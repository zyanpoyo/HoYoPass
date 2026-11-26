import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStateStore,
  getHoyoTodayDateString,
  getNextHoyoDailySignTimestamp,
  computeJitteredDelayMs,
  needsPolicyReview
} from '../src/services/state-store.js';
import { createReviewPromptService } from '../src/services/review-prompt-service.js';
import { API_CONFIG, STATUS_MAP, LEGACY_POLICY_VERSION, REVIEW_PROMPT_CONFIG } from '../src/config/constants.js';
import { createInMemoryStorageAdapter } from './helpers/in-memory-storage-adapter.js';

function createTestContext(initialNowMs = Date.parse('2026-10-17T03:00:00Z')) {
  let nowMs = initialNowMs;
  const clock = {
    now: () => nowMs,
    setNow: (ms) => { nowMs = ms; },
    advanceTime: (ms) => { nowMs += ms; }
  };
  const storage = createInMemoryStorageAdapter();
  const store = createStateStore({ storage, clock });
  const reviewPrompt = createReviewPromptService(store, { clock });
  return { storage, store, reviewPrompt, clock };
}

test('InMemoryStorageAdapter: local/session の配列・オブジェクト取得・clone隔離・remove・onChanged 準拠', async () => {
  const storage = createInMemoryStorageAdapter();
  const events = [];
  const listener = (changes, areaName) => events.push({ changes, areaName });
  storage.onChanged.addListener(listener);

  const mutableObj = { nested: [1, 2] };
  await storage.local.set({ k1: mutableObj, k2: 'val2' });
  mutableObj.nested.push(3);

  const gotArr = await storage.local.get(['k1', 'k2', 'missing']);
  assert.deepEqual(gotArr, { k1: { nested: [1, 2] }, k2: 'val2' }, '保存時・取得時ともに参照が隔離されること');
  assert.equal(Object.hasOwn(gotArr, 'missing'), false, '未存在キーは含まれないこと');

  const gotDefaults = await storage.local.get({ k2: 'fallback', k3: 'default3' });
  assert.deepEqual(gotDefaults, { k2: 'val2', k3: 'default3' });

  const gotAll = await storage.local.get(null);
  assert.deepEqual(gotAll, { k1: { nested: [1, 2] }, k2: 'val2' });

  await storage.session.set({ ga_session_id: 'sid1', ga_last_active: 1000, extra: 'x' });
  const sessionArr = await storage.session.get(['ga_session_id', 'ga_last_active', 'nope']);
  assert.deepEqual(sessionArr, { ga_session_id: 'sid1', ga_last_active: 1000 });

  await storage.session.remove(['ga_session_id', 'ga_last_active']);
  assert.deepEqual(await storage.session.get(null), { extra: 'x' });

  assert.equal(events.length, 3);
  assert.equal(events[0].areaName, 'local');
  assert.deepEqual(events[0].changes.k1, { newValue: { nested: [1, 2] } });
  assert.equal(events[2].areaName, 'session');
  assert.deepEqual(events[2].changes.ga_session_id, { oldValue: 'sid1' });

  storage.onChanged.removeListener(listener);
  await storage.local.set({ k2: 'val3' });
  assert.equal(events.length, 3);
});

test('addExecutionLog / getExecutionLogs: ログの追加と最大保持件数(MAX_EXECUTION_LOGS: 50)の維持', async () => {
  const { store } = createTestContext();
  assert.equal(API_CONFIG.MAX_EXECUTION_LOGS, 50, '定数MAX_EXECUTION_LOGSは50であること');
  assert.deepEqual(await store.getExecutionLogs(), []);

  await store.addExecutionLog({ message: 'ログ 1' });
  let logs = await store.getExecutionLogs();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].message, 'ログ 1');

  for (let i = 2; i <= 56; i++) {
    await store.addExecutionLog({ message: `ログ ${i}` });
  }

  logs = await store.getExecutionLogs();
  assert.equal(logs.length, 50, '保持件数が50件に制限されていること');
  assert.equal(logs[0].message, 'ログ 56', '先頭に最新ログが格納されていること');
  assert.equal(logs[49].message, 'ログ 7', '最も古い50件目（ログ7）が残っており、それ以前は破棄されていること');
});

test('shouldRunRedeem / recordFlowStart / recordFlowSuccess: 経過判定と試行/成功時刻の新しい方を基準に判定', async () => {
  const baseNow = 1_750_000_000_000;
  const { store, clock } = createTestContext(baseNow);

  assert.equal(await store.shouldRunRedeem(180), true, '初期状態では実行対象');

  // 2時間前に成功
  clock.setNow(baseNow - 2 * 60 * 60_000);
  await store.recordFlowSuccess('REDEEM', { isManual: false, recordSuccessTimestamp: true });
  clock.setNow(baseNow);
  assert.equal(await store.shouldRunRedeem(180), false, '2時間経過時点では3時間未達のためfalse');

  // 3時間1分前に成功
  clock.setNow(baseNow - (3 * 60 * 60_000 + 60_000));
  await store.recordFlowSuccess('REDEEM', { isManual: false, recordSuccessTimestamp: true });
  clock.setNow(baseNow);
  assert.equal(await store.shouldRunRedeem(180), true, '3時間以上経過時はtrue');

  // 1時間前に自動試行だけしていた場合は3時間クールダウンで false
  clock.setNow(baseNow - 60 * 60_000);
  await store.recordFlowStart('REDEEM', { isManual: false });
  clock.setNow(baseNow);
  assert.equal(await store.shouldRunRedeem(180), false);

  // 3時間経過すれば再び true
  clock.setNow(baseNow - 180 * 60_000);
  await store.recordFlowStart('REDEEM', { isManual: false });
  clock.setNow(baseNow);
  assert.equal(await store.shouldRunRedeem(180), true);
});

test('getHoyoTodayDateString & getNextHoyoDailySignTimestamp: UTC+8 日付境界と次回 00:05+ジッター算出', () => {
  const beforeResetMs = Date.parse('2026-10-16T15:59:59Z'); // 23:59:59 UTC+8
  assert.equal(getHoyoTodayDateString(beforeResetMs), '2026-10-16');

  const afterResetMs = Date.parse('2026-10-16T16:00:00Z'); // 00:00:00 UTC+8
  assert.equal(getHoyoTodayDateString(afterResetMs), '2026-10-17');

  // 当日 00:02 UTC+8 (= 16:02 UTC) にジッター15分 -> 同日 00:20 UTC+8 (= 16:20 UTC)
  const beforeTarget = Date.parse('2026-10-16T16:02:00Z');
  assert.equal(getNextHoyoDailySignTimestamp(beforeTarget, 15), Date.parse('2026-10-16T16:20:00Z'));

  // 当日 00:20 UTC+8 ちょうど -> 翌日 00:20 UTC+8
  const atTarget = Date.parse('2026-10-16T16:20:00Z');
  assert.equal(getNextHoyoDailySignTimestamp(atTarget, 15), Date.parse('2026-10-17T16:20:00Z'));
});

test('getSettings / updateSettings: autoSignEnabled・enabledGames・agreedPolicyVersion の補完と検証', async () => {
  const { storage, store } = createTestContext();

  const initial = await store.getSettings();
  assert.equal(initial.optInAccepted, false);
  assert.equal(initial.autoRedeemEnabled, false);
  assert.equal(initial.autoSignEnabled, false);
  assert.deepEqual(initial.enabledGames, ['GENSHIN', 'STAR_RAIL', 'ZZZ']);
  assert.equal(initial.activeGameKey, 'GENSHIN');
  assert.equal(initial.agreedPolicyVersion, null);
  assert.equal(needsPolicyReview(initial), false);

  storage.seedLocal({
    app_settings: { optInAccepted: true, autoRedeemEnabled: true, activeGameKey: 'STAR_RAIL' }
  });
  const migrated = await store.getSettings();
  assert.equal(migrated.autoSignEnabled, true, 'オプトイン済み既存ユーザーはautoSignEnabledがtrueに補完される');
  assert.deepEqual(migrated.enabledGames, ['GENSHIN', 'STAR_RAIL', 'ZZZ']);
  assert.equal(migrated.activeGameKey, 'STAR_RAIL');
  assert.equal(migrated.agreedPolicyVersion, LEGACY_POLICY_VERSION);
  assert.equal(needsPolicyReview(migrated), false);
  assert.equal(needsPolicyReview(migrated, '2027-01-01'), true);
  assert.equal(needsPolicyReview({ optInAccepted: true, agreedPolicyVersion: '2026-10-12' }, '2026-10-26'), true);
  assert.equal(needsPolicyReview({ optInAccepted: true, agreedPolicyVersion: '2027-05-01' }, '2026-10-26'), false);

  await store.updateSettings({ autoSignEnabled: false });
  const afterToggle = await store.getSettings();
  assert.equal(afterToggle.autoSignEnabled, false);
  assert.equal(afterToggle.autoRedeemEnabled, true);

  storage.seedLocal({
    app_settings: { optInAccepted: true, enabledGames: [], activeGameKey: 'GENSHIN' }
  });
  assert.deepEqual((await store.getSettings()).enabledGames, ['GENSHIN', 'STAR_RAIL', 'ZZZ']);

  storage.seedLocal({
    app_settings: { optInAccepted: true, enabledGames: ['UNKNOWN_GAME', 'ZZZ'], activeGameKey: 'UNKNOWN_GAME' }
  });
  const filtered = await store.getSettings();
  assert.deepEqual(filtered.enabledGames, ['ZZZ']);
  assert.equal(filtered.activeGameKey, 'ZZZ');

  await store.updateSettings({ enabledGames: ['GENSHIN', 'ZZZ'], activeGameKey: 'ZZZ' });
  const updated = await store.getSettings();
  assert.deepEqual(updated.enabledGames, ['GENSHIN', 'ZZZ']);
  assert.equal(updated.activeGameKey, 'ZZZ');
});

test('getDailySignRecord / setDailySignRecord / getDailySignSkipReason / shouldRunDailySign', async () => {
  const testNowMs = Date.parse('2026-10-17T03:00:00Z');
  const { store } = createTestContext(testNowMs);

  assert.equal(await store.getDailySignSkipReason('hk4e_global'), null);
  assert.equal(await store.shouldRunDailySign(['hk4e_global', 'hkrpg_global']), true);
  assert.equal(await store.shouldRunDailySign([]), false);

  await store.setDailySignRecord('hk4e_global', {
    date: '2026-10-17',
    isSigned: true,
    totalSignDay: 12,
    skippedNoChar: false
  });

  const rec = await store.getDailySignRecord('hk4e_global');
  assert.equal(rec.totalSignDay, 12);
  assert.equal(await store.getDailySignSkipReason('hk4e_global'), 'ALREADY_SIGNED_TODAY');
  assert.equal(await store.shouldRunDailySign(['hk4e_global', 'hkrpg_global']), true, 'hkrpg_globalが未受取のためtrue');

  await store.setDailySignRecord('hkrpg_global', {
    date: '2026-10-17',
    isSigned: false,
    skippedNoChar: true
  });
  assert.equal(await store.getDailySignSkipReason('hkrpg_global'), 'ALREADY_SIGNED_TODAY');
  assert.equal(await store.shouldRunDailySign(['hk4e_global', 'hkrpg_global']), false, '全タイトル確定のためfalse');
});

test('captchaBlocked の当日自動スキップ・同日上書き保護・受取時/翌日クリア', async () => {
  const todayMs = Date.parse('2026-10-17T03:00:00Z');
  const nextDayMs = Date.parse('2026-10-17T16:10:00Z');
  const { store, clock } = createTestContext(todayMs);

  await store.setDailySignRecord('hk4e_global', {
    date: '2026-10-17',
    isSigned: false,
    skippedNoChar: false,
    captchaBlocked: true
  });

  assert.equal(await store.getDailySignSkipReason('hk4e_global'), 'CAPTCHA_BLOCKED_TODAY');
  assert.equal(await store.shouldRunDailySign(['hk4e_global']), false);

  await store.setDailySignRecord('hk4e_global', {
    date: '2026-10-17',
    isSigned: false,
    totalSignDay: 10,
    skippedNoChar: false
  });
  assert.equal((await store.getDailySignRecord('hk4e_global')).captchaBlocked, true);
  assert.equal(await store.getDailySignSkipReason('hk4e_global'), 'CAPTCHA_BLOCKED_TODAY');

  clock.setNow(nextDayMs);
  assert.equal(await store.getDailySignSkipReason('hk4e_global'), null);
  assert.equal(await store.shouldRunDailySign(['hk4e_global']), true);

  await store.setDailySignRecord('hk4e_global', {
    date: '2026-10-18',
    isSigned: false,
    skippedNoChar: false
  });
  assert.equal((await store.getDailySignRecord('hk4e_global')).captchaBlocked, undefined);

  await store.setDailySignRecord('hk4e_global', {
    date: '2026-10-18',
    isSigned: false,
    captchaBlocked: true
  });
  await store.setDailySignRecord('hk4e_global', {
    date: '2026-10-18',
    isSigned: true,
    totalSignDay: 11,
    skippedNoChar: false
  });
  assert.equal((await store.getDailySignRecord('hk4e_global')).captchaBlocked, false);
  assert.equal(await store.getDailySignSkipReason('hk4e_global'), 'ALREADY_SIGNED_TODAY');
});

test('getCodeRedeemStats & setActiveCodes: 月間・通算・有効コード消化率の正確な集計', async () => {
  const nowMs = Date.parse('2026-10-17T03:00:00Z');
  const { storage, store } = createTestContext(nowMs);
  const thisMonthSec = Math.floor(Date.parse('2026-10-05T00:00:00Z') / 1000);
  const lastMonthSec = Math.floor(Date.parse('2026-09-20T00:00:00Z') / 1000);

  const emptyStats = await store.getCodeRedeemStats('hk4e_global', nowMs);
  assert.equal(emptyStats.monthlyCount, 0);
  assert.equal(emptyStats.totalCount, 0);
  assert.equal(emptyStats.activeTotal, null);
  assert.equal(emptyStats.activeClaimed, null);

  storage.seedLocal({
    redeemed_hk4e_global: {
      CODE_THIS_MONTH_SUCCESS: { s: STATUS_MAP.SUCCESS, t: thisMonthSec },
      CODE_THIS_MONTH_CLAIMED: { s: STATUS_MAP.ALREADY_CLAIMED, t: thisMonthSec },
      CODE_LAST_MONTH_SUCCESS: { s: STATUS_MAP.SUCCESS, t: lastMonthSec },
      CODE_LAST_MONTH_CLAIMED: { s: STATUS_MAP.ALREADY_CLAIMED, t: lastMonthSec },
      CODE_EXPIRED: { s: STATUS_MAP.EXPIRED, t: thisMonthSec },
      CODE_FAILED: { s: STATUS_MAP.FAILED, t: thisMonthSec },
      CODE_PENDING: { s: STATUS_MAP.PENDING_RETRY, t: thisMonthSec }
    }
  });

  const statsWithoutActive = await store.getCodeRedeemStats('hk4e_global', nowMs);
  assert.equal(statsWithoutActive.monthlyCount, 2);
  assert.equal(statsWithoutActive.totalCount, 4);
  assert.equal(statsWithoutActive.activeTotal, null);

  await store.setActiveCodes('hk4e_global', [
    'CODE_THIS_MONTH_SUCCESS',
    'CODE_THIS_MONTH_CLAIMED',
    'CODE_UNCLAIMED',
    'CODE_EXPIRED',
    'CODE_FAILED'
  ]);
  assert.deepEqual(storage.peekLocal('active_codes_hk4e_global'), [
    'CODE_THIS_MONTH_SUCCESS',
    'CODE_THIS_MONTH_CLAIMED',
    'CODE_UNCLAIMED',
    'CODE_EXPIRED',
    'CODE_FAILED'
  ]);

  const statsWithActive = await store.getCodeRedeemStats('hk4e_global', nowMs);
  assert.equal(statsWithActive.activeTotal, 3);
  assert.equal(statsWithActive.activeClaimed, 2);
});

test('reviewPrompt: 初期状態・マイグレーション・加算・バックオフ抑制・延期・恒久非表示', async () => {
  const nowMs = 1730000000000;
  const { storage, store, reviewPrompt, clock } = createTestContext(nowMs);

  const emptyState = await reviewPrompt.getReviewPromptState();
  assert.equal(emptyState.successCount, 0);
  assert.equal(emptyState.status, 'pending');
  assert.equal(emptyState.postponeCount, 0);
  assert.equal(emptyState.nextEligibleTimestamp, 0);
  assert.equal(emptyState.firstInstalledAt, nowMs);
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false);

  storage.seedLocal({
    redeemed_hk4e_global: {
      CODE1: { s: STATUS_MAP.SUCCESS },
      CODE2: { s: STATUS_MAP.ALREADY_CLAIMED },
      CODE3: { s: STATUS_MAP.EXPIRED }
    },
    redeemed_hkrpg_global: {
      CODE4: { s: STATUS_MAP.SUCCESS }
    },
    daily_sign_hk4e_global: { isSigned: true },
    daily_sign_hkrpg_global: { isSigned: false }
  });

  const migrated = await reviewPrompt.initReviewPromptState();
  assert.equal(migrated.successCount, 3);
  assert.equal(migrated.status, 'pending');
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), true);

  storage.clearLocal();
  storage.seedLocal({
    redeemed_hk4e_global: {
      C1: { s: STATUS_MAP.SUCCESS },
      C2: { s: STATUS_MAP.SUCCESS },
      C3: { s: STATUS_MAP.SUCCESS },
      C4: { s: STATUS_MAP.SUCCESS }
    }
  });
  const capped = await reviewPrompt.initReviewPromptState();
  assert.equal(capped.successCount, 3, '上限3に制限されること');

  storage.clearLocal();
  await reviewPrompt.initReviewPromptState();
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false);

  await reviewPrompt.incrementReviewSuccessCount();
  assert.equal((await reviewPrompt.getReviewPromptState()).successCount, 1);
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false);

  await reviewPrompt.incrementReviewSuccessCount();
  await reviewPrompt.incrementReviewSuccessCount();
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), true);

  storage.seedLocal({ backoff_until: nowMs + 10 * 60 * 1000 });
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false, 'バックオフ中は表示されないこと');
  storage.seedLocal({ backoff_until: nowMs - 1000 });
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), true);

  const postponed1 = await reviewPrompt.postponeReviewPrompt();
  assert.equal(postponed1.status, 'postponed');
  assert.equal(postponed1.postponeCount, 1);
  assert.equal(postponed1.nextEligibleTimestamp, nowMs + REVIEW_PROMPT_CONFIG.POSTPONE_DURATION_MS);

  clock.setNow(nowMs + 3 * 24 * 60 * 60 * 1000);
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false);

  const after7Days = nowMs + REVIEW_PROMPT_CONFIG.POSTPONE_DURATION_MS;
  clock.setNow(after7Days);
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), true);

  const postponed2 = await reviewPrompt.postponeReviewPrompt();
  assert.equal(postponed2.status, 'dismissed');
  assert.equal(postponed2.postponeCount, 2);

  clock.setNow(after7Days + 14 * 24 * 60 * 60 * 1000);
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false);

  await reviewPrompt.updateReviewPromptState({ status: 'completed' });
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false);
  await reviewPrompt.updateReviewPromptState({ status: 'dismissed' });
  assert.equal(await reviewPrompt.shouldShowReviewPrompt(), false);
});

test('排他ロックと pingSessionKeepAlive: 獲得・解放・5分タイムアウト・例外安全完了', async () => {
  const baseNow = 1_750_000_000_000;
  const { storage, store, clock } = createTestContext(baseNow);

  assert.equal(await store.acquireExecutionLock('TEST'), true);
  assert.equal(await store.acquireExecutionLock('TEST2'), false, '実行中はロック獲得失敗');

  clock.advanceTime(5 * 60 * 1000 + 1);
  assert.equal(await store.acquireExecutionLock('EXPIRED_PREV'), true, '5分経過後は失効し再獲得できる');

  await store.releaseExecutionLock();
  assert.equal(await store.acquireExecutionLock('TEST3'), true);
  await store.releaseExecutionLock();

  const sessionGetKeys = [];
  storage.setSessionGetHook(async (key) => {
    sessionGetKeys.push(key);
  });
  await store.pingSessionKeepAlive();
  assert.deepEqual(sessionGetKeys, ['lock_state']);

  storage.setSessionGetHook(async () => {
    throw new Error('storage session error');
  });
  await assert.doesNotReject(() => store.pingSessionKeepAlive());
});

test('コードステータス記録・日次受付上限・容量監視・履歴トリミング', async () => {
  const { storage, store } = createTestContext();

  await store.markCodeStatus('hk4e_global', 'TESTCODE1', 'SUCCESS');
  let codes = await store.getRedeemedCodes('hk4e_global');
  assert.equal(codes.TESTCODE1.s, STATUS_MAP.SUCCESS);

  await store.markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  codes = await store.getRedeemedCodes('hk4e_global');
  assert.equal(codes.ERRCODE.s, STATUS_MAP.PENDING_RETRY);
  assert.equal(codes.ERRCODE.r, 1);

  await store.markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  await store.markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  codes = await store.getRedeemedCodes('hk4e_global');
  assert.equal(codes.ERRCODE.s, STATUS_MAP.FAILED, '3回失敗でFAILED確定');

  storage.setBytesInUse(9 * 1024 * 1024);
  assert.equal((await store.checkStorageCapacity()).isWarning, true);
  storage.setBytesInUse(1024);
  assert.equal((await store.checkStorageCapacity()).isWarning, false);

  storage.setLocalWriteError(new Error('quota exceeded'));
  await assert.rejects(
    () => store.markCodeStatus('hk4e_global', 'ERRCODE2', 'SUCCESS'),
    /STORAGE_WRITE_FAILURE: quota exceeded/
  );
});

test('computeJitteredDelayMs & getOrCreateDailySignJitterMinutes: ジッター計算と破損値修復', async () => {
  assert.equal(computeJitteredDelayMs(0, 30_000, () => 0.9), 0);
  assert.equal(computeJitteredDelayMs(-100, 30_000, () => 0.5), 0);
  assert.equal(computeJitteredDelayMs(15_000, 0, () => 0.5), 15_000);
  assert.equal(computeJitteredDelayMs(15_000, 30_000, () => 0), 15_000);
  assert.equal(computeJitteredDelayMs(15_000, 30_000, () => 0.999999), 45_000);

  const { storage, store } = createTestContext();
  const first = await store.getOrCreateDailySignJitterMinutes(() => 0.5);
  assert.equal(first.created, true);
  assert.ok(first.minutes >= 0 && first.minutes <= API_CONFIG.DAILY_SIGN_JITTER_MAX_MINUTES);
  assert.equal(first.minutes, 15);

  const second = await store.getOrCreateDailySignJitterMinutes(() => 0.9);
  assert.equal(second.created, false);
  assert.equal(second.minutes, 15);

  storage.seedLocal({ daily_sign_jitter_minutes: 999 });
  const repaired = await store.getOrCreateDailySignJitterMinutes(() => 0);
  assert.equal(repaired.created, true);
  assert.equal(repaired.minutes, 0);
});

test('指数バックオフ: 30→60→120分段階延長、Retry-After上限キャップ、既存backoff_until互換、リセット', async () => {
  const baseNow = 1_750_000_000_000;
  const { storage, store, clock } = createTestContext(baseNow);

  // 既存ユーザー互換（backoff_untilのみ保存、backoff_level未定義）
  storage.seedLocal({ backoff_until: baseNow + 30 * 60 * 1000 });
  clock.setNow(baseNow + 1000);
  assert.equal(await store.isUnderBackoff(), true);
  const legacyState = await store.getBackoffState();
  assert.equal(legacyState.level, 0);
  assert.equal(legacyState.remainingMinutes, 30);

  storage.clearLocal();
  clock.setNow(baseNow);
  assert.equal((await store.recordBackoffFailure()).level, 1);
  assert.equal((await store.recordBackoffFailure()).remainingMinutes, 60);
  assert.equal((await store.recordBackoffFailure()).remainingMinutes, 120);
  const bo4 = await store.recordBackoffFailure();
  assert.equal(bo4.level, 3);
  assert.equal(bo4.remainingMinutes, 120);

  storage.clearLocal();
  assert.equal((await store.recordBackoffFailure({ retryAfterMs: 90 * 60 * 1000 })).remainingMinutes, 90);
  assert.equal((await store.recordBackoffFailure({ retryAfterMs: 300 * 60 * 1000 })).remainingMinutes, 120);

  // recordFlowSuccess でレベル0に戻る
  await store.recordFlowSuccess('REDEEM', { isManual: true });
  const boAfterReset = await store.recordBackoffFailure();
  assert.equal(boAfterReset.level, 1);
  assert.equal(boAfterReset.remainingMinutes, 30);
});

test('consumeRetrySlot / resetRetryState: 最大3回 (2→10→30分) と打ち止め、3時間失効', async () => {
  const baseNow = 1_750_000_000_000;
  const { store, clock } = createTestContext(baseNow);

  const s1 = await store.consumeRetrySlot('REDEEM', { randFn: () => 0.5 });
  assert.equal(s1.allowed, true);
  assert.equal(s1.attempt, 1);
  assert.equal(s1.baseMinutes, 2);
  assert.ok(s1.delayMinutes >= 2 && s1.delayMinutes <= 2.5);

  clock.setNow(baseNow + 2 * 60_000);
  const s2 = await store.consumeRetrySlot('REDEEM', { randFn: () => 0 });
  assert.equal(s2.allowed, true);
  assert.equal(s2.attempt, 2);
  assert.equal(s2.delayMinutes, 10);

  clock.setNow(baseNow + 12 * 60_000);
  const s3 = await store.consumeRetrySlot('REDEEM', { randFn: () => 0.99 });
  assert.equal(s3.allowed, true);
  assert.equal(s3.attempt, 3);
  assert.ok(s3.delayMinutes >= 30 && s3.delayMinutes <= 30.5);

  clock.setNow(baseNow + 42 * 60_000);
  const s4 = await store.consumeRetrySlot('REDEEM');
  assert.equal(s4.allowed, false);
  assert.equal(s4.exhausted, true);
  assert.equal(s4.shouldLogExhausted, true);

  clock.setNow(baseNow + 45 * 60_000);
  const s5 = await store.consumeRetrySlot('REDEEM');
  assert.equal(s5.allowed, false);
  assert.equal(s5.shouldLogExhausted, false);

  // 3時間経過後は自動失効して再び1回目から可能
  clock.setNow(baseNow + 42 * 60_000 + API_CONFIG.AUTO_ATTEMPT_COOLDOWN_MINUTES * 60_000);
  const afterExpired = await store.consumeRetrySlot('REDEEM', { randFn: () => 0 });
  assert.equal(afterExpired.allowed, true);
  assert.equal(afterExpired.attempt, 1);

  await store.consumeRetrySlot('SIGN', { randFn: () => 0 });
  await store.resetRetryState('SIGN');
  const afterReset = await store.consumeRetrySlot('SIGN', { randFn: () => 0 });
  assert.equal(afterReset.attempt, 1);
});

test('isUnderAutoAttemptCooldown: 3時間クールダウンとSIGNのHoYo日付跨ぎ解除', async () => {
  const beforeMidnight = Date.parse('2026-10-16T15:30:00Z'); // 23:30 UTC+8
  const { store, clock } = createTestContext(beforeMidnight);

  await store.recordFlowStart('SIGN', { isManual: false });
  await store.recordFlowStart('REDEEM', { isManual: false });

  clock.setNow(Date.parse('2026-10-16T15:45:00Z')); // 23:45 UTC+8
  assert.equal(await store.isUnderAutoAttemptCooldown('SIGN', 180), true);
  assert.equal(await store.isUnderAutoAttemptCooldown('REDEEM', 180), true);

  clock.setNow(Date.parse('2026-10-16T16:10:00Z')); // 翌00:10 UTC+8
  assert.equal(await store.isUnderAutoAttemptCooldown('SIGN', 180), false);
  assert.equal(await store.isUnderAutoAttemptCooldown('REDEEM', 180), true);

  clock.setNow(beforeMidnight + 180 * 60_000);
  assert.equal(await store.isUnderAutoAttemptCooldown('REDEEM', 180), false);
});

test('checkManualCooldown / recordFlowStart(isManual): ゲーム×操作種別ごとの60秒制限と session 未定義安全性', async () => {
  const baseNow = 1_750_000_000_000;
  const { storage, store, clock } = createTestContext(baseNow);

  assert.equal((await store.checkManualCooldown('CODE', 'GENSHIN')).allowed, true);

  await store.recordFlowStart('REDEEM', { isManual: true, category: 'CODE', gameKey: 'GENSHIN' });

  clock.setNow(baseNow + 20_000);
  const blocked = await store.checkManualCooldown('CODE', 'GENSHIN');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remainingSec, 40);

  assert.equal((await store.checkManualCooldown('CODE', 'STAR_RAIL')).allowed, true);
  assert.equal((await store.checkManualCooldown('SIGN', 'GENSHIN')).allowed, true);

  clock.setNow(baseNow + 60_000);
  assert.equal((await store.checkManualCooldown('CODE', 'GENSHIN')).allowed, true);

  storage.setSessionAvailable(false);
  assert.equal((await store.checkManualCooldown('CODE', 'GENSHIN')).allowed, true);
  await store.recordFlowStart('REDEEM', { isManual: true, category: 'CODE', gameKey: 'GENSHIN' });
});

test('subscribeChanges: local 変更キーのドメインイベント変換と unsubscribe 解除', async () => {
  const { storage, store } = createTestContext();
  const received = [];
  const unsubscribe = store.subscribeChanges((ev) => received.push(ev));

  await store.addExecutionLog({ message: 'hi' });
  await store.setActiveCodes('hk4e_global', ['C1']);
  await store.setDailySignRecord('nap_global', { date: '2026-10-17', isSigned: true });
  await store.updateSettings({ language: 'en' });
  await store.getOrCreateDailySignJitterMinutes(() => 0); // daily_sign_jitter_minutes は signChangedBiz に誤爆しない
  await storage.session.set({ ga_session_id: 's1' }); // session 領域は無視

  assert.equal(received.length, 4);
  assert.deepEqual(received[0], { logsChanged: true, settingsChanged: false, redeemChangedBiz: [], signChangedBiz: [] });
  assert.deepEqual(received[1], { logsChanged: false, settingsChanged: false, redeemChangedBiz: ['hk4e_global'], signChangedBiz: [] });
  assert.deepEqual(received[2], { logsChanged: false, settingsChanged: false, redeemChangedBiz: [], signChangedBiz: ['nap_global'] });
  assert.deepEqual(received[3], { logsChanged: false, settingsChanged: true, redeemChangedBiz: [], signChangedBiz: [] });

  unsubscribe();
  await store.addExecutionLog({ message: 'after unsubscribe' });
  assert.equal(received.length, 4);
});

test('getOrCreateGaSessionId: 配列一括取得と30分タイムアウト', async () => {
  const baseNow = 1_750_000_000_000;
  const { store, clock } = createTestContext(baseNow);

  const sid1 = await store.getOrCreateGaSessionId();
  assert.equal(sid1, String(baseNow));

  clock.advanceTime(10 * 60_000);
  assert.equal(await store.getOrCreateGaSessionId(), sid1);

  clock.advanceTime(31 * 60_000);
  const sid2 = await store.getOrCreateGaSessionId();
  assert.notEqual(sid2, sid1);
});

import test from 'node:test';
import assert from 'node:assert/strict';

const mockStorage = {
  local: new Map(),
  session: new Map()
};

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: mockStorage.local.get(key) }),
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.local.set(k, v))
    },
    session: {
      get: async (key) => ({ [key]: mockStorage.session.get(key) }),
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.session.set(k, v)),
      remove: async (key) => mockStorage.session.delete(key)
    }
  }
};

import { API_CONFIG } from '../src/config/constants.js';
import {
  computeJitteredDelayMs,
  getDailySignJitterMinutes,
  getOrCreateDailySignJitterMinutes,
  getBackoffState,
  isUnderBackoff,
  setBackoff,
  recordBackoffFailure,
  resetBackoffLevel,
  getRetryState,
  consumeRetrySlot,
  resetRetryState,
  setLastAttemptTimestamp,
  isUnderAutoAttemptCooldown,
  checkManualCooldown,
  recordManualCooldown,
  clearManualCooldowns
} from '../src/services/rate-limit-service.js';

test('computeJitteredDelayMs: ベース0以下は常に0、正数は範囲内の揺らぎを付与', () => {
  assert.equal(computeJitteredDelayMs(0, 30_000, () => 0.9), 0);
  assert.equal(computeJitteredDelayMs(-100, 30_000, () => 0.5), 0);
  assert.equal(computeJitteredDelayMs(15_000, 0, () => 0.5), 15_000);
  assert.equal(computeJitteredDelayMs(15_000, 30_000, () => 0), 15_000);
  assert.equal(computeJitteredDelayMs(15_000, 30_000, () => 0.999999), 45_000);
});

test('getOrCreateDailySignJitterMinutes: 0〜30分のユーザー固定オフセット生成と維持', async () => {
  mockStorage.local.clear();

  assert.equal(await getDailySignJitterMinutes(), null);

  const first = await getOrCreateDailySignJitterMinutes(() => 0.5);
  assert.equal(first.created, true);
  assert.ok(first.minutes >= 0 && first.minutes <= API_CONFIG.DAILY_SIGN_JITTER_MAX_MINUTES);
  assert.equal(first.minutes, 15);

  // 2回目は既存値を維持し created: false を返す
  const second = await getOrCreateDailySignJitterMinutes(() => 0.9);
  assert.equal(second.created, false);
  assert.equal(second.minutes, 15);
  assert.equal(await getDailySignJitterMinutes(), 15);

  // 範囲外の破損値が保存されていた場合は再生成する
  mockStorage.local.set('daily_sign_jitter_minutes', 999);
  const repaired = await getOrCreateDailySignJitterMinutes(() => 0);
  assert.equal(repaired.created, true);
  assert.equal(repaired.minutes, 0);
});

test('指数バックオフ: 30→60→120分段階延長、Retry-After上限キャップ、既存backoff_until互換、リセット', async () => {
  mockStorage.local.clear();
  const baseNow = 1_750_000_000_000;

  // 既存ユーザー互換（backoff_untilのみ保存、backoff_level未定義）
  await setBackoff(30 * 60 * 1000, baseNow);
  assert.equal(await isUnderBackoff(baseNow + 1000), true);
  const legacyState = await getBackoffState(baseNow + 1000);
  assert.equal(legacyState.level, 0);
  assert.equal(legacyState.remainingMinutes, 30);

  // 1回目失敗: 30分
  mockStorage.local.clear();
  const bo1 = await recordBackoffFailure({ nowMs: baseNow });
  assert.equal(bo1.level, 1);
  assert.equal(bo1.remainingMinutes, 30);

  // 2回目失敗: 60分
  const bo2 = await recordBackoffFailure({ nowMs: baseNow });
  assert.equal(bo2.level, 2);
  assert.equal(bo2.remainingMinutes, 60);

  // 3回目失敗: 120分 (上限)
  const bo3 = await recordBackoffFailure({ nowMs: baseNow });
  assert.equal(bo3.level, 3);
  assert.equal(bo3.remainingMinutes, 120);

  // 4回目以降もレベル3・120分でキャップ
  const bo4 = await recordBackoffFailure({ nowMs: baseNow });
  assert.equal(bo4.level, 3);
  assert.equal(bo4.remainingMinutes, 120);

  // Retry-After 90分は尊重、300分は120分でキャップ
  mockStorage.local.clear();
  const boRetryAfter = await recordBackoffFailure({ retryAfterMs: 90 * 60 * 1000, nowMs: baseNow });
  assert.equal(boRetryAfter.remainingMinutes, 90);
  const boRetryAfterCapped = await recordBackoffFailure({ retryAfterMs: 300 * 60 * 1000, nowMs: baseNow });
  assert.equal(boRetryAfterCapped.remainingMinutes, 120);

  // リセットでレベル0に戻る
  await resetBackoffLevel();
  const boAfterReset = await recordBackoffFailure({ nowMs: baseNow });
  assert.equal(boAfterReset.level, 1);
  assert.equal(boAfterReset.remainingMinutes, 30);
});

test('consumeRetrySlot / resetRetryState: 最大3回 (2→10→30分) と打ち止め、3時間失効', async () => {
  mockStorage.local.clear();
  const baseNow = 1_750_000_000_000;

  // 1回目: 2分 (+揺らぎ)
  const s1 = await consumeRetrySlot('REDEEM', { nowMs: baseNow, randFn: () => 0.5 });
  assert.equal(s1.allowed, true);
  assert.equal(s1.attempt, 1);
  assert.equal(s1.baseMinutes, 2);
  assert.ok(s1.delayMinutes >= 2 && s1.delayMinutes <= 2.5);

  // 2回目: 10分 (+揺らぎ)
  const s2 = await consumeRetrySlot('REDEEM', { nowMs: baseNow + 2 * 60_000, randFn: () => 0 });
  assert.equal(s2.allowed, true);
  assert.equal(s2.attempt, 2);
  assert.equal(s2.baseMinutes, 10);
  assert.equal(s2.delayMinutes, 10);

  // 3回目: 30分 (+揺らぎ)
  const s3 = await consumeRetrySlot('REDEEM', { nowMs: baseNow + 12 * 60_000, randFn: () => 0.99 });
  assert.equal(s3.allowed, true);
  assert.equal(s3.attempt, 3);
  assert.equal(s3.baseMinutes, 30);
  assert.ok(s3.delayMinutes >= 30 && s3.delayMinutes <= 30.5);

  // 4回目: 上限到達（初回のみ打ち止めログ出力許可）
  const s4 = await consumeRetrySlot('REDEEM', { nowMs: baseNow + 42 * 60_000 });
  assert.equal(s4.allowed, false);
  assert.equal(s4.exhausted, true);
  assert.equal(s4.shouldLogExhausted, true);

  // 5回目: ログ重複なし
  const s5 = await consumeRetrySlot('REDEEM', { nowMs: baseNow + 45 * 60_000 });
  assert.equal(s5.allowed, false);
  assert.equal(s5.exhausted, true);
  assert.equal(s5.shouldLogExhausted, false);

  // 3時間経過後は自動失効して0扱い
  const after3h = baseNow + 42 * 60_000 + API_CONFIG.AUTO_ATTEMPT_COOLDOWN_MINUTES * 60_000;
  const expiredState = await getRetryState('REDEEM', after3h);
  assert.equal(expiredState.count, 0);

  // 明示リセットの検証
  await consumeRetrySlot('SIGN', { nowMs: baseNow });
  await resetRetryState('SIGN');
  const afterReset = await getRetryState('SIGN', baseNow);
  assert.equal(afterReset.count, 0);
});

test('isUnderAutoAttemptCooldown: 3時間クールダウンとSIGNのHoYo日付跨ぎ解除', async () => {
  mockStorage.local.clear();

  // 2026-10-16 23:30 UTC+8 (= 2026-10-16 15:30:00Z)
  const beforeMidnight = Date.parse('2026-10-16T15:30:00Z');
  await setLastAttemptTimestamp('SIGN', beforeMidnight);
  await setLastAttemptTimestamp('REDEEM', beforeMidnight);

  // 15分後 (23:45 UTC+8, 同日): 両方クールダウン中
  const sameDay = Date.parse('2026-10-16T15:45:00Z');
  assert.equal(await isUnderAutoAttemptCooldown('SIGN', 180, sameDay), true);
  assert.equal(await isUnderAutoAttemptCooldown('REDEEM', 180, sameDay), true);

  // 40分後 (2026-10-17 00:10 UTC+8, 日付跨ぎ): SIGNは即解除、REDEEMは3時間継続
  const nextDay = Date.parse('2026-10-16T16:10:00Z');
  assert.equal(await isUnderAutoAttemptCooldown('SIGN', 180, nextDay), false);
  assert.equal(await isUnderAutoAttemptCooldown('REDEEM', 180, nextDay), true);

  // 3時間経過後: REDEEMも解除
  const after3h = beforeMidnight + 180 * 60_000;
  assert.equal(await isUnderAutoAttemptCooldown('REDEEM', 180, after3h), false);
});

test('checkManualCooldown / recordManualCooldown: ゲーム×操作種別ごとの60秒制限', async () => {
  mockStorage.session.clear();
  const baseNow = 1_750_000_000_000;

  assert.equal((await checkManualCooldown('CODE', 'GENSHIN', baseNow)).allowed, true);

  await recordManualCooldown('CODE', 'GENSHIN', baseNow);

  // 20秒後: 同ゲーム・同種別は拒否（残り40秒）
  const blocked = await checkManualCooldown('CODE', 'GENSHIN', baseNow + 20_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remainingSec, 40);

  // 別ゲーム・別種別は即許可
  assert.equal((await checkManualCooldown('CODE', 'STAR_RAIL', baseNow + 20_000)).allowed, true);
  assert.equal((await checkManualCooldown('SIGN', 'GENSHIN', baseNow + 20_000)).allowed, true);

  // 60秒経過後は再許可
  assert.equal((await checkManualCooldown('CODE', 'GENSHIN', baseNow + 60_000)).allowed, true);

  // クリア後とstorage.session未定義時の安全動作
  await clearManualCooldowns();
  assert.equal((await checkManualCooldown('CODE', 'GENSHIN', baseNow + 1_000)).allowed, true);

  const origSession = globalThis.chrome.storage.session;
  globalThis.chrome.storage.session = undefined;
  try {
    const safeCheck = await checkManualCooldown('CODE', 'GENSHIN', baseNow);
    assert.equal(safeCheck.allowed, true);
    await recordManualCooldown('CODE', 'GENSHIN', baseNow);
    await clearManualCooldowns();
  } finally {
    globalThis.chrome.storage.session = origSession;
  }
});

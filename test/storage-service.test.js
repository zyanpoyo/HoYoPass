import test from 'node:test';
import assert from 'node:assert/strict';

const mockStorage = {
  local: new Map()
};

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { res[k] = mockStorage.local.get(k); });
        } else if (typeof keys === 'string') {
          res[keys] = mockStorage.local.get(keys);
        } else {
          mockStorage.local.forEach((v, k) => { res[k] = v; });
        }
        return res;
      },
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.local.set(k, v))
    }
  }
};

import {
  addExecutionLog,
  getLastSuccessfulRun,
  setLastSuccessfulRun,
  shouldRunRedeem,
  getSettings,
  updateSettings,
  getHoyoTodayDateString,
  getDailySignRecord,
  setDailySignRecord,
  isDailySignedToday,
  shouldRunDailySign,
  getActiveCodes,
  setActiveCodes,
  getCodeRedeemStats,
  needsPolicyReview
} from '../src/services/storage-service.js';
import { API_CONFIG, STATUS_MAP, PRIVACY_POLICY_VERSION, LEGACY_POLICY_VERSION } from '../src/config/constants.js';

test('addExecutionLog: ログの追加と最大保持件数(MAX_EXECUTION_LOGS: 50)の維持', async () => {
  mockStorage.local.clear();

  assert.equal(API_CONFIG.MAX_EXECUTION_LOGS, 50, '定数MAX_EXECUTION_LOGSは50であること');

  // 1件目の追加
  await addExecutionLog({ message: 'ログ 1' });
  let data = await chrome.storage.local.get('exec_logs');
  assert.equal(data.exec_logs.length, 1);
  assert.equal(data.exec_logs[0].message, 'ログ 1');

  // 55件追加（合計56件になるため、上限50件にトリムされる）
  for (let i = 2; i <= 56; i++) {
    await addExecutionLog({ message: `ログ ${i}` });
  }

  data = await chrome.storage.local.get('exec_logs');
  assert.equal(data.exec_logs.length, 50, '保持件数が50件に制限されていること');
  assert.equal(data.exec_logs[0].message, 'ログ 56', '先頭に最新ログが格納されていること');
  assert.equal(data.exec_logs[49].message, 'ログ 7', '最も古い50件目（ログ7）が残っており、それ以前は破棄されていること');
});

test('getLastSuccessfulRun / setLastSuccessfulRun: 最終実行時刻の保存と取得', async () => {
  mockStorage.local.clear();

  const initial = await getLastSuccessfulRun();
  assert.equal(initial, 0, '未記録時は0を返す');

  const now = 1700000000000;
  await setLastSuccessfulRun(now);
  const updated = await getLastSuccessfulRun();
  assert.equal(updated, now, '保存したタイムスタンプが取得できる');
});

test('shouldRunRedeem: 指定インターバル経過判定', async () => {
  mockStorage.local.clear();

  // 未記録時は必ずtrue
  const shouldRunInitial = await shouldRunRedeem(180);
  assert.equal(shouldRunInitial, true, '初期状態では実行対象');

  // 2時間前に実行された場合（180分インターバルの場合まだfalse）
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
  await setLastSuccessfulRun(twoHoursAgo);
  const shouldRun2h = await shouldRunRedeem(180);
  assert.equal(shouldRun2h, false, '2時間経過時点では3時間未達のためfalse');

  // 3時間1分前に実行された場合（180分経過でtrue）
  const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000 + 60 * 1000);
  await setLastSuccessfulRun(threeHoursAgo);
  const shouldRun3h = await shouldRunRedeem(180);
  assert.equal(shouldRun3h, true, '3時間以上経過時はtrue');
});

test('getHoyoTodayDateString: UTC+8 (JST 01:00) 日付境界の正確な算出', () => {
  // 2026-10-17 00:59:59 JST = 2026-10-16 15:59:59 UTC = 2026-10-16 23:59:59 UTC+8
  const beforeResetMs = Date.parse('2026-10-16T15:59:59Z');
  assert.equal(getHoyoTodayDateString(beforeResetMs), '2026-10-16');

  // 2026-10-17 01:00:00 JST = 2026-10-16 16:00:00 UTC = 2026-10-17 00:00:00 UTC+8
  const afterResetMs = Date.parse('2026-10-16T16:00:00Z');
  assert.equal(getHoyoTodayDateString(afterResetMs), '2026-10-17');
});

test('getSettings / updateSettings: autoSignEnabledの個別制御と既存設定からの補完', async () => {
  mockStorage.local.clear();

  const initial = await getSettings();
  assert.equal(initial.optInAccepted, false);
  assert.equal(initial.autoRedeemEnabled, false);
  assert.equal(initial.autoSignEnabled, false);

  // 旧バージョンからのアップデート時（optInAccepted: true のみ保存されている場合）
  await chrome.storage.local.set({
    app_settings: { optInAccepted: true, autoRedeemEnabled: true, activeGameKey: 'STAR_RAIL' }
  });
  const migrated = await getSettings();
  assert.equal(migrated.autoSignEnabled, true, 'オプトイン済み既存ユーザーはautoSignEnabledがtrueに補完される');

  // 個別OFFへの更新
  await updateSettings({ autoSignEnabled: false });
  const afterToggle = await getSettings();
  assert.equal(afterToggle.autoSignEnabled, false);
  assert.equal(afterToggle.autoRedeemEnabled, true, 'autoRedeemEnabledは独立して維持される');
});

test('getDailySignRecord / setDailySignRecord / isDailySignedToday / shouldRunDailySign', async () => {
  mockStorage.local.clear();
  const testNowMs = Date.parse('2026-10-17T03:00:00Z'); // 2026-10-17 in UTC+8

  assert.equal(await isDailySignedToday('hk4e_global', testNowMs), false);
  assert.equal(await shouldRunDailySign(['hk4e_global', 'hkrpg_global'], testNowMs), true);

  await setDailySignRecord('hk4e_global', {
    date: '2026-10-17',
    isSigned: true,
    totalSignDay: 12,
    skippedNoChar: false
  });

  const rec = await getDailySignRecord('hk4e_global');
  assert.equal(rec.totalSignDay, 12);
  assert.equal(await isDailySignedToday('hk4e_global', testNowMs), true);
  assert.equal(await shouldRunDailySign(['hk4e_global', 'hkrpg_global'], testNowMs), true, 'hkrpg_globalが未受取のためtrue');

  await setDailySignRecord('hkrpg_global', {
    date: '2026-10-17',
    isSigned: false,
    skippedNoChar: true
  });
  assert.equal(await shouldRunDailySign(['hk4e_global', 'hkrpg_global'], testNowMs), false, '全タイトルが本日受取済または未プレイ確定のためfalse');
});

test('getActiveCodes / setActiveCodes: 有効コード配列の保存と取得', async () => {
  mockStorage.local.clear();

  const initial = await getActiveCodes('hk4e_global');
  assert.equal(initial, null, '未保存時はnullを返す');

  const sampleCodes = ['GENSHINGIFT', 'GS6ACJ775KNV'];
  await setActiveCodes('hk4e_global', sampleCodes);
  const loaded = await getActiveCodes('hk4e_global');
  assert.deepEqual(loaded, sampleCodes, '保存した有効コード配列が取得できる');
});

test('getCodeRedeemStats: 月間・通算・有効コード消化率の正確な集計', async () => {
  mockStorage.local.clear();

  // 基準日時: 2026年10月17日 12:00:00 JST (= 03:00 UTC = 11:00 UTC+8)
  const nowMs = Date.parse('2026-10-17T03:00:00Z');
  // 当月1日: 2026-10-01 00:00:00 UTC+8 = 2026-09-30 16:00:00 UTC (1759248000 秒)
  const thisMonthSec = Math.floor(Date.parse('2026-10-05T00:00:00Z') / 1000);
  const lastMonthSec = Math.floor(Date.parse('2026-09-20T00:00:00Z') / 1000);

  // 1. 空ストレージ時
  const emptyStats = await getCodeRedeemStats('hk4e_global', nowMs);
  assert.equal(emptyStats.monthlyCount, 0);
  assert.equal(emptyStats.totalCount, 0);
  assert.equal(emptyStats.activeTotal, null);
  assert.equal(emptyStats.activeClaimed, null);

  // 2. 履歴データの投入
  await chrome.storage.local.set({
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

  const statsWithoutActive = await getCodeRedeemStats('hk4e_global', nowMs);
  assert.equal(statsWithoutActive.monthlyCount, 2, '今月分(SUCCESS + ALREADY_CLAIMED)は2件');
  assert.equal(statsWithoutActive.totalCount, 4, '通算(SUCCESS + ALREADY_CLAIMED)は4件 (EXPIRED/FAILED/PENDING除外)');
  assert.equal(statsWithoutActive.activeTotal, null, 'active_codes未保存時はnull');

  // 3. activeCodes を設定して消化率検証
  // 有効コード5件: CODE_THIS_MONTH_SUCCESS (済), CODE_THIS_MONTH_CLAIMED (済), CODE_UNCLAIMED (未), CODE_EXPIRED (期限切れ確定), CODE_FAILED (失敗確定)
  await setActiveCodes('hk4e_global', [
    'CODE_THIS_MONTH_SUCCESS',
    'CODE_THIS_MONTH_CLAIMED',
    'CODE_UNCLAIMED',
    'CODE_EXPIRED',
    'CODE_FAILED'
  ]);

  const statsWithActive = await getCodeRedeemStats('hk4e_global', nowMs);
  assert.equal(statsWithActive.activeTotal, 3, '有効コード総数はEXPIREDおよびFAILEDを除外した3件');
  assert.equal(statsWithActive.activeClaimed, 2, 'うち適用済みは2件');
});

test('getSettings / updateSettings: enabledGames のデフォルト値と既存設定からの後方互換フォールバック', async () => {
  mockStorage.local.clear();

  // 1. 未保存（初回）状態
  const initial = await getSettings();
  assert.deepEqual(initial.enabledGames, ['GENSHIN', 'STAR_RAIL', 'ZZZ'], '初回未保存時は全ゲームが有効');
  assert.equal(initial.activeGameKey, 'GENSHIN');

  // 2. 既存ユーザー（enabledGames キーが存在しない旧設定）
  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoRedeemEnabled: true,
      autoSignEnabled: true,
      activeGameKey: 'STAR_RAIL'
    }
  });

  const legacy = await getSettings();
  assert.deepEqual(legacy.enabledGames, ['GENSHIN', 'STAR_RAIL', 'ZZZ'], '既存ユーザーの設定から全ゲームが自動補完される');
  assert.equal(legacy.activeGameKey, 'STAR_RAIL', '既存のアクティブゲームが維持される');

  // 3. 不正値（空配列や未知のキー）の場合のフォールバック
  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      enabledGames: [],
      activeGameKey: 'GENSHIN'
    }
  });
  const emptyGamesSettings = await getSettings();
  assert.deepEqual(emptyGamesSettings.enabledGames, ['GENSHIN', 'STAR_RAIL', 'ZZZ'], '空配列時は全ゲームにフォールバック');

  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      enabledGames: ['UNKNOWN_GAME', 'ZZZ'],
      activeGameKey: 'UNKNOWN_GAME'
    }
  });
  const filteredSettings = await getSettings();
  assert.deepEqual(filteredSettings.enabledGames, ['ZZZ'], '未知のゲームキーは除外される');
  assert.equal(filteredSettings.activeGameKey, 'ZZZ', 'アクティブキーが無効な場合は有効ゲーム先頭に補正される');

  // 4. 正常な部分更新
  await updateSettings({ enabledGames: ['GENSHIN', 'ZZZ'], activeGameKey: 'ZZZ' });
  const updated = await getSettings();
  assert.deepEqual(updated.enabledGames, ['GENSHIN', 'ZZZ']);
  assert.equal(updated.activeGameKey, 'ZZZ');
});



test('getSettings / needsPolicyReview: agreedPolicyVersion の自動補完と改定検知', async () => {
  mockStorage.local.clear();

  // 1. 新規ユーザー初期状態
  const initial = await getSettings();
  assert.equal(initial.agreedPolicyVersion, null, '未保存時は null');
  assert.equal(needsPolicyReview(initial), false, '未オプトイン時はポリシー改定通知不要');

  // 2. 既存ユーザー（agreedPolicyVersion 未定義、optInAccepted: true）
  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoRedeemEnabled: true
    }
  });
  const legacy = await getSettings();
  assert.equal(legacy.agreedPolicyVersion, LEGACY_POLICY_VERSION, '既存ユーザーは LEGACY_POLICY_VERSION (2026-10-26) に自動補完される');
  assert.equal(needsPolicyReview(legacy), false, '現行バージョン (2026-10-26) と一致するため改定通知は不要');

  // 3. 将来ポリシー改定時（新バージョンが設定された場合）
  assert.equal(needsPolicyReview(legacy, '2027-01-01'), true, '最新版が新しい日付の場合は改定通知が必要');

  // 4. 古いバージョンが保存されている場合
  const oldSettings = { optInAccepted: true, agreedPolicyVersion: '2026-10-12' };
  assert.equal(needsPolicyReview(oldSettings, '2026-10-26'), true, '旧版同意ユーザーは改定通知が必要');

  // 5. 将来版が保存されている場合（ダウングレード時など）
  const futureSettings = { optInAccepted: true, agreedPolicyVersion: '2027-05-01' };
  assert.equal(needsPolicyReview(futureSettings, '2026-10-26'), false, '保存版が新しい場合は通知不要');
});

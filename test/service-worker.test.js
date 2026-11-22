import test from 'node:test';
import assert from 'node:assert/strict';

const mockStorage = {
  local: new Map(),
  session: new Map()
};

const mockCreatedTabs = [];
const mockClearedNotifications = [];
const mockCreatedNotifications = [];
const mockAlarms = new Map();
const mockAlarmListeners = [];
const mockIdleListeners = [];
const mockMessageListeners = [];
let mockUninstallUrl = null;
const mockInstalledListeners = [];
const mockStartupListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach(k => { res[k] = mockStorage.local.get(k); });
          return res;
        }
        return { [keys]: mockStorage.local.get(keys) };
      },
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.local.set(k, v)),
      getBytesInUse: async () => 1024
    },
    session: {
      get: async (key) => ({ [key]: mockStorage.session.get(key) }),
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.session.set(k, v)),
      remove: async (key) => mockStorage.session.delete(key)
    }
  },
  alarms: {
    get: async (name) => mockAlarms.get(name) || null,
    create: async (name, opts) => { mockAlarms.set(name, opts); },
    clear: async (name) => { mockAlarms.delete(name); },
    onAlarm: { addListener: (fn) => { mockAlarmListeners.push(fn); } }
  },
  idle: {
    onStateChanged: {
      addListener: (fn) => { mockIdleListeners.push(fn); }
    }
  },
  notifications: {
    create: (id, opts) => { mockCreatedNotifications.push({ id, opts }); },
    clear: (id) => { mockClearedNotifications.push(id); },
    onClicked: { addListener: () => {} }
  },
  tabs: {
    create: async (opts) => {
      mockCreatedTabs.push(opts);
      return { id: 1, ...opts };
    }
  },
  runtime: {
    id: 'test-ext-id',
    getURL: (p) => `chrome-extension://test-ext-id/${p}`,
    onInstalled: { addListener: (fn) => { mockInstalledListeners.push(fn); } },
    onStartup: { addListener: (fn) => { mockStartupListeners.push(fn); } },
    setUninstallURL: async (url) => { mockUninstallUrl = url; },
    onMessage: {
      addListener: (fn) => { mockMessageListeners.push(fn); }
    }
  }
};

import { acquireExecutionLock, releaseExecutionLock, markCodeStatus, getRedeemedCodes, setLastSuccessfulRun, setDailySignRecord, getDailySignRecord, getReviewPromptState, updateReviewPromptState, getBackoffState, getRetryState, getDailySignJitterMinutes } from '../src/services/storage-service.js';
import { STATUS_MAP, GAMES, ALARM_NAMES, API_CONFIG, UNINSTALL_URL } from '../src/config/constants.js';
const {
  setupUninstallUrl,
  handleNotificationClick,
  LOGIN_NOTIFICATION_PREFIX,
  SIGN_LOGIN_NOTIFICATION_PREFIX,
  SIGN_CAPTCHA_NOTIFICATION_PREFIX,
  redeemForGame,
  runAutoRedeemFlow,
  setupAlarm,
  setupDailySignAlarm,
  getNextDailySignTimestamp,
  scheduleRetryAlarm,
  clearRetryAlarm,
  maybeRunCatchUp,
  maybeRunAllCatchUp,
  signForGame,
  runDailySignFlow
} = await import('../src/background/service-worker.js');

test('排他ロック: 獲得と解放', async () => {
  const lock1 = await acquireExecutionLock('TEST');
  assert.equal(lock1, true);

  const lock2 = await acquireExecutionLock('TEST2');
  assert.equal(lock2, false, 'すでに実行中ならロック獲得失敗');

  await releaseExecutionLock();
  const lock3 = await acquireExecutionLock('TEST3');
  assert.equal(lock3, true, '解放後はロック獲得可能');
  await releaseExecutionLock();
});

test('コードステータス記録: 短縮キー保存とリトライ', async () => {
  await markCodeStatus('hk4e_global', 'TESTCODE1', 'SUCCESS');
  let codes = await getRedeemedCodes('hk4e_global');
  assert.equal(codes['TESTCODE1'].s, STATUS_MAP.SUCCESS);

  await markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  codes = await getRedeemedCodes('hk4e_global');
  assert.equal(codes['ERRCODE'].s, STATUS_MAP.PENDING_RETRY);
  assert.equal(codes['ERRCODE'].r, 1);

  await markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  await markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  codes = await getRedeemedCodes('hk4e_global');
  assert.equal(codes['ERRCODE'].s, STATUS_MAP.FAILED, '3回失敗でFAILED確定');
});

test('GAMES config: giftSiteUrlの定義確認', () => {
  assert.equal(GAMES.GENSHIN.giftSiteUrl, 'https://genshin.hoyoverse.com/ja/gift');
  assert.equal(GAMES.STAR_RAIL.giftSiteUrl, 'https://hsr.hoyoverse.com/gift');
  assert.equal(GAMES.ZZZ.giftSiteUrl, 'https://zenless.hoyoverse.com/redemption/gift');
});

test('handleNotificationClick: ログイン誘導通知クリック時に正しい交換サイトを開く', async () => {
  mockCreatedTabs.length = 0;
  mockClearedNotifications.length = 0;

  // 原神のログイン通知クリック
  const notifIdGenshin = `${LOGIN_NOTIFICATION_PREFIX}GENSHIN`;
  await handleNotificationClick(notifIdGenshin);
  assert.equal(mockCreatedTabs.length, 1);
  assert.equal(mockCreatedTabs[0].url, 'https://genshin.hoyoverse.com/ja/gift');
  assert.equal(mockClearedNotifications.includes(notifIdGenshin), true);

  // スタレのログイン通知クリック
  const notifIdHsr = `${LOGIN_NOTIFICATION_PREFIX}STAR_RAIL`;
  await handleNotificationClick(notifIdHsr);
  assert.equal(mockCreatedTabs.length, 2);
  assert.equal(mockCreatedTabs[1].url, 'https://hsr.hoyoverse.com/gift');
  assert.equal(mockClearedNotifications.includes(notifIdHsr), true);

  // ZZZのログイン通知クリック
  const notifIdZzz = `${LOGIN_NOTIFICATION_PREFIX}ZZZ`;
  await handleNotificationClick(notifIdZzz);
  assert.equal(mockCreatedTabs.length, 3);
  assert.equal(mockCreatedTabs[2].url, 'https://zenless.hoyoverse.com/redemption/gift');
  assert.equal(mockClearedNotifications.includes(notifIdZzz), true);

  // 関係のない通知IDの場合はタブを作成しない
  mockCreatedTabs.length = 0;
  await handleNotificationClick('other_notification_id');
  assert.equal(mockCreatedTabs.length, 0);
});

test('redeemForGame: 未プレイ（retcode: -1 / キャラクター不在）の場合はエラー通知を出さず安全にスキップ', async () => {
  mockCreatedNotifications.length = 0;

  // fetch をモックして空のキャラクター一覧を返却
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('getUserGameRolesByCookie')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const res = await redeemForGame('ZZZ');
    assert.equal(res.success, true, '成功ステータスで返ること');
    assert.equal(res.skipped, true, 'スキップフラグがtrueであること');
    assert.equal(res.reason, 'NO_CHARACTER');
    assert.equal(res.gameKey, 'ZZZ');
    assert.equal(mockCreatedNotifications.length, 0, '未プレイゲームに対してログイン要求などの通知を出さないこと');

    // ログ記録の確認
    const logs = mockStorage.local.get('exec_logs') || [];
    const skipLog = logs.find(l => l.message && l.message.includes('キャラクターが見つからないためスキップ'));
    assert.ok(skipLog, 'INFOログにスキップログが記録されていること');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runAutoRedeemFlow: 全3ゲーム巡回（未プレイゲームはスキップ、プレイ中ゲームは引き換え成功）', async () => {
  mockCreatedNotifications.length = 0;
  mockStorage.local.clear();
  mockStorage.session.clear();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = url.toString();
    // ロール取得API
    if (urlStr.includes('getUserGameRolesByCookie')) {
      if (urlStr.includes('hk4e_global')) {
        // 原神: キャラクターあり
        return {
          ok: true,
          status: 200,
          json: async () => ({
            retcode: 0,
            message: 'OK',
            data: {
              list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: 'Traveler', level: 60 }]
            }
          })
        };
      }
      // スタレ、ZZZ: 未プレイ (キャラクター不在)
      return {
        ok: true,
        status: 200,
        json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } })
      };
    }

    // コード取得API
    if (urlStr.includes('hoyo-codes.seria.moe')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          codes: [{ code: 'GENSHINNEW1' }]
        })
      };
    }

    // コード引き換えAPI
    if (urlStr.includes('webExchangeCdkey')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ retcode: 0, message: 'OK' })
      };
    }

    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const flowRes = await runAutoRedeemFlow('ALARM');
    assert.equal(flowRes.success, true);
    assert.equal(flowRes.redeemedCount, 1, '原神で1件成功');
    assert.ok(flowRes.results.GENSHIN, '原神の結果が存在');
    assert.equal(flowRes.results.GENSHIN.skipped, false);
    assert.equal(flowRes.results.GENSHIN.redeemedCount, 1);

    assert.ok(flowRes.results.STAR_RAIL, 'スタレの結果が存在');
    assert.equal(flowRes.results.STAR_RAIL.skipped, true);
    assert.equal(flowRes.results.STAR_RAIL.reason, 'NO_CHARACTER');

    assert.ok(flowRes.results.ZZZ, 'ZZZの結果が存在');
    assert.equal(flowRes.results.ZZZ.skipped, true);
    assert.equal(flowRes.results.ZZZ.reason, 'NO_CHARACTER');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runAutoRedeemFlow: 手動実行（単一ゲーム指定）時は選択ゲームのみ実行され他ゲームは処理されない', async () => {
  mockCreatedNotifications.length = 0;
  mockStorage.local.clear();
  mockStorage.session.clear();

  const fetchedGames = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes('getUserGameRolesByCookie')) {
      if (urlStr.includes('hk4e_global')) {
        fetchedGames.push('GENSHIN');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            retcode: 0,
            message: 'OK',
            data: { list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: 'Traveler', level: 60 }] }
          })
        };
      }
      if (urlStr.includes('hkrpg_global')) fetchedGames.push('STAR_RAIL');
      if (urlStr.includes('nap_global')) fetchedGames.push('ZZZ');
      return { ok: true, status: 200, json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } }) };
    }

    if (urlStr.includes('hoyo-codes.seria.moe')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ codes: [{ code: 'GENSHINNEW2' }] })
      };
    }

    if (urlStr.includes('webExchangeCdkey')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ retcode: 0, message: 'OK' }) };
    }

    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const res = await runAutoRedeemFlow('MANUAL', 'GENSHIN');
    assert.equal(res.success, true);
    assert.equal(res.targetGameKey, 'GENSHIN');
    assert.equal(res.redeemedCount, 1);
    assert.ok(res.results.GENSHIN);
    assert.equal(res.results.STAR_RAIL, undefined, 'STAR_RAILは処理されない');
    assert.equal(res.results.ZZZ, undefined, 'ZZZは処理されない');
    assert.deepEqual(fetchedGames, ['GENSHIN'], '原神以外のAPIは呼ばれない');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runAutoRedeemFlow: 未知のゲームキー指定時は安全にエラーが返る', async () => {
  const res = await runAutoRedeemFlow('MANUAL', 'UNKNOWN_GAME');
  assert.equal(res.success, false);
  assert.match(res.reason, /未知のゲームキー/);
});

test('setupAlarm: 定期アラームが正しく登録される', async () => {
  mockAlarms.clear();
  await setupAlarm();
  const alarm = mockAlarms.get(ALARM_NAMES.AUTO_REDEEM);
  assert.ok(alarm, '定期アラームが作成されている');
  assert.equal(alarm.periodInMinutes, API_CONFIG.REDEEM_INTERVAL_MINUTES, '設定された周期であること');
});

test('scheduleRetryAlarm / clearRetryAlarm: 短期リトライアラームの登録と解除', async () => {
  mockAlarms.clear();
  await scheduleRetryAlarm(2);
  const retryAlarm = mockAlarms.get(ALARM_NAMES.RETRY);
  assert.ok(retryAlarm, 'リトライアラームが作成されている');
  assert.equal(retryAlarm.delayInMinutes, 2, '2分後遅延であること');

  await clearRetryAlarm();
  assert.equal(mockAlarms.get(ALARM_NAMES.RETRY), undefined, 'リトライアラームが解除されている');
});

test('maybeRunCatchUp: 設定無効時や3時間未経過時はスキップ、3時間経過時は実行される', async () => {
  mockStorage.local.clear();

  // 1. オプトイン未承諾の場合はスキップ
  let res = await maybeRunCatchUp('TEST');
  assert.equal(res, false, 'オプトイン未承諾時はfalse');

  // 2. 有効化するが直近実行済み（3時間未経過）の場合はスキップ
  await chrome.storage.local.set({
    app_settings: { optInAccepted: true, autoRedeemEnabled: true }
  });
  await setLastSuccessfulRun(Date.now()); // 今実行したばかり
  res = await maybeRunCatchUp('TEST');
  assert.equal(res, false, '3時間未経過時はfalse');

  // 3. 3時間以上経過している場合（テスト高速化のため遅延を0msに一時上書き）
  const originalDelay = API_CONFIG.CATCH_UP_DELAY_MS;
  API_CONFIG.CATCH_UP_DELAY_MS = 0;
  await setLastSuccessfulRun(Date.now() - (4 * 60 * 60 * 1000)); // 4時間前

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } }),
    text: async () => JSON.stringify({ retcode: 0, message: 'OK', data: { list: [] } })
  });

  try {
    res = await maybeRunCatchUp('TEST');
    assert.equal(res.success, true, 'キャッチアップ実行が成功すること');
  } finally {
    API_CONFIG.CATCH_UP_DELAY_MS = originalDelay;
    globalThis.fetch = originalFetch;
  }
});

test('runAutoRedeemFlow: 通信エラー発生時に自動でリトライアラームがスケジュールされ例外ERRORログは抑制される', async () => {
  mockAlarms.clear();
  mockStorage.local.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    const res = await runAutoRedeemFlow('ALARM');
    assert.equal(res.success, false);
    assert.equal(res.reason, 'NETWORK_RETRY_SCHEDULED');
    const retryAlarm = mockAlarms.get(ALARM_NAMES.RETRY);
    assert.ok(retryAlarm, '通信例外時にリトライアラームが登録されていること');
    assert.ok(retryAlarm.delayInMinutes >= 2 && retryAlarm.delayInMinutes <= 2.5, '1回目リトライは2分+揺らぎであること');

    const logs = (await chrome.storage.local.get('exec_logs')).exec_logs || [];
    assert.ok(logs.some(l => l.message.includes('一時的な通信不通を検知')), 'リトライ予告ログが存在すること');
    assert.equal(logs.some(l => l.message.includes('例外発生')), false, '例外発生のERRORログは抑制されていること');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getNextDailySignTimestamp & setupDailySignAlarm: デイリーサインイン専用アラームが正しくスケジュールされる', async () => {
  mockAlarms.clear();
  // 2026-10-17 00:00:00 UTC+8 (2026-10-16 16:00:00 UTC) の時点で次回 00:05 UTC+8 は5分後
  const baseMs = Date.parse('2026-10-16T16:00:00Z');
  const nextWhen = getNextDailySignTimestamp(baseMs);
  assert.equal(nextWhen, Date.parse('2026-10-16T16:05:00Z'), '5分後の00:05 UTC+8 (01:05 JST) が算出される');

  // 2026-10-17 00:10:00 UTC+8 の時点では翌日の 00:05 UTC+8 が算出される
  const afterMs = Date.parse('2026-10-16T16:10:00Z');
  const nextDayWhen = getNextDailySignTimestamp(afterMs);
  assert.equal(nextDayWhen, Date.parse('2026-10-17T16:05:00Z'), '翌日の00:05 UTC+8が算出される');

  await setupDailySignAlarm();
  const signAlarm = mockAlarms.get(ALARM_NAMES.DAILY_SIGN);
  assert.ok(signAlarm, 'DAILY_SIGNアラームが登録されていること');
  assert.equal(signAlarm.periodInMinutes, 1440, '24時間(1440分)周期であること');
});

test('handleNotificationClick: ログボ通知クリック時に公式ログインボーナスページを開く', async () => {
  mockCreatedTabs.length = 0;
  mockClearedNotifications.length = 0;

  await handleNotificationClick(`${SIGN_LOGIN_NOTIFICATION_PREFIX}STAR_RAIL`);
  assert.equal(mockCreatedTabs.length, 1);
  assert.equal(mockCreatedTabs[0].url, GAMES.STAR_RAIL.checkInSiteUrl);

  await handleNotificationClick(`${SIGN_CAPTCHA_NOTIFICATION_PREFIX}ZZZ`);
  assert.equal(mockCreatedTabs.length, 2);
  assert.equal(mockCreatedTabs[1].url, GAMES.ZZZ.checkInSiteUrl);
});

test('runDailySignFlow: 全3ゲーム巡回（未プレイはスキップ、未受取ゲームは受取成功して記録保存）', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    // 1. ロール照会: 原神のみプレイ中、他はキャラ不在
    if (u.includes('getUserGameRolesByCookie')) {
      if (u.includes('hk4e_global')) {
        return {
          status: 200,
          json: async () => ({
            retcode: 0,
            message: 'OK',
            data: { list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60 }] }
          })
        };
      }
      return {
        status: 200,
        json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } })
      };
    }

    // 2. info API: 原神は未受取 (total_sign_day: 10)
    if (u.includes('/event/sol/info')) {
      return {
        status: 200,
        text: async () => JSON.stringify({
          retcode: 0,
          message: 'OK',
          data: { is_sign: false, total_sign_day: 10, today: '2026-10-17' }
        })
      };
    }

    // 3. sign API: 原神のサインイン成功
    if (u.includes('/event/sol/sign') && opts?.method === 'POST') {
      return {
        status: 200,
        text: async () => JSON.stringify({
          retcode: 0,
          message: 'OK',
          data: { code: 'ok', is_risk: false }
        })
      };
    }

    return { status: 200, text: async () => JSON.stringify({ retcode: 0 }) };
  };

  try {
    const res = await runDailySignFlow('DAILY_ALARM');
    assert.equal(res.success, true);
    assert.equal(res.signedCount, 1);
    assert.equal(res.results.GENSHIN.signed, true);
    assert.equal(res.results.GENSHIN.totalSignDay, 11);
    assert.equal(res.results.STAR_RAIL.skipped, true);
    assert.equal(res.results.ZZZ.skipped, true);

    const saved = await getDailySignRecord('hk4e_global');
    assert.equal(saved.isSigned, true);
    assert.equal(saved.totalSignDay, 11);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maybeRunAllCatchUp: 起動・復帰時にログインボーナスとコード交換がロック競合せず直列実行されること', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true
    }
  });

  const originalDelay = API_CONFIG.CATCH_UP_DELAY_MS;
  API_CONFIG.CATCH_UP_DELAY_MS = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } }),
    text: async () => JSON.stringify({ retcode: 0, message: 'OK', data: { list: [] } })
  });

  try {
    const { signResult, redeemResult } = await maybeRunAllCatchUp('STARTUP');
    assert.equal(signResult.success, true, 'ログインボーナスキャッチアップが成功すること');
    assert.equal(redeemResult.success, true, 'コード引き換えキャッチアップもALREADY_RUNNINGにならず成功すること');
  } finally {
    API_CONFIG.CATCH_UP_DELAY_MS = originalDelay;
    globalThis.fetch = originalFetch;
  }
});

test('runAutoRedeemFlow & runDailySignFlow: enabledGames で指定したタイトルのみ巡回されること', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  // STAR_RAIL のみ有効化
  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true,
      enabledGames: ['STAR_RAIL'],
      activeGameKey: 'STAR_RAIL'
    }
  });

  const calledGames = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('getUserGameRolesByCookie')) {
      if (u.includes('hkrpg_global')) calledGames.push('STAR_RAIL');
      if (u.includes('hk4e_global')) calledGames.push('GENSHIN');
      if (u.includes('nap_global')) calledGames.push('ZZZ');
      return {
        status: 200,
        json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } })
      };
    }
    return { status: 200, json: async () => ({}), text: async () => JSON.stringify({ retcode: 0, data: {} }) };
  };

  try {
    // 1. コード自動引き換え
    const redeemRes = await runAutoRedeemFlow('ALARM');
    assert.equal(redeemRes.success, true);
    assert.deepEqual(Object.keys(redeemRes.results), ['STAR_RAIL'], '巡回結果キーにSTAR_RAILのみが含まれること');
    assert.ok(calledGames.includes('STAR_RAIL'));
    assert.ok(!calledGames.includes('GENSHIN'), 'GENSHINのAPIは呼ばれないこと');
    assert.ok(!calledGames.includes('ZZZ'), 'ZZZのAPIは呼ばれないこと');

    // 2. ログボ自動受取
    calledGames.length = 0;
    const signRes = await runDailySignFlow('DAILY_ALARM');
    assert.equal(signRes.success, true);
    assert.deepEqual(Object.keys(signRes.results), ['STAR_RAIL'], 'ログボ巡回結果キーにSTAR_RAILのみが含まれること');
    assert.ok(calledGames.includes('STAR_RAIL'));
    assert.ok(!calledGames.includes('GENSHIN'));
    assert.ok(!calledGames.includes('ZZZ'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maybeRunAllCatchUp: skipDelay=true 指定時に待機ディレイをスキップして即座にログボ・コード引き換えを実行すること', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true
    }
  });

  const originalDelay = API_CONFIG.CATCH_UP_DELAY_MS;
  // テスト検知用に大きなディレイを設定（スキップされない場合はタイムアウトまたは遅延する）
  API_CONFIG.CATCH_UP_DELAY_MS = 10_000;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } }),
    text: async () => JSON.stringify({ retcode: 0, message: 'OK', data: { list: [] } })
  });

  const startTime = Date.now();
  try {
    const { signResult, redeemResult } = await maybeRunAllCatchUp('INITIAL_RUN', true);
    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 2000, `ディレイがスキップされ高速に完了すること (実績: ${elapsed}ms)`);
    assert.equal(signResult.success, true);
    assert.equal(redeemResult.success, true);
  } finally {
    API_CONFIG.CATCH_UP_DELAY_MS = originalDelay;
    globalThis.fetch = originalFetch;
  }
});

test('onMessage: TRIGGER_INITIAL_CATCH_UP 受信時に maybeRunAllCatchUp が実行され結果を返すこと', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true
    }
  });

  const originalDelay = API_CONFIG.CATCH_UP_DELAY_MS;
  API_CONFIG.CATCH_UP_DELAY_MS = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } }),
    text: async () => JSON.stringify({ retcode: 0, message: 'OK', data: { list: [] } })
  });

  try {
    let handled = false;
    const responsePromise = new Promise((resolve) => {
      for (const listener of mockMessageListeners) {
        const res = listener({ type: 'TRIGGER_INITIAL_CATCH_UP' }, { id: chrome.runtime.id }, (data) => {
          resolve(data);
        });
        if (res === true) {
          handled = true;
          break;
        }
      }
    });

    assert.ok(handled, 'TRIGGER_INITIAL_CATCH_UP メッセージが処理されること');

    const responseData = await responsePromise;
    assert.ok(responseData, 'レスポンスが返却されること');
    assert.equal(responseData.signResult.success, true);
    assert.equal(responseData.redeemResult.success, true);
  } finally {
    API_CONFIG.CATCH_UP_DELAY_MS = originalDelay;
    globalThis.fetch = originalFetch;
  }
});




test('setupUninstallUrl: 正しいアンインストールURLが設定されること', async () => {
  mockUninstallUrl = null;
  await setupUninstallUrl();
  assert.equal(mockUninstallUrl, UNINSTALL_URL);
  assert.equal(mockUninstallUrl, 'https://forms.gle/xWmVdhKJhpcuvmhP9');
});

test('setupUninstallUrl: API例外発生時に例外を外部へスローせず安全に処理されること', async () => {
  const originalSetUninstallURL = chrome.runtime.setUninstallURL;
  chrome.runtime.setUninstallURL = async () => {
    throw new Error('API failure simulation');
  };

  try {
    // 例外がスローされず正常終了することを確認
    await assert.doesNotReject(async () => {
      await setupUninstallUrl();
    });
  } finally {
    chrome.runtime.setUninstallURL = originalSetUninstallURL;
  }
});

test('onInstalled / onStartup: 既存・新規ユーザーに対して ga_client_id が確実に初期化・維持されること', async () => {
  // 1. 未生成状態で onInstalled (アップデート/インストール) が呼ばれた場合、UUIDが生成・保存されること
  mockStorage.local.delete('ga_client_id');
  assert.equal(mockStorage.local.get('ga_client_id'), undefined);
  assert.ok(mockInstalledListeners.length > 0);
  await mockInstalledListeners[0]();
  const generatedId = mockStorage.local.get('ga_client_id');
  assert.ok(generatedId, 'onInstalled 実行時に ga_client_id が生成されること');
  assert.match(generatedId, /^[0-9a-f-]{36}$/i);

  // 2. 既存ユーザーが既に ga_client_id を持っている状態で onInstalled が呼ばれても同一IDが維持されること
  mockStorage.local.set('ga_client_id', 'existing-legacy-client-id');
  await mockInstalledListeners[0]();
  assert.equal(mockStorage.local.get('ga_client_id'), 'existing-legacy-client-id', '既存の ga_client_id が上書きされず維持されること');
});


test('runAutoRedeemFlow / runDailySignFlow: レビュー促進成功カウントの適切な加算制御', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  // 初期 reviewPrompt をセット
  await updateReviewPromptState({ successCount: 0, status: 'pending' });

  // 1. runAutoRedeemFlow: 新規成功(retcode: 0)がある場合は1セッションで+1加算
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes('getUserGameRolesByCookie')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          retcode: 0,
          message: 'OK',
          data: {
            list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: 'Traveler', level: 60 }]
          }
        })
      };
    }
    if (urlStr.includes('hoyo-codes.seria.moe')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({
          codes: [{ code: 'CODE1' }, { code: 'CODE2' }]
        })
      };
    }
    if (urlStr.includes('webExchangeCdkey')) {
      fetchCount++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ retcode: 0, message: 'OK' })
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  try {
    const res = await runAutoRedeemFlow('MANUAL', 'GENSHIN');
    assert.equal(res.success, true);
    assert.equal(res.redeemedCount, 2, '2件成功');
    let state = await getReviewPromptState();
    assert.equal(state.successCount, 1, '複数件成功してもセッション単位で+1加算されること');

    // 2. runAutoRedeemFlow: 引き換え済み(-2017)や期限切れ(-2001)のみで新規成功0件の時は加算されないこと
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('getUserGameRolesByCookie')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            retcode: 0,
            message: 'OK',
            data: {
              list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: 'Traveler', level: 60 }]
            }
          })
        };
      }
      if (urlStr.includes('hoyo-codes.seria.moe')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({
            codes: [{ code: 'ALREADY_CLAIMED_CODE' }]
          })
        };
      }
      if (urlStr.includes('webExchangeCdkey')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ retcode: -2017, message: 'Already claimed' })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    mockStorage.session.clear();
    const resAlready = await runAutoRedeemFlow('MANUAL', 'GENSHIN');
    assert.equal(resAlready.success, true);
    assert.equal(resAlready.redeemedCount, 0);
    state = await getReviewPromptState();
    assert.equal(state.successCount, 1, '引き換え済みのみの場合はカウントが増えないこと');

    // 3. runDailySignFlow: 新規受取成功で+1加算
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('getUserGameRolesByCookie')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            retcode: 0,
            message: 'OK',
            data: {
              list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: 'Traveler', level: 60 }]
            }
          })
        };
      }
      if (urlStr.includes('/event/sol/info')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            retcode: 0,
            message: 'OK',
            data: { is_sign: false, total_sign_day: 5, today: '2026-11-01' }
          })
        };
      }
      if (urlStr.includes('/event/sol/sign')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            retcode: 0,
            message: 'OK',
            data: { code: 'ok' }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const resSign = await runDailySignFlow('MANUAL', 'GENSHIN');
    assert.equal(resSign.success, true);
    assert.equal(resSign.signedCount, 1);
    state = await getReviewPromptState();
    assert.equal(state.successCount, 2, '新規ログボ受取成功で+1加算されること');

    // 4. runDailySignFlow: すでに受取済みの場合は加算されないこと
    globalThis.fetch = async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes('getUserGameRolesByCookie')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            retcode: 0,
            message: 'OK',
            data: {
              list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: 'Traveler', level: 60 }]
            }
          })
        };
      }
      if (urlStr.includes('/event/sol/info')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            retcode: 0,
            message: 'OK',
            data: { is_sign: true, total_sign_day: 6, today: '2026-11-01' }
          })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    // キャッシュをクリアしてforceCheck
    mockStorage.session.clear();
    const resSignAlready = await runDailySignFlow('MANUAL', 'GENSHIN');
    assert.equal(resSignAlready.success, true);
    assert.equal(resSignAlready.signedCount, 0);
    state = await getReviewPromptState();
    assert.equal(state.successCount, 2, '受取済みスキップ時はカウントが増えないこと');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('setupDailySignAlarm: 既存ユーザー（01:05固定アラーム登録済み）への初回オフセット移行と2回目以降の維持', async () => {
  mockStorage.local.clear();
  mockAlarms.clear();

  // 既存ユーザーの旧アラーム（01:05固定、オフセット未保存）を再現
  const legacyWhen = getNextDailySignTimestamp(Date.now(), 0);
  mockAlarms.set(ALARM_NAMES.DAILY_SIGN, { when: legacyWhen, periodInMinutes: 1440 });

  await setupDailySignAlarm();

  const savedJitter = await getDailySignJitterMinutes();
  assert.ok(savedJitter !== null && savedJitter >= 0 && savedJitter <= API_CONFIG.DAILY_SIGN_JITTER_MAX_MINUTES);
  const migratedAlarm = mockAlarms.get(ALARM_NAMES.DAILY_SIGN);
  assert.equal(migratedAlarm.periodInMinutes, 1440);
  const expectedDiffMs = savedJitter * 60 * 1000;
  const actualDiffMs = (migratedAlarm.when - legacyWhen + 24 * 60 * 60_000) % (24 * 60 * 60_000);
  assert.ok(Math.abs(actualDiffMs - expectedDiffMs) < 5_000, '移行後アラーム時刻がオフセット分ずれていること');

  // 2回目以降は既存アラームが上書きされないこと
  const sentinelWhen = 1234567890;
  mockAlarms.set(ALARM_NAMES.DAILY_SIGN, { when: sentinelWhen, periodInMinutes: 1440 });
  await setupDailySignAlarm();
  assert.equal(mockAlarms.get(ALARM_NAMES.DAILY_SIGN).when, sentinelWhen);
  assert.equal(await getDailySignJitterMinutes(), savedJitter);
});

test('runAutoRedeemFlow: ネットワークエラー短期リトライは最大3回 (2→10→30分) で打ち止め、通常アラームでリセット', async () => {
  mockAlarms.clear();
  mockStorage.local.clear();
  mockStorage.session.clear();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    // 1回目: 2分台
    const r1 = await runAutoRedeemFlow('ALARM');
    assert.equal(r1.reason, 'NETWORK_RETRY_SCHEDULED');
    const d1 = mockAlarms.get(ALARM_NAMES.RETRY).delayInMinutes;
    assert.ok(d1 >= 2 && d1 <= 2.5, `1回目は2〜2.5分: ${d1}`);

    // 2回目: 10分台
    mockAlarms.delete(ALARM_NAMES.RETRY);
    const r2 = await runAutoRedeemFlow('RETRY_ALARM');
    assert.equal(r2.reason, 'NETWORK_RETRY_SCHEDULED');
    const d2 = mockAlarms.get(ALARM_NAMES.RETRY).delayInMinutes;
    assert.ok(d2 >= 10 && d2 <= 10.5, `2回目は10〜10.5分: ${d2}`);

    // 3回目: 30分台
    mockAlarms.delete(ALARM_NAMES.RETRY);
    const r3 = await runAutoRedeemFlow('RETRY_ALARM');
    assert.equal(r3.reason, 'NETWORK_RETRY_SCHEDULED');
    const d3 = mockAlarms.get(ALARM_NAMES.RETRY).delayInMinutes;
    assert.ok(d3 >= 30 && d3 <= 30.5, `3回目は30〜30.5分: ${d3}`);

    // 4回目: 上限到達（アラーム未登録・打ち止めログ1回）
    mockAlarms.delete(ALARM_NAMES.RETRY);
    const r4 = await runAutoRedeemFlow('RETRY_ALARM');
    assert.equal(r4.reason, 'NETWORK_RETRY_EXHAUSTED');
    assert.equal(mockAlarms.get(ALARM_NAMES.RETRY), undefined, '4回目はリトライ予約されないこと');

    // 5回目: 打ち止めログが増えないこと
    const r5 = await runAutoRedeemFlow('RETRY_ALARM');
    assert.equal(r5.reason, 'NETWORK_RETRY_EXHAUSTED');
    const logs = mockStorage.local.get('exec_logs') || [];
    const exhaustedLogs = logs.filter(l => l.message && l.message.includes('再試行上限'));
    assert.equal(exhaustedLogs.length, 1, '打ち止めログは1回だけ出力されること');

    // 通常定期アラーム発火でリトライ回数がリセットされること
    await chrome.storage.local.set({ app_settings: { optInAccepted: true, autoRedeemEnabled: true } });
    mockAlarms.delete(ALARM_NAMES.RETRY);
    await mockAlarmListeners[0]({ name: ALARM_NAMES.AUTO_REDEEM });
    const dReset = mockAlarms.get(ALARM_NAMES.RETRY).delayInMinutes;
    assert.ok(dReset >= 2 && dReset <= 2.5, '通常アラーム後は再び1回目(2分台)から開始されること');
    assert.equal((await getRetryState('REDEEM')).count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CAPTCHA当日ブロック: isRisk後はIDLE_ACTIVEで再実行・再通知されないが手動実行は許可される', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();
  mockCreatedNotifications.length = 0;

  const origCatchUpDelay = API_CONFIG.CATCH_UP_DELAY_MS;
  const origSignDelay = API_CONFIG.SIGN_GAME_DELAY_MS;
  API_CONFIG.CATCH_UP_DELAY_MS = 0;
  API_CONFIG.SIGN_GAME_DELAY_MS = 0;

  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: false,
      enabledGames: ['GENSHIN']
    }
  });

  let signApiCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('getUserGameRolesByCookie')) {
      return {
        status: 200,
        json: async () => ({
          retcode: 0,
          message: 'OK',
          data: { list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60 }] }
        })
      };
    }
    if (u.includes('/event/sol/info')) {
      return {
        status: 200,
        text: async () => JSON.stringify({
          retcode: 0,
          message: 'OK',
          data: { is_sign: false, total_sign_day: 3 }
        })
      };
    }
    if (u.includes('/event/sol/sign')) {
      signApiCalls++;
      return {
        status: 200,
        text: async () => JSON.stringify({
          retcode: 0,
          message: 'OK',
          data: { is_risk: true }
        })
      };
    }
    return { status: 200, json: async () => ({ retcode: 0 }), text: async () => JSON.stringify({ retcode: 0 }) };
  };

  try {
    // 1. 定期実行でCAPTCHA検知
    const firstRun = await runDailySignFlow('DAILY_ALARM');
    assert.equal(firstRun.results.GENSHIN.isRisk, true);
    assert.equal(signApiCalls, 1);
    assert.equal(mockCreatedNotifications.length, 1);
    assert.equal((await getDailySignRecord('hk4e_global')).captchaBlocked, true);

    // 2. IDLE_ACTIVE 復帰でも再実行・通知連発しないこと
    const catchUpRes = await maybeRunAllCatchUp('IDLE_ACTIVE');
    assert.equal(catchUpRes.signResult, false);
    assert.equal(signApiCalls, 1, '当日は自動サインインAPIを再度叩かないこと');
    assert.equal(mockCreatedNotifications.length, 1, 'CAPTCHA通知が重複しないこと');

    // 3. ユーザーが手動で実行した場合は許可されること
    const manualRes = await runDailySignFlow('MANUAL', 'GENSHIN');
    assert.equal(manualRes.results.GENSHIN.isRisk, true);
    assert.equal(signApiCalls, 2, '手動実行時は実行が許可されること');
  } finally {
    API_CONFIG.CATCH_UP_DELAY_MS = origCatchUpDelay;
    API_CONFIG.SIGN_GAME_DELAY_MS = origSignDelay;
    globalThis.fetch = originalFetch;
  }
});

test('未ログイン時の自動3時間クールダウンとコード失敗回数(r)非消費', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();
  mockCreatedNotifications.length = 0;

  const origCatchUpDelay = API_CONFIG.CATCH_UP_DELAY_MS;
  const origInterDelay = API_CONFIG.INTER_REQUEST_DELAY_MS;
  API_CONFIG.CATCH_UP_DELAY_MS = 0;
  API_CONFIG.INTER_REQUEST_DELAY_MS = 0;

  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true,
      enabledGames: ['GENSHIN']
    }
  });

  let roleCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('getUserGameRolesByCookie')) {
      roleCalls++;
      return {
        status: 200,
        json: async () => ({ retcode: -100, message: 'Not logged in', data: null })
      };
    }
    return { status: 200, json: async () => ({ retcode: -100 }), text: async () => JSON.stringify({ retcode: -100 }) };
  };

  try {
    // 1. 起動時キャッチアップで未ログイン失敗
    await maybeRunAllCatchUp('STARTUP');
    const callsAfterStartup = roleCalls;
    assert.ok(callsAfterStartup > 0);

    // 2. 直後の IDLE_ACTIVE では両系統とも3時間クールダウンにより再実行されないこと
    const idleRes = await maybeRunAllCatchUp('IDLE_ACTIVE');
    assert.equal(idleRes.signResult, false);
    assert.equal(idleRes.redeemResult, false);
    assert.equal(roleCalls, callsAfterStartup, 'クールダウン中はAPIを叩かないこと');

    // 3. ロール取得成功後にコード交換APIが -100 を返してもコードの失敗回数 r が増えないこと
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('getUserGameRolesByCookie')) {
        return {
          status: 200,
          json: async () => ({
            retcode: 0,
            message: 'OK',
            data: { list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60 }] }
          })
        };
      }
      if (u.includes('hoyo-codes.seria.moe')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ codes: [{ code: 'VALIDCODE123' }] })
        };
      }
      if (u.includes('webExchangeCdkey')) {
        return {
          status: 200,
          text: async () => JSON.stringify({ retcode: -100, message: 'Not logged in' })
        };
      }
      return { status: 200, json: async () => ({}), text: async () => '{}' };
    };

    await redeemForGame('GENSHIN', 'ja', 'MANUAL');
    const redeemed = await getRedeemedCodes('hk4e_global');
    assert.equal(redeemed.VALIDCODE123, undefined, '未ログイン(-100)時にコードの失敗回数が消費されないこと');
  } finally {
    API_CONFIG.CATCH_UP_DELAY_MS = origCatchUpDelay;
    API_CONFIG.INTER_REQUEST_DELAY_MS = origInterDelay;
    globalThis.fetch = originalFetch;
  }
});

test('HTTP 429 検知時: sign を追い打ちせず指数バックオフ (30→60分) に遷移し、正常完了でリセット', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  const origSignDelay = API_CONFIG.SIGN_GAME_DELAY_MS;
  API_CONFIG.SIGN_GAME_DELAY_MS = 0;

  await chrome.storage.local.set({
    app_settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      enabledGames: ['GENSHIN']
    }
  });

  let signPostCalls = 0;
  let return429 = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('getUserGameRolesByCookie')) {
      return {
        status: 200,
        json: async () => ({
          retcode: 0,
          message: 'OK',
          data: { list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60 }] }
        })
      };
    }
    if (u.includes('/event/sol/info')) {
      if (return429) {
        return { status: 429 };
      }
      return {
        status: 200,
        text: async () => JSON.stringify({ retcode: 0, message: 'OK', data: { is_sign: true, total_sign_day: 5 } })
      };
    }
    if (u.includes('/event/sol/sign')) {
      signPostCalls++;
      return { status: 200, text: async () => JSON.stringify({ retcode: 0 }) };
    }
    return { status: 200, json: async () => ({}), text: async () => '{}' };
  };

  try {
    // 1回目 429 -> level 1 (30分)、sign POSTは呼ばれない
    const res1 = await runDailySignFlow('MANUAL', 'GENSHIN');
    assert.equal(res1.success, false);
    assert.equal(res1.reason, 'UNDER_BACKOFF');
    assert.equal(res1.remainingMinutes, 30);
    assert.equal(signPostCalls, 0, 'infoで429を受けた場合はsignを追い打ちしないこと');
    assert.equal((await getBackoffState()).level, 1);

    // バックオフ解除後に再び 429 -> level 2 (60分)
    mockStorage.local.set('backoff_until', Date.now() - 1000);
    mockStorage.session.clear();
    const res2 = await runDailySignFlow('MANUAL', 'GENSHIN');
    assert.equal(res2.reason, 'UNDER_BACKOFF');
    assert.equal(res2.remainingMinutes, 60);
    assert.equal((await getBackoffState()).level, 2);

    // バックオフ解除後に正常完了 -> level 0 にリセット
    mockStorage.local.set('backoff_until', Date.now() - 1000);
    mockStorage.session.clear();
    return429 = false;
    const res3 = await runDailySignFlow('MANUAL', 'GENSHIN');
    assert.equal(res3.success, true);
    assert.equal((await getBackoffState()).level, 0);
  } finally {
    API_CONFIG.SIGN_GAME_DELAY_MS = origSignDelay;
    globalThis.fetch = originalFetch;
  }
});

test('手動クールダウン: 60秒以内の同ゲーム同種別連打は拒否、別ゲーム・別種別は即実行可能', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchCount++;
    const u = String(url);
    if (u.includes('getUserGameRolesByCookie')) {
      return { status: 200, json: async () => ({ retcode: 0, message: 'OK', data: { list: [] } }) };
    }
    return { status: 200, json: async () => ({}), text: async () => '{}' };
  };

  try {
    // 1. 原神 コード交換 (1回目): 成功
    const r1 = await runAutoRedeemFlow('MANUAL', 'GENSHIN');
    assert.equal(r1.success, true);
    const countAfterFirst = fetchCount;

    // 2. 原神 コード交換 (2回目): クールダウン拒否、API呼出0回
    const r2 = await runAutoRedeemFlow('MANUAL', 'GENSHIN');
    assert.equal(r2.success, false);
    assert.equal(r2.reason, 'MANUAL_COOLDOWN');
    assert.ok(r2.remainingSec > 0 && r2.remainingSec <= 60);
    assert.equal(fetchCount, countAfterFirst, 'クールダウン拒否時はAPIが呼ばれないこと');

    // 3. 原神 ログボ (別種別): 実行可能
    const s1 = await runDailySignFlow('MANUAL', 'GENSHIN');
    assert.equal(s1.success, true);

    // 4. スタレ コード交換 (別ゲーム): 実行可能
    const r3 = await runAutoRedeemFlow('MANUAL', 'STAR_RAIL');
    assert.equal(r3.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

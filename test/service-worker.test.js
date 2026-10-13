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
const mockIdleListeners = [];

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: mockStorage.local.get(key) }),
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
    onAlarm: { addListener: () => {} }
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
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  }
};

import { acquireExecutionLock, releaseExecutionLock, markCodeStatus, getRedeemedCodes, setLastSuccessfulRun } from '../src/services/storage-service.js';
import { STATUS_MAP, GAMES, ALARM_NAMES, API_CONFIG } from '../src/config/constants.js';
const { handleNotificationClick, LOGIN_NOTIFICATION_PREFIX, redeemForGame, runAutoRedeemFlow, setupAlarm, scheduleRetryAlarm, clearRetryAlarm, maybeRunCatchUp } = await import('../src/background/service-worker.js');

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

test('runAutoRedeemFlow: 通信エラー発生時に自動でリトライアラームがスケジュールされる', async () => {
  mockAlarms.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  try {
    const res = await runAutoRedeemFlow('ALARM');
    assert.equal(res.success, false);
    assert.equal(res.reason, 'EXCEPTION');
    const retryAlarm = mockAlarms.get(ALARM_NAMES.RETRY);
    assert.ok(retryAlarm, '通信例外時にリトライアラームが登録されていること');
    assert.equal(retryAlarm.delayInMinutes, API_CONFIG.RETRY_INTERVAL_MINUTES);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



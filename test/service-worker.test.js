import test from 'node:test';
import assert from 'node:assert/strict';

import { createBackgroundRunner } from '../src/background/background-runner.js';
import { bindChromeListeners } from '../src/background/chrome-adapter.js';
import { createBackgroundTestAdapter } from './helpers/background-test-adapter.js';
import { formatRedeemResult } from '../src/utils/message-formatter.js';
import { API_STATUS, ERROR_KIND, GatewayError } from '../src/services/api-gateway.js';
import { STATUS_MAP, GAMES, ALARM_NAMES, API_CONFIG, UNINSTALL_URL } from '../src/config/constants.js';

const LOGIN_NOTIFICATION_PREFIX = 'login_required_';
const SIGN_LOGIN_NOTIFICATION_PREFIX = 'sign_login_required_';
const SIGN_CAPTCHA_NOTIFICATION_PREFIX = 'sign_captcha_';
const DEFAULT_SENDER = { id: 'test-ext-id' };

async function invokeMessage(runner, message, sender = DEFAULT_SENDER) {
  const dispatched = runner.handleMessage(message, sender);
  assert.equal(dispatched.handled, true, `${message?.type} がハンドリングされること`);
  return dispatched.promise;
}

async function createRealTimeoutError() {
  const signal = AbortSignal.timeout(1);
  if (!signal.aborted) {
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, { once: true });
    });
  }
  return signal.reason;
}

function createSampleRole(gameBiz = 'hk4e_global') {
  const presets = {
    hk4e_global: { game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60 },
    hkrpg_global: { game_biz: 'hkrpg_global', region: 'prod_official_asia', game_uid: '800111222', nickname: '星', level: 70 },
    nap_global: { game_biz: 'nap_global', region: 'prod_gf_jp', game_uid: '1300111222', nickname: 'アキラ', level: 60 }
  };
  return {
    success: true,
    retcode: 0,
    role: presets[gameBiz] || presets.hk4e_global,
    allRoles: [presets[gameBiz] || presets.hk4e_global],
    hoyoverseNotLoggedIn: false
  };
}

test('GAMES config: giftSiteUrlの定義確認', () => {
  assert.equal(GAMES.GENSHIN.giftSiteUrl, 'https://genshin.hoyoverse.com/ja/gift');
  assert.equal(GAMES.STAR_RAIL.giftSiteUrl, 'https://hsr.hoyoverse.com/gift');
  assert.equal(GAMES.ZZZ.giftSiteUrl, 'https://zenless.hoyoverse.com/redemption/gift');
});

test('handleNotificationClick: ログイン誘導・ログボ・CAPTCHA通知クリック時に正しいURLを開き通知を消去すること', async () => {
  const adapter = createBackgroundTestAdapter();
  const runner = createBackgroundRunner(adapter);

  const notifGenshin = `${LOGIN_NOTIFICATION_PREFIX}GENSHIN`;
  await runner.handleNotificationClick(notifGenshin);
  assert.equal(adapter.createdTabs.length, 1);
  assert.equal(adapter.createdTabs[0].url, 'https://genshin.hoyoverse.com/ja/gift');
  assert.equal(adapter.clearedNotifications.includes(notifGenshin), true);

  const notifHsr = `${LOGIN_NOTIFICATION_PREFIX}STAR_RAIL`;
  await runner.handleNotificationClick(notifHsr);
  assert.equal(adapter.createdTabs[1].url, 'https://hsr.hoyoverse.com/gift');
  assert.equal(adapter.clearedNotifications.includes(notifHsr), true);

  const notifZzz = `${LOGIN_NOTIFICATION_PREFIX}ZZZ`;
  await runner.handleNotificationClick(notifZzz);
  assert.equal(adapter.createdTabs[2].url, 'https://zenless.hoyoverse.com/redemption/gift');
  assert.equal(adapter.clearedNotifications.includes(notifZzz), true);

  await runner.handleNotificationClick(`${SIGN_LOGIN_NOTIFICATION_PREFIX}STAR_RAIL`);
  assert.equal(adapter.createdTabs[3].url, GAMES.STAR_RAIL.checkInSiteUrl);

  await runner.handleNotificationClick(`${SIGN_CAPTCHA_NOTIFICATION_PREFIX}ZZZ`);
  assert.equal(adapter.createdTabs[4].url, GAMES.ZZZ.checkInSiteUrl);

  const tabsBefore = adapter.createdTabs.length;
  const handled = await runner.handleNotificationClick('other_notification_id');
  assert.equal(handled, false);
  assert.equal(adapter.createdTabs.length, tabsBefore);
});

test('手動コード交換: 未プレイ（キャラクター不在 -1）の場合はエラー通知を出さず安全にスキップ', async () => {
  const adapter = createBackgroundTestAdapter({
    gateway: {
      fetchValidCodes: async () => ['ZZZNEW1'],
      getUserGameRoles: async () => ({
        success: false,
        retcode: -1,
        message: 'No character',
        role: null,
        hoyoverseNotLoggedIn: false
      })
    }
  });
  const runner = createBackgroundRunner(adapter);

  const resp = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'ZZZ' });
  assert.equal(resp.success, true);
  const res = resp.results.ZZZ;
  assert.equal(res.success, true, '成功ステータスで返ること');
  assert.equal(res.skipped, true, 'スキップフラグがtrueであること');
  assert.equal(res.reason, 'NO_CHARACTER');
  assert.equal(res.gameKey, 'ZZZ');
  assert.equal(adapter.createdNotifications.length, 0, '未プレイゲームに対して通知を出さないこと');
  assert.ok(
    adapter.logs.some(l => l.message && l.message.includes('キャラクターが見つからないためスキップ')),
    'INFOログにスキップログが記録されていること'
  );
});

test('定期コード交換: 全3ゲーム巡回（未プレイゲームはスキップ、プレイ中ゲームは引き換え成功）', async () => {
  const adapter = createBackgroundTestAdapter({
    settings: { optInAccepted: true, autoRedeemEnabled: true },
    gateway: {
      fetchValidCodes: async () => ['GENSHINNEW1'],
      getUserGameRoles: async (gameBiz) => {
        if (gameBiz === 'hk4e_global') return createSampleRole('hk4e_global');
        return { success: false, retcode: -1, message: 'No character', role: null };
      },
      redeemCode: async ({ cdkey }) => ({ retcode: 0, message: 'OK', cdkey })
    }
  });
  const runner = createBackgroundRunner(adapter);

  const flowRes = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(flowRes.success, true);
  assert.equal(flowRes.redeemedCount, 1, '原神で1件成功');
  assert.equal(flowRes.results.GENSHIN.skipped, false);
  assert.equal(flowRes.results.GENSHIN.redeemedCount, 1);
  assert.equal(flowRes.results.STAR_RAIL.skipped, true);
  assert.equal(flowRes.results.STAR_RAIL.reason, 'NO_CHARACTER');
  assert.equal(flowRes.results.ZZZ.skipped, true);
  assert.equal(flowRes.results.ZZZ.reason, 'NO_CHARACTER');
});

test('手動コード交換: 単一ゲーム指定時は選択ゲームのみ実行され他ゲームは処理されない', async () => {
  const fetchedRoleBiz = [];
  const adapter = createBackgroundTestAdapter({
    gateway: {
      fetchValidCodes: async () => ['GENSHINNEW2'],
      getUserGameRoles: async (gameBiz) => {
        fetchedRoleBiz.push(gameBiz);
        return createSampleRole(gameBiz);
      },
      redeemCode: async ({ cdkey }) => ({ retcode: 0, message: 'OK', cdkey })
    }
  });
  const runner = createBackgroundRunner(adapter);

  const res = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(res.success, true);
  assert.equal(res.targetGameKey, 'GENSHIN');
  assert.equal(res.redeemedCount, 1);
  assert.ok(res.results.GENSHIN);
  assert.equal(res.results.STAR_RAIL, undefined, 'STAR_RAILは処理されない');
  assert.equal(res.results.ZZZ, undefined, 'ZZZは処理されない');
  assert.deepEqual(fetchedRoleBiz, ['hk4e_global'], '原神以外のAPIは呼ばれない');
});

test('手動実行: 未知のゲームキー指定時は安全にエラーが返る', async () => {
  const adapter = createBackgroundTestAdapter();
  const runner = createBackgroundRunner(adapter);

  const redeemRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'UNKNOWN_GAME' });
  assert.equal(redeemRes.success, false);
  assert.match(redeemRes.reason, /未知のゲームキー/);

  const signRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'UNKNOWN_GAME' });
  assert.equal(signRes.success, false);
  assert.match(signRes.reason, /未知のゲームキー/);
});

test('handleInstalled: 定期アラーム登録・アンインストールURL設定・例外時の安全性', async () => {
  const adapter = createBackgroundTestAdapter({
    initialNowMs: Date.parse('2026-10-16T16:00:00Z'), // 2026-10-17 00:00:00 UTC+8
    randomValue: 0
  });
  const runner = createBackgroundRunner(adapter);

  await runner.handleInstalled();

  assert.equal(adapter.uninstallUrl, UNINSTALL_URL);
  assert.equal(adapter.uninstallUrl, 'https://forms.gle/xWmVdhKJhpcuvmhP9');

  const redeemAlarm = adapter.alarmsMap.get(ALARM_NAMES.AUTO_REDEEM);
  assert.ok(redeemAlarm, '定期アラームが作成されている');
  assert.equal(redeemAlarm.periodInMinutes, API_CONFIG.REDEEM_INTERVAL_MINUTES);

  const signAlarm = adapter.alarmsMap.get(ALARM_NAMES.DAILY_SIGN);
  assert.ok(signAlarm, 'DAILY_SIGNアラームが作成されている');
  assert.equal(signAlarm.periodInMinutes, 1440);
  assert.equal(signAlarm.when, Date.parse('2026-10-16T16:05:00Z'), '5分後の00:05 UTC+8が算出される');

  // 00:10 UTC+8 の場合は翌日 00:05 UTC+8 が算出される
  const nextDayAdapter = createBackgroundTestAdapter({
    initialNowMs: Date.parse('2026-10-16T16:10:00Z'),
    randomValue: 0
  });
  const nextDayRunner = createBackgroundRunner(nextDayAdapter);
  await nextDayRunner.handleInstalled();
  assert.equal(
    nextDayAdapter.alarmsMap.get(ALARM_NAMES.DAILY_SIGN).when,
    Date.parse('2026-10-17T16:05:00Z'),
    '翌日の00:05 UTC+8が算出される'
  );

  // setUninstallURL が例外を投げても後続の初期化が止まらないこと
  const errAdapter = createBackgroundTestAdapter();
  errAdapter.setUninstallUrlError(new Error('API failure simulation'));
  const errRunner = createBackgroundRunner(errAdapter);
  await assert.doesNotReject(() => errRunner.handleInstalled());
  assert.ok(errAdapter.alarmsMap.get(ALARM_NAMES.AUTO_REDEEM), '後続のアラーム登録が完了していること');
});

test('handleInstalled: 既存ユーザー（01:05固定アラーム登録済み）への初回オフセット移行と2回目以降の維持', async () => {
  const baseMs = Date.parse('2026-10-16T16:00:00Z');
  const adapter = createBackgroundTestAdapter({
    initialNowMs: baseMs,
    randomValue: 0.5 // 0〜30分の中間付近
  });
  const runner = createBackgroundRunner(adapter);

  const legacyWhen = Date.parse('2026-10-16T16:05:00Z');
  adapter.alarmsMap.set(ALARM_NAMES.DAILY_SIGN, { when: legacyWhen, periodInMinutes: 1440 });

  await runner.handleInstalled();

  const savedJitter = adapter.getDailySignJitterMinutes();
  assert.ok(savedJitter !== null && savedJitter >= 0 && savedJitter <= API_CONFIG.DAILY_SIGN_JITTER_MAX_MINUTES);
  const migratedAlarm = adapter.alarmsMap.get(ALARM_NAMES.DAILY_SIGN);
  assert.equal(migratedAlarm.periodInMinutes, 1440);
  const expectedDiffMs = savedJitter * 60 * 1000;
  const actualDiffMs = (migratedAlarm.when - legacyWhen + 24 * 60 * 60_000) % (24 * 60 * 60_000);
  assert.ok(Math.abs(actualDiffMs - expectedDiffMs) < 5_000, '移行後アラーム時刻がオフセット分ずれていること');

  // 2回目以降は既存アラームが上書きされないこと
  const sentinelWhen = 1234567890;
  adapter.alarmsMap.set(ALARM_NAMES.DAILY_SIGN, { when: sentinelWhen, periodInMinutes: 1440 });
  await runner.handleInstalled();
  assert.equal(adapter.alarmsMap.get(ALARM_NAMES.DAILY_SIGN).when, sentinelWhen);
  assert.equal(adapter.getDailySignJitterMinutes(), savedJitter);
});

test('handleInstalled / handleStartup: 既存・新規ユーザーに対して ga_client_id が初期化・維持されること', async () => {
  const adapter = createBackgroundTestAdapter();
  const runner = createBackgroundRunner(adapter);

  assert.equal(adapter.getGaClientId(), null);
  await runner.handleInstalled();
  const generatedId = adapter.getGaClientId();
  assert.ok(generatedId, 'onInstalled 実行時に ga_client_id が生成されること');
  assert.match(generatedId, /^[0-9a-f-]{36}$/i);

  adapter.setGaClientId('existing-legacy-client-id');
  await runner.handleStartup();
  assert.equal(adapter.getGaClientId(), 'existing-legacy-client-id', '既存の ga_client_id が維持されること');
});

test('キャッチアップ: 設定無効・3時間未経過時はスキップ、3時間経過時は実行される', async () => {
  const adapter = createBackgroundTestAdapter({
    config: { CATCH_UP_DELAY_MS: 0, CATCH_UP_JITTER_MAX_MS: 0 }
  });
  const runner = createBackgroundRunner(adapter);

  // 1. オプトイン未承諾時はスキップ
  let res = await runner.handleStartup();
  assert.deepEqual(res, { signResult: false, redeemResult: false });

  // 2. 有効化するが直近実行済み（3時間未経過）時はスキップ
  adapter.setSettings({ optInAccepted: true, autoRedeemEnabled: true, autoSignEnabled: false });
  adapter.setLastSuccessfulRun(adapter.clock.now());
  res = await runner.handleIdleStateChanged('active');
  assert.deepEqual(res, { signResult: false, redeemResult: false });

  // 非 active の idle 状態は無視される
  assert.equal(await runner.handleIdleStateChanged('idle'), null);

  // 3. 3時間以上経過している場合は実行される
  adapter.clock.advanceTime(4 * 60 * 60 * 1000);
  res = await runner.handleIdleStateChanged('active');
  assert.equal(res.signResult, false);
  assert.equal(res.redeemResult.success, true);
});

test('handleStartup: ログインボーナスとコード交換がロック競合せず直列実行されること', async () => {
  const adapter = createBackgroundTestAdapter({
    config: { CATCH_UP_DELAY_MS: 0, CATCH_UP_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoSignEnabled: true, autoRedeemEnabled: true }
  });
  const runner = createBackgroundRunner(adapter);

  const { signResult, redeemResult } = await runner.handleStartup();
  assert.equal(signResult.success, true, 'ログインボーナスキャッチアップが成功すること');
  assert.equal(redeemResult.success, true, 'コード引き換えキャッチアップもALREADY_RUNNINGにならず成功すること');
});

test('TRIGGER_INITIAL_CATCH_UP: 待機ディレイをスキップして即座にログボ・コード引き換えを実行すること', async () => {
  const adapter = createBackgroundTestAdapter({
    config: { CATCH_UP_DELAY_MS: 30_000, CATCH_UP_JITTER_MAX_MS: 10_000 },
    settings: { optInAccepted: true, autoSignEnabled: true, autoRedeemEnabled: true }
  });
  const runner = createBackgroundRunner(adapter);

  const resp = await invokeMessage(runner, { type: 'TRIGGER_INITIAL_CATCH_UP' });
  assert.equal(resp.signResult.success, true);
  assert.equal(resp.redeemResult.success, true);
  assert.equal(adapter.keepAlivePingCalls, 0, '初期実行時はキャッチアップ待機が発生しないこと');
  assert.equal(
    adapter.clock.sleepCalls.some(ms => ms >= 10_000),
    false,
    '30秒のキャッチアップ待機ディレイがスキップされること'
  );
});

test('キャッチアップ待機: 20秒単位の分割スリープとチャンク間キープアライブ呼び出しの境界値検証', async () => {
  const cases = [
    { delayMs: 0, expectedChunks: [], expectedPings: 0 },
    { delayMs: 18_000, expectedChunks: [18_000], expectedPings: 0 },
    { delayMs: 20_000, expectedChunks: [20_000], expectedPings: 0 },
    { delayMs: 40_000, expectedChunks: [20_000, 20_000], expectedPings: 1 },
    { delayMs: 45_000, expectedChunks: [20_000, 20_000, 5_000], expectedPings: 2 }
  ];

  for (const tc of cases) {
    const adapter = createBackgroundTestAdapter({
      config: {
        CATCH_UP_DELAY_MS: tc.delayMs,
        CATCH_UP_JITTER_MAX_MS: 0,
        CATCH_UP_KEEPALIVE_INTERVAL_MS: 20_000
      },
      settings: { optInAccepted: true, autoSignEnabled: true, autoRedeemEnabled: false, enabledGames: ['GENSHIN'] }
    });
    const runner = createBackgroundRunner(adapter);
    await runner.handleIdleStateChanged('active');
    assert.deepEqual(adapter.clock.sleepCalls, tc.expectedChunks, `delay=${tc.delayMs} のチャンク分割`);
    assert.equal(adapter.keepAlivePingCalls, tc.expectedPings, `delay=${tc.delayMs} のping回数`);
  }

  // keepAlivePing が例外を投げてもキャッチアップ本体が完走すること
  const errAdapter = createBackgroundTestAdapter({
    config: { CATCH_UP_DELAY_MS: 45_000, CATCH_UP_JITTER_MAX_MS: 0, CATCH_UP_KEEPALIVE_INTERVAL_MS: 20_000 },
    settings: { optInAccepted: true, autoSignEnabled: true, autoRedeemEnabled: false, enabledGames: ['GENSHIN'] }
  });
  errAdapter.setPingKeepAliveFn(async () => {
    throw new Error('storage session error');
  });
  const errRunner = createBackgroundRunner(errAdapter);
  const res = await errRunner.handleIdleStateChanged('active');
  assert.equal(res.signResult.success, true);
  assert.deepEqual(errAdapter.clock.sleepCalls, [20_000, 20_000, 5_000]);
  assert.equal(errAdapter.keepAlivePingCalls, 2);
});

test('定期ログボ受取: 全3ゲーム巡回（未プレイはスキップ、未受取ゲームは受取成功して記録保存）', async () => {
  const adapter = createBackgroundTestAdapter({
    settings: { optInAccepted: true, autoSignEnabled: true },
    gateway: {
      getUserGameRoles: async (gameBiz) => {
        if (gameBiz === 'hk4e_global') return createSampleRole('hk4e_global');
        return { success: false, retcode: -1, message: 'No character', role: null };
      },
      getDailySignInfo: async () => ({
        success: true,
        retcode: 0,
        isSigned: false,
        totalSignDay: 10,
        today: '2026-10-17'
      }),
      claimDailyBonus: async () => ({
        success: true,
        retcode: 0,
        alreadySigned: false,
        message: 'OK'
      })
    }
  });
  const runner = createBackgroundRunner(adapter);

  const res = await runner.handleAlarm({ name: ALARM_NAMES.DAILY_SIGN });
  assert.equal(res.success, true);
  assert.equal(res.signedCount, 1);
  assert.equal(res.results.GENSHIN.signed, true);
  assert.equal(res.results.GENSHIN.totalSignDay, 11);
  assert.equal(res.results.STAR_RAIL.skipped, true);
  assert.equal(res.results.ZZZ.skipped, true);

  const saved = adapter.getDailySignRecord('hk4e_global');
  assert.equal(saved.isSigned, true);
  assert.equal(saved.totalSignDay, 11);
});

test('enabledGames: 指定したタイトルのみ巡回されること', async () => {
  const calledGames = [];
  const adapter = createBackgroundTestAdapter({
    settings: {
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true,
      enabledGames: ['STAR_RAIL'],
      activeGameKey: 'STAR_RAIL'
    },
    gateway: {
      fetchValidCodes: async () => ['ENABLEDTEST1'],
      getUserGameRoles: async (gameBiz) => {
        if (gameBiz === 'hkrpg_global') calledGames.push('STAR_RAIL');
        if (gameBiz === 'hk4e_global') calledGames.push('GENSHIN');
        if (gameBiz === 'nap_global') calledGames.push('ZZZ');
        return { success: false, retcode: -1, message: 'No character', role: null };
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  const redeemRes = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(redeemRes.success, true);
  assert.deepEqual(Object.keys(redeemRes.results), ['STAR_RAIL']);
  assert.deepEqual(calledGames, ['STAR_RAIL']);

  calledGames.length = 0;
  const signRes = await runner.handleAlarm({ name: ALARM_NAMES.DAILY_SIGN });
  assert.equal(signRes.success, true);
  assert.deepEqual(Object.keys(signRes.results), ['STAR_RAIL']);
  assert.deepEqual(calledGames, ['STAR_RAIL']);
});

test('レビュー促進成功カウント: 新規成功セッションのみ+1加算され既受取・引き換え済みでは増えないこと', async () => {
  const adapter = createBackgroundTestAdapter({
    settings: { optInAccepted: true, enabledGames: ['GENSHIN'] }
  });
  adapter.setReviewPromptState({ successCount: 0, status: 'pending' });
  const runner = createBackgroundRunner(adapter);

  // 1. コード2件新規成功 -> 1セッションで +1
  adapter.setGateway({
    fetchValidCodes: async () => ['CODE1', 'CODE2'],
    getUserGameRoles: async () => createSampleRole('hk4e_global'),
    redeemCode: async ({ cdkey }) => ({ retcode: 0, message: 'OK', cdkey })
  });
  const r1 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(r1.redeemedCount, 2);
  assert.equal(adapter.getReviewPromptState().successCount, 1);

  // 2. 引き換え済み(-2017)のみ -> 加算されない
  adapter.clearManualCooldowns();
  adapter.setGateway({
    fetchValidCodes: async () => ['ALREADY_CLAIMED_CODE'],
    redeemCode: async ({ cdkey }) => ({ retcode: -2017, message: 'Already claimed', cdkey })
  });
  const r2 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(r2.redeemedCount, 0);
  assert.equal(adapter.getReviewPromptState().successCount, 1);

  // 3. ログボ新規受取成功 -> +1
  adapter.setGateway({
    getDailySignInfo: async () => ({ success: true, retcode: 0, isSigned: false, totalSignDay: 5, today: '2026-10-17' }),
    claimDailyBonus: async () => ({ success: true, retcode: 0, alreadySigned: false })
  });
  const s1 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  assert.equal(s1.signedCount, 1);
  assert.equal(adapter.getReviewPromptState().successCount, 2);

  // 4. すでにログボ受取済み -> 加算されない
  adapter.clearManualCooldowns();
  adapter.setGateway({
    getDailySignInfo: async () => ({ success: true, retcode: 0, isSigned: true, totalSignDay: 6, today: '2026-10-17' })
  });
  const s2 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  assert.equal(s2.signedCount, 0);
  assert.equal(adapter.getReviewPromptState().successCount, 2);
});

test('ネットワークエラー短期リトライ: 最大3回 (2→10→30分) で打ち止め、通常アラームでリセットされ例外ERRORログは抑制', async () => {
  const adapter = createBackgroundTestAdapter({
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN'] },
    gateway: {
      fetchValidCodes: async () => {
        throw new TypeError('Failed to fetch');
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  // 1回目: 2分台
  const r1 = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(r1.success, false);
  assert.equal(r1.reason, 'NETWORK_RETRY_SCHEDULED');
  const d1 = adapter.alarmsMap.get(ALARM_NAMES.RETRY).delayInMinutes;
  assert.ok(d1 >= 2 && d1 <= 2.5, `1回目は2〜2.5分: ${d1}`);
  assert.ok(adapter.logs.some(l => l.message.includes('一時的な通信不通を検知')));
  assert.equal(adapter.logs.some(l => l.message.includes('例外発生')), false, '例外ERRORログは抑制');

  // 2回目: 10分台
  adapter.alarmsMap.delete(ALARM_NAMES.RETRY);
  const r2 = await runner.handleAlarm({ name: ALARM_NAMES.RETRY });
  assert.equal(r2.reason, 'NETWORK_RETRY_SCHEDULED');
  const d2 = adapter.alarmsMap.get(ALARM_NAMES.RETRY).delayInMinutes;
  assert.ok(d2 >= 10 && d2 <= 10.5, `2回目は10〜10.5分: ${d2}`);

  // 3回目: 30分台
  adapter.alarmsMap.delete(ALARM_NAMES.RETRY);
  const r3 = await runner.handleAlarm({ name: ALARM_NAMES.RETRY });
  assert.equal(r3.reason, 'NETWORK_RETRY_SCHEDULED');
  const d3 = adapter.alarmsMap.get(ALARM_NAMES.RETRY).delayInMinutes;
  assert.ok(d3 >= 30 && d3 <= 30.5, `3回目は30〜30.5分: ${d3}`);

  // 4回目・5回目: 上限到達（アラーム未登録・打ち止めログ1回のみ）
  adapter.alarmsMap.delete(ALARM_NAMES.RETRY);
  const r4 = await runner.handleAlarm({ name: ALARM_NAMES.RETRY });
  assert.equal(r4.reason, 'NETWORK_RETRY_EXHAUSTED');
  assert.equal(adapter.alarmsMap.get(ALARM_NAMES.RETRY), undefined);

  const r5 = await runner.handleAlarm({ name: ALARM_NAMES.RETRY });
  assert.equal(r5.reason, 'NETWORK_RETRY_EXHAUSTED');
  assert.equal(adapter.logs.filter(l => l.message && l.message.includes('再試行上限')).length, 1);

  // 通常定期アラーム発火でリトライ回数がリセットされること
  adapter.alarmsMap.delete(ALARM_NAMES.RETRY);
  await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  const dReset = adapter.alarmsMap.get(ALARM_NAMES.RETRY).delayInMinutes;
  assert.ok(dReset >= 2 && dReset <= 2.5, '通常アラーム後は再び1回目(2分台)から開始');
  assert.equal(adapter.getRetryState('REDEEM').count, 1);
});

test('CAPTCHA当日ブロック: isRisk後はIDLE_ACTIVEで再実行・再通知されないが手動実行は許可される', async () => {
  let signApiCalls = 0;
  const adapter = createBackgroundTestAdapter({
    config: { CATCH_UP_DELAY_MS: 0, CATCH_UP_JITTER_MAX_MS: 0, SIGN_GAME_DELAY_MS: 0 },
    settings: { optInAccepted: true, autoSignEnabled: true, autoRedeemEnabled: false, enabledGames: ['GENSHIN'] },
    gateway: {
      getUserGameRoles: async () => createSampleRole('hk4e_global'),
      getDailySignInfo: async () => ({ success: true, retcode: 0, isSigned: false, totalSignDay: 3 }),
      claimDailyBonus: async () => {
        signApiCalls++;
        return { success: false, retcode: 1034, isRisk: true, message: 'CAPTCHA required' };
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  const firstRun = await runner.handleAlarm({ name: ALARM_NAMES.DAILY_SIGN });
  assert.equal(firstRun.results.GENSHIN.isRisk, true);
  assert.equal(signApiCalls, 1);
  assert.equal(adapter.createdNotifications.length, 1);
  assert.equal(adapter.getDailySignRecord('hk4e_global').captchaBlocked, true);

  const catchUpRes = await runner.handleIdleStateChanged('active');
  assert.equal(catchUpRes.signResult, false);
  assert.equal(signApiCalls, 1, '当日は自動サインインAPIを再度叩かないこと');
  assert.equal(adapter.createdNotifications.length, 1, 'CAPTCHA通知が重複しないこと');

  const manualRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  assert.equal(manualRes.results.GENSHIN.isRisk, true);
  assert.equal(signApiCalls, 2, '手動実行時は実行が許可されること');
});

test('未ログイン時の自動3時間クールダウンとコード失敗回数(r)非消費', async () => {
  let roleCalls = 0;
  const adapter = createBackgroundTestAdapter({
    config: { CATCH_UP_DELAY_MS: 0, CATCH_UP_JITTER_MAX_MS: 0, INTER_REQUEST_DELAY_MS: 0 },
    settings: { optInAccepted: true, autoSignEnabled: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN'] },
    gateway: {
      fetchValidCodes: async () => ['ENABLEDTEST1'],
      getUserGameRoles: async () => {
        roleCalls++;
        return { success: false, retcode: -100, message: 'Not logged in', role: null };
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  await runner.handleStartup();
  const callsAfterStartup = roleCalls;
  assert.ok(callsAfterStartup > 0);

  const idleRes = await runner.handleIdleStateChanged('active');
  assert.equal(idleRes.signResult, false);
  assert.equal(idleRes.redeemResult, false);
  assert.equal(roleCalls, callsAfterStartup, 'クールダウン中はAPIを叩かないこと');

  // ロール取得成功後に交換APIが -100 を返してもコードの失敗回数 r が増えないこと
  adapter.setGateway({
    fetchValidCodes: async () => ['VALIDCODE123'],
    getUserGameRoles: async () => createSampleRole('hk4e_global'),
    redeemCode: async ({ cdkey }) => ({ retcode: -100, message: 'Not logged in', cdkey })
  });
  await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(adapter.getRedeemedCodes('hk4e_global').VALIDCODE123, undefined);
});

test('HTTP 429 検知時: sign を追い打ちせず指数バックオフ (30→60分) に遷移し、正常完了でリセット', async () => {
  let signPostCalls = 0;
  let return429 = true;

  const adapter = createBackgroundTestAdapter({
    config: { SIGN_GAME_DELAY_MS: 0 },
    settings: { optInAccepted: true, autoSignEnabled: true, enabledGames: ['GENSHIN'] },
    gateway: {
      getUserGameRoles: async () => createSampleRole('hk4e_global'),
      getDailySignInfo: async () => {
        if (return429) {
          return { success: false, retcode: -429, shouldBackoff: true, httpStatus: 429, isRateLimited: true, retryAfterMs: null };
        }
        return { success: true, retcode: 0, isSigned: true, totalSignDay: 5 };
      },
      claimDailyBonus: async () => {
        signPostCalls++;
        return { success: true, retcode: 0 };
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  // 1回目 429 -> level 1 (30分)
  const res1 = await runner.handleMessage({ type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' }, DEFAULT_SENDER).promise;
  assert.equal(res1.success, false);
  assert.equal(res1.reason, 'UNDER_BACKOFF');
  assert.equal(res1.remainingMinutes, 30);
  assert.equal(signPostCalls, 0, 'infoで429を受けた場合はsignを追い打ちしないこと');
  assert.equal((await adapter.getBackoffState()).level, 1);

  // バックオフ中は即座に UNDER_BACKOFF で拒否される
  adapter.clearManualCooldowns();
  const resBlocked = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  assert.equal(resBlocked.success, false);
  assert.equal(resBlocked.reason, 'UNDER_BACKOFF');

  // バックオフ解除後に再び 429 -> level 2 (60分)
  adapter.clock.advanceTime(31 * 60_000);
  adapter.clearManualCooldowns();
  const res2 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  assert.equal(res2.reason, 'UNDER_BACKOFF');
  assert.equal(res2.remainingMinutes, 60);
  assert.equal((await adapter.getBackoffState()).level, 2);

  // バックオフ解除後に正常完了 -> level 0 にリセット
  adapter.clock.advanceTime(61 * 60_000);
  adapter.clearManualCooldowns();
  return429 = false;
  const res3 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  assert.equal(res3.success, true);
  assert.equal((await adapter.getBackoffState()).level, 0);
});

test('交換ループ内の HTTP 429 と -2016 クールダウン: 即中断・バックオフ記録・リトライアラーム解除', async () => {
  // 1. HTTP 429: logHttpBackoff WARNログ記録・GA failed(rate_limited)・残コード中断
  let redeemCalls = 0;
  const adapter429 = createBackgroundTestAdapter({
    config: { INTER_REQUEST_DELAY_MS: 0, INTER_REQUEST_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN', 'STAR_RAIL'] },
    gateway: {
      fetchValidCodes: async () => ['C1', 'C2'],
      getUserGameRoles: async (biz) => createSampleRole(biz),
      redeemCode: async ({ cdkey }) => {
        redeemCalls++;
        return { retcode: -429, shouldBackoff: true, httpStatus: 429, isRateLimited: true, retryAfterMs: null, cdkey };
      }
    }
  });
  adapter429.alarmsMap.set(ALARM_NAMES.RETRY, { delayInMinutes: 2 });
  const runner429 = createBackgroundRunner(adapter429);

  const flow429 = await runner429.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(flow429.success, false);
  assert.equal(flow429.reason, 'UNDER_BACKOFF');
  assert.equal(redeemCalls, 1, 'C2やSTAR_RAILへ進まず即中断すること');
  assert.equal(adapter429.alarmsMap.get(ALARM_NAMES.RETRY), undefined, 'バックオフ時はRETRYアラームが解除されること');
  assert.ok(adapter429.logs.some(l => l.type === 'WARN' && l.message.includes('一時停止します')));
  assert.equal(adapter429.gaEvents[0].params.error_reason, 'rate_limited');
  assert.equal(adapter429.getRedeemedCodes('hk4e_global').C1, undefined, '429時は失敗回数を消費しないこと');

  // 2. retcode -2016: GA cooldown 送信・WARNログなし・残コード中断・失敗回数非消費
  let cooldownCalls = 0;
  const adapter2016 = createBackgroundTestAdapter({
    config: { INTER_REQUEST_DELAY_MS: 0, INTER_REQUEST_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN', 'STAR_RAIL'] },
    gateway: {
      fetchValidCodes: async () => ['C1', 'C2'],
      getUserGameRoles: async (biz) => createSampleRole(biz),
      redeemCode: async ({ cdkey }) => {
        cooldownCalls++;
        return { retcode: -2016, message: 'Cooldown', cdkey };
      }
    }
  });
  const runner2016 = createBackgroundRunner(adapter2016);
  const flow2016 = await runner2016.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(flow2016.success, false);
  assert.equal(flow2016.reason, 'UNDER_BACKOFF');
  assert.equal(cooldownCalls, 1);
  assert.equal(adapter2016.logs.some(l => l.type === 'WARN'), false, '-2016時はlogHttpBackoffのWARNを出さないこと');
  assert.equal(adapter2016.gaEvents[0].params.status, 'cooldown');
  assert.equal(adapter2016.gaEvents[0].params.error_reason, 'cooldown');
  assert.equal(adapter2016.getRedeemedCodes('hk4e_global').C1, undefined);
});

test('手動クールダウン: 60秒以内の同ゲーム同種別連打は拒否、別ゲーム・別種別・60秒経過後は実行可能', async () => {
  let fetchCount = 0;
  const adapter = createBackgroundTestAdapter({
    gateway: {
      fetchValidCodes: async () => {
        fetchCount++;
        return ['COOLDOWN1'];
      },
      getUserGameRoles: async () => ({ success: false, retcode: -1, message: 'No character', role: null })
    }
  });
  const runner = createBackgroundRunner(adapter);

  const r1 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(r1.success, true);
  const countAfterFirst = fetchCount;

  adapter.clock.advanceTime(20_000);
  const r2 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(r2.success, false);
  assert.equal(r2.reason, 'MANUAL_COOLDOWN');
  assert.equal(r2.remainingSec, 40);
  assert.equal(fetchCount, countAfterFirst, 'クールダウン拒否時はAPIが呼ばれないこと');

  const s1 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  assert.equal(s1.success, true);

  const r3 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'STAR_RAIL' });
  assert.equal(r3.success, true);

  adapter.clock.advanceTime(40_000); // 初回から合計60秒経過
  const r4 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(r4.success, true);
});

test('コード一覧取得エラー分類 (GA4) と TimeoutError 時の短期リトライ予約', async () => {
  const realTimeoutErr = await createRealTimeoutError();
  const cases = [
    { err: realTimeoutErr, expectedHttp: 0, expectedType: 'timeout', expectedReason: 'NETWORK_RETRY_SCHEDULED' },
    { err: new DOMException('aborted', 'AbortError'), expectedHttp: 0, expectedType: 'timeout', expectedReason: 'NETWORK_RETRY_SCHEDULED' },
    { err: new GatewayError(ERROR_KIND.HTTP_ERROR, 'HTTP 503', { httpStatus: 503 }), expectedHttp: 503, expectedType: 'http_error', expectedReason: 'EXCEPTION' },
    { err: new GatewayError(ERROR_KIND.SECURITY_ERROR, 'Payload too large', { code: 'PAYLOAD_TOO_LARGE' }), expectedHttp: 0, expectedType: 'parse_error', expectedReason: 'EXCEPTION' },
    { err: new SyntaxError('Unexpected token <'), expectedHttp: 0, expectedType: 'parse_error', expectedReason: 'EXCEPTION' },
    { err: new TypeError('Failed to fetch'), expectedHttp: 0, expectedType: 'network_error', expectedReason: 'NETWORK_RETRY_SCHEDULED' }
  ];

  for (const tc of cases) {
    const adapter = createBackgroundTestAdapter({
      settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN'], language: 'ja' },
      gateway: {
        fetchValidCodes: async () => {
          throw tc.err;
        }
      }
    });
    const runner = createBackgroundRunner(adapter);

    const res = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
    assert.equal(res.success, false);
    assert.equal(res.reason, tc.expectedReason);

    const fetchErrEvent = adapter.gaEvents.find(e => e.eventName === 'code_list_fetch_error');
    assert.ok(fetchErrEvent, 'code_list_fetch_error が送信されること');
    assert.equal(fetchErrEvent.params.game, 'genshin');
    assert.equal(fetchErrEvent.params.http_status, tc.expectedHttp);
    assert.equal(fetchErrEvent.params.error_type, tc.expectedType);

    if (tc.expectedReason === 'NETWORK_RETRY_SCHEDULED') {
      assert.ok(adapter.alarmsMap.get(ALARM_NAMES.RETRY), 'ネットワーク/Timeout系エラー時はRETRYアラームが予約されること');
    } else {
      assert.equal(adapter.alarmsMap.get(ALARM_NAMES.RETRY), undefined);
    }
  }
});

test('ログボ取得時の API TimeoutError 発生で短期リトライアラームが予約されること', async () => {
  const timeoutErr = await createRealTimeoutError();
  const adapter = createBackgroundTestAdapter({
    config: { SIGN_GAME_DELAY_MS: 0 },
    settings: { optInAccepted: true, autoSignEnabled: true, enabledGames: ['GENSHIN'] },
    gateway: {
      getUserGameRoles: async () => {
        throw timeoutErr;
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  const res = await runner.handleAlarm({ name: ALARM_NAMES.DAILY_SIGN });
  assert.equal(res.success, false);
  assert.equal(res.reason, 'NETWORK_RETRY_SCHEDULED');
  assert.ok(adapter.alarmsMap.get(ALARM_NAMES.SIGN_RETRY), 'TimeoutError 時に SIGN_RETRY アラームが予約されること');
});

test('非JSON応答(-9999): 1ゲーム目で発生しても全体停止せず後続ゲームを完了すること', async () => {
  const redeemAdapter = createBackgroundTestAdapter({
    config: { INTER_REQUEST_DELAY_MS: 0, INTER_REQUEST_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN', 'STAR_RAIL', 'ZZZ'] },
    gateway: {
      fetchValidCodes: async (gameKey) => [gameKey === 'STAR_RAIL' ? 'HSRCODE1' : 'ZZZCODE1'],
      getUserGameRoles: async (gameBiz) => {
        if (gameBiz === 'hk4e_global') {
          return {
            success: false,
            status: API_STATUS.NON_JSON,
            retcode: -9999,
            httpStatus: 200,
            rawSnippet: '<html>WAF',
            apiMessage: '',
            role: null
          };
        }
        return createSampleRole(gameBiz);
      },
      redeemCode: async ({ cdkey }) => ({ retcode: 0, message: 'OK', cdkey })
    }
  });
  const redeemRunner = createBackgroundRunner(redeemAdapter);
  const flowRes = await redeemRunner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(flowRes.success, true);
  assert.equal(flowRes.redeemedCount, 2);
  assert.equal(flowRes.results.GENSHIN.success, false);
  assert.equal(flowRes.results.GENSHIN.status, API_STATUS.NON_JSON);
  assert.equal(flowRes.results.GENSHIN.retcode, -9999);
  assert.ok(redeemAdapter.logs.some(l => l.message.includes('HTTP 200 - 非JSON応答 (<html>WAF)')));
  assert.equal(flowRes.results.STAR_RAIL.redeemedCount, 1);
  assert.equal(flowRes.results.ZZZ.redeemedCount, 1);

  const signAdapter = createBackgroundTestAdapter({
    config: { SIGN_GAME_DELAY_MS: 0, SIGN_GAME_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoSignEnabled: true, enabledGames: ['GENSHIN', 'STAR_RAIL', 'ZZZ'] },
    gateway: {
      getUserGameRoles: async (gameBiz) => {
        if (gameBiz === 'hk4e_global') {
          return {
            success: false,
            status: API_STATUS.NON_JSON,
            retcode: -9999,
            httpStatus: 200,
            rawSnippet: '<html>WAF',
            apiMessage: '',
            role: null
          };
        }
        return createSampleRole(gameBiz);
      },
      getDailySignInfo: async () => ({ success: true, retcode: 0, isSigned: false, totalSignDay: 4, today: '2026-11-23' }),
      claimDailyBonus: async () => ({ success: true, retcode: 0, alreadySigned: false })
    }
  });
  const signRunner = createBackgroundRunner(signAdapter);
  const signRes = await signRunner.handleAlarm({ name: ALARM_NAMES.DAILY_SIGN });
  assert.equal(signRes.success, true);
  assert.equal(signRes.signedCount, 2);
  assert.equal(signRes.results.GENSHIN.success, false);
  assert.equal(signRes.results.GENSHIN.retcode, -9999);
  assert.equal(signRes.results.STAR_RAIL.signed, true);
  assert.equal(signRes.results.ZZZ.signed, true);
});

test('i18n (lang=en): 未知/無効ゲームキー・ロール取得失敗・受取失敗が英語で出力され通知/GAも連携すること', async () => {
  const adapter = createBackgroundTestAdapter({
    settings: {
      optInAccepted: true,
      autoRedeemEnabled: true,
      autoSignEnabled: true,
      enabledGames: ['GENSHIN'],
      language: 'en'
    }
  });
  const runner = createBackgroundRunner(adapter);

  const flowUnknown = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'UNKNOWN_GAME' });
  assert.equal(flowUnknown.success, false);
  assert.equal(flowUnknown.reason, 'Unknown game key: UNKNOWN_GAME');

  const flowDisabled = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'ZZZ' });
  assert.equal(flowDisabled.success, false);
  assert.equal(flowDisabled.reason, 'Game is hidden or disabled: ZZZ');

  // ロール取得失敗 (-100)
  adapter.setGateway({
    fetchValidCodes: async () => ['ENABLEDTEST1'],
    getUserGameRoles: async () => ({ success: false, retcode: -100, message: 'Not logged in', role: null })
  });
  const redeemRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  const redeemFail = redeemRes.results.GENSHIN;
  assert.equal(redeemFail.success, false);
  assert.equal(redeemFail.reason, 'Genshin Impact: Failed to fetch character info (Not logged in [retcode: -100])');
  assert.equal(adapter.createdNotifications[0].opts.title, 'Login Required');
  assert.equal(adapter.gaEvents[0].params.error_reason, 'not_logged_in');

  const signRoleRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  const signRoleFail = signRoleRes.results.GENSHIN;
  assert.equal(signRoleFail.success, false);
  assert.equal(signRoleFail.reason, 'Genshin Impact: [Check-in] Failed to fetch character info (Not logged in [retcode: -100])');

  // 受取失敗 (claimDailyBonus が -500) -> 通知不要、error_reason=api_error
  adapter.clearManualCooldowns();
  adapter.createdNotifications.length = 0;
  adapter.setGateway({
    getUserGameRoles: async () => createSampleRole('hk4e_global'),
    getDailySignInfo: async () => ({ success: true, retcode: 0, isSigned: false, totalSignDay: 2 }),
    claimDailyBonus: async () => ({ success: false, retcode: -500, message: 'Temporary error' })
  });
  const signClaimRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_SIGN', gameKey: 'GENSHIN' });
  const signClaimFail = signClaimRes.results.GENSHIN;
  assert.equal(signClaimFail.success, false);
  assert.equal(signClaimFail.reason, 'Genshin Impact: [Check-in] Failed to claim reward (Temporary error [retcode: -500])');
  assert.equal(adapter.createdNotifications.length, 0, '-500では未ログイン通知を作成しない');
  assert.equal(adapter.gaEvents[adapter.gaEvents.length - 1].params.error_reason, 'api_error');

  assert.ok(adapter.logs.some(l => l.message === redeemFail.reason));
  assert.ok(adapter.logs.some(l => l.message === signRoleFail.reason));
  assert.ok(adapter.logs.some(l => l.message === signClaimFail.reason));
});

test('未使用コード0件（空または全件確定済み）時は非公開APIを一切呼ばないこと', async () => {
  let hoyoApiCalls = 0;
  let codeListCalls = 0;
  let mockCodes = [];

  const adapter = createBackgroundTestAdapter({
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN'], language: 'ja' },
    gateway: {
      fetchValidCodes: async () => {
        codeListCalls++;
        return mockCodes;
      },
      getUserGameRoles: async () => {
        hoyoApiCalls++;
        return createSampleRole('hk4e_global');
      },
      redeemCode: async ({ cdkey }) => {
        hoyoApiCalls++;
        return { retcode: 0, message: 'OK', cdkey };
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  const autoEmpty = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(autoEmpty.success, true);
  assert.equal(autoEmpty.redeemedCount, 0);
  assert.equal(autoEmpty.results.GENSHIN.skipped, true);
  assert.equal(autoEmpty.results.GENSHIN.reason, 'NO_PENDING_CODES');
  assert.equal(codeListCalls, 1);
  assert.equal(hoyoApiCalls, 0);

  const manualEmpty = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(manualEmpty.success, true);
  assert.equal(manualEmpty.results.GENSHIN.reason, 'NO_PENDING_CODES');
  assert.equal(codeListCalls, 2);
  assert.equal(hoyoApiCalls, 0);

  adapter.clearManualCooldowns();
  adapter.setRedeemedCode('hk4e_global', 'DONE1', { s: STATUS_MAP.SUCCESS, r: 0, t: 1000 });
  adapter.setRedeemedCode('hk4e_global', 'EXPIRED1', { s: STATUS_MAP.EXPIRED, r: 0, t: 1000 });
  mockCodes = ['DONE1', 'EXPIRED1'];

  const manualAllClaimed = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(manualAllClaimed.results.GENSHIN.reason, 'NO_PENDING_CODES');
  assert.equal(codeListCalls, 3);
  assert.equal(hoyoApiCalls, 0);
  assert.equal(adapter.createdNotifications.length, 0);
});

test('ロール取得成功後に交換APIが未ログイン(-100/-1071)を返した場合、ERRORログ・通知・失敗返却されGA二重送信しないこと', async () => {
  const adapter = createBackgroundTestAdapter({
    config: { INTER_REQUEST_DELAY_MS: 0, INTER_REQUEST_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN', 'STAR_RAIL'], language: 'ja' },
    gateway: {
      fetchValidCodes: async () => ['NEEDLOGIN1'],
      getUserGameRoles: async () => createSampleRole('hk4e_global'),
      redeemCode: async ({ cdkey }) => ({ retcode: -1071, message: 'Login expired', cdkey })
    }
  });
  const runner = createBackgroundRunner(adapter);

  const manualRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(manualRes.success, true);
  assert.equal(manualRes.results.GENSHIN.success, false);
  assert.equal(manualRes.results.GENSHIN.retcode, -1071);

  const formatted = formatRedeemResult(manualRes, 'ja');
  assert.equal(formatted.title, 'コード交換失敗');
  assert.match(formatted.message, /【原神】未ログインです。公式コード交換サイトでログインを行ってください/);

  assert.equal(adapter.logs.some(l => l.message.includes('引き換え完了 (新規成功: 0件)')), false);
  assert.ok(adapter.logs.some(l => l.type === 'ERROR' && l.message === '原神: コード引き換え失敗 (Login expired [retcode: -1071])'));
  assert.equal(adapter.createdNotifications.length, 1);
  assert.equal(adapter.createdNotifications[0].id, `${LOGIN_NOTIFICATION_PREFIX}GENSHIN`);

  const redeemEvents = adapter.gaEvents.filter(e => e.eventName === 'code_redeem_result');
  assert.equal(redeemEvents.length, 1, 'GA4イベントが二重送信されず1回のみ送信されること');
  assert.equal(redeemEvents[0].params.status, 'failed');
  assert.equal(redeemEvents[0].params.error_reason, 'not_logged_in');
  assert.equal(adapter.getRedeemedCodes('hk4e_global').NEEDLOGIN1, undefined);

  // 自動巡回(en): 原神が -100 でも後続スタレまで継続実行されること
  adapter.clearLogs();
  adapter.createdNotifications.length = 0;
  adapter.setSettings({ language: 'en' });
  adapter.setGateway({
    fetchValidCodes: async (gameKey) => [gameKey === 'STAR_RAIL' ? 'HSRCODE1' : 'GENCODE1'],
    getUserGameRoles: async (biz) => createSampleRole(biz),
    redeemCode: async ({ gameBiz, cdkey }) => {
      if (gameBiz === 'hk4e_global') return { retcode: -100, message: 'Not logged in', cdkey };
      return { retcode: 0, message: 'OK', cdkey };
    }
  });

  const alarmRes = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(alarmRes.success, true);
  assert.equal(alarmRes.redeemedCount, 1);
  assert.equal(alarmRes.results.GENSHIN.success, false);
  assert.equal(alarmRes.results.GENSHIN.retcode, -100);
  assert.equal(alarmRes.results.STAR_RAIL.success, true);
  assert.equal(alarmRes.results.STAR_RAIL.redeemedCount, 1);
  assert.ok(
    adapter.logs.some(l => l.type === 'ERROR' && l.message === 'Genshin Impact: Failed to redeem code (Not logged in [retcode: -100])')
  );
});

test('同種類コード既使用(-2018)時は1回目でEXPIRED確定し実績加算・再試行されないこと', async () => {
  let redeemApiCalls = 0;
  const adapter = createBackgroundTestAdapter({
    config: { INTER_REQUEST_DELAY_MS: 0, INTER_REQUEST_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN'], language: 'ja' },
    gateway: {
      fetchValidCodes: async () => ['OKCODE1', 'SAMEGROUP1'],
      getUserGameRoles: async () => createSampleRole('hk4e_global'),
      redeemCode: async ({ cdkey }) => {
        redeemApiCalls++;
        if (cdkey === 'SAMEGROUP1') {
          return { retcode: -2018, message: 'Redemption code of the same type already used', cdkey };
        }
        return { retcode: 0, message: 'OK', cdkey };
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  const res1 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(res1.success, true);
  assert.equal(res1.redeemedCount, 1);
  assert.equal(redeemApiCalls, 2);

  const redeemed = adapter.getRedeemedCodes('hk4e_global');
  assert.equal(redeemed.OKCODE1.s, STATUS_MAP.SUCCESS);
  assert.equal(redeemed.SAMEGROUP1.s, STATUS_MAP.EXPIRED);

  const stats = await adapter.getCodeRedeemStats('hk4e_global');
  assert.equal(stats.monthlyCount, 1);
  assert.equal(stats.totalCount, 1);
  assert.equal(stats.activeTotal, 1);
  assert.equal(stats.activeClaimed, 1);

  redeemApiCalls = 0;
  adapter.clearManualCooldowns();
  const res2 = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(res2.results.GENSHIN.skipped, true);
  assert.equal(res2.results.GENSHIN.reason, 'NO_PENDING_CODES');
  assert.equal(redeemApiCalls, 0);
});

test('排他ロック競合: 実行中の並列実行は ALREADY_RUNNING を返し API を呼ばないこと', async () => {
  let releaseGate;
  let roleCalls = 0;
  const adapter = createBackgroundTestAdapter({
    settings: { optInAccepted: true, enabledGames: ['GENSHIN'] },
    gateway: {
      fetchValidCodes: async () => ['C1'],
      getUserGameRoles: async () => {
        roleCalls++;
        await new Promise(resolve => {
          releaseGate = resolve;
        });
        return createSampleRole('hk4e_global');
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  const firstPromise = invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  await new Promise(resolve => setTimeout(resolve, 0));

  const secondRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'STAR_RAIL' });
  assert.equal(secondRes.success, false);
  assert.equal(secondRes.reason, 'ALREADY_RUNNING');
  assert.equal(roleCalls, 1);

  releaseGate();
  await firstPromise;
});

test('1日20件の新規コード受付上限超過時とストレージ警告・書込失敗通知', async () => {
  const adapter = createBackgroundTestAdapter({
    config: { INTER_REQUEST_DELAY_MS: 0, INTER_REQUEST_JITTER_MAX_MS: 0, DAILY_NEW_CODE_LIMIT: 1 },
    settings: { optInAccepted: true, autoRedeemEnabled: true, enabledGames: ['GENSHIN'], language: 'ja' },
    gateway: {
      fetchValidCodes: async () => ['CODE_A', 'CODE_B'],
      getUserGameRoles: async () => createSampleRole('hk4e_global'),
      redeemCode: async ({ cdkey }) => ({ retcode: 0, message: 'OK', cdkey })
    }
  });
  adapter.setStorageWarning(true);
  const runner = createBackgroundRunner(adapter);

  const res = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(res.success, true);
  assert.equal(res.redeemedCount, 1, '1件のみ受け付け2件目で打ち切り');
  assert.ok(adapter.createdNotifications.some(n => n.id === null && n.opts.title === '容量警告'));
  assert.ok(adapter.logs.some(l => l.type === 'WARN' && l.message.includes('上限')));

  // 翌日へ進めて日次受付上限をリセットし、STORAGE_WRITE_FAILURE 発生時にエラー通知が発行されることを確認
  adapter.clock.advanceTime(25 * 60 * 60 * 1000);
  adapter.createdNotifications.length = 0;
  adapter.setMarkCodeStatusError(new Error('STORAGE_WRITE_FAILURE: quota exceeded'));
  adapter.clearManualCooldowns();
  const errRes = await invokeMessage(runner, { type: 'TRIGGER_MANUAL_REDEEM', gameKey: 'GENSHIN' });
  assert.equal(errRes.success, false);
  assert.equal(errRes.reason, 'EXCEPTION');
  assert.ok(adapter.createdNotifications.some(n => n.id === null && n.opts.title === '拡張機能エラー'));
});

test('オフライン時のガード: handleAlarm およびキャッチアップは API を叩かずリトライを予約すること', async () => {
  let apiCalls = 0;
  const adapter = createBackgroundTestAdapter({
    online: false,
    settings: { optInAccepted: true, autoRedeemEnabled: true, autoSignEnabled: true, enabledGames: ['GENSHIN'] },
    gateway: {
      fetchValidCodes: async () => {
        apiCalls++;
        return [];
      },
      getUserGameRoles: async () => {
        apiCalls++;
        return createSampleRole('hk4e_global');
      }
    }
  });
  const runner = createBackgroundRunner(adapter);

  const alarmRedeem = await runner.handleAlarm({ name: ALARM_NAMES.AUTO_REDEEM });
  assert.equal(alarmRedeem.reason, 'OFFLINE');
  assert.ok(adapter.alarmsMap.get(ALARM_NAMES.RETRY));

  const alarmSign = await runner.handleAlarm({ name: ALARM_NAMES.DAILY_SIGN });
  assert.equal(alarmSign.reason, 'OFFLINE');
  assert.ok(adapter.alarmsMap.get(ALARM_NAMES.SIGN_RETRY));

  adapter.alarmsMap.clear();
  const startupRes = await runner.handleStartup();
  assert.deepEqual(startupRes, { signResult: false, redeemResult: false });
  assert.ok(adapter.alarmsMap.get(ALARM_NAMES.RETRY));
  assert.ok(adapter.alarmsMap.get(ALARM_NAMES.SIGN_RETRY));
  assert.equal(apiCalls, 0);
});

test('bindChromeListeners: MV3リスナー配線・sender.id検証・非同期sendResponseと例外安全処理', async () => {
  const listeners = {};
  const mockChromeApi = {
    notifications: { onClicked: { addListener: (fn) => { listeners.notifClicked = fn; } } },
    runtime: {
      onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
      onStartup: { addListener: (fn) => { listeners.startup = fn; } },
      onMessage: { addListener: (fn) => { listeners.message = fn; } }
    },
    idle: { onStateChanged: { addListener: (fn) => { listeners.idle = fn; } } },
    alarms: { onAlarm: { addListener: (fn) => { listeners.alarm = fn; } } }
  };

  const adapter = createBackgroundTestAdapter({
    config: { CATCH_UP_DELAY_MS: 0, CATCH_UP_JITTER_MAX_MS: 0 },
    settings: { optInAccepted: true, autoSignEnabled: true, autoRedeemEnabled: true }
  });
  const runner = createBackgroundRunner(adapter);
  bindChromeListeners(runner, mockChromeApi);

  assert.equal(typeof listeners.notifClicked, 'function');
  assert.equal(typeof listeners.installed, 'function');
  assert.equal(typeof listeners.startup, 'function');
  assert.equal(typeof listeners.idle, 'function');
  assert.equal(typeof listeners.alarm, 'function');
  assert.equal(typeof listeners.message, 'function');

  // sender.id 不一致は処理されない (undefined 返却)
  const foreignRes = listeners.message({ type: 'TRIGGER_INITIAL_CATCH_UP' }, { id: 'other-ext' }, () => {});
  assert.equal(foreignRes, undefined);

  // 未知のメッセージ種別は処理されない
  const unknownRes = listeners.message({ type: 'UNKNOWN_TYPE' }, DEFAULT_SENDER, () => {});
  assert.equal(unknownRes, undefined);

  // TRIGGER_INITIAL_CATCH_UP は true を返し非同期で sendResponse を呼ぶ
  const catchUpResponse = await new Promise((resolve) => {
    const keepChannel = listeners.message({ type: 'TRIGGER_INITIAL_CATCH_UP' }, DEFAULT_SENDER, resolve);
    assert.equal(keepChannel, true);
  });
  assert.equal(catchUpResponse.signResult.success, true);
  assert.equal(catchUpResponse.redeemResult.success, true);

  // TRACK_GA_EVENT が gateway へ転送される
  const gaRes = await new Promise((resolve) => {
    const keepChannel = listeners.message(
      { type: 'TRACK_GA_EVENT', eventName: 'ui_action', params: { action_type: 'open_log', game: 'none' } },
      DEFAULT_SENDER,
      resolve
    );
    assert.equal(keepChannel, true);
  });
  assert.equal(gaRes.success, true);
  assert.equal(adapter.gaEvents.some(e => e.eventName === 'ui_action'), true);

  // ハンドラが例外を投げても { success: false, error } を返すこと
  const throwingRunner = {
    notifications: {},
    handleNotificationClick: async () => {},
    handleInstalled: async () => {},
    handleStartup: async () => {},
    handleIdleStateChanged: async () => {},
    handleAlarm: async () => {},
    handleMessage: () => ({ handled: true, promise: Promise.reject(new Error('boom')) })
  };
  let errListener;
  bindChromeListeners(throwingRunner, {
    ...mockChromeApi,
    runtime: { ...mockChromeApi.runtime, onMessage: { addListener: (fn) => { errListener = fn; } } }
  });
  const errResponse = await new Promise((resolve) => {
    const keepChannel = errListener({ type: 'TRIGGER_MANUAL_REDEEM' }, DEFAULT_SENDER, resolve);
    assert.equal(keepChannel, true);
  });
  assert.deepEqual(errResponse, { success: false, error: 'boom' });
});

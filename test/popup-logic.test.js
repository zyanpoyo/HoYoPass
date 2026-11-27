import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALARM_NAMES,
  MESSAGE_TYPES,
  PRIVACY_POLICY_VERSION,
  REVIEW_PROMPT_CONFIG,
  STATUS_MAP
} from '../src/config/constants.js';
import { GAMES } from '../src/config/games.js';
import { API_STATUS } from '../src/services/api-gateway.js';
import { getHoyoTodayDateString } from '../src/services/state-store.js';
import { createBackgroundRunner } from '../src/background/background-runner.js';
import { createBackgroundTestAdapter } from './helpers/background-test-adapter.js';
import {
  createPopupController,
  isLogForGame,
  buildLatestLogSummary,
  stripGamePrefix,
  resolvePopupAuthState,
  resolveManualRedeemFormatOptions
} from '../src/popup/popup-controller.js';
import { setupCheckboxMinimumValidation } from '../src/popup/popup-dom-adapter.js';
import { createPopupTestAdapter } from './helpers/popup-test-adapter.js';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('isLogForGame: gameKey プロパティ優先判定とレガシー文字列フォールバック', () => {
  assert.equal(isLogForGame(null, 'GENSHIN'), false);

  // 構造化 gameKey 指定あり
  assert.equal(isLogForGame({ gameKey: 'GENSHIN', message: '任意メッセージ' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ gameKey: 'STAR_RAIL', message: '原神という文字があっても別キー' }, 'GENSHIN'), false);

  // gameKey なし・ゲーム名含有時
  assert.equal(isLogForGame({ message: '原神: 引き換え完了' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ message: 'Genshin Impact: Finished redeeming' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ message: '崩壊：スターレイル: 引き換え完了' }, 'GENSHIN'), false);

  // どのゲーム名も含まない共通システムログ（全タブに表示）
  assert.equal(isLogForGame({ message: '一時的な通信不通を検知したため、2分後に自動再試行します' }, 'GENSHIN'), true);
  assert.equal(isLogForGame({ message: '一時的な通信不通を検知したため、2分後に自動再試行します' }, 'ZZZ'), true);
});

test('buildLatestLogSummary: 最新ログの種別と日英サマリー生成', () => {
  const emptyJa = buildLatestLogSummary(null, 'ja');
  assert.equal(emptyJa.text, '直近のログ: 履歴なし');
  assert.equal(emptyJa.isError, false);

  const emptyEn = buildLatestLogSummary(undefined, 'en');
  assert.equal(emptyEn.text, 'Latest: No logs');
  assert.equal(emptyEn.isError, false);

  const ts = new Date(2026, 9, 25, 14, 5, 0).getTime();

  const errSummary = buildLatestLogSummary({ type: 'ERROR', timestamp: ts }, 'ja');
  assert.equal(errSummary.text, '直近のログ: エラー (10/25 14:05)');
  assert.equal(errSummary.isError, true);

  const warnSummary = buildLatestLogSummary({ type: 'WARN', timestamp: ts }, 'en');
  assert.equal(warnSummary.text, 'Latest: Warning (10/25 14:05)');
  assert.equal(warnSummary.isError, false);

  const okSummary = buildLatestLogSummary({ type: 'INFO', timestamp: ts }, 'ja');
  assert.equal(okSummary.text, '直近のログ: 正常完了 (10/25 14:05)');
  assert.equal(okSummary.isError, false);
});

test('stripGamePrefix: 日本語・英語ゲーム名プレフィックスの除去', () => {
  assert.equal(
    stripGamePrefix('原神: 引き換え完了 (新規成功: 2件)', 'GENSHIN'),
    '引き換え完了 (新規成功: 2件)'
  );
  assert.equal(
    stripGamePrefix('Genshin Impact: Finished redeeming (2 new succeeded)', 'GENSHIN'),
    'Finished redeeming (2 new succeeded)'
  );
  assert.equal(
    stripGamePrefix('共通システムメッセージ', 'GENSHIN'),
    '共通システムメッセージ'
  );
});

test('setupCheckboxMinimumValidation: 最後の1つのチェックボックスが disabled になること', () => {
  const createMockCb = (checked) => {
    const listeners = [];
    return {
      checked,
      disabled: false,
      addEventListener: (ev, fn) => {
        if (ev === 'change') listeners.push(fn);
      },
      triggerChange: () => listeners.forEach(fn => fn())
    };
  };

  const cb1 = createMockCb(true);
  const cb2 = createMockCb(true);
  const cb3 = createMockCb(false);

  setupCheckboxMinimumValidation([cb1, cb2, cb3]);

  assert.equal(cb1.disabled, false);
  assert.equal(cb2.disabled, false);
  assert.equal(cb3.disabled, false);

  cb2.checked = false;
  cb2.triggerChange();
  assert.equal(cb1.disabled, true);
  assert.equal(cb2.disabled, false);

  cb3.checked = true;
  cb3.triggerChange();
  assert.equal(cb1.disabled, false);
  assert.equal(cb3.disabled, false);
});

test('resolvePopupAuthState: hoyoverse/hoyolab ログイン状態と自動引き換えON/OFFに応じた表示判定', () => {
  const sampleRole = { game_uid: '800123456', nickname: '蛍' };

  assert.deepEqual(
    resolvePopupAuthState({ roleRes: null, signInfo: null, autoRedeemEnabled: true }),
    { headerStatus: 'checking', needsSignLogin: false, needsRedeemLogin: false }
  );

  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { success: true, role: sampleRole, hoyoverseNotLoggedIn: false },
      signInfo: { success: true },
      autoRedeemEnabled: true
    }),
    { headerStatus: 'online', needsSignLogin: false, needsRedeemLogin: false }
  );

  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { success: true, role: sampleRole, hoyoverseNotLoggedIn: true },
      signInfo: { success: true },
      autoRedeemEnabled: true
    }),
    { headerStatus: 'logged_out', needsSignLogin: false, needsRedeemLogin: true }
  );

  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { success: true, role: sampleRole, hoyoverseNotLoggedIn: true },
      signInfo: { success: true },
      autoRedeemEnabled: false
    }),
    { headerStatus: 'online', needsSignLogin: false, needsRedeemLogin: false }
  );

  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { success: false, retcode: -100, hoyoverseNotLoggedIn: true },
      signInfo: { success: false, retcode: -1071 },
      autoRedeemEnabled: true
    }),
    { headerStatus: 'logged_out', needsSignLogin: true, needsRedeemLogin: true }
  );

  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { success: false, retcode: -100, hoyoverseNotLoggedIn: true },
      signInfo: { success: false, retcode: -1071 },
      autoRedeemEnabled: false
    }),
    { headerStatus: 'logged_out', needsSignLogin: true, needsRedeemLogin: false }
  );

  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { success: false, retcode: -1 },
      signInfo: null,
      autoRedeemEnabled: true
    }),
    { headerStatus: 'no_char', needsSignLogin: false, needsRedeemLogin: false }
  );
  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { success: false, retcode: -9999 },
      signInfo: null,
      autoRedeemEnabled: true
    }),
    { headerStatus: 'api_error', needsSignLogin: false, needsRedeemLogin: false }
  );
  assert.deepEqual(
    resolvePopupAuthState({
      roleRes: { networkError: true },
      signInfo: null,
      autoRedeemEnabled: true
    }),
    { headerStatus: 'offline', needsSignLogin: false, needsRedeemLogin: false }
  );
});

test('resolveManualRedeemFormatOptions: 手動引き換え結果モーダルの未ログイン補足判定', () => {
  const sampleRole = { game_uid: '800123456', nickname: '蛍' };

  assert.deepEqual(resolveManualRedeemFormatOptions({ roleRes: null }), {});
  assert.deepEqual(resolveManualRedeemFormatOptions({ roleRes: { networkError: true } }), {});
  assert.deepEqual(resolveManualRedeemFormatOptions({ roleRes: { success: false, retcode: -1 } }), {});
  assert.deepEqual(
    resolveManualRedeemFormatOptions({
      roleRes: { success: true, role: sampleRole, hoyoverseNotLoggedIn: false },
      autoRedeemEnabled: true
    }),
    {}
  );

  assert.deepEqual(
    resolveManualRedeemFormatOptions({
      roleRes: { success: true, role: sampleRole, hoyoverseNotLoggedIn: true },
      signInfo: { success: true },
      autoRedeemEnabled: true
    }),
    { redeemNotLoggedIn: true, needsRedeemLogin: true }
  );

  assert.deepEqual(
    resolveManualRedeemFormatOptions({
      roleRes: { success: true, role: sampleRole, hoyoverseNotLoggedIn: true },
      signInfo: { success: true },
      autoRedeemEnabled: false
    }),
    { redeemNotLoggedIn: true, needsRedeemLogin: false }
  );

  assert.deepEqual(
    resolveManualRedeemFormatOptions({
      roleRes: { success: false, retcode: -100 },
      autoRedeemEnabled: true
    }),
    { redeemNotLoggedIn: true, needsRedeemLogin: true }
  );
});

test('PopupController: 初期ロードで単一取得のみ実行され、自己書込エコーによる再取得ループが起きないこと', async () => {
  const adapter = createPopupTestAdapter({
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      autoSignEnabled: true,
      autoRedeemEnabled: true
    },
    gateway: {
      getUserGameRoles: async () => ({
        success: true,
        status: API_STATUS.OK,
        retcode: 0,
        role: { game_uid: '800123456', nickname: '蛍' },
        hoyoverseNotLoggedIn: false
      }),
      getDailySignInfo: async () => ({
        success: true,
        status: API_STATUS.OK,
        retcode: 0,
        isSigned: true,
        totalSignDay: 12,
        today: getHoyoTodayDateString(Date.parse('2026-10-17T03:00:00Z'))
      }),
      fetchValidCodes: async () => ['CODE001', 'CODE002']
    }
  });
  adapter.seedRedeemedCodes(GAMES.GENSHIN.gameBiz, {
    CODE001: { s: STATUS_MAP.SUCCESS, t: Math.floor(Date.parse('2026-10-17T03:00:00Z') / 1000) }
  });

  const controller = createPopupController(adapter);
  const snap = await controller.init();
  await controller.whenIdle();

  const finalSnap = controller.getSnapshot();
  assert.equal(adapter.gatewayCalls.getUserGameRoles.length, 1);
  assert.equal(adapter.gatewayCalls.getDailySignInfo.length, 1);
  assert.equal(adapter.gatewayCalls.fetchValidCodes.length, 1);
  assert.equal(snap.auth.headerStatus, 'online');
  assert.equal(finalSnap.auth.uid, '800123456');
  assert.equal(finalSnap.signStatus.pillClass, 'status-pill signed');
  assert.equal(finalSnap.redeemStatus.labelText, '有効コード 1/2 適用済');
  assert.equal(finalSnap.redeemStatus.badgeText, '今月 1件 / 通算 1件');

  controller.dispose();
});

test('PopupController: モーダル優先順位と閉鎖後のレビュー促進バナー再評価', async () => {
  // 1. 初回未オプトイン -> optin モーダル表示中はレビューバナー抑止 -> acceptOptIn 後に表示
  const adapter1 = createPopupTestAdapter();
  adapter1.seedReviewPrompt({
    successCount: REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT,
    status: 'pending'
  });

  const c1 = createPopupController(adapter1);
  const s1 = await c1.init();
  assert.equal(s1.blockingModal, 'optin');
  assert.equal(s1.reviewBannerVisible, false);

  await c1.acceptOptIn({ selectedGames: ['STAR_RAIL'], analyticsEnabled: false });
  await c1.whenIdle();

  const afterOptIn = c1.getSnapshot();
  assert.equal(afterOptIn.blockingModal, null);
  assert.equal(afterOptIn.activeGameKey, 'STAR_RAIL');
  assert.deepEqual(afterOptIn.enabledGames, ['STAR_RAIL']);
  assert.equal(afterOptIn.autoSignEnabled, true);
  assert.equal(afterOptIn.autoRedeemEnabled, true);
  assert.equal(afterOptIn.reviewBannerVisible, true);
  assert.ok(adapter1.syncConsentBadgeCalls >= 2);
  assert.ok(adapter1.sentMessages.some(m => m.type === MESSAGE_TYPES.TRIGGER_INITIAL_CATCH_UP));
  assert.ok(adapter1.sentMessages.some(m => m.type === MESSAGE_TYPES.TRACK_GA_EVENT && m.eventName === 'onboarding_complete'));
  c1.dispose();

  // 2. analytics_consent 未回答かつ旧ポリシー版 -> 拒否後に policy_update -> 同意後にレビューバナー表示
  const adapter2 = createPopupTestAdapter({
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: false,
      agreedPolicyVersion: '2025-01-01'
    }
  });
  adapter2.seedReviewPrompt({
    successCount: REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT,
    status: 'pending'
  });

  const c2 = createPopupController(adapter2);
  await c2.init();
  assert.equal(c2.getSnapshot().blockingModal, 'analytics_consent');
  assert.equal(c2.getSnapshot().reviewBannerVisible, false);

  await c2.decideAnalyticsConsent(false);
  assert.equal(c2.getSnapshot().blockingModal, 'policy_update');
  assert.equal(c2.getSnapshot().reviewBannerVisible, false);

  await c2.acceptPolicyUpdate();
  assert.equal(c2.getSnapshot().blockingModal, null);
  assert.equal(c2.getSnapshot().reviewBannerVisible, true);
  c2.dispose();
});

test('PopupController: 未ログイン判定(-100/-1071)統一と autoRedeemEnabled 切替連動', async () => {
  const adapter = createPopupTestAdapter({
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      autoSignEnabled: true,
      autoRedeemEnabled: true
    },
    gateway: {
      getUserGameRoles: async () => ({
        success: true,
        status: API_STATUS.OK,
        retcode: 0,
        role: { game_uid: '800123456', nickname: '蛍' },
        hoyoverseNotLoggedIn: true
      }),
      getDailySignInfo: async () => ({
        success: false,
        status: API_STATUS.API_ERROR,
        retcode: -1071
      })
    }
  });

  const controller = createPopupController(adapter);
  const snap = await controller.init();
  assert.equal(snap.auth.headerStatus, 'logged_out');
  assert.equal(snap.auth.needsSignLogin, true);
  assert.equal(snap.auth.needsRedeemLogin, true);
  assert.equal(snap.auth.signLinkText, '要ログイン ↗');
  assert.equal(snap.auth.redeemLinkText, '要ログイン ↗');
  assert.equal(snap.signStatus.text, '未ログイン');

  await controller.setAutoRedeemEnabled(false);
  const afterOff = controller.getSnapshot();
  assert.equal(afterOff.auth.needsSignLogin, true);
  assert.equal(afterOff.auth.needsRedeemLogin, false);
  assert.equal(afterOff.auth.redeemLinkText, '公式 ↗');

  controller.dispose();
});

test('PopupController: タブ高速往復(A->B->A)時の遅延レスポンス上書きを防ぐこと', async () => {
  const firstGenshinStarted = createDeferred();
  const firstGenshinRole = createDeferred();
  const secondGenshinRole = createDeferred();
  let genshinCount = 0;

  const adapter = createPopupTestAdapter({
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      activeGameKey: 'GENSHIN'
    },
    gateway: {
      getUserGameRoles: async (gameBiz) => {
        if (gameBiz === GAMES.GENSHIN.gameBiz) {
          genshinCount++;
          if (genshinCount === 1) {
            firstGenshinStarted.resolve();
            return firstGenshinRole.promise;
          }
          return secondGenshinRole.promise;
        }
        return {
          success: true,
          status: API_STATUS.OK,
          retcode: 0,
          role: { game_uid: '700000001', nickname: '星' },
          hoyoverseNotLoggedIn: false
        };
      }
    }
  });

  const controller = createPopupController(adapter);
  const initPromise = controller.init();
  await firstGenshinStarted.promise;

  // GENSHIN(1回目) が未完了のまま STAR_RAIL -> GENSHIN(2回目) へ切替
  await controller.selectGame('STAR_RAIL');
  const backToGenshin = controller.selectGame('GENSHIN');

  // 2回目の GENSHIN が先に完了（正常UID）
  secondGenshinRole.resolve({
    success: true,
    status: API_STATUS.OK,
    retcode: 0,
    role: { game_uid: '888888888', nickname: '最新蛍' },
    hoyoverseNotLoggedIn: false
  });
  await backToGenshin;

  // 1回目の古い GENSHIN 応答（未ログイン）が遅れて到着しても上書きされないこと
  firstGenshinRole.resolve({
    success: false,
    status: API_STATUS.NOT_LOGGED_IN,
    retcode: -100,
    role: null
  });
  await initPromise;
  await controller.whenIdle();

  assert.equal(genshinCount, 2);
  const snap = controller.getSnapshot();
  assert.equal(snap.activeGameKey, 'GENSHIN');
  assert.equal(snap.auth.headerStatus, 'online');
  assert.equal(snap.auth.uid, '888888888');
  assert.equal(snap.auth.badgeText, 'ログイン中: 最新蛍');

  controller.dispose();
});

test('PopupController: 設定モーダル保存で有効ゲーム退避・英語切替・GA送信が行われること', async () => {
  const adapter = createPopupTestAdapter({
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      activeGameKey: 'GENSHIN',
      enabledGames: ['GENSHIN', 'STAR_RAIL', 'ZZZ'],
      language: 'ja',
      analyticsEnabled: true
    },
    gateway: {
      getUserGameRoles: async () => ({
        success: true,
        status: API_STATUS.OK,
        retcode: 0,
        role: { game_uid: '900111222', nickname: 'Belle' },
        hoyoverseNotLoggedIn: false
      })
    }
  });

  const controller = createPopupController(adapter);
  await controller.init();
  await controller.openSettings();
  assert.equal(controller.getSnapshot().settingsModal.open, true);

  await controller.saveSettings({
    selectedGames: ['ZZZ'],
    language: 'en',
    analyticsEnabled: false
  });

  const snap = controller.getSnapshot();
  assert.equal(snap.settingsModal.open, false);
  assert.equal(snap.lang, 'en');
  assert.equal(snap.activeGameKey, 'ZZZ');
  assert.deepEqual(snap.enabledGames, ['ZZZ']);
  assert.equal(snap.game.name, 'Zenless Zone Zero');
  assert.equal(snap.auth.badgeText, 'Logged in: Belle');
  assert.ok(adapter.sentMessages.some(m => (
    m.type === MESSAGE_TYPES.TRACK_GA_EVENT &&
    m.eventName === 'ui_action' &&
    m.params?.action_type === 'change_settings'
  )));

  controller.dispose();
});

test('PopupController: 手動ログボ・手動コード交換のローディング/アラート/認証キャッシュ即時更新と例外処理', async () => {
  const redeemDeferred = createDeferred();
  const adapter = createPopupTestAdapter({
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      activeGameKey: 'GENSHIN',
      autoRedeemEnabled: true
    },
    gateway: {
      getUserGameRoles: async () => ({
        success: true,
        status: API_STATUS.OK,
        retcode: 0,
        role: { game_uid: '800123456', nickname: '蛍' },
        hoyoverseNotLoggedIn: false
      })
    }
  });

  const controller = createPopupController(adapter);
  await controller.init();

  // 手動コード交換（-1071 返却 -> 即時 hoyoverseNotLoggedIn = true 更新＆アラート表示）
  adapter.setMessageHandler(async (msg) => {
    if (msg.type === MESSAGE_TYPES.TRIGGER_MANUAL_REDEEM) {
      return redeemDeferred.promise;
    }
    return { success: true };
  });

  const manualRedeemPromise = controller.triggerManualRedeem();
  assert.equal(controller.getSnapshot().manualRedeemLoading, true);

  redeemDeferred.resolve({
    success: true,
    redeemedCount: 0,
    results: {
      GENSHIN: { success: false, status: API_STATUS.NOT_LOGGED_IN, retcode: -1071, reason: 'LOGIN_REQUIRED' }
    }
  });
  await manualRedeemPromise;

  const afterRedeemErr = controller.getSnapshot();
  assert.equal(afterRedeemErr.manualRedeemLoading, false);
  assert.ok(afterRedeemErr.alertModal);
  assert.equal(afterRedeemErr.auth.headerStatus, 'logged_out');
  assert.equal(afterRedeemErr.auth.needsRedeemLogin, true);

  controller.dismissAlert();
  assert.equal(controller.getSnapshot().alertModal, null);

  // 再実行で非スキップ成功 -> hoyoverseNotLoggedIn = false へ復帰
  adapter.setMessageHandler(async () => ({
    success: true,
    redeemedCount: 1,
    results: {
      GENSHIN: { success: true, skipped: false, redeemedCount: 1 }
    }
  }));
  await controller.triggerManualRedeem();
  assert.equal(controller.getSnapshot().auth.headerStatus, 'online');
  assert.equal(controller.getSnapshot().auth.needsRedeemLogin, false);

  // 手動ログボで例外発生時 -> フォールバックアラート＋ローディング解除
  adapter.setMessageHandler(async () => {
    throw new Error('Port disconnected');
  });
  await controller.triggerManualSign();
  const afterSignErr = controller.getSnapshot();
  assert.equal(afterSignErr.manualSignLoading, false);
  assert.equal(afterSignErr.alertModal.title, 'デイリーログインボーナス');
  assert.equal(afterSignErr.alertModal.message, 'Port disconnected');

  controller.dispose();
});

test('PopupController: アラームツールチップ（停止中・予定時刻あり・未登録）をタイムゾーン非依存で生成すること', async () => {
  const scheduledTime = Date.parse('2026-10-17T06:45:00Z');
  const expectedDate = new Date(scheduledTime);
  const expectedHHMM = `${String(expectedDate.getHours()).padStart(2, '0')}:${String(expectedDate.getMinutes()).padStart(2, '0')}`;

  const adapter = createPopupTestAdapter({
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      autoRedeemEnabled: false
    }
  });
  adapter.seedActiveCodes(GAMES.GENSHIN.gameBiz, []);

  const controller = createPopupController(adapter);
  await controller.init();
  assert.equal(controller.getSnapshot().redeemStatus.tooltip, '定期自動引き換え: 停止中');

  adapter.setAlarm(ALARM_NAMES.AUTO_REDEEM, { scheduledTime });
  await controller.setAutoRedeemEnabled(true);
  assert.equal(controller.getSnapshot().redeemStatus.tooltip, `次回自動実行予定: ${expectedHHMM}`);

  adapter.setAlarm(ALARM_NAMES.AUTO_REDEEM, null);
  await controller.setAutoRedeemEnabled(false);
  await controller.setAutoRedeemEnabled(true);
  assert.equal(controller.getSnapshot().redeemStatus.tooltip, '定期自動引き換え: 稼働中 (3時間毎)');

  controller.dispose();
});

test('PopupController: 外部ストレージ変更購読で自動更新され、dispose()後は更新されないこと', async () => {
  const nowMs = Date.parse('2026-10-17T03:00:00Z');
  const todayStr = getHoyoTodayDateString(nowMs);
  const adapter = createPopupTestAdapter({
    initialNowMs: nowMs,
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      activeGameKey: 'GENSHIN'
    },
    gateway: {
      getDailySignInfo: async () => ({
        success: true,
        status: API_STATUS.OK,
        retcode: 0,
        isSigned: false,
        totalSignDay: 4,
        today: todayStr
      })
    }
  });
  adapter.seedActiveCodes(GAMES.GENSHIN.gameBiz, ['CODE_A']);

  const controller = createPopupController(adapter);
  await controller.init();
  const signCallsBefore = adapter.gatewayCalls.getDailySignInfo.length;

  // 外部（Background 等）がログ・ログボ記録・引き換え記録を書き込む
  await adapter.addExecutionLog({
    type: 'INFO',
    category: 'REDEEM',
    gameKey: 'GENSHIN',
    message: '原神: 引き換え完了 (新規成功: 1件)'
  });
  await adapter.store.setDailySignRecord(GAMES.GENSHIN.gameBiz, {
    date: todayStr,
    isSigned: true,
    totalSignDay: 5,
    skippedNoChar: false
  });
  await adapter.markCodeStatus(GAMES.GENSHIN.gameBiz, 'CODE_A', 'SUCCESS');
  await controller.whenIdle();

  const updated = controller.getSnapshot();
  assert.equal(updated.logs.items.length, 1);
  assert.equal(updated.signStatus.pillClass, 'status-pill signed');
  assert.equal(updated.redeemStatus.labelText, '有効コード 1/1 適用済');
  // 外部 sign 変更時にリモート再照会ループが起きていないこと
  assert.equal(adapter.gatewayCalls.getDailySignInfo.length, signCallsBefore);

  controller.dispose();

  await adapter.addExecutionLog({
    type: 'ERROR',
    category: 'REDEEM',
    gameKey: 'GENSHIN',
    message: '原神: dispose後のログ'
  });
  await controller.whenIdle();
  assert.equal(controller.getSnapshot().logs.items.length, 1);
});

test('PopupController: 公式サイト遷移・UIDコピー・ログ展開・レビューバナー・DEVリセットとメッセージ契約整合', async () => {
  const adapter = createPopupTestAdapter({
    config: { IS_DEV: true },
    settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION,
      activeGameKey: 'GENSHIN'
    },
    gateway: {
      getUserGameRoles: async () => ({
        success: true,
        status: API_STATUS.OK,
        retcode: 0,
        role: { game_uid: '800999888', nickname: '旅人' },
        hoyoverseNotLoggedIn: false
      })
    }
  });

  const controller = createPopupController(adapter);
  await controller.init();

  const copyRes = await controller.copyUid();
  assert.deepEqual(copyRes, { copied: true });
  assert.deepEqual(adapter.copiedTexts, ['800999888']);

  controller.openCheckinSite();
  controller.openGiftSite();
  controller.openGuide();
  controller.openPrivacyPolicy();
  controller.recordLogsOpened();
  assert.equal(adapter.openedUrls.length, 4);

  // DEVリセット -> 表示 -> あとで -> 再度リセット -> 書く
  await controller.resetReviewPromptForDev();
  assert.equal(controller.getSnapshot().reviewBannerVisible, true);

  await controller.handleReviewLater();
  assert.equal(controller.getSnapshot().reviewBannerVisible, false);
  assert.equal(adapter.getReviewPromptState().status, 'postponed');

  await controller.resetReviewPromptForDev();
  assert.equal(controller.getSnapshot().reviewBannerVisible, true);
  await controller.handleReviewWrite();
  assert.equal(adapter.getReviewPromptState().status, 'completed');
  assert.ok(adapter.openedUrls.includes(REVIEW_PROMPT_CONFIG.REVIEW_URL));

  controller.dispose();

  // MESSAGE_TYPES が background-runner.js の handleMessage と一致すること
  const bgAdapter = createBackgroundTestAdapter();
  const runner = createBackgroundRunner(bgAdapter);
  for (const type of Object.values(MESSAGE_TYPES)) {
    const dispatched = runner.handleMessage(
      { type, gameKey: 'GENSHIN', eventName: 'ui_action', params: { action_type: 'open_log', game: 'none' } },
      { id: bgAdapter.runtime.id }
    );
    assert.equal(dispatched.handled, true, `${type} が background-runner で受理されること`);
    await dispatched.promise;
  }
});

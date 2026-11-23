import { GAMES, API_CONFIG, ALARM_NAMES } from '../config/constants.js';
import {
  isUnderBackoff,
  resetRetryState,
  isUnderAutoAttemptCooldown,
  getSettings,
  shouldRunRedeem,
  shouldRunDailySign,
  getOrCreateGaClientId
} from '../services/storage-service.js';
import { initReviewPromptState } from '../services/review-prompt-service.js';
import { syncConsentBadge, sendGAEvent } from '../services/analytics-service.js';
import {
  LOGIN_NOTIFICATION_PREFIX,
  SIGN_LOGIN_NOTIFICATION_PREFIX,
  SIGN_CAPTCHA_NOTIFICATION_PREFIX,
  handleNotificationClick,
  getNextDailySignTimestamp,
  setupUninstallUrl,
  setupAlarm,
  setupDailySignAlarm,
  scheduleRetryAlarm,
  clearRetryAlarm,
  scheduleSignRetryAlarm,
  clearSignRetryAlarm,
  waitCatchUpDelay
} from './flow-runner.js';
import { classifyFetchError, redeemForGame, runAutoRedeemFlow } from './redeem-runner.js';
import { signForGame, runDailySignFlow } from './sign-runner.js';

export {
  LOGIN_NOTIFICATION_PREFIX,
  SIGN_LOGIN_NOTIFICATION_PREFIX,
  SIGN_CAPTCHA_NOTIFICATION_PREFIX,
  handleNotificationClick,
  getNextDailySignTimestamp,
  setupUninstallUrl,
  setupAlarm,
  setupDailySignAlarm,
  scheduleRetryAlarm,
  clearRetryAlarm,
  scheduleSignRetryAlarm,
  clearSignRetryAlarm,
  waitCatchUpDelay,
  classifyFetchError,
  redeemForGame,
  runAutoRedeemFlow,
  signForGame,
  runDailySignFlow
};

/**
 * 前回実行から指定間隔が経過していればコード引き換えのキャッチアップを実行する
 */
export async function maybeRunCatchUp(triggerSource = 'STARTUP') {
  const settings = await getSettings();
  if (!settings.optInAccepted || !settings.autoRedeemEnabled) return false;
  if (await isUnderBackoff()) return false;

  const shouldRun = await shouldRunRedeem(API_CONFIG.REDEEM_INTERVAL_MINUTES);
  if (!shouldRun) return false;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await scheduleRetryAlarm();
    return false;
  }

  await waitCatchUpDelay();

  return await runAutoRedeemFlow(triggerSource);
}

/**
 * 当日未受取のゲームがあればログインボーナスのキャッチアップを実行する
 */
export async function maybeRunDailySignCatchUp(triggerSource = 'STARTUP', skipDelay = false) {
  const settings = await getSettings();
  if (!settings.optInAccepted || !settings.autoSignEnabled) return false;
  if (await isUnderBackoff()) return false;
  if (await isUnderAutoAttemptCooldown('SIGN')) return false;

  const enabledGames = settings.enabledGames || Object.keys(GAMES);
  const gameBizList = enabledGames.map(k => GAMES[k]?.gameBiz).filter(Boolean);
  const shouldRun = await shouldRunDailySign(gameBizList);
  if (!shouldRun) return false;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await scheduleSignRetryAlarm();
    return false;
  }

  if (!skipDelay) {
    await waitCatchUpDelay();
  }

  return await runDailySignFlow(triggerSource);
}

/**
 * 起動時・復帰時のログインボーナスおよびコード引き換えのキャッチアップを直列実行する
 */
export async function maybeRunAllCatchUp(triggerSource = 'STARTUP', skipDelay = false) {
  const settings = await getSettings();
  if (!settings.optInAccepted) return { signResult: false, redeemResult: false };
  if (await isUnderBackoff()) return { signResult: false, redeemResult: false };

  const enabledGames = settings.enabledGames || Object.keys(GAMES);
  const gameBizList = enabledGames.map(k => GAMES[k]?.gameBiz).filter(Boolean);
  const needSign = settings.autoSignEnabled &&
    !(await isUnderAutoAttemptCooldown('SIGN')) &&
    (await shouldRunDailySign(gameBizList));
  const needRedeem = settings.autoRedeemEnabled &&
    (await shouldRunRedeem(API_CONFIG.REDEEM_INTERVAL_MINUTES));

  if (!needSign && !needRedeem) {
    return { signResult: false, redeemResult: false };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (needSign) await scheduleSignRetryAlarm();
    if (needRedeem) await scheduleRetryAlarm();
    return { signResult: false, redeemResult: false };
  }

  if (!skipDelay) {
    await waitCatchUpDelay();
  }

  const signResult = needSign ? await runDailySignFlow(triggerSource) : false;
  const redeemResult = needRedeem ? await runAutoRedeemFlow(triggerSource) : false;

  return { signResult, redeemResult };
}

chrome.notifications.onClicked.addListener(handleNotificationClick);

chrome.runtime.onInstalled.addListener(async () => {
  await setupUninstallUrl();
  await setupAlarm();
  await setupDailySignAlarm();
  await syncConsentBadge();
  await getOrCreateGaClientId();
  await initReviewPromptState();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupUninstallUrl();
  await setupAlarm();
  await setupDailySignAlarm();
  await syncConsentBadge();
  await getOrCreateGaClientId();
  await maybeRunAllCatchUp('STARTUP');
});

if (chrome.idle && chrome.idle.onStateChanged) {
  chrome.idle.onStateChanged.addListener(async (newState) => {
    if (newState === 'active') {
      await maybeRunAllCatchUp('IDLE_ACTIVE');
    }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.AUTO_REDEEM || alarm.name === ALARM_NAMES.RETRY) {
    const settings = await getSettings();
    if (!settings.optInAccepted || !settings.autoRedeemEnabled) return;

    if (alarm.name === ALARM_NAMES.AUTO_REDEEM) {
      await resetRetryState('REDEEM');
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await scheduleRetryAlarm();
      return;
    }

    const source = alarm.name === ALARM_NAMES.RETRY ? 'RETRY_ALARM' : 'ALARM';
    await runAutoRedeemFlow(source);
    return;
  }

  if (alarm.name === ALARM_NAMES.DAILY_SIGN || alarm.name === ALARM_NAMES.SIGN_RETRY) {
    const settings = await getSettings();
    if (!settings.optInAccepted || !settings.autoSignEnabled) return;

    if (alarm.name === ALARM_NAMES.DAILY_SIGN) {
      await resetRetryState('SIGN');
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await scheduleSignRetryAlarm();
      return;
    }

    const source = alarm.name === ALARM_NAMES.SIGN_RETRY ? 'SIGN_RETRY_ALARM' : 'DAILY_ALARM';
    await runDailySignFlow(source);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  const handlers = {
    TRIGGER_MANUAL_REDEEM: () => runAutoRedeemFlow('MANUAL', message.gameKey),
    TRIGGER_MANUAL_SIGN: () => runDailySignFlow('MANUAL', message.gameKey),
    TRIGGER_INITIAL_CATCH_UP: () => maybeRunAllCatchUp('INITIAL_RUN', true),
    TRACK_GA_EVENT: () => sendGAEvent(message.eventName, message.params)
  };

  const handler = handlers[message.type];
  if (handler) {
    handler()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

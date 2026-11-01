import { GAMES, API_CONFIG, STATUS_MAP, ALARM_NAMES } from '../config/constants.js';
import { resolveLanguage, getGameLocalized, t } from '../utils/i18n.js';
import {
  setBackoff,
  getSettings,
  canAcceptNewCode,
  getRedeemedCodes,
  markCodeStatus,
  pruneHistoryIfExceeded,
  addExecutionLog,
  setLastSuccessfulRun,
  shouldRunRedeem,
  getHoyoTodayDateString,
  setDailySignRecord,
  isDailySignedToday,
  shouldRunDailySign,
  getActiveCodes,
  setActiveCodes,
  getOrCreateGaClientId
} from '../services/storage-service.js';
import { initReviewPromptState } from '../services/review-prompt-service.js';
import { fetchValidCodes } from '../services/code-fetcher.js';
import { getUserGameRoles, redeemCode, getDailySignInfo, claimDailyBonus } from '../services/hoyo-api.js';
import {
  toGaGameKey,
  toRedeemTrigger,
  toCheckinTrigger,
  syncConsentBadge,
  sendGAEvent
} from '../services/analytics-service.js';
import {
  LOGIN_NOTIFICATION_PREFIX,
  SIGN_LOGIN_NOTIFICATION_PREFIX,
  SIGN_CAPTCHA_NOTIFICATION_PREFIX,
  handleNotificationClick,
  notifyLoginRequired,
  getNextDailySignTimestamp,
  setupUninstallUrl,
  setupAlarm,
  setupDailySignAlarm,
  scheduleRetryAlarm,
  clearRetryAlarm,
  scheduleSignRetryAlarm,
  clearSignRetryAlarm,
  executeMultiGameFlow
} from './flow-runner.js';

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
  clearSignRetryAlarm
};

export async function maybeRunCatchUp(triggerSource = 'STARTUP') {
  const settings = await getSettings();
  if (!settings.optInAccepted || !settings.autoRedeemEnabled) return false;

  const shouldRun = await shouldRunRedeem(API_CONFIG.REDEEM_INTERVAL_MINUTES);
  if (!shouldRun) return false;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await scheduleRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
    return false;
  }

  if (API_CONFIG.CATCH_UP_DELAY_MS > 0) {
    await new Promise(r => setTimeout(r, API_CONFIG.CATCH_UP_DELAY_MS));
  }

  return await runAutoRedeemFlow(triggerSource);
}

export async function maybeRunDailySignCatchUp(triggerSource = 'STARTUP', skipDelay = false) {
  const settings = await getSettings();
  if (!settings.optInAccepted || !settings.autoSignEnabled) return false;

  const enabledGames = settings.enabledGames || Object.keys(GAMES);
  const gameBizList = enabledGames.map(k => GAMES[k]?.gameBiz).filter(Boolean);
  const shouldRun = await shouldRunDailySign(gameBizList);
  if (!shouldRun) return false;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await scheduleSignRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
    return false;
  }

  if (!skipDelay && API_CONFIG.CATCH_UP_DELAY_MS > 0) {
    await new Promise(r => setTimeout(r, API_CONFIG.CATCH_UP_DELAY_MS));
  }

  return await runDailySignFlow(triggerSource);
}

export async function maybeRunAllCatchUp(triggerSource = 'STARTUP', skipDelay = false) {
  const settings = await getSettings();
  if (!settings.optInAccepted) return { signResult: false, redeemResult: false };

  const enabledGames = settings.enabledGames || Object.keys(GAMES);
  const gameBizList = enabledGames.map(k => GAMES[k]?.gameBiz).filter(Boolean);
  const needSign = settings.autoSignEnabled && (await shouldRunDailySign(gameBizList));
  const needRedeem = settings.autoRedeemEnabled && (await shouldRunRedeem(API_CONFIG.REDEEM_INTERVAL_MINUTES));

  if (!needSign && !needRedeem) {
    return { signResult: false, redeemResult: false };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (needSign) await scheduleSignRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
    if (needRedeem) await scheduleRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
    return { signResult: false, redeemResult: false };
  }

  if (!skipDelay && API_CONFIG.CATCH_UP_DELAY_MS > 0) {
    await new Promise(r => setTimeout(r, API_CONFIG.CATCH_UP_DELAY_MS));
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

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await scheduleRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
      return;
    }

    const source = alarm.name === ALARM_NAMES.RETRY ? 'RETRY_ALARM' : 'ALARM';
    await runAutoRedeemFlow(source);
    return;
  }

  if (alarm.name === ALARM_NAMES.DAILY_SIGN || alarm.name === ALARM_NAMES.SIGN_RETRY) {
    const settings = await getSettings();
    if (!settings.optInAccepted || !settings.autoSignEnabled) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await scheduleSignRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
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

function classifyFetchError(fetchErr) {
  const match = fetchErr.message && fetchErr.message.match(/HTTP_ERROR_(\d+)/);
  const httpStatus = match ? parseInt(match[1], 10) : 0;
  const isTimeout = fetchErr.name === 'AbortError' || Boolean(fetchErr.message?.includes('TIMEOUT'));
  const isParseErr = fetchErr instanceof SyntaxError || Boolean(fetchErr.message?.includes('JSON'));
  const errorType = isTimeout
    ? 'timeout'
    : (httpStatus > 0 ? 'http_error' : (isParseErr ? 'parse_error' : 'network_error'));
  return { httpStatus, errorType };
}

function classifyRedeemRetcode(retcode) {
  switch (retcode) {
    case 0:
      return { codeStatus: 'SUCCESS', gaStatus: 'success', errorReason: 'none', shouldBreak: false };
    case -2017:
      return { codeStatus: 'ALREADY_CLAIMED', gaStatus: 'already_claimed', errorReason: 'none', shouldBreak: false };
    case -2001:
      return { codeStatus: 'EXPIRED', gaStatus: 'expired', errorReason: 'none', shouldBreak: false };
    case -2016:
      return { codeStatus: 'RETRY', gaStatus: 'cooldown', errorReason: 'cooldown', shouldBreak: true, triggerBackoff: true };
    case -100:
    case -1071:
      return { codeStatus: 'RETRY', gaStatus: 'failed', errorReason: 'not_logged_in', shouldBreak: true };
    default:
      return { codeStatus: 'RETRY', gaStatus: 'failed', errorReason: 'unknown', shouldBreak: false };
  }
}

function isTerminalCodeStatus(status) {
  return status === STATUS_MAP.SUCCESS ||
    status === STATUS_MAP.ALREADY_CLAIMED ||
    status === STATUS_MAP.EXPIRED ||
    status === STATUS_MAP.FAILED;
}

export async function redeemForGame(gameKey, lang = 'ja', triggerSource = 'ALARM') {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: `未知のゲームキー: ${gameKey}`, gameKey };
  }

  const trigger = toRedeemTrigger(triggerSource);
  const gameName = getGameLocalized(gameKey, lang).name;

  const roleRes = await getUserGameRoles(gameConfig.gameBiz, lang);
  if (!roleRes.success) {
    if (roleRes.retcode === -1 || roleRes.retcode === -2) {
      await addExecutionLog({
        type: 'INFO',
        category: 'CODE',
        gameKey,
        message: t('logNoCharSkip', [gameName], lang)
      });
      return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName };
    }

    const activeCodes = (await getActiveCodes(gameConfig.gameBiz)) || [];
    const redeemed = await getRedeemedCodes(gameConfig.gameBiz);
    const hasPendingCodes = activeCodes.some(cd => !redeemed[cd] || !isTerminalCodeStatus(redeemed[cd].s));
    if (hasPendingCodes || trigger === 'manual') {
      const errorReason = (roleRes.retcode === -100 || roleRes.retcode === -1071) ? 'not_logged_in' : 'unknown';
      await sendGAEvent('code_redeem_result', {
        game: toGaGameKey(gameKey),
        status: 'failed',
        error_reason: errorReason,
        trigger,
        lang
      });
    }

    const errorMsg = `${gameName}: ロール取得失敗 (${roleRes.message} [retcode: ${roleRes.retcode}])`;
    await addExecutionLog({ type: 'ERROR', category: 'CODE', gameKey, message: errorMsg });

    if (roleRes.retcode === -100 || roleRes.retcode === -1071) {
      notifyLoginRequired(LOGIN_NOTIFICATION_PREFIX, gameKey, 'notifLoginMsgRedeem', gameName, lang);
    }
    return { success: false, skipped: false, reason: errorMsg, retcode: roleRes.retcode, gameKey, gameName };
  }

  let activeCodes = [];
  try {
    activeCodes = await fetchValidCodes(gameKey);
    await setActiveCodes(gameConfig.gameBiz, activeCodes);
  } catch (fetchErr) {
    const { httpStatus, errorType } = classifyFetchError(fetchErr);
    await sendGAEvent('code_list_fetch_error', {
      game: toGaGameKey(gameKey),
      http_status: httpStatus,
      error_type: errorType,
      lang
    });
    throw fetchErr;
  }

  const redeemed = await getRedeemedCodes(gameConfig.gameBiz);
  let redeemedCount = 0;

  for (const cdkey of activeCodes) {
    const entry = redeemed[cdkey];
    if (entry && isTerminalCodeStatus(entry.s)) {
      continue;
    }

    if (!entry) {
      const canAccept = await canAcceptNewCode(gameConfig.gameBiz);
      if (!canAccept) {
        await addExecutionLog({
          type: 'WARN',
          gameKey,
          message: t('logDailyLimit', [gameName], lang)
        });
        break;
      }
    }

    await new Promise(r => setTimeout(r, API_CONFIG.INTER_REQUEST_DELAY_MS));

    const res = await redeemCode({
      exchangeHost: gameConfig.exchangeHost,
      exchangePath: gameConfig.exchangePath,
      gameBiz: gameConfig.gameBiz,
      uid: roleRes.role.game_uid,
      region: roleRes.role.region,
      cdkey,
      lang
    });

    const outcome = classifyRedeemRetcode(res.retcode);
    if (outcome.triggerBackoff) {
      await setBackoff();
    }
    await markCodeStatus(gameConfig.gameBiz, cdkey, outcome.codeStatus);
    if (outcome.codeStatus === 'SUCCESS') {
      redeemedCount++;
    }

    await sendGAEvent('code_redeem_result', {
      game: toGaGameKey(gameKey),
      status: outcome.gaStatus,
      error_reason: outcome.errorReason,
      trigger,
      lang
    });

    if (outcome.shouldBreak) {
      break;
    }
  }

  await pruneHistoryIfExceeded(gameConfig.gameBiz, activeCodes);
  await addExecutionLog({
    type: 'INFO',
    category: 'CODE',
    gameKey,
    message: t('logRedeemComplete', [gameName, redeemedCount], lang)
  });

  return { success: true, skipped: false, redeemedCount, gameKey, gameName };
}

export async function runAutoRedeemFlow(triggerSource = 'ALARM', targetGameKey = null) {
  return executeMultiGameFlow({
    lockKey: triggerSource,
    targetGameKey,
    category: 'CODE',
    countPropName: 'redeemedCount',
    checkStorage: true,
    logBackoffAbort: true,
    notifyStorageWriteFailure: true,
    skippedDelayMs: 500,
    getNormalDelayMs: () => API_CONFIG.INTER_REQUEST_DELAY_MS,
    runSingleGame: (gKey, lang) => redeemForGame(gKey, lang, triggerSource),
    extractCount: (res) => (res.success && !res.skipped && res.redeemedCount ? res.redeemedCount : 0),
    onFullRunSuccess: async () => {
      await setLastSuccessfulRun(Date.now());
      await clearRetryAlarm();
    },
    scheduleRetry: scheduleRetryAlarm,
    exceptionLogKey: 'logExceptionRedeem'
  });
}

export async function signForGame(gameKey, options = {}, lang = 'ja', triggerSource = 'DAILY_ALARM') {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: `未知のゲームキー: ${gameKey}`, gameKey };
  }

  const trigger = toCheckinTrigger(triggerSource);
  const gameName = getGameLocalized(gameKey, lang).name;

  if (!options.forceCheck && (await isDailySignedToday(gameConfig.gameBiz))) {
    return {
      success: true,
      skipped: true,
      alreadySigned: true,
      reason: 'ALREADY_SIGNED_TODAY',
      gameKey,
      gameName
    };
  }

  const roleRes = await getUserGameRoles(gameConfig.gameBiz, lang);
  if (!roleRes.success) {
    if (roleRes.retcode === -1 || roleRes.retcode === -2) {
      await setDailySignRecord(gameConfig.gameBiz, {
        date: getHoyoTodayDateString(),
        isSigned: false,
        skippedNoChar: true
      });
      await addExecutionLog({
        type: 'INFO',
        category: 'SIGN',
        gameKey,
        message: t('logNoCharSkipSign', [gameName], lang)
      });
      return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName };
    }

    const errorReason = (roleRes.retcode === -100 || roleRes.retcode === -1071) ? 'not_logged_in' : 'api_error';
    await sendGAEvent('daily_checkin_result', {
      game: toGaGameKey(gameKey),
      status: 'failed',
      error_reason: errorReason,
      trigger,
      lang
    });

    const errorMsg = `${gameName}: [ログボ] ロール取得失敗 (${roleRes.message} [retcode: ${roleRes.retcode}])`;
    await addExecutionLog({ type: 'ERROR', category: 'SIGN', gameKey, message: errorMsg });

    if (roleRes.retcode === -100 || roleRes.retcode === -1071) {
      notifyLoginRequired(SIGN_LOGIN_NOTIFICATION_PREFIX, gameKey, 'notifLoginMsgSign', gameName, lang);
    }
    return {
      success: false,
      skipped: false,
      reason: errorMsg,
      retcode: roleRes.retcode,
      gameKey,
      gameName
    };
  }

  const infoRes = await getDailySignInfo(gameConfig, lang);
  const todayStr = (infoRes.success && infoRes.today) ? infoRes.today : getHoyoTodayDateString();

  if (infoRes.success && infoRes.isSigned) {
    await setDailySignRecord(gameConfig.gameBiz, {
      date: todayStr,
      isSigned: true,
      totalSignDay: infoRes.totalSignDay,
      skippedNoChar: false
    });
    await sendGAEvent('daily_checkin_result', {
      game: toGaGameKey(gameKey),
      status: 'already_signed',
      error_reason: 'none',
      trigger,
      lang
    });
    const daysSuffix = infoRes.totalSignDay ? t('signStatusMonthDays', [infoRes.totalSignDay], lang) : '';
    await addExecutionLog({
      type: 'INFO',
      category: 'SIGN',
      gameKey,
      message: t('logSignAlready', [gameName, daysSuffix], lang)
    });
    return {
      success: true,
      skipped: false,
      signed: false,
      alreadySigned: true,
      totalSignDay: infoRes.totalSignDay,
      gameKey,
      gameName
    };
  }

  const claimRes = await claimDailyBonus(gameConfig, lang);

  if (claimRes.isRisk) {
    await sendGAEvent('daily_checkin_result', {
      game: toGaGameKey(gameKey),
      status: 'failed',
      error_reason: 'captcha_required',
      trigger,
      lang
    });
    const riskMsg = t('logSignRisk', [gameName], lang);
    await addExecutionLog({ type: 'WARN', category: 'SIGN', gameKey, message: riskMsg });
    chrome.notifications.create(`${SIGN_CAPTCHA_NOTIFICATION_PREFIX}${gameKey}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('notifCaptchaTitle', [], lang),
      message: t('notifCaptchaMsg', [gameName], lang)
    });
    return {
      success: false,
      skipped: false,
      isRisk: true,
      retcode: claimRes.retcode,
      reason: claimRes.message,
      gameKey,
      gameName
    };
  }

  if (claimRes.success) {
    const baseDays = infoRes.success ? infoRes.totalSignDay : 0;
    const totalSignDay = claimRes.alreadySigned ? baseDays : baseDays + 1;
    await setDailySignRecord(gameConfig.gameBiz, {
      date: todayStr,
      isSigned: true,
      totalSignDay,
      skippedNoChar: false
    });

    await sendGAEvent('daily_checkin_result', {
      game: toGaGameKey(gameKey),
      status: claimRes.alreadySigned ? 'already_signed' : 'success',
      error_reason: 'none',
      trigger,
      lang
    });

    const daysSuffix = totalSignDay ? t('signStatusMonthDays', [totalSignDay], lang) : '';
    const msg = t(claimRes.alreadySigned ? 'logSignAlready' : 'logSignDone', [gameName, daysSuffix], lang);

    await addExecutionLog({
      type: 'INFO',
      category: 'SIGN',
      gameKey,
      message: msg
    });

    return {
      success: true,
      skipped: false,
      signed: !claimRes.alreadySigned,
      alreadySigned: !!claimRes.alreadySigned,
      totalSignDay,
      gameKey,
      gameName
    };
  }

  const errorReason = (claimRes.retcode === -100 || claimRes.retcode === -1071) ? 'not_logged_in' : 'api_error';
  await sendGAEvent('daily_checkin_result', {
    game: toGaGameKey(gameKey),
    status: 'failed',
    error_reason: errorReason,
    trigger,
    lang
  });

  const errText = `${gameName}: [ログボ] 受取失敗 (${claimRes.message} [retcode: ${claimRes.retcode}])`;
  await addExecutionLog({ type: 'ERROR', category: 'SIGN', gameKey, message: errText });

  if (claimRes.retcode === -100 || claimRes.retcode === -1071) {
    notifyLoginRequired(SIGN_LOGIN_NOTIFICATION_PREFIX, gameKey, 'notifLoginMsgSign', gameName, lang);
  }

  return {
    success: false,
    skipped: false,
    retcode: claimRes.retcode,
    reason: errText,
    gameKey,
    gameName
  };
}

export async function runDailySignFlow(triggerSource = 'DAILY_ALARM', targetGameKey = null) {
  return executeMultiGameFlow({
    lockKey: `SIGN_${triggerSource}`,
    targetGameKey,
    category: 'SIGN',
    countPropName: 'signedCount',
    checkStorage: false,
    logBackoffAbort: false,
    notifyStorageWriteFailure: false,
    skippedDelayMs: 200,
    getNormalDelayMs: () => 1_500,
    runSingleGame: (gKey, lang) => signForGame(gKey, { forceCheck: !!targetGameKey }, lang, triggerSource),
    extractCount: (res) => (res.success && res.signed ? 1 : 0),
    onFullRunSuccess: clearSignRetryAlarm,
    scheduleRetry: scheduleSignRetryAlarm,
    exceptionLogKey: 'logExceptionSign'
  });
}

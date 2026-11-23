import { GAMES, API_CONFIG } from '../config/constants.js';
import { getGameLocalized, t } from '../utils/i18n.js';
import {
  computeJitteredDelayMs,
  resetRetryState,
  addExecutionLog,
  getHoyoTodayDateString,
  setDailySignRecord,
  isDailySignedToday,
  isDailySignAutoSkippedToday
} from '../services/storage-service.js';
import { getUserGameRoles, getDailySignInfo, claimDailyBonus } from '../services/hoyo-api.js';
import { toGaGameKey, toCheckinTrigger, sendGAEvent } from '../services/analytics-service.js';
import {
  SIGN_LOGIN_NOTIFICATION_PREFIX,
  SIGN_CAPTCHA_NOTIFICATION_PREFIX,
  scheduleSignRetryAlarm,
  clearSignRetryAlarm,
  executeMultiGameFlow,
  handleHttpBackoffResponse,
  reportGameFailure
} from './flow-runner.js';

/**
 * 指定ゲームのデイリーログインボーナス確認・受取を実行する
 */
export async function signForGame(gameKey, options = {}, lang = 'ja', triggerSource = 'DAILY_ALARM') {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: t('errUnknownGameKey', [gameKey], lang), gameKey };
  }

  const trigger = toCheckinTrigger(triggerSource);
  const gameName = getGameLocalized(gameKey, lang).name;

  if (!options.forceCheck) {
    if (await isDailySignedToday(gameConfig.gameBiz)) {
      return {
        success: true,
        skipped: true,
        alreadySigned: true,
        reason: 'ALREADY_SIGNED_TODAY',
        gameKey,
        gameName
      };
    }
    if (await isDailySignAutoSkippedToday(gameConfig.gameBiz)) {
      return {
        success: true,
        skipped: true,
        captchaBlocked: true,
        reason: 'CAPTCHA_BLOCKED_TODAY',
        gameKey,
        gameName
      };
    }
  }

  const roleRes = await getUserGameRoles(gameConfig.gameBiz, lang);
  if (!roleRes.success) {
    if (roleRes.shouldBackoff) {
      return await handleHttpBackoffResponse({
        gameKey,
        gameName,
        category: 'SIGN',
        gaEventName: 'daily_checkin_result',
        trigger,
        lang,
        res: roleRes
      });
    }
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

    return await reportGameFailure({
      category: 'SIGN',
      gaEvent: 'daily_checkin_result',
      gameKey,
      gameName,
      trigger,
      lang,
      retcode: roleRes.retcode,
      errorMessage: t('logRoleFetchFailedSign', [gameName, roleRes.message, roleRes.retcode], lang),
      fallbackErrorReason: 'api_error',
      notifPrefix: SIGN_LOGIN_NOTIFICATION_PREFIX,
      notifMsgKey: 'notifLoginMsgSign'
    });
  }

  const infoRes = await getDailySignInfo(gameConfig, lang);
  if (infoRes.shouldBackoff) {
    return await handleHttpBackoffResponse({
      gameKey,
      gameName,
      category: 'SIGN',
      gaEventName: 'daily_checkin_result',
      trigger,
      lang,
      res: infoRes
    });
  }
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

  if (claimRes.shouldBackoff) {
    return await handleHttpBackoffResponse({
      gameKey,
      gameName,
      category: 'SIGN',
      gaEventName: 'daily_checkin_result',
      trigger,
      lang,
      res: claimRes
    });
  }

  if (claimRes.isRisk) {
    await setDailySignRecord(gameConfig.gameBiz, {
      date: todayStr,
      isSigned: false,
      skippedNoChar: false,
      captchaBlocked: true
    });
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

  return await reportGameFailure({
    category: 'SIGN',
    gaEvent: 'daily_checkin_result',
    gameKey,
    gameName,
    trigger,
    lang,
    retcode: claimRes.retcode,
    errorMessage: t('logSignClaimFailed', [gameName, claimRes.message, claimRes.retcode], lang),
    fallbackErrorReason: 'api_error',
    notifPrefix: SIGN_LOGIN_NOTIFICATION_PREFIX,
    notifMsgKey: 'notifLoginMsgSign'
  });
}

/**
 * 全有効ゲームまたは指定ゲームのデイリーログインボーナス受取フローを実行する
 */
export async function runDailySignFlow(triggerSource = 'DAILY_ALARM', targetGameKey = null) {
  return executeMultiGameFlow({
    lockKey: `SIGN_${triggerSource}`,
    triggerSource,
    attemptKind: 'SIGN',
    targetGameKey,
    category: 'SIGN',
    countPropName: 'signedCount',
    checkStorage: false,
    logBackoffAbort: false,
    notifyStorageWriteFailure: false,
    skippedDelayMs: 200,
    getNormalDelayMs: () => computeJitteredDelayMs(
      API_CONFIG.SIGN_GAME_DELAY_MS,
      API_CONFIG.SIGN_GAME_JITTER_MAX_MS
    ),
    runSingleGame: (gKey, lang) => signForGame(gKey, { forceCheck: !!targetGameKey }, lang, triggerSource),
    extractCount: (res) => (res.success && res.signed ? 1 : 0),
    onFullRunSuccess: async () => {
      await clearSignRetryAlarm();
      await resetRetryState('SIGN');
    },
    scheduleRetry: scheduleSignRetryAlarm,
    clearRetry: clearSignRetryAlarm,
    resetRetry: () => resetRetryState('SIGN'),
    exceptionLogKey: 'logExceptionSign'
  });
}

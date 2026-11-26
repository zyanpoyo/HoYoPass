import { GAMES, ALARM_NAMES, STATUS_MAP, UNINSTALL_URL } from '../config/constants.js';
import { resolveLanguage, getGameLocalized, t } from '../utils/i18n.js';
import { getHoyoTodayDateString } from '../services/storage-service.js';
import { computeJitteredDelayMs } from '../services/rate-limit-service.js';
import { isNetworkException, isTimeoutError } from '../services/http-client.js';
import { isNotLoggedIn } from '../services/hoyo-api.js';
import { toGaGameKey, toRedeemTrigger, toCheckinTrigger } from '../services/analytics-service.js';

const NOTIFICATION_PREFIXES = {
  REDEEM_LOGIN: 'login_required_',
  SIGN_LOGIN: 'sign_login_required_',
  SIGN_CAPTCHA: 'sign_captcha_'
};

const NOTIFICATION_ROUTES = [
  {
    prefix: NOTIFICATION_PREFIXES.REDEEM_LOGIN,
    resolveUrl: (gameKey, lang) => getGameLocalized(gameKey, lang)?.giftSiteUrl
  },
  {
    prefix: NOTIFICATION_PREFIXES.SIGN_LOGIN,
    resolveUrl: (gameKey) => GAMES[gameKey]?.checkInSiteUrl
  },
  {
    prefix: NOTIFICATION_PREFIXES.SIGN_CAPTCHA,
    resolveUrl: (gameKey) => GAMES[gameKey]?.checkInSiteUrl
  }
];

const ALARM_ROUTES = {
  [ALARM_NAMES.AUTO_REDEEM]: { kind: 'REDEEM', resetRetry: true, triggerSource: 'ALARM' },
  [ALARM_NAMES.RETRY]: { kind: 'REDEEM', resetRetry: false, triggerSource: 'RETRY_ALARM' },
  [ALARM_NAMES.DAILY_SIGN]: { kind: 'SIGN', resetRetry: true, triggerSource: 'DAILY_ALARM' },
  [ALARM_NAMES.SIGN_RETRY]: { kind: 'SIGN', resetRetry: false, triggerSource: 'SIGN_RETRY_ALARM' }
};

const FLOW_SPECS = {
  REDEEM: {
    settingFlag: 'autoRedeemEnabled',
    retryAlarmName: ALARM_NAMES.RETRY,
    retryLogKey: 'logRetryRedeem',
    retryExhaustedLogKey: 'logRetryExhaustedRedeem',
    category: 'CODE',
    countPropName: 'redeemedCount',
    checkStorage: true,
    logBackoffAbort: true,
    notifyStorageWriteFailure: true,
    skippedDelayMs: 500,
    getLockKey: (triggerSource) => triggerSource,
    getNormalDelayMs: (config, randomFn) => computeJitteredDelayMs(
      config.INTER_REQUEST_DELAY_MS,
      config.INTER_REQUEST_JITTER_MAX_MS,
      randomFn
    ),
    extractCount: (res) => (res.success && !res.skipped && res.redeemedCount ? res.redeemedCount : 0),
    recordSuccessTimestamp: true,
    exceptionLogKey: 'logExceptionRedeem'
  },
  SIGN: {
    settingFlag: 'autoSignEnabled',
    retryAlarmName: ALARM_NAMES.SIGN_RETRY,
    retryLogKey: 'logRetrySign',
    retryExhaustedLogKey: 'logRetryExhaustedSign',
    category: 'SIGN',
    countPropName: 'signedCount',
    checkStorage: false,
    logBackoffAbort: false,
    notifyStorageWriteFailure: false,
    skippedDelayMs: 200,
    getLockKey: (triggerSource) => `SIGN_${triggerSource}`,
    getNormalDelayMs: (config, randomFn) => computeJitteredDelayMs(
      config.SIGN_GAME_DELAY_MS,
      config.SIGN_GAME_JITTER_MAX_MS,
      randomFn
    ),
    extractCount: (res) => (res.success && res.signed ? 1 : 0),
    recordSuccessTimestamp: false,
    exceptionLogKey: 'logExceptionSign'
  }
};

function resolveEnabledGames(settings) {
  return (settings && Array.isArray(settings.enabledGames) && settings.enabledGames.length > 0)
    ? settings.enabledGames
    : Object.keys(GAMES);
}

function getNextDailySignTimestamp(nowMs, jitterMinutes = 0) {
  const utc8OffsetMs = 8 * 60 * 60 * 1000;
  const utc8Date = new Date(nowMs + utc8OffsetMs);
  const targetUtc8 = Date.UTC(
    utc8Date.getUTCFullYear(),
    utc8Date.getUTCMonth(),
    utc8Date.getUTCDate(),
    0, 5, 0, 0
  ) + jitterMinutes * 60 * 1000;
  let nextWhen = targetUtc8 - utc8OffsetMs;
  if (nextWhen <= nowMs) {
    nextWhen += 24 * 60 * 60 * 1000;
  }
  return nextWhen;
}

function classifyFetchError(fetchErr) {
  const msg = typeof fetchErr?.message === 'string' ? fetchErr.message : '';
  const match = msg.match(/HTTP_ERROR_(\d+)/);
  const httpStatus = match ? parseInt(match[1], 10) : 0;
  const isTimeout = isTimeoutError(fetchErr);
  const isParseErr = fetchErr instanceof SyntaxError || msg.includes('JSON');
  const errorType = isTimeout
    ? 'timeout'
    : (httpStatus > 0 ? 'http_error' : (isParseErr ? 'parse_error' : 'network_error'));
  return { httpStatus, errorType };
}

function classifyRedeemRetcode(retcode) {
  if (isNotLoggedIn(retcode)) {
    return { codeStatus: null, skipMarkStatus: true, gaStatus: 'failed', errorReason: 'not_logged_in', shouldBreak: true };
  }
  switch (retcode) {
    case 0:
      return { codeStatus: 'SUCCESS', gaStatus: 'success', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2017:
      return { codeStatus: 'ALREADY_CLAIMED', gaStatus: 'already_claimed', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2001:
      return { codeStatus: 'EXPIRED', gaStatus: 'expired', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2018:
      return { codeStatus: 'EXPIRED', gaStatus: 'already_claimed', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2016:
      return { codeStatus: null, skipMarkStatus: true, gaStatus: 'cooldown', errorReason: 'cooldown', shouldBreak: true, triggerBackoff: true };
    default:
      return { codeStatus: 'RETRY', gaStatus: 'failed', errorReason: 'unknown', shouldBreak: false, skipMarkStatus: false };
  }
}

function isTerminalCodeStatus(status) {
  return status === STATUS_MAP.SUCCESS ||
    status === STATUS_MAP.ALREADY_CLAIMED ||
    status === STATUS_MAP.EXPIRED ||
    status === STATUS_MAP.FAILED;
}

/**
 * Background の実行制御・スケジューリング・バックオフ・巡回ロジックを集約した深いモジュールを生成する。
 * 外部依存（MV3 API・時計・ストレージ・外部通信）は単一シーム（adapter）越しに注入する。
 */
export function createBackgroundRunner(adapter) {
  const { config, clock, runtime, alarms, notifications, tabs, store, gateway } = adapter;

  const resolveLang = (settings) => resolveLanguage(settings?.language, runtime.uiLanguage);

  const createBasicNotification = (id, title, message) => notifications.create(id, {
    type: 'basic',
    iconUrl: runtime.getURL('icons/icon128.png'),
    title,
    message
  });

  async function setupUninstallUrl() {
    if (!runtime.setUninstallURL) return;
    try {
      await runtime.setUninstallURL(UNINSTALL_URL);
    } catch (err) {
      console.warn('Failed to set uninstall URL:', err);
    }
  }

  async function setupRedeemAlarm() {
    const existing = await alarms.get(ALARM_NAMES.AUTO_REDEEM);
    if (!existing || existing.periodInMinutes !== config.REDEEM_INTERVAL_MINUTES) {
      await alarms.create(ALARM_NAMES.AUTO_REDEEM, {
        periodInMinutes: config.REDEEM_INTERVAL_MINUTES
      });
    }
  }

  async function setupDailySignAlarm() {
    const { minutes, created } = await store.getOrCreateDailySignJitterMinutes();
    const existing = await alarms.get(ALARM_NAMES.DAILY_SIGN);
    if (created || !existing || existing.periodInMinutes !== 1440) {
      await alarms.create(ALARM_NAMES.DAILY_SIGN, {
        when: getNextDailySignTimestamp(clock.now(), minutes),
        periodInMinutes: 1440
      });
    }
  }

  async function scheduleRetryAlarm(kind, explicitDelayMinutes = null) {
    const spec = FLOW_SPECS[kind];
    const existing = await alarms.get(spec.retryAlarmName);
    if (existing) {
      return { scheduled: false, exhausted: false, alreadyScheduled: true };
    }

    const slot = await store.consumeRetrySlot(kind, { explicitDelayMinutes });
    const settings = await store.getSettings();
    const lang = resolveLang(settings);

    if (!slot.allowed) {
      if (slot.shouldLogExhausted) {
        await store.addExecutionLog({
          type: 'WARN',
          category: spec.category,
          message: t(spec.retryExhaustedLogKey, [slot.maxAttempts], lang)
        });
      }
      return { scheduled: false, exhausted: true, attempt: slot.attempt };
    }

    await alarms.create(spec.retryAlarmName, { delayInMinutes: slot.delayMinutes });
    await store.addExecutionLog({
      type: 'INFO',
      category: spec.category,
      message: t(spec.retryLogKey, [slot.baseMinutes, slot.attempt, slot.maxAttempts], lang)
    });
    return {
      scheduled: true,
      exhausted: false,
      delayMinutes: slot.delayMinutes,
      attempt: slot.attempt
    };
  }

  async function waitCatchUpDelay() {
    const totalDelayMs = computeJitteredDelayMs(
      config.CATCH_UP_DELAY_MS,
      config.CATCH_UP_JITTER_MAX_MS,
      clock.random
    );
    if (!Number.isFinite(totalDelayMs) || totalDelayMs <= 0) {
      return;
    }

    const maxStepMs = config.CATCH_UP_KEEPALIVE_INTERVAL_MS;
    const stepLimit = (Number.isFinite(maxStepMs) && maxStepMs > 0) ? maxStepMs : totalDelayMs;
    let remainingMs = totalDelayMs;

    while (remainingMs > 0) {
      const chunkMs = Math.min(remainingMs, stepLimit);
      await clock.sleep(chunkMs);
      remainingMs -= chunkMs;
      if (remainingMs > 0) {
        try {
          await store.pingSessionKeepAlive();
        } catch {
          // keepalive ping の失敗でキャッチアップ本体を止めない
        }
      }
    }
  }

  async function handleHttpBackoff({
    category,
    gaEventName,
    gameKey,
    gameName,
    trigger,
    lang,
    res
  }) {
    const backoff = await store.recordBackoffFailure({ retryAfterMs: res.retryAfterMs });
    const errorReason = res.isRateLimited ? 'rate_limited' : 'server_error';
    await gateway.sendGAEvent(gaEventName, {
      game: toGaGameKey(gameKey),
      status: 'failed',
      error_reason: errorReason,
      trigger,
      lang
    });
    const boMsg = t('logHttpBackoff', [gameName, res.httpStatus, backoff.remainingMinutes], lang);
    await store.addExecutionLog({ type: 'WARN', category, gameKey, message: boMsg });
    return {
      success: false,
      skipped: false,
      backoffTriggered: true,
      httpStatus: res.httpStatus,
      retcode: res.retcode,
      reason: boMsg,
      gameKey,
      gameName
    };
  }

  async function reportGameFailure({
    category,
    gaEvent,
    gameKey,
    gameName,
    trigger,
    lang,
    retcode,
    errorMessage,
    fallbackErrorReason = 'api_error',
    shouldSendGa = true,
    notifPrefix,
    notifMsgKey
  }) {
    const notLoggedIn = isNotLoggedIn(retcode);
    if (shouldSendGa) {
      await gateway.sendGAEvent(gaEvent, {
        game: toGaGameKey(gameKey),
        status: 'failed',
        error_reason: notLoggedIn ? 'not_logged_in' : fallbackErrorReason,
        trigger,
        lang
      });
    }

    await store.addExecutionLog({
      type: 'ERROR',
      category,
      gameKey,
      message: errorMessage
    });

    if (notLoggedIn && notifPrefix && notifMsgKey) {
      await createBasicNotification(
        `${notifPrefix}${gameKey}`,
        t('notifLoginTitle', [], lang),
        t(notifMsgKey, [gameName], lang)
      );
    }

    return {
      success: false,
      skipped: false,
      reason: errorMessage,
      retcode,
      gameKey,
      gameName
    };
  }

  async function redeemForGame(gameKey, lang, triggerSource) {
    const gameConfig = GAMES[gameKey];
    if (!gameConfig) {
      return { success: false, reason: t('errUnknownGameKey', [gameKey], lang), gameKey };
    }

    const trigger = toRedeemTrigger(triggerSource);
    const gameName = getGameLocalized(gameKey, lang).name;

    let activeCodes = [];
    try {
      activeCodes = await gateway.fetchValidCodes(gameKey);
      await store.setActiveCodes(gameConfig.gameBiz, activeCodes);
    } catch (fetchErr) {
      const { httpStatus, errorType } = classifyFetchError(fetchErr);
      await gateway.sendGAEvent('code_list_fetch_error', {
        game: toGaGameKey(gameKey),
        http_status: httpStatus,
        error_type: errorType,
        lang
      });
      throw fetchErr;
    }

    const redeemed = await store.getRedeemedCodes(gameConfig.gameBiz);
    const pendingCodes = activeCodes.filter(cdkey => {
      const entry = redeemed[cdkey];
      return !(entry && isTerminalCodeStatus(entry.s));
    });

    // 未処理コード 0 件時は非公開 HoYoverse/HoYoLAB API を一切呼ばない
    if (pendingCodes.length === 0) {
      await store.pruneHistoryIfExceeded(gameConfig.gameBiz, activeCodes);
      await store.addExecutionLog({
        type: 'INFO',
        category: 'CODE',
        gameKey,
        message: t('logRedeemComplete', [gameName, 0], lang)
      });
      return {
        success: true,
        skipped: true,
        reason: 'NO_PENDING_CODES',
        redeemedCount: 0,
        gameKey,
        gameName
      };
    }

    const roleRes = await gateway.getUserGameRoles(gameConfig.gameBiz, lang);
    if (!roleRes.success) {
      if (roleRes.shouldBackoff) {
        return handleHttpBackoff({
          category: 'CODE',
          gaEventName: 'code_redeem_result',
          gameKey,
          gameName,
          trigger,
          lang,
          res: roleRes
        });
      }
      if (roleRes.retcode === -1 || roleRes.retcode === -2) {
        await store.addExecutionLog({
          type: 'INFO',
          category: 'CODE',
          gameKey,
          message: t('logNoCharSkip', [gameName], lang)
        });
        return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName };
      }

      return reportGameFailure({
        category: 'CODE',
        gaEvent: 'code_redeem_result',
        gameKey,
        gameName,
        trigger,
        lang,
        retcode: roleRes.retcode,
        errorMessage: t('logRoleFetchFailedRedeem', [gameName, roleRes.message, roleRes.retcode], lang),
        fallbackErrorReason: 'unknown',
        shouldSendGa: true,
        notifPrefix: NOTIFICATION_PREFIXES.REDEEM_LOGIN,
        notifMsgKey: 'notifLoginMsgRedeem'
      });
    }

    let redeemedCount = 0;
    let backoffTriggered = false;
    let notLoggedInRes = null;

    for (const cdkey of pendingCodes) {
      if (!redeemed[cdkey]) {
        const canAccept = await store.canAcceptNewCode(gameConfig.gameBiz);
        if (!canAccept) {
          await store.addExecutionLog({
            type: 'WARN',
            gameKey,
            message: t('logDailyLimit', [gameName], lang)
          });
          break;
        }
      }

      const delayMs = computeJitteredDelayMs(
        config.INTER_REQUEST_DELAY_MS,
        config.INTER_REQUEST_JITTER_MAX_MS,
        clock.random
      );
      if (delayMs > 0) {
        await clock.sleep(delayMs);
      }

      const res = await gateway.redeemCode({
        exchangeHost: gameConfig.exchangeHost,
        exchangePath: gameConfig.exchangePath,
        gameBiz: gameConfig.gameBiz,
        uid: roleRes.role.game_uid,
        region: roleRes.role.region,
        cdkey,
        lang
      });

      if (res?.shouldBackoff) {
        await handleHttpBackoff({
          category: 'CODE',
          gaEventName: 'code_redeem_result',
          gameKey,
          gameName,
          trigger,
          lang,
          res
        });
        backoffTriggered = true;
        break;
      }

      const outcome = classifyRedeemRetcode(res.retcode);
      if (isNotLoggedIn(res.retcode)) {
        notLoggedInRes = res;
      }
      if (outcome.triggerBackoff) {
        await store.recordBackoffFailure({ retryAfterMs: res.retryAfterMs });
        backoffTriggered = true;
      }
      if (!outcome.skipMarkStatus) {
        await store.markCodeStatus(gameConfig.gameBiz, cdkey, outcome.codeStatus);
      }
      if (outcome.codeStatus === 'SUCCESS') {
        redeemedCount++;
      }

      await gateway.sendGAEvent('code_redeem_result', {
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

    await store.pruneHistoryIfExceeded(gameConfig.gameBiz, activeCodes);
    if (backoffTriggered) {
      return {
        success: false,
        skipped: false,
        backoffTriggered: true,
        redeemedCount,
        gameKey,
        gameName
      };
    }

    if (notLoggedInRes) {
      const failureRes = await reportGameFailure({
        category: 'CODE',
        gaEvent: 'code_redeem_result',
        gameKey,
        gameName,
        trigger,
        lang,
        retcode: notLoggedInRes.retcode,
        errorMessage: t('logRedeemFailed', [gameName, notLoggedInRes.message, notLoggedInRes.retcode], lang),
        fallbackErrorReason: 'unknown',
        shouldSendGa: false,
        notifPrefix: NOTIFICATION_PREFIXES.REDEEM_LOGIN,
        notifMsgKey: 'notifLoginMsgRedeem'
      });
      return { ...failureRes, redeemedCount };
    }

    await store.addExecutionLog({
      type: 'INFO',
      category: 'CODE',
      gameKey,
      message: t('logRedeemComplete', [gameName, redeemedCount], lang)
    });

    return { success: true, skipped: false, redeemedCount, gameKey, gameName };
  }

  async function signForGame(gameKey, options, lang, triggerSource) {
    const gameConfig = GAMES[gameKey];
    if (!gameConfig) {
      return { success: false, reason: t('errUnknownGameKey', [gameKey], lang), gameKey };
    }

    const trigger = toCheckinTrigger(triggerSource);
    const gameName = getGameLocalized(gameKey, lang).name;
    const abortWithBackoff = (res) => handleHttpBackoff({
      category: 'SIGN',
      gaEventName: 'daily_checkin_result',
      gameKey,
      gameName,
      trigger,
      lang,
      res
    });

    if (!options.forceCheck) {
      if (await store.isDailySignedToday(gameConfig.gameBiz)) {
        return {
          success: true,
          skipped: true,
          alreadySigned: true,
          reason: 'ALREADY_SIGNED_TODAY',
          gameKey,
          gameName
        };
      }
      if (await store.isDailySignAutoSkippedToday(gameConfig.gameBiz)) {
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

    const roleRes = await gateway.getUserGameRoles(gameConfig.gameBiz, lang);
    if (!roleRes.success) {
      if (roleRes.shouldBackoff) {
        return abortWithBackoff(roleRes);
      }
      if (roleRes.retcode === -1 || roleRes.retcode === -2) {
        await store.setDailySignRecord(gameConfig.gameBiz, {
          date: getHoyoTodayDateString(clock.now()),
          isSigned: false,
          skippedNoChar: true
        });
        await store.addExecutionLog({
          type: 'INFO',
          category: 'SIGN',
          gameKey,
          message: t('logNoCharSkipSign', [gameName], lang)
        });
        return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName };
      }

      return reportGameFailure({
        category: 'SIGN',
        gaEvent: 'daily_checkin_result',
        gameKey,
        gameName,
        trigger,
        lang,
        retcode: roleRes.retcode,
        errorMessage: t('logRoleFetchFailedSign', [gameName, roleRes.message, roleRes.retcode], lang),
        fallbackErrorReason: 'api_error',
        notifPrefix: NOTIFICATION_PREFIXES.SIGN_LOGIN,
        notifMsgKey: 'notifLoginMsgSign'
      });
    }

    const infoRes = await gateway.getDailySignInfo(gameConfig, lang);
    if (infoRes.shouldBackoff) {
      return abortWithBackoff(infoRes);
    }
    const todayStr = (infoRes.success && infoRes.today) ? infoRes.today : getHoyoTodayDateString(clock.now());

    if (infoRes.success && infoRes.isSigned) {
      await store.setDailySignRecord(gameConfig.gameBiz, {
        date: todayStr,
        isSigned: true,
        totalSignDay: infoRes.totalSignDay,
        skippedNoChar: false
      });
      await gateway.sendGAEvent('daily_checkin_result', {
        game: toGaGameKey(gameKey),
        status: 'already_signed',
        error_reason: 'none',
        trigger,
        lang
      });
      const daysSuffix = infoRes.totalSignDay ? t('signStatusMonthDays', [infoRes.totalSignDay], lang) : '';
      await store.addExecutionLog({
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

    const claimRes = await gateway.claimDailyBonus(gameConfig, lang);
    if (claimRes.shouldBackoff) {
      return abortWithBackoff(claimRes);
    }

    if (claimRes.isRisk) {
      await store.setDailySignRecord(gameConfig.gameBiz, {
        date: todayStr,
        isSigned: false,
        skippedNoChar: false,
        captchaBlocked: true
      });
      await gateway.sendGAEvent('daily_checkin_result', {
        game: toGaGameKey(gameKey),
        status: 'failed',
        error_reason: 'captcha_required',
        trigger,
        lang
      });
      const riskMsg = t('logSignRisk', [gameName], lang);
      await store.addExecutionLog({ type: 'WARN', category: 'SIGN', gameKey, message: riskMsg });
      await createBasicNotification(
        `${NOTIFICATION_PREFIXES.SIGN_CAPTCHA}${gameKey}`,
        t('notifCaptchaTitle', [], lang),
        t('notifCaptchaMsg', [gameName], lang)
      );
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
      await store.setDailySignRecord(gameConfig.gameBiz, {
        date: todayStr,
        isSigned: true,
        totalSignDay,
        skippedNoChar: false
      });

      await gateway.sendGAEvent('daily_checkin_result', {
        game: toGaGameKey(gameKey),
        status: claimRes.alreadySigned ? 'already_signed' : 'success',
        error_reason: 'none',
        trigger,
        lang
      });

      const daysSuffix = totalSignDay ? t('signStatusMonthDays', [totalSignDay], lang) : '';
      const msg = t(claimRes.alreadySigned ? 'logSignAlready' : 'logSignDone', [gameName, daysSuffix], lang);
      await store.addExecutionLog({
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

    return reportGameFailure({
      category: 'SIGN',
      gaEvent: 'daily_checkin_result',
      gameKey,
      gameName,
      trigger,
      lang,
      retcode: claimRes.retcode,
      errorMessage: t('logSignClaimFailed', [gameName, claimRes.message, claimRes.retcode], lang),
      fallbackErrorReason: 'api_error',
      notifPrefix: NOTIFICATION_PREFIXES.SIGN_LOGIN,
      notifMsgKey: 'notifLoginMsgSign'
    });
  }

  async function runFlow(kind, triggerSource, targetGameKey = null) {
    const spec = FLOW_SPECS[kind];
    const lockAcquired = await store.acquireExecutionLock(spec.getLockKey(triggerSource));
    if (!lockAcquired) {
      return { success: false, reason: 'ALREADY_RUNNING' };
    }

    const settings = await store.getSettings();
    const lang = resolveLang(settings);

    try {
      const backoff = await store.getBackoffState();
      if (backoff.isActive) {
        return {
          success: false,
          reason: 'UNDER_BACKOFF',
          remainingMinutes: backoff.remainingMinutes
        };
      }

      if (targetGameKey && !GAMES[targetGameKey]) {
        return { success: false, reason: t('errUnknownGameKey', [targetGameKey], lang) };
      }

      if (triggerSource === 'MANUAL' && targetGameKey) {
        const manualCooldown = await store.checkManualCooldown(spec.category, targetGameKey);
        if (!manualCooldown.allowed) {
          return {
            success: false,
            reason: 'MANUAL_COOLDOWN',
            remainingSec: manualCooldown.remainingSec,
            gameKey: targetGameKey
          };
        }
      }

      if (spec.checkStorage) {
        const cap = await store.checkStorageCapacity();
        if (cap.isWarning) {
          await createBasicNotification(
            null,
            t('notifStorageWarningTitle', [], lang),
            t('notifStorageWarningMsg', [], lang)
          );
        }
      }

      const enabledGames = resolveEnabledGames(settings);
      if (targetGameKey && !enabledGames.includes(targetGameKey)) {
        return {
          success: false,
          reason: t('errDisabledGameKey', [targetGameKey], lang),
          gameKey: targetGameKey
        };
      }

      if (triggerSource === 'MANUAL' && targetGameKey) {
        await store.recordManualCooldown(spec.category, targetGameKey);
        await store.resetRetryState(kind);
      } else if (!targetGameKey) {
        await store.setLastAttemptTimestamp(kind);
      }

      const gameKeys = targetGameKey ? [targetGameKey] : enabledGames;
      const results = {};
      let totalCount = 0;
      let hadBackoff = false;

      for (let i = 0; i < gameKeys.length; i++) {
        const gKey = gameKeys[i];
        const currentBackoff = await store.getBackoffState();
        if (currentBackoff.isActive) {
          hadBackoff = true;
          if (spec.logBackoffAbort) {
            const localized = getGameLocalized(gKey, lang);
            await store.addExecutionLog({
              type: 'WARN',
              category: spec.category,
              gameKey: gKey,
              message: t('logBackoffAbort', [localized.name], lang)
            });
          }
          break;
        }

        const res = kind === 'REDEEM'
          ? await redeemForGame(gKey, lang, triggerSource)
          : await signForGame(gKey, { forceCheck: !!targetGameKey }, lang, triggerSource);

        results[gKey] = res;
        totalCount += spec.extractCount(res);

        if (res?.backoffTriggered) {
          hadBackoff = true;
          break;
        }

        if (i < gameKeys.length - 1) {
          const delayMs = res.skipped ? spec.skippedDelayMs : spec.getNormalDelayMs(config, clock.random);
          if (delayMs > 0) {
            await clock.sleep(delayMs);
          }
        }
      }

      if (totalCount > 0) {
        await store.incrementReviewSuccessCount();
      }

      if (hadBackoff) {
        await alarms.clear(spec.retryAlarmName);
        const latestBackoff = await store.getBackoffState();
        return {
          success: false,
          reason: 'UNDER_BACKOFF',
          remainingMinutes: latestBackoff.remainingMinutes,
          [spec.countPropName]: totalCount,
          results,
          targetGameKey: targetGameKey || null
        };
      }

      await store.resetBackoffLevel();

      if (!targetGameKey) {
        if (spec.recordSuccessTimestamp) {
          await store.setLastSuccessfulRun(clock.now());
        }
        await alarms.clear(spec.retryAlarmName);
        await store.resetRetryState(kind);
      }

      return {
        success: true,
        [spec.countPropName]: totalCount,
        results,
        targetGameKey: targetGameKey || null
      };
    } catch (err) {
      if (spec.notifyStorageWriteFailure && err?.message?.startsWith('STORAGE_WRITE_FAILURE')) {
        await createBasicNotification(
          null,
          t('notifStorageErrorTitle', [], lang),
          t('notifStorageErrorMsg', [], lang)
        );
      }

      const isNetErr = isNetworkException(err);
      let retryExhausted = false;
      if (isNetErr) {
        const retryRes = await scheduleRetryAlarm(kind);
        retryExhausted = Boolean(retryRes?.exhausted);
      } else {
        await store.addExecutionLog({
          type: 'ERROR',
          category: spec.category,
          message: t(spec.exceptionLogKey, [err.message], lang)
        });
      }

      return {
        success: false,
        reason: isNetErr
          ? (retryExhausted ? 'NETWORK_RETRY_EXHAUSTED' : 'NETWORK_RETRY_SCHEDULED')
          : 'EXCEPTION',
        error: err.message
      };
    } finally {
      await store.releaseExecutionLock();
    }
  }

  async function runCatchUp(triggerSource = 'STARTUP', { skipDelay = false } = {}) {
    const settings = await store.getSettings();
    if (!settings.optInAccepted) return { signResult: false, redeemResult: false };
    if (await store.isUnderBackoff()) return { signResult: false, redeemResult: false };

    const enabledGames = resolveEnabledGames(settings);
    const gameBizList = enabledGames.map(k => GAMES[k]?.gameBiz).filter(Boolean);
    const needSign = settings.autoSignEnabled &&
      !(await store.isUnderAutoAttemptCooldown('SIGN')) &&
      (await store.shouldRunDailySign(gameBizList));
    const needRedeem = settings.autoRedeemEnabled &&
      (await store.shouldRunRedeem(config.REDEEM_INTERVAL_MINUTES));

    if (!needSign && !needRedeem) {
      return { signResult: false, redeemResult: false };
    }

    if (!runtime.isOnline()) {
      if (needSign) await scheduleRetryAlarm('SIGN');
      if (needRedeem) await scheduleRetryAlarm('REDEEM');
      return { signResult: false, redeemResult: false };
    }

    if (!skipDelay) {
      await waitCatchUpDelay();
    }

    const signResult = needSign ? await runFlow('SIGN', triggerSource) : false;
    const redeemResult = needRedeem ? await runFlow('REDEEM', triggerSource) : false;
    return { signResult, redeemResult };
  }

  async function handleInstalled() {
    await setupUninstallUrl();
    await setupRedeemAlarm();
    await setupDailySignAlarm();
    await runtime.syncConsentBadge();
    await store.getOrCreateGaClientId();
    await store.initReviewPromptState();
  }

  async function handleStartup() {
    await setupUninstallUrl();
    await setupRedeemAlarm();
    await setupDailySignAlarm();
    await runtime.syncConsentBadge();
    await store.getOrCreateGaClientId();
    return runCatchUp('STARTUP');
  }

  async function handleIdleStateChanged(newState) {
    if (newState !== 'active') return null;
    return runCatchUp('IDLE_ACTIVE');
  }

  async function handleAlarm(alarm) {
    const route = ALARM_ROUTES[alarm?.name];
    if (!route) return null;

    const spec = FLOW_SPECS[route.kind];
    const settings = await store.getSettings();
    if (!settings.optInAccepted || !settings[spec.settingFlag]) return null;

    if (route.resetRetry) {
      await store.resetRetryState(route.kind);
    }

    if (!runtime.isOnline()) {
      await scheduleRetryAlarm(route.kind);
      return { skipped: true, reason: 'OFFLINE' };
    }

    return runFlow(route.kind, route.triggerSource);
  }

  async function handleNotificationClick(notificationId) {
    if (typeof notificationId !== 'string') return false;
    const route = NOTIFICATION_ROUTES.find(r => notificationId.startsWith(r.prefix));
    if (!route) return false;

    const gameKey = notificationId.slice(route.prefix.length);
    const settings = await store.getSettings();
    const lang = resolveLang(settings);

    await gateway.sendGAEvent('ui_action', {
      action_type: 'notification_click',
      game: toGaGameKey(gameKey),
      lang
    });

    const targetUrl = route.resolveUrl(gameKey, lang);
    if (!targetUrl) return false;

    await tabs.create({ url: targetUrl });
    await notifications.clear(notificationId);
    return true;
  }

  function handleMessage(message, sender) {
    if (!message || sender?.id !== runtime.id) {
      return { handled: false };
    }

    const handlers = {
      TRIGGER_MANUAL_REDEEM: () => runFlow('REDEEM', 'MANUAL', message.gameKey),
      TRIGGER_MANUAL_SIGN: () => runFlow('SIGN', 'MANUAL', message.gameKey),
      TRIGGER_INITIAL_CATCH_UP: () => runCatchUp('INITIAL_RUN', { skipDelay: true }),
      TRACK_GA_EVENT: () => gateway.sendGAEvent(message.eventName, message.params)
    };

    const handler = handlers[message.type];
    if (!handler) {
      return { handled: false };
    }
    return { handled: true, promise: handler() };
  }

  return {
    handleInstalled,
    handleStartup,
    handleIdleStateChanged,
    handleAlarm,
    handleNotificationClick,
    handleMessage
  };
}

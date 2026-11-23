import { GAMES, API_CONFIG, ALARM_NAMES, UNINSTALL_URL } from '../config/constants.js';
import { resolveLanguage, getGameLocalized, t } from '../utils/i18n.js';
import {
  acquireExecutionLock,
  releaseExecutionLock,
  getBackoffState,
  resetBackoffLevel,
  recordBackoffFailure,
  computeJitteredDelayMs,
  getOrCreateDailySignJitterMinutes,
  consumeRetrySlot,
  setLastAttemptTimestamp,
  checkManualCooldown,
  recordManualCooldown,
  getSettings,
  checkStorageCapacity,
  addExecutionLog
} from '../services/storage-service.js';
import { incrementReviewSuccessCount } from '../services/review-prompt-service.js';
import { toGaGameKey, sendGAEvent } from '../services/analytics-service.js';
import { isNetworkException } from '../services/http-client.js';
import { isNotLoggedIn } from '../services/hoyo-api.js';

export const LOGIN_NOTIFICATION_PREFIX = 'login_required_';
export const SIGN_LOGIN_NOTIFICATION_PREFIX = 'sign_login_required_';
export const SIGN_CAPTCHA_NOTIFICATION_PREFIX = 'sign_captcha_';

const NOTIFICATION_ROUTES = [
  {
    prefix: LOGIN_NOTIFICATION_PREFIX,
    resolveUrl: (gameKey, lang) => getGameLocalized(gameKey, lang)?.giftSiteUrl
  },
  {
    prefix: SIGN_LOGIN_NOTIFICATION_PREFIX,
    resolveUrl: (gameKey) => GAMES[gameKey]?.checkInSiteUrl
  },
  {
    prefix: SIGN_CAPTCHA_NOTIFICATION_PREFIX,
    resolveUrl: (gameKey) => GAMES[gameKey]?.checkInSiteUrl
  }
];

export async function handleNotificationClick(notificationId) {
  const route = NOTIFICATION_ROUTES.find(r => notificationId.startsWith(r.prefix));
  if (!route) return;

  const gameKey = notificationId.slice(route.prefix.length);
  const settings = await getSettings();
  const lang = resolveLanguage(settings?.language);

  await sendGAEvent('ui_action', {
    action_type: 'notification_click',
    game: toGaGameKey(gameKey),
    lang
  });

  const targetUrl = route.resolveUrl(gameKey, lang);
  if (targetUrl) {
    await chrome.tabs.create({ url: targetUrl });
    chrome.notifications.clear(notificationId);
  }
}

export function notifyLoginRequired(prefix, gameKey, msgKey, gameName, lang) {
  chrome.notifications.create(`${prefix}${gameKey}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: t('notifLoginTitle', [], lang),
    message: t(msgKey, [gameName], lang)
  });
}

export function getNextDailySignTimestamp(nowMs = Date.now(), jitterMinutes = 0) {
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

export async function setupUninstallUrl() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.setUninstallURL) {
    try {
      await chrome.runtime.setUninstallURL(UNINSTALL_URL);
    } catch (err) {
      console.warn('Failed to set uninstall URL:', err);
    }
  }
}

export async function setupAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAMES.AUTO_REDEEM);
  if (!existing || existing.periodInMinutes !== API_CONFIG.REDEEM_INTERVAL_MINUTES) {
    await chrome.alarms.create(ALARM_NAMES.AUTO_REDEEM, {
      periodInMinutes: API_CONFIG.REDEEM_INTERVAL_MINUTES
    });
  }
}

export async function setupDailySignAlarm() {
  const { minutes, created } = await getOrCreateDailySignJitterMinutes();
  const existing = await chrome.alarms.get(ALARM_NAMES.DAILY_SIGN);
  if (created || !existing || existing.periodInMinutes !== 1440) {
    await chrome.alarms.create(ALARM_NAMES.DAILY_SIGN, {
      when: getNextDailySignTimestamp(Date.now(), minutes),
      periodInMinutes: 1440
    });
  }
}

async function scheduleAlarmWithLimit(
  alarmName,
  kind,
  category,
  logKey,
  exhaustedLogKey,
  explicitDelayMinutes = null
) {
  const existing = await chrome.alarms.get(alarmName);
  if (existing) {
    return { scheduled: false, exhausted: false, alreadyScheduled: true };
  }

  const slot = await consumeRetrySlot(kind, { explicitDelayMinutes });
  const settings = await getSettings();
  const lang = resolveLanguage(settings.language);

  if (!slot.allowed) {
    if (slot.shouldLogExhausted) {
      await addExecutionLog({
        type: 'WARN',
        category,
        message: t(exhaustedLogKey, [slot.maxAttempts], lang)
      });
    }
    return { scheduled: false, exhausted: true, attempt: slot.attempt };
  }

  await chrome.alarms.create(alarmName, {
    delayInMinutes: slot.delayMinutes
  });
  await addExecutionLog({
    type: 'INFO',
    category,
    message: t(logKey, [slot.baseMinutes, slot.attempt, slot.maxAttempts], lang)
  });
  return {
    scheduled: true,
    exhausted: false,
    delayMinutes: slot.delayMinutes,
    attempt: slot.attempt
  };
}

export async function scheduleRetryAlarm(explicitDelayMinutes = null) {
  return scheduleAlarmWithLimit(
    ALARM_NAMES.RETRY,
    'REDEEM',
    'CODE',
    'logRetryRedeem',
    'logRetryExhaustedRedeem',
    explicitDelayMinutes
  );
}

export async function clearRetryAlarm() {
  await chrome.alarms.clear(ALARM_NAMES.RETRY);
}

export async function scheduleSignRetryAlarm(explicitDelayMinutes = null) {
  return scheduleAlarmWithLimit(
    ALARM_NAMES.SIGN_RETRY,
    'SIGN',
    'SIGN',
    'logRetrySign',
    'logRetryExhaustedSign',
    explicitDelayMinutes
  );
}

export async function clearSignRetryAlarm() {
  await chrome.alarms.clear(ALARM_NAMES.SIGN_RETRY);
}

async function pingServiceWorkerKeepAlive() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session?.get) {
      await chrome.storage.session.get('lock_state');
    }
  } catch {
    // keepalive ping の失敗でキャッチアップ本体を止めない
  }
}

/**
 * キャッチアップ実行前の待機を Service Worker 停止防止のため分割実行する
 */
export async function waitCatchUpDelay({
  totalDelayMs = computeJitteredDelayMs(
    API_CONFIG.CATCH_UP_DELAY_MS,
    API_CONFIG.CATCH_UP_JITTER_MAX_MS
  ),
  maxStepMs = API_CONFIG.CATCH_UP_KEEPALIVE_INTERVAL_MS,
  sleepFn = (ms) => new Promise(r => setTimeout(r, ms)),
  pingFn = pingServiceWorkerKeepAlive
} = {}) {
  if (!Number.isFinite(totalDelayMs) || totalDelayMs <= 0) {
    return { totalWaitMs: 0, chunks: [], pingCount: 0 };
  }

  const stepLimit = (Number.isFinite(maxStepMs) && maxStepMs > 0) ? maxStepMs : totalDelayMs;
  let remainingMs = totalDelayMs;
  const chunks = [];
  let pingCount = 0;

  while (remainingMs > 0) {
    const chunkMs = Math.min(remainingMs, stepLimit);
    await sleepFn(chunkMs);
    chunks.push(chunkMs);
    remainingMs -= chunkMs;
    if (remainingMs > 0) {
      await pingFn();
      pingCount++;
    }
  }

  return { totalWaitMs: totalDelayMs, chunks, pingCount };
}

/**
 * HTTP 429 / 5xx 等のバックオフ要求応答を共通処理する
 */
export async function handleHttpBackoffResponse({
  gameKey,
  gameName,
  category,
  gaEventName,
  trigger,
  lang,
  res
}) {
  const backoff = await recordBackoffFailure({ retryAfterMs: res.retryAfterMs });
  const errorReason = res.isRateLimited ? 'rate_limited' : 'server_error';
  await sendGAEvent(gaEventName, {
    game: toGaGameKey(gameKey),
    status: 'failed',
    error_reason: errorReason,
    trigger,
    lang
  });
  const boMsg = t('logHttpBackoff', [gameName, res.httpStatus, backoff.remainingMinutes], lang);
  await addExecutionLog({ type: 'WARN', category, gameKey, message: boMsg });
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

/**
 * ゲーム単位の失敗時の GA 送信・ERROR ログ記録・未ログイン通知を共通処理する
 */
export async function reportGameFailure({
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
    const errorReason = notLoggedIn ? 'not_logged_in' : fallbackErrorReason;
    await sendGAEvent(gaEvent, {
      game: toGaGameKey(gameKey),
      status: 'failed',
      error_reason: errorReason,
      trigger,
      lang
    });
  }

  await addExecutionLog({
    type: 'ERROR',
    category,
    gameKey,
    message: errorMessage
  });

  if (notLoggedIn && notifPrefix && notifMsgKey) {
    notifyLoginRequired(notifPrefix, gameKey, notifMsgKey, gameName, lang);
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

/**
 * コード引き換え・ログインボーナス共通のマルチゲーム巡回実行パイプライン
 */
export async function executeMultiGameFlow({
  lockKey,
  triggerSource = lockKey,
  attemptKind = null,
  targetGameKey,
  category,
  countPropName,
  checkStorage = false,
  logBackoffAbort = false,
  notifyStorageWriteFailure = false,
  skippedDelayMs,
  getNormalDelayMs,
  runSingleGame,
  extractCount,
  onFullRunSuccess,
  scheduleRetry,
  clearRetry = null,
  resetRetry = null,
  exceptionLogKey
}) {
  const lockAcquired = await acquireExecutionLock(lockKey);
  if (!lockAcquired) {
    return { success: false, reason: 'ALREADY_RUNNING' };
  }

  const settings = await getSettings();
  const lang = resolveLanguage(settings.language);

  try {
    const backoff = await getBackoffState();
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
      const manualCooldown = await checkManualCooldown(category, targetGameKey);
      if (!manualCooldown.allowed) {
        return {
          success: false,
          reason: 'MANUAL_COOLDOWN',
          remainingSec: manualCooldown.remainingSec,
          gameKey: targetGameKey
        };
      }
    }

    if (checkStorage) {
      const cap = await checkStorageCapacity();
      if (cap.isWarning) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: t('notifStorageWarningTitle', [], lang),
          message: t('notifStorageWarningMsg', [], lang)
        });
      }
    }

    const enabledGames = (settings && Array.isArray(settings.enabledGames) && settings.enabledGames.length > 0)
      ? settings.enabledGames
      : Object.keys(GAMES);

    if (targetGameKey && !enabledGames.includes(targetGameKey)) {
      return {
        success: false,
        reason: t('errDisabledGameKey', [targetGameKey], lang),
        gameKey: targetGameKey
      };
    }

    if (triggerSource === 'MANUAL' && targetGameKey) {
      await recordManualCooldown(category, targetGameKey);
      if (resetRetry) {
        await resetRetry();
      }
    } else if (!targetGameKey && attemptKind) {
      await setLastAttemptTimestamp(attemptKind);
    }

    const gameKeys = targetGameKey ? [targetGameKey] : enabledGames;
    const results = {};
    let totalCount = 0;
    let hadBackoff = false;

    for (let i = 0; i < gameKeys.length; i++) {
      const gKey = gameKeys[i];
      const currentBackoff = await getBackoffState();
      if (currentBackoff.isActive) {
        hadBackoff = true;
        if (logBackoffAbort) {
          const localized = getGameLocalized(gKey, lang);
          await addExecutionLog({
            type: 'WARN',
            category,
            gameKey: gKey,
            message: t('logBackoffAbort', [localized.name], lang)
          });
        }
        break;
      }

      const res = await runSingleGame(gKey, lang);
      results[gKey] = res;
      totalCount += extractCount(res);

      if (res?.backoffTriggered) {
        hadBackoff = true;
        break;
      }

      if (i < gameKeys.length - 1) {
        const delayMs = res.skipped ? skippedDelayMs : getNormalDelayMs();
        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }

    if (totalCount > 0) {
      await incrementReviewSuccessCount();
    }

    if (hadBackoff) {
      if (clearRetry) {
        await clearRetry();
      }
      const latestBackoff = await getBackoffState();
      return {
        success: false,
        reason: 'UNDER_BACKOFF',
        remainingMinutes: latestBackoff.remainingMinutes,
        [countPropName]: totalCount,
        results,
        targetGameKey: targetGameKey || null
      };
    }

    await resetBackoffLevel();

    if (!targetGameKey && onFullRunSuccess) {
      await onFullRunSuccess();
    }

    return {
      success: true,
      [countPropName]: totalCount,
      results,
      targetGameKey: targetGameKey || null
    };
  } catch (err) {
    if (notifyStorageWriteFailure && err?.message?.startsWith('STORAGE_WRITE_FAILURE')) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: t('notifStorageErrorTitle', [], lang),
        message: t('notifStorageErrorMsg', [], lang)
      });
    }

    const isNetErr = isNetworkException(err);
    let retryExhausted = false;
    if (isNetErr) {
      const retryRes = await scheduleRetry();
      retryExhausted = Boolean(retryRes?.exhausted);
    } else {
      await addExecutionLog({
        type: 'ERROR',
        category,
        message: t(exceptionLogKey, [err.message], lang)
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
    await releaseExecutionLock();
  }
}

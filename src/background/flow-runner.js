import { GAMES, API_CONFIG, ALARM_NAMES, UNINSTALL_URL } from '../config/constants.js';
import { resolveLanguage, getGameLocalized, t } from '../utils/i18n.js';
import {
  acquireExecutionLock,
  releaseExecutionLock,
  isUnderBackoff,
  getSettings,
  checkStorageCapacity,
  addExecutionLog
} from '../services/storage-service.js';
import { incrementReviewSuccessCount } from '../services/review-prompt-service.js';
import { toGaGameKey, sendGAEvent } from '../services/analytics-service.js';

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

export function getNextDailySignTimestamp(nowMs = Date.now()) {
  const utc8OffsetMs = 8 * 60 * 60 * 1000;
  const utc8Date = new Date(nowMs + utc8OffsetMs);
  const targetUtc8 = Date.UTC(
    utc8Date.getUTCFullYear(),
    utc8Date.getUTCMonth(),
    utc8Date.getUTCDate(),
    0, 5, 0, 0
  );
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
  const existing = await chrome.alarms.get(ALARM_NAMES.DAILY_SIGN);
  if (!existing || existing.periodInMinutes !== 1440) {
    await chrome.alarms.create(ALARM_NAMES.DAILY_SIGN, {
      when: getNextDailySignTimestamp(),
      periodInMinutes: 1440
    });
  }
}

async function scheduleAlarmWithLog(alarmName, delayMinutes, category, logKey) {
  const existing = await chrome.alarms.get(alarmName);
  if (!existing) {
    await chrome.alarms.create(alarmName, {
      delayInMinutes: delayMinutes
    });
    const settings = await getSettings();
    const lang = resolveLanguage(settings.language);
    await addExecutionLog({
      type: 'INFO',
      category,
      message: t(logKey, [delayMinutes], lang)
    });
  }
}

export async function scheduleRetryAlarm(delayMinutes = API_CONFIG.RETRY_INTERVAL_MINUTES) {
  await scheduleAlarmWithLog(ALARM_NAMES.RETRY, delayMinutes, 'CODE', 'logRetryRedeem');
}

export async function clearRetryAlarm() {
  await chrome.alarms.clear(ALARM_NAMES.RETRY);
}

export async function scheduleSignRetryAlarm(delayMinutes = API_CONFIG.RETRY_INTERVAL_MINUTES) {
  await scheduleAlarmWithLog(ALARM_NAMES.SIGN_RETRY, delayMinutes, 'SIGN', 'logRetrySign');
}

export async function clearSignRetryAlarm() {
  await chrome.alarms.clear(ALARM_NAMES.SIGN_RETRY);
}

function isNetworkException(err) {
  return Boolean(
    err?.message && (
      err.message.includes('fetch') ||
      err.message.includes('Network') ||
      err.message.includes('TIMEOUT')
    )
  );
}

/**
 * コード引き換え・ログインボーナス共通のマルチゲーム巡回実行パイプライン
 */
export async function executeMultiGameFlow({
  lockKey,
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
  exceptionLogKey
}) {
  const lockAcquired = await acquireExecutionLock(lockKey);
  if (!lockAcquired) {
    return { success: false, reason: 'ALREADY_RUNNING' };
  }

  const settings = await getSettings();
  const lang = resolveLanguage(settings.language);

  try {
    if (await isUnderBackoff()) {
      return { success: false, reason: 'UNDER_BACKOFF' };
    }

    if (targetGameKey && !GAMES[targetGameKey]) {
      return { success: false, reason: `未知のゲームキー: ${targetGameKey}` };
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
        reason: `非表示または無効化されたゲームです: ${targetGameKey}`,
        gameKey: targetGameKey
      };
    }

    const gameKeys = targetGameKey ? [targetGameKey] : enabledGames;
    const results = {};
    let totalCount = 0;

    for (let i = 0; i < gameKeys.length; i++) {
      const gKey = gameKeys[i];
      if (await isUnderBackoff()) {
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

      if (i < gameKeys.length - 1) {
        const delayMs = res.skipped ? skippedDelayMs : getNormalDelayMs();
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    if (!targetGameKey && onFullRunSuccess) {
      await onFullRunSuccess();
    }

    if (totalCount > 0) {
      await incrementReviewSuccessCount();
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
    if (isNetErr) {
      await scheduleRetry(API_CONFIG.RETRY_INTERVAL_MINUTES);
    } else {
      await addExecutionLog({
        type: 'ERROR',
        category,
        message: t(exceptionLogKey, [err.message], lang)
      });
    }

    return {
      success: false,
      reason: isNetErr ? 'NETWORK_RETRY_SCHEDULED' : 'EXCEPTION',
      error: err.message
    };
  } finally {
    await releaseExecutionLock();
  }
}

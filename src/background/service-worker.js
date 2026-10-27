import { GAMES, API_CONFIG, STATUS_MAP, ALARM_NAMES, UNINSTALL_URL } from '../config/constants.js';
import { resolveLanguage, getGameLocalized, t } from '../utils/i18n.js';
import {
  acquireExecutionLock,
  releaseExecutionLock,
  isUnderBackoff,
  setBackoff,
  getSettings,
  checkStorageCapacity,
  canAcceptNewCode,
  getRedeemedCodes,
  markCodeStatus,
  pruneHistoryIfExceeded,
  addExecutionLog,
  getLastSuccessfulRun,
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
import { fetchValidCodes } from '../services/code-fetcher.js';
import { getUserGameRoles, redeemCode, getDailySignInfo, claimDailyBonus } from '../services/hoyo-api.js';
import {
  toGaGameKey,
  toRedeemTrigger,
  toCheckinTrigger,
  syncConsentBadge,
  sendGAEvent
} from '../services/analytics-service.js';

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

export async function scheduleRetryAlarm(delayMinutes = API_CONFIG.RETRY_INTERVAL_MINUTES) {
  const existing = await chrome.alarms.get(ALARM_NAMES.RETRY);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAMES.RETRY, {
      delayInMinutes: delayMinutes
    });
    const settings = await getSettings();
    const lang = resolveLanguage(settings.language);
    await addExecutionLog({
      type: 'INFO',
      category: 'CODE',
      message: t('logRetryRedeem', [delayMinutes], lang)
    });
  }
}

export async function clearRetryAlarm() {
  await chrome.alarms.clear(ALARM_NAMES.RETRY);
}

export async function scheduleSignRetryAlarm(delayMinutes = API_CONFIG.RETRY_INTERVAL_MINUTES) {
  const existing = await chrome.alarms.get(ALARM_NAMES.SIGN_RETRY);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAMES.SIGN_RETRY, {
      delayInMinutes: delayMinutes
    });
    const settings = await getSettings();
    const lang = resolveLanguage(settings.language);
    await addExecutionLog({
      type: 'INFO',
      category: 'SIGN',
      message: t('logRetrySign', [delayMinutes], lang)
    });
  }
}

export async function clearSignRetryAlarm() {
  await chrome.alarms.clear(ALARM_NAMES.SIGN_RETRY);
}

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

  let signResult = false;
  if (needSign) {
    signResult = await runDailySignFlow(triggerSource);
  }

  let redeemResult = false;
  if (needRedeem) {
    redeemResult = await runAutoRedeemFlow(triggerSource);
  }

  return { signResult, redeemResult };
}

export const LOGIN_NOTIFICATION_PREFIX = 'login_required_';
export const SIGN_LOGIN_NOTIFICATION_PREFIX = 'sign_login_required_';
export const SIGN_CAPTCHA_NOTIFICATION_PREFIX = 'sign_captcha_';

export async function handleNotificationClick(notificationId) {
  if (notificationId.startsWith(LOGIN_NOTIFICATION_PREFIX)) {
    const gameKey = notificationId.slice(LOGIN_NOTIFICATION_PREFIX.length);
    const settings = await getSettings();
    const lang = resolveLanguage(settings?.language);
    await sendGAEvent('ui_action', {
      action_type: 'notification_click',
      game: toGaGameKey(gameKey),
      lang
    });
    const localized = getGameLocalized(gameKey, lang);
    if (localized?.giftSiteUrl) {
      await chrome.tabs.create({ url: localized.giftSiteUrl });
      chrome.notifications.clear(notificationId);
    }
    return;
  }

  if (notificationId.startsWith(SIGN_LOGIN_NOTIFICATION_PREFIX)) {
    const gameKey = notificationId.slice(SIGN_LOGIN_NOTIFICATION_PREFIX.length);
    const settings = await getSettings();
    const lang = resolveLanguage(settings?.language);
    await sendGAEvent('ui_action', {
      action_type: 'notification_click',
      game: toGaGameKey(gameKey),
      lang
    });
    const gameConfig = GAMES[gameKey];
    if (gameConfig?.checkInSiteUrl) {
      await chrome.tabs.create({ url: gameConfig.checkInSiteUrl });
      chrome.notifications.clear(notificationId);
    }
    return;
  }

  if (notificationId.startsWith(SIGN_CAPTCHA_NOTIFICATION_PREFIX)) {
    const gameKey = notificationId.slice(SIGN_CAPTCHA_NOTIFICATION_PREFIX.length);
    const settings = await getSettings();
    const lang = resolveLanguage(settings?.language);
    await sendGAEvent('ui_action', {
      action_type: 'notification_click',
      game: toGaGameKey(gameKey),
      lang
    });
    const gameConfig = GAMES[gameKey];
    if (gameConfig?.checkInSiteUrl) {
      await chrome.tabs.create({ url: gameConfig.checkInSiteUrl });
      chrome.notifications.clear(notificationId);
    }
  }
}

chrome.notifications.onClicked.addListener(handleNotificationClick);

chrome.runtime.onInstalled.addListener(async () => {
  await setupUninstallUrl();
  await setupAlarm();
  await setupDailySignAlarm();
  await syncConsentBadge();
  await getOrCreateGaClientId();
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

  if (message.type === 'TRIGGER_MANUAL_REDEEM') {
    runAutoRedeemFlow('MANUAL', message.gameKey)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'TRIGGER_MANUAL_SIGN') {
    runDailySignFlow('MANUAL', message.gameKey)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'TRIGGER_INITIAL_CATCH_UP') {
    maybeRunAllCatchUp('INITIAL_RUN', true)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'TRACK_GA_EVENT') {
    sendGAEvent(message.eventName, message.params)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

export async function redeemForGame(gameKey, lang = 'ja', triggerSource = 'ALARM') {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: `未知のゲームキー: ${gameKey}`, gameKey };
  }

  const trigger = toRedeemTrigger(triggerSource);
  const localizedGame = getGameLocalized(gameKey, lang);
  const gameName = localizedGame.name;

  const roleRes = await getUserGameRoles(gameConfig.gameBiz, lang);
  if (!roleRes.success) {
    // 未プレイまたはキャラクター未作成の場合（retcode: -1 または -2）
    if (roleRes.retcode === -1 || roleRes.retcode === -2) {
      await addExecutionLog({
        type: 'INFO',
        category: 'CODE',
        gameKey,
        message: t('logNoCharSkip', [gameName], lang)
      });
      return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName };
    }

    // 未引換コードが存在する場合のみ、または手動実行の場合のみ失敗イベントを記録
    const activeCodes = (await getActiveCodes(gameConfig.gameBiz)) || [];
    const redeemed = await getRedeemedCodes(gameConfig.gameBiz);
    const hasPendingCodes = activeCodes.some(cd => {
      const entry = redeemed[cd];
      return !entry || (entry.s !== STATUS_MAP.SUCCESS && entry.s !== STATUS_MAP.ALREADY_CLAIMED && entry.s !== STATUS_MAP.EXPIRED && entry.s !== STATUS_MAP.FAILED);
    });
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

    // 未ログイン・セッション期限切れ（retcode: -100 または -1071）
    const errorMsg = `${gameName}: ロール取得失敗 (${roleRes.message} [retcode: ${roleRes.retcode}])`;
    await addExecutionLog({ type: 'ERROR', category: 'CODE', gameKey, message: errorMsg });

    if (roleRes.retcode === -100 || roleRes.retcode === -1071) {
      chrome.notifications.create(`${LOGIN_NOTIFICATION_PREFIX}${gameKey}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: t('notifLoginTitle', [], lang),
        message: t('notifLoginMsgRedeem', [gameName], lang)
      });
    }
    return { success: false, skipped: false, reason: errorMsg, retcode: roleRes.retcode, gameKey, gameName };
  }

  const role = roleRes.role;
  let activeCodes = [];
  try {
    activeCodes = await fetchValidCodes(gameKey);
    await setActiveCodes(gameConfig.gameBiz, activeCodes);
  } catch (fetchErr) {
    let httpStatus = 0;
    const match = fetchErr.message && fetchErr.message.match(/HTTP_ERROR_(\d+)/);
    if (match) {
      httpStatus = parseInt(match[1], 10);
    }
    const isTimeout = fetchErr.name === 'AbortError' || (fetchErr.message && fetchErr.message.includes('TIMEOUT'));
    const isParseErr = fetchErr instanceof SyntaxError || (fetchErr.message && fetchErr.message.includes('JSON'));
    const errorType = isTimeout ? 'timeout' : (httpStatus > 0 ? 'http_error' : (isParseErr ? 'parse_error' : 'network_error'));
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
    if (entry && (entry.s === STATUS_MAP.SUCCESS || entry.s === STATUS_MAP.ALREADY_CLAIMED || entry.s === STATUS_MAP.EXPIRED || entry.s === STATUS_MAP.FAILED)) {
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
      uid: role.game_uid,
      region: role.region,
      cdkey,
      lang
    });

    let status = 'failed';
    let errorReason = 'unknown';

    if (res.retcode === 0) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'SUCCESS');
      redeemedCount++;
      status = 'success';
      errorReason = 'none';
    } else if (res.retcode === -2017) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'ALREADY_CLAIMED');
      status = 'already_claimed';
      errorReason = 'none';
    } else if (res.retcode === -2001) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'EXPIRED');
      status = 'expired';
      errorReason = 'none';
    } else if (res.retcode === -2016) {
      await setBackoff();
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'RETRY');
      status = 'cooldown';
      errorReason = 'cooldown';
    } else if (res.retcode === -100 || res.retcode === -1071) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'RETRY');
      status = 'failed';
      errorReason = 'not_logged_in';
    } else {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'RETRY');
      status = 'failed';
      errorReason = 'unknown';
    }

    await sendGAEvent('code_redeem_result', {
      game: toGaGameKey(gameKey),
      status,
      error_reason: errorReason,
      trigger,
      lang
    });

    if (res.retcode === -2016 || res.retcode === -100 || res.retcode === -1071) {
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
  const lockAcquired = await acquireExecutionLock(triggerSource);
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

    const cap = await checkStorageCapacity();
    if (cap.isWarning) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: t('notifStorageWarningTitle', [], lang),
        message: t('notifStorageWarningMsg', [], lang)
      });
    }

    const enabledGames = (settings && Array.isArray(settings.enabledGames) && settings.enabledGames.length > 0)
      ? settings.enabledGames
      : Object.keys(GAMES);

    if (targetGameKey && !enabledGames.includes(targetGameKey)) {
      return { success: false, reason: `非表示または無効化されたゲームです: ${targetGameKey}`, gameKey: targetGameKey };
    }

    const gameKeys = targetGameKey ? [targetGameKey] : enabledGames;
    const results = {};
    let totalRedeemed = 0;

    for (let i = 0; i < gameKeys.length; i++) {
      const gKey = gameKeys[i];
      const localized = getGameLocalized(gKey, lang);
      if (await isUnderBackoff()) {
        await addExecutionLog({
          type: 'WARN',
          category: 'CODE',
          gameKey: gKey,
          message: t('logBackoffAbort', [localized.name], lang)
        });
        break;
      }

      const res = await redeemForGame(gKey, lang, triggerSource);
      results[gKey] = res;
      if (res.success && !res.skipped && res.redeemedCount) {
        totalRedeemed += res.redeemedCount;
      }

      // 次のゲームへ進む前の待機（最後のゲームを除く）
      if (i < gameKeys.length - 1) {
        const delayMs = res.skipped ? 500 : API_CONFIG.INTER_REQUEST_DELAY_MS;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    if (!targetGameKey) {
      await setLastSuccessfulRun(Date.now());
      await clearRetryAlarm();
    }

    return {
      success: true,
      redeemedCount: totalRedeemed,
      results,
      targetGameKey: targetGameKey || null
    };
  } catch (err) {
    if (err.message && err.message.startsWith('STORAGE_WRITE_FAILURE')) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: t('notifStorageErrorTitle', [], lang),
        message: t('notifStorageErrorMsg', [], lang)
      });
    }

    const isNetworkError = err.message && (
      err.message.includes('fetch') ||
      err.message.includes('Network') ||
      err.message.includes('TIMEOUT')
    );

    if (isNetworkError) {
      await scheduleRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
    } else {
      await addExecutionLog({
        type: 'ERROR',
        category: 'CODE',
        message: t('logExceptionRedeem', [err.message], lang)
      });
    }

    return {
      success: false,
      reason: isNetworkError ? 'NETWORK_RETRY_SCHEDULED' : 'EXCEPTION',
      error: err.message
    };
  } finally {
    await releaseExecutionLock();
  }
}

export async function signForGame(gameKey, options = {}, lang = 'ja', triggerSource = 'DAILY_ALARM') {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: `未知のゲームキー: ${gameKey}`, gameKey };
  }

  const trigger = toCheckinTrigger(triggerSource);
  const localizedGame = getGameLocalized(gameKey, lang);
  const gameName = localizedGame.name;

  const forceCheck = !!options.forceCheck;
  if (!forceCheck) {
    const alreadyDone = await isDailySignedToday(gameConfig.gameBiz);
    if (alreadyDone) {
      return {
        success: true,
        skipped: true,
        alreadySigned: true,
        reason: 'ALREADY_SIGNED_TODAY',
        gameKey,
        gameName
      };
    }
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
      chrome.notifications.create(`${SIGN_LOGIN_NOTIFICATION_PREFIX}${gameKey}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: t('notifLoginTitle', [], lang),
        message: t('notifLoginMsgSign', [gameName], lang)
      });
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
    const msg = claimRes.alreadySigned
      ? t('logSignAlready', [gameName, daysSuffix], lang)
      : t('logSignDone', [gameName, daysSuffix], lang);

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
    chrome.notifications.create(`${SIGN_LOGIN_NOTIFICATION_PREFIX}${gameKey}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('notifLoginTitle', [], lang),
      message: t('notifLoginMsgSign', [gameName], lang)
    });
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
  const lockAcquired = await acquireExecutionLock(`SIGN_${triggerSource}`);
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

    const enabledGames = (settings && Array.isArray(settings.enabledGames) && settings.enabledGames.length > 0)
      ? settings.enabledGames
      : Object.keys(GAMES);

    if (targetGameKey && !enabledGames.includes(targetGameKey)) {
      return { success: false, reason: `非表示または無効化されたゲームです: ${targetGameKey}`, gameKey: targetGameKey };
    }

    const gameKeys = targetGameKey ? [targetGameKey] : enabledGames;
    const results = {};
    let signedCount = 0;

    for (let i = 0; i < gameKeys.length; i++) {
      const gKey = gameKeys[i];
      if (await isUnderBackoff()) {
        break;
      }

      const res = await signForGame(gKey, { forceCheck: !!targetGameKey }, lang, triggerSource);
      results[gKey] = res;
      if (res.success && res.signed) {
        signedCount++;
      }

      if (i < gameKeys.length - 1) {
        const delayMs = res.skipped ? 200 : 1_500;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    if (!targetGameKey) {
      await clearSignRetryAlarm();
    }

    return {
      success: true,
      signedCount,
      results,
      targetGameKey: targetGameKey || null
    };
  } catch (err) {
    const isNetworkError = err.message && (
      err.message.includes('fetch') ||
      err.message.includes('Network') ||
      err.message.includes('TIMEOUT')
    );

    if (isNetworkError) {
      await scheduleSignRetryAlarm(API_CONFIG.RETRY_INTERVAL_MINUTES);
    } else {
      await addExecutionLog({
        type: 'ERROR',
        category: 'SIGN',
        message: t('logExceptionSign', [err.message], lang)
      });
    }

    return {
      success: false,
      reason: isNetworkError ? 'NETWORK_RETRY_SCHEDULED' : 'EXCEPTION',
      error: err.message
    };
  } finally {
    await releaseExecutionLock();
  }
}


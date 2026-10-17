import { GAMES, API_CONFIG, STATUS_MAP, ALARM_NAMES } from '../config/constants.js';
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
  shouldRunDailySign
} from '../services/storage-service.js';
import { fetchValidCodes } from '../services/code-fetcher.js';
import { getUserGameRoles, redeemCode, getDailySignInfo, claimDailyBonus } from '../services/hoyo-api.js';

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
    await addExecutionLog({
      type: 'INFO',
      category: 'CODE',
      message: `一時的な通信不通を検知したため、${delayMinutes}分後に自動再試行します`
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
    await addExecutionLog({
      type: 'INFO',
      category: 'SIGN',
      message: `ログインボーナス通信不通のため、${delayMinutes}分後に自動再試行します`
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

  const gameBizList = Object.values(GAMES).map(g => g.gameBiz);
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

export async function maybeRunAllCatchUp(triggerSource = 'STARTUP') {
  const settings = await getSettings();
  if (!settings.optInAccepted) return { signResult: false, redeemResult: false };

  const gameBizList = Object.values(GAMES).map(g => g.gameBiz);
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

  if (API_CONFIG.CATCH_UP_DELAY_MS > 0) {
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
    const gameConfig = GAMES[gameKey];
    if (gameConfig?.giftSiteUrl) {
      await chrome.tabs.create({ url: gameConfig.giftSiteUrl });
      chrome.notifications.clear(notificationId);
    }
    return;
  }

  if (notificationId.startsWith(SIGN_LOGIN_NOTIFICATION_PREFIX)) {
    const gameKey = notificationId.slice(SIGN_LOGIN_NOTIFICATION_PREFIX.length);
    const gameConfig = GAMES[gameKey];
    if (gameConfig?.checkInSiteUrl) {
      await chrome.tabs.create({ url: gameConfig.checkInSiteUrl });
      chrome.notifications.clear(notificationId);
    }
    return;
  }

  if (notificationId.startsWith(SIGN_CAPTCHA_NOTIFICATION_PREFIX)) {
    const gameKey = notificationId.slice(SIGN_CAPTCHA_NOTIFICATION_PREFIX.length);
    const gameConfig = GAMES[gameKey];
    if (gameConfig?.checkInSiteUrl) {
      await chrome.tabs.create({ url: gameConfig.checkInSiteUrl });
      chrome.notifications.clear(notificationId);
    }
  }
}

chrome.notifications.onClicked.addListener(handleNotificationClick);

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarm();
  await setupDailySignAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  await setupDailySignAlarm();
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
});

export async function redeemForGame(gameKey) {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: `未知のゲームキー: ${gameKey}`, gameKey };
  }

  const roleRes = await getUserGameRoles(gameConfig.gameBiz);
  if (!roleRes.success) {
    // 未プレイまたはキャラクター未作成の場合（retcode: -1 または -2）
    if (roleRes.retcode === -1 || roleRes.retcode === -2) {
      await addExecutionLog({
        type: 'INFO',
        category: 'CODE',
        message: `${gameConfig.name}: キャラクターが見つからないためスキップしました`
      });
      return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName: gameConfig.name };
    }

    // 未ログイン・セッション期限切れ（retcode: -100 または -1071）
    const errorMsg = `${gameConfig.name}: ロール取得失敗 (${roleRes.message} [retcode: ${roleRes.retcode}])`;
    await addExecutionLog({ type: 'ERROR', category: 'CODE', message: errorMsg });

    if (roleRes.retcode === -100 || roleRes.retcode === -1071) {
      chrome.notifications.create(`${LOGIN_NOTIFICATION_PREFIX}${gameKey}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'ログインが必要です',
        message: `${gameConfig.name}の公式サイトで再ログインしてください。`
      });
    }
    return { success: false, skipped: false, reason: errorMsg, retcode: roleRes.retcode, gameKey, gameName: gameConfig.name };
  }

  const role = roleRes.role;
  const activeCodes = await fetchValidCodes(gameKey);
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
        await addExecutionLog({ type: 'WARN', message: `${gameConfig.name}: 1日の新規コード受付上限(20件)に達したためスキップしました。` });
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
      cdkey
    });

    if (res.retcode === 0) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'SUCCESS');
      redeemedCount++;
    } else if (res.retcode === -2017) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'ALREADY_CLAIMED');
    } else if (res.retcode === -2001) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'EXPIRED');
    } else if (res.retcode === -2016) {
      await setBackoff();
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'RETRY');
      break;
    } else if (res.retcode === -100 || res.retcode === -1071) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'RETRY');
      break;
    } else {
      await markCodeStatus(gameConfig.gameBiz, cdkey, 'RETRY');
    }
  }

  await pruneHistoryIfExceeded(gameConfig.gameBiz, activeCodes);
  await addExecutionLog({
    type: 'INFO',
    category: 'CODE',
    message: `${gameConfig.name}: 引き換え完了 (新規成功: ${redeemedCount}件)`
  });

  return { success: true, skipped: false, redeemedCount, gameKey, gameName: gameConfig.name };
}

export async function runAutoRedeemFlow(triggerSource = 'ALARM', targetGameKey = null) {
  const lockAcquired = await acquireExecutionLock(triggerSource);
  if (!lockAcquired) {
    return { success: false, reason: 'ALREADY_RUNNING' };
  }

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
        title: '容量警告',
        message: '拡張機能の保存容量が80%を超過しています。整理を推奨します。'
      });
    }

    const gameKeys = targetGameKey ? [targetGameKey] : Object.keys(GAMES);
    const results = {};
    let totalRedeemed = 0;

    for (let i = 0; i < gameKeys.length; i++) {
      const gKey = gameKeys[i];
      if (await isUnderBackoff()) {
        await addExecutionLog({ type: 'WARN', category: 'CODE', message: `バックオフ発動中のため ${GAMES[gKey]?.name || gKey} 以降の処理を中断しました。` });
        break;
      }

      const res = await redeemForGame(gKey);
      results[gKey] = res;
      if (res.success && !res.skipped && res.redeemedCount) {
        totalRedeemed += res.redeemedCount;
      }

      // 次のゲームへ進む前の待機（最後のゲームを除く）
      if (i < gameKeys.length - 1) {
        // 引き換え処理を行ったゲームの後はインターバル待機、スキップ時は短縮
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
        title: '拡張機能エラー',
        message: 'ストレージ容量が上限に達したため、自動実行を停止しました。'
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
      await addExecutionLog({ type: 'ERROR', category: 'CODE', message: `例外発生: ${err.message}` });
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

export async function signForGame(gameKey, options = {}) {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: `未知のゲームキー: ${gameKey}`, gameKey };
  }

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
        gameName: gameConfig.name
      };
    }
  }

  const roleRes = await getUserGameRoles(gameConfig.gameBiz);
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
        message: `${gameConfig.name}: [ログボ] キャラクターが見つからないためスキップしました`
      });
      return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName: gameConfig.name };
    }

    const errorMsg = `${gameConfig.name}: [ログボ] ロール取得失敗 (${roleRes.message} [retcode: ${roleRes.retcode}])`;
    await addExecutionLog({ type: 'ERROR', category: 'SIGN', message: errorMsg });

    if (roleRes.retcode === -100 || roleRes.retcode === -1071) {
      chrome.notifications.create(`${SIGN_LOGIN_NOTIFICATION_PREFIX}${gameKey}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'ログインが必要です',
        message: `${gameConfig.name}の公式ログインボーナスページでログインしてください。`
      });
    }
    return {
      success: false,
      skipped: false,
      reason: errorMsg,
      retcode: roleRes.retcode,
      gameKey,
      gameName: gameConfig.name
    };
  }

  const infoRes = await getDailySignInfo(gameConfig);
  const todayStr = (infoRes.success && infoRes.today) ? infoRes.today : getHoyoTodayDateString();

  if (infoRes.success && infoRes.isSigned) {
    await setDailySignRecord(gameConfig.gameBiz, {
      date: todayStr,
      isSigned: true,
      totalSignDay: infoRes.totalSignDay,
      skippedNoChar: false
    });
    await addExecutionLog({
      type: 'INFO',
      category: 'SIGN',
      message: `${gameConfig.name}: [ログボ] 本日受取済み (今月累計: ${infoRes.totalSignDay}日)`
    });
    return {
      success: true,
      skipped: false,
      signed: false,
      alreadySigned: true,
      totalSignDay: infoRes.totalSignDay,
      gameKey,
      gameName: gameConfig.name
    };
  }

  const claimRes = await claimDailyBonus(gameConfig);

  if (claimRes.isRisk) {
    const riskMsg = `${gameConfig.name}: [ログボ] セキュリティ認証(CAPTCHA)が必要です。公式ページから手動で受け取ってください`;
    await addExecutionLog({ type: 'WARN', category: 'SIGN', message: riskMsg });
    chrome.notifications.create(`${SIGN_CAPTCHA_NOTIFICATION_PREFIX}${gameKey}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'ログインボーナス手動確認が必要',
      message: `${gameConfig.name}でCAPTCHA認証が要求されました。クリックして公式ページから受け取ってください。`
    });
    return {
      success: false,
      skipped: false,
      isRisk: true,
      retcode: claimRes.retcode,
      reason: claimRes.message,
      gameKey,
      gameName: gameConfig.name
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

    const msg = claimRes.alreadySigned
      ? `${gameConfig.name}: [ログボ] 本日受取済み${totalSignDay ? ` (今月累計: ${totalSignDay}日)` : ''}`
      : `${gameConfig.name}: [ログボ] 受取完了${totalSignDay ? ` (今月累計: ${totalSignDay}日)` : ''}`;

    await addExecutionLog({
      type: 'INFO',
      category: 'SIGN',
      message: msg
    });

    return {
      success: true,
      skipped: false,
      signed: !claimRes.alreadySigned,
      alreadySigned: !!claimRes.alreadySigned,
      totalSignDay,
      gameKey,
      gameName: gameConfig.name
    };
  }

  const errText = `${gameConfig.name}: [ログボ] 受取失敗 (${claimRes.message} [retcode: ${claimRes.retcode}])`;
  await addExecutionLog({ type: 'ERROR', category: 'SIGN', message: errText });

  if (claimRes.retcode === -100 || claimRes.retcode === -1071) {
    chrome.notifications.create(`${SIGN_LOGIN_NOTIFICATION_PREFIX}${gameKey}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'ログインが必要です',
      message: `${gameConfig.name}の公式ログインボーナスページでログインしてください。`
    });
  }

  return {
    success: false,
    skipped: false,
    retcode: claimRes.retcode,
    reason: errText,
    gameKey,
    gameName: gameConfig.name
  };
}

export async function runDailySignFlow(triggerSource = 'DAILY_ALARM', targetGameKey = null) {
  const lockAcquired = await acquireExecutionLock(`SIGN_${triggerSource}`);
  if (!lockAcquired) {
    return { success: false, reason: 'ALREADY_RUNNING' };
  }

  try {
    if (await isUnderBackoff()) {
      return { success: false, reason: 'UNDER_BACKOFF' };
    }

    if (targetGameKey && !GAMES[targetGameKey]) {
      return { success: false, reason: `未知のゲームキー: ${targetGameKey}` };
    }

    const gameKeys = targetGameKey ? [targetGameKey] : Object.keys(GAMES);
    const results = {};
    let signedCount = 0;

    for (let i = 0; i < gameKeys.length; i++) {
      const gKey = gameKeys[i];
      if (await isUnderBackoff()) {
        break;
      }

      const res = await signForGame(gKey, { forceCheck: !!targetGameKey });
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
      await addExecutionLog({ type: 'ERROR', category: 'SIGN', message: `[ログボ] 例外発生: ${err.message}` });
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


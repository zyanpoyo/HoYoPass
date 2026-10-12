import { GAMES, API_CONFIG, STATUS_MAP } from '../config/constants.js';
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
  addExecutionLog
} from '../services/storage-service.js';
import { fetchValidCodes } from '../services/code-fetcher.js';
import { getUserGameRoles, redeemCode } from '../services/hoyo-api.js';

const ALARM_NAME = 'hoyo_auto_redeem_alarm';

export async function setupAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: API_CONFIG.REDEEM_INTERVAL_MINUTES
    });
  }
}

export const LOGIN_NOTIFICATION_PREFIX = 'login_required_';

export async function handleNotificationClick(notificationId) {
  if (notificationId.startsWith(LOGIN_NOTIFICATION_PREFIX)) {
    const gameKey = notificationId.slice(LOGIN_NOTIFICATION_PREFIX.length);
    const gameConfig = GAMES[gameKey];
    if (gameConfig?.giftSiteUrl) {
      await chrome.tabs.create({ url: gameConfig.giftSiteUrl });
      chrome.notifications.clear(notificationId);
    }
  }
}

chrome.notifications.onClicked.addListener(handleNotificationClick);

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    const settings = await getSettings();
    if (!settings.optInAccepted || !settings.autoRedeemEnabled) return;
    await runAutoRedeemFlow('ALARM');
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
        message: `${gameConfig.name}: キャラクターが見つからないためスキップしました`
      });
      return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName: gameConfig.name };
    }

    // 未ログイン・セッション期限切れ（retcode: -100 または -1071）
    const errorMsg = `${gameConfig.name}: ロール取得失敗 (${roleRes.message} [retcode: ${roleRes.retcode}])`;
    await addExecutionLog({ type: 'ERROR', message: errorMsg });

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
        await addExecutionLog({ type: 'WARN', message: `バックオフ発動中のため ${GAMES[gKey]?.name || gKey} 以降の処理を中断しました。` });
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
    await addExecutionLog({ type: 'ERROR', message: `例外発生: ${err.message}` });
    return { success: false, reason: 'EXCEPTION', error: err.message };
  } finally {
    await releaseExecutionLock();
  }
}

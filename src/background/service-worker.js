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
    runAutoRedeemFlow('MANUAL')
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

export async function runAutoRedeemFlow(triggerSource = 'MANUAL') {
  const lockAcquired = await acquireExecutionLock(triggerSource);
  if (!lockAcquired) {
    return { success: false, reason: 'ALREADY_RUNNING' };
  }

  try {
    if (await isUnderBackoff()) {
      return { success: false, reason: 'UNDER_BACKOFF' };
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

    const settings = await getSettings();
    const gameKey = settings.activeGameKey || 'GENSHIN';
    const gameConfig = GAMES[gameKey];

    const roleRes = await getUserGameRoles(gameConfig.gameBiz);
    if (!roleRes.success) {
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
      return { success: false, reason: errorMsg, retcode: roleRes.retcode };
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
          await addExecutionLog({ type: 'WARN', message: '1日の新規コード受付上限(20件)に達したためスキップしました。' });
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

    return { success: true, redeemedCount };
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

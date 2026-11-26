import { API_CONFIG } from '../config/constants.js';
import {
  acquireExecutionLock,
  releaseExecutionLock,
  pingSessionKeepAlive,
  isUnderBackoff,
  getBackoffState,
  recordBackoffFailure,
  resetBackoffLevel,
  getOrCreateDailySignJitterMinutes,
  consumeRetrySlot,
  resetRetryState,
  setLastAttemptTimestamp,
  isUnderAutoAttemptCooldown,
  checkManualCooldown,
  recordManualCooldown,
  getSettings,
  checkStorageCapacity,
  addExecutionLog,
  canAcceptNewCode,
  getRedeemedCodes,
  markCodeStatus,
  pruneHistoryIfExceeded,
  setLastSuccessfulRun,
  setActiveCodes,
  shouldRunRedeem,
  setDailySignRecord,
  isDailySignedToday,
  isDailySignAutoSkippedToday,
  shouldRunDailySign,
  getOrCreateGaClientId
} from '../services/storage-service.js';
import { initReviewPromptState, incrementReviewSuccessCount } from '../services/review-prompt-service.js';
import { syncConsentBadge, sendGAEvent } from '../services/analytics-service.js';
import { fetchValidCodes } from '../services/code-fetcher.js';
import { getUserGameRoles, redeemCode, getDailySignInfo, claimDailyBonus } from '../services/hoyo-api.js';

/**
 * Chrome MV3 ランタイム API と各種サービスを Background Runner の単一シームへ接続する本番アダプター。
 */
export function createChromeBackgroundAdapter(chromeApi = chrome) {
  return {
    config: API_CONFIG,
    clock: {
      now: () => Date.now(),
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      random: () => Math.random()
    },
    runtime: {
      get id() {
        return chromeApi.runtime.id;
      },
      get uiLanguage() {
        try {
          return chromeApi.i18n?.getUILanguage?.() || '';
        } catch {
          return '';
        }
      },
      getURL: (path) => chromeApi.runtime.getURL(path),
      setUninstallURL: chromeApi.runtime?.setUninstallURL
        ? (url) => chromeApi.runtime.setUninstallURL(url)
        : null,
      isOnline: () => !(typeof navigator !== 'undefined' && navigator.onLine === false),
      syncConsentBadge
    },
    alarms: {
      get: (name) => chromeApi.alarms.get(name),
      create: (name, opts) => chromeApi.alarms.create(name, opts),
      clear: (name) => chromeApi.alarms.clear(name)
    },
    notifications: {
      create: (id, opts) => (id
        ? chromeApi.notifications.create(id, opts)
        : chromeApi.notifications.create(opts)),
      clear: (id) => chromeApi.notifications.clear(id)
    },
    tabs: {
      create: (opts) => chromeApi.tabs.create(opts)
    },
    store: {
      acquireExecutionLock,
      releaseExecutionLock,
      pingSessionKeepAlive,
      isUnderBackoff,
      getBackoffState,
      recordBackoffFailure,
      resetBackoffLevel,
      getOrCreateDailySignJitterMinutes,
      consumeRetrySlot,
      resetRetryState,
      setLastAttemptTimestamp,
      isUnderAutoAttemptCooldown,
      checkManualCooldown,
      recordManualCooldown,
      getSettings,
      checkStorageCapacity,
      addExecutionLog,
      canAcceptNewCode,
      getRedeemedCodes,
      markCodeStatus,
      pruneHistoryIfExceeded,
      setLastSuccessfulRun,
      setActiveCodes,
      shouldRunRedeem,
      setDailySignRecord,
      isDailySignedToday,
      isDailySignAutoSkippedToday,
      shouldRunDailySign,
      getOrCreateGaClientId,
      initReviewPromptState,
      incrementReviewSuccessCount
    },
    gateway: {
      fetchValidCodes,
      getUserGameRoles,
      redeemCode,
      getDailySignInfo,
      claimDailyBonus,
      sendGAEvent
    }
  };
}

/**
 * MV3 のイベントリスナー登録要件に従い、トップレベルから同期的に全リスナーを配線する。
 */
export function bindChromeListeners(runner, chromeApi = chrome) {
  chromeApi.notifications.onClicked.addListener((notificationId) => {
    return runner.handleNotificationClick(notificationId);
  });

  chromeApi.runtime.onInstalled.addListener(() => {
    return runner.handleInstalled();
  });

  chromeApi.runtime.onStartup.addListener(() => {
    return runner.handleStartup();
  });

  if (chromeApi.idle?.onStateChanged) {
    chromeApi.idle.onStateChanged.addListener((newState) => {
      return runner.handleIdleStateChanged(newState);
    });
  }

  chromeApi.alarms.onAlarm.addListener((alarm) => {
    return runner.handleAlarm(alarm);
  });

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const dispatched = runner.handleMessage(message, sender);
    if (!dispatched?.handled) return;

    dispatched.promise
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  });
}

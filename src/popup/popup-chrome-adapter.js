import { API_CONFIG } from '../config/constants.js';
import { defaultStateStore } from '../services/state-store.js';
import { defaultReviewPromptService } from '../services/review-prompt-service.js';
import { syncConsentBadge } from '../services/analytics-service.js';
import { defaultApiGateway } from '../services/api-gateway.js';

/**
 * Chrome MV3 ランタイム API と既存サービスを Popup Controller の単一シームへ接続する本番アダプター。
 */
export function createChromePopupAdapter({
  chromeApi = typeof chrome !== 'undefined' ? chrome : undefined,
  windowObj = typeof window !== 'undefined' ? window : undefined,
  navigatorObj = typeof navigator !== 'undefined' ? navigator : undefined
} = {}) {
  return {
    config: API_CONFIG,
    clock: {
      now: () => Date.now()
    },
    runtime: {
      get uiLanguage() {
        try {
          return chromeApi?.i18n?.getUILanguage?.() || navigatorObj?.language || '';
        } catch {
          return '';
        }
      },
      get version() {
        try {
          return chromeApi?.runtime?.getManifest?.()?.version || '';
        } catch {
          return '';
        }
      },
      sendMessage: (message) => chromeApi.runtime.sendMessage(message),
      syncConsentBadge
    },
    alarms: {
      get: async (name) => {
        if (!chromeApi?.alarms?.get) return null;
        return chromeApi.alarms.get(name);
      }
    },
    tabs: {
      open: (url) => {
        if (!url) return;
        if (chromeApi?.tabs?.create) {
          return chromeApi.tabs.create({ url });
        }
        windowObj?.open?.(url, '_blank', 'noopener,noreferrer');
      }
    },
    clipboard: {
      writeText: (text) => navigatorObj.clipboard.writeText(text)
    },
    store: {
      getSettings: defaultStateStore.getSettings,
      updateSettings: defaultStateStore.updateSettings,
      getDailySignRecord: defaultStateStore.getDailySignRecord,
      setDailySignRecord: defaultStateStore.setDailySignRecord,
      getCodeRedeemStats: defaultStateStore.getCodeRedeemStats,
      setActiveCodes: defaultStateStore.setActiveCodes,
      getExecutionLogs: defaultStateStore.getExecutionLogs,
      subscribeChanges: defaultStateStore.subscribeChanges
    },
    gateway: {
      getUserGameRoles: defaultApiGateway.getUserGameRoles,
      getDailySignInfo: defaultApiGateway.getDailySignInfo,
      fetchValidCodes: defaultApiGateway.fetchValidCodes
    },
    reviewPrompt: {
      shouldShowReviewPrompt: defaultReviewPromptService.shouldShowReviewPrompt,
      updateReviewPromptState: defaultReviewPromptService.updateReviewPromptState,
      postponeReviewPrompt: defaultReviewPromptService.postponeReviewPrompt
    }
  };
}

import { API_CONFIG } from '../../src/config/constants.js';
import { GAMES, DEFAULT_ENABLED_GAMES, DEFAULT_GAME_KEY } from '../../src/config/games.js';
import { API_STATUS } from '../../src/services/api-gateway.js';
import { createStateStore } from '../../src/services/state-store.js';
import { createReviewPromptService } from '../../src/services/review-prompt-service.js';
import { createInMemoryStorageAdapter } from './in-memory-storage-adapter.js';

function createDefaultSettings() {
  return {
    optInAccepted: false,
    autoRedeemEnabled: false,
    autoSignEnabled: false,
    activeGameKey: DEFAULT_GAME_KEY,
    enabledGames: [...DEFAULT_ENABLED_GAMES],
    language: 'auto',
    analyticsConsentReviewed: false,
    analyticsEnabled: false,
    agreedPolicyVersion: null
  };
}

function normalizeSettings(raw) {
  const defaultGames = [...DEFAULT_ENABLED_GAMES];
  let enabledGames = [...defaultGames];
  if (Array.isArray(raw.enabledGames) && raw.enabledGames.length > 0) {
    const valid = raw.enabledGames.filter(k => GAMES[k]);
    if (valid.length > 0) {
      enabledGames = valid;
    }
  }
  let activeGameKey = raw.activeGameKey || enabledGames[0];
  if (!enabledGames.includes(activeGameKey)) {
    activeGameKey = enabledGames[0];
  }
  const language = (raw.language === 'ja' || raw.language === 'en') ? raw.language : 'auto';
  return {
    ...createDefaultSettings(),
    ...raw,
    enabledGames,
    activeGameKey,
    language
  };
}

/**
 * Popup Controller の決定論的検証アダプター（共通 In-Memory Storage＋本物 StateStore/ReviewPrompt＋スタブ）。
 * globalThis（chrome / document / window / fetch）を一切書き換えずに単一シーム経由で全状態遷移を検証する。
 */
export function createPopupTestAdapter(options = {}) {
  const config = {
    ...API_CONFIG,
    ...(options.config ?? {})
  };

  let nowMs = options.initialNowMs ?? Date.parse('2026-10-17T03:00:00Z');
  let uiLanguage = options.uiLanguage ?? 'ja';
  const appVersion = options.appVersion ?? '1.3.7';
  let messageHandler = options.messageHandler ?? null;
  let clipboardError = null;

  const alarmsMap = new Map();
  const sentMessages = [];
  const openedUrls = [];
  const copiedTexts = [];
  let syncConsentBadgeCalls = 0;

  const gatewayCalls = {
    getUserGameRoles: [],
    getDailySignInfo: [],
    fetchValidCodes: []
  };

  const clock = {
    now: () => nowMs,
    setNow: (ms) => {
      nowMs = ms;
    },
    advanceTime: (ms) => {
      nowMs += ms;
    }
  };

  const storage = createInMemoryStorageAdapter();
  if (options.settings) {
    storage.seedLocal({
      app_settings: normalizeSettings({ ...createDefaultSettings(), ...options.settings })
    });
  }

  const stateStore = createStateStore({
    storage,
    clock,
    config
  });
  const reviewPromptService = createReviewPromptService(stateStore, { clock });

  const gatewayImpl = {
    getUserGameRoles: async () => ({
      success: false,
      status: API_STATUS.NO_CHARACTER,
      retcode: -1,
      apiMessage: '',
      role: null,
      hoyoverseNotLoggedIn: false
    }),
    getDailySignInfo: async () => ({
      success: true,
      status: API_STATUS.OK,
      retcode: 0,
      isSigned: false,
      totalSignDay: 0,
      today: null,
      apiMessage: 'OK'
    }),
    fetchValidCodes: async () => [],
    ...(options.gateway ?? {})
  };

  const gateway = {
    getUserGameRoles: async (gameBiz) => {
      gatewayCalls.getUserGameRoles.push(gameBiz);
      return gatewayImpl.getUserGameRoles(gameBiz);
    },
    getDailySignInfo: async (gameConfig, lang) => {
      gatewayCalls.getDailySignInfo.push({ gameBiz: gameConfig?.gameBiz, lang });
      return gatewayImpl.getDailySignInfo(gameConfig, lang);
    },
    fetchValidCodes: async (gameKey) => {
      gatewayCalls.fetchValidCodes.push(gameKey);
      return gatewayImpl.fetchValidCodes(gameKey);
    }
  };

  return {
    config,
    clock,
    storage,
    runtime: {
      get uiLanguage() {
        return uiLanguage;
      },
      get version() {
        return appVersion;
      },
      sendMessage: async (message) => {
        sentMessages.push(message);
        if (messageHandler) {
          return messageHandler(message);
        }
        return { success: true };
      },
      syncConsentBadge: async () => {
        syncConsentBadgeCalls++;
      }
    },
    alarms: {
      get: async (name) => alarmsMap.get(name) || null
    },
    tabs: {
      open: (url) => {
        if (url) openedUrls.push(url);
      }
    },
    clipboard: {
      writeText: async (text) => {
        if (clipboardError) throw clipboardError;
        copiedTexts.push(text);
      }
    },
    store: {
      getSettings: stateStore.getSettings,
      updateSettings: stateStore.updateSettings,
      getDailySignRecord: stateStore.getDailySignRecord,
      setDailySignRecord: stateStore.setDailySignRecord,
      getCodeRedeemStats: stateStore.getCodeRedeemStats,
      setActiveCodes: stateStore.setActiveCodes,
      getExecutionLogs: stateStore.getExecutionLogs,
      subscribeChanges: stateStore.subscribeChanges
    },
    gateway,
    reviewPrompt: {
      shouldShowReviewPrompt: reviewPromptService.shouldShowReviewPrompt,
      updateReviewPromptState: reviewPromptService.updateReviewPromptState,
      postponeReviewPrompt: reviewPromptService.postponeReviewPrompt
    },

    // --- テスト制御・観測用ヘルパー ---
    setGateway: (overrides) => {
      Object.assign(gatewayImpl, overrides);
    },
    setMessageHandler: (fn) => {
      messageHandler = fn;
    },
    setAlarm: (name, alarmOrNull) => {
      if (alarmOrNull === null || alarmOrNull === undefined) {
        alarmsMap.delete(name);
      } else {
        alarmsMap.set(name, { ...alarmOrNull });
      }
    },
    setUiLanguage: (lang) => {
      uiLanguage = lang;
    },
    setClipboardError: (err) => {
      clipboardError = err;
    },
    setSettings: (partial) => {
      const current = storage.peekLocal('app_settings') || createDefaultSettings();
      storage.seedLocal({ app_settings: normalizeSettings({ ...current, ...partial }) });
    },
    seedDailySign: (gameBiz, record) => {
      storage.seedLocal({ [`daily_sign_${gameBiz}`]: record });
    },
    seedActiveCodes: (gameBiz, codes) => {
      storage.seedLocal({ [`active_codes_${gameBiz}`]: codes });
    },
    seedRedeemedCodes: (gameBiz, redeemedMap) => {
      storage.seedLocal({ [`redeemed_${gameBiz}`]: redeemedMap });
    },
    seedLogs: (logs) => {
      storage.seedLocal({ exec_logs: logs });
    },
    seedReviewPrompt: (partial) => {
      const current = storage.peekLocal('reviewPrompt') || {
        successCount: 0,
        status: 'pending',
        nextEligibleTimestamp: 0,
        postponeCount: 0,
        firstInstalledAt: nowMs
      };
      storage.seedLocal({ reviewPrompt: { ...current, ...partial } });
    },
    get sentMessages() {
      return sentMessages;
    },
    get openedUrls() {
      return openedUrls;
    },
    get copiedTexts() {
      return copiedTexts;
    },
    get syncConsentBadgeCalls() {
      return syncConsentBadgeCalls;
    },
    get gatewayCalls() {
      return gatewayCalls;
    },
    getSettings: () => stateStore.getSettings(),
    getDailySignRecord: (gameBiz) => stateStore.getDailySignRecord(gameBiz),
    getReviewPromptState: () => storage.peekLocal('reviewPrompt') || null,
    addExecutionLog: (entry) => stateStore.addExecutionLog(entry),
    markCodeStatus: (gameBiz, cdkey, status) => stateStore.markCodeStatus(gameBiz, cdkey, status)
  };
}

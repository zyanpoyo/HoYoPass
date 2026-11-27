import {
  API_CONFIG,
  REVIEW_PROMPT_CONFIG
} from '../../src/config/constants.js';
import {
  GAMES,
  DEFAULT_ENABLED_GAMES,
  DEFAULT_GAME_KEY
} from '../../src/config/games.js';
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
 * Background Runner の決定論的検証アダプター（共通 In-Memory Storage＋本物 StateStore＋フェイク時計/乱数/GWスタブ）。
 * globalThis（chrome / fetch / API_CONFIG）を一切書き換えずに単一シーム経由で全遷移を検証する。
 */
export function createBackgroundTestAdapter(options = {}) {
  const config = {
    ...API_CONFIG,
    ...(options.config ?? {})
  };

  let nowMs = options.initialNowMs ?? Date.parse('2026-10-17T03:00:00Z');
  let randomProvider = typeof options.randomValue === 'function'
    ? options.randomValue
    : () => (options.randomValue ?? 0);
  let online = options.online ?? true;
  let uiLanguage = options.uiLanguage ?? 'ja';
  const runtimeId = options.runtimeId ?? 'test-ext-id';

  let uninstallUrl = null;
  let uninstallUrlError = null;
  let pingKeepAliveOverride = null;

  const alarmsMap = new Map();
  const createdNotifications = [];
  const clearedNotifications = [];
  const createdTabs = [];
  const gaEvents = [];
  const sleepCalls = [];
  let keepAlivePingCalls = 0;
  let syncConsentBadgeCalls = 0;

  const clock = {
    now: () => nowMs,
    sleep: async (ms) => {
      sleepCalls.push(ms);
      nowMs += ms;
    },
    random: () => randomProvider(),
    setNow: (ms) => {
      nowMs = ms;
    },
    advanceTime: (ms) => {
      nowMs += ms;
    },
    setRandom: (valOrFn) => {
      randomProvider = typeof valOrFn === 'function' ? valOrFn : () => valOrFn;
    },
    sleepCalls
  };

  const storage = createInMemoryStorageAdapter();
  if (options.settings) {
    storage.seedLocal({
      app_settings: normalizeSettings({ ...createDefaultSettings(), ...options.settings })
    });
  }
  if (options.gaClientId) {
    storage.seedLocal({ ga_client_id: options.gaClientId });
  }

  const stateStore = createStateStore({
    storage,
    clock,
    random: () => randomProvider(),
    config
  });
  const reviewPrompt = createReviewPromptService(stateStore, { clock });

  const gateway = {
    fetchValidCodes: async () => [],
    getUserGameRoles: async () => ({
      success: false,
      status: API_STATUS.NO_CHARACTER,
      retcode: -1,
      apiMessage: '',
      role: null,
      hoyoverseNotLoggedIn: false
    }),
    redeemCode: async ({ cdkey }) => ({ success: true, status: API_STATUS.OK, retcode: 0, apiMessage: 'OK', cdkey }),
    getDailySignInfo: async () => ({
      success: true,
      status: API_STATUS.OK,
      retcode: 0,
      isSigned: false,
      totalSignDay: 0,
      today: null,
      apiMessage: 'OK'
    }),
    claimDailyBonus: async () => ({
      success: true,
      status: API_STATUS.OK,
      retcode: 0,
      alreadySigned: false,
      apiMessage: 'OK'
    }),
    sendGAEvent: async (eventName, params) => {
      gaEvents.push({ eventName, params });
      return { success: true, eventName, params };
    },
    ...(options.gateway ?? {})
  };

  const store = {
    acquireExecutionLock: stateStore.acquireExecutionLock,
    releaseExecutionLock: stateStore.releaseExecutionLock,
    pingSessionKeepAlive: async () => {
      keepAlivePingCalls++;
      if (pingKeepAliveOverride) {
        return pingKeepAliveOverride();
      }
      return stateStore.pingSessionKeepAlive();
    },
    isUnderBackoff: stateStore.isUnderBackoff,
    getBackoffState: stateStore.getBackoffState,
    recordBackoffFailure: stateStore.recordBackoffFailure,
    getOrCreateDailySignJitterMinutes: stateStore.getOrCreateDailySignJitterMinutes,
    consumeRetrySlot: stateStore.consumeRetrySlot,
    resetRetryState: stateStore.resetRetryState,
    isUnderAutoAttemptCooldown: stateStore.isUnderAutoAttemptCooldown,
    checkManualCooldown: stateStore.checkManualCooldown,
    recordFlowStart: stateStore.recordFlowStart,
    recordFlowSuccess: stateStore.recordFlowSuccess,
    getSettings: stateStore.getSettings,
    checkStorageCapacity: stateStore.checkStorageCapacity,
    addExecutionLog: stateStore.addExecutionLog,
    canAcceptNewCode: stateStore.canAcceptNewCode,
    getRedeemedCodes: stateStore.getRedeemedCodes,
    markCodeStatus: stateStore.markCodeStatus,
    pruneHistoryIfExceeded: stateStore.pruneHistoryIfExceeded,
    setActiveCodes: stateStore.setActiveCodes,
    shouldRunRedeem: stateStore.shouldRunRedeem,
    setDailySignRecord: stateStore.setDailySignRecord,
    getDailySignSkipReason: stateStore.getDailySignSkipReason,
    shouldRunDailySign: stateStore.shouldRunDailySign,
    getOrCreateGaClientId: stateStore.getOrCreateGaClientId,
    initReviewPromptState: reviewPrompt.initReviewPromptState,
    incrementReviewSuccessCount: reviewPrompt.incrementReviewSuccessCount
  };

  return {
    config,
    clock,
    runtime: {
      id: runtimeId,
      get uiLanguage() {
        return uiLanguage;
      },
      getURL: (p) => `chrome-extension://${runtimeId}/${p}`,
      setUninstallURL: async (url) => {
        if (uninstallUrlError) throw uninstallUrlError;
        uninstallUrl = url;
      },
      isOnline: () => online,
      syncConsentBadge: async () => {
        syncConsentBadgeCalls++;
      }
    },
    alarms: {
      get: async (name) => alarmsMap.get(name) || null,
      create: async (name, opts) => {
        alarmsMap.set(name, { ...opts });
      },
      clear: async (name) => {
        alarmsMap.delete(name);
      }
    },
    notifications: {
      create: (id, opts) => {
        createdNotifications.push({ id: id ?? null, opts });
      },
      clear: (id) => {
        clearedNotifications.push(id);
      }
    },
    tabs: {
      create: async (opts) => {
        createdTabs.push(opts);
        return { id: createdTabs.length, ...opts };
      }
    },
    store,
    gateway,

    // --- テスト制御・観測用ヘルパー ---
    setGateway: (overrides) => Object.assign(gateway, overrides),
    setSettings: (partial) => {
      const current = storage.peekLocal('app_settings') || createDefaultSettings();
      storage.seedLocal({ app_settings: normalizeSettings({ ...current, ...partial }) });
    },
    setOnline: (flag) => {
      online = flag;
    },
    setUiLanguage: (lang) => {
      uiLanguage = lang;
    },
    setUninstallUrlError: (err) => {
      uninstallUrlError = err;
    },
    setStorageWarning: (isWarning) => {
      storage.setBytesInUse(isWarning ? 9 * 1024 * 1024 : 0);
    },
    setMarkCodeStatusError: (err) => {
      storage.setLocalWriteError(
        err,
        err ? (items) => Object.keys(items).some(k => k.startsWith('redeemed_')) : null
      );
    },
    setPingKeepAliveFn: (fn) => {
      pingKeepAliveOverride = fn;
    },
    setGaClientId: (id) => {
      if (id === null || id === undefined) {
        storage.deleteLocal('ga_client_id');
      } else {
        storage.seedLocal({ ga_client_id: id });
      }
    },
    setBackoffState: ({ until = 0, level = 0 }) => {
      storage.seedLocal({ backoff_until: until, backoff_level: level });
    },
    setLastSuccessfulRun: (ts) => {
      storage.seedLocal({ last_successful_run: ts });
    },
    setDailySignJitterMinutes: (minutes) => {
      if (minutes === null || minutes === undefined) {
        storage.deleteLocal('daily_sign_jitter_minutes');
      } else {
        storage.seedLocal({ daily_sign_jitter_minutes: minutes });
      }
    },
    setReviewPromptState: (partial) => {
      const current = storage.peekLocal('reviewPrompt') || {
        successCount: 0,
        status: 'pending',
        nextEligibleTimestamp: 0,
        postponeCount: 0,
        firstInstalledAt: nowMs
      };
      storage.seedLocal({ reviewPrompt: { ...current, ...partial } });
    },
    setRedeemedCode: (gameBiz, cdkey, entry) => {
      const key = `redeemed_${gameBiz}`;
      const current = { ...(storage.peekLocal(key) || {}) };
      current[cdkey] = entry;
      storage.seedLocal({ [key]: current });
    },
    clearLogs: () => {
      storage.deleteLocal('exec_logs');
    },
    clearManualCooldowns: () => {
      storage.deleteSession('manual_cooldowns');
    },
    clearSession: () => {
      storage.clearSession();
    },
    get alarmsMap() {
      return alarmsMap;
    },
    get createdNotifications() {
      return createdNotifications;
    },
    get clearedNotifications() {
      return clearedNotifications;
    },
    get createdTabs() {
      return createdTabs;
    },
    get gaEvents() {
      return gaEvents;
    },
    get logs() {
      return storage.peekLocal('exec_logs') || [];
    },
    get keepAlivePingCalls() {
      return keepAlivePingCalls;
    },
    get syncConsentBadgeCalls() {
      return syncConsentBadgeCalls;
    },
    get uninstallUrl() {
      return uninstallUrl;
    },
    getGaClientId: () => storage.peekLocal('ga_client_id') ?? null,
    getBackoffState: () => stateStore.getBackoffState(),
    getRetryState: (kind) => {
      const key = kind === 'SIGN' ? 'retry_state_sign' : 'retry_state_redeem';
      return storage.peekLocal(key) || { count: 0, updatedAt: 0, exhaustedLogged: false };
    },
    getDailySignRecord: (gameBiz) => storage.peekLocal(`daily_sign_${gameBiz}`) || null,
    getDailySignJitterMinutes: () => storage.peekLocal('daily_sign_jitter_minutes') ?? null,
    getRedeemedCodes: (gameBiz) => storage.peekLocal(`redeemed_${gameBiz}`) || {},
    getReviewPromptState: () => storage.peekLocal('reviewPrompt') || null,
    getCodeRedeemStats: (gameBiz) => stateStore.getCodeRedeemStats(gameBiz)
  };
}

import {
  API_CONFIG,
  GAMES,
  DEFAULT_ENABLED_GAMES,
  STATUS_MAP,
  REVIEW_PROMPT_CONFIG
} from '../../src/config/constants.js';
import { getHoyoTodayDateString } from '../../src/services/storage-service.js';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function clampUnitRandom(randFn) {
  const val = Number(randFn());
  if (!Number.isFinite(val)) return 0;
  return Math.min(0.999999999999, Math.max(0, val));
}

function createDefaultSettings() {
  return {
    optInAccepted: false,
    autoRedeemEnabled: false,
    autoSignEnabled: false,
    activeGameKey: 'GENSHIN',
    enabledGames: [...DEFAULT_ENABLED_GAMES],
    language: 'auto',
    analyticsConsentReviewed: false,
    analyticsEnabled: false,
    agreedPolicyVersion: null
  };
}

/**
 * Background Runner の決定論的検証アダプター（インメモリ状態＋フェイク時計・乱数・GWスタブ）。
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
  let storageWarning = { isWarning: false };
  let markCodeStatusError = null;
  let pingKeepAliveOverride = null;

  const alarmsMap = new Map();
  const createdNotifications = [];
  const clearedNotifications = [];
  const createdTabs = [];
  const gaEvents = [];
  const sleepCalls = [];
  let keepAlivePingCalls = 0;
  let syncConsentBadgeCalls = 0;

  let lockState = null;
  let settingsState = options.settings
    ? normalizeSettings({ ...createDefaultSettings(), ...options.settings })
    : createDefaultSettings();
  let gaClientId = options.gaClientId ?? null;
  let reviewPromptState = null;
  let execLogs = [];
  let backoffUntil = 0;
  let backoffLevel = 0;
  let dailySignJitterMinutes = null;
  const retryStates = {
    REDEEM: { count: 0, updatedAt: 0, exhaustedLogged: false },
    SIGN: { count: 0, updatedAt: 0, exhaustedLogged: false }
  };
  const attemptTimestamps = { REDEEM: 0, SIGN: 0 };
  const manualCooldowns = new Map();
  const activeCodesByBiz = new Map();
  const redeemedCodesByBiz = new Map();
  const dailyCountsByBiz = new Map();
  const dailySignRecordsByBiz = new Map();
  let lastSuccessfulRun = 0;

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

  const gateway = {
    fetchValidCodes: async () => [],
    getUserGameRoles: async () => ({
      success: false,
      retcode: -1,
      message: 'No character',
      role: null,
      hoyoverseNotLoggedIn: false
    }),
    redeemCode: async ({ cdkey }) => ({ retcode: 0, message: 'OK', cdkey }),
    getDailySignInfo: async () => ({
      success: true,
      retcode: 0,
      isSigned: false,
      totalSignDay: 0,
      today: null,
      message: 'OK'
    }),
    claimDailyBonus: async () => ({
      success: true,
      retcode: 0,
      alreadySigned: false,
      message: 'OK'
    }),
    sendGAEvent: async (eventName, params) => {
      gaEvents.push({ eventName, params });
      return { success: true, eventName, params };
    },
    ...(options.gateway ?? {})
  };

  const store = {
    acquireExecutionLock: async (triggerSource) => {
      if (lockState && lockState.running && nowMs - lockState.startedAt < LOCK_TIMEOUT_MS) {
        return false;
      }
      lockState = { running: true, startedAt: nowMs, trigger: triggerSource };
      return true;
    },
    releaseExecutionLock: async () => {
      lockState = null;
    },
    pingSessionKeepAlive: async () => {
      keepAlivePingCalls++;
      if (pingKeepAliveOverride) {
        return pingKeepAliveOverride();
      }
    },
    getSettings: async () => ({ ...settingsState, enabledGames: [...settingsState.enabledGames] }),
    getOrCreateGaClientId: async () => {
      if (gaClientId) return gaClientId;
      gaClientId = '11111111-2222-4333-8444-555555555555';
      return gaClientId;
    },
    initReviewPromptState: async () => {
      if (reviewPromptState) return { ...reviewPromptState };
      let migratedCount = 0;
      for (const game of Object.values(GAMES)) {
        const redeemed = redeemedCodesByBiz.get(game.gameBiz) || {};
        for (const entry of Object.values(redeemed)) {
          if (entry && entry.s === STATUS_MAP.SUCCESS) migratedCount++;
        }
        const signRec = dailySignRecordsByBiz.get(game.gameBiz);
        if (signRec && signRec.isSigned === true) migratedCount++;
      }
      reviewPromptState = {
        successCount: Math.min(migratedCount, REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT),
        status: 'pending',
        nextEligibleTimestamp: 0,
        postponeCount: 0,
        firstInstalledAt: nowMs
      };
      return { ...reviewPromptState };
    },
    incrementReviewSuccessCount: async () => {
      const current = reviewPromptState ?? {
        successCount: 0,
        status: 'pending',
        nextEligibleTimestamp: 0,
        postponeCount: 0,
        firstInstalledAt: nowMs
      };
      reviewPromptState = { ...current, successCount: current.successCount + 1 };
      return { ...reviewPromptState };
    },
    checkStorageCapacity: async () => ({ ...storageWarning }),
    addExecutionLog: async (logEntry) => {
      execLogs.unshift({ timestamp: nowMs, ...logEntry });
      if (execLogs.length > config.MAX_EXECUTION_LOGS) {
        execLogs.pop();
      }
    },
    getBackoffState: async () => {
      const remainingMs = Math.max(0, backoffUntil - nowMs);
      const isActive = remainingMs > 0;
      return {
        isActive,
        until: backoffUntil,
        remainingMs,
        remainingMinutes: isActive ? Math.ceil(remainingMs / 60_000) : 0,
        level: backoffLevel
      };
    },
    isUnderBackoff: async () => Math.max(0, backoffUntil - nowMs) > 0,
    recordBackoffFailure: async ({ retryAfterMs = null } = {}) => {
      const steps = config.BACKOFF_STEPS_MS;
      const nextLevel = Math.min(Math.max(0, backoffLevel) + 1, steps.length);
      const baseMs = steps[nextLevel - 1];
      const maxMs = steps[steps.length - 1];
      const hasRetryAfter = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0;
      const durationMs = hasRetryAfter ? Math.min(maxMs, Math.max(baseMs, retryAfterMs)) : baseMs;
      backoffUntil = nowMs + durationMs;
      backoffLevel = nextLevel;
      return {
        until: backoffUntil,
        durationMs,
        remainingMinutes: Math.ceil(durationMs / 60_000),
        level: nextLevel
      };
    },
    resetBackoffLevel: async () => {
      backoffLevel = 0;
    },
    getOrCreateDailySignJitterMinutes: async () => {
      const validExisting = typeof dailySignJitterMinutes === 'number' &&
        Number.isInteger(dailySignJitterMinutes) &&
        dailySignJitterMinutes >= 0 &&
        dailySignJitterMinutes <= config.DAILY_SIGN_JITTER_MAX_MINUTES;
      if (validExisting) {
        return { minutes: dailySignJitterMinutes, created: false };
      }
      const minutes = Math.floor(clampUnitRandom(randomProvider) * (config.DAILY_SIGN_JITTER_MAX_MINUTES + 1));
      dailySignJitterMinutes = minutes;
      return { minutes, created: true };
    },
    consumeRetrySlot: async (kind, { explicitDelayMinutes = null } = {}) => {
      const key = kind === 'SIGN' ? 'SIGN' : 'REDEEM';
      const steps = config.RETRY_DELAY_STEPS_MINUTES;
      const maxAttempts = steps.length;
      const saved = retryStates[key];
      const ttlMs = config.AUTO_ATTEMPT_COOLDOWN_MINUTES * 60 * 1000;
      const state = (saved.updatedAt > 0 && nowMs - saved.updatedAt >= ttlMs)
        ? { count: 0, updatedAt: 0, exhaustedLogged: false }
        : saved;

      if (state.count >= maxAttempts) {
        const shouldLogExhausted = !state.exhaustedLogged;
        if (shouldLogExhausted) {
          retryStates[key] = {
            count: state.count,
            updatedAt: state.updatedAt || nowMs,
            exhaustedLogged: true
          };
        }
        return {
          allowed: false,
          exhausted: true,
          shouldLogExhausted,
          attempt: state.count,
          maxAttempts,
          baseMinutes: 0,
          delayMinutes: 0
        };
      }

      const hasExplicit = typeof explicitDelayMinutes === 'number' &&
        Number.isFinite(explicitDelayMinutes) &&
        explicitDelayMinutes > 0;
      const baseMinutes = hasExplicit ? explicitDelayMinutes : steps[state.count];
      const delayMinutes = hasExplicit
        ? explicitDelayMinutes
        : Number((baseMinutes + clampUnitRandom(randomProvider) * config.RETRY_JITTER_MAX_MINUTES).toFixed(2));
      const nextCount = state.count + 1;
      retryStates[key] = { count: nextCount, updatedAt: nowMs, exhaustedLogged: false };
      return {
        allowed: true,
        exhausted: false,
        shouldLogExhausted: false,
        attempt: nextCount,
        maxAttempts,
        baseMinutes,
        delayMinutes
      };
    },
    resetRetryState: async (kind) => {
      const key = kind === 'SIGN' ? 'SIGN' : 'REDEEM';
      retryStates[key] = { count: 0, updatedAt: 0, exhaustedLogged: false };
    },
    setLastAttemptTimestamp: async (kind) => {
      const key = kind === 'SIGN' ? 'SIGN' : 'REDEEM';
      attemptTimestamps[key] = nowMs;
    },
    isUnderAutoAttemptCooldown: async (kind) => {
      const key = kind === 'SIGN' ? 'SIGN' : 'REDEEM';
      const last = attemptTimestamps[key] || 0;
      if (last <= 0) return false;
      if (key === 'SIGN') {
        const lastUtc8Day = Math.floor((last + UTC8_OFFSET_MS) / ONE_DAY_MS);
        const nowUtc8Day = Math.floor((nowMs + UTC8_OFFSET_MS) / ONE_DAY_MS);
        if (lastUtc8Day !== nowUtc8Day) return false;
      }
      return (nowMs - last) < config.AUTO_ATTEMPT_COOLDOWN_MINUTES * 60 * 1000;
    },
    checkManualCooldown: async (category, gameKey) => {
      const last = manualCooldowns.get(`${category}:${gameKey}`) || 0;
      const elapsed = nowMs - last;
      if (last > 0 && elapsed >= 0 && elapsed < config.MANUAL_COOLDOWN_MS) {
        const remainingMs = config.MANUAL_COOLDOWN_MS - elapsed;
        return { allowed: false, remainingMs, remainingSec: Math.ceil(remainingMs / 1000) };
      }
      return { allowed: true, remainingMs: 0, remainingSec: 0 };
    },
    recordManualCooldown: async (category, gameKey) => {
      manualCooldowns.set(`${category}:${gameKey}`, nowMs);
    },
    setActiveCodes: async (gameBiz, codes) => {
      activeCodesByBiz.set(gameBiz, Array.isArray(codes) ? [...codes] : []);
    },
    getRedeemedCodes: async (gameBiz) => ({ ...(redeemedCodesByBiz.get(gameBiz) || {}) }),
    canAcceptNewCode: async (gameBiz) => {
      const record = dailyCountsByBiz.get(gameBiz) || { count: 0, resetAt: nowMs + ONE_DAY_MS };
      if (nowMs > record.resetAt) {
        record.count = 0;
        record.resetAt = nowMs + ONE_DAY_MS;
      }
      if (record.count >= config.DAILY_NEW_CODE_LIMIT) {
        return false;
      }
      record.count++;
      dailyCountsByBiz.set(gameBiz, record);
      return true;
    },
    markCodeStatus: async (gameBiz, cdkey, statusStr) => {
      if (markCodeStatusError) {
        throw markCodeStatusError;
      }
      const current = { ...(redeemedCodesByBiz.get(gameBiz) || {}) };
      const entry = { ...(current[cdkey] || { r: 0 }) };
      if (statusStr === 'RETRY') {
        entry.r = (entry.r || 0) + 1;
        entry.s = entry.r >= config.MAX_CODE_RETRIES ? STATUS_MAP.FAILED : STATUS_MAP.PENDING_RETRY;
      } else {
        entry.s = STATUS_MAP[statusStr] ?? STATUS_MAP.EXPIRED;
      }
      entry.t = Math.floor(nowMs / 1000);
      current[cdkey] = entry;
      redeemedCodesByBiz.set(gameBiz, current);
    },
    pruneHistoryIfExceeded: async (gameBiz, activeCodesList) => {
      if (Array.isArray(activeCodesList)) {
        activeCodesByBiz.set(gameBiz, [...activeCodesList]);
      }
      const current = { ...(redeemedCodesByBiz.get(gameBiz) || {}) };
      const keys = Object.keys(current);
      if (keys.length <= config.MAX_REDEEMED_HISTORY_LIMIT) return;

      const activeSet = new Set(activeCodesList);
      const prunableKeys = keys
        .filter(k => !activeSet.has(k) && current[k].s !== STATUS_MAP.PENDING_RETRY)
        .sort((a, b) => current[a].t - current[b].t);
      const deleteCount = keys.length - config.MAX_REDEEMED_HISTORY_LIMIT;
      for (let i = 0; i < Math.min(deleteCount, prunableKeys.length); i++) {
        delete current[prunableKeys[i]];
      }
      redeemedCodesByBiz.set(gameBiz, current);
    },
    setLastSuccessfulRun: async (timestamp = nowMs) => {
      lastSuccessfulRun = timestamp;
    },
    shouldRunRedeem: async (minIntervalMinutes = config.REDEEM_INTERVAL_MINUTES) => {
      const lastRun = Math.max(lastSuccessfulRun, attemptTimestamps.REDEEM || 0);
      return (nowMs - lastRun) >= minIntervalMinutes * 60 * 1000;
    },
    setDailySignRecord: async (gameBiz, record) => {
      const current = dailySignRecordsByBiz.get(gameBiz) || null;
      const isSameDate = Boolean(current && record.date && current.date === record.date);
      const base = isSameDate ? current : {};
      const updated = { ...base, ...record, updatedAt: nowMs };
      if (record.isSigned === true) {
        updated.captchaBlocked = false;
      }
      dailySignRecordsByBiz.set(gameBiz, updated);
      return { ...updated };
    },
    isDailySignedToday: async (gameBiz) => {
      const record = dailySignRecordsByBiz.get(gameBiz);
      if (!record || !record.date) return false;
      const today = getHoyoTodayDateString(nowMs);
      return record.date === today && (record.isSigned === true || record.skippedNoChar === true);
    },
    isDailySignAutoSkippedToday: async (gameBiz) => {
      const record = dailySignRecordsByBiz.get(gameBiz);
      if (!record || !record.date) return false;
      const today = getHoyoTodayDateString(nowMs);
      return record.date === today && (
        record.isSigned === true ||
        record.skippedNoChar === true ||
        record.captchaBlocked === true
      );
    },
    shouldRunDailySign: async (gameBizList) => {
      for (const gameBiz of gameBizList) {
        const record = dailySignRecordsByBiz.get(gameBiz);
        const today = getHoyoTodayDateString(nowMs);
        const skipped = Boolean(
          record && record.date === today &&
          (record.isSigned === true || record.skippedNoChar === true || record.captchaBlocked === true)
        );
        if (!skipped) return true;
      }
      return false;
    }
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
      settingsState = normalizeSettings({ ...settingsState, ...partial });
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
      storageWarning = { isWarning };
    },
    setMarkCodeStatusError: (err) => {
      markCodeStatusError = err;
    },
    setPingKeepAliveFn: (fn) => {
      pingKeepAliveOverride = fn;
    },
    setGaClientId: (id) => {
      gaClientId = id;
    },
    setBackoffState: ({ until = 0, level = 0 }) => {
      backoffUntil = until;
      backoffLevel = level;
    },
    setLastSuccessfulRun: (ts) => {
      lastSuccessfulRun = ts;
    },
    setDailySignJitterMinutes: (minutes) => {
      dailySignJitterMinutes = minutes;
    },
    setReviewPromptState: (partial) => {
      reviewPromptState = {
        successCount: 0,
        status: 'pending',
        nextEligibleTimestamp: 0,
        postponeCount: 0,
        firstInstalledAt: nowMs,
        ...(reviewPromptState || {}),
        ...partial
      };
    },
    setRedeemedCode: (gameBiz, cdkey, entry) => {
      const current = { ...(redeemedCodesByBiz.get(gameBiz) || {}) };
      current[cdkey] = entry;
      redeemedCodesByBiz.set(gameBiz, current);
    },
    clearManualCooldowns: () => manualCooldowns.clear(),
    clearSession: () => {
      lockState = null;
      manualCooldowns.clear();
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
      return execLogs;
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
    getGaClientId: () => gaClientId,
    getBackoffState: () => store.getBackoffState(),
    getRetryState: (kind) => ({ ...retryStates[kind === 'SIGN' ? 'SIGN' : 'REDEEM'] }),
    getDailySignRecord: (gameBiz) => dailySignRecordsByBiz.get(gameBiz) || null,
    getDailySignJitterMinutes: () => dailySignJitterMinutes,
    getRedeemedCodes: (gameBiz) => ({ ...(redeemedCodesByBiz.get(gameBiz) || {}) }),
    getReviewPromptState: () => (reviewPromptState ? { ...reviewPromptState } : null),
    getCodeRedeemStats: (gameBiz) => {
      const redeemed = redeemedCodesByBiz.get(gameBiz) || {};
      const activeCodes = activeCodesByBiz.get(gameBiz) || null;
      const utc8Date = new Date(nowMs + UTC8_OFFSET_MS);
      const monthStartUtc8Ms = Date.UTC(utc8Date.getUTCFullYear(), utc8Date.getUTCMonth(), 1, 0, 0, 0, 0);
      const monthStartSec = Math.floor((monthStartUtc8Ms - UTC8_OFFSET_MS) / 1000);
      const isClaimed = (s) => s === STATUS_MAP.SUCCESS || s === STATUS_MAP.ALREADY_CLAIMED;

      let monthlyCount = 0;
      let totalCount = 0;
      for (const entry of Object.values(redeemed)) {
        if (entry && isClaimed(entry.s)) {
          totalCount++;
          if ((entry.t || 0) >= monthStartSec) monthlyCount++;
        }
      }

      let activeTotal = null;
      let activeClaimed = null;
      if (activeCodes) {
        const availableCodes = activeCodes.filter(code => {
          const entry = redeemed[code];
          return !entry || (entry.s !== STATUS_MAP.EXPIRED && entry.s !== STATUS_MAP.FAILED);
        });
        activeTotal = availableCodes.length;
        activeClaimed = availableCodes.filter(code => redeemed[code] && isClaimed(redeemed[code].s)).length;
      }

      return { monthlyCount, totalCount, activeTotal, activeClaimed };
    }
  };
}

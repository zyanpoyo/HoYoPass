import {
  API_CONFIG,
  STATUS_MAP,
  PRIVACY_POLICY_VERSION,
  LEGACY_POLICY_VERSION
} from '../config/constants.js';
import {
  GAMES,
  DEFAULT_ENABLED_GAMES,
  DEFAULT_GAME_KEY
} from '../config/games.js';
import { createChromeStorageAdapter } from './chrome-storage-adapter.js';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const STORAGE_MAX_BYTES = 10 * 1024 * 1024;
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const STORAGE_KEYS = {
  APP_SETTINGS: 'app_settings',
  EXEC_LOGS: 'exec_logs',
  LAST_SUCCESSFUL_RUN: 'last_successful_run',
  LAST_REDEEM_ATTEMPT: 'last_redeem_attempt',
  LAST_SIGN_ATTEMPT: 'last_sign_attempt',
  RETRY_STATE_REDEEM: 'retry_state_redeem',
  RETRY_STATE_SIGN: 'retry_state_sign',
  BACKOFF_UNTIL: 'backoff_until',
  BACKOFF_LEVEL: 'backoff_level',
  DAILY_SIGN_JITTER_MINUTES: 'daily_sign_jitter_minutes',
  GA_CLIENT_ID: 'ga_client_id',
  REVIEW_PROMPT: 'reviewPrompt',
  LOCK_STATE: 'lock_state',
  MANUAL_COOLDOWNS: 'manual_cooldowns',
  GA_SESSION_ID: 'ga_session_id',
  GA_LAST_ACTIVE: 'ga_last_active'
};

const RETRY_STATE_KEYS = {
  REDEEM: STORAGE_KEYS.RETRY_STATE_REDEEM,
  SIGN: STORAGE_KEYS.RETRY_STATE_SIGN
};

const ATTEMPT_TIMESTAMP_KEYS = {
  REDEEM: STORAGE_KEYS.LAST_REDEEM_ATTEMPT,
  SIGN: STORAGE_KEYS.LAST_SIGN_ATTEMPT
};

function redeemedKey(gameBiz) {
  return `redeemed_${gameBiz}`;
}

function activeCodesKey(gameBiz) {
  return `active_codes_${gameBiz}`;
}

function dailyCountsKey(gameBiz) {
  return `daily_counts_${gameBiz}`;
}

function dailySignKey(gameBiz) {
  return `daily_sign_${gameBiz}`;
}

function resolveRetryStateKey(kind) {
  return RETRY_STATE_KEYS[kind] || RETRY_STATE_KEYS.REDEEM;
}

function resolveAttemptKey(kind) {
  return ATTEMPT_TIMESTAMP_KEYS[kind] || ATTEMPT_TIMESTAMP_KEYS.REDEEM;
}

function clampUnitRandom(randFn = Math.random) {
  const val = Number(randFn());
  if (!Number.isFinite(val)) return 0;
  return Math.min(0.999999999999, Math.max(0, val));
}

function getHoyoMonthStartSec(nowMs) {
  const utc8Date = new Date(nowMs + UTC8_OFFSET_MS);
  const monthStartUtc8Ms = Date.UTC(
    utc8Date.getUTCFullYear(),
    utc8Date.getUTCMonth(),
    1, 0, 0, 0, 0
  );
  return Math.floor((monthStartUtc8Ms - UTC8_OFFSET_MS) / 1000);
}

function isSameHoyoDay(tsA, tsB) {
  return Math.floor((tsA + UTC8_OFFSET_MS) / ONE_DAY_MS) === Math.floor((tsB + UTC8_OFFSET_MS) / ONE_DAY_MS);
}

/**
 * UTC+8 基準の本日日付文字列 (YYYY-MM-DD) を算出する。
 */
export function getHoyoTodayDateString(nowMs = Date.now()) {
  const utc8Ms = nowMs + UTC8_OFFSET_MS;
  return new Date(utc8Ms).toISOString().slice(0, 10);
}

/**
 * 次回デイリーログボ発火予定時刻 (UTC+8 00:05 + ジッター分) のエポックミリ秒を算出する。
 */
export function getNextHoyoDailySignTimestamp(nowMs = Date.now(), jitterMinutes = 0) {
  const utc8Date = new Date(nowMs + UTC8_OFFSET_MS);
  const targetUtc8 = Date.UTC(
    utc8Date.getUTCFullYear(),
    utc8Date.getUTCMonth(),
    utc8Date.getUTCDate(),
    0, 5, 0, 0
  ) + jitterMinutes * 60 * 1000;
  let nextWhen = targetUtc8 - UTC8_OFFSET_MS;
  if (nextWhen <= nowMs) {
    nextWhen += ONE_DAY_MS;
  }
  return nextWhen;
}

/**
 * ベース待機時間にランダムなジッターを加算する。
 * テスト等で baseMs に 0 以下が指定された場合は 0 を返す。
 */
export function computeJitteredDelayMs(baseMs, maxJitterMs = 0, randFn = Math.random) {
  if (!Number.isFinite(baseMs) || baseMs <= 0) {
    return 0;
  }
  if (!Number.isFinite(maxJitterMs) || maxJitterMs <= 0) {
    return baseMs;
  }
  return baseMs + Math.floor(clampUnitRandom(randFn) * (maxJitterMs + 1));
}

export function needsPolicyReview(settings, current = PRIVACY_POLICY_VERSION) {
  return Boolean(settings?.optInAccepted) &&
    (settings?.agreedPolicyVersion ?? '') < current;
}

/**
 * 永続状態・セッションロック・レート制御・変更購読を統合した深い状態ストアを生成する。
 */
export function createStateStore({
  storage = createChromeStorageAdapter(),
  clock = { now: () => Date.now() },
  random = () => Math.random(),
  config = API_CONFIG
} = {}) {
  async function acquireExecutionLock(triggerSource) {
    const session = await storage.session.get(STORAGE_KEYS.LOCK_STATE);
    const lock = session?.[STORAGE_KEYS.LOCK_STATE];
    const now = clock.now();

    if (lock && lock.running && now - lock.startedAt < LOCK_TIMEOUT_MS) {
      return false;
    }

    await storage.session.set({
      [STORAGE_KEYS.LOCK_STATE]: { running: true, startedAt: now, trigger: triggerSource }
    });
    return true;
  }

  async function releaseExecutionLock() {
    await storage.session.remove(STORAGE_KEYS.LOCK_STATE);
  }

  /**
   * MV3 Service Worker のアイドル停止を防ぐため、session ストレージへ軽量アクセスを行う。
   */
  async function pingSessionKeepAlive() {
    try {
      if (storage.session.isAvailable()) {
        await storage.session.get(STORAGE_KEYS.LOCK_STATE);
      }
    } catch {
      // keepalive ping の失敗でキャッチアップ本体を止めない
    }
  }

  async function getSettings() {
    const data = await storage.local.get(STORAGE_KEYS.APP_SETTINGS);
    const saved = data?.[STORAGE_KEYS.APP_SETTINGS];
    const defaultGames = DEFAULT_ENABLED_GAMES || Object.keys(GAMES);

    if (!saved) {
      return {
        optInAccepted: false,
        autoRedeemEnabled: false,
        autoSignEnabled: false,
        activeGameKey: DEFAULT_GAME_KEY,
        enabledGames: [...defaultGames],
        language: 'auto',
        analyticsConsentReviewed: false,
        analyticsEnabled: false,
        agreedPolicyVersion: null
      };
    }

    let enabledGames = [...defaultGames];
    if (Array.isArray(saved.enabledGames) && saved.enabledGames.length > 0) {
      const valid = saved.enabledGames.filter(k => GAMES[k]);
      if (valid.length > 0) {
        enabledGames = valid;
      }
    }

    let activeGameKey = saved.activeGameKey || enabledGames[0];
    if (!enabledGames.includes(activeGameKey)) {
      activeGameKey = enabledGames[0];
    }

    const language = (saved.language === 'ja' || saved.language === 'en') ? saved.language : 'auto';
    const analyticsConsentReviewed = Boolean(saved.analyticsConsentReviewed);
    const analyticsEnabled = analyticsConsentReviewed ? Boolean(saved.analyticsEnabled) : false;
    const agreedPolicyVersion = saved.agreedPolicyVersion
      ? String(saved.agreedPolicyVersion)
      : (saved.optInAccepted ? LEGACY_POLICY_VERSION : null);

    return {
      optInAccepted: false,
      autoRedeemEnabled: false,
      autoSignEnabled: saved.optInAccepted ? true : false,
      ...saved,
      enabledGames,
      activeGameKey,
      language,
      analyticsConsentReviewed,
      analyticsEnabled,
      agreedPolicyVersion
    };
  }

  async function updateSettings(partial) {
    const current = await getSettings();
    const updated = { ...current, ...partial };
    await storage.local.set({ [STORAGE_KEYS.APP_SETTINGS]: updated });
    return updated;
  }

  async function getOrCreateGaClientId() {
    if (!storage.local.isAvailable()) {
      return '00000000-0000-4000-8000-000000000000';
    }
    const data = await storage.local.get(STORAGE_KEYS.GA_CLIENT_ID);
    if (data && data[STORAGE_KEYS.GA_CLIENT_ID]) {
      return data[STORAGE_KEYS.GA_CLIENT_ID];
    }
    const newClientId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
    await storage.local.set({ [STORAGE_KEYS.GA_CLIENT_ID]: newClientId });
    return newClientId;
  }

  async function getOrCreateGaSessionId(nowMs = clock.now()) {
    const now = nowMs;
    try {
      if (storage.session.isAvailable()) {
        const data = await storage.session.get([STORAGE_KEYS.GA_SESSION_ID, STORAGE_KEYS.GA_LAST_ACTIVE]);
        const sid = data?.[STORAGE_KEYS.GA_SESSION_ID];
        const lastActive = Number(data?.[STORAGE_KEYS.GA_LAST_ACTIVE] || 0);

        if (sid && lastActive && (now - lastActive < config.GA_SESSION_TIMEOUT_MS)) {
          await storage.session.set({ [STORAGE_KEYS.GA_LAST_ACTIVE]: now });
          return String(sid);
        }

        const newSid = String(now);
        await storage.session.set({
          [STORAGE_KEYS.GA_SESSION_ID]: newSid,
          [STORAGE_KEYS.GA_LAST_ACTIVE]: now
        });
        return newSid;
      }
    } catch {
      // ignore
    }
    return String(now);
  }

  async function checkStorageCapacity() {
    const bytes = await storage.local.getBytesInUse();
    if (typeof bytes === 'number' && bytes > STORAGE_MAX_BYTES * config.STORAGE_WARNING_THRESHOLD) {
      return { isWarning: true, usageBytes: bytes };
    }
    return { isWarning: false };
  }

  async function canAcceptNewCode(gameBiz) {
    const key = dailyCountsKey(gameBiz);
    const data = await storage.local.get(key);
    const now = clock.now();
    const record = data?.[key] || { count: 0, resetAt: now + ONE_DAY_MS };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + ONE_DAY_MS;
    }

    if (record.count >= config.DAILY_NEW_CODE_LIMIT) {
      return false;
    }

    record.count++;
    await storage.local.set({ [key]: record });
    return true;
  }

  async function getRedeemedCodes(gameBiz) {
    const key = redeemedKey(gameBiz);
    const data = await storage.local.get(key);
    return data?.[key] || {};
  }

  async function markCodeStatus(gameBiz, cdkey, statusStr) {
    const key = redeemedKey(gameBiz);
    const current = await getRedeemedCodes(gameBiz);
    const entry = { ...(current[cdkey] || { r: 0 }) };

    if (statusStr === 'RETRY') {
      entry.r = (entry.r || 0) + 1;
      entry.s = entry.r >= config.MAX_CODE_RETRIES ? STATUS_MAP.FAILED : STATUS_MAP.PENDING_RETRY;
    } else {
      entry.s = STATUS_MAP[statusStr] ?? STATUS_MAP.EXPIRED;
    }
    entry.t = Math.floor(clock.now() / 1000);

    current[cdkey] = entry;

    try {
      await storage.local.set({ [key]: current });
    } catch (err) {
      throw new Error(`STORAGE_WRITE_FAILURE: ${err.message}`);
    }
  }

  async function setActiveCodes(gameBiz, codes) {
    const key = activeCodesKey(gameBiz);
    await storage.local.set({ [key]: Array.isArray(codes) ? codes : [] });
  }

  async function pruneHistoryIfExceeded(gameBiz, activeCodesList) {
    if (Array.isArray(activeCodesList)) {
      await setActiveCodes(gameBiz, activeCodesList);
    }

    const key = redeemedKey(gameBiz);
    const current = await getRedeemedCodes(gameBiz);
    const keys = Object.keys(current);

    if (keys.length <= config.MAX_REDEEMED_HISTORY_LIMIT) {
      return;
    }

    const activeSet = new Set(activeCodesList);
    const prunableKeys = keys
      .filter(k => !activeSet.has(k) && current[k].s !== STATUS_MAP.PENDING_RETRY)
      .sort((a, b) => current[a].t - current[b].t);

    const deleteCount = keys.length - config.MAX_REDEEMED_HISTORY_LIMIT;
    for (let i = 0; i < Math.min(deleteCount, prunableKeys.length); i++) {
      delete current[prunableKeys[i]];
    }

    await storage.local.set({ [key]: current });
  }

  async function getCodeRedeemStats(gameBiz, nowMs = clock.now()) {
    const rKey = redeemedKey(gameBiz);
    const aKey = activeCodesKey(gameBiz);
    const data = await storage.local.get([rKey, aKey]);
    const redeemed = data?.[rKey] || {};
    const activeCodes = Array.isArray(data?.[aKey]) ? data[aKey] : null;
    const monthStartSec = getHoyoMonthStartSec(nowMs);
    const isClaimed = (s) => s === STATUS_MAP.SUCCESS || s === STATUS_MAP.ALREADY_CLAIMED;

    let monthlyCount = 0;
    let totalCount = 0;

    for (const entry of Object.values(redeemed)) {
      if (entry && isClaimed(entry.s)) {
        totalCount++;
        if ((entry.t || 0) >= monthStartSec) {
          monthlyCount++;
        }
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

    return {
      monthlyCount,
      totalCount,
      activeTotal,
      activeClaimed
    };
  }

  async function getExecutionLogs() {
    const data = await storage.local.get(STORAGE_KEYS.EXEC_LOGS);
    return Array.isArray(data?.[STORAGE_KEYS.EXEC_LOGS]) ? data[STORAGE_KEYS.EXEC_LOGS] : [];
  }

  async function addExecutionLog(logEntry) {
    const logs = [...(await getExecutionLogs())];
    logs.unshift({
      timestamp: clock.now(),
      ...logEntry
    });
    if (logs.length > config.MAX_EXECUTION_LOGS) {
      logs.pop();
    }
    await storage.local.set({ [STORAGE_KEYS.EXEC_LOGS]: logs });
  }

  async function shouldRunRedeem(minIntervalMinutes = config.REDEEM_INTERVAL_MINUTES, nowMs = clock.now()) {
    const data = await storage.local.get([
      STORAGE_KEYS.LAST_SUCCESSFUL_RUN,
      STORAGE_KEYS.LAST_REDEEM_ATTEMPT
    ]);
    const lastSuccess = Number(data?.[STORAGE_KEYS.LAST_SUCCESSFUL_RUN] || 0);
    const lastAttempt = Number(data?.[STORAGE_KEYS.LAST_REDEEM_ATTEMPT] || 0);
    const lastRun = Math.max(lastSuccess, lastAttempt);
    return (nowMs - lastRun) >= minIntervalMinutes * 60 * 1000;
  }

  async function getDailySignRecord(gameBiz) {
    const key = dailySignKey(gameBiz);
    const data = await storage.local.get(key);
    return data?.[key] || null;
  }

  async function setDailySignRecord(gameBiz, record) {
    const key = dailySignKey(gameBiz);
    const current = await getDailySignRecord(gameBiz);
    // 日付が切り替わった場合は古い日の captchaBlocked / skippedNoChar を引き継がない
    const isSameDate = Boolean(current && record.date && current.date === record.date);
    const base = isSameDate ? current : {};
    const updated = {
      ...base,
      ...record,
      updatedAt: clock.now()
    };
    if (record.isSigned === true) {
      updated.captchaBlocked = false;
    }
    try {
      await storage.local.set({ [key]: updated });
    } catch (err) {
      throw new Error(`STORAGE_WRITE_FAILURE: ${err.message}`);
    }
    return updated;
  }

  function resolveDailySignSkipReasonFromRecord(record, today) {
    if (!record || record.date !== today) {
      return null;
    }
    if (record.isSigned === true || record.skippedNoChar === true) {
      return 'ALREADY_SIGNED_TODAY';
    }
    if (record.captchaBlocked === true) {
      return 'CAPTCHA_BLOCKED_TODAY';
    }
    return null;
  }

  async function getDailySignSkipReason(gameBiz, nowMs = clock.now()) {
    const record = await getDailySignRecord(gameBiz);
    return resolveDailySignSkipReasonFromRecord(record, getHoyoTodayDateString(nowMs));
  }

  async function shouldRunDailySign(gameBizList, nowMs = clock.now()) {
    if (!Array.isArray(gameBizList) || gameBizList.length === 0) {
      return false;
    }
    const keys = gameBizList.map(dailySignKey);
    const data = await storage.local.get(keys);
    const today = getHoyoTodayDateString(nowMs);
    for (const key of keys) {
      if (!resolveDailySignSkipReasonFromRecord(data?.[key], today)) {
        return true;
      }
    }
    return false;
  }

  async function getOrCreateDailySignJitterMinutes(randFn = random) {
    let existing = null;
    if (storage.local.isAvailable()) {
      const data = await storage.local.get(STORAGE_KEYS.DAILY_SIGN_JITTER_MINUTES);
      const val = data?.[STORAGE_KEYS.DAILY_SIGN_JITTER_MINUTES];
      if (
        typeof val === 'number' &&
        Number.isInteger(val) &&
        val >= 0 &&
        val <= config.DAILY_SIGN_JITTER_MAX_MINUTES
      ) {
        existing = val;
      }
    }
    if (existing !== null) {
      return { minutes: existing, created: false };
    }

    const maxMinutes = config.DAILY_SIGN_JITTER_MAX_MINUTES;
    const minutes = Math.floor(clampUnitRandom(randFn) * (maxMinutes + 1));
    if (storage.local.isAvailable()) {
      await storage.local.set({ [STORAGE_KEYS.DAILY_SIGN_JITTER_MINUTES]: minutes });
    }
    return { minutes, created: true };
  }

  async function getBackoffState(nowMs = clock.now()) {
    if (!storage.local.isAvailable()) {
      return { isActive: false, until: 0, remainingMs: 0, remainingMinutes: 0, level: 0 };
    }
    const data = await storage.local.get([
      STORAGE_KEYS.BACKOFF_UNTIL,
      STORAGE_KEYS.BACKOFF_LEVEL
    ]);
    const until = Number(data?.[STORAGE_KEYS.BACKOFF_UNTIL] || 0);
    const level = Number(data?.[STORAGE_KEYS.BACKOFF_LEVEL] || 0);
    const remainingMs = Math.max(0, until - nowMs);
    const isActive = remainingMs > 0;
    return {
      isActive,
      until,
      remainingMs,
      remainingMinutes: isActive ? Math.ceil(remainingMs / 60_000) : 0,
      level
    };
  }

  async function isUnderBackoff(nowMs = clock.now()) {
    const state = await getBackoffState(nowMs);
    return state.isActive;
  }

  async function recordBackoffFailure({ retryAfterMs = null, nowMs = clock.now() } = {}) {
    const steps = config.BACKOFF_STEPS_MS;
    let currentLevel = 0;
    if (storage.local.isAvailable()) {
      const levelData = await storage.local.get(STORAGE_KEYS.BACKOFF_LEVEL);
      currentLevel = Number(levelData?.[STORAGE_KEYS.BACKOFF_LEVEL] || 0);
    }

    const nextLevel = Math.min(Math.max(0, currentLevel) + 1, steps.length);
    const baseMs = steps[nextLevel - 1];
    const maxMs = steps[steps.length - 1];
    const hasRetryAfter = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0;
    const durationMs = hasRetryAfter ? Math.min(maxMs, Math.max(baseMs, retryAfterMs)) : baseMs;
    const until = nowMs + durationMs;

    if (storage.local.isAvailable()) {
      await storage.local.set({
        [STORAGE_KEYS.BACKOFF_UNTIL]: until,
        [STORAGE_KEYS.BACKOFF_LEVEL]: nextLevel
      });
    }

    return {
      until,
      durationMs,
      remainingMinutes: Math.ceil(durationMs / 60_000),
      level: nextLevel
    };
  }

  async function getRetryStateInternal(kind, nowMs = clock.now()) {
    const empty = { count: 0, updatedAt: 0, exhaustedLogged: false };
    if (!storage.local.isAvailable()) {
      return empty;
    }

    const key = resolveRetryStateKey(kind);
    const data = await storage.local.get(key);
    const saved = data?.[key];
    if (!saved || typeof saved !== 'object') {
      return empty;
    }

    const updatedAt = Number(saved.updatedAt || 0);
    const ttlMs = config.AUTO_ATTEMPT_COOLDOWN_MINUTES * 60 * 1000;
    if (updatedAt > 0 && nowMs - updatedAt >= ttlMs) {
      return empty;
    }

    return {
      count: Math.max(0, Number(saved.count || 0)),
      updatedAt,
      exhaustedLogged: Boolean(saved.exhaustedLogged)
    };
  }

  /**
   * 短期リトライ枠を1消費する（最大3回: 2→10→30分＋揺らぎ）。
   * 上限到達時は exhausted: true を返し、打ち止めログの初回出力のみ許可する。
   */
  async function consumeRetrySlot(
    kind,
    { nowMs = clock.now(), randFn = random, explicitDelayMinutes = null } = {}
  ) {
    const key = resolveRetryStateKey(kind);
    const steps = config.RETRY_DELAY_STEPS_MINUTES;
    const maxAttempts = steps.length;
    const state = await getRetryStateInternal(kind, nowMs);

    if (state.count >= maxAttempts) {
      const shouldLogExhausted = !state.exhaustedLogged;
      if (shouldLogExhausted && storage.local.isAvailable()) {
        await storage.local.set({
          [key]: {
            count: state.count,
            updatedAt: state.updatedAt || nowMs,
            exhaustedLogged: true
          }
        });
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
      : Number((baseMinutes + clampUnitRandom(randFn) * config.RETRY_JITTER_MAX_MINUTES).toFixed(2));
    const nextCount = state.count + 1;

    if (storage.local.isAvailable()) {
      await storage.local.set({
        [key]: {
          count: nextCount,
          updatedAt: nowMs,
          exhaustedLogged: false
        }
      });
    }

    return {
      allowed: true,
      exhausted: false,
      shouldLogExhausted: false,
      attempt: nextCount,
      maxAttempts,
      baseMinutes,
      delayMinutes
    };
  }

  async function resetRetryState(kind) {
    if (!storage.local.isAvailable()) {
      return;
    }
    const key = resolveRetryStateKey(kind);
    await storage.local.set({
      [key]: { count: 0, updatedAt: 0, exhaustedLogged: false }
    });
  }

  /**
   * 自動キャッチアップ用の再試行クールダウン判定。
   * SIGN は HoYo 日付（UTC+8）を跨いだ時点で即解除される。
   */
  async function isUnderAutoAttemptCooldown(
    kind,
    cooldownMinutes = config.AUTO_ATTEMPT_COOLDOWN_MINUTES,
    nowMs = clock.now()
  ) {
    if (!storage.local.isAvailable()) {
      return false;
    }
    const key = resolveAttemptKey(kind);
    const data = await storage.local.get(key);
    const last = Number(data?.[key] || 0);
    if (last <= 0) {
      return false;
    }
    if (kind === 'SIGN' && !isSameHoyoDay(last, nowMs)) {
      return false;
    }
    return (nowMs - last) < cooldownMinutes * 60 * 1000;
  }

  async function checkManualCooldown(
    category,
    gameKey,
    nowMs = clock.now(),
    cooldownMs = config.MANUAL_COOLDOWN_MS
  ) {
    if (!storage.session.isAvailable()) {
      return { allowed: true, remainingMs: 0, remainingSec: 0 };
    }
    const data = await storage.session.get(STORAGE_KEYS.MANUAL_COOLDOWNS);
    const map = data?.[STORAGE_KEYS.MANUAL_COOLDOWNS] || {};
    const last = Number(map[`${category}:${gameKey}`] || 0);
    const elapsed = nowMs - last;
    if (last > 0 && elapsed >= 0 && elapsed < cooldownMs) {
      const remainingMs = cooldownMs - elapsed;
      return {
        allowed: false,
        remainingMs,
        remainingSec: Math.ceil(remainingMs / 1000)
      };
    }
    return { allowed: true, remainingMs: 0, remainingSec: 0 };
  }

  async function recordFlowStart(
    kind,
    { isManual = false, category = null, gameKey = null, nowMs = clock.now() } = {}
  ) {
    if (isManual) {
      if (category && gameKey && storage.session.isAvailable()) {
        const data = await storage.session.get(STORAGE_KEYS.MANUAL_COOLDOWNS);
        const map = { ...(data?.[STORAGE_KEYS.MANUAL_COOLDOWNS] || {}) };
        map[`${category}:${gameKey}`] = nowMs;
        await storage.session.set({ [STORAGE_KEYS.MANUAL_COOLDOWNS]: map });
      }
      await resetRetryState(kind);
      return;
    }

    if (storage.local.isAvailable()) {
      const key = resolveAttemptKey(kind);
      await storage.local.set({ [key]: nowMs });
    }
  }

  async function recordFlowSuccess(
    kind,
    { isManual = false, recordSuccessTimestamp = false, nowMs = clock.now() } = {}
  ) {
    if (storage.local.isAvailable()) {
      const levelData = await storage.local.get(STORAGE_KEYS.BACKOFF_LEVEL);
      if (Number(levelData?.[STORAGE_KEYS.BACKOFF_LEVEL] || 0) !== 0) {
        await storage.local.set({ [STORAGE_KEYS.BACKOFF_LEVEL]: 0 });
      }
    }

    if (!isManual) {
      if (recordSuccessTimestamp && storage.local.isAvailable()) {
        await storage.local.set({ [STORAGE_KEYS.LAST_SUCCESSFUL_RUN]: nowMs });
      }
      await resetRetryState(kind);
    }
  }

  async function getReviewPromptRecord() {
    const data = await storage.local.get(STORAGE_KEYS.REVIEW_PROMPT);
    return data?.[STORAGE_KEYS.REVIEW_PROMPT] ?? null;
  }

  async function saveReviewPromptRecord(record) {
    await storage.local.set({ [STORAGE_KEYS.REVIEW_PROMPT]: record });
    return record;
  }

  async function countHistoricalReviewSuccesses(gameBizList) {
    if (!Array.isArray(gameBizList) || gameBizList.length === 0) {
      return 0;
    }
    const keysToFetch = [
      ...gameBizList.map(redeemedKey),
      ...gameBizList.map(dailySignKey)
    ];
    const historyData = await storage.local.get(keysToFetch);
    let migratedCount = 0;

    for (const biz of gameBizList) {
      const redeemed = historyData?.[redeemedKey(biz)] || {};
      for (const entry of Object.values(redeemed)) {
        if (entry && entry.s === STATUS_MAP.SUCCESS) {
          migratedCount++;
        }
      }
      const signRec = historyData?.[dailySignKey(biz)];
      if (signRec && signRec.isSigned === true) {
        migratedCount++;
      }
    }

    return migratedCount;
  }

  function subscribeChanges(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    const handler = (changes, areaName) => {
      if (areaName !== 'local' || !changes || typeof changes !== 'object') {
        return;
      }

      let logsChanged = false;
      let settingsChanged = false;
      const redeemChangedSet = new Set();
      const signChangedSet = new Set();

      for (const key of Object.keys(changes)) {
        if (key === STORAGE_KEYS.EXEC_LOGS) {
          logsChanged = true;
        } else if (key === STORAGE_KEYS.APP_SETTINGS) {
          settingsChanged = true;
        } else if (key.startsWith('redeemed_')) {
          redeemChangedSet.add(key.slice('redeemed_'.length));
        } else if (key.startsWith('active_codes_')) {
          redeemChangedSet.add(key.slice('active_codes_'.length));
        } else if (key.startsWith('daily_sign_') && key !== STORAGE_KEYS.DAILY_SIGN_JITTER_MINUTES) {
          signChangedSet.add(key.slice('daily_sign_'.length));
        }
      }

      if (logsChanged || settingsChanged || redeemChangedSet.size > 0 || signChangedSet.size > 0) {
        listener({
          logsChanged,
          settingsChanged,
          redeemChangedBiz: [...redeemChangedSet],
          signChangedBiz: [...signChangedSet]
        });
      }
    };

    storage.onChanged.addListener(handler);
    return () => {
      storage.onChanged.removeListener(handler);
    };
  }

  return {
    acquireExecutionLock,
    releaseExecutionLock,
    pingSessionKeepAlive,
    getSettings,
    updateSettings,
    getOrCreateGaClientId,
    getOrCreateGaSessionId,
    checkStorageCapacity,
    canAcceptNewCode,
    getRedeemedCodes,
    markCodeStatus,
    pruneHistoryIfExceeded,
    setActiveCodes,
    getCodeRedeemStats,
    getExecutionLogs,
    addExecutionLog,
    shouldRunRedeem,
    getDailySignRecord,
    setDailySignRecord,
    getDailySignSkipReason,
    shouldRunDailySign,
    getOrCreateDailySignJitterMinutes,
    getBackoffState,
    isUnderBackoff,
    recordBackoffFailure,
    consumeRetrySlot,
    resetRetryState,
    isUnderAutoAttemptCooldown,
    checkManualCooldown,
    recordFlowStart,
    recordFlowSuccess,
    getReviewPromptRecord,
    saveReviewPromptRecord,
    countHistoricalReviewSuccesses,
    subscribeChanges
  };
}

export const defaultStateStore = createStateStore();

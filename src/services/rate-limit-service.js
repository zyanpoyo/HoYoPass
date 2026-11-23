import { API_CONFIG } from '../config/constants.js';

const DAILY_SIGN_JITTER_KEY = 'daily_sign_jitter_minutes';
const BACKOFF_UNTIL_KEY = 'backoff_until';
const BACKOFF_LEVEL_KEY = 'backoff_level';
const MANUAL_COOLDOWNS_KEY = 'manual_cooldowns';

const RETRY_STATE_KEYS = {
  REDEEM: 'retry_state_redeem',
  SIGN: 'retry_state_sign'
};

const ATTEMPT_TIMESTAMP_KEYS = {
  REDEEM: 'last_redeem_attempt',
  SIGN: 'last_sign_attempt'
};

const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function clampUnitRandom(randFn = Math.random) {
  const val = Number(randFn());
  if (!Number.isFinite(val)) return 0;
  return Math.min(0.999999999999, Math.max(0, val));
}

function resolveRetryStateKey(kind) {
  return RETRY_STATE_KEYS[kind] || RETRY_STATE_KEYS.REDEEM;
}

function resolveAttemptKey(kind) {
  return ATTEMPT_TIMESTAMP_KEYS[kind] || ATTEMPT_TIMESTAMP_KEYS.REDEEM;
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

export async function getDailySignJitterMinutes() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }
  const data = await chrome.storage.local.get(DAILY_SIGN_JITTER_KEY);
  const val = data?.[DAILY_SIGN_JITTER_KEY];
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= API_CONFIG.DAILY_SIGN_JITTER_MAX_MINUTES) {
    return val;
  }
  return null;
}

/**
 * ユーザー固定のログボ実行オフセット（0〜30分）を取得、未設定なら生成・保存する。
 * 既存ユーザーはアップデート初回にのみ自動生成される。
 */
export async function getOrCreateDailySignJitterMinutes(randFn = Math.random) {
  const existing = await getDailySignJitterMinutes();
  if (existing !== null) {
    return { minutes: existing, created: false };
  }

  const maxMinutes = API_CONFIG.DAILY_SIGN_JITTER_MAX_MINUTES;
  const minutes = Math.floor(clampUnitRandom(randFn) * (maxMinutes + 1));
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [DAILY_SIGN_JITTER_KEY]: minutes });
  }
  return { minutes, created: true };
}

export async function getBackoffState(nowMs = Date.now()) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { isActive: false, until: 0, remainingMs: 0, remainingMinutes: 0, level: 0 };
  }
  const untilData = await chrome.storage.local.get(BACKOFF_UNTIL_KEY);
  const levelData = await chrome.storage.local.get(BACKOFF_LEVEL_KEY);
  const until = Number(untilData?.[BACKOFF_UNTIL_KEY] || 0);
  const level = Number(levelData?.[BACKOFF_LEVEL_KEY] || 0);
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

export async function isUnderBackoff(nowMs = Date.now()) {
  const state = await getBackoffState(nowMs);
  return state.isActive;
}

export async function setBackoff(durationMs = API_CONFIG.BACKOFF_DURATION_MS, nowMs = Date.now()) {
  const until = nowMs + durationMs;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [BACKOFF_UNTIL_KEY]: until });
  }
  return until;
}

/**
 * 429 / 5xx / -2016 検知時に指数バックオフ（30→60→120分）を進める。
 */
export async function recordBackoffFailure({ retryAfterMs = null, nowMs = Date.now() } = {}) {
  const steps = API_CONFIG.BACKOFF_STEPS_MS;
  let currentLevel = 0;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const levelData = await chrome.storage.local.get(BACKOFF_LEVEL_KEY);
    currentLevel = Number(levelData?.[BACKOFF_LEVEL_KEY] || 0);
  }

  const nextLevel = Math.min(Math.max(0, currentLevel) + 1, steps.length);
  const baseMs = steps[nextLevel - 1];
  const maxMs = steps[steps.length - 1];
  const hasRetryAfter = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0;
  const durationMs = hasRetryAfter ? Math.min(maxMs, Math.max(baseMs, retryAfterMs)) : baseMs;
  const until = nowMs + durationMs;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({
      [BACKOFF_UNTIL_KEY]: until,
      [BACKOFF_LEVEL_KEY]: nextLevel
    });
  }

  return {
    until,
    durationMs,
    remainingMinutes: Math.ceil(durationMs / 60_000),
    level: nextLevel
  };
}

export async function resetBackoffLevel() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  const levelData = await chrome.storage.local.get(BACKOFF_LEVEL_KEY);
  if (Number(levelData?.[BACKOFF_LEVEL_KEY] || 0) !== 0) {
    await chrome.storage.local.set({ [BACKOFF_LEVEL_KEY]: 0 });
  }
}

export async function getRetryState(kind, nowMs = Date.now()) {
  const empty = { count: 0, updatedAt: 0, exhaustedLogged: false };
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return empty;
  }

  const key = resolveRetryStateKey(kind);
  const data = await chrome.storage.local.get(key);
  const saved = data?.[key];
  if (!saved || typeof saved !== 'object') {
    return empty;
  }

  const updatedAt = Number(saved.updatedAt || 0);
  const ttlMs = API_CONFIG.AUTO_ATTEMPT_COOLDOWN_MINUTES * 60 * 1000;
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
export async function consumeRetrySlot(kind, { nowMs = Date.now(), randFn = Math.random, explicitDelayMinutes = null } = {}) {
  const key = resolveRetryStateKey(kind);
  const steps = API_CONFIG.RETRY_DELAY_STEPS_MINUTES;
  const maxAttempts = steps.length;
  const state = await getRetryState(kind, nowMs);

  if (state.count >= maxAttempts) {
    const shouldLogExhausted = !state.exhaustedLogged;
    if (shouldLogExhausted && typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
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

  const hasExplicit = typeof explicitDelayMinutes === 'number' && Number.isFinite(explicitDelayMinutes) && explicitDelayMinutes > 0;
  const baseMinutes = hasExplicit ? explicitDelayMinutes : steps[state.count];
  const delayMinutes = hasExplicit
    ? explicitDelayMinutes
    : Number((baseMinutes + clampUnitRandom(randFn) * API_CONFIG.RETRY_JITTER_MAX_MINUTES).toFixed(2));
  const nextCount = state.count + 1;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({
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

export async function resetRetryState(kind) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  const key = resolveRetryStateKey(kind);
  await chrome.storage.local.set({
    [key]: { count: 0, updatedAt: 0, exhaustedLogged: false }
  });
}

export async function getLastAttemptTimestamp(kind) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return 0;
  }
  const key = resolveAttemptKey(kind);
  const data = await chrome.storage.local.get(key);
  return Number(data?.[key] || 0);
}

export async function setLastAttemptTimestamp(kind, timestamp = Date.now()) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  const key = resolveAttemptKey(kind);
  await chrome.storage.local.set({ [key]: timestamp });
}

/**
 * 自動キャッチアップ用の再試行クールダウン判定。
 * SIGN は HoYo 日付（UTC+8）を跨いだ時点で即解除される。
 */
export async function isUnderAutoAttemptCooldown(
  kind,
  cooldownMinutes = API_CONFIG.AUTO_ATTEMPT_COOLDOWN_MINUTES,
  nowMs = Date.now()
) {
  const last = await getLastAttemptTimestamp(kind);
  if (last <= 0) {
    return false;
  }
  if (kind === 'SIGN') {
    const lastUtc8Day = Math.floor((last + UTC8_OFFSET_MS) / ONE_DAY_MS);
    const nowUtc8Day = Math.floor((nowMs + UTC8_OFFSET_MS) / ONE_DAY_MS);
    if (lastUtc8Day !== nowUtc8Day) {
      return false;
    }
  }
  return (nowMs - last) < cooldownMinutes * 60 * 1000;
}

export async function checkManualCooldown(
  category,
  gameKey,
  nowMs = Date.now(),
  cooldownMs = API_CONFIG.MANUAL_COOLDOWN_MS
) {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return { allowed: true, remainingMs: 0, remainingSec: 0 };
  }
  const data = await chrome.storage.session.get(MANUAL_COOLDOWNS_KEY);
  const map = data?.[MANUAL_COOLDOWNS_KEY] || {};
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

export async function recordManualCooldown(category, gameKey, nowMs = Date.now()) {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return;
  }
  const data = await chrome.storage.session.get(MANUAL_COOLDOWNS_KEY);
  const map = { ...(data?.[MANUAL_COOLDOWNS_KEY] || {}) };
  map[`${category}:${gameKey}`] = nowMs;
  await chrome.storage.session.set({ [MANUAL_COOLDOWNS_KEY]: map });
}

export async function clearManualCooldowns() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) {
    return;
  }
  if (typeof chrome.storage.session.remove === 'function') {
    await chrome.storage.session.remove(MANUAL_COOLDOWNS_KEY);
  } else {
    await chrome.storage.session.set({ [MANUAL_COOLDOWNS_KEY]: {} });
  }
}

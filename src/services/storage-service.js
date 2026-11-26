import {
  API_CONFIG,
  STATUS_MAP,
  GAMES,
  DEFAULT_ENABLED_GAMES,
  PRIVACY_POLICY_VERSION,
  LEGACY_POLICY_VERSION
} from '../config/constants.js';
import {
  isUnderBackoff,
  setBackoff,
  getBackoffState,
  recordBackoffFailure,
  resetBackoffLevel,
  computeJitteredDelayMs,
  getDailySignJitterMinutes,
  getOrCreateDailySignJitterMinutes,
  getRetryState,
  consumeRetrySlot,
  resetRetryState,
  getLastAttemptTimestamp,
  setLastAttemptTimestamp,
  isUnderAutoAttemptCooldown,
  checkManualCooldown,
  recordManualCooldown,
  clearManualCooldowns
} from './rate-limit-service.js';

const LOCK_STATE_KEY = 'lock_state';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const STORAGE_MAX_BYTES = 10 * 1024 * 1024;

export {
  isUnderBackoff,
  setBackoff,
  getBackoffState,
  recordBackoffFailure,
  resetBackoffLevel,
  computeJitteredDelayMs,
  getDailySignJitterMinutes,
  getOrCreateDailySignJitterMinutes,
  getRetryState,
  consumeRetrySlot,
  resetRetryState,
  getLastAttemptTimestamp,
  setLastAttemptTimestamp,
  isUnderAutoAttemptCooldown,
  checkManualCooldown,
  recordManualCooldown,
  clearManualCooldowns
};

export async function acquireExecutionLock(triggerSource) {
  const session = await chrome.storage.session.get(LOCK_STATE_KEY);
  const lock = session[LOCK_STATE_KEY];
  const now = Date.now();

  if (lock && lock.running && now - lock.startedAt < LOCK_TIMEOUT_MS) {
    return false;
  }

  await chrome.storage.session.set({
    [LOCK_STATE_KEY]: { running: true, startedAt: now, trigger: triggerSource }
  });
  return true;
}

export async function releaseExecutionLock() {
  await chrome.storage.session.remove(LOCK_STATE_KEY);
}

/**
 * MV3 Service Worker のアイドル停止を防ぐため、session ストレージへ軽量アクセスを行う。
 */
export async function pingSessionKeepAlive() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session?.get) {
      await chrome.storage.session.get(LOCK_STATE_KEY);
    }
  } catch {
    // keepalive ping の失敗でキャッチアップ本体を止めない
  }
}

export function needsPolicyReview(settings, current = PRIVACY_POLICY_VERSION) {
  return Boolean(settings?.optInAccepted) &&
    (settings?.agreedPolicyVersion ?? '') < current;
}

export async function getSettings() {
  const data = await chrome.storage.local.get('app_settings');
  const saved = data.app_settings;
  const defaultGames = DEFAULT_ENABLED_GAMES || Object.keys(GAMES);

  if (!saved) {
    return {
      optInAccepted: false,
      autoRedeemEnabled: false,
      autoSignEnabled: false,
      activeGameKey: 'GENSHIN',
      enabledGames: [...defaultGames],
      language: 'auto',
      analyticsConsentReviewed: false,
      analyticsEnabled: false,
      agreedPolicyVersion: null
    };
  }

  // 既存ユーザー向け補完・配列バリデーション
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

export async function updateSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ app_settings: updated });
  return updated;
}

export async function getOrCreateGaClientId() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return '00000000-0000-4000-8000-000000000000';
  }
  const data = await chrome.storage.local.get('ga_client_id');
  if (data && data.ga_client_id) {
    return data.ga_client_id;
  }
  const newClientId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
  await chrome.storage.local.set({ ga_client_id: newClientId });
  return newClientId;
}

export async function checkStorageCapacity() {
  if (chrome.storage.local.getBytesInUse) {
    const bytes = await chrome.storage.local.getBytesInUse();
    if (bytes > STORAGE_MAX_BYTES * API_CONFIG.STORAGE_WARNING_THRESHOLD) {
      return { isWarning: true, usageBytes: bytes };
    }
  }
  return { isWarning: false };
}

export async function canAcceptNewCode(gameBiz) {
  const key = `daily_counts_${gameBiz}`;
  const data = await chrome.storage.local.get(key);
  const record = data[key] || { count: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 };

  const now = Date.now();
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 24 * 60 * 60 * 1000;
  }

  if (record.count >= API_CONFIG.DAILY_NEW_CODE_LIMIT) {
    return false;
  }

  record.count++;
  await chrome.storage.local.set({ [key]: record });
  return true;
}

export async function getRedeemedCodes(gameBiz) {
  const key = `redeemed_${gameBiz}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || {};
}

export async function markCodeStatus(gameBiz, cdkey, statusStr) {
  const key = `redeemed_${gameBiz}`;
  const current = await getRedeemedCodes(gameBiz);
  const entry = current[cdkey] || { r: 0 };

  if (statusStr === 'RETRY') {
    entry.r = (entry.r || 0) + 1;
    entry.s = entry.r >= API_CONFIG.MAX_CODE_RETRIES ? STATUS_MAP.FAILED : STATUS_MAP.PENDING_RETRY;
  } else {
    entry.s = STATUS_MAP[statusStr] ?? STATUS_MAP.EXPIRED;
  }
  entry.t = Math.floor(Date.now() / 1000);

  current[cdkey] = entry;

  try {
    await chrome.storage.local.set({ [key]: current });
  } catch (err) {
    throw new Error(`STORAGE_WRITE_FAILURE: ${err.message}`);
  }
}

export async function pruneHistoryIfExceeded(gameBiz, activeCodesList) {
  if (Array.isArray(activeCodesList)) {
    await setActiveCodes(gameBiz, activeCodesList);
  }

  const key = `redeemed_${gameBiz}`;
  const current = await getRedeemedCodes(gameBiz);
  const keys = Object.keys(current);

  if (keys.length <= API_CONFIG.MAX_REDEEMED_HISTORY_LIMIT) {
    return;
  }

  const activeSet = new Set(activeCodesList);
  const prunableKeys = keys
    .filter(k => !activeSet.has(k) && current[k].s !== STATUS_MAP.PENDING_RETRY)
    .sort((a, b) => current[a].t - current[b].t);

  const deleteCount = keys.length - API_CONFIG.MAX_REDEEMED_HISTORY_LIMIT;
  for (let i = 0; i < Math.min(deleteCount, prunableKeys.length); i++) {
    delete current[prunableKeys[i]];
  }

  await chrome.storage.local.set({ [key]: current });
}

export async function getActiveCodes(gameBiz) {
  const key = `active_codes_${gameBiz}`;
  const data = await chrome.storage.local.get(key);
  return Array.isArray(data[key]) ? data[key] : null;
}

export async function setActiveCodes(gameBiz, codes) {
  const key = `active_codes_${gameBiz}`;
  await chrome.storage.local.set({ [key]: Array.isArray(codes) ? codes : [] });
}

export async function getCodeRedeemStats(gameBiz, nowMs = Date.now()) {
  const redeemedKey = `redeemed_${gameBiz}`;
  const activeKey = `active_codes_${gameBiz}`;
  const data = await chrome.storage.local.get([redeemedKey, activeKey]);
  const redeemed = data[redeemedKey] || {};
  const activeCodes = Array.isArray(data[activeKey]) ? data[activeKey] : null;

  // UTC+8 における当月1日 00:00:00 のUNIXタイムスタンプ（秒）
  const utc8OffsetMs = 8 * 60 * 60 * 1000;
  const utc8Date = new Date(nowMs + utc8OffsetMs);
  const monthStartUtc8Ms = Date.UTC(utc8Date.getUTCFullYear(), utc8Date.getUTCMonth(), 1, 0, 0, 0, 0);
  const monthStartSec = Math.floor((monthStartUtc8Ms - utc8OffsetMs) / 1000);

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
    // 期限切れ(EXPIRED)または失敗確定(FAILED)のコードを除外した「現在受け取り可能な有効コード」
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

export async function addExecutionLog(logEntry) {
  const data = await chrome.storage.local.get('exec_logs');
  const logs = data.exec_logs || [];
  logs.unshift({
    timestamp: Date.now(),
    ...logEntry
  });
  if (logs.length > API_CONFIG.MAX_EXECUTION_LOGS) logs.pop();
  await chrome.storage.local.set({ exec_logs: logs });
}

export async function getLastSuccessfulRun() {
  const data = await chrome.storage.local.get('last_successful_run');
  return data.last_successful_run || 0;
}

export async function setLastSuccessfulRun(timestamp = Date.now()) {
  await chrome.storage.local.set({ last_successful_run: timestamp });
}

export async function shouldRunRedeem(minIntervalMinutes = API_CONFIG.REDEEM_INTERVAL_MINUTES, nowMs = Date.now()) {
  const lastSuccess = await getLastSuccessfulRun();
  const lastAttempt = await getLastAttemptTimestamp('REDEEM');
  const lastRun = Math.max(lastSuccess, lastAttempt);
  const elapsedMs = nowMs - lastRun;
  return elapsedMs >= minIntervalMinutes * 60 * 1000;
}

export function getHoyoTodayDateString(nowMs = Date.now()) {
  const utc8Ms = nowMs + 8 * 60 * 60 * 1000;
  return new Date(utc8Ms).toISOString().slice(0, 10);
}

export async function getDailySignRecord(gameBiz) {
  const key = `daily_sign_${gameBiz}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
}

export async function setDailySignRecord(gameBiz, record) {
  const key = `daily_sign_${gameBiz}`;
  const current = await getDailySignRecord(gameBiz);
  // 日付が切り替わった場合は古い日の captchaBlocked / skippedNoChar を引き継がない
  const isSameDate = Boolean(current && record.date && current.date === record.date);
  const base = isSameDate ? current : {};
  const updated = {
    ...base,
    ...record,
    updatedAt: Date.now()
  };
  if (record.isSigned === true) {
    updated.captchaBlocked = false;
  }
  try {
    await chrome.storage.local.set({ [key]: updated });
  } catch (err) {
    throw new Error(`STORAGE_WRITE_FAILURE: ${err.message}`);
  }
  return updated;
}

export async function isDailySignedToday(gameBiz, nowMs = Date.now()) {
  const record = await getDailySignRecord(gameBiz);
  if (!record || !record.date) return false;
  const today = getHoyoTodayDateString(nowMs);
  return record.date === today && (record.isSigned === true || record.skippedNoChar === true);
}

export async function isDailySignAutoSkippedToday(gameBiz, nowMs = Date.now()) {
  const record = await getDailySignRecord(gameBiz);
  if (!record || !record.date) return false;
  const today = getHoyoTodayDateString(nowMs);
  return record.date === today && (
    record.isSigned === true ||
    record.skippedNoChar === true ||
    record.captchaBlocked === true
  );
}

export async function shouldRunDailySign(gameBizList, nowMs = Date.now()) {
  for (const gameBiz of gameBizList) {
    const skipped = await isDailySignAutoSkippedToday(gameBiz, nowMs);
    if (!skipped) return true;
  }
  return false;
}

export {
  getReviewPromptState,
  initReviewPromptState,
  updateReviewPromptState,
  incrementReviewSuccessCount,
  postponeReviewPrompt,
  shouldShowReviewPrompt
} from './review-prompt-service.js';



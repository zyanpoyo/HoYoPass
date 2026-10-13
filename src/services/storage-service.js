import { API_CONFIG, STATUS_MAP } from '../config/constants.js';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const STORAGE_MAX_BYTES = 10 * 1024 * 1024;

export async function acquireExecutionLock(triggerSource) {
  const session = await chrome.storage.session.get('lock_state');
  const lock = session.lock_state;
  const now = Date.now();

  if (lock && lock.running && now - lock.startedAt < LOCK_TIMEOUT_MS) {
    return false;
  }

  await chrome.storage.session.set({
    lock_state: { running: true, startedAt: now, trigger: triggerSource }
  });
  return true;
}

export async function releaseExecutionLock() {
  await chrome.storage.session.remove('lock_state');
}

export async function isUnderBackoff() {
  const data = await chrome.storage.local.get('backoff_until');
  return Date.now() < (data.backoff_until || 0);
}

export async function setBackoff(durationMs = API_CONFIG.BACKOFF_DURATION_MS) {
  await chrome.storage.local.set({ backoff_until: Date.now() + durationMs });
}

export async function getSettings() {
  const data = await chrome.storage.local.get('app_settings');
  return data.app_settings || {
    optInAccepted: false,
    autoRedeemEnabled: false,
    activeGameKey: 'GENSHIN'
  };
}

export async function updateSettings(partial) {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ app_settings: updated });
  return updated;
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

export async function shouldRunRedeem(minIntervalMinutes = API_CONFIG.REDEEM_INTERVAL_MINUTES) {
  const lastRun = await getLastSuccessfulRun();
  const elapsedMs = Date.now() - lastRun;
  return elapsedMs >= minIntervalMinutes * 60 * 1000;
}


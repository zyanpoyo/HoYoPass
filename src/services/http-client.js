import { API_CONFIG } from '../config/constants.js';

const ALLOWED_HOYO_HOSTS = [
  'api-os-takumi.hoyoverse.com',
  'api-os-takumi.hoyolab.com',
  'sg-hk4e-api.hoyoverse.com',
  'sg-hk4e-api.hoyolab.com',
  'sg-hkrpg-api.hoyoverse.com',
  'sg-public-api.hoyoverse.com',
  'sg-public-api.hoyolab.com',
  'public-operation-nap.hoyoverse.com',
  'sg-act-nap-api.hoyoverse.com',
  'sg-act-nap-api.hoyolab.com'
];

const ALLOWED_PUBLIC_HOSTS = [
  'hoyo-codes.seria.moe'
];

export async function hoyoFetch(url, options = {}) {
  const parsedUrl = new URL(url);
  if (!ALLOWED_HOYO_HOSTS.includes(parsedUrl.hostname)) {
    throw new Error(`SECURITY_ERROR: Host ${parsedUrl.hostname} is not allowed for hoyoFetch.`);
  }

  const signal = AbortSignal.timeout(API_CONFIG.HOYO_API_TIMEOUT_MS);
  return fetch(url, {
    ...options,
    credentials: 'include',
    signal
  });
}

export function parseRetryAfterMs(resp, nowMs = Date.now()) {
  const raw = resp?.headers?.get?.('retry-after') ?? resp?.headers?.get?.('Retry-After');
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const diff = parsedDate - nowMs;
    return diff > 0 ? diff : null;
  }
  return null;
}

export function inspectHttpBackoffStatus(resp, nowMs = Date.now()) {
  const status = Number(resp?.status || 0);
  if (status === 429 || status >= 500) {
    return {
      shouldBackoff: true,
      httpStatus: status,
      isRateLimited: status === 429,
      isServerError: status >= 500,
      retryAfterMs: parseRetryAfterMs(resp, nowMs)
    };
  }
  return null;
}

export async function publicFetch(url, options = {}) {
  const parsedUrl = new URL(url);
  if (!ALLOWED_PUBLIC_HOSTS.includes(parsedUrl.hostname)) {
    throw new Error(`SECURITY_ERROR: Host ${parsedUrl.hostname} is not allowed for publicFetch.`);
  }

  const signal = AbortSignal.timeout(API_CONFIG.CODE_API_TIMEOUT_MS);
  return fetch(url, {
    ...options,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal
  });
}

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

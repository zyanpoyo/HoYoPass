import { API_CONFIG, GAMES, ALLOWED_REGIONS } from '../config/constants.js';
import { getExchangeApiLang, getSignApiLang } from '../utils/i18n.js';

const TAKUMI_HOSTS = [
  'https://api-os-takumi.hoyoverse.com',
  'https://api-os-takumi.hoyolab.com'
];

const PUBLIC_CODE_API_ORIGIN = 'https://hoyo-codes.seria.moe';

export const API_STATUS = Object.freeze({
  OK: 'OK',
  ALREADY_SIGNED: 'ALREADY_SIGNED',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  NO_CHARACTER: 'NO_CHARACTER',
  INVALID_ROLE: 'INVALID_ROLE',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_ERROR: 'SERVER_ERROR',
  COOLDOWN: 'COOLDOWN',
  ALREADY_CLAIMED: 'ALREADY_CLAIMED',
  EXPIRED: 'EXPIRED',
  SAME_TYPE_USED: 'SAME_TYPE_USED',
  NON_JSON: 'NON_JSON',
  INVALID_CONFIG: 'INVALID_CONFIG',
  API_ERROR: 'API_ERROR'
});

export const ERROR_KIND = Object.freeze({
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  HTTP_ERROR: 'HTTP_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  SECURITY_ERROR: 'SECURITY_ERROR',
  STORAGE_ERROR: 'STORAGE_ERROR',
  UNKNOWN: 'UNKNOWN'
});

/**
 * 外部通信・検証・プロトコル異常を表す構造化エラー。
 */
export class GatewayError extends Error {
  constructor(kind, message, { httpStatus = 0, code = '', cause } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.code = code;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function buildAllowedHoyoHosts(games = GAMES) {
  const hosts = new Set();
  const addOrigin = (origin) => {
    if (!origin) return;
    hosts.add(new URL(origin).hostname);
  };

  for (const host of TAKUMI_HOSTS) {
    addOrigin(host);
  }
  for (const game of Object.values(games)) {
    addOrigin(game.exchangeHost);
    for (const signHost of game.signHosts || []) {
      addOrigin(signHost);
    }
  }
  return hosts;
}

const ALLOWED_HOYO_HOSTS = buildAllowedHoyoHosts(GAMES);
const ALLOWED_PUBLIC_HOSTS = new Set([new URL(PUBLIC_CODE_API_ORIGIN).hostname]);

function isValidCode(code) {
  if (typeof code !== 'string') return false;
  return /^[A-Za-z0-9]{4,30}$/.test(code);
}

function isValidUid(uid) {
  if (typeof uid !== 'string' && typeof uid !== 'number') return false;
  const str = String(uid);
  return /^\d{6,12}$/.test(str);
}

function isValidRegion(region) {
  if (typeof region !== 'string') return false;
  if (ALLOWED_REGIONS.includes(region)) return true;
  return /^[a-z0-9_]{3,30}$/.test(region) && (region.startsWith('os_') || region.startsWith('prod_'));
}

export function isNotLoggedIn(retcode) {
  return retcode === -100 || retcode === -1071;
}

function isCaptchaRisk(resJson) {
  if (!resJson) return false;
  if (resJson.retcode === 1034) return true;
  const d = resJson.data;
  if (!d) return false;
  return d.is_risk === true ||
    d.gt_result?.is_risk === true ||
    Number(d.risk_code || 0) !== 0;
}

function isTimeoutLikeError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return true;
  }
  const msg = typeof err.message === 'string' ? err.message : '';
  return /timeout|timed\s*out/i.test(msg);
}

/**
 * 例外オブジェクトを構造化された通信/プロトコル/ストレージ種別へ正規化する。
 */
export function classifyGatewayError(err) {
  if (!err) {
    return { kind: ERROR_KIND.UNKNOWN, httpStatus: 0, isRetryable: false, gaErrorType: 'network_error' };
  }

  if (err instanceof GatewayError) {
    switch (err.kind) {
      case ERROR_KIND.TIMEOUT:
        return { kind: ERROR_KIND.TIMEOUT, httpStatus: 0, isRetryable: true, gaErrorType: 'timeout' };
      case ERROR_KIND.NETWORK:
        return { kind: ERROR_KIND.NETWORK, httpStatus: 0, isRetryable: true, gaErrorType: 'network_error' };
      case ERROR_KIND.HTTP_ERROR:
        return {
          kind: ERROR_KIND.HTTP_ERROR,
          httpStatus: Number(err.httpStatus || 0),
          isRetryable: false,
          gaErrorType: 'http_error'
        };
      case ERROR_KIND.PARSE_ERROR:
      case ERROR_KIND.SECURITY_ERROR:
        return { kind: err.kind, httpStatus: 0, isRetryable: false, gaErrorType: 'parse_error' };
      case ERROR_KIND.STORAGE_ERROR:
        return { kind: ERROR_KIND.STORAGE_ERROR, httpStatus: 0, isRetryable: false, gaErrorType: 'network_error' };
      default:
        return { kind: ERROR_KIND.UNKNOWN, httpStatus: 0, isRetryable: false, gaErrorType: 'network_error' };
    }
  }

  const msg = typeof err.message === 'string' ? err.message : '';
  if (msg.startsWith('STORAGE_WRITE_FAILURE')) {
    return { kind: ERROR_KIND.STORAGE_ERROR, httpStatus: 0, isRetryable: false, gaErrorType: 'network_error' };
  }
  if (msg.startsWith('SECURITY_ERROR')) {
    return { kind: ERROR_KIND.SECURITY_ERROR, httpStatus: 0, isRetryable: false, gaErrorType: 'parse_error' };
  }

  const httpMatch = msg.match(/^HTTP_ERROR_(\d+)/);
  if (httpMatch) {
    return {
      kind: ERROR_KIND.HTTP_ERROR,
      httpStatus: parseInt(httpMatch[1], 10),
      isRetryable: false,
      gaErrorType: 'http_error'
    };
  }

  if (isTimeoutLikeError(err)) {
    return { kind: ERROR_KIND.TIMEOUT, httpStatus: 0, isRetryable: true, gaErrorType: 'timeout' };
  }

  if (err instanceof SyntaxError || /json/i.test(msg)) {
    return { kind: ERROR_KIND.PARSE_ERROR, httpStatus: 0, isRetryable: false, gaErrorType: 'parse_error' };
  }

  if (
    /failed to fetch|fetch failed|networkerror|network request failed|err_internet_disconnected|err_network/i.test(msg) ||
    /\bfetch\b|\bnetwork\b/i.test(msg)
  ) {
    return { kind: ERROR_KIND.NETWORK, httpStatus: 0, isRetryable: true, gaErrorType: 'network_error' };
  }

  return { kind: ERROR_KIND.UNKNOWN, httpStatus: 0, isRetryable: false, gaErrorType: 'network_error' };
}

function parseRetryAfterMs(resp, nowMs) {
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

function inspectHttpBackoffStatus(resp, nowMs) {
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

async function parseJsonResponse(resp) {
  if (typeof resp?.text === 'function') {
    const rawText = await resp.text();
    try {
      const data = JSON.parse(rawText);
      if (data && typeof data === 'object') {
        return { ok: true, data };
      }
      return { ok: false, rawText };
    } catch {
      return { ok: false, rawText };
    }
  }
  if (typeof resp?.json === 'function') {
    try {
      const data = await resp.json();
      if (data && typeof data === 'object') {
        return { ok: true, data };
      }
      return { ok: false, rawText: String(data ?? '') };
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { ok: false, rawText: '' };
      }
      throw err;
    }
  }
  return { ok: false, rawText: '' };
}

function classifyRedeemStatus(retcode) {
  if (isNotLoggedIn(retcode)) return API_STATUS.NOT_LOGGED_IN;
  switch (retcode) {
    case 0:
      return API_STATUS.OK;
    case -2017:
      return API_STATUS.ALREADY_CLAIMED;
    case -2001:
      return API_STATUS.EXPIRED;
    case -2018:
      return API_STATUS.SAME_TYPE_USED;
    case -2016:
      return API_STATUS.COOLDOWN;
    default:
      return API_STATUS.API_ERROR;
  }
}

function resolveGameConfig(gameOrKey) {
  return typeof gameOrKey === 'string' ? GAMES[gameOrKey] : gameOrKey;
}

/**
 * 外部通信・入力検証・プロトコル防御を単一シーム背後へ集約した ApiGateway を生成する。
 */
export function createApiGateway({
  fetchFn = (url, opts) => globalThis.fetch(url, opts),
  clock = { now: () => Date.now() },
  config = API_CONFIG
} = {}) {
  const textEncoder = new TextEncoder();

  function assertAllowedUrl(url, allowedHosts, label) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (err) {
      throw new GatewayError(
        ERROR_KIND.SECURITY_ERROR,
        `SECURITY_ERROR: Invalid URL for ${label}.`,
        { code: 'INVALID_URL', cause: err }
      );
    }
    if (parsedUrl.protocol !== 'https:' || !allowedHosts.has(parsedUrl.hostname)) {
      throw new GatewayError(
        ERROR_KIND.SECURITY_ERROR,
        `SECURITY_ERROR: Host ${parsedUrl.hostname} is not allowed for ${label}.`,
        { code: 'DISALLOWED_HOST' }
      );
    }
    return parsedUrl;
  }

  async function hoyoFetch(url, options = {}) {
    assertAllowedUrl(url, ALLOWED_HOYO_HOSTS, 'hoyoFetch');
    const signal = AbortSignal.timeout(config.HOYO_API_TIMEOUT_MS);
    return fetchFn(url, {
      ...options,
      credentials: 'include',
      signal
    });
  }

  async function publicFetch(url, options = {}) {
    assertAllowedUrl(url, ALLOWED_PUBLIC_HOSTS, 'publicFetch');
    const signal = AbortSignal.timeout(config.CODE_API_TIMEOUT_MS);
    return fetchFn(url, {
      ...options,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    });
  }

  async function requestHoyoJson({ hosts, buildRequest, onJsonResponse, logTag }) {
    let lastFailure = null;

    for (const host of hosts) {
      const { url, fetchOptions } = buildRequest(host);
      const resp = await hoyoFetch(url, fetchOptions);
      const backoffInfo = inspectHttpBackoffStatus(resp, clock.now());
      if (backoffInfo) {
        return {
          done: true,
          result: {
            success: false,
            status: backoffInfo.isRateLimited ? API_STATUS.RATE_LIMITED : API_STATUS.SERVER_ERROR,
            retcode: -backoffInfo.httpStatus,
            ...backoffInfo,
            apiMessage: `HTTP ${backoffInfo.httpStatus}`
          }
        };
      }

      const parsed = await parseJsonResponse(resp);
      if (!parsed.ok) {
        console.error(`[${logTag}] Non-JSON response (HTTP ${resp?.status ?? 'unknown'}, ${host}):`, parsed.rawText.slice(0, 200));
        lastFailure = {
          success: false,
          status: API_STATUS.NON_JSON,
          retcode: -9999,
          httpStatus: resp?.status ?? null,
          rawSnippet: parsed.rawText.slice(0, 50),
          apiMessage: ''
        };
        continue;
      }

      const step = onJsonResponse(parsed.data, host);
      if (step.done) {
        return { done: true, result: step.result };
      }

      lastFailure = step.failure;
      if (!step.shouldContinue) {
        break;
      }
    }

    return { done: false, lastFailure };
  }

  async function fetchValidCodes(gameKey = 'GENSHIN') {
    const param = GAMES[gameKey]?.hoyoCodesParam || gameKey.toLowerCase();
    const url = `${PUBLIC_CODE_API_ORIGIN}/codes?game=${encodeURIComponent(param)}`;
    const response = await publicFetch(url);

    if (!response.ok) {
      throw new GatewayError(
        ERROR_KIND.HTTP_ERROR,
        `HTTP_ERROR_${response.status}`,
        { httpStatus: response.status, code: 'HTTP_ERROR' }
      );
    }

    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      throw new GatewayError(
        ERROR_KIND.SECURITY_ERROR,
        'SECURITY_ERROR: Content-Type must be application/json',
        { code: 'INVALID_CONTENT_TYPE' }
      );
    }

    const text = await response.text();
    if (textEncoder.encode(text).length > config.MAX_EXTERNAL_PAYLOAD_BYTES) {
      throw new GatewayError(
        ERROR_KIND.SECURITY_ERROR,
        'SECURITY_ERROR: Payload exceeds 256KB size limit.',
        { code: 'PAYLOAD_TOO_LARGE' }
      );
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new GatewayError(
        ERROR_KIND.PARSE_ERROR,
        'Invalid JSON payload from code API',
        { code: 'INVALID_JSON', cause: err }
      );
    }

    if (!data || typeof data !== 'object') {
      throw new GatewayError(
        ERROR_KIND.PARSE_ERROR,
        'Invalid JSON payload structure from code API',
        { code: 'INVALID_JSON' }
      );
    }

    const rawList = Array.isArray(data) ? data : (Array.isArray(data.codes) ? data.codes : []);
    if (rawList.length > config.MAX_NEW_CODES_PER_FETCH) {
      throw new GatewayError(
        ERROR_KIND.SECURITY_ERROR,
        'SECURITY_ERROR: Fetched code count exceeds sanity threshold.',
        { code: 'TOO_MANY_CODES' }
      );
    }

    const validCodes = [];
    for (const item of rawList) {
      const code = typeof item === 'string' ? item : item?.code;
      const status = typeof item === 'object' && item?.status ? String(item.status).toLowerCase() : 'active';
      if ((status === 'ok' || status === 'active' || status === 'valid') && isValidCode(code)) {
        validCodes.push(code.trim());
      }
    }

    return [...new Set(validCodes)];
  }

  async function getUserGameRoles(gameBiz = 'hk4e_global') {
    let hoyoverseNotLoggedIn = false;

    const outcome = await requestHoyoJson({
      hosts: TAKUMI_HOSTS,
      logTag: 'getUserGameRoles',
      buildRequest: (host) => ({
        url: `${host}/binding/api/getUserGameRolesByCookie?game_biz=${gameBiz}`,
        fetchOptions: {}
      }),
      onJsonResponse: (data, host) => {
        console.log(`[getUserGameRoles] ${gameBiz} (${host}) Response:`, data);

        if (data.retcode === 0) {
          const rawList = data.data?.list || [];
          if (!rawList.length) {
            console.warn(`[getUserGameRoles] No roles in data.list for ${gameBiz}:`, data.data);
            return {
              done: true,
              result: {
                success: false,
                status: API_STATUS.NO_CHARACTER,
                retcode: -1,
                apiMessage: data.message || '',
                role: null,
                hoyoverseNotLoggedIn
              }
            };
          }

          const validRoles = rawList.filter(r => isValidUid(r.game_uid) && isValidRegion(r.region));
          if (!validRoles.length) {
            console.warn(`[getUserGameRoles] Roles filtered out by constraints:`, rawList);
            return {
              done: true,
              result: {
                success: false,
                status: API_STATUS.INVALID_ROLE,
                retcode: -2,
                invalidRegions: rawList.map(r => r.region),
                apiMessage: data.message || '',
                role: null,
                hoyoverseNotLoggedIn
              }
            };
          }

          const selectedRole = validRoles.find(r => r.is_chosen === true) ||
            validRoles.reduce((max, curr) => (curr.level > max.level ? curr : max), validRoles[0]);

          return {
            done: true,
            result: {
              success: true,
              status: API_STATUS.OK,
              retcode: 0,
              role: selectedRole,
              allRoles: validRoles,
              hoyoverseNotLoggedIn
            }
          };
        }

        const notLoggedIn = isNotLoggedIn(data.retcode);
        if (notLoggedIn && host.includes('.hoyoverse.com')) {
          hoyoverseNotLoggedIn = true;
        }

        return {
          done: false,
          shouldContinue: notLoggedIn,
          failure: {
            success: false,
            status: notLoggedIn ? API_STATUS.NOT_LOGGED_IN : API_STATUS.API_ERROR,
            retcode: data.retcode,
            apiMessage: data.message || ''
          }
        };
      }
    });

    if (outcome.done) {
      return {
        ...outcome.result,
        role: outcome.result.role ?? null,
        hoyoverseNotLoggedIn
      };
    }

    const lastFailure = outcome.lastFailure;
    return {
      success: false,
      status: lastFailure?.status ?? API_STATUS.NOT_LOGGED_IN,
      retcode: lastFailure?.retcode ?? -100,
      ...(lastFailure?.httpStatus != null ? { httpStatus: lastFailure.httpStatus } : {}),
      ...(lastFailure?.rawSnippet != null ? { rawSnippet: lastFailure.rawSnippet } : {}),
      apiMessage: lastFailure?.apiMessage || '',
      role: null,
      hoyoverseNotLoggedIn
    };
  }

  async function redeemCode({ exchangeHost, exchangePath, gameBiz, uid, region, cdkey, lang = 'ja' }) {
    if (!isValidUid(uid) || !isValidRegion(region) || !isValidCode(cdkey)) {
      return {
        success: false,
        status: API_STATUS.INVALID_CONFIG,
        retcode: -999,
        apiMessage: '',
        cdkey
      };
    }

    const outcome = await requestHoyoJson({
      hosts: [exchangeHost],
      logTag: 'redeemCode',
      buildRequest: (host) => {
        const url = new URL(exchangePath, host);
        url.searchParams.set('uid', uid);
        url.searchParams.set('region', region);
        url.searchParams.set('lang', getExchangeApiLang(lang));
        url.searchParams.set('cdkey', cdkey);
        url.searchParams.set('game_biz', gameBiz);
        return { url: url.toString(), fetchOptions: {} };
      },
      onJsonResponse: (resJson) => {
        const status = classifyRedeemStatus(resJson.retcode);
        return {
          done: true,
          result: {
            success: status === API_STATUS.OK,
            status,
            retcode: resJson.retcode,
            apiMessage: resJson.message || '',
            cdkey
          }
        };
      }
    });

    if (outcome.done) {
      return { ...outcome.result, cdkey };
    }

    return {
      ...outcome.lastFailure,
      cdkey
    };
  }

  async function callSignApiWithFallback(gameOrKey, buildRequest, parseSuccess, defaultFallback) {
    const gameConfig = resolveGameConfig(gameOrKey);
    if (!gameConfig || !gameConfig.actId) {
      return {
        ...defaultFallback,
        success: false,
        status: API_STATUS.INVALID_CONFIG,
        retcode: -999,
        apiMessage: ''
      };
    }

    const hosts = gameConfig.signHosts || [];
    const outcome = await requestHoyoJson({
      hosts,
      logTag: 'callSignApiWithFallback',
      buildRequest: (host) => buildRequest(gameConfig, host),
      onJsonResponse: (resJson) => {
        const handled = parseSuccess(resJson);
        if (handled) {
          return { done: true, result: handled };
        }
        const notLoggedIn = isNotLoggedIn(resJson.retcode);
        return {
          done: false,
          shouldContinue: notLoggedIn,
          failure: {
            ...defaultFallback,
            success: false,
            status: notLoggedIn ? API_STATUS.NOT_LOGGED_IN : API_STATUS.API_ERROR,
            retcode: resJson.retcode,
            apiMessage: resJson.message || ''
          }
        };
      }
    });

    if (outcome.done) {
      return { ...defaultFallback, ...outcome.result };
    }

    return outcome.lastFailure || {
      ...defaultFallback,
      success: false,
      status: API_STATUS.NOT_LOGGED_IN,
      retcode: -100,
      apiMessage: ''
    };
  }

  async function getDailySignInfo(gameOrKey, lang = 'ja') {
    return callSignApiWithFallback(
      gameOrKey,
      (gameConfig, host) => {
        const url = new URL(gameConfig.infoPath, host);
        url.searchParams.set('act_id', gameConfig.actId);
        url.searchParams.set('lang', getSignApiLang(lang));
        const headers = {};
        if (gameConfig.signGameHeader) {
          headers['x-rpc-signgame'] = gameConfig.signGameHeader;
        }
        return { url: url.toString(), fetchOptions: { method: 'GET', headers } };
      },
      (resJson) => {
        if (resJson.retcode === 0 && resJson.data) {
          return {
            success: true,
            status: API_STATUS.OK,
            retcode: 0,
            isSigned: !!resJson.data.is_sign,
            totalSignDay: Number(resJson.data.total_sign_day || 0),
            today: resJson.data.today || null,
            apiMessage: resJson.message || 'OK'
          };
        }
        return null;
      },
      {}
    );
  }

  async function claimDailyBonus(gameOrKey, lang = 'ja') {
    return callSignApiWithFallback(
      gameOrKey,
      (gameConfig, host) => {
        const url = new URL(gameConfig.signPath, host);
        url.searchParams.set('lang', getSignApiLang(lang));
        const headers = { 'Content-Type': 'application/json;charset=UTF-8' };
        if (gameConfig.signGameHeader) {
          headers['x-rpc-signgame'] = gameConfig.signGameHeader;
        }
        return {
          url: url.toString(),
          fetchOptions: {
            method: 'POST',
            headers,
            body: JSON.stringify({ act_id: gameConfig.actId })
          }
        };
      },
      (resJson) => {
        if (isCaptchaRisk(resJson)) {
          return {
            success: false,
            status: API_STATUS.CAPTCHA_REQUIRED,
            retcode: resJson.retcode || 1034,
            isRisk: true,
            apiMessage: resJson.message || ''
          };
        }
        if (resJson.retcode === 0) {
          return {
            success: true,
            status: API_STATUS.OK,
            retcode: 0,
            alreadySigned: false,
            apiMessage: resJson.message || 'OK'
          };
        }
        if (resJson.retcode === -5003) {
          return {
            success: true,
            status: API_STATUS.ALREADY_SIGNED,
            retcode: -5003,
            alreadySigned: true,
            apiMessage: resJson.message || ''
          };
        }
        return null;
      },
      { isRisk: false }
    );
  }

  return {
    fetchValidCodes,
    getUserGameRoles,
    redeemCode,
    getDailySignInfo,
    claimDailyBonus
  };
}

export const defaultApiGateway = createApiGateway();

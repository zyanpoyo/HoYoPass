import { hoyoFetch, inspectHttpBackoffStatus } from './http-client.js';
import { isValidUid, isValidRegion } from './security.js';
import { GAMES } from '../config/constants.js';
import { getExchangeApiLang, getSignApiLang, t } from '../utils/i18n.js';

const TAKUMI_HOSTS = [
  'https://api-os-takumi.hoyoverse.com',
  'https://api-os-takumi.hoyolab.com'
];

export function isNotLoggedIn(retcode) {
  return retcode === -100 || retcode === -1071;
}

function formatNonJsonMessage(resp, rawText, lang) {
  return t('apiNonJsonResponse', [resp?.status ?? 'unknown', rawText.slice(0, 50)], lang);
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

export async function getUserGameRoles(gameBiz = 'hk4e_global', lang = 'ja') {
  let lastData = null;

  for (const host of TAKUMI_HOSTS) {
    const url = `${host}/binding/api/getUserGameRolesByCookie?game_biz=${gameBiz}`;
    const resp = await hoyoFetch(url);
    const backoffInfo = inspectHttpBackoffStatus(resp);
    if (backoffInfo) {
      return {
        success: false,
        retcode: -backoffInfo.httpStatus,
        ...backoffInfo,
        message: `HTTP ${backoffInfo.httpStatus}`,
        role: null
      };
    }
    const parsed = await parseJsonResponse(resp);
    if (!parsed.ok) {
      console.error(`[getUserGameRoles] Non-JSON response (HTTP ${resp?.status ?? 'unknown'}, ${host}):`, parsed.rawText.slice(0, 200));
      lastData = {
        retcode: -9999,
        message: formatNonJsonMessage(resp, parsed.rawText, lang)
      };
      continue;
    }
    const data = parsed.data;
    console.log(`[getUserGameRoles] ${gameBiz} (${host}) Response:`, data);
    lastData = data;

    if (data.retcode === 0) {
      const rawList = data.data?.list || [];
      if (!rawList.length) {
        console.warn(`[getUserGameRoles] No roles in data.list for ${gameBiz}:`, data.data);
        return { success: false, retcode: -1, message: t('apiNoChar', [], lang), role: null };
      }

      const validRoles = rawList.filter(r => isValidUid(r.game_uid) && isValidRegion(r.region));
      if (!validRoles.length) {
        console.warn(`[getUserGameRoles] Roles filtered out by constraints:`, rawList);
        const regions = rawList.map(r => r.region).join(',');
        return { success: false, retcode: -2, message: t('apiInvalidUidRegion', [regions], lang), role: null };
      }

      const selectedRole = validRoles.find(r => r.is_chosen === true) ||
        validRoles.reduce((max, curr) => (curr.level > max.level ? curr : max), validRoles[0]);

      return { success: true, retcode: 0, role: selectedRole, allRoles: validRoles };
    }

    if (!isNotLoggedIn(data.retcode)) {
      break;
    }
  }

  return {
    success: false,
    retcode: lastData?.retcode ?? -100,
    message: lastData?.message || `API error (${lastData?.retcode})`,
    role: null
  };
}

export async function redeemCode({ exchangeHost, exchangePath, gameBiz, uid, region, cdkey, lang = 'ja' }) {
  const url = new URL(exchangePath, exchangeHost);
  url.searchParams.set('uid', uid);
  url.searchParams.set('region', region);
  url.searchParams.set('lang', getExchangeApiLang(lang));
  url.searchParams.set('cdkey', cdkey);
  url.searchParams.set('game_biz', gameBiz);

  const resp = await hoyoFetch(url.toString());
  const backoffInfo = inspectHttpBackoffStatus(resp);
  if (backoffInfo) {
    return {
      retcode: -backoffInfo.httpStatus,
      ...backoffInfo,
      message: `HTTP ${backoffInfo.httpStatus}`,
      cdkey
    };
  }
  const parsed = await parseJsonResponse(resp);
  if (!parsed.ok) {
    console.error(`[redeemCode] Non-JSON response (HTTP ${resp?.status ?? 'unknown'}):`, parsed.rawText.slice(0, 200));
    return {
      retcode: -9999,
      message: formatNonJsonMessage(resp, parsed.rawText, lang),
      cdkey
    };
  }
  const resJson = parsed.data;
  return {
    retcode: resJson.retcode,
    message: resJson.message || 'No message',
    cdkey
  };
}

export function isCaptchaRisk(resJson) {
  if (!resJson) return false;
  if (resJson.retcode === 1034) return true;
  const d = resJson.data;
  if (!d) return false;
  return d.is_risk === true ||
    d.gt_result?.is_risk === true ||
    Number(d.risk_code || 0) !== 0;
}

async function callSignApiWithFallback(gameOrKey, lang, buildRequest, parseSuccess, defaultFallback) {
  const gameConfig = typeof gameOrKey === 'string' ? GAMES[gameOrKey] : gameOrKey;
  if (!gameConfig || !gameConfig.actId) {
    return { success: false, retcode: -999, message: t('apiInvalidGameConfig', [], lang) };
  }

  const hosts = gameConfig.signHosts || [];
  let lastRes = null;

  for (const host of hosts) {
    const { url, fetchOptions } = buildRequest(gameConfig, host, lang);
    const resp = await hoyoFetch(url, fetchOptions);
    const backoffInfo = inspectHttpBackoffStatus(resp);
    if (backoffInfo) {
      return {
        ...defaultFallback,
        success: false,
        retcode: -backoffInfo.httpStatus,
        ...backoffInfo,
        message: `HTTP ${backoffInfo.httpStatus}`
      };
    }
    const parsed = await parseJsonResponse(resp);
    if (!parsed.ok) {
      console.error(`[callSignApiWithFallback] Non-JSON response (HTTP ${resp?.status ?? 'unknown'}, ${host}):`, parsed.rawText.slice(0, 200));
      lastRes = {
        ...defaultFallback,
        success: false,
        retcode: -9999,
        message: formatNonJsonMessage(resp, parsed.rawText, lang)
      };
      continue;
    }
    const resJson = parsed.data;

    const handled = parseSuccess(resJson, lang);
    if (handled) {
      return handled;
    }

    lastRes = {
      ...defaultFallback,
      success: false,
      retcode: resJson.retcode,
      message: resJson.message || `API error (${resJson.retcode})`
    };

    if (!isNotLoggedIn(resJson.retcode)) {
      break;
    }
  }

  return lastRes || {
    ...defaultFallback,
    success: false,
    retcode: -100,
    message: t('apiPleaseLogin', [], lang)
  };
}

export async function getDailySignInfo(gameOrKey, lang = 'ja') {
  return callSignApiWithFallback(
    gameOrKey,
    lang,
    (gameConfig, host, currentLang) => {
      const url = new URL(gameConfig.infoPath, host);
      url.searchParams.set('act_id', gameConfig.actId);
      url.searchParams.set('lang', getSignApiLang(currentLang));
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
          retcode: 0,
          isSigned: !!resJson.data.is_sign,
          totalSignDay: Number(resJson.data.total_sign_day || 0),
          today: resJson.data.today || null,
          message: resJson.message || 'OK'
        };
      }
      return null;
    },
    {}
  );
}

export async function claimDailyBonus(gameOrKey, lang = 'ja') {
  return callSignApiWithFallback(
    gameOrKey,
    lang,
    (gameConfig, host, currentLang) => {
      const url = new URL(gameConfig.signPath, host);
      url.searchParams.set('lang', getSignApiLang(currentLang));
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
    (resJson, currentLang) => {
      if (isCaptchaRisk(resJson)) {
        return {
          success: false,
          retcode: resJson.retcode || 1034,
          isRisk: true,
          message: t('apiCaptchaRequired', [], currentLang)
        };
      }
      if (resJson.retcode === 0) {
        return {
          success: true,
          retcode: 0,
          alreadySigned: false,
          message: resJson.message || 'OK'
        };
      }
      if (resJson.retcode === -5003) {
        return {
          success: true,
          retcode: -5003,
          alreadySigned: true,
          message: resJson.message || t('apiAlreadySignedToday', [], currentLang)
        };
      }
      return null;
    },
    { isRisk: false }
  );
}

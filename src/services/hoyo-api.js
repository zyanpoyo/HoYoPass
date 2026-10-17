import { hoyoFetch } from './http-client.js';
import { isValidUid, isValidRegion } from './security.js';
import { GAMES } from '../config/constants.js';

const TAKUMI_HOSTS = [
  'https://api-os-takumi.hoyoverse.com',
  'https://api-os-takumi.hoyolab.com'
];

export async function getUserGameRoles(gameBiz = 'hk4e_global') {
  let lastData = null;

  for (const host of TAKUMI_HOSTS) {
    const url = `${host}/binding/api/getUserGameRolesByCookie?game_biz=${gameBiz}`;
    const resp = await hoyoFetch(url);
    const data = await resp.json();
    console.log(`[getUserGameRoles] ${gameBiz} (${host}) Response:`, data);
    lastData = data;

    if (data.retcode === 0) {
      const rawList = data.data?.list || [];
      if (!rawList.length) {
        console.warn(`[getUserGameRoles] No roles in data.list for ${gameBiz}:`, data.data);
        return { success: false, retcode: -1, message: 'アカウント内にキャラクターが見つかりません', role: null };
      }

      const validRoles = rawList.filter(r => isValidUid(r.game_uid) && isValidRegion(r.region));
      if (!validRoles.length) {
        console.warn(`[getUserGameRoles] Roles filtered out by constraints:`, rawList);
        return { success: false, retcode: -2, message: `有効なUIDまたはRegionに一致しません (${rawList.map(r => r.region).join(',')})`, role: null };
      }

      let selectedRole = validRoles.find(r => r.is_chosen === true);
      if (!selectedRole) {
        selectedRole = validRoles.reduce((max, curr) => (curr.level > max.level ? curr : max), validRoles[0]);
      }

      return { success: true, retcode: 0, role: selectedRole, allRoles: validRoles };
    }

    if (data.retcode !== -100 && data.retcode !== -1071) {
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

export async function redeemCode({ exchangeHost, exchangePath, gameBiz, uid, region, cdkey }) {
  const url = new URL(exchangePath, exchangeHost);
  url.searchParams.set('uid', uid);
  url.searchParams.set('region', region);
  url.searchParams.set('lang', 'ja');
  url.searchParams.set('cdkey', cdkey);
  url.searchParams.set('game_biz', gameBiz);

  const resp = await hoyoFetch(url.toString());
  const text = await resp.text();
  let resJson;
  try {
    resJson = JSON.parse(text);
  } catch (err) {
    console.error(`[redeemCode] Non-JSON response (HTTP ${resp.status}):`, text.slice(0, 200));
    return {
      retcode: -9999,
      message: `HTTP ${resp.status} - 非JSON応答 (${text.slice(0, 50)})`,
      cdkey
    };
  }

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
  if (d.is_risk === true) return true;
  if (d.gt_result && d.gt_result.is_risk === true) return true;
  if (Number(d.risk_code || 0) !== 0) return true;
  return false;
}

export async function getDailySignInfo(gameOrKey) {
  const gameConfig = typeof gameOrKey === 'string' ? GAMES[gameOrKey] : gameOrKey;
  if (!gameConfig || !gameConfig.actId) {
    return { success: false, retcode: -999, message: '不正なゲーム設定です' };
  }

  const hosts = gameConfig.signHosts || [];
  let lastRes = null;

  for (const host of hosts) {
    const url = new URL(gameConfig.infoPath, host);
    url.searchParams.set('act_id', gameConfig.actId);
    url.searchParams.set('lang', 'ja-jp');

    const headers = {};
    if (gameConfig.signGameHeader) {
      headers['x-rpc-signgame'] = gameConfig.signGameHeader;
    }

    const resp = await hoyoFetch(url.toString(), { method: 'GET', headers });
    const text = await resp.text();
    let resJson;
    try {
      resJson = JSON.parse(text);
    } catch {
      lastRes = {
        success: false,
        retcode: -9999,
        message: `HTTP ${resp.status} - 非JSON応答 (${text.slice(0, 50)})`
      };
      continue;
    }

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

    lastRes = {
      success: false,
      retcode: resJson.retcode,
      message: resJson.message || `API error (${resJson.retcode})`
    };

    if (resJson.retcode !== -100 && resJson.retcode !== -1071) {
      break;
    }
  }

  return lastRes || { success: false, retcode: -100, message: 'ログインしてください' };
}

export async function claimDailyBonus(gameOrKey) {
  const gameConfig = typeof gameOrKey === 'string' ? GAMES[gameOrKey] : gameOrKey;
  if (!gameConfig || !gameConfig.actId) {
    return { success: false, retcode: -999, message: '不正なゲーム設定です' };
  }

  const hosts = gameConfig.signHosts || [];
  let lastRes = null;

  for (const host of hosts) {
    const url = new URL(gameConfig.signPath, host);
    url.searchParams.set('lang', 'ja-jp');

    const headers = {
      'Content-Type': 'application/json;charset=UTF-8'
    };
    if (gameConfig.signGameHeader) {
      headers['x-rpc-signgame'] = gameConfig.signGameHeader;
    }

    const resp = await hoyoFetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ act_id: gameConfig.actId })
    });

    const text = await resp.text();
    let resJson;
    try {
      resJson = JSON.parse(text);
    } catch {
      lastRes = {
        success: false,
        retcode: -9999,
        message: `HTTP ${resp.status} - 非JSON応答 (${text.slice(0, 50)})`
      };
      continue;
    }

    if (isCaptchaRisk(resJson)) {
      return {
        success: false,
        retcode: resJson.retcode || 1034,
        isRisk: true,
        message: 'セキュリティ認証(CAPTCHA)が必要です。公式ページから手動で受け取ってください。'
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
        message: resJson.message || '本日はすでにサインイン済みです'
      };
    }

    lastRes = {
      success: false,
      retcode: resJson.retcode,
      isRisk: false,
      message: resJson.message || `API error (${resJson.retcode})`
    };

    if (resJson.retcode !== -100 && resJson.retcode !== -1071) {
      break;
    }
  }

  return lastRes || { success: false, retcode: -100, isRisk: false, message: 'ログインしてください' };
}


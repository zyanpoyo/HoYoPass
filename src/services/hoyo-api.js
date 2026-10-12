import { hoyoFetch } from './http-client.js';
import { isValidUid, isValidRegion } from './security.js';

export async function getUserGameRoles(gameBiz = 'hk4e_global') {
  const url = `https://api-os-takumi.hoyoverse.com/binding/api/getUserGameRolesByCookie?game_biz=${gameBiz}`;
  const resp = await hoyoFetch(url);
  const data = await resp.json();
  console.log(`[getUserGameRoles] ${gameBiz} Response:`, data);

  if (data.retcode !== 0) {
    return {
      success: false,
      retcode: data.retcode,
      message: data.message || `API error (${data.retcode})`,
      role: null
    };
  }

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

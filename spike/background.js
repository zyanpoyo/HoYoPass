export async function testConnection() {
  try {
    const resp = await fetch('https://api-os-takumi.hoyoverse.com/binding/api/getUserGameRolesByCookie?game_biz=hk4e_global', {
      method: 'GET',
      credentials: 'include'
    });
    const data = await resp.json();
    console.log('[Spike Result]', data);
    return data;
  } catch (err) {
    console.error('[Spike Error]', err);
    return { error: err.message };
  }
}

const SIGN_CONFIGS = {
  GENSHIN: {
    actId: 'e202102251931481',
    signGameHeader: 'hk4e',
    hosts: ['https://sg-hk4e-api.hoyolab.com', 'https://sg-hk4e-api.hoyoverse.com'],
    infoPath: '/event/sol/info',
    signPath: '/event/sol/sign'
  },
  STAR_RAIL: {
    actId: 'e202303301540311',
    signGameHeader: 'hkrpg',
    hosts: ['https://sg-public-api.hoyolab.com', 'https://sg-public-api.hoyoverse.com'],
    infoPath: '/event/luna/os/info',
    signPath: '/event/luna/os/sign'
  },
  ZZZ: {
    actId: 'e202406031448091',
    signGameHeader: 'zzz',
    hosts: ['https://sg-act-nap-api.hoyolab.com', 'https://sg-act-nap-api.hoyoverse.com'],
    infoPath: '/event/luna/zzz/os/info',
    signPath: '/event/luna/zzz/os/sign'
  }
};

export async function testDailySign(gameKey = 'GENSHIN') {
  const cfg = SIGN_CONFIGS[gameKey];
  if (!cfg) return { error: `Unknown gameKey: ${gameKey}` };

  const results = {};
  for (const host of cfg.hosts) {
    try {
      const infoUrl = `${host}${cfg.infoPath}?act_id=${cfg.actId}&lang=ja-jp`;
      const infoResp = await fetch(infoUrl, {
        method: 'GET',
        credentials: 'include',
        headers: { 'x-rpc-signgame': cfg.signGameHeader }
      });
      const infoData = await infoResp.json();

      const signUrl = `${host}${cfg.signPath}?lang=ja-jp`;
      const signResp = await fetch(signUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'x-rpc-signgame': cfg.signGameHeader
        },
        body: JSON.stringify({ act_id: cfg.actId })
      });
      const signData = await signResp.json();

      results[host] = { info: infoData, sign: signData };
    } catch (err) {
      results[host] = { error: err.message };
    }
  }
  console.log(`[Spike DailySign ${gameKey}]`, results);
  return results;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Spike installed. Run testConnection() or testDailySign("GENSHIN"|"STAR_RAIL"|"ZZZ") in console.');
});

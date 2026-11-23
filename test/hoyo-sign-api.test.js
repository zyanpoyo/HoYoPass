import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../src/config/constants.js';
import {
  isCaptchaRisk,
  getDailySignInfo,
  claimDailyBonus,
  getUserGameRoles,
  redeemCode
} from '../src/services/hoyo-api.js';

test('isCaptchaRisk: Geetest CAPTCHA / リスク制御の検知テスト', () => {
  assert.equal(isCaptchaRisk(null), false);
  assert.equal(isCaptchaRisk({ retcode: 0, data: null }), false);
  assert.equal(isCaptchaRisk({ retcode: 0, data: { is_risk: false, risk_code: 0 } }), false);

  // retcode: 1034
  assert.equal(isCaptchaRisk({ retcode: 1034, message: 'Risk detected' }), true);
  // data.is_risk === true
  assert.equal(isCaptchaRisk({ retcode: 0, data: { is_risk: true } }), true);
  // data.gt_result.is_risk === true
  assert.equal(isCaptchaRisk({ retcode: 0, data: { gt_result: { is_risk: true } } }), true);
  // data.risk_code !== 0
  assert.equal(isCaptchaRisk({ retcode: 0, data: { risk_code: 375 } }), true);
});

test('getDailySignInfo: プライマリホスト(hoyolab.com)で成功し x-rpc-signgame ヘッダーが送信されること', async () => {
  const originalFetch = globalThis.fetch;
  const calledRequests = [];

  globalThis.fetch = async (url, opts) => {
    calledRequests.push({ url: String(url), opts });
    return {
      status: 200,
      text: async () => JSON.stringify({
        retcode: 0,
        message: 'OK',
        data: { is_sign: true, total_sign_day: 18, today: '2026-10-17' }
      })
    };
  };

  try {
    const res = await getDailySignInfo('ZZZ');
    assert.equal(res.success, true);
    assert.equal(res.isSigned, true);
    assert.equal(res.totalSignDay, 18);
    assert.equal(res.today, '2026-10-17');
    assert.equal(calledRequests.length, 1, 'プライマリ成功時は1回のみ通信');
    assert.ok(calledRequests[0].url.startsWith('https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os/info'));
    assert.ok(calledRequests[0].url.includes('lang=ja-jp'), 'デフォルトはja-jp');
    assert.equal(calledRequests[0].opts.headers['x-rpc-signgame'], 'zzz');
    assert.equal(calledRequests[0].opts.credentials, 'include');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getDailySignInfo: lang=en 指定時に lang=en-us がクエリに含まれること', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = null;

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      status: 200,
      text: async () => JSON.stringify({
        retcode: 0,
        message: 'OK',
        data: { is_sign: true, total_sign_day: 1, today: '2026-10-25' }
      })
    };
  };

  try {
    const res = await getDailySignInfo('GENSHIN', 'en');
    assert.equal(res.success, true);
    assert.ok(requestedUrl.includes('lang=en-us'), 'lang=en指定時はen-usになること');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getDailySignInfo: プライマリが未ログイン(-100)の場合にセカンダリ(hoyoverse.com)へ自動フォールバックすること', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    calledUrls.push(urlStr);
    if (urlStr.includes('hoyolab.com')) {
      return {
        status: 200,
        text: async () => JSON.stringify({ retcode: -100, message: 'ログインしてください', data: null })
      };
    }
    return {
      status: 200,
      text: async () => JSON.stringify({
        retcode: 0,
        message: 'OK',
        data: { is_sign: false, total_sign_day: 5, today: '2026-10-17' }
      })
    };
  };

  try {
    const res = await getDailySignInfo(GAMES.GENSHIN);
    assert.equal(res.success, true);
    assert.equal(res.isSigned, false);
    assert.equal(res.totalSignDay, 5);
    assert.equal(calledUrls.length, 2, 'プライマリ失敗後にセカンダリへフォールバック');
    assert.ok(calledUrls[0].includes('sg-hk4e-api.hoyolab.com'));
    assert.ok(calledUrls[1].includes('sg-hk4e-api.hoyoverse.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('claimDailyBonus: POSTメソッド・x-rpc-signgameヘッダー・act_idボディで正常にサインインできること', async () => {
  const originalFetch = globalThis.fetch;
  let capturedReq = null;

  globalThis.fetch = async (url, opts) => {
    capturedReq = { url: String(url), opts };
    return {
      status: 200,
      text: async () => JSON.stringify({
        retcode: 0,
        message: 'OK',
        data: { code: 'ok', is_risk: false }
      })
    };
  };

  try {
    const res = await claimDailyBonus('STAR_RAIL');
    assert.equal(res.success, true);
    assert.equal(res.alreadySigned, false);
    assert.equal(capturedReq.opts.method, 'POST');
    assert.equal(capturedReq.opts.headers['x-rpc-signgame'], 'hkrpg');
    assert.deepEqual(JSON.parse(capturedReq.opts.body), { act_id: 'e202303301540311' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('claimDailyBonus: 本日受取済み(-5003)は alreadySigned: true の成功として扱われること', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({
      retcode: -5003,
      message: '本日はすでにサインインしました',
      data: null
    })
  });

  try {
    const res = await claimDailyBonus('GENSHIN');
    assert.equal(res.success, true);
    assert.equal(res.alreadySigned, true);
    assert.equal(res.retcode, -5003);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('claimDailyBonus: CAPTCHA要求時(retcode: 0, is_risk: true)は成功と誤認せず isRisk: true を返すこと', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({
      retcode: 0,
      message: 'OK',
      data: { gt_result: { is_risk: true, gt: 'xxx', challenge: 'yyy' } }
    })
  });

  try {
    const res = await claimDailyBonus('GENSHIN');
    assert.equal(res.success, false);
    assert.equal(res.isRisk, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getUserGameRoles: hoyoverse.comが未ログイン(-100)の場合にhoyolab.comへフォールバックすること', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

  globalThis.fetch = async (url) => {
    const u = String(url);
    calledUrls.push(u);
    if (u.includes('api-os-takumi.hoyoverse.com')) {
      return {
        status: 200,
        json: async () => ({ retcode: -100, message: 'Not logged in', data: null })
      };
    }
    return {
      status: 200,
      json: async () => ({
        retcode: 0,
        message: 'OK',
        data: {
          list: [
            { game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60, is_chosen: true }
          ]
        }
      })
    };
  };

  try {
    const res = await getUserGameRoles('hk4e_global');
    assert.equal(res.success, true);
    assert.equal(res.role.nickname, '蛍');
    assert.equal(calledUrls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP 429 / 503 検知時はフォールバックせず即座に shouldBackoff: true を返すこと', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. getUserGameRoles で HTTP 429 + Retry-After: 90
    const roleCalls = [];
    globalThis.fetch = async (url) => {
      roleCalls.push(String(url));
      return {
        status: 429,
        headers: new Headers({ 'Retry-After': '90' }),
        json: async () => ({})
      };
    };
    const roleRes = await getUserGameRoles('hk4e_global');
    assert.equal(roleRes.success, false);
    assert.equal(roleRes.shouldBackoff, true);
    assert.equal(roleRes.httpStatus, 429);
    assert.equal(roleRes.isRateLimited, true);
    assert.equal(roleRes.retryAfterMs, 90_000);
    assert.equal(roleCalls.length, 1, '429時は2ホスト目へフォールバックしないこと');

    // 2. getDailySignInfo で HTTP 503 (ヘッダなし)
    const infoCalls = [];
    globalThis.fetch = async (url) => {
      infoCalls.push(String(url));
      return { status: 503 };
    };
    const infoRes = await getDailySignInfo('GENSHIN');
    assert.equal(infoRes.success, false);
    assert.equal(infoRes.shouldBackoff, true);
    assert.equal(infoRes.httpStatus, 503);
    assert.equal(infoRes.isServerError, true);
    assert.equal(infoRes.retryAfterMs, null);
    assert.equal(infoCalls.length, 1, '503時も2ホスト目へフォールバックしないこと');

    // 3. claimDailyBonus で HTTP 429
    const signCalls = [];
    globalThis.fetch = async (url) => {
      signCalls.push(String(url));
      return { status: 429 };
    };
    const signRes = await claimDailyBonus('STAR_RAIL');
    assert.equal(signRes.success, false);
    assert.equal(signRes.shouldBackoff, true);
    assert.equal(signRes.httpStatus, 429);
    assert.equal(signCalls.length, 1);

    // 4. redeemCode で HTTP 502
    globalThis.fetch = async () => ({ status: 502 });
    const redeemRes = await redeemCode({
      exchangeHost: GAMES.GENSHIN.exchangeHost,
      exchangePath: GAMES.GENSHIN.exchangePath,
      gameBiz: GAMES.GENSHIN.gameBiz,
      uid: '800123456',
      region: 'os_asia',
      cdkey: 'TESTCODE'
    });
    assert.equal(redeemRes.shouldBackoff, true);
    assert.equal(redeemRes.httpStatus, 502);
    assert.equal(redeemRes.isServerError, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function createRealTimeoutError() {
  const signal = AbortSignal.timeout(1);
  if (!signal.aborted) {
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, { once: true });
    });
  }
  return signal.reason;
}

test('getUserGameRoles: 1ホスト目が非JSON応答(HTML等)の場合に2ホスト目へフォールバックして成功すること', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls = [];

  globalThis.fetch = async (url) => {
    const u = String(url);
    calledUrls.push(u);
    if (u.includes('api-os-takumi.hoyoverse.com')) {
      return {
        status: 200,
        text: async () => '<html><body>WAF Challenge</body></html>'
      };
    }
    return {
      status: 200,
      text: async () => JSON.stringify({
        retcode: 0,
        message: 'OK',
        data: {
          list: [
            { game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60, is_chosen: true }
          ]
        }
      })
    };
  };

  try {
    const res = await getUserGameRoles('hk4e_global');
    assert.equal(res.success, true);
    assert.equal(res.role.game_uid, '800123456');
    assert.equal(calledUrls.length, 2, '1ホスト目が非JSONなら2ホスト目へフォールバックすること');
    assert.ok(calledUrls[0].includes('api-os-takumi.hoyoverse.com'));
    assert.ok(calledUrls[1].includes('api-os-takumi.hoyolab.com'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getUserGameRoles: 両ホストとも非JSON応答や非オブジェクトJSONの場合は retcode -9999 を返し例外を投げないこと', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. 両ホストとも HTML 応答
    globalThis.fetch = async () => ({
      status: 403,
      text: async () => '<!DOCTYPE html><html>Forbidden</html>'
    });
    const htmlRes = await getUserGameRoles('hk4e_global');
    assert.equal(htmlRes.success, false);
    assert.equal(htmlRes.retcode, -9999);
    assert.equal(htmlRes.role, null);
    assert.match(htmlRes.message, /非JSON応答/);

    // 2. JSON.parse('null') 等の非オブジェクト JSON
    globalThis.fetch = async () => ({
      status: 200,
      text: async () => 'null'
    });
    const nullJsonRes = await getUserGameRoles('hk4e_global');
    assert.equal(nullJsonRes.success, false);
    assert.equal(nullJsonRes.retcode, -9999);
    assert.equal(nullJsonRes.role, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getUserGameRoles: レスポンス読み取り中に TimeoutError が発生した場合は握りつぶさず再スローすること', async () => {
  const originalFetch = globalThis.fetch;
  const timeoutErr = await createRealTimeoutError();

  try {
    // 1. resp.text() 中に TimeoutError
    globalThis.fetch = async () => ({
      status: 200,
      text: async () => { throw timeoutErr; }
    });
    await assert.rejects(
      () => getUserGameRoles('hk4e_global'),
      (err) => err === timeoutErr && err.name === 'TimeoutError'
    );

    // 2. resp.json() のみのモックで TimeoutError
    globalThis.fetch = async () => ({
      status: 200,
      json: async () => { throw timeoutErr; }
    });
    await assert.rejects(
      () => getUserGameRoles('hk4e_global'),
      (err) => err === timeoutErr && err.name === 'TimeoutError'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

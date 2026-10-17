import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../src/config/constants.js';
import {
  isCaptchaRisk,
  getDailySignInfo,
  claimDailyBonus,
  getUserGameRoles
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
    assert.equal(calledRequests[0].opts.headers['x-rpc-signgame'], 'zzz');
    assert.equal(calledRequests[0].opts.credentials, 'include');
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

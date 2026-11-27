import test from 'node:test';
import assert from 'node:assert/strict';
import { DOCS_URLS } from '../src/config/constants.js';
import { GAMES } from '../src/config/games.js';
import {
  API_STATUS,
  ERROR_KIND,
  GatewayError,
  createApiGateway,
  classifyGatewayError,
  isNotLoggedIn
} from '../src/services/api-gateway.js';
import {
  createFetchStubAdapter,
  jsonResponse,
  textResponse
} from './helpers/fetch-stub-adapter.js';

async function createRealTimeoutError() {
  const signal = AbortSignal.timeout(1);
  if (!signal.aborted) {
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, { once: true });
    });
  }
  return signal.reason;
}

test('GAMES / DOCS_URLS: 基本設定定数の確認', () => {
  assert.equal(GAMES.GENSHIN.hoyoCodesParam, 'genshin');
  assert.equal(GAMES.STAR_RAIL.hoyoCodesParam, 'hkrpg');
  assert.equal(GAMES.ZZZ.hoyoCodesParam, 'nap');
  assert.equal(DOCS_URLS.README, 'https://hoyopass.pages.dev/');
  assert.equal(DOCS_URLS.PRIVACY_POLICY, 'https://hoyopass.pages.dev/privacy');
});

test('fetchValidCodes: 正常取得・ステータス選別・コード検証・重複排除・プライバシーオプション', async () => {
  const stub = createFetchStubAdapter((url) => {
    if (url.includes('game=hkrpg')) {
      return jsonResponse({
        codes: [
          { code: 'HSRACTIVE1', status: 'OK' },
          { code: 'HSREXPIRED', status: 'expired' },
          'HSRSTRING2'
        ]
      });
    }
    return jsonResponse([
      { code: 'GENSHINGIFT', status: 'active' },
      { code: 'VALIDCODE1', status: 'valid' },
      { code: 'VALIDCODE1', status: 'ok' },
      { code: 'ABC', status: 'active' }, // 4文字未満は除外
      { code: 'A'.repeat(31), status: 'active' }, // 30文字超過は除外
      { code: 'BAD<script>', status: 'active' }, // 記号混入は除外
      { code: 'コード１２３', status: 'active' }, // 全角除外
      { code: 'INACTIVE99', status: 'inactive' }
    ]);
  });

  const gw = createApiGateway({ fetchFn: stub.fetchFn });

  const genshinCodes = await gw.fetchValidCodes('GENSHIN');
  assert.deepEqual(genshinCodes, ['GENSHINGIFT', 'VALIDCODE1']);
  assert.equal(stub.calls[0].url, 'https://hoyo-codes.seria.moe/codes?game=genshin');
  assert.equal(stub.calls[0].opts.credentials, 'omit');
  assert.equal(stub.calls[0].opts.referrerPolicy, 'no-referrer');
  assert.ok(stub.calls[0].opts.signal instanceof AbortSignal);

  const hsrCodes = await gw.fetchValidCodes('STAR_RAIL');
  assert.deepEqual(hsrCodes, ['HSRACTIVE1', 'HSRSTRING2']);
});

test('fetchValidCodes: HTTPエラー・Content-Type不正・256KB超過・50件超過・JSON破損を防御すること', async () => {
  // 1. HTTP 503
  {
    const stub = createFetchStubAdapter(() => jsonResponse({}, { status: 503 }));
    const gw = createApiGateway({ fetchFn: stub.fetchFn });
    await assert.rejects(
      () => gw.fetchValidCodes('GENSHIN'),
      (err) => err instanceof GatewayError &&
        err.kind === ERROR_KIND.HTTP_ERROR &&
        err.httpStatus === 503
    );
  }

  // 2. Content-Type 不正 (text/html)
  {
    const stub = createFetchStubAdapter(() => textResponse('<html>blocked</html>', { status: 200 }));
    const gw = createApiGateway({ fetchFn: stub.fetchFn });
    await assert.rejects(
      () => gw.fetchValidCodes('GENSHIN'),
      (err) => err instanceof GatewayError &&
        err.kind === ERROR_KIND.SECURITY_ERROR &&
        err.code === 'INVALID_CONTENT_TYPE'
    );
  }

  // 3. UTF-8 ペイロード 256KB 超過 (マルチバイト文字を含む厳密チェック)
  {
    const bigPayload = JSON.stringify({ data: 'あ'.repeat(90_000) }); // 270KB+
    const stub = createFetchStubAdapter(() => jsonResponse(bigPayload));
    const gw = createApiGateway({ fetchFn: stub.fetchFn });
    await assert.rejects(
      () => gw.fetchValidCodes('GENSHIN'),
      (err) => err instanceof GatewayError &&
        err.kind === ERROR_KIND.SECURITY_ERROR &&
        err.code === 'PAYLOAD_TOO_LARGE'
    );
  }

  // 4. 50件上限超過
  {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ code: `CODE${1000 + i}`, status: 'active' }));
    const stub = createFetchStubAdapter(() => jsonResponse(tooMany));
    const gw = createApiGateway({ fetchFn: stub.fetchFn });
    await assert.rejects(
      () => gw.fetchValidCodes('GENSHIN'),
      (err) => err instanceof GatewayError &&
        err.kind === ERROR_KIND.SECURITY_ERROR &&
        err.code === 'TOO_MANY_CODES'
    );
  }

  // 5. JSON 破損 & 非オブジェクト JSON
  {
    const stub = createFetchStubAdapter(() => textResponse('{broken', {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }));
    const gw = createApiGateway({ fetchFn: stub.fetchFn });
    await assert.rejects(
      () => gw.fetchValidCodes('GENSHIN'),
      (err) => err instanceof GatewayError && err.kind === ERROR_KIND.PARSE_ERROR
    );

    const nullStub = createFetchStubAdapter(() => jsonResponse('null'));
    const nullGw = createApiGateway({ fetchFn: nullStub.fetchFn });
    await assert.rejects(
      () => nullGw.fetchValidCodes('GENSHIN'),
      (err) => err instanceof GatewayError && err.kind === ERROR_KIND.PARSE_ERROR
    );
  }
});

test('許可ホスト自動導出と不正ホスト/プロトコル遮断 (GAMES 定義由来)', async () => {
  const stub = createFetchStubAdapter(() => jsonResponse({ retcode: 0, message: 'OK', cdkey: 'ABCD' }));
  const gw = createApiGateway({ fetchFn: stub.fetchFn });

  // 全ゲームの exchangeHost が自動許可されていること
  for (const game of Object.values(GAMES)) {
    const res = await gw.redeemCode({
      exchangeHost: game.exchangeHost,
      exchangePath: game.exchangePath,
      gameBiz: game.gameBiz,
      uid: '800123456',
      region: 'os_asia',
      cdkey: 'TESTCODE1'
    });
    assert.equal(res.status, API_STATUS.OK);
  }

  // 許可外ホスト・サブドメイン偽装・HTTPプロトコルは即遮断
  for (const badHost of [
    'https://evil.example.com',
    'https://sg-hk4e-api.hoyoverse.com.evil.com',
    'http://sg-hk4e-api.hoyoverse.com'
  ]) {
    await assert.rejects(
      () => gw.redeemCode({
        exchangeHost: badHost,
        exchangePath: '/common/apicdkey/api/webExchangeCdkey',
        gameBiz: 'hk4e_global',
        uid: '800123456',
        region: 'os_asia',
        cdkey: 'TESTCODE1'
      }),
      (err) => err instanceof GatewayError && err.kind === ERROR_KIND.SECURITY_ERROR
    );
  }
});

test('getDailySignInfo: プライマリ成功、lang=en-us、未ログイン時のセカンダリフォールバック', async () => {
  // 1. ZZZ プライマリ成功 + x-rpc-signgame ヘッダー確認
  const stub1 = createFetchStubAdapter(() => jsonResponse({
    retcode: 0,
    message: 'OK',
    data: { is_sign: true, total_sign_day: 18, today: '2026-10-17' }
  }));
  const gw1 = createApiGateway({ fetchFn: stub1.fetchFn });
  const res1 = await gw1.getDailySignInfo('ZZZ');
  assert.equal(res1.success, true);
  assert.equal(res1.status, API_STATUS.OK);
  assert.equal(res1.isSigned, true);
  assert.equal(res1.totalSignDay, 18);
  assert.equal(res1.today, '2026-10-17');
  assert.equal(stub1.calls.length, 1);
  assert.ok(stub1.calls[0].url.startsWith('https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os/info'));
  assert.ok(stub1.calls[0].url.includes('lang=ja-jp'));
  assert.equal(stub1.calls[0].opts.headers['x-rpc-signgame'], 'zzz');
  assert.equal(stub1.calls[0].opts.credentials, 'include');

  // 2. lang=en
  const stub2 = createFetchStubAdapter(() => jsonResponse({
    retcode: 0,
    message: 'OK',
    data: { is_sign: true, total_sign_day: 1, today: '2026-10-25' }
  }));
  const gw2 = createApiGateway({ fetchFn: stub2.fetchFn });
  const res2 = await gw2.getDailySignInfo('GENSHIN', 'en');
  assert.equal(res2.success, true);
  assert.ok(stub2.calls[0].url.includes('lang=en-us'));

  // 3. プライマリ -100 -> セカンダリへ自動フォールバック
  const stub3 = createFetchStubAdapter((url) => {
    if (url.includes('hoyolab.com')) {
      return jsonResponse({ retcode: -100, message: 'Not logged in', data: null });
    }
    return jsonResponse({
      retcode: 0,
      message: 'OK',
      data: { is_sign: false, total_sign_day: 5, today: '2026-10-17' }
    });
  });
  const gw3 = createApiGateway({ fetchFn: stub3.fetchFn });
  const res3 = await gw3.getDailySignInfo(GAMES.GENSHIN);
  assert.equal(res3.success, true);
  assert.equal(res3.isSigned, false);
  assert.equal(res3.totalSignDay, 5);
  assert.equal(stub3.calls.length, 2);
  assert.ok(stub3.calls[0].url.includes('sg-hk4e-api.hoyolab.com'));
  assert.ok(stub3.calls[1].url.includes('sg-hk4e-api.hoyoverse.com'));

  // 4. 不正ゲーム設定 -> INVALID_CONFIG (翻訳文言なし)
  const invalidRes = await gw3.getDailySignInfo('UNKNOWN_GAME');
  assert.equal(invalidRes.success, false);
  assert.equal(invalidRes.status, API_STATUS.INVALID_CONFIG);
  assert.equal(invalidRes.retcode, -999);
});

test('claimDailyBonus: 正常受取、-5003既受取、CAPTCHA全パターン検知', async () => {
  // 1. 正常 POST
  const stub1 = createFetchStubAdapter(() => jsonResponse({
    retcode: 0,
    message: 'OK',
    data: { code: 'ok', is_risk: false }
  }));
  const gw1 = createApiGateway({ fetchFn: stub1.fetchFn });
  const okRes = await gw1.claimDailyBonus('STAR_RAIL');
  assert.equal(okRes.success, true);
  assert.equal(okRes.status, API_STATUS.OK);
  assert.equal(okRes.alreadySigned, false);
  assert.equal(stub1.calls[0].opts.method, 'POST');
  assert.equal(stub1.calls[0].opts.headers['x-rpc-signgame'], 'hkrpg');
  assert.deepEqual(JSON.parse(stub1.calls[0].opts.body), { act_id: 'e202303301540311' });

  // 2. -5003 本日受取済み
  const stub2 = createFetchStubAdapter(() => jsonResponse({
    retcode: -5003,
    message: 'Already signed',
    data: null
  }));
  const gw2 = createApiGateway({ fetchFn: stub2.fetchFn });
  const alreadyRes = await gw2.claimDailyBonus('GENSHIN');
  assert.equal(alreadyRes.success, true);
  assert.equal(alreadyRes.status, API_STATUS.ALREADY_SIGNED);
  assert.equal(alreadyRes.alreadySigned, true);
  assert.equal(alreadyRes.retcode, -5003);

  // 3. CAPTCHA 要求 (retcode 1034 / is_risk / gt_result.is_risk / risk_code)
  for (const riskPayload of [
    { retcode: 1034, message: 'Risk detected' },
    { retcode: 0, data: { is_risk: true } },
    { retcode: 0, data: { gt_result: { is_risk: true, gt: 'x', challenge: 'y' } } },
    { retcode: 0, data: { risk_code: 375 } }
  ]) {
    const stubRisk = createFetchStubAdapter(() => jsonResponse(riskPayload));
    const gwRisk = createApiGateway({ fetchFn: stubRisk.fetchFn });
    const riskRes = await gwRisk.claimDailyBonus('GENSHIN');
    assert.equal(riskRes.success, false);
    assert.equal(riskRes.status, API_STATUS.CAPTCHA_REQUIRED);
    assert.equal(riskRes.isRisk, true);
  }
});

test('getUserGameRoles: デュアルホスト・hoyoverseNotLoggedIn・UID/Regionフィルタ・非JSON・TimeoutError再スロー', async () => {
  // 1. hoyoverse -100 -> hoyolab 成功
  {
    const stub = createFetchStubAdapter((url) => {
      if (url.includes('api-os-takumi.hoyoverse.com')) {
        return jsonResponse({ retcode: -100, message: 'Not logged in', data: null });
      }
      return jsonResponse({
        retcode: 0,
        message: 'OK',
        data: {
          list: [
            { game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60, is_chosen: true }
          ]
        }
      });
    });
    const gw = createApiGateway({ fetchFn: stub.fetchFn });
    const res = await gw.getUserGameRoles('hk4e_global');
    assert.equal(res.success, true);
    assert.equal(res.status, API_STATUS.OK);
    assert.equal(res.role.nickname, '蛍');
    assert.equal(res.hoyoverseNotLoggedIn, true);
    assert.equal(stub.calls.length, 2);
  }

  // 2. 直接成功 (false) & 両方 -1071 (true)
  {
    const directStub = createFetchStubAdapter(() => jsonResponse({
      retcode: 0,
      message: 'OK',
      data: {
        list: [
          { game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 45 },
          { game_biz: 'hk4e_global', region: 'os_usa', game_uid: '600123456', nickname: '空', level: 60 }
        ]
      }
    }));
    const directRes = await createApiGateway({ fetchFn: directStub.fetchFn }).getUserGameRoles('hk4e_global');
    assert.equal(directRes.success, true);
    assert.equal(directRes.role.game_uid, '600123456', 'is_chosenなし時は最大levelを選択');
    assert.equal(directRes.hoyoverseNotLoggedIn, false);

    const bothOutStub = createFetchStubAdapter(() => jsonResponse({ retcode: -1071, message: 'Login expired', data: null }));
    const bothOutRes = await createApiGateway({ fetchFn: bothOutStub.fetchFn }).getUserGameRoles('hk4e_global');
    assert.equal(bothOutRes.success, false);
    assert.equal(bothOutRes.status, API_STATUS.NOT_LOGGED_IN);
    assert.equal(bothOutRes.retcode, -1071);
    assert.equal(bothOutRes.hoyoverseNotLoggedIn, true);
  }

  // 3. キャラ不在 (-1) & UID/Region バリデーション除外 (-2)
  {
    const noCharStub = createFetchStubAdapter(() => jsonResponse({ retcode: 0, data: { list: [] } }));
    const noCharRes = await createApiGateway({ fetchFn: noCharStub.fetchFn }).getUserGameRoles('hk4e_global');
    assert.equal(noCharRes.success, false);
    assert.equal(noCharRes.status, API_STATUS.NO_CHARACTER);
    assert.equal(noCharRes.retcode, -1);

    const badRoleStub = createFetchStubAdapter(() => jsonResponse({
      retcode: 0,
      data: {
        list: [
          { game_uid: '12345', region: 'os_asia' }, // UID短すぎ
          { game_uid: '80012345a', region: 'os_asia' }, // 非数字
          { game_uid: '800123456', region: 'invalid_region' } // 不正リージョン
        ]
      }
    }));
    const badRoleRes = await createApiGateway({ fetchFn: badRoleStub.fetchFn }).getUserGameRoles('hk4e_global');
    assert.equal(badRoleRes.success, false);
    assert.equal(badRoleRes.status, API_STATUS.INVALID_ROLE);
    assert.equal(badRoleRes.retcode, -2);
    assert.deepEqual(badRoleRes.invalidRegions, ['os_asia', 'os_asia', 'invalid_region']);
  }

  // 4. 1ホスト目非JSON -> 2ホスト目フォールバック成功
  {
    const stub = createFetchStubAdapter((url) => {
      if (url.includes('api-os-takumi.hoyoverse.com')) {
        return textResponse('<html><body>WAF Challenge</body></html>');
      }
      return jsonResponse({
        retcode: 0,
        message: 'OK',
        data: { list: [{ game_biz: 'hk4e_global', region: 'os_asia', game_uid: '800123456', nickname: '蛍', level: 60 }] }
      });
    });
    const res = await createApiGateway({ fetchFn: stub.fetchFn }).getUserGameRoles('hk4e_global');
    assert.equal(res.success, true);
    assert.equal(res.hoyoverseNotLoggedIn, false);
    assert.equal(stub.calls.length, 2);
  }

  // 5. 両ホストとも非JSON / null JSON -> 構造化 NON_JSON (翻訳文言を含まない)
  {
    const htmlStub = createFetchStubAdapter(() => textResponse('<!DOCTYPE html><html>Forbidden</html>', { status: 403 }));
    const htmlRes = await createApiGateway({ fetchFn: htmlStub.fetchFn }).getUserGameRoles('hk4e_global');
    assert.equal(htmlRes.success, false);
    assert.equal(htmlRes.status, API_STATUS.NON_JSON);
    assert.equal(htmlRes.retcode, -9999);
    assert.equal(htmlRes.httpStatus, 403);
    assert.equal(htmlRes.rawSnippet, '<!DOCTYPE html><html>Forbidden</html>');
    assert.equal(htmlRes.message, undefined, '翻訳済みメッセージ文字列を返さないこと');

    const nullStub = createFetchStubAdapter(() => textResponse('null', { status: 200 }));
    const nullRes = await createApiGateway({ fetchFn: nullStub.fetchFn }).getUserGameRoles('hk4e_global');
    assert.equal(nullRes.status, API_STATUS.NON_JSON);
    assert.equal(nullRes.retcode, -9999);
  }

  // 6. 読み取り中の TimeoutError 再スロー
  {
    const timeoutErr = await createRealTimeoutError();
    const textThrowGw = createApiGateway({
      fetchFn: async () => ({ status: 200, text: async () => { throw timeoutErr; } })
    });
    await assert.rejects(() => textThrowGw.getUserGameRoles('hk4e_global'), (err) => err === timeoutErr);

    const jsonThrowGw = createApiGateway({
      fetchFn: async () => ({ status: 200, json: async () => { throw timeoutErr; } })
    });
    await assert.rejects(() => jsonThrowGw.getUserGameRoles('hk4e_global'), (err) => err === timeoutErr);
  }
});

test('HTTP 429 / 5xx 検知時はフォールバックせず即座に RATE_LIMITED / SERVER_ERROR を返すこと', async () => {
  const fixedClock = { now: () => Date.parse('2026-10-17T00:00:00Z') };

  // 1. getUserGameRoles 429 + Retry-After 秒数
  const roleStub = createFetchStubAdapter(() => jsonResponse({}, { status: 429, headers: { 'Retry-After': '90' } }));
  const roleRes = await createApiGateway({ fetchFn: roleStub.fetchFn, clock: fixedClock }).getUserGameRoles('hk4e_global');
  assert.equal(roleRes.success, false);
  assert.equal(roleRes.status, API_STATUS.RATE_LIMITED);
  assert.equal(roleRes.shouldBackoff, true);
  assert.equal(roleRes.httpStatus, 429);
  assert.equal(roleRes.isRateLimited, true);
  assert.equal(roleRes.retryAfterMs, 90_000);
  assert.equal(roleStub.calls.length, 1);

  // 2. getDailySignInfo 503 (ヘッダなし)
  const infoStub = createFetchStubAdapter(() => ({ status: 503 }));
  const infoRes = await createApiGateway({ fetchFn: infoStub.fetchFn, clock: fixedClock }).getDailySignInfo('GENSHIN');
  assert.equal(infoRes.status, API_STATUS.SERVER_ERROR);
  assert.equal(infoRes.shouldBackoff, true);
  assert.equal(infoRes.httpStatus, 503);
  assert.equal(infoRes.isServerError, true);
  assert.equal(infoRes.retryAfterMs, null);
  assert.equal(infoStub.calls.length, 1);

  // 3. claimDailyBonus 429 + Retry-After HTTP-date
  const retryDate = new Date(fixedClock.now() + 120_000).toUTCString();
  const signStub = createFetchStubAdapter(() => jsonResponse({}, { status: 429, headers: { 'Retry-After': retryDate } }));
  const signRes = await createApiGateway({ fetchFn: signStub.fetchFn, clock: fixedClock }).claimDailyBonus('STAR_RAIL');
  assert.equal(signRes.status, API_STATUS.RATE_LIMITED);
  assert.equal(signRes.retryAfterMs, 120_000);

  // 4. redeemCode 502
  const redeemStub = createFetchStubAdapter(() => ({ status: 502 }));
  const redeemRes = await createApiGateway({ fetchFn: redeemStub.fetchFn, clock: fixedClock }).redeemCode({
    exchangeHost: GAMES.GENSHIN.exchangeHost,
    exchangePath: GAMES.GENSHIN.exchangePath,
    gameBiz: GAMES.GENSHIN.gameBiz,
    uid: '800123456',
    region: 'os_asia',
    cdkey: 'TESTCODE'
  });
  assert.equal(redeemRes.status, API_STATUS.SERVER_ERROR);
  assert.equal(redeemRes.shouldBackoff, true);
  assert.equal(redeemRes.httpStatus, 502);
});

test('redeemCode: retcode マッピング・非JSON・不正入力ガード', async () => {
  const cases = [
    { retcode: 0, expectedStatus: API_STATUS.OK, expectedSuccess: true },
    { retcode: -2017, expectedStatus: API_STATUS.ALREADY_CLAIMED, expectedSuccess: false },
    { retcode: -2001, expectedStatus: API_STATUS.EXPIRED, expectedSuccess: false },
    { retcode: -2018, expectedStatus: API_STATUS.SAME_TYPE_USED, expectedSuccess: false },
    { retcode: -2016, expectedStatus: API_STATUS.COOLDOWN, expectedSuccess: false },
    { retcode: -100, expectedStatus: API_STATUS.NOT_LOGGED_IN, expectedSuccess: false },
    { retcode: -1071, expectedStatus: API_STATUS.NOT_LOGGED_IN, expectedSuccess: false },
    { retcode: -999, expectedStatus: API_STATUS.API_ERROR, expectedSuccess: false }
  ];

  for (const tc of cases) {
    const stub = createFetchStubAdapter(() => jsonResponse({ retcode: tc.retcode, message: 'msg' }));
    const res = await createApiGateway({ fetchFn: stub.fetchFn }).redeemCode({
      exchangeHost: GAMES.GENSHIN.exchangeHost,
      exchangePath: GAMES.GENSHIN.exchangePath,
      gameBiz: GAMES.GENSHIN.gameBiz,
      uid: '800123456',
      region: 'os_asia',
      cdkey: 'TESTCODE',
      lang: 'en'
    });
    assert.equal(res.status, tc.expectedStatus);
    assert.equal(res.success, tc.expectedSuccess);
    assert.equal(res.retcode, tc.retcode);
    assert.ok(stub.calls[0].url.includes('lang=en'));
  }

  // 非JSON
  const htmlStub = createFetchStubAdapter(() => textResponse('<html>Forbidden</html>', { status: 403 }));
  const nonJsonRes = await createApiGateway({ fetchFn: htmlStub.fetchFn }).redeemCode({
    exchangeHost: GAMES.GENSHIN.exchangeHost,
    exchangePath: GAMES.GENSHIN.exchangePath,
    gameBiz: GAMES.GENSHIN.gameBiz,
    uid: '800123456',
    region: 'os_asia',
    cdkey: 'TESTCODE'
  });
  assert.equal(nonJsonRes.status, API_STATUS.NON_JSON);
  assert.equal(nonJsonRes.retcode, -9999);
  assert.equal(nonJsonRes.httpStatus, 403);

  // 不正 UID/Region/Code は通信せず INVALID_CONFIG
  const unusedStub = createFetchStubAdapter(() => jsonResponse({ retcode: 0 }));
  const badInputRes = await createApiGateway({ fetchFn: unusedStub.fetchFn }).redeemCode({
    exchangeHost: GAMES.GENSHIN.exchangeHost,
    exchangePath: GAMES.GENSHIN.exchangePath,
    gameBiz: GAMES.GENSHIN.gameBiz,
    uid: 'bad',
    region: 'os_asia',
    cdkey: 'TESTCODE'
  });
  assert.equal(badInputRes.status, API_STATUS.INVALID_CONFIG);
  assert.equal(unusedStub.calls.length, 0);
});

test('classifyGatewayError & isNotLoggedIn: 構造化エラーと互換例外の境界分類', async () => {
  assert.equal(isNotLoggedIn(-100), true);
  assert.equal(isNotLoggedIn(-1071), true);
  assert.equal(isNotLoggedIn(0), false);
  assert.equal(isNotLoggedIn(-2016), false);

  const realTimeoutErr = await createRealTimeoutError();
  assert.deepEqual(classifyGatewayError(realTimeoutErr), {
    kind: ERROR_KIND.TIMEOUT,
    httpStatus: 0,
    isRetryable: true,
    gaErrorType: 'timeout'
  });
  assert.deepEqual(classifyGatewayError(new DOMException('aborted', 'AbortError')), {
    kind: ERROR_KIND.TIMEOUT,
    httpStatus: 0,
    isRetryable: true,
    gaErrorType: 'timeout'
  });
  assert.deepEqual(classifyGatewayError(new TypeError('Failed to fetch')), {
    kind: ERROR_KIND.NETWORK,
    httpStatus: 0,
    isRetryable: true,
    gaErrorType: 'network_error'
  });
  assert.deepEqual(
    classifyGatewayError(new GatewayError(ERROR_KIND.HTTP_ERROR, 'HTTP 503', { httpStatus: 503 })),
    { kind: ERROR_KIND.HTTP_ERROR, httpStatus: 503, isRetryable: false, gaErrorType: 'http_error' }
  );
  assert.deepEqual(
    classifyGatewayError(new GatewayError(ERROR_KIND.SECURITY_ERROR, 'Payload too large', { code: 'PAYLOAD_TOO_LARGE' })),
    { kind: ERROR_KIND.SECURITY_ERROR, httpStatus: 0, isRetryable: false, gaErrorType: 'parse_error' }
  );
  assert.deepEqual(classifyGatewayError(new SyntaxError('Unexpected token <')), {
    kind: ERROR_KIND.PARSE_ERROR,
    httpStatus: 0,
    isRetryable: false,
    gaErrorType: 'parse_error'
  });
  assert.deepEqual(classifyGatewayError(new TypeError("Cannot read properties of undefined (reading 'foo')")), {
    kind: ERROR_KIND.UNKNOWN,
    httpStatus: 0,
    isRetryable: false,
    gaErrorType: 'network_error'
  });
  assert.deepEqual(classifyGatewayError(new Error('STORAGE_WRITE_FAILURE: quota exceeded')), {
    kind: ERROR_KIND.STORAGE_ERROR,
    httpStatus: 0,
    isRetryable: false,
    gaErrorType: 'network_error'
  });
  assert.equal(classifyGatewayError(null).isRetryable, false);
});

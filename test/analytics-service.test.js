import test from 'node:test';
import assert from 'node:assert/strict';

const mockStorage = {
  local: new Map(),
  session: new Map()
};

let badgeState = { text: '', color: '' };

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { res[k] = mockStorage.local.get(k); });
        } else if (typeof keys === 'string') {
          res[keys] = mockStorage.local.get(keys);
        } else {
          mockStorage.local.forEach((v, k) => { res[k] = v; });
        }
        return res;
      },
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.local.set(k, v))
    },
    session: {
      get: async (keys) => {
        const res = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { res[k] = mockStorage.session.get(k); });
        } else if (typeof keys === 'string') {
          res[keys] = mockStorage.session.get(keys);
        } else {
          mockStorage.session.forEach((v, k) => { res[k] = v; });
        }
        return res;
      },
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.session.set(k, v)),
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => mockStorage.session.delete(k));
      }
    }
  },
  action: {
    setBadgeText: async (opts) => { badgeState.text = opts?.text ?? ''; },
    setBadgeBackgroundColor: async (opts) => { badgeState.color = opts?.color ?? ''; }
  },
  runtime: {
    getManifest: () => ({ version: '1.3.0' })
  }
};

import {
  toGaGameKey,
  toRedeemTrigger,
  toCheckinTrigger,
  sanitizeEventParams,
  getOrCreateSessionId,
  syncConsentBadge,
  sendGAEvent
} from '../src/services/analytics-service.js';
import { getOrCreateGaClientId } from '../src/services/storage-service.js';
import { API_CONFIG } from '../src/config/constants.js';

test('toGaGameKey: ゲームキーの正確なマッピング', () => {
  assert.equal(toGaGameKey('GENSHIN'), 'genshin');
  assert.equal(toGaGameKey('STAR_RAIL'), 'hsr');
  assert.equal(toGaGameKey('ZZZ'), 'zzz');
  assert.equal(toGaGameKey('UNKNOWN'), 'none');
  assert.equal(toGaGameKey(null), 'none');
});

test('toRedeemTrigger & toCheckinTrigger: トリガー契機のマッピング', () => {
  assert.equal(toRedeemTrigger('MANUAL'), 'manual');
  assert.equal(toRedeemTrigger('INITIAL_RUN'), 'initial');
  assert.equal(toRedeemTrigger('ALARM'), 'auto');
  assert.equal(toRedeemTrigger('STARTUP'), 'auto');

  assert.equal(toCheckinTrigger('MANUAL'), 'manual');
  assert.equal(toCheckinTrigger('DAILY_ALARM'), 'auto');
  assert.equal(toCheckinTrigger('INITIAL_RUN'), 'auto');
});

test('sanitizeEventParams: 許可リストによる未知キー・危険キーの完全遮断', () => {
  // 不明なイベント
  assert.equal(sanitizeEventParams('unknown_event', { foo: 'bar' }), null);

  // code_redeem_result: uidやcdkeyやcookieなどの危険なキーが除去されること
  const rawParams = {
    game: 'genshin',
    trigger: 'auto',
    status: 'success',
    uid: '800123456',
    cdkey: 'SECRETCODE123',
    cookie: 'ltoken=abc; ltuid=123'
  };
  const sanitized = sanitizeEventParams('code_redeem_result', rawParams);
  assert.deepEqual(sanitized, {
    game: 'genshin',
    trigger: 'auto',
    status: 'success'
  });
  assert.equal(sanitized.uid, undefined);
  assert.equal(sanitized.cdkey, undefined);
  assert.equal(sanitized.cookie, undefined);

  // onboarding_complete: boolean値が文字列 'true'/'false' に正規化されること
  const obClean = sanitizeEventParams('onboarding_complete', {
    genshin_enabled: true,
    hsr_enabled: false,
    zzz_enabled: true,
    extra: 'test'
  });
  assert.deepEqual(obClean, {
    genshin_enabled: 'true',
    hsr_enabled: 'false',
    zzz_enabled: 'true'
  });
});

test('getOrCreateGaClientId: UUIDの生成とストレージ永続化', async () => {
  mockStorage.local.clear();
  const id1 = await getOrCreateGaClientId();
  assert.ok(id1);
  assert.match(id1, /^[0-9a-f-]{36}$/i);

  const id2 = await getOrCreateGaClientId();
  assert.equal(id1, id2, '同一クライアントIDが再利用されること');
});

test('getOrCreateSessionId: 30分セッション管理', async () => {
  mockStorage.session.clear();
  const baseTime = 1700000000000;
  const sid1 = await getOrCreateSessionId(baseTime);
  assert.equal(sid1, String(baseTime));

  const sid2 = await getOrCreateSessionId(baseTime + 10 * 60 * 1000);
  assert.equal(sid2, sid1, '有効時間内は同一セッションID');

  // 31分経過
  const sid3 = await getOrCreateSessionId(baseTime + 41 * 60 * 1000);
  assert.equal(sid3, String(baseTime + 41 * 60 * 1000));
  assert.notEqual(sid1, sid3, '30分タイムアウト後は新セッションIDが生成されること');
});

test('syncConsentBadge: 既存ユーザーへの "!" バッジ表示と確認後の消去', async () => {
  mockStorage.local.clear();
  badgeState = { text: '', color: '' };

  // 1. 新規ユーザー初期状態 (optInAccepted: false): バッジなし
  await syncConsentBadge();
  assert.equal(badgeState.text, '');

  // 2. 既存ユーザー (optInAccepted: true, analyticsConsentReviewed: false): "!" バッジ表示
  mockStorage.local.set('app_settings', {
    optInAccepted: true,
    analyticsConsentReviewed: false,
    analyticsEnabled: false
  });
  await syncConsentBadge();
  assert.equal(badgeState.text, '!');
  assert.equal(badgeState.color, '#f59e0b');

  // 3. 合意確認完了後 (analyticsConsentReviewed: true): バッジ消去
  mockStorage.local.set('app_settings', {
    optInAccepted: true,
    analyticsConsentReviewed: true,
    analyticsEnabled: true
  });
  await syncConsentBadge();
  assert.equal(badgeState.text, '');
});

test('sendGAEvent: オプトアウト状態での完全遮断', async () => {
  mockStorage.local.clear();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200 };
  };

  try {
    // 1. 合意未確認時 (初期状態)
    let res = await sendGAEvent('code_redeem_result', { game: 'genshin' });
    assert.equal(res.success, false);
    assert.equal(res.reason, 'OPTED_OUT');
    assert.equal(fetchCalled, false);

    // 2. オプトアウト選択時 (analyticsConsentReviewed: true, analyticsEnabled: false)
    mockStorage.local.set('app_settings', {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      analyticsEnabled: false
    });
    res = await sendGAEvent('code_redeem_result', { game: 'genshin' });
    assert.equal(res.success, false);
    assert.equal(res.reason, 'OPTED_OUT');
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendGAEvent: 共通パラメータ付与および開発/本番送信の挙動', async () => {
  mockStorage.local.clear();
  mockStorage.session.clear();

  mockStorage.local.set('app_settings', {
    optInAccepted: true,
    analyticsConsentReviewed: true,
    analyticsEnabled: true,
    language: 'ja'
  });

  const capturedRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    capturedRequests.push({ url, opts });
    return { ok: true, status: 204 };
  };

  const origIsDev = API_CONFIG.IS_DEV;
  const origMid = API_CONFIG.GA_MEASUREMENT_ID;
  const origSec = API_CONFIG.GA_API_SECRET;

  try {
    // 1. IS_DEV === true 時はコンソールログのみで fetch されないこと
    API_CONFIG.IS_DEV = true;
    let res = await sendGAEvent('ui_action', { action_type: 'open_log', game: 'none' });
    assert.equal(res.success, true);
    assert.equal(res.isDev, true);
    assert.equal(res.params.app_version, '1.3.0');
    assert.equal(res.params.lang, 'ja');
    assert.equal(res.params.engagement_time_msec, 100);
    assert.ok(res.params.session_id);
    assert.equal(capturedRequests.length, 0, 'dev環境ではfetchが呼ばれない');

    // 2. IS_DEV === false 時は本番エンドポイントへ単純POST通信
    API_CONFIG.IS_DEV = false;
    API_CONFIG.GA_MEASUREMENT_ID = 'G-TEST123456';
    API_CONFIG.GA_API_SECRET = 'TEST_SECRET';

    res = await sendGAEvent('ui_action', { action_type: 'notification_click', game: 'genshin' });
    assert.equal(res.success, true);
    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.ok(req.url.includes('measurement_id=G-TEST123456'));
    assert.ok(req.url.includes('api_secret=TEST_SECRET'));
    assert.equal(req.opts.method, 'POST');
    assert.equal(req.opts.credentials, 'omit');
    // Content-Type ヘッダーが付与されていないこと（CORSプリフライト回避）
    assert.equal(req.opts.headers, undefined);

    const parsedBody = JSON.parse(req.opts.body);
    assert.ok(parsedBody.client_id);
    assert.equal(parsedBody.events.length, 1);
    assert.equal(parsedBody.events[0].name, 'ui_action');
    assert.equal(parsedBody.events[0].params.action_type, 'notification_click');
    assert.equal(parsedBody.events[0].params.game, 'genshin');
  } finally {
    API_CONFIG.IS_DEV = origIsDev;
    API_CONFIG.GA_MEASUREMENT_ID = origMid;
    API_CONFIG.GA_API_SECRET = origSec;
    globalThis.fetch = originalFetch;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toGaGameKey,
  toRedeemTrigger,
  toCheckinTrigger,
  sanitizeEventParams,
  getOrCreateSessionId,
  syncConsentBadge,
  sendGAEvent
} from '../src/services/analytics-service.js';
import { createStateStore } from '../src/services/state-store.js';
import { API_CONFIG } from '../src/config/constants.js';
import { createInMemoryStorageAdapter } from './helpers/in-memory-storage-adapter.js';

let badgeState = { text: '', color: '' };

globalThis.chrome = {
  action: {
    setBadgeText: async (opts) => { badgeState.text = opts?.text ?? ''; },
    setBadgeBackgroundColor: async (opts) => { badgeState.color = opts?.color ?? ''; }
  },
  runtime: {
    getManifest: () => ({ version: '1.3.5' })
  }
};

function createTestStore() {
  const storage = createInMemoryStorageAdapter();
  const store = createStateStore({ storage });
  return { storage, store };
}

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
  assert.equal(sanitizeEventParams('unknown_event', { foo: 'bar' }), null);

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

  const fetchErrClean = sanitizeEventParams('code_list_fetch_error', {
    game: 'genshin',
    http_status: 503,
    error_type: 'http_error',
    lang: 'ja',
    secret: 'xxx'
  });
  assert.deepEqual(fetchErrClean, {
    game: 'genshin',
    http_status: 503,
    error_type: 'http_error'
  });
});

test('getOrCreateGaClientId: UUIDの生成とストレージ永続化', async () => {
  const { store } = createTestStore();
  const id1 = await store.getOrCreateGaClientId();
  assert.ok(id1);
  assert.match(id1, /^[0-9a-f-]{36}$/i);

  const id2 = await store.getOrCreateGaClientId();
  assert.equal(id1, id2, '同一クライアントIDが再利用されること');
});

test('getOrCreateSessionId: 30分セッション管理', async () => {
  const { store } = createTestStore();
  const baseTime = 1700000000000;
  const sid1 = await getOrCreateSessionId(baseTime, store);
  assert.equal(sid1, String(baseTime));

  const sid2 = await getOrCreateSessionId(baseTime + 10 * 60 * 1000, store);
  assert.equal(sid2, sid1, '有効時間内は同一セッションID');

  const sid3 = await getOrCreateSessionId(baseTime + 41 * 60 * 1000, store);
  assert.equal(sid3, String(baseTime + 41 * 60 * 1000));
  assert.notEqual(sid1, sid3, '30分タイムアウト後は新セッションIDが生成されること');
});

test('syncConsentBadge: 既存ユーザーへの "!" バッジ表示とポリシー改定連動', async () => {
  const { storage, store } = createTestStore();
  badgeState = { text: '', color: '' };

  await syncConsentBadge(store);
  assert.equal(badgeState.text, '');

  storage.seedLocal({
    app_settings: {
      optInAccepted: true,
      analyticsConsentReviewed: false,
      analyticsEnabled: false
    }
  });
  await syncConsentBadge(store);
  assert.equal(badgeState.text, '!');
  assert.equal(badgeState.color, '#f59e0b');

  storage.seedLocal({
    app_settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      analyticsEnabled: true
    }
  });
  await syncConsentBadge(store);
  assert.equal(badgeState.text, '', '現行版補完によりバッジは非表示');

  storage.seedLocal({
    app_settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      analyticsEnabled: true,
      agreedPolicyVersion: '2026-10-12'
    }
  });
  await syncConsentBadge(store);
  assert.equal(badgeState.text, '!', '旧版同意ユーザーにはバッジを表示');
  assert.equal(badgeState.color, '#f59e0b');

  storage.seedLocal({
    app_settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      analyticsEnabled: true,
      agreedPolicyVersion: '2026-10-26'
    }
  });
  await syncConsentBadge(store);
  assert.equal(badgeState.text, '', '最新版同意後はバッジ消去');
});

test('sendGAEvent: オプトアウト状態での完全遮断', async () => {
  const { storage, store } = createTestStore();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200 };
  };

  try {
    let res = await sendGAEvent('code_redeem_result', { game: 'genshin' }, { store });
    assert.equal(res.success, false);
    assert.equal(res.reason, 'OPTED_OUT');
    assert.equal(fetchCalled, false);

    storage.seedLocal({
      app_settings: {
        optInAccepted: true,
        analyticsConsentReviewed: true,
        analyticsEnabled: false
      }
    });
    res = await sendGAEvent('code_redeem_result', { game: 'genshin' }, { store });
    assert.equal(res.success, false);
    assert.equal(res.reason, 'OPTED_OUT');
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendGAEvent: 共通パラメータ付与および開発/本番送信の挙動', async () => {
  const { storage, store } = createTestStore();

  storage.seedLocal({
    app_settings: {
      optInAccepted: true,
      analyticsConsentReviewed: true,
      analyticsEnabled: true,
      language: 'ja'
    }
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
    API_CONFIG.IS_DEV = true;
    let res = await sendGAEvent('ui_action', { action_type: 'open_log', game: 'none' }, { store });
    assert.equal(res.success, true);
    assert.equal(res.isDev, true);
    assert.equal(res.params.app_version, '1.3.5');
    assert.equal(res.params.lang, 'ja');
    assert.equal(res.params.engagement_time_msec, 100);
    assert.ok(res.params.session_id);
    assert.ok(res.params.client_id);
    assert.match(res.params.client_id, /^[0-9a-f-]{36}$/i);
    assert.equal(res.params.custom_client_id, res.params.client_id, 'custom_client_idにclient_idと同じ値が設定されること');
    assert.equal(res.params.user_id, undefined, 'user_idは付与されないこと');
    assert.equal(capturedRequests.length, 0, 'dev環境ではfetchが呼ばれない');

    API_CONFIG.IS_DEV = false;
    API_CONFIG.GA_MEASUREMENT_ID = 'G-TEST123456';
    API_CONFIG.GA_API_SECRET = 'TEST_SECRET';

    res = await sendGAEvent('ui_action', { action_type: 'notification_click', game: 'genshin' }, { store });
    assert.equal(res.success, true);
    assert.equal(capturedRequests.length, 1);
    const req = capturedRequests[0];
    assert.ok(req.url.includes('measurement_id=G-TEST123456'));
    assert.ok(req.url.includes('api_secret=TEST_SECRET'));
    assert.equal(req.opts.method, 'POST');
    assert.equal(req.opts.credentials, 'omit');
    assert.equal(req.opts.headers, undefined);

    const parsedBody = JSON.parse(req.opts.body);
    assert.ok(parsedBody.client_id);
    assert.equal(parsedBody.user_id, undefined, 'ルートにuser_idは含まれないこと');
    assert.equal(parsedBody.events.length, 1);
    assert.equal(parsedBody.events[0].name, 'ui_action');
    assert.equal(parsedBody.events[0].params.action_type, 'notification_click');
    assert.equal(parsedBody.events[0].params.game, 'genshin');
    assert.equal(parsedBody.events[0].params.client_id, parsedBody.client_id, 'イベントパラメータにも同一のclient_idが付与されること');
    assert.equal(parsedBody.events[0].params.custom_client_id, parsedBody.client_id, 'イベントパラメータのcustom_client_idにも同一のclient_idが付与されること');

    storage.seedLocal({ ga_client_id: 'existing-user-uuid-9999' });
    const existingUserRes = await sendGAEvent('ui_action', { action_type: 'open_log', game: 'none' }, { store });
    assert.equal(existingUserRes.success, true);
    assert.equal(existingUserRes.params.client_id, 'existing-user-uuid-9999');
    assert.equal(existingUserRes.params.custom_client_id, 'existing-user-uuid-9999');
    const existingReqBody = JSON.parse(capturedRequests[1].opts.body);
    assert.equal(existingReqBody.client_id, 'existing-user-uuid-9999');
    assert.equal(existingReqBody.events[0].params.client_id, 'existing-user-uuid-9999');
    assert.equal(existingReqBody.events[0].params.custom_client_id, 'existing-user-uuid-9999');
  } finally {
    API_CONFIG.IS_DEV = origIsDev;
    API_CONFIG.GA_MEASUREMENT_ID = origMid;
    API_CONFIG.GA_API_SECRET = origSec;
    globalThis.fetch = originalFetch;
  }
});

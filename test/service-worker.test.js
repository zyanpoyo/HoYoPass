import test from 'node:test';
import assert from 'node:assert/strict';

const mockStorage = {
  local: new Map(),
  session: new Map()
};

const mockCreatedTabs = [];
const mockClearedNotifications = [];

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: mockStorage.local.get(key) }),
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.local.set(k, v)),
      getBytesInUse: async () => 1024
    },
    session: {
      get: async (key) => ({ [key]: mockStorage.session.get(key) }),
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.session.set(k, v)),
      remove: async (key) => mockStorage.session.delete(key)
    }
  },
  alarms: {
    get: async () => null,
    create: () => {},
    onAlarm: { addListener: () => {} }
  },
  notifications: {
    create: () => {},
    clear: (id) => { mockClearedNotifications.push(id); },
    onClicked: { addListener: () => {} }
  },
  tabs: {
    create: async (opts) => {
      mockCreatedTabs.push(opts);
      return { id: 1, ...opts };
    }
  },
  runtime: {
    id: 'test-ext-id',
    getURL: (p) => `chrome-extension://test-ext-id/${p}`,
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    onMessage: { addListener: () => {} }
  }
};

import { acquireExecutionLock, releaseExecutionLock, markCodeStatus, getRedeemedCodes } from '../src/services/storage-service.js';
import { STATUS_MAP, GAMES } from '../src/config/constants.js';
const { handleNotificationClick, LOGIN_NOTIFICATION_PREFIX } = await import('../src/background/service-worker.js');

test('排他ロック: 獲得と解放', async () => {
  const lock1 = await acquireExecutionLock('TEST');
  assert.equal(lock1, true);

  const lock2 = await acquireExecutionLock('TEST2');
  assert.equal(lock2, false, 'すでに実行中ならロック獲得失敗');

  await releaseExecutionLock();
  const lock3 = await acquireExecutionLock('TEST3');
  assert.equal(lock3, true, '解放後はロック獲得可能');
  await releaseExecutionLock();
});

test('コードステータス記録: 短縮キー保存とリトライ', async () => {
  await markCodeStatus('hk4e_global', 'TESTCODE1', 'SUCCESS');
  let codes = await getRedeemedCodes('hk4e_global');
  assert.equal(codes['TESTCODE1'].s, STATUS_MAP.SUCCESS);

  await markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  codes = await getRedeemedCodes('hk4e_global');
  assert.equal(codes['ERRCODE'].s, STATUS_MAP.PENDING_RETRY);
  assert.equal(codes['ERRCODE'].r, 1);

  await markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  await markCodeStatus('hk4e_global', 'ERRCODE', 'RETRY');
  codes = await getRedeemedCodes('hk4e_global');
  assert.equal(codes['ERRCODE'].s, STATUS_MAP.FAILED, '3回失敗でFAILED確定');
});

test('GAMES config: giftSiteUrlの定義確認', () => {
  assert.equal(GAMES.GENSHIN.giftSiteUrl, 'https://genshin.hoyoverse.com/ja/gift');
  assert.equal(GAMES.STAR_RAIL.giftSiteUrl, 'https://hsr.hoyoverse.com/gift');
  assert.equal(GAMES.ZZZ.giftSiteUrl, 'https://zenless.hoyoverse.com/redemption/gift');
});

test('handleNotificationClick: ログイン誘導通知クリック時に正しい交換サイトを開く', async () => {
  mockCreatedTabs.length = 0;
  mockClearedNotifications.length = 0;

  // 原神のログイン通知クリック
  const notifIdGenshin = `${LOGIN_NOTIFICATION_PREFIX}GENSHIN`;
  await handleNotificationClick(notifIdGenshin);
  assert.equal(mockCreatedTabs.length, 1);
  assert.equal(mockCreatedTabs[0].url, 'https://genshin.hoyoverse.com/ja/gift');
  assert.equal(mockClearedNotifications.includes(notifIdGenshin), true);

  // スタレのログイン通知クリック
  const notifIdHsr = `${LOGIN_NOTIFICATION_PREFIX}STAR_RAIL`;
  await handleNotificationClick(notifIdHsr);
  assert.equal(mockCreatedTabs.length, 2);
  assert.equal(mockCreatedTabs[1].url, 'https://hsr.hoyoverse.com/gift');
  assert.equal(mockClearedNotifications.includes(notifIdHsr), true);

  // ZZZのログイン通知クリック
  const notifIdZzz = `${LOGIN_NOTIFICATION_PREFIX}ZZZ`;
  await handleNotificationClick(notifIdZzz);
  assert.equal(mockCreatedTabs.length, 3);
  assert.equal(mockCreatedTabs[2].url, 'https://zenless.hoyoverse.com/redemption/gift');
  assert.equal(mockClearedNotifications.includes(notifIdZzz), true);

  // 関係のない通知IDの場合はタブを作成しない
  mockCreatedTabs.length = 0;
  await handleNotificationClick('other_notification_id');
  assert.equal(mockCreatedTabs.length, 0);
});


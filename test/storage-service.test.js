import test from 'node:test';
import assert from 'node:assert/strict';

const mockStorage = {
  local: new Map()
};

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: mockStorage.local.get(key) }),
      set: async (obj) => Object.entries(obj).forEach(([k, v]) => mockStorage.local.set(k, v))
    }
  }
};

import { addExecutionLog, getLastSuccessfulRun, setLastSuccessfulRun, shouldRunRedeem } from '../src/services/storage-service.js';
import { API_CONFIG } from '../src/config/constants.js';

test('addExecutionLog: ログの追加と最大保持件数(MAX_EXECUTION_LOGS: 50)の維持', async () => {
  mockStorage.local.clear();

  assert.equal(API_CONFIG.MAX_EXECUTION_LOGS, 50, '定数MAX_EXECUTION_LOGSは50であること');

  // 1件目の追加
  await addExecutionLog({ message: 'ログ 1' });
  let data = await chrome.storage.local.get('exec_logs');
  assert.equal(data.exec_logs.length, 1);
  assert.equal(data.exec_logs[0].message, 'ログ 1');

  // 55件追加（合計56件になるため、上限50件にトリムされる）
  for (let i = 2; i <= 56; i++) {
    await addExecutionLog({ message: `ログ ${i}` });
  }

  data = await chrome.storage.local.get('exec_logs');
  assert.equal(data.exec_logs.length, 50, '保持件数が50件に制限されていること');
  assert.equal(data.exec_logs[0].message, 'ログ 56', '先頭に最新ログが格納されていること');
  assert.equal(data.exec_logs[49].message, 'ログ 7', '最も古い50件目（ログ7）が残っており、それ以前は破棄されていること');
});

test('getLastSuccessfulRun / setLastSuccessfulRun: 最終実行時刻の保存と取得', async () => {
  mockStorage.local.clear();

  const initial = await getLastSuccessfulRun();
  assert.equal(initial, 0, '未記録時は0を返す');

  const now = 1700000000000;
  await setLastSuccessfulRun(now);
  const updated = await getLastSuccessfulRun();
  assert.equal(updated, now, '保存したタイムスタンプが取得できる');
});

test('shouldRunRedeem: 指定インターバル経過判定', async () => {
  mockStorage.local.clear();

  // 未記録時は必ずtrue
  const shouldRunInitial = await shouldRunRedeem(180);
  assert.equal(shouldRunInitial, true, '初期状態では実行対象');

  // 2時間前に実行された場合（180分インターバルの場合まだfalse）
  const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
  await setLastSuccessfulRun(twoHoursAgo);
  const shouldRun2h = await shouldRunRedeem(180);
  assert.equal(shouldRun2h, false, '2時間経過時点では3時間未達のためfalse');

  // 3時間1分前に実行された場合（180分経過でtrue）
  const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000 + 60 * 1000);
  await setLastSuccessfulRun(threeHoursAgo);
  const shouldRun3h = await shouldRunRedeem(180);
  assert.equal(shouldRun3h, true, '3時間以上経過時はtrue');
});


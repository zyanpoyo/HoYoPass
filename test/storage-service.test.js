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

import { addExecutionLog } from '../src/services/storage-service.js';
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

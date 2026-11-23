import test from 'node:test';
import assert from 'node:assert/strict';
import { isTimeoutError, isNetworkException } from '../src/services/http-client.js';

async function createRealTimeoutError() {
  const signal = AbortSignal.timeout(1);
  if (!signal.aborted) {
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, { once: true });
    });
  }
  return signal.reason;
}

test('isTimeoutError: AbortSignal.timeout 由来の TimeoutError と各種タイムアウト判定', async () => {
  const realTimeoutErr = await createRealTimeoutError();
  assert.equal(realTimeoutErr.name, 'TimeoutError');
  assert.equal(isTimeoutError(realTimeoutErr), true, '実 TimeoutError を検知できること');
  assert.equal(isTimeoutError(new DOMException('aborted', 'AbortError')), true, 'AbortError を検知できること');
  assert.equal(isTimeoutError(new Error('Request timed out')), true, '小文字 timed out メッセージを検知できること');
  assert.equal(isTimeoutError(new Error('TIMEOUT')), true, '大文字 TIMEOUT メッセージを検知できること');

  assert.equal(isTimeoutError(new TypeError('Failed to fetch')), false);
  assert.equal(isTimeoutError(new Error('HTTP_ERROR_503')), false);
  assert.equal(isTimeoutError(null), false);
});

test('isNetworkException: ネットワーク例外と業務・バグ由来エラーの境界判定', async () => {
  const realTimeoutErr = await createRealTimeoutError();
  assert.equal(isNetworkException(realTimeoutErr), true, 'TimeoutError はリトライ対象であること');
  assert.equal(isNetworkException(new DOMException('aborted', 'AbortError')), true);
  assert.equal(isNetworkException(new Error('Request timed out')), true);
  assert.equal(isNetworkException(new Error('TIMEOUT')), true);
  assert.equal(isNetworkException(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkException(new TypeError('fetch failed')), true);
  assert.equal(isNetworkException(new Error('Network error')), true);

  // 実装バグや防御エラー・HTTPステータスエラーは誤ってネットワーク例外にしないこと
  assert.equal(
    isNetworkException(new TypeError("Cannot read properties of undefined (reading 'foo')")),
    false,
    '一般の TypeError はネットワーク例外扱いにしないこと'
  );
  assert.equal(isNetworkException(new SyntaxError('Unexpected token <')), false);
  assert.equal(isNetworkException(new Error('HTTP_ERROR_503')), false);
  assert.equal(
    isNetworkException(new Error('SECURITY_ERROR: Host example.com is not allowed for publicFetch.')),
    false,
    'publicFetch の SECURITY_ERROR は fetch 部分一致で誤判定しないこと'
  );
  assert.equal(isNetworkException(new Error('STORAGE_WRITE_FAILURE: quota exceeded')), false);
  assert.equal(isNetworkException(null), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCode, isValidUid, isValidRegion, maskUid } from '../src/services/security.js';

test('isValidCode: 有効なコードの判定', () => {
  assert.equal(isValidCode('GENSHINGIFT'), true);
  assert.equal(isValidCode('A1B2C3D4E5'), true);
  assert.equal(isValidCode('ABC'), false, '4文字未満は無効');
  assert.equal(isValidCode('A'.repeat(31)), false, '30文字超過は無効');
  assert.equal(isValidCode('CODE<script>'), false, '特殊記号混入は無効');
  assert.equal(isValidCode('コード１２３'), false, '全角混入は無効');
});

test('isValidUid: UIDバリデーション', () => {
  assert.equal(isValidUid('800123456'), true);
  assert.equal(isValidUid(800123456), true);
  assert.equal(isValidUid('12345'), false, '6桁未満は無効');
  assert.equal(isValidUid('8001234567890'), false, '13桁以上は無効');
  assert.equal(isValidUid('80012345a'), false, '英字混入は無効');
});

test('isValidRegion: サーバー地域バリデーション', () => {
  assert.equal(isValidRegion('os_usa'), true);
  assert.equal(isValidRegion('os_asia'), true);
  assert.equal(isValidRegion('invalid_region'), false);
  assert.equal(isValidRegion(''), false);
});

test('maskUid: マスキング', () => {
  assert.equal(maskUid('800123456'), '800***456');
  assert.equal(maskUid('1234'), '***');
  assert.equal(maskUid(null), '***');
});

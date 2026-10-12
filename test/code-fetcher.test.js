import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../src/config/constants.js';

test('GAMES config: タイトル別パラメータ定義', () => {
  assert.equal(GAMES.GENSHIN.hoyoCodesParam, 'genshin');
  assert.equal(GAMES.STAR_RAIL.hoyoCodesParam, 'hkrpg');
  assert.equal(GAMES.ZZZ.hoyoCodesParam, 'nap');
});

test('code-fetcher: パラメータマッピングのフォールバック動作', () => {
  const getParam = (key) => GAMES[key]?.hoyoCodesParam || key.toLowerCase();
  assert.equal(getParam('GENSHIN'), 'genshin');
  assert.equal(getParam('STAR_RAIL'), 'hkrpg');
  assert.equal(getParam('ZZZ'), 'nap');
  assert.equal(getParam('genshin'), 'genshin');
  assert.equal(getParam('hkrpg'), 'hkrpg');
});

test('DOCS_URLS: URL定義の確認', async () => {
  const { DOCS_URLS } = await import('../src/config/constants.js');
  assert.equal(DOCS_URLS.README, 'https://github.com/zyanpoyo/HoYoPass#readme');
  assert.equal(DOCS_URLS.PRIVACY_POLICY, 'https://github.com/zyanpoyo/HoYoPass/blob/main/docs/legal/privacy_policy.md');
});

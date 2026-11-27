import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GAMES,
  DEFAULT_ENABLED_GAMES,
  DEFAULT_GAME_KEY,
  getLocalizedGame,
  getGameAllLocalizedNames,
  getGameGaKey,
  getOnboardingEnabledParamKey,
  getOnboardingEnabledParamKeys,
  buildOnboardingEnabledParams
} from '../src/config/games.js';

function extractAttrValues(html, regex) {
  return [...html.matchAll(regex)].map(match => match[1]);
}

test('GAMES カタログ: 全タイトルの必須項目・一意性・不変性・互換プロパティの検証', () => {
  const keys = Object.keys(GAMES);
  assert.ok(keys.length > 0);
  assert.deepEqual(DEFAULT_ENABLED_GAMES, keys);
  assert.equal(DEFAULT_GAME_KEY, keys[0]);
  assert.equal(Object.isFrozen(GAMES), true);
  assert.equal(Object.isFrozen(DEFAULT_ENABLED_GAMES), true);

  const gaKeys = new Set();
  const gameBizSet = new Set();

  for (const key of keys) {
    const game = GAMES[key];
    assert.equal(Object.isFrozen(game), true, `${key} が freeze されていること`);
    assert.equal(Object.isFrozen(game.signHosts), true, `${key}.signHosts が freeze されていること`);
    assert.equal(Object.isFrozen(game.locales), true, `${key}.locales が freeze されていること`);
    assert.equal(game.key, key);
    assert.ok(game.gaKey, `${key} に gaKey が存在すること`);
    assert.ok(game.gameBiz, `${key} に gameBiz が存在すること`);
    assert.ok(game.iconPath, `${key} に iconPath が存在すること`);
    assert.ok(game.exchangeHost?.startsWith('https://'), `${key} に exchangeHost が存在すること`);
    assert.ok(game.exchangePath, `${key} に exchangePath が存在すること`);
    assert.ok(game.hoyoCodesParam, `${key} に hoyoCodesParam が存在すること`);
    assert.ok(game.actId, `${key} に actId が存在すること`);
    assert.ok(game.signGameHeader, `${key} に signGameHeader が存在すること`);
    assert.ok(Array.isArray(game.signHosts) && game.signHosts.length > 0, `${key} に signHosts が存在すること`);
    assert.ok(game.infoPath, `${key} に infoPath が存在すること`);
    assert.ok(game.signPath, `${key} に signPath が存在すること`);
    assert.ok(game.checkInSiteUrl?.startsWith('https://'), `${key} に checkInSiteUrl が存在すること`);

    assert.equal(gaKeys.has(game.gaKey), false, `gaKey "${game.gaKey}" が重複しないこと`);
    gaKeys.add(game.gaKey);
    assert.equal(gameBizSet.has(game.gameBiz), false, `gameBiz "${game.gameBiz}" が重複しないこと`);
    gameBizSet.add(game.gameBiz);

    for (const lang of ['ja', 'en']) {
      const loc = game.locales[lang];
      assert.ok(loc?.name, `${key}.locales.${lang}.name が存在すること`);
      assert.ok(loc?.shortName, `${key}.locales.${lang}.shortName が存在すること`);
      assert.ok(loc?.tabLabel, `${key}.locales.${lang}.tabLabel が存在すること`);
      assert.ok(loc?.giftSiteUrl?.startsWith('https://'), `${key}.locales.${lang}.giftSiteUrl が存在すること`);
    }

    assert.equal(game.name, game.locales.ja.name);
    assert.equal(game.shortName, game.locales.ja.shortName);
    assert.equal(game.tabLabel, game.locales.ja.tabLabel);
    assert.equal(game.giftSiteUrl, game.locales.ja.giftSiteUrl);
  }
});

test('派生参照ヘルパー: getLocalizedGame / getGameAllLocalizedNames / GA4キー・オンボーディングパラメータ生成', () => {
  const jaGenshin = getLocalizedGame('GENSHIN', 'ja');
  assert.equal(jaGenshin.name, '原神');
  assert.equal(jaGenshin.giftSiteUrl, 'https://genshin.hoyoverse.com/ja/gift');

  const enGenshin = getLocalizedGame('GENSHIN', 'en');
  assert.equal(enGenshin.name, 'Genshin Impact');
  assert.equal(enGenshin.giftSiteUrl, 'https://genshin.hoyoverse.com/en/gift');

  const fallbackLang = getLocalizedGame('STAR_RAIL', 'fr');
  assert.equal(fallbackLang.name, '崩壊：スターレイル');
  assert.equal(fallbackLang.giftSiteUrl, 'https://hsr.hoyoverse.com/gift');

  const unknown = getLocalizedGame('UNKNOWN_GAME', 'en');
  assert.deepEqual(unknown, {
    name: 'UNKNOWN_GAME',
    shortName: 'UNKNOWN_GAME',
    tabLabel: 'UNKNOWN_GAME',
    giftSiteUrl: ''
  });

  assert.deepEqual(getGameAllLocalizedNames('GENSHIN'), ['原神', 'Genshin Impact']);
  assert.deepEqual(getGameAllLocalizedNames('STAR_RAIL'), ['崩壊：スターレイル', 'Honkai: Star Rail']);
  assert.deepEqual(getGameAllLocalizedNames('ZZZ'), ['ゼンレスゾーンゼロ', 'Zenless Zone Zero']);
  assert.deepEqual(getGameAllLocalizedNames('UNKNOWN_GAME'), []);

  assert.equal(getGameGaKey('GENSHIN'), 'genshin');
  assert.equal(getGameGaKey('STAR_RAIL'), 'hsr');
  assert.equal(getGameGaKey('ZZZ'), 'zzz');
  assert.equal(getGameGaKey('UNKNOWN_GAME'), 'none');

  assert.equal(getOnboardingEnabledParamKey('GENSHIN'), 'genshin_enabled');
  assert.equal(getOnboardingEnabledParamKey('UNKNOWN_GAME'), null);
  assert.deepEqual(getOnboardingEnabledParamKeys(), ['genshin_enabled', 'hsr_enabled', 'zzz_enabled']);

  assert.deepEqual(buildOnboardingEnabledParams(['GENSHIN', 'ZZZ']), {
    genshin_enabled: true,
    hsr_enabled: false,
    zzz_enabled: true
  });
  assert.deepEqual(buildOnboardingEnabledParams(null), {
    genshin_enabled: false,
    hsr_enabled: false,
    zzz_enabled: false
  });
});

test('popup.html ドリフト検知: ゲーム選択チェックボックスとタブの値が DEFAULT_ENABLED_GAMES と一致すること', () => {
  const html = fs.readFileSync('src/popup/popup.html', 'utf8');

  const optinValues = extractAttrValues(html, /class="optin-game-cb"\s+value="([^"]+)"/g);
  const filterValues = extractAttrValues(html, /class="filter-game-cb"\s+value="([^"]+)"/g);
  const tabValues = extractAttrValues(html, /class="tab-btn(?:\s+active)?"\s+data-game="([^"]+)"/g);
  const labelValues = extractAttrValues(html, /data-game-label="([^"]+)"/g);

  assert.deepEqual(optinValues, DEFAULT_ENABLED_GAMES);
  assert.deepEqual(filterValues, DEFAULT_ENABLED_GAMES);
  assert.deepEqual(tabValues, DEFAULT_ENABLED_GAMES);
  assert.deepEqual(labelValues, [...DEFAULT_ENABLED_GAMES, ...DEFAULT_ENABLED_GAMES]);
});

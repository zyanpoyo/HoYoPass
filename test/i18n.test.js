import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLanguage,
  formatDailySignTimeLocal,
  getGameLocalized,
  getExchangeApiLang,
  getSignApiLang,
  t
} from '../src/utils/i18n.js';

test('resolveLanguage: 明示的な言語指定', () => {
  assert.equal(resolveLanguage('ja'), 'ja');
  assert.equal(resolveLanguage('en'), 'en');
});

test('resolveLanguage: auto指定時のブラウザ/navigator判定', () => {
  // 日本語環境
  assert.equal(resolveLanguage('auto', 'ja-JP'), 'ja');

  // 英語環境
  assert.equal(resolveLanguage('auto', 'en-US'), 'en');

  // その他（ドイツ語など）-> en
  assert.equal(resolveLanguage('auto', 'de-DE'), 'en');

  // ブラウザ情報なし時はjaへフォールバック
  assert.equal(resolveLanguage('auto', ''), 'ja');
});

test('formatDailySignTimeLocal: 形式検証 (HH:mm)', () => {
  const timeStr = formatDailySignTimeLocal();
  assert.match(timeStr, /^\d{2}:\d{2}$/);
});

test('getGameLocalized: 日英のゲーム名・タブ名・URL切り替え', () => {
  // 原神
  const genshinJa = getGameLocalized('GENSHIN', 'ja');
  assert.equal(genshinJa.name, '原神');
  assert.equal(genshinJa.tabLabel, '原神');
  assert.equal(genshinJa.shortName, '原');
  assert.equal(genshinJa.giftSiteUrl, 'https://genshin.hoyoverse.com/ja/gift');

  const genshinEn = getGameLocalized('GENSHIN', 'en');
  assert.equal(genshinEn.name, 'Genshin Impact');
  assert.equal(genshinEn.tabLabel, 'Genshin');
  assert.equal(genshinEn.shortName, 'GI');
  assert.equal(genshinEn.giftSiteUrl, 'https://genshin.hoyoverse.com/en/gift');

  // スタレ
  const hsrEn = getGameLocalized('STAR_RAIL', 'en');
  assert.equal(hsrEn.name, 'Honkai: Star Rail');
  assert.equal(hsrEn.tabLabel, 'Star Rail');
  assert.equal(hsrEn.shortName, 'HSR');

  // ZZZ
  const zzzEn = getGameLocalized('ZZZ', 'en');
  assert.equal(zzzEn.name, 'Zenless Zone Zero');
  assert.equal(zzzEn.shortName, 'ZZZ');
});

test('getExchangeApiLang & getSignApiLang: API言語パラメータ変換', () => {
  assert.equal(getExchangeApiLang('ja'), 'ja');
  assert.equal(getExchangeApiLang('en'), 'en');

  assert.equal(getSignApiLang('ja'), 'ja-jp');
  assert.equal(getSignApiLang('en'), 'en-us');
});

test('t: プレースホルダー置換と多言語メッセージ取得', () => {
  assert.equal(t('btnOk', [], 'ja'), 'OK');
  assert.equal(t('btnOk', [], 'en'), 'OK');

  assert.equal(t('autoSignLabel', ['01:05'], 'ja'), '自動受け取り (毎日 01:05)');
  assert.equal(t('autoSignLabel', ['01:05'], 'en'), 'Auto Claim (Daily 01:05)');

  assert.equal(t('redeemStatsBadge', [5, 42], 'ja'), '今月 5件 / 通算 42件');
  assert.equal(t('redeemStatsBadge', [5, 42], 'en'), 'Month: 5 / Total: 42');
});

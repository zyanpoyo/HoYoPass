import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLanguage,
  getPrivacyPolicyUrl,
  getGuideUrl,
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

test('getPrivacyPolicyUrl: 言語別のURL解決', () => {
  assert.equal(getPrivacyPolicyUrl('ja'), 'https://hoyopass.pages.dev/privacy');
  assert.equal(getPrivacyPolicyUrl('en'), 'https://hoyopass.pages.dev/privacy_en');
  assert.equal(getPrivacyPolicyUrl(), 'https://hoyopass.pages.dev/privacy', 'デフォルトは日本語URL');
});

test('getGuideUrl: 言語別の使い方ガイドURL解決', () => {
  assert.equal(getGuideUrl('ja'), 'https://hoyopass.pages.dev/');
  assert.equal(getGuideUrl('en'), 'https://hoyopass.pages.dev/index_en');
  assert.equal(getGuideUrl(), 'https://hoyopass.pages.dev/', 'デフォルトは日本語URL');
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

  // ポリシー改定モーダル文言の検証
  assert.equal(t('policyUpdateTitle', [], 'ja'), 'プライバシーポリシー改定のお知らせ');
  assert.equal(t('policyUpdateTitle', [], 'en'), 'Privacy Policy Update');
  assert.equal(t('policyUpdateAcceptBtn', [], 'ja'), '確認して同意する');
  assert.equal(t('policyUpdateAcceptBtn', [], 'en'), 'Agree and Continue');

  const jaDesc = t('policyUpdateDesc', ['2026-10-26', '<link>'], 'ja');
  assert.ok(jaDesc.includes('2026-10-26'));
  assert.ok(jaDesc.includes('<link>'));

  const enDesc = t('policyUpdateDesc', ['2026-10-26', '<link>'], 'en');
  assert.ok(enDesc.includes('2026-10-26'));
  assert.ok(enDesc.includes('<link>'));
});

test('t: レビュー促進バナー関連メッセージの日英一貫性', () => {
  const keys = [
    'reviewPromptTitle',
    'reviewPromptBody',
    'reviewPromptBtnWrite',
    'reviewPromptBtnLater',
    'reviewPromptBtnDismiss'
  ];

  keys.forEach(key => {
    const jaText = t(key, [], 'ja');
    const enText = t(key, [], 'en');

    assert.ok(jaText && jaText !== key, `ja に ${key} の翻訳が存在すること`);
    assert.ok(enText && enText !== key, `en に ${key} の翻訳が存在すること`);
    assert.notEqual(jaText, enText, `${key} の日英でテキストが異なること`);
  });

  assert.equal(t('reviewPromptBtnWrite', [], 'ja'), 'レビューを書く');
  assert.equal(t('reviewPromptBtnWrite', [], 'en'), 'Rate on Web Store');
  assert.equal(t('reviewPromptBtnLater', [], 'ja'), 'あとで');
  assert.equal(t('reviewPromptBtnLater', [], 'en'), 'Later');
  assert.equal(t('reviewPromptBtnDismiss', [], 'ja'), '今後は表示しない');
  assert.equal(t('reviewPromptBtnDismiss', [], 'en'), "Don't show again");
});

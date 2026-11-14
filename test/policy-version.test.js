import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVACY_POLICY_VERSION, LEGACY_POLICY_VERSION, DOCS_URLS } from '../src/config/constants.js';

test('PRIVACY_POLICY_VERSION: ISO日付形式 (YYYY-MM-DD)', () => {
  assert.match(PRIVACY_POLICY_VERSION, /^\d{4}-\d{2}-\d{2}$/, 'ISO形式の日付であること');
  assert.match(LEGACY_POLICY_VERSION, /^\d{4}-\d{2}-\d{2}$/, '基準バージョンもISO形式であること');
});

test('DOCS_URLS: プライバシーポリシーおよびガイドURLの整合性', () => {
  assert.equal(DOCS_URLS.README, 'https://hoyopass.pages.dev/');
  assert.equal(DOCS_URLS.README_EN, 'https://hoyopass.pages.dev/index_en');
  assert.equal(DOCS_URLS.PRIVACY_POLICY, 'https://hoyopass.pages.dev/privacy');
  assert.equal(DOCS_URLS.PRIVACY_POLICY_EN, 'https://hoyopass.pages.dev/privacy_en');
});

test('ドリフト検知: webpages/privacy.html と PRIVACY_POLICY_VERSION の整合性', () => {
  const content = fs.readFileSync('webpages/privacy.html', 'utf8');

  // '2026-10-26' -> '2026年10月26日'
  const [year, month, day] = PRIVACY_POLICY_VERSION.split('-');
  const expectedJaDate = `${year}年${parseInt(month, 10)}月${parseInt(day, 10)}日`;

  assert.ok(
    content.includes(`最終改定: ${expectedJaDate}`),
    `privacy.html の最終改定日に "${expectedJaDate}" が含まれること`
  );
  assert.ok(
    content.includes(`${expectedJaDate} (改定)`),
    `privacy.html の改定履歴最新項目に "${expectedJaDate} (改定)" が含まれること`
  );
});

test('ドリフト検知: webpages/privacy_en.html と PRIVACY_POLICY_VERSION の整合性', () => {
  const content = fs.readFileSync('webpages/privacy_en.html', 'utf8');

  const [year, month, day] = PRIVACY_POLICY_VERSION.split('-');
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const expectedEnMonth = monthNames[parseInt(month, 10) - 1];
  const expectedEnDate = `${expectedEnMonth} ${parseInt(day, 10)}, ${year}`;

  assert.ok(
    content.includes(`Last Revised: ${expectedEnDate}`),
    `privacy_en.html の最終改定日に "${expectedEnDate}" が含まれること`
  );
  assert.ok(
    content.includes(`${expectedEnDate} (Revised)`),
    `privacy_en.html の改定履歴最新項目に "${expectedEnDate} (Revised)" が含まれること`
  );
});

test('ドリフト検知: docs/legal/privacy_policy.md と PRIVACY_POLICY_VERSION の整合性', () => {
  const content = fs.readFileSync('docs/legal/privacy_policy.md', 'utf8');
  const [year, month, day] = PRIVACY_POLICY_VERSION.split('-');
  const expectedJaDate = `${year}年${parseInt(month, 10)}月${parseInt(day, 10)}日`;

  assert.ok(
    content.includes(`最終改定: ${expectedJaDate}`),
    `privacy_policy.md の最終改定日に "${expectedJaDate}" が含まれること`
  );
  assert.ok(
    content.includes(`**${expectedJaDate} (改定)**`),
    `privacy_policy.md の改定履歴最新項目に "**${expectedJaDate} (改定)**" が含まれること`
  );
});

test('ドリフト検知: docs/legal/privacy_policy_en.md と PRIVACY_POLICY_VERSION の整合性', () => {
  const content = fs.readFileSync('docs/legal/privacy_policy_en.md', 'utf8');
  const [year, month, day] = PRIVACY_POLICY_VERSION.split('-');
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const expectedEnMonth = monthNames[parseInt(month, 10) - 1];
  const expectedEnDate = `${expectedEnMonth} ${parseInt(day, 10)}, ${year}`;

  assert.ok(
    content.includes(`Last Revised: ${expectedEnDate}`),
    `privacy_policy_en.md の最終改定日に "${expectedEnDate}" が含まれること`
  );
  assert.ok(
    content.includes(`**${expectedEnDate} (Revised)**`),
    `privacy_policy_en.md の改定履歴最新項目に "**${expectedEnDate} (Revised)**" が含まれること`
  );
});

test('Webページ相互リンク: index.html と index_en.html の整合性', () => {
  const jaContent = fs.readFileSync('webpages/index.html', 'utf8');
  const enContent = fs.readFileSync('webpages/index_en.html', 'utf8');

  assert.ok(jaContent.includes('href="index_en.html"'), 'index.html に index_en.html への切替リンクが存在すること');
  assert.ok(jaContent.includes('hreflang="en"'), 'index.html に hreflang="en" が存在すること');

  assert.ok(enContent.includes('href="index.html"'), 'index_en.html に index.html への切替リンクが存在すること');
  assert.ok(enContent.includes('hreflang="ja"'), 'index_en.html に hreflang="ja" が存在すること');
  assert.ok(enContent.includes('href="privacy_en.html"'), 'index_en.html から privacy_en.html へ遷移すること');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MESSAGES } from '../src/utils/i18n.js';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('バージョン整合: package.json / manifest.json / analytics-service.js / README.md / CHROMEWEBSTORE.md が一致すること', () => {
  const pkg = readJson('package.json');
  const manifest = readJson('manifest.json');
  const expectedVersion = pkg.version;

  assert.match(expectedVersion, /^\d+\.\d+\.\d+$/, 'package.json の version は semver 形式であること');
  assert.equal(manifest.version, expectedVersion, 'manifest.json の version が package.json と一致すること');

  const analyticsSrc = fs.readFileSync('src/services/analytics-service.js', 'utf8');
  const fallbackMatch = analyticsSrc.match(/let\s+appVersion\s*=\s*'([^']+)'/);
  assert.ok(fallbackMatch, 'analytics-service.js に appVersion フォールバック定義が存在すること');
  assert.equal(fallbackMatch[1], expectedVersion, 'analytics-service.js のフォールバック appVersion が一致すること');

  const readme = fs.readFileSync('README.md', 'utf8');
  assert.ok(
    readme.includes(`dist/hoyopass-v${expectedVersion}.zip`),
    `README.md のパッケージ出力先に dist/hoyopass-v${expectedVersion}.zip が記載されていること`
  );

  const cws = fs.readFileSync('CHROMEWEBSTORE.md', 'utf8');
  assert.ok(
    cws.includes(`バージョン ${expectedVersion} —`),
    `CHROMEWEBSTORE.md (日本語) に「バージョン ${expectedVersion} —」が含まれること`
  );
  assert.ok(
    cws.includes(`Version ${expectedVersion} —`),
    `CHROMEWEBSTORE.md (英語) に「Version ${expectedVersion} —」が含まれること`
  );

  const historySection = cws.split('## Version History')[1] || '';
  const firstHistoryRow = historySection.match(/^\|\s*(\d+\.\d+\.\d+)\s*\|/m);
  assert.ok(firstHistoryRow, 'CHROMEWEBSTORE.md の Version History に先頭バージョン行が存在すること');
  assert.equal(firstHistoryRow[1], expectedVersion, 'Version History の先頭行が最新バージョンと一致すること');
});

test('i18n 整合: MESSAGES.ja と MESSAGES.en のキー・非空文字列・プレースホルダーが完全一致すること', () => {
  const jaKeys = Object.keys(MESSAGES.ja).sort();
  const enKeys = Object.keys(MESSAGES.en).sort();

  const missingInEn = jaKeys.filter(k => !Object.hasOwn(MESSAGES.en, k));
  const missingInJa = enKeys.filter(k => !Object.hasOwn(MESSAGES.ja, k));

  assert.deepEqual(missingInEn, [], `MESSAGES.en に不足しているキー: ${missingInEn.join(', ')}`);
  assert.deepEqual(missingInJa, [], `MESSAGES.ja に不足しているキー: ${missingInJa.join(', ')}`);

  for (const key of jaKeys) {
    const jaVal = MESSAGES.ja[key];
    const enVal = MESSAGES.en[key];
    assert.equal(typeof jaVal, 'string', `MESSAGES.ja.${key} が文字列であること`);
    assert.equal(typeof enVal, 'string', `MESSAGES.en.${key} が文字列であること`);
    assert.ok(jaVal.trim().length > 0, `MESSAGES.ja.${key} が空でないこと`);
    assert.ok(enVal.trim().length > 0, `MESSAGES.en.${key} が空でないこと`);

    const jaPlaceholders = [...new Set(jaVal.match(/\{\d+\}/g) || [])].sort();
    const enPlaceholders = [...new Set(enVal.match(/\{\d+\}/g) || [])].sort();
    assert.deepEqual(
      enPlaceholders,
      jaPlaceholders,
      `i18n キー "${key}" のプレースホルダーが ja (${jaPlaceholders.join(',')}) と en (${enPlaceholders.join(',')}) で一致すること`
    );
  }
});

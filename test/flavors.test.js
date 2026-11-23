import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildFlavor } from '../scripts/build.js';
import { FLAVORS } from '../src/config/flavors.js';

test('FLAVORS: 定義整合性チェック', () => {
  assert.ok(FLAVORS.dev, 'dev フレーバーが存在すること');
  assert.ok(FLAVORS.prod, 'prod フレーバーが存在すること');

  // dev
  assert.equal(FLAVORS.dev.config.REDEEM_INTERVAL_MINUTES, 180, 'devは180分(3時間)周期');
  assert.equal(FLAVORS.dev.config.CATCH_UP_DELAY_MS, 15_000, 'devはディレイ15秒');
  assert.equal(FLAVORS.dev.config.IS_DEV, true, 'devはIS_DEV: true');
  assert.equal(FLAVORS.dev.manifest.nameSuffix, ' [DEV]');

  // prod
  assert.equal(FLAVORS.prod.config.REDEEM_INTERVAL_MINUTES, 180, 'prodは180分(3時間)周期');
  assert.equal(FLAVORS.prod.config.CATCH_UP_DELAY_MS, 15_000, 'prodはディレイ15秒');
  assert.equal(FLAVORS.prod.config.IS_DEV, false, 'prodはIS_DEV: false');
  assert.equal(FLAVORS.prod.manifest.nameSuffix, '');
});

test('buildFlavor(dev): dist/dev への出力検証', () => {
  buildFlavor('dev');

  const devDir = path.resolve('dist/dev');
  assert.ok(fs.existsSync(devDir), 'dist/dev が生成されていること');

  // manifest.json
  const manifest = JSON.parse(fs.readFileSync(path.join(devDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, '__MSG_extName__', 'i18nプレースホルダーを維持');
  assert.equal(manifest.short_name, 'HoYoPass-Dev');
  assert.equal(manifest.version_name, '1.3.3-dev');

  // _locales/ devサフィックス検証
  const jaMsgDev = JSON.parse(fs.readFileSync(path.join(devDir, '_locales/ja/messages.json'), 'utf8'));
  assert.equal(jaMsgDev.extName.message, 'HoYoPass - ログボ＆交換コード自動受取 for 原神/スタレ/ZZZ [DEV]');
  const enMsgDev = JSON.parse(fs.readFileSync(path.join(devDir, '_locales/en/messages.json'), 'utf8'));
  assert.equal(enMsgDev.extName.message, 'HoYoPass - Auto Daily Check-In & Codes for Genshin / HSR / ZZZ [DEV]');

  // env.js
  const envContent = fs.readFileSync(path.join(devDir, 'src/config/env.js'), 'utf8');
  assert.match(envContent, /CURRENT_FLAVOR = "dev"/);
  assert.match(envContent, /"REDEEM_INTERVAL_MINUTES": 180/);
  assert.match(envContent, /"CATCH_UP_DELAY_MS": 15000/);
  assert.match(envContent, /"IS_DEV": true/);

  // 静的ファイル
  assert.ok(fs.existsSync(path.join(devDir, 'icons/icon128.png')), 'icons がコピーされていること');
  assert.ok(fs.existsSync(path.join(devDir, 'assets/icons/genshin.png')), 'assets がコピーされていること');
  assert.ok(fs.existsSync(path.join(devDir, 'LICENSE')), 'LICENSE がコピーされていること');
});

test('buildFlavor(prod): dist/prod への出力検証', () => {
  buildFlavor('prod');

  const prodDir = path.resolve('dist/prod');
  assert.ok(fs.existsSync(prodDir), 'dist/prod が生成されていること');

  // manifest.json
  const manifest = JSON.parse(fs.readFileSync(path.join(prodDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, '__MSG_extName__', 'i18nプレースホルダーを維持');
  assert.equal(manifest.short_name, 'HoYoPass');
  assert.equal(manifest.version_name, undefined, 'prodはversion_nameサフィックスなし');

  // _locales/ prod検証
  const jaMsgProd = JSON.parse(fs.readFileSync(path.join(prodDir, '_locales/ja/messages.json'), 'utf8'));
  assert.equal(jaMsgProd.extName.message, 'HoYoPass - ログボ＆交換コード自動受取 for 原神/スタレ/ZZZ');
  const enMsgProd = JSON.parse(fs.readFileSync(path.join(prodDir, '_locales/en/messages.json'), 'utf8'));
  assert.equal(enMsgProd.extName.message, 'HoYoPass - Auto Daily Check-In & Codes for Genshin / HSR / ZZZ');

  // env.js
  const envContent = fs.readFileSync(path.join(prodDir, 'src/config/env.js'), 'utf8');
  assert.match(envContent, /CURRENT_FLAVOR = "prod"/);
  assert.match(envContent, /"REDEEM_INTERVAL_MINUTES": 180/);
  assert.match(envContent, /"CATCH_UP_DELAY_MS": 15000/);
  assert.match(envContent, /"IS_DEV": false/);
});

test('messages.json: name が 75 文字以内、description が 132 文字以内であること (Chrome Web Store 制限)', () => {
  const locales = ['ja', 'en'];
  for (const loc of locales) {
    const raw = fs.readFileSync(path.resolve('_locales', loc, 'messages.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const name = parsed.extName.message;
    const desc = parsed.extDescription.message;
    assert.ok(name.length <= 75, `${loc} name is too long: ${name.length} (max 75)`);
    assert.ok(desc.length <= 132, `${loc} description is too long: ${desc.length} (max 132)`);
  }
});
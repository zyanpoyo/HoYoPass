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
  assert.equal(FLAVORS.dev.config.REDEEM_INTERVAL_MINUTES, 3, 'devは3分周期');
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
  assert.equal(manifest.name, 'HoYoPass - 交換コード自動引き換えツール [DEV]');
  assert.equal(manifest.short_name, 'HoYoPass-Dev');
  assert.equal(manifest.version_name, '1.0.1-dev');

  // env.js
  const envContent = fs.readFileSync(path.join(devDir, 'src/config/env.js'), 'utf8');
  assert.match(envContent, /CURRENT_FLAVOR = "dev"/);
  assert.match(envContent, /"REDEEM_INTERVAL_MINUTES": 3/);
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
  assert.equal(manifest.name, 'HoYoPass - 交換コード自動引き換えツール');
  assert.equal(manifest.short_name, 'HoYoPass');
  assert.equal(manifest.version_name, undefined, 'prodはversion_nameサフィックスなし');

  // env.js
  const envContent = fs.readFileSync(path.join(prodDir, 'src/config/env.js'), 'utf8');
  assert.match(envContent, /CURRENT_FLAVOR = "prod"/);
  assert.match(envContent, /"REDEEM_INTERVAL_MINUTES": 180/);
  assert.match(envContent, /"CATCH_UP_DELAY_MS": 15000/);
  assert.match(envContent, /"IS_DEV": false/);
});

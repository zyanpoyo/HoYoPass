import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { buildFlavor } from './build.js';

// CRC32 計算テーブル
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS日時フォーマット変換
function toDosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: d };
}

// ゼロ依存 ZIP アーカイブ生成クラス (PKZip 仕様準拠)
class SimpleZip {
  constructor() {
    this.entries = [];
  }

  addFile(relativePath, buffer) {
    const normPath = relativePath.replace(/\\/g, '/');
    const compressed = zlib.deflateRawSync(buffer);
    const crc = crc32(buffer);
    this.entries.push({
      path: normPath,
      uncompressedSize: buffer.length,
      compressedSize: compressed.length,
      crc,
      compressedData: compressed,
      date: new Date()
    });
  }

  toBuffer() {
    const parts = [];
    let offset = 0;

    // 1. Local File Headers + Compressed Data
    for (const entry of this.entries) {
      entry.offset = offset;
      const nameBuf = Buffer.from(entry.path, 'utf8');
      const { time, date } = toDosDateTime(entry.date);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
      localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
      localHeader.writeUInt16LE(0, 6);          // General purpose bit flag
      localHeader.writeUInt16LE(8, 8);          // Compression method (8 = Deflate)
      localHeader.writeUInt16LE(time, 10);      // File last modification time
      localHeader.writeUInt16LE(date, 12);      // File last modification date
      localHeader.writeUInt32LE(entry.crc, 14); // CRC-32
      localHeader.writeUInt32LE(entry.compressedSize, 18);   // Compressed size
      localHeader.writeUInt32LE(entry.uncompressedSize, 22); // Uncompressed size
      localHeader.writeUInt16LE(nameBuf.length, 26);         // File name length
      localHeader.writeUInt16LE(0, 28);                      // Extra field length

      parts.push(localHeader, nameBuf, entry.compressedData);
      offset += localHeader.length + nameBuf.length + entry.compressedData.length;
    }

    const centralDirStart = offset;

    // 2. Central Directory Headers
    for (const entry of this.entries) {
      const nameBuf = Buffer.from(entry.path, 'utf8');
      const { time, date } = toDosDateTime(entry.date);

      const cdHeader = Buffer.alloc(46);
      cdHeader.writeUInt32LE(0x02014b50, 0); // Central directory header signature
      cdHeader.writeUInt16LE(20, 4);          // Version made by
      cdHeader.writeUInt16LE(20, 6);          // Version needed to extract
      cdHeader.writeUInt16LE(0, 8);           // General purpose bit flag
      cdHeader.writeUInt16LE(8, 10);          // Compression method
      cdHeader.writeUInt16LE(time, 12);       // Mod time
      cdHeader.writeUInt16LE(date, 14);       // Mod date
      cdHeader.writeUInt32LE(entry.crc, 16);  // CRC-32
      cdHeader.writeUInt32LE(entry.compressedSize, 20);   // Compressed size
      cdHeader.writeUInt32LE(entry.uncompressedSize, 24); // Uncompressed size
      cdHeader.writeUInt16LE(nameBuf.length, 28);         // File name length
      cdHeader.writeUInt16LE(0, 30);                      // Extra field length
      cdHeader.writeUInt16LE(0, 32);                      // File comment length
      cdHeader.writeUInt16LE(0, 34);                      // Disk number start
      cdHeader.writeUInt16LE(0, 36);                      // Internal file attributes
      cdHeader.writeUInt32LE(0, 38);                      // External file attributes
      cdHeader.writeUInt32LE(entry.offset, 42);           // Relative offset of local header

      parts.push(cdHeader, nameBuf);
      offset += cdHeader.length + nameBuf.length;
    }

    const centralDirSize = offset - centralDirStart;

    // 3. End of Central Directory Record (EOCD)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);                  // EOCD signature
    eocd.writeUInt16LE(0, 4);                           // Number of this disk
    eocd.writeUInt16LE(0, 6);                           // Disk where central directory starts
    eocd.writeUInt16LE(this.entries.length, 8);         // Total entries on this disk
    eocd.writeUInt16LE(this.entries.length, 10);        // Total entries in central directory
    eocd.writeUInt32LE(centralDirSize, 12);             // Size of central directory
    eocd.writeUInt32LE(centralDirStart, 16);            // Offset of start of central directory
    eocd.writeUInt16LE(0, 20);                          // Comment length

    parts.push(eocd);
    return Buffer.concat(parts);
  }
}

// 再帰的にディレクトリ内ファイルを収集
function collectFilesRecursively(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// メイン実行関数
async function runPackaging() {
  console.log('🚀 [HoYoPass] Chrome Web Store 配布パッケージングを開始します...');

  // 1. プリフライト検証
  console.log('🔍 [Preflight] ユニットテストを実行中 (npm test)...');
  try {
    execSync('npm test', { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ ユニットテストに失敗したため、パッケージングを中止しました。');
    process.exit(1);
  }

  console.log('🔍 [Preflight] 機密情報混入スキャンを実行中 (npm run check-secrets)...');
  try {
    execSync('npm run check-secrets', { stdio: 'inherit' });
  } catch (err) {
    console.error('❌ 機密情報チェックに失敗したため、パッケージングを中止しました。');
    process.exit(1);
  }

  // 2. prod フレーバーのビルドを実行
  console.log('🏗️ [Build] 製品版 (prod) フレーバーをビルドしています...');
  buildFlavor('prod');
  const prodDir = path.resolve('dist', 'prod');

  const manifestPath = path.join(prodDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ dist/prod/manifest.json が見つかりません。');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = manifest.version || '1.0.0';

  // 3. ホワイトリストファイルの収集 (dist/prod から収集)
  console.log('📦 [Collect] プロダクションアセットを収集しています...');
  const targetFiles = [
    'manifest.json',
    'LICENSE',
    'NOTICE'
  ];

  const targetDirs = [
    'src',
    'icons',
    'assets'
  ];

  const filesToPackage = [];

  for (const relFile of targetFiles) {
    const fullPath = path.join(prodDir, relFile);
    if (fs.existsSync(fullPath)) {
      filesToPackage.push({ fullPath, relativePath: relFile });
    } else {
      console.warn(`⚠️ 警告: ファイルが見つかりません: ${relFile}`);
    }
  }

  for (const relDir of targetDirs) {
    const fullDir = path.join(prodDir, relDir);
    if (fs.existsSync(fullDir)) {
      const files = collectFilesRecursively(fullDir);
      for (const f of files) {
        filesToPackage.push({
          fullPath: f,
          relativePath: path.relative(prodDir, f).replace(/\\/g, '/')
        });
      }
    }
  }

  // 4. 禁止ファイルの厳格な混入チェック（ダブルガード）
  const prohibitedPatterns = [
    /\.test\.js$/i,
    /^test[\/\\]/i,
    /^spike[\/\\]/i,
    /^scripts[\/\\]/i,
    /^docs[\/\\]/i,
    /^CHROMEWEBSTORE\.md$/i,
    /^README\.md$/i,
    /package(-lock)?\.json$/i,
    /^\.git/i,
    /^\.env/i,
    /Thumbs\.db$/i,
    /\.DS_Store$/i
  ];

  for (const item of filesToPackage) {
    const norm = item.relativePath;
    for (const pattern of prohibitedPatterns) {
      if (pattern.test(norm)) {
        console.error(`🚨 セキュリティエラー: 禁止ファイルがパッケージング対象に含まれています: ${item.relativePath}`);
        process.exit(1);
      }
    }
  }

  // 5. ZIPアーカイブ生成
  console.log('🗜️ [Compress] ZIPアーカイブを構築しています...');
  const zip = new SimpleZip();
  let totalRawBytes = 0;

  for (const item of filesToPackage) {
    const content = fs.readFileSync(item.fullPath);
    totalRawBytes += content.length;
    zip.addFile(item.relativePath, content);
  }

  const zipBuffer = zip.toBuffer();

  // 6. 出力先ディレクトリ (dist/) の準備と書き込み
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outZipName = `hoyopass-v${version}.zip`;
  const outZipPath = path.join(distDir, outZipName);
  fs.writeFileSync(outZipPath, zipBuffer);

  // 7. サマリー表示
  console.log('\n==================================================');
  console.log(`✅ パッケージング完了: ${outZipPath}`);
  console.log(`📊 格納ファイル数: ${filesToPackage.length} ファイル`);
  console.log(`📦 元サイズ: ${(totalRawBytes / 1024).toFixed(1)} KB`);
  console.log(`🗜️ ZIPサイズ: ${(zipBuffer.length / 1024).toFixed(1)} KB`);
  console.log('==================================================');
  console.log('\n【格納されたファイル一覧】');
  filesToPackage.forEach(item => console.log(` • ${item.relativePath}`));
  console.log('==================================================\n');
}

runPackaging().catch(err => {
  console.error('❌ パッケージング処理で例外が発生しました:', err);
  process.exit(1);
});

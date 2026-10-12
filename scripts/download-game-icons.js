import fs from 'fs';
import path from 'path';

const GAME_ICONS = [
  {
    name: 'starrail.png',
    url: 'https://play-lh.googleusercontent.com/aWrGocSA7hEuk1qAPe7L4T57LvLKrwwH26cK2_LOqxRQMQX7j3uHYojC-EKWgYEV2PdrmE0ahqvvhLhXrAGk6Q=s512'
  },
  {
    name: 'zzz.png',
    // ZZZ Google Play 最新アイコンURL（大文字小文字補正済み）
    url: 'https://play-lh.googleusercontent.com/N8j-t_IXvDvqFzN3U_19OJPIyAHHgljwVa7TMyCYpdRXRykalU3HKq9u9oPnzDXEkUOX1yyuX16yuWNDrUC_Uw=s512'
  }
];

const destDir = path.join(process.cwd(), 'assets', 'icons');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

async function downloadFile(url, destPath) {
  const signal = AbortSignal.timeout(15_000); // 15秒タイムアウト
  const resp = await fetch(url, {
    redirect: 'follow', // 301/302リダイレクト自動追従
    signal
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} (${resp.statusText})`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

async function main() {
  console.log('Downloading game icons (StarRail & ZZZ)...');
  for (const item of GAME_ICONS) {
    const dest = path.join(destDir, item.name);
    try {
      await downloadFile(item.url, dest);
      console.log(`[SUCCESS] Downloaded ${item.name}`);
    } catch (err) {
      console.error(`[ERROR] Failed to download ${item.name}: ${err.message}`);
    }
  }

  // 原神アイコンの存在確認
  const genshinPath = path.join(destDir, 'genshin.png');
  if (!fs.existsSync(genshinPath)) {
    console.log('[INFO] genshin.png not found. Run npm run process-genshin-icon to generate it.');
  }
  console.log('Game icons preparation completed.');
}

main();

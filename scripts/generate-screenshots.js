import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT_DIR = path.resolve('.');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs', 'screenshots');
const TEMP_DIR = path.join(ROOT_DIR, 'docs', 'screenshots', '.temp');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// アイコンをBase64変換して埋め込み用に取得
function getBase64Image(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const ext = path.extname(filePath).slice(1);
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:image/${ext};base64,${data}`;
}

const genshinIconBase64 = getBase64Image(path.join(ROOT_DIR, 'assets', 'icons', 'genshin.png'));
const starrailIconBase64 = getBase64Image(path.join(ROOT_DIR, 'assets', 'icons', 'starrail.png'));
const zzzIconBase64 = getBase64Image(path.join(ROOT_DIR, 'assets', 'icons', 'zzz.png'));
const extIconBase64 = getBase64Image(path.join(ROOT_DIR, 'icons', 'icon128.png'));
const popupCss = fs.readFileSync(path.join(ROOT_DIR, 'src', 'popup', 'popup.css'), 'utf8');

// ポップアップ本体の共通HTML
function renderPopupHtml({ showDialog = false } = {}) {
  return `
  <div class="mockup-popup">
    <!-- 初回オプトイン (非表示) -->
    
    <!-- 結果モーダル -->
    <div id="alert-modal" class="modal-overlay ${showDialog ? '' : 'hidden'}" style="${showDialog ? 'position: absolute; border-radius: 12px;' : ''}">
      <div class="modal-card dialog-card">
        <h2 id="alert-modal-title" style="color: #38bdf8; font-size: 15px; margin-bottom: 8px;">コード交換成功</h2>
        <p id="alert-modal-message" class="modal-desc dialog-message" style="white-space: pre-line; line-height: 1.5; font-size: 13px; color: #e2e8f0;">
【原神】3件のコードを引き換えました。
ゲーム内メールをご確認ください。
        </p>
        <button id="alert-modal-ok-btn" class="btn btn-primary btn-block" style="margin-top: 14px;">OK</button>
      </div>
    </div>

    <div class="app-container">
      <!-- ゲーム選択タブ -->
      <nav class="game-tabs" id="game-tabs">
        <button class="tab-btn active" data-game="GENSHIN">原神</button>
        <button class="tab-btn" data-game="STAR_RAIL">スタレ</button>
        <button class="tab-btn" data-game="ZZZ">ZZZ</button>
      </nav>

      <header class="app-header">
        <div class="header-title">
          <div class="icon-wrapper" id="game-icon-wrapper">
            <img id="game-icon" src="${genshinIconBase64}" alt="原神" class="game-badge-icon">
          </div>
          <h1 id="game-title">原神</h1>
        </div>
        <span id="login-status-badge" class="badge online">Online: 旅人</span>
      </header>

      <main class="main-content">
        <div class="control-card">
          <div class="toggle-row">
            <span>定期自動引き換え (4時間毎)</span>
            <label class="switch">
              <input type="checkbox" id="auto-redeem-toggle" checked>
              <span class="slider"></span>
            </label>
          </div>
          <button id="manual-trigger-btn" class="btn btn-primary btn-block">今すぐ引き換え実行</button>
        </div>

        <section class="logs-section">
          <h2>実行ログ (直近50件)</h2>
          <div id="logs-container" class="logs-list">
            <div class="log-item" style="color: #6ee7b7; font-weight: 500;">[10/12 16:42] 原神: 引き換え完了 (新規成功: 3件)</div>
            <div class="log-item">[10/12 16:41] 原神: コード GS6ACJ775KNV 引き換え成功</div>
            <div class="log-item">[10/12 16:41] 原神: コード 8T95CY23PUP9 引き換え成功</div>
            <div class="log-item">[10/12 16:40] 原神: コード GENSHINGIFT 引き換え成功</div>
            <div class="log-item" style="color: #94a3b8;">[10/12 12:40] 原神: 引き換え完了 (新規成功: 0件)</div>
            <div class="log-item" style="color: #94a3b8;">[10/12 08:40] 原神: 定期自動引き換えチェック完了</div>
          </div>
        </section>
      </main>

      <footer class="app-footer">
        <div class="footer-links">
          <span class="footer-link">使い方・README</span>
          <span class="footer-separator">•</span>
          <span class="footer-link">プライバシーポリシー</span>
        </div>
        <p class="footer-disclaimer">
          非公式ファンメイドツール（COGNOSPHERE / HoYoverseとは関係ありません）
        </p>
      </footer>
    </div>
  </div>
  `;
}

// 1. ストア用プロモーション画像 (1280x800) - メイン画面 & 3件成功ログ
function generateScreenshot1Html() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    ${popupCss}
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1280px;
      height: 800px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
      background: radial-gradient(circle at 75% 40%, #1e293b 0%, #0f172a 45%, #050811 100%);
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 90px;
      position: relative;
    }

    /* 背景装飾 */
    .bg-glow-1 {
      position: absolute;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(37, 99, 235, 0.18) 0%, rgba(37, 99, 235, 0) 70%);
      top: -100px;
      right: 150px;
      pointer-events: none;
    }
    .bg-glow-2 {
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0) 70%);
      bottom: -100px;
      right: 350px;
      pointer-events: none;
    }

    /* 左側: 紹介カラム */
    .brand-col {
      max-width: 540px;
      z-index: 2;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(37, 99, 235, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.4);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      color: #60a5fa;
      margin-bottom: 22px;
    }
    .brand-header {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-bottom: 16px;
    }
    .brand-icon {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .brand-title {
      font-size: 42px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 0%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .tagline {
      font-size: 23px;
      font-weight: 700;
      color: #38bdf8;
      line-height: 1.35;
      margin-bottom: 20px;
    }
    .description {
      font-size: 15px;
      line-height: 1.6;
      color: #94a3b8;
      margin-bottom: 32px;
    }
    .feature-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .feature-item {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 15px;
      font-weight: 500;
      color: #cbd5e1;
    }
    .feature-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(37, 99, 235, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.5);
      color: #60a5fa;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: bold;
    }

    /* 右側: ポップアップモックアップ */
    .popup-wrapper {
      position: relative;
      z-index: 2;
    }
    .mockup-popup {
      width: 360px;
      background-color: #12141a;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.75), 0 0 30px rgba(37, 99, 235, 0.2);
      position: relative;
      overflow: hidden;
    }
    .mockup-popup .app-container {
      padding: 16px;
    }
    .mockup-popup .logs-list {
      max-height: 160px;
    }
  </style>
</head>
<body>
  <div class="bg-glow-1"></div>
  <div class="bg-glow-2"></div>

  <!-- 左カラム -->
  <div class="brand-col">
    <div class="brand-badge">
      <span>Chrome 拡張機能 (Manifest V3)</span>
    </div>
    <div class="brand-header">
      <img src="${extIconBase64}" alt="HoYoPass" class="brand-icon">
      <h1 class="brand-title">HoYoPass</h1>
    </div>
    <div class="tagline">交換コードを自動検知して<br>ワンクリック一括引き換え</div>
    <p class="description">
      原神・崩壊：スターレイル・ゼンレスゾーンゼロに対応。<br>
      定期自動チェックで最新コードの交換漏れを確実に防ぎます。
    </p>

    <div class="feature-list">
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>4時間ごとの自動巡回</strong> — バックグラウンドで順次引き換え</span>
      </div>
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>直近50件の実行ログ</strong> — 交換成功件数や結果を一元把握</span>
      </div>
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>3大タイトル完全対応</strong> — タブ切り替えで手軽に管理</span>
      </div>
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>ゼロトラスト設計</strong> — Cookie収集・外部送信なしの安全仕様</span>
      </div>
    </div>
  </div>

  <!-- 右カラム: 3件成功状態のポップアップUI -->
  <div class="popup-wrapper">
    ${renderPopupHtml({ showDialog: false })}
  </div>
</body>
</html>`;
}

// 2. ストア用プロモーション画像 (1280x800) - 交換成功ダイアログ表示状態
function generateScreenshot2Html() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    ${popupCss}
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1280px;
      height: 800px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
      background: radial-gradient(circle at 75% 40%, #1e1b4b 0%, #0f172a 50%, #050811 100%);
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 90px;
      position: relative;
    }

    .bg-glow-1 {
      position: absolute;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(168, 85, 247, 0.18) 0%, rgba(168, 85, 247, 0) 70%);
      top: -100px;
      right: 150px;
      pointer-events: none;
    }
    .bg-glow-2 {
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, rgba(56, 189, 248, 0) 70%);
      bottom: -100px;
      right: 350px;
      pointer-events: none;
    }

    .brand-col {
      max-width: 540px;
      z-index: 2;
    }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(168, 85, 247, 0.15);
      border: 1px solid rgba(192, 132, 252, 0.4);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      color: #c084fc;
      margin-bottom: 22px;
    }
    .brand-header {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-bottom: 16px;
    }
    .brand-icon {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .brand-title {
      font-size: 42px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .tagline {
      font-size: 23px;
      font-weight: 700;
      color: #a855f7;
      line-height: 1.35;
      margin-bottom: 20px;
    }
    .description {
      font-size: 15px;
      line-height: 1.6;
      color: #94a3b8;
      margin-bottom: 32px;
    }
    .feature-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .feature-item {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 15px;
      font-weight: 500;
      color: #cbd5e1;
    }
    .feature-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(168, 85, 247, 0.2);
      border: 1px solid rgba(192, 132, 252, 0.5);
      color: #c084fc;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: bold;
    }

    .popup-wrapper {
      position: relative;
      z-index: 2;
    }
    .mockup-popup {
      width: 360px;
      background-color: #12141a;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.75), 0 0 30px rgba(168, 85, 247, 0.25);
      position: relative;
      overflow: hidden;
    }
    .mockup-popup .app-container {
      padding: 16px;
    }
    .mockup-popup .logs-list {
      max-height: 160px;
    }
  </style>
</head>
<body>
  <div class="bg-glow-1"></div>
  <div class="bg-glow-2"></div>

  <div class="brand-col">
    <div class="brand-badge">
      <span>交換結果ダイアログ</span>
    </div>
    <div class="brand-header">
      <img src="${extIconBase64}" alt="HoYoPass" class="brand-icon">
      <h1 class="brand-title">HoYoPass</h1>
    </div>
    <div class="tagline">交換結果をひと目で通知<br>ゲーム内メールへ即座に付与</div>
    <p class="description">
      手動実行時は引き換え完了ダイアログが即座に表示。<br>
      バックグラウンド定期実行時もデスクトップ通知でお知らせします。
    </p>

    <div class="feature-list">
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>即時フィードバック</strong> — 新規成功件数と内訳をダイアログ表示</span>
      </div>
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>重複交換ガード</strong> — 引き換え済みコードは自動スキップ</span>
      </div>
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>安全なAPIレート制限</strong> — 連続リクエストによる負荷を防止</span>
      </div>
      <div class="feature-item">
        <span class="feature-icon">✓</span>
        <span><strong>デスクトップ通知連携</strong> — セッション期限切れ時も迅速に誘導</span>
      </div>
    </div>
  </div>

  <div class="popup-wrapper">
    ${renderPopupHtml({ showDialog: true })}
  </div>
</body>
</html>`;
}

// 3. ブラウザ画面モックアップ (1280x800) - Chromeブラウザと拡張機能ドロップダウン
function generateScreenshot3Html() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    ${popupCss}

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1280px;
      height: 800px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #0b0f17;
      color: #e2e8f0;
      position: relative;
    }

    /* Chromeウィンドウヘッダー */
    .browser-frame {
      width: 1280px;
      height: 800px;
      background: #18181b;
      display: flex;
      flex-direction: column;
    }
    .window-header {
      background: #1e1e24;
      height: 42px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      border-bottom: 1px solid #27272a;
    }
    .window-controls {
      display: flex;
      gap: 8px;
      margin-right: 18px;
    }
    .win-btn {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .win-close { background: #ef4444; }
    .win-min { background: #f59e0b; }
    .win-max { background: #10b981; }

    .tab-bar {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .browser-tab {
      background: #27272a;
      padding: 6px 16px;
      border-radius: 8px 8px 0 0;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #f4f4f5;
    }
    .tab-icon {
      width: 14px;
      height: 14px;
      border-radius: 2px;
    }

    /* アドレスバー・ツールバー */
    .toolbar {
      background: #27272a;
      height: 44px;
      display: flex;
      align-items: center;
      padding: 0 14px;
      gap: 12px;
      border-bottom: 1px solid #3f3f46;
    }
    .nav-icons {
      display: flex;
      gap: 12px;
      color: #71717a;
      font-size: 15px;
    }
    .address-bar {
      flex: 1;
      background: #18181b;
      height: 30px;
      border-radius: 15px;
      display: flex;
      align-items: center;
      padding: 0 14px;
      font-size: 12px;
      color: #a1a1aa;
      gap: 8px;
    }
    .address-lock {
      color: #10b981;
      font-size: 11px;
    }
    .extension-icons {
      display: flex;
      align-items: center;
      gap: 12px;
      position: relative;
    }
    .ext-icon-btn {
      position: relative;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      border-radius: 6px;
      background: rgba(37, 99, 235, 0.25);
      border: 1px solid rgba(59, 130, 246, 0.4);
    }
    .ext-icon-img {
      width: 20px;
      height: 20px;
      border-radius: 4px;
    }

    /* Webページ領域 */
    .web-viewport {
      flex: 1;
      background: linear-gradient(135deg, #090d16 0%, #111827 50%, #1e1b4b 100%);
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .bg-watermark {
      font-size: 54px;
      font-weight: 900;
      color: rgba(255, 255, 255, 0.04);
      letter-spacing: 4px;
      text-transform: uppercase;
      user-select: none;
    }

    /* ドロップダウンポップアップの位置調整 */
    .dropdown-popup-anchor {
      position: absolute;
      top: 10px;
      right: 28px;
      z-index: 100;
    }
    .mockup-popup {
      width: 360px;
      background-color: #12141a;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.8), 0 0 25px rgba(37, 99, 235, 0.25);
      overflow: hidden;
    }
    .mockup-popup .app-container {
      padding: 16px;
    }
    .mockup-popup .logs-list {
      max-height: 160px;
    }
  </style>
</head>
<body>
  <div class="browser-frame">
    <!-- ウィンドウヘッダー -->
    <div class="window-header">
      <div class="window-controls">
        <div class="win-btn win-close"></div>
        <div class="win-btn win-min"></div>
        <div class="win-btn win-max"></div>
      </div>
      <div class="tab-bar">
        <div class="browser-tab">
          <img src="${genshinIconBase64}" class="tab-icon" alt="">
          <span>原神 コード交換公式サイト - HoYoverse</span>
        </div>
      </div>
    </div>

    <!-- ツールバー -->
    <div class="toolbar">
      <div class="nav-icons">
        <span>←</span>
        <span>→</span>
        <span>↻</span>
      </div>
      <div class="address-bar">
        <span class="address-lock">🔒</span>
        <span>https://genshin.hoyoverse.com/ja/gift</span>
      </div>
      <div class="extension-icons">
        <div class="ext-icon-btn">
          <img src="${extIconBase64}" class="ext-icon-img" alt="HoYoPass">
        </div>
      </div>
    </div>

    <!-- ページ本体＆ポップアップオーバーレイ -->
    <div class="web-viewport">
      <div class="bg-watermark">GENSHIN IMPACT GIFT REDEEM</div>

      <!-- 右上にポップアップが展開 -->
      <div class="dropdown-popup-anchor">
        ${renderPopupHtml({ showDialog: false })}
      </div>
    </div>
  </div>
</body>
</html>`;
}

// 4. ポップアップ単体 (実寸 340x495)
function generateScreenshotStandaloneHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    ${popupCss}

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 340px;
      height: 490px;
      background: #12141a;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .mockup-popup {
      width: 340px;
      background-color: #12141a;
      overflow: hidden;
    }
    .mockup-popup .app-container {
      padding: 14px;
    }
    .mockup-popup .logs-list {
      max-height: 140px;
    }
  </style>
</head>
<body>
  ${renderPopupHtml({ showDialog: false })}
</body>
</html>`;
}

// スクリーンショット撮影実行
function captureScreenshot(htmlPath, outPngPath, width, height) {
  const args = [
    '--headless=new',
    `--screenshot=${outPngPath}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--disable-gpu',
    `file:///${htmlPath.replace(/\\/g, '/')}`
  ];

  console.log(`📸 撮影中: ${path.basename(outPngPath)} (${width}x${height})...`);
  const res = spawnSync(CHROME_PATH, args, { stdio: 'pipe', encoding: 'utf8' });
  if (res.error) {
    throw res.error;
  }
  if (!fs.existsSync(outPngPath)) {
    throw new Error(`スクリーンショットファイルの生成に失敗しました: ${outPngPath}\n${res.stderr}`);
  }
  const stat = fs.statSync(outPngPath);
  console.log(`✅ 保存完了: ${path.basename(outPngPath)} (${(stat.size / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('🚀 [HoYoPass] Chrome Web Store 向け画面キャプチャの自動生成を開始します...\n');

  const tasks = [
    {
      name: 'screenshot1_main_1280x800.png',
      htmlContent: generateScreenshot1Html(),
      tempHtml: path.join(TEMP_DIR, 'screen1.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot1_main_1280x800.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'screenshot2_dialog_1280x800.png',
      htmlContent: generateScreenshot2Html(),
      tempHtml: path.join(TEMP_DIR, 'screen2.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot2_dialog_1280x800.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'screenshot3_browser_1280x800.png',
      htmlContent: generateScreenshot3Html(),
      tempHtml: path.join(TEMP_DIR, 'screen3.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot3_browser_1280x800.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'popup_3items_success.png',
      htmlContent: generateScreenshotStandaloneHtml(),
      tempHtml: path.join(TEMP_DIR, 'screen_popup.html'),
      outPng: path.join(OUTPUT_DIR, 'popup_3items_success.png'),
      width: 340,
      height: 490
    }
  ];

  for (const task of tasks) {
    fs.writeFileSync(task.tempHtml, task.htmlContent, 'utf8');
    captureScreenshot(task.tempHtml, task.outPng, task.width, task.height);
  }

  // 一時ファイルの整理
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log('\n🎉 全ての画面キャプチャが正常に生成されました！');
  console.log(`📂 保存先: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err);
  process.exit(1);
});

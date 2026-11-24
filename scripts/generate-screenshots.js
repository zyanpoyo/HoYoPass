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
// html, body スタイルを除去（スクリーンショット全体の 1280x800 body を上書き汚染させないため）
const cleanPopupCss = popupCss.replace(/html,\s*body\s*\{[^}]*\}/g, '');

// ポップアップ本体の共通HTML
function renderPopupHtml({ showDialog = false, dialog = null, lang = 'ja' } = {}) {
  const isEn = lang === 'en';

  const defaultDialog = isEn
    ? {
        title: 'Code Redemption Succeeded',
        message: '[Genshin Impact] Successfully redeemed 3 code(s)!\nPlease check your in-game mailbox.'
      }
    : {
        title: 'コード交換成功',
        message: '【原神】3件のコードを引き換えました！\nゲーム内メールをご確認ください。'
      };

  const dialogData = dialog || defaultDialog;

  const labels = isEn
    ? {
        tab1: 'Genshin',
        tab2: 'Star Rail',
        tab3: 'ZZZ',
        settingsTitle: 'Settings',
        gameTitle: 'Genshin Impact',
        statusOnline: 'Logged in: Lumine',
        uid: '800123456',
        uidCopied: 'Copied!',
        signCardTitle: 'Daily Check-In',
        btnOfficial: 'Official ↗',
        signStatusLabel: "Today's Status",
        signStatusVal: 'Claimed Today (Total: 24 days)',
        autoSignLabel: 'Auto Claim (Daily 01:05)',
        redeemCardTitle: 'Auto Code Redeemer',
        redeemStatusLabel: 'Active Codes 6/6 Claimed',
        redeemStatsBadge: 'Month: 6 / Total: 42',
        autoRedeemLabel: 'Auto Redeem (Every 3h)',
        latestSummary: 'Latest: Success (10/24 21:50)',
        log1: '[10/24 21:50] Finished redeeming (3 new succeeded)',
        log2: '[10/24 01:05] [Check-in] Claimed (Total: 24 days)',
        guide: 'User Guide',
        privacy: 'Privacy Policy',
        disclaimer: 'Unofficial Fan-made Tool<br>(Not affiliated with COGNOSPHERE / HoYoverse)'
      }
    : {
        tab1: '原神',
        tab2: 'スタレ',
        tab3: 'ZZZ',
        settingsTitle: '設定',
        gameTitle: '原神',
        statusOnline: 'ログイン中: 蛍',
        uid: '800123456',
        uidCopied: 'コピー完了!',
        signCardTitle: 'デイリーログインボーナス',
        btnOfficial: '公式 ↗',
        signStatusLabel: '本日の受取状況',
        signStatusVal: '本日受取済 (累計 24日)',
        autoSignLabel: '自動受け取り (毎日 01:05)',
        redeemCardTitle: '交換コード自動引き換え',
        redeemStatusLabel: '有効コード 6/6 適用済',
        redeemStatsBadge: '今月 6件 / 通算 42件',
        autoRedeemLabel: '定期自動引き換え (3時間毎)',
        latestSummary: '直近のログ: 正常完了 (10/24 21:50)',
        log1: '[10/24 21:50] 引き換え完了 (新規成功: 3件)',
        log2: '[10/24 01:05] [ログボ] 受取完了 (今月累計: 24日)',
        guide: '使い方ガイド',
        privacy: 'プライバシーポリシー',
        disclaimer: '非公式ファンメイドツール<br>（COGNOSPHERE / HoYoverseとは関係ありません）'
      };

  return `
  <div class="mockup-popup">
    <!-- 結果モーダル -->
    <div id="alert-modal" class="modal-overlay ${showDialog ? '' : 'hidden'}" style="${showDialog ? 'position: absolute; border-radius: 12px;' : ''}">
      <div class="modal-card dialog-card">
        <h2 id="alert-modal-title" style="color: #60a5fa; font-size: 15px; margin-bottom: 8px;">${dialogData.title}</h2>
        <p id="alert-modal-message" class="modal-desc dialog-message" style="white-space: pre-line; line-height: 1.5; font-size: 13px; color: #e2e8f0;">
${dialogData.message}
        </p>
        <button id="alert-modal-ok-btn" class="btn btn-primary btn-block" style="margin-top: 14px;">OK</button>
      </div>
    </div>

    <div class="app-container">
      <!-- ゲーム選択タブ -->
      <div class="tabs-header-row">
        <nav class="game-tabs" id="game-tabs" aria-label="Game Selection">
          <button class="tab-btn active" data-game="GENSHIN">${labels.tab1}</button>
          <button class="tab-btn" data-game="STAR_RAIL">${labels.tab2}</button>
          <button class="tab-btn" data-game="ZZZ">${labels.tab3}</button>
        </nav>
        <button id="tab-settings-btn" class="btn-icon tab-settings-btn" type="button" title="${labels.settingsTitle}" aria-label="${labels.settingsTitle}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      <header class="app-header">
        <div class="header-title">
          <div class="icon-wrapper" id="game-icon-wrapper" role="button" tabindex="0">
            <img id="game-icon" src="${genshinIconBase64}" alt="Genshin" class="game-badge-icon">
          </div>
          <h1 id="game-title">${labels.gameTitle}</h1>
        </div>
        <div class="header-user-status">
          <span id="login-status-badge" class="badge online">${labels.statusOnline}</span>
          <button id="uid-copy-chip" class="uid-chip" type="button" title="UID">
            <span class="uid-prefix">UID:</span>
            <span id="uid-value" class="uid-text">${labels.uid}</span>
            <svg class="uid-copy-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span id="uid-copied-tooltip" class="uid-tooltip">${labels.uidCopied}</span>
          </button>
        </div>
      </header>

      <main class="main-content">
        <!-- カード1: デイリーログインボーナス -->
        <section class="control-card feature-card sign-card" aria-labelledby="sign-card-heading">
          <div class="card-header">
            <h2 id="sign-card-heading" class="card-title">
              <span class="card-icon" aria-hidden="true">🎁</span>
              <span>${labels.signCardTitle}</span>
            </h2>
            <button id="open-checkin-site-btn" class="btn-site-link" type="button">${labels.btnOfficial}</button>
          </div>
          <div class="status-row">
            <span class="status-label">${labels.signStatusLabel}</span>
            <span id="sign-status-badge" class="status-pill signed">${labels.signStatusVal}</span>
          </div>
          <div class="control-row">
            <span id="auto-sign-label" class="control-label">${labels.autoSignLabel}</span>
            <div class="control-actions">
              <label class="switch">
                <input type="checkbox" id="auto-sign-toggle" checked>
                <span class="slider"></span>
              </label>
              <button id="manual-sign-btn" class="btn-icon" type="button">
                <svg class="icon-refresh" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                  <path d="M16 16h5v5"/>
                </svg>
              </button>
            </div>
          </div>
        </section>

        <!-- カード2: 交換コード自動引き換え -->
        <section class="control-card feature-card redeem-card" aria-labelledby="redeem-card-heading">
          <div class="card-header">
            <h2 id="redeem-card-heading" class="card-title">
              <span class="card-icon" aria-hidden="true">🎟️</span>
              <span>${labels.redeemCardTitle}</span>
            </h2>
            <button id="open-gift-site-btn" class="btn-site-link" type="button">${labels.btnOfficial}</button>
          </div>
          <div class="status-row">
            <span id="redeem-status-label" class="status-label">${labels.redeemStatusLabel}</span>
            <span id="redeem-status-badge" class="status-pill signed">${labels.redeemStatsBadge}</span>
          </div>
          <div class="control-row">
            <span id="auto-redeem-label" class="control-label">${labels.autoRedeemLabel}</span>
            <div class="control-actions">
              <label class="switch">
                <input type="checkbox" id="auto-redeem-toggle" checked>
                <span class="slider"></span>
              </label>
              <button id="manual-trigger-btn" class="btn-icon" type="button">
                <svg class="icon-refresh" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                  <path d="M16 16h5v5"/>
                </svg>
              </button>
            </div>
          </div>
        </section>

        <!-- 実行ログ -->
        <details id="logs-accordion" class="logs-accordion">
          <summary class="logs-summary">
            <span class="logs-chevron" aria-hidden="true">›</span>
            <span id="latest-log-summary" class="logs-summary-text">${labels.latestSummary}</span>
          </summary>
          <div id="logs-container" class="logs-list">
            <div class="log-item">${labels.log1}</div>
            <div class="log-item">${labels.log2}</div>
          </div>
        </details>
      </main>

      <footer class="app-footer">
        <div class="footer-links">
          <a href="#" class="footer-link">${labels.guide}</a>
          <span class="footer-separator">•</span>
          <a href="#" class="footer-link">${labels.privacy}</a>
        </div>
        <p class="footer-disclaimer">${labels.disclaimer}</p>
      </footer>
    </div>
  </div>
  `;
}

// 共通CSSスタイル
const baseScreenshotStyles = `
  ${cleanPopupCss}

  .mockup-popup {
    width: 340px;
    height: 480px;
    background-color: #11151f;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    border: 1px solid #283147;
    border-radius: 12px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08);
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }
`;

// スクリーンショット1: メイン画面
function generateScreenshot1Html(lang = 'ja') {
  const isEn = lang === 'en';
  const badgeText = isEn ? 'Genshin Impact / Honkai: Star Rail / ZZZ' : '原神・崩壊：スターレイル・ゼンレスゾーンゼロ';
  const headingHtml = isEn
    ? 'Auto Daily Check-In &<br>Gift Code Redeemer.'
    : '毎日のログボも交換コードも、<br>バックグラウンドで自動受け取り。';
  const leadText = isEn
    ? 'Automate HoYoLAB daily check-in bonuses and latest gift code redemptions in the background to reduce daily hassle and missed rewards.'
    : '原神・崩壊：スターレイル・ゼンレスゾーンゼロのデイリーログインボーナス受取と最新ギフト交換コードの引き換えをバックグラウンドで自動化し、報酬の受け取り忘れを防ぎます。';

  const feats = isEn
    ? [
        { icon: '🎁', title: 'Daily Check-In Auto Claim', desc: 'Claims check-in rewards across enabled games daily around 00:05 UTC+8.' },
        { icon: '🎟️', title: 'Automatic Code Redemption', desc: 'Checks public codes every 3 hours and redeems unclaimed ones.' },
        { icon: '🛡️', title: 'Privacy-First Zero-Trust Design', desc: 'No passwords or cookies collected. Uses local browser session only.' }
      ]
    : [
        { icon: '🎁', title: 'デイリーログインボーナス自動受取', desc: '毎日 01:05 JST頃に有効タイトルのログボを自動巡回して取得' },
        { icon: '🎟️', title: '交換コード3時間毎自動引き換え', desc: '3時間毎に公開コードを確認し、未使用コード検知時に引き換え' },
        { icon: '🛡️', title: '認証情報を外部に出さない設計', desc: 'パスワードやCookie送信なし。ブラウザ内セッションのみ利用' }
      ];

  const popupHtml = renderPopupHtml({ showDialog: false, lang });

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      width: 1280px !important;
      height: 800px !important;
      overflow: hidden !important;
    }
    body {
      width: 1280px !important;
      height: 800px !important;
      overflow: hidden !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: radial-gradient(circle at 75% 40%, #1e293b 0%, #0f172a 45%, #050811 100%) !important;
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
    .brand-col { max-width: 540px; z-index: 2; }
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
    .brand-header { display: flex; align-items: center; gap: 18px; margin-bottom: 16px; }
    .brand-icon { width: 64px; height: 64px; border-radius: 14px; box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4); }
    .brand-title { font-size: 38px; font-weight: 800; letter-spacing: -0.5px; }
    .brand-headline { font-size: 32px; font-weight: 750; line-height: 1.3; margin-bottom: 18px; color: #ffffff; }
    .brand-lead { font-size: 15px; line-height: 1.6; color: #94a3b8; margin-bottom: 32px; }
    .feature-list { display: flex; flex-direction: column; gap: 14px; }
    .feat-item { display: flex; align-items: flex-start; gap: 14px; }
    .feat-icon-box {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .feat-title { font-size: 14px; font-weight: 700; color: #f1f5f9; margin-bottom: 2px; }
    .feat-desc { font-size: 12.5px; color: #94a3b8; line-height: 1.4; }
    .popup-wrapper { z-index: 2; transform: scale(1.18); transform-origin: center right; }
    ${baseScreenshotStyles}
  </style>
</head>
<body>
  <div class="bg-glow-1"></div>
  <div class="bg-glow-2"></div>
  <div class="brand-col">
    <div class="brand-badge">${badgeText}</div>
    <div class="brand-header">
      <img src="${extIconBase64}" alt="HoYoPass" class="brand-icon">
      <h1 class="brand-title">HoYoPass</h1>
    </div>
    <h2 class="brand-headline">${headingHtml}</h2>
    <p class="brand-lead">${leadText}</p>
    <div class="feature-list">
      ${feats.map(f => `
      <div class="feat-item">
        <div class="feat-icon-box">${f.icon}</div>
        <div>
          <div class="feat-title">${f.title}</div>
          <div class="feat-desc">${f.desc}</div>
        </div>
      </div>
      `).join('')}
    </div>
  </div>
  <div class="popup-wrapper">
    ${popupHtml}
  </div>
</body>
</html>
  `;
}

// スクリーンショット2: 手動実行・ダイアログ
function generateScreenshot2Html(lang = 'ja') {
  const isEn = lang === 'en';
  const badgeText = isEn ? 'Instant Manual Run' : '手動ワンクリック実行対応';
  const headingHtml = isEn
    ? 'One-Click Execution<br>& Clear Status Dialog.'
    : 'ワンクリックで即座に実行。<br>完了ダイアログで安心確認。';
  const leadText = isEn
    ? 'Trigger check-in or code redemption right after special program livestreams. Instant modal displays redeem outcomes with breakdown.'
    : '生放送直後の新着コードや、今すぐボーナスを受け取りたい時にも便利。ポップアップ内の実行ボタンを押すだけで、現在選択中のゲームを即座に引き換えます。';

  const feats = isEn
    ? [
        { icon: '⚡', title: 'Targeted Game Execution', desc: 'Runs only the currently selected title without waiting for timers.' },
        { icon: '📬', title: 'Delivery Outcome Display', desc: 'Displays exact count of redeemed codes and in-game mailbox notice.' },
        { icon: '🔄', title: 'Seamless Duplicate Handling', desc: 'Codes already used in-game are safely recorded to avoid duplicate runs.' }
      ]
    : [
        { icon: '⚡', title: '選択中ゲームのみを即時実行', desc: 'タブで開いているタイトルだけを無駄なくピンポイントで手動処理' },
        { icon: '📬', title: '詳細な受取結果メッセージ', desc: '何件のコードが交換されゲーム内メールへ届いたかをダイアログで表示' },
        { icon: '🔄', title: '事前引き換え済みコードの自動判別', desc: 'ゲーム内で交換済みのコードも重複エラーなく正しく適用済として記録' }
      ];

  const dialogData = isEn
    ? {
        title: 'Code Redemption Succeeded',
        message: '[Genshin Impact] Successfully redeemed 3 code(s)!\nPlease check your in-game mailbox.'
      }
    : {
        title: 'コード交換成功',
        message: '【原神】3件のコードを引き換えました！\nゲーム内メールをご確認ください。'
      };

  const popupHtml = renderPopupHtml({ showDialog: true, dialog: dialogData, lang });

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      width: 1280px !important;
      height: 800px !important;
      overflow: hidden !important;
    }
    body {
      width: 1280px !important;
      height: 800px !important;
      overflow: hidden !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: radial-gradient(circle at 75% 40%, #1e1b4b 0%, #0f172a 45%, #050811 100%) !important;
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
      background: radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, rgba(99, 102, 241, 0) 70%);
      top: -100px;
      right: 150px;
      pointer-events: none;
    }
    .brand-col { max-width: 540px; z-index: 2; }
    .brand-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(129, 140, 248, 0.4);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      color: #818cf8;
      margin-bottom: 22px;
    }
    .brand-headline { font-size: 32px; font-weight: 750; line-height: 1.3; margin-bottom: 18px; color: #ffffff; }
    .brand-lead { font-size: 15px; line-height: 1.6; color: #94a3b8; margin-bottom: 32px; }
    .feature-list { display: flex; flex-direction: column; gap: 14px; }
    .feat-item { display: flex; align-items: flex-start; gap: 14px; }
    .feat-icon-box {
      width: 36px;
      height: 36px;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .feat-title { font-size: 14px; font-weight: 700; color: #f1f5f9; margin-bottom: 2px; }
    .feat-desc { font-size: 12.5px; color: #94a3b8; line-height: 1.4; }
    .popup-wrapper { z-index: 2; transform: scale(1.18); transform-origin: center right; }
    ${baseScreenshotStyles}
  </style>
</head>
<body>
  <div class="bg-glow-1"></div>
  <div class="brand-col">
    <div class="brand-badge">${badgeText}</div>
    <h2 class="brand-headline">${headingHtml}</h2>
    <p class="brand-lead">${leadText}</p>
    <div class="feature-list">
      ${feats.map(f => `
      <div class="feat-item">
        <div class="feat-icon-box">${f.icon}</div>
        <div>
          <div class="feat-title">${f.title}</div>
          <div class="feat-desc">${f.desc}</div>
        </div>
      </div>
      `).join('')}
    </div>
  </div>
  <div class="popup-wrapper">
    ${popupHtml}
  </div>
</body>
</html>
  `;
}

// スクリーンショット3: ブラウザ操作イメージ
function generateScreenshot3Html(lang = 'ja') {
  const isEn = lang === 'en';
  const title = isEn
    ? 'Seamlessly Integrated with Chrome.<br>Set it and forget it.'
    : 'ブラウザに常駐して自動サポート。<br>設定後は放っておくだけ。';
  const desc = isEn
    ? 'HoYoPass runs quietly in the background without opening tabs. Automatic catch-up claims rewards even when your PC wakes up from sleep.'
    : '拡張機能アイコンをクリックするだけでいつでも受取実績や稼働状況を確認可能。PCのスリープ復帰時や起動時も自動キャッチアップで受取忘れを防ぎます。';

  const popupHtml = renderPopupHtml({ showDialog: false, lang });

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html {
      width: 1280px !important;
      height: 800px !important;
      overflow: hidden !important;
    }
    body {
      width: 1280px !important;
      height: 800px !important;
      overflow: hidden !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: #090d16 !important;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 36px;
      position: relative;
    }
    .header-text-block { text-align: center; margin-bottom: 30px; z-index: 2; }
    .header-title { font-size: 28px; font-weight: 800; color: #ffffff; margin-bottom: 8px; }
    .header-desc { font-size: 14.5px; color: #94a3b8; }
    .browser-frame {
      width: 1120px;
      height: 640px;
      background-color: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 30px 60px rgba(0, 0, 0, 0.8);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }
    .browser-titlebar {
      height: 42px;
      background: #0d1117;
      border-bottom: 1px solid #21262d;
      display: flex;
      align-items: center;
      padding: 0 16px;
      gap: 14px;
    }
    .window-dots { display: flex; gap: 8px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot-red { background: #ff5f56; }
    .dot-yellow { background: #ffbd2e; }
    .dot-green { background: #27c93f; }
    .url-bar {
      flex: 1;
      height: 28px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 12px;
      color: #8b949e;
      gap: 8px;
    }
    .browser-toolbar-icons { display: flex; align-items: center; gap: 12px; }
    .browser-ext-icon { width: 20px; height: 20px; border-radius: 4px; box-shadow: 0 0 8px rgba(59, 130, 246, 0.5); }
    .browser-page-body {
      flex: 1;
      background: radial-gradient(circle at 50% 30%, #1a2234 0%, #0d1117 70%);
      position: relative;
      display: flex;
      justify-content: flex-end;
      padding-right: 50px;
      padding-top: 10px;
    }
    .pinned-popup { transform: scale(1.05); transform-origin: top right; z-index: 10; }
    ${baseScreenshotStyles}
  </style>
</head>
<body>
  <div class="header-text-block">
    <h2 class="header-title">${title}</h2>
    <p class="header-desc">${desc}</p>
  </div>
  <div class="browser-frame">
    <div class="browser-titlebar">
      <div class="window-dots">
        <div class="dot dot-red"></div>
        <div class="dot dot-yellow"></div>
        <div class="dot dot-green"></div>
      </div>
      <div class="url-bar">
        <span>🔒</span>
        <span>https://hoyolab.com/</span>
      </div>
      <div class="browser-toolbar-icons">
        <img src="${extIconBase64}" alt="HoYoPass" class="browser-ext-icon">
      </div>
    </div>
    <div class="browser-page-body">
      <div class="pinned-popup">
        ${popupHtml}
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

// ポップアップ単体プレビュー
function generateScreenshotStandaloneHtml(lang = 'ja') {
  const popupHtml = renderPopupHtml({ showDialog: false, lang });

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 340px;
      height: 480px;
      overflow: hidden;
      background: #0d1117;
    }
    ${baseScreenshotStyles}
    .mockup-popup {
      border: none;
      box-shadow: none;
      border-radius: 0;
    }
  </style>
</head>
<body>
  ${popupHtml}
</body>
</html>
  `;
}

// Chrome Headless によるキャプチャ実行
function captureScreenshot(htmlPath, outPngPath, width, height) {
  const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
  console.log(`📸 撮影中: ${path.basename(outPngPath)} (${width}x${height})...`);

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-sandbox',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${outPngPath}`,
    fileUrl
  ];

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
    // 日本語版 (JA)
    {
      name: 'screenshot1_main_1280x800.png',
      htmlContent: generateScreenshot1Html('ja'),
      tempHtml: path.join(TEMP_DIR, 'screen1_ja.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot1_main_1280x800.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'screenshot2_dialog_1280x800.png',
      htmlContent: generateScreenshot2Html('ja'),
      tempHtml: path.join(TEMP_DIR, 'screen2_ja.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot2_dialog_1280x800.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'screenshot3_browser_1280x800.png',
      htmlContent: generateScreenshot3Html('ja'),
      tempHtml: path.join(TEMP_DIR, 'screen3_ja.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot3_browser_1280x800.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'popup_3items_success.png',
      htmlContent: generateScreenshotStandaloneHtml('ja'),
      tempHtml: path.join(TEMP_DIR, 'screen_popup_ja.html'),
      outPng: path.join(OUTPUT_DIR, 'popup_3items_success.png'),
      width: 340,
      height: 480
    },

    // 英語版 (EN)
    {
      name: 'screenshot1_main_1280x800_en.png',
      htmlContent: generateScreenshot1Html('en'),
      tempHtml: path.join(TEMP_DIR, 'screen1_en.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot1_main_1280x800_en.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'screenshot2_dialog_1280x800_en.png',
      htmlContent: generateScreenshot2Html('en'),
      tempHtml: path.join(TEMP_DIR, 'screen2_en.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot2_dialog_1280x800_en.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'screenshot3_browser_1280x800_en.png',
      htmlContent: generateScreenshot3Html('en'),
      tempHtml: path.join(TEMP_DIR, 'screen3_en.html'),
      outPng: path.join(OUTPUT_DIR, 'screenshot3_browser_1280x800_en.png'),
      width: 1280,
      height: 800
    },
    {
      name: 'popup_3items_success_en.png',
      htmlContent: generateScreenshotStandaloneHtml('en'),
      tempHtml: path.join(TEMP_DIR, 'screen_popup_en.html'),
      outPng: path.join(OUTPUT_DIR, 'popup_3items_success_en.png'),
      width: 340,
      height: 480
    }
  ];

  for (const task of tasks) {
    fs.writeFileSync(task.tempHtml, task.htmlContent, 'utf8');
    captureScreenshot(task.tempHtml, task.outPng, task.width, task.height);
  }

  // 一時ファイルの整理
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log('\n🎉 全ての画面キャプチャ（日・英 計8枚）が正常に生成されました！');
  console.log(`📂 保存先: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err);
  process.exit(1);
});

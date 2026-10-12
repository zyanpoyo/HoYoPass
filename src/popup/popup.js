import { GAMES, DOCS_URLS } from '../config/constants.js';
import { getSettings, updateSettings } from '../services/storage-service.js';
import { getUserGameRoles } from '../services/hoyo-api.js';
import { formatRedeemResult } from '../utils/message-formatter.js';

let currentGameKey = 'GENSHIN';

document.addEventListener('DOMContentLoaded', async () => {
  const optInModal = document.getElementById('optin-modal');
  const optInAcceptBtn = document.getElementById('optin-accept-btn');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');
  const manualTriggerBtn = document.getElementById('manual-trigger-btn');
  const gameTabs = document.getElementById('game-tabs');

  // 設定読み込み
  const settings = await getSettings();
  currentGameKey = settings.activeGameKey || 'GENSHIN';

  if (!settings.optInAccepted) {
    optInModal.classList.remove('hidden');
  } else {
    autoRedeemToggle.checked = !!settings.autoRedeemEnabled;
  }

  // タブイベント登録
  gameTabs.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const g = btn.dataset.game;
      if (!g || g === currentGameKey) return;
      currentGameKey = g;
      gameTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      await updateSettings({ activeGameKey: currentGameKey });
      updateGameView();
    });
  });

  // 同意ボタン
  optInAcceptBtn.addEventListener('click', async () => {
    await updateSettings({ optInAccepted: true, autoRedeemEnabled: true });
    optInModal.classList.add('hidden');
    autoRedeemToggle.checked = true;
    updateGameView();
  });

  // 自動トグル
  autoRedeemToggle.addEventListener('change', async (e) => {
    await updateSettings({ autoRedeemEnabled: e.target.checked });
  });

  // 手動トリガー
  manualTriggerBtn.addEventListener('click', async () => {
    manualTriggerBtn.disabled = true;
    manualTriggerBtn.textContent = '引き換え実行中...';
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'TRIGGER_MANUAL_REDEEM' });
      const { title, message, detail } = formatRedeemResult(resp);
      await showAlertModal(title, message, detail);
    } catch (err) {
      await showAlertModal('コード交換失敗', '通信または処理中にエラーが発生しました。時間をおいて再度お試しください。', err?.message);
    } finally {
      manualTriggerBtn.disabled = false;
      manualTriggerBtn.textContent = '今すぐ引き換え実行';
      await renderLogs();
    }
  });

  // ゲームアイコンクリックでコード交換サイトへ遷移
  const gameIconWrapper = document.getElementById('game-icon-wrapper');
  if (gameIconWrapper) {
    const openCurrentGameGiftSite = () => {
      const config = GAMES[currentGameKey];
      if (config?.giftSiteUrl) {
        chrome.tabs.create({ url: config.giftSiteUrl });
      }
    };

    gameIconWrapper.addEventListener('click', openCurrentGameGiftSite);
    gameIconWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCurrentGameGiftSite();
      }
    });
  }

  // 外部リンク（README・プライバシーポリシー）の安全なタブオープン設定
  const openExternalTab = (url) => {
    if (url && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const bindExternalLink = (elementId, url) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openExternalTab(url);
    });
  };

  bindExternalLink('footer-link-readme', DOCS_URLS.README);
  bindExternalLink('footer-link-privacy', DOCS_URLS.PRIVACY_POLICY);
  bindExternalLink('optin-privacy-link', DOCS_URLS.PRIVACY_POLICY);


  // 初期描画
  updateActiveTabButton();
  updateGameView();
  renderLogs();
});

function updateActiveTabButton() {
  const tabs = document.querySelectorAll('#game-tabs .tab-btn');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.game === currentGameKey));
}

async function updateGameView() {
  const config = GAMES[currentGameKey];
  const titleEl = document.getElementById('game-title');
  const iconEl = document.getElementById('game-icon');
  const fallbackEl = document.getElementById('icon-fallback');
  const badgeEl = document.getElementById('login-status-badge');

  titleEl.textContent = config.name;
  fallbackEl.textContent = config.shortName;

  const wrapperEl = document.getElementById('game-icon-wrapper');
  if (wrapperEl) {
    const label = `${config.name}のコード交換サイトを開く`;
    wrapperEl.title = label;
    wrapperEl.setAttribute('aria-label', label);
  }

  // 画像フォールバック制御
  iconEl.style.display = 'block';
  fallbackEl.style.display = 'none';
  iconEl.src = config.iconPath;

  badgeEl.textContent = '確認中...';
  badgeEl.className = 'badge';

  try {
    const res = await getUserGameRoles(config.gameBiz);
    if (res.success && res.role) {
      badgeEl.textContent = `Online: ${res.role.nickname}`;
      badgeEl.classList.add('online');
    } else {
      badgeEl.textContent = res.retcode === -100 ? '未ログイン' : `未ログイン (${res.retcode ?? 'エラー'})`;
      badgeEl.classList.add('offline');
    }
  } catch (err) {
    badgeEl.textContent = 'オフライン';
    badgeEl.classList.add('offline');
  }
}

async function renderLogs() {
  const container = document.getElementById('logs-container');
  const data = await chrome.storage.local.get('exec_logs');
  const logs = data.exec_logs || [];

  container.innerHTML = '';
  if (!logs.length) {
    const empty = document.createElement('div');
    empty.textContent = 'ログはありません。';
    empty.style.color = '#64748b';
    container.appendChild(empty);
    return;
  }

  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = 'log-item';
    const time = new Date(log.timestamp).toLocaleTimeString();
    item.textContent = `[${time}] ${log.message || log.type}`;
    container.appendChild(item);
  });
}

function showAlertModal(title, message, detail = null) {
  const modal = document.getElementById('alert-modal');
  const titleEl = document.getElementById('alert-modal-title');
  const msgEl = document.getElementById('alert-modal-message');
  const detailsEl = document.getElementById('alert-modal-details');
  const detailTextEl = document.getElementById('alert-modal-detail-text');
  const okBtn = document.getElementById('alert-modal-ok-btn');

  titleEl.textContent = title;
  msgEl.textContent = message;

  if (detail) {
    detailTextEl.textContent = detail;
    detailsEl.open = false; // デフォルトは折りたたみ
    detailsEl.classList.remove('hidden');
  } else {
    detailsEl.classList.add('hidden');
    detailTextEl.textContent = '';
  }

  modal.classList.remove('hidden');
  okBtn.focus();

  return new Promise((resolve) => {
    const handleClose = () => {
      okBtn.removeEventListener('click', handleClose);
      document.removeEventListener('keydown', handleKeyDown);
      modal.classList.add('hidden');
      resolve();
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        handleClose();
      }
    };

    okBtn.addEventListener('click', handleClose);
    document.addEventListener('keydown', handleKeyDown);
  });
}


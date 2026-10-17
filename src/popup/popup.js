import { GAMES, DOCS_URLS, API_CONFIG } from '../config/constants.js';
import {
  getSettings,
  updateSettings,
  getDailySignRecord,
  setDailySignRecord,
  getHoyoTodayDateString
} from '../services/storage-service.js';
import { getUserGameRoles, getDailySignInfo } from '../services/hoyo-api.js';
import { formatRedeemResult, formatSignResult, formatLogTimestamp } from '../utils/message-formatter.js';

let currentGameKey = 'GENSHIN';
let currentLogFilter = 'ALL';

document.addEventListener('DOMContentLoaded', async () => {
  const optInModal = document.getElementById('optin-modal');
  const optInAcceptBtn = document.getElementById('optin-accept-btn');
  const autoSignToggle = document.getElementById('auto-sign-toggle');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');
  const manualSignBtn = document.getElementById('manual-sign-btn');
  const manualTriggerBtn = document.getElementById('manual-trigger-btn');
  const openCheckinSiteBtn = document.getElementById('open-checkin-site-btn');
  const openGiftSiteBtn = document.getElementById('open-gift-site-btn');
  const gameTabs = document.getElementById('game-tabs');
  const logFilters = document.getElementById('log-filters');
  const flavorBadge = document.getElementById('flavor-badge');
  const autoSignLabel = document.getElementById('auto-sign-label');
  const autoRedeemLabel = document.getElementById('auto-redeem-label');

  // フレーバーUIの反映
  if (API_CONFIG.FLAVOR_UI) {
    if (autoRedeemLabel && API_CONFIG.FLAVOR_UI.intervalLabel) {
      autoRedeemLabel.textContent = API_CONFIG.FLAVOR_UI.intervalLabel;
    }
    if (autoSignLabel && API_CONFIG.FLAVOR_UI.signIntervalLabel) {
      autoSignLabel.textContent = API_CONFIG.FLAVOR_UI.signIntervalLabel;
    }
    if (flavorBadge && API_CONFIG.FLAVOR_UI.badgeText) {
      flavorBadge.textContent = API_CONFIG.FLAVOR_UI.badgeText;
      flavorBadge.style.display = 'inline-block';
    }
  }

  // 設定読み込み
  const settings = await getSettings();
  currentGameKey = settings.activeGameKey || 'GENSHIN';

  if (!settings.optInAccepted) {
    optInModal.classList.remove('hidden');
  } else {
    if (autoSignToggle) autoSignToggle.checked = !!settings.autoSignEnabled;
    if (autoRedeemToggle) autoRedeemToggle.checked = !!settings.autoRedeemEnabled;
  }

  // ゲーム選択タブイベント登録
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

  // ログフィルタボタンイベント登録
  if (logFilters) {
    logFilters.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter || 'ALL';
        if (filter === currentLogFilter) return;
        currentLogFilter = filter;
        logFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderLogs();
      });
    });
  }

  // 初回同意ボタン
  optInAcceptBtn.addEventListener('click', async () => {
    await updateSettings({
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true
    });
    optInModal.classList.add('hidden');
    if (autoSignToggle) autoSignToggle.checked = true;
    if (autoRedeemToggle) autoRedeemToggle.checked = true;
    updateGameView();
  });

  // 自動ログインボーナス受取トグル（個別制御）
  if (autoSignToggle) {
    autoSignToggle.addEventListener('change', async (e) => {
      await updateSettings({ autoSignEnabled: e.target.checked });
    });
  }

  // 自動コード引き換えトグル（個別制御）
  if (autoRedeemToggle) {
    autoRedeemToggle.addEventListener('change', async (e) => {
      await updateSettings({ autoRedeemEnabled: e.target.checked });
    });
  }

  // 手動ログインボーナス受取トリガー
  if (manualSignBtn) {
    manualSignBtn.addEventListener('click', async () => {
      manualSignBtn.disabled = true;
      manualSignBtn.textContent = '受取処理中...';
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'TRIGGER_MANUAL_SIGN',
          gameKey: currentGameKey
        });
        const { title, message, detail } = formatSignResult(resp);
        await showAlertModal(title, message, detail);
      } catch (err) {
        await showAlertModal('ログインボーナス受取失敗', '通信または処理中にエラーが発生しました。時間をおいて再度お試しください。', err?.message);
      } finally {
        manualSignBtn.disabled = false;
        manualSignBtn.textContent = '今すぐボーナス受取';
        await updateDailySignStatusView(currentGameKey);
        await renderLogs();
      }
    });
  }

  // 手動コード引き換えトリガー
  manualTriggerBtn.addEventListener('click', async () => {
    manualTriggerBtn.disabled = true;
    manualTriggerBtn.textContent = '引き換え実行中...';
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'TRIGGER_MANUAL_REDEEM',
        gameKey: currentGameKey
      });
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

  // 外部サイトオープン用ヘルパー
  const openExternalTab = (url) => {
    if (url && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url });
    } else if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // 公式ログインボーナスページを開くボタン
  if (openCheckinSiteBtn) {
    openCheckinSiteBtn.addEventListener('click', () => {
      const config = GAMES[currentGameKey];
      if (config?.checkInSiteUrl) {
        openExternalTab(config.checkInSiteUrl);
      }
    });
  }

  // 公式コード交換サイトを開くボタン & ゲームアイコンクリック
  const openCurrentGameGiftSite = () => {
    const config = GAMES[currentGameKey];
    if (config?.giftSiteUrl) {
      openExternalTab(config.giftSiteUrl);
    }
  };

  if (openGiftSiteBtn) {
    openGiftSiteBtn.addEventListener('click', openCurrentGameGiftSite);
  }

  const gameIconWrapper = document.getElementById('game-icon-wrapper');
  if (gameIconWrapper) {
    gameIconWrapper.addEventListener('click', openCurrentGameGiftSite);
    gameIconWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCurrentGameGiftSite();
      }
    });
  }

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
  const targetKey = currentGameKey;
  const config = GAMES[targetKey];
  const titleEl = document.getElementById('game-title');
  const iconEl = document.getElementById('game-icon');
  const fallbackEl = document.getElementById('icon-fallback');
  const badgeEl = document.getElementById('login-status-badge');
  const checkinSiteBtn = document.getElementById('open-checkin-site-btn');
  const giftSiteBtn = document.getElementById('open-gift-site-btn');

  titleEl.textContent = config.name;
  fallbackEl.textContent = config.shortName;

  const wrapperEl = document.getElementById('game-icon-wrapper');
  if (wrapperEl) {
    const label = `${config.name}のコード交換サイトを開く`;
    wrapperEl.title = label;
    wrapperEl.setAttribute('aria-label', label);
  }
  if (checkinSiteBtn) {
    checkinSiteBtn.title = `${config.name}の公式ログインボーナスページを開く`;
  }
  if (giftSiteBtn) {
    giftSiteBtn.title = `${config.name}の公式コード交換サイトを開く`;
  }

  // 画像フォールバック制御
  iconEl.style.display = 'block';
  fallbackEl.style.display = 'none';
  iconEl.src = config.iconPath;

  badgeEl.textContent = '確認中...';
  badgeEl.className = 'badge';

  // ログインボーナス状態表示も並行更新
  updateDailySignStatusView(targetKey);

  try {
    const res = await getUserGameRoles(config.gameBiz);
    if (currentGameKey !== targetKey) return;
    if (res.success && res.role) {
      badgeEl.textContent = `Online: ${res.role.nickname}`;
      badgeEl.classList.add('online');
    } else if (res.retcode === -1 || res.retcode === -2) {
      badgeEl.textContent = 'キャラ不在';
      badgeEl.classList.add('offline');
    } else {
      badgeEl.textContent = res.retcode === -100 ? '未ログイン' : `未ログイン (${res.retcode ?? 'エラー'})`;
      badgeEl.classList.add('offline');
    }
  } catch {
    if (currentGameKey !== targetKey) return;
    badgeEl.textContent = 'オフライン';
    badgeEl.classList.add('offline');
  }
}

async function updateDailySignStatusView(gameKey) {
  const signBadgeEl = document.getElementById('sign-status-badge');
  if (!signBadgeEl) return;

  const config = GAMES[gameKey];
  if (!config) return;

  signBadgeEl.textContent = '確認中...';
  signBadgeEl.className = 'status-pill';

  const today = getHoyoTodayDateString();
  const cached = await getDailySignRecord(config.gameBiz);
  if (currentGameKey !== gameKey) return;

  if (cached && cached.date === today && cached.isSigned) {
    const daysText = cached.totalSignDay ? ` (累計 ${cached.totalSignDay}日)` : '';
    signBadgeEl.textContent = `受取済 ✅${daysText}`;
    signBadgeEl.className = 'status-pill signed';
  }

  try {
    const info = await getDailySignInfo(config);
    if (currentGameKey !== gameKey) return;

    if (info.success) {
      await setDailySignRecord(config.gameBiz, {
        date: info.today || today,
        isSigned: info.isSigned,
        totalSignDay: info.totalSignDay,
        skippedNoChar: false
      });
      const daysText = info.totalSignDay ? ` (累計 ${info.totalSignDay}日)` : '';
      if (info.isSigned) {
        signBadgeEl.textContent = `受取済 ✅${daysText}`;
        signBadgeEl.className = 'status-pill signed';
      } else {
        signBadgeEl.textContent = `未受取${daysText}`;
        signBadgeEl.className = 'status-pill unsigned';
      }
    } else if (!cached || cached.date !== today || !cached.isSigned) {
      signBadgeEl.textContent = info.retcode === -100 ? '未ログイン' : '未確認';
      signBadgeEl.className = 'status-pill skipped';
    }
  } catch {
    if (currentGameKey !== gameKey) return;
    if (!cached || cached.date !== today || !cached.isSigned) {
      signBadgeEl.textContent = 'オフライン';
      signBadgeEl.className = 'status-pill skipped';
    }
  }
}

function getLogCategory(log) {
  if (log.category === 'SIGN' || log.category === 'CODE') {
    return log.category;
  }
  const msg = log.message || '';
  if (msg.includes('[ログボ]') || msg.includes('ログインボーナス')) {
    return 'SIGN';
  }
  return 'CODE';
}

async function renderLogs() {
  const container = document.getElementById('logs-container');
  const data = await chrome.storage.local.get('exec_logs');
  const allLogs = data.exec_logs || [];

  const logs = currentLogFilter === 'ALL'
    ? allLogs
    : allLogs.filter(log => getLogCategory(log) === currentLogFilter);

  container.innerHTML = '';
  if (!logs.length) {
    const empty = document.createElement('div');
    empty.textContent = '該当するログはありません。';
    empty.style.color = '#64748b';
    container.appendChild(empty);
    return;
  }

  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = 'log-item';
    const time = formatLogTimestamp(log.timestamp);
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
    detailsEl.open = false;
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



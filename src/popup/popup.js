import { GAMES, DOCS_URLS, API_CONFIG, ALARM_NAMES } from '../config/constants.js';
import {
  getSettings,
  updateSettings,
  getDailySignRecord,
  setDailySignRecord,
  getHoyoTodayDateString,
  getCodeRedeemStats,
  setActiveCodes
} from '../services/storage-service.js';
import { fetchValidCodes } from '../services/code-fetcher.js';
import { getUserGameRoles, getDailySignInfo } from '../services/hoyo-api.js';
import { formatRedeemResult, formatSignResult, formatLogTimestamp } from '../utils/message-formatter.js';
import { resolveLanguage, getGameLocalized, formatDailySignTimeLocal, t } from '../utils/i18n.js';
import { toGaGameKey, syncConsentBadge } from '../services/analytics-service.js';

let currentGameKey = 'GENSHIN';
let currentUid = null;
let uidCopyResetTimer = null;
let currentLang = 'ja';

function trackGAEvent(eventName, params = {}) {
  try {
    chrome.runtime.sendMessage({
      type: 'TRACK_GA_EVENT',
      eventName,
      params
    }).catch(() => {});
  } catch {
    // ignore
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const optInModal = document.getElementById('optin-modal');
  const optInAcceptBtn = document.getElementById('optin-accept-btn');
  const optinAnalyticsCb = document.getElementById('optin-analytics-cb');
  const analyticsConsentModal = document.getElementById('analytics-consent-modal');
  const analyticsConsentAcceptBtn = document.getElementById('analytics-consent-accept-btn');
  const analyticsConsentDeclineBtn = document.getElementById('analytics-consent-decline-btn');
  const autoSignToggle = document.getElementById('auto-sign-toggle');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');
  const manualSignBtn = document.getElementById('manual-sign-btn');
  const manualTriggerBtn = document.getElementById('manual-trigger-btn');
  const openCheckinSiteBtn = document.getElementById('open-checkin-site-btn');
  const openGiftSiteBtn = document.getElementById('open-gift-site-btn');
  const flavorBadge = document.getElementById('flavor-badge');

  // 設定読み込み & 言語解決
  const settings = await getSettings();
  currentGameKey = settings.activeGameKey || 'GENSHIN';
  currentLang = resolveLanguage(settings.language);
  const initialEnabledGames = settings.enabledGames || Object.keys(GAMES);

  // バッジ状態と設定を確実に同期
  await syncConsentBadge();

  // DOMに初期言語を適用
  applyI18nToDom(currentLang);

  // フレーバーUIバッジの反映
  if (API_CONFIG.FLAVOR_UI && flavorBadge && API_CONFIG.FLAVOR_UI.badgeText) {
    flavorBadge.textContent = API_CONFIG.FLAVOR_UI.badgeText;
    flavorBadge.style.display = 'inline-block';
  }

  const optinCheckboxes = document.querySelectorAll('.optin-game-cb');
  if (optinCheckboxes.length > 0) {
    setupCheckboxMinimumValidation(optinCheckboxes);
  }

  if (!settings.optInAccepted) {
    optInModal.classList.remove('hidden');
  } else {
    if (autoSignToggle) autoSignToggle.checked = !!settings.autoSignEnabled;
    if (autoRedeemToggle) autoRedeemToggle.checked = !!settings.autoRedeemEnabled;

    // 既存ユーザー向け同意モーダル（未確認の場合のみ表示）
    if (!settings.analyticsConsentReviewed && analyticsConsentModal) {
      analyticsConsentModal.classList.remove('hidden');
    }
  }

  // 既存ユーザー向け同意モーダルボタン処理
  if (analyticsConsentAcceptBtn) {
    analyticsConsentAcceptBtn.addEventListener('click', async () => {
      await updateSettings({
        analyticsEnabled: true,
        analyticsConsentReviewed: true
      });
      await syncConsentBadge();
      if (analyticsConsentModal) analyticsConsentModal.classList.add('hidden');
    });
  }

  if (analyticsConsentDeclineBtn) {
    analyticsConsentDeclineBtn.addEventListener('click', async () => {
      await updateSettings({
        analyticsEnabled: false,
        analyticsConsentReviewed: true
      });
      await syncConsentBadge();
      if (analyticsConsentModal) analyticsConsentModal.classList.add('hidden');
    });
  }

  // ゲーム選択タブの初期動的描画
  renderGameTabs(initialEnabledGames);

  // 初回同意ボタン
  optInAcceptBtn.addEventListener('click', async () => {
    const selected = Array.from(optinCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    const chosenGames = selected.length > 0 ? selected : Object.keys(GAMES);

    if (!chosenGames.includes(currentGameKey)) {
      currentGameKey = chosenGames[0];
    }

    const isAnalyticsEnabled = optinAnalyticsCb ? optinAnalyticsCb.checked : true;

    await updateSettings({
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true,
      enabledGames: chosenGames,
      activeGameKey: currentGameKey,
      analyticsEnabled: isAnalyticsEnabled,
      analyticsConsentReviewed: true
    });
    await syncConsentBadge();

    optInModal.classList.add('hidden');
    if (autoSignToggle) autoSignToggle.checked = true;
    if (autoRedeemToggle) autoRedeemToggle.checked = true;
    renderGameTabs(chosenGames);
    updateGameView();
    updateRedeemStatusView();

    trackGAEvent('onboarding_complete', { lang: currentLang });

    // 同意直後にバックグラウンドで初回自動受取（ログボ＆交換コード）を即時開始
    chrome.runtime.sendMessage({ type: 'TRIGGER_INITIAL_CATCH_UP' })
      .then(async () => {
        await updateDailySignStatusView(currentGameKey);
        await updateRedeemStatusView(currentGameKey);
        await renderLogs();
      })
      .catch(() => {});
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
      await updateRedeemStatusView();
    });
  }

  // 手動ログインボーナス受取トリガー
  if (manualSignBtn) {
    manualSignBtn.addEventListener('click', async () => {
      manualSignBtn.disabled = true;
      manualSignBtn.classList.add('is-loading');
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'TRIGGER_MANUAL_SIGN',
          gameKey: currentGameKey
        });
        const { title, message, detail } = formatSignResult(resp, currentLang);
        await showAlertModal(title, message, detail);
      } catch (err) {
        await showAlertModal(
          t('signCardTitle', [], currentLang),
          err?.message || 'Error',
          err?.message
        );
      } finally {
        manualSignBtn.disabled = false;
        manualSignBtn.classList.remove('is-loading');
        await updateDailySignStatusView(currentGameKey);
        await renderLogs();
      }
    });
  }

  // 手動コード引き換えトリガー
  if (manualTriggerBtn) {
    manualTriggerBtn.addEventListener('click', async () => {
      manualTriggerBtn.disabled = true;
      manualTriggerBtn.classList.add('is-loading');
      try {
        const resp = await chrome.runtime.sendMessage({
          type: 'TRIGGER_MANUAL_REDEEM',
          gameKey: currentGameKey
        });
        const { title, message, detail } = formatRedeemResult(resp, currentLang);
        await showAlertModal(title, message, detail);
      } catch (err) {
        await showAlertModal(
          t('redeemCardTitle', [], currentLang),
          err?.message || 'Error',
          err?.message
        );
      } finally {
        manualTriggerBtn.disabled = false;
        manualTriggerBtn.classList.remove('is-loading');
        await updateRedeemStatusView();
        await renderLogs();
      }
    });
  }

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
        trackGAEvent('ui_action', { action_type: 'open_official_site', game: toGaGameKey(currentGameKey), lang: currentLang });
        openExternalTab(config.checkInSiteUrl);
      }
    });
  }

  // 公式コード交換サイトを開くボタン & ゲームアイコンクリック
  const openCurrentGameGiftSite = () => {
    const localized = getGameLocalized(currentGameKey, currentLang);
    if (localized?.giftSiteUrl) {
      trackGAEvent('ui_action', { action_type: 'open_official_site', game: toGaGameKey(currentGameKey), lang: currentLang });
      openExternalTab(localized.giftSiteUrl);
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

  // 表示設定モーダルの制御（言語設定 ＋ ゲーム選択 ＋ 匿名の利用統計）
  const tabSettingsBtn = document.getElementById('tab-settings-btn');
  const filterModal = document.getElementById('game-filter-modal');
  const filterCancelBtn = document.getElementById('filter-modal-cancel-btn');
  const filterSaveBtn = document.getElementById('filter-modal-save-btn');
  const filterCheckboxes = document.querySelectorAll('.filter-game-cb');
  const langRadios = document.querySelectorAll('input[name="app-lang"]');
  const settingsAnalyticsCb = document.getElementById('settings-analytics-cb');

  const syncFilterValidation = setupCheckboxMinimumValidation(filterCheckboxes);

  const openFilterModal = async () => {
    const curSettings = await getSettings();
    const currentEnabled = curSettings.enabledGames || Object.keys(GAMES);
    filterCheckboxes.forEach(cb => {
      cb.checked = currentEnabled.includes(cb.value);
    });
    const curLangSetting = curSettings.language || 'auto';
    langRadios.forEach(r => {
      r.checked = r.value === curLangSetting;
    });
    if (settingsAnalyticsCb) {
      settingsAnalyticsCb.checked = !!curSettings.analyticsEnabled;
    }
    syncFilterValidation();
    filterModal.classList.remove('hidden');
  };

  if (tabSettingsBtn) {
    tabSettingsBtn.addEventListener('click', openFilterModal);
  }

  if (filterCancelBtn) {
    filterCancelBtn.addEventListener('click', () => {
      filterModal.classList.add('hidden');
    });
  }

  if (filterSaveBtn) {
    filterSaveBtn.addEventListener('click', async () => {
      const selectedGames = Array.from(filterCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      const validSelectedGames = selectedGames.length > 0 ? selectedGames : Object.keys(GAMES);

      if (!validSelectedGames.includes(currentGameKey)) {
        currentGameKey = validSelectedGames[0];
      }

      const selectedLangRadio = Array.from(langRadios).find(r => r.checked);
      const chosenLangSetting = selectedLangRadio ? selectedLangRadio.value : 'auto';
      const chosenAnalytics = settingsAnalyticsCb ? settingsAnalyticsCb.checked : true;

      await updateSettings({
        enabledGames: validSelectedGames,
        activeGameKey: currentGameKey,
        language: chosenLangSetting,
        analyticsEnabled: chosenAnalytics,
        analyticsConsentReviewed: true
      });
      await syncConsentBadge();

      trackGAEvent('ui_action', { action_type: 'change_settings', game: 'none', lang: currentLang });

      // 新しい言語を適用
      currentLang = resolveLanguage(chosenLangSetting);
      applyI18nToDom(currentLang);

      filterModal.classList.add('hidden');
      renderGameTabs(validSelectedGames);
      updateGameView();
      renderLogs();
    });
  }

  // UIDワンクリックコピー処理
  const uidChipBtn = document.getElementById('uid-copy-chip');
  if (uidChipBtn) {
    uidChipBtn.addEventListener('click', async () => {
      if (!currentUid) return;
      try {
        await navigator.clipboard.writeText(currentUid);
        trackGAEvent('ui_action', { action_type: 'uid_copy', game: toGaGameKey(currentGameKey), lang: currentLang });
        uidChipBtn.classList.add('copied');
        if (uidCopyResetTimer) clearTimeout(uidCopyResetTimer);
        uidCopyResetTimer = setTimeout(() => {
          uidChipBtn.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.error('Failed to copy UID to clipboard:', err);
      }
    });
  }

  // ログアコーディオンの開閉検知（UIアクション追跡）
  const logsAccordion = document.getElementById('logs-accordion');
  if (logsAccordion) {
    logsAccordion.addEventListener('toggle', () => {
      if (logsAccordion.open) {
        trackGAEvent('ui_action', { action_type: 'open_log', game: toGaGameKey(currentGameKey), lang: currentLang });
      }
    });
  }

  // 画像フォールバック制御
  const gameIconEl = document.getElementById('game-icon');
  const iconFallbackEl = document.getElementById('icon-fallback');
  if (gameIconEl && iconFallbackEl) {
    gameIconEl.addEventListener('error', () => {
      gameIconEl.style.display = 'none';
      iconFallbackEl.style.display = 'flex';
    });
    gameIconEl.addEventListener('load', () => {
      gameIconEl.style.display = 'block';
      iconFallbackEl.style.display = 'none';
    });
  }

  updateActiveTabButton();
  updateGameView();
  updateRedeemStatusView();
  renderLogs();

  // バックグラウンド実行中のログやステータス変更をリアルタイム反映
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.exec_logs) {
        renderLogs();
      }
      const relevantBiz = GAMES[currentGameKey]?.gameBiz;
      if (relevantBiz) {
        if (changes[`redeemed_${relevantBiz}`] || changes[`active_codes_${relevantBiz}`]) {
          updateRedeemStatusView(currentGameKey);
        }
        if (changes[`daily_sign_${relevantBiz}`]) {
          updateDailySignStatusView(currentGameKey);
        }
      }
    });
  }
});

function applyI18nToDom(lang) {
  document.documentElement.lang = lang;

  // text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key, [], lang);
  });

  // title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key, [], lang);
  });

  // aria-label
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    el.setAttribute('aria-label', t(key, [], lang));
  });

  // 初回オプトインのセキュリティリンク文言
  const optinSecNote = document.getElementById('optin-security-note');
  if (optinSecNote) {
    const privacyLinkHtml = `<a href="https://hoyopass.pages.dev/privacy" target="_blank" rel="noopener noreferrer" class="link-inline" id="optin-privacy-link">${t('privacyPolicy', [], lang)}</a>`;
    optinSecNote.innerHTML = t('optinSecurityNote', [privacyLinkHtml], lang);
  }

  // フッター免責事項
  const footerDisclaimer = document.getElementById('footer-disclaimer-text');
  if (footerDisclaimer) {
    footerDisclaimer.innerHTML = t('footerDisclaimer', [], lang);
  }

  // ゲーム選択チェックボックスのラベル名
  document.querySelectorAll('[data-game-label]').forEach(el => {
    const gKey = el.getAttribute('data-game-label');
    const localized = getGameLocalized(gKey, lang);
    el.textContent = localized.name;
  });

  // アラーム定期ラベル
  updateIntervalLabels(lang);
}

function updateIntervalLabels(lang) {
  const autoSignLabel = document.getElementById('auto-sign-label');
  const autoRedeemLabel = document.getElementById('auto-redeem-label');

  if (autoSignLabel) {
    autoSignLabel.textContent = t('autoSignLabel', [formatDailySignTimeLocal()], lang);
  }

  if (autoRedeemLabel) {
    const isDev = API_CONFIG.IS_DEV;
    const intervalStr = isDev
      ? t('intervalLabelMinutes', [API_CONFIG.REDEEM_INTERVAL_MINUTES || 3], lang)
      : t('intervalLabelHours', [(API_CONFIG.REDEEM_INTERVAL_MINUTES || 180) / 60], lang);
    autoRedeemLabel.textContent = t('autoRedeemLabel', [intervalStr], lang);
  }
}

function setupCheckboxMinimumValidation(checkboxes) {
  const sync = () => {
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    if (checked.length === 1) {
      checked[0].disabled = true;
    } else {
      checkboxes.forEach(cb => { cb.disabled = false; });
    }
  };
  checkboxes.forEach(cb => {
    cb.addEventListener('change', sync);
  });
  sync();
  return sync;
}

function renderGameTabs(enabledGames) {
  const gameTabs = document.getElementById('game-tabs');
  if (!gameTabs) return;
  gameTabs.innerHTML = '';

  enabledGames.forEach(gKey => {
    const localized = getGameLocalized(gKey, currentLang);
    const btn = document.createElement('button');
    btn.className = `tab-btn${gKey === currentGameKey ? ' active' : ''}`;
    btn.dataset.game = gKey;
    btn.textContent = localized.tabLabel || localized.name;
    btn.addEventListener('click', async () => {
      if (gKey === currentGameKey) return;
      currentGameKey = gKey;
      gameTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.game === currentGameKey));
      await updateSettings({ activeGameKey: currentGameKey });
      updateGameView();
      renderLogs();
    });
    gameTabs.appendChild(btn);
  });
}

function updateActiveTabButton() {
  const tabs = document.querySelectorAll('#game-tabs .tab-btn');
  tabs.forEach(t => t.classList.toggle('active', t.dataset.game === currentGameKey));
}

async function updateGameView() {
  const targetKey = currentGameKey;
  const config = GAMES[targetKey];
  const localized = getGameLocalized(targetKey, currentLang);

  const titleEl = document.getElementById('game-title');
  const iconEl = document.getElementById('game-icon');
  const fallbackEl = document.getElementById('icon-fallback');
  const badgeEl = document.getElementById('login-status-badge');
  const checkinSiteBtn = document.getElementById('open-checkin-site-btn');
  const giftSiteBtn = document.getElementById('open-gift-site-btn');
  const uidChipEl = document.getElementById('uid-copy-chip');
  const uidValueEl = document.getElementById('uid-value');
  const manualSignBtn = document.getElementById('manual-sign-btn');
  const manualTriggerBtn = document.getElementById('manual-trigger-btn');
  const autoSignToggle = document.getElementById('auto-sign-toggle');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');

  titleEl.textContent = localized.name;
  fallbackEl.textContent = localized.shortName;

  const wrapperEl = document.getElementById('game-icon-wrapper');
  if (wrapperEl) {
    const label = t('gameIconTitle', [localized.name], currentLang);
    wrapperEl.title = label;
    wrapperEl.setAttribute('aria-label', label);
  }
  if (checkinSiteBtn) {
    checkinSiteBtn.title = t('btnOfficialSignTitle', [localized.name], currentLang);
  }
  if (giftSiteBtn) {
    giftSiteBtn.title = t('btnOfficialGiftTitle', [localized.name], currentLang);
  }
  if (manualSignBtn) {
    manualSignBtn.title = t('btnManualSignTitle', [], currentLang);
    manualSignBtn.setAttribute('aria-label', t('btnManualSignTitle', [], currentLang));
  }
  if (manualTriggerBtn) {
    manualTriggerBtn.title = t('btnManualRedeemTitle', [], currentLang);
    manualTriggerBtn.setAttribute('aria-label', t('btnManualRedeemTitle', [], currentLang));
  }
  if (autoSignToggle && autoSignToggle.parentElement) {
    autoSignToggle.parentElement.title = t('autoSignToggleTitle', [], currentLang);
  }
  if (autoRedeemToggle && autoRedeemToggle.parentElement) {
    autoRedeemToggle.parentElement.title = t('autoRedeemToggleTitle', [], currentLang);
  }

  if (config.iconPath) {
    iconEl.src = config.iconPath;
    if (iconEl.complete) {
      if (iconEl.naturalWidth === 0) {
        iconEl.style.display = 'none';
        fallbackEl.style.display = 'flex';
      } else {
        iconEl.style.display = 'block';
        fallbackEl.style.display = 'none';
      }
    }
  } else {
    iconEl.style.display = 'none';
    fallbackEl.style.display = 'flex';
  }

  badgeEl.textContent = t('statusChecking', [], currentLang);
  badgeEl.className = 'badge';
  if (uidChipEl) uidChipEl.classList.add('hidden');
  if (uidValueEl) uidValueEl.textContent = '--------';
  currentUid = null;

  // ログインボーナス・交換コード状態表示も並行更新
  updateDailySignStatusView(targetKey);
  updateRedeemStatusView(targetKey);

  try {
    const res = await getUserGameRoles(config.gameBiz, currentLang);
    if (currentGameKey !== targetKey) return;
    if (res.success && res.role) {
      badgeEl.textContent = t('statusOnline', [res.role.nickname], currentLang);
      badgeEl.classList.add('online');
      currentUid = String(res.role.game_uid || '');
      if (currentUid && uidValueEl && uidChipEl) {
        uidValueEl.textContent = currentUid;
        uidChipEl.classList.remove('hidden');
        uidChipEl.setAttribute('aria-label', `UID ${currentUid}`);
      }
    } else if (res.retcode === -1 || res.retcode === -2) {
      badgeEl.textContent = t('statusNoChar', [], currentLang);
      badgeEl.classList.add('offline');
    } else {
      badgeEl.textContent = res.retcode === -100 ? t('statusLoggedOut', [], currentLang) : `${t('statusLoggedOut', [], currentLang)} (${res.retcode ?? 'error'})`;
      badgeEl.classList.add('offline');
    }
  } catch {
    if (currentGameKey !== targetKey) return;
    badgeEl.textContent = t('statusOffline', [], currentLang);
    badgeEl.classList.add('offline');
  }
}

async function updateDailySignStatusView(gameKey) {
  const signBadgeEl = document.getElementById('sign-status-badge');
  if (!signBadgeEl) return;

  const config = GAMES[gameKey];
  if (!config) return;

  signBadgeEl.textContent = t('statusChecking', [], currentLang);
  signBadgeEl.className = 'status-pill';

  const today = getHoyoTodayDateString();
  const cached = await getDailySignRecord(config.gameBiz);
  if (currentGameKey !== gameKey) return;

  if (cached && cached.date === today && cached.isSigned) {
    const daysText = cached.totalSignDay ? t('signStatusDays', [cached.totalSignDay], currentLang) : '';
    signBadgeEl.textContent = `${t('signStatusSigned', [], currentLang)}${daysText}`;
    signBadgeEl.className = 'status-pill signed';
  }

  try {
    const info = await getDailySignInfo(config, currentLang);
    if (currentGameKey !== gameKey) return;

    if (info.success) {
      await setDailySignRecord(config.gameBiz, {
        date: info.today || today,
        isSigned: info.isSigned,
        totalSignDay: info.totalSignDay,
        skippedNoChar: false
      });
      const daysText = info.totalSignDay ? t('signStatusDays', [info.totalSignDay], currentLang) : '';
      if (info.isSigned) {
        signBadgeEl.textContent = `${t('signStatusSigned', [], currentLang)}${daysText}`;
        signBadgeEl.className = 'status-pill signed';
      } else {
        signBadgeEl.textContent = `${t('signStatusUnsigned', [], currentLang)}${daysText}`;
        signBadgeEl.className = 'status-pill unsigned';
      }
    } else if (!cached || cached.date !== today || !cached.isSigned) {
      signBadgeEl.textContent = info.retcode === -100 ? t('statusLoggedOut', [], currentLang) : t('signStatusSkipped', [], currentLang);
      signBadgeEl.className = 'status-pill skipped';
    }
  } catch {
    if (currentGameKey !== gameKey) return;
    if (!cached || cached.date !== today || !cached.isSigned) {
      signBadgeEl.textContent = t('statusOffline', [], currentLang);
      signBadgeEl.className = 'status-pill skipped';
    }
  }
}

async function updateRedeemStatusView(gameKey = currentGameKey) {
  const labelEl = document.getElementById('redeem-status-label');
  const badgeEl = document.getElementById('redeem-status-badge');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');
  if (!badgeEl) return;

  const config = GAMES[gameKey];
  if (!config) return;

  const isEnabled = autoRedeemToggle ? autoRedeemToggle.checked : false;

  const isDev = API_CONFIG.IS_DEV;
  const intervalStr = isDev
    ? t('intervalLabelMinutes', [API_CONFIG.REDEEM_INTERVAL_MINUTES || 3], currentLang)
    : t('intervalLabelHours', [(API_CONFIG.REDEEM_INTERVAL_MINUTES || 180) / 60], currentLang);

  let nextRunTooltip = t('nextRunTooltipStopped', [], currentLang);
  if (isEnabled) {
    try {
      if (typeof chrome !== 'undefined' && chrome.alarms?.get) {
        const alarm = await chrome.alarms.get(ALARM_NAMES.AUTO_REDEEM);
        if (alarm && alarm.scheduledTime) {
          const nextDate = new Date(alarm.scheduledTime);
          const hours = String(nextDate.getHours()).padStart(2, '0');
          const minutes = String(nextDate.getMinutes()).padStart(2, '0');
          nextRunTooltip = t('nextRunTooltipScheduled', [`${hours}:${minutes}`], currentLang);
        } else {
          nextRunTooltip = t('nextRunTooltipRunning', [intervalStr], currentLang);
        }
      }
    } catch {
      nextRunTooltip = t('nextRunTooltipRunning', [intervalStr], currentLang);
    }
  }

  badgeEl.title = nextRunTooltip;

  try {
    const stats = await getCodeRedeemStats(config.gameBiz);
    if (currentGameKey !== gameKey) return;

    if (labelEl) {
      if (stats.activeTotal !== null) {
        if (stats.activeTotal === 0) {
          labelEl.textContent = t('redeemStatusLabelNone', [], currentLang);
        } else {
          labelEl.textContent = t('redeemStatusLabelActive', [stats.activeClaimed, stats.activeTotal], currentLang);
        }
      } else {
        labelEl.textContent = t('redeemStatusLabelDefault', [], currentLang);
        fetchValidCodes(gameKey).then(async (codes) => {
          if (Array.isArray(codes)) {
            await setActiveCodes(config.gameBiz, codes);
            if (currentGameKey === gameKey) {
              updateRedeemStatusView(gameKey);
            }
          }
        }).catch(() => {});
      }
    }

    badgeEl.textContent = t('redeemStatsBadge', [stats.monthlyCount, stats.totalCount], currentLang);

    if (stats.activeTotal !== null) {
      if (stats.activeClaimed >= stats.activeTotal) {
        badgeEl.className = 'status-pill signed';
      } else {
        badgeEl.className = 'status-pill unsigned';
      }
    } else {
      badgeEl.className = 'status-pill';
    }
  } catch {
    if (currentGameKey !== gameKey) return;
    if (labelEl) labelEl.textContent = t('redeemStatusLabelDefault', [], currentLang);
    badgeEl.textContent = t('signStatusSkipped', [], currentLang);
    badgeEl.className = 'status-pill skipped';
  }
}

function isLogForGame(log, gameKey) {
  if (!log) return false;
  if (log.gameKey) {
    return log.gameKey === gameKey;
  }
  const msg = log.message || '';
  const jaName = GAMES[gameKey]?.name;
  const enName = getGameLocalized(gameKey, 'en')?.name;

  if ((jaName && msg.includes(jaName)) || (enName && msg.includes(enName))) {
    return true;
  }

  // 他の特定ゲーム名が含まれている場合は除外
  const otherNames = [];
  Object.keys(GAMES).forEach(k => {
    if (k !== gameKey) {
      otherNames.push(GAMES[k]?.name);
      otherNames.push(getGameLocalized(k, 'en')?.name);
    }
  });

  return !otherNames.some(name => name && msg.includes(name));
}

function buildLatestLogSummary(latestLog) {
  if (!latestLog) {
    return { text: t('latestLogEmpty', [], currentLang), isError: false };
  }
  const time = formatLogTimestamp(latestLog.timestamp);
  const timeSuffix = time ? ` (${time})` : '';
  if (latestLog.type === 'ERROR') {
    return { text: t('latestLogError', [timeSuffix], currentLang), isError: true };
  }
  if (latestLog.type === 'WARN') {
    return { text: t('latestLogWarn', [timeSuffix], currentLang), isError: false };
  }
  return { text: t('latestLogSuccess', [timeSuffix], currentLang), isError: false };
}

async function renderLogs() {
  const container = document.getElementById('logs-container');
  const summaryEl = document.getElementById('latest-log-summary');
  if (!container) return;

  const data = await chrome.storage.local.get('exec_logs');
  const allLogs = data.exec_logs || [];
  const logs = allLogs.filter(log => isLogForGame(log, currentGameKey));

  if (summaryEl) {
    const { text, isError } = buildLatestLogSummary(logs[0]);
    summaryEl.textContent = text;
    summaryEl.classList.toggle('has-error', isError);
  }

  container.innerHTML = '';
  if (!logs.length) {
    const empty = document.createElement('div');
    empty.textContent = t('noLogs', [], currentLang);
    empty.style.color = '#64748b';
    container.appendChild(empty);
    return;
  }

  const jaPrefix = `${GAMES[currentGameKey]?.name}: `;
  const enPrefix = `${getGameLocalized(currentGameKey, 'en')?.name}: `;

  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = log.type === 'ERROR' ? 'log-item log-error' : 'log-item';
    const time = formatLogTimestamp(log.timestamp);
    let cleanMsg = log.message || log.type || '';
    if (cleanMsg.startsWith(jaPrefix)) {
      cleanMsg = cleanMsg.slice(jaPrefix.length);
    } else if (cleanMsg.startsWith(enPrefix)) {
      cleanMsg = cleanMsg.slice(enPrefix.length);
    }
    item.textContent = `[${time}] ${cleanMsg}`;
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

import { GAMES, API_CONFIG, PRIVACY_POLICY_VERSION } from '../config/constants.js';
import { defaultStateStore } from '../services/state-store.js';
import { API_STATUS, isNotLoggedIn } from '../services/api-gateway.js';
import { formatRedeemResult, formatSignResult } from '../utils/message-formatter.js';
import { resolveLanguage, getGameLocalized, getPrivacyPolicyUrl, getGuideUrl, t } from '../utils/i18n.js';
import { toGaGameKey, syncConsentBadge } from '../services/analytics-service.js';
import {
  openExternalTab,
  bindExternalLink,
  setupCheckboxMinimumValidation,
  showAlertModal,
  checkPolicyReviewModal,
  initReviewPromptBanner,
  initConsentModals,
  initSettingsModal
} from './modals.js';
import {
  applyI18nToDom,
  applyPopupAuthView,
  resolveManualRedeemFormatOptions,
  updateDailySignStatusView,
  updateRedeemStatusView,
  updateGameView
} from './status-view.js';
import { renderLogs } from './log-view.js';

const state = {
  currentGameKey: 'GENSHIN',
  currentUid: null,
  currentLang: 'ja',
  authStateByGame: {}
};
let uidCopyResetTimer = null;

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

function renderGameTabs(enabledGames) {
  const gameTabs = document.getElementById('game-tabs');
  if (!gameTabs) return;
  gameTabs.innerHTML = '';

  enabledGames.forEach(gKey => {
    const localized = getGameLocalized(gKey, state.currentLang);
    const btn = document.createElement('button');
    btn.className = `tab-btn${gKey === state.currentGameKey ? ' active' : ''}`;
    btn.dataset.game = gKey;
    btn.textContent = localized.tabLabel || localized.name;
    btn.addEventListener('click', async () => {
      if (gKey === state.currentGameKey) return;
      state.currentGameKey = gKey;
      gameTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.game === state.currentGameKey));
      await defaultStateStore.updateSettings({ activeGameKey: state.currentGameKey });
      updateGameView(state);
      renderLogs(state.currentGameKey, state.currentLang);
    });
    gameTabs.appendChild(btn);
  });
}

function bindManualActionButton(buttonEl, messageType, formatResultFn, fallbackTitleKey, onComplete) {
  if (!buttonEl) return;
  buttonEl.addEventListener('click', async () => {
    const targetGameKey = state.currentGameKey;
    let actionResp = null;
    buttonEl.disabled = true;
    buttonEl.classList.add('is-loading');
    try {
      actionResp = await chrome.runtime.sendMessage({
        type: messageType,
        gameKey: targetGameKey
      });
      const { title, message, detail } = formatResultFn(actionResp, state.currentLang, targetGameKey);
      await showAlertModal(title, message, detail);
    } catch (err) {
      await showAlertModal(
        t(fallbackTitleKey, [], state.currentLang),
        err?.message || 'Error',
        err?.message
      );
    } finally {
      buttonEl.disabled = false;
      buttonEl.classList.remove('is-loading');
      await onComplete(actionResp, targetGameKey);
      await renderLogs(state.currentGameKey, state.currentLang);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const optInModal = document.getElementById('optin-modal');
  const optInAcceptBtn = document.getElementById('optin-accept-btn');
  const optinAnalyticsCb = document.getElementById('optin-analytics-cb');
  const analyticsConsentModal = document.getElementById('analytics-consent-modal');
  const autoSignToggle = document.getElementById('auto-sign-toggle');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');
  const manualSignBtn = document.getElementById('manual-sign-btn');
  const manualTriggerBtn = document.getElementById('manual-trigger-btn');
  const openCheckinSiteBtn = document.getElementById('open-checkin-site-btn');
  const openGiftSiteBtn = document.getElementById('open-gift-site-btn');
  const flavorBadge = document.getElementById('flavor-badge');

  const refreshReviewPromptBanner = initReviewPromptBanner({
    getCurrentLang: () => state.currentLang,
    trackGAEvent
  });

  const settings = await defaultStateStore.getSettings();
  state.currentGameKey = settings.activeGameKey || 'GENSHIN';
  state.currentLang = resolveLanguage(settings.language);
  const initialEnabledGames = settings.enabledGames || Object.keys(GAMES);

  await syncConsentBadge();
  applyI18nToDom(state.currentLang);

  if (API_CONFIG.FLAVOR_UI && flavorBadge && API_CONFIG.FLAVOR_UI.badgeText) {
    flavorBadge.textContent = API_CONFIG.FLAVOR_UI.badgeText;
    flavorBadge.style.display = 'inline-block';
  }

  const optinCheckboxes = document.querySelectorAll('.optin-game-cb');
  if (optinCheckboxes.length > 0) {
    setupCheckboxMinimumValidation(optinCheckboxes);
  }

  if (!settings.optInAccepted) {
    optInModal?.classList.remove('hidden');
  } else {
    if (autoSignToggle) autoSignToggle.checked = !!settings.autoSignEnabled;
    if (autoRedeemToggle) autoRedeemToggle.checked = !!settings.autoRedeemEnabled;

    if (!settings.analyticsConsentReviewed && analyticsConsentModal) {
      analyticsConsentModal.classList.remove('hidden');
    } else {
      await checkPolicyReviewModal(state.currentLang);
    }
  }

  initConsentModals({ getCurrentLang: () => state.currentLang });
  renderGameTabs(initialEnabledGames);

  optInAcceptBtn?.addEventListener('click', async () => {
    const selected = Array.from(optinCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    const chosenGames = selected.length > 0 ? selected : Object.keys(GAMES);

    if (!chosenGames.includes(state.currentGameKey)) {
      state.currentGameKey = chosenGames[0];
    }

    const isAnalyticsEnabled = optinAnalyticsCb ? optinAnalyticsCb.checked : true;

    await defaultStateStore.updateSettings({
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true,
      enabledGames: chosenGames,
      activeGameKey: state.currentGameKey,
      analyticsEnabled: isAnalyticsEnabled,
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION
    });
    await syncConsentBadge();

    optInModal?.classList.add('hidden');
    await refreshReviewPromptBanner();
    if (autoSignToggle) autoSignToggle.checked = true;
    if (autoRedeemToggle) autoRedeemToggle.checked = true;
    renderGameTabs(chosenGames);
    updateGameView(state);
    updateRedeemStatusView(state.currentGameKey, state);

    trackGAEvent('onboarding_complete', {
      genshin_enabled: chosenGames.includes('GENSHIN'),
      hsr_enabled: chosenGames.includes('STAR_RAIL'),
      zzz_enabled: chosenGames.includes('ZZZ'),
      lang: state.currentLang
    });

    chrome.runtime.sendMessage({ type: 'TRIGGER_INITIAL_CATCH_UP' })
      .then(async () => {
        await updateDailySignStatusView(state.currentGameKey, state);
        await updateRedeemStatusView(state.currentGameKey, state);
        await renderLogs(state.currentGameKey, state.currentLang);
      })
      .catch(() => {});
  });

  autoSignToggle?.addEventListener('change', async (e) => {
    await defaultStateStore.updateSettings({ autoSignEnabled: e.target.checked });
  });

  autoRedeemToggle?.addEventListener('change', async (e) => {
    await defaultStateStore.updateSettings({ autoRedeemEnabled: e.target.checked });
    applyPopupAuthView(state.currentGameKey, state);
    await updateRedeemStatusView(state.currentGameKey, state);
  });

  bindManualActionButton(
    manualSignBtn,
    'TRIGGER_MANUAL_SIGN',
    formatSignResult,
    'signCardTitle',
    (_resp, targetGameKey) => updateDailySignStatusView(targetGameKey, state)
  );

  bindManualActionButton(
    manualTriggerBtn,
    'TRIGGER_MANUAL_REDEEM',
    (resp, lang, targetGameKey) => {
      const cache = state.authStateByGame?.[targetGameKey];
      const options = resolveManualRedeemFormatOptions({
        roleRes: cache?.roleRes,
        signInfo: cache?.signInfo,
        autoRedeemEnabled: autoRedeemToggle ? autoRedeemToggle.checked : false
      });
      return formatRedeemResult(resp, lang, options);
    },
    'redeemCardTitle',
    async (resp, targetGameKey) => {
      const gameRes = resp?.results?.[targetGameKey];
      const roleCache = state.authStateByGame?.[targetGameKey]?.roleRes;
      if (roleCache && gameRes) {
        if (gameRes.status === API_STATUS.NOT_LOGGED_IN || isNotLoggedIn(gameRes.retcode)) {
          roleCache.hoyoverseNotLoggedIn = true;
          applyPopupAuthView(targetGameKey, state);
        } else if (gameRes.success && !gameRes.skipped) {
          roleCache.hoyoverseNotLoggedIn = false;
          applyPopupAuthView(targetGameKey, state);
        }
      }
      await updateRedeemStatusView(targetGameKey, state);
    }
  );

  openCheckinSiteBtn?.addEventListener('click', () => {
    const config = GAMES[state.currentGameKey];
    if (config?.checkInSiteUrl) {
      trackGAEvent('ui_action', { action_type: 'open_official_site', game: toGaGameKey(state.currentGameKey), lang: state.currentLang });
      openExternalTab(config.checkInSiteUrl);
    }
  });

  const openCurrentGameGiftSite = () => {
    const localized = getGameLocalized(state.currentGameKey, state.currentLang);
    if (localized?.giftSiteUrl) {
      trackGAEvent('ui_action', { action_type: 'open_official_site', game: toGaGameKey(state.currentGameKey), lang: state.currentLang });
      openExternalTab(localized.giftSiteUrl);
    }
  };

  openGiftSiteBtn?.addEventListener('click', openCurrentGameGiftSite);

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

  bindExternalLink('optin-privacy-link', () => getPrivacyPolicyUrl(state.currentLang));
  bindExternalLink('footer-link-readme', () => getGuideUrl(state.currentLang));
  bindExternalLink('footer-link-privacy', () => getPrivacyPolicyUrl(state.currentLang));

  initSettingsModal({
    state,
    trackGAEvent,
    onSettingsApplied: (validSelectedGames) => {
      applyI18nToDom(state.currentLang);
      bindExternalLink('optin-privacy-link', () => getPrivacyPolicyUrl(state.currentLang));
      renderGameTabs(validSelectedGames);
      updateGameView(state);
      renderLogs(state.currentGameKey, state.currentLang);
    }
  });

  const uidChipBtn = document.getElementById('uid-copy-chip');
  uidChipBtn?.addEventListener('click', async () => {
    if (!state.currentUid) return;
    try {
      await navigator.clipboard.writeText(state.currentUid);
      trackGAEvent('ui_action', { action_type: 'uid_copy', game: toGaGameKey(state.currentGameKey), lang: state.currentLang });
      uidChipBtn.classList.add('copied');
      if (uidCopyResetTimer) clearTimeout(uidCopyResetTimer);
      uidCopyResetTimer = setTimeout(() => {
        uidChipBtn.classList.remove('copied');
      }, 1500);
    } catch (err) {
      console.error('Failed to copy UID to clipboard:', err);
    }
  });

  const logsAccordion = document.getElementById('logs-accordion');
  logsAccordion?.addEventListener('toggle', () => {
    if (logsAccordion.open) {
      trackGAEvent('ui_action', { action_type: 'open_log', game: toGaGameKey(state.currentGameKey), lang: state.currentLang });
    }
  });

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

  document.querySelectorAll('#game-tabs .tab-btn').forEach(tabBtn => {
    tabBtn.classList.toggle('active', tabBtn.dataset.game === state.currentGameKey);
  });

  updateGameView(state);
  updateRedeemStatusView(state.currentGameKey, state);
  renderLogs(state.currentGameKey, state.currentLang);
  await refreshReviewPromptBanner();

  defaultStateStore.subscribeChanges((event) => {
    if (event.logsChanged) {
      renderLogs(state.currentGameKey, state.currentLang);
    }
    const relevantBiz = GAMES[state.currentGameKey]?.gameBiz;
    if (relevantBiz) {
      if (event.redeemChangedBiz.includes(relevantBiz)) {
        updateRedeemStatusView(state.currentGameKey, state);
      }
      if (event.signChangedBiz.includes(relevantBiz)) {
        updateDailySignStatusView(state.currentGameKey, state);
      }
    }
  });
});

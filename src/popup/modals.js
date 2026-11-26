import { GAMES, API_CONFIG, PRIVACY_POLICY_VERSION, REVIEW_PROMPT_CONFIG } from '../config/constants.js';
import { defaultStateStore, needsPolicyReview } from '../services/state-store.js';
import {
  shouldShowReviewPrompt,
  updateReviewPromptState,
  postponeReviewPrompt
} from '../services/review-prompt-service.js';
import { resolveLanguage, getPrivacyPolicyUrl, t } from '../utils/i18n.js';
import { syncConsentBadge } from '../services/analytics-service.js';

export function openExternalTab(url) {
  if (url && typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url });
  } else if (url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function bindExternalLink(target, urlOrFn) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const targetUrl = typeof urlOrFn === 'function' ? urlOrFn() : urlOrFn;
    openExternalTab(targetUrl);
  });
}

export function setupCheckboxMinimumValidation(checkboxes) {
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

export function showAlertModal(title, message, detail = null) {
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

export async function checkPolicyReviewModal(currentLang) {
  const policyUpdateModal = document.getElementById('policy-update-modal');
  const policyUpdateDesc = document.getElementById('policy-update-desc');
  const cur = await defaultStateStore.getSettings();

  if (cur.optInAccepted && cur.analyticsConsentReviewed && needsPolicyReview(cur)) {
    if (policyUpdateDesc) {
      const policyUrl = getPrivacyPolicyUrl(currentLang);
      const linkHtml = `<a href="${policyUrl}" target="_blank" rel="noopener noreferrer" class="link-inline" id="policy-update-privacy-link">${t('privacyPolicy', [], currentLang)}</a>`;
      policyUpdateDesc.innerHTML = t('policyUpdateDesc', [PRIVACY_POLICY_VERSION, linkHtml], currentLang);
      const policyLink = document.getElementById('policy-update-privacy-link');
      if (policyLink) {
        policyLink.addEventListener('click', (e) => {
          e.preventDefault();
          openExternalTab(getPrivacyPolicyUrl(currentLang));
        });
      }
    }
    policyUpdateModal?.classList.remove('hidden');
  }
}

export function initReviewPromptBanner({ getCurrentLang, trackGAEvent }) {
  const reviewBanner = document.getElementById('review-prompt-banner');
  const reviewWriteBtn = document.getElementById('review-prompt-write-btn');
  const reviewLaterBtn = document.getElementById('review-prompt-later-btn');
  const reviewDismissBtn = document.getElementById('review-prompt-dismiss-btn');
  const flavorBadge = document.getElementById('flavor-badge');

  const optInModal = document.getElementById('optin-modal');
  const analyticsConsentModal = document.getElementById('analytics-consent-modal');
  const policyUpdateModal = document.getElementById('policy-update-modal');

  const refreshReviewPromptBanner = async () => {
    if (!reviewBanner) return;
    const isModalOpen = [optInModal, analyticsConsentModal, policyUpdateModal]
      .some(modal => modal && !modal.classList.contains('hidden'));
    if (isModalOpen) {
      reviewBanner.hidden = true;
      return;
    }
    const show = await shouldShowReviewPrompt();
    reviewBanner.hidden = !show;
  };

  if (reviewWriteBtn) {
    reviewWriteBtn.addEventListener('click', async () => {
      if (reviewBanner) reviewBanner.hidden = true;
      await updateReviewPromptState({ status: 'completed' });
      trackGAEvent('ui_action', { action_type: 'review_prompt_write', game: 'none', lang: getCurrentLang() });
      openExternalTab(REVIEW_PROMPT_CONFIG.REVIEW_URL);
    });
  }

  if (reviewLaterBtn) {
    reviewLaterBtn.addEventListener('click', async () => {
      if (reviewBanner) reviewBanner.hidden = true;
      await postponeReviewPrompt();
      trackGAEvent('ui_action', { action_type: 'review_prompt_later', game: 'none', lang: getCurrentLang() });
    });
  }

  if (reviewDismissBtn) {
    reviewDismissBtn.addEventListener('click', async () => {
      if (reviewBanner) reviewBanner.hidden = true;
      await updateReviewPromptState({ status: 'dismissed' });
      trackGAEvent('ui_action', { action_type: 'review_prompt_dismiss', game: 'none', lang: getCurrentLang() });
    });
  }

  if (API_CONFIG.IS_DEV && flavorBadge) {
    flavorBadge.classList.add('dev-interactive');
    flavorBadge.title = '[DEV] クリックでレビューバナーをリセット＆表示';
    flavorBadge.addEventListener('click', async () => {
      await updateReviewPromptState({
        successCount: REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT,
        status: 'pending',
        postponeCount: 0,
        nextEligibleTimestamp: 0
      });
      await refreshReviewPromptBanner();
    });
  }

  return refreshReviewPromptBanner;
}

export function initConsentModals({ getCurrentLang }) {
  const analyticsConsentModal = document.getElementById('analytics-consent-modal');
  const analyticsConsentAcceptBtn = document.getElementById('analytics-consent-accept-btn');
  const analyticsConsentDeclineBtn = document.getElementById('analytics-consent-decline-btn');
  const policyUpdateModal = document.getElementById('policy-update-modal');
  const policyUpdateAcceptBtn = document.getElementById('policy-update-accept-btn');

  if (analyticsConsentAcceptBtn) {
    analyticsConsentAcceptBtn.addEventListener('click', async () => {
      await defaultStateStore.updateSettings({
        analyticsEnabled: true,
        analyticsConsentReviewed: true,
        agreedPolicyVersion: PRIVACY_POLICY_VERSION
      });
      await syncConsentBadge();
      analyticsConsentModal?.classList.add('hidden');
      await checkPolicyReviewModal(getCurrentLang());
    });
  }

  if (analyticsConsentDeclineBtn) {
    analyticsConsentDeclineBtn.addEventListener('click', async () => {
      await defaultStateStore.updateSettings({
        analyticsEnabled: false,
        analyticsConsentReviewed: true
      });
      await syncConsentBadge();
      analyticsConsentModal?.classList.add('hidden');
      await checkPolicyReviewModal(getCurrentLang());
    });
  }

  if (policyUpdateAcceptBtn) {
    policyUpdateAcceptBtn.addEventListener('click', async () => {
      await defaultStateStore.updateSettings({
        agreedPolicyVersion: PRIVACY_POLICY_VERSION
      });
      await syncConsentBadge();
      policyUpdateModal?.classList.add('hidden');
    });
  }
}

export function initSettingsModal({ state, trackGAEvent, onSettingsApplied }) {
  const tabSettingsBtn = document.getElementById('tab-settings-btn');
  const filterModal = document.getElementById('game-filter-modal');
  const filterCancelBtn = document.getElementById('filter-modal-cancel-btn');
  const filterSaveBtn = document.getElementById('filter-modal-save-btn');
  const filterCheckboxes = document.querySelectorAll('.filter-game-cb');
  const langRadios = document.querySelectorAll('input[name="app-lang"]');
  const settingsAnalyticsCb = document.getElementById('settings-analytics-cb');

  const syncFilterValidation = setupCheckboxMinimumValidation(filterCheckboxes);

  const openFilterModal = async () => {
    const curSettings = await defaultStateStore.getSettings();
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
    filterModal?.classList.remove('hidden');
  };

  if (tabSettingsBtn) {
    tabSettingsBtn.addEventListener('click', openFilterModal);
  }

  if (filterCancelBtn) {
    filterCancelBtn.addEventListener('click', () => {
      filterModal?.classList.add('hidden');
    });
  }

  if (filterSaveBtn) {
    filterSaveBtn.addEventListener('click', async () => {
      const selectedGames = Array.from(filterCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      const validSelectedGames = selectedGames.length > 0 ? selectedGames : Object.keys(GAMES);

      if (!validSelectedGames.includes(state.currentGameKey)) {
        state.currentGameKey = validSelectedGames[0];
      }

      const selectedLangRadio = Array.from(langRadios).find(r => r.checked);
      const chosenLangSetting = selectedLangRadio ? selectedLangRadio.value : 'auto';
      const chosenAnalytics = settingsAnalyticsCb ? settingsAnalyticsCb.checked : true;

      await defaultStateStore.updateSettings({
        enabledGames: validSelectedGames,
        activeGameKey: state.currentGameKey,
        language: chosenLangSetting,
        analyticsEnabled: chosenAnalytics,
        analyticsConsentReviewed: true
      });
      await syncConsentBadge();

      trackGAEvent('ui_action', { action_type: 'change_settings', game: 'none', lang: state.currentLang });

      state.currentLang = resolveLanguage(chosenLangSetting);
      filterModal?.classList.add('hidden');
      onSettingsApplied(validSelectedGames);
    });
  }
}

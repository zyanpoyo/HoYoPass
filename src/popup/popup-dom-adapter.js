import { getGameLocalized, t } from '../utils/i18n.js';

/**
 * 選択ゲームチェックボックスの最低1件必須バリデーションを設定する。
 */
export function setupCheckboxMinimumValidation(checkboxes) {
  const sync = () => {
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    if (checked.length === 1) {
      checked[0].disabled = true;
    } else {
      checkboxes.forEach(cb => { cb.disabled = false; });
    }
  };
  checkboxes.forEach((cb) => {
    cb.addEventListener('change', sync);
  });
  sync();
  return sync;
}

function applyStaticI18n(doc, snapshot) {
  const { lang, privacyPolicyUrl, guideUrl } = snapshot;
  doc.documentElement.lang = lang;

  doc.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key, [], lang);
  });

  doc.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key, [], lang);
  });

  doc.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    el.setAttribute('aria-label', t(key, [], lang));
  });

  const optinSecNote = doc.getElementById('optin-security-note');
  if (optinSecNote) {
    const privacyLinkHtml = `<a href="${privacyPolicyUrl}" target="_blank" rel="noopener noreferrer" class="link-inline" id="optin-privacy-link">${t('privacyPolicy', [], lang)}</a>`;
    optinSecNote.innerHTML = t('optinSecurityNote', [privacyLinkHtml], lang);
  }

  const footerDisclaimer = doc.getElementById('footer-disclaimer-text');
  if (footerDisclaimer) {
    footerDisclaimer.innerHTML = t('footerDisclaimer', [], lang);
  }

  const footerReadmeLink = doc.getElementById('footer-link-readme');
  if (footerReadmeLink) {
    footerReadmeLink.href = guideUrl;
  }
  const footerPrivacyLink = doc.getElementById('footer-link-privacy');
  if (footerPrivacyLink) {
    footerPrivacyLink.href = privacyPolicyUrl;
  }

  doc.querySelectorAll('[data-game-label]').forEach((el) => {
    const gKey = el.getAttribute('data-game-label');
    const localized = getGameLocalized(gKey, lang);
    el.textContent = localized.name;
  });
}

/**
 * Popup Controller のスナップショットを DOM へ反映し、UI イベントをコマンドへ接続する薄いアダプター。
 */
export function mountPopupDom(controller, { doc = document, win = window } = {}) {
  const optInModal = doc.getElementById('optin-modal');
  const optInAcceptBtn = doc.getElementById('optin-accept-btn');
  const optinAnalyticsCb = doc.getElementById('optin-analytics-cb');
  const optinCheckboxes = doc.querySelectorAll('.optin-game-cb');
  const optinSecNote = doc.getElementById('optin-security-note');

  const analyticsConsentModal = doc.getElementById('analytics-consent-modal');
  const analyticsConsentAcceptBtn = doc.getElementById('analytics-consent-accept-btn');
  const analyticsConsentDeclineBtn = doc.getElementById('analytics-consent-decline-btn');

  const policyUpdateModal = doc.getElementById('policy-update-modal');
  const policyUpdateDesc = doc.getElementById('policy-update-desc');
  const policyUpdateAcceptBtn = doc.getElementById('policy-update-accept-btn');

  const tabSettingsBtn = doc.getElementById('tab-settings-btn');
  const filterModal = doc.getElementById('game-filter-modal');
  const filterCancelBtn = doc.getElementById('filter-modal-cancel-btn');
  const filterSaveBtn = doc.getElementById('filter-modal-save-btn');
  const filterCheckboxes = doc.querySelectorAll('.filter-game-cb');
  const langRadios = doc.querySelectorAll('input[name="app-lang"]');
  const settingsAnalyticsCb = doc.getElementById('settings-analytics-cb');

  const alertModalEl = doc.getElementById('alert-modal');
  const alertTitleEl = doc.getElementById('alert-modal-title');
  const alertMsgEl = doc.getElementById('alert-modal-message');
  const alertDetailsEl = doc.getElementById('alert-modal-details');
  const alertDetailTextEl = doc.getElementById('alert-modal-detail-text');
  const alertOkBtn = doc.getElementById('alert-modal-ok-btn');

  const gameTabsEl = doc.getElementById('game-tabs');
  const gameTitleEl = doc.getElementById('game-title');
  const gameIconWrapper = doc.getElementById('game-icon-wrapper');
  const gameIconEl = doc.getElementById('game-icon');
  const iconFallbackEl = doc.getElementById('icon-fallback');
  const flavorBadge = doc.getElementById('flavor-badge');

  const badgeEl = doc.getElementById('login-status-badge');
  const uidChipEl = doc.getElementById('uid-copy-chip');
  const uidValueEl = doc.getElementById('uid-value');

  const checkinSiteBtn = doc.getElementById('open-checkin-site-btn');
  const signBadgeEl = doc.getElementById('sign-status-badge');
  const autoSignLabelEl = doc.getElementById('auto-sign-label');
  const autoSignToggle = doc.getElementById('auto-sign-toggle');
  const manualSignBtn = doc.getElementById('manual-sign-btn');

  const giftSiteBtn = doc.getElementById('open-gift-site-btn');
  const redeemLabelEl = doc.getElementById('redeem-status-label');
  const redeemBadgeEl = doc.getElementById('redeem-status-badge');
  const autoRedeemLabelEl = doc.getElementById('auto-redeem-label');
  const autoRedeemToggle = doc.getElementById('auto-redeem-toggle');
  const manualTriggerBtn = doc.getElementById('manual-trigger-btn');

  const logsAccordion = doc.getElementById('logs-accordion');
  const latestLogSummaryEl = doc.getElementById('latest-log-summary');
  const logsContainerEl = doc.getElementById('logs-container');

  const reviewBanner = doc.getElementById('review-prompt-banner');
  const reviewWriteBtn = doc.getElementById('review-prompt-write-btn');
  const reviewLaterBtn = doc.getElementById('review-prompt-later-btn');
  const reviewDismissBtn = doc.getElementById('review-prompt-dismiss-btn');

  const footerReadmeLink = doc.getElementById('footer-link-readme');
  const footerPrivacyLink = doc.getElementById('footer-link-privacy');

  if (optinCheckboxes.length > 0) {
    setupCheckboxMinimumValidation(optinCheckboxes);
  }
  const syncFilterValidation = filterCheckboxes.length > 0
    ? setupCheckboxMinimumValidation(filterCheckboxes)
    : () => {};

  let lastAppliedLang = null;
  let lastTabsSignature = null;
  let lastIconPath = null;
  let lastPolicyDescKey = null;
  let wasSettingsOpen = false;
  let wasAlertOpen = false;
  let devBadgeBound = false;
  let uidCopyResetTimer = null;

  const handleAlertKeyDown = (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      controller.dismissAlert();
    }
  };

  function renderTabs(snapshot) {
    if (!gameTabsEl) return;
    const signature = snapshot.tabs.map(tab => `${tab.key}:${tab.label}`).join('|');
    if (signature !== lastTabsSignature) {
      lastTabsSignature = signature;
      gameTabsEl.innerHTML = '';
      snapshot.tabs.forEach((tab) => {
        const btn = doc.createElement('button');
        btn.className = `tab-btn${tab.active ? ' active' : ''}`;
        btn.dataset.game = tab.key;
        btn.textContent = tab.label;
        gameTabsEl.appendChild(btn);
      });
      return;
    }

    gameTabsEl.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.game === snapshot.activeGameKey);
    });
  }

  function renderGameHeader(snapshot) {
    if (gameTitleEl) gameTitleEl.textContent = snapshot.game.name;
    if (iconFallbackEl) iconFallbackEl.textContent = snapshot.game.shortName;

    if (gameIconWrapper) {
      gameIconWrapper.title = snapshot.game.iconTitle;
      gameIconWrapper.setAttribute('aria-label', snapshot.game.iconTitle);
    }

    if (flavorBadge && snapshot.flavorBadgeText) {
      flavorBadge.textContent = snapshot.flavorBadgeText;
      flavorBadge.style.display = 'inline-block';
    }
    if (snapshot.isDev && flavorBadge && !devBadgeBound) {
      devBadgeBound = true;
      flavorBadge.classList.add('dev-interactive');
      flavorBadge.title = '[DEV] クリックでレビューバナーをリセット＆表示';
      flavorBadge.addEventListener('click', () => {
        controller.resetReviewPromptForDev();
      });
    }

    if (gameIconEl && iconFallbackEl) {
      if (snapshot.game.iconPath) {
        if (lastIconPath !== snapshot.game.iconPath) {
          lastIconPath = snapshot.game.iconPath;
          gameIconEl.src = snapshot.game.iconPath;
        }
        if (gameIconEl.complete) {
          if (gameIconEl.naturalWidth === 0) {
            gameIconEl.style.display = 'none';
            iconFallbackEl.style.display = 'flex';
          } else {
            gameIconEl.style.display = 'block';
            iconFallbackEl.style.display = 'none';
          }
        }
      } else {
        lastIconPath = null;
        gameIconEl.style.display = 'none';
        iconFallbackEl.style.display = 'flex';
      }
    }
  }

  function renderAuthAndCards(snapshot) {
    if (badgeEl) {
      badgeEl.textContent = snapshot.auth.badgeText;
      badgeEl.className = snapshot.auth.badgeClass;
    }

    if (uidChipEl && uidValueEl) {
      if (snapshot.auth.uid) {
        uidValueEl.textContent = snapshot.auth.uid;
        uidChipEl.classList.remove('hidden');
        uidChipEl.setAttribute('aria-label', `UID ${snapshot.auth.uid}`);
      } else {
        uidChipEl.classList.add('hidden');
        uidValueEl.textContent = '--------';
      }
    }

    if (checkinSiteBtn) {
      checkinSiteBtn.textContent = snapshot.auth.signLinkText;
      checkinSiteBtn.classList.toggle('needs-login', snapshot.auth.needsSignLogin);
      checkinSiteBtn.title = snapshot.game.checkinBtnTitle;
    }

    if (giftSiteBtn) {
      giftSiteBtn.textContent = snapshot.auth.redeemLinkText;
      giftSiteBtn.classList.toggle('needs-login', snapshot.auth.needsRedeemLogin);
      giftSiteBtn.title = snapshot.game.giftBtnTitle;
    }

    if (signBadgeEl) {
      signBadgeEl.textContent = snapshot.signStatus.text;
      signBadgeEl.className = snapshot.signStatus.pillClass;
    }
    if (autoSignLabelEl) autoSignLabelEl.textContent = snapshot.autoSignLabel;
    if (autoSignToggle) {
      autoSignToggle.checked = snapshot.autoSignEnabled;
      if (autoSignToggle.parentElement) {
        autoSignToggle.parentElement.title = t('autoSignToggleTitle', [], snapshot.lang);
      }
    }
    if (manualSignBtn) {
      manualSignBtn.disabled = snapshot.manualSignLoading;
      manualSignBtn.classList.toggle('is-loading', snapshot.manualSignLoading);
      const signTitle = t('btnManualSignTitle', [], snapshot.lang);
      manualSignBtn.title = signTitle;
      manualSignBtn.setAttribute('aria-label', signTitle);
    }

    if (redeemLabelEl) redeemLabelEl.textContent = snapshot.redeemStatus.labelText;
    if (redeemBadgeEl) {
      redeemBadgeEl.textContent = snapshot.redeemStatus.badgeText;
      redeemBadgeEl.className = snapshot.redeemStatus.pillClass;
      redeemBadgeEl.title = snapshot.redeemStatus.tooltip;
    }
    if (autoRedeemLabelEl) autoRedeemLabelEl.textContent = snapshot.autoRedeemLabel;
    if (autoRedeemToggle) {
      autoRedeemToggle.checked = snapshot.autoRedeemEnabled;
      if (autoRedeemToggle.parentElement) {
        autoRedeemToggle.parentElement.title = t('autoRedeemToggleTitle', [], snapshot.lang);
      }
    }
    if (manualTriggerBtn) {
      manualTriggerBtn.disabled = snapshot.manualRedeemLoading;
      manualTriggerBtn.classList.toggle('is-loading', snapshot.manualRedeemLoading);
      const redeemTitle = t('btnManualRedeemTitle', [], snapshot.lang);
      manualTriggerBtn.title = redeemTitle;
      manualTriggerBtn.setAttribute('aria-label', redeemTitle);
    }
  }

  function renderLogsSection(snapshot) {
    if (latestLogSummaryEl) {
      latestLogSummaryEl.textContent = snapshot.logs.summaryText;
      latestLogSummaryEl.classList.toggle('has-error', snapshot.logs.hasError);
    }
    if (!logsContainerEl) return;

    logsContainerEl.innerHTML = '';
    if (!snapshot.logs.items.length) {
      const empty = doc.createElement('div');
      empty.textContent = snapshot.logs.emptyText;
      empty.style.color = '#64748b';
      logsContainerEl.appendChild(empty);
      return;
    }

    snapshot.logs.items.forEach((itemData) => {
      const item = doc.createElement('div');
      item.className = itemData.isError ? 'log-item log-error' : 'log-item';
      item.textContent = itemData.formattedText;
      logsContainerEl.appendChild(item);
    });
  }

  function renderModalsAndBanner(snapshot) {
    optInModal?.classList.toggle('hidden', snapshot.blockingModal !== 'optin');
    analyticsConsentModal?.classList.toggle('hidden', snapshot.blockingModal !== 'analytics_consent');
    policyUpdateModal?.classList.toggle('hidden', snapshot.blockingModal !== 'policy_update');

    if (snapshot.blockingModal === 'policy_update' && policyUpdateDesc) {
      const descKey = `${snapshot.lang}:${snapshot.policyUpdateVersion}:${snapshot.privacyPolicyUrl}`;
      if (descKey !== lastPolicyDescKey) {
        lastPolicyDescKey = descKey;
        const linkHtml = `<a href="${snapshot.privacyPolicyUrl}" target="_blank" rel="noopener noreferrer" class="link-inline" id="policy-update-privacy-link">${t('privacyPolicy', [], snapshot.lang)}</a>`;
        policyUpdateDesc.innerHTML = t('policyUpdateDesc', [snapshot.policyUpdateVersion, linkHtml], snapshot.lang);
      }
    }

    const isSettingsOpen = snapshot.settingsModal.open;
    if (isSettingsOpen && !wasSettingsOpen) {
      filterCheckboxes.forEach((cb) => {
        cb.checked = snapshot.settingsModal.enabledGames.includes(cb.value);
      });
      langRadios.forEach((r) => {
        r.checked = r.value === snapshot.settingsModal.language;
      });
      if (settingsAnalyticsCb) {
        settingsAnalyticsCb.checked = snapshot.settingsModal.analyticsEnabled;
      }
      syncFilterValidation();
    }
    wasSettingsOpen = isSettingsOpen;
    filterModal?.classList.toggle('hidden', !isSettingsOpen);

    if (snapshot.alertModal && alertModalEl) {
      if (alertTitleEl) alertTitleEl.textContent = snapshot.alertModal.title;
      if (alertMsgEl) alertMsgEl.textContent = snapshot.alertModal.message;
      if (alertDetailsEl && alertDetailTextEl) {
        if (snapshot.alertModal.detail) {
          alertDetailTextEl.textContent = snapshot.alertModal.detail;
          if (!wasAlertOpen) {
            alertDetailsEl.open = false;
          }
          alertDetailsEl.classList.remove('hidden');
        } else {
          alertDetailsEl.classList.add('hidden');
          alertDetailTextEl.textContent = '';
        }
      }
      alertModalEl.classList.remove('hidden');
      if (!wasAlertOpen) {
        wasAlertOpen = true;
        doc.addEventListener('keydown', handleAlertKeyDown);
        alertOkBtn?.focus();
      }
    } else {
      alertModalEl?.classList.add('hidden');
      if (wasAlertOpen) {
        wasAlertOpen = false;
        doc.removeEventListener('keydown', handleAlertKeyDown);
      }
    }

    if (reviewBanner) {
      reviewBanner.hidden = !snapshot.reviewBannerVisible;
    }
  }

  function render(snapshot) {
    if (snapshot.lang !== lastAppliedLang) {
      applyStaticI18n(doc, snapshot);
      lastAppliedLang = snapshot.lang;
    }
    renderTabs(snapshot);
    renderGameHeader(snapshot);
    renderAuthAndCards(snapshot);
    renderLogsSection(snapshot);
    renderModalsAndBanner(snapshot);
  }

  gameTabsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn?.dataset?.game) {
      controller.selectGame(btn.dataset.game);
    }
  });

  optInAcceptBtn?.addEventListener('click', () => {
    const selected = Array.from(optinCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    const analyticsEnabled = optinAnalyticsCb ? optinAnalyticsCb.checked : true;
    controller.acceptOptIn({ selectedGames: selected, analyticsEnabled });
  });

  analyticsConsentAcceptBtn?.addEventListener('click', () => controller.decideAnalyticsConsent(true));
  analyticsConsentDeclineBtn?.addEventListener('click', () => controller.decideAnalyticsConsent(false));
  policyUpdateAcceptBtn?.addEventListener('click', () => controller.acceptPolicyUpdate());

  optinSecNote?.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      e.preventDefault();
      controller.openPrivacyPolicy();
    }
  });
  policyUpdateDesc?.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      e.preventDefault();
      controller.openPrivacyPolicy();
    }
  });

  footerReadmeLink?.addEventListener('click', (e) => {
    e.preventDefault();
    controller.openGuide();
  });
  footerPrivacyLink?.addEventListener('click', (e) => {
    e.preventDefault();
    controller.openPrivacyPolicy();
  });

  tabSettingsBtn?.addEventListener('click', () => controller.openSettings());
  filterCancelBtn?.addEventListener('click', () => controller.closeSettings());
  filterSaveBtn?.addEventListener('click', () => {
    const selectedGames = Array.from(filterCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    const selectedLangRadio = Array.from(langRadios).find(r => r.checked);
    const language = selectedLangRadio ? selectedLangRadio.value : 'auto';
    const analyticsEnabled = settingsAnalyticsCb ? settingsAnalyticsCb.checked : true;
    controller.saveSettings({ selectedGames, language, analyticsEnabled });
  });

  autoSignToggle?.addEventListener('change', (e) => {
    controller.setAutoSignEnabled(e.target.checked);
  });
  autoRedeemToggle?.addEventListener('change', (e) => {
    controller.setAutoRedeemEnabled(e.target.checked);
  });

  manualSignBtn?.addEventListener('click', () => controller.triggerManualSign());
  manualTriggerBtn?.addEventListener('click', () => controller.triggerManualRedeem());
  alertOkBtn?.addEventListener('click', () => controller.dismissAlert());

  checkinSiteBtn?.addEventListener('click', () => controller.openCheckinSite());
  giftSiteBtn?.addEventListener('click', () => controller.openGiftSite());

  if (gameIconWrapper) {
    gameIconWrapper.addEventListener('click', () => controller.openGiftSite());
    gameIconWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        controller.openGiftSite();
      }
    });
  }

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

  uidChipEl?.addEventListener('click', async () => {
    const result = await controller.copyUid();
    if (!result?.copied) return;
    uidChipEl.classList.add('copied');
    if (uidCopyResetTimer) win.clearTimeout(uidCopyResetTimer);
    uidCopyResetTimer = win.setTimeout(() => {
      uidChipEl.classList.remove('copied');
    }, 1500);
  });

  logsAccordion?.addEventListener('toggle', () => {
    if (logsAccordion.open) {
      controller.recordLogsOpened();
    }
  });

  reviewWriteBtn?.addEventListener('click', () => controller.handleReviewWrite());
  reviewLaterBtn?.addEventListener('click', () => controller.handleReviewLater());
  reviewDismissBtn?.addEventListener('click', () => controller.handleReviewDismiss());

  const unsubscribe = controller.subscribe(render);

  return () => {
    unsubscribe();
    if (uidCopyResetTimer) {
      win.clearTimeout(uidCopyResetTimer);
      uidCopyResetTimer = null;
    }
    if (wasAlertOpen) {
      doc.removeEventListener('keydown', handleAlertKeyDown);
      wasAlertOpen = false;
    }
  };
}

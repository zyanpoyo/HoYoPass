import { GAMES, API_CONFIG, ALARM_NAMES } from '../config/constants.js';
import { defaultStateStore, getHoyoTodayDateString } from '../services/state-store.js';
import { API_STATUS, defaultApiGateway, isNotLoggedIn } from '../services/api-gateway.js';
import {
  getGameLocalized,
  formatDailySignTimeLocal,
  getPrivacyPolicyUrl,
  getGuideUrl,
  t
} from '../utils/i18n.js';

export function updateIntervalLabels(lang) {
  const autoSignLabel = document.getElementById('auto-sign-label');
  const autoRedeemLabel = document.getElementById('auto-redeem-label');

  if (autoSignLabel) {
    autoSignLabel.textContent = t('autoSignLabel', [formatDailySignTimeLocal()], lang);
  }

  if (autoRedeemLabel) {
    const intervalMinutes = API_CONFIG.REDEEM_INTERVAL_MINUTES || 180;
    const intervalStr = (intervalMinutes < 60)
      ? t('intervalLabelMinutes', [intervalMinutes], lang)
      : t('intervalLabelHours', [intervalMinutes / 60], lang);
    autoRedeemLabel.textContent = t('autoRedeemLabel', [intervalStr], lang);
  }
}

export function applyI18nToDom(lang) {
  document.documentElement.lang = lang;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key, [], lang);
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key, [], lang);
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    el.setAttribute('aria-label', t(key, [], lang));
  });

  const optinSecNote = document.getElementById('optin-security-note');
  if (optinSecNote) {
    const privacyLinkHtml = `<a href="${getPrivacyPolicyUrl(lang)}" target="_blank" rel="noopener noreferrer" class="link-inline" id="optin-privacy-link">${t('privacyPolicy', [], lang)}</a>`;
    optinSecNote.innerHTML = t('optinSecurityNote', [privacyLinkHtml], lang);
  }

  const footerDisclaimer = document.getElementById('footer-disclaimer-text');
  if (footerDisclaimer) {
    footerDisclaimer.innerHTML = t('footerDisclaimer', [], lang);
  }

  const footerReadmeLink = document.getElementById('footer-link-readme');
  if (footerReadmeLink) {
    footerReadmeLink.href = getGuideUrl(lang);
  }
  const footerPrivacyLink = document.getElementById('footer-link-privacy');
  if (footerPrivacyLink) {
    footerPrivacyLink.href = getPrivacyPolicyUrl(lang);
  }

  document.querySelectorAll('[data-game-label]').forEach(el => {
    const gKey = el.getAttribute('data-game-label');
    const localized = getGameLocalized(gKey, lang);
    el.textContent = localized.name;
  });

  updateIntervalLabels(lang);
}

function getGameAuthCache(state, gameKey) {
  if (!state.authStateByGame) {
    state.authStateByGame = {};
  }
  if (!state.authStateByGame[gameKey]) {
    state.authStateByGame[gameKey] = { roleRes: null, signInfo: null };
  }
  return state.authStateByGame[gameKey];
}

function updateSiteLinkButton(btnEl, needsLogin, lang) {
  if (!btnEl) return;
  btnEl.textContent = t(needsLogin ? 'btnLoginRequired' : 'btnOfficial', [], lang);
  btnEl.classList.toggle('needs-login', Boolean(needsLogin));
}

/**
 * 認証結果と自動引き換え設定からヘッダバッジおよび各カード公式リンクの表示状態を決定する
 */
export function resolvePopupAuthState({ roleRes = null, signInfo = null, autoRedeemEnabled = false } = {}) {
  const redeemEnabled = Boolean(autoRedeemEnabled);
  const signNotLoggedIn = Boolean(
    signInfo && !signInfo.success && (signInfo.status === API_STATUS.NOT_LOGGED_IN || isNotLoggedIn(signInfo.retcode))
  );

  if (!roleRes) {
    return {
      headerStatus: 'checking',
      needsSignLogin: signNotLoggedIn,
      needsRedeemLogin: false
    };
  }

  if (roleRes.networkError) {
    return {
      headerStatus: 'offline',
      needsSignLogin: signNotLoggedIn,
      needsRedeemLogin: false
    };
  }

  if (roleRes.success && roleRes.role) {
    const redeemBlocked = Boolean(roleRes.hoyoverseNotLoggedIn && redeemEnabled);
    return {
      headerStatus: (redeemBlocked || signNotLoggedIn) ? 'logged_out' : 'online',
      needsSignLogin: signNotLoggedIn,
      needsRedeemLogin: redeemBlocked
    };
  }

  if (
    roleRes.status === API_STATUS.NO_CHARACTER ||
    roleRes.status === API_STATUS.INVALID_ROLE ||
    roleRes.retcode === -1 ||
    roleRes.retcode === -2
  ) {
    return {
      headerStatus: 'no_char',
      needsSignLogin: signNotLoggedIn,
      needsRedeemLogin: false
    };
  }

  if (roleRes.status === API_STATUS.NOT_LOGGED_IN || isNotLoggedIn(roleRes.retcode)) {
    return {
      headerStatus: 'logged_out',
      needsSignLogin: signInfo?.success ? false : true,
      needsRedeemLogin: redeemEnabled
    };
  }

  return {
    headerStatus: 'api_error',
    needsSignLogin: signNotLoggedIn,
    needsRedeemLogin: false
  };
}

/**
 * 手動引き換え結果ダイアログに表示する未ログイン補足オプションを判定する
 */
export function resolveManualRedeemFormatOptions({ roleRes = null, signInfo = null, autoRedeemEnabled = false } = {}) {
  if (!roleRes || roleRes.networkError) {
    return {};
  }
  const redeemNotLoggedIn = Boolean(
    roleRes.hoyoverseNotLoggedIn ||
    (!roleRes.success && (roleRes.status === API_STATUS.NOT_LOGGED_IN || isNotLoggedIn(roleRes.retcode)))
  );
  if (!redeemNotLoggedIn) {
    return {};
  }
  const authState = resolvePopupAuthState({ roleRes, signInfo, autoRedeemEnabled });
  return {
    redeemNotLoggedIn: true,
    needsRedeemLogin: authState.needsRedeemLogin
  };
}

/**
 * 現在のキャッシュ済み認証状態からヘッダ・UID・各カードのログイン導線を再描画する
 */
export function applyPopupAuthView(gameKey, state) {
  if (state.currentGameKey !== gameKey) return;

  const lang = state.currentLang;
  const badgeEl = document.getElementById('login-status-badge');
  const uidChipEl = document.getElementById('uid-copy-chip');
  const uidValueEl = document.getElementById('uid-value');
  const checkinSiteBtn = document.getElementById('open-checkin-site-btn');
  const giftSiteBtn = document.getElementById('open-gift-site-btn');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');
  if (!badgeEl) return;

  const autoRedeemEnabled = autoRedeemToggle ? autoRedeemToggle.checked : Boolean(state.autoRedeemEnabled);
  const cache = getGameAuthCache(state, gameKey);
  const authState = resolvePopupAuthState({
    roleRes: cache.roleRes,
    signInfo: cache.signInfo,
    autoRedeemEnabled
  });

  updateSiteLinkButton(checkinSiteBtn, authState.needsSignLogin, lang);
  updateSiteLinkButton(giftSiteBtn, authState.needsRedeemLogin, lang);

  if (authState.headerStatus === 'checking') {
    badgeEl.textContent = t('statusChecking', [], lang);
    badgeEl.className = 'badge';
    uidChipEl?.classList.add('hidden');
    if (uidValueEl) uidValueEl.textContent = '--------';
    state.currentUid = null;
    return;
  }

  if (authState.headerStatus === 'online' && cache.roleRes?.role) {
    badgeEl.textContent = t('statusOnline', [cache.roleRes.role.nickname], lang);
    badgeEl.className = 'badge online';
    state.currentUid = String(cache.roleRes.role.game_uid || '');
    if (state.currentUid && uidValueEl && uidChipEl) {
      uidValueEl.textContent = state.currentUid;
      uidChipEl.classList.remove('hidden');
      uidChipEl.setAttribute('aria-label', `UID ${state.currentUid}`);
    }
    return;
  }

  uidChipEl?.classList.add('hidden');
  if (uidValueEl) uidValueEl.textContent = '--------';
  state.currentUid = null;

  if (authState.headerStatus === 'no_char') {
    badgeEl.textContent = t('statusNoChar', [], lang);
  } else if (authState.headerStatus === 'api_error') {
    badgeEl.textContent = `${t('statusLoggedOut', [], lang)} (${cache.roleRes?.retcode ?? 'error'})`;
  } else if (authState.headerStatus === 'offline') {
    badgeEl.textContent = t('statusOffline', [], lang);
  } else {
    badgeEl.textContent = t('statusLoggedOut', [], lang);
  }
  badgeEl.className = 'badge offline';
}

export async function updateDailySignStatusView(gameKey, state) {
  const signBadgeEl = document.getElementById('sign-status-badge');
  if (!signBadgeEl) return;

  const config = GAMES[gameKey];
  if (!config) return;

  const lang = state.currentLang;
  signBadgeEl.textContent = t('statusChecking', [], lang);
  signBadgeEl.className = 'status-pill';

  const today = getHoyoTodayDateString();
  const cached = await defaultStateStore.getDailySignRecord(config.gameBiz);
  if (state.currentGameKey !== gameKey) return;

  if (cached && cached.date === today && cached.isSigned) {
    const daysText = cached.totalSignDay ? t('signStatusDays', [cached.totalSignDay], lang) : '';
    signBadgeEl.textContent = `${t('signStatusSigned', [], lang)}${daysText}`;
    signBadgeEl.className = 'status-pill signed';
  }

  try {
    const info = await defaultApiGateway.getDailySignInfo(config, lang);
    if (state.currentGameKey !== gameKey) return;

    const gameAuth = getGameAuthCache(state, gameKey);
    gameAuth.signInfo = info;
    applyPopupAuthView(gameKey, state);

    if (info.success) {
      await defaultStateStore.setDailySignRecord(config.gameBiz, {
        date: info.today || today,
        isSigned: info.isSigned,
        totalSignDay: info.totalSignDay,
        skippedNoChar: false
      });
      const daysText = info.totalSignDay ? t('signStatusDays', [info.totalSignDay], lang) : '';
      if (info.isSigned) {
        signBadgeEl.textContent = `${t('signStatusSigned', [], lang)}${daysText}`;
        signBadgeEl.className = 'status-pill signed';
      } else {
        signBadgeEl.textContent = `${t('signStatusUnsigned', [], lang)}${daysText}`;
        signBadgeEl.className = 'status-pill unsigned';
      }
    } else if (!cached || cached.date !== today || !cached.isSigned) {
      const notLoggedIn = info.status === API_STATUS.NOT_LOGGED_IN || isNotLoggedIn(info.retcode);
      signBadgeEl.textContent = notLoggedIn ? t('statusLoggedOut', [], lang) : t('signStatusSkipped', [], lang);
      signBadgeEl.className = 'status-pill skipped';
    }
  } catch {
    if (state.currentGameKey !== gameKey) return;
    getGameAuthCache(state, gameKey).signInfo = null;
    applyPopupAuthView(gameKey, state);
    if (!cached || cached.date !== today || !cached.isSigned) {
      signBadgeEl.textContent = t('statusOffline', [], lang);
      signBadgeEl.className = 'status-pill skipped';
    }
  }
}

export async function updateRedeemStatusView(gameKey, state) {
  const targetKey = gameKey || state.currentGameKey;
  const labelEl = document.getElementById('redeem-status-label');
  const badgeEl = document.getElementById('redeem-status-badge');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');
  if (!badgeEl) return;

  const config = GAMES[targetKey];
  if (!config) return;

  const lang = state.currentLang;
  const isEnabled = autoRedeemToggle ? autoRedeemToggle.checked : false;

  const intervalMinutes = API_CONFIG.REDEEM_INTERVAL_MINUTES || 180;
  const intervalStr = (intervalMinutes < 60)
    ? t('intervalLabelMinutes', [intervalMinutes], lang)
    : t('intervalLabelHours', [intervalMinutes / 60], lang);

  let nextRunTooltip = t('nextRunTooltipStopped', [], lang);
  if (isEnabled) {
    try {
      if (typeof chrome !== 'undefined' && chrome.alarms?.get) {
        const alarm = await chrome.alarms.get(ALARM_NAMES.AUTO_REDEEM);
        if (alarm && alarm.scheduledTime) {
          const nextDate = new Date(alarm.scheduledTime);
          const hours = String(nextDate.getHours()).padStart(2, '0');
          const minutes = String(nextDate.getMinutes()).padStart(2, '0');
          nextRunTooltip = t('nextRunTooltipScheduled', [`${hours}:${minutes}`], lang);
        } else {
          nextRunTooltip = t('nextRunTooltipRunning', [intervalStr], lang);
        }
      }
    } catch {
      nextRunTooltip = t('nextRunTooltipRunning', [intervalStr], lang);
    }
  }

  badgeEl.title = nextRunTooltip;

  try {
    const stats = await defaultStateStore.getCodeRedeemStats(config.gameBiz);
    if (state.currentGameKey !== targetKey) return;

    if (labelEl) {
      if (stats.activeTotal !== null) {
        labelEl.textContent = stats.activeTotal === 0
          ? t('redeemStatusLabelNone', [], lang)
          : t('redeemStatusLabelActive', [stats.activeClaimed, stats.activeTotal], lang);
      } else {
        labelEl.textContent = t('redeemStatusLabelDefault', [], lang);
        defaultApiGateway.fetchValidCodes(targetKey).then(async (codes) => {
          if (Array.isArray(codes)) {
            await defaultStateStore.setActiveCodes(config.gameBiz, codes);
            if (state.currentGameKey === targetKey) {
              updateRedeemStatusView(targetKey, state);
            }
          }
        }).catch(() => {});
      }
    }

    badgeEl.textContent = t('redeemStatsBadge', [stats.monthlyCount, stats.totalCount], lang);
    badgeEl.className = stats.activeTotal !== null
      ? (stats.activeClaimed >= stats.activeTotal ? 'status-pill signed' : 'status-pill unsigned')
      : 'status-pill';
  } catch {
    if (state.currentGameKey !== targetKey) return;
    if (labelEl) labelEl.textContent = t('redeemStatusLabelDefault', [], lang);
    badgeEl.textContent = t('signStatusSkipped', [], lang);
    badgeEl.className = 'status-pill skipped';
  }
}

export async function updateGameView(state) {
  const targetKey = state.currentGameKey;
  const lang = state.currentLang;
  const config = GAMES[targetKey];
  const localized = getGameLocalized(targetKey, lang);

  const titleEl = document.getElementById('game-title');
  const iconEl = document.getElementById('game-icon');
  const fallbackEl = document.getElementById('icon-fallback');
  const checkinSiteBtn = document.getElementById('open-checkin-site-btn');
  const giftSiteBtn = document.getElementById('open-gift-site-btn');
  const manualSignBtn = document.getElementById('manual-sign-btn');
  const manualTriggerBtn = document.getElementById('manual-trigger-btn');
  const autoSignToggle = document.getElementById('auto-sign-toggle');
  const autoRedeemToggle = document.getElementById('auto-redeem-toggle');

  titleEl.textContent = localized.name;
  fallbackEl.textContent = localized.shortName;

  const wrapperEl = document.getElementById('game-icon-wrapper');
  if (wrapperEl) {
    const label = t('gameIconTitle', [localized.name], lang);
    wrapperEl.title = label;
    wrapperEl.setAttribute('aria-label', label);
  }
  if (checkinSiteBtn) {
    checkinSiteBtn.title = t('btnOfficialSignTitle', [localized.name], lang);
  }
  if (giftSiteBtn) {
    giftSiteBtn.title = t('btnOfficialGiftTitle', [localized.name], lang);
  }
  if (manualSignBtn) {
    manualSignBtn.title = t('btnManualSignTitle', [], lang);
    manualSignBtn.setAttribute('aria-label', t('btnManualSignTitle', [], lang));
  }
  if (manualTriggerBtn) {
    manualTriggerBtn.title = t('btnManualRedeemTitle', [], lang);
    manualTriggerBtn.setAttribute('aria-label', t('btnManualRedeemTitle', [], lang));
  }
  if (autoSignToggle?.parentElement) {
    autoSignToggle.parentElement.title = t('autoSignToggleTitle', [], lang);
  }
  if (autoRedeemToggle?.parentElement) {
    autoRedeemToggle.parentElement.title = t('autoRedeemToggleTitle', [], lang);
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

  const gameAuth = getGameAuthCache(state, targetKey);
  gameAuth.roleRes = null;
  gameAuth.signInfo = null;
  applyPopupAuthView(targetKey, state);

  updateDailySignStatusView(targetKey, state);
  updateRedeemStatusView(targetKey, state);

  try {
    const res = await defaultApiGateway.getUserGameRoles(config.gameBiz);
    if (state.currentGameKey !== targetKey) return;
    gameAuth.roleRes = res;
    applyPopupAuthView(targetKey, state);
  } catch {
    if (state.currentGameKey !== targetKey) return;
    gameAuth.roleRes = { networkError: true };
    applyPopupAuthView(targetKey, state);
  }
}

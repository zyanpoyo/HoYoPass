import {
  GAMES,
  API_CONFIG,
  ALARM_NAMES,
  MESSAGE_TYPES,
  PRIVACY_POLICY_VERSION,
  REVIEW_PROMPT_CONFIG
} from '../config/constants.js';
import { getHoyoTodayDateString, needsPolicyReview } from '../services/state-store.js';
import { API_STATUS, isNotLoggedIn } from '../services/api-gateway.js';
import { formatRedeemResult, formatSignResult, formatLogTimestamp } from '../utils/message-formatter.js';
import {
  resolveLanguage,
  getGameLocalized,
  formatDailySignTimeLocal,
  getPrivacyPolicyUrl,
  getGuideUrl,
  t
} from '../utils/i18n.js';
import { toGaGameKey } from '../services/analytics-service.js';

function isNotLoggedInResult(res) {
  return Boolean(res && (res.status === API_STATUS.NOT_LOGGED_IN || isNotLoggedIn(res.retcode)));
}

function isNoCharacterResult(res) {
  return Boolean(
    res && (
      res.status === API_STATUS.NO_CHARACTER ||
      res.status === API_STATUS.INVALID_ROLE ||
      res.retcode === -1 ||
      res.retcode === -2
    )
  );
}

/**
 * 実行ログが指定ゲームタブに表示対象かどうかを判定する。
 */
export function isLogForGame(log, gameKey) {
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

  const otherNames = [];
  Object.keys(GAMES).forEach((k) => {
    if (k !== gameKey) {
      otherNames.push(GAMES[k]?.name);
      otherNames.push(getGameLocalized(k, 'en')?.name);
    }
  });

  return !otherNames.some(name => name && msg.includes(name));
}

/**
 * 最新ログ1件からアコーディオン見出し用のサマリーを生成する。
 */
export function buildLatestLogSummary(latestLog, lang = 'ja') {
  if (!latestLog) {
    return { text: t('latestLogEmpty', [], lang), isError: false };
  }
  const time = formatLogTimestamp(latestLog.timestamp);
  const timeSuffix = time ? ` (${time})` : '';
  if (latestLog.type === 'ERROR') {
    return { text: t('latestLogError', [timeSuffix], lang), isError: true };
  }
  if (latestLog.type === 'WARN') {
    return { text: t('latestLogWarn', [timeSuffix], lang), isError: false };
  }
  return { text: t('latestLogSuccess', [timeSuffix], lang), isError: false };
}

/**
 * ログ本文先頭に付与された日英ゲーム名プレフィックスを取り除く。
 */
export function stripGamePrefix(rawMessage, gameKey) {
  let cleanMsg = rawMessage || '';
  const jaPrefix = `${GAMES[gameKey]?.name}: `;
  const enPrefix = `${getGameLocalized(gameKey, 'en')?.name}: `;

  if (cleanMsg.startsWith(jaPrefix)) {
    cleanMsg = cleanMsg.slice(jaPrefix.length);
  } else if (cleanMsg.startsWith(enPrefix)) {
    cleanMsg = cleanMsg.slice(enPrefix.length);
  }
  return cleanMsg;
}

/**
 * 認証結果と自動引き換え設定からヘッダバッジおよび各カード公式リンクの表示状態を決定する。
 */
export function resolvePopupAuthState({ roleRes = null, signInfo = null, autoRedeemEnabled = false } = {}) {
  const redeemEnabled = Boolean(autoRedeemEnabled);
  const signNotLoggedIn = Boolean(signInfo && !signInfo.success && isNotLoggedInResult(signInfo));

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

  if (isNoCharacterResult(roleRes)) {
    return {
      headerStatus: 'no_char',
      needsSignLogin: signNotLoggedIn,
      needsRedeemLogin: false
    };
  }

  if (isNotLoggedInResult(roleRes)) {
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
 * 手動引き換え結果ダイアログに表示する未ログイン補足オプションを判定する。
 */
export function resolveManualRedeemFormatOptions({ roleRes = null, signInfo = null, autoRedeemEnabled = false } = {}) {
  if (!roleRes || roleRes.networkError) {
    return {};
  }
  const redeemNotLoggedIn = Boolean(
    roleRes.hoyoverseNotLoggedIn ||
    (!roleRes.success && isNotLoggedInResult(roleRes))
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

function resolveBlockingModal(settings) {
  if (!settings?.optInAccepted) {
    return 'optin';
  }
  if (!settings?.analyticsConsentReviewed) {
    return 'analytics_consent';
  }
  if (needsPolicyReview(settings)) {
    return 'policy_update';
  }
  return null;
}

function normalizeSelectedGames(selectedGames) {
  const allGames = Object.keys(GAMES);
  if (!Array.isArray(selectedGames)) {
    return allGames;
  }
  const valid = selectedGames.filter((k, idx) => GAMES[k] && selectedGames.indexOf(k) === idx);
  return valid.length > 0 ? valid : allGames;
}

function normalizeLanguageSetting(language) {
  return (language === 'ja' || language === 'en') ? language : 'auto';
}

function formatIntervalLabel(intervalMinutes, lang) {
  const mins = intervalMinutes || 180;
  return mins < 60
    ? t('intervalLabelMinutes', [mins], lang)
    : t('intervalLabelHours', [mins / 60], lang);
}

function formatAlarmTimeHHMM(scheduledTime) {
  const nextDate = new Date(scheduledTime);
  const hours = String(nextDate.getHours()).padStart(2, '0');
  const minutes = String(nextDate.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function incrementCounter(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function decrementCounter(map, key) {
  const cur = map.get(key) || 0;
  if (cur <= 1) {
    map.delete(key);
  } else {
    map.set(key, cur - 1);
  }
}

function consumeCounter(map, key) {
  const cur = map.get(key) || 0;
  if (cur <= 0) return false;
  decrementCounter(map, key);
  return true;
}

/**
 * DOM 非依存の Popup 状態遷移・表示モデルコントローラを生成する。
 */
export function createPopupController(adapter) {
  const {
    config = API_CONFIG,
    clock = { now: () => Date.now() },
    runtime,
    alarms,
    tabs,
    clipboard,
    store,
    gateway,
    reviewPrompt
  } = adapter;

  let enabledGames = Object.keys(GAMES);
  let currentGameKey = enabledGames[0] || 'GENSHIN';
  let languageSetting = 'auto';
  let currentLang = resolveLanguage('auto', runtime?.uiLanguage || '');
  let autoSignEnabled = false;
  let autoRedeemEnabled = false;
  let analyticsEnabled = false;

  const authStateByGame = {};

  let signStatus = {
    text: t('statusChecking', [], currentLang),
    pillClass: 'status-pill'
  };
  let redeemStatus = {
    labelText: t('redeemStatusLabelDefault', [], currentLang),
    badgeText: t('statusChecking', [], currentLang),
    pillClass: 'status-pill',
    tooltip: t('nextRunTooltipStopped', [], currentLang)
  };
  let logsState = {
    summaryText: t('latestLogEmpty', [], currentLang),
    hasError: false,
    items: [],
    emptyText: t('noLogs', [], currentLang)
  };

  let manualSignLoading = false;
  let manualRedeemLoading = false;
  let blockingModal = null;
  let settingsModal = {
    open: false,
    enabledGames: [...enabledGames],
    language: 'auto',
    analyticsEnabled: false
  };
  let alertModal = null;
  let reviewBannerVisible = false;

  let gameLoadSeq = 0;
  let roleLoadSeq = 0;
  let signLoadSeq = 0;
  let redeemLoadSeq = 0;
  let logsLoadSeq = 0;
  let disposed = false;

  const inFlightCodeFetchByGame = new Map();
  const selfSignWriteByBiz = new Map();
  const selfRedeemWriteByBiz = new Map();
  const pendingTasks = new Set();
  const listeners = new Set();
  let unsubscribeStore = null;

  function trackTask(promise) {
    const p = Promise.resolve(promise).finally(() => {
      pendingTasks.delete(p);
    });
    pendingTasks.add(p);
    return p;
  }

  function getGameAuthCache(gameKey) {
    if (!authStateByGame[gameKey]) {
      authStateByGame[gameKey] = { roleRes: null, signInfo: null };
    }
    return authStateByGame[gameKey];
  }

  function trackGAEvent(eventName, params = {}) {
    try {
      Promise.resolve(
        runtime.sendMessage({
          type: MESSAGE_TYPES.TRACK_GA_EVENT,
          eventName,
          params
        })
      ).catch(() => {});
    } catch {
      // GA4 送信の失敗で UI 操作を止めない
    }
  }

  function buildAuthSnapshot() {
    const cache = getGameAuthCache(currentGameKey);
    const authState = resolvePopupAuthState({
      roleRes: cache.roleRes,
      signInfo: cache.signInfo,
      autoRedeemEnabled
    });

    let badgeText;
    let badgeClass;
    let uid = null;

    if (authState.headerStatus === 'checking') {
      badgeText = t('statusChecking', [], currentLang);
      badgeClass = 'badge';
    } else if (authState.headerStatus === 'online' && cache.roleRes?.role) {
      badgeText = t('statusOnline', [cache.roleRes.role.nickname], currentLang);
      badgeClass = 'badge online';
      uid = cache.roleRes.role.game_uid ? String(cache.roleRes.role.game_uid) : null;
    } else {
      badgeClass = 'badge offline';
      if (authState.headerStatus === 'no_char') {
        badgeText = t('statusNoChar', [], currentLang);
      } else if (authState.headerStatus === 'api_error') {
        badgeText = `${t('statusLoggedOut', [], currentLang)} (${cache.roleRes?.retcode ?? 'error'})`;
      } else if (authState.headerStatus === 'offline') {
        badgeText = t('statusOffline', [], currentLang);
      } else {
        badgeText = t('statusLoggedOut', [], currentLang);
      }
    }

    return {
      headerStatus: authState.headerStatus,
      badgeText,
      badgeClass,
      uid,
      needsSignLogin: authState.needsSignLogin,
      needsRedeemLogin: authState.needsRedeemLogin,
      signLinkText: t(authState.needsSignLogin ? 'btnLoginRequired' : 'btnOfficial', [], currentLang),
      redeemLinkText: t(authState.needsRedeemLogin ? 'btnLoginRequired' : 'btnOfficial', [], currentLang)
    };
  }

  function getSnapshot() {
    const gameConfig = GAMES[currentGameKey] || GAMES.GENSHIN;
    const localized = getGameLocalized(currentGameKey, currentLang);
    const intervalStr = formatIntervalLabel(config.REDEEM_INTERVAL_MINUTES, currentLang);

    return {
      lang: currentLang,
      languageSetting,
      flavorBadgeText: config.FLAVOR_UI?.badgeText || '',
      isDev: Boolean(config.IS_DEV),
      enabledGames: [...enabledGames],
      activeGameKey: currentGameKey,
      game: {
        key: currentGameKey,
        name: localized.name,
        shortName: localized.shortName,
        iconPath: gameConfig?.iconPath || '',
        giftSiteUrl: localized.giftSiteUrl || '',
        checkInSiteUrl: gameConfig?.checkInSiteUrl || '',
        iconTitle: t('gameIconTitle', [localized.name], currentLang),
        checkinBtnTitle: t('btnOfficialSignTitle', [localized.name], currentLang),
        giftBtnTitle: t('btnOfficialGiftTitle', [localized.name], currentLang)
      },
      tabs: enabledGames.map((k) => {
        const loc = getGameLocalized(k, currentLang);
        return {
          key: k,
          label: loc.tabLabel || loc.name,
          active: k === currentGameKey
        };
      }),
      auth: buildAuthSnapshot(),
      autoSignEnabled,
      autoRedeemEnabled,
      autoSignLabel: t('autoSignLabel', [formatDailySignTimeLocal()], currentLang),
      autoRedeemLabel: t('autoRedeemLabel', [intervalStr], currentLang),
      signStatus: { ...signStatus },
      manualSignLoading,
      redeemStatus: { ...redeemStatus },
      manualRedeemLoading,
      logs: {
        summaryText: logsState.summaryText,
        hasError: logsState.hasError,
        items: logsState.items.map(item => ({ ...item })),
        emptyText: logsState.emptyText
      },
      blockingModal,
      policyUpdateVersion: PRIVACY_POLICY_VERSION,
      privacyPolicyUrl: getPrivacyPolicyUrl(currentLang),
      guideUrl: getGuideUrl(currentLang),
      settingsModal: {
        open: settingsModal.open,
        enabledGames: [...settingsModal.enabledGames],
        language: settingsModal.language,
        analyticsEnabled: settingsModal.analyticsEnabled
      },
      alertModal: alertModal ? { ...alertModal } : null,
      reviewBannerVisible
    };
  }

  function emit() {
    if (disposed) return;
    const snap = getSnapshot();
    for (const listener of [...listeners]) {
      listener(snap);
    }
  }

  function applySettingsState(settings) {
    enabledGames = normalizeSelectedGames(settings?.enabledGames);
    currentGameKey = settings?.activeGameKey && enabledGames.includes(settings.activeGameKey)
      ? settings.activeGameKey
      : enabledGames[0];
    languageSetting = normalizeLanguageSetting(settings?.language);
    currentLang = resolveLanguage(languageSetting, runtime?.uiLanguage || '');
    autoSignEnabled = Boolean(settings?.autoSignEnabled);
    autoRedeemEnabled = Boolean(settings?.autoRedeemEnabled);
    analyticsEnabled = Boolean(settings?.analyticsEnabled);
  }

  async function refreshReviewBanner() {
    if (disposed) return;
    if (blockingModal !== null) {
      reviewBannerVisible = false;
      emit();
      return;
    }
    const show = await reviewPrompt.shouldShowReviewPrompt(clock.now());
    if (disposed) return;
    reviewBannerVisible = blockingModal === null ? Boolean(show) : false;
    emit();
  }

  async function loadRoleStatus(gameKey, gameSeq = gameLoadSeq) {
    const reqSeq = ++roleLoadSeq;
    const gameConfig = GAMES[gameKey];
    if (!gameConfig) return;

    const isStale = () => disposed || gameSeq !== gameLoadSeq || reqSeq !== roleLoadSeq || currentGameKey !== gameKey;

    try {
      const res = await gateway.getUserGameRoles(gameConfig.gameBiz);
      if (isStale()) return;
      getGameAuthCache(gameKey).roleRes = res;
      emit();
    } catch {
      if (isStale()) return;
      getGameAuthCache(gameKey).roleRes = { networkError: true };
      emit();
    }
  }

  async function loadDailySignStatus(gameKey, { fetchRemote = true, gameSeq = gameLoadSeq } = {}) {
    const reqSeq = ++signLoadSeq;
    const gameConfig = GAMES[gameKey];
    if (!gameConfig) return;

    const isStale = () => disposed || gameSeq !== gameLoadSeq || reqSeq !== signLoadSeq || currentGameKey !== gameKey;
    const lang = currentLang;

    if (fetchRemote) {
      signStatus = {
        text: t('statusChecking', [], lang),
        pillClass: 'status-pill'
      };
      emit();
    }

    const today = getHoyoTodayDateString(clock.now());
    const cached = await store.getDailySignRecord(gameConfig.gameBiz);
    if (isStale()) return;

    if (cached && cached.date === today && cached.isSigned) {
      const daysText = cached.totalSignDay ? t('signStatusDays', [cached.totalSignDay], lang) : '';
      signStatus = {
        text: `${t('signStatusSigned', [], lang)}${daysText}`,
        pillClass: 'status-pill signed'
      };
      emit();
    } else if (!fetchRemote) {
      if (cached && cached.date === today && (cached.skippedNoChar || cached.captchaBlocked)) {
        signStatus = {
          text: t('signStatusSkipped', [], lang),
          pillClass: 'status-pill skipped'
        };
        emit();
      }
      return;
    }

    if (!fetchRemote) {
      return;
    }

    try {
      const info = await gateway.getDailySignInfo(gameConfig, lang);
      if (isStale()) return;

      getGameAuthCache(gameKey).signInfo = info;

      if (info.success) {
        incrementCounter(selfSignWriteByBiz, gameConfig.gameBiz);
        try {
          await store.setDailySignRecord(gameConfig.gameBiz, {
            date: info.today || today,
            isSigned: info.isSigned,
            totalSignDay: info.totalSignDay,
            skippedNoChar: false
          });
        } catch (writeErr) {
          decrementCounter(selfSignWriteByBiz, gameConfig.gameBiz);
          throw writeErr;
        }
        if (isStale()) return;

        const daysText = info.totalSignDay ? t('signStatusDays', [info.totalSignDay], lang) : '';
        signStatus = info.isSigned
          ? { text: `${t('signStatusSigned', [], lang)}${daysText}`, pillClass: 'status-pill signed' }
          : { text: `${t('signStatusUnsigned', [], lang)}${daysText}`, pillClass: 'status-pill unsigned' };
      } else if (!cached || cached.date !== today || !cached.isSigned) {
        signStatus = {
          text: isNotLoggedInResult(info) ? t('statusLoggedOut', [], lang) : t('signStatusSkipped', [], lang),
          pillClass: 'status-pill skipped'
        };
      }
      emit();
    } catch {
      if (isStale()) return;
      getGameAuthCache(gameKey).signInfo = null;
      if (!cached || cached.date !== today || !cached.isSigned) {
        signStatus = {
          text: t('statusOffline', [], lang),
          pillClass: 'status-pill skipped'
        };
      }
      emit();
    }
  }

  async function resolveRedeemTooltip(lang) {
    if (!autoRedeemEnabled) {
      return t('nextRunTooltipStopped', [], lang);
    }
    const intervalStr = formatIntervalLabel(config.REDEEM_INTERVAL_MINUTES, lang);
    try {
      if (alarms?.get) {
        const alarm = await alarms.get(ALARM_NAMES.AUTO_REDEEM);
        if (alarm && alarm.scheduledTime) {
          return t('nextRunTooltipScheduled', [formatAlarmTimeHHMM(alarm.scheduledTime)], lang);
        }
      }
      return t('nextRunTooltipRunning', [intervalStr], lang);
    } catch {
      return t('nextRunTooltipRunning', [intervalStr], lang);
    }
  }

  async function loadRedeemStatus(gameKey, { allowCodeFetch = true, gameSeq = gameLoadSeq } = {}) {
    const reqSeq = ++redeemLoadSeq;
    const gameConfig = GAMES[gameKey];
    if (!gameConfig) return;

    const isStale = () => disposed || gameSeq !== gameLoadSeq || reqSeq !== redeemLoadSeq || currentGameKey !== gameKey;
    const lang = currentLang;

    const tooltip = await resolveRedeemTooltip(lang);
    if (isStale()) return;

    try {
      const stats = await store.getCodeRedeemStats(gameConfig.gameBiz);
      if (isStale()) return;

      let labelText;
      let pillClass;
      if (stats.activeTotal !== null) {
        labelText = stats.activeTotal === 0
          ? t('redeemStatusLabelNone', [], lang)
          : t('redeemStatusLabelActive', [stats.activeClaimed, stats.activeTotal], lang);
        pillClass = stats.activeClaimed >= stats.activeTotal ? 'status-pill signed' : 'status-pill unsigned';
      } else {
        labelText = t('redeemStatusLabelDefault', [], lang);
        pillClass = 'status-pill';

        if (allowCodeFetch && !inFlightCodeFetchByGame.has(gameKey)) {
          const fetchPromise = Promise.resolve()
            .then(() => gateway.fetchValidCodes(gameKey))
            .then(async (codes) => {
              if (!Array.isArray(codes) || disposed) return;
              incrementCounter(selfRedeemWriteByBiz, gameConfig.gameBiz);
              try {
                await store.setActiveCodes(gameConfig.gameBiz, codes);
              } catch (writeErr) {
                decrementCounter(selfRedeemWriteByBiz, gameConfig.gameBiz);
                throw writeErr;
              }
              if (!disposed && currentGameKey === gameKey) {
                await loadRedeemStatus(gameKey, { allowCodeFetch: false, gameSeq: gameLoadSeq });
              }
            })
            .catch(() => {})
            .finally(() => {
              inFlightCodeFetchByGame.delete(gameKey);
            });
          inFlightCodeFetchByGame.set(gameKey, fetchPromise);
          trackTask(fetchPromise);
        }
      }

      redeemStatus = {
        labelText,
        badgeText: t('redeemStatsBadge', [stats.monthlyCount, stats.totalCount], lang),
        pillClass,
        tooltip
      };
      emit();
    } catch {
      if (isStale()) return;
      redeemStatus = {
        labelText: t('redeemStatusLabelDefault', [], lang),
        badgeText: t('signStatusSkipped', [], lang),
        pillClass: 'status-pill skipped',
        tooltip
      };
      emit();
    }
  }

  async function loadLogs(gameKey = currentGameKey, gameSeq = gameLoadSeq) {
    const reqSeq = ++logsLoadSeq;
    const lang = currentLang;
    const isStale = () => disposed || gameSeq !== gameLoadSeq || reqSeq !== logsLoadSeq || currentGameKey !== gameKey;

    const allLogs = await store.getExecutionLogs();
    if (isStale()) return;

    const filtered = allLogs.filter(log => isLogForGame(log, gameKey));
    const summary = buildLatestLogSummary(filtered[0], lang);

    logsState = {
      summaryText: summary.text,
      hasError: summary.isError,
      items: filtered.map(log => ({
        isError: log.type === 'ERROR',
        formattedText: `[${formatLogTimestamp(log.timestamp)}] ${stripGamePrefix(log.message || log.type || '', gameKey)}`
      })),
      emptyText: t('noLogs', [], lang)
    };
    emit();
  }

  async function loadGameView() {
    if (disposed) return;
    const gameSeq = ++gameLoadSeq;
    const targetKey = currentGameKey;
    const cache = getGameAuthCache(targetKey);
    cache.roleRes = null;
    cache.signInfo = null;

    emit();

    await Promise.all([
      loadRoleStatus(targetKey, gameSeq),
      loadDailySignStatus(targetKey, { fetchRemote: true, gameSeq }),
      loadRedeemStatus(targetKey, { allowCodeFetch: true, gameSeq }),
      loadLogs(targetKey, gameSeq)
    ]);
  }

  function handleStoreChanges(event) {
    if (disposed || !event) return;
    if (event.logsChanged) {
      trackTask(loadLogs(currentGameKey, gameLoadSeq));
    }
    const relevantBiz = GAMES[currentGameKey]?.gameBiz;
    if (!relevantBiz) return;

    if (event.redeemChangedBiz?.includes(relevantBiz)) {
      if (!consumeCounter(selfRedeemWriteByBiz, relevantBiz)) {
        trackTask(loadRedeemStatus(currentGameKey, { allowCodeFetch: false, gameSeq: gameLoadSeq }));
      }
    }
    if (event.signChangedBiz?.includes(relevantBiz)) {
      if (!consumeCounter(selfSignWriteByBiz, relevantBiz)) {
        trackTask(loadDailySignStatus(currentGameKey, { fetchRemote: false, gameSeq: gameLoadSeq }));
      }
    }
  }

  async function init() {
    const settings = await store.getSettings();
    if (disposed) return getSnapshot();

    applySettingsState(settings);
    blockingModal = resolveBlockingModal(settings);
    await runtime.syncConsentBadge();
    if (disposed) return getSnapshot();

    await refreshReviewBanner();
    if (disposed) return getSnapshot();

    if (typeof store.subscribeChanges === 'function') {
      unsubscribeStore = store.subscribeChanges(handleStoreChanges);
    }

    await loadGameView();
    return getSnapshot();
  }

  async function selectGame(gameKey) {
    if (disposed || !GAMES[gameKey] || gameKey === currentGameKey) return;
    currentGameKey = gameKey;
    await store.updateSettings({ activeGameKey: currentGameKey });
    if (disposed) return;
    await loadGameView();
  }

  async function acceptOptIn({ selectedGames, analyticsEnabled: optInAnalytics = true } = {}) {
    if (disposed) return;
    const chosenGames = normalizeSelectedGames(selectedGames);
    if (!chosenGames.includes(currentGameKey)) {
      currentGameKey = chosenGames[0];
    }

    const updated = await store.updateSettings({
      optInAccepted: true,
      autoSignEnabled: true,
      autoRedeemEnabled: true,
      enabledGames: chosenGames,
      activeGameKey: currentGameKey,
      analyticsEnabled: Boolean(optInAnalytics),
      analyticsConsentReviewed: true,
      agreedPolicyVersion: PRIVACY_POLICY_VERSION
    });
    if (disposed) return;

    applySettingsState(updated);
    blockingModal = resolveBlockingModal(updated);
    await runtime.syncConsentBadge();
    if (disposed) return;

    await Promise.all([
      refreshReviewBanner(),
      loadGameView()
    ]);

    trackGAEvent('onboarding_complete', {
      genshin_enabled: chosenGames.includes('GENSHIN'),
      hsr_enabled: chosenGames.includes('STAR_RAIL'),
      zzz_enabled: chosenGames.includes('ZZZ'),
      lang: currentLang
    });

    trackTask(
      Promise.resolve(runtime.sendMessage({ type: MESSAGE_TYPES.TRIGGER_INITIAL_CATCH_UP }))
        .then(async () => {
          if (disposed) return;
          const seq = gameLoadSeq;
          await Promise.all([
            loadDailySignStatus(currentGameKey, { fetchRemote: true, gameSeq: seq }),
            loadRedeemStatus(currentGameKey, { allowCodeFetch: true, gameSeq: seq }),
            loadLogs(currentGameKey, seq)
          ]);
        })
        .catch(() => {})
    );
  }

  async function decideAnalyticsConsent(accepted) {
    if (disposed) return;
    const patch = accepted
      ? {
          analyticsEnabled: true,
          analyticsConsentReviewed: true,
          agreedPolicyVersion: PRIVACY_POLICY_VERSION
        }
      : {
          analyticsEnabled: false,
          analyticsConsentReviewed: true
        };

    const updated = await store.updateSettings(patch);
    if (disposed) return;

    await runtime.syncConsentBadge();
    if (disposed) return;

    applySettingsState(updated);
    blockingModal = resolveBlockingModal(updated);
    await refreshReviewBanner();
  }

  async function acceptPolicyUpdate() {
    if (disposed) return;
    const updated = await store.updateSettings({
      agreedPolicyVersion: PRIVACY_POLICY_VERSION
    });
    if (disposed) return;

    await runtime.syncConsentBadge();
    if (disposed) return;

    applySettingsState(updated);
    blockingModal = resolveBlockingModal(updated);
    await refreshReviewBanner();
  }

  async function openSettings() {
    if (disposed) return;
    const curSettings = await store.getSettings();
    if (disposed) return;

    settingsModal = {
      open: true,
      enabledGames: normalizeSelectedGames(curSettings?.enabledGames),
      language: normalizeLanguageSetting(curSettings?.language),
      analyticsEnabled: Boolean(curSettings?.analyticsEnabled)
    };
    emit();
  }

  function closeSettings() {
    if (disposed || !settingsModal.open) return;
    settingsModal = { ...settingsModal, open: false };
    emit();
  }

  async function saveSettings({ selectedGames, language, analyticsEnabled: nextAnalytics } = {}) {
    if (disposed) return;
    const validSelectedGames = normalizeSelectedGames(selectedGames);
    if (!validSelectedGames.includes(currentGameKey)) {
      currentGameKey = validSelectedGames[0];
    }
    const chosenLangSetting = normalizeLanguageSetting(language);

    const updated = await store.updateSettings({
      enabledGames: validSelectedGames,
      activeGameKey: currentGameKey,
      language: chosenLangSetting,
      analyticsEnabled: Boolean(nextAnalytics),
      analyticsConsentReviewed: true
    });
    if (disposed) return;

    await runtime.syncConsentBadge();
    if (disposed) return;

    applySettingsState(updated);
    blockingModal = resolveBlockingModal(updated);
    settingsModal = {
      open: false,
      enabledGames: [...enabledGames],
      language: languageSetting,
      analyticsEnabled
    };

    trackGAEvent('ui_action', {
      action_type: 'change_settings',
      game: 'none',
      lang: currentLang
    });

    await Promise.all([
      refreshReviewBanner(),
      loadGameView()
    ]);
  }

  async function setAutoSignEnabled(enabled) {
    if (disposed) return;
    autoSignEnabled = Boolean(enabled);
    emit();
    await store.updateSettings({ autoSignEnabled });
  }

  async function setAutoRedeemEnabled(enabled) {
    if (disposed) return;
    autoRedeemEnabled = Boolean(enabled);
    emit();
    await store.updateSettings({ autoRedeemEnabled });
    if (disposed) return;
    await loadRedeemStatus(currentGameKey, { allowCodeFetch: true, gameSeq: gameLoadSeq });
  }

  async function triggerManualSign() {
    if (disposed || manualSignLoading) return;
    const targetGameKey = currentGameKey;
    manualSignLoading = true;
    emit();

    try {
      const resp = await runtime.sendMessage({
        type: MESSAGE_TYPES.TRIGGER_MANUAL_SIGN,
        gameKey: targetGameKey
      });
      if (disposed) return;
      const formatted = formatSignResult(resp, currentLang);
      alertModal = {
        title: formatted.title,
        message: formatted.message,
        detail: formatted.detail ?? null
      };
    } catch (err) {
      if (disposed) return;
      alertModal = {
        title: t('signCardTitle', [], currentLang),
        message: err?.message || 'Error',
        detail: err?.message ?? null
      };
    } finally {
      manualSignLoading = false;
      emit();
    }

    if (disposed) return;
    const tasks = [loadLogs(currentGameKey, gameLoadSeq)];
    if (currentGameKey === targetGameKey) {
      tasks.push(loadDailySignStatus(targetGameKey, { fetchRemote: true, gameSeq: gameLoadSeq }));
    }
    await Promise.all(tasks);
  }

  async function triggerManualRedeem() {
    if (disposed || manualRedeemLoading) return;
    const targetGameKey = currentGameKey;
    manualRedeemLoading = true;
    emit();

    try {
      const resp = await runtime.sendMessage({
        type: MESSAGE_TYPES.TRIGGER_MANUAL_REDEEM,
        gameKey: targetGameKey
      });
      if (disposed) return;

      const cache = authStateByGame[targetGameKey];
      const options = resolveManualRedeemFormatOptions({
        roleRes: cache?.roleRes,
        signInfo: cache?.signInfo,
        autoRedeemEnabled
      });
      const formatted = formatRedeemResult(resp, currentLang, options);
      alertModal = {
        title: formatted.title,
        message: formatted.message,
        detail: formatted.detail ?? null
      };

      const gameRes = resp?.results?.[targetGameKey];
      if (cache?.roleRes && gameRes) {
        if (isNotLoggedInResult(gameRes)) {
          cache.roleRes = { ...cache.roleRes, hoyoverseNotLoggedIn: true };
        } else if (gameRes.success && !gameRes.skipped) {
          cache.roleRes = { ...cache.roleRes, hoyoverseNotLoggedIn: false };
        }
      }
    } catch (err) {
      if (disposed) return;
      alertModal = {
        title: t('redeemCardTitle', [], currentLang),
        message: err?.message || 'Error',
        detail: err?.message ?? null
      };
    } finally {
      manualRedeemLoading = false;
      emit();
    }

    if (disposed) return;
    const tasks = [loadLogs(currentGameKey, gameLoadSeq)];
    if (currentGameKey === targetGameKey) {
      tasks.push(loadRedeemStatus(targetGameKey, { allowCodeFetch: true, gameSeq: gameLoadSeq }));
    }
    await Promise.all(tasks);
  }

  function dismissAlert() {
    if (disposed || !alertModal) return;
    alertModal = null;
    emit();
  }

  function openCheckinSite() {
    const gameConfig = GAMES[currentGameKey];
    if (!gameConfig?.checkInSiteUrl) return;
    trackGAEvent('ui_action', {
      action_type: 'open_official_site',
      game: toGaGameKey(currentGameKey),
      lang: currentLang
    });
    tabs.open(gameConfig.checkInSiteUrl);
  }

  function openGiftSite() {
    const localized = getGameLocalized(currentGameKey, currentLang);
    if (!localized?.giftSiteUrl) return;
    trackGAEvent('ui_action', {
      action_type: 'open_official_site',
      game: toGaGameKey(currentGameKey),
      lang: currentLang
    });
    tabs.open(localized.giftSiteUrl);
  }

  function openGuide() {
    tabs.open(getGuideUrl(currentLang));
  }

  function openPrivacyPolicy() {
    tabs.open(getPrivacyPolicyUrl(currentLang));
  }

  async function copyUid() {
    const uid = buildAuthSnapshot().uid;
    if (!uid) return { copied: false };
    try {
      await clipboard.writeText(uid);
      trackGAEvent('ui_action', {
        action_type: 'uid_copy',
        game: toGaGameKey(currentGameKey),
        lang: currentLang
      });
      return { copied: true };
    } catch (err) {
      console.error('Failed to copy UID to clipboard:', err);
      return { copied: false };
    }
  }

  function recordLogsOpened() {
    trackGAEvent('ui_action', {
      action_type: 'open_log',
      game: toGaGameKey(currentGameKey),
      lang: currentLang
    });
  }

  async function handleReviewWrite() {
    if (disposed) return;
    reviewBannerVisible = false;
    emit();
    await reviewPrompt.updateReviewPromptState({ status: 'completed' });
    trackGAEvent('ui_action', { action_type: 'review_prompt_write', game: 'none', lang: currentLang });
    tabs.open(REVIEW_PROMPT_CONFIG.REVIEW_URL);
  }

  async function handleReviewLater() {
    if (disposed) return;
    reviewBannerVisible = false;
    emit();
    await reviewPrompt.postponeReviewPrompt(clock.now());
    trackGAEvent('ui_action', { action_type: 'review_prompt_later', game: 'none', lang: currentLang });
  }

  async function handleReviewDismiss() {
    if (disposed) return;
    reviewBannerVisible = false;
    emit();
    await reviewPrompt.updateReviewPromptState({ status: 'dismissed' });
    trackGAEvent('ui_action', { action_type: 'review_prompt_dismiss', game: 'none', lang: currentLang });
  }

  async function resetReviewPromptForDev() {
    if (disposed || !config.IS_DEV) return;
    await reviewPrompt.updateReviewPromptState({
      successCount: REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT,
      status: 'pending',
      postponeCount: 0,
      nextEligibleTimestamp: 0
    });
    await refreshReviewBanner();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    listeners.add(listener);
    listener(getSnapshot());
    return () => {
      listeners.delete(listener);
    };
  }

  async function whenIdle() {
    while (pendingTasks.size > 0) {
      await Promise.allSettled([...pendingTasks]);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    gameLoadSeq++;
    if (unsubscribeStore) {
      unsubscribeStore();
      unsubscribeStore = null;
    }
    listeners.clear();
  }

  return {
    init,
    dispose,
    getSnapshot,
    subscribe,
    whenIdle,
    selectGame,
    acceptOptIn,
    decideAnalyticsConsent,
    acceptPolicyUpdate,
    openSettings,
    closeSettings,
    saveSettings,
    setAutoSignEnabled,
    setAutoRedeemEnabled,
    triggerManualSign,
    triggerManualRedeem,
    dismissAlert,
    openCheckinSite,
    openGiftSite,
    openGuide,
    openPrivacyPolicy,
    copyUid,
    recordLogsOpened,
    handleReviewWrite,
    handleReviewLater,
    handleReviewDismiss,
    resetReviewPromptForDev
  };
}

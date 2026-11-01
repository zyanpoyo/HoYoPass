import { getGameLocalized, t } from './i18n.js';

function resolveGameDisplayName(gameKey, res, lang) {
  const localizedGame = getGameLocalized(gameKey, lang);
  return lang === 'en' ? localizedGame.name : (res?.gameName || localizedGame.name || gameKey);
}

function isLoginErrorResult(res) {
  if (!res) return false;
  const reason = res.reason || '';
  return res.retcode === -100 ||
    res.retcode === -1071 ||
    reason === 'LOGIN_REQUIRED' ||
    reason.includes('-100') ||
    reason.includes('-1071') ||
    reason.includes('Login expired') ||
    reason.includes('Not logged in');
}

function isNoCharacterError(res) {
  if (!res) return false;
  const reason = res.reason || '';
  return res.retcode === -1 ||
    res.retcode === -2 ||
    reason.includes('キャラクターが見つかりません') ||
    reason.includes('No character') ||
    reason.includes('Invalid UID or Region');
}

function extractRawDetail(resp, lang) {
  return resp.reason ||
    resp.error ||
    (resp.retcode !== undefined ? `retcode: ${resp.retcode}` : t('fmtNoDetails', [], lang));
}

function formatSingleGameRedeem(gameKey, res, lang) {
  const name = resolveGameDisplayName(gameKey, res, lang);

  if (res.skipped && res.reason === 'NO_CHARACTER') {
    return {
      title: t('fmtRedeemTitleComplete', [], lang),
      message: t('fmtSingleNoCharMsg', [name], lang),
      detail: null
    };
  }
  if (isLoginErrorResult(res)) {
    return {
      title: t('fmtRedeemTitleFailed', [], lang),
      message: t('fmtRedeemSingleNotLoggedIn', [name], lang),
      detail: res.reason || null
    };
  }
  if (!res.success) {
    return {
      title: t('fmtRedeemTitleFailed', [], lang),
      message: t('fmtRedeemSingleFailed', [name, res.reason || t('fmtFallbackError', [], lang)], lang),
      detail: res.reason || null
    };
  }

  const gameCount = res.redeemedCount || 0;
  return {
    title: t(gameCount > 0 ? 'fmtRedeemTitleSuccess' : 'fmtRedeemTitleComplete', [], lang),
    message: gameCount > 0
      ? t('fmtRedeemSingleSuccess', [name, gameCount], lang)
      : t('fmtRedeemSingleNoNew', [name], lang),
    detail: null
  };
}

function formatMultiGameRedeem(results, totalCount, lang) {
  const summaryLines = [];
  let anyPlayed = false;
  let hasLoginError = false;

  for (const [key, res] of Object.entries(results)) {
    const name = resolveGameDisplayName(key, res, lang);

    if (res.skipped && res.reason === 'NO_CHARACTER') {
      summaryLines.push(t('fmtItemSkippedNoChar', [name], lang));
    } else if (res.retcode === -100 || res.retcode === -1071 || res.reason === 'LOGIN_REQUIRED') {
      summaryLines.push(t('fmtItemNotLoggedIn', [name], lang));
      hasLoginError = true;
      anyPlayed = true;
    } else if (res.success) {
      anyPlayed = true;
      const gameCount = res.redeemedCount || 0;
      summaryLines.push(
        gameCount > 0
          ? t('fmtRedeemItemSuccess', [name, gameCount], lang)
          : t('fmtRedeemItemNoNew', [name], lang)
      );
    } else {
      anyPlayed = true;
      summaryLines.push(t('fmtItemError', [name, res.reason || t('fmtFallbackFailed', [], lang)], lang));
    }
  }

  let mainMsg;
  if (totalCount > 0) {
    mainMsg = t('fmtRedeemMultiSuccess', [totalCount], lang);
  } else if (!anyPlayed) {
    mainMsg = t('fmtRedeemMultiNoGames', [], lang);
  } else if (hasLoginError) {
    mainMsg = t('fmtRedeemMultiNeedLogin', [], lang);
  } else {
    mainMsg = t('fmtRedeemMultiNoNew', [], lang);
  }

  return {
    title: t(totalCount > 0 ? 'fmtRedeemTitleSuccess' : 'fmtRedeemTitleComplete', [], lang),
    message: `${mainMsg}\n\n${t('fmtBreakdownHeader', [], lang)}\n${summaryLines.join('\n')}`,
    detail: null
  };
}

/**
 * 引き換え結果オブジェクトからユーザー向け表示用タイトル、概要メッセージ、解析用詳細原因を生成する
 *
 * @param {object} [resp] - 実行結果レスポンス
 * @param {'ja'|'en'} [lang='ja'] - 表示言語
 * @returns {{ title: string, message: string, detail: string | null }}
 */
export function formatRedeemResult(resp, lang = 'ja') {
  if (!resp) {
    return {
      title: t('fmtRedeemTitleFailed', [], lang),
      message: t('fmtEmptyRespMsg', [], lang),
      detail: 'レスポンスが空です (null or undefined)'
    };
  }

  if (resp.success) {
    const count = resp.redeemedCount || 0;
    if (resp.results && typeof resp.results === 'object') {
      const resultKeys = Object.keys(resp.results);
      if (resultKeys.length === 1) {
        return formatSingleGameRedeem(resultKeys[0], resp.results[resultKeys[0]], lang);
      }
      return formatMultiGameRedeem(resp.results, count, lang);
    }

    return {
      title: t(count > 0 ? 'fmtRedeemTitleSuccess' : 'fmtRedeemTitleComplete', [], lang),
      message: count > 0 ? t('fmtRedeemMultiSuccess', [count], lang) : t('fmtRedeemMultiNoNew', [], lang),
      detail: null
    };
  }

  const rawDetail = extractRawDetail(resp, lang);
  const reason = resp.reason || '';

  if (isLoginErrorResult(resp)) {
    return {
      title: t('fmtRedeemTitleFailed', [], lang),
      message: t('fmtRedeemErrNotLoggedIn', [], lang),
      detail: rawDetail
    };
  }
  if (isNoCharacterError(resp)) {
    return {
      title: t('fmtRedeemTitleFailed', [], lang),
      message: t('fmtRedeemErrNoChar', [], lang),
      detail: rawDetail
    };
  }
  if (reason === 'ALREADY_RUNNING') {
    return {
      title: t('fmtProcessingTitle', [], lang),
      message: t('fmtRedeemRunningMsg', [], lang),
      detail: t('fmtLockDetail', [], lang)
    };
  }
  if (reason === 'UNDER_BACKOFF' || resp.retcode === -2016) {
    return {
      title: t('fmtRedeemTitlePaused', [], lang),
      message: t('fmtBackoffMsg', [], lang),
      detail: reason === 'UNDER_BACKOFF' ? t('fmtBackoffDetail', [], lang) : rawDetail
    };
  }
  if (reason === 'EXCEPTION' || resp.error) {
    return {
      title: t('fmtRedeemTitleNetworkErr', [], lang),
      message: t('fmtRedeemNetworkErrMsg', [], lang),
      detail: resp.error || rawDetail
    };
  }

  return {
    title: t('fmtRedeemTitleFailed', [], lang),
    message: t('fmtRedeemGenericErrMsg', [], lang),
    detail: rawDetail
  };
}

/**
 * ログタイムスタンプを短縮日時表記 (MM/DD HH:mm) に整形する
 *
 * @param {number|string|Date} timestamp - ミリ秒タイムスタンプ
 * @returns {string} 整形された日時文字列（不正時は空文字）
 */
export function formatLogTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '';

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${month}/${day} ${hours}:${minutes}`;
}

function formatSingleGameSign(gameKey, res, lang) {
  const name = resolveGameDisplayName(gameKey, res, lang);

  if (res.skipped && res.reason === 'NO_CHARACTER') {
    return {
      title: t('fmtSignTitleStatus', [], lang),
      message: t('fmtSingleNoCharMsg', [name], lang),
      detail: null
    };
  }
  if (res.isRisk) {
    return {
      title: t('fmtSignTitleVerify', [], lang),
      message: t('fmtSignSingleCaptcha', [name], lang),
      detail: res.reason || 'CAPTCHA_REQUIRED'
    };
  }
  if (isLoginErrorResult(res)) {
    return {
      title: t('fmtSignTitleFailed', [], lang),
      message: t('fmtSignSingleNotLoggedIn', [name], lang),
      detail: res.reason || null
    };
  }
  if (!res.success) {
    return {
      title: t('fmtSignTitleFailed', [], lang),
      message: t('fmtSignSingleFailed', [name, res.reason || t('fmtFallbackError', [], lang)], lang),
      detail: res.reason || null
    };
  }

  const dayText = res.totalSignDay ? t('signStatusMonthDays', [res.totalSignDay], lang) : '';
  if (res.alreadySigned) {
    return {
      title: t('fmtSignTitleAlready', [], lang),
      message: t('fmtSignSingleAlready', [name, dayText], lang),
      detail: null
    };
  }

  return {
    title: t('fmtSignTitleSuccess', [], lang),
    message: t('fmtSignSingleSuccess', [name, dayText], lang),
    detail: null
  };
}

function formatMultiGameSign(results, signedCount, lang) {
  const summaryLines = [];
  let hasError = false;

  for (const [key, res] of Object.entries(results)) {
    const name = resolveGameDisplayName(key, res, lang);

    if (res.skipped && res.reason === 'NO_CHARACTER') {
      summaryLines.push(t('fmtItemSkippedNoChar', [name], lang));
    } else if (res.isRisk) {
      summaryLines.push(t('fmtSignItemCaptcha', [name], lang));
      hasError = true;
    } else if (res.retcode === -100 || res.retcode === -1071 || res.reason === 'LOGIN_REQUIRED') {
      summaryLines.push(t('fmtItemNotLoggedIn', [name], lang));
      hasError = true;
    } else if (res.success) {
      summaryLines.push(t(res.alreadySigned ? 'fmtSignItemAlready' : 'fmtSignItemSuccess', [name], lang));
    } else {
      summaryLines.push(t('fmtItemError', [name, res.reason || t('fmtFallbackFailed', [], lang)], lang));
      hasError = true;
    }
  }

  let mainMsg;
  if (signedCount > 0) {
    mainMsg = t('fmtSignMultiSuccess', [signedCount], lang);
  } else if (hasError) {
    mainMsg = t('fmtSignMultiHasError', [], lang);
  } else {
    mainMsg = t('fmtSignMultiAllDone', [], lang);
  }

  return {
    title: t(signedCount > 0 ? 'fmtSignTitleSuccess' : 'fmtSignTitleComplete', [], lang),
    message: `${mainMsg}\n\n${t('fmtBreakdownHeader', [], lang)}\n${summaryLines.join('\n')}`,
    detail: null
  };
}

/**
 * ログインボーナス受取結果からユーザー向け表示用タイトル、概要メッセージ、解析用詳細原因を生成する
 *
 * @param {object} [resp] - 実行結果レスポンス
 * @param {'ja'|'en'} [lang='ja'] - 表示言語
 * @returns {{ title: string, message: string, detail: string | null }}
 */
export function formatSignResult(resp, lang = 'ja') {
  if (!resp) {
    return {
      title: t('fmtSignTitleFailed', [], lang),
      message: t('fmtEmptyRespMsg', [], lang),
      detail: 'レスポンスが空です (null or undefined)'
    };
  }

  if (resp.success && resp.results && typeof resp.results === 'object') {
    const resultKeys = Object.keys(resp.results);
    if (resultKeys.length === 1) {
      return formatSingleGameSign(resultKeys[0], resp.results[resultKeys[0]], lang);
    }
    return formatMultiGameSign(resp.results, resp.signedCount || 0, lang);
  }

  const rawDetail = extractRawDetail(resp, lang);
  const reason = resp.reason || '';

  if (reason === 'ALREADY_RUNNING') {
    return {
      title: t('fmtProcessingTitle', [], lang),
      message: t('fmtSignRunningMsg', [], lang),
      detail: t('fmtLockDetail', [], lang)
    };
  }

  if (reason === 'UNDER_BACKOFF') {
    return {
      title: t('fmtSignTitleWaiting', [], lang),
      message: t('fmtBackoffMsg', [], lang),
      detail: t('fmtBackoffDetail', [], lang)
    };
  }

  return {
    title: t('fmtSignTitleFailed', [], lang),
    message: t('fmtSignGenericErrMsg', [], lang),
    detail: rawDetail
  };
}

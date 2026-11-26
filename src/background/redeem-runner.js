import { GAMES, API_CONFIG, STATUS_MAP } from '../config/constants.js';
import { getGameLocalized, t } from '../utils/i18n.js';
import {
  recordBackoffFailure,
  computeJitteredDelayMs,
  resetRetryState,
  canAcceptNewCode,
  getRedeemedCodes,
  markCodeStatus,
  pruneHistoryIfExceeded,
  addExecutionLog,
  setLastSuccessfulRun,
  setActiveCodes
} from '../services/storage-service.js';
import { fetchValidCodes } from '../services/code-fetcher.js';
import { isTimeoutError } from '../services/http-client.js';
import { getUserGameRoles, redeemCode, isNotLoggedIn } from '../services/hoyo-api.js';
import { toGaGameKey, toRedeemTrigger, sendGAEvent } from '../services/analytics-service.js';
import {
  LOGIN_NOTIFICATION_PREFIX,
  scheduleRetryAlarm,
  clearRetryAlarm,
  executeMultiGameFlow,
  handleHttpBackoffResponse,
  reportGameFailure
} from './flow-runner.js';

/**
 * 外部コード取得時の例外種別を GA4 送信用のエラー分類に変換する
 */
export function classifyFetchError(fetchErr) {
  const msg = typeof fetchErr?.message === 'string' ? fetchErr.message : '';
  const match = msg.match(/HTTP_ERROR_(\d+)/);
  const httpStatus = match ? parseInt(match[1], 10) : 0;
  const isTimeout = isTimeoutError(fetchErr);
  const isParseErr = fetchErr instanceof SyntaxError || msg.includes('JSON');
  const errorType = isTimeout
    ? 'timeout'
    : (httpStatus > 0 ? 'http_error' : (isParseErr ? 'parse_error' : 'network_error'));
  return { httpStatus, errorType };
}

function classifyRedeemRetcode(retcode, res = {}) {
  if (res?.shouldBackoff) {
    return {
      codeStatus: null,
      skipMarkStatus: true,
      gaStatus: 'failed',
      errorReason: res.isRateLimited ? 'rate_limited' : 'server_error',
      shouldBreak: true,
      triggerBackoff: true
    };
  }
  if (isNotLoggedIn(retcode)) {
    return { codeStatus: null, skipMarkStatus: true, gaStatus: 'failed', errorReason: 'not_logged_in', shouldBreak: true };
  }
  switch (retcode) {
    case 0:
      return { codeStatus: 'SUCCESS', gaStatus: 'success', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2017:
      return { codeStatus: 'ALREADY_CLAIMED', gaStatus: 'already_claimed', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2001:
      return { codeStatus: 'EXPIRED', gaStatus: 'expired', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2018:
      return { codeStatus: 'EXPIRED', gaStatus: 'already_claimed', errorReason: 'none', shouldBreak: false, skipMarkStatus: false };
    case -2016:
      return { codeStatus: null, skipMarkStatus: true, gaStatus: 'cooldown', errorReason: 'cooldown', shouldBreak: true, triggerBackoff: true };
    default:
      return { codeStatus: 'RETRY', gaStatus: 'failed', errorReason: 'unknown', shouldBreak: false, skipMarkStatus: false };
  }
}

function isTerminalCodeStatus(status) {
  return status === STATUS_MAP.SUCCESS ||
    status === STATUS_MAP.ALREADY_CLAIMED ||
    status === STATUS_MAP.EXPIRED ||
    status === STATUS_MAP.FAILED;
}

/**
 * 指定ゲームの有効コード取得・順次引き換えを実行する
 */
export async function redeemForGame(gameKey, lang = 'ja', triggerSource = 'ALARM') {
  const gameConfig = GAMES[gameKey];
  if (!gameConfig) {
    return { success: false, reason: t('errUnknownGameKey', [gameKey], lang), gameKey };
  }

  const trigger = toRedeemTrigger(triggerSource);
  const gameName = getGameLocalized(gameKey, lang).name;

  let activeCodes = [];
  try {
    activeCodes = await fetchValidCodes(gameKey);
    await setActiveCodes(gameConfig.gameBiz, activeCodes);
  } catch (fetchErr) {
    const { httpStatus, errorType } = classifyFetchError(fetchErr);
    await sendGAEvent('code_list_fetch_error', {
      game: toGaGameKey(gameKey),
      http_status: httpStatus,
      error_type: errorType,
      lang
    });
    throw fetchErr;
  }

  const redeemed = await getRedeemedCodes(gameConfig.gameBiz);
  const pendingCodes = activeCodes.filter(cdkey => {
    const entry = redeemed[cdkey];
    return !(entry && isTerminalCodeStatus(entry.s));
  });

  if (pendingCodes.length === 0) {
    await pruneHistoryIfExceeded(gameConfig.gameBiz, activeCodes);
    await addExecutionLog({
      type: 'INFO',
      category: 'CODE',
      gameKey,
      message: t('logRedeemComplete', [gameName, 0], lang)
    });
    return {
      success: true,
      skipped: true,
      reason: 'NO_PENDING_CODES',
      redeemedCount: 0,
      gameKey,
      gameName
    };
  }

  const roleRes = await getUserGameRoles(gameConfig.gameBiz, lang);
  if (!roleRes.success) {
    if (roleRes.shouldBackoff) {
      return await handleHttpBackoffResponse({
        gameKey,
        gameName,
        category: 'CODE',
        gaEventName: 'code_redeem_result',
        trigger,
        lang,
        res: roleRes
      });
    }
    if (roleRes.retcode === -1 || roleRes.retcode === -2) {
      await addExecutionLog({
        type: 'INFO',
        category: 'CODE',
        gameKey,
        message: t('logNoCharSkip', [gameName], lang)
      });
      return { success: true, skipped: true, reason: 'NO_CHARACTER', gameKey, gameName };
    }

    return await reportGameFailure({
      category: 'CODE',
      gaEvent: 'code_redeem_result',
      gameKey,
      gameName,
      trigger,
      lang,
      retcode: roleRes.retcode,
      errorMessage: t('logRoleFetchFailedRedeem', [gameName, roleRes.message, roleRes.retcode], lang),
      fallbackErrorReason: 'unknown',
      shouldSendGa: true,
      notifPrefix: LOGIN_NOTIFICATION_PREFIX,
      notifMsgKey: 'notifLoginMsgRedeem'
    });
  }

  let redeemedCount = 0;
  let backoffTriggered = false;
  let notLoggedInRes = null;

  for (const cdkey of pendingCodes) {
    const entry = redeemed[cdkey];

    if (!entry) {
      const canAccept = await canAcceptNewCode(gameConfig.gameBiz);
      if (!canAccept) {
        await addExecutionLog({
          type: 'WARN',
          gameKey,
          message: t('logDailyLimit', [gameName], lang)
        });
        break;
      }
    }

    const delayMs = computeJitteredDelayMs(
      API_CONFIG.INTER_REQUEST_DELAY_MS,
      API_CONFIG.INTER_REQUEST_JITTER_MAX_MS
    );
    if (delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }

    const res = await redeemCode({
      exchangeHost: gameConfig.exchangeHost,
      exchangePath: gameConfig.exchangePath,
      gameBiz: gameConfig.gameBiz,
      uid: roleRes.role.game_uid,
      region: roleRes.role.region,
      cdkey,
      lang
    });

    const outcome = classifyRedeemRetcode(res.retcode, res);
    if (!res?.shouldBackoff && isNotLoggedIn(res.retcode)) {
      notLoggedInRes = res;
    }
    if (outcome.triggerBackoff) {
      const backoff = await recordBackoffFailure({ retryAfterMs: res.retryAfterMs });
      backoffTriggered = true;
      if (res.shouldBackoff) {
        await addExecutionLog({
          type: 'WARN',
          category: 'CODE',
          gameKey,
          message: t('logHttpBackoff', [gameName, res.httpStatus, backoff.remainingMinutes], lang)
        });
      }
    }
    if (!outcome.skipMarkStatus) {
      await markCodeStatus(gameConfig.gameBiz, cdkey, outcome.codeStatus);
    }
    if (outcome.codeStatus === 'SUCCESS') {
      redeemedCount++;
    }

    await sendGAEvent('code_redeem_result', {
      game: toGaGameKey(gameKey),
      status: outcome.gaStatus,
      error_reason: outcome.errorReason,
      trigger,
      lang
    });

    if (outcome.shouldBreak) {
      break;
    }
  }

  await pruneHistoryIfExceeded(gameConfig.gameBiz, activeCodes);
  if (backoffTriggered) {
    return {
      success: false,
      skipped: false,
      backoffTriggered: true,
      redeemedCount,
      gameKey,
      gameName
    };
  }

  if (notLoggedInRes) {
    const failureRes = await reportGameFailure({
      category: 'CODE',
      gaEvent: 'code_redeem_result',
      gameKey,
      gameName,
      trigger,
      lang,
      retcode: notLoggedInRes.retcode,
      errorMessage: t('logRedeemFailed', [gameName, notLoggedInRes.message, notLoggedInRes.retcode], lang),
      fallbackErrorReason: 'unknown',
      shouldSendGa: false,
      notifPrefix: LOGIN_NOTIFICATION_PREFIX,
      notifMsgKey: 'notifLoginMsgRedeem'
    });
    return { ...failureRes, redeemedCount };
  }

  await addExecutionLog({
    type: 'INFO',
    category: 'CODE',
    gameKey,
    message: t('logRedeemComplete', [gameName, redeemedCount], lang)
  });

  return { success: true, skipped: false, redeemedCount, gameKey, gameName };
}

/**
 * 全有効ゲームまたは指定ゲームのコード自動引き換えフローを実行する
 */
export async function runAutoRedeemFlow(triggerSource = 'ALARM', targetGameKey = null) {
  return executeMultiGameFlow({
    lockKey: triggerSource,
    triggerSource,
    attemptKind: 'REDEEM',
    targetGameKey,
    category: 'CODE',
    countPropName: 'redeemedCount',
    checkStorage: true,
    logBackoffAbort: true,
    notifyStorageWriteFailure: true,
    skippedDelayMs: 500,
    getNormalDelayMs: () => computeJitteredDelayMs(
      API_CONFIG.INTER_REQUEST_DELAY_MS,
      API_CONFIG.INTER_REQUEST_JITTER_MAX_MS
    ),
    runSingleGame: (gKey, lang) => redeemForGame(gKey, lang, triggerSource),
    extractCount: (res) => (res.success && !res.skipped && res.redeemedCount ? res.redeemedCount : 0),
    onFullRunSuccess: async () => {
      await setLastSuccessfulRun(Date.now());
      await clearRetryAlarm();
      await resetRetryState('REDEEM');
    },
    scheduleRetry: scheduleRetryAlarm,
    clearRetry: clearRetryAlarm,
    resetRetry: () => resetRetryState('REDEEM'),
    exceptionLogKey: 'logExceptionRedeem'
  });
}

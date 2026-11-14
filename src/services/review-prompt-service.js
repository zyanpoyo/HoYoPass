import {
  STATUS_MAP,
  GAMES,
  REVIEW_PROMPT_CONFIG
} from '../config/constants.js';
import { isUnderBackoff } from './storage-service.js';

const VALID_REVIEW_STATUSES = ['pending', 'postponed', 'completed', 'dismissed'];

export async function getReviewPromptState(nowMs = Date.now()) {
  const data = await chrome.storage.local.get('reviewPrompt');
  const saved = data.reviewPrompt;
  if (!saved || typeof saved !== 'object') {
    return {
      successCount: 0,
      status: 'pending',
      nextEligibleTimestamp: 0,
      postponeCount: 0,
      firstInstalledAt: nowMs
    };
  }
  return {
    successCount: typeof saved.successCount === 'number' && saved.successCount >= 0 ? saved.successCount : 0,
    status: VALID_REVIEW_STATUSES.includes(saved.status) ? saved.status : 'pending',
    nextEligibleTimestamp: typeof saved.nextEligibleTimestamp === 'number' ? saved.nextEligibleTimestamp : 0,
    postponeCount: typeof saved.postponeCount === 'number' && saved.postponeCount >= 0 ? saved.postponeCount : 0,
    firstInstalledAt: typeof saved.firstInstalledAt === 'number' ? saved.firstInstalledAt : nowMs
  };
}

/**
 * インストールまたはアップデート時の初期化。
 * 既存ユーザー（reviewPrompt 未作成だが過去にコード引換 SUCCESS またはログボ受取実績がある環境）は、
 * 過去実績数を初期 successCount（上限 THRESHOLD_SUCCESS_COUNT）として引き継ぐ。
 * ※ firstInstalledAt は既存ユーザーのアップデート時にはアップデート実行日時となる。
 */
export async function initReviewPromptState(nowMs = Date.now()) {
  const data = await chrome.storage.local.get('reviewPrompt');
  if (data.reviewPrompt && typeof data.reviewPrompt === 'object') {
    return getReviewPromptState(nowMs);
  }

  let migratedCount = 0;
  const gameBizList = Object.values(GAMES).map(g => g.gameBiz).filter(Boolean);
  const keysToFetch = [
    ...gameBizList.map(biz => `redeemed_${biz}`),
    ...gameBizList.map(biz => `daily_sign_${biz}`)
  ];
  const historyData = await chrome.storage.local.get(keysToFetch);

  for (const biz of gameBizList) {
    const redeemed = historyData[`redeemed_${biz}`] || {};
    for (const entry of Object.values(redeemed)) {
      if (entry && entry.s === STATUS_MAP.SUCCESS) {
        migratedCount++;
      }
    }
    const signRec = historyData[`daily_sign_${biz}`];
    if (signRec && signRec.isSigned === true) {
      migratedCount++;
    }
  }

  const initial = {
    successCount: Math.min(migratedCount, REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT),
    status: 'pending',
    nextEligibleTimestamp: 0,
    postponeCount: 0,
    firstInstalledAt: nowMs
  };
  await chrome.storage.local.set({ reviewPrompt: initial });
  return initial;
}

export async function updateReviewPromptState(partial, nowMs = Date.now()) {
  const current = await getReviewPromptState(nowMs);
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ reviewPrompt: updated });
  return updated;
}

export async function incrementReviewSuccessCount(nowMs = Date.now()) {
  const current = await getReviewPromptState(nowMs);
  const updated = {
    ...current,
    successCount: current.successCount + 1
  };
  await chrome.storage.local.set({ reviewPrompt: updated });
  return updated;
}

export async function postponeReviewPrompt(nowMs = Date.now()) {
  const current = await getReviewPromptState(nowMs);
  const nextPostponeCount = (current.postponeCount || 0) + 1;
  const maxPostpones = REVIEW_PROMPT_CONFIG.MAX_POSTPONE_COUNT || 2;

  if (nextPostponeCount >= maxPostpones) {
    return updateReviewPromptState({
      status: 'dismissed',
      postponeCount: nextPostponeCount
    }, nowMs);
  }

  return updateReviewPromptState({
    status: 'postponed',
    postponeCount: nextPostponeCount,
    nextEligibleTimestamp: nowMs + REVIEW_PROMPT_CONFIG.POSTPONE_DURATION_MS
  }, nowMs);
}

export async function shouldShowReviewPrompt(nowMs = Date.now()) {
  const state = await getReviewPromptState(nowMs);

  if (state.status === 'completed' || state.status === 'dismissed') {
    return false;
  }

  if (state.status === 'postponed' && nowMs < state.nextEligibleTimestamp) {
    return false;
  }

  if (state.successCount < REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT) {
    return false;
  }

  // 直近に致命的エラーがないか確認（レート制限等のバックオフ中は表示しない）
  if (await isUnderBackoff(nowMs)) {
    return false;
  }

  return true;
}

import { REVIEW_PROMPT_CONFIG } from '../config/constants.js';
import { GAMES } from '../config/games.js';
import { defaultStateStore } from './state-store.js';

const VALID_REVIEW_STATUSES = ['pending', 'postponed', 'completed', 'dismissed'];

function normalizeReviewPromptState(saved, nowMs) {
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
 * ストアレビュー促進バナーの状態管理・実績マイグレーション・表示判定サービスを生成する。
 */
export function createReviewPromptService(
  store = defaultStateStore,
  { clock = { now: () => Date.now() } } = {}
) {
  async function getReviewPromptState(nowMs = clock.now()) {
    const saved = await store.getReviewPromptRecord();
    return normalizeReviewPromptState(saved, nowMs);
  }

  /**
   * インストールまたはアップデート時の初期化。
   * 既存ユーザー（reviewPrompt 未作成だが過去にコード引換 SUCCESS またはログボ受取実績がある環境）は、
   * 過去実績数を初期 successCount（上限 THRESHOLD_SUCCESS_COUNT）として引き継ぐ。
   * ※ firstInstalledAt は既存ユーザーのアップデート時にはアップデート実行日時となる。
   */
  async function initReviewPromptState(nowMs = clock.now()) {
    const existing = await store.getReviewPromptRecord();
    if (existing && typeof existing === 'object') {
      return normalizeReviewPromptState(existing, nowMs);
    }

    const gameBizList = Object.values(GAMES).map(g => g.gameBiz).filter(Boolean);
    const migratedCount = await store.countHistoricalReviewSuccesses(gameBizList);

    const initial = {
      successCount: Math.min(migratedCount, REVIEW_PROMPT_CONFIG.THRESHOLD_SUCCESS_COUNT),
      status: 'pending',
      nextEligibleTimestamp: 0,
      postponeCount: 0,
      firstInstalledAt: nowMs
    };
    await store.saveReviewPromptRecord(initial);
    return initial;
  }

  async function updateReviewPromptState(partial, nowMs = clock.now()) {
    const current = await getReviewPromptState(nowMs);
    const updated = { ...current, ...partial };
    await store.saveReviewPromptRecord(updated);
    return updated;
  }

  async function incrementReviewSuccessCount(nowMs = clock.now()) {
    const current = await getReviewPromptState(nowMs);
    const updated = {
      ...current,
      successCount: current.successCount + 1
    };
    await store.saveReviewPromptRecord(updated);
    return updated;
  }

  async function postponeReviewPrompt(nowMs = clock.now()) {
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

  async function shouldShowReviewPrompt(nowMs = clock.now()) {
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
    if (await store.isUnderBackoff(nowMs)) {
      return false;
    }

    return true;
  }

  return {
    getReviewPromptState,
    initReviewPromptState,
    updateReviewPromptState,
    incrementReviewSuccessCount,
    postponeReviewPrompt,
    shouldShowReviewPrompt
  };
}

export const defaultReviewPromptService = createReviewPromptService();

export const getReviewPromptState = (nowMs) => defaultReviewPromptService.getReviewPromptState(nowMs);
export const initReviewPromptState = (nowMs) => defaultReviewPromptService.initReviewPromptState(nowMs);
export const updateReviewPromptState = (partial, nowMs) => defaultReviewPromptService.updateReviewPromptState(partial, nowMs);
export const incrementReviewSuccessCount = (nowMs) => defaultReviewPromptService.incrementReviewSuccessCount(nowMs);
export const postponeReviewPrompt = (nowMs) => defaultReviewPromptService.postponeReviewPrompt(nowMs);
export const shouldShowReviewPrompt = (nowMs) => defaultReviewPromptService.shouldShowReviewPrompt(nowMs);

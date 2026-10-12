import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRedeemResult, formatLogTimestamp } from '../src/utils/message-formatter.js';


test('formatRedeemResult: 空または不正なレスポンス', () => {
  const res = formatRedeemResult(null);
  assert.equal(res.title, 'コード交換失敗');
  assert.equal(res.message, '応答がありませんでした。もう一度お試しください。');
  assert.ok(res.detail);
});

test('formatRedeemResult: 成功ケース (件数あり)', () => {
  const res = formatRedeemResult({ success: true, redeemedCount: 3 });
  assert.equal(res.title, 'コード交換成功');
  assert.match(res.message, /3件のコードを引き換えました/);
  assert.equal(res.detail, null, '成功時はdetailがnull');
});

test('formatRedeemResult: 成功ケース (0件)', () => {
  const res = formatRedeemResult({ success: true, redeemedCount: 0 });
  assert.equal(res.title, 'コード交換完了');
  assert.equal(res.message, '利用可能な新しい引き換えコードはありませんでした。');
  assert.equal(res.detail, null, '成功時はdetailがnull');
});

test('formatRedeemResult: 未ログイン (retcode: -100)', () => {
  const rawMsg = '原神: ロール取得失敗 (Login expired. Please log in again. [retcode: -100])';
  const res = formatRedeemResult({
    success: false,
    retcode: -100,
    reason: rawMsg
  });
  assert.equal(res.title, 'コード交換失敗');
  assert.equal(res.message, '未ログインです。ログインを行ってください。');
  assert.equal(res.detail, rawMsg, '生エラーメッセージが詳細原因として保持される');
});

test('formatRedeemResult: 未ログイン (retcode: -1071 / メッセージ内検知)', () => {
  const rawMsg = 'スターレイル: ロール取得失敗 (Login expired [retcode: -1071])';
  const res = formatRedeemResult({
    success: false,
    reason: rawMsg
  });
  assert.equal(res.title, 'コード交換失敗');
  assert.equal(res.message, '未ログインです。ログインを行ってください。');
  assert.equal(res.detail, rawMsg);
});

test('formatRedeemResult: キャラクター不在 (retcode: -1)', () => {
  const rawMsg = '原神: ロール取得失敗 (アカウント内にキャラクターが見つかりません [retcode: -1])';
  const res = formatRedeemResult({
    success: false,
    retcode: -1,
    reason: rawMsg
  });
  assert.equal(res.title, 'コード交換失敗');
  assert.match(res.message, /キャラクター情報が見つかりません/);
  assert.equal(res.detail, rawMsg);
});

test('formatRedeemResult: 二重実行 (ALREADY_RUNNING)', () => {
  const res = formatRedeemResult({
    success: false,
    reason: 'ALREADY_RUNNING'
  });
  assert.equal(res.title, '処理中');
  assert.match(res.message, /現在引き換え処理を実行中です/);
  assert.ok(res.detail);
});

test('formatRedeemResult: バックオフ中 (UNDER_BACKOFF)', () => {
  const res = formatRedeemResult({
    success: false,
    reason: 'UNDER_BACKOFF'
  });
  assert.equal(res.title, 'コード交換一時停止中');
  assert.match(res.message, /連続リクエスト制限中のため/);
  assert.match(res.detail, /バックオフ期間中/);
});

test('formatRedeemResult: 例外発生 (EXCEPTION)', () => {
  const res = formatRedeemResult({
    success: false,
    reason: 'EXCEPTION',
    error: 'Failed to fetch network resource'
  });
  assert.equal(res.title, '通信エラー');
  assert.match(res.message, /通信または処理中にエラーが発生しました/);
  assert.equal(res.detail, 'Failed to fetch network resource');
});

test('formatRedeemResult: 複数ゲーム巡回結果 (成功・スキップ混在)', () => {
  const res = formatRedeemResult({
    success: true,
    redeemedCount: 2,
    results: {
      GENSHIN: { success: true, skipped: false, redeemedCount: 2, gameName: '原神' },
      STAR_RAIL: { success: true, skipped: false, redeemedCount: 0, gameName: '崩壊：スターレイル' },
      ZZZ: { success: true, skipped: true, reason: 'NO_CHARACTER', gameName: 'ゼンレスゾーンゼロ' }
    }
  });

  assert.equal(res.title, 'コード交換成功');
  assert.match(res.message, /2件のコードを引き換えました/);
  assert.match(res.message, /・原神: 2件引き換え成功/);
  assert.match(res.message, /・崩壊：スターレイル: 新規コードなし/);
  assert.match(res.message, /・ゼンレスゾーンゼロ: 未プレイのためスキップ/);
  assert.equal(res.detail, null);
});

test('formatRedeemResult: 複数ゲーム巡回結果 (全ゲーム未プレイ)', () => {
  const res = formatRedeemResult({
    success: true,
    redeemedCount: 0,
    results: {
      GENSHIN: { success: true, skipped: true, reason: 'NO_CHARACTER', gameName: '原神' },
      STAR_RAIL: { success: true, skipped: true, reason: 'NO_CHARACTER', gameName: '崩壊：スターレイル' },
      ZZZ: { success: true, skipped: true, reason: 'NO_CHARACTER', gameName: 'ゼンレスゾーンゼロ' }
    }
  });

  assert.equal(res.title, 'コード交換完了');
  assert.match(res.message, /キャラクターが作成されているゲームが見つかりませんでした/);
  assert.match(res.message, /・原神: 未プレイのためスキップ/);
});

test('formatRedeemResult: 単一ゲーム結果 (成功件数あり)', () => {
  const res = formatRedeemResult({
    success: true,
    redeemedCount: 2,
    results: {
      GENSHIN: { success: true, skipped: false, redeemedCount: 2, gameName: '原神' }
    }
  });
  assert.equal(res.title, 'コード交換成功');
  assert.match(res.message, /【原神】2件のコードを引き換えました/);
  assert.equal(res.detail, null);
});

test('formatRedeemResult: 単一ゲーム結果 (0件)', () => {
  const res = formatRedeemResult({
    success: true,
    redeemedCount: 0,
    results: {
      STAR_RAIL: { success: true, skipped: false, redeemedCount: 0, gameName: '崩壊：スターレイル' }
    }
  });
  assert.equal(res.title, 'コード交換完了');
  assert.match(res.message, /【崩壊：スターレイル】利用可能な新しい引き換えコードはありませんでした/);
  assert.equal(res.detail, null);
});

test('formatRedeemResult: 単一ゲーム結果 (未プレイ)', () => {
  const res = formatRedeemResult({
    success: true,
    redeemedCount: 0,
    results: {
      ZZZ: { success: true, skipped: true, reason: 'NO_CHARACTER', gameName: 'ゼンレスゾーンゼロ' }
    }
  });
  assert.equal(res.title, 'コード交換完了');
  assert.match(res.message, /【ゼンレスゾーンゼロ】キャラクターが作成されていません/);
  assert.equal(res.detail, null);
});

test('formatRedeemResult: 単一ゲーム結果 (未ログイン)', () => {
  const res = formatRedeemResult({
    success: true,
    redeemedCount: 0,
    results: {
      GENSHIN: { success: false, skipped: false, retcode: -100, reason: 'Login expired', gameName: '原神' }
    }
  });
  assert.equal(res.title, 'コード交換失敗');
  assert.match(res.message, /【原神】未ログインです/);
  assert.equal(res.detail, 'Login expired');
});

test('formatLogTimestamp: MM/DD HH:mm 形式へのフォーマットとゼロ埋め', () => {
  // 2026-10-12 14:30
  const d1 = new Date(2026, 9, 12, 14, 30, 0).getTime();
  assert.equal(formatLogTimestamp(d1), '10/12 14:30');

  // 2026-01-05 09:03 (ゼロ埋め確認)
  const d2 = new Date(2026, 0, 5, 9, 3, 0).getTime();
  assert.equal(formatLogTimestamp(d2), '01/05 09:03');

  // 不正値・空値
  assert.equal(formatLogTimestamp(null), '');
  assert.equal(formatLogTimestamp(undefined), '');
  assert.equal(formatLogTimestamp(''), '');
  assert.equal(formatLogTimestamp('invalid_date'), '');
});


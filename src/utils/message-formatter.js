/**
 * 引き換え結果オブジェクトからユーザー向け表示用タイトル、概要メッセージ、解析用詳細原因を生成する
 * 
 * @param {object} [resp] - 実行結果レスポンス
 * @param {boolean} [resp.success] - 成功フラグ
 * @param {number} [resp.redeemedCount] - 交換成功件数
 * @param {string} [resp.reason] - エラー・中断理由
 * @param {number} [resp.retcode] - APIリターンコード
 * @param {string} [resp.error] - 例外エラーメッセージ
 * @returns {{ title: string, message: string, detail: string | null }}
 */
export function formatRedeemResult(resp) {
  if (!resp) {
    return {
      title: 'コード交換失敗',
      message: '応答がありませんでした。もう一度お試しください。',
      detail: 'レスポンスが空です (null or undefined)'
    };
  }

  // 成功時
  if (resp.success) {
    const count = resp.redeemedCount || 0;

    // 複数ゲーム巡回結果 (resp.results) が存在する場合
    if (resp.results && typeof resp.results === 'object') {
      const summaryLines = [];
      let anyPlayed = false;
      let hasLoginError = false;

      for (const [key, res] of Object.entries(resp.results)) {
        const name = res.gameName || key;
        if (res.skipped && res.reason === 'NO_CHARACTER') {
          summaryLines.push(`・${name}: 未プレイのためスキップ`);
        } else if (res.retcode === -100 || res.retcode === -1071 || res.reason === 'LOGIN_REQUIRED') {
          summaryLines.push(`・${name}: 未ログイン`);
          hasLoginError = true;
          anyPlayed = true;
        } else if (res.success) {
          anyPlayed = true;
          const gameCount = res.redeemedCount || 0;
          summaryLines.push(gameCount > 0 ? `・${name}: ${gameCount}件引き換え成功` : `・${name}: 新規コードなし`);
        } else {
          anyPlayed = true;
          summaryLines.push(`・${name}: エラー (${res.reason || '失敗'})`);
        }
      }

      let mainMsg = '';
      if (count > 0) {
        mainMsg = `${count}件のコードを引き換えました。\nゲーム内メールをご確認ください。`;
      } else if (!anyPlayed) {
        mainMsg = 'キャラクターが作成されているゲームが見つかりませんでした。';
      } else if (hasLoginError) {
        mainMsg = 'ログインが必要なゲームがあります。公式サイトで再ログインしてください。';
      } else {
        mainMsg = '利用可能な新しい引き換えコードはありませんでした。';
      }

      return {
        title: count > 0 ? 'コード交換成功' : 'コード交換完了',
        message: `${mainMsg}\n\n【内訳】\n${summaryLines.join('\n')}`,
        detail: null
      };
    }

    // 単一ゲーム結果の場合（後方互換）
    return {
      title: count > 0 ? 'コード交換成功' : 'コード交換完了',
      message: count > 0
        ? `${count}件のコードを引き換えました。\nゲーム内メールをご確認ください。`
        : '利用可能な新しい引き換えコードはありませんでした。',
      detail: null
    };
  }

  // 詳細原因（開発者解析用）のベース文字列
  const rawDetail = resp.reason || resp.error || (resp.retcode !== undefined ? `retcode: ${resp.retcode}` : '詳細情報なし');
  const retcode = resp.retcode;
  const reason = resp.reason || '';

  // 未ログイン・セッション期限切れ
  if (retcode === -100 || retcode === -1071 || reason.includes('-100') || reason.includes('-1071') || reason.includes('Login expired')) {
    return {
      title: 'コード交換失敗',
      message: '未ログインです。ログインを行ってください。',
      detail: rawDetail
    };
  }

  // キャラクター未作成 / 見つからない
  if (retcode === -1 || retcode === -2 || reason.includes('キャラクターが見つかりません')) {
    return {
      title: 'コード交換失敗',
      message: '対象ゲームのキャラクター情報が見つかりません。ゲーム内でキャラクターを作成してください。',
      detail: rawDetail
    };
  }

  // 二重実行
  if (reason === 'ALREADY_RUNNING') {
    return {
      title: '処理中',
      message: '現在引き換え処理を実行中です。完了までしばらくお待ちください。',
      detail: '排他実行ロックが獲得できませんでした (ALREADY_RUNNING)'
    };
  }

  // バックオフ・連続リクエスト制限中
  if (reason === 'UNDER_BACKOFF' || retcode === -2016) {
    return {
      title: 'コード交換一時停止中',
      message: '連続リクエスト制限中のため、しばらく時間をおいてから再度お試しください。',
      detail: reason === 'UNDER_BACKOFF' ? 'バックオフ期間中 (30分間一時停止)' : rawDetail
    };
  }

  // 例外 / 通信エラー
  if (reason === 'EXCEPTION' || resp.error) {
    return {
      title: '通信エラー',
      message: '通信または処理中にエラーが発生しました。ネットワーク環境を確認の上、時間をおいて再度お試しください。',
      detail: resp.error || rawDetail
    };
  }

  // その他汎用失敗
  return {
    title: 'コード交換失敗',
    message: '引き換え処理に失敗しました。時間をおいて再度お試しください。',
    detail: rawDetail
  };
}

/**
 * ログタイムスタンプを短縮日時表記 (MM/DD HH:mm) に整形する
 * 例: 10/12 14:30
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


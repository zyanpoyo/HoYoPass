import { GAMES } from '../config/constants.js';
import { getGameLocalized } from './i18n.js';

/**
 * 引き換え結果オブジェクトからユーザー向け表示用タイトル、概要メッセージ、解析用詳細原因を生成する
 * 
 * @param {object} [resp] - 実行結果レスポンス
 * @param {'ja'|'en'} [lang='ja'] - 表示言語
 * @returns {{ title: string, message: string, detail: string | null }}
 */
export function formatRedeemResult(resp, lang = 'ja') {
  const isEn = lang === 'en';

  if (!resp) {
    return {
      title: isEn ? 'Code Redemption Failed' : 'コード交換失敗',
      message: isEn ? 'No response received. Please try again.' : '応答がありませんでした。もう一度お試しください。',
      detail: 'レスポンスが空です (null or undefined)'
    };
  }

  // 成功時
  if (resp.success) {
    const count = resp.redeemedCount || 0;

    // ゲーム別結果 (resp.results) が存在する場合
    if (resp.results && typeof resp.results === 'object') {
      const resultKeys = Object.keys(resp.results);

      // 単一ゲーム指定の場合（画面からの手動引き換えなど）
      if (resultKeys.length === 1) {
        const singleKey = resultKeys[0];
        const res = resp.results[singleKey];
        const localizedGame = getGameLocalized(singleKey, lang);
        const name = isEn ? localizedGame.name : (res.gameName || localizedGame.name || singleKey);

        if (res.skipped && res.reason === 'NO_CHARACTER') {
          return {
            title: isEn ? 'Code Redemption Complete' : 'コード交換完了',
            message: isEn
              ? `[${name}] No character created. Please create a character in the game first.`
              : `【${name}】キャラクターが作成されていません。ゲーム内でキャラクターを作成してください。`,
            detail: null
          };
        }
        if (res.retcode === -100 || res.retcode === -1071 || res.reason === 'LOGIN_REQUIRED' || (res.reason && (res.reason.includes('-100') || res.reason.includes('-1071')))) {
          return {
            title: isEn ? 'Code Redemption Failed' : 'コード交換失敗',
            message: isEn
              ? `[${name}] Not logged in. Please log in on the official website.`
              : `【${name}】未ログインです。公式サイトでログインを行ってください。`,
            detail: res.reason || null
          };
        }
        if (!res.success) {
          return {
            title: isEn ? 'Code Redemption Failed' : 'コード交換失敗',
            message: isEn
              ? `[${name}] Redemption failed (${res.reason || 'error'}).`
              : `【${name}】引き換えに失敗しました (${res.reason || 'エラー'})。`,
            detail: res.reason || null
          };
        }

        const gameCount = res.redeemedCount || 0;
        return {
          title: gameCount > 0
            ? (isEn ? 'Code Redemption Succeeded' : 'コード交換成功')
            : (isEn ? 'Code Redemption Complete' : 'コード交換完了'),
          message: gameCount > 0
            ? (isEn
                ? `[${name}] Successfully redeemed ${gameCount} code(s).\nPlease check your in-game mailbox.`
                : `【${name}】${gameCount}件のコードを引き換えました。\nゲーム内メールをご確認ください。`)
            : (isEn
                ? `[${name}] No new codes available to redeem.`
                : `【${name}】利用可能な新しい引き換えコードはありませんでした。`),
          detail: null
        };
      }

      const summaryLines = [];
      let anyPlayed = false;
      let hasLoginError = false;

      for (const [key, res] of Object.entries(resp.results)) {
        const localizedGame = getGameLocalized(key, lang);
        const name = isEn ? localizedGame.name : (res.gameName || localizedGame.name || key);

        if (res.skipped && res.reason === 'NO_CHARACTER') {
          summaryLines.push(isEn ? `• ${name}: Skipped (no character)` : `・${name}: 未プレイのためスキップ`);
        } else if (res.retcode === -100 || res.retcode === -1071 || res.reason === 'LOGIN_REQUIRED') {
          summaryLines.push(isEn ? `• ${name}: Not logged in` : `・${name}: 未ログイン`);
          hasLoginError = true;
          anyPlayed = true;
        } else if (res.success) {
          anyPlayed = true;
          const gameCount = res.redeemedCount || 0;
          summaryLines.push(gameCount > 0
            ? (isEn ? `• ${name}: Redeemed ${gameCount} code(s)` : `・${name}: ${gameCount}件引き換え成功`)
            : (isEn ? `• ${name}: No new codes` : `・${name}: 新規コードなし`));
        } else {
          anyPlayed = true;
          summaryLines.push(isEn ? `• ${name}: Error (${res.reason || 'failed'})` : `・${name}: エラー (${res.reason || '失敗'})`);
        }
      }

      let mainMsg = '';
      if (count > 0) {
        mainMsg = isEn
          ? `Successfully redeemed ${count} code(s).\nPlease check your in-game mailbox.`
          : `${count}件のコードを引き換えました。\nゲーム内メールをご確認ください。`;
      } else if (!anyPlayed) {
        mainMsg = isEn
          ? 'No games with created characters were found.'
          : 'キャラクターが作成されているゲームが見つかりませんでした。';
      } else if (hasLoginError) {
        mainMsg = isEn
          ? 'Some games require login. Please re-login on the official website.'
          : 'ログインが必要なゲームがあります。公式サイトで再ログインしてください。';
      } else {
        mainMsg = isEn
          ? 'No new codes available to redeem.'
          : '利用可能な新しい引き換えコードはありませんでした。';
      }

      const breakdownHeader = isEn ? '[Breakdown]' : '【内訳】';

      return {
        title: count > 0
          ? (isEn ? 'Code Redemption Succeeded' : 'コード交換成功')
          : (isEn ? 'Code Redemption Complete' : 'コード交換完了'),
        message: `${mainMsg}\n\n${breakdownHeader}\n${summaryLines.join('\n')}`,
        detail: null
      };
    }

    // 単一ゲーム結果の場合（後方互換）
    return {
      title: count > 0
        ? (isEn ? 'Code Redemption Succeeded' : 'コード交換成功')
        : (isEn ? 'Code Redemption Complete' : 'コード交換完了'),
      message: count > 0
        ? (isEn
            ? `Successfully redeemed ${count} code(s).\nPlease check your in-game mailbox.`
            : `${count}件のコードを引き換えました。\nゲーム内メールをご確認ください。`)
        : (isEn
            ? 'No new codes available to redeem.'
            : '利用可能な新しい引き換えコードはありませんでした。'),
      detail: null
    };
  }

  // 詳細原因（開発者解析用）のベース文字列
  const rawDetail = resp.reason || resp.error || (resp.retcode !== undefined ? `retcode: ${resp.retcode}` : (isEn ? 'No details' : '詳細情報なし'));
  const retcode = resp.retcode;
  const reason = resp.reason || '';

  // 未ログイン・セッション期限切れ
  if (retcode === -100 || retcode === -1071 || reason.includes('-100') || reason.includes('-1071') || reason.includes('Login expired') || reason.includes('Not logged in')) {
    return {
      title: isEn ? 'Code Redemption Failed' : 'コード交換失敗',
      message: isEn ? 'Not logged in. Please log in on the official site.' : '未ログインです。ログインを行ってください。',
      detail: rawDetail
    };
  }

  // キャラクター未作成 / 見つからない
  if (retcode === -1 || retcode === -2 || reason.includes('キャラクターが見つかりません') || reason.includes('No character') || reason.includes('Invalid UID or Region')) {
    return {
      title: isEn ? 'Code Redemption Failed' : 'コード交換失敗',
      message: isEn
        ? 'No character found for this game. Please create a character in the game first.'
        : '対象ゲームのキャラクター情報が見つかりません。ゲーム内でキャラクターを作成してください。',
      detail: rawDetail
    };
  }

  // 二重実行
  if (reason === 'ALREADY_RUNNING') {
    return {
      title: isEn ? 'Processing' : '処理中',
      message: isEn ? 'Code redemption is currently running. Please wait a moment.' : '現在引き換え処理を実行中です。完了までしばらくお待ちください。',
      detail: isEn ? 'Could not acquire execution lock (ALREADY_RUNNING)' : '排他実行ロックが獲得できませんでした (ALREADY_RUNNING)'
    };
  }

  // バックオフ・連続リクエスト制限中
  if (reason === 'UNDER_BACKOFF' || retcode === -2016) {
    return {
      title: isEn ? 'Redemption Paused' : 'コード交換一時停止中',
      message: isEn
        ? 'Requests are temporarily throttled. Please try again later.'
        : '連続リクエスト制限中のため、しばらく時間をおいてから再度お試しください。',
      detail: reason === 'UNDER_BACKOFF' ? (isEn ? 'In backoff period (paused for 30 minutes)' : 'バックオフ期間中 (30分間一時停止)') : rawDetail
    };
  }

  // 例外 / 通信エラー
  if (reason === 'EXCEPTION' || resp.error) {
    return {
      title: isEn ? 'Network Error' : '通信エラー',
      message: isEn
        ? 'A network or processing error occurred. Please check your connection and try again.'
        : '通信または処理中にエラーが発生しました。ネットワーク環境を確認の上、時間をおいて再度お試しください。',
      detail: resp.error || rawDetail
    };
  }

  // その他汎用失敗
  return {
    title: isEn ? 'Code Redemption Failed' : 'コード交換失敗',
    message: isEn ? 'Redemption failed. Please try again later.' : '引き換え処理に失敗しました。時間をおいて再度お試しください。',
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

/**
 * ログインボーナス受取結果からユーザー向け表示用タイトル、概要メッセージ、解析用詳細原因を生成する
 *
 * @param {object} [resp] - 実行結果レスポンス
 * @param {'ja'|'en'} [lang='ja'] - 表示言語
 * @returns {{ title: string, message: string, detail: string | null }}
 */
export function formatSignResult(resp, lang = 'ja') {
  const isEn = lang === 'en';

  if (!resp) {
    return {
      title: isEn ? 'Daily Check-In Failed' : 'ログインボーナス受取失敗',
      message: isEn ? 'No response received. Please try again.' : '応答がありませんでした。もう一度お試しください。',
      detail: 'レスポンスが空です (null or undefined)'
    };
  }

  if (resp.success && resp.results && typeof resp.results === 'object') {
    const resultKeys = Object.keys(resp.results);

    if (resultKeys.length === 1) {
      const singleKey = resultKeys[0];
      const res = resp.results[singleKey];
      const localizedGame = getGameLocalized(singleKey, lang);
      const name = isEn ? localizedGame.name : (res.gameName || localizedGame.name || singleKey);

      if (res.skipped && res.reason === 'NO_CHARACTER') {
        return {
          title: isEn ? 'Daily Check-In Status' : 'ログインボーナス確認',
          message: isEn
            ? `[${name}] No character created. Please create a character in the game first.`
            : `【${name}】キャラクターが作成されていません。ゲーム内でキャラクターを作成してください。`,
          detail: null
        };
      }
      if (res.isRisk) {
        return {
          title: isEn ? 'Verification Required' : 'セキュリティ認証が必要',
          message: isEn
            ? `[${name}] Security check (CAPTCHA) required. Please claim manually from the official check-in page.`
            : `【${name}】セキュリティ認証(CAPTCHA)が要求されました。公式ログインボーナスページを開いて手動で受け取ってください。`,
          detail: res.reason || 'CAPTCHA_REQUIRED'
        };
      }
      if (res.retcode === -100 || res.retcode === -1071 || res.reason === 'LOGIN_REQUIRED' || (res.reason && (res.reason.includes('-100') || res.reason.includes('-1071')))) {
        return {
          title: isEn ? 'Daily Check-In Failed' : 'ログインボーナス受取失敗',
          message: isEn
            ? `[${name}] Not logged in. Please log in on the official check-in page or website.`
            : `【${name}】未ログインです。公式ログインボーナスページまたは公式サイトでログインを行ってください。`,
          detail: res.reason || null
        };
      }
      if (!res.success) {
        return {
          title: isEn ? 'Daily Check-In Failed' : 'ログインボーナス受取失敗',
          message: isEn
            ? `[${name}] Check-in failed (${res.reason || 'error'}).`
            : `【${name}】受け取りに失敗しました (${res.reason || 'エラー'})。`,
          detail: res.reason || null
        };
      }

      const dayText = res.totalSignDay
        ? (isEn ? ` (Total: ${res.totalSignDay} days)` : `（今月累計: ${res.totalSignDay}日）`)
        : '';

      if (res.alreadySigned) {
        return {
          title: isEn ? 'Already Checked In' : 'ログインボーナス受取済',
          message: isEn
            ? `[${name}] Today's check-in has already been claimed${dayText}.`
            : `【${name}】本日のログインボーナスはすでに受け取り済みです${dayText}。`,
          detail: null
        };
      }

      return {
        title: isEn ? 'Daily Check-In Succeeded' : 'ログインボーナス受取成功',
        message: isEn
          ? `[${name}] Claimed today's check-in reward!${dayText}\nPlease check your in-game mailbox.`
          : `【${name}】本日のログインボーナスを受け取りました！${dayText}\nゲーム内メールをご確認ください。`,
        detail: null
      };
    }

    const summaryLines = [];
    let signedCount = resp.signedCount || 0;
    let hasError = false;

    for (const [key, res] of Object.entries(resp.results)) {
      const localizedGame = getGameLocalized(key, lang);
      const name = isEn ? localizedGame.name : (res.gameName || localizedGame.name || key);

      if (res.skipped && res.reason === 'NO_CHARACTER') {
        summaryLines.push(isEn ? `• ${name}: Skipped (no character)` : `・${name}: 未プレイのためスキップ`);
      } else if (res.isRisk) {
        summaryLines.push(isEn ? `• ${name}: CAPTCHA required (manual check-in needed)` : `・${name}: 要CAPTCHA認証（手動受取が必要）`);
        hasError = true;
      } else if (res.retcode === -100 || res.retcode === -1071 || res.reason === 'LOGIN_REQUIRED') {
        summaryLines.push(isEn ? `• ${name}: Not logged in` : `・${name}: 未ログイン`);
        hasError = true;
      } else if (res.success) {
        if (res.alreadySigned) {
          summaryLines.push(isEn ? `• ${name}: Already claimed today` : `・${name}: 本日受取済み`);
        } else {
          summaryLines.push(isEn ? `• ${name}: Successfully claimed` : `・${name}: 受取成功`);
        }
      } else {
        summaryLines.push(isEn ? `• ${name}: Error (${res.reason || 'failed'})` : `・${name}: エラー (${res.reason || '失敗'})`);
        hasError = true;
      }
    }

    let mainMsg = '';
    if (signedCount > 0) {
      mainMsg = isEn
        ? `Successfully claimed ${signedCount} check-in reward(s).`
        : `${signedCount}件のログインボーナスを受け取りました。`;
    } else if (hasError) {
      mainMsg = isEn
        ? 'Some games require login or manual confirmation.'
        : '一部のゲームでログインまたは手動確認が必要です。';
    } else {
      mainMsg = isEn
        ? "Today's daily check-in rewards are all claimed."
        : '本日のログインボーナスはすべて確認・受取済みです。';
    }

    const breakdownHeader = isEn ? '[Breakdown]' : '【内訳】';

    return {
      title: signedCount > 0
        ? (isEn ? 'Daily Check-In Succeeded' : 'ログインボーナス受取成功')
        : (isEn ? 'Daily Check-In Complete' : 'ログインボーナス確認完了'),
      message: `${mainMsg}\n\n${breakdownHeader}\n${summaryLines.join('\n')}`,
      detail: null
    };
  }

  const rawDetail = resp.reason || resp.error || (resp.retcode !== undefined ? `retcode: ${resp.retcode}` : (isEn ? 'No details' : '詳細情報なし'));
  const reason = resp.reason || '';

  if (reason === 'ALREADY_RUNNING') {
    return {
      title: isEn ? 'Processing' : '処理中',
      message: isEn ? 'Background check-in is currently running. Please wait a moment.' : '現在バックグラウンド処理を実行中です。完了までしばらくお待ちください。',
      detail: isEn ? 'Could not acquire execution lock (ALREADY_RUNNING)' : '排他実行ロックが獲得できませんでした (ALREADY_RUNNING)'
    };
  }

  if (reason === 'UNDER_BACKOFF') {
    return {
      title: isEn ? 'Temporarily Waiting' : '一時待機中',
      message: isEn
        ? 'Requests are temporarily throttled. Please try again later.'
        : '連続リクエスト制限中のため、しばらく時間をおいてから再度お試しください。',
      detail: isEn ? 'In backoff period (paused for 30 minutes)' : 'バックオフ期間中 (30分間一時停止)'
    };
  }

  return {
    title: isEn ? 'Daily Check-In Failed' : 'ログインボーナス受取失敗',
    message: isEn ? 'Check-in failed. Please try again later.' : '受け取り処理に失敗しました。時間をおいて再度お試しください。',
    detail: rawDetail
  };
}

import { GAMES, DOCS_URLS } from '../config/constants.js';

export const SUPPORTED_LANGUAGES = ['auto', 'ja', 'en'];

/**
 * 有効な言語コード ('ja' | 'en') を解決する
 * @param {string} [preferredLang] - 設定値 ('auto' | 'ja' | 'en')
 * @param {string} [fallbackBrowserLang] - テスト用/明示的なブラウザ言語の上書き
 * @returns {'ja' | 'en'}
 */
export function resolveLanguage(preferredLang, fallbackBrowserLang = null) {
  if (preferredLang === 'ja' || preferredLang === 'en') {
    return preferredLang;
  }

  // ブラウザUI言語またはnavigator.languageの判定
  let browserLang = fallbackBrowserLang || '';
  if (!browserLang) {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
        browserLang = chrome.i18n.getUILanguage() || '';
      }
    } catch {
      // ignore
    }
  }

  if (!browserLang) {
    try {
      if (typeof navigator !== 'undefined' && navigator.language) {
        browserLang = navigator.language;
      }
    } catch {
      // ignore
    }
  }

  if (browserLang && browserLang.toLowerCase().startsWith('ja')) {
    return 'ja';
  }

  if (browserLang) {
    return 'en';
  }

  // Node.js テスト環境等、ブラウザ言語が取得できない場合のデフォルト
  return 'ja';
}

/**
 * 00:05 UTC+8 (16:05 UTC) をユーザーのローカル環境の「HH:mm」形式で取得する
 * @returns {string} 例: '01:05'
 */
export function getPrivacyPolicyUrl(lang = 'ja') {
  return lang === 'en' ? DOCS_URLS.PRIVACY_POLICY_EN : DOCS_URLS.PRIVACY_POLICY;
}

/**
 * 言語別の使い方ガイドURLを取得する
 * @param {'ja'|'en'} [lang]
 * @returns {string}
 */
export function getGuideUrl(lang = 'ja') {
  return lang === 'en' ? DOCS_URLS.README_EN : DOCS_URLS.README;
}

export function formatDailySignTimeLocal() {
  const d = new Date();
  d.setUTCHours(16, 5, 0, 0);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 言語設定に応じたゲーム基本情報（多言語名称、URL等）を取得する
 * @param {string} gameKey
 * @param {'ja'|'en'} [lang]
 */
export function getGameLocalized(gameKey, lang = 'ja') {
  const isEn = lang === 'en';
  const base = GAMES[gameKey] || {};

  switch (gameKey) {
    case 'GENSHIN':
      return {
        ...base,
        name: isEn ? 'Genshin Impact' : '原神',
        shortName: isEn ? 'GI' : '原',
        tabLabel: isEn ? 'Genshin' : '原神',
        giftSiteUrl: isEn ? 'https://genshin.hoyoverse.com/en/gift' : 'https://genshin.hoyoverse.com/ja/gift'
      };
    case 'STAR_RAIL':
      return {
        ...base,
        name: isEn ? 'Honkai: Star Rail' : '崩壊：スターレイル',
        shortName: isEn ? 'HSR' : '星',
        tabLabel: isEn ? 'Star Rail' : 'スタレ',
        giftSiteUrl: base.giftSiteUrl || 'https://hsr.hoyoverse.com/gift'
      };
    case 'ZZZ':
      return {
        ...base,
        name: isEn ? 'Zenless Zone Zero' : 'ゼンレスゾーンゼロ',
        shortName: 'ZZZ',
        tabLabel: 'ZZZ',
        giftSiteUrl: base.giftSiteUrl || 'https://zenless.hoyoverse.com/redemption/gift'
      };
    default:
      return {
        ...base,
        name: base.name || gameKey,
        shortName: base.shortName || gameKey,
        tabLabel: base.tabLabel || gameKey,
        giftSiteUrl: base.giftSiteUrl || ''
      };
  }
}

/**
 * 交換API用の lang パラメータ
 * @param {'ja'|'en'} lang
 * @returns {'ja'|'en'}
 */
export function getExchangeApiLang(lang = 'ja') {
  return lang === 'en' ? 'en' : 'ja';
}

/**
 * ログボAPI用の lang パラメータ
 * @param {'ja'|'en'} lang
 * @returns {'ja-jp'|'en-us'}
 */
export function getSignApiLang(lang = 'ja') {
  return lang === 'en' ? 'en-us' : 'ja-jp';
}

export const MESSAGES = {
  ja: {
    // 初回モーダル
    optinTitle: '利用開始のご確認',
    optinDesc: '本拡張機能（HoYoPass）をご利用いただく前に、以下の内容をご確認・同意してください。',
    optinDisclaimerTitle: '【免責事項】',
    optinDisclaimerBody: '本拡張機能は非公式のファンメイドツールであり、COGNOSPHERE / HoYoverseとは関係ありません。本ツール内で使用されているゲーム画像・商標の権利は、各権利者に帰属します。',
    optinGameTitle: '利用するゲーム',
    optinGameHint: '※表示するゲームは、開始後もタブ横の設定（⚙）からいつでも変更できます。',
    optinSecurityNote: '※ 本拡張機能はお使いのブラウザに保存された公式ログインCookieをローカルでのみ利用し、外部サーバーへのCookie送信・収集は一切行いません。詳細は{0}をご確認ください。',
    optinAnalyticsLabel: '匿名の利用統計データを送信する（品質向上用）',
    privacyPolicy: 'プライバシーポリシー',
    optinAcceptBtn: '同意して利用を開始する',

    // レビュー促進バナー
    reviewPromptTitle: 'いつもご利用ありがとうございます！',
    reviewPromptBody: 'HoYoPassはお役に立っていますか？よろしければストアで星評価やレビューをいただけると、開発の大きな励みになります！',
    reviewPromptBtnWrite: 'レビューを書く',
    reviewPromptBtnLater: 'あとで',
    reviewPromptBtnDismiss: '今後は表示しない',

    // 既存ユーザー向けアナリティクス同意モーダル
    analyticsConsentTitle: '品質向上のための統計情報収集について',
    analyticsConsentDesc: 'HoYoPassでは機能改善のため、個人情報を含まない匿名の利用統計情報（引き換え成否やエラー発生状況など）を収集しています。UIDやアカウント情報、Cookieは一切収集されません。後からいつでも設定で変更できます。',
    analyticsConsentAcceptBtn: '協力する',
    analyticsConsentDeclineBtn: '協力しない',

    // ポリシー改定モーダル
    policyUpdateTitle: 'プライバシーポリシー改定のお知らせ',
    policyUpdateDesc: 'プライバシーポリシーが改定されました（改定日: {0}）。引き続きご利用いただく前に、{1}をご確認ください。',
    policyUpdateAcceptBtn: '確認して同意する',

    // 設定モーダル
    settingsTitle: '設定',
    settingsLanguageLabel: '表示言語',
    langAuto: '自動',
    settingsGamesLabel: '表示するゲーム',
    settingsAnalyticsLabel: '匿名の利用統計',
    settingsAnalyticsDesc: '品質向上のため匿名の利用統計データを送信する',
    btnCancel: 'キャンセル',
    btnSave: '保存',

    // 結果モーダル
    dialogDetails: '詳細情報',
    btnOk: 'OK',

    // ヘッダー & ステータス
    gameTabsAria: 'ゲーム選択',
    tabSettingsTitle: '設定',
    gameIconTitle: '{0}のコード交換サイトを開く',
    statusChecking: '確認中...',
    statusOnline: 'ログイン中: {0}',
    statusNoChar: 'キャラ不在',
    statusLoggedOut: '未ログイン',
    statusOffline: 'オフライン',
    uidCopyTitle: 'クリックしてUIDをコピー',
    uidCopied: 'コピー完了!',

    // カード1: ログインボーナス
    signCardTitle: 'デイリーログインボーナス',
    btnOfficial: '公式 ↗',
    btnOfficialSignTitle: '{0}の公式ログインボーナスページを開く',
    signStatusLabel: '本日の受取状況',
    signStatusSigned: '本日受取済',
    signStatusUnsigned: '未受取',
    signStatusDays: ' (累計 {0}日)',
    signStatusMonthDays: '（今月累計: {0}日）',
    signStatusSkipped: '未確認',
    autoSignLabel: '自動受け取り (毎日 {0}頃)',
    autoSignToggleTitle: '自動受け取りのON/OFF',
    btnManualSignTitle: '今すぐボーナス受取 (手動実行)',

    // カード2: 交換コード
    redeemCardTitle: '交換コード自動引き換え',
    btnOfficialGiftTitle: '{0}の公式コード交換サイトを開く',
    redeemStatusLabelDefault: 'コード適用状況',
    redeemStatusLabelNone: '有効コード なし',
    redeemStatusLabelActive: '有効コード {0}/{1} 適用済',
    redeemStatsBadge: '今月 {0}件 / 通算 {1}件',
    autoRedeemLabel: '定期自動引き換え ({0})',
    intervalLabelHours: '{0}時間毎',
    intervalLabelMinutes: '{0}分毎',
    autoRedeemToggleTitle: '定期自動引き換えのON/OFF',
    btnManualRedeemTitle: '今すぐ引き換え実行 (手動実行)',
    nextRunTooltipStopped: '定期自動引き換え: 停止中',
    nextRunTooltipScheduled: '次回自動実行予定: {0}',
    nextRunTooltipRunning: '定期自動引き換え: 稼働中 ({0})',

    // ログ
    latestLogEmpty: '直近のログ: 履歴なし',
    latestLogError: '直近のログ: エラー{0}',
    latestLogWarn: '直近のログ: 要確認{0}',
    latestLogSuccess: '直近のログ: 正常完了{0}',
    noLogs: '該当するログはありません。',

    // フッター
    footerGuide: '使い方ガイド',
    footerDisclaimer: '非公式ファンメイドツール<br>（COGNOSPHERE / HoYoverseとは関係ありません）',

    // 通知 & ログ
    notifLoginTitle: 'ログインが必要です',
    notifLoginMsgRedeem: '{0}の公式サイトで再ログインしてください。',
    notifLoginMsgSign: '{0}の公式ログインボーナスページでログインしてください。',
    notifCaptchaTitle: 'ログインボーナス手動確認が必要',
    notifCaptchaMsg: '{0}でCAPTCHA認証が要求されました。クリックして公式ページから受け取ってください。',
    notifStorageWarningTitle: '容量警告',
    notifStorageWarningMsg: '拡張機能の保存容量が80%を超過しています。整理を推奨します。',
    notifStorageErrorTitle: '拡張機能エラー',
    notifStorageErrorMsg: 'ストレージ容量が上限に達したため、自動実行を停止しました。',

    logRetryRedeem: '一時的な通信不通を検知したため、約{0}分後に自動再試行します ({1}/{2}回目)',
    logRetrySign: 'ログインボーナス通信不通のため、約{0}分後に自動再試行します ({1}/{2}回目)',
    logRetryExhaustedRedeem: '通信エラーの再試行上限({0}回)に達したため、今回の自動再試行を停止しました。',
    logRetryExhaustedSign: '[ログボ] 通信エラーの再試行上限({0}回)に達したため、今回の自動再試行を停止しました。',
    logHttpBackoff: '{0}: サーバー応答(HTTP {1})により約{2}分間一時停止します。',
    logNoCharSkip: '{0}: キャラクターが見つからないためスキップしました',
    logNoCharSkipSign: '{0}: [ログボ] キャラクターが見つからないためスキップしました',
    logDailyLimit: '{0}: 1日の新規コード受付上限(20件)に達したためスキップしました。',
    logRedeemComplete: '{0}: 引き換え完了 (新規成功: {1}件)',
    logBackoffAbort: 'バックオフ発動中のため {0} 以降の処理を中断しました。',
    logExceptionRedeem: '例外発生: {0}',
    logExceptionSign: '[ログボ] 例外発生: {0}',
    logSignAlready: '{0}: [ログボ] 本日受取済み{1}',
    logSignDone: '{0}: [ログボ] 受取完了{1}',
    logSignRisk: '{0}: [ログボ] セキュリティ認証(CAPTCHA)が必要です。公式ページから手動で受け取ってください',

    // API共通メッセージ
    apiNoChar: 'アカウント内にキャラクターが見つかりません',
    apiInvalidUidRegion: '有効なUIDまたはRegionに一致しません ({0})',
    apiInvalidGameConfig: '不正なゲーム設定です',
    apiCaptchaRequired: 'セキュリティ認証(CAPTCHA)が必要です。公式ページから手動で受け取ってください。',
    apiAlreadySignedToday: '本日はすでにサインイン済みです',
    apiPleaseLogin: 'ログインしてください',

    // 結果フォーマッタ共通
    fmtEmptyRespMsg: '応答がありませんでした。もう一度お試しください。',
    fmtNoDetails: '詳細情報なし',
    fmtBreakdownHeader: '【内訳】',
    fmtProcessingTitle: '処理中',
    fmtLockDetail: '排他実行ロックが獲得できませんでした (ALREADY_RUNNING)',
    fmtBackoffMsg: '連続リクエスト制限中のため、しばらく時間をおいてから再度お試しください。',
    fmtBackoffDetail: 'バックオフ期間中 (30分間一時停止)',
    fmtBackoffDetailWithMinutes: 'バックオフ期間中 (残り約{0}分一時停止)',
    fmtManualCooldownTitle: 'しばらくお待ちください',
    fmtManualCooldownMsg: 'サーバー負荷軽減のため、連続実行を制限しています。あと約{0}秒ほどお待ちください。',
    fmtManualCooldownDetail: '手動実行クールダウン中 (残り約{0}秒)',
    fmtSingleNoCharMsg: '【{0}】キャラクターが作成されていません。ゲーム内でキャラクターを作成してください。',
    fmtItemSkippedNoChar: '・{0}: 未プレイのためスキップ',
    fmtItemNotLoggedIn: '・{0}: 未ログイン',
    fmtItemError: '・{0}: エラー ({1})',
    fmtFallbackFailed: '失敗',
    fmtFallbackError: 'エラー',

    // コード引き換え結果フォーマット
    fmtRedeemTitleFailed: 'コード交換失敗',
    fmtRedeemTitleSuccess: 'コード交換成功',
    fmtRedeemTitleComplete: 'コード交換完了',
    fmtRedeemTitlePaused: 'コード交換一時停止中',
    fmtRedeemTitleNetworkErr: '通信エラー',
    fmtRedeemSingleNotLoggedIn: '【{0}】未ログインです。公式サイトでログインを行ってください。',
    fmtRedeemSingleFailed: '【{0}】引き換えに失敗しました ({1})。',
    fmtRedeemSingleSuccess: '【{0}】{1}件のコードを引き換えました。\nゲーム内メールをご確認ください。',
    fmtRedeemSingleNoNew: '【{0}】利用可能な新しい引き換えコードはありませんでした。',
    fmtRedeemItemSuccess: '・{0}: {1}件引き換え成功',
    fmtRedeemItemNoNew: '・{0}: 新規コードなし',
    fmtRedeemMultiSuccess: '{0}件のコードを引き換えました。\nゲーム内メールをご確認ください。',
    fmtRedeemMultiNoGames: 'キャラクターが作成されているゲームが見つかりませんでした。',
    fmtRedeemMultiNeedLogin: 'ログインが必要なゲームがあります。公式サイトで再ログインしてください。',
    fmtRedeemMultiNoNew: '利用可能な新しい引き換えコードはありませんでした。',
    fmtRedeemErrNotLoggedIn: '未ログインです。ログインを行ってください。',
    fmtRedeemErrNoChar: '対象ゲームのキャラクター情報が見つかりません。ゲーム内でキャラクターを作成してください。',
    fmtRedeemRunningMsg: '現在引き換え処理を実行中です。完了までしばらくお待ちください。',
    fmtRedeemNetworkErrMsg: '通信または処理中にエラーが発生しました。ネットワーク環境を確認の上、時間をおいて再度お試しください。',
    fmtRedeemGenericErrMsg: '引き換え処理に失敗しました。時間をおいて再度お試しください。',

    // ログインボーナス結果フォーマット
    fmtSignTitleFailed: 'ログインボーナス受取失敗',
    fmtSignTitleStatus: 'ログインボーナス確認',
    fmtSignTitleVerify: 'セキュリティ認証が必要',
    fmtSignTitleAlready: 'ログインボーナス受取済',
    fmtSignTitleSuccess: 'ログインボーナス受取成功',
    fmtSignTitleComplete: 'ログインボーナス確認完了',
    fmtSignTitleWaiting: '一時待機中',
    fmtSignSingleCaptcha: '【{0}】セキュリティ認証(CAPTCHA)が要求されました。公式ログインボーナスページを開いて手動で受け取ってください。',
    fmtSignSingleNotLoggedIn: '【{0}】未ログインです。公式ログインボーナスページまたは公式サイトでログインを行ってください。',
    fmtSignSingleFailed: '【{0}】受け取りに失敗しました ({1})。',
    fmtSignSingleAlready: '【{0}】本日のログインボーナスはすでに受け取り済みです{1}。',
    fmtSignSingleSuccess: '【{0}】本日のログインボーナスを受け取りました！{1}\nゲーム内メールをご確認ください。',
    fmtSignItemCaptcha: '・{0}: 要CAPTCHA認証（手動受取が必要）',
    fmtSignItemAlready: '・{0}: 本日受取済み',
    fmtSignItemSuccess: '・{0}: 受取成功',
    fmtSignMultiSuccess: '{0}件のログインボーナスを受け取りました。',
    fmtSignMultiHasError: '一部のゲームでログインまたは手動確認が必要です。',
    fmtSignMultiAllDone: '本日のログインボーナスはすべて確認・受取済みです。',
    fmtSignRunningMsg: '現在バックグラウンド処理を実行中です。完了までしばらくお待ちください。',
    fmtSignGenericErrMsg: '受け取り処理に失敗しました。時間をおいて再度お試しください。'
  },

  en: {
    // First-run Opt-in Modal
    optinTitle: 'Welcome to HoYoPass',
    optinDesc: 'Please review and agree to the following information before using HoYoPass.',
    optinDisclaimerTitle: '[Disclaimer]',
    optinDisclaimerBody: 'This extension is an unofficial fan-made tool and is not affiliated with COGNOSPHERE or HoYoverse. All game trademarks and copyrights belong to their respective owners.',
    optinGameTitle: 'Enabled Games',
    optinGameHint: '* You can change enabled games anytime from the settings (⚙) icon next to the tabs.',
    optinSecurityNote: '* This extension uses official login cookies locally in your browser and never sends or collects cookies to external servers. See our {0} for details.',
    optinAnalyticsLabel: 'Share anonymous usage statistics to help improve HoYoPass',
    privacyPolicy: 'Privacy Policy',
    optinAcceptBtn: 'Agree and Get Started',

    // Review Prompt Banner
    reviewPromptTitle: 'Enjoying HoYoPass?',
    reviewPromptBody: 'If HoYoPass has saved you time, please consider leaving a review on the Chrome Web Store. It helps us a lot!',
    reviewPromptBtnWrite: 'Rate on Web Store',
    reviewPromptBtnLater: 'Later',
    reviewPromptBtnDismiss: "Don't show again",

    // Existing user analytics consent modal
    analyticsConsentTitle: 'Anonymous Usage Statistics',
    analyticsConsentDesc: 'HoYoPass collects anonymous usage metrics (such as redemption success rates and error types) to help improve quality. No personal data, UIDs, account details, or cookies are collected. You can change this at any time in Settings.',
    analyticsConsentAcceptBtn: 'Allow',
    analyticsConsentDeclineBtn: 'Decline',

    // Policy Update Modal
    policyUpdateTitle: 'Privacy Policy Update',
    policyUpdateDesc: 'Our Privacy Policy has been updated (Effective: {0}). Please review the {1} before continuing.',
    policyUpdateAcceptBtn: 'Agree and Continue',

    // Settings Modal
    settingsTitle: 'Settings',
    settingsLanguageLabel: 'Language',
    langAuto: 'Auto',
    settingsGamesLabel: 'Enabled Games',
    settingsAnalyticsLabel: 'Anonymous Analytics',
    settingsAnalyticsDesc: 'Send anonymous usage data to help improve quality',
    btnCancel: 'Cancel',
    btnSave: 'Save',

    // Dialog Modal
    dialogDetails: 'Details',
    btnOk: 'OK',

    // Header & Status
    gameTabsAria: 'Game Selection',
    tabSettingsTitle: 'Settings',
    gameIconTitle: 'Open {0} code exchange site',
    statusChecking: 'Checking...',
    statusOnline: 'Logged in: {0}',
    statusNoChar: 'No Character',
    statusLoggedOut: 'Not Logged In',
    statusOffline: 'Offline',
    uidCopyTitle: 'Click to copy UID',
    uidCopied: 'Copied!',

    // Card 1: Check-in
    signCardTitle: 'Daily Check-In',
    btnOfficial: 'Official ↗',
    btnOfficialSignTitle: 'Open official {0} check-in page',
    signStatusLabel: "Today's Status",
    signStatusSigned: 'Claimed Today',
    signStatusUnsigned: 'Not Claimed',
    signStatusDays: ' ({0} days)',
    signStatusMonthDays: ' (Total: {0} days)',
    signStatusSkipped: 'Unchecked',
    autoSignLabel: 'Auto Claim (Daily ~{0})',
    autoSignToggleTitle: 'Toggle Auto Check-In',
    btnManualSignTitle: 'Claim Check-In Now (Manual)',

    // Card 2: Codes
    redeemCardTitle: 'Auto Code Redeemer',
    btnOfficialGiftTitle: 'Open official {0} code exchange site',
    redeemStatusLabelDefault: 'Code Status',
    redeemStatusLabelNone: 'No Active Codes',
    redeemStatusLabelActive: 'Active Codes: {0}/{1} Claimed',
    redeemStatsBadge: 'Month: {0} / Total: {1}',
    autoRedeemLabel: 'Auto Redeem ({0})',
    intervalLabelHours: 'Every {0}h',
    intervalLabelMinutes: 'Every {0}m',
    autoRedeemToggleTitle: 'Toggle Auto Redeem',
    btnManualRedeemTitle: 'Redeem Codes Now (Manual)',
    nextRunTooltipStopped: 'Auto Redeem: Paused',
    nextRunTooltipScheduled: 'Next run scheduled: {0}',
    nextRunTooltipRunning: 'Auto Redeem: Active ({0})',

    // Logs
    latestLogEmpty: 'Latest: No logs',
    latestLogError: 'Latest: Error{0}',
    latestLogWarn: 'Latest: Warning{0}',
    latestLogSuccess: 'Latest: Success{0}',
    noLogs: 'No logs available.',

    // Footer
    footerGuide: 'User Guide',
    footerDisclaimer: 'Unofficial Fan-made Tool<br>(Not affiliated with COGNOSPHERE / HoYoverse)',

    // Notifications & Logs
    notifLoginTitle: 'Login Required',
    notifLoginMsgRedeem: 'Please log in to the official {0} website again.',
    notifLoginMsgSign: 'Please log in to the official {0} check-in page.',
    notifCaptchaTitle: 'Verification Required',
    notifCaptchaMsg: 'CAPTCHA security check required for {0}. Click to claim manually on the official page.',
    notifStorageWarningTitle: 'Storage Warning',
    notifStorageWarningMsg: 'Extension storage is over 80% capacity. Cleanup is recommended.',
    notifStorageErrorTitle: 'Extension Error',
    notifStorageErrorMsg: 'Extension storage is full. Background execution paused.',

    logRetryRedeem: 'Temporary network error detected. Retrying in about {0} min (attempt {1}/{2}).',
    logRetrySign: 'Check-in network error detected. Retrying in about {0} min (attempt {1}/{2}).',
    logRetryExhaustedRedeem: 'Automatic retry paused after reaching the maximum {0} attempts due to network errors.',
    logRetryExhaustedSign: '[Check-in] Automatic retry paused after reaching the maximum {0} attempts due to network errors.',
    logHttpBackoff: '{0}: Server response (HTTP {1}) detected. Pausing requests for about {2} minutes.',
    logNoCharSkip: '{0}: Skipped because no character was found.',
    logNoCharSkipSign: '{0}: [Check-in] Skipped because no character was found.',
    logDailyLimit: '{0}: Skipped because daily new code limit (20) was reached.',
    logRedeemComplete: '{0}: Finished redeeming ({1} new succeeded)',
    logBackoffAbort: 'Paused processing for {0} and subsequent games due to active backoff.',
    logExceptionRedeem: 'Exception occurred: {0}',
    logExceptionSign: '[Check-in] Exception occurred: {0}',
    logSignAlready: '{0}: [Check-in] Already claimed today{1}',
    logSignDone: '{0}: [Check-in] Successfully claimed{1}',
    logSignRisk: '{0}: [Check-in] Security verification (CAPTCHA) required. Please claim manually.',

    // API Common Messages
    apiNoChar: 'No character found in account',
    apiInvalidUidRegion: 'Invalid UID or Region ({0})',
    apiInvalidGameConfig: 'Invalid game configuration',
    apiCaptchaRequired: 'Security verification (CAPTCHA) required. Please claim manually from the official page.',
    apiAlreadySignedToday: 'Already checked in today',
    apiPleaseLogin: 'Please log in',

    // Formatter Common
    fmtEmptyRespMsg: 'No response received. Please try again.',
    fmtNoDetails: 'No details',
    fmtBreakdownHeader: '[Breakdown]',
    fmtProcessingTitle: 'Processing',
    fmtLockDetail: 'Could not acquire execution lock (ALREADY_RUNNING)',
    fmtBackoffMsg: 'Requests are temporarily throttled. Please try again later.',
    fmtBackoffDetail: 'In backoff period (paused for 30 minutes)',
    fmtBackoffDetailWithMinutes: 'In backoff period (paused for ~{0} min)',
    fmtManualCooldownTitle: 'Please Wait',
    fmtManualCooldownMsg: 'Please wait about {0} second(s) before running this action again.',
    fmtManualCooldownDetail: 'Manual cooldown active (~{0}s remaining)',
    fmtSingleNoCharMsg: '[{0}] No character created. Please create a character in the game first.',
    fmtItemSkippedNoChar: '• {0}: Skipped (no character)',
    fmtItemNotLoggedIn: '• {0}: Not logged in',
    fmtItemError: '• {0}: Error ({1})',
    fmtFallbackFailed: 'failed',
    fmtFallbackError: 'error',

    // Code Redemption Formatter
    fmtRedeemTitleFailed: 'Code Redemption Failed',
    fmtRedeemTitleSuccess: 'Code Redemption Succeeded',
    fmtRedeemTitleComplete: 'Code Redemption Complete',
    fmtRedeemTitlePaused: 'Redemption Paused',
    fmtRedeemTitleNetworkErr: 'Network Error',
    fmtRedeemSingleNotLoggedIn: '[{0}] Not logged in. Please log in on the official website.',
    fmtRedeemSingleFailed: '[{0}] Redemption failed ({1}).',
    fmtRedeemSingleSuccess: '[{0}] Successfully redeemed {1} code(s).\nPlease check your in-game mailbox.',
    fmtRedeemSingleNoNew: '[{0}] No new codes available to redeem.',
    fmtRedeemItemSuccess: '• {0}: Redeemed {1} code(s)',
    fmtRedeemItemNoNew: '• {0}: No new codes',
    fmtRedeemMultiSuccess: 'Successfully redeemed {0} code(s).\nPlease check your in-game mailbox.',
    fmtRedeemMultiNoGames: 'No games with created characters were found.',
    fmtRedeemMultiNeedLogin: 'Some games require login. Please re-login on the official website.',
    fmtRedeemMultiNoNew: 'No new codes available to redeem.',
    fmtRedeemErrNotLoggedIn: 'Not logged in. Please log in on the official site.',
    fmtRedeemErrNoChar: 'No character found for this game. Please create a character in the game first.',
    fmtRedeemRunningMsg: 'Code redemption is currently running. Please wait a moment.',
    fmtRedeemNetworkErrMsg: 'A network or processing error occurred. Please check your connection and try again.',
    fmtRedeemGenericErrMsg: 'Redemption failed. Please try again later.',

    // Daily Check-in Formatter
    fmtSignTitleFailed: 'Daily Check-In Failed',
    fmtSignTitleStatus: 'Daily Check-In Status',
    fmtSignTitleVerify: 'Verification Required',
    fmtSignTitleAlready: 'Already Checked In',
    fmtSignTitleSuccess: 'Daily Check-In Succeeded',
    fmtSignTitleComplete: 'Daily Check-In Complete',
    fmtSignTitleWaiting: 'Temporarily Waiting',
    fmtSignSingleCaptcha: '[{0}] Security check (CAPTCHA) required. Please claim manually from the official check-in page.',
    fmtSignSingleNotLoggedIn: '[{0}] Not logged in. Please log in on the official check-in page or website.',
    fmtSignSingleFailed: '[{0}] Check-in failed ({1}).',
    fmtSignSingleAlready: "[{0}] Today's check-in has already been claimed{1}.",
    fmtSignSingleSuccess: "[{0}] Claimed today's check-in reward!{1}\nPlease check your in-game mailbox.",
    fmtSignItemCaptcha: '• {0}: CAPTCHA required (manual check-in needed)',
    fmtSignItemAlready: '• {0}: Already claimed today',
    fmtSignItemSuccess: '• {0}: Successfully claimed',
    fmtSignMultiSuccess: 'Successfully claimed {0} check-in reward(s).',
    fmtSignMultiHasError: 'Some games require login or manual confirmation.',
    fmtSignMultiAllDone: "Today's daily check-in rewards are all claimed.",
    fmtSignRunningMsg: 'Background check-in is currently running. Please wait a moment.',
    fmtSignGenericErrMsg: 'Check-in failed. Please try again later.'
  }
};

/**
 * 翻訳文字列を取得する
 * @param {string} key
 * @param {any[]} [params]
 * @param {'ja'|'en'} [lang]
 * @returns {string}
 */
export function t(key, params = [], lang = 'ja') {
  const dict = MESSAGES[lang] || MESSAGES.ja;
  let str = dict[key] || MESSAGES.ja[key] || key;

  if (Array.isArray(params) && params.length > 0) {
    params.forEach((val, idx) => {
      str = str.replaceAll(`{${idx}}`, String(val ?? ''));
    });
  }

  return str;
}

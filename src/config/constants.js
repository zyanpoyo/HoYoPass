import { FLAVOR_CONFIG, GA_MEASUREMENT_ID, GA_API_SECRET } from './env.js';

export const API_CONFIG = {
  CODE_API_TIMEOUT_MS: 10_000,
  HOYO_API_TIMEOUT_MS: 10_000,
  GA_TIMEOUT_MS: 5_000,
  GA_SESSION_TIMEOUT_MS: 30 * 60 * 1000,
  GA_MEASUREMENT_ID: GA_MEASUREMENT_ID ?? '',
  GA_API_SECRET: GA_API_SECRET ?? '',
  REDEEM_INTERVAL_MINUTES: FLAVOR_CONFIG?.config?.REDEEM_INTERVAL_MINUTES ?? 180,
  RETRY_INTERVAL_MINUTES: 2, // 2分後短期リトライ
  CATCH_UP_DELAY_MS: FLAVOR_CONFIG?.config?.CATCH_UP_DELAY_MS ?? 15_000,
  CATCH_UP_JITTER_MAX_MS: 30_000, // キャッチアップ待機ランダム揺らぎ (最大+30秒)
  CATCH_UP_KEEPALIVE_INTERVAL_MS: 20_000, // キャッチアップ待機中のSW停止防止分割間隔 (20秒)
  DAILY_SIGN_JITTER_MAX_MINUTES: 30, // ログボ定時アラーム分散幅 (0〜30分)
  INTER_REQUEST_DELAY_MS: 5_200, // 5.2秒ウェイト
  INTER_REQUEST_JITTER_MAX_MS: 1_500, // コード交換間ランダム揺らぎ (最大+1.5秒)
  SIGN_GAME_DELAY_MS: 1_500, // ログボゲーム間ウェイト
  SIGN_GAME_JITTER_MAX_MS: 1_000, // ログボゲーム間ランダム揺らぎ (最大+1秒)
  MAX_CODE_RETRIES: 3,
  RETRY_DELAY_STEPS_MINUTES: [2, 10, 30], // 短期リトライ段階間隔 (最大3回)
  RETRY_JITTER_MAX_MINUTES: 0.5, // リトライ遅延ランダム揺らぎ (最大+30秒)
  BACKOFF_DURATION_MS: 30 * 60 * 1000, // 30分間バックオフ
  BACKOFF_STEPS_MS: [30 * 60 * 1000, 60 * 60 * 1000, 120 * 60 * 1000], // 指数バックオフ段階 (30→60→120分)
  AUTO_ATTEMPT_COOLDOWN_MINUTES: 180, // 自動キャッチアップ再試行クールダウン (3時間)
  MANUAL_COOLDOWN_MS: 60_000, // 手動実行ボタン連打制限 (60秒)
  MAX_EXTERNAL_PAYLOAD_BYTES: 256 * 1024, // 256KB制限
  MAX_NEW_CODES_PER_FETCH: 50, // 1回あたりの最大取得コード数
  DAILY_NEW_CODE_LIMIT: 20, // 1日あたりの新規コード上限
  STORAGE_WARNING_THRESHOLD: 0.8, // 80%容量監視
  MAX_REDEEMED_HISTORY_LIMIT: 3000, // 古い確定記録整理の閾値
  MAX_EXECUTION_LOGS: 50, // ポップアップ・ストレージ保持ログ件数
  IS_DEV: FLAVOR_CONFIG?.config?.IS_DEV ?? false,
  FLAVOR_UI: FLAVOR_CONFIG?.ui ?? {
    badgeText: '',
    intervalLabel: '定期自動引き換え (3時間毎)',
    signIntervalLabel: '自動受け取り (毎日 01:05頃)'
  }
};

export const ALARM_NAMES = {
  AUTO_REDEEM: 'hoyo_auto_redeem_alarm',
  RETRY: 'hoyo_retry_alarm',
  DAILY_SIGN: 'hoyo_daily_sign_alarm',
  SIGN_RETRY: 'hoyo_sign_retry_alarm'
};

export const STATUS_MAP = {
  SUCCESS: 0,
  ALREADY_CLAIMED: 1,
  EXPIRED: 2,
  INVALID: 3,
  FAILED: 4,
  PENDING_RETRY: 5
};

export const DEFAULT_ENABLED_GAMES = ['GENSHIN', 'STAR_RAIL', 'ZZZ'];

export const GAMES = {
  GENSHIN: {
    name: '原神',
    shortName: '原',
    tabLabel: '原神',
    iconPath: '/assets/icons/genshin.png',
    gameBiz: 'hk4e_global',
    exchangeHost: 'https://sg-hk4e-api.hoyoverse.com',
    exchangePath: '/common/apicdkey/api/webExchangeCdkey',
    hoyoCodesParam: 'genshin',
    giftSiteUrl: 'https://genshin.hoyoverse.com/ja/gift',
    actId: 'e202102251931481',
    signGameHeader: 'hk4e',
    signHosts: [
      'https://sg-hk4e-api.hoyolab.com',
      'https://sg-hk4e-api.hoyoverse.com'
    ],
    infoPath: '/event/sol/info',
    signPath: '/event/sol/sign',
    checkInSiteUrl: 'https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481'
  },
  STAR_RAIL: {
    name: '崩壊：スターレイル',
    shortName: '星',
    tabLabel: 'スタレ',
    iconPath: '/assets/icons/starrail.png',
    gameBiz: 'hkrpg_global',
    exchangeHost: 'https://sg-hkrpg-api.hoyoverse.com',
    exchangePath: '/common/apicdkey/api/webExchangeCdkey',
    hoyoCodesParam: 'hkrpg',
    giftSiteUrl: 'https://hsr.hoyoverse.com/gift',
    actId: 'e202303301540311',
    signGameHeader: 'hkrpg',
    signHosts: [
      'https://sg-public-api.hoyolab.com',
      'https://sg-public-api.hoyoverse.com'
    ],
    infoPath: '/event/luna/os/info',
    signPath: '/event/luna/os/sign',
    checkInSiteUrl: 'https://act.hoyolab.com/bbs/event/signin/hkrpg/index.html?act_id=e202303301540311'
  },
  ZZZ: {
    name: 'ゼンレスゾーンゼロ',
    shortName: '絶',
    tabLabel: 'ZZZ',
    iconPath: '/assets/icons/zzz.png',
    gameBiz: 'nap_global',
    exchangeHost: 'https://public-operation-nap.hoyoverse.com',
    exchangePath: '/common/apicdkey/api/webExchangeCdkey',
    hoyoCodesParam: 'nap',
    giftSiteUrl: 'https://zenless.hoyoverse.com/redemption/gift',
    actId: 'e202406031448091',
    signGameHeader: 'zzz',
    signHosts: [
      'https://sg-act-nap-api.hoyolab.com',
      'https://sg-act-nap-api.hoyoverse.com'
    ],
    infoPath: '/event/luna/zzz/os/info',
    signPath: '/event/luna/zzz/os/sign',
    checkInSiteUrl: 'https://act.hoyolab.com/bbs/event/signin/zzz/index.html?act_id=e202406031448091'
  }
};

export const ALLOWED_REGIONS = [
  'os_usa', 'os_euro', 'os_asia', 'os_cht',
  'prod_official_usa', 'prod_official_eur', 'prod_official_asia', 'prod_official_cht', 'prod_official_jp',
  'prod_gf_us', 'prod_gf_eu', 'prod_gf_jp', 'prod_gf_sg'
];

// ポリシーのバージョン（制定・改定日, ISO形式）。
// 上げる基準: ユーザーの権利・取得データ・外部送信先に関わる実質変更のみ。
// 誤字修正・明確化では上げない（上げると全ユーザーに再同意モーダルが出る）。
export const PRIVACY_POLICY_VERSION = '2026-10-26';
export const LEGACY_POLICY_VERSION = '2026-10-26'; // 既存ユーザー補完用。変更しない。

export const DOCS_URLS = {
  README: 'https://hoyopass.pages.dev/',
  README_EN: 'https://hoyopass.pages.dev/index_en',
  PRIVACY_POLICY: 'https://hoyopass.pages.dev/privacy',
  PRIVACY_POLICY_EN: 'https://hoyopass.pages.dev/privacy_en'
};

export const UNINSTALL_URL = 'https://forms.gle/xWmVdhKJhpcuvmhP9';

export const REVIEW_PROMPT_CONFIG = {
  EXTENSION_ID: 'cjaoogecpnhdklnododipehcnipapccn',
  REVIEW_URL: 'https://chromewebstore.google.com/detail/cjaoogecpnhdklnododipehcnipapccn/reviews',
  THRESHOLD_SUCCESS_COUNT: 3,
  POSTPONE_DURATION_MS: 7 * 24 * 60 * 60 * 1000, // 7日間 (604,800,000 ms)
  MAX_POSTPONE_COUNT: 2 // 「あとで」の上限回数（2回目押下時は dismissed へ移行）
};


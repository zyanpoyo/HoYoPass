export const API_CONFIG = {
  CODE_API_TIMEOUT_MS: 10_000,
  HOYO_API_TIMEOUT_MS: 10_000,
  REDEEM_INTERVAL_MINUTES: 240, // 4時間周期
  INTER_REQUEST_DELAY_MS: 5_200, // 5.2秒ウェイト
  MAX_CODE_RETRIES: 3,
  BACKOFF_DURATION_MS: 30 * 60 * 1000, // 30分間バックオフ
  MAX_EXTERNAL_PAYLOAD_BYTES: 256 * 1024, // 256KB制限
  MAX_NEW_CODES_PER_FETCH: 50, // 1回あたりの最大取得コード数
  DAILY_NEW_CODE_LIMIT: 20, // 1日あたりの新規コード上限
  STORAGE_WARNING_THRESHOLD: 0.8, // 80%容量監視
  MAX_REDEEMED_HISTORY_LIMIT: 3000 // 古い確定記録整理の閾値
};

export const STATUS_MAP = {
  SUCCESS: 0,
  ALREADY_CLAIMED: 1,
  EXPIRED: 2,
  INVALID: 3,
  FAILED: 4,
  PENDING_RETRY: 5
};

export const GAMES = {
  GENSHIN: {
    name: '原神',
    shortName: '原',
    iconPath: '/assets/icons/genshin.png',
    gameBiz: 'hk4e_global',
    exchangeHost: 'https://sg-hk4e-api.hoyoverse.com',
    exchangePath: '/common/apicdkey/api/webExchangeCdkey',
    hoyoCodesParam: 'genshin',
    giftSiteUrl: 'https://genshin.hoyoverse.com/ja/gift'
  },
  STAR_RAIL: {
    name: '崩壊：スターレイル',
    shortName: '星',
    iconPath: '/assets/icons/starrail.png',
    gameBiz: 'hkrpg_global',
    exchangeHost: 'https://sg-hkrpg-api.hoyoverse.com',
    exchangePath: '/common/apicdkey/api/webExchangeCdkey',
    hoyoCodesParam: 'hkrpg',
    giftSiteUrl: 'https://hsr.hoyoverse.com/gift'
  },
  ZZZ: {
    name: 'ゼンレスゾーンゼロ',
    shortName: '絶',
    iconPath: '/assets/icons/zzz.png',
    gameBiz: 'nap_global',
    exchangeHost: 'https://public-operation-nap.hoyoverse.com',
    exchangePath: '/common/apicdkey/api/webExchangeCdkey',
    hoyoCodesParam: 'nap',
    giftSiteUrl: 'https://zenless.hoyoverse.com/redemption/gift'
  }
};

export const ALLOWED_REGIONS = [
  'os_usa', 'os_euro', 'os_asia', 'os_cht',
  'prod_official_usa', 'prod_official_eur', 'prod_official_asia', 'prod_official_cht', 'prod_official_jp',
  'prod_gf_us', 'prod_gf_eu', 'prod_gf_jp', 'prod_gf_sg'
];

export const DOCS_URLS = {
  README: 'https://github.com/zyanpoyo/HoYoPass#readme',
  PRIVACY_POLICY: 'https://github.com/zyanpoyo/HoYoPass/blob/master/docs/legal/privacy_policy.md'
};

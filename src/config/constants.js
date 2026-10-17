import { FLAVOR_CONFIG } from './env.js';

export const API_CONFIG = {
  CODE_API_TIMEOUT_MS: 10_000,
  HOYO_API_TIMEOUT_MS: 10_000,
  REDEEM_INTERVAL_MINUTES: FLAVOR_CONFIG?.config?.REDEEM_INTERVAL_MINUTES ?? 180,
  RETRY_INTERVAL_MINUTES: 2, // 2分後短期リトライ
  CATCH_UP_DELAY_MS: FLAVOR_CONFIG?.config?.CATCH_UP_DELAY_MS ?? 15_000,
  INTER_REQUEST_DELAY_MS: 5_200, // 5.2秒ウェイト
  MAX_CODE_RETRIES: 3,
  BACKOFF_DURATION_MS: 30 * 60 * 1000, // 30分間バックオフ
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
    signIntervalLabel: '自動受け取り (毎日 01:05)'
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

export const GAMES = {
  GENSHIN: {
    name: '原神',
    shortName: '原',
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

export const DOCS_URLS = {
  README: 'https://github.com/zyanpoyo/HoYoPass#readme',
  PRIVACY_POLICY: 'https://github.com/zyanpoyo/HoYoPass/blob/master/docs/legal/privacy_policy.md'
};

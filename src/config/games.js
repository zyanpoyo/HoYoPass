/**
 * 単一ゲームカタログ定義と派生参照ヘルパー。
 * @param {string} key
 * @param {object} spec
 */
function defineGame(key, spec) {
  const jaLocale = Object.freeze({
    ...spec.locales.ja,
    giftSiteUrl: spec.locales.ja.giftSiteUrl || spec.giftSiteUrl || ''
  });
  const enLocale = Object.freeze({
    ...spec.locales.en,
    giftSiteUrl: spec.locales.en.giftSiteUrl || spec.giftSiteUrl || jaLocale.giftSiteUrl
  });
  const locales = Object.freeze({
    ja: jaLocale,
    en: enLocale
  });

  return Object.freeze({
    ...spec,
    key,
    name: jaLocale.name,
    shortName: jaLocale.shortName,
    tabLabel: jaLocale.tabLabel,
    giftSiteUrl: jaLocale.giftSiteUrl,
    signHosts: Object.freeze([...spec.signHosts]),
    locales
  });
}

export const GAMES = Object.freeze({
  GENSHIN: defineGame('GENSHIN', {
    gaKey: 'genshin',
    iconPath: '/assets/icons/genshin.png',
    gameBiz: 'hk4e_global',
    exchangeHost: 'https://sg-hk4e-api.hoyoverse.com',
    exchangePath: '/common/apicdkey/api/webExchangeCdkey',
    hoyoCodesParam: 'genshin',
    actId: 'e202102251931481',
    signGameHeader: 'hk4e',
    signHosts: [
      'https://sg-hk4e-api.hoyolab.com',
      'https://sg-hk4e-api.hoyoverse.com'
    ],
    infoPath: '/event/sol/info',
    signPath: '/event/sol/sign',
    checkInSiteUrl: 'https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481',
    locales: {
      ja: {
        name: '原神',
        shortName: '原',
        tabLabel: '原神',
        giftSiteUrl: 'https://genshin.hoyoverse.com/ja/gift'
      },
      en: {
        name: 'Genshin Impact',
        shortName: 'GI',
        tabLabel: 'Genshin',
        giftSiteUrl: 'https://genshin.hoyoverse.com/en/gift'
      }
    }
  }),
  STAR_RAIL: defineGame('STAR_RAIL', {
    gaKey: 'hsr',
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
    checkInSiteUrl: 'https://act.hoyolab.com/bbs/event/signin/hkrpg/index.html?act_id=e202303301540311',
    locales: {
      ja: {
        name: '崩壊：スターレイル',
        shortName: '星',
        tabLabel: 'スタレ'
      },
      en: {
        name: 'Honkai: Star Rail',
        shortName: 'HSR',
        tabLabel: 'Star Rail'
      }
    }
  }),
  ZZZ: defineGame('ZZZ', {
    gaKey: 'zzz',
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
    checkInSiteUrl: 'https://act.hoyolab.com/bbs/event/signin/zzz/index.html?act_id=e202406031448091',
    locales: {
      ja: {
        name: 'ゼンレスゾーンゼロ',
        shortName: '絶',
        tabLabel: 'ZZZ'
      },
      en: {
        name: 'Zenless Zone Zero',
        shortName: 'ZZZ',
        tabLabel: 'ZZZ'
      }
    }
  })
});

export const DEFAULT_ENABLED_GAMES = Object.freeze(Object.keys(GAMES));
export const DEFAULT_GAME_KEY = DEFAULT_ENABLED_GAMES[0];

/**
 * 言語設定に応じたゲーム基本情報（多言語名称、URL等）を取得する
 * @param {string} gameKey
 * @param {'ja'|'en'} [lang]
 */
export function getLocalizedGame(gameKey, lang = 'ja') {
  const base = GAMES[gameKey];
  if (!base) {
    return {
      name: gameKey,
      shortName: gameKey,
      tabLabel: gameKey,
      giftSiteUrl: ''
    };
  }
  const locale = base.locales[lang] || base.locales.ja;
  return {
    ...base,
    ...locale
  };
}

/**
 * 指定ゲームの全登録言語における表示名リスト（重複排除）を返す
 * @param {string} gameKey
 * @returns {string[]}
 */
export function getGameAllLocalizedNames(gameKey) {
  const base = GAMES[gameKey];
  if (!base?.locales) return [];
  const names = [];
  for (const loc of Object.values(base.locales)) {
    if (loc?.name && !names.includes(loc.name)) {
      names.push(loc.name);
    }
  }
  return names;
}

/**
 * GA4 イベントパラメータ用のゲーム識別キーを取得する
 * @param {string} gameKey
 * @returns {string}
 */
export function getGameGaKey(gameKey) {
  return GAMES[gameKey]?.gaKey || 'none';
}

/**
 * onboarding_complete イベント用のゲーム有効フラグ名を取得する
 * @param {string} gameKey
 * @returns {string | null}
 */
export function getOnboardingEnabledParamKey(gameKey) {
  const gaKey = GAMES[gameKey]?.gaKey;
  return gaKey ? `${gaKey}_enabled` : null;
}

/**
 * onboarding_complete イベントで許可されるゲーム有効フラグ名一覧を返す
 * @returns {string[]}
 */
export function getOnboardingEnabledParamKeys() {
  return DEFAULT_ENABLED_GAMES
    .map(gameKey => getOnboardingEnabledParamKey(gameKey))
    .filter(Boolean);
}

/**
 * 選択済みゲーム配列から onboarding_complete のゲーム有効フラグ群を構築する
 * @param {string[]} [selectedGames]
 * @returns {Record<string, boolean>}
 */
export function buildOnboardingEnabledParams(selectedGames = []) {
  const selectedSet = new Set(Array.isArray(selectedGames) ? selectedGames : []);
  const params = {};
  for (const gameKey of DEFAULT_ENABLED_GAMES) {
    const paramKey = getOnboardingEnabledParamKey(gameKey);
    if (paramKey) {
      params[paramKey] = selectedSet.has(gameKey);
    }
  }
  return params;
}

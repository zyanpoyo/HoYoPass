export const FLAVORS = {
  dev: {
    flavor: 'dev',
    manifest: {
      nameSuffix: ' [DEV]',
      shortNameSuffix: '-Dev',
      versionNameSuffix: '-dev'
    },
    config: {
      REDEEM_INTERVAL_MINUTES: 3,
      CATCH_UP_DELAY_MS: 15_000,
      IS_DEV: true
    },
    ui: {
      badgeText: 'DEV',
      intervalLabel: '定期自動引き換え (開発版: 3分毎)',
      signIntervalLabel: '自動受け取り (毎日 01:05)'
    }
  },
  prod: {
    flavor: 'prod',
    manifest: {
      nameSuffix: '',
      shortNameSuffix: '',
      versionNameSuffix: ''
    },
    config: {
      REDEEM_INTERVAL_MINUTES: 180,
      CATCH_UP_DELAY_MS: 15_000,
      IS_DEV: false
    },
    ui: {
      badgeText: '',
      intervalLabel: '定期自動引き換え (3時間毎)',
      signIntervalLabel: '自動受け取り (毎日 01:05)'
    }
  }
};

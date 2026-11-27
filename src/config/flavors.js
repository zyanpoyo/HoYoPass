export const FLAVORS = {
  dev: {
    flavor: 'dev',
    manifest: {
      nameSuffix: ' [DEV]',
      shortNameSuffix: '-Dev',
      versionNameSuffix: '-dev'
    },
    config: {
      REDEEM_INTERVAL_MINUTES: 180,
      CATCH_UP_DELAY_MS: 15_000,
      IS_DEV: true
    },
    ui: {
      badgeText: 'DEV'
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
      badgeText: ''
    }
  }
};

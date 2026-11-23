# HoYoPass システムアーキテクチャ & 技術仕様書

本書は、Chrome拡張機能「HoYoPass - ログボ＆交換コード自動受取ツール」の内部設計、システム構成、セキュリティモデル、およびアルゴリズム仕様をまとめた技術仕様書です。

---

## 1. システム概要 & 全体構成図

HoYoPassは、Google Chromeの拡張機能仕様（Manifest V3）に準拠したクライアント完結型の拡張機能です。専用のバックエンドサーバーを持たず、ブラウザのバックグラウンドService Workerと公式API（HoYoLAB / HoYoverse）、およびオープンソースの交換コードAPIのみと直接通信します。

```mermaid
flowchart TD
    subgraph Browser["Google Chrome (Client)"]
        SW["Background Service Worker<br>(ログボ日次アラーム 01:05〜01:35 JST分散 / コード3時間周期アラーム)"]
        Popup["Popup UI<br>(統合2カード構成: ログボ受取・交換コード引き換え)"]
        Storage["chrome.storage.local<br>(設定・ログボ受取記録・引き換え済コード・実行ログ)"]
        CookieJar["Browser Cookie Jar<br>(.hoyolab.com / .hoyoverse.com 公式セッションCookie)"]
    end

    subgraph ExternalServices["外部サービス"]
        SignAPI["HoYoLAB / HoYoverse Daily Check-In API<br>(info / sign エンドポイント + x-rpc-signgame)"]
        TakumiAPI["HoYoverse Takumi API<br>(ロール情報照会・UID取得)"]
        RedeemAPI["各ゲーム公式交換API<br>(原神 / スタレ / ZZZ)"]
        HoyoCodesAPI["hoyo-codes API<br>(公開交換コード一覧取得)"]
        GA4API["Google Analytics 4<br>(Measurement Protocol 匿名メトリクス収集)"]
    end

    SW -->|日次アラーム / 3時間アラーム / キャッチアップ起動| Storage
    Popup -->|手動受取 / 手動引き換え / 個別トグル設定変更| SW
    Popup -->|設定・受取状態・ログ読み出し| Storage

    SW -->|コード一覧取得| HoyoCodesAPI
    SW -->|Cookie透過通信 credentials: include| SignAPI
    SW -->|Cookie透過通信 credentials: include| TakumiAPI
    SW -->|Cookie透過通信 credentials: include| RedeemAPI
    SW -->|匿名利用統計 POST（オプトアウト可）| GA4API
    Popup -->|UI操作イベント POST（オプトアウト可）| GA4API
    CookieJar -.->|ブラウザ自動付与| SignAPI
    CookieJar -.->|ブラウザ自動付与| TakumiAPI
    CookieJar -.->|ブラウザ自動付与| RedeemAPI
```

---

## 2. ゼロトラスト認証 & セキュリティモデル

本拡張機能の最大の設計指針は、**「ユーザーの認証情報を拡張機能自身が触らない・保持しない」** ゼロトラストセキュリティです。

### 2.1 Cookieの非保持とブラウザ委任 (`credentials: 'include'`)
- 通常のスクレイピングや非公式ボットでは、ユーザーにログインCookieの手動貼り付けや入力を求めるケースが多く存在します。これにはCookieの流出や不正利用のリスクが伴います。
- HoYoPassでは、`fetch()` リクエスト時に `credentials: 'include'` を指定することで、ブラウザがすでに保持している公式Cookieをリクエストヘッダーへ自動付加させます。
- 拡張機能のJavaScriptコード内にはCookie情報（`account_mid_v2` や `ltuid_v2`、`ltoken_v2` 等）を一切読み込まず、メモリやストレージにも一切保存しません。

### 2.2 デュアルドメインCookieモデル（`.hoyolab.com` & `.hoyoverse.com`）
- HoYoLABの公式ログインボーナスページ（`act.hoyolab.com`）は `.hoyolab.com` ドメインにセッションCookieを保存し、各ゲームの公式ギフト交換ページ（`*.hoyoverse.com`）は `.hoyoverse.com` ドメインにセッションCookieを保存します。
- HoYoPassは、ログインボーナスAPIおよびTakumiロール照会APIの呼び出しにおいて、`*.hoyolab.com` をプライマリ、`*.hoyoverse.com` をセカンダリ（未ログインエラー `-100` / `-1071` 発生時の自動フォールバック）として順次試行するデュアルホスト設計を採用しています。

### 2.3 最小権限原則（`cookies` 権限の完全排除）
- `manifest.json` において、`cookies` API 権限を明示的に要求していません。
- これにより、悪意あるコードインジェクションや拡張機能の改ざんが発生した場合でも、ユーザーのCookieを盗み出す権限自体が存在しません。

### 2.4 ホスト権限（`host_permissions`）の厳格限定
通信可能なオリジンを以下の公式ドメインおよび検証済みコード配布APIのみに制限しています：
- `https://api-os-takumi.hoyoverse.com/*` / `https://api-os-takumi.hoyolab.com/*`（公式ユーザーロール照会API）
- `https://sg-hk4e-api.hoyolab.com/*` / `https://sg-hk4e-api.hoyoverse.com/*`（原神 ログボ受取・交換コード引き換えAPI）
- `https://sg-public-api.hoyolab.com/*` / `https://sg-public-api.hoyoverse.com/*`（崩壊：スターレイル ログボ受取API）
- `https://sg-hkrpg-api.hoyoverse.com/*`（崩壊：スターレイル 交換コード引き換えAPI）
- `https://sg-act-nap-api.hoyolab.com/*` / `https://sg-act-nap-api.hoyoverse.com/*` / `https://public-operation-nap.hoyoverse.com/*`（ゼンレスゾーンゼロ ログボ受取・交換コード引き換えAPI）
- `https://hoyo-codes.seria.moe/*`（検証済み公開交換コード取得API: [seriaati/hoyo-codes](https://github.com/seriaati/hoyo-codes)）

### 2.5 Content Security Policy (CSP)
Manifest V3の厳格なCSPを採用し、インラインスクリプトや外部スクリプトのロード（`eval` や外部CDN経由のJSなど）を全面的に遮断しています。

---

## 3. 外部API仕様 & 連携先GitHubリポジトリ

HoYoPassが利用・通信する外部APIの詳細および仕様・ソースコードのリファレンスとなるGitHubリポジトリは以下の通りです。

### 3.1 HoYoLAB / HoYoverse デイリーログインボーナスAPI（Daily Check-In API）
HoYoLABの公式デイリーチェックインページ（`act.hoyolab.com`）が内部通信で使用している公式REST APIです。

- **各タイトルのエンドポイント & 設定値**:
  | ゲーム | `act_id` | `x-rpc-signgame` ヘッダ | `info` パス | `sign` パス | 対応ホスト（Primary / Secondary） |
  | :--- | :--- | :--- | :--- | :--- | :--- |
  | **原神** | `e202102251931481` | `hk4e` | `/event/sol/info` | `/event/sol/sign` | `sg-hk4e-api.hoyolab.com` / `sg-hk4e-api.hoyoverse.com` |
  | **崩壊：スターレイル** | `e202303301540311` | `hkrpg` | `/event/luna/hkrpg/os/info` | `/event/luna/hkrpg/os/sign` | `sg-public-api.hoyolab.com` / `sg-public-api.hoyoverse.com` |
  | **ゼンレスゾーンゼロ** | `e202406031448091` | `zzz` | `/event/luna/zzz/os/info` | `/event/luna/zzz/os/sign` | `sg-act-nap-api.hoyolab.com` / `sg-act-nap-api.hoyoverse.com` |
- **必須カスタムヘッダー**:
  - `x-rpc-signgame`: 特にゼンレスゾーンゼロ（`/event/luna/zzz/os/sign`）では、`x-rpc-signgame: zzz` ヘッダーがない場合、未ログイン時であっても `{"retcode":-100,"message":"请从游戏内打开参与活动"}` で拒否されるため、全タイトルで必須ヘッダーとして付与しています。
- **CAPTCHA（リスク検証）検知**:
  - `sign` エンドポイントは HTTP 200 かつ `retcode: 0` であっても、`data.is_risk === true` または `data.gt_result?.is_risk === true`（あるいは `retcode === 1034`）としてGeetest CAPTCHA検証を要求する場合があります。
  - `isCaptchaRisk()` によりこれを検知した際は「受取済」として誤記録せず、ユーザーへ公式チェックインページでの手動認証を促す通知を発行します。
- **実装箇所**: [`src/services/hoyo-api.js`](../../src/services/hoyo-api.js) (`getDailySignInfo`, `claimDailyBonus`, `isCaptchaRisk`)

### 3.2 hoyo-codes API（公開交換コード一覧取得）
- **GitHubリポジトリ**: [seriaati/hoyo-codes (GitHub)](https://github.com/seriaati/hoyo-codes)（ライセンス: GPL-3.0）
- **Web API ホスト**: `https://hoyo-codes.seria.moe`
- **利用エンドポイント**: `GET https://hoyo-codes.seria.moe/codes?game={genshin|hkrpg|nap}`
- **概要**: 原神（`genshin`）、崩壊：スターレイル（`hkrpg`）、ゼンレスゾーンゼロ（`nap`）のアクティブなギフト交換コードを自動収集・検証してJSON形式で配信しているオープンソースREST APIです。
- **実装箇所**: [`src/services/code-fetcher.js`](../../src/services/code-fetcher.js)
- **ライセンス適合性**: 独立したREST APIの呼び出し（HTTP GET）のみであり、GPL-3.0のコピーレフトはクライアント側に伝播しません。詳細な法的分析は [ライセンス適合性調査レポート (docs/legal/license_compliance_report.md)](../legal/license_compliance_report.md) を参照してください。
- **セキュリティ & 防御機構**: `publicFetch`（Cookie送信完全遮断、`no-referrer`）経由で通信を行い、受信ペイロードサイズ上限（256KB）および新規コード取得件数上限（50件）のバリデーションを実施しています。

### 3.3 HoYoverse 内部Web API（ロール照会 & コード引き換え）
- **ロール照会API（Takumi API）**:
  - エンドポイント: `GET https://api-os-takumi.hoyoverse.com/binding/api/getUserGameRolesByCookie?game_biz={gameBiz}`（フォールバック: `https://api-os-takumi.hoyolab.com/binding/api/getUserGameRolesByCookie`）
  - 概要: ログイン中セッションCookieに紐づくゲーム内キャラクター一覧（UID、サーバー、ニックネーム）を取得。
  - 実装箇所: [`src/services/hoyo-api.js`](../../src/services/hoyo-api.js) (`getUserGameRoles`)
- **コード引き換えAPI（WebExchangeCdkey API）**:
  - 原神: `GET https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey`
  - 崩壊：スターレイル: `GET https://sg-hkrpg-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey`
  - ゼンレスゾーンゼロ: `GET https://public-operation-nap.hoyoverse.com/common/apicdkey/api/webExchangeCdkey` / `https://sg-act-nap-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey`
  - 概要: 指定したUID・リージョン・交換コードでアイテム交換を実行。
  - 実装箇所: [`src/services/hoyo-api.js`](../../src/services/hoyo-api.js) (`redeemCode`)
- **関連オープンソース・コミュニティGitHubリポジトリ（仕様リファレンス）**:
  - [torikushiii/hoyoverse-api (GitHub)](https://github.com/torikushiii/hoyoverse-api) - HoYoverse各タイトルのAPI・コード情報をまとめたオープンソースプロジェクト
  - [thesadru/genshin.py (GitHub)](https://github.com/thesadru/genshin.py) - HoYoverse Web API（Takumi API / ログボAPI / 交換API等）の包括的なオープンソースAPIラッパー

---

## 4. 主要コンポーネント構成

```
src/
├── background/
│   ├── flow-runner.js          # アラーム制御、通知ルーティング、共通マルチゲーム巡回パイプライン
│   └── service-worker.js       # 2系統アラーム発火・キャッチアップ起動、コード引換/ログボ個別処理、メッセージハンドラ
├── config/
│   ├── constants.js            # API定数、ゲーム固有エンドポイント設定（ログボ・コード）、URL定義
│   ├── env.js                  # ビルド時自動生成されるフレーバー・GA4環境変数定義
│   └── flavors.js              # dev / prod ビルドフレーバー別のアラーム周期・ラベル設定
├── popup/
│   ├── popup.html              # 統合2カード型ポップアップUIマークアップ
│   ├── popup.css               # スタイリング（ダークモード基調、2カード構成、モーダル・バナー）
│   ├── popup.js                # ポップアップ状態管理、タブ描画、イベントバインディングのエントリポイント
│   ├── modals.js               # 初回同意・統計同意・ポリシー改定・設定・アラートモーダルおよびレビュー促進バナー制御
│   ├── status-view.js          # DOM多言語反映、ゲームロール表示、ログボ・交換コード実績カードの描画更新
│   └── log-view.js             # ゲーム別実行ログのフィルタリング・プレフィックス整形・リスト描画
├── services/
│   ├── analytics-service.js    # GA4 Measurement Protocolによる匿名イベント送信・サニタイズ・セッション管理
│   ├── code-fetcher.js         # hoyo-codes APIからのコード一覧取得・ペイロード検証
│   ├── hoyo-api.js             # デュアルホスト対応ロール取得、ログボAPI（info/sign）、公式交換API呼び出し
│   ├── http-client.js          # ホワイトリスト検証・429/5xx検知付きセキュアHTTPクライアント（hoyoFetch / publicFetch）
│   ├── rate-limit-service.js   # ジッター、指数バックオフ、短期リトライ上限、自動/手動クールダウン状態管理
│   ├── review-prompt-service.js# ストアレビュー促進バナーの状態管理・実績マイグレーション・表示判定
│   ├── security.js             # UID・リージョン・交換コード形式の入力バリデーション
│   └── storage-service.js      # chrome.storageのCRUD操作、UTC+8日付管理、排他ロック（Mutex）管理
└── utils/
    ├── i18n.js                 # 日英多言語辞書（MESSAGES）、言語解決、URL・時刻ローカライズヘルパー
    └── message-formatter.js    # ログボおよび交換コード実行結果のユーザー向けダイアログ文言フォーマッタ
```

---

## 5. 独立2系統アラーム & 高信頼実行アーキテクチャ

「デイリーログインボーナス自動受取」と「交換コード自動引き換え」は、更新サイクルが異なるため独立した2系統のイベント軸で制御されています。

### 5.1 ログインボーナス自動受取（日次リセット基準軸）
- **UTC+8 日付境界の厳密判定**: HoYoLABのデイリーログインボーナスは毎日 `00:00 (UTC+8)` ＝ **日本時間 `01:00 (JST)`** に日付が切り替わります。`getHoyoTodayDateString()` により UTC+8 基準の `YYYY-MM-DD` 文字列を算出し、当日分の受取有無を管理します。
- **日次定時アラームとジッター分散 (`hoyo_daily_sign_alarm`)**: 一斉スパイクを回避するため、初回（および既存ユーザー更新初回）に `0〜30分` のユーザー固定ランダムオフセット（`daily_sign_jitter_minutes`）を決定して永続化し、毎日 `01:05〜01:35 JST`（`00:05〜00:35 UTC+8`）のいずれかに1440分（24時間）周期で発火します。また、ゲーム間の巡回待機にも `1.5〜2.5秒` の揺らぎを入れます。
- **事前 `info` チェックによる冪等性とCAPTCHA当日抑止**: `sign` を叩く前にまず `getDailySignInfo` で `is_sign` を確認し、すでに受取済みの場合はPOST通信を行わずにローカル記録を同期します。`claimDailyBonus` でCAPTCHA（`isRisk`）が要求された場合は `captchaBlocked: true` を保存し、当日（UTC+8）中の自動再実行・通知連発をスキップします（ユーザーによる手動実行は許可）。

### 5.2 交換コード自動引き換え（3時間インターバル軸）
- **定期アラーム (`hoyo_auto_redeem_alarm`)**: 3時間（180分）周期で全3タイトルを順次巡回し、最新コードを一括自動引き換えします。
- **ジッター付き順次リクエスト遅延**: 1つのコードを引き換えるごと、およびゲーム切替ごとに **5.2〜6.7秒** のランダム揺らぎ付きスリープを挿入し、固定周期の機械的アクセスやレートリミットを回避します。
- **HTTP 429 / 5xx・`-2016` による指数バックオフ**: HoYo API から HTTP `429`・`5xx` または `retcode: -2016` を検知した際は、予備ホストへのフォールバックも行わず即座に処理を中断し、連続発生に応じて **30分 → 60分 → 上限120分** へ段階延長する指数バックオフ（`Retry-After` ヘッダがある場合は上限120分の範囲で尊重）に遷移します。未ログイン（`-100`/`-1071`）・`429`・`5xx`・`-2016` 受信時は対象コードの失敗回数（上限3回）を消費しません。
- **公式APIの二段階判定と重複メール仕様**: HoYoverseの交換コードAPIは、Web APIでの受付判定とゲームサーバーでのメール配送判定の二段階で動作します。事前照会APIが存在しないため、過去にゲーム内等で手動交換済みのコードに対して初回実行時に「交換済み重複メール」がゲーム内に届く場合がありますが、これはAPI仕様上の制約であり、一度処理されたコードはローカルに保存されて再送が防止されます。

### 5.3 ブラウザ起動時・スリープ復帰時の直列キャッチアップ・リトライ・手動クールダウン
- **ジッター付き待機と直列キャッチアップ (`maybeRunAllCatchUp`)**: Chrome起動時 (`chrome.runtime.onStartup`) やスリープ復帰時 (`chrome.idle.onStateChanged` -> `active`) には、**15〜45秒** のランダムな回線安定待機の後に `maybeRunAllCatchUp()` を実行し、**① ログインボーナス当日未実行チェック → ② 交換コード3時間経過チェック** の順で `await` により直列実行します（待機時間が20秒を超える場合は、MV3 Service Worker の30秒無活動停止を防ぐため20秒単位で分割待機し、`chrome.storage.session` への軽量読み出しでアイドルタイマーをリセットします）。
- 共通の排他ロック（Mutex）競合を防ぐため、**① ログインボーナス当日未実行チェック → ② 交換コード3時間経過チェック** の順で `await` により直列実行します。
- **自動試行3時間クールダウン**: 未ログイン（`-100` / `-1071`）や外部コード一覧APIエラー等で失敗した場合でも、起動やアイドル復帰のたびに再実行されないよう自動キャッチアップに **3時間クールダウン** を設けています（ログボ側は HoYo 日付跨ぎで即解除、ユーザーによる手動実行は随時許可）。
- **短期リトライ上限（最大3回・段階的延長）**: ネットワーク未確立による `Failed to fetch` 等やオフライン検知時は、それぞれ独立した短期リトライアラーム（`hoyo_sign_retry_alarm` / `hoyo_retry_alarm`）で **2分 → 10分 → 30分**（各 `0〜30秒` 揺らぎ付き）の最大3回まで段階的に自動再試行し、上限到達後は次の通常定期実行または手動実行まで停止します。
- **手動実行クールダウン**: ポップアップからの手動実行ボタンは、`chrome.storage.session` により **ゲーム × 操作種別（ログボ／コード交換）単位で60秒** のクールダウンを適用し、短時間の連打を防止します。

---

## 6. ストレージ設計と容量ローテーションポリシー

ブラウザの `chrome.storage.local`（最大10MB）を使用します。

### 6.1 キー構造
| ストレージ領域 | キー | 型 | 用途 |
| :--- | :--- | :--- | :--- |
| `local` | `app_settings` | Object | ユーザー設定（`optInAccepted`, `autoSignEnabled`, `autoRedeemEnabled`, `activeGameKey`, `enabledGames`, `language`, `analyticsConsentReviewed`, `analyticsEnabled`, `agreedPolicyVersion`） |
| `local` | `daily_sign_${gameBiz}` | Object | ゲーム別のログボ受取記録（`date`: `YYYY-MM-DD` (UTC+8), `isSigned`, `totalSignDay`, `skippedNoChar`, `captchaBlocked`, `updatedAt`） |
| `local` | `daily_sign_jitter_minutes` | Number | ユーザー固定のログボ実行オフセット分（`0〜30`） |
| `local` | `redeemed_${gameBiz}` | Object | ゲーム別引き換え済みコード履歴（重複引き換えの防止・月間/通算集計） |
| `local` | `active_codes_${gameBiz}` | Array | 直近に取得した有効交換コード一覧（消化率表示用キャッシュ） |
| `local` | `daily_counts_${gameBiz}` | Object | 1日あたりの新規コード引き換え試行カウント（上限20件の保護用） |
| `local` | `exec_logs` | Array | 画面表示用の直近実行ログ（`timestamp`, `type`, `category` (`SIGN`/`CODE`), `gameKey`, `message`） |
| `local` | `last_successful_run` | Number | コード自動引き換え巡回全体が正常完了した最終エポックミリ秒 |
| `local` | `last_redeem_attempt` / `last_sign_attempt` | Number | 自動キャッチアップクールダウン判定用の最終全体試行エポックミリ秒 |
| `local` | `retry_state_redeem` / `retry_state_sign` | Object | 短期リトライ制御状態（`count`, `updatedAt`, `exhaustedLogged`） |
| `local` | `backoff_until` / `backoff_level` | Number | 指数バックオフ解除時刻（ms）と連続バックオフ段階（`0〜3`） |
| `local` | `ga_client_id` | String | GA4 用の匿名クライアント識別子（UUIDv4） |
| `local` | `reviewPrompt` | Object | ストアレビュー促進機能の処理ステータス、成功回数（実行セッション単位）、延期回数、次回再表示可能時刻、初回インストール日時 |
| `session` | `lock_state` | Object | 排他ロック用ステータス（`running`, `startedAt`, `trigger`） |
| `session` | `manual_cooldowns` | Object | 手動実行ボタンのゲーム×種別ごとの最終実行タイムスタンプマップ（60秒制限） |
| `session` | `ga_session_id` / `ga_last_active` | String / Number | GA4 の30分セッション管理用タイムスタンプ |

### 6.2 履歴の整理（ローテーション）
- `redeemed_codes` に蓄積された記録が 3,000 件を超えた場合、古い確定記録から自動的に整理されます。
- `exec_logs` は最新の 50 件のみを保持し、古いログは順次自動破棄されます。

---

## 7. テスト・検証環境

プロジェクトはNode.js組み込みのテストランナー（`node:test` / `node:assert/strict`）を採用しており、外部の重量級フレームワークに依存せず高速にテストを実行可能です。CI/CDおよびライブラリ脆弱性の検知・自動更新パイプライン仕様については、[CI/CD & 脆弱性管理システム設計書](./ci_cd_security_architecture.md) を参照してください。

```bash
# 全単体テストの実行
npm test

# 機密情報（シークレット、秘密鍵）混入スキャン
npm run check-secrets
```

---

## 8. 免責事項 & 権利帰属
本ツールは非公式のオープンソースプロジェクトであり、miHoYo / COGNOSPHEREとは一切提携・承認関係にありません。詳細な著作権、ライセンス情報、および法的適合性検証結果は [NOTICE](../../NOTICE)、[LICENSE](../../LICENSE)、および [ライセンス適合性調査レポート](../legal/license_compliance_report.md) を参照してください。

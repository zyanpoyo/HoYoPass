# GA4 利用統計計測仕様書 (Google Analytics 4 Measurement Spec)

本ドキュメントは、Chrome拡張機能「HoYoPass」に導入された Google Analytics 4 (GA4) Measurement Protocol による利用統計計測の技術仕様、収集イベント、カスタムディメンション定義、およびセキュリティ・プライバシー保護設計をまとめたものです。

---

## 1. 概要とアーキテクチャ

HoYoPass では、機能改善、交換コード引き換え成功率の把握、およびAPI仕様変更や障害の早期検知を目的として、Google LLC が提供する **GA4 Measurement Protocol** による匿名の利用統計収集を行っています。

```
[Service Worker / Background] ──────────┐
   │ (code_redeem, daily_checkin, etc.) │
   ▼                                    ▼
[analytics-service.js] ──────► [POST https://www.google-analytics.com/mp/collect]
   ▲
   │ (ui_action, onboarding)
[Popup UI (popup.js)]
```

### 主な設計方針
1. **ゼロPII（個人情報・機密情報の完全遮断）**:
   - ゲームアカウントのUID、ゲーム内プレイヤー名、パスワード、認証トークン、Cookieデータは一切収集・送信しません。
   - イベントパラメータは事前定義された厳格なホワイトリスト（`ALLOWED_EVENT_PARAMS`）によってサニタイズされ、未知のパラメータや不正なキーは送信前に自動削除されます。
2. **クライアント識別子（Client ID）**:
   - 拡張機能インストール時やアップデート・起動時にブラウザのローカル環境で生成されるランダムなUUID（`crypto.randomUUID()` または暗号論的疑似乱数フォールバック）を `chrome.storage.local` に保存して利用します（既存ユーザーに対しても自動的に生成・永続化され、同一IDが継続して付与されます）。
   - リクエストのルートペイロードおよび各イベントの共通パラメータ（`client_id`）として送信され、GA4探索レポート等でのユーザー単位のイベント集計に利用されます。
   - ブラウザや個人の識別情報とは完全に切り離されています。
3. **セッション管理（Session ID）**:
   - 最後のイベント送信から30分以上経過した場合に新しいタイムスタンプ（ミリ秒）を発行し、セッションを区切ります。
4. **CORSプリフライトの抑止**:
   - Service Worker からの送信時、無駄な `OPTIONS` プリフライトリクエストを回避するため、`Content-Type: application/json` ヘッダーを意図的に省略し、Simple Request として `JSON.stringify(payload)` を送信します。
5. **非ブロッキング＆エラー抑制**:
   - GA4 への送信成否が拡張機能の本来の動作（ログインボーナス受取やコード引き換え）に一切影響を与えないよう、タイムアウト（5秒）およびエラーのスワロー（例外非伝播）を徹底しています。

---

## 2. 認証情報とシークレット管理

GA4 の Measurement Protocol では以下の2つの認証情報を使用します：
- **Measurement ID (測定ID)**: `G-XXXXXXXXXX` 形式
- **API Secret (APIシークレットキー)**: Measurement Protocol 専用のシークレット文字列

### 秘匿化とビルドインジェクション方針
- **Git追跡の完全排除**:
  - 測定IDおよびシークレットキーは、Git管理外のローカル `.env` にのみ記述します。
  - Gitリポジトリ内のソースコード（`src/config/env.js`）には空文字列（`''`）のプレースホルダーのみをコミットします。
- **ビルド時注入 (`scripts/build.js`)**:
  - `npm run build` 実行時に `.env` をパースし、ビルド成果物（`dist/dev/src/config/env.js`, `dist/prod/src/config/env.js`）にのみ実際の値を注入します。
- **コミット前自動検査 (`scripts/check-secrets.js`)**:
  - `npm test` 実行時に `check-secrets.js` が作動し、Git追跡対象の全ファイルに `.env` 内の機密値が含まれていないかを動的正規表現で検証します。
- **開発フレーバー（dev）での送信抑制**:
  - 開発ビルド（`IS_DEV: true`）では外部ネットワークへの HTTP POST は行われず、`console.debug` へのローカル出力にとどまります。

---

## 3. GA4 カスタムディメンション定義

### 3.1 管理画面への登録が必要なカスタムディメンション（全13項目）

GA4 管理画面（**「管理」＞「データの表示」＞「カスタム定義」＞「カスタムディメンションを作成」**）に登録するパラメータの一覧です（すべてスコープは **「イベント」**）。

| パラメータ名 | ディメンション表示名 (日本語) | スコープ | 説明 | 想定される値の例 |
| :--- | :--- | :--- | :--- | :--- |
| `game` | **対象ゲーム** | イベント | イベント対象のゲームタイトル | `genshin`, `hsr`, `zzz`, `none` |
| `status` | **結果ステータス** | イベント | 処理の成否結果 | `success`, `already_claimed`, `expired`, `cooldown`, `failed`, `already_signed` |
| `error_reason` | **エラー要因** | イベント | 失敗時の詳細エラー分類 | `not_logged_in`, `cooldown`, `captcha_required`, `api_error`, `unknown`, `none` |
| `trigger` | **実行契機** | イベント | 自動アラーム、手動実行、初回起動時 | `auto`, `manual`, `initial` |
| `action_type` | **UI操作種別** | イベント | ユーザーが実行したUIアクション | `uid_copy`, `open_log`, `change_settings`, `open_official_site`, `notification_click`, `review_prompt_write`, `review_prompt_later`, `review_prompt_dismiss` |
| `http_status` | **HTTPステータス** | イベント | コード一覧取得失敗時のHTTPステータスコード | `503`, `404`, `0` |
| `error_type` | **通信エラー種別** | イベント | コード一覧取得失敗時のエラー分類 | `timeout`, `http_error`, `parse_error`, `network_error` |
| `genshin_enabled` | **原神有効フラグ** | イベント | 初回オンボーディング時の原神選択有無 | `true`, `false` |
| `hsr_enabled` | **スタレ有効フラグ** | イベント | 初回オンボーディング時のスタレ選択有無 | `true`, `false` |
| `zzz_enabled` | **ZZZ有効フラグ** | イベント | 初回オンボーディング時のZZZ選択有無 | `true`, `false` |
| `app_version` | **拡張機能バージョン** | イベント | 実行中のHoYoPassのバージョン | `1.3.1` |
| `lang` | **UI言語** | イベント | ユーザーの表示言語設定 | `ja`, `en` |
| `custom_client_id` | **カスタムクライアントID** | イベント | `client_id` と同一の匿名クライアント識別子（GA4予約語回避・探索レポート集計用） | `3fa85f64-5717-4562-b3fc-2c963f66afa6` |

### 3.2 カスタムディメンション登録が不要な標準・予約パラメータ（3項目）

以下のパラメータは全イベントに共通付与されますが、GA4 の標準仕様・予約語として自動処理されるため、**カスタムディメンションへの手動登録は不要（または登録不可）**です。

| パラメータ名 | 扱い | 説明 | 想定される値の例 |
| :--- | :--- | :--- | :--- |
| `client_id` | GA4予約語（登録不可） | ローカル生成される匿名のクライアント識別子（UUIDv4）。カスタムディメンション集計には上記の `custom_client_id` を使用 | `3fa85f64-5717-4562-b3fc-2c963f66afa6` |
| `session_id` | GA4標準パラメータ（登録不要） | 30分タイムアウトで発行されるセッション識別子 | `1793023326903` |
| `engagement_time_msec` | GA4標準パラメータ（登録不要） | アクティブユーザー集計用のエンゲージメント時間（常時 `100`） | `100` |

---

## 4. 収集イベント一覧

### 4.1. `code_redeem_result`（コード引き換え結果）
- **契機**: 自動巡回または手動実行で交換コードの引き換えAPIを呼び出した際、および未ログイン等の理由でコード引き換え処理自体がスキップ・失敗した際。
- **パラメータ**:
  - `game`: 対象ゲーム（`genshin` / `hsr` / `zzz`）
  - `status`: 成否（`success` / `already_claimed` / `expired` / `cooldown` / `failed`）
  - `error_reason`: エラー要因（`not_logged_in` / `cooldown` / `unknown` / `none`）
  - `trigger`: 実行契機（`auto` / `manual` / `initial` ※初回起動巡回時）
  - `app_version`, `lang`, `client_id`, `custom_client_id`, `session_id`, `engagement_time_msec`

### 4.2. `daily_checkin_result`（デイリーログインボーナス結果）
- **契機**: 自動アラームまたは手動実行でデイリーログインボーナスの受取APIを実行した際。
- **パラメータ**:
  - `game`: 対象ゲーム（`genshin` / `hsr` / `zzz`）
  - `status`: 成否（`success` / `already_signed` / `failed`）
  - `error_reason`: エラー要因（`not_logged_in` / `captcha_required` / `api_error` / `none`）
  - `trigger`: 実行契機（`auto` / `manual`）
  - `app_version`, `lang`, `client_id`, `custom_client_id`, `session_id`, `engagement_time_msec`

### 4.3. `onboarding_complete`（初回利用開始・オンボーディング完了）
- **契機**: 新規ユーザーが初回オプトインモーダルの「同意して利用を開始する」ボタンを押下した際。
- **パラメータ**:
  - `genshin_enabled`: 原神の有効状態（`'true'` / `'false'`）
  - `hsr_enabled`: 崩壊：スターレイルの有効状態（`'true'` / `'false'`）
  - `zzz_enabled`: ゼンレスゾーンゼロの有効状態（`'true'` / `'false'`）
  - `app_version`, `lang`, `client_id`, `custom_client_id`, `session_id`, `engagement_time_msec`

### 4.4. `ui_action`（UI操作・機能利用）
- **契機**: ユーザーがポップアップUIまたは通知で特定のアクションを行った際。
- **パラメータ**:
  - `action_type`:
    - `uid_copy`: UIDチップを押下してクリップボードにコピーした
    - `open_log`: ログアコーディオンを展開した
    - `change_settings`: 設定モーダルで設定を保存した
    - `open_official_site`: 公式サイト（ログボページ/交換サイト）を開いた
    - `notification_click`: デスクトップ通知をクリックして再ログイン/公式サイトを開いた
    - `review_prompt_write`: レビュー促進バナーで「レビューを書く」を押下した
    - `review_prompt_later`: レビュー促進バナーで「あとで」を押下した
    - `review_prompt_dismiss`: レビュー促進バナーで「✕（今後は表示しない）」を押下した
  - `game`: 対象ゲーム（`genshin` / `hsr` / `zzz`、該当しない場合は `'none'`）
  - `app_version`, `lang`, `client_id`, `custom_client_id`, `session_id`, `engagement_time_msec`

### 4.5. `code_list_fetch_error`（コード一覧取得失敗）
- **契機**: 外部の交換コード配布API (`hoyo-codes.seria.moe`) の取得に失敗（タイムアウト・HTTPエラー等）した際。
- **パラメータ**:
  - `game`: 対象ゲーム（`genshin` / `hsr` / `zzz`）
  - `http_status`: HTTPステータスコード（タイムアウト・ネットワークエラー時は `0`）
  - `error_type`: エラー種別（`timeout` / `http_error` / `parse_error` / `network_error`）
  - `app_version`, `lang`, `client_id`, `custom_client_id`, `session_id`, `engagement_time_msec`

---

## 5. 同意管理・オプトイン・オプトアウト設計

ユーザーの自己決定権とプライバシーを尊重するため、明示的な同意フローと容易なオプトアウトを提供しています。

1. **新規ユーザー**:
   - 初回起動時の利用開始確認モーダル（`#optin-modal`）内に「匿名の利用統計データを送信する（品質向上用）」のチェックボックスを配置。
   - チェックを外して開始した場合は、最初からオプトアウト状態で動作します。
2. **既存ユーザー**:
   - アップデート時にシステム通知を乱発してユーザーを煩わせることを避けるため、ツールバーの拡張機能アイコンに目立たない注意バッジ（`"!"`、アクセントカラー）のみを表示（`syncConsentBadge`）。
   - ユーザーが次回ポップアップUIを開いたタイミングで、一度だけ「品質向上のための統計情報収集について」モーダル（`#analytics-consent-modal`）を表示。
   - 「協力する」「協力しない」のいずれを選択しても、バッジは即座に消去され、次回以降モーダルは表示されません。
3. **いつでも設定変更可能（オプトアウト）**:
   - ポップアップ画面右上の設定アイコン（⚙）から開く設定画面に「匿名の利用統計」トグルを配置。
   - いつでもチェックを外して即座に無効化できます。
   - `analyticsEnabled: false` の場合、`sendGAEvent` の冒頭で処理が完全中断され、外部通信は一切発生しません。

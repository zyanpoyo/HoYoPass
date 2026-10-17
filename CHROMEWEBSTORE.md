# Chrome Web Store Listing — HoYoPass

> Last Updated: 2026-10-17

## Store Listing

**Extension Name** [REQUIRED]
HoYoPass - ログボ＆交換コード自動受取ツール

**Short Description** [REQUIRED]
HoYoverseゲーム（原神、崩壊：スターレイル、ゼンレスゾーンゼロ）のデイリーログインボーナスと交換コードを自動受取する非公式ツールです。

**Detailed Description** [REQUIRED]
HoYoverse各ゲーム（原神、崩壊：スターレイル、ゼンレスゾーンゼロ）のHoYoLABデイリーログインボーナスと最新ギフト交換コードを自動で受け取り、毎日の報酬獲得をサポートする非公式ファンメイドツールです。

【主な機能】
• デイリーログインボーナス自動受取 — 毎日01:05 JST（HoYoLAB日付更新直後）およびブラウザ起動・スリープ復帰時に全3タイトルのログインボーナスを自動取得
• 交換コードの3時間ごと自動引き換え — バックグラウンドで最新コードを自動検知して順次引き換え
• 機能別の個別ON/OFFトグル — 「ログボ自動受取」と「交換コード自動引き換え」をそれぞれ独立してON/OFF設定可能
• ワンクリック手動実行 & 公式ページショートカット — ポップアップ画面から現在選択中のタイトルを即時実行、または公式チェックイン・交換ページへワンクリック移動
• マルチタイトル対応 — 原神、崩壊：スターレイル、ゼンレスゾーンゼロの3タイトルをタブで一元管理（未プレイタイトルは自動スキップ）
• カテゴリ別実行ログ表示 — 直近50件のログを「すべて / ログボ / コード」でフィルタリングして確認可能
• デスクトップ通知 — 報酬の受取完了、CAPTCHA認証が必要な場合、再ログインが必要なタイミングをお知らせ

【使い方】
1. ブラウザでHoYoLABの公式ログインボーナスページ、または各ゲームの公式ギフト交換ページにログインします。
2. 拡張機能のアイコンをクリックし、利用規約・免責事項を確認して利用を開始します。
3. 自動受取トグルをONにしておくだけで、毎日のログインボーナスと新着交換コードをバックグラウンドで自動取得します。

【プライバシーとセキュリティ】
本拡張機能は「個人情報を一切収集・送信しない」ゼロトラスト設計です。
• アカウントのログインCookieやパスワードを拡張機能が読み取ったり外部へ送信することはありません（`cookies` 権限不使用）。
• お使いのブラウザに保存された公式セッションを通じて直接公式API（HoYoLAB / HoYoverse）とのみ通信します。
• 設定情報や受取履歴はすべてお使いのPC内にのみ安全に保存されます。

【免責事項】
本拡張機能はファンメイドの非公式ツールであり、COGNOSPHERE PTE. LTD. および miHoYo Co., Ltd.（HoYoverse）とは一切関係ありません。

【サポート & お問い合わせ】
不具合報告や機能要望は、GitHubリポジトリのIssueよりお気軽にご連絡ください。
https://github.com/zyanpoyo/HoYoPass/issues

バージョン 1.1.0 — デイリーログインボーナス自動受取機能 & 統合2カードUIアップデート

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
HoYoverse各ゲームのデイリーログインボーナスおよび公開ギフト交換コードを自動的に受け取り、ゲーム内報酬の獲得を支援する。

**Primary Language** [REQUIRED]
Japanese


## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot1_main_1280x800.png` (メイン画面・統合2カードUI) |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot2_dialog_1280x800.png` (受取・交換成功ダイアログ画面) |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot3_browser_1280x800.png` (Chromeブラウザ操作モックアップ) |
| Popup Preview [REFERENCE] | 360×580 | ✅ Ready | `docs/screenshots/popup_3items_success.png` (ポップアップ実寸) |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
- スクリーンショット1: ポップアップのメイン操作画面（原神タブ、デイリーログボ＆交換コードの2カードUI、ログ一覧）。
- スクリーンショット2: 手動実行後の完了ダイアログ表示画面。
- スクリーンショット3: Chromeブラウザ上でHoYoPassを開いた実際の利用体験モックアップ。
- ポップアップ単体プレビュー: READMEやドキュメント掲載用の実寸切り抜きキャプチャ。


## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | ユーザー設定（ログボ・交換コード各自動実行の有効/無効、選択ゲーム）、本日のログボ受取記録、引き換え済みコード履歴、直近50件の実行ログをブラウザ内にローカル保存するために使用します。 |
| `alarms` | permissions | 毎日01:05 JSTのログインボーナス自動受取アラーム、3時間周期の交換コード自動引き換えアラーム、および通信失敗時の短期自動再試行スケジュールを行うために使用します。 |
| `notifications` | permissions | ログボ受取やコード引き換えの完了通知、CAPTCHA認証要求の案内、および公式セッション期限切れに伴う再ログイン誘導をユーザーへ通知するために使用します。 |
| `idle` | permissions | PCのスリープ解除やユーザーのアイドル復帰を検知し、回線安定後に当日未受取のログインボーナスおよび最新交換コードの自動キャッチアップを行うために使用します。 |
| `https://api-os-takumi.hoyoverse.com/*` | host_permissions | HoYoverse公式Takumi APIと通信し、ログイン中セッションに紐づくゲーム内キャラクター情報（UID・サーバー）を取得するために使用します。 |
| `https://api-os-takumi.hoyolab.com/*` | host_permissions | HoYoLAB側の公式Takumi APIと通信し、`.hoyolab.com` セッション利用時にゲーム内キャラクター情報（UID・サーバー）を取得するために使用します。 |
| `https://sg-hk4e-api.hoyolab.com/*` | host_permissions | 「原神」のHoYoLAB公式デイリーログインボーナスAPI（`/event/sol/info`, `/event/sol/sign`）と通信し、ログインボーナスの状態確認と受取を実行するために使用します。 |
| `https://sg-hk4e-api.hoyoverse.com/*` | host_permissions | 「原神」の公式交換APIおよびデイリーログインボーナスAPIと通信し、交換コードの引き換えとログインボーナスの受取を実行するために使用します。 |
| `https://sg-hkrpg-api.hoyoverse.com/*` | host_permissions | 「崩壊：スターレイル」の公式交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
| `https://sg-public-api.hoyolab.com/*` | host_permissions | 「崩壊：スターレイル」のHoYoLAB公式デイリーログインボーナスAPI（`/event/luna/hkrpg/os/info`, `/event/luna/hkrpg/os/sign`）と通信し、ログインボーナスの状態確認と受取を実行するために使用します。 |
| `https://sg-public-api.hoyoverse.com/*` | host_permissions | 「崩壊：スターレイル」のHoYoverse側デイリーログインボーナスAPIと通信し、フォールバック時のログインボーナス状態確認と受取を実行するために使用します。 |
| `https://public-operation-nap.hoyoverse.com/*` | host_permissions | 「ゼンレスゾーンゼロ」の公式交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
| `https://sg-act-nap-api.hoyolab.com/*` | host_permissions | 「ゼンレスゾーンゼロ」のHoYoLAB公式デイリーログインボーナスAPI（`/event/luna/zzz/os/info`, `/event/luna/zzz/os/sign`）と通信し、ログインボーナスの状態確認と受取を実行するために使用します。 |
| `https://sg-act-nap-api.hoyoverse.com/*` | host_permissions | 「ゼンレスゾーンゼロ」の公式Web交換APIおよびデイリーログインボーナスAPIと通信し、交換コードの引き換えとログインボーナスの受取を実行するために使用します。 |
| `https://hoyo-codes.seria.moe/*` | host_permissions | 検証済みの最新公開ギフト交換コード一覧を取得するために使用します（オープンソースAPI、Cookie・個人情報の送信なし）。 |


## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

本拡張機能はいかなる個人情報・行動データ・認証情報も収集・送信しません。
公式APIとの通信はすべてブラウザ標準のCookie透過通信（`credentials: 'include'`）によりクライアント完結で行われ、外部サーバーへのCookie収集は一切行いません。

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes


## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/zyanpoyo/HoYoPass/blob/master/docs/legal/privacy_policy.md


## Distribution

**Visibility**: Public
**Regions**: All regions


## Developer Info

**Publisher Name** [REQUIRED]
zyanpoyo

**Contact Email** [REQUIRED]
(※ Chrome Web Store デベロッパーダッシュボードに登録したメールアドレスを入力)

**Support URL / Email** [RECOMMENDED]
https://github.com/zyanpoyo/HoYoPass/issues

**Homepage URL** [RECOMMENDED]
https://github.com/zyanpoyo/HoYoPass


## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 1.1.0 | 2026-10-17 | デイリーログインボーナス自動受取機能（原神・スタレ・ZZZ対応）、統合2カードUI、個別ON/OFFトグル、日次独立アラーム＆直列キャッチアップの追加、拡張機能名称の刷新 | Ready |
| 1.0.1 | 2026-10-13 | 実行周期を3時間に短縮、スリープ復帰/ブラウザ起動時キャッチアップ機能、通信エラー時2分後自動再試行機能、`idle` 権限の追加 | Released |
| 1.0.0 | 2026-10-12 | 初回バージョンリリース（原神・スターレイル・ZZZ対応、定期自動引き換え、排他制御） | Released |


## Review Notes

### Known Issues / Limitations
- 本拡張機能は公式Webサイト（HoYoLABおよび各ゲームのギフト交換ページ）でのログインセッションが有効である必要があります。未ログインまたはセッション期限切れ時はデスクトップ通知にて再ログインを促します。
- ログインボーナス受取時にHoYoLAB側からCAPTCHA認証（人間確認）が要求された場合は、デスクトップ通知にて公式チェックインページでの手動認証を案内します。
- 各ゲームでキャラクターが作成されていない場合（未プレイタイトル）は安全にスキップされます。

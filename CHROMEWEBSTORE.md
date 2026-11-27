# Chrome Web Store Listing — HoYoPass

> Last Updated: 2026-11-27

## Store Listing (Japanese / 日本語)

**Extension Name** [REQUIRED]
HoYoPass - ログボ＆交換コード自動受取 for 原神/スタレ/ZZZ

**Short Description** [REQUIRED]
原神・崩壊スターレイル・ゼンゼロのHoYoLABデイリーログインボーナス（ログボ）と最新シリアルコード（交換コード）の自動入力・自動受取ツール。ブラウザを開くだけで原石・星玉・ポリクローム等のゲーム内報酬の取り逃がしを防ぐChrome拡張機能です。

**Detailed Description** [REQUIRED]
HoYoverse各ゲーム（原神、崩壊：スターレイル、ゼンレスゾーンゼロ）のHoYoLABデイリーログインボーナスと最新ギフト交換コード（シリアルコード）を自動で受け取り、原石・星玉・ポリクロームなどの報酬獲得をサポートする非公式ファンメイドツールです。
毎日各サイトを開く手間を省き、コードの入力忘れ・期限切れによる報酬の取り逃がしを防ぎます。
※ 本拡張機能はファンメイドの非公式ツールです。自動化ツールの利用は運営元の利用規約解釈によってはアカウント制限等のリスクがゼロではないため、内容をご理解の上、自己責任でご利用ください（詳細は下部の【ご利用にあたっての重要事項・リスクについて】をご確認ください）。

【こんな方におすすめ】
• 原神、崩壊：スターレイル（スタレ）、ゼンレスゾーンゼロ（ゼンゼロ / ZZZ）を掛け持ちしていて、毎日の日課を効率化したい方
• ホヨラボ（HoYoLAB）のログボ（デイリーチェックイン）をつい受け取り忘れてしまう方
• 公式の予告番組・生放送のシリアルコード（プロモコード / ギフトコード）を期限切れ前に自動入力で手軽に回収したい方
• 毎回ブラウザで複数の交換サイトを開いてコードをコピペする手間をなくしたい方

【主な機能】
• 多言語対応（日本語 / 英語）— ブラウザの表示言語に合わせた自動表示に加え、設定（⚙）から手動切り替え可能
• 初回利用時の即時自動受取 — 初期設定（同意）完了直後から未受取のログインボーナスおよび有効な交換コードを即座に自動取得
• デイリーログインボーナス自動受取 — 毎日 01:05 JST頃（00:05 UTC+8基準・負荷分散のため30分幅で自動調整／お住まいの現地時刻へ自動換算）に各タイトルのログインボーナスを自動実行。PC起動時やスリープ復帰時にも未受取のログボ・最新コードを自動でキャッチアップするため、深夜にPCを起動しておく必要はありません
• 交換コードの3時間ごと自動引き換え — 3時間ごとに公開コード一覧を確認し、未使用コード検知時のみ非公開APIで順次引き換えを実行
• プレイ中タイトルのみ表示するタブカスタマイズ — プレイしていないゲームはタブ非表示＆バックグラウンド巡回から安全に除外可能
• ワンクリック手動実行 — ポップアップ画面から現在選択中のタイトルを即時実行
• コード適用実績＆有効コード消化状況の可視化 — ポップアップ上で現在有効なコードの消化状況と、今月・累計の引き換え実績を確認可能

【使い方】
1. ブラウザでHoYoLABの公式ログインボーナスページ、または各ゲームの公式ギフト交換ページにログインします。
2. 拡張機能のアイコンをクリックし、利用規約・免責事項およびリスクに関する注意事項を確認して利用を開始します。
3. 自動受取トグルをONにしておくだけで、毎日のログインボーナスと新着交換コードをバックグラウンドで自動取得します。
※ 初回利用時、過去に手動交換済みのコードがある場合はゲーム内に「使用済み（重複）」の通知メールが届くことがありますが、API仕様による正常な挙動です（実害はなく、一度処理されたコードは拡張機能内に記録され次回以降再送されません）。

【プライバシーとセキュリティ】
本拡張機能は、認証情報を外部に出さないプライバシー重視のゼロトラスト設計です。
• ログイン情報、Cookie、パスワードを拡張機能が読み取ったり外部サーバーへ送信することはありません。
• ログインセッションを用いる通信は、お使いのブラウザから非公開API（HoYoLAB / HoYoverse）とのみ直接行います（最新コード一覧の取得にのみ、認証情報を含めない形で公開APIを利用します）。
• 設定や受取履歴はすべてお使いのPCローカル内に安全に保存されます。
• ※品質改善用の匿名利用統計（個人を特定しない操作ログ）は、設定画面からいつでも完全無効化（オプトアウト）可能です。

【ご利用にあたっての重要事項・リスクについて】
• 本拡張機能はファンメイドの非公式ツールであり、COGNOSPHERE PTE. LTD. および miHoYo Co., Ltd.（HoYoverse）とは一切関係ありません。
• 外部ツールを用いたログインボーナス受取やギフトコード引き換えの自動化は、運営元の利用規約や運用方針の解釈によっては、アカウント制限・停止等のリスクがゼロではありません。
• 過剰なリクエストや短時間の連続実行を避けるため、リクエストの分散・指数バックオフ制御や、未使用コード検知時のみ非公開APIを実行する設計を採用していますが、これらの対策によって規約上のリスクが完全に消えるものではありません。
• 最終的なご利用の判断および利用に伴う結果・損害等については、すべてユーザーご自身の責任（自己責任）となります。上記をご理解・ご同意いただいた上でのみご利用ください。

【サポート & お問い合わせ】
不具合報告や機能要望は、Chrome ウェブストアの本拡張機能ページ（サポートタブ）よりご連絡ください。

バージョン 1.3.6 — 軽微なバグを修正しました

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
HoYoverse各ゲームのデイリーログインボーナスおよび公開ギフト交換コードを自動的に受け取り、ゲーム内報酬の獲得を支援する。

**Primary Language** [REQUIRED]
English (Default) / Japanese


---

## Store Listing (English / 英語)

**Extension Name** [REQUIRED]
HoYoPass - Auto Daily Check-In & Codes for Genshin / HSR / ZZZ

**Short Description** [REQUIRED]
Auto-claims HoYoLAB daily check-in rewards & gift codes for Genshin Impact, Honkai: Star Rail, and ZZZ in the background.

**Detailed Description** [REQUIRED]
HoYoPass is an unofficial, fan-made Chrome extension designed to help Travelers, Trailblazers, and Proxies reduce the hassle of claiming daily rewards. It claims HoYoLAB daily check-in bonuses and auto-redeems newly released promo codes and gift codes for Genshin Impact, Honkai: Star Rail (HSR), and Zenless Zone Zero (ZZZ) directly in the background.
Save time opening multiple tabs every day and reduce the chance of missing limited-time livestream codes and redemption codes (Primogems, Stellar Jades, Polychromes).
* Note: This is an unofficial fan-made tool. Automating actions via third-party tools carries a non-zero risk of account restrictions depending on HoYoverse's Terms of Service interpretation. Please review [Important Notice & Risks] below and use entirely at your own risk.

[Key Features]
• Multi-Language Support (English / Japanese) — Automatically matches your browser language or can be toggled manually from settings (⚙).
• Immediate Auto-Claim on Setup — Right after agreeing to terms, it instantly collects all pending check-in rewards and available active codes.
• Background Daily Check-In — Automatically cycles through all enabled games daily around 00:05 UTC+8 (around 01:05 JST, distributed across a 30-minute window and calculated in your local timezone). It also automatically catches up on any unclaimed daily check-in bonuses and latest promo codes when you start your PC or wake it from sleep, so there is no need to leave your PC running overnight.
• 3-Hour Periodic Code Redemption — Checks the public code list every 3 hours and calls the private redemption API only when unclaimed codes are detected.
• Tab Filter & Game Customization — Playing only Genshin, HSR, or ZZZ? Hide unplayed games from the interface and exclude them safely from background checks.
• One-Click Instant Manual Trigger — Instantly redeem codes or claim check-in for the currently selected game from the popup.
• Transparent Stats & Active Code Tracker — Easily check how many active codes are available, your monthly count, and total redeemed codes.

[How to Use]
1. Log in to the official HoYoLAB check-in page or game redemption website in your browser.
2. Click the HoYoPass icon on your toolbar and review the disclaimer and risk notice to start.
3. Keep the toggles ON. This Chrome extension will automatically collect check-in rewards and auto-redeem codes in the background.
* Note: On your first run, you may receive in-game mail stating "Code has already been used" for codes you previously claimed manually. This is normal behavior from the private API. These codes are safely remembered and will not be re-submitted.

[Privacy & Security]
HoYoPass is built with a privacy-first, zero-credential-collection design:
• No passwords, session tokens, or account credentials are ever read, stored, or sent to external servers.
• All authenticated requests using your browser session communicate directly and exclusively with private HoYoLAB / HoYoverse APIs (the public code-list API is queried without any credentials or cookies).
• All preferences and redemption histories are stored 100% locally on your computer.
• Fully transparent: Anonymous usage metrics for quality improvements can be toggled off at any time via Settings (⚙).

[Important Notice & Risks]
• HoYoPass is an unofficial fan-made project and is NOT affiliated with, endorsed by, or associated with COGNOSPHERE PTE. LTD. or miHoYo Co., Ltd. (HoYoverse).
• Automating daily check-ins or gift code redemptions via third-party tools carries a non-zero risk of account restrictions or suspension depending on how HoYoverse interprets and enforces its Terms of Service.
• To minimize server load and avoid burst requests, HoYoPass implements request jitter, exponential backoff, and only calls private APIs when unclaimed codes are detected; however, these safeguards do not completely eliminate Terms of Service risks.
• Use of this extension is entirely at your own discretion and risk. By using HoYoPass, you acknowledge and accept full responsibility for any outcomes.

[Support]
Please submit any questions or bug reports through the Support tab on the Chrome Web Store page.

Version 1.3.6 — Fixed minor bugs.

**Single Purpose** [REQUIRED]
Automatically claims HoYoverse daily check-in rewards and redeems public gift codes to assist players in acquiring in-game items.


---

## Graphics & Assets

### Japanese Store Assets
| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot1_main_1280x800.png` (メイン画面・日本語) |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot2_dialog_1280x800.png` (受取完了ダイアログ・日本語) |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot3_browser_1280x800.png` (ブラウザ操作モック・日本語) |
| Popup Preview [REFERENCE] | 340×480 | ✅ Ready | `docs/screenshots/popup_3items_success.png` (ポップアップ実寸・日本語) |

### English Store Assets
| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Screenshot 1 (EN) [REQUIRED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot1_main_1280x800_en.png` (Main Popup UI in English) |
| Screenshot 2 (EN) [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot2_dialog_1280x800_en.png` (Instant Dialog UI in English) |
| Screenshot 3 (EN) [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot3_browser_1280x800_en.png` (Browser Mockup in English) |
| Popup Preview (EN) [REFERENCE] | 340×480 | ✅ Ready | `docs/screenshots/popup_3items_success_en.png` (Standalone Popup in English) |


## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | ユーザー設定（ログボ・交換コード各自動実行の有効/無効、選択ゲーム、表示言語）、本日のログボ受取記録、引き換え済みコード履歴、直近50件の実行ログをブラウザ内にローカル保存するために使用します。 |
| `alarms` | permissions | 毎日01:05 JST頃（現地時刻換算・負荷分散オフセット付き）のログインボーナス自動受取アラーム、3時間周期の交換コード自動引き換えアラーム、および通信失敗時の回数上限付き自動再試行スケジュールを行うために使用します。 |
| `notifications` | permissions | ログボ受取やコード引き換えの完了通知、CAPTCHA認証要求の案内、および公式セッション期限切れに伴う再ログイン誘導をユーザーへ通知するために使用します。 |
| `idle` | permissions | PCのスリープ解除やユーザーのアイドル復帰を検知し、回線安定後に当日未受取のログインボーナスおよび最新交換コードの自動キャッチアップを行うために使用します。 |
| `https://api-os-takumi.hoyoverse.com/*` | host_permissions | HoYoverse非公開Takumi APIと通信し、ログイン中セッションに紐づくゲーム内キャラクター情報（UID・サーバー）を取得するために使用します。 |
| `https://api-os-takumi.hoyolab.com/*` | host_permissions | HoYoLAB側の非公開Takumi APIと通信し、`.hoyolab.com` セッション利用時にゲーム内キャラクター情報（UID・サーバー）を取得するために使用します。 |
| `https://sg-hk4e-api.hoyolab.com/*` | host_permissions | 「原神」のHoYoLAB非公開デイリーログインボーナスAPI（`/event/sol/info`, `/event/sol/sign`）と通信し、ログインボーナスの状態確認と受取を実行するために使用します。 |
| `https://sg-hk4e-api.hoyoverse.com/*` | host_permissions | 「原神」の非公開交換APIおよびデイリーログインボーナスAPIと通信し、交換コードの引き換えとログインボーナスの受取を実行するために使用します。 |
| `https://sg-hkrpg-api.hoyoverse.com/*` | host_permissions | 「崩壊：スターレイル」の非公開交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
| `https://sg-public-api.hoyolab.com/*` | host_permissions | 「崩壊：スターレイル」のHoYoLAB非公開デイリーログインボーナスAPI（`/event/luna/hkrpg/os/info`, `/event/luna/hkrpg/os/sign`）と通信し、ログインボーナスの状態確認と受取を実行するために使用します。 |
| `https://sg-public-api.hoyoverse.com/*` | host_permissions | 「崩壊：スターレイル」のHoYoverse側デイリーログインボーナスAPIと通信し、フォールバック時のログインボーナス状態確認と受取を実行するために使用します。 |
| `https://public-operation-nap.hoyoverse.com/*` | host_permissions | 「ゼンレスゾーンゼロ」の非公開交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
| `https://sg-act-nap-api.hoyolab.com/*` | host_permissions | 「ゼンレスゾーンゼロ」のHoYoLAB非公開デイリーログインボーナスAPI（`/event/luna/zzz/os/info`, `/event/luna/zzz/os/sign`）と通信し、ログインボーナスの状態確認と受取を実行するために使用します。 |
| `https://sg-act-nap-api.hoyoverse.com/*` | host_permissions | 「ゼンレスゾーンゼロ」の非公開Web交換APIおよびデイリーログインボーナスAPIと通信し、交換コードの引き換えとログインボーナスの受取を実行するために使用します。 |
| `https://hoyo-codes.seria.moe/*` | host_permissions | 検証済みの最新公開ギフト交換コード一覧を取得するために使用します（オープンソースAPI、Cookie・個人情報の送信なし）。 |


## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

本拡張機能は、機能の改善および不具合検知を目的として、Google Analytics 4 Measurement Protocol 経由で匿名の利用統計データを収集します。
- **収集するデータ項目**: ユーザーの操作種別（UIボタン押下など）、コード引き換え成否ステータス、エラー分類コード、拡張機能バージョン、表示言語設定、およびランダム生成された識別子（UUID）。
- **収集しない情報**: 氏名、メールアドレス、パスワード、ゲームアカウントUID、Cookie、IPアドレス、その他一切の個人を特定可能な情報。
- **オプトアウト（無効化）**: 初回利用開始時の確認画面、またはポップアップ設定画面（⚙）の「匿名の利用統計」トグルから、いつでも無効化できます。

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes


## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://hoyopass.pages.dev/privacy (English: https://hoyopass.pages.dev/privacy_en)


## Distribution

**Visibility**: Public
**Regions**: All regions


## Developer Info

**Publisher Name** [REQUIRED]
zyanpoyo

**Contact Email** [REQUIRED]
(※ Chrome Web Store デベロッパーダッシュボードに登録したメールアドレスを入力)

**Support URL / Email** [RECOMMENDED]
https://hoyopass.pages.dev/ (English: https://hoyopass.pages.dev/index_en)

**Homepage URL** [RECOMMENDED]
https://hoyopass.pages.dev/ (English: https://hoyopass.pages.dev/index_en)


## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 1.3.6 | 2026-11-27 | 内部アーキテクチャのモジュール深化（Background・永続状態ストア・API通信・Popup・ゲーム定義カタログの一元化）および未使用フレーバー設定の整理 | Ready |
| 1.3.5 | 2026-11-26 | 交換コードAPI未ログイン(-100/-1071)検知・Windows通知・ポップアップ「要ログイン ↗」導線・未適用0件時モーダル補足・同種コード既使用(-2018)対応 | Ready |
| 1.3.4 | 2026-11-24 | 未使用コード事前判定による非公開API通信の削減、ストア説明文・UI・ドキュメントの注意喚起および免責表記の強化 | Released |
| 1.3.3 | 2026-11-23 | リクエスト分散（ジッター）・指数バックオフ・リトライ上限・手動クールダウンの導入、MV3待機保護・非JSON応答防御による通信耐性および安定性の向上 | Released |
| 1.3.2 | 2026-11-13 | Chrome ウェブストア掲載情報・拡張機能説明文の拡充（日英SEO・機能明記）、バックグラウンド自動受取・スリープ復帰時キャッチアップ処理の安定性向上 | Released |
| 1.3.1 | 2026-11-01 | ストアレビュー促進機能（インラインバナー形式、成功体験累積トリガー、延期・非表示管理）の追加、開発版テスト用ワンクリックリセット機構の導入 | Released |
| 1.3.0 | 2026-10-27 | サービス品質向上のための匿名利用統計（GA4 Measurement Protocol）の導入、明示的なオプトイン/オプトアウト設定UI、初回利用時および既存ユーザー向け同意フローの実装、アンインストール時の品質改善アンケートフォーム誘導対応、機密情報保護アーキテクチャの強化、プライバシーポリシー日英多言語対応および将来の改定管理（バージョン管理）機構の導入 | Released |
| 1.2.2 | 2026-10-25 | 多言語対応（日本語 / 英語）、ブラウザ言語自動判定＆手動切替UI（Auto / 日本語 / English）、ロケーション連動APIリクエスト、現地時刻自動換算表示、CWS英語掲載情報および英語スクリーンショット生成対応 | Released |
| 1.2.1 | 2026-10-24 | 初期設定完了時の即時自動受取対応、プレイ中タイトルに絞り込めるタブ表示カスタマイズ、UI/UX改善および安定性の向上 | Released |
| 1.2.0 | 2026-10-24 | ポップアップ画面のUIシンプル化・操作性向上、交換コード適用実績（今月/通算）および有効コード消化状況の可視化、初回利用時の交換コード重複案内ドキュメント強化 | Released |
| 1.1.0 | 2026-10-17 | デイリーログインボーナス自動受取機能（原神・スタレ・ZZZ対応）、統合2カードUI、個別ON/OFFトグル、日次独立アラーム＆直列キャッチアップの追加、拡張機能名称の刷新 | Released |
| 1.0.1 | 2026-10-13 | 実行周期を3時間に短縮、スリープ復帰/ブラウザ起動時キャッチアップ機能、通信エラー時2分後自動再試行機能、`idle` 権限の追加 | Released |
| 1.0.0 | 2026-10-12 | 初回バージョンリリース（原神・スターレイル・ZZZ対応、定期自動引き換え、排他制御） | Released |


## Review Notes

### Known Issues / Limitations
- 本拡張機能は公式Webサイト（HoYoLABおよび各ゲームのギフト交換ページ）でのログインセッションが有効である必要があります。未ログインまたはセッション期限切れ時はデスクトップ通知にて再ログインを促します。
- ログインボーナス受取時にHoYoLAB側からCAPTCHA認証（人間確認）が要求された場合は、デスクトップ通知にて公式チェックインページでの手動認証を案内します。
- 各ゲームでキャラクターが作成されていない場合（未プレイタイトル）は安全にスキップされます。
- 初回利用時、現在公開されている有効コードを一括で引き換えるため、過去にゲーム内等で手動交換済みのコードについてゲーム内メールで「交換コードは既に使用されています（重複エラー）」という通知が届く場合があります。これはHoYoverse非公開APIの仕様による正常な挙動であり、アカウントへの実害はありません。

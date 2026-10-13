# Chrome Web Store Listing — HoYoPass

> Last Updated: 2026-10-12

## Store Listing

**Extension Name** [REQUIRED]
HoYoPass - 交換コード自動引き換えツール (Unofficial)

**Short Description** [REQUIRED]
HoYoverseゲーム（原神、崩壊：スターレイル、ゼンレスゾーンゼロ）の交換コードを自動引き換えする非公式ツールです。

**Detailed Description** [REQUIRED]
HoYoverse各ゲーム（原神、崩壊：スターレイル、ゼンレスゾーンゼロ）の最新ギフト交換コードを自動で引き換え、ゲーム内報酬の受け取りをサポートする非公式ファンメイドツールです。

【主な機能】
• 3時間ごとの定期自動引き換え — バックグラウンドで最新コードを自動検知して順次引き換え（スリープ復帰・ブラウザ起動時の自動キャッチアップ対応）
• ワンクリック手動引き換え — ポップアップ画面から現在選択中のタイトルを即時引き換え
• マルチタイトル対応 — 原神、崩壊：スターレイル、ゼンレスゾーンゼロの3タイトルをタブで一元管理
• 直近50件の実行ログ表示 — 引き換え結果や成功件数をいつでも手元で確認可能
• デスクトップ通知 — コード交換の完了や再ログインが必要なタイミングをお知らせ

【使い方】
1. ブラウザで各ゲームの公式サイトまたはHoYoLABにログインします。
2. 拡張機能のアイコンをクリックし、利用規約・免責事項を確認して利用を開始します。
3. 交換したいゲームのタブ（原神 / スタレ / ZZZ）を選択し、「今すぐ引き換え実行」をクリックするか、自動引き換えをONにしておくだけで完了です。

【プライバシーとセキュリティ】
本拡張機能は「個人情報を一切収集・送信しない」ゼロトラスト設計です。
• アカウントのログインCookieやパスワードを拡張機能が読み取ったり外部へ送信することはありません。
• お使いのブラウザに保存された公式セッションを通じて直接公式交換サイトとのみ通信します。
• 設定情報や引き換え履歴はすべてお使いのPC内にのみ安全に保存されます。

【免責事項】
本拡張機能はファンメイドの非公式ツールであり、COGNOSPHERE PTE. LTD. および miHoYo Co., Ltd.（HoYoverse）とは一切関係ありません。

【サポート & お問い合わせ】
不具合報告や機能要望は、GitHubリポジトリのIssueよりお気軽にご連絡ください。
https://github.com/zyanpoyo/HoYoPass/issues

バージョン 1.0.1 — バックグラウンド実行の信頼性向上アップデート

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
HoYoverse各ゲームの公開ギフト交換コードを自動的に検知・引き換えてゲーム内報酬の受け取りを支援する。

**Primary Language** [REQUIRED]
Japanese


## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot1_main_1280x800.png` (メイン画面・3件交換成功ログ) |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot2_dialog_1280x800.png` (3件交換成功ダイアログ画面) |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/screenshots/screenshot3_browser_1280x800.png` (Chromeブラウザ操作モックアップ) |
| Popup Preview [REFERENCE] | 340×490 | ✅ Ready | `docs/screenshots/popup_3items_success.png` (ポップアップ実寸) |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
- スクリーンショット1: ポップアップのメイン操作画面（原神タブ、自動引き換えトグルON、3件の交換成功ログ一覧）。
- スクリーンショット2: 手動引き換え後の「3件のコードを引き換えました」ダイアログ表示画面。
- スクリーンショット3: Chromeブラウザ上でHoYoPassを開いた実際の利用体験モックアップ。
- ポップアップ単体プレビュー: READMEやドキュメント掲載用の実寸切り抜きキャプチャ。


## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | ユーザー設定（自動引き換えの有効/無効、選択ゲーム）、引き換え済みコード履歴、直近50件の実行ログをブラウザ内にローカル保存するために使用します。 |
| `alarms` | permissions | 3時間周期でバックグラウンド実行をトリガーし、および通信失敗時の自動再試行スケジュールを行うために使用します。 |
| `notifications` | permissions | コード引き換えの完了通知、および公式セッション期限切れに伴う再ログイン誘導をユーザーへ通知するために使用します。 |
| `idle` | permissions | PCのスリープ解除やユーザーのアイドル復帰を検知し、回線安定後に最新コードの自動キャッチアップ引き換えを行うために使用します。 |
| `https://api-os-takumi.hoyoverse.com/*` | host_permissions | HoYoverse公式Takumi APIと通信し、ログイン中セッションに紐づくゲーム内キャラクター情報（UID・サーバー）を取得するために使用します。 |
| `https://sg-hk4e-api.hoyoverse.com/*` | host_permissions | 「原神」の公式交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
| `https://sg-hkrpg-api.hoyoverse.com/*` | host_permissions | 「崩壊：スターレイル」の公式交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
| `https://public-operation-nap.hoyoverse.com/*` | host_permissions | 「ゼンレスゾーンゼロ」の公式交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
| `https://sg-act-nap-api.hoyoverse.com/*` | host_permissions | 「ゼンレスゾーンゼロ」の公式Web交換APIと通信し、取得した交換コードの引き換えを実行するために使用します。 |
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
| 1.0.1 | 2026-10-13 | 実行周期を3時間に短縮、スリープ復帰/ブラウザ起動時キャッチアップ機能、通信エラー時2分後自動再試行機能、`idle` 権限の追加 | Ready |
| 1.0.0 | 2026-10-12 | 初回バージョンリリース（原神・スターレイル・ZZZ対応、定期自動引き換え、排他制御） | Draft |


## Review Notes

### Known Issues / Limitations
- 本拡張機能は公式Webサイトでのログインセッションが有効である必要があります。未ログインまたはセッション期限切れ時はデスクトップ通知にて再ログインを促します。
- 各ゲームでキャラクターが作成されていない場合（未プレイタイトル）は安全にスキップされます。

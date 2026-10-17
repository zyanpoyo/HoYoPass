# HoYoPass - ログボ＆交換コード自動受取 Chrome拡張機能 実装調査・仕様書

本ドキュメントは、HoYoverseゲーム（原神、崩壊：スターレイル、ゼンレスゾーンゼロ）における**「デイリーログインボーナス自動受取」および「交換コード（シリアルコード）自動検知・自動引き換え」を行うChrome拡張機能（HoYoPass）**の技術仕様書である。

---

## 1. プロジェクト概要と解決課題

### 1.1 プロジェクト目的
1. **デイリーログインボーナスの完全自動受取**: HoYoLAB上で毎日配布される各タイトルのログインボーナスを、日本時間深夜1時（`00:00 UTC+8`）のリセット以降にバックグラウンドで自動取得する。
2. **交換コードの自動検知・自動引き換え**: 公式SNSや公式生放送等で随時発表される交換コード（原石・星玉・ポリクローム等のゲーム内アイテム配布コード）を、バックグラウンドで3時間ごとに自動検知し、代理で引き換える。

### 1.2 解決する課題
* **毎日のチェックイン忘れ・手動入力の手間**: 毎日HoYoLABのチェックインページや各ゲームのギフト交換サイトにアクセスし、手動で受け取る手間の削減。
* **受取期限切れの防止**: 生放送記念コードなどの「数時間〜1日」で期限切れになる限定コードの失効リスク、および累計ログイン日数の取りこぼしを防止。
* **導入の敷居の低さ**: 従来のスクリプト型（GitHub Actions等）で必須だった「F12開発者ツールを開いてCookieを手動抽出する」複雑な手順を廃止し、通常通りブラウザで公式サイト（HoYoLAB / ギフト交換サイト）にログインしているだけで動作するゼロトラストUXを実現。

---

## 2. HoYoverse / HoYoLAB API & 認証仕様調査結果

### 2.1 公式APIの提供状況
* **公式開発者API**: **提供なし**（オープンなDeveloper PortalやOAuth 2.0認証、APIキー発行等は一切存在しない）。
* **アクセス手法**: 公式Webサイト（HoYoLABおよびギフト交換ページ）が内部通信で利用している**公式内部REST API**を直接呼び出す。

### 2.2 認証方式（Cookie透過通信 & デュアルドメイン対応）
HoYoverse / HoYoLABのWebセッションはCookieによって管理される。HoYoPassでは `chrome.cookies` 権限を一切使用せず、ブラウザ標準の `fetch(..., { credentials: 'include' })` によってブラウザが保持する公式セッションCookieを自動付与させる。

#### ドメイン別のCookie分離とフォールバック仕様
* **`.hoyolab.com`**: HoYoLAB公式チェックインページ（`https://act.hoyolab.com`）や `https://www.hoyolab.com` にログインした際に保存される。
* **`.hoyoverse.com`**: 各ゲームの公式ギフト交換ページ（`https://genshin.hoyoverse.com/ja/gift` 等）にログインした際に保存される。
* **デュアルホスト試行**: ログボAPIおよびロール照会APIは `*.hoyolab.com` と `*.hoyoverse.com` の両方にエンドポイントが存在するため、プライマリホストで未ログイン判定（`retcode: -100` / `-1071`）となった場合は自動的にセカンダリホストへフォールバックする。

### 2.3 関連APIエンドポイント仕様

#### (1) ゲームアカウント・UID自動取得API
ログイン中のCookieに紐づいているゲーム内キャラクター（UID、サーバー、ニックネーム等）の一覧を取得する。

* **Endpoint**:
  * Primary: `GET https://api-os-takumi.hoyoverse.com/binding/api/getUserGameRolesByCookie`
  * Secondary: `GET https://api-os-takumi.hoyolab.com/binding/api/getUserGameRolesByCookie`
* **Query Parameters**:
  * `game_biz`: `hk4e_global`（原神）、`hkrpg_global`（スターレイル）、`nap_global`（ゼンレスゾーンゼロ）

#### (2) デイリーログインボーナスAPI（Daily Check-In API）
HoYoLABのデイリーログインボーナス状態照会（`info`）および受取実行（`sign`）を行う。

| ゲーム | `act_id` | `x-rpc-signgame` | `info` Path (`GET`) | `sign` Path (`POST`) | 対応ホスト（Primary / Secondary） |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **原神** | `e202102251931481` | `hk4e` | `/event/sol/info` | `/event/sol/sign` | `sg-hk4e-api.hoyolab.com` / `sg-hk4e-api.hoyoverse.com` |
| **崩壊：スターレイル** | `e202303301540311` | `hkrpg` | `/event/luna/hkrpg/os/info` | `/event/luna/hkrpg/os/sign` | `sg-public-api.hoyolab.com` / `sg-public-api.hoyoverse.com` |
| **ゼンレスゾーンゼロ** | `e202406031448091` | `zzz` | `/event/luna/zzz/os/info` | `/event/luna/zzz/os/sign` | `sg-act-nap-api.hoyolab.com` / `sg-act-nap-api.hoyoverse.com` |

* **必須リクエストヘッダー**:
  * `x-rpc-signgame`: `hk4e` / `hkrpg` / `zzz`（特にZZZでは未付与時に `retcode: -100, message: "请从游戏内打开参与活动"` で弾かれるため必須）
* **主なResponse Retcode & 判定**:
  * `0`: 成功（ただし `data.is_risk === true` または `data.gt_result?.is_risk === true` の場合はCAPTCHA要求と判定）
  * `-5003`: 本日分はすでに受け取り済み（正常スキップ対象）
  * `1034`: CAPTCHA（人間認証）要求（公式チェックインページへ誘導）
  * `-100` / `-1071`: 未ログイン・Cookie期限切れ

#### (3) 交換コード引き換えAPI
指定したUIDおよびサーバーに対して交換コードを適用する。

* **Endpoint**:
  * 原神: `GET https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey`
  * 崩壊：スターレイル: `GET https://sg-hkrpg-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey`
  * ゼンレスゾーンゼロ: `GET https://public-operation-nap.hoyoverse.com/common/apicdkey/api/webExchangeCdkey` / `https://sg-act-nap-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey`
* **Response Status Code / Retcode**:
  * `0`: 成功（「交換に成功しました。ゲーム内メールをご確認ください」）
  * `-2017`: すでに交換済み（正常スキップ対象）
  * `-2001`: コードが無効または使用期限切れ
  * `-2016`: クールダウン中（短時間の連続リクエストによる拒否。約5秒以上の待機が必要）
  * `-1071` / `-100`: Cookie無効・未ログイン（再ログインが必要）

> **参考GitHubリポジトリ（APIリファレンス・仕様調査元）**:
> - [torikushiii/hoyoverse-api (GitHub)](https://github.com/torikushiii/hoyoverse-api) - 各種HoYoverseタイトルのコード交換・エンドポイント仕様
> - [thesadru/genshin.py (GitHub)](https://github.com/thesadru/genshin.py) - Takumi API / デイリーチェックインAPI / 認証仕様等の包括的リファレンス実装

---

## 3. 新着コード取得元（データソース設計）

1. **[hoyo-codes API (GitHub: seriaati/hoyo-codes)](https://github.com/seriaati/hoyo-codes)**
   * 原神、スターレイル、ZZZの有効コードを自動検証付きで提供しているREST API（`https://hoyo-codes.seria.moe/codes?game={genshin|hkrpg|nap}`）。

---

## 4. Chrome拡張機能（Manifest V3）アーキテクチャ設計

### 4.1 統合2カードUI & 個別制御トグル
* ポップアップ画面は上部のゲーム選択タブ（`原神` / `スタレ` / `ZZZ`）の下に、2つの独立した機能カードを配置する：
  1. **🎁 デイリーログインボーナスカード**: 本日の受取ステータスバッジ（`受取済 ✅ (累計 X日)` / `未受取`）、自動受取トグル（`autoSignEnabled`）、手動「今すぐログボ受取」ボタン、公式チェックインページへのショートカットボタン。
  2. **🎟️ 交換コード自動引き換えカード**: 自動引き換えトグル（`autoRedeemEnabled`）、手動「今すぐコード引き換え」ボタン、公式ギフト交換ページへのショートカットボタン。
* 実行ログセクションにはカテゴリフィルタ（`すべて` / `ログボ` / `コード`）を設ける。

### 4.2 独立2系統アラームと直列キャッチアップ
1. **ログインボーナス自動受取 (`hoyo_daily_sign_alarm`)**:
   * HoYoLABの日付リセット（`00:00 UTC+8` ＝ `01:00 JST`）に合わせ、毎日 `01:05 JST` に定期発火する日次アラームで全タイトルを巡回。
2. **交換コード自動引き換え (`hoyo_auto_redeem_alarm`)**:
   * 3時間（180分）周期のアラームで全タイトルの新着コードを巡回。
3. **ブラウザ起動時 / スリープ復帰時直列キャッチアップ (`maybeRunAllCatchUp`)**:
   * Chrome起動時およびアイドル復帰時、15秒後に「① 当日ログボ未実行ならログボ巡回」→「② 前回から3時間以上経過していればコード巡回」の順で直列実行し、排他ロック（Mutex）の競合を防止する。

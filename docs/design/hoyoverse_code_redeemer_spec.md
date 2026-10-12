# HoYoverse 交換コード自動引き換え Chrome拡張機能 実装調査・仕様書

本ドキュメントは、HoYoverseゲーム（原神、崩壊：スターレイル、ゼンレスゾーンゼロ等）における**「交換コード（シリアルコード）自動検知・自動引き換えChrome拡張機能」**の実装計画をAIに策定させるためのインプット仕様書である。

---

## 1. プロジェクト概要と解決課題

### 1.1 プロジェクト目的
公式SNSや公式生放送等で随時発表される交換コード（原石・星玉・ポリクローム等のゲーム内アイテム配布コード）を、ユーザーが手動で確認・入力することなく、**ブラウザ拡張機能がバックグラウンドで完全自動検知し、代理で引き換えるシステム**を構築する。

### 1.2 解決する課題
* **手動入力の手間**: 毎回公式サイト（例: [https://genshin.hoyoverse.com/ja/gift](https://genshin.hoyoverse.com/ja/gift)）にアクセスし、UIDを選択してコードをコピペ・申請する手間の削減。
* **受取期限切れの防止**: 生放送記念コードなどの「数時間〜1日」で期限切れになる限定コードの失効リスクを防止。
* **導入の敷居の低さ**: 従来のスクリプト型（GitHub Actions等）で必須だった「F12開発者ツールを開いてCookieを手動抽出する」複雑な手順を廃止し、通常通りブラウザで公式サイトにログインしているだけで動作するUXを実現。

---

## 2. HoYoverse API & 認証仕様調査結果

### 2.1 公式APIの提供状況
* **公式開発者API**: **提供なし**（オープンなDeveloper PortalやOAuth 2.0認証、APIキー発行等は一切存在しない）。
* **アクセス手法**: 公式Webサイト（HoYoLABおよびギフト交換ページ）が内部通信で利用している**非公式内部REST API**を直接呼び出す。

### 2.2 認証方式（Cookieベース認証）
HoYoverseのWebセッションはCookieによって管理される。Chrome拡張機能の `chrome.cookies` API を利用することで、ユーザーのブラウザ内Cookieを直接読み取り、認証ヘッダーとして利用する。

#### 必要となるCookieキー名
* `account_id` / `account_id_v2`: アカウント識別子
* `cookie_token` / `cookie_token_v2`: Web機能実行用のセッショントークン
* （補助）`account_mid_v2`, `ltuid_v2`, `ltoken_v2`

> **Note**: ブラウザ上で `https://genshin.hoyoverse.com` または `https://www.hoyolab.com` に1度でもログインしていれば、`.hoyoverse.com` ドメインにこれらのCookieが保存される。

### 2.3 関連APIエンドポイント仕様

#### (1) ゲームアカウント・UID自動取得API
ログイン中のCookieに紐づいているゲーム内キャラクター（UID、サーバー、ニックネーム等）の一覧を取得する。

* **Endpoint**: `GET https://api-os-takumi.hoyoverse.com/binding/api/getUserGameRolesByCookie`
* **Query Parameters**:
  * `game_biz`: `hk4e_global`（原神）、`hkrpg_global`（スターレイル）、`nap_global`（ゼンレスゾーンゼロ）
* **Headers**:
  * `Cookie`: 取得した認証Cookie文字列
* **Response Example (`retcode: 0`)**:
  ```json
  {
    "retcode": 0,
    "message": "OK",
    "data": {
      "list": [
        {
          "game_biz": "hk4e_global",
          "region": "os_asia",
          "game_uid": "800123456",
          "nickname": "Traveler",
          "level": 60,
          "is_chosen": true,
          "region_name": "Asia Server"
        }
      ]
    }
  }
  ```

#### (2) 交換コード引き換えAPI
指定したUIDおよびサーバーに対して交換コードを適用する。

* **Endpoint**: `GET https://sg-hk4e-api.hoyoverse.com/common/apicd-g-service/api/exchange`
  * ※ スターレイルは `sg-hkrpg-api.hoyoverse.com` 等、ゲーム毎の専用サブドメインまたは共通エンドポイントを使用。
* **Query Parameters**:
  * `uid`: プレイヤーUID（例: `800123456`）
  * `region`: 所属サーバー（例: `os_asia`, `os_usa`, `os_euro`, `os_cht`）
  * `lang`: 言語コード（例: `ja`）
  * `cdkey`: 交換コード文字列（例: `GENSHINGIFT`）
  * `game_biz`: ゲーム識別子（例: `hk4e_global`）
* **Headers**:
  * `Cookie`: 認証Cookie文字列
  * `User-Agent`: ブラウザ標準のUA
* **Response Status Code / Retcode**:
  * `0`: 成功（「交換に成功しました。ゲーム内メールをご確認ください」）
  * `-2017`: すでに交換済み（正常スキップ対象）
  * `-2001`: コードが無効または使用期限切れ
  * `-2016`: クールダウン中（短時間の連続リクエストによる拒否。約5秒以上の待機が必要）
  * `-1071` / `-100`: Cookie無効・未ログイン（再ログインが必要）

> **参考GitHubリポジトリ（APIリファレンス・仕様調査元）**:
> - [torikushiii/hoyoverse-api (GitHub)](https://github.com/torikushiii/hoyoverse-api) - 各種HoYoverseタイトルのコード交換・エンドポイント仕様
> - [thesadru/genshin.py (GitHub)](https://github.com/thesadru/genshin.py) - Takumi API / 認証仕様等の包括的リファレンス実装

---

## 3. 新着コード取得元（データソース設計）

自前でSNSをスクレイピングするサーバーを常時運用するコストを避けるため、オープンソースコミュニティが公開・保守している新着コードAPIを利用する。

### 3.1 主なデータソース候補
1. **[hoyo-codes API (GitHub: seriaati/hoyo-codes)](https://github.com/seriaati/hoyo-codes)**
   * 原神、スターレイル、ZZZの有効コードを自動検証付きで提供しているREST API。
   * エンドポイントからアクティブなコードリストをJSON形式で取得可能。
2. **[hoyoverse-api (GitHub: torikushiii/hoyoverse-api)](https://github.com/torikushiii/hoyoverse-api)**
   * 各種HoYoverseタイトルのシリアルコード・イベント情報を返すファンメイドAPI。

---

## 4. Chrome拡張機能（Manifest V3）アーキテクチャ設計

### 4.1 全体構造
拡張機能は以下の3つの主要コンポーネントで構成する。

```
[Popup UI] ── (Status / Manual Trigger) ──> [Background Service Worker]
                                                    │
                                      ┌─────────────┴─────────────┐
                                      ▼                           ▼
                           [chrome.cookies API]          [chrome.alarms API]
                           (HoYoverseセッション取得)        (定期バッチ実行)
                                      │                           │
                                      ▼                           ▼
                           [HoYoverse API]               [hoyo-codes API]
                           (アカウント取得 & 引き換え)       (新着コード取得)
                                      │
                                      ▼
                           [chrome.storage.local]
                           (処理済みコード履歴 / 設定保持)
                                      │
                                      ▼
                           [chrome.notifications API]
                           (デスクトップ通知)
```

### 4.2 `manifest.json` 要件
* `manifest_version`: 3
* `permissions`:
  * `"cookies"`: `.hoyoverse.com` からのセッションCookie取得
  * `"storage"`: 交換済みコード履歴、実行ログ、設定の保存
  * `"alarms"`: バックグラウンドでの定期実行タイマー
  * `"notifications"`: 交換完了時のデスクトップ通知
* `host_permissions`:
  * `"https://*.hoyoverse.com/*"`
  * `"https://*.hoyolab.com/*"`
  * `"https://*.seria.moe/*"` （または利用するコード配布APIのホスト）

### 4.3 実行シーケンスフロー
1. **タイマー起動**: `chrome.alarms` により定期（例: 2〜4時間毎、またはブラウザ起動時）に Service Worker が起動。
2. **認証状態確認**: `chrome.cookies.get` で `cookie_token` または `cookie_token_v2` の存在を確認。
   * 存在しない場合: 処理を中断（ポップアップに未ログイン警告を表示）。
3. **アカウント情報取得**: `getUserGameRolesByCookie` を叩き、ユーザーのメインUIDおよびサーバーを取得。
4. **コード取得**: 新着コードAPIにアクセスし、現在有効なコード一覧を取得。
5. **差分チェック**: `chrome.storage.local` から過去の交換履歴（`redeemed_codes`）を読み込み、未交換のコードのみをフィルタリング。
6. **順次引き換え実行**:
   * 未交換コードを1件ずつ交換エンドポイントへリクエスト。
   * **重要**: レート制限回避のため、リクエスト間に必ず **5秒のウェイト（Sleep）** を設ける。
7. **履歴更新 & 通知**:
   * 交換結果（成功・期限切れ・重複）をストレージに追記。
   * 成功したコードがある場合、`chrome.notifications.create` で「コード [XXXX] を自動引き換えしました」と通知。

---

## 5. 先行・類似ツールの比較と本ツールの差別化要因

| 区分 | ツール例 | 認証方式 | 自動化度 | 主な課題 / メリット |
| :--- | :--- | :--- | :--- | :--- |
| **先行拡張機能** | 旅人アシスタント | ブラウザCookie自動取得 | 半自動（手動操作主体） | デイリー確認等は優秀だが、コード引き換えはユーザーが右クリックや手動選択する必要がある。 |
| **先行拡張機能** | GenshCode | ブラウザCookie | 半自動（ボタン実行） | ギフトページ上で全コードを一括適用するUIボタン追加。定期完全自動ではない。 |
| **先行スクリプト** | hoyolab-auto / hoyo-redeem-codes | Cookie手動抽出（環境変数） | 完全自動（放置型） | バックグラウンドで全自動実行可能だが、一般ユーザーにとってF12からのCookie抽出・設定が極めて難関。 |
| **本設計ツール** | **本Chrome拡張機能** | **ブラウザCookie自動取得** | **完全自動（放置型）** | **「ログインするだけで設定完了」という手軽さと「完全放置での新着コード自動引換」を両立。** |

---

## 6. 実装における技術的制約・注意点・リスク対策

1. **レート制限（Cool-down）とブロック回避**:
   * 短時間に複数回APIを叩くと `retcode: -2016` が返るため、各リクエスト間に最低 5 秒のインターバルを設ける。
   * 1回に試行するコード数は未処理分のみに絞り、すでに無効判定されたコードは再試行しない。
2. **Cookieの有効期限とセッション切れ**:
   * Cookieが切れた場合（`retcode: -1071` / `-100`）、ポップアップに「HoYoverse公式サイトで再ログインしてください」と促すアラートとリンクを表示する。
3. **セキュリティとプライバシー**:
   * **Cookie情報は外部サーバーに一切送信せず、ローカルの拡張機能内のみで完結させる**こと。
   * コード取得API側へはGETリクエストのみ行い、ユーザーアカウント情報やCookieを一切渡さないこと。
4. **マルチタイトル対応の拡張性**:
   * 初回は原神（`hk4e_global`）をメインターゲットとしつつ、内部設計では `game_biz` やAPIエンドポイントを切り替えられる構造にしておくことで、崩壊：スターレイル（`hkrpg_global`）やゼンレスゾーンゼロ（`nap_global`）にも容易に拡張可能とする。

---

## 7. AI実装計画策定用プロンプト（指示テンプレート）

AIに具体的なコード実装やタスク分解を指示する際は、本ドキュメントを添付の上、以下のプロンプトを使用する。

```markdown
# 指示
添付の仕様書「HoYoverse 交換コード自動引き換え Chrome拡張機能 実装調査・仕様書」に基づき、
以下の成果物を含む具体的な「実装計画書」および「ソースコード一式」を作成してください。

## 要求成果物
1. プロジェクトのディレクトリ構成（Manifest V3準拠）
2. manifest.json の完全なコード
3. background.js（Service Worker: Cookie抽出、コードフェッチ、引き換え、レート制限制御、通知）
4. popup.html / popup.js / popup.css（ログインステータス確認、手動実行ボタン、交換履歴ログ表示UI）
5. 実装・ローカルテスト手順（Chromeのデベロッパーモードでの読み込み手順と検証方法）
```

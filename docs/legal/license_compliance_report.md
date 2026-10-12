# HoYoPass ライセンス & 法的適合性調査レポート (License Compliance Report)

**調査日**: 2026年10月12日  
**対象ソフトウェア**: HoYoPass（Chrome拡張機能 Manifest V3）  
**調査対象リポジトリ**: [zyanpoyo/HoYoPass](https://github.com/zyanpoyo/HoYoPass)  
**調査対象API**:
1. `hoyo-codes` API ([seriaati/hoyo-codes](https://github.com/seriaati/hoyo-codes) - GPL-3.0)
2. HoYoverse 内部Web API（Takumi API / WebExchangeCdkey API）

---

## 1. エグゼクティブサマリー

結論から申し上げますと、**本拡張機能（HoYoPass）の実装および外部APIの利用方法は、オープンソースライセンス（GPL-3.0等）および著作権法に違反していません。** また、本プロジェクト全体を **MIT License** の下で公開・頒布し続けることに法的な問題はありません。

主な調査結果の要約は以下の通りです：

| 調査項目 | 該当外部リソース / API | 判定 | 理由・根拠 |
| :--- | :--- | :---: | :--- |
| **GPLコピーレフト感染** | hoyo-codes API (`seriaati/hoyo-codes`) | 🟢 **安全（非感染）** | ネットワーク経由のREST API通信（HTTP GET）のみであり、派生物（Derivative Work）を構成しないため。 |
| **ソースコードの複写・翻案** | hoyo-codes API / 関連リポジトリ | 🟢 **問題なし（完全独自実装）** | Python等の外部コードは一切同梱・流用しておらず、JavaScriptでゼロから独自実装されているため。 |
| **返却データの著作権性** | 交換コード（シリアルコード）文字列 | 🟢 **問題なし（著作物非該当）** | ゲーム内交換コードは機械的識別子・事実情報であり、著作物性（創作性）が認められないため。 |
| **API提供元の利用許諾** | hoyo-codes.seria.moe | 🟢 **問題なし（正規利用）** | 提供元の公式READMEで外部からのAPI消費（consuming the API）が想定・容認されているため。 |
| **公式内部Web APIの利用** | HoYoverse Takumi / 交換API | 🟡 **適切な制御・リスク管理済** | ゼロトラスト認証・過負荷防止ディレイ（5.2秒）・非公式免責表記により安全に運用。 |
| **プロジェクト内依存関係** | npm / サードパーティパッケージ | 🟢 **依存ゼロ（完全自律）** | 外部npmライブラリへの依存が0件であり、ライセンス衝突の余地がないため。 |
| **商標・ゲーム画像アセット** | ゲームロゴ・タイトル・アイコン | 🟢 **適正表示（NOTICE完備）** | `NOTICE` および `README` にて権利帰属および非公式明記を徹底しているため。 |

---

## 2. hoyo-codes API (GPL-3.0) とのライセンス適合性詳細

### 2.1 提供元リポジトリのライセンス状況
- **リポジトリ**: `seriaati/hoyo-codes`
- **ライセンス**: **GNU General Public License v3.0 (GPL-3.0)**
- **アーキテクチャ**: Python (FastAPI / APScheduler / BeautifulSoup) で構築されたサーバーサイドAPI

### 2.2 GPL-3.0のコピーレフトはクライアント側に伝播（感染）するか？
**結論: 伝播しません。**

#### 法的およびFSF（Free Software Foundation）公式見解
GPL-3.0 のコピーレフト条項（派生物全体をGPLで公開しなければならない義務）は、ソフトウェアの「複製」「改変」「頒布（Conveying）」に対して適用されます。

1. **ネットワーク通信とConveyingの定義 (GPL-3.0 Section 0)**:
   > *"Mere interaction with a user through a computer network, with no transfer of a copy, is not conveying."*  
   > （コンピュータネットワークを通じた単なるユーザーとの対話・通信は、コピーの譲渡を伴わない限り「Conveying（譲渡・伝達）」には該当しない。）
2. **FSF公式FAQの解釈**:
   GPLライセンスされたサーバー（Webサーバー、DB、API）に対して、独立したクライアントプログラムが標準的なネットワークプロトコル（HTTP/REST/JSON）で通信を行う場合、クライアントはサーバーソフトウェアの「派生物（Derivative Work）」とはみなされません。両者は完全に独立した別個の著作物（Independent Work）として扱われます。
3. **AGPLとの差異**:
   ネットワーク経由の利用においてサーバー側のソースコード開示義務を課すのは **AGPL (Affero GPL)** ですが、`seriaati/hoyo-codes` は通常版の **GPL-3.0** です。さらに、仮にAGPLであったとしても、それは「AGPLサーバーを改変してWebホスティングした者」に対する義務であり、単にAPIを利用する第三者クライアントにコピーレフトを及ぼすものではありません。

### 2.3 ソースコードの探索結果（複写・混入の有無）
本拡張機能の `src/services/code-fetcher.js` を探索・精査しました：
```javascript
// src/services/code-fetcher.js
export async function fetchValidCodes(gameKey = 'GENSHIN') {
  const param = GAMES[gameKey]?.hoyoCodesParam || gameKey.toLowerCase();
  const url = `https://hoyo-codes.seria.moe/codes?game=${param}`;
  const response = await publicFetch(url);
  // レスポンスの検証と独自パース処理
  ...
}
```
- `seriaati/hoyo-codes` の Python ソースコードや正規表現定義、データベーススキーマ等は一切コピー・改変・移植されていません。
- 純粋なブラウザ標準 `fetch` による HTTP GET リクエストを発行し、受信した一般的な JSON 配列を標準 JavaScript で走査しているだけです。
- したがって、**著作権法上の複製権・翻案権の侵害、およびGPLのライセンス違反は一切存在しません。**

### 2.4 返却されるデータ（交換コード）の著作権性
- `hoyo-codes API` が返却するデータは、`"GENSHINGIFT"`、`"XTNDKTE2VSDX"` といった単なる英数字の文字列（プロモーションコード）です。
- これらは事実情報（またはゲームシステム上の機械的識別子）であり、人間の思想または感情を創作的に表現した「著作物」（著作権法第2条1項1号）には該当しません。
- したがって、コード文字列を取得・利用すること自体が著作権侵害になることはありません。

### 2.5 API提供元の利用方針・負荷への配慮
- `seriaati/hoyo-codes` の README には以下のように記載されています：
  > *"Besides an API, there is also a simple site for displaying all the available codes: https://hoyo-codes.seria.moe"*  
  > *"So, when consuming the API, you may want to add extra checks to handle redemption failures..."*
- API提供者自身が第三者によるAPIの利用（consuming the API）を前提かつ歓迎した設計となっています。
- 本拡張機能では以下の安全機構を設けており、提供元サーバーへの負荷も最小限に抑えられています：
  - **4時間周期の低頻度ポーリング**（1日最大6回程度）
  - **最大256KBのペイロード制限**
  - **最大50件の取得上限設定**
  - **`NOTICE` およびドキュメントにおけるクレジット表記**

---

## 3. HoYoverse 公式内部Web APIとの適合性

### 3.1 著作権法（オープンソースライセンス）の観点
- HoYoverse のロール照会API（Takumi API）およびコード引き換えAPI（WebExchangeCdkey API）は、HoYoverseのプロプライエタリなWebサービスエンドポイントです。
- APIのエンドポイントURL仕様やJSONスキーマそれ自体は「アイデア・規約・インターフェース」であり、著作権の保護対象外です（相互運用性の確保のためのAPI参照は適法と解釈されます）。
- したがって、「ライセンス違反」という事態は発生しません。

### 3.2 サービス利用規約（ToS）への配慮と安全設計
ゲーム運営会社（COGNOSPHERE / miHoYo）の利用規約（Terms of Service）との関係において、本拡張機能はアカウントリスクおよびサーバー過負荷リスクを回避するため、徹底した防護措置を実装しています：

1. **ゼロトラスト認証**:
   - ユーザーのパスワードや認証トークンを拡張機能が読み取ったり保存したりすることは一切ありません。
   - ブラウザ標準のセッション機構（`credentials: 'include'`）により、ユーザーが正規にブラウザでログインしている状態でのみリクエストが行われます。
2. **過負荷防止ディレイ（Inter-Request Delay）**:
   - 1つのコードを引き換えるごとに **5.2秒以上** のスリープを強制挿入し、公式サーバーに過度な負荷をかけません。
3. **自動バックオフ機能**:
   - APIから混雑やレートリミットが返却された場合、自動的に **30分間のバックオフ（待機）** に突入し、リクエストを完全停止します。
4. **非商用・オープンソース・明示的免責**:
   - 本拡張機能は非公式ファンツールであり、公式との関係性を否定する免責事項をすべてのUI、ドキュメント、`NOTICE` に明記しています。

---

## 4. プロジェクト全体の依存関係と MIT ライセンスの妥当性

本拡張機能の `package.json` および全ソースコードを確認しました：

```json
{
  "name": "hoyopass",
  "version": "1.0.0",
  "license": "MIT"
}
```

- **外部ランタイム依存（dependencies）**: **0件**
- **外部ビルド依存（devDependencies）**: **0件**
- Node.js 組み込みモジュール（`node:test`, `zlib`, `fs`）および Chrome WebExtensions 標準 API のみで動作しています。
- 外部のライブラリ（特に GPL/AGPL などのコピーレフトライセンスを持つライブラリ）を一切含んでいないため、**プロジェクト全体を MIT License として公開・配布することは完全に適法であり、一切のライセンス矛盾はありません。**

---

## 5. まとめと推奨アクション

本拡張機能は、ソフトウェアライセンス、著作権法、およびオープンソースコミュニティの慣例に照らして**極めてクリーンかつ安全な設計**となっています。

念のため、今後プロジェクトを運用・公開していく上でのベストプラクティスを以下にまとめます：

1. **APIクレジットの継続保持**:
   - `NOTICE` および `docs/design/architecture.md` に記載した `hoyo-codes` API のクレジット表記（[seriaati/hoyo-codes](https://github.com/seriaati/hoyo-codes)）を今後も保持すること（実施済）。
2. **非公式・免責表記の継続保持**:
   - HoYoverse公式との提携関係がないこと、および自己責任での利用であることを明記し続けること（実施済）。
3. **サーバー負荷への配慮の維持**:
   - 5.2秒のインターバルディレイや4時間のアラーム周期など、外部サーバーに負荷をかけないアルゴリズム設定を変更しないこと（実施済）。

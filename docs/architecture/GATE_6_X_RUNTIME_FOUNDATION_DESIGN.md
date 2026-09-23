# Phase 6.x-2: Universal Runtime Foundation 設計書
**POSTING MAP Universal 単独Runtime基盤構築設計（単独アプリ・単独リポジトリ・単独ドメイン原則）**

---

## 0. 最上位基本原則 (Supreme Principle)

> **POSTING MAP Universalは、単独アプリ・単独リポジトリ・単独ドメインで運用し、地域・支部・顧客の差異はデータとして扱う。アプリ、リポジトリ、Standalone GAS、Spreadsheet、Web App、ドメインを地域単位で複製しない。**

```text
                  POSTING MAP Universal
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
   単独アプリ          単独リポジトリ      単独ドメイン
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                 単独Standalone GAS
                           │
                 単独Universal Web App
                           │
               単独Universal Spreadsheet (Pure DB)
                           │
              ┌────────────┴────────────┐
              │                         │
         地域Aデータ               地域Bデータ
      (三重03・亀山等)           (新規顧客・自治体等)
```

### 絶対に採用しない構成（永久禁止事項）
- ❌ **地域ごとに別アプリ・別リポジトリ・別GAS・別Spreadsheet・別Web App・別ドメインを作成すること**
- ❌ **Staging用GAS / Production用GAS 等のようにUniversalアプリそのものを複数化・環境複製すること**
- ❌ **顧客ごと・支部ごとにコードベースをコピーすること**
- ❌ **KUWANA本番環境をコピー元・作成元・設定元として直接操作・参照すること**

---

## 1. Purpose (目的)

Phase 6.x-1 の全数資産監査により、Universal リポジトリ（`/Volumes/SSD_DATA/posting-map-universal/`）は特定地区のインフラ実体を持たないクリーンな原本エンジンとして維持されている一方、**稼働可能な Universal 専用の Standalone GAS、Web App、稼働用スプレッドシートが未接続（`UNSET`）** であることが確定した。

本設計書（Phase 6.x-2）の目的は、**上記最上位原則を完全に遵守し、KUWANA 本番環境を 100% 不可侵とした上で、公式空DBマスター（`POSTING_MAP_EMPTY_TEMPLATE`）を唯一の安全な複製元とし、Universal 唯一の Runtime Infrastructure を安全にプロビジョニング・接続するための完全な設計・手順・検証基準・ロールバック機構を確定すること** である。

> [!CAUTION]
> **【本Phaseの絶対制約】**
> Phase 6.x-2 は「設計・監査・文書化のみ」のフェーズである。
> 本書に記載されたプロビジョニング手順の実行、コード変更、GAS 作成、スプレッドシートのコピー、デプロイ、Git コミットおよびプッシュは**一切行わない**。

---

## 2. Confirmed Current State (Phase 6.x-1 確定事実)

```text
[Universal Repository 現況]
  ├── Universal Standalone GAS       : NONE (未作成)
  ├── Universal Web App URL          : NONE (未発行 / data/config.js: "")
  ├── Universal 稼働用 Spreadsheet   : NONE (未接続 / DEPLOYMENT_REGISTRY: UNSET)
  ├── .clasp.json                   : NONE (.clasp.json.template のみ実在)
  ├── deployment.json               : NONE (deployment.template.json のみ実在)
  └── POSTING_MAP_EMPTY_TEMPLATE     : FOUND (公式空DBマスター実在)
        ├─ Spreadsheet ID           : 1_fvgpNsK2fmz6hYgraDUnvyn69JnphmbgnXcOvzLYeY
        └─ Google Drive 格納先      : 01_MASTER/Templates (1Zt-AC153J0ByAwP9TkaUjimsgGVwDImF)
```
- **KUWANA 本番環境（`15Nr43ft...` / `AKfycbw69...` / `1mk346cj...`）**:
  探索対象からも完全除外され、変更ゼロ・完全無影響を維持。

---

## 3. Universal Single-App Architecture (単独Runtime論理構造)

```mermaid
graph TD
    subgraph Repo [Universal Repository (Local / Git)]
        R["/Volumes/SSD_DATA/posting-map-universal/<br>(GitHub: main)"]
        CL[".clasp.json (Local Only / Untracked)<br>scriptId: <Universal Script ID>"]
        DJ["deployment.json (Local Only / Untracked)<br>deploymentId: <Universal Deploy ID>"]
    end

    subgraph Client [Universal Frontends (Single Domain)]
        HA["Hアプリ (現場活動)<br>https://postingmap.jp/"]
        DB["Dashboard (観測・管理)<br>https://postingmap.jp/active/manager/"]
    end

    subgraph GAS [Universal Standalone GAS (Single Engine)]
        API["active/api/v2_api.js<br>(doPost / processPostAction)"]
        BIZ["active/business/gps/*<br>(GPSService / GPSRepository)"]
        LOG["active/infrastructure/logger/*<br>(StructuredLogger)"]
        SP["PropertiesService (Script Properties)<br>TARGET_SPREADSHEET_ID: <Universal SS ID><br>STORAGE_PARENT_ID: <Drive Folder ID><br>GOOGLE_MAPS_API_KEY: <Masked Key>"]

        API --> BIZ
        BIZ --> LOG
        API --> SP
    end

    subgraph Web [Universal Web App (Single Entrypoint)]
        DEP["Deployment ID: <Unique ID><br>execute-as: USER_DEPLOYING<br>access: ANYONE_ANONYMOUS"]
        URL["Universal Web App Endpoint<br>https://script.google.com/macros/s/<DeployID>/exec"]
        DEP --> URL
    end

    subgraph Storage [Universal Spreadsheet (Single Pure DB)]
        SS["POSTING_MAP_UNIVERSAL_DB<br>(Spreadsheet ID: <Unique ID>)<br>複製元: POSTING_MAP_EMPTY_TEMPLATE"]
        SYS["SYSTEM_INFO (保護台帳)<br>状態: ACTIVE"]
        REC["配布実績YYYY-MM<br>Q列: requestId (Durable Authority)"]
        MST["原本シート群 (名簿 / 保有チラシ / 受渡要請 / PinStatus)"]

        SS --- SYS
        SS --- REC
        SS --- MST
    end

    Client -->|HTTP POST| URL
    URL --> API
    R -->|clasp push| GAS
    GAS -->|clasp deploy| DEP
    BIZ -->|SpreadsheetApp (Pure DB)| SS
```

---

## 4. Spreadsheet Provisioning 設計

### 4-1. 唯一の Universal Runtime Spreadsheet の生成
- **複製元 (SSOT)**:
  `POSTING_MAP_EMPTY_TEMPLATE` (`1_fvgpNsK2fmz6hYgraDUnvyn69JnphmbgnXcOvzLYeY` / `01_MASTER/Templates`)
- **生成方式**:
  Google Drive API / Node.js 自動スクリプトにより複製。原本テンプレートは Read-Only で完全不可侵とし、完全バイナリ複製により 7シート構成、原本ヘッダー、数式、データ入力規則を 100% 保持する。
- **インスタンス名称**:
  `POSTING_MAP_UNIVERSAL_DB` (完全新規の独自 Spreadsheet ID を発行)
- **格納先フォルダ**:
  `01_MASTER/Templates` または Universal 専用 Google Drive フォルダ

### 4-2. スプレッドシート初期化 (`SYSTEM_INFO`)
既存仕様（[active/business/system/system_info_service.js:L258-270](file:///Volumes/SSD_DATA/posting-map-universal/active/business/system/system_info_service.js#L258-L270)）と 100% 整合した初期設定を実施。勝手な列追加や構造変更は一切行わない（Pure DB 原則）。

```text
[SYSTEM_INFO 初期化仕様]
項目 (A列)                 内容 (B列)
─────────────────────────────────────────────────────────────
地区コード                 UNIVERSAL
地区名                     POSTING MAP Universal
HアプリURL                 https://postingmap.jp/
Dashboard URL              https://postingmap.jp/active/manager/
LIFFアプリ名               POSTING MAP Universal
LIFF ID                    (空文字: プロビジョニング時に注入)
LIFF URL                   (空文字: プロビジョニング時に注入)
Endpoint URL               https://script.google.com/macros/s/<Deployment ID>/exec
Manager認証パスワード      <暗号学的に安全なランダム8桁PIN>
状態                       ACTIVE
契約終了日                 2099-12-31
```
- **機密情報の完全隔離**:
  `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_ID`, `GOOGLE_MAPS_API_KEY` はスプレッドシート（`SYSTEM_INFO`）には書き込まず、GAS `Script Properties` のみに格納する。

---

## 5. Standalone GAS Provisioning 設計

### 5-1. Universal 専用の唯一の Standalone GAS
- **作成方式**:
  `npx clasp create --type standalone --title "POSTING-MAP-UNIVERSAL" --rootDir active` による完全自動発行。
- **Script ID**:
  完全新規の一意 ID を発行（KUWANA 本番および特定地区と 100% 物理的・論理的に分離）。
- **rootDir**:
  `active`（[active/appsscript.json](file:///Volumes/SSD_DATA/posting-map-universal/active/appsscript.json) の V8 / STACKDRIVER / 5大 OAuth scope を完全継承）。
- **地域追加時の禁止事項**:
  地域（桑名、亀山、岡山等）が追加されても、GAS プロジェクトは**絶対に増やさない**。この単一の Universal Standalone GAS がすべての地域リクエストを処理する。

---

## 6. Web App & Domain 設計

### 6-1. 単独 Web App エンドポイント
- **Deployment**:
  `npx clasp deploy -d "POSTING MAP Universal Baseline"` により唯一の Deployment ID を取得。
- **更新原則**:
  URL 不変資産原則（[DEPLOYMENT_REGISTRY.md](file:///Volumes/SSD_DATA/posting-map-universal/DEPLOYMENT_REGISTRY.md)）に基づき、コード更新時は必ず同一 Deployment ID を `-i` で更新し、URL を変更しない。
- **execute-as / access**:
  `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`（API 内部で LINE Token による verified identity 強制）。

### 6-2. 単独ドメイン (Single Domain)
- **原則**: Universal POSTING MAP は `https://postingmap.jp/` の単独ドメインで稼働する。
- 地域ごとのサブドメイン（`kuwana.postingmap.jp` 等）への分離は行わず、単独ドメイン内で地域データを動的に切り替えて表示・運用する。

---

## 7. .clasp.json 設計

### 7-1. Git 非追跡の厳格維持（Purity 保証原則）
- **決定事項**: **`.clasp.json` は Git で管理しない（`.gitignore` 必須維持）**。
- **根拠**:
  Universal リポジトリは全地区の原本基盤（Universal Baseline）であり、特定の `scriptId` をコミットすると複製時に実体設定が残骸として混入する。
- [`.clasp.json.template`](file:///Volumes/SSD_DATA/posting-map-universal/.clasp.json.template) からローカル環境にのみ `.clasp.json` を生成する。

---

## 8. Runtime Configuration SSOT (単一情報源) 設計

設定値の散乱・手書き重複を防止するため、全設定の SSOT を以下のように一元化する：

| 設定項目 | SSOT (台帳) | 配備先 (実行時) | 同期・保護手段 |
|---|---|---|---|
| **Script ID** | `DEPLOYMENT_REGISTRY.md` | `.clasp.json` | テンプレートから自動注入 / Git 非追跡 |
| **Deployment ID** | `DEPLOYMENT_REGISTRY.md` | `deployment.json` | `scripts/safe-deploy.mjs` で固定更新 |
| **Web App URL** | `DEPLOYMENT_REGISTRY.md` | `data/config.js` (`gasWebAppUrl`) | `scripts/sync-deployment-config.mjs` |
| **Spreadsheet ID** | `DEPLOYMENT_REGISTRY.md` | GAS Script Properties (`TARGET_SPREADSHEET_ID`) | フロントエンドへは一切非公開 |
| **LIFF ID** | `DEPLOYMENT_REGISTRY.md` | `data/config.js` (`liffId`) | `scripts/sync-deployment-config.mjs` |

---

## 9. KUWANA 完全分離 (Isolation) 設計

### 9-1. 機械的隔離防衛（assertKuwanaIsolation）
プロビジョニング・デプロイスクリプトにおいて、以下の KUWANA 既知本番 ID との一致を検出した瞬間に即座に `process.exit(1)`（HARD STOP）させる：

```javascript
const KUWANA_BLACKLIST = {
  scriptId:      '15Nr43ftSF2vKgq-aX-NbkQrPijKaUIG-y1QwrVvEQfqwXcovT6Qg9mdx',
  deploymentId:  'AKfycbw69CcF7Ktb711lIYhmHSgR0iqTOuoGF_gElWsWcxJzZU3uR595me62t6lAgcUZAnFyOA',
  spreadsheetId: '1mk346cjH6JhrYeVKye6ZyfmHXaXpRFO-FJ1BGa0WQIw',
  driveFolderId: '1gd4JFqyiUQ5PAASUSY4Vx9fXeJeiBFwL',
  liffId:        '2010941735-x29F8IQ3'
};

function assertKuwanaIsolation(candidate) {
  for (const [key, kuwanaId] of Object.entries(KUWANA_BLACKLIST)) {
    if (candidate[key] && candidate[key].trim() === kuwanaId) {
      throw new Error(`🛑 [HARD STOP] KUWANA Isolation Breach Detected! Candidate ${key} matches KUWANA production!`);
    }
  }
}
```

---

## 10. Regional Data Model Boundary (単独アプリとしてのデータ設計)

「地域差はデータで吸収する」原則を具現化するデータ構造：

```text
[Universal Engine] (不変・共通)
       │
       ├── data/address_master.csv        ── e-Stat 小地域 (KEY_CODE) 単位の住所マスター
       ├── data/boundaries.geojson        ── 境界幾何データ (city_name, town_name, rowId)
       ├── data/municipality_master.csv   ── 対象自治体マスター
       └── data/area_mapping.json         ── 地域・ブロック対応表
       │
[Spreadsheet Pure DB] (不変・共通スキーマ)
       ├── 配布実績YYYY-MM                 ── 行データ内に rowId, areaName, staffId, branchCode
       ├── 名簿                            ── 所属支部、活動地域をデータ列として保持
       └── SYSTEM_INFO                    ── システム共通稼働パラメータ
```
- 新規地域（岡山、亀山、新規顧客）を追加する際は、`data/` 配下のファイルおよびスプレッドシートの行レコードとして追加するのみであり、**GAS やリポジトリを複製することは恒久的に禁止**とする。

---

## 11. 単独アプリと検証環境の区別 (Quality & Verification Strategy)

「単独アプリ」を維持したまま、システムの安全性と品質を検証するための多層テスト戦略：

1. **Layer 1: ローカル自動テスト (`tests/`)**:
   - Node.js テストランナーによるビジネスロジック、データ整合性、認証境界の単体検証。
2. **Layer 2: ヘッドレスブラウザ E2E テスト (Playwright)**:
   - モックサーバーを用いた H アプリ・Dashboard の画面描画、地図描画、オフラインキュー動作検証。
3. **Layer 3: Standalone GAS 実機疎通テスト (`scripts/verify-gas-deployment.mjs`)**:
   - 唯一の Universal Standalone GAS に対し、HTTP GET / POST でヘルスチェックおよび API 動作を実測。
4. **Layer 4: 実機・実デバイス検証**:
   - LINE LIFF およびスマートフォン実機での結合動作確認。

> **検証のために Universal アプリや GAS を複製（Staging 用 POSTING MAP 等）することは厳禁とする。**

---

## 12. Runtime ↔ Repository 対応表

| Layer | Universal 唯一の実体 | Target ID / Key | Source / Origin | Verification Gate |
|---|---|---|---|---|
| **Application** | `POSTING MAP Universal` | 単独アプリ | `active/` | Browser E2E |
| **Repository** | `posting-map-universal` | GitHub `main` (`2cb4db0...`) | SSD_DATA | `git status --short` (Clean) |
| **GAS** | Universal Standalone GAS | `<Universal Script ID>` | `clasp create` | `clasp status` (Diff: 0) |
| **Spreadsheet** | Universal Runtime DB | `<Universal SS ID>` | `POSTING_MAP_EMPTY_TEMPLATE` 複製 | `SYSTEM_INFO: ACTIVE` |
| **Deployment** | Universal Deployment | `<Universal Deployment ID>` | `clasp deploy` | `npx clasp deployments` |
| **Web App** | Universal Web App | `https://script.google.com/macros/s/<ID>/exec` | Standalone GAS | `npm run verify:gas` (HTTP 200) |
| **Domain** | Universal Domain | `https://postingmap.jp/` | 単独ドメイン | HTTPS / SSL 疎通 |

---

## 13. Provisioning Procedure (実行手順案 P-01 〜 P-18)

> [!NOTE]
> 以下の手順は実行計画案であり、MASTER の承認後に実行される。

```text
[P-01] 公式空DBマスター確認: POSTING_MAP_EMPTY_TEMPLATE (1_fvgpNsK2fmz6hYgraDUnvyn69JnphmbgnXcOvzLYeY) の存在確認
[P-02] Universal Spreadsheet 生成: 原本から「POSTING_MAP_UNIVERSAL_DB」を安全複製 (assertKuwanaIsolation)
[P-03] Spreadsheet 構造検証: 7シート構成、原本ヘッダー完全性の客観的確認
[P-04] Universal Standalone GAS 取得: npx clasp create --type standalone --title "POSTING-MAP-UNIVERSAL" --rootDir active
[P-05] Script ID 確定: 発行された Script ID の KUWANA Blacklist 照合
[P-06] Repository ↔ GAS 接続: .clasp.json.template からローカル .clasp.json を生成し Script ID 設定 (Git除外確認)
[P-07] Spreadsheet 接続: GAS Script Properties に TARGET_SPREADSHEET_ID を設定
[P-08] Script Properties 設定: GOOGLE_MAPS_API_KEY, LINE設定を Script Properties へ投入
[P-09] clasp status: active/ 配下のファイルが正常に同期対象として認識されていることを確認
[P-10] Universal GAS へ初回反映: npx clasp push によるコード同期
[P-11] Universal Deployment 作成: npx clasp deploy -d "POSTING MAP Universal Baseline" を実行
[P-12] Web App URL 確定: 発行された Web App URL を deployment.json に記録 (Local Untracked)
[P-13] Runtime configuration 確定: npm run sync:config を実行し data/config.js を同期
[P-14] HTTP 疎通確認: GET / POST で Web App エンドポイントの HTTP 200 を確認 (npm run verify:gas)
[P-15] API → Spreadsheet 確認: POST action: 'getSystemSummary' による SYSTEM_INFO 読み取り導通確認
[P-16] H App → API → GAS → Spreadsheet 確認: Hアプリからの配布完了・GPS同期疎通確認
[P-17] Dashboard → API 確認: Dashboard からの進捗・ピンステータス読み取り導通確認
[P-18] 単独Runtime 成立確認: DEPLOYMENT_REGISTRY.md に UNIVERSAL_BASE を確定登録
```

---

## 14. Verification (判定基準)
- **Git**: ワーキングツリーがクリーンであり、`.clasp.json` / `deployment.json` が Git 追跡されていないこと
- **clasp**: `npx clasp status` が差分 0 で成功すること
- **GAS**: 単一の Script ID が確立され、V8 および 5大 OAuth scope が適用されていること
- **Deployment**: 固定 Deployment ID が発行され、Web App URL が取得できていること
- **Spreadsheet**: 7シート構成、原本ヘッダー完全性、`SYSTEM_INFO: ACTIVE` が確認できること
- **HTTP / API**: `verify:gas` で HTTP 200、`getSystemSummary` 成功、未認証業務 API が遮断されること

---

## 15. Rollback 設計
- **Spreadsheet 失敗時**: 作成途中のスプレッドシートをゴミ箱へ退避 (`setTrashed(true)`)。原本 `POSTING_MAP_EMPTY_TEMPLATE` は読み取りのみのため無傷。
- **GAS プロジェクト失敗時**: Google Drive 上の空 GAS プロジェクトを削除し、ローカルの `.clasp.json` を破棄。
- **Deployment 失敗時**: `npx clasp undeploy <ID>` で Deployment を取り消し。
- **設定同期失敗時**: `deployment.json` および `.clasp.json` を破棄し、`data/config.js` を空テンプレート状態へ巻き戻し。
- **スプレッドシート復元ルール**: 版の履歴からの全体一括復元は**永久禁止**。再複製または Surgical Repair で対処。

---

## 16. Risks & Mitigation
1. **Drive API / clasp 認証権限エラー**:
   - サンドボックス環境下での認証情報アクセス（`~/.clasprc.json`）の許可を確認して対処する。
2. **GAS バージョンクォータ消費**:
   - `scripts/safe-deploy.mjs` のバージョン監視（上限200）を適用し、同一 Deployment ID への `-i` 更新を徹底する。

---

## 17. Open Questions
- [ ] OQ-01: Universal スプレッドシート複製時の Google Drive 親フォルダの指定先確認（`01_MASTER/Templates` または Universal 専用フォルダ）。
- [ ] OQ-02: Universal 稼働用の Google Maps API キーおよび LINE チャネル情報の準備状況確認。

---

## 18. Gate 7 Entry Criteria (Gate 7 着手基準)
以下の条件がすべて満たされた場合に限り、Gate 7 への着手を許可する：
- [ ] 本設計書（`GATE_6_X_RUNTIME_FOUNDATION_DESIGN.md`）に対する MASTER の承認受領。
- [ ] KUWANA 本番に対する一切の変更・接触がないことの再確認。
- [ ] リポジトリのワーキングツリーが clean であること。
- [ ] 手順 P-01 〜 P-18 の実行許可の受領。

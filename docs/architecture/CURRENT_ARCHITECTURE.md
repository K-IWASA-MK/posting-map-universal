# POSTING MAP — 現行アーキテクチャ定義書
*(Current Architecture Specification)*

本書は、POSTING MAPの現行アーキテクチャを定義する技術定義書である。
最上位の設計契約・憲法として **[01_DESIGN_CONTRACT.md](01_DESIGN_CONTRACT.md)** が存在し、本書はその下位において現行システムの構造を定義する。

---

## 1. 最上位原則 (Supreme Principles)

### ① 単独アプリ・単独リポジトリ・単独ドメイン (Single App, Repository & Domain)
- POSTING MAPは、単独アプリ・単独リポジトリ・単独ドメインを共通基盤とする **Universal Engine** である。
- 地域ごとに別アプリ・別リポジトリ・別ドメインを作成・複製する設計は採用しない。
- 地域間の差異（所属支部・活動対象地域・マスターデータ等）は、すべて **「データ」** として分離・吸収する。

### ② 共通エンジンとデータ層の完全分離 (Universal Engine vs. Master Data)
- **`active/` = 汎用 Universal Engine**
  - 全地域で100%同一の実行プログラム（JavaScript / HTML / CSS / Standalone GAS）。
  - 地域固有のコード改変・条件分岐の混入を永久に禁止する。
- **`data/` = 地域データ & クライアント設定 (Regional Data & Config)**
  - 住所マスター、境界GeoJSON、自治体定義、クライアント接続情報が集約されるデータ領域。

### ③ 活動関係とIdentityの正規導出
- 活動関係モデル: `LINE User ID (verified) → 本人 (Staff Identity) → 所属支部 (Branch) → 支部の活動対象地域`
- クライアントが送信する `staffId` や `branchId` を権限根拠として信用しない（サーバー側で安全に解決）。
- 党員個人への固定担当エリア割り当ては存在しない。活動実績から個人ランキングを生成・可視化する。

### ④ 【Legacy / Historical】旧第1世代アーキテクチャ（地区物理複製モデル）の廃止
- *※旧モデル記録: かつて採用されていた「1地区 = 1独立リポジトリ = 1独立アプリケーション（物理COPY → data/交換）」は、コードベースの肥大化と管理負債を招くため、第2世代（Universal Engine）において完全に廃止された。新地域への展開においてリポジトリを物理複製してはならない。*

---

## 2. システム構成と責務境界 (System Architecture)

```text
┌──────────────────────────────────────────────────────────────────┐
│                     POSTING MAP 独立インスタンス                  │
│                                                                  │
│  ┌────────────────────────┐          ┌────────────────────────┐  │
│  │   Hアプリ (配布員UI)    │          │  Dashboard (管理者UI)  │  │
│  │  active/dashboard/     │          │  active/manager/       │  │
│  └───────────┬────────────┘          └───────────┬────────────┘  │
│              │ (静的読込)                         │ (静的読込)     │
│              ▼                                   ▼               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     data/ (地区固有領域)                    │  │
│  │  ・address_master.csv      ・boundaries.geojson            │  │
│  │  ・municipality_master.csv  ・config.js                     │  │
│  │  ・area_mapping.json                                       │  │
│  └───────────────────────────┬────────────────────────────────┘  │
│                              │ API通信 (POST / JSON)             │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │           Standalone Google Apps Script (APIサーバー)       │  │
│  │  active/api/ , active/business/                             │  │
│  │  ※ Script Properties から接続情報を動的解決                  │  │
│  └───────────────────────────┬────────────────────────────────┘  │
│                              │ Sheets API                        │
│                              ▼                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼ 外部独立クラウド
              ┌──────────────────────────────────┐
              │     Google Spreadsheet (Pure DB) │
              │     ※ 12シート / コード内包ゼロ    │
              └──────────────────────────────────┘
```

### 1. Hアプリ (配布員用モバイルUI: `active/dashboard/`)
- LINE LIFF または スマートフォンWebブラウザ上で動作するポスティング配布員専用のUI。
- 地区の町丁目ピン、境界ポリゴン、配布進捗ステータスを `data/` および GAS API から動的取得して描画。
- 接続情報は `data/config.js` を唯一の参照先とし、コード内にURL等のハードコードを持たない。

### 2. Dashboard (統括管理者用UI: `active/manager/`)
- PC/タブレット向けの進捗管理・チラシ在庫・配布員名簿・受渡要請の統括管理画面。
- `data/address_master.csv`、`data/municipality_master.csv`、`data/boundaries.geojson` を動的解析して表示。
- 接続情報は `data/config.js` を唯一の参照先とする。

### 3. API (共通バックエンドロジック: `active/api/`, `active/business/`)
- Standalone GAS 上で稼働する共通REST/RPC風APIサーバー。
- 認証、進捗集計、受渡要請、在庫管理、名簿管理を実行し、Spreadsheet（Pure DB）へアクセス。

### 4. Spreadsheet = Pure DB (純粋データベース)
- スプレッドシートは **「純粋なデータベース（データ層）」** としてのみ存在する。
- プログラムコード（スクリプト）、独自マクロ、トリガー関数は一切内包しない。
- 12シート構造（`SYSTEM_INFO`, 原本シート群5種, YYYY-MMシート群5種, `ポスティング進捗状況`）。

### 5. GAS = Standalone only (独立APIサーバー)
- Google Apps Script はスプレッドシートから完全に切り離された **「スタンドアロンプロジェクト」** として作成・配備する。
- 接続先スプレッドシートIDやDriveフォルダIDは、デプロイ時に `PropertiesService.getScriptProperties()` へ外部注入する（ハードコード禁止）。

### 6. Container-bound GAS = 現行アーキテクチャ外 (廃止・絶対禁止)
- スプレッドシートに付随するコンテナバウンドGAS（拡張機能 → Apps Script）は、現行アーキテクチャ外のレガシー残骸である。
- コンテナバウンドGASの作成、復元、同期、依存、編集は永久に禁止する。

### 7. 認証 / LINE LIFF (`active/api/auth/`)
- Hアプリは LINE LIFF ID Token による本人確認・セッション管理。
- 管理者画面はセッション認証（パスワード / トークン）。

---

## 3. 地区データの境界 (data/ 仕様)

新地区展開時に交換・初期化するファイルは、原則として以下の **`data/` 配下5ファイル** に集約される：

| ファイルパス | 役割 | 新地区展開時の扱い |
|---|---|---|
| `data/address_master.csv` | 町丁目・座標データ（SSOT） | 新地区の国勢調査町丁目データで**全数交換** |
| `data/boundaries.geojson` | 町丁目境界GeoJSON（MultiPolygon対応） | 新地区のGeoJSONで**全数交換** |
| `data/municipality_master.csv` | 地区を構成する自治体一覧 | 新地区の自治体一覧で**全数交換** |
| `data/config.js` | クライアント公開設定 (`gasWebAppUrl`, `liffId`) | 汎用時は空テンプレート、新地区デプロイ時に**同期・生成** |
| `data/area_mapping.json` | 過去エリアからの集約マッピング | 新地区立ち上げ時は **空配列 `[]` に初期化** |
| `data/storage_locations.json` | 保管場所候補マスター（小選挙区構成自治体） | 開催地から小選挙区データに基づき**機械的導出・配備** |

> **注記（外部データ生成ツールについて）**:  
> 国勢調査データ（e-Stat Shapefile）から上記マスターを生成するETLツールは、実行エンジン（`active/`）に含めず、データ調達用の独立ツール（`scripts/` 等）として分離管理する。

### 地区固有データの正式移行完了 (`data/election_history.json`)

衆院選・参院選投票率データ（`election_history.json`）の配置・参照方式については、Target Districtホワイトリスト方式の確立に伴い、以下の通り正式移行が完了した：

1. **地区固有データとしての一元化**:
   - `election_history.json` は地区固有データであるため、`docs/` から `data/election_history.json` へ正式移行完了。
2. **Universal Engineにおける動的パス解決への統一**:
   - `active/manager/manager.js` における旧レガシーパス直書き（`/docs/`）を廃止。
   - `data/config.js` の `staticMaster.electionHistoryFilename` および `fetchStaticDataFile` を用いた動的解決方式に統一された。
3. **データ層品質ゲート（Rule-06）での全数監査**:
   - `validate-district-data-gate.mjs` のホワイトリスト監査対象に `election_history.json` を追加。
   - 自治体キー（`municipalities`）が `data/municipality_master.csv`（SSOT）と100%一致することが機械判定される。

### 保管場所候補マスター（`data/storage_locations.json`）の責務と動的連携

Hアプリの「保有チラシ」機能において、チラシ保管場所（市町村名）を選択・登録・共有するためのマスターデータであり、以下のアーキテクチャ境界を持つ：

1. **`address_master.csv` との責務分離（完全独立）**:
   - `address_master.csv`: ポスティング配布対象エリアそのものの確定SSOT（単一自治体または対象選挙区の確定町丁）。
   - `storage_locations.json`: ポスティングスタッフの活動拠点・保管拠点候補マスター。選挙開催地が属する**衆議院小選挙区の全構成市町村**を公式データから機械的に導出して定義（周辺自治体を含む）。両者は目的・粒度・範囲が完全に異なる独立責務である。
2. **Hアプリによるオンデマンド遅延取得（Zero Startup Lag）**:
   - 起動処理、`loadData()`、地図描画、LIFF初期化には一切接続せず、ユーザーが「保有チラシ登録画面」を開いた瞬間のみ非同期オンデマンドフェッチされる。初期起動性能への影響は 0ms を維持する。
3. **Spreadsheet が保有チラシデータの唯一の正本**:
   - Hアプリから登録されたデータは、GAS API（`registerFlyerStock`）を経由してスプレッドシート（「保有チラシ枚数の原本」シート等）の `location` 列に直接保存される。
4. **他端末Hアプリおよび Manager Dashboard での正本表示**:
   - **他端末Hアプリ**: `render.js` がスプレッドシートの最新データを取得し、`location` ごとに動的グループを自動生成して在庫状況を表示。
   - **Manager Dashboard**: `manager.js` がスプレッドシートの `location` をそのまま動的エスケープ表示。
   - Universal Engine（`active/`）側への自治体名ハードコードは一切行わず、地区データとスプレッドシート正本のみで表示・共有が成立する。

---

## 4. 外部リソースとデプロイメントメタデータ

### 1. 外部独立リソース (External Resources)
Universal POSTING MAP は以下の外部クラウドインフラと連携する：
1. **Googleスプレッドシート**: Pure DB（スクリプト内包なし・トリガー依存なし）。
2. **Google Driveフォルダ**: 写真・添付データ等の保管フォルダ。
3. **LINE Developers**: LIFF アプリおよび本人性確認。
4. **Standalone GAS プロジェクト**: APIサーバーとして独立配備。

### 2. Deployment Metadata (`deployment.json`)
- インフラ接続の物理ID（`scriptId`, `deploymentId`, `webAppUrl`, `spreadsheetId`, `storageFolderId`, `productionLiffUrl`）を保持するローカル設定ファイル（Git追跡除外）。
- テンプレート `deployment.template.json` のみがリポジトリに保持される。

---

## 5. Universal アーキテクチャの不可侵原則 (Universal Architecture Invariants)

Universal POSTING MAP の運用・開発において、以下の原則はいかなる例外もなく遵守されなければならない：

1. **`active/` ゼロ改変原則**:  
   地域展開や機能追加において、地域固有のハードコードや分岐を `active/` 内に混入させてはならない。
2. **コード複製禁止原則**:
   地域展開のためにリポジトリの複製、ブランチ分岐、アプリの物理複製を行ってはならない。地域差はすべてデータ層で吸収する。
3. **リポジトリ境界絶対遵守原則**:
   作業中のリポジトリ以外を参照・探索・比較しない。他地区のコードやデータを推測で流用しない。
4. **【Legacy / Historical】旧新地区展開パイプラインの扱い**:
   *旧複製スクリプト群（`district-deployment/workflow.md`, `check-pre-copy-purity.mjs` 等）は、第1世代（物理コピー方式）の過去遺産（DEPRECATED）であり、Universal POSTING MAP の通常運用・開発パイプラインからは切り離されている。*

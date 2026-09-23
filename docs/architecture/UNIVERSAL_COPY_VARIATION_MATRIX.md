# Universal Copy Variation Matrix (確定版)
**汎用POSTING MAP量産構造・コピー先固有変更点完全抽出マトリクス**
**【公式空テンプレート POSTING_MAP_EMPTY_TEMPLATE 方式 準拠】**

---

## 0. Document Metadata
- **Document ID**: `UNIVERSAL_COPY_VARIATION_MATRIX`
- **Version**: `2.0.0 (Audited Final)`
- **Status**: `OFFICIAL SSOT / FINALIZED`
- **Database Model**: `POSTING_MAP_EMPTY_TEMPLATE` 方式（全原本0件・7シート空マスター複製モデル）
- **Deprecated Architecture**: 旧方式（既存地区本番DBの複製・初期化）は歴史的廃止済みとし、Universal 現行仕様から完全除外

---

## 1. 最上位原則と量産3層モデル

POSTING MAP Universal は、以下の 3層構造によって複製・量産される：

```text
[Universal 原本リポジトリ]
        │
        ├── ① 共通エンジン (Immutable Core) ────────────────── 変更 0 行 (100% 共通利用)
        │     - active/ 配下の全コード (フロントエンド・共通API・業務ロジック)
        │     - index.html, assets/, package.json, テンプレート群
        │
        ├── ② 地区データセット (data/ Replacement) ────────── 新地区データへ全数交換
        │     - address_master.csv, boundaries.geojson, municipality_master.csv
        │     - storage_locations.json, election_history.json, area_mapping.json
        │
        └── ③ コピー先固有設定・インフラ実体 (Instance Specifics) ─ 新規発行・注入 (自動化)
              - deployment.json (.clasp.json)
              - data/config.js (npm run sync:config による自動同期)
              - POSTING_MAP_EMPTY_TEMPLATE からの新規スプレッドシート複製
              - 新規 Standalone GAS / Drive フォルダ / LIFF アプリ
```

---

## 2. ① 共通エンジンとして変更不要なもの (Immutable Core: 45 ファイル)

実コード全数走査の結果、`active/` 配下に特定地区名・特定ID等のハードコードは**ゼロ件**であり、1行も変更せずそのまま複製して稼働する：

| 対象領域 | 主な構成ファイル | 役割 | 変更要否 |
|---|---|---|---|
| **Hアプリ フロントエンド** | `active/dashboard/app.js`<br>`active/dashboard/db.js`<br>`active/dashboard/map.js`<br>`active/dashboard/auth.js`<br>`active/dashboard/index.html` | 現場ポスティングUI、Leaflet地図描画、GPS測位、IndexedDBオフライン同期キュー、完了提出処理 | **不要 (0行)** |
| **Dashboard / コックピット** | `active/manager/` 配下全般 | 全体進捗管理、ピンステータス観測、集計画面 | **不要 (0行)** |
| **Universal API エンドポイント** | `active/api/v2_api.js` | 全POST/GETリクエスト受付、LINE Token 認証、Backend Identity 強制解決、ルーティング | **不要 (0行)** |
| **業務ロジック層** | `active/business/gps/*`<br>`active/business/system/*`<br>`active/business/roster/*`<br>`active/business/stock/*`<br>`active/business/bulletin/*` | GPS/写真保存統括、排他制御、スプレッドシート Pure DB 読書、名簿、在庫、掲示板 | **不要 (0行)** |
| **GAS Runtime OS 基盤** | `active/gas/v2_config.js`<br>`active/gas/sheet_guard.js`<br>`active/gas/v2_deployment_foundation.js` 等 | GAS実行時プロパティ取得、シート保護、システムエラー防衛 | **不要 (0行)** |
| **GAS マニフェスト** | `active/appsscript.json` | V8ランタイム、STACKDRIVER例外ログ、5大 OAuth scopes | **不要 (0行)** |
| **静的エントリー・共通設定** | `index.html`<br>`assets/richmenu_default.png`<br>`package.json`, `package-lock.json`<br>`.claspignore`<br>`.clasp.json.template`<br>`deployment.template.json`<br>`.env.example` | Webエントリーポイント、共通依存パッケージ、設定テンプレート群 | **不要 (0行)** |
| **共通デプロイ・検証スクリプト** | `scripts/safe-deploy.mjs`<br>`scripts/sync-deployment-config.mjs`<br>`scripts/validate-gas-endpoint-ssot.mjs`<br>`scripts/verify-gas-deployment.mjs`<br>`scripts/check-scope.mjs`<br>`scripts/generate-boundaries-geojson.py` | バージョン監視安全デプロイ、SSOT設定同期、検証ゲート群 | **不要 (0行)** |

---

## 3. ② data/ として地区ごとに差し替えるもの (District Data: 6 ファイル)

新地区の地理・統計・行政界データセットとして丸ごと差し替えるファイル群：

| ファイル名 | データ内容 | 取得元 / 生成方法 | 役割 |
|---|---|---|---|
| **`data/address_master.csv`** | 全町丁目・小地域住所マスター | e-Stat 統計および自治体公式 | 配布先町丁目の全件マスター（`rowId` 連番、人口世帯数） |
| **`data/boundaries.geojson`** | 全小地域ポリゴン幾何データ | `generate-boundaries-geojson.py` | 地図上の町丁目ポリゴン描画 |
| **`data/municipality_master.csv`** | 対象自治体一覧 | 自治体公式コード表 | 市区町村名、コード、町丁数 |
| **`data/storage_locations.json`** | 保管場所候補自治体リスト | 衆院小選挙区画定公定データ | 保有チラシ枚数登録時の拠点候補リスト |
| **`data/election_history.json`** | 過去3回選挙結果データ | 選挙管理委員会確定データ | 投票率・得票傾向分析 |
| **`data/area_mapping.json`** | エリアマッピング | 運用初期時は `[]` (空配列) | 町丁目のブロック割り・グループ化 |

---

## 4. ③ POSTING_MAP_EMPTY_TEMPLATE から新規Runtimeを生成する際にコピー先固有として設定・変更が必要なもの

公式空DBマスター `POSTING_MAP_EMPTY_TEMPLATE`（ID: `1_fvgpNsK2fmz6hYgraDUnvyn69JnphmbgnXcOvzLYeY`）を複製元として新規Runtimeを確立する際、**コピー先固有の実体として発行・設定が必要な全要素**：

### 4-1. 最終コピー差分マトリクス

| ID | 対象リソース | ファイル / 場所 | 変更前 (原本) | 変更後 (新コピー先) | なぜ変更が必要か | 必須 | 自動化可否 |
|---|---|---|---|---|---|---|---|
| **SPEC-01** | **専用スプレッドシート** | Google Drive / Spreadsheet | 公式空原本 `POSTING_MAP_EMPTY_TEMPLATE` | 新規複製スプレッドシート (`POSTING_MAP_<DISTRICT>`) | 新地区専用の独立した Pure DB（全原本0件・データ完全分離）を確立するため | **必須** | ✅ **完全自動**<br>(Drive API makeCopy) |
| **SPEC-02** | **スプレッドシート台帳** | スプレッドシート内 `SYSTEM_INFO` | 地区コード: `EMPTY`<br>状態: `EMPTY` | 地区コード: `<DISTRICT>`<br>状態: `ACTIVE`<br>URL: 新地区URL群 | スプレッドシート自身が自らの所属地区・Endpoint URL・Manager認証PINを保持するため | **必須** | ✅ **完全自動**<br>(プロビジョニング時) |
| **SPEC-03** | **専用 Standalone GAS** | Google Apps Script プロジェクト | 未作成 | 新規 Standalone GAS プロジェクト | 新地区専用の独立したバックエンド実行エンジン（クォータ・権限分離）を確立するため | **必須** | ✅ **完全自動**<br>(`npx clasp create`) |
| **SPEC-04** | **GAS 接続プロパティ** | GAS `Script Properties` | 未設定 | `TARGET_SPREADSHEET_ID: <新SS ID>`<br>`STORAGE_PARENT_ID: <新Folder ID>` | Standalone GAS が新スプレッドシートおよび新写真保存フォルダとバインドするため | **必須** | ✅ **完全自動**<br>(API経由注入) |
| **SPEC-05** | **clasp 接続設定** | `.clasp.json`<br>(ローカル生成) | 未存在 (`.clasp.json.template`) | `{"scriptId": "<新Script ID>", "rootDir": "active", ...}` | ローカルリポジトリと新 Standalone GAS を push/deploy 接続するため (Git非追跡) | **必須** | ✅ **完全自動**<br>(`clasp create`時) |
| **SPEC-06** | **Deployment 定義** | `deployment.json`<br>(ローカル生成) | 未存在 (`deployment.template.json`) | 新規発行された ID 群を記録した JSON (Git非追跡) | 新地区インフラ実体群のローカル SSOT 台帳を固定するため | **必須** | ✅ **完全自動**<br>(CLI発行時) |
| **SPEC-07** | **フロントエンド設定** | `data/config.js` | `gasWebAppUrl: ""` `liffId: ""` | 新地区の WebApp URL & LIFF ID | Hアプリが通信する新地区エンドポイントおよび起動用 LIFF ID を固定するため | **必須** | ✅ **完全自動**<br>(`npm run sync:config`) |
| **SPEC-08** | **写真保存 Drive フォルダ** | Google Drive フォルダ | 未作成 | `<DISTRICT>_PHOTOS` フォルダ | 現場配布写真の格納先バケットを新地区専用に分離・保全するため | **必須** | ✅ **完全自動**<br>(Drive API作成) |
| **SPEC-09** | **デプロイ台帳** | `DEPLOYMENT_REGISTRY.md` | `UNIVERSAL_BASE \| UNSET` | 新地区名、Script ID、Deploy ID、URL | システム資産台帳（SSOT）へ新地区の本番接続情報を永久記録するため | **必須** | ⚠️ 手動確認推奨<br>(スクリプト追記可) |
| **SPEC-10** | **LINE LIFF アプリ** | LINE Developers Console | 未登録 | 新地区用 LIFF ID (`2010941735-xxxxxxxx`) | LINE トーク画面内で新地区の Hアプリを個別起動・認証するため | **必須** | ⚠️ 一部手動/API<br>(LINE APIで自動可) |
| **SPEC-11** | **共通機密キー** | GAS `Script Properties` / `.env` | 未設定 (`.env.example`) | `GOOGLE_MAPS_API_KEY`<br>`LINE_CHANNEL_ACCESS_TOKEN` | 外部サービス（Google Maps / LINE Messaging）と安全に接続するため | **必須** | ✅ **自動化可能**<br>(共通キー注入) |

---

## 5. active/（Runtimeコード）と scripts/（補助ツール）の分離検証

### 5-1. active/ 配下の検証結果
- **判定**: **地区固有変更は厳密に「不要 (0件)」**
  - 全 28 ファイルにわたり、地域固有の分岐・ハードコードは一切存在しない。
  - すべての接続先・地域情報は `data/config.js`、`PropertiesService.getScriptProperties()`、スプレッドシート `SYSTEM_INFO` から実行時に動的解決される。

### 5-2. scripts/ 等の補助ツールに残る地区固有ハードコード（Runtime外）
Runtime の実行には影響しないが、運用・補助スクリプト内に残存している地区依存箇所：

| 対象スクリプト | 該当箇所 / 内容 | なぜ残存しているか | コピー先での影響・処置 |
|---|---|---|---|
| **`scripts/sort-address-master.py`** | L21-L75: `POSTAL_KANA_KUWANA`<br>L291-L297: カナ引き当て処理 | 桑名市の住所マスターを五十音順ソートするために公定一次資料から作成された辞書 | **【要注意】** 桑名市以外の新地区住所マスターに対して実行すると `FATAL: Unresolved reading kana` で落ちる。<br>新地区展開時は外部ソート済みデータを用いるか、スクリプトの動的解決化が必要。 |
| **`scripts/test_browser_h_app_storage.mjs`** | L11, L221, L284: `location: '桑名市'` | ブラウザ自動テストのモック用フィクスチャデータ | **影響なし (テスト内のみ)**。新地区用テスト時にフィクスチャを差し替え可能。 |
| **`scripts/acquire-liff-id.mjs`** | L11-L13: 過去の LIFF ID コメント | 過去地区（KAMEYAMA, OKAYAMA-02, MIE-03）の参照用メモ | **影響なし**。 |
| **`scripts/verify-gate-minus-1.mjs`**<br>**`scripts/check-pre-copy-purity.mjs`** | KUWANA / OKAYAMA シグネチャ一覧 | 特定地区残骸の混入を機械検知するための**ブラックリスト（検査定義）** | **正常動作**。原本純度を保護するための必須ガード。 |

---

## 6. 未確認事項 (UNVERIFIED)

推測を排除し、実機検証まで未確定として扱う事項：
- **UNVERIFIED-01**: 新規 Standalone GAS プロジェクト作成時、Google Cloud Console 側の GCP プロジェクト標準紐付け（デフォルトプロジェクト）で STACKDRIVER ロギングおよび Maps API Key が即座に疎通するか、または明示的な GCP プロジェクト変更が必要か。
- **UNVERIFIED-02**: LINE Messaging API の同一チャネル（LINE_CHANNEL_ID: `2010941735`）配下に新規 LIFF アプリを追加発行する際の上限枠（LIFF 最大数制限）の残枠数。

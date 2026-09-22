# 現行Hアプリ構造台帳 (Current H-App & System Inventory)
## Universal POSTING MAP Architecture Ledger — Gate 1

> 本書は、最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md` §19, Gate 1 出口基準）に基づき、
> リポジトリ内の全既存資産（コード、データ、シート構造、設定、スクリプト）の実測・現物棚卸し結果および
> 4分類（🟢 継承 / 🔴 廃止 / 🟡 再構築 / 🔵 要検証）を記録した公式台帳である。

---

## 1. 現物計測サマリ（実測値）

リポジトリ（`/Volumes/SSD_DATA/posting-map-universal/`）内の全資産を実ファイルから直接再計測した結果は以下の通りである。

### (1) コード規模・ファイル数サマリ

| 領域 | ファイル数 | 実行テキスト行数 (wc -l) | バイト数 | 主な構成・言語 |
|---|---|---|---|---|
| **Hアプリ (配布員用モバイルUI)** | 14ファイル (13テキスト + 1画像) | **5,572行** (※1) | 266,419 bytes | HTML, JS, CSS, WebP/PNG |
| **Manager Dashboard (管理者UI)** | 2ファイル | **3,892行** | 166,354 bytes | HTML, JS (Leaflet, Tailwind) |
| **APIルーター・認証 (`active/api/`)** | 4ファイル | **1,083行** | 43,105 bytes | GAS / JS (V8) |
| **ドメイン業務ロジック (`active/business/`)** | 21ファイル | **3,640行** | 134,849 bytes | GAS / JS (9業務ドメイン) |
| **GASコア・運用基盤 (`active/gas/`)** | 9ファイル | **2,167行** | 71,947 bytes | GAS / JS (バッチ・展開・移行) |
| **インフラアダプター (`active/infrastructure/`)** | 4ファイル | **321行** | 10,678 bytes | GAS / JS (Spreadsheet, Drive等) |
| **GASマニフェスト (`active/appsscript.json`)** | 1ファイル | **16行** (※2) | 495 bytes | JSON (OAuth Scopes, V8) |
| **【ゾンビコード】スプシUIスクリプト** | 1ファイル | **601行** (※1) | 21,253 bytes | `active/dashboard/v2_ui.js` |
| **`active/` 配下 小計 (テキスト全54ファイル)** | **55ファイル** (54テキスト + 1画像) | **17,292行** (※3) | 724,320 bytes | 実行アプリケーション中核 |
| **マスターデータ・設定 (`data/`)** | 12ファイル (7ルート + 5e-Stat) | 428行 + 1MB GeoJSON | 1,028,843 bytes | CSV, GeoJSON, JSON |
| **リポジトリ全体 (テスト・スクリプト等含む)** | **175ファイル** (144 Git追跡) | — | — | 全体資産 |

> ※1: `active/dashboard/v2_ui.js`（601行）は、スプレッドシートのメニュー・UI操作を行うコンテナバウンドGAS用スクリプトであり、フロントエンドコードではないため別枠で計上（Hアプリ 5,572行 + ゾンビコード 601行 = 6,173行）。  
> ※2: `active/appsscript.json` は末尾に改行コードが無いため、`wc -l`（改行数）では 16行、論理行数では 17行となる（本書では標準 `wc -l` の 16行で集計）。  
> ※3: 内訳合計: 5,572 (Hアプリ) + 3,892 (Manager) + 7,227 (Backend 39ファイル小計: 1,083+3,640+2,167+321+16) + 601 (v2_ui.js) = **17,292行** となり、`wc -l` 実測値と完全に一致する。バイナリ画像 `icon180-v2.png` はテキスト行数に含まない。

---

## 2. データベース現物構造（Spreadsheet Pure DB）

`active/business/system/district_provisioner.js`、`monthly_sheet_resolver.js`、`bulletin_service.js` から確認された実シート構成は、計 **13シート**（標準運用時）である。

### (1) システム管理シート（1シート）
- **`SYSTEM_INFO`**: 契約期間（`CONTRACT_END_DATE`）、管理者パスワードハッシュ（`MANAGER_PASSWORD_HASH`）、地区識別子（`DISTRICT_ID`）、接続スプレッドシートID、Google Maps APIキー等のキー・バリュー設定。

### (2) 原本シート群（5シート: 毎月1日の月次自動生成テンプレート）
1. **`配布実績の原本`**: 15列 `[ID, 市町村, 町域, 配布完了日時, 配布枚数, 担当者ID, 担当者名, GPS, 写真, 緯度, 経度, GPS日時, 写真ファイルID, 写真URL, 写真日時]`
2. **`名簿の原本`**: 4列 `[ID, 名前, LINE_USER_ID, 登録日時]`
3. **`保有チラシ枚数の原本`**: 6列 `[ID, 担当者ID, 担当者名, 保管場所, 保有枚数, 最終更新日時]`
4. **`受渡要請履歴の原本`**: 7列 `[日時, 要請者, 要請者ID, 保管者, 保管者ID, 連絡方法, 連絡先]`
5. **`PinStatusの原本`**: 2列 `[rowId, status]`

### (3) 当月業務シート群（5シート: YYYY-MM形式で自動生成・履歴保全）
1. **`配布実績YYYY-MM`**
2. **`名簿YYYY-MM`**
3. **`保有チラシ枚数YYYY-MM`**
4. **`受渡要請履歴YYYY-MM`**
5. **`PinStatusYYYY-MM`**

### (4) 現場コミュニケーション・履歴シート群（2シート）
1. **`掲示板`**: 配布員間のメッセージ投稿（`[ID, 投稿日時, LINE_USER_ID, 表示名, 本文, 削除フラグ]`）
2. **`掲示板連絡履歴`**: 掲示板経由での連絡履歴

---

## 3. 全資産の4分類台帳 (Classification Ledger)

`01_DESIGN_CONTRACT.md` §19 に基づき、現有全資産を以下の基準で分類する。
- 🟢 **継承**: 現行の優れたUI/UX、現場思想、確立されたコア機能。
- 🔴 **廃止**: 旧地区複製モデルの残骸、コンテナバウンドGASUI、ダミーモック、ゾンビコード。
- 🟡 **再構築**: Universal POSTING MAP（単独アプリ・単独リポジトリ・単独ドメイン）に適合させるための構造再設計。
- 🔵 **要検証**: 現場での利用実態・非機能要件・負荷耐性の検証が必要な項目（推測での分類禁止）。

### (1) Frontend — Hアプリ (`active/dashboard/`, `index.html`)

| ファイル / コンポーネント | 行数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `index.html` (ルート) | 43 | 🟡 再構築 | LIFF初期化とリダイレクトを担う。Universal共通エントリとして単一ドメインルーティングへ最適化が必要。 |
| `active/dashboard/index.html` | 354 | 🟢 継承 | HアプリのメインDOM。ブラック基調のプレミアムUI、下部ナビゲーション、モーダル構造を確立。 |
| `active/dashboard/style.css` | 618 | 🟢 継承 | グラスモフィズム、ネオモルフィズム、タッチアニメーション等のデザインシステム。 |
| `active/dashboard/tailwind-utils.css` | 321 | 🟢 継承 | オフライン稼働・高速レンダリングのためのTailwind事前生成CSS。 |
| `active/dashboard/app.js` | 2,278 | 🟡 再構築 | アプリ起動・Optimistic First Paint・地図制御・イベント管理。長大かつ一部管理思想が混在しているため、モジュール分割再構築が必要。 |
| `active/dashboard/render.js` | 1,129 | 🟡 再構築 | Google Mapsピン・ポリゴン・モーダル描画。大量ポリゴン描画の最適化およびクリーン構造化が必要。 |
| `active/dashboard/db.js` | 321 | 🟢 継承 | IndexedDBによるオフライン送信キュー（`PostingMapDB` -> `syncQueue`）。現場作業継続の重要基盤。 |
| `active/dashboard/components/navigation.js` | 52 | 🟢 継承 | 現場目線の2層（Tier1/Tier2）ボトムナビゲーションHTML生成。 |
| `active/dashboard/components/ranking.js` | 72 | 🟢 継承 | 個人ランキングカード表示。INV-004（活動意欲支援機能として維持）に準拠。 |
| `active/dashboard/components/staff.js` | 82 | 🟢 継承 | デジタル配布員証（ジャイロカード・公式配布員ID表示）。 |
| `active/dashboard/modules/api.js` | 87 | 🟡 再構築 | `PMS_CLIENT_CONFIG.api.gasWebAppUrl` 経由のPOST通信。認証ヘッダー・共通エラーハンドリングの標準化が必要。 |
| `active/dashboard/modules/device.js` | 122 | 🟢 継承 | 高精度GPS取得（`getGPSLocation`）および写真撮影・クライアント側画像圧縮（`compressImage`）。 |
| `active/dashboard/modules/navigation.js` | 136 | 🟢 継承 | 画面遷移（`switchPage`）・スクロール位置保持・ナビ切り替え。 |
| `active/dashboard/v2_ui.js` | 601 | 🔴 廃止 | **【ゾンビコード】** `SpreadsheetApp.getUi()`, `onOpen()` 等を含むコンテナバウンドGAS用UIスクリプト。フロントエンドディレクトリに誤配置されており、全編廃止対象。 |
| `active/dashboard/assets/icon180-v2.png` | 31KB | 🟢 継承 | PWA / LIFF 用公式アプリアイコン。 |

### (2) Frontend — Manager Dashboard (`active/manager/`)

| ファイル / コンポーネント | 行数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `active/manager/index.html` | 712 | 🟢 継承 | 管理者向けダッシュボードDOM。Leaflet地図、進捗、在庫、名簿、受渡要請の5大タブ構成。 |
| `active/manager/manager.js` | 3,180 | 🟡 再構築 | 管理者業務ロジック。Leaflet連携、パスワード認証、CSV解析。単独ドメイン・Universal共通APIへの接続統合が必要。 |

### (3) Backend API & 認証 (`active/api/`)

| ファイル / コンポーネント | 行数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `active/api/v2_api.js` | 856 | 🟡 再構築 | `doGet`/`doPost` エントリポイント。全アクションのルーティングを司るが、旧複製モデル用APIやモックが混在。Universal正規API契約へ再構築。 |
| `active/api/AssetRegistry.js` | 73 | 🟢 継承 | 静的アセット・設定レジストリ。 |
| `active/api/auth/auth.js` | 83 | 🟡 再構築 | LINE LIFF ID Token 認証。Universal認可チェーン（LINE User ID → Staff Identity → Branch → Target Region）へ統合。 |
| `active/api/auth/session.js` | 71 | 🟢 継承 | セッション検証・トークン処理。 |

### (4) Backend ドメイン業務ロジック (`active/business/`)

| ドメイン / ファイル | 行数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `area/address_master_service.js` | 146 | 🟢 継承 | 住所マスターCSVの読込・パース・町丁目クエリSSOT（ブラウザ/GAS両対応）。 |
| `area/area_repository.js` | 88 | 🟢 継承 | エリアデータの検索・取得リポジトリ。 |
| `area/area_service.js` | 36 | 🟢 継承 | エリア詳細情報提供サービス。 |
| `area/tier1_service.js` | 92 | 🟢 継承 | 自治体別集計（Tier 1）提供サービス。 |
| `bulletin/bulletin_service.js` | 358 | 🔵 要検証 | 掲示板投稿・連絡履歴管理。現場での利用頻度、スパム対策、通知負荷の検証が必要。 |
| `distribution/distribution_model.js` | 57 | 🟢 継承 | 配布実績データモデル。 |
| `distribution/distribution_repository.js` | 284 | 🟢 継承 | 配布実績の集計・ランキング計算・履歴取得リポジトリ。 |
| `distribution/distribution_service.js` | 103 | 🟢 継承 | 配布実績登録・更新サービス。 |
| `flyer/flyer_repository.js` | 131 | 🟢 継承 | チラシ在庫データアクセス。 |
| `flyer/flyer_service.js` | 31 | 🟢 継承 | チラシ在庫取得・更新サービス。 |
| `gps/gps_repository.js` | 179 | 🟢 継承 | GPSログおよびDrive写真ファイル連携。 |
| `gps/gps_service.js` | 88 | 🟢 継承 | GPS座標検証および写真メタデータ更新。 |
| `pin/pin_status_service.js` | 99 | 🟢 継承 | ピンのリアルタイム作業中（inProgress）状態管理。 |
| `staff/staff_model.js` | 56 | 🟢 継承 | 配布員データモデル。 |
| `staff/staff_repository.js` | 198 | 🟢 継承 | 名簿シートへの読み書きリポジトリ。 |
| `staff/staff_service.js` | 145 | 🟢 継承 | 配布員登録、LINE User IDからのIdentity解決（`resolveStaffIdentity`）。 |
| `system/district_provisioner.js` | 670 | 🔴 廃止 | **【旧複製モデル】** 地区別スプレッドシート一括作成スクリプト。Universal POSTING MAPでは単独リポジトリ・単一エンジン運用となるため廃止。 |
| `system/monthly_sheet_resolver.js` | 77 | 🟢 継承 | 当月シート名（YYYY-MM）の厳格な参照解決SSOT。 |
| `system/system_info_service.js` | 329 | 🟢 継承 | `SYSTEM_INFO` シートの管理、契約期間チェック、管理者認証。 |
| `system/system_summary_service.js` | 115 | 🟢 継承 | システム全体の進捗・統計サマリ提供。 |
| `transfer/transfer_service.js` | 358 | 🔵 要検証 | チラシ受渡要請サービス。LINE Push通知連携のコスト・クォータ・代替手段の検証が必要。 |

### (5) Backend GAS運用・移行基盤 (`active/gas/`)

| ファイル | 行数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `active/gas/sheet_guard.js` | 106 | 🟢 継承 | スプレッドシート保護・競合防止。 |
| `active/gas/v2_batch.js` | 217 | 🟢 継承 | 定期バッチ・集計トリガー処理。 |
| `active/gas/v2_config.js` | 128 | 🟡 再構築 | スクリプトプロパティ取得・設定。Universal環境変数体系へ整理。 |
| `active/gas/v2_core.js` | 22 | 🟢 継承 | コア共通ユーティリティ。 |
| `active/gas/v2_deployment_foundation.js` | 1,036 | 🔴 廃止 | **【旧複製モデル】** 地区別デプロイ基盤スクリプト。Universalでは不要。 |
| `active/gas/v2_extract.js` | 149 | 🟢 継承 | データ抽出ユーティリティ。 |
| `active/gas/v2_map.js` | 187 | 🟢 継承 | 座標計算・マップデータ補助。 |
| `active/gas/v2_migration.js` | 228 | 🟡 再構築 | カラムマイグレーションスクリプト。Universalデータスキーマへの移行用に改定。 |
| `active/gas/v2_stats.js` | 94 | 🟢 継承 | 統計集計ユーティリティ。 |

### (6) インフラアダプター (`active/infrastructure/`)

| ファイル | 行数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `active/infrastructure/cache/cache_adapter.js` | 41 | 🟢 継承 | GAS `CacheService` ラッパー。 |
| `active/infrastructure/drive/drive_adapter.js` | 25 | 🟢 継承 | GAS `DriveApp` ラッパー。 |
| `active/infrastructure/lock/lock_adapter.js` | 36 | 🟢 継承 | GAS `LockService` 排他制御ラッパー。 |
| `active/infrastructure/spreadsheet/spreadsheet_adapter.js` | 219 | 🟢 継承 | GAS `SpreadsheetApp` 安全アクセスラッパー。 |

### (7) マスターデータ・設定 (`data/`)

| ファイル | 規模 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `data/address_master.csv` | 338行 | 🟢 継承 | 国勢調査小地域に基づく町丁目・座標・世帯数SSOT。 |
| `data/boundaries.geojson` | 1.0MB | 🔵 要検証 | 町丁目境界ポリゴンデータ。モバイルでの描画パフォーマンスの検証が必要。 |
| `data/municipality_master.csv` | 2行 | 🟢 継承 | 構成自治体一覧（桑名市: 24205, 337町丁目）。 |
| `data/config.js` | 20行 | 🟡 再構築 | クライアント接続設定。Universal本番環境用設定へ再定義。 |
| `data/storage_locations.json` | 10行 | 🟢 継承 | チラシ保管場所の自治体候補リスト。 |
| `data/election_history.json` | 58行 | 🔵 要検証 | 過去の選挙実績データ。現場UIでの活用状況の確認が必要。 |
| `data/area_mapping.json` | 2 bytes | 🔴 廃止 | 空のJSONオブジェクト（`{}`）。未使用ファイル。 |
| `data/raw_estat_r2/24205/` | 5ファイル | 🟢 継承 | 国勢調査一次データ（Shapefile・DBF・ZIPアーカイブ）。生成元エビデンスとして保持。 |

### (8) 開発・運用スクリプト (`scripts/`)

| スクリプト | 分類 | 分類理由・現物根拠 |
|---|---|---|
| `scripts/verify-gate-minus-1.mjs` | 🟢 継承 | Gate -1 環境分離・接続遮断の恒久自動検証スクリプト。 |
| `scripts/serve.mjs` | 🟢 継承 | ローカル開発・検証用HTTPサーバー。 |
| `scripts/certify-universal-engine.mjs` | 🟢 継承 | Universal Engine 認証テスト。 |
| `scripts/safe-deploy.mjs` | 🟡 再構築 | 安全デプロイスクリプト。Universal専用デプロイへ改定。 |
| `scripts/generate-boundaries-geojson.py` | 🟢 継承 | e-Stat ShapefileからGeoJSONを生成するパイプライン。 |
| `scripts/sort-address-master.py` | 🟢 継承 | 住所マスターの正規化・ソートツール。 |
| `scripts/test_browser_h_app*.mjs` (3種) | 🟢 継承 | Hアプリ実機ブラウザ動作検証スクリプト。 |
| `scripts/provision-district.mjs` | 🔴 廃止 | 旧地区別リポジトリ作成スクリプト。Universalアーキテクチャに反するため廃止。 |
| `scripts/sync-deployment-config.mjs` | 🔴 廃止 | 旧地区別デプロイ同期スクリプト。廃止。 |
| `scripts/check-pre-copy-purity.mjs` | 🔴 廃止 | 旧地区複製前の純度検証スクリプト。廃止。 |
| `scripts/check-provisioning-gate.mjs` | 🔴 廃止 | 旧プロビジョニング検証スクリプト。廃止。 |
| `scripts/test-copy-simulation.mjs` | 🔴 廃止 | 旧地区コピーシミュレーションスクリプト。廃止。 |
| `scripts/validate-district-data-gate.mjs` | 🔴 廃止 | 旧地区データ検証スクリプト。廃止。 |

---

## 4. 🔵 要検証項目（Pending Verification Items）

推測による独断判定を排除し、Gate 2以降の設計・検証フェーズで実機検証・運用確認を行う項目は以下の **4点** である。

1. **掲示板（Bulletin）機能の現場運用性**:
   - `active/business/bulletin/bulletin_service.js`（358行）および `page-bulletin`。
   - 検証項目: 配布員間のメッセージ交換が実際の活動で有効に機能しているか、不適切な投稿や個人情報露出のリスクはないか、通知インフラの負荷。
2. **チラシ受渡要請（Transfer）機能とLINE Push通知**:
   - `active/business/transfer/transfer_service.js`（358行）および `page-storage-list`。
   - 検証項目: LINE Messaging API によるプッシュ通知送信の月間クォータ消費、送信失敗時のリトライ・フォールバック仕様、当事者間連絡の成立実態。
3. **境界GeoJSON描画パフォーマンス（モバイル低スペック端末耐性）**:
   - `data/boundaries.geojson`（1.0MB）および `active/dashboard/render.js`。
   - 検証項目: スマートフォン（特に低スペック機や通信制限下）において、Google Maps 上でのポリゴン描画負荷、ズーム操作時のFPS低下、メモリ消費量の限界値。
4. **過去選挙実績データ（`election_history.json`）の機能的有用性**:
   - `data/election_history.json`（58行）。
   - 検証項目: HアプリまたはDashboardでの参照実態、今後の選挙戦略機能としての必要性。

# REQUIREMENTS TRACEABILITY MATRIX (要件追跡性マトリクス)

- **Version**: 1.0.0 (Gate 4 Formal Deliverable)
- **Date**: 2026-09-22
- **Scope**: Universal POSTING MAP Architecture, Data, API, and Governance Contracts
- **Reference Standards**:
  - `AGENTS.md` (最上位基本就業規則)
  - `docs/architecture/01_DESIGN_CONTRACT.md` (最高位設計契約)
  - `docs/data/DATA_DICTIONARY.md` (データ辞書)
  - `docs/data/DATA_LIFECYCLE.md` (データライフサイクル規程)
  - `docs/api/API_CONTRACT.md` (API・異常系・排他制御・整合性契約)
  - `docs/architecture/decisions/ADR-001.md` 〜 `ADR-008.md`

---

## 1. 凡例とステータス定義

本マトリクスでは、机上の空論や未実装項目の過大評価を完全に排除するため、実態に基づき以下のステータスを厳格に適用する。

| ステータス | 定義 | 判定基準 |
|:---|:---|:---|
| **VERIFIED** | 実装および検証が完了し、契約との整合性が確認されている状態 | 現存するコード、既存テスト、Gate -1 スクリプト、または確定文書により検証可能なもの |
| **GAP** | 設計契約として確定しているが、現行コードへの実装または実機検証が未完了の状態 | Gate 5 以降での実装・修正・実機テストが必要な項目（例: `requestId` 冪等性照合） |
| **FUTURE IMPLEMENTATION** | 将来の計画として合意されているが、現フェーズでは未配備・将来検討とする状態 | Gate 8 以降のアーキテクチャ近代化や、機械的自動フック（`hooks.json` 等）の配備 |
| **UNDETERMINED** | 現行の仕様・インフラ環境からは一意に数値を特定できず、未確定である状態 | GAS の同時実行限界や Google インフラ内部の非公開クォータ挙動 |

---

## 2. Requirements Traceability Matrix

### 2.1 Architecture Domain (システム構造・基盤境界)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-ARCH-001** | 4層物理分離 | Client / Backend Standalone GAS / Pure DB / Master Data の物理的分離 | [ADR-001](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-001.md) | `DATA_LIFECYCLE.md` §1<br>`API_CONTRACT.md` §2 | `index.html`<br>`active/dashboard/`<br>`active/api/v2_api.js`<br>`data/` | `npm run gate:minus-1` (Check 2: No bound scripts, Check 4: No regional code) | **VERIFIED** |
| **REQ-ARCH-002** | Universal Engine | 単独アプリ・単独リポジトリ・単独ドメイン。地域差はデータで吸収 | [ADR-003](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-003.md) | `01_DESIGN_CONTRACT.md` §1<br>`DATA_DICTIONARY.md` §0 | Git Root<br>`active/`<br>`data/` | `npm run gate:minus-1` (Check 4: Universal Engine pureness) | **VERIFIED** |
| **REQ-ARCH-003** | `active/` 不可侵境界と共通進化 | 地区特化のための変更は禁止。共通改善・バグ修正はGate統制下で許容 | [ADR-003](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-003.md) | `AGENTS.md` §1<br>`01_DESIGN_CONTRACT.md` §1 | `active/` 全域 | 変更前の事前宣言および事後 `git diff` 差分照合 | **VERIFIED** |
| **REQ-ARCH-004** | レガシー互換性・実行環境制約 | IIFE / グローバル Singleton 構造の当面尊重と近代化境界の分離 | [ADR-007](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-007.md) | `API_CONTRACT.md` §2 | `active/dashboard/app.js`<br>`active/api/v2_api.js`<br>`active/business/` | コード構造監査（既存の即時実行関数および単一インスタンス管理を確認） | **VERIFIED** |
| **REQ-ARCH-005** | Pure DB 原則 | スプレッドシート内にスクリプト、カスタム関数、トリガーを内包しない | [ADR-001](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-001.md) | `01_DESIGN_CONTRACT.md` §2<br>`DATA_LIFECYCLE.md` §1 | 外部 Google Spreadsheet DB | `npm run gate:minus-1` (Check 2: Pure DB 検査) | **VERIFIED** |

---

### 2.2 Data Model & Business Invariants Domain (業務不変条件・データ契約)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-DATA-001** | 自由配布・非事前割当モデル | 個人への担当エリア・活動可能地域割当の完全排除 (`Person → AssignedArea` 不存在) | [ADR-002](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-002.md) | `01_DESIGN_CONTRACT.md` §3<br>`DATA_DICTIONARY.md` §0, §5 | `active/dashboard/app.js`<br>`active/api/v2_api.js` | データスキーマ監査および `grep` 照合（担当割当ロジック不在を確認） | **VERIFIED** |
| **REQ-DATA-002** | 支部活動制限の排除 | 支部による党員の活動地域制限モデルの排除 (`Branch → AllowedRegion → Person` 不存在) | [ADR-002](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-002.md) | `AGENTS.md` §2<br>`DATA_DICTIONARY.md` §5 | `active/dashboard/app.js`<br>`active/business/` | コード監査（支部外活動拒否ロジックが存在しないことを確認） | **VERIFIED** |
| **REQ-DATA-003** | ノルマ・強制管理の排除 | 個人ノルマ、出勤・参加管理、未達ペナルティの完全排除 | [ADR-002](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-002.md) | `DATA_DICTIONARY.md` §0, §5 | `active/dashboard/`<br>`active/business/` | UIおよびバックエンドロジック監査 | **VERIFIED** |
| **REQ-DATA-004** | 客観的事実の記録 | 配布実績は「誰が・いつ・どこで・何枚」という確定事実のみを追記 | [ADR-002](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-002.md)<br>[ADR-005](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1<br>`DATA_LIFECYCLE.md` §2 | `DistributionRecord` シート<br>`active/business/distribution/` | スキーマ定義およびアペンド処理監査 | **VERIFIED** |
| **REQ-DATA-005** | 状態と事実の厳格分離 | PinStatus (一時状態) と DistributionRecord (確定事実) の責務分離 | [ADR-002](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-002.md)<br>[ADR-005](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1, §3<br>`DATA_LIFECYCLE.md` §2 | `active/business/pin/`<br>`active/business/distribution/` | 状態更新と実績追記の独立分離コード監査 | **VERIFIED** |
| **REQ-DATA-006** | 個人ランキングの動機付け純化 | ランキングは自発的活動促進のための機能であり、管理・評価に使用しない | [ADR-002](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-002.md) | `DATA_DICTIONARY.md` §4<br>`DATA_LIFECYCLE.md` §4 | `active/dashboard/`<br>`active/business/distribution/` | UI表示・集計ロジック監査 | **VERIFIED** |
| **REQ-DATA-007** | Spreadsheet DB 正本 (SSOT) | 確定データは Spreadsheet DB にのみ存在し、端末キャッシュは一時ミラー | [ADR-005](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1<br>`DATA_LIFECYCLE.md` §1 | Google Spreadsheet DB | アーキテクチャ設計監査 | **VERIFIED** |
| **REQ-DATA-008** | rowId と requestId の分離 | rowId (町丁目地理ID) と requestId (完了操作UUID v4) の概念・判定分離 | [ADR-005](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1<br>`API_CONTRACT.md` §4, §17 | `active/dashboard/app.js`<br>`active/business/distribution/` | バックエンドでの requestId 受領・照合ロジック未実装 | **GAP** |
| **REQ-DATA-009** | 正当な配布実績の保護 | 同一 rowId の実績存在を理由とする登録拒絶の禁止、timestamp winner 上書き禁止 | [ADR-005](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1<br>`API_CONTRACT.md` §4, §17 | `active/business/distribution/distribution_service.js` | 追記専用（Append-Only）処理の監査（上書きロジック不在確認） | **VERIFIED** |
| **REQ-DATA-010** | Server Wins の厳格定義 | 競合時の確定正本優先原則であり、既存実績を上書き消去する権限ではない | [ADR-005](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-005.md) | `API_CONTRACT.md` §17<br>`DATA_LIFECYCLE.md` §2 | `active/dashboard/app.js`<br>`active/business/` | 整合性解決ロジック監査 | **VERIFIED** |

---

### 2.3 API & Offline Sync Domain (通信・排他制御・セキュリティ)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-API-001** | オフラインキュー | IndexedDB (`PostingMapDB` / `syncQueue`) によるオフライン時データ保護とFIFO送信 | [ADR-004](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §10 | `active/dashboard/db.js` (L14-15)<br>`active/dashboard/app.js` | IndexedDB 実装コード監査 (`PostingMapDB`, `syncQueue`) | **VERIFIED** |
| **REQ-API-002** | クライアント多重送信防止 | `isProcessing` フラグによる排他制御 | [ADR-004](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §14 | `active/dashboard/app.js` | キュー送出処理排他制御コード監査 | **VERIFIED** |
| **REQ-API-003** | 指数バックオフリトライ | 通信障害・混雑時の Exponential Backoff (1s, 2s, 4s, 8s, 16s; 最大3回) | [ADR-004](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §10 | `active/dashboard/app.js` | リトライ遅延計算コード監査 | **VERIFIED** |
| **REQ-API-004** | バックエンド排他制御 | GAS `LockService.getScriptLock()` による保護、`waitLock(15000)` 設定 | [ADR-004](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §11, §13 | `active/business/distribution/distribution_service.js` (L75) | スクリプトロック待機コード監査 (`lock.waitLock(15000)`) | **VERIFIED** |
| **REQ-API-005** | 非現実的ロック制約の排除 | 「ロック保持時間1秒未満」の不採用（Drive/SS I/O 実態を反映） | [ADR-004](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §11 | `active/business/distribution/` | 設計決定確定（無理なタイマー制限の排除を確認） | **VERIFIED** |
| **REQ-API-006** | requestId 冪等性保証 | 同一 UUID v4 の再送検知時に二重書き込みをスキップし HTTP 200 返却 | [ADR-005](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-005.md) | `API_CONTRACT.md` §4, §17 | `active/business/distribution/distribution_service.js`<br>`active/api/v2_api.js` | バックエンド側 requestId キャッシュ・重複スキップロジック未実装 | **GAP** |
| **REQ-API-007** | Hアプリ主認証 | LINE LIFF Bearer Token + LINE Profile API 直接検証 | [ADR-006](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-006.md) | `API_CONTRACT.md` §2, §6 | `index.html`<br>`active/api/v2_api.js`<br>`active/api/auth/` | LIFF 初期化・API 検証コード監査 | **VERIFIED** |
| **REQ-API-008** | 認証キャッシュ | GAS `CacheService` による検証済みユーザー情報の 30分間 (1800s) キャッシュ | [ADR-006](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-006.md) | `API_CONTRACT.md` §2, §6 | `active/api/v2_api.js` | キャッシュ参照・保存コード監査 | **VERIFIED** |
| **REQ-API-009** | HMAC 主認証の完全排除 | フロントエンドゼロシークレット原則の遵守（HMAC 共有鍵の埋め込み禁止） | [ADR-006](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-006.md) | `API_CONTRACT.md` §2, §6 | `active/dashboard/`<br>`index.html` | フロントエンドソースコード全数 `grep`（秘密鍵不在を確認） | **VERIFIED** |
| **REQ-API-010** | Identity 強制解決チェーン | `lineUserId` から Staff Master を引いて `staffId` / `branchId` をサーバー解決 | [ADR-006](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-006.md) | `AGENTS.md` §2<br>`DATA_DICTIONARY.md` §2<br>`API_CONTRACT.md` §7 | `active/api/v2_api.js`<br>`active/business/staff/` | クライアント送信パラメータ無視およびサーバー強制解決コード監査 | **VERIFIED** |
| **REQ-API-011** | シークレット隔離境界 | スプレッドシートID等の機密情報は `ScriptProperties` に隔離しコード露出ゼロ | [ADR-006](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-006.md) | `01_DESIGN_CONTRACT.md` §2<br>`API_CONTRACT.md` §2, §6 | `active/api/v2_api.js` (L440)<br>Google Apps Script プロパティ | `PropertiesService.getScriptProperties()` 参照確認・平文不在確認 | **VERIFIED** |
| **REQ-API-012** | 高負荷時耐性・同時実行挙動 | GAS 同時実行集中時の挙動特定、適切な 429/503 返却とエラーハンドリング | [ADR-004](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §10, §13 | `active/api/v2_api.js`<br>`active/infrastructure/lock/` | 実機環境での負荷テスト未実施（GAS同時実行クォータ限界はGoogle依存） | **GAP**<br>(一部 **UNDETERMINED**) |
| **REQ-API-013** | 構造化監査ログ基盤 | 操作・エラー・セキュリティイベントを構造化 JSON で永続化 | [ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `API_CONTRACT.md` §16 | `active/api/v2_api.js`<br>`AuditLog` シート | 専用 AuditLog シートおよびフォーマット統一未配備（`console.log` のみ） | **GAP** |

---

### 2.4 Governance & AI Agent Domain (変更統制・運用原則)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-GOV-001** | リポジトリ境界 (永久原則) | 作業対象 Git root を絶対境界とし、SSD 上の他地区リポジトリ参照を永久禁止 | [ADR-003](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-003.md)<br>[ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `AGENTS.md` §3 | AI Agent 探索・作業環境 | `npm run gate:minus-1` (Check 5: No reference to other districts) | **VERIFIED** |
| **REQ-GOV-002** | 8-Stage Protocol 変更統制 | Plan → Review → Impl → Verify → Diff → Commit → Deploy → Runtime の厳守 | [ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `AGENTS.md` §4, §6<br>`01_DESIGN_CONTRACT.md` §1 | `.agents/workflows/development/workflow.md` | Gate 0〜4 の進捗・コミット履歴・運用証跡 | **VERIFIED** |
| **REQ-GOV-003** | 最小権限・実行モード分離 | READ / AUDIT / DESIGN / DOC ONLY 等、フェーズに応じた権限の厳格制限 | [ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `.agents/rules/agent-authority.md` | AI Agent プロンプト・就業規則 | Gate指示ごとのモード遵守確認 | **VERIFIED** |
| **REQ-GOV-004** | 事前宣言と事後差分照合 | ファイル変更前の日本語事前宣言と、完了後の `git diff` 1行単位照合 | [ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `AGENTS.md` §4 | Git 差分管理 | 未宣言変更ゼロの確認（No Silent Changes） | **VERIFIED** |
| **REQ-GOV-005** | Human-in-the-Loop | コミット、プッシュ、デプロイ、破壊的変更における人間監督者（MASTER）承認 | [ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `AGENTS.md` §4, §6 | 変更承認ワークフロー | MASTER の明示的承認履歴 | **VERIFIED** |
| **REQ-GOV-006** | 予期せぬ状態での即時停止 | 不整合・テスト失敗・宣言外変更検知時の自己判断修正禁止と HARD STOP | [ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `AGENTS.md` §4 | AI Agent 行動原則 | 異常検知時の停止・エスカレーション実績 | **VERIFIED** |
| **REQ-GOV-007** | 機械的 PreToolUse ガバナンス | AST 静的解析・MCP PreToolUse による未承認コマンド・コードの機械的ブロック | [ADR-008](file:///Volumes/SSD_DATA/posting-map-universal/docs/architecture/decisions/ADR-008.md) | `API_CONTRACT.md` §18 | `hooks.json`<br>`mcp_config.json`<br>静的解析ツール群 | 現時点では未配備（運用規則による統制のみ有効） | **FUTURE IMPLEMENTATION** |

---

## 3. ステータス集計と分析

### 3.1 ステータス内訳

| ステータス | 件数 | 割合 | 主な対象項目 |
|:---|:---:|:---:|:---|
| **VERIFIED** | **30** | 85.7% | 4層分離、Universal Engine、自由配布モデル、SSOT、ScriptLock、LINE認証、Git境界、8-Stage Protocol 等 |
| **GAP** | **4** | 11.4% | `requestId` 冪等性照合ロジック (REQ-DATA-008, REQ-API-006)、GAS高負荷耐性実測 (REQ-API-012)、構造化監査ログ基盤 (REQ-API-013)（Gate 5以降の実装・テスト対象） |
| **FUTURE IMPLEMENTATION** | **1** | 2.9% | 機械的 PreToolUse 自動フック (`hooks.json` / MCP ガバナンス設定: REQ-GOV-007) |
| **合計** | **35** | 100.0% | 全要件追跡項目 |

※ REQ-API-012 の一部（GAS 同時実行集中時の Google インフラ内部クォータ挙動）は「UNDETERMINED（外部依存のため未確定）」として内包・取り扱います。

### 3.2 Gate 5 (実装・実機検証フェーズ) への申し送り事項 (GAP分析)

1. **`requestId` 冪等性照合機構の実装 (REQ-DATA-008, REQ-API-006)**:
   - 現行の `DistributionService.submitDistribution` はサーバーサイドで UUID を発行しているが、クライアントから送信された `requestId` (UUID v4) をキーとした重複照合（Idempotent Hit 判定）を行っていない。
   - Gate 5 において、`CacheService` または Spreadsheet DB 照会を用いた重複スキップ・既存実績返却ロジックを安全に実装する。
2. **高負荷耐性・同時実行性能の実測 (REQ-API-012)**:
   - GAS の `LockService.waitLock(15000)` が同時多発アクセス時にどのように競合を解消するか、429/503 が返却された際にクライアントの Exponential Backoff が正常にリトライを吸収するかを実機テスト環境で検証する。
3. **構造化監査ログ基盤の整備 (REQ-API-013)**:
   - 現状の `console.log` 出力から、API リクエスト ID、検証結果、所要時間、IP/User-Agent 等を記録する監査ログ出力ユーティリティを整備する。

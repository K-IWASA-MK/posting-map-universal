# Universal POSTING MAP — API契約 (API_CONTRACT.md)
## Gate 3: API Architecture & Failure/Integrity/Governance Contract — Official Deliverable

> **本書の目的と最高位原則**:
> 本書は、最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md` §22, Gate 3 出口基準）および
> Gate 3 確定指示に基づき、Universal POSTING MAP における API 契約（API Contract）、異常系契約（Failure Contract）、
> データ整合性契約（Data Integrity Contract）、運用契約（Operational Contract）、および
> AI Agent / MCP 実行ガバナンス契約（Governance Contract）を規定した公式設計書である。
>
> **最上位不変原則**:
> 1. **ポスティングは完全に自由**: 個人担当エリア・個人活動可能地域・ノルマ・強制参加モデルは一切存在しない。
> 2. **所属支部と活動場所の完全分離**: 「支部の活動対象地域」は組織上の管理・観測対象地域であり、「党員のポスティング可能範囲」ではない。所属支部から活動場所を制限・限定・選択肢化してはならない。
> 3. **配布実績（事実）の記録**: 「誰が・いつ・どこで・何枚配ったか」という発生した客観的事実のみを記録する。
> 4. **Hアプリのランキングは動機付け機能**: 配布員本人のモチベーション・活動意欲を高めるための機能であり、管理・監督・評価のための機能ではない。評価スコア（`rankingScore` 等）は新設しない。
> 5. **操作単位の冪等性と正当な再配布の保証**: `rowId`（町丁目識別子）と `requestId`（操作単位の冪等性キー）を厳格に分離し、正当な再配布を duplicate 扱いしない。
> 6. **基盤適合性**: Google Apps Script (GAS) および Google Spreadsheet (Pure DB) の実行環境・制約と整合した、実現可能な契約として定義する（非現実的なRDB前提の一般論を排除）。
> 7. **AI Agent / MCP ガバナンスの確立**: 最小権限、読み書き分離、リポジトリ境界、人間による承認（Human-in-the-Loop）を強制する。

---

## 目次 (Table of Contents)

1. [Purpose (目的)](#1-purpose-目的)
2. [System Boundary / Context Diagram (システム境界・コンテキスト図)](#2-system-boundary--context-diagram-システム境界コンテキスト図)
3. [API Interface (通信方式・プロトコル)](#3-api-interface-通信方式プロトコル)
4. [Authentication (認証アーキテクチャ)](#4-authentication-認証アーキテクチャ)
5. [Identity Resolution (Identity強制解決)](#5-identity-resolution-identity強制解決)
6. [Authorization (認可モデル)](#6-authorization-認可モデル)
   - [6.1 District Routing & Authorization Boundary (地区ルーティングと認可境界)](#61-district-routing--authorization-boundary-地区ルーティングと認可境界)
7. [Data Model (データモデル整合性)](#7-data-model-データモデル整合性)
8. [DistributionRecord API (配布実績登録契約)](#8-distributionrecord-api-配布実績登録契約)
9. [Ranking API (個人ランキング契約)](#9-ranking-api-個人ランキング契約)
10. [Dashboard Read API (全体観測契約)](#10-dashboard-read-api-全体観測契約)
11. [Validation / Boundary Conditions (入力検証・境界条件)](#11-validation--boundary-conditions-入力検証境界条件)
12. [State Machine (状態遷移マシン)](#12-state-machine-状態遷移マシン)
13. [Idempotency / Concurrency (冪等性・並行性排他制御・正当な再配布の保証)](#13-idempotency--concurrency-冪等性並行性排他制御正当な再配布の保証)
14. [Error Contract (エラー契約・障害分類)](#14-error-contract-エラー契約障害分類)
15. [Timeout / Retry (タイムアウト・リトライ契約 & 状態遷移マトリクス)](#15-timeout--retry-タイムアウトリトライ契約--状態遷移マトリクス)
16. [Offline / Synchronization (オフライン同期・永続化保証)](#16-offline--synchronization-オフライン同期永続化保証)
17. [SSOT / Reconciliation (真実の情報源と不整合調停)](#17-ssot--reconciliation-真実の情報源と不整合調停)
18. [Security (セキュリティ契約)](#18-security-セキュリティ契約)
19. [Structured Logging / Traceability (構造化ログ・追跡性)](#19-structured-logging--traceability-構造化ログ追跡性)
20. [Monitoring / Audit (監視・監査運用設計)](#20-monitoring--audit-監視監査運用設計)
21. [Versioning / Backward Compatibility (バージョニング・後方互換性)](#21-versioning--backward-compatibility-バージョニング後方互換性)
22. [Rollback / Recovery (ロールバック・障害復旧手順)](#22-rollback--recovery-ロールバック障害復旧手順)
23. [RPO / RTO (目標復旧地点・目標復旧時間)](#23-rpo--rto-目標復旧地点目標復旧時間)
24. [AI Agent & MCP Governance (AIエージェント・MCP実行ガバナンス契約)](#24-ai-agent--mcp-governance-aiエージェントmcp実行ガバナンス契約)
25. [未確定事項 (Unconfirmed Items)](#25-未確定事項-unconfirmed-items)
26. [現行実装との対比・GAP分析 (EXISTING / REQUIRED / GAP)](#26-現行実装との対比gap分析-existing--required--gap)

---

## 1. Purpose (目的)

Universal POSTING MAP において、現場で活動する配布員が利用する「Hアプリ」、組織の観測者が利用する「Dashboard」、業務ロジック・永続化を司る「Backend (Standalone GAS / Spreadsheet)」、および開発・保守・監査を自律的・半自律的に支援する「AI Agent / MCP ツール群」の間で交換されるすべてのデータ通信契約・運用規範を定義する。

本書は単なるエンドポイント一覧にとどまらず、ネットワーク寸断、端末故障、並行アクセス、認証失効などの異常系（Failure Contract）、データ確定・重複防止（Data Integrity Contract）、障害検知・復旧（Operational Contract）、および AI エージェントの誤動作・権限逸脱を防ぐ統制モデル（Governance Contract）を包括的に規定する。

---

## 2. System Boundary / Context Diagram (システム境界・コンテキスト図)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【現場境界】                                                                │
│  配布員 (Person)                                                            │
│     │ 完全に自由なポスティング活動 (活動場所制限・担当エリアなし)           │
│     ▼                                                                       │
│  Hアプリ (Field Operations UI)                                              │
│     ├─ IndexedDB (PostingMapDB / syncQueue: オフライン永続化)               │
│     ├─ Device API (GPS測位・カメラ撮影・UUID発番)                           │
│     └─ Client API Engine (AbortController, 指数バックオフリトライ)         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS POST/GET (JSON / liffToken)
                                       │ 302 Follow Redirect
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【API・ロジック境界】                                                       │
│  Backend / API Gateway (Standalone GAS: v2_api.js)                          │
│     ├─ Auth Gateway: LINE Profile API トークン検証 (CacheService 30分)      │
│     ├─ Identity Resolver: staffId / staffName の強制上書き (クライアント無効化)│
│     ├─ Validation Engine: 型・境界値・Base64・サイズ厳格検証                │
│     ├─ Concurrency Control: LockService 排他ロック (15秒悲観ロック)         │
│     └─ Idempotency Engine: requestId 照合による二重書込防止 (再配布は受容) │
└───────────────────┬─────────────────────────────────────┬───────────────────┘
                    │ 永続化 (Lock下更新)                 │ データ提供 (ReadOnly)
                    ▼                                     ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
│ 【永続化境界 (Pure DB)】             │  │ 【統括観測境界】                  │
│  Google Spreadsheet / Drive          │  │  Dashboard (Manager UI)           │
│   ├─ 配布実績YYYY-MM (事実の原本)     │  │   ├─ 進捗観測 (完了率・総枚数)   │
│   ├─ 名簿の原本 (配布員Identity)     │  │   ├─ 時系列実績観測 (誰がいつどこで)│
│   ├─ 保有チラシ原本 (在庫記録)       │  │   ├─ GPS/写真監査プレビュー       │
│   ├─ Google Drive (証跡写真保管)     │  │   └─ スタッフ別実績一覧 (観測用)  │
│   └─ マクロ・トリガー・コード内包ゼロ│  │   ※ Hアプリへ指示を出さない     │
└──────────────────────────────────────┘  └───────────────────────────────────┘
                    ▲
                    │ 監査・検査・制御 (MCP 経由 / 最小権限)
┌───────────────────┴─────────────────────────────────────────────────────────┐
│ 【AI Agent / MCP 実行統制境界】                                             │
│  AI Agents (security-auditor / builder / release-deployer)                  │
│   ├─ MCP Architecture (Tool Registry, Read/Write Separation)                │
│   ├─ Workspace Boundary (他地区リポジトリ参照の完全遮断【永久原則】)        │
│   ├─ PreToolUse Hard Block (危険コマンド・未承認操作の事前強制停止)         │
│   └─ Human-in-the-Loop (MASTER 承認必須: Commit / Push / Deploy)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. API Interface (通信方式・プロトコル)

### (1) 通信プロトコル仕様
- **プロトコル**: HTTPS (TLS 1.2 / 1.3 必須)
- **エンドポイント**: Standalone Google Apps Script Web App 公開URL
  - 形式: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`
- **GAS 固有通信仕様 (重要)**:
  - GAS Web App は、リクエスト受信時に Google の認証・プロキシ層を経由し、`302 Moved Temporarily` を返却して `https://script.googleusercontent.com/...` へリダイレクトする。
  - クライアント通信設定として `redirect: 'follow'` が**必須**。
  - クロスオリジン通信のため `mode: 'cors'`, `credentials: 'omit'` を適用。
  - キャッシュ事故防止のため `cache: 'no-store'` および URLパラメータ `_t=${Date.now()}` を付与。

### (2) HTTP メソッドの運用契約
| メソッド | 適用対象 | 特記事項・禁止事項 |
|---|---|---|
| **GET** | 公開マスター読み取り、ヘルスチェック | **禁止**: `liffToken` を GET クエリに含めること（URLログ漏洩防止）。トークンを含むリクエストは即時 `400 Bad Request` 拒絶。 |
| **POST** | 業務データ送信、認証必須API、長大データ送信 | すべての書き込み操作、および認証・個人情報を含む読み出し操作は POST JSON ボディにて送信する。 |

---

## 4. Authentication (認証アーキテクチャ)

### (1) 認証方式
- **認証基盤**: LINE Front-end Framework (LIFF) ID Token / Access Token
- **トークン送信方式**: POST JSON ペイロード内の `liffToken` フィールドに格納して送信。
- **検証プロトコル**:
  ```text
  Client (Hアプリ)                Backend (GAS)                 LINE Platform
       │                               │                             │
       │── POST (liffToken: "...") ───►│                             │
       │                               │── CacheService 照合 (SHA256)│
       │                               │   [HIT (有効期限30分以内)]  │
       │                               │   ──► セッション復帰        │
       │                               │                             │
       │                               │   [MISS]                    │
       │                               │── GET /v2/profile ─────────►│
       │                               │   (Authorization: Bearer)   │
       │                               │◄─ 200 OK (userId, name) ────│
       │                               │── CacheService 保存 (1800s) │
       │                               │                             │
  ```

### (2) トークン検証キャッシュ仕様
- **キャッシュキー**: `AUTH_SESSION_` + SHA-256(`liffToken`) (平文トークンをキーにしない)
- **保管場所**: `CacheService.getScriptCache()`
- **TTL (有効期間)**: 1,800秒 (30分)
- **保存データ**: `{ lineUserId, displayName, pictureUrl, createdAt }`

---

## 5. Identity Resolution (Identity強制解決)

クライアント（ブラウザ・端末）から送信されたユーザー識別情報は**一切信用しない**。

```text
受信ペイロード (改ざん・偽装の可能性あり)
  { "liffToken": "...", "staffId": "STF-99999", "staffName": "詐称名" }
                     │
                     ▼
Backend: authenticateRequest(postData)
  ├─ 検証済み LINE User ID を抽出 ("U1234567890abcdef...")
  ▼
Backend: StaffService.resolveStaffIdentity(lineUserId)
  ├─ 名簿の原本 (SSOT) を照合
  ▼
Backend: ペイロード強制上書き (クライアント送信値を破棄)
  postData.staffId = identity.staffId;         // 例: "STF-24205-001"
  postData.staffName = identity.staffName;     // 例: "山田 太郎"
  postData.resolvedLineUserId = lineUserId;    // 内部監査専用
```

---

## 6. Authorization (認可モデル)

システム内の API アクションは、以下の4つの認可レベルに厳格に分類される。

| 認可レベル | 対象アクション例 | 必要な資格情報 | 拒絶時のレスポンス |
|---|---|---|---|
| **Public (公開)** | `getSystemSummary`, `getMapsApiKey`, `getSystemInfo` | なし (認証不要) | なし |
| **Unregistered Staff** | `registerStaff` (名簿初回登録) | 有効な `liffToken` (LINE検証成功) | `UNAUTHORIZED` (無効/期限切れトークン) |
| **Active Staff (配布員)** | `submitDistribution`, `updateRecordWithGPSPhoto`, `getRanking`, `getFlyerStock`, `updateFlyerStock`, `requestFlyerTransfer` | 有効な `liffToken` ＋ 名簿登録済み (`found === true`) | `NOT_REGISTERED` (名簿未登録) / `UNAUTHORIZED` |
| **Manager (管理者)** | `getRoster`, `getTransferRequests`, `verifyManagerPassword` | 管理者パスワード検証、または管理用セッション | `FORBIDDEN` / `UNAUTHORIZED` |

---

## 6.1 District Routing & Authorization Boundary (地区ルーティングと認可境界)

単一の親Standalone GAS（単一Web App URL）から複数地区のSpreadsheet（DB）へアクセスを振り分けるマルチテナント運用において、**ルーティング（どのDBを開くか）と認証・認可（誰がアクセスしてよいか）を完全に分離**する。

```text
Request 受信
    ↓
districtId 取得 (Routing Hint: 対象DB候補の指定)
    ↓
DISTRICT_REGISTRY による対象DB（Spreadsheet ID）候補の解決
    ↓
LINE Access Token 検証 ➔ 認証済み lineUserId 取得 (Identity Proof: 本人性証明)
    ↓
対象DB（名簿シート）との照合 ➔ 地区所属・利用資格確認 (Authorization: 認可判定)
    ↓
認可 PASS ➔ Spreadsheet 業務操作 / 認可 DENY ➔ 処理即時遮断
```

### (1) districtId は「Routing Hint」であり認証情報ではない
- クライアントが送信する `districtId`（例: `"KUWANA"`）は、あくまで「どのDBを候補として調べるか」の指定に過ぎない。
- `districtId` を送信したこと自体を信頼して対象スプレッドシートへの書き込み・読み取り権限を与える構造は絶対に採用しない。

### (2) 認可境界の実装要件
- 認証済み `lineUserId` と対象地区DBの名簿照合を認可境界として実装し、地区越境アクセスを拒否する。
- 業務系アクション（配布登録、在庫更新、ランキング取得等）の実行時、対象スプレッドシートの名簿に認証済み `lineUserId` が存在しない場合は、直ちに処理を停止し拒絶レスポンスを返却する。

### (3) 認可検証マトリクス (テスト検証条件)
実機・単体テストにおいて、以下の5大条件をすべて満たすことを実証する。

| テストシナリオ | LINE Token | 本人所属地区 | 指定 districtId | 認可判定 | レスポンスコード | 期待挙動 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **正当アクセス** | 正常 (User A) | District A | District A | **PASS** | `200 OK` | 正常に業務処理を完了・永続化 |
| **地区越境アクセス** | 正常 (User A) | District A | District B | **DENY** | `NOT_REGISTERED` | 越境操作を拒絶し、DB書き込み遮断 |
| **名簿未登録ユーザー**| 正常 (Unknown) | なし | District A | **DENY** | `NOT_REGISTERED` | 初回登録画面へ誘導 |
| **不正/失効トークン** | 無効/失効 | - | District A | **DENY** | `UNAUTHORIZED` | 認証エラーとして即時拒絶 |
| **未知の地区ID** | 正常 (User A) | District A | Unknown-99 | **DENY** | `DISTRICT_NOT_FOUND` | ルーティング失敗として即時拒絶 |

### (4) 推奨リクエスト構造
```json
{
  "action": "submitDistribution",
  "districtId": "KUWANA",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "liffToken": "eyJhbGciOi...",
  "rowId": 142,
  "count": 120
}
```
※ `districtId` は Routing Hint、`liffToken` は Identity Credential として扱い、Backend 側で分離検証する。


---

## 7. Data Model (データモデル整合性)

Gate 2 (`DATA_DICTIONARY.md`, `DATA_LIFECYCLE.md`) で確定したデータモデル契約を 100% 遵守する。

```text
Person (党員個人)
   ├── 組織所属 ──► Branch (所属支部: 組織上の所属先)
   │
   │ 1. performs (完全に自由なポスティング活動: 活動場所制限・担当エリアなし)
   ▼
DistributionRecord (配布実績事実)
   ├── rowId (町丁目行番号)
   ├── cityName / townName (どこで)
   ├── completedAt (いつ)
   ├── count (何枚)
   ├── staffId / staffName (誰が: Backend強制解決)
   ├── gps (latitude, longitude, accuracy: 空間証跡)
   └── photo (photoFileId, photoUrl: 物理証跡)
```

### 【絶対禁止事項のAPI契約上の担保】
- ❌ API リクエスト/レスポンスに `assignedAreaId`, `assignedStaffId`, `quota`, `targetCount` を含めてはならない。
- ❌ 「支部の活動対象地域」を党員個人の活動可能範囲としてフィルタリング・制限する API パラメータを設けてはならない。
- ❌ ランキング API に `rankingScore`, `motivationPoint`, `performanceGrade` 等の評価値を含めてはならない。

---

## 8. DistributionRecord API (配布実績登録契約)

配布実績の確定記録を行う中核 API。

### (1) エンドポイントアクション: `updateRecordWithGPSPhoto`
- **HTTP Method**: POST
- **認証**: 必須 (Active Staff)
- **排他制御**: `LockService.getScriptLock()` による 15秒悲観的ロック必須

#### リクエストボディ仕様 (JSON)
```json
{
  "action": "updateRecordWithGPSPhoto",
  "liffToken": "eyJhbGciOi...",
  "requestId": "req_550e8400-e29b-41d4-a716-446655440000",
  "rowId": 142,
  "count": 350,
  "isDone": true,
  "latitude": 35.0658,
  "longitude": 136.6834,
  "accuracy": 12.5,
  "photoData": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "areaName": "桑名市相生町"
}
```

#### レスポンス仕様 (成功時: HTTP 200)
```json
{
  "success": true,
  "rowId": 142,
  "count": 350,
  "gpsStatus": "OK",
  "photoStatus": "OK",
  "photoUrl": "https://drive.google.com/file/d/1AbC.../view",
  "timestamp": "2026/09/22 18:30:00"
}
```

#### レスポンス仕様 (同一操作の重複再送時: Idempotent Hit)
```json
{
  "success": true,
  "rowId": 142,
  "count": 350,
  "gpsStatus": "OK",
  "photoStatus": "OK",
  "message": "already_completed",
  "timestamp": "2026/09/22 18:30:00"
}
```

---

## 9. Ranking API (個人ランキング契約)

配布員本人のモチベーション・活動意欲向上（メンタル面の動機付け）のための API。

### (1) エンドポイントアクション: `getRanking`
- **HTTP Method**: POST
- **認証**: 必須 (Active Staff)

#### リクエストボディ仕様 (JSON)
```json
{
  "action": "getRanking",
  "liffToken": "eyJhbGciOi..."
}
```

#### レスポンス仕様 (HTTP 200)
```json
{
  "success": true,
  "mySummary": {
    "rank": 3,
    "count": 1250
  },
  "ranking": [
    { "rank": 1, "staffId": "STF-24205-008", "name": "STF-24205-008", "count": 2100, "isMe": false },
    { "rank": 2, "staffId": "STF-24205-003", "name": "STF-24205-003", "count": 1800, "isMe": false },
    { "rank": 3, "staffId": "STF-24205-001", "name": "山田 太郎",       "count": 1250, "isMe": true }
  ]
}
```
※ 他人の行は `staffId` を表示名として匿名化し、本人の行のみ `isMe: true` かつ登録名を返却。

---

## 10. Dashboard Read API (全体観測契約)

管理者が全体の進捗・事実を把握・観測するための API。

| アクション名 | 目的・返却データ | 認証 | 備考 |
|---|---|---|---|
| `getSystemSummary` | 全体進捗率、完了町丁目数、総町丁目数、累計配布枚数 | 不要 (Public) | ダッシュボード上部サマリ表示用 |
| `getLatestDistribution` | 直近の配布実績リスト（最大件数指定、最新20件等） | 不要 / Optional | 時系列での活動事実観測、写真プレビュー |
| `getRoster` | 全配布員の名簿、当月累計配布枚数、チラシ在庫合計 | 管理者権限 | 人員・在庫の全体状況把握 |
| `getGlobalPinStatus` | 当日中のリアルタイム作業中ピン（町丁目）一覧 | 不要 (Public) | 重複作業の自然防止のための地図表示 |

---

## 11. Validation / Boundary Conditions (入力検証・境界条件)

「例示された一般論」と「Universal POSTING MAP で実際に採用する契約」を明確に分離して定義する。

### 採用する検証・境界条件契約マトリクス

| 項目 | 採用する許容範囲・仕様 | 境界値・異常値の扱い | エラーコード |
|---|---|---|---|
| `rowId` | 1以上の正の整数 (`Number.isInteger(n) && n >= 1`) | 0, 負数, 小数点, 文字列, null, 空文字は REJECT | `INVALID_ROW_ID` |
| `count` | 0以上の整数 (`Number.isInteger(n) && n >= 0 && n <= 10000`) | 負数, NaN, 10,000超過（1町丁目の物理上限）は REJECT | `INVALID_COUNT` |
| `isDone` | 真偽値 (`true` または `false`。文字列 `"true"` / `"false"` も許容) | null, 未定義は `false` と判定 | - |
| `latitude` | 日本国内測地系: `20.0 <= lat <= 46.0` | 範囲外, 0, null は座標なし（`gpsStatus: "NO"`）として受容 | - |
| `longitude`| 日本国内測地系: `122.0 <= lng <= 154.0` | 範囲外, 0, null は座標なし（`gpsStatus: "NO"`）として受容 | - |
| `accuracy` | 0 より大きい数値 (メートル) | 負数, 0 は無効。1,000m 超過時は精度不足フラグ | - |
| `photoData`| `data:image/` で始まる Base64 文字列 (デコード後 5MB 以下) | 形式不正は写真なし（`photoStatus: "NO"`）として受容。5MB超過は REJECT | `PAYLOAD_TOO_LARGE` |
| `requestId`| `req_` で始まる UUID v4 文字列 (36文字以上) | 欠落時はクライアントで生成必須。空文字は REJECT | `MISSING_REQUEST_ID` |
| JSON構文 | 有効な JSON 文字列 | パースエラー（構文異常）時は即座に REJECT | `MALFORMED_JSON` |

---

## 12. State Machine (状態遷移マシン)

Hアプリ端末内における配布実績送信のライフサイクルを有限オートマトン（State Machine）として定義する。

```text
 ┌─────────────┐
 │   UNSENT    │ (現場で入力完了)
 └──────┬──────┘
        │ enqueueSync()
        ▼
 ┌─────────────┐       (ネットワーク接続あり)
 │   QUEUED    ├────────────────────────────────┐
 └──────┬──────┘                                │
        │ (オフライン時: 保留)                  ▼
        │                              ┌─────────────────┐
        │                              │     SENDING     │
        │                              └────────┬────────┘
        │                                       │
        │                        ┌──────────────┴──────────────┐
        │                        │                             │
        │                  (通信成功: 200)             (一時エラー: 503/429/timeout)
        │                        │                             │
        │                        ▼                             ▼
        │               ┌─────────────────┐           ┌─────────────────┐
        │               │    PERSISTED    │           │   RETRY_WAIT    │
        │               │ (キューから削除)│           └────────┬────────┘
        │               └─────────────────┘                    │
        │                                                      │ (指数バックオフ待機)
        │                                                      ▼
        │                                               (再試行実行: オンライン)
        │                                                      │
        │                                                      ▼
        │                                              ┌─────────────────┐
        │                                              │     SENDING     │
        │                                              └─────────────────┘
        │                                                      │
        │                                        (リトライ上限 5回超過)
        │                                                      │
        │                                                      ▼
        │                                             ┌─────────────────┐
        │                                             │ FAILED_PERMANENT│
        │                                             │   (手動再送待機)│
        │                                             └─────────────────┘
        │ (恒久エラー: 400/401/403)                            ▲
        └──────────────────────────────────────────────────────┘
```

---

## 13. Idempotency / Concurrency (冪等性・並行性排他制御・正当な再配布の保証)

### (1) `rowId` と `requestId` の厳格な責務分離
システムの二重登録防止と正当な活動記録を両立させるため、以下の2つの識別子を厳格に区別する。

```text
┌──────────────────────────────┬─────────────────────────────────────────────────────────────┐
│ 識別子                        │ 責務・定義                                                   │
├──────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **rowId (地域行識別子)**      │ 「どこで配るか」を表す地理的マスターの町丁目識別子。         │
│                              │ ※ 1回の配布操作やトランザクションを一意に特定するものではない。│
├──────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **requestId (冪等性キー)**   │ 「1回の配布完了操作」を一意に特定する暗号学的UUID v4キー。   │
│                              │ ※ 通信寸断や端末リトライによる同一操作の二重書込を防ぐ。    │
└──────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

### (2) 正当な再配布の保護 (Non-Duplicate Guarantee)
- **原則**: **異なる `requestId` を持つ正当な再配布を duplicate 扱いしてはならない。**
  - 同じ町丁目（同一 `rowId`）であっても、
    * 別の日に再度ポスティングを行った場合
    * 同月内に同一町丁目の未配布エリアに追加配布を行った場合
    * 複数人の党員が手分けして同一町丁目を配布した場合
    これらはすべて独立した新しい活動実績（`DistributionRecord`）であり、サーバーはこれを正常に受容・保存する。
- **排除すべき誤った設計**:
  - ❌ 「同一 `rowId` が既に完了（OK/OK）なら、いかなるリクエストも一律更新スキップする」という設計は、正当な追加配布や再配布を破壊するため禁止する。

### (3) 真の冪等性（Idempotency）保証アーキテクチャ
- **対象**: 通信タイムアウト、回線切断、UI連打等によって、**「同一の `requestId`（または端末キュー内の同一未完了タスク）」が複数回送信された場合**のみ。
- **処理フロー**:
  1. クライアントは完了操作時に `requestId = "req_" + UUIDv4()` を一意生成。
  2. サーバー（Backend）は直近処理済み `requestId` のハッシュおよび結果をキャッシュ（`CacheService` またはログ）と照合。
  3. 同一 `requestId` を検知した場合、スプレッドシートへの重複追記を行わず、前回の確定レスポンス（`already_completed`）を即座に返却（Idempotent Hit）。

### (4) 並行性排他制御 (GAS Pessimistic Script Lock)
- **排他制御方式**: Google Apps Script の `LockService.getScriptLock()` による悲観的スクリプト排他ロックを採用。
- **ロック獲得待ち時間**: 最大 15,000ms (15秒)。
- **完全解放保証**: `try { lock.waitLock(15000); ... } finally { lock.releaseLock(); }` により例外発生時も確実に解放。
- **競合時の挙動**: 15秒以内にロックを獲得できなかった場合、処理を中断して `LOCK_TIMEOUT` (503相当) を返却。クライアント側は指数バックオフで再送する。

---

## 14. Error Contract (エラー契約・障害分類)

### (1) 統一エラーレスポンスフォーマット
すべてのエラー応答は、以下の JSON スキーマに厳格に準拠する。

```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "ユーザーに表示可能な説明文",
  "errorType": "TRANSIENT | PERMANENT",
  "retryable": true
}
```

---

## 15. Timeout / Retry (タイムアウト・リトライ契約 & 状態遷移マトリクス)

### (1) 採用するタイムアウト・リトライ確定値
現行実装の実測・制約から導出した確定値を規定する。

| レイヤー | 処理内容 | タイムアウト値 | リトライ上限 | バックオフ間隔・方式 | 根拠・技術的理由 |
|---|---|---|---|---|---|
| **Hアプリ API** | 通常の POST API 呼出 (`modules/api.js`) | **90,000ms (90秒)** | **3回** | **1s → 2s → 4s** (係数 2.0) | GAS のコールドスタート（数秒〜十数秒）および写真アップロード処理を吸収するため。 |
| **Hアプリ キュー** | オフライン同期キュー (`db.js`) | 各送信に準拠 | **5回** | **10s → 30s → 60s → 60s → 60s** | 現場の電波途切れ・トンネル通過からの緩やかな復帰に適合。 |
| **Manager API** | ダッシュボード集計取得 (`manager.js`) | **25,000ms (25秒)** | 0回 (単発) | なし (手動再読込) | 管理者が画面上で即時エラーを把握できるようにするため。 |
| **Manager 認証** | 管理者パスワード検証 | **45,000ms (45秒)** | 0回 (単発) | なし | Script Properties のハッシュ検証処理。 |
| **Backend ロック** | スクリプト悲観ロック (`GPSService.js`) | **15,000ms (15秒)** | - | 即時 503 返却 | GAS の実行時間制限（最大6分）を浪費させずクライアントへ速やかに再試行を促すため。 |

### (2) Error Code / HTTP Status → Retryable → State Transition 対応マトリクス

| エラーコード | HTTP相当 | エラー分類 | retryable | 発生要因・具体例 | 次の状態遷移 (Hアプリ) | クライアントのアクション |
|---|---|---|---|---|---|---|
| `LOCK_TIMEOUT` | 503 | TRANSIENT | **true** | 他端末リクエスト競合で15秒間ロック獲得失敗 | `SENDING` → `RETRY_WAIT` | 指数バックオフ待機後に自動再送（最大5回） |
| `RATE_LIMIT_EXCEEDED`| 429 | TRANSIENT | **true** | Google 基盤クォータ超過 (UrlFetch等) | `SENDING` → `RETRY_WAIT` | 長期バックオフ（60秒〜）後に自動再送 |
| `NETWORK_FAILURE` | 0 / timeout | TRANSIENT | **true** | 端末圏外、DNS失敗、AbortController(90秒)到達 | `SENDING` → `RETRY_WAIT` (オフライン時は `QUEUED`) | オンライン復帰イベント検知で自動再送 |
| `INTERNAL_ERROR` | 500 | TRANSIENT | **true** | GAS 実行時例外、一時的な Google Drive 障害 | `SENDING` → `RETRY_WAIT` | 指数バックオフ待機後に自動再送 |
| `INVALID_ARGUMENT` | 400 | PERMANENT | **false** | `rowId`, `count` 等の型・境界値違反 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。UI警告表示、入力値修正 |
| `MALFORMED_JSON` | 400 | PERMANENT | **false** | リクエストボディの JSON パース失敗 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。通信ペイロード構築不具合 |
| `UNAUTHORIZED` | 401 | PERMANENT | **false** | `liffToken` 欠落、署名不正、有効期限切れ | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。LIFF 再ログイン画面へ誘導 |
| `NOT_REGISTERED` | 403 | PERMANENT | **false** | LINE User ID が名簿の原本に未登録 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。初回名簿登録画面へ誘導 |
| `FORBIDDEN` | 403 | PERMANENT | **false** | 管理者パスワード不一致、禁止APIへの呼出 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。権限エラーモーダル表示 |
| `RESOURCE_NOT_FOUND` | 404 | PERMANENT | **false** | 指定スプレッドシートやフォルダが存在しない | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。システム設定・構成の確認 |
| `CONTRACT_EXPIRED` | 403 | PERMANENT | **false** | システム契約期間満了 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。利用終了画面表示 |

---

## 16. Offline / Synchronization (オフライン同期・永続化保証)

1. **ローカル永続化**:
   - ブラウザ標準の **IndexedDB (`PostingMapDB` / `syncQueue`)** を使用。
   - 電波圏外であっても、完了操作を行った瞬間にローカルキューへ即時永続化され、UI 上は「保存完了（送信待ち）」となる。
2. **写真データの退避**:
   - カメラ撮影した証跡写真（Base64）も `syncQueue` レコード内に直接保持する。
   - ブラウザのリロードや端末再起動が発生しても、未送信データは一切消失しない。
3. **自動同期エンジン**:
   - `window.addEventListener('online', processQueue)` により、ネットワーク復帰を検知してバックグラウンドで自動同期を開始する。

---

## 17. SSOT / Reconciliation (真実の情報源と不整合調停)

### (1) データ別 SSOT (真実の単一情報源) 台帳

| データ種別 | SSOT の所在 | キャッシュ / 一時情報の所在 | 採用ルール |
|---|---|---|---|
| **配布実績 (DistributionRecord)** | **Spreadsheet (`配布実績YYYY-MM`)** | Hアプリ `cityAreaCache`, IndexedDB | **Database が絶対SSOT**。「LocalStorageにあるから正しい」という設計を完全排除。 |
| **配布員名簿 (StaffIdentity)** | **Spreadsheet (`名簿の原本`)** | Hアプリ `localStorage.user_info` | **Database が絶対SSOT**。端末キャッシュは先行表示用の一時情報に過ぎない。 |
| **活動対象地域 (TargetRegion)** | **CSV (`data/address_master.csv`)** | Hアプリ `pinsCache` | **リポジトリ内マスターデータが絶対SSOT**。 |
| **個人ランキング (RankingSummary)**| **Backend 動的集計エンジン** | Hアプリ `window._myRankingSummary` | **Backend が絶対SSOT**。配布実績の最新合計から随時計算。 |

### (2) 不整合調停 (Reconciliation) ポリシー
- **クライアント vs サーバーの競合**: 常に **サーバー（Spreadsheet）の確定値を優先（Server Wins）** する。
- **キュー滞留データとサーバーデータの重複**:
  - 同一 `requestId` を持つタスクがサーバー側ですでに保存完了となっている場合、ローカルキューを正常完了として破棄する。

---

## 18. Security (セキュリティ契約)

1. **通信経路保護**:
   - すべての通信を TLS 1.2 以上で暗号化。HTTP 通信は Google Apps Script 基盤により自動遮断される。
2. **トークン露出の完全防止**:
   - `liffToken` を GET クエリ文字列として送信することはアーキテクチャ上禁止。検知した場合は `v2_api.js` により即座にエラー返却。
3. **機密情報の秘匿**:
   - `lineUserId` は API レスポンス（Hアプリ、Dashboard）に一切露出させない。
4. **インジェクション対策**:
   - スプレッドシート追記時、先頭文字が `=`, `+`, `-`, `@` で始まる入力値はエスケープし、数式インジェクション（CSV Formula Injection）を防止。
   - 写真ファイル名および表示名に含まれるファイルシステム不正文字（`\ / : * ? " < > |` および空白）をアンダースコア `_` にサニタイズ。

---

## 19. Structured Logging / Traceability (構造化ログ・追跡性)

すべての API リクエストおよびトランザクション処理は、以下の構造化 JSON 形式でログを出力する。

### (1) ログ出力フォーマット
```json
{
  "timestamp": "2026-09-22T18:30:00.123Z",
  "traceId": "req_550e8400-e29b-41d4-a716-446655440000",
  "action": "updateRecordWithGPSPhoto",
  "authenticatedStaffId": "STF-24205-001",
  "subjectHash": "sha256_7a8b9c...",
  "rowId": 142,
  "count": 350,
  "latencyMs": 1250,
  "result": "SUCCESS",
  "errorCode": null
}
```

### (2) 機密情報マスキング契約
- ❌ `lineUserId`, `liffToken`, 電話番号, パスワード等の個人機密情報は**ログへの平文出力を絶対禁止**。
- 監査追跡が必要な場合は、SHA-256 でハッシュ化した `subjectHash` または解決済み `staffId` を使用する。

---

## 20. Monitoring / Audit (監視・監査運用設計)

### (1) 監視項目および閾値

| 監視対象 | 監視指標 | 警戒閾値 | 確認手段 |
|---|---|---|---|
| **可用性 (Availability)** | API 成功率 (`success: true` の割合) | < 99.0% | Google Cloud Logging |
| **排他混雑** | `LOCK_TIMEOUT` 発生頻度 | > 5回 / 10分 | GAS 実行ログ |
| **遅延 (Latency)** | API 応答時間 (P95) | > 10,000ms | Cloud Monitoring / デバッグログ |
| **端末同期待ち** | `syncQueue` 滞留件数 (端末側) | > 10件 | Hアプリ デバッグパネル |
| **クォータ消費** | `UrlFetchApp` 呼出回数 | > 15,000回 / 日 | Google Workspace 管理コンソール |

### (2) 障害検知・確認体制
- **一次検知**: Hアプリ利用者の画面アラート、およびデバッグパネルの同期待ち警告。
- **ログ確認先**: Google Apps Script ダッシュボードの「実行ログ」および Google Cloud Logging。
- **確認担当**: 支部システム管理者。

---

## 21. Versioning / Backward Compatibility (バージョニング・後方互換性)

1. **URL 不変原則**:
   - Universal POSTING MAP では、エンドポイント URL を頻繁に変更せず、単一の Web App URL を継続利用する。
2. **後方互換性契約**:
   - 新規フィールドの追加時は、必ずデフォルト値を設定し、旧バージョンの Hアプリからの送信（フィールド欠落）でもエラーとしない。
   - レガシーな列構成のスプレッドシート（P列が存在しない等）を受信した場合でも、フォールバック処理により安全に動作を継続する。

---

## 22. Rollback / Recovery (ロールバック・障害復旧手順)

### (1) API / GAS デプロイ障害時のロールバック
1. Google Apps Script エディタの「デプロイ」→「デプロイを管理」を開く。
2. 障害の発生したアクティブデプロイの編集を選択。
3. バージョン選択ドロップダウンにて「正常稼働していた直前のバージョン番号」を選択して保存。
4. これにより、**コード変更なしに数分以内で直前安定版へロールバック**が完了する。

### (2) スプレッドシート データ破損時のリカバリ
1. Google Spreadsheet の「ファイル」→「変更履歴」→「版の履歴を表示」を開く。
2. 誤操作またはデータ破損が発生する直前の版を選択し、「この版を復元」を実行。
3. 必要に応じて、バックアップ原本（`名簿の原本`, `保有チラシ枚数の原本`）から当月シートを再生成。

---

## 23. RPO / RTO (目標復旧地点・目標復旧時間)

根拠のない数値を独断で設定することを禁止し、現行の Google Cloud / Google Workspace インフラ構成に基づく客観的評価として規定する。

| 指標 | 判定・目標値 | 根拠・制約事項 |
|---|---|---|
| **RPO (Recovery Point Objective)** | **【未決定 (要運用合意)】**<br>※基盤実力値: 直前数分以内 | Google Spreadsheet の自動版履歴機能により通常は直前の変更まで保持される。ただし、広域障害時の復元保証は Google Workspace SLA (99.9%) に準拠。 |
| **RTO (Recovery Time Objective)** | **【未決定 (要運用合意)】**<br>※基盤実力値: 15分〜2時間 | GAS バージョンロールバックは 5分以内で可能。スプレッドシートの手動過去版復元および整合性チェックは 1〜2時間程度を想定。 |

---

## 24. AI Agent & MCP Governance (AIエージェント・MCP実行ガバナンス契約)

Universal POSTING MAP の開発・保守・監査・運用において稼働する AI Agent および Model Context Protocol (MCP) ツールの実行統制モデルを規定する。

> **注記**: 本章はガバナンス設計契約を規定するものであり、Gate 3 において MCP 設定ファイル（`mcp_config.json` 等）や MCP サーバーの新規実装を行うものではない。

### (1) MCP Architecture & System Topology
- **クライアント**: Antigravity IDE / CLI / Subagent Engine
- **プロトコル**: Model Context Protocol (MCP) JSON-RPC 2.0
- **アーキテクチャ分離**: Tool Client ↔ MCP Gateway / Proxy ↔ Workspace Tools / External API

### (2) Agent Roles & 役割分離 (Role Separation)
AI エージェントは単一の全能権限を持たず、責務に応じた以下の厳格なロールに分離される。

| エージェントロール | 主な責務 | 許可ツール権限 | 禁止操作 |
|---|---|---|---|
| **`security-auditor`** | 権限境界、認証境界、Gate -1、秘密情報漏洩の検査・監査 | **READ ONLY** (`view_file`, `grep_search`, `list_dir`) | すべてのファイル編集・コマンド実行・Git操作 |
| **`builder` / `developer`** | 設計書およびコードの実装、ローカルビルド、単体テスト | **Workspace WRITE** (`replace_file_content`, `run_command` [sandboxed]) | 本番デプロイ、他地区探索、Git Push |
| **`release-deployer`** | デプロイ前検証、Git Push、本番リリース管理 | **DEPLOY & PUSH** (MASTER 承認必須) | 計画なき独断デプロイ、コード改変 |

### (3) Tool Registry & Versioning
- 全 MCP ツールは一元的な Tool Registry に登録され、ツール名、引数スキーマ、権限レベル、セマンティックバージョンが固定される。
- 未登録ツールの動的呼出は禁止。

### (4) Least Privilege & READ / WRITE Separation
- **最小権限の原則 (Least Privilege)**: タスクの目的に必要な最小限のツールのみをエージェントに公開する。
- **読み書きのフェーズ分離**: 探索・調査・監査フェーズでは WRITE ツールを一切提供せず、READ ツールのみで実行する。

### (5) Workspace Boundary (リポジトリ境界・他地区参照禁止【永久原則】)
- リポジトリの Git root（`/Volumes/SSD_DATA/posting-map-universal`）を操作・探索の絶対境界とする。
- SSD 上に存在する他地区（OKAYAMA-02, KUWANA 等）のリポジトリやフォルダーへの参照・探索・実行は、MCP レベルで強制遮断される。

### (6) Secret Isolation & Masking
- `lineUserId`, `liffId`, `gasWebAppUrl`, デプロイトークン等の秘密情報は、MCP ツールの入出力および実行ログから自動的にマスキングされる。

### (7) PreToolUse Hard Block & Destructive Operation Protection
- MCP ツール実行直前のフックにおいて、以下の危険操作を検知した場合は即時 **HARD BLOCK (実行停止)** とする：
  1. `rm -rf`, `git reset --hard`, `git clean -fd` などの破壊的コマンド。
  2. `git push --force` などの履歴破壊コマンド。
  3. リポジトリ境界外（`../` 等）を対象とするファイル読み書き。
  4. 計画未承認状態での `active/` や `data/` 配下のファイル編集。

### (8) Human-in-the-Loop & Auto Approval Policy
- **自動承認 (Auto Approval)**: 読み取り系ツール（ファイル閲覧、検索、ディレクトリ一覧）および安全なサンドボックス内テストコマンドのみに限定。
- **人間による承認必須 (Human-in-the-Loop)**:
  - ファイル変更（コード編集）
  - Git Commit / Push
  - 本番リソースアクセス / デプロイ
  これらは必ず MASTER（人間）の明示的承認をブロックモーダルで要求する。

### (9) Production Access Control
- 本番 Google Apps Script、本番 Google Spreadsheet、LINE Official Account 本番設定に対する AI エージェントの直接的な書き込み・変更権限は原則付与しない。

### (10) Tool Timeout & Concurrency Limit
- **ツールタイムアウト**: MCP ツール呼び出しごとに最大タイムアウトを設定（コマンド実行: 30秒、ファイル操作: 10秒）。応答なき場合は強制切断。
- **並行度制限 (Concurrency Limit)**: 同一ワークスペースに対する並行編集ツール呼び出しを 1 に制限し、レースコンディションを排除。

### (11) MCP Failure & Fail-safe Policy
- MCP 接続切断、プロキシタイムアウト、またはツール実行失敗が発生した場合、AI エージェントは「推測による作業続行」を禁止し、**即座に作業を中断して MASTER へ報告（Fail-safe STOP）** する。

### (12) Structured Audit Log & Traceability
- すべての MCP ツール呼び出しは、`timestamp`, `agentRole`, `toolName`, `sanitizedArgs`, `durationMs`, `result` を含めて JSON 形式で監査ログに記録され、完全な追跡可能性を担保する。

### (13) Agent Session Isolation
- エージェントのセッション状態はメモリ上に隔離され、別セッションや過去タスクの不要な状態（ゾンビ変数）を引き継がない。

### (14) Commit / Push / Deploy Governance (8-Stage Protocol 連動)
- Commit, Push, Deploy は必ず「8-Stage Protocol（実装→テスト→差分照合→コミット→プッシュ→デプロイ→本番検証）」に従い、事前宣言・差分確認・Gate -1 8/8 PASS を経て、MASTER 承認を得た場合のみ実行を許可する。

---

## 25. 未確定事項 (Unconfirmed Items)

以下の項目は、運用方針、通信費用、またはプライバシー保護方針が現在確定していないため、勝手に仕様化・実装せず「未確定事項」として明記する。

1. **他党員の個別配布実績のHアプリ一般公開**:
   - プライバシー保護および自律的活動の観点から、Gate 3 時点では「非公開」を維持。
2. **掲示板（Bulletin）の自動削除期間（TTL）の運用値**:
   - 30日または90日等の具体的アーカイブ期間は未決定。
3. **チラシ受渡要請における LINE Push 通知のクォータ上限運用**:
   - Messaging API の月間無償送信枠（200通/月）と有償枠の運用合意は未決定。
4. **GeoJSON 境界データのモバイル向け Simplify 許容誤差**:
   - 回線細い現場での描画速度向上に向けた具体的頂点間引き率は未決定。

---

## 26. 現行実装との対比・GAP分析 (EXISTING / REQUIRED / GAP)

Gate 3 で策定した設計契約と、現行コードベース（`active/`）の実装状況を厳密に対比し、差異（GAP）を分類する。**なお、Gate 3 では実装を行わない（READ / AUDIT / DESIGN / DOC ONLY）。**

| 分類 | 項目名 | 現行コードベース (`active/`) の実態 | Gate 3 設計契約の要求 | GAP 分析と今後の対応 |
|---|---|---|---|---|
| **EXISTING** | GAS 排他ロック制御 | `GPSService.js` にて `LockService.getScriptLock().waitLock(15000)` 実装済。 | 15秒悲観ロックの維持。 | **完全整合 (GAPなし)** |
| **EXISTING** | LINE Token 認証 | `auth.js` にて LINE Profile API 照合および 30分キャッシュ実装済。 | トークン検証とキャッシュの維持。 | **完全整合 (GAPなし)** |
| **EXISTING** | オフライン同期キュー | `db.js` にて IndexedDB (`PostingMapDB`) と指数バックオフ (10s〜60s) 実装済。 | 端末内ローカル退避と自動同期の維持。 | **完全整合 (GAPなし)** |
| **EXISTING** | 原本＋月次シート運用 | `MonthlySheetResolver` により `配布実績YYYY-MM` を動的解決して更新。 | 月次シート分割の継承。 | **完全整合 (GAPなし)** |
| **REQUIRED** | 操作単位の `requestId` 冪等性保証 | 現在は同一 `rowId` かつ GPS OK / 写真 OK で一律更新スキップ。`requestId` の照合未永続化。 | `requestId` による同一操作の重複排除と、**正当な再配布（異なる `requestId`）の完全受容**。 | **【GAPあり】**: 将来のBackend実装フェーズにおいて、`rowId` による一律スキップを廃止し、`requestId` 照合による真の冪等性制御への改修が必要。 |
| **REQUIRED** | 構造化ログ出力 | 現在は `console.log` によるテキストログ出力が中心。 | JSON 形式による構造化ログ（`traceId`, `latencyMs` 等）。 | **【GAPあり】**: 将来のロギング強化フェーズにて JSON 出力ラッパーの導入が必要。 |
| **REQUIRED** | 厳格な境界値チェック | 現在は `rowIdNum < 1` 判定のみ。極端な枚数（> 10,000）のバリデーションは未実装。 | `INVALID_COUNT` 等の厳格な業務バリデーション。 | **【GAPあり】**: 将来のバリデーション層強化フェーズにて実装を検討。 |
| **REQUIRED** | AI Agent / MCP ガバナンス | 現時点ではリポジトリ共通ルール（`AGENTS.md`）のみ存在。 | MCP レベルでの最小権限・READ/WRITE分離・PreToolUse遮断の設計契約。 | **【GAPあり】**: 将来の MCP エージェント基盤導入フェーズにおいて、本契約に沿ったサーバー・プロキシ構成を適用。 |

---
**Gate 3 API設計書 策定完了**

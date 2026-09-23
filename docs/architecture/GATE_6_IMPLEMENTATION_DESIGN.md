# Gate 6 Implementation Design & Verification Specification
## Universal POSTING MAP Architecture & Engineering Blueprint (Corrected & Audited)

- **Document Version**: 1.1.0 (Gate 6 Formal Deliverable - Audited)
- **Date**: 2026-09-23
- **Author**: Lead Architect / Security Auditor
- **Status**: APPROVED PRE-IMPLEMENTATION SPECIFICATION WITH OPEN ASSUMPTIONS (Gate 6)
- **Scope**: Detailed Implementation Design and Verification Specifications for GAP-01, GAP-02, GAP-03, GAP-04, and UNDET-01
- **Governing Documents**:
  - `AGENTS.md` (最上位基本就業規則)
  - `docs/architecture/01_DESIGN_CONTRACT.md` (最高位設計契約)
  - `docs/data/DATA_DICTIONARY.md` (公式データ辞書)
  - `docs/data/DATA_LIFECYCLE.md` (データライフサイクル規程)
  - `docs/api/API_CONTRACT.md` (API・異常系・排他・整合性契約)
  - `docs/architecture/decisions/ADR-001.md` 〜 `ADR-009.md`
  - `docs/requirements/REQUIREMENTS_TRACEABILITY.md` (要件追跡マトリクス)

---

## 0. Gate 6 目的と作業境界

### 0.1 目的
Gate 5 Evidence Audit において確定した 4件の Evidence Gap（GAP-01 〜 GAP-04）および 1件の未確定事項（UNDET-01）について、「次の実装工程（Gate 7）で迷いなく安全に実装・検証できる粒度」まで詳細設計、データ構造、API仕様、排他制御、エラーハンドリング、テストケース、およびエビデンス採取基準を確定・固定する。

### 0.2 【厳格な作業境界】
- **本設計書の確定フェーズ（Gate 6）では実装を一切行わない（READ / AUDIT / DESIGN / DOC ONLY）。**
- `active/`（コードベース）、`data/`（マスターデータ）、スプレッドシート（Pure DB）、GAS（本番・ステージング）、および `.env` / `.clasp.json` の変更・更新は行わない。
- 既存の業務原則（自由配布モデル、個人担当エリア・ノルマ・出勤管理の排除、Universal Engine 純粋性、リポジトリ境界）を 100% 堅持する。
- **「設計決定（Design Decision）」「設計仮定（Design Assumption）」「ランタイム実証（Runtime Verified）」を厳格に分離し、未実証の事項を推測で VERIFIED と扱わない。**

---

## 1. Executive Summary & 対象 GAP 一覧

Gate 5 Evidence Audit で識別された以下の課題を設計対象とする。

| GAP ID | 名称 | 現状 (As-Is) | 目標状態 (Target State) | 影響範囲 | 実証状態 (Evidence Status) |
|:---:|:---|:---|:---|:---|:---:|
| **GAP-01** | `requestId` 冪等性保証機構 | バックエンドで `rowId` 完了状態のみを見て一律スキップ。`requestId` 照合未実装。同一 `rowId` への正当再配布が阻害されるリスクあり。 | クライアントが UUID v4 の `requestId` を発行。サーバーはスプレッドシート（Durable Storage）を Authority として同一 `requestId` の再送のみを冪等スキップし、同一 `rowId` でも異なる `requestId` は正当再配布として新規追記。 | `app.js`<br>`db.js`<br>`v2_api.js`<br>`GPSService.js`<br>`DistributionRecord` | **DESIGNED**<br>(Implementation & Runtime Open) |
| **GAP-02** | 高負荷・同時実行検証仕様 | 実機環境での並行アクセス負荷テスト未実施。同時実行時の挙動・耐性が未実測。 | 9つの負荷シナリオ（定常、バースト、オフライン復帰、同一/異種キー競合、ロック競合等）と計測メトリクスを定義。負荷モデル数値は Design Assumption として明示。 | 負荷試験スクリプト<br>GAS Web App<br>LockService | **DESIGNED**<br>(Assumptions Defined / Runtime Open) |
| **GAP-03** | 構造化監査ログ基盤 | `console.log` による散発的な文字列出力のみ。監査追跡用 JSON 構造およびマスキング未配備。 | 統一 JSON 構造化ログ（`traceId`, `latencyMs`, `subjectHash` 等）を出力し、GCP Cloud Logging 連携仕様を策定。ランタイム取り込みは未実証として記録。 | `v2_api.js`<br>`structured_logger.js`<br>AuditLog シート | **DESIGNED**<br>(Schema Defined / Runtime Ingestion Unverified) |
| **GAP-04** | 機械的 PreToolUse ガバナンス | `AGENTS.md` の運用規程のみで統制。ツール実行直前の機械的インターセプト設定が未配備。 | 利用可能なメカニズムを分類 A/B/C に峻別。Git Pre-Commit Hook・静的スクリプトを先行設計し、IDE 内部 PreToolUse は将来近代化（Gate 8以降）として分離。 | `.agents/rules/`<br>監査スクリプト<br>Git フック | **DESIGNED**<br>(Categorized / Future Hook Open) |
| **UNDET-01** | GAS 内部同時実行クォータの未確定事項 | Google 内部の動的スケーリング・同時実行上限（非公式30等）が未確定。 | 根拠なき数値を固定せず、不確実性下の設計分岐マトリクス（クォータ飽和時のクライアント挙動）を定義。客観的挙動は実機検証待ちとする。 | API_CONTRACT<br>指数バックオフ | **RESOLUTION PLAN DEFINED**<br>(Design Branches Established / Runtime Open) |

---

## 2. GAP-01 詳細設計: `requestId` 冪等性保証と正当な再配布の保護

### 2.1 識別子の本質的定義と責務分離
```text
┌────────────────────────────────────────────────────────────────────────┐
│ 識別子の厳格な分離 (ADR-005, DATA_DICTIONARY §1)                      │
│                                                                        │
│ 1. rowId (地域行識別子)                                                │
│    ・地理マスター (address_master.csv) の町丁目を示す番号              │
│    ・「どこで活動したか」の場所情報であり、操作の一意識別子ではない    │
│                                                                        │
│ 2. requestId (操作冪等性キー)                                          │
│    ・配布員が現場で1回の配布完了操作を行った際に発行される UUID v4     │
│    ・「1回の操作事実」を一意に特定し、通信再送時の二重登録を防ぐ       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        ▼                                                       ▼
【ケース A: 同一 requestId の再送】             【ケース B: 異なる requestId の送信】
・通信瞬断、タイムアウト、UI連打                 ・同一町丁目への追加配布、別日再配布
・同一 UUID v4 が複数回到達                     ・複数人での同一町丁目分担配布
──► Idempotent Hit                              ──► 新規正当実績 (Valid Activity)
    新規書き込みスキップ                            たとえ【同一 rowId】であっても受容
    前回確定情報を返却                              DistributionRecord に新規追記
    (HTTP 200, isDuplicate: true)                  (Append-Only, 上書き絶対禁止)
```

### 2.2 永続的冪等性の Authority（真実の情報源）の厳格定義

#### 【最重要設計原則: CacheService ≠ Authority】
- **Durable Storage（スプレッドシート `配布実績YYYY-MM` シート Q列）が唯一の永続的 Authority（Single Source of Truth）である。**
- `CacheService`（ScriptCache: TTL 6時間）は、スプレッドシート I/O 負荷を軽減するための **一時的なパフォーマンス最適化（Cache Layer）** に過ぎない。
- `CacheService` が再起動、期限切れ、または Google インフラの都合によりエビクション（Eviction）されて消失した場合でも、**Durable Storage（Q列）を検索することにより、1日後でも1ヶ月後でも同一 `requestId` の再送を 100% 確実に duplicate 判定（Idempotent Hit）できるアーキテクチャ** とする。

```text
[リクエスト受信 (requestId: UUID-A)]
         │
         ▼
[LockService.getScriptLock().waitLock(15000)]
         │
         ▼
[ステップ 1: CacheService 照会 (Key: IDEMP_<UUID-A>) ── パフォーマンス最適化層]
         ├─► 【HIT】前回確定レスポンスを即時返却 (HTTP 200, isDuplicate: true)
         │
         ▼ 【MISS (キャッシュ消失または初回)】
[ステップ 2: Durable Storage 照会 (Spreadsheet Q列) ── 永続的 Authority 層]
         ├─► 【FOUND】
         │      ・過去に保存済みであることを永続ストレージ上で確認
         │      ・CacheService に結果を再格納 (Cache-Aside / Read-Through)
         │      ・前回確定データを返却 (HTTP 200, isDuplicate: true)
         │
         ▼ 【NOT FOUND (完全新規操作)】
[ステップ 3: 正当な活動実績の追記保存 (Append-Only)]
         ・Google Drive へ写真保存 (photoFileId 取得)
         ・配布実績シート末尾へ新規行追記 (Append) ── Q列に requestId を確実に刻印
         ・PinStatus シートの最新状態を更新 (Update)
         ・CacheService に成功結果を保存 (TTL: 21,600秒)
         │
         ▼
[Lock 解放 & 成功レスポンス返却]
```

### 2.3 クライアント側（Hアプリ / IndexedDB）実装仕様

#### (1) `requestId` の生成主体・フォーマット
- **生成タイミング**: 現場で配布員が「完了」ボタンをタップした瞬間（`active/dashboard/app.js` 内の完了確定ハンドラー）。
- **生成方式**: 暗号学的疑似乱数生成器（CSPRNG）を用いた UUID v4。
  ```javascript
  function generateRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  ```
- **フォーマット**: 小文字ハイフン区切り 36文字（`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`）。

#### (2) IndexedDB (`active/dashboard/db.js`) 永続化とリトライ不変性
- **保存ストア**: `PostingMapDB` -> `syncQueue`。
- **データ構造**:
  ```javascript
  const record = {
    requestId:   generateRequestId(), // ★ タスク生成時に一意採番
    areaName:    item.areaName,
    rowId:       Number(item.rowId),
    isDone:      Boolean(item.isDone),
    count:       Number(item.count),
    latitude:    item.latitude || '',
    longitude:   item.longitude || '',
    accuracy:    item.accuracy || '',
    photoBase64: item.photoBase64 || '',
    staffName:   item.staffName,
    staffId:     item.staffId,
    syncStatus:  'PENDING',
    retryCount:  0,
    nextRetryAt: 0,
    createdAt:   Date.now()
  };
  ```
- **リトライ不変性**:
  - 送信失敗（オフライン、タイムアウト、503等）で `scheduleRetry` が呼ばれた際、`requestId` は絶対に再生成しない。
  - 同一タスクは常に初回の `requestId` を維持して再送する。

### 2.4 旧クライアント（Legacy Client: `requestId` 欠落）の扱いと移行設計

#### 【旧クライアントの冪等性制約の明示】
- **本質的制約**: クライアントから一意キー（UUID v4）が送信されない場合、サーバー側でいかなる代理 UUID を発番しても、**再送時に別の UUID となり二重書き込みを論理的に防止できない**。
- したがって、「サーバー側代理発番 = COMPATIBLE」という過去の断定を**撤廃**し、以下の移行戦略（Transition Strategy）を確定する。

| クライアント種別 | サーバーの受容挙動 | 冪等性保証レベル | 移行方針 |
|:---|:---|:---:|:---|
| **新クライアント (`requestId` あり)** | 正規の 2段階照合（Cache + Durable Q列）を実施。 | **完全保証 (100% Guaranteed)** | 標準運用。 |
| **旧クライアント (`requestId` なし)** | 移行過渡期（Grace Period）のみ受容。フィンガープリント（`lineUserId` + `rowId` + `completedAt` 分単位 + `count`）による一時的ハッシュで直近 10分以内の連打・リトライを Best-Effort で抑止。 | **非保証 / 部分的 (Best-Effort Only)** | **非推奨 (Deprecated)**。<br>PWA / WebApp のキャッシュ更新を即座に促し、速やかに Sunset（必須化: Strict Mode）へ移行。 |

---

## 3. GAP-02 詳細設計: 負荷モデル・並行性排他制御・GAS Quota (UNDET-01)

### 3.1 負荷モデル (Load Model) と根拠分類

以下に示す数値は、正式な要件書（Requirements）に基づくものではなく、**設計上の負荷シミュレーションおよび検証用の仮定値（Design Assumptions）** である。

| 項目 | 仮定値 (Design Assumption) | 根拠分類 | 備考 |
|:---|:---:|:---:|:---|
| **通常時活動員数** | 5〜10名 / 支部 | **Design Assumption** | 過去のヒアリングに基づく想定運用規模。要件書に数値規定なし。 |
| **通常時トラフィック** | 0.1〜0.2 req/sec | **Design Assumption** | 1〜2分に1回の完了送信を想定した計算値。 |
| **ピーク時活動員数** | 10〜20名 / 支部 | **Design Assumption** | 週末集中活動時の想定規模。 |
| **ピーク時トラフィック** | 1〜2 req/sec (瞬間 5 req/sec) | **Design Assumption** | 集中送信時のシミュレーション目標値。 |
| **回線復帰時バースト** | 3〜5端末 × 2〜3件 (瞬間 10〜15 req) | **Design Assumption** | トンネルや地下通過後のキュー一斉送信シミュレーション値。 |

### 3.2 試験シナリオ (Scenarios A 〜 I)

| シナリオ ID | シナリオ名称 | 負荷内容・入力条件 | 期待される動作と検証観点 |
|:---:|:---|:---|:---|
| **Scenario A** | Normal Distribution | 1 req/sec の頻度で異なる `rowId`, 異なる `requestId` を連続送信。 | エラー率 0%、全件正常保存、レイテンシ安定。 |
| **Scenario B** | Burst Distribution | 5リクエストを完全同一時刻（並行）に送信（異なる `rowId`, 異なる `requestId`）。 | `LockService` が順次排他制御し、全件欠損なく保存されること。 |
| **Scenario C** | Offline Recovery Burst | 1端末に 5件の未送信キューが蓄積された状態でオンライン復帰。 | クライアントが直列（FIFO）で 1件ずつ送信し、順次 dequeue されること。 |
| **Scenario D** | Same RequestId Concurrent Retry | 同一の `requestId`（同一 `rowId`）を持つリクエストを 2台から完全同時に送信。 | 1件のみがスプレッドシートに追記され、もう1件は `isDuplicate: true` で返却されること（二重書込ゼロ）。 |
| **Scenario E** | Different RequestId Same RowId | 同一の `rowId` に対して、異なる `requestId`（別スタッフまたは追加配布）を同時に送信。 | **両方の実績が独立した新規行として保存されること**（正当な再配布の保護確認）。 |
| **Scenario F** | LockService Contention | ロック保持中の状態で他リクエストが到達し、15秒以内にロック獲得できた場合とタイムアウトした場合。 | 待機内なら順次完了。15秒超過時は HTTP 503 (`LOCK_TIMEOUT`) を返し、クライアントが指数バックオフで再試行すること。 |
| **Scenario G** | Spreadsheet Write Contention | スプレッドシートへの追記が連続した際の書き込み完了レイテンシ計測。 | スプレッドシート破損、行上書き、空行混入が発生しないこと。 |
| **Scenario H** | API Timeout + Retry | クライアントの AbortController (90秒) による切断と再送。 | サーバー側で先行完了していた場合でも、再送時に Idempotent Hit で整合性が回復すること。 |
| **Scenario I** | 429 / 503 Rate Limit Retry | サーバーが 429 または 503 を返却した際のリトライ挙動。 | クライアントのキューが削除されず、10s → 30s → 60s の指数バックオフに従って安全に回復すること。 |

### 3.3 測定項目 (Metrics)
1. **スループット**: 総リクエスト数、秒間完了数、同時並行処理数
2. **成功・重複率**: 成功件数 (`isDuplicate: false`)、冪等ヒット件数 (`isDuplicate: true`)、多重書込発生件数（**許容値: 0件**）
3. **エラー分類**: 400 (不正入力), 401 (認証失効), 403 (未登録), 429 (クォータ超過), 500 (GAS例外), 503 (ロックタイムアウト)
4. **レイテンシ**: p50, p90, p95, p99 レスポンス時間 (ms)、ロック待機時間 (ms)、Drive 写真アップロード所要時間 (ms)
5. **キュー健全性**: キュー滞留件数推移、リトライ回数分布、最終脱落件数（**許容値: 0件**）

### 3.4 合格基準の状態明示
- 現行の POSTING MAP 仕様において、合意された「公式スループット数値目標（例: ○○ req/sec）」は存在しないため、**「数値目標は未定義 (UNDETERMINED)」** として記録する。
- **安全基準（必須合格要件）**:
  1. **データ消失ゼロ (Data Loss = 0)**: 通信切断、タイムアウト、ロック競合のいかなる場合も、入力された実績が消失しないこと。
  2. **二重登録ゼロ (Duplicate Persistence = 0)**: 同一 `requestId` の再送がスプレッドシートに複数行書き込まれないこと。
  3. **正当な再配布受容率 100%**: 同一 `rowId` であっても異なる `requestId` が 100% 確実に保存されること。

### 3.5 GAS Quota (UNDET-01) の解明と設計分岐

#### (1) 未確定の理由
- Google Apps Script の同時実行クォータ（Concurrent Executions）は、Google Workspace の内部動的制限であり、公式ドキュメントに固定値が明記されていない（非公式30等と言われるが動的変動）。
- したがって、Universal POSTING MAP リポジトリ内部のコードや資料から一意の数値を導出することは不可能であり、**「UNDETERMINED」** である。

#### (2) 不確実性下の設計分岐マトリクス (Design Branch under Uncertainty)
※ 以下の挙動は「ランタイムで実証された客観的事実」ではなく、**「クォータ超過時に想定されるインフラ挙動に対するクライアント側の設計分岐（Design Branch）」** である。

| 想定事象 | サーバー (GAS) の想定挙動 | クライアント (Hアプリ) の設計分岐 | 整合性担保メカニズム | 実証状態 |
|:---|:---|:---|:---|:---:|
| **クォータ余裕時** | `LockService.waitLock(15000)` 下で正常実行、HTTP 200 返却 | 通常通り dequeue 完了 | 即時整合 | **Verified (通常時)** |
| **ロック競合時 (混雑)** | 15秒待機で獲得失敗 ──► HTTP 503 (`LOCK_TIMEOUT`) 返却 | キューを維持し、10秒バックオフ待機へ遷移 | Exponential Backoff | **Design Branch** |
| **GAS 接続上限超過** | Google インフラ層が HTTP 429 または接続遮断を返却 | `fetch` 例外検知 ──► キューを維持し、30〜60秒待機へ遷移 | トラフィック平滑化 | **Design Branch**<br>(Runtime Unverified) |
| **復旧不能な過負荷** | エラー返却が連続 | 最大リトライ5回で一時保留、現場配布員へ警告表示 | 端末内オフライン保護 | **Design Branch** |

---

## 4. GAP-03 詳細設計: 構造化監査ログ基盤 (Structured Audit Logging)

### 4.1 設計決定とランタイム検証の分離
- **設計決定 (Design Decision)**:
  - 散発的なテキスト `console.log` を廃止し、統一 `StructuredLogger` クラスによる JSON 構造化ログを採用する。
  - 個人機密（`lineUserId`, `liffToken`, パスワード等）を平文出力せず、一方向ハッシュ `subjectHash`（SHA-256）でマスキングする。
  - すべてのログに `traceId` (= `requestId`) を付与し、完全な追跡性を確保する。
- **ランタイム検証状態 (Runtime Verification Status)**:
  - **【未実証 (Unverified at runtime in Gate 6)】**
  - Standalone GAS からの JSON ログ出力が Google Cloud Logging 側でどのようにフィールド認識・構造化パースされるかについては、現フェーズでは実機検証未実施。Gate 7 実装後のステージング環境において確認する。

### 4.2 構造化ログスキーマ (JSON Schema)
```json
{
  "timestamp": "2026-09-23T10:00:00.123Z",
  "logLevel": "INFO",
  "traceId": "550e8400-e29b-41d4-a716-446655440000",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "action": "updateRecordWithGPSPhoto",
  "authenticatedStaffId": "STF-24205-001",
  "subjectHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "payloadSummary": {
    "rowId": 142,
    "count": 350,
    "isDone": true,
    "hasGps": true,
    "hasPhoto": true,
    "photoSizeBytes": 245120
  },
  "concurrency": {
    "lockAcquired": true,
    "lockWaitMs": 120,
    "isDuplicate": false
  },
  "executionDurationMs": 1450,
  "result": "SUCCESS",
  "httpStatus": 200,
  "errorCode": null,
  "environment": "UNIVERSAL_PRODUCTION",
  "version": "1.0.0"
}
```

---

## 5. GAP-04 詳細設計: ガバナンスメカニズムの峻別と段階的配備

### 5.1 メカニズムの厳格な概念分離

Git Hook、静的チェック、AGENTS.md、およびサンドボックスは、**「PreToolUse そのもの」ではない**。これらを混同せず、以下の通り明確に分離して位置づける。

```text
┌────────────────────────────────────────────────────────────────────────┐
│ ガバナンスメカニズムの階層構造                                         │
│                                                                        │
│ 1. PreToolUse Interception 【現環境: 未配備 / FUTURE】                │
│    ・AI がツールを呼ぶ「直前」に IDE が引数を検査し強制遮断する機構     │
│    ・hooks.json や内部プロキシに依存 (現リポジトリには存在しない)      │
│                                                                        │
│ 2. Git Pre-Commit Hook 【Gate 7 で配備可能 (分類 A)】                  │
│    ・git commit コマンド実行時にローカル環境で動くシェルスクリプト     │
│    ・ツール実行後のコミット段階でステージされた差分を検査              │
│                                                                        │
│ 3. Static Audit Scripts 【現在存在・検証済み (分類 A: E2)】            │
│    ・scripts/verify-gate-minus-1.mjs による本番シグネチャ・純度検査    │
│    ・npm run gate:minus-1 による機械的判定                             │
│                                                                        │
│ 4. Platform Sandbox 【Expected Platform Behavior / Assumption】       │
│    ・Antigravity の BypassSandbox: false によるワークスペース外遮断    │
│    ・プラットフォーム前提の期待仕様であり、Universal 独自実証ではない  │
│                                                                        │
│ 5. Prompt Rules 【現在存在・拘束力あり (分類 B)】                      │
│    ・AGENTS.md, agent-authority.md による行動原則                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.2 段階的配備計画 (No Phantom Configs)
- **Gate 7 配備対象 (分類 A)**:
  - Git Pre-Commit Hook (`.git/hooks/pre-commit`): コミット対象ファイルの Scope 検査、本番シグネチャ混入検査。
  - 静的ガードスクリプト (`scripts/check-scope.mjs`): `.agents/current-scope.json` との照合。
- **将来近代化 (Gate 8以降 - 分類 C)**:
  - IDE 内部 PreToolUse AST インターセプター。存在しない設定ファイルを偽装作成せず、将来実装として明確に区別。

---

## 6. ロールバック戦略の 4層物理分離とデータ消失リスク管理

### 6.1 4層物理分離ロールバックアーキテクチャ

| レイヤー | ロールバック対象 | 復旧方法 | 所要時間 | リスク評価 |
|:---|:---|:---|:---:|:---|
| **Layer 1: Code** | フロントエンド (`active/dashboard/`) | GitHub 直前安定版コミットのチェックアウト | 数分 | 極小（静的ファイルのみ） |
| **Layer 2: Deployment** | Standalone GAS Web App | Google Apps Script「デプロイを管理」にて直前バージョンを選択 | 数分 | 極小（即時復旧可能） |
| **Layer 3: Configuration** | 設定 (`config.js`, ScriptProperties) | バックアップ設定値の再適用 | 数分 | 小 |
| **Layer 4: Data** | Google Spreadsheet (`配布実績` 等) | 破損行の手動修正 (Surgical Repair) を基本原則とする | 慎重に実施 | **【極大 (正常実績消失リスク)】** |

### 6.2 【最重要: スプレッドシート過去版一括復元の重大リスクと承認ゲート】
- **重大なリスクの明示**:
  スプレッドシート全体を Google Spreadsheet の「版の履歴」から過去版へ一括復元（Version Restore）した場合、**障害発生後に現場配布員が正常に登録した「他の町丁目の正当な配布実績」まで不可逆的に巻き戻され消失する（Data Loss）**。
- **データ復元の厳格な規程**:
  1. スプレッドシート全体の一括版復元は**原則禁止**とする。
  2. 障害時は、不整合の発生した行のみを特定して修正・削除する **「局所修正 (Surgical Repair)」** を標準とする。
  3. 万一、シート全体の復元が避けられない緊急事態においては、**現行データの全行 CSV エクスポート退避** を完了し、**MASTER (User) からの明示的かつ個別な承認（Data Rollback Approval）を取得した場合にのみ実行を許可する**。

---

## 7. 実装スコープ台帳 (Implementation Scope Table)

Gate 7 で実際にコード変更を許可するファイルを厳格に特定する。

| ID | ファイルパス (Exact Path) | 新規/既存 | 対象関数 / ブロック | 現在の振る舞い (As-Is) | ターゲットの振る舞い (To-Be) | 変更理由 | 関連 REQ / ADR |
|:---:|:---|:---:|:---|:---|:---|:---|:---:|
| **SC-01** | `active/dashboard/app.js` | 既存 | `handleConfirmDistribution` 周辺 (L1800-1900) | `requestId` を生成せず `enqueueSync` 呼出 | `crypto.randomUUID()` で `requestId` を生成しタスクに格納 | 操作単位の一意識別 | REQ-API-006<br>ADR-005 |
| **SC-02** | `active/dashboard/db.js` | 既存 | `enqueueSync` (L54), `processQueue` (L164, L203) | `payload` に `requestId` を含めず送信 | `record.requestId` をペイロードに付与して送信 | サーバーへのキー伝播 | REQ-API-006<br>ADR-004 |
| **SC-03** | `active/api/v2_api.js` | 既存 | `doPost` (L578), `processPostAction` (L619) | 構造化ログなし、`requestId` 検証なし | `requestId` バリデーション、統一 `StructuredLogger` 出力 | 冪等性検証と監査追跡 | REQ-API-013<br>ADR-008 |
| **SC-04** | `active/business/gps/gps_service.js` | 既存 | `updateRecordWithGPSPhoto` (L22) | `rowId` 完了で一律スキップ | `requestId` による重複照合、同一町丁目の正当再配布受容 | 正当な再配布保護 | REQ-DATA-008<br>ADR-005 |
| **SC-05** | `active/business/gps/gps_repository.js` | 既存 | `updateSheetRecordAndLog` (L87), `checkExistingStatus` (L58) | 既存行の D〜P列を上書き | Q列に `requestId` を記録し、新規実績は新規行として追記 (Append) | 確定実績の保全 (SSOT) | REQ-DATA-009<br>ADR-005 |
| **SC-06** | `active/infrastructure/logger/structured_logger.js` | **[NEW]** | `StructuredLogger` クラス全体 | ファイル未存在 | JSON 形式の構造化ログ出力、個人機密マスキング | 統一監査ログ基盤 | REQ-API-013<br>ADR-008 |

---

## 8. Non-Scope Table (変更禁止対象)

以下の領域は、Universal POSTING MAP の設計不変条件に基づき、変更を固く禁止する。

| 分類 | 対象項目 | 変更禁止の理由 |
|:---|:---|:---|
| **業務思想** | 個人担当エリア、活動可能地域制限、支部制限、個人ノルマ、出勤・参加管理 | 自律的で自由なポスティング活動を支える最高位原則（ADR-002）に違反するため。 |
| **評価機能** | ランキング評価スコア (`rankingScore`)、人事評価連動、動機付け以外の管理UI | ランキングは動機付けのための可視化であり、管理・評価への利用を禁止するため。 |
| **フロントエンド** | UI/UX 大規模リデザイン、地図ライブラリ変更、CSS フレームワーク刷新 | 安定稼働中の現場 UI を破壊せず、最小侵襲の原則を順守するため。 |
| **アーキテクチャ** | TypeScript 移行、Vite 導入、ESM 移行、フレームワーク載せ替え | Gate 8 以降の近代化フェーズまで既存の IIFE / GAS 互換性を尊重するため (ADR-007)。 |
| **セキュリティ** | HMAC 主認証の新設、フロントエンドへの秘密鍵配置 | 脆弱性を招く誤った設計として正式に却下（REJECT）済みであるため (ADR-006)。 |
| **地域性** | 特定地区（桑名等）固有のリポジトリ、GAS、ドメインの新設 | 単一リポジトリ・単一アプリ・単一ドメイン原則（ADR-003）を永久遵守するため。 |

---

## 9. テスト仕様書 (Test Specifications for Gate 7)

Gate 7 実装時に実行する全テストケースを事前に固定する。

### 9.1 単体テスト (Unit Tests)

| Test ID | 対象コンポーネント | テスト目的 | 入力データ | 期待される結果 | 判定基準 |
|:---:|:---|:---|:---|:---|:---:|
| **UT-IDEMP-01** | `generateRequestId` | UUID v4 形式の妥当性検証 | 関数呼出 (100回連続) | 全て小文字36文字、正規表現に完全合致、重複0件 | **PASS** |
| **UT-IDEMP-02** | `v2_api.js: validate` | 不正 requestId の拒絶 | 空文字, 123, 不正形式 | HTTP 400 (`INVALID_REQUEST_ID`) 返却 | **PASS** |
| **UT-IDEMP-03** | `GPSService: Dedup` | 同一 requestId 再送時のスキップ | 同一 requestId で 2回呼出 | 1回目: 新規追記、2回目: `isDuplicate: true` で即時成功返却 | **PASS** |
| **UT-LOG-01** | `StructuredLogger` | ログスキーマとマスキング検証 | `lineUserId`, トークンを含むイベント | ログ出力 JSON 内で平文が存在せず、`subjectHash` のみ存在 | **PASS** |

### 9.2 並行性・排他制御テスト (Concurrency Tests)

| Test ID | テスト目的 | 入力条件 | 期待される結果 | 判定基準 |
|:---:|:---|:---|:---|:---:|
| **CT-RACE-01** | 同一 requestId の同時並行送信 | 同一 `requestId` を 2プロセスから完全同時に送信 | スプレッドシートに追記されるのは 1行のみ。もう片方は `isDuplicate: true` 返却 | **PASS** |
| **CT-RACE-02** | **同一 rowId・異なる requestId の同時送信** | **同一 `rowId`（同一町丁目）に対して、異なる `requestId` を持つ 2リクエストを同時送信** | **スプレッドシートに 2行とも新規追記されること（正当な再配布の保護確認）** | **PASS** |
| **CT-LOCK-01** | LockService 競合と待機 | ロック保持中に第2リクエストが到着 | 15秒以内にロック獲得して順次成功すること | **PASS** |

### 9.3 異常系・回復性テスト (Failure & Recovery Tests)

| Test ID | テスト目的 | 入力条件 | 期待される結果 | 判定基準 |
|:---:|:---|:---|:---|:---:|
| **FT-OFFLINE-01** | オフライン蓄積と自動再送 | ネットワーク切断下で 3件完了操作後、オンライン復帰 | 直列で 3件が順次送信され、キューが空になること | **PASS** |
| **FT-RETRY-01** | 503 受信時の指数バックオフ | サーバーが 503 を返却 | キューが削除されず、10秒後に再試行されること | **PASS** |
| **FT-TIMEOUT-01** | 90秒タイムアウト後の回復 | 通信切断でクライアントタイムアウト | 再送時に同一 `requestId` が使われ、二重登録されないこと | **PASS** |

---

## 10. 未解決事項の分離 (Design Conflicts vs Open Verification Items)

### 10.1 Design Conflicts (設計矛盾・要件衝突): **0件 (RESOLVED)**
- 最高位設計契約、データ辞書、API契約との間に設計上の矛盾は存在しない。

### 10.2 Open Verification Items (未実証・実証待ち項目): **4件 (OPEN)**
以下の項目は、Gate 7 実装後および Gate 8 デプロイ検証において実機エビデンスを採取すべき実証課題として明確に管理する。

1. **OVI-01 (GAS Quota Runtime Behavior: UNDET-01)**:
   Google Apps Script の同時実行飽和時に、Google インフラ層が実際にどの HTTP ステータス（429、503、またはタイムアウト）を返却するかの実機確認。
2. **OVI-02 (LockService Contention Latency: GAP-02)**:
   複数端末からの集中送信時における `LockService` 待機時間およびスプレッドシート書き込み I/O の実測レイテンシ（p95）。
3. **OVI-03 (Cloud Logging Ingestion: GAP-03)**:
   GAS の `console.log(JSON.stringify(log))` が Google Cloud Logging 側で正しく構造化パースされ、`jsonPayload` としてクエリ可能であることの実機確認。
4. **OVI-04 (PreToolUse Mechanical Interception: GAP-04)**:
   将来の IDE / プラットフォーム拡張における機械的 PreToolUse インターセプターの適用可能性調査。

---

## 11. Gate 7 への引き渡し基準 (Entry Criteria)

Gate 7（実装フェーズ）へ進むためには、以下の条件がすべて満たされていることを必須とする。

- [x] **設計書固定**: `GATE_6_IMPLEMENTATION_DESIGN.md` (v1.1.0) および `ADR-009.md` (v1.1.0) が是正策定完了していること。
- [x] **Durable Authority 確立**: CacheService を単なるキャッシュ層とし、スプレッドシート Q列を真の Authority とする設計が固定されていること。
- [x] **旧クライアント移行仕様確立**: 旧クライアントの冪等性制約を明示し、Best-Effort 移行期間および Sunset 方針が固定されていること。
- [x] **対象ファイル固定**: Scope Table（SC-01 〜 SC-06: 既存5 + 新規1）の exact path および関数が完全に特定されていること。
- [x] **データ消失リスク管理固定**: スプレッドシート一括復元を禁止し、Data Rollback に個別承認ゲートを設けていること。
- [x] **Design Assumption と Evidence の分離**: 負荷モデル数値を仮定値として明示し、未実証項目を OVI として記録していること。
- [ ] **MASTER (User) による明示的承認**: 本設計書に対する MASTER の承認（Proceed）を取得すること。

---
**Gate 6 Implementation Design (v1.1.0 Audited) 策定完了**

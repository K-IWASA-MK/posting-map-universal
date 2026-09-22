# 汎用POSTING MAP 再構築 実装計画書
## Universal POSTING MAP Engineering Master Plan — Revised Unified Edition

> **本書は、汎用POSTING MAPの再構築における最上位実装計画・設計契約・実装開始ゲートを一つに統合したマスタープランである。**
>
> 本書に記載された思想・不変条件・責務境界・実装順序・検証基準を、実装者およびAI開発者が従うべき基準とする。

---

# 0. 最上位憲法

## 0.1 汎用POSTING MAPの基本単位

汎用POSTING MAPは、地域ごとに別アプリを作る製品ではない。

### 物理構成の不変条件

- **単独アプリ**
- **単独リポジトリ**
- **単独ドメイン**

この1つのPOSTING MAPを共通基盤として、地域・支部・対象地域等の差異は**データとして分離**する。

```text
                    汎用POSTING MAP
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
     単独アプリ       単独リポジトリ      単独ドメイン
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                  共通アプリケーション
                          │
             ┌────────────┴────────────┐
             │                         │
          Hアプリ                  Dashboard
        （現場活動）                （観測）
             │                         │
             └────────────┬────────────┘
                          │
                    共通API / Backend
                          │
                     共通データモデル
                          │
             ┌────────────┴────────────┐
             │                         │
          地域Aデータ                地域Bデータ
          支部・対象地域             支部・対象地域
```

### 絶対に採用しない構造

```text
地域A → 別アプリ
地域B → 別アプリ

地域A → 別リポジトリ
地域B → 別リポジトリ

地域A → 別ドメイン
地域B → 別ドメイン
```

地域展開のためにコードベースを複製する設計にはしない。

---

# 1. 再構築の目的

## 1.1 唯一の目的

本再構築は「新しいPOSTING MAPを発明する」ものではない。

現行Hアプリで確立された、

- 思想
- 利用者体験
- 基本操作
- 地域構造

を基準として継承し、後付け機能・技術的負債・バグ・暫定実装によって複雑化した内部実装を、汎用POSTING MAPとしてクリーンに再構築する。

### 継承対象

> 現行Hアプリで確立された利用者体験・思想・基本操作を基準として継承する。

### 継承しないもの

- 意図しない挙動
- バグ
- 暫定実装
- 重複ロジック
- ゾンビコード
- 技術的負債
- 管理都合によって後付けされた不適切な構造

---

# 2. AI・実装者に対する変更契約

## 2.1 最優先ルール

実装者・AI・将来の開発者が、

- 「より便利」
- 「より高度」
- 「一般的にはこうする」
- 「ついでに整理」
- 「リファクタリングした方がよい」

という理由で、本計画にない変更を行うことを禁止する。

**「改善」は変更理由にならない。**

## 2.2 実装前宣言

各実装単位では、事前に以下を明示する。

1. 対象ファイル
2. 対象関数・対象ブロック
3. 変更内容
4. 変更理由
5. 変更しない範囲
6. 関連するREQ / DESIGN / ADR
7. 検証方法

## 2.3 実装後監査

必ず以下を実施する。

- diff確認
- `git diff --check`
- 変更範囲監査
- テスト
- API境界確認
- 必要な実機確認
- 本番反映確認

新コードが旧コードを置き換える場合、旧ロジックを残して二重実装にしない。

---

# 3. POSTING MAPの利用者・責務

## 3.1 Hアプリ

**現場の党員が活動するためのアプリ。**

基本思想：

> 配布員は操作する。管理者は見る。

Hアプリでは、党員本人が自分の生活圏・都合に合わせて活動場所を選択できる。

## 3.2 Dashboard

管理者・運営側が地域全体を観測するための画面。

- PC：MAP中心のOverview
- スマートフォン：コンパクトOverview
- 詳細画面選択時：その画面を主画面化・必要に応じてFullscreen

Dashboardは現場への個別タスク割当を目的としない。

---

# 4. 党員と地域の関係

## 4.1 正しい関係

```text
LINE User ID（署名検証）
        ↓
本人（Staff Identity）
        ↓
所属支部（Branch）
        ↓
支部の活動対象地域
        ↓
本人が活動場所を選択
        ↓
活動実績
        ↓
個人ランキング
```

## 4.2 存在しない関係

```text
党員 ──×──> 担当エリア
```

党員個人に「担当エリア」は存在しない。

したがって、

- 担当エリアID
- 担当者コード
- 個人への固定エリア割当
- 担当枠

をデータモデルへ導入しない。

## 4.3 個人ランキングは存在する

個人ランキングは正式な機能として実装対象とする。

ランキングは、

- 活動実績
- 活動量
- 継続活動
- その他、正式に定義した活動指標

を可視化するための機能とする。

ただしランキングを、

- 個人ノルマ
- 強制参加
- 出勤管理
- 人事評価
- 管理者による活動強制

へ変換しない。

---

# 5. 不変条件

## INV-001：本人性

LINE User IDを本人性確認の基礎とする。

## INV-002：所属支部

所属支部はサーバー側で本人性確認後に導出する。

クライアントが送信する`branchId`を権限根拠として信用しない。

## INV-003：担当エリアなし

党員への固定担当エリア概念は存在しない。

## INV-004：個人ランキングあり

活動実績から個人ランキングを生成できる。

## INV-005：lineUserId秘匿

`lineUserId`をフロントエンドの、

- LocalStorage
- Cookie
- DOM
- URL

へ平文で露出させない。

## INV-006：オフライン継続

通信断でも現場操作を停止させない。

## INV-007：冪等性

活動登録は`clientEventId`等の冪等キーによって重複登録を防止する。

## INV-008：単独製品

POSTING MAPは単独アプリ・単独リポジトリ・単独ドメインとして維持する。

## INV-009：地域差はデータ

地域展開時の差異は、原則として地域データ・設定・マスターデータとして扱い、地域ごとにアプリコードを複製しない。

---

# 6. IN / OUT

| 領域 | IN SCOPE | OUT OF SCOPE |
|---|---|---|
| 現場活動 | 活動入口、地域MAP、ポスティング、活動ログ、物資所在情報 | 固定担当エリア、個人ノルマ、出勤管理、活動強制 |
| 個人可視化 | 活動実績、個人ランキング | 人事評価、強制順位付け |
| 位置・通信 | 最小限の操作、オフライン保持、復帰後再送 | 常時GPS、常時位置追跡、バックグラウンド監視 |
| 管理 | Dashboardによる地域全体の観測 | 個人への活動場所強制割当 |
| 製品構造 | 単独アプリ・単独repo・単独domain | 地域別アプリ・地域別repo・地域別domain |
| SNS | 必要な外部導線 | SNSそのものの代替 |

---

# 7. 責務境界

## Hアプリ

### 決めてよい

- 本人が選択した活動場所
- 本人が実施した活動事実
- 活動ログ送信

### 決めてはいけない

- 自分の所属支部
- 自分の権限
- 自分の担当エリア
- 他人の本人性

## Standalone GAS API

### 決めてよい

- 本人性
- 所属支部
- 入力検証
- 権限確認
- DB書き込み
- 冪等性
- エラー返却

### 決めてはいけない

- HTML UIの返却
- クライアント状態の勝手な強制変更

## Spreadsheet

Pure DBとして扱う。

- スクリプト内包なし
- トリガー依存なし
- 業務ロジック依存なし

## Dashboard

- 地域全体の観測
- 進捗可視化
- 物資状況
- 手薄地域等の可視化
- 個人ランキングの観測

を行う。

現場個人への固定担当割当は行わない。

---

# 8. 要件トレーサビリティ

すべての実装は、

```text
REQ
 ↓
DESIGN / INVARIANT
 ↓
UI
 ↓
API
 ↓
TEST
 ↓
EVIDENCE
```

で追跡可能にする。

上流要求に紐付かないコード追加は実装対象にしない。

---

# 9. データ設計

## 9.1 データ辞書

`docs/data/DATA_DICTIONARY.md`

全項目について以下を定義する。

- 物理名
- 論理名
- 型
- 制約
- SSOT
- 作成主体
- 更新主体
- 必須/任意
- 個人情報区分
- 保持期間
- ライフサイクル
- 関連REQ/ADR

## 9.2 基本データ

少なくとも以下を設計対象とする。

- branchId
- areaId
- activityId
- clientEventId
- clientCreatedAt
- serverReceivedAt
- Staff Identity
- 活動実績
- ランキング集計用データ

### 禁止

党員個人に固定担当エリアを持たせる列を作らない。

---

# 10. 活動ログライフサイクル

```text
未操作
 ↓
操作受付
 ↓
ローカル保存
 ↓
同期待ち
 ↓
送信中
 ├→ 送信失敗 → 同期待ち
 └→ サーバー受付
       ↓
     確定
```

恒久エラーは要確認状態へ隔離する。

---

# 11. 冪等性

端末側で活動送信ごとに一意の`clientEventId`を生成する。

サーバーは同一キーを受信した場合、

- DB二重書込をしない
- 成功として扱える場合はduplicate=true等で返却
- クライアントが安全に再送できる

ことを保証する。

---

# 12. API契約

基本プロトコル：

- HTTPS
- POST
- JSON Request / JSON Response
- Authorization
- サーバー側本人性導出
- 入力検証
- 権限検証
- 冪等性
- エラーコード
- retryable判定

実際の既存API名・実際の認証方式・実際のSpreadsheet列は、現行Hアプリ構造台帳で確認してから確定する。

本書のAPI名・フィールド名は、確定前の例示を実装仕様として扱わない。

---

# 13. 現場UX契約

1. 待たせない
2. 圏外でも止めない
3. 迷わせない
4. 疲れさせない
5. 何もしないで閉じても正常
6. 活動場所を本人が自由に選択できる
7. 操作は可能な限り少ない
8. 地図を中心にする
9. 常時監視を行わない

---

# 14. 性能契約

測定点をT0〜T5として固定する。

```text
T0 URL / LIFF起動
 ↓
T1 基本UI描画
 ↓
T2 ローカル状態・主要UI展開
 ↓
T3 地図コンテナ確定
 ↓
T4 地図・ピン操作可能
 ↓
T5 最新差分同期完了
```

目標：

- Warm Start：T2 ≤ 200ms
- Cold Start：T2 ≤ 800ms
- Offline：T2 ≤ 200ms

数値は実機計測によって検証する。

---

# 15. 障害モデル

最低限、以下を試験対象とする。

1. 通信遮断
2. APIタイムアウト
3. API 500 / GASクラッシュ
4. GASクォータ超過
5. Spreadsheet同時書込
6. 認証期限切れ
7. 地図API障害
8. ブラウザ強制終了・電池切れ
9. ストレージ圧迫
10. 同時活動
11. 重複送信

基本原則：

> 障害が発生しても、現場ユーザーの「活動した」という事実を可能な限り失わない。

---

# 16. アクセシビリティ

- 色だけに依存しない
- 状態は形状・アイコン・文字等を併用
- タップ領域は原則48px以上
- 通信状態・同期状態を誤認させない

---

# 17. ADR

`docs/architecture/decisions/`

最低限以下を管理する。

- ADR-001 LINE Identity
- ADR-002 Standalone GAS API
- ADR-003 Spreadsheet Pure DB
- ADR-004 Hアプリ / Dashboard分離
- ADR-005 共通エンジン / 地域データ分離
- ADR-006 Offline Queue / Idempotency
- ADR-007 Google Maps Loader
- ADR-008 担当エリアなし・自律選択モデル
- ADR-009 単独アプリ / 単独リポジトリ / 単独ドメイン
- ADR-010 個人ランキング

---

# 18. 桑名の教訓

`docs/architecture/02_LESSONS_FROM_KUWANA.md`

確認済み事故・根本原因・影響・検出・再発防止・検証方法を統一フォーマットで記録する。

主な教訓：

1. Identity直列化による起動遅延
2. hidden containerでのGoogle Maps初期化
3. 複数Google Maps loader
4. Dashboard/管理思想のHアプリ混入
5. Offline未考慮
6. Mock成功・実機失敗
7. clasp pushのみで本番完了と誤認
8. container-bound GAS残存
9. 大量ポリゴンによるモバイル負荷
10. Antigravity用のクリーン構造不足
11. AIによる未依頼変更
12. 新旧ロジック併存によるZombie Code

追加原則：

> AIが問題を発見したことと、AIに修正権限があることは別である。

---

# 19. 現行Hアプリ構造台帳

`docs/architecture/03_CURRENT_H_APP_INVENTORY.md`

全資産を以下に分類する。

- 🟢 継承
- 🔴 廃止
- 🟡 再構築
- 🔵 要検証

🔵を根拠なく継承・廃止へ変更してはならない。

---

# 20. 実装フェーズ

## Phase 0 — 基本設計契約固定

### 実装対象
- 本書
- 不変条件
- IN/OUT
- 責務境界

### 完了条件
- 基本思想確定
- 単独アプリ / repo / domain確定
- 個人ランキング確定
- 担当エリア不存在確定

---

## Phase 1 — 現行Hアプリ完全棚卸し

### 実施
- Repository
- Frontend
- GAS
- Spreadsheet
- API
- Auth
- Data
- External Services
- Production
- Config

### 成果物
`03_CURRENT_H_APP_INVENTORY.md`

---

## Phase 2 — 継承 / 廃止 / 再構築 / 要検証

現行資産を4分類する。

ここではコードを変更しない。

---

## Phase 3 — 汎用データモデル

地域依存コードを排除し、

```text
共通コード
 +
地域データ
```

へ分離する。

### 必須確認
- Branch
- Area
- Staff
- Activity
- Ranking
- Identity
- Tenant / Region境界

---

## Phase 4 — 共通アプリ / 地域データ分離

### 原則

```text
active/
data/
```

等の責務を明確化する。

地域展開のために共通コードを複製しない。

---

## Phase 5 — Identity / Tenant / Branch境界

実装：

- LIFF Identity
- Token verification
- Staff Identity
- Branch derivation
- Authorization
- Tenant boundary

### 禁止
- client branchId信用
- client staffId信用
- lineUserId frontend exposure
- 担当エリア割当

---

## Phase 6 — API境界

Standalone GASをJSON APIとして構築する。

- Request validation
- Auth
- Authorization
- Idempotency
- DB write
- Error contract
- Logging

---

## Phase 7 — Pure DB

SpreadsheetをPure DBとして整理する。

- Scriptなし
- Trigger依存なし
- 業務ロジックなし
- APIのみが業務ルールを担う

---

## Phase 8 — HアプリCore

現行Hアプリの思想・基本操作を基準に、

- 起動
- Identity
- 地域MAP
- 地図loader
- 活動入口
- 状態表示

を再構築する。

---

## Phase 9 — Posting Flow

活動場所選択から活動登録までを実装。

基本原則：

```text
見る
 ↓
選ぶ
 ↓
活動する
 ↓
「配った」
 ↓
記録
```

担当エリアへの割当は存在しない。

---

## Phase 10 — Offline / Durable Queue

- Local persistent queue
- optimistic UI
- retry
- exponential backoff
- duplicate protection
- force-close recovery
- reconnect recovery

を実装する。

---

## Phase 11 — Activity State Machine

活動ログの状態を実装し、UI状態・API状態・DB状態を一致させる。

個人ランキングの集計元となる活動実績の確定条件もここで明確化する。

---

## Phase 12 — 【削除】

本Phaseは設けない。

前版に存在した「Resource / Logistics」Phaseは、今回の汎用POSTING MAP再構築の独立実装Phaseから削除する。

物流の将来構想を、現時点の実装仕様として固定しない。

---

## Phase 13 — Dashboard

**本Phaseの位置付け・内容は前版から変更しない。**

Dashboardは管理者・運営側が地域全体を観測するための画面とする。

- MAP中心Overview
- PC大画面
- Smartphone compact view
- 詳細選択
- 詳細画面Fullscreen
- 進捗・地域状況の観測
- 個人ランキングの観測

管理者による現場個人への固定担当割当・活動強制は行わない。

---

## Phase 14 — Performance

- T0〜T5計測
- Warm
- Cold
- Offline
- 実機
- MAP rendering
- marker performance
- memory
- network waterfall

を検証する。

---

## Phase 15 — Security

- Identity
- Authorization
- Tenant isolation
- Input validation
- XSS
- CSRF等の該当脅威
- Secret exposure
- lineUserId exposure
- API abuse
- audit logging

を確認する。

---

## Phase 16 — Testing

### Unit
- state
- parser
- validation
- ranking calculation
- idempotency

### Integration
- API
- DB
- Identity
- queue

### E2E
- activity
- offline
- reconnect
- duplicate
- ranking

### Real Device
- iOS
- Android
- LINE / LIFF
- weak network
- offline

---

## Phase 17 — Production Deploy

実装完了をGit pushだけで扱わない。

必須：

```text
Code
 ↓
Git
 ↓
clasp push
 ↓
GAS deployment
 ↓
Production WebApp
 ↓
API verification
 ↓
Production reflection verification
```

---

## Phase 18 — Migration

現行環境から新環境への移行計画を確定する。

- data mapping
- ID mapping
- compatibility
- migration script
- validation
- rollback point

---

## Phase 19 — Cutover / Rollback

切替手順を文書化する。

- Cutover criteria
- Freeze
- Migration
- Smoke test
- Production verification
- Rollback trigger
- Rollback procedure

---

## Phase 20 — Production Monitoring

本番稼働後に、

- API errors
- queue backlog
- duplicate events
- latency
- GAS errors
- Spreadsheet lock
- map failure
- authentication failure

を監視する。

---

## Phase 21 — Generic / Multi-region Validation

複数の地域データを投入して、

> **地域が変わってもコードを複製・改変せず動作する**

ことを確認する。

検証対象：

- 支部
- 対象地域
- 党員
- 活動ログ
- MAP
- Dashboard
- 個人ランキング
- API
- 認証
- データ境界

### 合格条件

地域A用コード、地域B用コードを作らず、

```text
同一アプリ
同一repo
同一domain
同一共通コード
+
異なる地域データ
```

で成立すること。

---

# 21. 証拠管理

`docs/evidence/`

```text
docs/evidence/
├── screenshots/
├── test-runs/
├── api-responses/
└── production/
```

「テストした」ではなく、第三者が確認可能な証拠を残す。

---

# 22. 実装開始ゲート

## Gate 0 — 思想・憲法

### Entry
本計画のレビュー

### Exit
- 不変条件確定
- IN/OUT確定
- 単独アプリ確定
- 単独repo確定
- 単独domain確定
- 個人ランキング確定
- 担当エリアなし確定

### Deliverable
`01_DESIGN_CONTRACT.md`

---

## Gate 1 — 現物・教訓

### Exit
- 現行コード全数棚卸し
- 桑名教訓整理

### Deliverables
- `03_CURRENT_H_APP_INVENTORY.md`
- `02_LESSONS_FROM_KUWANA.md`

---

## Gate 2 — データ設計

### Exit
全項目についてSSOT・型・責任・ライフサイクル確定。

### Deliverables
- `DATA_DICTIONARY.md`
- `DATA_LIFECYCLE.md`

---

## Gate 3 — API契約

### Exit
- Request
- Response
- Auth
- Authorization
- Error
- Retry
- Idempotency

確定。

### Deliverable
`API_CONTRACT.md`

---

## Gate 4 — Architecture

### Exit
- ADR
- REQ traceability
- 共通コード / 地域データ境界

確定。

---

## Gate 5 — Evidence

### Exit
現行本番環境について、

- T0〜T5
- API
- 実機
- 本番構成

の証拠取得。

---

## Gate 6 — Git固定

Gate 0〜5の成果物をGit commitし、基準コミットを固定する。

---

## Gate 7 — 複製・無菌化

基準コミットから新しい実装環境を作成する。

既存コードの残骸や不要ファイルを混在させず、AIが誤認しないクリーンな構造を確立する。

---

## Gate 8 — 実装解禁

Gate 0〜7の完了後、初めて次世代POSTING MAPの実装を開始する。

---

# 23. Definition of Done

POSTING MAPでは、以下をすべて満たして初めて「実装完了」とする。

### 設計

- [ ] 本計画との整合
- [ ] REQ traceability
- [ ] ADR
- [ ] Data Dictionary
- [ ] API Contract

### 実装

- [ ] Hアプリ
- [ ] API
- [ ] Pure DB
- [ ] Dashboard
- [ ] 個人ランキング
- [ ] Offline
- [ ] Idempotency
- [ ] Identity
- [ ] Tenant boundary

### 品質

- [ ] Unit
- [ ] Integration
- [ ] E2E
- [ ] Real Device
- [ ] Offline
- [ ] Security
- [ ] Performance

### 本番

- [ ] Git commit
- [ ] Git push
- [ ] clasp push
- [ ] GAS deployment
- [ ] Production API verification
- [ ] Production reflection verification
- [ ]必要なmigration
- [ ] Cutover
- [ ] Rollback確認

### 汎用性

- [ ] 複数地域データで検証
- [ ] 地域ごとのコード複製なし
- [ ] 単独アプリ
- [ ] 単独リポジトリ
- [ ] 単独ドメイン

---

# 24. 最終アーキテクチャ原則

汎用POSTING MAPは、

> **一つのアプリ、一つのリポジトリ、一つのドメインを共通基盤として持ち、地域ごとの差異をデータとして扱う。**

その上で、

> **党員は固定担当エリアを持たず、所属支部の活動対象地域から自分が活動する場所を選ぶ。**

そして、

> **活動した事実は記録され、その実績は個人ランキング等の可視化へ利用できる。**

Hアプリは現場活動、Dashboardは全体観測を担う。

AI・実装者は、本計画にない「改善」を理由として仕様・責務・データ構造・画面体験を勝手に変更してはならない。

---

# 25. 実装順序の最終固定

```text
設計契約
  ↓
現行Hアプリ完全棚卸し
  ↓
桑名教訓の固定
  ↓
データ辞書
  ↓
データライフサイクル
  ↓
API契約
  ↓
ADR
  ↓
Evidence
  ↓
Git固定
  ↓
クリーンコピー
  ↓
Identity / Tenant
  ↓
API
  ↓
Pure DB
  ↓
HアプリCore
  ↓
Posting Flow
  ↓
Offline
  ↓
Activity / Ranking
  ↓
【Phase 12なし】
  ↓
Dashboard（Phase 13）
  ↓
Performance
  ↓
Security
  ↓
Testing
  ↓
Production Deploy
  ↓
Migration
  ↓
Cutover / Rollback
  ↓
Monitoring
  ↓
Multi-region Validation
  ↓
汎用POSTING MAP完成
```

**この順序を、実装開始後の勝手な短縮・統合・並べ替えの基準にしない。変更が必要な場合はADRまたは本計画の改訂として記録する。**

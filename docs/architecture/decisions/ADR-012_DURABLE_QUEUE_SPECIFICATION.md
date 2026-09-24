# ADR-012: Durable Queue Specification (堅牢な永続キュー仕様)

## 状態
承認済み (Approved) — Phase 10 実装

## 文脈 (Context)
POSTING MAP のフィールドワーク（ポスティング配布現場）では、地下、建物間、郊外などの電波微弱エリアや一時的オフライン環境において配布完了報告（GPS・写真・配布枚数）を安全に受け付け、オフライン復旧時やアプリ再起動時にもデータを絶対に消失・重複させずバックエンド（GAS/スプレッドシート）へ永続化することが求められる。

Phase 9 では「写真・GPS取得完了 ≠ COMPLETED」「Backend永続化成功のみが真の完了」という因果関係を確立した。
Phase 10 では、この因果関係を支えるクライアント側の送信キューについて、以下の設計原則・運用境界を確立する。

## 決定事項 (Decisions)

### 1. IndexedDB スキーマとバージョン管理
- **データベース名**: `PostingMapDB`
- **オブジェクトストア名**: `syncQueue` (keyPath: `'id'`, autoIncrement: true)
- **スキーマバージョン**: `DB_VERSION = 2` を維持する（v3 へのアップグレードや drop/recreate は禁止）。
- **既存データ互換性**: 既存レコードに `requestId` 等の新設フィールドが存在しない場合でも、エラーなく読み取り・処理・復旧を継続できること。

### 2. トランザクション境界と重複防止 (rowId-level Deduplication)
- **単一 readwrite トランザクション境界**:
  `enqueueSync(item)` 実行時、同一トランザクション内で既存キューの走査（`store.getAll()`）とレコード追加（`store.add()`）を不可分に実行する。
  分離された `getQueue()` → 判定 → `add()` による競合窓（race window）の発生を防止する。
- **重複キューイング抑止**:
  同一 `rowId` を持つアイテムが既にキュー内に存在する場合、新たなレコード追加を行わず、既存レコードの ID を返却して即時送信（`processQueue()`）を促す。

### 3. クライアント側不変操作識別子 (requestId)
- **役割**: クライアント側の各送信意図を一意に追跡・ログ照合するための不変操作識別子（UUID/プレフィックス付きタイムスタンプ）とする。
- **Backend 冪等性との境界**: Phase 10 ではクライアント側の不変識別子として付与するのみにとどめ、Backend側の既存冪等性ロジック（`rowId + GPS=OK + photo=OK` による二重登録防止）は変更しない。

### 4. COMPLETED 因果関係の絶対順序
キュー処理時、以下の因果関係とライフサイクル順序を厳格に維持する：
```
1. [Backend persistence confirmed] (res.success === true 受信)
       ↓
2. [dequeueSync()] (IndexedDB syncQueue からレコード削除)
       ↓
3. [COMPLETED 確定] (UI / メモリキャッシュに同期完了を反映)
       ↓
4. [p.isDone = true] (配布ポイント完了フラグ確定)
       ↓
5. [完了ピン・ロック] (UI上のピン完了化およびロック)
```

以下の状態はいずれも COMPLETED ではない：
- `enqueue 成功` ≠ COMPLETED
- `HTTP request 送信` ≠ COMPLETED
- `SUBMITTING` ≠ COMPLETED
- `QUEUE_PENDING` ≠ COMPLETED
- `RETRY_WAIT` ≠ COMPLETED

### 5. 指数バックオフと強制終了復旧 (Crash Recovery)
- **リトライ間隔**: 10秒 → 30秒 → 60秒 → 60秒 → 60秒 (最大5回)。
- **強制終了・クラッシュ復旧**:
  ブラウザの強制終了やタブ閉じにより `SYNCING` 状態で中断されたレコードは、次回起動時または `processQueue()` 実行時に自動検出され、即時再送対象として安全に復旧・送信される。
- **待機ピン復元 (`getSyncQueueRowIds`)**:
  起動時やデータロード時、`getSyncQueueRowIds()` を用いてキュー内の未送信アイテムを検出し、ピンを待機状態（`pending`）として即座に復元する。

### 6. オフラインUI即時解放と待機制御
- **オフライン提出**:
  `enqueueSync` 成功後、オフライン時は待機せず即座にモーダルを閉じて画面を解放する（UIフリーズの完全防止）。
- **オンライン提出**:
  最大3秒間の上限待機時間を設け、タイムアウト時もバックグラウンド送信に引き継いでモーダルを解放し、通常操作へ即座に復帰可能とする。
- **完了昇格の責務分離 (`triggerUISyncRefresh`)**:
  バックグラウンドでキューが消化（`dequeueSync`）された後、`triggerUISyncRefresh()` がキュー消滅を検知して安全に `p.isDone = true`、ピン完了、ロックへの昇格を実行する。

## 影響・遵守事項 (Consequences & Compliance)
- Universal 原則を遵守し、地区名や専用ロジックを一切含まない。
- 本番バックエンド（GAS/Spreadsheet/API）に一切の変更を加えない。

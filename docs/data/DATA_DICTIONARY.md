# Universal POSTING MAP — データ辞書 (DATA_DICTIONARY.md)
## Gate 2: Data Architecture Specification — Official Deliverable

> 本書は、最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md` §22, Gate 2 出口基準）および
> Gate 2 確定指示に基づき、Universal POSTING MAP の全データ項目の定義、所有権、SSOT、型、制約、
> および識別子体系を規定した公式データ辞書である。
>
> **最重要原則**:
> 1. ポスティングは完全に自由。個人担当エリア・活動場所の個人割当・ノルマは存在しない。
> 2. 「支部の活動対象地域」は組織上の管轄・管理対象地域であり、「党員のポスティング可能範囲」ではない。「所属支部」と「ポスティングした場所」は別概念であり、所属支部から活動場所を制限・限定・選択肢化してはならない。
> 3. 「相生町が山田さんの担当」を記録するのではない。「山田さんが相生町で500枚配った」という発生した配布実績（事実）を記録する。
> 4. Hアプリは現場活動（データ送信）、Backendは認証・検証・保存、Databaseは事実の保存、Dashboardは全体観測（データ受信・表示）を担う。
> 5. Hアプリの個人ランキングは管理・監督・評価のための機能ではない。自由に活動する配布員自身のモチベーション・活動意欲（メンタル面の動機付け）を高めるための可視化機能である。

---

## 1. 識別子設計体系 (ID Architecture)

システム内で扱われる各種識別子は厳格に分離されており、相互に混同・代用してはならない。

| 識別子 (ID) | 命名・形式例 | 役割・定義 | 機密性 | 外部・フロントエンド露出 |
|---|---|---|---|---|
| **LINE User ID** | `U` + 32桁hex (`U1234567890abcdef...`) | LINEプラットフォームにおける検証済み本人識別子。内部認証および本人性の唯一の根拠。 | **極秘** (内部限定) | **不可**（フロントエンドSSOTとしての保持・公開を禁止） |
| **Person ID** | `PRS-` + UUID | 自然人（党員個人）のシステム内部識別子。 | 機密 (内部) | 不可 |
| **Staff ID** | `STF-` + 5桁連番 (`STF-24205-001`) | Hアプリおよび名簿上で党員・配布員を識別するための人間向けID。 | 支部内限定 | 可（本人のみ、または管理画面） |
| **Branch ID** | `BR-` + 地域記号 (`BR-MIE-03`) | 党の組織単位である支部（例: 三重3区支部）の識別子。 | 公開 | 可 |
| **Target Region ID** | 国勢調査小地域KEY_CODE (`242050150`) / `rowId` | 活動対象となる町丁目の地理的識別子。 | 公開 | 可 |
| **Activity Record ID** | `evt-` + timestamp + random / UUID | 配布実績（「誰が・いつ・どこで・何枚配ったか」）のイベント一意識別子。 | 内部 | 可 |
| **Request ID** | `req_` + UUID v4 | Hアプリ等からの通信における重複防止のための冪等性キー（Idempotency Key）。 | 一時情報 | 可 |

### 識別子分離の不変原則
```text
LINE User ID ≠ Staff ID ≠ Person ID ≠ Branch ID ≠ Activity Record ID ≠ Request ID
```
- クライアントから送信された `staffId` や `staffName` などの平文テキストは、認証・認可の根拠として信頼してはならない（クライアント詐称防止）。
- `localStorage` に保存された `user_info` は「オフライン起動時の先行表示用キャッシュ」に過ぎず、真実の単一情報源（SSOT）ではない。

---

## 2. エンティティ所有権・ガバナンスメタデータ台帳

| Entity | 論理名 | Owner (所有主体) | SSOT (真実の情報源) | Write Authority (書込権限) | Read Consumers (参照者) | 機密区分 | 保管・履歴ポリシー |
|---|---|---|---|---|---|---|---|
| **DistributionRecord** | 配布実績 | 配布実行者 (Person) | Spreadsheet (`配布実績YYYY-MM`) | 認証済み本人のみ (Backend強制) | Hアプリ(自身分・集計), Dashboard | 支部内公開 | 恒久保全 (月次履歴) |
| **StaffIdentity** | 配布員名簿 | 本人 / 支部管理者 | Spreadsheet (`名簿の原本`) | 本人 (LINE連携時) / 支部管理者 | Backend, Dashboard (名簿タブ) | 個人機密 | 契約期間中保全 |
| **ActivityTargetRegion** | 支部活動対象地域マスター (※1) | 支部 (Branch) | CSV (`data/address_master.csv`) | 地区管理責任者 (Gate時) | Hアプリ (地図), Dashboard | 公開マスター | 地区運用期間中固定 |
| **Municipality** | 自治体マスター | 支部 (Branch) | CSV (`data/municipality_master.csv`)| 地区管理責任者 (Gate時) | Hアプリ (一覧), Dashboard | 公開マスター | 地区運用期間中固定 |
| **RankingSummary** | 個人ランキング | システム (System) | Backend 動的集計エンジン | Backend バッチ / 動的計算 | Hアプリ (個人順位・全体上位) | 支部内公開 | 月次集計 (随時再計算) |
| **FlyerStock** | 保有チラシ在庫 | チラシ保管者 (Staff) | Spreadsheet (`保有チラシ枚数の原本`)| 保管者本人 (在庫増減・受渡時) | Hアプリ (在庫一覧), Dashboard | 支部内限定 | 随時更新・月次保全 |
| **FlyerTransferRequest**| 受渡要請 | 要請者 (Staff) | Spreadsheet (`受渡要請履歴YYYY-MM`)| 要請者本人 (発行) / 保管者 (受諾)| 当事者間, Dashboard (管理タブ)| 支部内限定 | 完了後アーカイブ |
| **PinStatus** | リアルタイム作業中状態 | 配布実行者 (Staff) | Spreadsheet (`PinStatusYYYY-MM`) | 配布開始/終了者 (Hアプリ) | Hアプリ (ピン表示), Dashboard | 支部内公開 | 当日〜当月限定 (短期) |
| **BulletinPost** | 掲示板投稿 (🔵要検証) | 投稿者本人 (Staff) | Spreadsheet (`掲示板`) | 認証済み本人 (投稿・削除) | Hアプリ (掲示板タブ), Dashboard| 支部内公開 | 保持期限満了後削除 |
| **SystemInfo** | システム設定・契約 | 統括管理者 | Spreadsheet (`SYSTEM_INFO`) | 統括管理者のみ | Backend, Hアプリ, Dashboard | システム機密 | 恒久保全 |

※1 **重要**: 「支部の活動対象地域マスター」は、支部組織としての管轄・観測対象地域を定義する地理マスターであり、「党員のポスティング可能範囲」ではない。党員個人に対する活動場所の制限・限定・選択肢化は一切行わない。

---

## 3. 配布実績（DistributionRecord）中心データ項目定義

POSTING MAP の中核である「誰が・いつ・どこで・何枚配ったか」を記録するデータ項目。

### (1) 配布実績エンティティ (`DistributionRecord`)

| Field (物理名) | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | 生成者 | 利用者 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|
| `rowId` | 地域行識別子 | Number | 必須 | 対象町丁目の通し番号 (address_master と連動) | Hアプリ | 配布実績シート A列 | address_master | Hアプリ, Dashboard | address_master | 1以上の整数 |
| `cityName` | 市町村名 | String | 必須 | 活動対象町丁目が属する自治体名 | address_master | 配布実績シート B列 | address_master | Hアプリ, Dashboard | address_master | 例: `桑名市` |
| `townName` | 町域名 | String | 必須 | 活動対象町丁目の正式名称 | address_master | 配布実績シート C列 | address_master | Hアプリ, Dashboard | address_master | 例: `相生町` |
| `completedAt` | 配布完了日時 | String | 必須 | 現場で配布完了が記録された日時 (JST) | Hアプリ (端末時) | 配布実績シート D列 | 配布員 (完了タップ) | Hアプリ, Dashboard | 配布実績シート | フォーマット: `yyyy/MM/dd HH:mm:ss` |
| `count` | 配布枚数 | Number | 必須 | 実際に配布されたチラシの枚数 | Hアプリ (テンキー)| 配布実績シート E列 | 配布員 (入力) | Hアプリ, Dashboard | 配布実績シート | 0以上の数値。例: `500` |
| `staffId` | 担当者ID | String | 必須 | 配布を実施した党員の公式配布員ID | Backend (強制解決)| 配布実績シート F列 | Backend (`resolveStaffIdentity`)| Dashboard | 名簿の原本 | クライアント送信値を上書き強制 |
| `staffName` | 担当者名 | String | 必須 | 配布を実施した党員の表示名 | Backend (強制解決)| 配布実績シート G列 | Backend (`resolveStaffIdentity`)| Dashboard | 名簿の原本 | クライアント送信値を上書き強制 |
| `gpsStatus` | GPS記録状態 | String | 必須 | 座標記録の有効性フラグ | Hアプリ (端末GPS) | 配布実績シート H列 | `modules/device.js` | Dashboard | 配布実績シート | `OK` または `NO` |
| `photoStatus` | 写真記録状態 | String | 必須 | 完了写真アップロード状態フラグ | Hアプリ (端末カメラ)| 配布実績シート I列 | `modules/device.js` | Dashboard | 配布実績シート | `OK` または `NO` |
| `latitude` | 配布緯度 | Number | 任意 | 配布完了地点のGPS緯度 (世界測地系) | 端末GPS | 配布実績シート J列 | 端末GPS | Dashboard | 配布実績シート | `0` または欠損時は空文字 |
| `longitude` | 配布経度 | Number | 任意 | 配布完了地点のGPS経度 (世界測地系) | 端末GPS | 配布実績シート K列 | 端末GPS | Dashboard | 配布実績シート | `0` または欠損時は空文字 |
| `gpsTimestamp`| GPS取得日時 | String | 任意 | GPS測位が成功した日時 (JST) | 端末GPS | 配布実績シート L列 | 端末GPS | Dashboard | 配布実績シート | フォーマット: `yyyy/MM/dd HH:mm:ss` |
| `photoFileId` | 写真ファイルID | String | 任意 | Google Drive に保存された写真のファイルID | Backend (Drive保存)| 配布実績シート M列 | Backend (`GPSService`) | Dashboard | Google Drive | Drive File ID |
| `photoUrl` | 写真閲覧URL | String | 任意 | 配布証跡写真のDriveプレビューURL | Backend | 配布実績シート N列 | Backend (`GPSService`) | Dashboard | Google Drive | `https://drive.google.com/...` |
| `photoTimestamp`| 写真撮影日時 | String | 任意 | 証跡写真が撮影・保存された日時 (JST) | Hアプリ | 配布実績シート O列 | Hアプリ | Dashboard | 配布実績シート | フォーマット: `yyyy/MM/dd HH:mm:ss` |
| `resolvedLineUserId`| 認証済みLINE ID | String | 必須 | 活動を実施した本人の検証済みLINE User ID | LINE LIFF トークン | 配布実績シート P列 | Backend (トークン検証) | 内部監査 | LINE Platform | **機密監査項目** (フロントエンド非公開) |

---

## 4. その他のエンティティ項目定義

### (2) 配布員名簿 (`StaffIdentity`) — `名簿の原本` / `名簿YYYY-MM`

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `id` | 配布員ID (Staff ID) | String | 必須 | 支部内で一意の人間向けスタッフID | Backend | A列 | 名簿の原本 | 例: `STF-24205-001` |
| `name` | 配布員名 | String | 必須 | 党員の登録表示名 (ニックネーム可) | Hアプリ入力 / LINE名 | B列 | 名簿の原本 | 本人が登録時に設定 |
| `lineUserId` | LINE User ID | String | 必須 | 検証済みLINE User ID | LIFF トークン | C列 | LINE Platform | **機密項目** (内部照合専用) |
| `registeredAt` | 登録日時 | String | 必須 | 初回名簿登録日時 (JST) | Backend | D列 | 名簿の原本 | `yyyy/MM/dd HH:mm:ss` |

### (3) 支部活動対象地域 (`ActivityTargetRegion`) — `data/address_master.csv`

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `rowId` | 通し番号 | Number | 必須 | 1から始まる町丁目行番号 | e-Stat データ | CSV 1列目 | address_master.csv | 1以上の整数 |
| `city_name` | 自治体名 | String | 必須 | 所属する市区町村名称 | e-Stat データ | CSV 2列目 | address_master.csv | 例: `桑名市` |
| `town_name` | 町域名 | String | 必須 | 町丁目名称 (丁目を小地域として分離) | e-Stat データ | CSV 3列目 | address_master.csv | 例: `青葉町一丁目` |
| `latitude` | 代表緯度 | Number | 必須 | 町丁目の代表点 (重心) 緯度 | e-Stat 形状 | CSV 4列目 | address_master.csv | 地図ピン初期配置座標 |
| `longitude` | 代表経度 | Number | 必須 | 町丁目の代表点 (重心) 経度 | e-Stat 形状 | CSV 5列目 | address_master.csv | 地図ピン初期配置座標 |
| `households` | 世帯数 | Number | 任意 | 国勢調査小地域世帯数 | 国勢調査統計 | CSV 6列目 | address_master.csv | ポスティング参考情報 (※ノルマではない) |
| `population` | 人口 | Number | 任意 | 国勢調査小地域人口 | 国勢調査統計 | CSV 7列目 | address_master.csv | 参考情報 |
| `e_stat_code` | 国勢調査小地域コード | String | 任意 | e-Stat KEY_CODE (11桁コード) | 総務省統計局 | CSV 8列目 | address_master.csv | 例: `24205103001` |

### (4) 個人ランキング (`RankingSummary`) — Backend 動的集計
> **目的と位置付け**:
> Hアプリにおける個人ランキングは、管理・監督・人事評価のための機能ではない。
> 自由にポスティングする配布員が自身の活動実績を確認し、「自分もやろう」という**モチベーション・活動意欲（メンタル面の動機付け）を高めるための可視化機能**である。活動を強制するものではない。
>
> **データ関係**:
> ```text
> DistributionRecord (配布実績事実)
>         ↓
> 実際の配布枚数 (count)
>         ↓
> 単純集計 (合計計算 & 降順ソート)
>         ↓
> 個人ランキング (RankingSummary)
>         ↓
> Hアプリ: モチベーション可視化 / Dashboard: 全体観測
> ```

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `rank` | 順位 | Number | 必須 | 支部内の月間配布実績順位 (1位〜) | 配布実績集計 | メモリ / キャッシュ | 配布実績シート | 同枚数の場合は同順位 |
| `staffId` | 配布員ID | String | 必須 | 表示用スタッフID | 配布実績集計 | メモリ / キャッシュ | 名簿の原本 | 他人にはIDのみ表示 (匿名性保護) |
| `count` | 合計配布枚数 | Number | 必須 | 当月内に完了登録したチラシの合計枚数 | 配布実績集計 | メモリ / キャッシュ | 配布実績シート | 0以上の整数（純粋な配布枚数のみ） |
| `isMe` | 本人判定フラグ | Boolean | 必須 | リクエスト送信者本人であるかどうかの判定 | Backend | APIレスポンス | Backend認証 | 本人行のみハイライト表示用 |

※ **現物確認結果**: 既存Backend実装（`DistributionRepository.js`）において、ランキング計算は純粋に配布実績の `count` 列のみを集計しており、専用の評価値・ポイント等は一切存在しない。Universal POSTING MAP でもこのシンプルな実績集計を完全継承する。

### (5) 保有チラシ在庫 (`FlyerStock`) — `保有チラシ枚数の原本` / `保有チラシ枚数YYYY-MM`

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `id` | 在庫ID | Number | 必須 | チラシ保管レコードの連番 | Backend | A列 | 保有チラシ原本 | 1以上の整数 |
| `staffId` | 保管者スタッフID | String | 必須 | チラシを保管している党員のStaff ID | Backend | B列 | 名簿の原本 | 例: `STF-24205-001` |
| `staffName` | 保管者名 | String | 必須 | チラシを保管している党員の表示名 | Backend | C列 | 名簿の原本 | 表示用 |
| `location` | 保管場所 | String | 必須 | 保管場所の自治体名 | Hアプリ選択 | D列 | 保有チラシ原本 | `storage_locations.json` と連動 |
| `count` | 保有枚数 | Number | 必須 | 現在保管しているチラシの残数 | Hアプリ入力 | E列 | 保有チラシ原本 | 配布や受渡により増減 |
| `updatedAt` | 最終更新日時 | String | 必須 | 在庫数が最後に更新された日時 (JST) | Backend | F列 | 保有チラシ原本 | `MM/dd HH:mm` |
| `lineUserId` | 保管者LINE ID | String | 必須 | 保管者の検証済みLINE User ID | Backend | G列 | LINE Platform | **機密項目** (isMe判定専用) |

---

## 5. 絶対禁止項目の不存在証明 (Non-Existence of Forbidden Items)

本データ辞書において、以下の概念・フィールドは**意図的に排除されており、いかなるエンティティにも存在しない**。

1. **個人担当エリア (`person → assignedArea`)**:
   - `assignedAreaId`、`assignedTown`、`targetStaffId` 等の「エリアに対して担当者を固定する項目」は存在しない。
   - 配布実績シートの `staffId` は、「その町で配った事実」を記録するものであり、「その町の担当者」を指すものではない。
2. **活動場所の個人割当モデル (`person → activityArea`)**:
   - 党員ごとに活動場所を事前割当・指示するフィールドは存在しない。
3. **支部による個人の活動場所制限・限定・選択肢化モデル (`branch → allowedActivityRegions → person`)**:
   - 「支部対象地域から選択する」「支部の活動対象地域内で活動する」「支部が活動可能地域を定義する」「党員の活動可能地域」「支部による活動場所制限」等のモデル・フィールドは一切存在しない。
   - 「支部の活動対象地域」は組織上の管理対象地域であり、「党員のポスティング可能範囲」ではない。「所属支部」と「ポスティングした場所」は完全に独立した別概念であり、所属支部から活動場所を制限・限定・選択肢化してはならない。
4. **ノルマ・目標枚数 (`person → quota`)**:
   - `targetCount`、`quota`、`requiredCount` 等の強制・ノルマ項目は存在しない。
   - `address_master.csv` の `households`（世帯数）は国勢調査の客観統計情報であり、個人への目標値ではない。
5. **出勤管理・強制参加フラグ**:
   - `attendanceStatus`、`checkInTime`、`isMandatory` 等の労務管理・強制参加項目は存在しない。
6. **ランキングの管理・評価機能化および評価値項目**:
   - ランキングを管理・監督・評価のためのツールにしてはならない。ノルマ未達管理、人事評価、指示、参加制限、ペナルティ等と連動するフィールドは一切存在しない。
   - `rankingScore`、`motivationPoint`、`performanceGrade`、`evaluationScore` 等の評価値・ポイント新設は禁止であり、モデルに存在しない。実際の配布枚数（`count`）の集計のみを扱う。

# POSTING MAP — AGENTS.md (最上位基本就業規則)

## 1. Architecture — ABSOLUTE
- POSTING MAP is a single application, a single repository, and a single domain (Universal Engine).
- Regional differences are absorbed by data, not code duplication. Creating district-specific repositories, applications, or domains is strictly prohibited.
- active/ = universal engine. Never modify active/ for regional specialization.
- data/ = master data and client configuration (address_master.csv, boundaries.geojson, municipality_master.csv, config.js, area_mapping.json).
- Spreadsheet = Pure DB (no scripts, no triggers). GAS = Standalone only. Container-bound Apps Script is permanently deprecated.

## 2. Identity & Authorization — ABSOLUTE
- Identity & Target Area derivation chain: LINE User ID (verified) → Person / Staff Identity → Branch → Branch Activity Target Regions.
- Client-supplied staffId, staffName, or branchId MUST NOT be trusted as authentication or authorization evidence.
- Never hardcode regional names, IDs, or endpoints in active/.

## 3. Repository Boundary — ABSOLUTE【永久原則】
- 現在作業対象としているリポジトリのGit rootを作業・探索・検索・読み取り・操作の絶対境界とする。
- SSD上に存在する他地区（OKAYAMA-02、KUWANA等）のリポジトリやフォルダーを、通常時・監査時・実装時・比較時を問わず一切参照・探索・検索・読み取りしない。
- 「参考」「比較」「検証」の目的でも他リポジトリを見ない。他リポジトリのコード、データ、設定、Git履歴、監査結果、Runtime情報等を判断材料に使用しない。
- リポジトリ内部だけでは判断できない事項は、他地区を見て補完・推測せず「UNDETERMINED」とする。複数リポジトリを同時に参照しない。

## 4. Execution Governance — ABSOLUTE
1. **No Plan → No Proceed → No Implementation**: 計画立案とMASTER承認なしの実装・変更は絶対禁止。
2. **No Silent Changes**: ファイル変更前に「対象ファイル、関数・行、変更内容、変更理由、変更しない範囲」を日本語で事前宣言すること。未宣言の変更は禁止。
3. **Scope Lock & 最小侵襲**: 指定範囲外のコード不可侵。最小限の行数のみ変更。「ついで」の改善・リファクタリング・別箇所への波及は絶対禁止。
4. **Unexpected Condition → Report → STOP**: 予期せぬ状態・不整合・テスト失敗・宣言外変更を発見した場合は即座に作業を停止し、MASTERへ報告すること。自己判断での修正拡大は禁止。
5. **実装後差分照合必須**: 実装完了後、必ず `git diff` で事前宣言と実際の変更内容を照合すること。宣言外変更が1行でも存在した場合は即時失敗・HARD STOPとする。

## 5. Data Protection — ABSOLUTE
- Never modify production data outside approved scope.
- Never delete production resources without explicit approval.
- Preserve rollback until final verification passes.

## 6. Completion & Definition of Done — ABSOLUTE
- Implementation → Test → Diff/Audit → Commit → Push → Deploy → Runtime Verify.
- If any required verification FAILS: STOP.
- Git PASS is not deployment PASS. Production deployment requires production runtime evidence.

## 7. Detailed Rules & Workflows
AI社員は作業フェーズに応じて、必ず以下の詳細規程・ワークフローを参照・遵守すること。
- 最高位設計契約 (Supreme Design Contract): [docs/architecture/01_DESIGN_CONTRACT.md](docs/architecture/01_DESIGN_CONTRACT.md)
- 現行アーキテクチャ定義: [docs/architecture/CURRENT_ARCHITECTURE.md](docs/architecture/CURRENT_ARCHITECTURE.md)
- 開発・完了報告手順 (8-Stage Protocol): [.agents/workflows/development/workflow.md](.agents/workflows/development/workflow.md)
- 検証・検品規程 & HARD STOP条件 (V1〜V4): [.agents/rules/verification-gates.md](.agents/rules/verification-gates.md)
- 権限境界・Scope最小化・詳細禁止事項: [.agents/rules/agent-authority.md](.agents/rules/agent-authority.md)
- AI社員基盤・アーキテクチャ体系: [docs/ai-foundation.md](docs/ai-foundation.md)
- Legacy district-deployment workflow (.agents/workflows/district-deployment/workflow.md) is deprecated and must not be used.

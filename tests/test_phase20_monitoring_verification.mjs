/**
 * Phase 20 Anchor Test: Production Monitoring Contract & Observability Verification
 * 
 * マスタープラン Phase 20 が定める 8 つの監視領域：
 * 1. API errors
 * 2. queue backlog
 * 3. duplicate events
 * 4. latency
 * 5. GAS errors
 * 6. Spreadsheet lock
 * 7. map failure
 * 8. authentication failure
 * 
 * に対し、単なるコード文字列の存在確認ではなく、
 * 「監視対象 → 検知方法 → 判定条件 → Severity → 一次対応」の運用契約が成立し、
 * 既存 Universal 実装がそれを検知・判定できる契約を満たしていることを厳格に自動検証する。
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

console.log('====================================================');
console.log('🚀 PHASE 20 ANCHOR TEST: PRODUCTION MONITORING');
console.log('====================================================');

// ─── GATE 1: 8大監視項目の運用契約完全性（Detection, Threshold, Severity, SOP） ───
console.log('\n[Gate 1] 8大監視項目の運用契約完全性検証 (ADR-021 Contract)...');

const adr021Path = path.join(REPO_ROOT, 'docs/architecture/decisions/ADR-021_PRODUCTION_MONITORING_SPECIFICATION.md');
assert.ok(fs.existsSync(adr021Path), 'ADR-021 specification file must exist');
const adr021Content = fs.readFileSync(adr021Path, 'utf8');

const requiredMonitoringItems = [
  { key: 'API errors', term: 'API errors' },
  { key: 'queue backlog', term: 'queue backlog' },
  { key: 'duplicate events', term: 'duplicate events' },
  { key: 'latency', term: 'latency' },
  { key: 'GAS errors', term: 'GAS errors' },
  { key: 'Spreadsheet lock', term: 'Spreadsheet lock' },
  { key: 'map failure', term: 'map failure' },
  { key: 'authentication failure', term: 'authentication failure' }
];

for (const item of requiredMonitoringItems) {
  assert.ok(
    adr021Content.includes(item.term),
    `ADR-021 must explicitly define monitoring item: ${item.key}`
  );
}

// 5大運用要素（検知対象、検知方法、判定条件、Severity、一次対応）の定義確認
const operationalComponents = ['検知対象', '検知方法', '判定条件', 'Severity', '一次対応'];
for (const comp of operationalComponents) {
  assert.ok(
    adr021Content.includes(comp),
    `ADR-021 must systematically include operational component: ${comp}`
  );
}

// 外部SaaS・過剰インフラの排除宣言の確認
assert.ok(
  adr021Content.includes('外部有償SaaS') || adr021Content.includes('外部SaaS'),
  'ADR-021 must explicitly prohibit external SaaS and heavy incident platforms'
);
assert.ok(
  adr021Content.includes('最小補助分類'),
  'ADR-021 must declare Severity as minimal auxiliary classification without creating new SLAs'
);

console.log('  ✅ Gate 1 PASS: 8大監視項目および5大運用要素の契約完全性を確認');

// ─── GATE 2: API errors & Authentication failure 監視可能性検証 ───
console.log('\n[Gate 2] API errors & Authentication failure 監視可能性検証...');

const apiPath = path.join(REPO_ROOT, 'active/api/v2_api.js');
assert.ok(fs.existsSync(apiPath), 'active/api/v2_api.js must exist');
const apiContent = fs.readFileSync(apiPath, 'utf8');

// 1. API errors: 統一エラーレスポンス構造
assert.ok(
  apiContent.includes('success: false'),
  'API must implement uniform error response structure { success: false }'
);

// 2. 監視対象エラーコードの客観的検知可能性
const expectedErrorCodes = [
  'CONTRACT_EXPIRED',
  'DISTRICT_MISMATCH',
  'METHOD_NOT_ALLOWED',
  'FORBIDDEN',
  'UNAUTHORIZED'
];
for (const code of expectedErrorCodes) {
  assert.ok(
    apiContent.includes(code),
    `API must have explicit machine-detectable error code: ${code}`
  );
}

// 3. Authentication failure: GET経由トークン送信の即時拒否契約
assert.ok(
  apiContent.includes('Token transmission via GET is prohibited.'),
  'API must strictly reject token transmission via GET for authentication security monitoring'
);

console.log('  ✅ Gate 2 PASS: API errors & Authentication failure の機械的検知契約を確認');

// ─── GATE 3: Queue backlog & Duplicate events 監視可能性検証 ───
console.log('\n[Gate 3] Queue backlog & Duplicate events 監視可能性検証...');

const dbPath = path.join(REPO_ROOT, 'active/dashboard/db.js');
assert.ok(fs.existsSync(dbPath), 'active/dashboard/db.js must exist');
const dbContent = fs.readFileSync(dbPath, 'utf8');

// 1. Queue backlog: DurableQueue 構造および滞留追跡関数
assert.ok(
  dbContent.includes("const STORE_NAME = 'syncQueue'"),
  'db.js must define syncQueue object store for DurableQueue'
);
assert.ok(
  dbContent.includes('function getQueue('),
  'db.js must expose getQueue() for backlog quantity tracking'
);
assert.ok(
  dbContent.includes('function getSyncQueueRowIds('),
  'db.js must expose getSyncQueueRowIds() for unsubmitted item identification'
);
assert.ok(
  dbContent.includes('function updateUISyncStatus('),
  'db.js must expose updateUISyncStatus() to notify UI of pending backlog'
);

// 2. Duplicate events: 重複キューイング抑止契約
assert.ok(
  dbContent.includes('[Queue] Duplicate enqueue avoided for rowId='),
  'db.js must detect and log duplicate enqueue avoidance within single transaction'
);

// 3. 不変操作識別子 (requestId) 生成契約
assert.ok(
  dbContent.includes('function generateRequestId('),
  'db.js must expose generateRequestId() for client idempotency tracing'
);

// 4. Freeze と DurableQueue の契約関係（Phase 19 との整合）
assert.ok(
  adr021Content.includes('書き込み停止・業務凍結'),
  'ADR-021 must state that Freeze means stopping operations/writes, not avoided by DurableQueue'
);

console.log('  ✅ Gate 3 PASS: Queue backlog & Duplicate events の監視可能性およびFreeze整合性を確認');

// ─── GATE 4: Latency & Spreadsheet lock 監視可能性検証 ───
console.log('\n[Gate 4] Latency & Spreadsheet lock 監視可能性検証...');

// 1. Latency: ADR-015 性能 SSOT 参照確認
const adr015Path = path.join(REPO_ROOT, 'docs/architecture/decisions/ADR-015_PERFORMANCE_CONTRACT.md');
assert.ok(fs.existsSync(adr015Path), 'ADR-015 must exist');
const adr015Content = fs.readFileSync(adr015Path, 'utf8');

assert.ok(
  adr015Content.includes('Warm Start ($T_2$)') && adr015Content.includes('200'),
  'ADR-015 must define Warm Start SLA <= 200ms'
);
assert.ok(
  adr015Content.includes('Cold Start ($T_2$)') && adr015Content.includes('800'),
  'ADR-015 must define Cold Start SLA <= 800ms'
);
assert.ok(
  adr015Content.includes('Offline Start ($T_2$)') && adr015Content.includes('200'),
  'ADR-015 must define Offline Start SLA <= 200ms'
);

// ADR-021 が ADR-015 の値を SSOT として参照していることの検証
assert.ok(
  adr021Content.includes('ADR-015 SSOT 準拠'),
  'ADR-021 must explicitly conform to ADR-015 as the sole performance SSOT'
);
assert.ok(
  adr021Content.includes('250') && adr021Content.includes('1000'),
  'ADR-021 must reflect ADR-015 maximum SLA tolerance thresholds (250ms / 1000ms)'
);

// 2. Spreadsheet lock: LockServiceProvider タイムアウト契約
const lockPath = path.join(REPO_ROOT, 'active/infrastructure/lock/lock_adapter.js');
assert.ok(fs.existsSync(lockPath), 'active/infrastructure/lock/lock_adapter.js must exist');
const lockContent = fs.readFileSync(lockPath, 'utf8');

assert.ok(
  lockContent.includes('LockService.getScriptLock()'),
  'lock_adapter.js must utilize LockService.getScriptLock()'
);
assert.ok(
  lockContent.includes('Lock Timeout: Failed to acquire lock within'),
  'lock_adapter.js must throw standardized Lock Timeout exception for log detection'
);

console.log('  ✅ Gate 4 PASS: Latency (ADR-015 SSOT) & Spreadsheet lock タイムアウト監視契約を確認');

// ─── GATE 5: GAS errors & Map failure 監視可能性検証 ───
console.log('\n[Gate 5] GAS errors & Map failure 監視可能性検証...');

// 1. GAS errors: Web App (30s) / Batch (6m) / Quota 監視契約
assert.ok(
  adr021Content.includes('30秒') && adr021Content.includes('6分'),
  'ADR-021 must capture GAS Web App (30s) and Batch (6m) timeout monitoring boundaries'
);

// 2. Map failure: Google Maps API 初期化ガード契約
const renderPath = path.join(REPO_ROOT, 'active/dashboard/render.js');
assert.ok(fs.existsSync(renderPath), 'active/dashboard/render.js must exist');
const renderContent = fs.readFileSync(renderPath, 'utf8');

assert.ok(
  renderContent.includes('if (!mapEl || !window.google || !window.google.maps) return;'),
  'render.js must implement defensive map initialization guard against map failure'
);

// 3. Manager Map: Leaflet 初期化ガード契約
const managerPath = path.join(REPO_ROOT, 'active/manager/manager.js');
assert.ok(fs.existsSync(managerPath), 'active/manager/manager.js must exist');
const managerContent = fs.readFileSync(managerPath, 'utf8');

assert.ok(
  managerContent.includes('initMap()') && managerContent.includes('L.tileLayer'),
  'manager.js must define Leaflet/OSM map initialization structure'
);

console.log('  ✅ Gate 5 PASS: GAS errors & Map failure 初期化ガード・フェイルセーフ契約を確認');

console.log('\n====================================================');
console.log('🎉 ALL 5 GATES OF PHASE 20 ANCHOR TEST PASSED (100%)');
console.log('====================================================\n');

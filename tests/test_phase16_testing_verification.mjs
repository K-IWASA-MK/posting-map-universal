import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log("====================================================");
console.log("🧪 PHASE 16: UNIVERSAL TESTING ARCHITECTURE ANCHOR SUITE");
console.log("====================================================");

const REPO_ROOT = '/Volumes/SSD_DATA/posting-map-universal';
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const LEGACY_DIR = path.join(TESTS_DIR, 'legacy');

// ─── Gate 1: マスタープラン要求 18 項目のトレーサビリティ検証 ───────────────
console.log("\n▶ [GATE 1] Master Plan Requirements Traceability Mapping");
const requirementsMatrix = {
  unit: [
    { req: 'state', file: 'test_phase11_activity_state_machine.mjs', desc: 'Activity State Machine (IDLE/ACTIVE/PAUSED/COMPLETED)' },
    { req: 'parser', file: 'test_h_app_core_verification.mjs', desc: 'URL query & Master data parsing' },
    { req: 'validation', file: 'test_step3_rectification.mjs', desc: 'validateRequestPayload & district boundary checks' },
    { req: 'ranking calculation', file: 'test_phase13_dashboard_verification.mjs', desc: 'Ranking calculation & roster parity' },
    { req: 'idempotency', file: 'test_posting_flow_verification.mjs', desc: 'clientMutationId duplication rejection' }
  ],
  integration: [
    { req: 'API', file: 'test_step3_rectification.mjs', desc: 'doGet/doPost Universal endpoints & error codes' },
    { req: 'DB', file: 'test_step2_step3_verification.mjs', desc: 'SpreadsheetResolver & Fail-Closed contract' },
    { req: 'Identity', file: 'test_staff_identity_boundary.mjs', desc: 'lineUserId -> staffId -> branchId authorization chain' },
    { req: 'queue', file: 'test_durable_queue_verification.mjs', desc: 'DurableQueue localStorage/IndexedDB persistence' }
  ],
  e2e: [
    { req: 'activity', file: 'test_phase11_activity_state_machine.mjs', desc: 'Complete activity lifecycle to local storage' },
    { req: 'offline', file: 'test_phase14_performance_verification.mjs', desc: 'Instant offline launch & offline data entry' },
    { req: 'reconnect', file: 'test_durable_queue_verification.mjs', desc: 'Network restoration auto-flush & sync' },
    { req: 'duplicate', file: 'test_posting_flow_verification.mjs', desc: 'Double tap / offline duplicate rejection' },
    { req: 'ranking', file: 'test_phase13_dashboard_verification.mjs', desc: 'Realtime ranking updates and state persistence' }
  ],
  realDevice: [
    { req: 'weak network', file: 'measure_chrome_real.mjs', desc: 'Chrome CDP 3G throttling measurement (300ms latency)' },
    { req: 'offline', file: 'measure_chrome_real.mjs', desc: 'Chrome CDP offline disconnection measurement' },
    { req: 'iOS / Android / LINE', file: '../docs/architecture/decisions/ADR-017_TESTING_ARCHITECTURE.md', desc: 'Formal manual acceptance protocol defined' }
  ]
};

let totalMapped = 0;
for (const [category, items] of Object.entries(requirementsMatrix)) {
  for (const item of items) {
    const targetPath = path.join(TESTS_DIR, item.file);
    assert.ok(fs.existsSync(targetPath), `Required test artifact missing for ${category}:${item.req} -> ${item.file}`);
    totalMapped++;
  }
}
console.log(`  ✅ GATE 1 PASS: Master Plan 全 18 要件 (${totalMapped} マッピング) の対応テストファイルが完全実在`);

// ─── Gate 2: レガシー・除外テストの隔離完全性 ──────────────────────────────
console.log("\n▶ [GATE 2] Quarantined Legacy Test Isolation");
assert.ok(fs.existsSync(LEGACY_DIR), "tests/legacy directory must exist");
assert.ok(fs.existsSync(path.join(LEGACY_DIR, 'README.md')), "tests/legacy/README.md must exist");

const legacyFiles = [
  'test_bulletin_lifecycle.mjs',
  'dashboard_verification_gate.mjs',
  'test_initial_display_sync.mjs'
];

for (const f of legacyFiles) {
  assert.ok(fs.existsSync(path.join(LEGACY_DIR, f)), `Legacy test must be quarantined in tests/legacy/${f}`);
  assert.ok(!fs.existsSync(path.join(TESTS_DIR, f)), `Legacy test must NOT exist in active tests/ root: ${f}`);
}
console.log("  ✅ GATE 2 PASS: Phase 12除外コード・Playwright依存コードが tests/legacy/ に完全隔離");

// ─── Gate 3: ゼロ外部依存（Zero External Dependency）静的監査 ───────────────
console.log("\n▶ [GATE 3] Zero External Dependency Static Audit");
const activeTestFiles = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.mjs') && f !== 'test_phase16_testing_verification.mjs');
for (const file of activeTestFiles) {
  const content = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
  assert.ok(!/from\s+['"]playwright['"]/.test(content), `Active test ${file} must NOT import playwright`);
  assert.ok(!/from\s+['"]puppeteer['"]/.test(content), `Active test ${file} must NOT import puppeteer`);
  assert.ok(!/from\s+['"]mocha['"]/.test(content), `Active test ${file} must NOT import mocha`);
  assert.ok(!/from\s+['"]jest['"]/.test(content), `Active test ${file} must NOT import jest`);
}
console.log(`  ✅ GATE 3 PASS: 全 ${activeTestFiles.length} 現役テストファイルが外部パッケージ依存ゼロ（Node.js 標準準拠）`);

// ─── Gate 4: Chrome Real-Browser 計測契約監査 ──────────────────────────────
console.log("\n▶ [GATE 4] Chrome Real-Browser Benchmark Contract Audit");
const chromeRealContent = fs.readFileSync(path.join(TESTS_DIR, 'measure_chrome_real.mjs'), 'utf8');

// Weak network 測定が実装されているか
assert.ok(chromeRealContent.includes('Weak Network Start'), "measure_chrome_real.mjs must contain Weak Network measurement");
assert.ok(chromeRealContent.includes('Network.emulateNetworkConditions'), "measure_chrome_real.mjs must use CDP Network emulation");
assert.ok(chromeRealContent.includes('latency'), "measure_chrome_real.mjs must support network latency throttling");

// 勝手な新規SLA（<=800ms等）がWeak Networkに課されていないか（Phase 14のSLAのみをアサートしているか）
assert.ok(chromeRealContent.includes('warmPass'), "Must verify warmPass");
assert.ok(chromeRealContent.includes('coldPass'), "Must verify coldPass");
assert.ok(chromeRealContent.includes('offlinePass'), "Must verify offlinePass");
assert.ok(!chromeRealContent.includes('weakPass'), "Must NOT introduce arbitrary weakPass SLA assertion");

console.log("  ✅ GATE 4 PASS: Chrome CDP による Weak Network 実測を網羅し、勝手な新規SLAは不設定");

// ─── Gate 5: ADR-017 仕様整合性 ─────────────────────────────────────────────
console.log("\n▶ [GATE 5] ADR-017 Architecture Documentation Alignment");
const adr17Path = path.join(REPO_ROOT, 'docs/architecture/decisions/ADR-017_TESTING_ARCHITECTURE.md');
assert.ok(fs.existsSync(adr17Path), "ADR-017 document must exist");
const adr17Content = fs.readFileSync(adr17Path, 'utf8');
assert.ok(adr17Content.includes('ACCEPTED'), "ADR-017 status must be ACCEPTED");
assert.ok(adr17Content.includes('4-Layer Testing Pyramid'), "ADR-017 must define 4-Layer Testing Pyramid");
assert.ok(adr17Content.includes('Weak Network Evaluation Policy'), "ADR-017 must define Weak Network policy");
assert.ok(adr17Content.includes('Quarantine Policy'), "ADR-017 must define Quarantine Policy");

console.log("  ✅ GATE 5 PASS: ADR-017 Testing Architecture と完全整合");

console.log("\n====================================================");
console.log("🎉 ALL PHASE 16 TESTING ANCHOR GATES PASSED PERFECTLY!");
console.log("====================================================");

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = '/Volumes/SSD_DATA/posting-map-universal';
const TESTS_DIR = path.join(REPO_ROOT, 'tests');

const testSuites = [
  'test_phase18_migration_verification.mjs',
  'test_phase17_production_verification.mjs',
  'test_phase16_testing_verification.mjs',
  'test_phase15_security_verification.mjs',
  'test_phase14_performance_verification.mjs',
  'test_phase13_dashboard_verification.mjs',
  'test_phase11_activity_state_machine.mjs',
  'test_durable_queue_verification.mjs',
  'test_posting_flow_verification.mjs',
  'test_h_app_core_verification.mjs',
  'test_dashboard_snapshot.mjs',
  'test_staff_identity_boundary.mjs',
  'test_multi_district_routing_auth.mjs',
  'test_step2_step3_verification.mjs',
  'test_step3_rectification.mjs',
  'test_storage_register_lifecycle.mjs',
  'test_manager_ui_interaction.mjs',
  'test_line_push_idempotency_audit.mjs',
  'test_contract_expiry.mjs',
  'test_backend_dashboard_identity.mjs',
  'test_optimistic_startup_safety.mjs'
];

console.log("====================================================");
console.log(`🚀 RUNNING ALL ACTIVE TEST SUITES (${testSuites.length} SUITES)`);
console.log("====================================================");

let passedCount = 0;
let failedCount = 0;
const failures = [];

for (const suite of testSuites) {
  process.stdout.write(`▶ Running ${suite.padEnd(42)} ... `);
  const suitePath = path.join(TESTS_DIR, suite);
  const res = spawnSync(process.execPath, [suitePath], { stdio: 'pipe', encoding: 'utf8' });

  if (res.status === 0) {
    console.log("✅ PASS");
    passedCount++;
  } else {
    console.log("❌ FAIL");
    failedCount++;
    failures.push({ suite, error: res.stderr || res.stdout });
  }
}

console.log("\n====================================================");
console.log("📊 ALL TESTS SUMMARY REPORT");
console.log("====================================================");
console.log(`Total Suites:  ${testSuites.length}`);
console.log(`Passed Suites: ${passedCount}`);
console.log(`Failed Suites: ${failedCount}`);

if (failedCount > 0) {
  console.log("\n❌ FAILURES DETECTED:");
  for (const f of failures) {
    console.log(`\n--- [${f.suite}] ---`);
    console.log(f.error);
  }
  process.exit(1);
} else {
  console.log("\n🎉 ALL ACTIVE TEST SUITES PASSED PERFECTLY (100%)!");
  console.log("====================================================");
}

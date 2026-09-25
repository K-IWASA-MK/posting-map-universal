import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

console.log("====================================================");
console.log("🚀 PHASE 17: PRODUCTION DEPLOYMENT & VERIFICATION SUITE");
console.log("====================================================");

const REPO_ROOT = '/Volumes/SSD_DATA/posting-map-universal';
const TARGET_DEPLOYMENT_ID = 'AKfycbyjeoNc8CeTT6AyNdTSBTqLFGHs23vUaQiavSlsPKjVmMBZ5hE_KlJqN8RI12cgb7S-';
const TARGET_WEBAPP_URL = `https://script.google.com/macros/s/${TARGET_DEPLOYMENT_ID}/exec`;

// ─── Gate 1: SSOT & Deployment Configuration Integrity ─────────────
console.log("\n▶ [GATE 1] SSOT & Deployment Configuration Integrity");
const deploymentJsonPath = path.join(REPO_ROOT, 'deployment.json');
assert.ok(fs.existsSync(deploymentJsonPath), "deployment.json must exist in root");

const deploymentData = JSON.parse(fs.readFileSync(deploymentJsonPath, 'utf8'));
const confDepId = deploymentData?.resources?.deploymentId || deploymentData?.deploymentId;
const confUrl = deploymentData?.resources?.webAppUrl || deploymentData?.webAppUrl;

assert.equal(confDepId, TARGET_DEPLOYMENT_ID, "deployment.json must match TARGET_DEPLOYMENT_ID");
assert.equal(confUrl, TARGET_WEBAPP_URL, "deployment.json must match TARGET_WEBAPP_URL");

const regContent = fs.readFileSync(path.join(REPO_ROOT, 'DEPLOYMENT_REGISTRY.md'), 'utf8');
assert.ok(regContent.includes(TARGET_DEPLOYMENT_ID), "DEPLOYMENT_REGISTRY.md must contain TARGET_DEPLOYMENT_ID");
assert.ok(regContent.includes(TARGET_WEBAPP_URL), "DEPLOYMENT_REGISTRY.md must contain TARGET_WEBAPP_URL");

console.log("  ✅ GATE 1 PASS: deployment.json 及び DEPLOYMENT_REGISTRY.md のSSOT構成が完全整合");

// ─── Gate 2: Active Deployment Version Gate ─────────────────────────
console.log("\n▶ [GATE 2] Active Deployment Version Gate");
let deploymentsOutput = '';
try {
  deploymentsOutput = execSync('npx clasp deployments', { cwd: REPO_ROOT, encoding: 'utf8' });
} catch (e) {
  console.warn("  ⚠️ Warning: clasp deployments via execSync encountered issue, reading stdout:", e.message);
  deploymentsOutput = e.stdout || '';
}

assert.ok(deploymentsOutput.includes(TARGET_DEPLOYMENT_ID), "Target deployment ID must be listed in clasp deployments");

// バージョン番号の抽出 (例: AKfycby... @7)
const depRegex = new RegExp(`${TARGET_DEPLOYMENT_ID}\\s+@(\\d+)`);
const match = deploymentsOutput.match(depRegex);
assert.ok(match, "Active version must be detected in clasp deployments output");
const activeVersion = parseInt(match[1], 10);
console.log(`  - Detected Active Deployment Version: @${activeVersion}`);
assert.ok(activeVersion >= 7, `Active version must be >= 7 (Actual: @${activeVersion})`);

console.log(`  ✅ GATE 2 PASS: 本番 Deployment が新バージョン @${activeVersion} に正しく紐付けられている`);

// ─── Gate 3: Production WebApp Public API Reachability & Health ─────
console.log("\n▶ [GATE 3] Production WebApp Public API Reachability & Health");
const resDevice = await fetch(`${TARGET_WEBAPP_URL}?action=registerOrValidateDevice`);
assert.equal(resDevice.status, 200, "registerOrValidateDevice must return HTTP 200");
const jsonDevice = await resDevice.json();
assert.equal(jsonDevice.success, true, "registerOrValidateDevice must return success: true");
assert.equal(jsonDevice.authorized, true, "registerOrValidateDevice must return authorized: true");

const resStatus = await fetch(`${TARGET_WEBAPP_URL}?action=getDeviceStatus`);
assert.equal(resStatus.status, 200, "getDeviceStatus must return HTTP 200");
const jsonStatus = await resStatus.json();
assert.equal(jsonStatus.success, true, "getDeviceStatus must return success: true");
assert.equal(jsonStatus.exists, false, "getDeviceStatus must return exists: false");

console.log("  ✅ GATE 3 PASS: 本番 Web App 公開 API (registerOrValidateDevice, getDeviceStatus) が 200 OK 正常稼働");

// ─── Gate 4: Protocol & Routing Safety Gates (Live Verification) ────
console.log("\n▶ [GATE 4] Protocol & Routing Safety Gates (Live Verification)");

// 1. POST専用APIへのGET拒絶
const resMethod = await fetch(`${TARGET_WEBAPP_URL}?action=bootstrapEnvironment`);
const jsonMethod = await resMethod.json();
assert.equal(jsonMethod.success, false, "bootstrapEnvironment via GET must fail");
assert.equal(jsonMethod.code, "METHOD_NOT_ALLOWED", "Must return METHOD_NOT_ALLOWED");

// 2. 地区不一致の遮断 (SpreadsheetResolver Integrity Guard)
const resMismatch = await fetch(`${TARGET_WEBAPP_URL}?districtId=TEST_DISTRICT`);
const jsonMismatch = await resMismatch.json();
assert.equal(jsonMismatch.success, false, "Unknown district must fail");
assert.equal(jsonMismatch.code, "DISTRICT_MISMATCH", "Must return DISTRICT_MISMATCH");

// 3. 契約満了時の安全側遮断 (Contract Gate Fail-Closed)
const resExpired = await fetch(`${TARGET_WEBAPP_URL}?districtId=TEST_E2E`);
const jsonExpired = await resExpired.json();
assert.equal(jsonExpired.success, false, "Expired contract must fail");
assert.equal(jsonExpired.code, "CONTRACT_EXPIRED", "Must return CONTRACT_EXPIRED");

console.log("  ✅ GATE 4 PASS: 本番環境のプロトコル制限・地区整合性ガード・Fail-Closed契約判定が完全機能");

// ─── Gate 5: ADR-018 Architecture Compliance ────────────────────────
console.log("\n▶ [GATE 5] ADR-018 Architecture Compliance");
const adr18Path = path.join(REPO_ROOT, 'docs/architecture/decisions/ADR-018_PRODUCTION_DEPLOYMENT_SPECIFICATION.md');
assert.ok(fs.existsSync(adr18Path), "ADR-018 must exist");
const adr18Content = fs.readFileSync(adr18Path, 'utf8');
assert.ok(adr18Content.includes('ACCEPTED'), "ADR-018 status must be ACCEPTED");
assert.ok(adr18Content.includes(TARGET_DEPLOYMENT_ID), "ADR-018 must document TARGET_DEPLOYMENT_ID");
assert.ok(adr18Content.includes('Production の Web App URL はシステム資産'), "ADR-018 must document URL asset principle");

console.log("  ✅ GATE 5 PASS: ADR-018 仕様と本番デプロイが完全整合");

console.log("\n====================================================");
console.log("🎉 ALL PHASE 17 PRODUCTION VERIFICATION GATES PASSED PERFECTLY!");
console.log("====================================================");

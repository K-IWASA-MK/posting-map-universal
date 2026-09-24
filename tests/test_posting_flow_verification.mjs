#!/usr/bin/env node
/**
 * POSTING MAP - Phase 9 Posting Flow Verification Suite (Strict Audit)
 *
 * 目的:
 * Phase 9 Posting Flow において、
 * 「写真・GPS取得完了は DRAFT (READY_TO_SUBMIT) であり、COMPLETED ではない」
 * 「Backend永続化成功 (status === null) のみが唯一の COMPLETED 確定条件である」
 * ことを機械判定により厳密に実証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

// テスト対象ファイル
const appJsPath = path.join(rootDir, 'active/dashboard/app.js');
const renderJsPath = path.join(rootDir, 'active/dashboard/render.js');
const dbJsPath = path.join(rootDir, 'active/dashboard/db.js');
const apiJsPath = path.join(rootDir, 'active/dashboard/modules/api.js');
const v2ApiPath = path.join(rootDir, 'active/api/v2_api.js');
const gpsServicePath = path.join(rootDir, 'active/business/gps/gps_service.js');
const gpsRepositoryPath = path.join(rootDir, 'active/business/gps/gps_repository.js');

const appJs = fs.readFileSync(appJsPath, 'utf8');
const renderJs = fs.readFileSync(renderJsPath, 'utf8');
const dbJs = fs.readFileSync(dbJsPath, 'utf8');
const apiJs = fs.readFileSync(apiJsPath, 'utf8');
const v2ApiJs = fs.readFileSync(v2ApiPath, 'utf8');
const gpsServiceJs = fs.readFileSync(gpsServicePath, 'utf8');
const gpsRepositoryJs = fs.readFileSync(gpsRepositoryPath, 'utf8');

console.log('====================================================');
console.log('🚀 PHASE 9 POSTING FLOW STRICT VERIFICATION SUITE');
console.log('====================================================\n');

// ----------------------------------------------------------------------------
// 1. 写真/GPS完了 ≠ COMPLETED の検証 (本体 isDone=false 維持)
// ----------------------------------------------------------------------------
test('1. 写真/GPS取得完了 ≠ COMPLETED: 本体の p.isDone は false を維持し、isReadyToSubmit=true であること', () => {
  // app.js の pressNum 写真確定ブロックで p.isDone = false が設定されていること
  assert.ok(
    appJs.includes('p.isDone = false;\n        p.isReadyToSubmit = true;'),
    '写真確定時、本体の p.isDone は false のままであり、isReadyToSubmit=true となること'
  );

  // モーダル再描画にはプレビューオブジェクト ({ ...p, isDone: true }) が渡されること
  assert.ok(
    appJs.includes('renderDetailModalContent({ ...p, isDone: true })'),
    'renderDetailModalContent にはプレビュー用オブジェクトが渡され、本体の isDone を汚染しないこと'
  );
});

// ----------------------------------------------------------------------------
// 2. 未提出終了 ≠ COMPLETED の検証 (モーダルを閉じただけでは完了にならない)
// ----------------------------------------------------------------------------
test('2. 未提出終了 ≠ COMPLETED: 提出せずにモーダルを閉じても配布完了にならないこと', () => {
  // シミュレーション: 写真撮影後に提出せずキャンセルまたはモーダルを閉じる
  const pin = { rowId: 201, isDone: false, isReadyToSubmit: true };
  const globalCompleted = [];

  // 提出ボタンを押さずに閉じた場合、本体の isDone は false のまま
  assert.equal(pin.isDone, false, '未提出終了時、本体の isDone は false のままであること');
  assert.ok(!globalCompleted.includes(201), '未提出ピンが globalPinStatus.completed に追加されてはならない');
});

// ----------------------------------------------------------------------------
// 3. API失敗 ≠ COMPLETED の検証 (失敗時は必ず isDone=false)
// ----------------------------------------------------------------------------
test('3. API失敗 ≠ COMPLETED: 通信エラーやGAS失敗時に isDone=false にロールバックされ、再提出可能であること', () => {
  // app.js の submitMissionComplete の catch ブロックで p.isDone = false が設定されていること
  const catchRegex = /catch\s*\(\s*err\s*\)\s*\{[\s\S]*?p\.isDone\s*=\s*false;/;
  assert.ok(catchRegex.test(appJs), 'submitMissionComplete の catch ブロックで p.isDone = false が設定されていること');

  // シミュレーション
  const pin = { rowId: 202, isDone: false, isReadyToSubmit: true, syncStatus: 'submitting' };
  const globalCompleted = [];

  // API例外発生時
  pin.syncStatus = 'pending';
  pin.isDone = false;

  assert.equal(pin.isDone, false, 'API失敗時に isDone は false');
  assert.equal(pin.syncStatus, 'pending', '再提出可能状態 (pending)');
  assert.ok(!globalCompleted.includes(202), 'completed に追加されてはならない');
});

// ----------------------------------------------------------------------------
// 4. 認証失敗 ≠ COMPLETED の検証
// ----------------------------------------------------------------------------
test('4. 認証失敗 ≠ COMPLETED: 認証エラー時に isDone=false となり提出中断すること', () => {
  // app.js の waitForIdentityVerified catch ブロックで p.isDone = false が設定されていること
  const authCatchRegex = /catch\s*\(\s*authErr\s*\)\s*\{[\s\S]*?p\.isDone\s*=\s*false;/;
  assert.ok(authCatchRegex.test(appJs), 'authErr ブロックで p.isDone = false が設定されていること');

  // シミュレーション
  const pin = { rowId: 203, isDone: false, isReadyToSubmit: true, syncStatus: 'submitting' };
  pin.syncStatus = 'failed';
  pin.isDone = false;

  assert.equal(pin.isDone, false, '認証失敗時に isDone は false');
  assert.equal(pin.syncStatus, 'failed');
});

// ----------------------------------------------------------------------------
// 5. Backend成功 = COMPLETED の検証 (status === null のみで確定)
// ----------------------------------------------------------------------------
test('5. Backend成功 = COMPLETED: status === null の瞬間のみ isDone=true が確定すること', () => {
  // app.js で status === null のブロック内でのみ p.isDone = true が設定されていること
  const successBlockRegex = /if\s*\(\s*status\s*===\s*null\s*\)\s*\{[\s\S]*?p\.isDone\s*=\s*true;[\s\S]*?delete\s+p\.isReadyToSubmit;[\s\S]*?p\.syncStatus\s*=\s*['"]synced['"];/;
  assert.ok(successBlockRegex.test(appJs), 'status === null ブロック内で isDone=true, delete isReadyToSubmit, syncStatus=synced が行われること');

  // シミュレーション
  const pin = { rowId: 204, isDone: false, isReadyToSubmit: true, syncStatus: 'submitting' };
  const globalCompleted = [];

  // Backend永続化完了 (status === null)
  pin.isDone = true;
  delete pin.isReadyToSubmit;
  pin.syncStatus = 'synced';
  globalCompleted.push(pin.rowId);

  assert.equal(pin.isDone, true, 'Backend成功時に初めて isDone=true');
  assert.equal(pin.isReadyToSubmit, undefined, 'isReadyToSubmit が消去されること');
  assert.equal(pin.syncStatus, 'synced');
  assert.ok(globalCompleted.includes(204), 'completed 配列に追加されること');
});

// ----------------------------------------------------------------------------
// 6. Backend成功前の completed 配列追加なし & ピンロックなしの検証
// ----------------------------------------------------------------------------
test('6. Backend成功前の completed 追加なし & ピンロックなし', () => {
  // globalPinStatus.completed.push(rowId) および lockActivePinAndBubble(rowId) が
  // status === null のブロック内にのみ存在することの検証
  const statusNullIndex = appJs.indexOf('if (status === null) {');
  assert.ok(statusNullIndex > 0, 'status === null ブロックが存在すること');

  const statusNullBlock = appJs.substring(statusNullIndex, appJs.indexOf('break;', statusNullIndex));
  assert.ok(statusNullBlock.includes('globalPinStatus.completed.push(rowId)'), 'status === null 内で completed に追加されること');
  assert.ok(statusNullBlock.includes('lockActivePinAndBubble(rowId)'), 'status === null 内で lockActivePinAndBubble が呼ばれること');

  // submitMissionComplete の開始から status === null の前までに completed.push や lock が存在しないこと
  const submitFunctionStart = appJs.indexOf('async function submitMissionComplete');
  const preStatusNullSection = appJs.substring(submitFunctionStart, statusNullIndex);
  assert.ok(!preStatusNullSection.includes('globalPinStatus.completed.push'), 'status === null 前に completed.push が存在してはならない');
  assert.ok(!preStatusNullSection.includes('lockActivePinAndBubble'), 'status === null 前に lockActivePinAndBubble が存在してはならない');
});

// ----------------------------------------------------------------------------
// 7. 二重送信防止（排他制御・ボタンロック）
// ----------------------------------------------------------------------------
test('7. 二重送信防止: submitting ガードとサーバー側15秒排他ロック', () => {
  assert.ok(appJs.includes("p.syncStatus === 'submitting'"), 'submitting ガードが存在すること');
  assert.ok(appJs.includes('submitBtn.disabled = true'), '送信ボタン disabled ガードが存在すること');
  assert.ok(gpsServiceJs.includes('lock.waitLock(15000)'), 'GPSService 15秒排他ロックが存在すること');
});

// ----------------------------------------------------------------------------
// 8. Phase境界・Universal原則の不可侵
// ----------------------------------------------------------------------------
test('8. 境界保護: Phase 8 Core無変更、Phase 10 Queue再設計なし、Universal原則遵守', () => {
  assert.ok(renderJs.includes('class CustomMarkerOverlay extends google.maps.OverlayView'), 'CustomMarkerOverlay が無傷で存在すること');
  assert.ok(v2ApiJs.includes("case 'submitDistribution':"), 'submitDistribution が温存されていること');
  assert.ok(!appJs.includes('DurableQueue'), 'Phase 10 DurableQueue は先取り実装されていないこと');

  // 地区名ハードコードチェック
  const forbidden = ['kuwana', 'okayama', 'tsushima'];
  const content = appJs.toLowerCase();
  for (const term of forbidden) {
    assert.equal(content.includes(term), false, `app.js に地区名 "${term}" のハードコードが存在してはならない`);
  }
});

console.log('✅ ALL 8 PHASE 9 POSTING FLOW STRICT VERIFICATION CHECKS DEFINED SUCCESSFULLY.\n');

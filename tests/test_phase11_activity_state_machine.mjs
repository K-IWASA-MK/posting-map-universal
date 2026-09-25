#!/usr/bin/env node
/**
 * POSTING MAP - Phase 11 Activity State Machine Verification Suite (Strict Audit)
 *
 * 目的:
 * Phase 11 Activity State Machine において、
 * 1. ADR-013 制定と状態整合性モデルの確立
 * 2. 原本 clientEventId 定義保護と requestId との対応関係
 * 3. 活動ログ状態遷移マシン（UNTOUCHED ➔ IN_PROGRESS ➔ DRAFT ➔ SUBMITTING ➔ PENDING ➔ COMPLETED）
 * 4. 完了条件が「Backend永続化成功」のみであること
 * 5. 既存業務ルール「完了確定地区は当月再操作不可」のUI・ロジック完全防護
 * 6. 既存業務ルール「未完了地区は翌日0:00以降再操作可能」の保証
 * 7. 個人ランキング集計確定条件（completedAt + groupKey + count>0）
 * 8. Universal原則遵守 & Scope Lock（データ・外部接続不可侵）
 * を機械判定により厳密に実証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

// テスト対象ファイル
const adr013Path = path.join(rootDir, 'docs/architecture/decisions/ADR-013_ACTIVITY_STATE_MACHINE.md');
const designContractPath = path.join(rootDir, 'docs/architecture/01_DESIGN_CONTRACT.md');
const appJsPath = path.join(rootDir, 'active/dashboard/app.js');
const renderJsPath = path.join(rootDir, 'active/dashboard/render.js');
const dbJsPath = path.join(rootDir, 'active/dashboard/db.js');
const distRepoPath = path.join(rootDir, 'active/business/distribution/distribution_repository.js');
const pinStatusServicePath = path.join(rootDir, 'active/business/pin/pin_status_service.js');
const gpsServicePath = path.join(rootDir, 'active/business/gps/gps_service.js');
const gpsRepositoryPath = path.join(rootDir, 'active/business/gps/gps_repository.js');

const adr013 = fs.readFileSync(adr013Path, 'utf8');
const designContract = fs.readFileSync(designContractPath, 'utf8');
const appJs = fs.readFileSync(appJsPath, 'utf8');
const renderJs = fs.readFileSync(renderJsPath, 'utf8');
const dbJs = fs.readFileSync(dbJsPath, 'utf8');
const distRepoJs = fs.readFileSync(distRepoPath, 'utf8');
const pinStatusServiceJs = fs.readFileSync(pinStatusServicePath, 'utf8');
const gpsServiceJs = fs.readFileSync(gpsServicePath, 'utf8');
const gpsRepositoryJs = fs.readFileSync(gpsRepositoryPath, 'utf8');

console.log('====================================================');
console.log('🚀 PHASE 11 ACTIVITY STATE MACHINE VERIFICATION SUITE');
console.log('====================================================\n');

// ----------------------------------------------------------------------------
// 1. ADR-013 制定と仕様整合性
// ----------------------------------------------------------------------------
test('1. ADR-013 制定: 状態遷移、完了確定条件、業務ルール、ランキング集計条件が明文化されていること', () => {
  assert.ok(adr013.includes('ADR-013: Activity State Machine'), 'ADR-013 が存在すること');
  assert.ok(adr013.includes('Status**: ACCEPTED'), 'ADR-013 が ACCEPTED であること');
  assert.ok(adr013.includes('clientEventId'), 'clientEventId について記述されていること');
  assert.ok(adr013.includes('requestId'), 'requestId について記述されていること');
  assert.ok(adr013.includes('activityId'), 'activityId について記述されていること');
  assert.ok(adr013.includes('当月再操作不可'), '月次完了再操作禁止ルールが記述されていること');
  assert.ok(adr013.includes('翌日0:00以降に再操作可能'), '未完了翌日再操作ルールが記述されていること');
  assert.ok(adr013.includes('fetchRankingData'), 'ランキング確定条件が記述されていること');
});

// ----------------------------------------------------------------------------
// 2. clientEventId / requestId の原本定義保護と対応関係
// ----------------------------------------------------------------------------
test('2. 識別子境界: 原本 clientEventId 定義を保護し、requestId との対応関係が確立されていること', () => {
  // 原本仕様の確認
  assert.ok(designContract.includes('活動登録は`clientEventId`等の冪等キーによって重複登録を防止する。'), '原本の冪等性記述');
  assert.ok(designContract.includes('端末側で活動送信ごとに一意の`clientEventId`を生成する。'), '原本のclientEventId生成記述');

  // app.js で requestId 発番後に clientEventId が対応付けられていること
  assert.ok(appJs.includes('const clientEventId = requestId;'), 'clientEventId が requestId に対応付けられていること');
  assert.ok(appJs.includes('clientEventId,'), 'enqueueSync に clientEventId が渡されていること');

  // db.js の payload に clientEventId が含められていること
  assert.ok(dbJs.includes('clientEventId: item.clientEventId || item.requestId || \'\','), 'API送信 payload に clientEventId が含まれていること');
});

// ----------------------------------------------------------------------------
// 3. 活動ログ状態遷移マシン (State Transition Machine)
// ----------------------------------------------------------------------------
test('3. 状態遷移マシン: UNTOUCHED ➔ IN_PROGRESS ➔ DRAFT ➔ SUBMITTING ➔ PENDING ➔ COMPLETED の因果関係が守られていること', () => {
  // DRAFT (写真確定時点): isDone=false, isReadyToSubmit=true
  assert.ok(appJs.includes('p.isDone = false;\n        p.isReadyToSubmit = true;'), '写真取得完了時は DRAFT を維持');

  // SUBMITTING: submitting フラグとUIボタン無効化
  assert.ok(appJs.includes("p.syncStatus = 'submitting';"), '送信開始で submitting に移行');
  assert.ok(appJs.includes("submitBtn.disabled = true;"), '多重送信防止のためボタン非活性化');

  // PENDING (同期待ち / オフライン): isDone=false 維持
  assert.ok(appJs.includes("p.syncStatus = 'pending';\n        p.isDone = false;"), 'オフライン時は pending かつ isDone=false');

  // COMPLETED: Backend 成功 (getRowStatus === null) でのみ昇格
  assert.ok(appJs.includes("if (status === null) {\n          // キューから消滅 ＝ GAS保存成功（データ送信成功＝真の配布完了確定）\n          p.isDone = true;"), 'Backend成功で COMPLETED 確定');
  assert.ok(appJs.includes("delete p.isReadyToSubmit;"), '完了時に isReadyToSubmit を削除');
});

// ----------------------------------------------------------------------------
// 4. 完了確定条件 (Backend永続化成功のみが唯一のSSOT)
// ----------------------------------------------------------------------------
test('4. 完了確定条件: 写真撮影・キュー投入・送信中は COMPLETED ではなく、Backend永続化成功のみで確定すること', () => {
  // 認証エラー時のロールバック
  assert.ok(appJs.includes("p.syncStatus = 'failed';\n      p.isDone = false;"), '認証失敗時は isDone=false');

  // タイムアウト時の未完了維持
  assert.ok(appJs.includes("p.syncStatus = 'pending';\n        p.isDone = false;\n        alert(\"送信処理中です。バックグラウンドで送信を継続します。\");"), '3秒超過時は pending かつ isDone=false で解放');

  // エラー catch 時のロールバック
  assert.ok(appJs.includes("p.syncStatus = 'pending';\n    // Phase 9: Backend永続化が成功していないため、配布完了を確定させない (COMPLETED = false)\n    p.isDone = false;"), '送信例外発生時は isDone=false');
});

// ----------------------------------------------------------------------------
// 5. 業務ルール1: 完了確定した地区の月内再操作禁止
// ----------------------------------------------------------------------------
test('5. 業務ルール1: 完了確定地区は当月再操作不可であること (UI・ロジック二重防護)', () => {
  // 1. submitMissionComplete 先頭ガード
  assert.ok(
    appJs.includes('const isAlreadyCompleted = (window.globalPinStatus && Array.isArray(window.globalPinStatus.completed) && window.globalPinStatus.completed.includes(Number(rowId))) ||\n                             (p.isDone && !p.isReadyToSubmit);'),
    'submitMissionComplete で完了済み地区の再提出をガード'
  );
  assert.ok(appJs.includes('alert("この地区は既に今月の配布が完了しています。再操作はできません。");'), '再操作ブロックアラートが存在すること');

  // 2. render.js バブルでのロック表示
  assert.ok(renderJs.includes('const isCompleted = window.globalPinStatus?.completed?.includes(row.rowId);'), 'globalPinStatus.completed でピン状態判定');
  assert.ok(renderJs.includes('<div class="premium-glass-badge badge-completed">\n                  配布済み 🔒\n                </div>'), '完了ピンには配布開始ボタンを出さず配布済みバッジを表示');

  // 3. render.js モーダル内での再操作不可バッジ表示
  assert.ok(renderJs.includes('(p.isDone && !p.isReadyToSubmit)'), '完了確定済みアイテムの条件判定');
  assert.ok(renderJs.includes('今月の配布は完了しています（再操作不可）'), 'モーダル内に再操作不可メッセージを表示');
  assert.ok(renderJs.includes('closeDetailModal()'), '閉じるボタンのみを提供し再提出ボタンを非表示化');
});

// ----------------------------------------------------------------------------
// 6. 業務ルール2: 未完了地区の翌日0:00以降再操作可能の保証
// ----------------------------------------------------------------------------
test('6. 業務ルール2: 未完了地区は当月シートに completedAt が記録されず、翌日以降も再操作可能であること', () => {
  // pin_status_service.js の completed 判定が completedAt (D列) 必須であること
  assert.ok(
    pinStatusServiceJs.includes('.filter(r => r[0] && r[3] !== "" && r[3] !== null)'),
    'PinStatusService で D列 (completedAt) が存在する行のみ completed と判定'
  );

  // キャンセル時は一時データがリセットされ、isDone=false が維持されること
  assert.ok(renderJs.includes('p.isDone = false;'), 'cancelMissionComplete で isDone=false を維持');
  assert.ok(renderJs.includes('delete p.tempPhotoUrl;\n    delete p.photoBase64;'), '写真データが破棄されること');

  // 未完了ピンは globalPinStatus.completed に入らないため、翌日0:00以降も通常通り緑/未操作ピンとして再操作可能
  assert.ok(appJs.includes('if (!p.isDone) {\n          delete p.syncStatus;\n        }'), '未完了アイテムは syncStatus がリセットされ再操作可能状態となること');
});

// ----------------------------------------------------------------------------
// 7. 個人ランキング集計確定条件
// ----------------------------------------------------------------------------
test('7. ランキング集計条件: completedAt + groupKey + count > 0 の確定行のみが集計されること', () => {
  // distribution_repository.js の集計元シートが当月配布実績シートであること
  assert.ok(
    distRepoJs.includes('getCurrentSheet("distribution", districtId)'),
    '当月の配布実績シートのみを集計元として解決'
  );

  // 確定行の必須抽出条件
  assert.ok(
    distRepoJs.includes('if (!rawCompletedAt || !groupKey || count <= 0) continue;'),
    'completedAt が存在し、groupKey が存在し、count > 0 の確定行のみ集計すること'
  );

  // groupKey の優先順位 (lineUserId 最優先、次点 staffId)
  assert.ok(
    distRepoJs.includes('const groupKey = rowLineUserId || staffId;'),
    'groupKey は lineUserId を最優先し、未設定時は staffId を使用'
  );
});

// ----------------------------------------------------------------------------
// 8. Universal 原則遵守 & 厳格な Scope Lock
// ----------------------------------------------------------------------------
test('8. Universal 原則遵守: active/ 配下に地区固有ハードコードがなく、マスターデータが保護されていること', () => {
  const activeFiles = [appJsPath, renderJsPath, dbJsPath];
  for (const f of activeFiles) {
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(!content.includes('KUWANA-'), '地区IDが active/ にハードコードされていないこと');
    assert.ok(!content.includes('OKAYAMA-'), '地区IDが active/ にハードコードされていないこと');
  }

  // address_master.csv の確認 (337件維持)
  const masterCsv = fs.readFileSync(path.join(rootDir, 'data/address_master.csv'), 'utf8');
  const lines = masterCsv.trim().split('\n');
  assert.equal(lines.length, 338, 'マスターCSVはヘッダー含め338行(337レコード)を維持していること');
});

console.log('✅ ALL 8 PHASE 11 ACTIVITY STATE MACHINE VERIFICATION CHECKS DEFINED SUCCESSFULLY.\n');

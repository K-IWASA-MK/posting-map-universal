/**
 * GAS v2 - バッチ処理モジュール
 * - Drive写真自動整理・保管管理
 * - PinStatus 日次クリーンアップ
 * - トリガー管理
 *
 * ※ 旧世代の個別エリアシート生成(forceStartBatch, generateAreaSheetsBatch)および
 *    旧月末全消去方式(checkEndOfMonthAndReset)は、DistrictProvisioner への全面移行に伴い完全撤去されました。
 */

// =============================================
// ① トリガー共通管理
// =============================================

function deleteTriggers(name) {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === name) ScriptApp.deleteTrigger(t);
  });
}

// =============================================
// ② Drive写真 自動整理バッチ
// - 90日超: /evidence → /archive へ移動
// - 180日超: /archive 内ファイルをゴミ箱へ
// =============================================

/**
 * Googleドライブの証拠写真を自動整理する。
 * setupCleanupTrigger() で毎日深夜2〜3時に自動実行される。
 */
function cleanupDrivePhotos() {
  const parentFolderId = getStorageFolderId();
  let parentFolder;
  try {
    parentFolder = DriveApp.getFolderById(parentFolderId);
  } catch (e) {
    console.error("cleanupDrivePhotos: parent folder not found:", e);
    return;
  }

  const now = new Date();
  const MS_90_DAYS  = 90  * 24 * 60 * 60 * 1000;
  const MS_180_DAYS = 180 * 24 * 60 * 60 * 1000;

  // --- /evidence フォルダを取得 ---
  const evidenceFolders = parentFolder.getFoldersByName("evidence");
  if (evidenceFolders.hasNext()) {
    const evidenceFolder = evidenceFolders.next();

    // /archive フォルダを取得または作成
    const archiveFolders = parentFolder.getFoldersByName("archive");
    let archiveFolder;
    if (archiveFolders.hasNext()) {
      archiveFolder = archiveFolders.next();
    } else {
      archiveFolder = parentFolder.createFolder("archive");
    }

    // 90日以上経過したファイルを /archive へ移動
    const evidenceFiles = evidenceFolder.getFiles();
    let movedCount = 0;
    while (evidenceFiles.hasNext()) {
      const file = evidenceFiles.next();
      const age = now - file.getDateCreated();
      if (age > MS_90_DAYS) {
        file.moveTo(archiveFolder);
        movedCount++;
      }
    }
    if (movedCount > 0) {
      console.log(`cleanupDrivePhotos: ${movedCount} files moved to /archive`);
    }
  }

  // --- /archive フォルダを取得 ---
  const archiveFolders2 = parentFolder.getFoldersByName("archive");
  if (archiveFolders2.hasNext()) {
    const archiveFolder = archiveFolders2.next();

    // 180日以上経過したファイルをゴミ箱へ
    const archiveFiles = archiveFolder.getFiles();
    let deletedCount = 0;
    while (archiveFiles.hasNext()) {
      const file = archiveFiles.next();
      const age = now - file.getDateCreated();
      if (age > MS_180_DAYS) {
        file.setTrashed(true);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`cleanupDrivePhotos: ${deletedCount} files trashed from /archive`);
    }
  }
}

/**
 * cleanupDrivePhotos の時間主導型トリガーを設定する。
 * GASエディタから手動で1回だけ実行すること。
 * 既存トリガーを削除してから新規作成するため、重複しない。
 */
function setupCleanupTrigger() {
  deleteTriggers("cleanupDrivePhotos");
  ScriptApp.newTrigger("cleanupDrivePhotos")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  console.log("cleanupDrivePhotos trigger set: daily at 2:00 AM JST");
}

/**
 * C-5 Field Result Sync Foundation
 * 30日経過写真の自動削除バッチ
 */
function cleanupOldPhotosBatch() {
  const folderId = (typeof getStorageFolderId === 'function') ? getStorageFolderId() : null;
  if (!folderId) {
    console.error("cleanupOldPhotosBatch: Storage folder not found.");
    return;
  }

  try {
    const folder = DriveApp.getFolderById(folderId);
    const now = new Date();
    const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

    // 写真専用フォルダ直下のファイルのみを走査
    const files = folder.getFiles();
    let trashedCount = 0;
    while (files.hasNext()) {
      const file = files.next();
      const age = now - file.getDateCreated();
      if (age > MS_30_DAYS && !file.isTrashed()) {
        file.setTrashed(true);
        trashedCount++;
      }
    }

    console.log(`cleanupOldPhotosBatch: ${trashedCount} old photos moved to trash.`);
  } catch(e) {
    console.error("cleanupOldPhotosBatch error:", e);
  }
}

/**
 * 30日削除バッチの時間主導型トリガーを設定する
 */
function setupPhotoCleanupTrigger() {
  // 既存の同名トリガーがあれば削除（二重作成防止）
  deleteTriggers("cleanupOldPhotosBatch");
  ScriptApp.newTrigger("cleanupOldPhotosBatch")
    .timeBased()
    .everyDays(1)
    .atHour(3) // 3 AM JST
    .create();
  console.log("cleanupOldPhotosBatch trigger set: daily at 3:00 AM JST");
}

// =============================================
// ③ PinStatus 日次クリーンアップ
// =============================================

/**
 * PinStatus 日次クリーンアップ
 * 毎日0:00頃の時間主導型トリガーから実行。
 * PinStatus シートに残存した IN_PROGRESS データを全件クリアする。
 * 配布実績シートを含む他シートには一切アクセス・変更しない。
 */
function cleanupPinStatusDaily() {
  try {
    let pinSheet = null;
    if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
      pinSheet = MonthlySheetResolver.getInstance().getCurrentSheet("pin");
    }
    if (!pinSheet) {
      console.log("cleanupPinStatusDaily: PinStatus sheet does not exist. Nothing to clear.");
      return;
    }

    const lr = pinSheet.getLastRow();
    if (lr <= 1) {
      console.log("cleanupPinStatusDaily: PinStatus sheet has no data rows. Nothing to clear.");
      return;
    }

    const lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) {
      try {
        pinSheet.deleteRows(2, lr - 1);
        SpreadsheetApp.flush();
        console.log(`cleanupPinStatusDaily: PinStatus cleared successfully (${lr - 1} rows cleared, header preserved).`);
      } finally {
        lock.releaseLock();
      }
    } else {
      console.warn("cleanupPinStatusDaily: Could not obtain lock.");
    }
  } catch (e) {
    console.error("cleanupPinStatusDaily error: " + e.toString());
  }
}

/**
 * PinStatus 日次クリーンアップの時間主導型トリガーを設定する
 * 既存の同名トリガーを削除してから新規登録（多重登録防止）
 * 毎日 0:00 (午前0時〜1時) に1回実行
 */
function setupPinStatusCleanupTrigger() {
  deleteTriggers("cleanupPinStatusDaily");
  ScriptApp.newTrigger("cleanupPinStatusDaily")
    .timeBased()
    .everyDays(1)
    .atHour(0) // 0:00 AM JST
    .create();
  console.log("cleanupPinStatusDaily trigger set: daily at 0:00 AM JST");
}

/**
 * 名簿および名簿の原本シートを初期化・再構築
 * (M-01: v2_ui.js から移設)
 */
function setupRosterSheet() {
  const ss = (typeof getSS === 'function') ? getSS() : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
  if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
    DistrictProvisioner.getInstance().createStaffMaster(ss);
    DistrictProvisioner.getInstance().rolloverMonthlySheets();
    return "名簿の原本および当月名簿を4列新SSOT構造で再構築しました。";
  }
  return "DistrictProvisioner not available";
}

/**
 * 日次トリガーから実行される月次判定・自動生成関数
 * (M-02: v2_ui.js から移設)
 */
function rolloverMonthlySheetsDailyCheck() {
  if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
    DistrictProvisioner.getInstance().rolloverMonthlySheets();
  }
}

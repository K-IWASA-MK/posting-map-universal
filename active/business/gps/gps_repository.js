/**
 * Business Layer - GPS Repository Module
 *
 * Domain: GPS / Photo Domain
 * Layer: Business Layer
 * Responsibility: Google Drive への写真保存、指定エリアシートへの GPS・写真情報書き込み
 */

if (typeof sanitizeFormula === 'undefined') {
  sanitizeFormula = function(val) {
    if (typeof val !== 'string') return val;
    if (/^[=\+\-@\t\r]/.test(val)) {
      return "'" + val;
    }
    return val;
  };
}

if (typeof GPSRepository === 'undefined') {
  GPSRepository = class GPSRepository {
    constructor() {
      this.driveAdapter = (typeof DriveAdapter !== 'undefined') ? new DriveAdapter() : null;
      this.spreadsheetAdapter = (typeof SpreadsheetAdapter !== 'undefined') ? new SpreadsheetAdapter() : null;
    }

    static getInstance() {
      if (!GPSRepository.instance) {
        GPSRepository.instance = new GPSRepository();
      }
      return GPSRepository.instance;
    }

    savePhotoToDrive(data, rowIdNum) {
      if (!data.photoData || data.photoData.indexOf("data:image") !== 0) {
        return { success: false };
      }
      try {
        const folderId = (typeof getStorageFolderId === 'function') ? getStorageFolderId() : null;
        if (!folderId) return { success: false };
        const folder = DriveApp.getFolderById(folderId);
        const now = new Date();
        const yyyyMMdd = Utilities.formatDate(now, "JST", "yyyyMMdd");
        const HHmmss = Utilities.formatDate(now, "JST", "HHmmss");

        // Sanitize staffName
        let safeStaffName = data.staffName ? String(data.staffName) : "Unknown";
        safeStaffName = safeStaffName.replace(/[\\/:*?"<>|\s　]/g, "_");

        const fileName = `${rowIdNum}_${safeStaffName}_${yyyyMMdd}_${HHmmss}.jpg`;
        const base64Data = data.photoData.split(",")[1];
        const decoded = Utilities.base64Decode(base64Data);
        const blob = Utilities.newBlob(decoded, "image/jpeg", fileName);
        const file = folder.createFile(blob);
        return { success: true, fileId: file.getId() };
      } catch (driveErr) {
        console.error("Google Drive Save Error:", driveErr);
        return { success: false };
      }
    }

    getDistributionSheet() {
      if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
        return MonthlySheetResolver.getInstance().getCurrentSheet("distribution");
      }
      return null;
    }

    checkExistingStatus(rowIdNum) {
      try {
        const sheet = this.getDistributionSheet();
        if (!sheet) return null;

        const finder = sheet.getRange("A:A").createTextFinder(String(rowIdNum)).matchEntireCell(true);
        const cell = finder.findNext();
        if (cell) {
           const row = cell.getRow();
           // H(8): GPS, I(9): 写真, J(10): lat, K(11): lng, L(12): gpsTime, M(13): fileId, N(14): photoUrl, O(15): photoTime
           const rowValues = sheet.getRange(row, 8, 1, 8).getValues()[0];
           const gpsStatus = rowValues[0] === "OK" ? "OK" : "NO";
           const photoStatus = rowValues[1] === "OK" ? "OK" : "NO";
           return {
             found: true, rowNum: row, gpsStatus, photoStatus,
             existingLat: rowValues[2] || "",
             existingLng: rowValues[3] || "",
             existingGpsTime: rowValues[4] || "",
             existingFileId: rowValues[5] || "",
             existingPhotoUrl: rowValues[6] || "",
             existingPhotoTime: rowValues[7] || ""
           };
        }
      } catch (e) {
        console.error("checkExistingStatus error:", e);
      }
      return null;
    }

    updateSheetRecordAndLog(data, rowIdNum, gpsStatus, photoStatus, existing, photoFileId) {
      const isComplete = data.isDone === 'true' || data.isDone === true;
      const timestamp = Date.now();
      const completedAt = Utilities.formatDate(new Date(timestamp), "JST", "yyyy/MM/dd HH:mm:ss");

      let finalGpsStatus = gpsStatus;

      let latNum = existing ? existing.existingLat : "";
      let lngNum = existing ? existing.existingLng : "";
      let gpsTimestamp = existing ? existing.existingGpsTime : "";

      let pFileId = existing ? existing.existingFileId : "";
      let pUrl = existing ? existing.existingPhotoUrl : "";
      let pTimestamp = existing ? existing.existingPhotoTime : "";

      if (isComplete && gpsStatus !== "OK") {
         const latTemp = Number(data.latitude);
         const lngTemp = Number(data.longitude);
         const isValidGps = typeof data.latitude !== "undefined" && data.latitude !== null && data.latitude !== "" &&
                            typeof data.longitude !== "undefined" && data.longitude !== null && data.longitude !== "" &&
                            !Number.isNaN(latTemp) && Number.isFinite(latTemp) && latTemp !== 0 &&
                            !Number.isNaN(lngTemp) && Number.isFinite(lngTemp) && lngTemp !== 0;

         if (isValidGps) {
           finalGpsStatus = "OK";
           latNum = Number(latTemp);
           lngNum = Number(lngTemp);
           gpsTimestamp = completedAt;
         } else {
           finalGpsStatus = "NO";
         }
      } else if (existing && existing.gpsStatus === "OK") {
         finalGpsStatus = "OK";
      }

      if (isComplete && photoStatus === "OK" && photoFileId) {
         pFileId = photoFileId;
         pUrl = "https://drive.google.com/file/d/" + pFileId + "/view";
         pTimestamp = completedAt;
      }

      const countVal = parseFloat(data.count) || 0;
      let updateSuccess = false;
      let targetRow = existing ? existing.rowNum : null;

      let ss = null;
      if (typeof getSS === 'function') {
        ss = getSS();
      }

      try {
        const sheet = this.getDistributionSheet();
        if (sheet) {
          if (!targetRow) {
            const finder = sheet.getRange("A:A").createTextFinder(String(rowIdNum)).matchEntireCell(true);
            const cell = finder.findNext();
            if (cell) targetRow = cell.getRow();
          }
          if (targetRow) {
            const cleanLineUserId = String(data.resolvedLineUserId || data.lineUserId || (data.user && data.user.lineUserId) || "").trim();
            if (isComplete) {
              sheet.getRange(targetRow, 4, 1, 13).setValues([[
                completedAt,
                countVal,
                data.staffId || "",
                sanitizeFormula(data.staffName || ""),
                finalGpsStatus,
                photoStatus,
                latNum,
                lngNum,
                gpsTimestamp,
                pFileId,
                pUrl,
                pTimestamp,
                cleanLineUserId
              ]]);
            } else {
              sheet.getRange(targetRow, 4, 1, 13).setValues([["", "", "", "", "", "", "", "", "", "", "", "", ""]]); // Revert D to P
            }
            updateSuccess = true;
          }
        }
      } catch(e) {
        updateSuccess = false;
        console.error("Spreadsheet write error:", e);
      }

      if (!updateSuccess) return { success: false, message: "Spreadsheet record update failed or row not found" };
      return { success: true, rowId: rowIdNum, count: countVal, gpsStatus: finalGpsStatus, photoStatus: photoStatus, timestamp: completedAt };
    }
  };
  GPSRepository.instance = null;
}

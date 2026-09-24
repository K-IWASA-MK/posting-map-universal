/**
 * Business Layer - Staff Service
 * 
 * Target Domain: Staff Management
 * Owner Layer: Business Layer
 * Responsibility: Staff 登録業務トランザクションおよび ID / Identity 解決サービスの提供
 */

if (typeof StaffService === 'undefined') {
  StaffService = class StaffService {
    constructor() {
      this.repository = StaffRepository.getInstance();
    }

    static getInstance() {
      if (!StaffService.instance) {
        StaffService.instance = new StaffService();
      }
      return StaffService.instance;
    }

    resolveStaffIdentity(lineUserId, districtId = "") {
      if (!lineUserId) {
        return StaffIdentity.notFound(lineUserId);
      }
      const staff = this.repository.findByLineUserId(lineUserId, districtId);
      if (staff) {
        return StaffIdentity.found(staff.id, staff.name, staff.lineUserId);
      }
      return StaffIdentity.notFound(lineUserId);
    }

    registerStaff(arg1, arg2, arg3) {
      let lineUserId = "";
      let displayName = "";
      let pictureUrl = "";

      const isUserId = (val) => typeof val === "string" && val.startsWith("U") && val.length > 25;

      if (isUserId(arg1)) {
        lineUserId = arg1;
        displayName = arg2 || "";
        pictureUrl = arg3 || "";
      } else if (isUserId(arg3)) {
        lineUserId = arg3;
        displayName = arg1 || "";
        pictureUrl = "";
      } else {
        if (arg1 && !arg3) {
          displayName = arg1;
        } else {
          displayName = arg1 || "";
          lineUserId = arg3 || "";
        }
      }

      if (typeof logTrace === 'function') {
        logTrace("registerStaff:entry", { displayName, lineUserId, pictureUrl });
      }

      const self = this;
      const executeCoreLogic = function() {
        const cleanName = String(displayName || "").trim();
        const cleanLineUserId = String(lineUserId || "").trim();
        
        if (!cleanLineUserId) {
          return { success: false, message: "LINE User ID が必要です。" };
        }
        if (!cleanName) {
          return { success: false, message: "お名前 (displayName) が必要です。" };
        }

        // 1. C列(LINE_USER_ID)での完全一致重複チェック
        const existingStaff = self.repository.findByLineUserId(cleanLineUserId);
        if (existingStaff) {
          if (typeof logTrace === 'function') {
            logTrace("registerStaff:duplicate_line_id", { lineUserId: cleanLineUserId, staffId: existingStaff.id });
          }
          return { success: true, id: existingStaff.id, name: existingStaff.name, message: "existing" };
        }

        // 2. 既存の同名スタッフチェック
        const nameMatch = self.repository.findByName(cleanName);
        if (nameMatch) {
          if (!nameMatch.staff.lineUserId) {
            self.repository.updateLineUserIdAtRow(nameMatch.rowIndex, cleanLineUserId);
          }
          return { success: true, id: nameMatch.staff.id, name: nameMatch.staff.name, message: "existing" };
        }

        // 3. 新規登録（Backend側でD列登録日時を自動生成）
        const newStaff = self.repository.insertNewStaff(new Staff({
          name: cleanName,
          lineUserId: cleanLineUserId
        }));

        return { success: true, id: newStaff.id, name: newStaff.name, message: "new" };
      };

      if (typeof LockServiceProvider !== 'undefined' && typeof LockServiceProvider.getInstance === 'function' && typeof LockServiceProvider.getInstance().executeWithLock === 'function') {
        return LockServiceProvider.getInstance().executeWithLock(executeCoreLogic);
      } else {
        const lock = LockService.getScriptLock();
        try {
          lock.waitLock(15000);
          return executeCoreLogic();
        } catch (e) {
          if (typeof logTrace === 'function') {
            logTrace("registerStaff:error", { message: "Lock timeout" });
          }
          throw new Error("サーバーが混雑しています。時間をおいて再度お試しください。");
        } finally {
          try {
            lock.releaseLock();
          } catch (el) {}
        }
      }
    }

    getRoster(districtId = "") {
      const sheet = this.repository.getRosterSheet(districtId);
      if (!sheet) return [];
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return [];

      const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      const roster = [];

      for (let i = 0; i < values.length; i++) {
        const id = String(values[i][0] || "").trim();
        const name = String(values[i][1] || "").trim();
        const lineUserId = String(values[i][2] || "").trim();
        const registeredAt = (values[i][3] && typeof values[i][3].getMonth === 'function')
          ? (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function' ? Utilities.formatDate(values[i][3], "JST", "yyyy/MM/dd HH:mm:ss") : values[i][3].toISOString())
          : String(values[i][3] || "").trim();

        if (id !== "" && name !== "") {
          roster.push({ id: id, name: name, lineUserId: lineUserId, registeredAt: registeredAt });
        }
      }
      return roster;
    }
  };
  StaffService.instance = null;
}

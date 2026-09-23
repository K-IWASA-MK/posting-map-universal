/**
 * POSTING MAP - System Info Service
 * SYSTEM_INFO を実態から再生成する SSOT 同期サービス。
 */
(function(global) {
  class SystemInfoService {
    static getInstance() {
      if (!SystemInfoService.instance) {
        SystemInfoService.instance = new SystemInfoService();
      }
      return SystemInfoService.instance;
    }

    getSS(districtId = "") {
      if (typeof getSS === 'function') return getSS(districtId);
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet) {
        return SpreadsheetApp.getActiveSpreadsheet();
      }
      throw new Error('Active spreadsheet unavailable');
    }

    getConfigProperty(key) {
      try {
        return PropertiesService.getScriptProperties().getProperty(key) || '';
      } catch (e) {
        return '';
      }
    }

    getLiffConfig(options, existingSheet) {
      const opts = options || {};
      let liffUrl = opts.productionLiffUrl || opts.liffUrl || this.getConfigProperty('PRODUCTION_LIFF_URL') || this.getConfigProperty('LINE_LIFF_URL') || '';
      let liffId = opts.liffId || this.getConfigProperty('LINE_LIFF_ID') || this.getConfigProperty('LIFF_ID') || '';

      if ((!liffUrl || !liffId) && existingSheet) {
        try {
          const lastRow = existingSheet.getLastRow();
          if (lastRow > 1) {
            const data = existingSheet.getRange(1, 1, lastRow, 2).getValues();
            for (let i = 0; i < data.length; i++) {
              const row = data[i];
              if (row[0] === 'LIFF URL' && row[1] && !liffUrl) liffUrl = String(row[1]).trim();
              if (row[0] === 'LIFF ID' && row[1] && !liffId) liffId = String(row[1]).trim();
            }
          }
        } catch (e) {}
      }

      if (!liffId && liffUrl) {
        const match = String(liffUrl).match(/liff\.line\.me\/([^/?#]+)/i);
        if (match && match[1]) {
          liffId = match[1];
        }
      }

      if (opts.productionLiffUrl || opts.liffUrl) {
        try {
          const props = PropertiesService.getScriptProperties();
          if (props) {
            if (liffUrl) props.setProperty('PRODUCTION_LIFF_URL', liffUrl);
            if (liffId) props.setProperty('LINE_LIFF_ID', liffId);
          }
        } catch (e) {}
      }

      return { url: liffUrl, id: liffId };
    }

    generateRandomPin() {
      return String(Math.floor(100000 + Math.random() * 900000));
    }

    getManagerPassword(existingSheet) {
      if (!existingSheet) return this.generateRandomPin();
      try {
        const lastRow = existingSheet.getLastRow();
        if (lastRow > 1) {
          const data = existingSheet.getRange(1, 1, lastRow, 2).getValues();
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (row[0] === 'Manager認証パスワード' && row[1] !== undefined && row[1] !== null && String(row[1]).trim() !== '') {
              return String(row[1]).trim();
            }
          }
        }
      } catch (e) {}
      return this.generateRandomPin();
    }

    verifyManagerPassword(inputPassword, districtId = "") {
      if (!inputPassword || typeof inputPassword !== 'string' || !inputPassword.trim()) {
        return { success: false, message: '認証コードを入力してください' };
      }
      try {
        const ss = this.getSS(districtId);
        const districtName = ss.getName();
        const sheet = ss.getSheetByName('SYSTEM_INFO');
        if (!sheet) {
          return { success: false, message: 'SYSTEM_INFO が初期化されていません' };
        }
        let storedPassword = '';
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          const data = sheet.getRange(1, 1, lastRow, 2).getValues();
          for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (row[0] === 'Manager認証パスワード') {
              storedPassword = String(row[1] || '').trim();
              break;
            }
          }
        }
        if (!storedPassword) {
          storedPassword = this.generateRandomPin();
          sheet.appendRow(['Manager認証パスワード', storedPassword]);
        }

        if (inputPassword.trim() === storedPassword) {
          return { success: true, districtCode: districtName };
        } else {
          return { success: false, message: '認証コードが正しくありません' };
        }
      } catch (err) {
        return { success: false, message: '認証処理中にエラーが発生しました: ' + err.message };
      }
    }

    getContractEndDate(existingSheet, districtId = "") {
      try {
        const s = existingSheet || (this.getSS(districtId) ? this.getSS(districtId).getSheetByName('SYSTEM_INFO') : null);
        if (!s) return '';
        const lr = s.getLastRow();
        if (lr < 2) return '';
        const data = s.getRange(1, 1, lr, 2).getValues();
        for (let i = 0; i < data.length; i++) {
          if (data[i][0] === '契約終了日') {
            const val = data[i][1];
            if (val instanceof Date) {
              if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
                return Utilities.formatDate(val, "JST", "yyyy-MM-dd");
              }
              const jst = new Date(val.getTime() + (9 * 60 * 60 * 1000));
              return jst.toISOString().slice(0, 10);
            }
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              return String(val).trim().replace(/\//g, '-');
            }
            return '';
          }
        }
      } catch (e) {}
      return '';
    }

    ensureContractEndDateRow(existingSheet) {
      try {
        const s = existingSheet || (this.getSS() ? this.getSS().getSheetByName('SYSTEM_INFO') : null);
        if (!s) return;
        const lr = s.getLastRow();
        if (lr < 1) return;
        const data = s.getRange(1, 1, lr, 1).getValues();
        for (let i = 0; i < data.length; i++) {
          if (data[i][0] === '契約終了日') {
            return;
          }
        }
        s.appendRow(['契約終了日', '']);
        if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
          SpreadsheetApp.flush();
        }
      } catch (e) {}
    }

    setContractEndDate(dateStr) {
      const ss = this.getSS();
      let sheet = ss.getSheetByName('SYSTEM_INFO');
      if (!sheet) sheet = ss.insertSheet('SYSTEM_INFO');

      let cleanDate = '';
      if (dateStr !== undefined && dateStr !== null) {
        cleanDate = String(dateStr).trim().replace(/\//g, '-');
      }

      const lr = sheet.getLastRow();
      let found = false;
      if (lr >= 2) {
        const data = sheet.getRange(1, 1, lr, 2).getValues();
        for (let i = 0; i < data.length; i++) {
          if (data[i][0] === '契約終了日') {
            sheet.getRange(i + 1, 2).setValue(cleanDate);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        sheet.appendRow(['契約終了日', cleanDate]);
      }
      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
        SpreadsheetApp.flush();
      }
      return { success: true, contractEndDate: cleanDate };
    }

    getContractStatus(existingSheet, now = new Date(), districtId = "") {
      const endDateStr = this.getContractEndDate(existingSheet, districtId);
      if (!endDateStr) {
        return { status: 'ACTIVE', isExpired: false, endDate: '' };
      }

      let todayStr = '';
      if (typeof Utilities !== 'undefined' && typeof Utilities.formatDate === 'function') {
        todayStr = Utilities.formatDate(now, "JST", "yyyy-MM-dd");
      } else {
        const jst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        todayStr = jst.toISOString().slice(0, 10);
      }

      const isExpired = todayStr > endDateStr;
      return {
        status: isExpired ? 'EXPIRED' : 'ACTIVE',
        isExpired: isExpired,
        endDate: endDateStr,
        today: todayStr
      };
    }

    syncSystemInfo(options) {
      const opts = options || {};
      const token = opts.provisioningToken;
      const tokenCheck = typeof verifyProvisioningToken === 'function'
        ? verifyProvisioningToken(token)
        : { success: false, code: "UNAUTHORIZED", message: "verifyProvisioningToken unavailable" };
      if (!tokenCheck.success) {
        return tokenCheck;
      }

      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        const ss = this.getSS();
        let sheet = ss.getSheetByName('SYSTEM_INFO');
        if (!sheet) sheet = ss.insertSheet('SYSTEM_INFO');

        const liff = this.getLiffConfig(opts, sheet);
        const managerPassword = opts.managerPassword || this.getManagerPassword(sheet);
        const districtName = ss.getName();
        const subdomain = districtName.toLowerCase();
        const baseUrl = (opts.baseUrl && opts.baseUrl !== 'https://postingmap.jp')
          ? opts.baseUrl
          : `https://${subdomain}.postingmap.jp`;
        const dashboardUrl = `${baseUrl}/active/manager/`;
        const hAppUrl = `${baseUrl}/`;

        const contractEndDate = opts.contractEndDate !== undefined ? opts.contractEndDate : this.getContractEndDate(sheet);

        const values = [
          ['項目', '内容'],
          ['地区コード', districtName],
          ['地区名', districtName],
          ['HアプリURL', hAppUrl],
          ['Dashboard URL', dashboardUrl],
          ['LIFFアプリ名', `POSTING MAP ${districtName}`],
          ['LIFF ID', liff.id],
          ['LIFF URL', liff.url],
          ['Endpoint URL', hAppUrl],
          ['Manager認証パスワード', managerPassword],
          ['状態', 'ACTIVE'],
          ['契約終了日', contractEndDate]
        ];

        sheet.clear();
        sheet.getRange(1, 1, values.length, 2).setValues(values);
        sheet.getRange('A1:B1').setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
        sheet.getRange(`A2:A${values.length}`).setFontWeight('bold');
        sheet.setFrozenRows(1);
        SpreadsheetApp.flush();

        if (opts.lineChannelAccessToken && typeof opts.lineChannelAccessToken === 'string') {
          try {
            const props = PropertiesService.getScriptProperties();
            if (props) {
              props.setProperty('LINE_CHANNEL_ACCESS_TOKEN', opts.lineChannelAccessToken.trim());
            }
          } catch (e) {}
        }
        if (opts.lineChannelId && typeof opts.lineChannelId === 'string') {
          try {
            const props = PropertiesService.getScriptProperties();
            if (props) {
              props.setProperty('LINE_CHANNEL_ID', opts.lineChannelId.trim());
            }
          } catch (e) {}
        }
        if ((opts.mapsApiKey || opts.googleMapsApiKey) && typeof (opts.mapsApiKey || opts.googleMapsApiKey) === 'string') {
          try {
            const props = PropertiesService.getScriptProperties();
            if (props) {
              const keyVal = (opts.mapsApiKey || opts.googleMapsApiKey).trim();
              if (keyVal) {
                props.setProperty('GOOGLE_MAPS_API_KEY', keyVal);
              }
            }
          } catch (e) {}
        }

        const lineConfigured = !!this.getConfigProperty('LINE_CHANNEL_ACCESS_TOKEN');

        return {
          success: true,
          sheetName: 'SYSTEM_INFO',
          districtName: districtName,
          dashboardUrl: dashboardUrl,
          hAppUrl: hAppUrl,
          endpointUrl: hAppUrl,
          liffUrl: liff.url,
          liffId: liff.id,
          lineConfigured: lineConfigured,
          status: 'ACTIVE'
        };
      } finally {
        lock.releaseLock();
      }
    }
  }

  SystemInfoService.instance = null;
  global.SystemInfoService = SystemInfoService;
})(this);

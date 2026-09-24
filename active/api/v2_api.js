/**
 * GAS v2 - 純粋 JSON API エンジン
 * UI(HTML)は一切返却せず、ContentService を通じて JSON のみを応答する。
 * Version: 2.2.0-modular
 */


// =============================
// ① 基本設定
// =============================

function getMonthlySheet(type) {
  if (typeof MonthlySheetResolver !== 'undefined' && MonthlySheetResolver.getInstance) {
    return MonthlySheetResolver.getInstance().getCurrentSheet(type);
  }
  return null;
}

function computeSha256(str) {
  if (!str || typeof str !== 'string') return '';
  try {
    const rawDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
    let hexHash = '';
    for (let i = 0; i < rawDigest.length; i++) {
      let byte = rawDigest[i];
      if (byte < 0) byte += 256;
      let hex = byte.toString(16);
      if (hex.length === 1) hex = '0' + hex;
      hexHash += hex;
    }
    return hexHash;
  } catch (e) {
    return '';
  }
}

function verifyProvisioningToken(token) {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, code: "UNAUTHORIZED", message: "Provisioning token is missing." };
  }
  const props = PropertiesService.getScriptProperties();
  const storedHash = (props.getProperty('PROVISIONING_TOKEN_HASH') || '').trim().toLowerCase();
  const CORE_PROVISIONING_HASH = 'cdbbd0eedf4ea2c25de8a03fda87017740261bd64b898e98de687906a5d4cc90';

  const clientHash = computeSha256(token.trim()).toLowerCase();

  if (storedHash) {
    if (clientHash === storedHash) {
      return { success: true };
    }
    return { success: false, code: "UNAUTHORIZED", message: "Invalid provisioning token for configured district." };
  }

  if (clientHash === CORE_PROVISIONING_HASH) {
    return { success: true };
  }

  return { success: false, code: "UNAUTHORIZED", message: "Invalid provisioning token." };
}
/**
 * GETリクエスト：JSONデータの取得
 */
function doGet(e) {
  isWebAppCall = true;
  let params = (e && e.parameter) ? Object.assign({}, e.parameter) : {};

  if (params.json) {
    try {
      const parsed = typeof params.json === 'string' ? JSON.parse(params.json) : params.json;
      if (parsed && typeof parsed === 'object') {
        Object.assign(params, parsed);
      }
    } catch (errJ) {}
  }
  if (e) {
    e.parameter = params;
  }

  if (params.liffToken) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Token transmission via GET is prohibited."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const action = params.action || "";

  const isReadOnlyAction = [
    'getSystemSummary',
    'getDashboardData',
    'getTier1',
    'getFlyerStock',
    'getRanking',
    'getLatestDistribution',
    'getMapsApiKey',
    'getDeliveryStats',
    'getAreaDetails',
    'getGlobalPinStatus',
    'getBulletinPosts',
    'verifyManagerPassword'
  ].includes(action);

  const isDashboardAction = [
    'getRoster',
    'getTransferRequests'
  ].includes(action);

  if (action === 'registerOrValidateDevice') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, authorized: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'resetDeviceManagement') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "FORBIDDEN",
      message: "resetDeviceManagement is disabled on Web App endpoint."
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'bootstrapEnvironment') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "METHOD_NOT_ALLOWED",
      message: "bootstrapEnvironment requires POST request."
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'provisionDistrict') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "METHOD_NOT_ALLOWED",
      message: "provisionDistrict requires POST request."
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'getDeviceStatus') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, exists: false, rows: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'syncSystemInfo') {
    const token = params && (params.provisioningToken || (params.options && params.options.provisioningToken));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const options = (params && params.options) || {};
    options.provisioningToken = token;
    let result;
    if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
      result = SystemInfoService.getInstance().syncSystemInfo(options);
    } else if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      const ss = DistrictProvisioner.getInstance().getSS();
      result = DistrictProvisioner.getInstance().createOrSyncSystemInfo(ss, options);
    } else {
      result = { success: false, message: 'SystemInfoService not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const districtId = String((params && params.districtId) || "").trim();

  if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
    const contract = SystemInfoService.getInstance().getContractStatus(null, new Date(), districtId);
    if (contract.isExpired) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "CONTRACT_EXPIRED",
        message: "契約期間が終了しているため利用できません。"
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (!isReadOnlyAction && !isDashboardAction) {
    const auth = authenticateRequest(params);
    if (!auth.success) {
      return ContentService.createTextOutput(JSON.stringify(auth))
        .setMimeType(ContentService.MimeType.JSON);
    }
    e.user = auth.user;
  } else {
    const auth = authenticateRequest(params);
    e.user = auth.success ? auth.user : null;
  }
  const res = processGetActionLegacy(action, e, districtId);
  if (res && typeof res.setMimeType === 'function') {
    return res;
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 従来のGETリクエストの処理（後方互換用）
 */
function processGetActionLegacy(action, e, districtId = "") {
  let response;
  switch (action) {
      case 'getDashboardData':
      case 'getSystemSummary':
        response = typeof SystemSummaryService !== 'undefined' ? SystemSummaryService.getInstance().getSystemSummary(districtId) : { success: true, ...getDashboardData() };
        break;
      case 'getTier1':
        response = typeof Tier1Service !== 'undefined' ? Tier1Service.getInstance().getTier1() : { success: false };
        break;
      case 'getSystemInfo':
        try {
          const reqParam = (e && e.parameter) || {};
          const targetId = reqParam.spreadsheetId;
          const ss = targetId
            ? SpreadsheetApp.openById(targetId)
            : (typeof getSS === 'function' ? getSS(districtId) : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null));
          if (!ss) {
            response = { success: false, message: 'Spreadsheet unavailable' };
          } else {
            const sysSheet = ss.getSheetByName('SYSTEM_INFO');
            const sysValues = (sysSheet && sysSheet.getLastRow() > 0 && sysSheet.getLastColumn() > 0)
              ? sysSheet.getRange(1, 1, sysSheet.getLastRow(), sysSheet.getLastColumn()).getValues()
              : [];
            const sheetsSummary = ss.getSheets().map(s => ({
              name: s.getName(),
              lastRow: s.getLastRow(),
              lastColumn: s.getLastColumn(),
              dataRows: Math.max(0, s.getLastRow() - 1)
            }));
            response = {
              success: true,
              spreadsheetName: ss.getName(),
              spreadsheetId: ss.getId(),
              systemInfoRows: sysValues,
              sheets: sheetsSummary
            };
          }
        } catch (err) {
          response = { success: false, error: err.toString() };
        }
        break;
      case 'getRanking': {
        const rankPayload = DistributionService.getInstance().getRankingPayload("");
        response = { success: true, mySummary: rankPayload.mySummary, ranking: rankPayload.ranking };
        break;
      }
      case 'getLatestDistribution':
        try {
          const records = typeof DistributionRepository !== 'undefined' && DistributionRepository.getInstance
            ? DistributionRepository.getInstance().fetchLatestRecords(20, "")
            : [];
          response = { success: true, records: records };
        } catch (err) {
          response = { success: false, error: err.toString(), records: [] };
        }
        break;
      case 'getRoster': {
        const rawRoster = StaffService.getInstance().getRoster();
        let stocks = [];
        let ranking = [];
        try {
          stocks = FlyerRepository.getInstance().findAllStocks("");
          ranking = DistributionRepository.getInstance().fetchRankingData("");
        } catch (eAgg) {}
        const aggregatedRoster = rawRoster.map(r => {
          const staffStocks = stocks.filter(st => st.staffId === r.id);
          const stockTotal = staffStocks.reduce((acc, st) => acc + (Number(st.count) || 0), 0);
          const staffRank = ranking.find(rk => rk.staffId === r.id);
          const deliveredTotal = staffRank ? Number(staffRank.count || 0) : 0;
          return {
            id: r.id,
            name: r.name,
            registeredAt: r.registeredAt,
            stockTotal: stockTotal,
            deliveredTotal: deliveredTotal
          };
        });
        response = { success: true, roster: aggregatedRoster };
        break;
      }
      case 'resetRoster':
        response = { success: true, message: setupRosterSheet() };
        break;
      case 'resetDeviceManagement':
        response = { success: false, code: "FORBIDDEN", message: "resetDeviceManagement is disabled on Web App endpoint." };
        break;
      case 'getAreaDetails':
        response = AreaService.getInstance().getAreaDetails(e.name);
        break;
      case 'submitDistribution':
        response = { success: false, message: 'Write operations require POST. Please update the client.' };
        break;
      case 'registerStaff':
        response = { success: false, error: 'Registration requires POST request for security reasons.' };
        break;
      case 'getDeliveryStats':
        response = DistributionService.getInstance().getDeliveryStats();
        break;
      case 'getFlyerStock': {
        const stockPayload = FlyerService.getInstance().getFlyerStock("");
        response = { success: true, myStock: stockPayload.myStock, stocks: stockPayload.stocks };
        break;
      }
      case 'getTransferRequests':
        response = { success: true, requests: TransferService.getInstance().getTransferRequests("") };
        break;


      default:
        response = { success: true, message: 'POSTING MAP API is online.' };
    }
  return response;
}

/**
 * POSTリクエスト：データの登録・更新
 */
function doPost(e) {
  isWebAppCall = true;
  let params = (e && e.parameter) ? Object.assign({}, e.parameter) : {};
  let postData = null;
  if (e && e.postData && e.postData.contents) {
    try {
      postData = JSON.parse(e.postData.contents);
    } catch (errP) {}
  }
  if (params.json) {
    try {
      const parsedJson = typeof params.json === 'string' ? JSON.parse(params.json) : params.json;
      postData = { ...(postData || {}), ...parsedJson };
    } catch (errJson) {}
  }
  const action = (postData && postData.action) || params.action || (e && e.parameter && e.parameter.action) || "";
  const districtId = String((postData && postData.districtId) || (params && params.districtId) || "").trim();

  const isManagementAction = [
    'bootstrapEnvironment',
    'provisionDistrict',
    'createEmptyTemplate',
    'createDistrictDatabase',
    'syncSystemInfo',
    'runIdentityMigration',
    'registerOrValidateDevice',
    'resetDeviceManagement',
    'getDeviceStatus',
    'issueMobilePairingToken',
    'pairMobileDevice'
  ].includes(action);

  if (!isManagementAction) {
    try {
      const props = PropertiesService.getScriptProperties();
      if (props.getProperty("DISTRICT_REGISTRY") && !districtId) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          code: "MISSING_DISTRICT_ID",
          message: "districtId is required for multi-district routing."
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } catch (eProps) {}
  }

  const isReadOnlyAction = [
    'getSystemSummary',
    'getDashboardData',
    'getTier1',
    'getFlyerStock',
    'getRanking',
    'getLatestDistribution',
    'getMapsApiKey',
    'getDeliveryStats',
    'getAreaDetails',
    'getGlobalPinStatus',
    'getBulletinPosts',
    'verifyManagerPassword'
  ].includes(action);

  const isDashboardAction = [
    'getRoster',
    'getTransferRequests'
  ].includes(action);

  if (action === 'registerOrValidateDevice') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, authorized: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'resetDeviceManagement') {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      code: "FORBIDDEN",
      message: "resetDeviceManagement is disabled on Web App endpoint."
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'getDeviceStatus') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, exists: false, rows: [] }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'issueMobilePairingToken') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "OK" }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'pairMobileDevice') {
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "OK" }))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'bootstrapEnvironment') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));

    const props = PropertiesService.getScriptProperties();
    const storedHash = (props.getProperty('PROVISIONING_TOKEN_HASH') || '').trim().toLowerCase();
    const existingTargetSsId = (props.getProperty('TARGET_SPREADSHEET_ID') || props.getProperty('SPREADSHEET_ID') || '').trim();

    // 既に初期化済み（PROVISIONING_TOKEN_HASH または TARGET_SPREADSHEET_ID が存在）の場合は厳格なトークン認証が必須
    if (storedHash || existingTargetSsId) {
      const tokenCheck = verifyProvisioningToken(token);
      if (!tokenCheck.success) {
        return ContentService.createTextOutput(JSON.stringify(tokenCheck))
          .setMimeType(ContentService.MimeType.JSON);
      }
    } else {
      // 初回ブートストラップ時の安全防壁:
      // provisioningToken が必須（空文字・16文字未満の脆弱トークンを拒絶）
      if (!token || typeof token !== 'string' || token.trim().length < 16) {
        return ContentService.createTextOutput(JSON.stringify({
          success: false,
          code: "UNAUTHORIZED",
          message: "Provisioning token with at least 16 characters is required for initial bootstrap."
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    const districtId = String((postData && postData.districtId) || (params && params.districtId) || "").trim();
    const targetSpreadsheetId = String(
      (postData && (postData.targetSpreadsheetId || postData.spreadsheetId)) ||
      (params && (params.targetSpreadsheetId || params.spreadsheetId)) || ""
    ).trim();
    const storageParentId = String(
      (postData && (postData.storageParentId || postData.storageFolderId)) ||
      (params && (params.storageParentId || params.storageFolderId)) || ""
    ).trim();

    if (!districtId || !targetSpreadsheetId || !storageParentId) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "INVALID_ARGUMENT",
        message: "districtId, targetSpreadsheetId, and storageParentId are required."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 実在リソース検証: 対象スプレッドシートのアクセス確認
    let ss;
    try {
      ss = SpreadsheetApp.openById(targetSpreadsheetId);
    } catch (e) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "RESOURCE_NOT_FOUND",
        message: "Target spreadsheet cannot be opened: " + e.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 地区名SSOT検証: スプレッドシート名が districtId と完全一致すること
    const ssName = (ss.getName() || "").trim();
    if (ssName !== districtId) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "DISTRICT_MISMATCH",
        message: `Spreadsheet name "${ssName}" does not match requested districtId "${districtId}".`
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 実在リソース検証: ストレージフォルダのアクセス確認
    try {
      DriveApp.getFolderById(storageParentId);
    } catch (e) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "RESOURCE_NOT_FOUND",
        message: "Storage parent folder cannot be opened: " + e.toString()
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Script Properties 設定
    const newProps = {
      DISTRICT_ID: districtId,
      TARGET_SPREADSHEET_ID: targetSpreadsheetId,
      SPREADSHEET_ID: targetSpreadsheetId,
      STORAGE_PARENT_ID: storageParentId,
      PROVISIONING_TOKEN_HASH: computeSha256(token.trim()).toLowerCase()
    };

    props.setProperties(newProps);

    // キャッシュクリア
    if (typeof CacheService !== "undefined" && CacheService.getScriptCache()) {
      CacheService.getScriptCache().remove("CONFIG_STORE");
    }
    if (typeof SpreadsheetResolver !== "undefined" && SpreadsheetResolver.getInstance) {
      SpreadsheetResolver.getInstance().clearCache();
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: "Environment bootstrapped successfully.",
      districtId: districtId,
      targetSpreadsheetId: targetSpreadsheetId,
      storageParentId: storageParentId
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'provisionDistrict') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const addresses = (postData && postData.addresses) || (params && params.addresses);
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "INVALID_ARGUMENT",
        message: "addresses must be a non-empty array of address master records."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    const options = (postData && postData.options) || (params && params.options) || {};
    if (postData && postData.skipSystemInfo !== undefined && options.skipSystemInfo === undefined) {
      options.skipSystemInfo = postData.skipSystemInfo;
    }
    options.provisioningToken = token;
    let result;
    if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      result = DistrictProvisioner.getInstance().provisionNewDistrict(addresses, options);
    } else {
      result = { success: false, message: 'DistrictProvisioner not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'createEmptyTemplate') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const sourceSpreadsheetId = (postData && postData.sourceSpreadsheetId) || (params && params.sourceSpreadsheetId);
    const targetFolderId = (postData && postData.targetFolderId) || (params && params.targetFolderId);
    const options = (postData && postData.options) || (params && params.options) || {};
    options.provisioningToken = token;

    let result;
    if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      result = DistrictProvisioner.getInstance().createEmptyTemplate(sourceSpreadsheetId, targetFolderId, options);
    } else {
      result = { success: false, message: 'DistrictProvisioner not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'createDistrictDatabase') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const templateSpreadsheetId = (postData && postData.templateSpreadsheetId) || (params && params.templateSpreadsheetId);
    const targetDistrictName = (postData && postData.targetDistrictName) || (params && params.targetDistrictName);
    const targetFolderId = (postData && postData.targetFolderId) || (params && params.targetFolderId);
    const options = (postData && postData.options) || (params && params.options) || {};
    options.provisioningToken = token;

    let result;
    if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      result = DistrictProvisioner.getInstance().createDistrictDatabase(templateSpreadsheetId, targetDistrictName, targetFolderId, options);
    } else {
      result = { success: false, message: 'DistrictProvisioner not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'syncSystemInfo') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const options = (postData && postData.options) || (params && params.options) || {};
    options.provisioningToken = token;
    let result;
    if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
      result = SystemInfoService.getInstance().syncSystemInfo(options);
    } else if (typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance) {
      const ss = DistrictProvisioner.getInstance().getSS();
      result = DistrictProvisioner.getInstance().createOrSyncSystemInfo(ss, options);
    } else {
      result = { success: false, message: 'SystemInfoService not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'runIdentityMigration') {
    const token = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)))
               || (params && (params.provisioningToken || (params.options && params.options.provisioningToken)));
    const tokenCheck = verifyProvisioningToken(token);
    if (!tokenCheck.success) {
      return ContentService.createTextOutput(JSON.stringify(tokenCheck))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const isDryRun = (postData && postData.isDryRun !== undefined) ? !!postData.isDryRun : true;
    let result;
    if (typeof migrateIdentityColumns === 'function') {
      result = migrateIdentityColumns(isDryRun);
    } else {
      result = { success: false, message: 'migrateIdentityColumns not available' };
    }
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance) {
    const contract = SystemInfoService.getInstance().getContractStatus(null, new Date(), districtId);
    if (contract.isExpired) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        code: "CONTRACT_EXPIRED",
        message: "契約期間が終了しているため利用できません。"
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (!isReadOnlyAction && !isDashboardAction) {
    const auth = authenticateRequest(postData || {});
    if (!auth.success) {
      return ContentService.createTextOutput(JSON.stringify(auth))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (postData) {
      postData.user = auth.user;
    } else {
      postData = { user: auth.user };
    }
  } else {
    const auth = authenticateRequest(postData || {});
    if (postData) {
      postData.user = auth.success ? auth.user : null;
    } else {
      postData = { user: auth.success ? auth.user : null };
    }
  }
  const res = processPostAction(action, postData, e, districtId);
  if (res && typeof res.setMimeType === 'function') {
    return res;
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * 実際のPOSTアクション処理のスイッチケース
 */
function processPostAction(action, postData, e, districtId = "") {
  if (e && e.parameter && e.parameter.json) {
    try {
      const parsedJson = typeof e.parameter.json === 'string' ? JSON.parse(e.parameter.json) : e.parameter.json;
      postData = { ...(postData || {}), ...parsedJson };
    } catch (errJson) {}
  }

  // Staff依存業務アクションに対する操作主体（LINE User ID）の検証・Identity強制
  const staffDependentActions = [
    'updateFlyerStock',
    'submitDistribution',
    'updateRecordWithGPSPhoto',
    'createBulletinPost',
    'sendBulletinContact',
    'requestFlyerTransfer',
    'resolveTransferRequest'
  ];
  if (staffDependentActions.includes(action)) {
    const lineUserId = (postData && postData.user && postData.user.lineUserId) ? String(postData.user.lineUserId).trim() : "";
    if (!lineUserId) {
      return { success: false, code: "UNAUTHORIZED", message: "LINE User ID が取得できません。" };
    }
    const identity = (typeof StaffService !== 'undefined' && StaffService.getInstance)
      ? StaffService.getInstance().resolveStaffIdentity(lineUserId, districtId)
      : null;
    if (!identity || !identity.found) {
      return {
        success: false,
        code: "NOT_REGISTERED",
        message: "配布員登録が完了していません。名簿登録を行ってください。"
      };
    }
    // 操作主体の Identity を Backend 側で強制確定（クライアント送信値を無力化）
    postData.staffId = identity.staffId;
    postData.staffName = identity.staffName;
    postData.requestUserId = identity.staffId;
    postData.resolvedStaffId = identity.staffId;
    postData.resolvedStaffName = identity.staffName;
    postData.resolvedLineUserId = identity.lineUserId;
  }

  const reqLineUserId = (postData && postData.user && postData.user.lineUserId) ? String(postData.user.lineUserId).trim() : "";

  switch (action) {

    case 'getStaffIdentity': {
      const lineUserId = (postData && postData.user && postData.user.lineUserId) ? String(postData.user.lineUserId).trim() : "";
      if (!lineUserId) {
        return { success: false, code: "UNAUTHORIZED", message: "LINE User ID が取得できません。" };
      }
      const identity = (typeof StaffService !== 'undefined' && StaffService.getInstance)
        ? StaffService.getInstance().resolveStaffIdentity(lineUserId, districtId)
        : null;
      if (identity && identity.found) {
        return {
          success: true,
          registered: true,
          staffId: identity.staffId,
          staffName: identity.staffName
        };
      } else {
        return {
          success: true,
          registered: false,
          code: "NOT_REGISTERED",
          message: "Staff not registered"
        };
      }
    }
    case 'getSystemSummary':
      return typeof SystemSummaryService !== 'undefined' ? SystemSummaryService.getInstance().getSystemSummary(districtId) : { success: false };
    case 'getMapsApiKey':
      return { success: true, mapsApiKey: PropertiesService.getScriptProperties().getProperty('GOOGLE_MAPS_API_KEY') || "" };
    case 'getTier1':
      return typeof Tier1Service !== 'undefined' ? Tier1Service.getInstance().getTier1() : { success: false };
    case 'getSystemInfo':
      try {
        const ss = typeof getSS === 'function' ? getSS(districtId) : (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
        if (!ss) {
          return { success: false, message: 'Spreadsheet unavailable' };
        }
        const sysSheet = ss.getSheetByName('SYSTEM_INFO');
        const sysValues = (sysSheet && sysSheet.getLastRow() > 0 && sysSheet.getLastColumn() > 0)
          ? sysSheet.getRange(1, 1, sysSheet.getLastRow(), sysSheet.getLastColumn()).getValues()
          : [];
        const sheetsSummary = ss.getSheets().map(s => ({
          name: s.getName(),
          lastRow: s.getLastRow(),
          lastColumn: s.getLastColumn(),
          dataRows: Math.max(0, s.getLastRow() - 1)
        }));
        return {
          success: true,
          spreadsheetName: ss.getName(),
          spreadsheetId: ss.getId(),
          systemInfoRows: sysValues,
          sheets: sheetsSummary
        };
      } catch (err) {
        return { success: false, error: err.toString() };
      }

    case 'getEvidence':
      try {
        const rosterSheet = getMonthlySheet('staff');
        const rosterLastRow = rosterSheet ? rosterSheet.getLastRow() : 0;
        return {
          success: true,
          rosterLatest: rosterLastRow > 0 ? rosterSheet.getRange(rosterLastRow, 1, 1, rosterSheet.getLastColumn()).getValues()[0] : null,
          traceLatest: null
        };
      } catch (err) {
        return { success: false, error: err.toString() };
      }

    case 'getRanking': {
      const rankPayload = DistributionService.getInstance().getRankingPayload(reqLineUserId, districtId);
      return { success: true, mySummary: rankPayload.mySummary, ranking: rankPayload.ranking };
    }
    case 'getLatestDistribution':
      try {
        const records = typeof DistributionRepository !== 'undefined' && DistributionRepository.getInstance
          ? DistributionRepository.getInstance().fetchLatestRecords(postData.limit || 20, reqLineUserId, districtId)
          : [];
        return { success: true, records: records };
      } catch (err) {
        return { success: false, error: err.toString(), records: [] };
      }
    case 'getRoster': {
      const rawRoster = StaffService.getInstance().getRoster();
      let stocks = [];
      let ranking = [];
      try {
        stocks = FlyerRepository.getInstance().findAllStocks("", districtId);
        ranking = DistributionRepository.getInstance().fetchRankingData("", districtId, rawRoster);
      } catch (eAgg) {}
      const aggregatedRoster = rawRoster.map(r => {
        const staffStocks = stocks.filter(st => st.staffId === r.id);
        const stockTotal = staffStocks.reduce((acc, st) => acc + (Number(st.count) || 0), 0);
        const staffRank = ranking.find(rk => rk.staffId === r.id);
        const deliveredTotal = staffRank ? Number(staffRank.count || 0) : 0;
        return {
          id: r.id,
          name: r.name,
          registeredAt: r.registeredAt,
          stockTotal: stockTotal,
          deliveredTotal: deliveredTotal
        };
      });
      return { success: true, roster: aggregatedRoster };
    }
    case 'resetRoster':
      return { success: true, message: setupRosterSheet() };
    case 'resetDeviceManagement':
      return {
        success: false,
        code: "FORBIDDEN",
        message: "resetDeviceManagement is disabled on Web App endpoint."
      };
    case 'getAreaDetails':
      return AreaService.getInstance().getAreaDetails(postData.name || (e && e.parameter ? e.parameter.name : ""));
    case 'submitDistribution':
      return DistributionService.getInstance().submitDistribution(postData);
    case 'updateRecordWithGPSPhoto':
      return GPSService.getInstance().updateRecordWithGPSPhoto(postData);
    case 'registerStaff':
      let rLastName = postData.lastName || postData.displayName || (e && e.parameter ? e.parameter.lastName : "");
      let rFirstName = postData.firstName || (e && e.parameter ? e.parameter.firstName : "LINE");
      let rLineUserId = (postData && postData.user && postData.user.lineUserId) ? postData.user.lineUserId : "";
      if (!rLastName && e && e.parameter && e.parameter.json) {
        try {
          const pj = typeof e.parameter.json === 'string' ? JSON.parse(e.parameter.json) : e.parameter.json;
          if (pj.lastName) rLastName = pj.lastName;
          if (pj.displayName && !rLastName) rLastName = pj.displayName;
          if (pj.firstName) rFirstName = pj.firstName;
        } catch (errPj) {}
      }
      return StaffService.getInstance().registerStaff(rLastName, rFirstName, rLineUserId);
    case 'requestFlyerTransfer':
      return TransferService.getInstance().requestFlyerTransfer(postData);
    case 'resolveTransferRequest':
      return TransferService.getInstance().resolveTransferRequest(postData);
    case 'getFlyerStock': {
      const stockPayload = FlyerService.getInstance().getFlyerStock(reqLineUserId, districtId);
      return { success: true, myStock: stockPayload.myStock, stocks: stockPayload.stocks };
    }
    case 'getTransferRequests':
      return { success: true, requests: TransferService.getInstance().getTransferRequests(reqLineUserId) };
    case 'updateFlyerStock':
      return FlyerService.getInstance().updateFlyerStock(
        postData.location,
        parseInt(postData.count, 10) || 0,
        postData.staffName,
        postData.staffId,
        postData.resolvedLineUserId || reqLineUserId
      );
    case 'getGlobalPinStatus':
      return PinStatusService.getInstance().getStatus();
    case 'getBulletinPosts':
      return typeof BulletinService !== 'undefined' && BulletinService.getInstance
        ? BulletinService.getInstance().getPosts(reqLineUserId)
        : { success: false, message: 'BulletinService not available' };
    case 'createBulletinPost':
      return typeof BulletinService !== 'undefined' && BulletinService.getInstance
        ? BulletinService.getInstance().createPost(postData)
        : { success: false, message: 'BulletinService not available' };
    case 'sendBulletinContact':
      return typeof BulletinService !== 'undefined' && BulletinService.getInstance
        ? BulletinService.getInstance().sendContact(postData)
        : { success: false, message: 'BulletinService not available' };
    case 'setPinInProgress':
      return PinStatusService.getInstance().setInProgress(postData);
    case 'provisionDistrict':
      const pToken = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)));
      const pCheck = verifyProvisioningToken(pToken);
      if (!pCheck.success) return pCheck;
      if (postData && postData.options) postData.options.provisioningToken = pToken;
      return typeof DistrictProvisioner !== 'undefined' && DistrictProvisioner.getInstance
        ? DistrictProvisioner.getInstance().provisionNewDistrict(postData && postData.addresses, postData && postData.options)
        : { success: false, message: 'DistrictProvisioner not available' };
    case 'syncSystemInfo':
      const sToken = (postData && (postData.provisioningToken || (postData.options && postData.options.provisioningToken)));
      const sCheck = verifyProvisioningToken(sToken);
      if (!sCheck.success) return sCheck;
      if (postData && postData.options) postData.options.provisioningToken = sToken;
      return typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance
        ? SystemInfoService.getInstance().syncSystemInfo(postData && postData.options)
        : { success: false, message: 'SystemInfoService not available' };
    case 'verifyManagerPassword':
      const postPwd = (postData && postData.password) || (e && e.parameter ? e.parameter.password : "");
      return typeof SystemInfoService !== 'undefined' && SystemInfoService.getInstance
        ? SystemInfoService.getInstance().verifyManagerPassword(postPwd, districtId)
        : { success: false, message: 'SystemInfoService not available' };
    default:
      return { success: false, message: 'Invalid POST action' };
  }
}

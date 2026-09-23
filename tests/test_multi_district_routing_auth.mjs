/**
 * test_multi_district_routing_auth.mjs
 * 親Standalone GAS 1本化・動的地区ルーティング & 認可境界 厳格検証テストスイート
 *
 * MASTER確定仕様:
 * 1. currentDistrictId のSingleton状態保持を排除（リクエストスコープ伝播）。
 * 2. districtId なしの本番マルチ地区APIはデフォルトSpreadsheetへ無条件fallbackさせない (MISSING_DISTRICT_ID)。
 * 3. SYSTEM_INFO の機械的照合値は「地区コード（B2）」とし、不一致時は DISTRICT_MISMATCH で遮断。
 * 4. DISTRICT_REGISTRY は「地区DB接続情報」のSSOT。
 * 5. SYSTEM_INFO は接続先DB自身の地区情報・契約状態等のSSOT。
 * 6. 5大認可シナリオ（正当、越境、未登録、無効トークン、未知地区ID）の全数実証。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('================================================================');
console.log('🧪 MULTI-DISTRICT DYNAMIC ROUTING & AUTH BOUNDARY VERIFICATION');
console.log('================================================================\n');

// 1. スプレッドシートモック
class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  getLastRow() {
    return this.rows.length;
  }
  getLastColumn() {
    return this.rows.length > 0 ? this.rows[0].length : 0;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const res = [];
        for (let r = 0; r < numRows; r++) {
          const rowIdx = row - 1 + r;
          const rowData = sheet.rows[rowIdx] || [];
          const rowVals = [];
          for (let c = 0; c < numCols; c++) {
            const colIdx = col - 1 + c;
            rowVals.push(rowData[colIdx] !== undefined ? rowData[colIdx] : "");
          }
          res.push(rowVals);
        }
        return res;
      },
      setValues(vals) {
        for (let r = 0; r < vals.length; r++) {
          const rowIdx = row - 1 + r;
          if (!sheet.rows[rowIdx]) {
            sheet.rows[rowIdx] = [];
          }
          for (let c = 0; c < vals[r].length; c++) {
            const colIdx = col - 1 + c;
            sheet.rows[rowIdx][colIdx] = vals[r][c];
          }
        }
      }
    };
  }
}

class MockSpreadsheet {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.sheets = {};
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getSheetByName(name) {
    return this.sheets[name] || null;
  }
  addSheet(name) {
    const sheet = new MockSheet(name);
    this.sheets[name] = sheet;
    return sheet;
  }
}

// 2. モック環境の構築
const mockSpreadsheets = {};
const mockScriptProperties = {};

global.PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(key) {
        return mockScriptProperties[key] || null;
      },
      setProperty(key, val) {
        mockScriptProperties[key] = String(val);
      }
    };
  }
};

global.SpreadsheetApp = {
  openById(id) {
    if (mockSpreadsheets[id]) {
      return mockSpreadsheets[id];
    }
    throw new Error(`Spreadsheet not found for ID: ${id}`);
  },
  getActiveSpreadsheet() {
    return null;
  }
};

global.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput(text) {
    return {
      text: text,
      mimeType: "application/json",
      setMimeType(m) { this.mimeType = m; return this; }
    };
  }
};

// 3. スプレッドシート作成
const currentMonth = "2026-09";
const staffSheetName = "名簿" + currentMonth;
const distSheetName = "配布実績" + currentMonth;

// (1) KUWANA DB
const kuwanaSS = new MockSpreadsheet("ss-kuwana-id", "POSTING_MAP_KUWANA");
const kuwanaSysInfo = kuwanaSS.addSheet("SYSTEM_INFO");
kuwanaSysInfo.rows = [
  ["項目", "設定値"],
  ["地区コード", "KUWANA"],
  ["地区名", "桑名地区"],
  ["管理パスワード", "pwd_kuwana"]
];
const kuwanaStaff = kuwanaSS.addSheet(staffSheetName);
kuwanaStaff.rows = [
  ["STAFF_ID", "氏名", "LINE_USER_ID", "登録日時"],
  ["K001", "桑名 太郎", "U_KUWANA_001", "2026/01/01"],
  ["K002", "桑名 花子", "U_KUWANA_002", "2026/01/01"]
];
const kuwanaDist = kuwanaSS.addSheet(distSheetName);
kuwanaDist.rows = [
  ["rowId", "cityName", "townName", "completedAt", "count", "staffId", "staffName", "", "", "", "", "", "", "", "", "lineUserId"],
  ["1", "桑名市", "中央町1", "2026/09/20", 100, "K001", "桑名 太郎", "", "", "", "", "", "", "", "", "U_KUWANA_001"]
];
mockSpreadsheets["ss-kuwana-id"] = kuwanaSS;

// (2) OKAYAMA DB
const okayamaSS = new MockSpreadsheet("ss-okayama-id", "POSTING_MAP_OKAYAMA");
const okayamaSysInfo = okayamaSS.addSheet("SYSTEM_INFO");
okayamaSysInfo.rows = [
  ["項目", "設定値"],
  ["地区コード", "OKAYAMA"],
  ["地区名", "岡山地区"],
  ["管理パスワード", "pwd_okayama"]
];
const okayamaStaff = okayamaSS.addSheet(staffSheetName);
okayamaStaff.rows = [
  ["STAFF_ID", "氏名", "LINE_USER_ID", "登録日時"],
  ["O001", "岡山 次郎", "U_OKAYAMA_001", "2026/01/01"]
];
const okayamaDist = okayamaSS.addSheet(distSheetName);
okayamaDist.rows = [
  ["rowId", "cityName", "townName", "completedAt", "count", "staffId", "staffName", "", "", "", "", "", "", "", "", "lineUserId"],
  ["1", "岡山市", "北区1", "2026/09/20", 250, "O001", "岡山 次郎", "", "", "", "", "", "", "", "", "U_OKAYAMA_001"]
];
mockSpreadsheets["ss-okayama-id"] = okayamaSS;

// (3) 不整合スプレッドシート（B2が不正な値）
const mismatchSS = new MockSpreadsheet("ss-mismatch-id", "POSTING_MAP_MISMATCH");
const mismatchSysInfo = mismatchSS.addSheet("SYSTEM_INFO");
mismatchSysInfo.rows = [
  ["項目", "設定値"],
  ["地区コード", "CORRUPTED_CODE"],
  ["地区名", "桑名地区"]
];
mockSpreadsheets["ss-mismatch-id"] = mismatchSS;

// 4. DISTRICT_REGISTRY の設定
PropertiesService.getScriptProperties().setProperty("DISTRICT_REGISTRY", JSON.stringify({
  "KUWANA": "ss-kuwana-id",
  "OKAYAMA": "ss-okayama-id",
  "MISMATCH_DISTRICT": "ss-mismatch-id"
}));

// 5. ソースコードの読み込みと評価
const rootDir = process.cwd();
const adapterCode = fs.readFileSync(path.join(rootDir, 'active/infrastructure/spreadsheet/spreadsheet_adapter.js'), 'utf-8');
const monthlyResolverCode = fs.readFileSync(path.join(rootDir, 'active/business/system/monthly_sheet_resolver.js'), 'utf-8');
import vm from 'node:vm';

const staffModelCode = fs.readFileSync(path.join(rootDir, 'active/business/staff/staff_model.js'), 'utf-8');
const staffRepoCode = fs.readFileSync(path.join(rootDir, 'active/business/staff/staff_repository.js'), 'utf-8');
const staffServiceCode = fs.readFileSync(path.join(rootDir, 'active/business/staff/staff_service.js'), 'utf-8');
const systemSummaryCode = fs.readFileSync(path.join(rootDir, 'active/business/system/system_summary_service.js'), 'utf-8');
const distRepoCode = fs.readFileSync(path.join(rootDir, 'active/business/distribution/distribution_repository.js'), 'utf-8');
const distServiceCode = fs.readFileSync(path.join(rootDir, 'active/business/distribution/distribution_service.js'), 'utf-8');
const v2ApiCode = fs.readFileSync(path.join(rootDir, 'active/api/v2_api.js'), 'utf-8');

// 依存モジュールロード
vm.runInThisContext(adapterCode);
vm.runInThisContext(monthlyResolverCode);
vm.runInThisContext(staffModelCode);
vm.runInThisContext(staffRepoCode);
vm.runInThisContext(staffServiceCode);
vm.runInThisContext(systemSummaryCode);
vm.runInThisContext(distRepoCode);
vm.runInThisContext(distServiceCode);

// LINE 認証検証のモック（テスト用）
global.authenticateRequest = function(payload) {
  if (!payload || !payload.liffToken) {
    return { success: false, message: "Unauthorized: Missing liffToken" };
  }
  const token = payload.liffToken;
  if (token === "token_kuwana_user1") {
    return { success: true, user: { lineUserId: "U_KUWANA_001", displayName: "桑名 太郎" } };
  }
  if (token === "token_kuwana_user2") {
    return { success: true, user: { lineUserId: "U_KUWANA_002", displayName: "桑名 花子" } };
  }
  if (token === "token_okayama_user1") {
    return { success: true, user: { lineUserId: "U_OKAYAMA_001", displayName: "岡山 次郎" } };
  }
  if (token === "token_unknown_user") {
    return { success: true, user: { lineUserId: "U_STRANGER_999", displayName: "見知らぬ人" } };
  }
  return { success: false, message: "Unauthorized: Invalid or expired liffToken" };
};

global.verifyLineToken = function(token) {
  if (token === "token_kuwana_user1") return { success: true, lineUserId: "U_KUWANA_001" };
  if (token === "token_kuwana_user2") return { success: true, lineUserId: "U_KUWANA_002" };
  if (token === "token_okayama_user1") return { success: true, lineUserId: "U_OKAYAMA_001" };
  if (token === "token_unknown_user") return { success: true, lineUserId: "U_STRANGER_999" };
  return { success: false, code: "INVALID_TOKEN", message: "Token verification failed" };
};

vm.runInThisContext(v2ApiCode);

// =============================================================================
// テスト実行
// =============================================================================

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

// -----------------------------------------------------------------------------
// TEST 1: 正当アクセス (User A in KUWANA -> KUWANA DB)
// -----------------------------------------------------------------------------
runTest("Scenario 1: 正当アクセス (KUWANA所属スタッフがKUWANAを指定)", () => {
  const req = {
    postData: {
      contents: JSON.stringify({
        action: "getStaffIdentity",
        liffToken: "token_kuwana_user1",
        districtId: "KUWANA"
      })
    }
  };
  const res = doPost(req);
  const data = JSON.parse(res.text);
  assert.equal(data.success, true);
  assert.equal(data.registered, true);
  assert.equal(data.staffId, "K001");
  assert.equal(data.staffName, "桑名 太郎");
});

// -----------------------------------------------------------------------------
// TEST 2: 越境アクセス拒否 (User A in KUWANA -> OKAYAMA DB 指定)
// -----------------------------------------------------------------------------
runTest("Scenario 2: 越境アクセス拒否 (KUWANA所属スタッフがOKAYAMA DBへアクセス)", () => {
  const req = {
    postData: {
      contents: JSON.stringify({
        action: "getStaffIdentity",
        liffToken: "token_kuwana_user1",
        districtId: "OKAYAMA"
      })
    }
  };
  const res = doPost(req);
  const data = JSON.parse(res.text);
  assert.equal(data.success, true);
  assert.equal(data.registered, false);
  assert.equal(data.code, "NOT_REGISTERED");
});

// -----------------------------------------------------------------------------
// TEST 3: 未登録ユーザー拒否 (Unknown User -> KUWANA DB)
// -----------------------------------------------------------------------------
runTest("Scenario 3: 未登録ユーザー拒否 (どの地区名簿にも存在しないLINEユーザー)", () => {
  const req = {
    postData: {
      contents: JSON.stringify({
        action: "getStaffIdentity",
        liffToken: "token_unknown_user",
        districtId: "KUWANA"
      })
    }
  };
  const res = doPost(req);
  const data = JSON.parse(res.text);
  assert.equal(data.success, true);
  assert.equal(data.registered, false);
  assert.equal(data.code, "NOT_REGISTERED");
});

// -----------------------------------------------------------------------------
// TEST 4: 無効トークン拒否 (Invalid Token)
// -----------------------------------------------------------------------------
runTest("Scenario 4: 無効トークン拒否 (期限切れまたは偽装トークン)", () => {
  const req = {
    postData: {
      contents: JSON.stringify({
        action: "getStaffIdentity",
        liffToken: "fake_expired_token",
        districtId: "KUWANA"
      })
    }
  };
  const res = doPost(req);
  const data = JSON.parse(res.text);
  assert.equal(data.success, false);
  assert.match(data.message, /Unauthorized/);
});

// -----------------------------------------------------------------------------
// TEST 5: 未知地区ID拒否 (Unknown districtId)
// -----------------------------------------------------------------------------
runTest("Scenario 5: 未知地区ID拒否 (DISTRICT_REGISTRYに存在しない地区ID)", () => {
  assert.throws(() => {
    SpreadsheetResolver.getInstance().getSpreadsheet("UNKNOWN_DISTRICT");
  }, /not found in DISTRICT_REGISTRY/);
});

// -----------------------------------------------------------------------------
// TEST 6: マルチ地区環境での districtId 欠落拒否 (無条件fallback遮断)
// -----------------------------------------------------------------------------
runTest("Scenario 6: districtId欠落遮断 (マルチ地区環境でdistrictId未指定の業務API)", () => {
  const req = {
    postData: {
      contents: JSON.stringify({
        action: "getStaffIdentity",
        liffToken: "token_kuwana_user1"
        // districtId 未指定
      })
    }
  };
  const res = doPost(req);
  const data = JSON.parse(res.text);
  assert.equal(data.success, false);
  assert.equal(data.code, "MISSING_DISTRICT_ID");
});

// -----------------------------------------------------------------------------
// TEST 7: 二段階SSOT・Integrity Guard 検証 (B2 地区コード完全一致 & DISTRICT_MISMATCH)
// -----------------------------------------------------------------------------
runTest("Scenario 7: Integrity Guard (SYSTEM_INFO の地区コードが不一致の場合に即時遮断)", () => {
  assert.throws(() => {
    // MISMATCH_DISTRICT は registry にあるが、SYSTEM_INFO の B2 は "CORRUPTED_CODE"
    SpreadsheetResolver.getInstance().getSpreadsheet("MISMATCH_DISTRICT");
  }, /DISTRICT_MISMATCH/);
});

// -----------------------------------------------------------------------------
// TEST 8: Singleton 状態保持の完全排除検証 (リクエスト間での独立性)
// -----------------------------------------------------------------------------
runTest("Scenario 8: Singleton状態保持の排除 (KUWANAとOKAYAMAを交互に呼び出しても汚染されない)", () => {
  const resolver = SpreadsheetResolver.getInstance();

  // 1回目: KUWANA
  const ssKuwana = resolver.getSpreadsheet("KUWANA");
  assert.equal(ssKuwana.getId(), "ss-kuwana-id");
  assert.equal(ssKuwana.getName(), "POSTING_MAP_KUWANA");

  // 2回目: OKAYAMA
  const ssOkayama = resolver.getSpreadsheet("OKAYAMA");
  assert.equal(ssOkayama.getId(), "ss-okayama-id");
  assert.equal(ssOkayama.getName(), "POSTING_MAP_OKAYAMA");

  // 3回目: 再び KUWANA (状態が OKAYAMA に上書きされていないこと)
  const ssKuwana2 = resolver.getSpreadsheet("KUWANA");
  assert.equal(ssKuwana2.getId(), "ss-kuwana-id");
  assert.equal(ssKuwana2.getName(), "POSTING_MAP_KUWANA");
});

// -----------------------------------------------------------------------------
// TEST 9: ランキング集計の地区別分離
// -----------------------------------------------------------------------------
runTest("Scenario 9: 配布ランキングの地区別分離", () => {
  const reqKuwana = {
    postData: {
      contents: JSON.stringify({
        action: "getRanking",
        liffToken: "token_kuwana_user1",
        districtId: "KUWANA"
      })
    }
  };
  const resKuwana = doPost(reqKuwana);
  const dataKuwana = JSON.parse(resKuwana.text);
  assert.equal(dataKuwana.success, true);
  assert.equal(dataKuwana.ranking.length, 1);
  assert.equal(dataKuwana.ranking[0].staffId, "K001");
  assert.equal(dataKuwana.ranking[0].count, 100);

  const reqOkayama = {
    postData: {
      contents: JSON.stringify({
        action: "getRanking",
        liffToken: "token_okayama_user1",
        districtId: "OKAYAMA"
      })
    }
  };
  const resOkayama = doPost(reqOkayama);
  const dataOkayama = JSON.parse(resOkayama.text);
  assert.equal(dataOkayama.success, true);
  assert.equal(dataOkayama.ranking.length, 1);
  assert.equal(dataOkayama.ranking[0].staffId, "O001");
  assert.equal(dataOkayama.ranking[0].count, 250);
});

console.log('\n================================================================');
console.log(`TEST SUMMARY: Total=${passCount + failCount}, PASS=${passCount}, FAIL=${failCount}`);
console.log('================================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log("====================================================");
console.log("📊 STEP 4 PERFORMANCE & I/O RIGOROUS MEASUREMENT");
console.log("====================================================");

// 計測用カウンター
let openByIdCount = 0;
let sheetReadCount = 0;

class MockRange {
  constructor(values) { this.values = values; }
  getValues() {
    sheetReadCount++;
    return this.values;
  }
}

class MockSheet {
  constructor(name, data = []) {
    this.name = name;
    this.data = data;
  }
  getName() { return this.name; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data[0] ? this.data[0].length : 0; }
  getRange(row, col, numRows = 1, numCols = 1) {
    const slice = [];
    for (let r = 0; r < numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < numCols; c++) {
        const rIdx = (row - 1) + r;
        const cIdx = (col - 1) + c;
        rowArr.push(this.data[rIdx] ? this.data[rIdx][cIdx] : "");
      }
      slice.push(rowArr);
    }
    return new MockRange(slice);
  }
}

class MockSpreadsheet {
  constructor(id, name, sheets = {}) {
    this.id = id;
    this.name = name;
    this.sheets = sheets;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheetByName(name) { return this.sheets[name] || null; }
}

const kuwanaSS = new MockSpreadsheet("ss-kuwana-id", "POSTING_MAP_KUWANA", {
  "SYSTEM_INFO": new MockSheet("SYSTEM_INFO", [
    ["項目", "設定値"],
    ["地区コード", "KUWANA"],
    ["契約終了日", "2026-10-31"],
    ["システム名", "POSTING MAP KUWANA"]
  ]),
  "名簿2026-09": new MockSheet("名簿2026-09", [
    ["STAFF_ID", "氏名", "LINE_USER_ID", "登録日時"],
    ["K001", "桑名 太郎", "U_KUWANA_001", "2026/01/01"],
    ["K002", "桑名 花子", "U_KUWANA_002", "2026/01/02"]
  ]),
  "保有チラシ枚数2026-09": new MockSheet("保有チラシ枚数2026-09", [
    ["スタッフID", "スタッフ名", "チラシ種別", "保管場所", "枚数", "更新日時"],
    ["K001", "桑名 太郎", "A4チラシ", "自宅", 500, "2026/09/20"],
    ["K002", "桑名 花子", "B4チラシ", "事務所", 300, "2026/09/20"]
  ]),
  "配布実績2026-09": new MockSheet("配布実績2026-09", [
    ["rowId", "cityName", "townName", "completedAt", "count", "staffId", "staffName", "", "", "", "", "", "", "", "", "lineUserId"],
    ["1", "桑名市", "中央町1", "2026-09-20 10:00:00", 150, "K001", "桑名 太郎", "", "", "", "", "", "", "", "", "U_KUWANA_001"],
    ["2", "桑名市", "中央町2", "2026-09-21 11:00:00", 200, "K002", "桑名 花子", "", "", "", "", "", "", "", "", "U_KUWANA_002"]
  ]),
  "受渡要請履歴2026-09": new MockSheet("受渡要請履歴2026-09", [
    ["要請ID", "要請者ID", "要請者名", "対象者ID", "対象者名", "チラシ種別", "希望枚数", "ステータス", "作成日時"],
    ["REQ001", "K001", "桑名 太郎", "K002", "桑名 花子", "A4チラシ", 100, "PENDING", "2026/09/22"]
  ]),
  "PinStatus2026-09": new MockSheet("PinStatus2026-09", [
    ["rowId", "status", "updatedAt"],
    ["1", "completed", "2026/09/20"],
    ["2", "inProgress", "2026/09/21"]
  ])
});

const mockSpreadsheets = { "ss-kuwana-id": kuwanaSS };

global.SpreadsheetApp = {
  openById: (id) => {
    openByIdCount++;
    if (!mockSpreadsheets[id]) throw new Error(`Not found: ${id}`);
    return mockSpreadsheets[id];
  },
  getActiveSpreadsheet: () => kuwanaSS,
  flush: () => {}
};

class MockCache {
  constructor() { this.store = new Map(); }
  get(key) { return this.store.get(key) || null; }
  put(key, val) { this.store.set(key, String(val)); }
  remove(key) { this.store.delete(key); }
}
global.CacheService = { getScriptCache: () => new MockCache() };

global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => k === "DISTRICT_REGISTRY" ? JSON.stringify({ "KUWANA": "ss-kuwana-id" }) : null
  })
};

global.Utilities = {
  formatDate: (d, tz, fmt) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return fmt === "yyyy-MM" ? `${y}-${m}` : `${y}-${m}-${day}`;
  }
};

global.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput: (t) => ({ text: t, setMimeType() { return this; } })
};

// コードロード
const rootDir = process.cwd();
const files = [
  "active/infrastructure/spreadsheet/spreadsheet_adapter.js",
  "active/business/system/monthly_sheet_resolver.js",
  "active/business/staff/staff_model.js",
  "active/business/staff/staff_repository.js",
  "active/business/staff/staff_service.js",
  "active/business/flyer/flyer_repository.js",
  "active/business/flyer/flyer_service.js",
  "active/business/distribution/distribution_repository.js",
  "active/business/distribution/distribution_service.js",
  "active/business/pin/pin_status_service.js",
  "active/business/transfer/transfer_service.js",
  "active/business/system/system_info_service.js",
  "active/business/system/system_summary_service.js",
  "active/api/v2_api.js"
];
files.forEach(f => vm.runInThisContext(fs.readFileSync(path.join(rootDir, f), 'utf8')));
global.authenticateRequest = () => ({ success: true, user: { lineUserId: "U_KUWANA_001" } });

// -------------------------------------------------------------
// [計測 1] 従来 7 API 並行実行シミュレーション (Baseline)
// -------------------------------------------------------------
console.log("▶ [計測 1] 従来 7 API 並行実行時の I/O 実測");
openByIdCount = 0;
sheetReadCount = 0;
let totalPayloadBytesBaseline = 0;
let gasExecutionsBaseline = 7;
let httpRequestsBaseline = 7;

const baselineActions = [
  { action: "getSystemSummary", districtId: "KUWANA" },
  { action: "getFlyerStock", districtId: "KUWANA" },
  { action: "getRanking", districtId: "KUWANA" },
  { action: "getGlobalPinStatus", districtId: "KUWANA" },
  { action: "getRoster", districtId: "KUWANA" },
  { action: "getTransferRequests", districtId: "KUWANA" },
  { action: "getLatestDistribution", districtId: "KUWANA", limit: 20 }
];

for (const reqObj of baselineActions) {
  // 独立GAS executionシミュレーション: Request-local cache リセット
  SpreadsheetResolver.instance = null;
  const res = doPost({ postData: { contents: JSON.stringify(reqObj) } });
  totalPayloadBytesBaseline += Buffer.byteLength(res.text, 'utf8');
}

const baselineOpenById = openByIdCount;
const baselineSheetRead = sheetReadCount;

console.log(`  - openById 回数: ${baselineOpenById} 回`);
console.log(`  - Sheet READ 回数: ${baselineSheetRead} 回`);
console.log(`  - GAS Executions: ${gasExecutionsBaseline} 回`);
console.log(`  - HTTP Requests: ${httpRequestsBaseline} 回`);
console.log(`  - Payload 合計: ${totalPayloadBytesBaseline} bytes`);

// -------------------------------------------------------------
// [計測 2] STEP 4 Snapshot API 実行 (Actual)
// -------------------------------------------------------------
console.log("\n▶ [計測 2] STEP 4 Snapshot API 1回実行時の I/O 実測");
openByIdCount = 0;
sheetReadCount = 0;
SpreadsheetResolver.instance = null;

const resSnap = doPost({ postData: { contents: JSON.stringify({ action: "getDashboardSnapshot", districtId: "KUWANA", limit: 20 }) } });
const snapPayloadBytes = Buffer.byteLength(resSnap.text, 'utf8');
const actualOpenById = openByIdCount;
const actualSheetRead = sheetReadCount;
const actualGasExecutions = 1;
const actualHttpRequests = 1;

console.log(`  - openById 回数: ${actualOpenById} 回`);
console.log(`  - Sheet READ 回数: ${actualSheetRead} 回`);
console.log(`  - GAS Executions: ${actualGasExecutions} 回`);
console.log(`  - HTTP Requests: ${actualHttpRequests} 回`);
console.log(`  - Payload 合計: ${snapPayloadBytes} bytes`);

// -------------------------------------------------------------
// [計測 3] 削減率・性能比較の確定
// -------------------------------------------------------------
console.log("\n▶ [計測 3] Baseline vs Actual 削減効果の確定");
console.log(`  - openById: ${baselineOpenById} ➔ ${actualOpenById} (削減率: ${Math.round((1 - actualOpenById / baselineOpenById) * 100)}%)`);
console.log(`  - Sheet READ: ${baselineSheetRead} ➔ ${actualSheetRead} (削減率: ${Math.round((1 - actualSheetRead / baselineSheetRead) * 100)}%)`);
console.log(`  - GAS Executions: ${gasExecutionsBaseline} ➔ ${actualGasExecutions} (削減率: ${Math.round((1 - actualGasExecutions / gasExecutionsBaseline) * 100)}%)`);
console.log(`  - HTTP Requests: ${httpRequestsBaseline} ➔ ${actualHttpRequests} (削減率: ${Math.round((1 - actualHttpRequests / httpRequestsBaseline) * 100)}%)`);
console.log(`  - Payload: ${totalPayloadBytesBaseline} bytes ➔ ${snapPayloadBytes} bytes`);

console.log("\n====================================================");
console.log("🎉 I/O & PERFORMANCE MEASUREMENT COMPLETED SUCCESSFULLY");
console.log("====================================================");

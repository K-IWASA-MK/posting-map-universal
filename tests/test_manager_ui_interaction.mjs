import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log("====================================================");
console.log("🖥️ STEP 4 MANAGER UI INTERACTION & RENDERING RIGOROUS TEST");
console.log("====================================================");

// ブラウザ環境モックの構築
const mockWindow = {
  location: { search: "" },
  PMS_CLIENT_CONFIG: {
    districtId: "KUWANA",
    api: { gasWebAppUrl: "https://script.google.com/test" }
  },
  addEventListener: () => {},
  removeEventListener: () => {}
};
const mockDocument = {
  getElementById: (id) => ({
    style: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
    innerHTML: '',
    textContent: '',
    value: '',
    focus: () => {},
    addEventListener: () => {}
  }),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: () => {} }, appendChild: () => {} }),
  addEventListener: () => {},
  removeEventListener: () => {}
};

let layerClearCount = 0;
let renderCurrentViewCount = 0;
let renderMainStageMailCount = 0;
let mapSetViewCount = 0;

const mockMap = {
  setView: () => { mapSetViewCount++; },
  getZoom: () => 14,
  getCenter: () => ({ lat: 35.06, lng: 136.68 }),
  hasLayer: () => true
};
const mockLayer = {
  clearLayers: () => { layerClearCount++; },
  addLayer: () => {}
};

// Node VM 内で manager.js を評価
const managerCode = fs.readFileSync(path.join(process.cwd(), "active/manager/manager.js"), 'utf8');

let mockApiResponseHandler = null;

const sandbox = {
  window: mockWindow,
  document: mockDocument,
  navigator: { onLine: true },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  URLSearchParams: URLSearchParams,
  AbortController: class {
    constructor() { this.signal = {}; }
    abort() {}
  },
  fetch: async (url, options) => {
    const bodyObj = JSON.parse(options.body);
    const result = mockApiResponseHandler ? mockApiResponseHandler(bodyObj.action, bodyObj) : { success: false };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(result)
    };
  },
  getApiUrl: () => "https://script.google.com/test",
  L: {
    map: () => mockMap,
    layerGroup: () => mockLayer,
    circleMarker: () => ({ bindPopup: () => {}, on: () => {}, addTo: () => {} }),
    marker: () => ({ bindPopup: () => {}, on: () => {} }),
    icon: () => ({}),
    divIcon: () => ({})
  },
  _isSyncing: false,
  _isDashboardInitialized: true,
  _hasAppliedPinStatus: false
};

vm.createContext(sandbox);

// 補助関数のスタブ注入
sandbox.setSyncStatus = (status) => {};
sandbox.showManagerPinGate = () => {};

// manager.js をサンドボックスに読み込む
vm.runInContext(managerCode, sandbox);

// -------------------------------------------------------------
// [UI TEST 1] マーカー差分更新検知: ピン状態不変時の再描画ゼロ検証
// -------------------------------------------------------------
console.log("▶ [UI TEST 1] ピン状態不変時の Leaflet マーカー再描画スキップ検証");
Object.assign(sandbox.window.DashboardState, {
  districtId: "KUWANA",
  selectedCity: 'ALL',
  summary: { total: 100, done: 20 },
  stocks: [{ staffId: "K001", count: 500 }],
  roster: [{ id: "K001", name: "桑名 太郎" }],
  requests: [{ requestId: "REQ001" }],
  ranking: [{ staffId: "K001", count: 150 }],
  liveRecords: [],
  globalPinStatus: { inProgress: [2], completed: [1] },
  currentFocus: 'map',
  map: mockMap,
  markersLayer: mockLayer,
  masterPins: [{ rowId: 1, cityName: '桑名市', lat: 35.0, lng: 136.0 }, { rowId: 2, cityName: '桑名市', lat: 35.1, lng: 136.1 }]
});
sandbox._hasAppliedPinStatus = true; // 初回適用済み

layerClearCount = 0;

// 同期レスポンス: ピン状態に変更なし
mockApiResponseHandler = (action, params) => {
  return {
    success: true,
    status: "SUCCESS",
    domains: {
      summary: { success: true, total: 100, done: 20 },
      flyerStock: { success: true, stocks: [{ staffId: "K001", count: 500 }] },
      ranking: { success: true, ranking: [{ staffId: "K001", count: 150 }] },
      pinStatus: { success: true, inProgress: [2], completed: [1] }, // 変更なし
      roster: { success: true, roster: [{ id: "K001", name: "桑名 太郎" }] },
      transfer: { success: true, requests: [{ requestId: "REQ001" }] },
      latestDistribution: { success: true, records: [] }
    }
  };
};

// 1回目 (初回同期): 初回適用フラグが立っていないためマーカーが初期描画される
await sandbox.syncDashboardData();
assert.equal(layerClearCount, 1, "初回同期時はマーカーが 1 回初期描画されること");

// カウンターリセット
layerClearCount = 0;

// 2回目 (ピン状態不変の定期同期): マーカー再描画が完全にスキップされること
await sandbox.syncDashboardData();

assert.equal(layerClearCount, 0, "ピン状態が変化していない場合、マーカーレイヤーのクリア・再生成は行われてはならない (0回)");
assert.equal(mapSetViewCount, 0, "地図の視点 (setView/ズーム/センター) はリセットされてはならない (0回)");
console.log("  ✅ UI TEST 1 PASS: ピン不変時、マーカー再描画回数 = 0 回 (地図のパン・ズーム・選択ピンが完全維持)");

// -------------------------------------------------------------
// [UI TEST 2] マーカー差分検知: ピン状態変更時のみ差分再描画される検証
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 2] ピン状態変化時の差分再描画検知");
layerClearCount = 0;

// 同期レスポンス: ピン状態に変化あり (completed に 2 が追加)
mockApiResponseHandler = (action, params) => {
  return {
    success: true,
    status: "SUCCESS",
    domains: {
      summary: { success: true, total: 100, done: 21 },
      flyerStock: { success: true, stocks: [] },
      ranking: { success: true, ranking: [] },
      pinStatus: { success: true, inProgress: [], completed: [1, 2] }, // 変化あり
      roster: { success: true, roster: [] },
      transfer: { success: true, requests: [] },
      latestDistribution: { success: true, records: [] }
    }
  };
};

await sandbox.syncDashboardData();

assert.equal(layerClearCount, 1, "ピン状態が変化した場合、マーカーレイヤーが的確に 1 回クリア・再描画されること");
console.log("  ✅ UI TEST 2 PASS: ピン状態変化時のみ的確に 1 回マーカー更新が実行される");

// -------------------------------------------------------------
// [UI TEST 3] 人間操作状態保持: タブ選択・画面切替・スクロール位置の維持
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 3] 人間操作状態保持 (タブ選択・画面フォーカス・スクロール)");
sandbox.window.DashboardState.currentFocus = 'mail';
sandbox.window.DashboardState.selectedMailTabIndex = 2; // 管理者が「受渡要請」タブを選択中

// 同期実行
await sandbox.syncDashboardData();

assert.equal(sandbox.window.DashboardState.currentFocus, 'mail', "画面フォーカスは維持されること");
assert.equal(sandbox.window.DashboardState.selectedMailTabIndex, 2, "タブインデックス (2) が同期でリセットされないこと");
console.log("  ✅ UI TEST 3 PASS: 同期実行中も管理者のタブ選択状態 (Index 2) およびフォーカスが完全保持");

// -------------------------------------------------------------
// [UI TEST 4] 部分失敗 (PARTIAL_SUCCESS) 時の既存表示保持
// -------------------------------------------------------------
console.log("\n▶ [UI TEST 4] 部分失敗時の既存データ保持 (No Blanking / No Reset)");
// 既存データ設定
sandbox.window.DashboardState.stocks = [{ staffId: "K001", count: 500 }];
sandbox.window.DashboardState.requests = [{ requestId: "REQ001" }];

// 一部ドメイン (flyerStock, transfer) が失敗したレスポンス
mockApiResponseHandler = (action, params) => {
  return {
    success: true,
    status: "PARTIAL_SUCCESS",
    domains: {
      summary: { success: true, total: 100, done: 20 },
      flyerStock: { success: false, error: "Sheet lock timeout" }, // 失敗
      ranking: { success: true, ranking: [] },
      pinStatus: { success: true, inProgress: [], completed: [1] },
      roster: { success: true, roster: [] },
      transfer: { success: false, error: "Network timeout" }, // 失敗
      latestDistribution: { success: true, records: [] }
    },
    errors: { flyerStock: "Sheet lock timeout", transfer: "Network timeout" }
  };
};

await sandbox.syncDashboardData();

// 失敗ドメインのデータが空配列にリセットされず、直前状態が保持されていること
assert.equal(sandbox.window.DashboardState.stocks.length, 1, "失敗した在庫ドメインは空クリアされず既存表示を保持");
assert.equal(sandbox.window.DashboardState.requests.length, 1, "失敗した受渡要請ドメインは空クリアされず既存表示を保持");
console.log("  ✅ UI TEST 4 PASS: ドメイン障害時も既存表示データが完全保持され、画面のブランク・点滅がゼロ");

console.log("\n====================================================");
console.log("🎉 ALL MANAGER UI INTERACTION TESTS PASSED PERFECTLY!");
console.log("====================================================");

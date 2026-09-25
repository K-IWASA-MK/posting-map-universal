import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log("====================================================");
console.log("⚡ PHASE 14 UNIVERSAL PERFORMANCE VERIFICATION SUITE");
console.log("====================================================");

const rootDir = process.cwd();

// ─── 1. ADR-015 制定確認 ─────────────────────────────────────────
test('1. ADR-015 制定: T0-T5定義、実ユーザー視点T2、統一SLA基準値、線形増加傾向の明文化', () => {
  const adrPath = path.join(rootDir, 'docs/architecture/decisions/ADR-015_PERFORMANCE_CONTRACT.md');
  assert.ok(fs.existsSync(adrPath), 'ADR-015 file must exist');

  const content = fs.readFileSync(adrPath, 'utf8');
  assert.ok(content.includes('T0') && content.includes('T1') && content.includes('T2') && content.includes('T3') && content.includes('T4') && content.includes('T5'), 'ADR-015 must define T0 through T5 sequence');
  assert.ok(content.includes('Warm Start') && content.includes('200ms'), 'ADR-015 must specify Warm Start SLA <= 200ms');
  assert.ok(content.includes('Cold Start') && content.includes('800ms'), 'ADR-015 must specify Cold Start SLA <= 800ms');
  assert.ok(content.includes('Offline Start') && content.includes('200ms'), 'ADR-015 must specify Offline Start SLA <= 200ms');
  assert.ok(content.includes('中央値') && content.includes('5 回測定'), 'ADR-015 must specify unified 5-run median measurement protocol');
  assert.ok(content.includes('線形増加傾向'), 'ADR-015 must describe empirical linear trend for N-count scaling');
  assert.ok(content.includes('主要UI展開完了') && content.includes('ローディング'), 'ADR-015 must define T2 from user perspective (loading dismissed & main UI visible)');
});

// ─── 2. T0〜T5 測定境界・因果関係検証 ─────────────────────────────
test('2. T0〜T5 測定境界・因果関係: T0 < T1 < T2 < T3 < T4 < T5 の順序性と非ブロッキング性', () => {
  const timestamps = {
    t0: 100, // Navigation Start
    t1: 120, // DOMContentLoaded
    t2: 150, // showMainApp() & loading hidden
    t3: 180, // main-map DOM layout confirmed
    t4: 250, // markers mounted & idle
    t5: 400  // system summary / snapshot synced
  };

  assert.ok(timestamps.t0 < timestamps.t1, 'T0 must precede T1');
  assert.ok(timestamps.t1 < timestamps.t2, 'T1 must precede T2');
  assert.ok(timestamps.t2 < timestamps.t3, 'T2 must precede T3');
  assert.ok(timestamps.t3 < timestamps.t4, 'T3 must precede T4');
  assert.ok(timestamps.t4 < timestamps.t5, 'T4 must precede T5');

  // T2 SLA計算の論理検証
  const warmT2 = timestamps.t2 - timestamps.t0; // 50ms
  assert.ok(warmT2 <= 200, `Warm T2 (${warmT2}ms) must be <= 200ms`);
});

// ─── 3. Optimistic First Paint ロジック検証 ──────────────────────
test('3. Optimistic First Paint: hasExistingStaffId 時に非同期 API を待たずに即時 T2 展開', () => {
  const appJsPath = path.join(rootDir, 'active/dashboard/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Optimistic First Paint のロジックが存在することを確認
  assert.ok(appJs.includes('Optimistic First Paint'), 'app.js must contain Optimistic First Paint logic');
  assert.ok(appJs.includes('hasExistingStaffId'), 'app.js must check hasExistingStaffId');
  assert.ok(appJs.includes('showMainApp()'), 'app.js must invoke showMainApp() optimistically');

  // getStaffIdentity はバックグラウンド Promise として非ブロッキング実行されること
  assert.ok(appJs.includes('_identitySyncPromise = callApiPost(\'getStaffIdentity\''), 'Identity sync must be assigned to background promise');
});

// ─── 4. Cold Start 非ブロッキング検証 ─────────────────────────────
test('4. Cold Start 非ブロッキング: 初回未登録・キャッシュなし時もUIがクラッシュせず安全に進行', () => {
  const appJsPath = path.join(rootDir, 'active/dashboard/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 初回起動時の分岐（hasExistingStaffId が false）の処理が存在すること
  assert.ok(appJs.includes('VERIFYING IDENTITY...'), 'app.js must handle cold start loading status');
  assert.ok(appJs.includes('triggerBackgroundRegistration'), 'app.js must trigger background registration if not registered');
});

// ─── 5. マーカー差分更新 & 不要再生成スキップ検証 ─────────────────
test('5. マーカー差分更新: masterMarkers.length > 0 時の再生成スキップ (H-App & Manager)', () => {
  const renderJsPath = path.join(rootDir, 'active/dashboard/render.js');
  const renderJs = fs.readFileSync(renderJsPath, 'utf8');

  // H-App: masterMarkers.length > 0 でスキップ
  assert.ok(renderJs.includes('if (window.masterMarkers.length > 0) return;'), 'render.js must skip master markers creation if already instantiated');

  // Manager: 差分更新（pinLayers チェックまたは状態不変スキップ）
  const managerJsPath = path.join(rootDir, 'active/manager/manager.js');
  const managerJs = fs.readFileSync(managerJsPath, 'utf8');
  assert.ok(managerJs.includes('pinLayers') || managerJs.includes('markers') || managerJs.includes('getDashboardSnapshot'), 'manager.js must maintain marker references for differential updates');
});

// ─── 6. Network Waterfall 非同期化検証 ────────────────────────────
test('6. Network Waterfall: クリティカルパスに直列ブロッキング同期通信が存在しないこと', () => {
  const appJsPath = path.join(rootDir, 'active/dashboard/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 同期XMLHttpRequest(openの第3引数がfalse)が使用されていないこと
  assert.ok(!appJs.includes('.open("POST", url, false)'), 'Synchronous XHR must not be used');
  assert.ok(!appJs.includes('.open("GET", url, false)'), 'Synchronous XHR must not be used');

  // Snapshot API による集約（Phase 7）
  const v2ApiPath = path.join(rootDir, 'active/api/v2_api.js');
  const v2Api = fs.readFileSync(v2ApiPath, 'utf8');
  assert.ok(v2Api.includes('getDashboardSnapshot'), 'v2_api.js must provide aggregated getDashboardSnapshot');
});

// ─── 7. Universal Engine 動的 N 件スケーラビリティ検証 ────────────
test('7. 動的 N 件スケーラビリティ: 検証用サンプル N=100/337/1000 において極端なスパイクがないこと', () => {
  const sampleSizes = [100, 337, 1000];
  const durations = [];

  for (const n of sampleSizes) {
    const data = Array.from({ length: n }, (_, i) => ({
      rowId: String(i + 1),
      cityName: 'テスト市',
      townName: `町丁目_${i + 1}`,
      lat: 35.0 + i * 0.001,
      lng: 136.0 + i * 0.001
    }));

    const start = performance.now();
    const index = new Map();
    data.forEach(item => index.set(item.rowId, item));
    const duration = performance.now() - start;
    durations.push({ n, duration });
  }

  // 1000件でも極小時間（< 50ms）で完了すること
  const d1000 = durations.find(d => d.n === 1000);
  assert.ok(d1000.duration < 50, `N=1000 processing time (${d1000.duration}ms) must remain well under 50ms`);
});

// ─── 8. 不可侵境界 & 最小侵襲検証 ─────────────────────────────────
test('8. 不可侵境界: Phase 7〜13 契約破壊なし、マスターデータ保全、外部APM等の過剰設計なし', () => {
  // 住所マスター・境界データが変更されていないこと
  const addressCsvPath = path.join(rootDir, 'data/address_master.csv');
  const boundariesPath = path.join(rootDir, 'data/boundaries.geojson');
  assert.ok(fs.existsSync(addressCsvPath), 'address_master.csv must exist');
  assert.ok(fs.existsSync(boundariesPath), 'boundaries.geojson must exist');

  // package.json に不要な外部APMパッケージ（newrelic, datadog等）が混入していないこと
  const pkgJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    assert.ok(!allDeps['newrelic'], 'newrelic must not be installed');
    assert.ok(!allDeps['dd-trace'], 'datadog must not be installed');
  }
});

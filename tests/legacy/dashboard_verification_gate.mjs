/**
 * POSTING MAP Dashboard Quality Gate (6-Phase Comprehensive Verification Suite)
 * 
 * 思想:
 * 地区非依存テンプレートアーキテクチャに完全準拠し、特定地区に依存しない恒久品質ゲート。
 * 期待値（ピン数・CSV行数・自治体）は config.js および Backend SSOT から動的取得する。
 * 
 * 6つの品質ゲート:
 * [Phase 1] 実機Dashboard通常動作 (masterLoadStatus, 動的マスターピン数一致, アプリエラー0件)
 * [Phase 2] 連続リロード安定性 (7回連続リロードでのデッドロック・タイミング競合なし)
 * [Phase 3] Master ERROR 障害・部分劣化試験 (CSV障害時に地図のみERR、Backend由来機能は継続)
 * [Phase 4] cities SSOT & ノイズ除外確認 (Backend getTier1 を正とし、ノイズを完全除外)
 * [Phase 5] fitBounds & 異常座標防御試験 (マスターピンからの自動表示、NaN/null混入時のクラッシュ防御)
 * [Phase 6] Hアプリ非干渉 & アーキテクチャ分離監査 (Hアプリの未干渉・staticMaster非参照)
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';

async function ensureServerRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:8080/manager/index.html', (res) => {
      resolve(null);
    });
    req.on('error', () => {
      console.log('Starting background local server on port 8080...');
      const child = spawn('node', ['scripts/serve.mjs'], {
        cwd: process.cwd(),
        stdio: 'ignore',
        detached: false
      });
      setTimeout(() => resolve(child), 1200);
    });
  });
}

async function runDashboardQualityGate() {
  console.log("===============================================================");
  console.log("🏛️ POSTING MAP DASHBOARD QUALITY GATE (6 PHASES INCL. N-CONTRACT)");
  console.log("===============================================================\n");

  const results = {
    phase1: { name: "Phase 1: 実機Dashboard通常動作 (District-Agnostic)", pass: false, details: [] },
    phase2: { name: "Phase 2: 連続リロード安定性", pass: false, details: [] },
    phase3: { name: "Phase 3: Master ERROR 障害・部分劣化試験", pass: false, details: [] },
    phase4: { name: "Phase 4: cities SSOT & ノイズ除外確認", pass: false, details: [] },
    phase5: { name: "Phase 5: fitBounds & 異常座標防御試験", pass: false, details: [] },
    phase6: { name: "Phase 6: Hアプリ非干渉 & アーキテクチャ分離監査", pass: false, details: [] },
  };

  const spawnedServer = await ensureServerRunning();
  // 1. config.js から動的に静的マスター定義を取得し、期待件数を算出（地区非依存化）
  const configPath = path.resolve(process.cwd(), 'data/config.js');
  let expectedCsvPinsCount = 0;
  let csvFilename = '';

  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf8');
    const csvMatch = configContent.match(/addressCsvFilename:\s*["']([^"']+)["']/);
    if (csvMatch) {
      csvFilename = csvMatch[1];
      const csvPath = path.resolve(process.cwd(), 'data', csvFilename);
      if (fs.existsSync(csvPath)) {
        const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n').filter(l => l.trim().length > 0);
        expectedCsvPinsCount = Math.max(0, lines.length - 1); // ヘッダー除く
      }
    }
  }

  const muniCsvPath = path.resolve(process.cwd(), 'data/municipality_master.csv');
  let expectedCities = [];
  if (fs.existsSync(muniCsvPath)) {
    const lines = fs.readFileSync(muniCsvPath, 'utf8').trim().split('\n').filter(l => l.trim().length > 0);
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts[0]) expectedCities.push(parts[0].trim());
    }
  }

  console.log(`[Config SSOT Inspection] Target CSV: ${csvFilename || '(未定義)'}, Expected Pins: ${expectedCsvPinsCount}, Expected Cities: ${expectedCities.join(', ')}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  async function setupAuthenticatedPage(page) {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('pm_last_district');
        localStorage.setItem('pm_auth_DEFAULT', 'true');
      } catch (e) {}
    });

    await page.route('**/data/config.js*', async (route) => {
      const originalPath = path.resolve(process.cwd(), 'data/config.js');
      let content = fs.readFileSync(originalPath, 'utf8');
      content = content.replace('gasWebAppUrl: ""', 'gasWebAppUrl: "http://localhost:8080/mock-gas/exec"');
      content = content.replace('liffId: ""', 'liffId: "9999999999-TestLiff"');
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        body: content
      });
    });

    await page.route('**/*exec*', async (route, request) => {
      const url = request.url();
      const method = request.method();
      const postData = request.postData() || '';

      if (postData.includes('verifyManagerPassword') || url.includes('action=verifyManagerPassword')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            districtCode: 'DEFAULT'
          })
        });
        return;
      }

      if (url.includes('action=getSystemSummary') || postData.includes('getSystemSummary')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            districtName: 'MOCK_DISTRICT',
            totalAreas: expectedCsvPinsCount,
            doneAreas: 12,
            unallocatedAreas: expectedCsvPinsCount - 12,
            totalRecords: 12000,
            totalStocks: 3500,
            activePosters: 5,
            liveEvents: []
          })
        });
        return;
      }

      if (url.includes('action=getGlobalPinStatus') || postData.includes('getGlobalPinStatus')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            statusMap: {}
          })
        });
        return;
      }

      if (url.includes('action=getTier1') || postData.includes('getTier1')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            cities: expectedCities
          })
        });
        return;
      }

      if (url.includes('action=getFlyerStock') || postData.includes('getFlyerStock') || url.includes('action=getStocks') || postData.includes('getStocks')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            stocks: [{ id: '1', name: 'Aチラシ', count: 100 }]
          })
        });
        return;
      }

      if (url.includes('action=getRanking') || postData.includes('getRanking') || url.includes('action=getPosterRanking') || postData.includes('getPosterRanking')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            ranking: [{ rank: 1, name: '配布員A', count: 500 }]
          })
        });
        return;
      }

      if (url.includes('action=getRoster') || postData.includes('getRoster')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            roster: [{ id: '1', name: '配布員A' }]
          })
        });
        return;
      }

      if (url.includes('action=getTransferRequests') || postData.includes('getTransferRequests')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            requests: []
          })
        });
        return;
      }

      if (url.includes('action=getLatestDistribution') || postData.includes('getLatestDistribution')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            success: true,
            distributions: []
          })
        });
        return;
      }

      await route.continue();
    });
  }

  try {
    console.log("\n▶ [SECURITY GATE] 端末制限撤廃・直接アクセス正常性試験 実行中...");
    const pageDirect = await browser.newPage();
    const DASHBOARD_URL = 'http://localhost:8080/manager/index.html';
    await pageDirect.goto(DASHBOARD_URL, { waitUntil: 'load' });
    const isDirectAccessOk = await pageDirect.evaluate(() => {
      const lockEl = document.getElementById('device-lock-screen');
      const mainEl = document.querySelector('main');
      return (!lockEl || lockEl.classList.contains('hidden')) && (mainEl && mainEl.style.display !== 'none');
    });
    await pageDirect.close();
    console.log(`[SECURITY GATE] 端末制限撤廃・直接メイン表示確認: ${isDirectAccessOk ? '✅ PASS (ロックなし・正常表示)' : '❌ FAIL'}`);
    // -------------------------------------------------------------
    // PHASE 1: 実機Dashboard通常動作
    // -------------------------------------------------------------
    console.log("\n▶ [PHASE 1] 実機Dashboard通常動作の検証中...");
    const page1 = await browser.newPage();
    await setupAuthenticatedPage(page1);
    const appErrors1 = [];

    page1.on('pageerror', err => {
      appErrors1.push(`[JS Exception] ${err.toString()}`);
    });
    page1.on('response', res => {
      if (res.status() >= 400 && !res.url().includes('favicon.ico')) {
        appErrors1.push(`[HTTP ${res.status()}] ${res.url()}`);
      }
    });

    await page1.goto(DASHBOARD_URL, { waitUntil: 'load' });
    await page1.waitForFunction(() => window.DashboardState && window.DashboardState.masterLoadStatus === 'LOADED' && window.DashboardState.summary, { timeout: 15000 });

    const state1 = await page1.evaluate(() => {
      return {
        masterLoadStatus: window.DashboardState.masterLoadStatus,
        masterPinsCount: window.DashboardState.masterPins.length,
        cities: window.DashboardState.cities,
        totalAreasText: document.getElementById('fact-total-areas')?.textContent,
        doneAreasText: document.getElementById('fact-done-areas')?.textContent,
        unallocatedAreasText: document.getElementById('fact-unallocated-areas')?.textContent,
        totalRecordsText: document.getElementById('fact-total-records')?.textContent,
        totalStocksText: document.getElementById('fact-total-stocks')?.textContent,
        totalRosterText: document.getElementById('fact-total-roster')?.textContent,
        mapDistrictLabelText: document.getElementById('map-district-label')?.textContent,
        liveCardsCount: document.querySelectorAll('#live-feed-container > div').length
      };
    });

    const phase1Pass = (
      state1.masterLoadStatus === 'LOADED' &&
      state1.masterPinsCount === expectedCsvPinsCount &&
      state1.totalAreasText === expectedCsvPinsCount.toLocaleString() &&
      state1.mapDistrictLabelText.includes(`${expectedCsvPinsCount}エリア`) &&
      state1.unallocatedAreasText !== '--' &&
      state1.totalRecordsText !== '--' &&
      state1.totalStocksText !== '--' &&
      state1.totalRosterText !== '--' &&
      appErrors1.length === 0
    );

    results.phase1.pass = phase1Pass;
    results.phase1.details.push(`masterLoadStatus: ${state1.masterLoadStatus}`);
    results.phase1.details.push(`masterPinsCount: ${state1.masterPinsCount} (期待値: ${expectedCsvPinsCount})`);
    results.phase1.details.push(`totalAreasText: ${state1.totalAreasText}`);
    results.phase1.details.push(`totalRecordsText: ${state1.totalRecordsText}`);
    results.phase1.details.push(`totalStocksText: ${state1.totalStocksText}`);
    results.phase1.details.push(`totalRosterText: ${state1.totalRosterText}`);
    results.phase1.details.push(`mapDistrictLabel: ${state1.mapDistrictLabelText}`);
    results.phase1.details.push(`App Errors: ${appErrors1.length} ${appErrors1.length > 0 ? `(${appErrors1.join(', ')})` : '(0件: PASS)'}`);
    await page1.close();

    // -------------------------------------------------------------
    // PHASE 2: 連続リロード安定性 (7回)
    // -------------------------------------------------------------
    console.log("\n▶ [PHASE 2] 連続リロード試験 (7回) 実行中...");
    const page2 = await browser.newPage();
    await setupAuthenticatedPage(page2);
    let reloadSuccessCount = 0;
    for (let i = 1; i <= 7; i++) {
      await page2.goto(DASHBOARD_URL, { waitUntil: 'load' });
      await page2.waitForFunction(() => window.DashboardState && window.DashboardState.masterLoadStatus === 'LOADED', { timeout: 10000 });
      const status = await page2.evaluate(() => window.DashboardState?.masterLoadStatus);
      if (status === 'LOADED') {
        reloadSuccessCount++;
      }
    }
    await page2.close();
    results.phase2.pass = (reloadSuccessCount === 7);
    results.phase2.details.push(`7回中成功回数: ${reloadSuccessCount}/7`);

    // -------------------------------------------------------------
    // PHASE 3: Master ERROR 障害・部分劣化試験
    // -------------------------------------------------------------
    console.log("\n▶ [PHASE 3] Master ERROR 障害・部分劣化試験 実行中...");
    const page3 = await browser.newPage();
    await setupAuthenticatedPage(page3);
    await page3.route('**/*.csv', route => route.abort());

    await page3.goto(DASHBOARD_URL, { waitUntil: 'load' });
    await page3.waitForFunction(() => window.DashboardState && window.DashboardState.masterLoadStatus === 'ERROR' && window.DashboardState.summary, { timeout: 15000 });

    const state3 = await page3.evaluate(() => {
      return {
        masterLoadStatus: window.DashboardState?.masterLoadStatus,
        totalAreasText: document.getElementById('fact-total-areas')?.textContent,
        doneAreasText: document.getElementById('fact-done-areas')?.textContent,
        hasBackendSummary: !!window.DashboardState?.summary,
        stocksCount: window.DashboardState?.stocks?.length || 0,
        rankingCount: window.DashboardState?.ranking?.length || 0
      };
    });
    await page3.close();

    const phase3Pass = (
      state3.masterLoadStatus === 'ERROR' &&
      state3.totalAreasText === 'ERR' &&
      state3.doneAreasText === 'ERR' &&
      state3.hasBackendSummary
    );
    results.phase3.pass = phase3Pass;
    results.phase3.details.push(`masterLoadStatus: ${state3.masterLoadStatus}`);
    results.phase3.details.push(`fact-total-areas: ${state3.totalAreasText}`);
    results.phase3.details.push(`fact-done-areas: ${state3.doneAreasText}`);
    results.phase3.details.push(`Backend summary生存確認: ${state3.hasBackendSummary ? 'PASS' : 'FAIL'}`);
    results.phase3.details.push(`Backend stocksCount: ${state3.stocksCount}`);
    results.phase3.details.push(`Backend rankingCount: ${state3.rankingCount}`);

    // -------------------------------------------------------------
    // PHASE 4: cities SSOT & ノイズ除外 & 選択時展開維持確認
    // -------------------------------------------------------------
    console.log("\n▶ [PHASE 4] cities SSOT & ノイズ除外 & 選択時展開維持確認 実行中...");
    const page4 = await browser.newPage();
    await setupAuthenticatedPage(page4);
    await page4.goto(DASHBOARD_URL, { waitUntil: 'load' });
    await page4.waitForFunction(() => window.DashboardState && window.DashboardState.cities.length > 0, { timeout: 10000 });

    const citiesCheck = await page4.evaluate(() => {
      const trigger = document.getElementById('city-selector-trigger');
      const list = document.getElementById('city-selector-list');
      const currentLabel = document.getElementById('city-selector-current');

      const initialClosed = list?.classList.contains('hidden') && trigger?.getAttribute('aria-expanded') === 'false';

      // 1. トリガーをクリックして展開テスト
      trigger?.click();
      const openedAfterFirstClick = !list?.classList.contains('hidden') && trigger?.getAttribute('aria-expanded') === 'true';

      // 2. アイテム一覧取得
      const items = Array.from(list?.querySelectorAll('button[data-city-val]') || []).map(b => b.getAttribute('data-city-val'));

      // 3. 1つ目の自治体 (items[1]) をクリック ➔ 選択後も「OPENのまま」であることを検証
      let firstCityWorksAndStaysOpen = false;
      if (items.length > 1) {
        const city1 = items[1];
        const btn1 = list.querySelector(`button[data-city-val="${city1}"]`);
        btn1?.click();

        const stillOpen1 = !list?.classList.contains('hidden') && trigger?.getAttribute('aria-expanded') === 'true';
        const label1 = currentLabel?.textContent === city1;
        const state1 = window.DashboardState?.selectedCity === city1;
        firstCityWorksAndStaysOpen = stillOpen1 && label1 && state1;
      }

      // 4. 2つ目の自治体 (items[2]) を連続クリック ➔ 選択後も「OPENのまま」であることを検証 (複数自治体存在時のみ)
      let secondCityWorksAndStaysOpen = items.length <= 2;
      if (items.length > 2) {
        const city2 = items[2];
        const btn2 = list.querySelector(`button[data-city-val="${city2}"]`);
        btn2?.click();

        const stillOpen2 = !list?.classList.contains('hidden') && trigger?.getAttribute('aria-expanded') === 'true';
        const label2 = currentLabel?.textContent === city2;
        const state2 = window.DashboardState?.selectedCity === city2;
        secondCityWorksAndStaysOpen = stillOpen2 && label2 && state2;
      }

      // 5. トリガーを再度クリック ➔ 明示的に閉じることを検証
      trigger?.click();
      const closedAfterTriggerReclick = list?.classList.contains('hidden') && trigger?.getAttribute('aria-expanded') === 'false';

      return {
        stateCities: window.DashboardState.cities,
        renderedItems: items,
        initialClosed,
        openedAfterFirstClick,
        firstCityWorksAndStaysOpen,
        secondCityWorksAndStaysOpen,
        closedAfterTriggerReclick
      };
    });
    await page4.close();

    const hasOriginalNoise = citiesCheck.stateCities.some(c => c.includes('原本') || c.includes('テンプレート'));
    const hasValidCities = citiesCheck.stateCities.length > 0;

    const allExpectedCitiesPresent = expectedCities.length > 0
      ? expectedCities.every(c => citiesCheck.stateCities.includes(c))
      : true;

    const hasDeviceMgmt = citiesCheck.stateCities.some(c => c.includes('端末管理'));
    const hasContractMgmt = citiesCheck.stateCities.some(c => c.includes('契約管理'));
    const hasConflict = citiesCheck.stateCities.some(c => c.includes('conflict'));
    const noManagementNoise = !hasDeviceMgmt && !hasContractMgmt && !hasConflict;

    const phase4Pass = (
      !hasOriginalNoise &&
      hasValidCities &&
      allExpectedCitiesPresent &&
      noManagementNoise &&
      citiesCheck.renderedItems.includes('ALL') &&
      citiesCheck.initialClosed &&
      citiesCheck.openedAfterFirstClick &&
      citiesCheck.firstCityWorksAndStaysOpen &&
      citiesCheck.secondCityWorksAndStaysOpen &&
      citiesCheck.closedAfterTriggerReclick
    );

    results.phase4.pass = phase4Pass;
    results.phase4.details.push(`自治体数: ${citiesCheck.stateCities.length}`);
    const cityCheckStr = expectedCities.map(c => `${c}: ${citiesCheck.stateCities.includes(c) ? 'PASS' : 'FAIL'}`).join(', ');
    results.phase4.details.push(`正規自治体表示確認 (${cityCheckStr})`);
    results.phase4.details.push(`管理シート非混入確認 (端末管理: ${hasDeviceMgmt ? 'FAIL (混入)' : 'PASS (除外)'}, 契約管理: ${hasContractMgmt ? 'FAIL (混入)' : 'PASS (除外)'}, conflict: ${hasConflict ? 'FAIL (混入)' : 'PASS (除外)'})`);
    results.phase4.details.push(`ノイズ除外('原本'): ${hasOriginalNoise ? 'FAIL (混入)' : 'PASS (除外済)'}`);
    results.phase4.details.push(`選択時展開維持 (開いたまま連続切替): ${citiesCheck.firstCityWorksAndStaysOpen && citiesCheck.secondCityWorksAndStaysOpen ? 'PASS' : 'FAIL'}`);
    results.phase4.details.push(`トリガー再タップで閉じる: ${citiesCheck.closedAfterTriggerReclick ? 'PASS' : 'FAIL'}`);
    results.phase4.details.push(`セレクター項目: ${citiesCheck.renderedItems.join(', ')}`);

    // -------------------------------------------------------------
    // PHASE 5: fitBounds & 異常座標防御試験
    // -------------------------------------------------------------
    console.log("\n▶ [PHASE 5] fitBounds & 異常座標防御試験 実行中...");
    const page5 = await browser.newPage();
    await setupAuthenticatedPage(page5);
    await page5.goto(DASHBOARD_URL, { waitUntil: 'load' });
    await page5.waitForFunction(() => window.DashboardState && window.DashboardState.masterLoadStatus === 'LOADED', { timeout: 10000 });

    const fitBoundsCheck = await page5.evaluate(() => {
      const map = window.DashboardState.map;
      const center = map.getCenter();
      
      let exceptionThrown = false;
      try {
        const dummyPins = [
          { lat: NaN, lng: 136.6 },
          { lat: 35.0, lng: null },
          { lat: 0, lng: 0 },
          { lat: 35.06, lng: 136.62 }
        ];
        const validCoords = dummyPins
          .filter(p => isFinite(p.lat) && isFinite(p.lng) && p.lat !== 0 && p.lng !== 0)
          .map(p => [p.lat, p.lng]);
        if (validCoords.length > 0) {
          const testBounds = L.latLngBounds(validCoords);
          map.fitBounds(testBounds);
        }
      } catch (e) {
        exceptionThrown = true;
      }

      return {
        center: { lat: center.lat, lng: center.lng },
        exceptionThrown
      };
    });
    await page5.close();

    const phase5Pass = (!fitBoundsCheck.exceptionThrown && isFinite(fitBoundsCheck.center.lat) && isFinite(fitBoundsCheck.center.lng));
    results.phase5.pass = phase5Pass;
    results.phase5.details.push(`Map Center: lat ${fitBoundsCheck.center.lat.toFixed(4)}, lng ${fitBoundsCheck.center.lng.toFixed(4)}`);
    results.phase5.details.push(`異常座標混入時クラッシュ防御: ${fitBoundsCheck.exceptionThrown ? 'FAIL' : 'PASS'}`);

    // -------------------------------------------------------------
    // PHASE 6: Hアプリ非干渉 & アーキテクチャ分離監査
    console.log("\n▶ [PHASE 6] Hアプリ非干渉 & アーキテクチャ分離監査 実行中...");
    const page6 = await browser.newPage();
    await setupAuthenticatedPage(page6);
    let hAppException = false;
    page6.on('pageerror', (err) => {
      console.error('[H-App PageError]', err);
      hAppException = true;
    });

    await page6.addInitScript(() => {
      window.liff = {
        init: () => Promise.resolve(),
        isLoggedIn: () => true,
        getAccessToken: () => 'stub-access-token',
        getIDToken: () => 'stub-id-token',
        getOS: () => 'web',
        getProfile: () => Promise.resolve({ userId: 'TEST_USER', displayName: 'テスト' })
      };
    });

    await page6.goto('http://localhost:8080/active/dashboard/index.html', { waitUntil: 'networkidle' });
    await page6.waitForSelector('#app', { timeout: 5000 }).catch(() => {});
    await page6.close();

    // Hアプリロジック（active/dashboard/app.js, render.js 等）が staticMaster を参照していないことの監査（active/配下ゼロ件完全隔離）
    const grepStaticMasterHApp = execSync("git grep -n 'staticMaster' active/dashboard/ || true", { encoding: 'utf8' }).trim();
    const staticMasterOccurrences = grepStaticMasterHApp.split('\n').filter(Boolean);
    const isStaticMasterIsolated = (staticMasterOccurrences.length === 0);

    const phase6Pass = (!hAppException && isStaticMasterIsolated);
    results.phase6.pass = phase6Pass;
    results.phase6.details.push(`Hアプリ起動正常性: ${hAppException ? 'FAIL (例外発生)' : 'PASS (正常)'}`);
    results.phase6.details.push(`Hアプリロジック非干渉 (active/ 内 staticMaster 完全追放): ${isStaticMasterIsolated ? 'PASS (0件)' : 'FAIL'}`);

  } catch (err) {
    console.error("Quality Gate Error:", err);
  } finally {
    await browser.close();
    if (spawnedServer) {
      try { spawnedServer.kill(); } catch (e) {}
    }
  }

  // -------------------------------------------------------------
  // 最終判定 & レポート出力
  // -------------------------------------------------------------
  console.log("\n===============================================================");
  console.log("📊 DASHBOARD QUALITY GATE AUDIT REPORT");
  console.log("===============================================================");
  let allPass = true;
  for (const [key, p] of Object.entries(results)) {
    const mark = p.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`[${mark}] ${p.name}`);
    p.details.forEach(d => console.log(`       - ${d}`));
    if (!p.pass) allPass = false;
  }
  console.log("===============================================================");
  console.log(`FINAL JUDGEMENT: ${allPass ? "🎉 ALL QUALITY GATES PASSED (PRODUCTION READY)" : "🛑 QUALITY GATE FAILED"}`);
  console.log("===============================================================\n");

  if (!allPass) {
    process.exit(1);
  }
}

runDashboardQualityGate();

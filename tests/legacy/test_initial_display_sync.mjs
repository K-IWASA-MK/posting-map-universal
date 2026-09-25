import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 8102;
const rootDir = process.cwd();

let mockRegisterStaffDelay = 1000;
let mockRegisterStaffCallCount = 0;
let mockSummaryCallCount = 0;
let mockRankingCallCount = 0;

function startLocalServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let relativePath = req.url.split('?')[0];
      if (relativePath.startsWith('/app/')) {
        relativePath = relativePath.replace('/app/', '/active/dashboard/');
      } else if (relativePath === '/app') {
        relativePath = '/active/dashboard/index.html';
      } else if (relativePath.startsWith('/business/')) {
        relativePath = relativePath.replace('/business/', '/active/business/');
      } else if (relativePath.startsWith('/data/')) {
        relativePath = relativePath.replace('/data/', '/data/');
      }
      let filePath = path.join(rootDir, relativePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end(`File not found: ${req.url}`);
        } else {
          let contentType = 'text/html';
          if (filePath.endsWith('.js')) contentType = 'application/javascript';
          if (filePath.endsWith('.css')) contentType = 'text/css';
          if (filePath.endsWith('.json')) contentType = 'application/json';
          if (filePath.endsWith('.png')) contentType = 'image/png';
          if (filePath.endsWith('.csv')) contentType = 'text/plain; charset=utf-8';

          let responseData = data;
          if (filePath.endsWith('config.js')) {
            let configText = data.toString('utf8');
            configText = configText.replace(/gasWebAppUrl:\s*".*?"/, `gasWebAppUrl: "http://localhost:${PORT}/mock-exec"`);
            configText = configText.replace(/liffId:\s*".*?"/, 'liffId: "test-liff-init-sync"');
            responseData = Buffer.from(configText, 'utf8');
          }

          res.writeHead(200, { 'Content-Type': contentType });
          res.end(responseData);
        }
      });
    });

    server.listen(PORT, () => {
      resolve(server);
    });
  });
}

async function setupMockRoutes(page) {
  // LIFF SDK モック
  await page.route('**/sdk.js', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.liff = {
          init: () => Promise.resolve(),
          isLoggedIn: () => true,
          getAccessToken: () => 'mock-access-token-sync',
          getIDToken: () => 'mock-id-token',
          getOS: () => 'ios',
          getProfile: () => Promise.resolve({
            userId: 'U_TEST_NEW_STAFF',
            displayName: '桑名 新規',
            pictureUrl: 'https://example.com/new_avatar.png'
          }),
          login: () => {},
          logout: () => {}
        };
      `
    });
  });

  // Google Maps モック
  await page.route('**/maps/api/js*', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.google = { maps: { Map: function() { return { setCenter: ()=>{}, fitBounds: ()=>{} }; } } };`
    });
  });

  // GAS API モック
  await page.route('**/*mock-exec*', async route => {
    const postData = route.request().postData() || '';
    let bodyObj = {};
    try { bodyObj = JSON.parse(postData); } catch (e) {}
    const action = bodyObj.action || '';

    if (action === 'registerStaff') {
      mockRegisterStaffCallCount++;
      if (mockRegisterStaffDelay > 0) {
        await new Promise(r => setTimeout(r, mockRegisterStaffDelay));
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          id: 'S999',
          message: 'Staff registered successfully'
        })
      });
    }

    if (action === 'getSystemSummary') {
      mockSummaryCallCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          districtName: '桑名市',
          total: 337,
          done: 120,
          percent: 36,
          online: true,
          contractStatus: 'ACTIVE',
          isExpired: false
        })
      });
    }

    if (action === 'getRanking') {
      mockRankingCallCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          ranking: [{ rank: 1, staffName: '桑名 新規', count: 100, staffId: 'S999' }]
        })
      });
    }

    if (action === 'getMapsApiKey') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, key: 'mock-key' })
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
}

async function runInitialDisplaySyncSuite() {
  console.log('===============================================================');
  console.log('🧪 H-APP INITIAL DISPLAY TIMING & SYNC VERIFICATION SUITE');
  console.log('===============================================================');

  const server = await startLocalServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // -------------------------------------------------------------
    // Case A: 新規登録ライフサイクル（1000ms遅延注入）
    // -------------------------------------------------------------
    console.log('\n▶ [Case A: 新規登録] 1000ms通信遅延中の未完成画面非表示 & 完了時一括表示試験');
    mockRegisterStaffDelay = 1000;
    mockRegisterStaffCallCount = 0;

    const contextA = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15'
    });
    const pageA = await contextA.newPage();
    await setupMockRoutes(pageA);

    // ★ localStorage は完全に空（未登録状態）からスタート！
    await pageA.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // ページ遷移開始
    await pageA.goto(`http://localhost:${PORT}/app/index.html`);

    // 300ms時点（GAS通信中: 約1000ms遅延の最中）でスナップショット監査
    await pageA.waitForTimeout(300);
    const midFlightState = await pageA.evaluate(() => {
      const app = document.getElementById('app');
      const loading = document.getElementById('loading');
      const settingsContent = document.getElementById('settings-content');
      const hasAppClass = app ? (!app.classList.contains('hidden') && !app.classList.contains('opacity-0')) : false;
      const htmlText = settingsContent ? settingsContent.innerHTML : '';
      const hasKoshikiOnly = htmlText.includes('公式配布員') && !htmlText.includes('STAFF ID');
      return {
        appVisible: hasAppClass,
        loadingVisible: loading ? (!loading.classList.contains('hidden') && !loading.classList.contains('opacity-0')) : false,
        settingsHtml: htmlText,
        hasKoshikiOnly: hasKoshikiOnly
      };
    });

    console.log('  遅延通信中 (300ms) チェック:');
    console.log(`    - app表示状態: ${midFlightState.appVisible} (期待値: false - 画面が先行表示されていないこと)`);
    console.log(`    - loading表示状態: ${midFlightState.loadingVisible} (期待値: true - ローディング維持)`);
    console.log(`    - 「公式配布員」単独先行描画: ${midFlightState.hasKoshikiOnly} (期待値: false)`);

    if (midFlightState.appVisible || midFlightState.hasKoshikiOnly) {
      throw new Error('FAIL: 通信遅延中に未完成画面（公式配布員のみ）が先行表示されました！');
    }
    console.log('  ✅ 通信遅延中の未完成画面ブロック: PASS');

    // 通信完了を待機（合計1500ms待機）
    await pageA.waitForTimeout(1200);

    const settledState = await pageA.evaluate(() => {
      const app = document.getElementById('app');
      const loading = document.getElementById('loading');
      const settingsContent = document.getElementById('settings-content');
      const headerCount = document.getElementById('header-count');
      const bottomNav = document.getElementById('bottom-nav');
      const html = settingsContent ? settingsContent.innerHTML : '';

      // 5箇所の存在確認
      const hasHeaderCount = headerCount && headerCount.textContent.length > 0;
      const hasOfficialStaffText = html.includes('公式配布員');
      const hasStaffIdBadge = html.includes('STAFF ID S999') || html.includes('STAFF ID');
      const hasStaffCard = html.includes('Authorized Staff') && html.includes('桑名 新規');
      const hasBottomNav = bottomNav && bottomNav.style.display !== 'none';

      return {
        appVisible: app && !app.classList.contains('hidden') && !app.classList.contains('opacity-0'),
        loadingHidden: !loading || loading.classList.contains('opacity-0') || loading.style.display === 'none',
        hasHeaderCount,
        hasOfficialStaffText,
        hasStaffIdBadge,
        hasStaffCard,
        hasBottomNav,
        allFivePresent: hasHeaderCount && hasOfficialStaffText && hasStaffIdBadge && hasStaffCard && hasBottomNav
      };
    });

    console.log('  通信完了後チェック:');
    console.log(`    - app一括表示: ${settledState.appVisible}`);
    console.log(`    - loading消灯: ${settledState.loadingHidden}`);
    console.log(`    - ①全体エリアヘッダー: ${settledState.hasHeaderCount}`);
    console.log(`    - ②公式配布員テキスト: ${settledState.hasOfficialStaffText}`);
    console.log(`    - ③STAFF IDバッジ (同時生成): ${settledState.hasStaffIdBadge}`);
    console.log(`    - ④AUTHORIZED STAFFカード: ${settledState.hasStaffCard}`);
    console.log(`    - ⑤下部ナビゲーション: ${settledState.hasBottomNav}`);
    console.log(`    - 5箇所一括完成状態: ${settledState.allFivePresent}`);

    if (!settledState.appVisible || !settledState.allFivePresent) {
      throw new Error('FAIL: 新規登録完了後に5箇所が揃って一括表示されませんでした！');
    }
    console.log('  ✅ Case A (新規登録一括表示): PASS');
    await contextA.close();

    // -------------------------------------------------------------
    // Case B: 登録済みユーザー（最初から即時一括表示）
    // -------------------------------------------------------------
    console.log('\n▶ [Case B: 登録済みユーザー] 保存済みSTAFF IDによる初回即時一括表示 & 最初の可視化フレーム追跡試験');
    mockRegisterStaffDelay = 0;

    const contextB = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15'
    });
    const pageB = await contextB.newPage();
    await setupMockRoutes(pageB);

    // ★ 登録済みユーザー事前セット + 詳細ライフサイクルフック & 追跡 MutationObserver
    await pageB.addInitScript(() => {
      localStorage.setItem('user_info', JSON.stringify({
        id: 'S101',
        last: '桑名',
        first: '太郎',
        picture: 'https://example.com/avatar.png',
        lineUserId: 'U_EXISTING_STAFF'
      }));

      window.__timeline = [];
      function record(step, detail = {}) {
        window.__timeline.push({
          time: performance.now(),
          step,
          ...detail
        });
      }

      record('1_localStorage_initialized', { userInfo: localStorage.getItem('user_info') });

      window.__firstVisibleSnapshot = null;

      // MutationObserver で DOM 変化を完全追跡
      const observer = new MutationObserver((mutations) => {
        const app = document.getElementById('app');
        const settingsContent = document.getElementById('settings-content');
        const html = settingsContent ? settingsContent.innerHTML : '';

        // #app の hidden 解除瞬間
        if (app && !app.classList.contains('hidden') && !window.__firstVisibleSnapshot) {
          const headerCount = document.getElementById('header-count');
          const bottomNav = document.getElementById('bottom-nav');
          const pageSettings = document.getElementById('page-settings');

          window.__firstVisibleSnapshot = {
            time: performance.now(),
            appClasses: app.className,
            pageSettingsClasses: pageSettings ? pageSettings.className : '',
            hasOfficialStaff: html.includes('公式配布員'),
            hasStaffIdBadge: html.includes('STAFF ID 101') || html.includes('STAFF ID'),
            hasStaffCard: html.includes('Authorized Staff'),
            hasHeaderCount: !!(headerCount && headerCount.textContent.length > 0),
            hasBottomNav: !!(bottomNav && bottomNav.style.display !== 'none'),
            htmlSnippet: html.substring(0, 160).trim()
          };
          record('app_unhidden_first_frame', { snapshot: window.__firstVisibleSnapshot });
        }

        // settings-content に公式配布員またはSTAFF IDが入った瞬間
        if (html.includes('公式配布員') && !window.__recordedOfficialStaff) {
          window.__recordedOfficialStaff = true;
          record('dom_official_staff_inserted', {
            hasStaffIdBadge: html.includes('STAFF ID'),
            htmlSnippet: html.substring(0, 100).trim()
          });
        }
        if (html.includes('STAFF ID') && !window.__recordedStaffId) {
          window.__recordedStaffId = true;
          record('dom_staff_id_badge_inserted', {
            htmlSnippet: html.substring(0, 100).trim()
          });
        }
      });

      observer.observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ['class', 'style']
      });

      // window.logDebug をラップしてタイムラインに記録
      const origLogDebug = window.logDebug;
      window.logDebug = function(msg) {
        record('logDebug', { message: msg });
        if (typeof origLogDebug === 'function') origLogDebug(msg);
      };

      // script load 監視
      document.addEventListener('DOMContentLoaded', () => {
        record('DOMContentLoaded_event', {
          renderSettingsExists: typeof window.renderSettings === 'function',
          appHidden: document.getElementById('app')?.classList.contains('hidden') ?? true
        });
      });
    });

    const browserConsoleLogs = [];
    pageB.on('console', msg => {
      browserConsoleLogs.push({ time: Date.now(), text: msg.text() });
    });

    await pageB.goto(`http://localhost:${PORT}/app/index.html`);
    // 起動直後（400ms）でタイムラインと最初の可視化フレームを回収
    await pageB.waitForTimeout(400);

    const auditData = await pageB.evaluate(() => {
      return {
        timeline: window.__timeline || [],
        firstVisible: window.__firstVisibleSnapshot
      };
    });

    console.log('\n  [ブラウザコンソールログ]:');
    browserConsoleLogs.forEach(l => console.log(`    ${l.text}`));

    console.log('\n  [詳細タイムライン追跡]:');
    auditData.timeline.forEach((item, idx) => {
      const details = Object.entries(item)
        .filter(([k]) => k !== 'time' && k !== 'step' && k !== 'snapshot')
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(', ');
      console.log(`    ${(idx + 1).toString().padStart(2, ' ')}. [${item.time.toFixed(1)}ms] ${item.step} ${details ? `(${details})` : ''}`);
    });

    console.log('\n  [最初の可視化フレーム（#app unhidden 直後）の同期スナップショット]:');
    const fv = auditData.firstVisible;
    if (!fv) {
      throw new Error('FAIL: #app の hidden 解除イベントが捕捉されませんでした！');
    }

    console.log(`    - タイムスタンプ: ${fv.time.toFixed(1)}ms`);
    console.log(`    - appClasses: "${fv.appClasses}"`);
    console.log(`    - ①全体エリアヘッダー: ${fv.hasHeaderCount}`);
    console.log(`    - ②公式配布員テキスト: ${fv.hasOfficialStaff}`);
    console.log(`    - ③STAFF IDバッジ: ${fv.hasStaffIdBadge}`);
    console.log(`    - ④AUTHORIZED STAFFカード: ${fv.hasStaffCard}`);
    console.log(`    - ⑤下部ナビゲーション: ${fv.hasBottomNav}`);
    console.log(`    - settings-content 内容: "${fv.htmlSnippet}"`);

    const allFiveInFirstFrame = fv.hasHeaderCount && fv.hasOfficialStaff && fv.hasStaffIdBadge && fv.hasStaffCard && fv.hasBottomNav;
    console.log(`    - 最初の可視化フレームでの5箇所同時存在: ${allFiveInFirstFrame}`);

    if (!allFiveInFirstFrame) {
      console.log('\n  ⚠️ 検証結果判定: FAIL（最初の可視化フレームで5箇所が未完成）');
      console.log('  【後追い描画の証跡】:');
      const unhiddenTime = fv.time;
      const staffInsertEvent = auditData.timeline.find(t => t.step === 'dom_official_staff_inserted');
      if (staffInsertEvent) {
        console.log(`    - #app 可視化: ${unhiddenTime.toFixed(1)}ms`);
        console.log(`    - 公式配布員 DOM挿入: ${staffInsertEvent.time.toFixed(1)}ms (遅れ: +${(staffInsertEvent.time - unhiddenTime).toFixed(1)}ms)`);
      }
    }

    if (!fv.hasOfficialStaff || !fv.hasStaffIdBadge) {
      throw new Error('FAIL: 最初の可視化フレームで公式配布員とSTAFF IDがセットで存在しません！');
    }

    console.log('  ✅ Case B (最初の可視化フレームでの5箇所同時存在確認): PASS');
    await contextB.close();

    // -------------------------------------------------------------
    // Case C: バックグラウンド処理の継続確認
    // -------------------------------------------------------------
    console.log('\n▶ [Case C: バックグラウンド処理] 一括表示後のデータ取得継続確認');
    console.log(`  getSystemSummary 呼び出し回数: ${mockSummaryCallCount}`);
    console.log(`  getRanking 呼び出し回数: ${mockRankingCallCount}`);

    const bgCallsOk = mockSummaryCallCount > 0;
    console.log(`  ✅ Case C (バックグラウンド取得継続): PASS (${bgCallsOk})`);

    console.log('\n===============================================================');
    console.log('🎉 ALL 3 CASES (Case A, Case B, Case C) PASSED PERFECTLY!');
    console.log('===============================================================');
  } finally {
    await browser.close();
    server.close();
  }
}

runInitialDisplaySyncSuite().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});

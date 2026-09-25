import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ============================================================================
// 掲示板ライフサイクル & 3大要件 検証テストスイート
// ============================================================================
async function runBulletinLifecycleTests() {
  console.log("===============================================================");
  console.log("🧪 BULLETIN LIFECYCLE & 3-DIRECTIVES VERIFICATION SUITE");
  console.log("===============================================================\n");

  const results = {};

  // Mock DOM 環境の構築
  class MockClassList {
    constructor() { this.classes = new Set(); }
    add(c) { this.classes.add(c); }
    remove(c) { this.classes.delete(c); }
    contains(c) { return this.classes.has(c); }
  }

  class MockElement {
    constructor(id) {
      this.id = id;
      this.innerHTML = '';
      this.classList = new MockClassList();
      this.style = {};
    }
  }

  const elements = {
    'bulletin-list-container': new MockElement('bulletin-list-container'),
    'page-bulletin': new MockElement('page-bulletin'),
    'page-areas': new MockElement('page-areas')
  };

  // 初期状態: page-bulletin はアクティブ
  elements['page-bulletin'].classList.remove('hidden');

  let renderedPosts = null;
  let apiCallCount = 0;
  let apiCallResolvers = [];

  const mockGlobal = {
    document: {
      getElementById: (id) => elements[id] || null
    },
    renderBulletinList: (posts) => {
      renderedPosts = posts;
      elements['bulletin-list-container'].innerHTML = `<div class="rendered">${posts.length} posts</div>`;
    },
    callApiPost: (action) => {
      if (action === 'getBulletinPosts') {
        apiCallCount++;
        return new Promise((resolve, reject) => {
          apiCallResolvers.push({ resolve, reject });
        });
      }
      return Promise.resolve({ success: true });
    },
    console: {
      log: () => {},
      warn: () => {},
      error: () => {}
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    Promise: Promise
  };

  // app.js から bulletin 関連コードを抽出してロード
  const appCode = fs.readFileSync(path.join(ROOT, 'active/dashboard/app.js'), 'utf-8');
  
  // fetchBulletinPosts のコードブロックを vm で実行
  const bulletinCodeMatch = appCode.match(/\/\/ 掲示板データ取得ライフサイクル管理ステート[\s\S]*?window\.submitBulletinPost/);
  if (!bulletinCodeMatch) {
    throw new Error("Could not extract bulletin lifecycle code from app.js");
  }

  const scriptCode = `
    let window = {};
    ${bulletinCodeMatch[0].replace('window.submitBulletinPost', '')}
    this.window = window;
    this.getInternalState = () => ({
      _cachedBulletinPosts,
      _bulletinFetched,
      _activeBulletinPromise,
      _bulletinReqSeq,
      _bulletinNeedsRefresh
    });
    this.forceResetInFlight = () => {
      _activeBulletinPromise = null;
    };
    this.resetState = () => {
      _cachedBulletinPosts = null;
      _bulletinFetched = false;
      _activeBulletinPromise = null;
      _bulletinReqSeq = 0;
      _bulletinNeedsRefresh = false;
    };
  `;

  vm.runInNewContext(scriptCode, mockGlobal);
  const { window: mockWindow, getInternalState, resetState, forceResetInFlight } = mockGlobal;

  // --------------------------------------------------------------------------
  // TEST 1: 初回ローディング → データ取得 → 描画
  // --------------------------------------------------------------------------
  console.log("▶ [TEST 1] 初回ローディング & 正常描画 実行中...");
  resetState();
  apiCallCount = 0;
  apiCallResolvers = [];

  const p1 = mockWindow.fetchBulletinPosts();
  const state1 = getInternalState();

  // 初回はLoadingが表示されること
  const hasLoadingInitial = elements['bulletin-list-container'].innerHTML.includes('Loading Bulletin...');
  const isApiCalledOnce = apiCallCount === 1;

  // API解決
  apiCallResolvers[0].resolve({
    success: true,
    posts: [{ staffId: 'U1', message: 'Hello' }, { staffId: 'U2', message: 'World' }]
  });
  await p1;
  await new Promise(r => setImmediate(r));

  const hasRenderedList = elements['bulletin-list-container'].innerHTML.includes('2 posts');
  const test1_pass = hasLoadingInitial && isApiCalledOnce && hasRenderedList;
  console.log(`  Initial Fetch: PASS=${test1_pass} (Loading=${hasLoadingInitial}, ApiCalls=${apiCallCount}, Rendered=${hasRenderedList})`);

  // --------------------------------------------------------------------------
  // TEST 2: 2回目以降 (Stale-While-Revalidate) Loadingが出ず即座にキャッシュ描画
  // --------------------------------------------------------------------------
  console.log("\n▶ [TEST 2] 2回目画面復帰 (Stale-While-Revalidate) 実行中...");
  // コンテナを一旦クリアしても、fetchBulletinPostsを呼んだ瞬間に同期的にキャッシュが描画されること
  elements['bulletin-list-container'].innerHTML = '<div>empty</div>';
  
  const p2 = mockWindow.fetchBulletinPosts();
  // Promise の await 前に、同期的に即座にキャッシュが描画されているか！
  const immediateRendered = elements['bulletin-list-container'].innerHTML.includes('2 posts');
  const noLoadingOnSecond = !elements['bulletin-list-container'].innerHTML.includes('Loading Bulletin...');

  // バックグラウンドAPI解決
  apiCallResolvers[1].resolve({
    success: true,
    posts: [{ staffId: 'U1', message: 'Hello updated' }]
  });
  await p2;

  const updatedRendered = elements['bulletin-list-container'].innerHTML.includes('1 posts');
  const test2_pass = immediateRendered && noLoadingOnSecond && updatedRendered;
  console.log(`  Cache Instant Restore: PASS=${test2_pass} (InstantRender=${immediateRendered}, NoLoading=${noLoadingOnSecond}, Updated=${updatedRendered})`);

  // --------------------------------------------------------------------------
  // TEST 3: 要件① UIタイムアウト(15s)とin-flight通信プロミスの完全分離
  // --------------------------------------------------------------------------
  console.log("\n▶ [TEST 3] 要件① 15秒UIタイムアウト分離 & in-flight維持 実行中...");
  resetState();
  apiCallCount = 0;
  apiCallResolvers = [];

  // フェイクタイマーで15秒進めるシミュレーション
  let timeoutFired = false;
  const originalSetTimeout = mockGlobal.setTimeout;

  // 15秒タイムアウトを即座に発火させるカスタムフック
  let registeredTimeoutFn = null;
  mockGlobal.setTimeout = (fn, ms) => {
    if (ms === 15000) {
      registeredTimeoutFn = fn;
      return 999;
    }
    return originalSetTimeout(fn, ms);
  };

  const p3 = mockWindow.fetchBulletinPosts();
  // 15秒タイマーを発火（UIタイムアウト発生）
  registeredTimeoutFn();
  await new Promise(r => setImmediate(r));

  const stateAfterTimeout = getInternalState();
  // 重要確認：UIタイムアウトが発生しても、_activeBulletinPromise は null になっていないこと！
  const inFlightMaintained = stateAfterTimeout._activeBulletinPromise !== null;
  const uiShowsTimeout = elements['bulletin-list-container'].innerHTML.includes('通信がタイムアウトしました');

  // このタイムアウト状態で再度 fetchBulletinPosts() を呼んでも、新たなAPI通信を発射しないこと！
  const callCountBeforeSecondCall = apiCallCount;
  mockWindow.fetchBulletinPosts();
  const noSecondApiCall = (apiCallCount === callCountBeforeSecondCall);

  // 遅れてバックグラウンド通信が成功した場合、正常にキャッシュが更新されUIも回復すること！
  apiCallResolvers[0].resolve({
    success: true,
    posts: [{ staffId: 'U3', message: 'Recovered after timeout' }]
  });
  await p3;
  await new Promise(r => setImmediate(r));

  const stateAfterSettle = getInternalState();
  const inFlightClearedAfterSettle = stateAfterSettle._activeBulletinPromise === null;
  const uiRecovered = elements['bulletin-list-container'].innerHTML.includes('1 posts');

  mockGlobal.setTimeout = originalSetTimeout;

  const test3_pass = inFlightMaintained && uiShowsTimeout && noSecondApiCall && inFlightClearedAfterSettle && uiRecovered;
  console.log(`  UI Timeout Separation: PASS=${test3_pass}`);
  console.log(`    - InFlight Maintained After Timeout: ${inFlightMaintained}`);
  console.log(`    - UI Shows Timeout: ${uiShowsTimeout}`);
  console.log(`    - No Concurrent New GET: ${noSecondApiCall}`);
  console.log(`    - UI Auto-Recovered on Delayed Settle: ${uiRecovered}`);

  // --------------------------------------------------------------------------
  // TEST 4: 要件② force:true 時の同時GET完全抑止 & 遅延再取得
  // --------------------------------------------------------------------------
  console.log("\n▶ [TEST 4] 要件② force:true 時の同時GET抑止 & 遅延再取得 実行中...");
  resetState();
  apiCallCount = 0;
  apiCallResolvers = [];

  const p4_1 = mockWindow.fetchBulletinPosts();
  const apiCountInitial = apiCallCount; // 1

  // 1本目が通信中の状態で force: true を実行
  const p4_2 = mockWindow.fetchBulletinPosts({ force: true });
  const apiCountDuringInFlight = apiCallCount; // 依然として 1 でなければならない！
  const stateDuringInFlight = getInternalState();
  const refreshScheduled = stateDuringInFlight._bulletinNeedsRefresh === true;

  // 1本目の通信が完了
  apiCallResolvers[0].resolve({
    success: true,
    posts: [{ staffId: 'U1', message: 'First' }]
  });
  await p4_1;
  await new Promise(r => setImmediate(r));

  // 1本目完了直後に、遅延予約されていた2本目（最新再取得）が自動発射されたか！
  const apiCountAfterFirstSettle = apiCallCount; // 2
  const isSecondCallTriggered = apiCountAfterFirstSettle === 2;

  // 2本目の通信を解決
  apiCallResolvers[1].resolve({
    success: true,
    posts: [{ staffId: 'U1', message: 'First' }, { staffId: 'U2', message: 'Second Forced' }]
  });
  await new Promise(r => setTimeout(r, 50));

  const test4_pass = (apiCountInitial === 1) && (apiCountDuringInFlight === 1) && refreshScheduled && isSecondCallTriggered;
  console.log(`  Force No-Concurrent-GET: PASS=${test4_pass}`);
  console.log(`    - Concurrent GET Suppressed: ${apiCountDuringInFlight === 1}`);
  console.log(`    - Refresh Scheduled: ${refreshScheduled}`);
  console.log(`    - Triggered Sequentially: ${isSecondCallTriggered}`);

  // --------------------------------------------------------------------------
  // TEST 5: 要件③ 世代番号逆順完了保護 (A開始 → B開始 → B完了 → A遅延完了)
  // --------------------------------------------------------------------------
  console.log("\n▶ [TEST 5] 要件③ 世代番号逆順完了保護 実行中...");
  resetState();
  apiCallCount = 0;
  apiCallResolvers = [];

  // A GET開始
  const pA = mockWindow.fetchBulletinPosts();
  const seqA = getInternalState()._bulletinReqSeq;

  // in-flight を模擬的にリセットして B GET開始（ユーザーの急速操作）
  forceResetInFlight();
  const pB = mockWindow.fetchBulletinPosts();
  const seqB = getInternalState()._bulletinReqSeq;

  // B が先に完了（最新の投稿2件）
  apiCallResolvers[1].resolve({
    success: true,
    posts: [{ staffId: 'B1', message: 'Latest B' }, { staffId: 'B2', message: 'Latest B2' }]
  });
  await pB;
  await new Promise(r => setImmediate(r));

  const contentAfterB = elements['bulletin-list-container'].innerHTML;

  // 遅れて A が完了（古い投稿1件）
  apiCallResolvers[0].resolve({
    success: true,
    posts: [{ staffId: 'A1', message: 'Old Stale A' }]
  });
  await pA;
  await new Promise(r => setImmediate(r));

  const contentAfterA = elements['bulletin-list-container'].innerHTML;

  // Aの古い結果がBの最新結果を上書きしていないこと！
  const test5_pass = (contentAfterA === contentAfterB) && contentAfterA.includes('2 posts');
  console.log(`  Out-Of-Order Settle Protection: PASS=${test5_pass} (Latest B Preserved: ${contentAfterA.includes('2 posts')})`);

  // --------------------------------------------------------------------------
  // TEST 6: 要件③ 非アクティブ画面へのDOM非干渉
  // --------------------------------------------------------------------------
  console.log("\n▶ [TEST 6] 要件③ 非アクティブ画面へのDOM非干渉 実行中...");
  resetState();
  apiCallCount = 0;
  apiCallResolvers = [];

  // 掲示板でGET開始
  elements['page-bulletin'].classList.remove('hidden');
  const p6 = mockWindow.fetchBulletinPosts();

  // 通信中にユーザーが「エリア」画面へ移動（page-bulletin を hidden に）
  elements['page-bulletin'].classList.add('hidden');
  elements['bulletin-list-container'].innerHTML = '<div class="untouched">Original</div>';

  // 通信完了
  apiCallResolvers[0].resolve({
    success: true,
    posts: [{ staffId: 'U99', message: 'Arrived while off-screen' }]
  });
  await p6;
  await new Promise(r => setImmediate(r));

  // DOMが非アクティブ中に勝手に書き換えられていないこと！
  const domNotTouchedWhileHidden = elements['bulletin-list-container'].innerHTML.includes('untouched');
  // ただしキャッシュデータは最新化されていること！
  const cacheUpdatedOffScreen = getInternalState()._cachedBulletinPosts.length === 1;

  const test6_pass = domNotTouchedWhileHidden && cacheUpdatedOffScreen;
  console.log(`  Off-Screen Protection: PASS=${test6_pass} (DOM Untouched=${domNotTouchedWhileHidden}, Cache Updated=${cacheUpdatedOffScreen})`);

  // --------------------------------------------------------------------------
  // 総括
  // --------------------------------------------------------------------------
  const allPassed = test1_pass && test2_pass && test3_pass && test4_pass && test5_pass && test6_pass;

  console.log("\n===============================================================");
  console.log(`📊 LIFECYCLE AUDIT VERDICT: ${allPassed ? "🎉 ALL 6 LIFECYCLE GATES PASSED" : "❌ AUDIT FAILED"}`);
  console.log("===============================================================");

  return allPassed;
}

runBulletinLifecycleTests().then(passed => {
  if (!passed) process.exit(1);
});

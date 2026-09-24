const $ = id => document.getElementById(id);

// SEC-004: XSS対策用エスケープ関数
window.escapeHtml = function(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// 暗号学的UUID v4 + 実機フォールバック対応のRequestId生成関数 (冪等性キー)
window.generateRequestId = function(prefix = 'req') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return `${prefix}_${crypto.randomUUID()}`;
    } catch (e) {}
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${prefix}_${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    } catch (e) {}
  }
  const p = (typeof performance !== 'undefined' && typeof performance.now === 'function') ? Math.floor(performance.now() * 1000) : 0;
  return `${prefix}_${Date.now()}_${p}_${Math.random().toString(36).substring(2, 11)}`;
};

// デバッグログ出力関数 (本番用: コンソールのみ出力)
window.logDebug = function(msg) {
  console.log("[DEBUG]", msg);
};
window.onerror = function(message, source, lineno, colno, error) {
  if (message === "Script error.") return false;
  logDebug(`ERROR: ${message} at ${source}:${lineno}:${colno}`);
  return false;
};
window.onunhandledrejection = function(event) {
  logDebug(`UNHANDLED PROMISE: ${event.reason}`);
};

let allPoints = [], rankingData = [];
let _rankingFetched = false;  // ランキング遅延取得済みフラグ
let _stockFetched = false;    // 在庫一覧取得済みフラグ
let _stockData = [];          // 在庫一覧キャッシュデータ
let currentCity = null;
window.activeRankingPromise = null;
window.globalPinStatus = { inProgress: [], completed: [] };
window.lastPinStatusSync = 0;

// ─── グローバル・ローディング二重制御ヘルパー ─────────────────────
let _loadingCount = 0;

function showLoading(label = 'CONNECTING...') {
  _loadingCount++;
  const loadingEl = $('loading');
  if (loadingEl) {
    const statusEl = $('loading-status');
    if (statusEl) statusEl.textContent = label;
    loadingEl.classList.remove('hidden');
    loadingEl.classList.remove('opacity-0');
  }
}

function hideLoading() {
  _loadingCount = Math.max(0, _loadingCount - 1);
  if (_loadingCount === 0) {
    const loadingEl = $('loading');
    if (loadingEl) {
      loadingEl.classList.add('opacity-0');
      setTimeout(() => {
        if (_loadingCount === 0) {
          loadingEl.classList.add('hidden');
        }
      }, 300);
    }
  }
}

function setLoadingProgress(pct, label) {
  const bar = document.getElementById('loading-bar');
  const txt = document.getElementById('loading-status');
  if (bar) bar.style.width = pct + '%';
  if (txt) {
    txt.style.opacity = '0';
    setTimeout(() => { txt.textContent = label; txt.style.opacity = '1'; }, 180);
  }
}

// プレミアム・インタラクション・スキル (JS Touch Handler)
document.addEventListener('touchstart', e => {
  const el = e.target.closest('.btn-neu, .clickable-card, .nav-btn');
  if (!el) return;
  if (el.classList.contains('btn-neu')) el.classList.add('pressed-primary');
  if (el.classList.contains('clickable-card')) el.classList.add('pressed-secondary');
  if (el.classList.contains('nav-btn')) el.classList.add('pressed-nav');
}, {passive: true});

document.addEventListener('touchend', removePressed);
document.addEventListener('touchcancel', removePressed);
function removePressed() {
  document.querySelectorAll('.pressed-primary, .pressed-secondary, .pressed-nav').forEach(el => {
    el.classList.remove('pressed-primary', 'pressed-secondary', 'pressed-nav');
  });
}

// =====================================
// Phase 4-B: Global Pin Status Sync
// =====================================
window.fetchGlobalPinStatus = async function() {
  const now = Date.now();
  if (now - window.lastPinStatusSync < 10000) {
    // スロットリング：10秒以内の連続フェッチをスキップ
    return;
  }
  window.lastPinStatusSync = now;
  try {
    const res = await callApiPost('getGlobalPinStatus');
    if (res && res.success) {
      window.globalPinStatus.inProgress = res.inProgress || [];
      window.globalPinStatus.completed = res.completed || [];
      // 必要に応じて画面再描画
      if (typeof window.refreshMainMapPins === 'function') {
        window.refreshMainMapPins();
      }
    }
  } catch (err) {
    logDebug(`[fetchGlobalPinStatus] Error: ${err.message}`);
  }
};

// --- Identity Safety Gate (Verified後のみ業務Write許可) ---
let _identityVerified = false;
let _identitySyncPromise = null;

function waitForIdentityVerified() {
  if (_identityVerified) return Promise.resolve(true);
  if (_identitySyncPromise) return _identitySyncPromise;
  return Promise.reject(new Error("IDENTITY_NOT_INITIALIZED"));
}
window.waitForIdentityVerified = waitForIdentityVerified;

let pinActionPromiseChain = Promise.resolve();

window.setPinInProgress = function(rowId, action) {
  const numericRowId = parseInt(rowId, 10);
  if (!isNaN(numericRowId) && window.globalPinStatus && Array.isArray(window.globalPinStatus.inProgress)) {
    if (action === "remove") {
      window.globalPinStatus.inProgress = window.globalPinStatus.inProgress.filter(id => id !== numericRowId);
    } else if (action === "add") {
      if (!window.globalPinStatus.inProgress.includes(numericRowId)) {
        window.globalPinStatus.inProgress.push(numericRowId);
      }
    }
  }

  // Promise Chain によるFIFO直列通信制御
  pinActionPromiseChain = pinActionPromiseChain.then(async () => {
    try {
      await waitForIdentityVerified();
      await callApiPost('setPinInProgress', { rowId: rowId, pinAction: action });
    } catch (err) {
      logDebug(`[setPinInProgress] Error/Blocked: ${err.message}`);
    }
  });

  return pinActionPromiseChain;
};

let appStartupTriggered = false;
let mainAppVisible = false;

function showMainApp() {
  if (mainAppVisible || window.__contractExpired) return;

  const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  if (!userInfo.id) return;

  mainAppVisible = true;

  // 初期画面（page-settings）のDOMを同期的に完全確定させる
  if (typeof renderSettings === 'function') {
    renderSettings();
  }
  updateBottomNavVisibility();

  const navContainer = document.getElementById('bottom-nav');
  const renderNavFn = window.renderBottomNavigation || (typeof renderBottomNavigation === 'function' ? renderBottomNavigation : null);
  if (navContainer && renderNavFn) {
    navContainer.innerHTML = renderNavFn('settings');
  }

  // 初期ページを同期的に settings に即時確定（200msアニメーション遅延による未描画フレームを排除）
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => {
    if (p.id === 'page-settings') {
      p.classList.remove('hidden');
      p.style.opacity = '1';
      p.style.transform = 'translateY(0)';
    } else {
      p.classList.add('hidden');
      p.style.opacity = '0';
    }
  });

  $('app').classList.remove('hidden');
  $('app').classList.remove('opacity-0');

  const loadingEl = $('loading');
  if (loadingEl) {
    loadingEl.classList.add('opacity-0');
    setTimeout(() => loadingEl.classList.add('hidden'), 400);
  }
}

function loadGoogleMapsApi() {
  if (window.googleMapsApiLoaded) return;
  window.googleMapsApiLoaded = true;

  callApiPost('getMapsApiKey').then(keyData => {
    if (keyData && keyData.success && keyData.mapsApiKey) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${keyData.mapsApiKey}&callback=initMainMap&language=ja`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else {
      window.googleMapsApiLoaded = false;
    }
  }).catch(err => {
    window.googleMapsApiLoaded = false;
    logDebug("[loadGoogleMapsApi] Error: " + (err ? err.message : err));
  });
}

async function startApp() {
  if (appStartupTriggered) return;
  appStartupTriggered = true;

  try {
    loadGoogleMapsApi();

    fetchSystemSummary();

    // 起動時の未送信キュー復旧・送信処理（クラッシュ・オフライン復旧）
    if (typeof processQueue === 'function') {
      processQueue();
    }

    loadData(false).catch(err => {
      console.warn("Background load error:", err);
      logDebug("[loadData] Background error: " + (err ? err.message : err));
    });

    showMainApp();
  } catch (err) {
    console.error("Startup error:", err);
    logDebug("Startup error: " + err.message);
  }
}

function setSyncStatus(state) {
  const statusEl = $('sync-status');
  const textEl = $('sync-text');
  if (!statusEl) return;
  statusEl.className = 'w-2 h-2 rounded-full transition-all duration-300';

  if (textEl) {
    textEl.className = 'text-[8px] font-black uppercase tracking-[0.2em] transition-all duration-300';
  }

  if (state === 'online') {
    statusEl.classList.add('bg-[#22c55e]', 'shadow-[0_0_8px_#22c55e]', 'animate-soft-pulse');
    if (textEl) {
      textEl.textContent = 'ONLINE';
      textEl.classList.add('text-[#22c55e]');
    }
  } else if (state === 'offline') {
    statusEl.classList.add('bg-[#f59e0b]', 'shadow-[0_0_8px_#f59e0b]');
    if (textEl) {
      textEl.textContent = 'OFFLINE';
      textEl.classList.add('text-[#f59e0b]');
    }
  } else if (state === 'syncing') {
    statusEl.classList.add('bg-[#2563eb]', 'shadow-[0_0_8px_#2563eb]', 'animate-pulse');
    if (textEl) {
      textEl.textContent = 'SYNCING';
      textEl.classList.add('text-[#2563eb]', 'animate-pulse');
    }
  }
}

let isRegistering = false;
let registrationError = false;
function triggerBackgroundRegistration(profile) {
  window.liffProfile = profile;
  if (isRegistering) return Promise.resolve();
  isRegistering = true;
  window.isRegistering = true;
  registrationError = false;
  window.registrationError = false;

  const idEl = $('storage-register-staff-id');
  if (idEl) {
    idEl.textContent = 'ID: 登録中...';
    idEl.style.color = 'inherit';
    idEl.style.cursor = 'default';
    idEl.onclick = null;
  }

  logDebug("API START (初回登録・非同期)");
  return callApiPost('registerStaff', {
    lastName: profile.displayName,
    firstName: "(LINE)",
    lineUserId: profile.userId
  }).then(res => {
    isRegistering = false;
    window.isRegistering = false;
    logDebug("API OK (初回登録完了)");
    if (res && res.success) {
      const registeredInfo = {
        last: profile.displayName,
        first: "",
        id: res.id,
        lineUserId: profile.userId,
        picture: profile.pictureUrl
      };
      localStorage.setItem('user_info', JSON.stringify(registeredInfo));
      logDebug("Registered! Staff ID: " + res.id);

      const updatedIdEl = $('storage-register-staff-id');
      if (updatedIdEl) {
        updatedIdEl.textContent = 'ID: ' + (res.id || '---');
        updatedIdEl.style.color = 'inherit';
        updatedIdEl.style.cursor = 'default';
        updatedIdEl.onclick = null;
      }

      if (typeof renderSettings === 'function') {
        renderSettings();
      }
      updateBottomNavVisibility();
      showMainApp();
    } else {
      throw new Error("GAS registration returned success=false");
    }
  }).catch(err => {
    isRegistering = false;
    window.isRegistering = false;
    registrationError = true;
    window.registrationError = true;
    logDebug("Background registration failed: " + err.message);

    const updatedIdEl = $('storage-register-staff-id');
    if (updatedIdEl) {
      updatedIdEl.textContent = 'ID: 登録失敗 (タップして再試行)';
      updatedIdEl.style.color = '#ef4444';
      updatedIdEl.style.cursor = 'pointer';
      updatedIdEl.onclick = () => {
        triggerBackgroundRegistration(profile);
      };
    }

    // エラー時は未完成画面を表示させず、ローディング画面でエラーと再試行を提示
    const loadingStatusEl = $('loading-status');
    if (loadingStatusEl) {
      loadingStatusEl.textContent = '登録エラー (タップして再試行): ' + (err.message || '通信失敗');
      loadingStatusEl.style.color = '#ef4444';
      loadingStatusEl.style.cursor = 'pointer';
      loadingStatusEl.onclick = () => {
        loadingStatusEl.textContent = '再試行中...';
        loadingStatusEl.style.color = 'inherit';
        loadingStatusEl.onclick = null;
        triggerBackgroundRegistration(profile);
      };
    }
  });
}

// 登録再試行用のグローバルハンドラーを公開
window.retryRegistration = () => {
  if (window.liffProfile) {
    triggerBackgroundRegistration(window.liffProfile);
  }
};

async function loadData(skipSync = false) {
  logDebug("[loadData] START (Background)");

  const tier1Promise = fetchTier1();

  try {
    if (!skipSync) {
      setSyncStatus(navigator.onLine ? 'online' : 'offline');
    }

    logDebug("[loadData] Awaiting fetchSystemSummary in background...");
    const data = await fetchSystemSummary();
    logDebug("[loadData] fetchSystemSummary resolved.");

    if (data && data.success) {
      logDebug("[loadData] System Summary received: total=" + data.total + ", done=" + data.done + ", percent=" + data.percent);
      updateStats(data);
      prefetchRanking();
    } else {
      throw new Error(data ? data.message : "データが空です");
    }
  } catch (err) {
    console.error("Background Load Error:", err);
    logDebug(`[loadData] Background ERROR: ${err.message}`);
    // バックグラウンドロードの失敗は画面をブロッキングしてフリーズさせず、ログ出力のみに留めます。
  }

  await tier1Promise;

  // 待機中キューのピン状態復元（強制終了・クラッシュ復旧）
  if (typeof window.getSyncQueueRowIds === 'function') {
    try {
      const queueRowIds = await window.getSyncQueueRowIds();
      if (queueRowIds && queueRowIds.length > 0 && Array.isArray(allPoints)) {
        queueRowIds.forEach(rowId => {
          const pt = allPoints.find(p => Number(p.rowId) === Number(rowId));
          if (pt && !pt.isDone) {
            pt.syncStatus = 'pending';
          }
        });
      }
    } catch (qErr) {
      console.warn("[loadData] Failed to restore pending queue pins:", qErr);
    }
  }
}

// ランキングデータのバックグラウンド先読み関数
function prefetchRanking() {
  window.activeRankingPromise = callApiPost('getRanking')
    .then(data => {
      if (data && data.success) {
        rankingData = data.ranking || [];
        window._myRankingSummary = data.mySummary || null;
        _rankingFetched = true;
        logDebug("[prefetchRanking] Ranking pre-fetched in background.");
        // 現在ランキングページを表示中であれば再描画
        const activePage = document.querySelector('.page:not(.hidden)');
        if (activePage && activePage.id === 'page-ranking' && typeof renderRanking === 'function') {
          renderRanking();
        }
      }
      return data;
    })
    .catch(err => {
      logDebug("[prefetchRanking] Failed to pre-fetch ranking: " + err.message);
      return null;
    });
}

let numpadContext = null;

function openNumpad(areaName, rowId, initialCount, isDoneToggle = false, checkbox = null) {
  numpadContext = {
    areaName,
    rowId,
    isDoneToggle,
    checkbox,
    currentVal: initialCount ? String(initialCount) : '0'
  };

  $('numpad-display').textContent = numpadContext.currentVal;

  const modal = $('numpad-modal');
  modal.classList.remove('pointer-events-none', 'opacity-0');
  const content = modal.firstElementChild;
  content.classList.remove('translate-y-full');
}

function closeNumpad() {
  if (!numpadContext) return;

  if (numpadContext.isDoneToggle && numpadContext.checkbox) {
    numpadContext.checkbox.checked = false;
  }

  const modal = $('numpad-modal');
  modal.classList.add('opacity-0', 'pointer-events-none');
  const content = modal.firstElementChild;
  content.classList.add('translate-y-full');

  numpadContext = null;
}


window.triggerUISyncRefresh = async function() {
  if (!allPoints || allPoints.length === 0) return; // let変数は window に付かないため直接参照
  if (typeof getQueue !== 'function') return;

  const currentAreaName = window.currentCityDetailAreaName;
  if (!currentAreaName) return;

  try {
    const queue = await getQueue();
    allPoints.forEach(p => {
      // submitting（提出処理中）の場合はキュー状態での上書きを防止
      if (p.syncStatus === 'submitting') return;

      const found = queue.find(q => q.rowId === p.rowId && q.areaName === currentAreaName);
      if (found) {
        p.syncStatus = found.syncStatus || found.status; // 'pending' | 'sending' | 'failed'
      } else {
        // キューに存在しない場合
        // もし以前送信待機中（pending/SYNCING/RETRY等）だったアイテムがキューから消滅した場合、
        // Backend永続化が成功して dequeueSync されたことを意味するため、COMPLETED (isDone=true) に昇格
        if (p.syncStatus && p.syncStatus !== 'synced') {
          p.isDone = true;
          delete p.isReadyToSubmit;
          p.syncStatus = 'synced';
          if (typeof window.setPinInProgress === 'function') {
            window.setPinInProgress(p.rowId, "remove");
          }
          if (window.globalPinStatus) {
            if (!window.globalPinStatus.completed.includes(p.rowId)) {
              window.globalPinStatus.completed.push(p.rowId);
            }
            window.globalPinStatus.inProgress = window.globalPinStatus.inProgress.filter(id => id !== p.rowId);
          }
          if (typeof window.lockActivePinAndBubble === 'function') {
            window.lockActivePinAndBubble(p.rowId);
          }
        } else if (!p.isDone) {
          delete p.syncStatus;
        }
      }
    });

    // 開いている詳細モーダルの再描画
    if (window.currentPointDetailRowId) {
      const p = allPoints.find(point => point.rowId === window.currentPointDetailRowId);
      const modalContent = $('detail-modal-content');
      if (p && p.syncStatus !== 'submitting' && modalContent && typeof renderDetailModalContent === 'function') {
        modalContent.innerHTML = renderDetailModalContent(p);
      }
    }
  } catch (err) {
    console.error("triggerUISyncRefresh error:", err);
  }
};


function pressNum(key) {
  if (!numpadContext) return;

  if (key === 'C') {
    numpadContext.currentVal = '0';
  } else if (key === 'OK') {
    const valNum = parseFloat(numpadContext.currentVal) || 0;
    const { areaName, rowId } = numpadContext;

    const p = allPoints.find(point => point.rowId === rowId);
    const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
    const staffName = `${userInfo.last || ''} ${userInfo.first || ''}`.trim();
    const staffId = userInfo.id || '';
    const now = new Date();
    const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    numpadContext.isDoneToggle = false;

    // GPS・カメラを先に開始（ユーザーのタップジェスチャーが生きている間に呼ぶ）
    const gpsPromise = getGPSLocation();
    // capturePhoto()内のinput.click()はここで同期的に実行される
    // → テンキーを閉じる前にカメラが起動するため、裏画面が一瞬見える現象を防ぐ
    const cameraPromise = capturePhoto();

    closeNumpad(); // カメラ起動後にテンキーを閉じる

    // 2. バックグラウンドで写真取得完了とGPS結果を待つ
    (async () => {
      let imageBlob = null;
      try {
        imageBlob = await cameraPromise;
      } catch (err) {
        console.error("Camera activation failed:", err);
      }

      // カメラがキャンセルされた場合は処理を中断
      if (!imageBlob || typeof window.blobToBase64 !== 'function') {
        console.warn("Photo capture cancelled or failed. Mission completion aborted.");
        return;
      }

      let photoBase64 = '';
      try {
        photoBase64 = await window.blobToBase64(imageBlob);
      } catch (err) {
        console.warn("Photo Base64 conversion threw an error.", err);
      }

      if (!photoBase64) {
        console.warn("Photo Base64 conversion returned empty data. Mission completion aborted.");
        return;
      }

      // 3. 写真確定後に状態を更新し、即座にMISSION COMPLETED画面を生成（GPSは待たない）
      if (p) {
        // Phase 9: 写真・GPS取得完了は DRAFT (READY_TO_SUBMIT) であり、Backend永続化成功前の COMPLETED 確定ではない
        p.isDone = false;
        p.isReadyToSubmit = true;
        p.count = valNum;
        p.staffName = staffName;
        p.staffId = staffId; // Payload用に保持
        p.completedAt = timeStr;
        p.syncStatus = 'pending';
        p.gpsStatus = 'pending';
        p.photoStatus = 'OK';

        p.tempPhotoUrl = URL.createObjectURL(imageBlob);
        p.photoBase64 = photoBase64;

        // モーダルを再描画（提出前プレビュー画面として表示するため isDone: true のプロパティを渡す）
        const modalContent = $('detail-modal-content');
        if (modalContent) {
          modalContent.innerHTML = renderDetailModalContent({ ...p, isDone: true });
        }
      }

      // 4. バックグラウンドでGPS結果を待機
      let gps = await gpsPromise;
      if (!gps.latitude || !gps.longitude) {
        console.log("GPS empty after camera, retrying...");
        gps = await getGPSLocation();
      }

      // GPS判定
      const latNum = Number(gps?.latitude);
      const lngNum = Number(gps?.longitude);
      const hasValidGps =
        Number.isFinite(latNum) &&
        Number.isFinite(lngNum) &&
        latNum !== 0 &&
        lngNum !== 0 &&
        latNum >= -90 && latNum <= 90 &&
        lngNum >= -180 && lngNum <= 180;

      if (p) {
        if (!hasValidGps) {
          console.warn("GPS acquisition failed or out of range.");
          p.gpsStatus = 'NO';
        } else {
          p.gpsStatus = 'OK';
          p.gps = `${gps.latitude},${gps.longitude}`;
          p.latitude = gps.latitude;
          p.longitude = gps.longitude;
          p.accuracy = gps.accuracy || null;
        }

        // GPS状態が確定したのでモーダルのみ再描画（提出処理中はUIを上書きしない）
        const modalContent = $('detail-modal-content');
        if (modalContent && p.syncStatus !== 'submitting') {
          modalContent.innerHTML = renderDetailModalContent(p.isDone ? p : { ...p, isDone: true });
        }
      }
    })().catch(err => {
      console.error("Async sync background task failed:", err);
    });

    return;
  } else {
    if (numpadContext.currentVal === '0') {
      numpadContext.currentVal = String(key);
    } else {
      if (numpadContext.currentVal.length < 5) {
        numpadContext.currentVal += String(key);
      }
    }
  }

  $('numpad-display').textContent = numpadContext.currentVal;
}

// モーダルの「この内容で提出する」ボタン押下時に呼ばれる
async function submitMissionComplete(areaName, rowId) {
  const p = (typeof allPoints !== 'undefined' && Array.isArray(allPoints) && allPoints.find(point => point.rowId === rowId)) ||
            (typeof window.allPoints !== 'undefined' && Array.isArray(window.allPoints) && window.allPoints.find(point => point.rowId === rowId));
  if (!p) return;

  if (p.syncStatus === 'submitting') return;
  p.syncStatus = 'submitting';

  if (p.photoStatus !== 'OK' || !p.photoBase64) {
    p.syncStatus = 'pending';
    return;
  }

  const submitBtn = $('submit-mission-btn');
  const cancelBtn = $('cancel-mission-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ 提出中...';
  }
  if (cancelBtn) {
    cancelBtn.disabled = true;
  }

  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  try {
    while (p.gpsStatus === 'pending') {
      await new Promise(r => setTimeout(r, 200));
    }

    // Safety Gate: Identity Verified を確認
    try {
      await waitForIdentityVerified();
    } catch (authErr) {
      alert("スタッフ認証が完了していないため、配布完了を送信できません。再起動してください。");
      p.syncStatus = 'failed';
      p.isDone = false; // Phase 9: 認証失敗時は配布完了としない
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '🚀 この内容で提出する';
      }
      if (cancelBtn) cancelBtn.disabled = false;
      return;
    }

    // 最新の認証済み user_info を再取得して staffId / staffName を確定
    const verifiedUserInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
    const finalStaffId = verifiedUserInfo.id || p.staffId || '';
    const finalStaffName = `${verifiedUserInfo.last || ''} ${verifiedUserInfo.first || ''}`.trim() || p.staffName || '';

    // クライアント不変操作識別子 (requestId) を発番
    const requestId = (typeof window.generateRequestId === 'function')
      ? window.generateRequestId('req')
      : ('req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));

    if (typeof enqueueSync === 'function') {
      // 1. IndexedDB 送信キューに永続化
      await enqueueSync({
        requestId,
        areaName,
        rowId: Number(rowId),
        isDone:     true,
        count:      p.count || 0,
        latitude:   p.gpsStatus === 'OK' ? (p.latitude || '') : '',
        longitude:  p.gpsStatus === 'OK' ? (p.longitude || '') : '',
        accuracy:   p.gpsStatus === 'OK' ? (p.accuracy || null) : null,
        gpsTimestamp: p.gpsStatus === 'OK' ? (p.gpsTimestamp || '') : '',
        gpsStatusReason: p.gpsStatus || 'NO',
        branchCode: localStorage.getItem('branch_name') || '',
        areaId:     String(rowId),
        photoBase64: p.photoBase64 || '',
        staffName:  finalStaffName,
        staffId:    finalStaffId
      });

      // 2. オフライン判定：オフライン時は即時モーダルを閉じて画面を解放（UIフリーズを完全阻止）
      if (!navigator.onLine) {
        p.syncStatus = 'pending';
        p.isDone = false;
        alert("電波が圏外のため、端末内に安全に保存しました。\n電波が回復次第、自動で送信されます。");
        if (typeof closeDetailModal === 'function') {
          closeDetailModal();
        }
        return;
      }

      // 3. オンライン時：最大3秒間の待機（while(true)無限待機を撤廃しタイムアウト上限を設定）
      const maxWaitMs = 3000;
      const startTime = Date.now();
      let isPersisted = false;

      while (Date.now() - startTime < maxWaitMs) {
        if (typeof window.getRowStatus !== 'function') {
          throw new Error("Sync check mechanism is missing.");
        }
        const status = await window.getRowStatus(Number(rowId));

        if (status === null) {
          // キューから消滅 ＝ GAS保存成功（データ送信成功＝真の配布完了確定）
          p.isDone = true;
          delete p.isReadyToSubmit;
          p.syncStatus = 'synced';
          if (typeof window.setPinInProgress === 'function') {
            window.setPinInProgress(rowId, "remove");
          }
          if (window.globalPinStatus) {
            if (!window.globalPinStatus.completed.includes(rowId)) {
              window.globalPinStatus.completed.push(rowId);
            }
            window.globalPinStatus.inProgress = window.globalPinStatus.inProgress.filter(id => id !== rowId);
          }
          if (typeof window.lockActivePinAndBubble === 'function') {
            window.lockActivePinAndBubble(rowId);
          }
          isPersisted = true;
          break;
        }
        if (status === 'RETRY') {
          throw new Error("GAS Save Failed");
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // 4. 完了または待機完了後の画面解放
      if (isPersisted) {
        alert("✓ 提出致しました");
      } else {
        // 3秒経過後もバックグラウンドで継続中：通常操作へ復帰
        p.syncStatus = 'pending';
        p.isDone = false;
        alert("送信処理中です。バックグラウンドで送信を継続します。");
      }

      if (typeof closeDetailModal === 'function') {
        closeDetailModal();
      }
    }
  } catch (err) {
    console.error("Submission failed:", err);
    alert("提出に失敗しました: " + (err.message || "エラー"));
    p.syncStatus = 'pending';
    // Phase 9: Backend永続化が成功していないため、配布完了を確定させない (COMPLETED = false)
    p.isDone = false;
  } finally {
    const submitBtn = $('submit-mission-btn');
    const cancelBtn = $('cancel-mission-btn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 この内容で提出する';
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
    }
  }
}

window.addEventListener('online', () => {
  setSyncStatus('online');
});

window.addEventListener('offline', () => {
  console.log("Device went offline.");
  setSyncStatus('offline');
});

window.onPageEnter = function(id) {
  if (id === 'settings') renderSettings();
  if (id === 'ranking') initRankingPage();
  if (id === 'storage-register') initStorageRegisterPage();
  if (id === 'storage-list') initStorageListPage();
  if (id === 'bulletin' && typeof fetchBulletinPosts === 'function') fetchBulletinPosts();

  // エリア（MAP）画面表示時: display:none解除に伴うリサイズ同期
  if (id === 'areas' && window.mainMapInstance && window.google && window.google.maps) {
    let center = window.currentMapState?.center;
    if (!center && Array.isArray(window.masterPins) && window.masterPins.length > 0) {
      const p = window.masterPins.find(pin => pin && typeof pin.latitude === 'number' && typeof pin.longitude === 'number');
      if (p) center = { lat: p.latitude, lng: p.longitude };
    }
    if (center) {
      window.mainMapInstance.setCenter(center);
    }
    google.maps.event.trigger(window.mainMapInstance, 'resize');
    if (center) {
      window.mainMapInstance.setCenter(center);
    }
  }
};

function initRankingPage() {
  const container = $('ranking-list');
  if (!_rankingFetched) {
    if (container) {
      container.innerHTML = `
        <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
          <div class="w-8 h-8 rounded-full border-2 border-[#2563eb]/40 border-t-[#2563eb] animate-spin"></div>
          <p class="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Loading Leaderboard...</p>
        </div>`;
    }
    const p = window.activeRankingPromise || callApiPost('getRanking');
    p.then(data => {
      if (data && data.success) {
        rankingData = data.ranking || [];
        window._myRankingSummary = data.mySummary || null;
        _rankingFetched = true;
      }
      if (typeof renderRanking === 'function') renderRanking();
    }).catch(() => {
      if (typeof renderRanking === 'function') renderRanking();
    });
  } else {
    if (typeof renderRanking === 'function') renderRanking();
  }
}

function updateStorageCountDisplay() {
  const countInput = $('storage-register-count');
  const countText = $('storage-register-count-text');
  const countUnit = $('storage-register-count-unit');

  if (!countInput || !countText) return;

  const raw = countInput.value.replace(/,/g, '').replace(/枚/g, '').trim();
  if (raw !== '' && !isNaN(parseInt(raw, 10))) {
    countText.textContent = Number(raw).toLocaleString();
    if (countUnit) countUnit.style.display = 'inline';
  } else {
    countText.textContent = '';
    if (countUnit) countUnit.style.display = 'none';
  }
}

window.updateStorageRegisterButtonText = function updateStorageRegisterButtonText() {
  const btn = $('btn-storage-register-submit');
  const countInput = $('storage-register-count');
  if (!btn || !countInput) return;

  const raw = countInput.value.replace(/,/g, '').replace(/枚/g, '').trim();
  btn.textContent = raw ? 'チラシ枚数を更新する' : 'チラシ枚数を入力する';
};

function setupStorageRegisterInputFormatter(inputEl) {
  if (!inputEl || inputEl.dataset.formatted) return;
  inputEl.dataset.formatted = 'true';

  const container = $('storage-register-count-container');
  const display = $('storage-register-count-display');

  if (container && display) {
    container.addEventListener('click', function() {
      inputEl.classList.remove('hidden');
      display.classList.add('hidden');
      inputEl.dataset.userEditing = 'true';

      const raw = inputEl.value.replace(/,/g, '').replace(/枚/g, '').trim();
      inputEl.value = raw;
      inputEl.focus();

      if (typeof inputEl.setSelectionRange === 'function') {
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      }
    });
  }

  inputEl.addEventListener('focus', function() {
    if (display) display.classList.add('hidden');
    inputEl.classList.remove('hidden');
    inputEl.dataset.userEditing = 'true';
    const rawVal = this.value.replace(/,/g, '').replace(/枚/g, '').replace(/[^\d]/g, '');
    this.value = rawVal;
  });

  inputEl.addEventListener('blur', function() {
    inputEl.classList.add('hidden');
    if (display) display.classList.remove('hidden');

    const rawVal = this.value.replace(/,/g, '').replace(/枚/g, '').replace(/[^\d]/g, '');
    if (!rawVal) {
      this.value = '';
    } else {
      const num = parseInt(rawVal, 10);
      this.value = isNaN(num) ? '' : String(num);
    }

    updateStorageCountDisplay();
    updateStorageRegisterButtonText();
  });

  inputEl.addEventListener('input', function() {
    inputEl.dataset.userEditing = 'true';
    const rawVal = this.value.replace(/,/g, '').replace(/枚/g, '').replace(/[^\d]/g, '');
    this.value = rawVal;
    updateStorageRegisterButtonText();
  });
}

function updateStorageLocationDisplayText() {
  const locSelect = $('storage-register-location');
  const locText = $('storage-location-text');
  if (!locSelect || !locText) return;

  if (locSelect.value) {
    locText.textContent = locSelect.value;
  } else {
    locText.textContent = '保管場所を選択';
  }
}

let _storageLocationsCache = null;
let _storageLocationsFetching = null;

async function getStorageLocations() {
  if (_storageLocationsCache) return _storageLocationsCache;
  if (_storageLocationsFetching) return _storageLocationsFetching;

  _storageLocationsFetching = (async () => {
    try {
      const res = await fetch('../../data/storage_locations.json');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          _storageLocationsCache = data;
          return _storageLocationsCache;
        }
      }
    } catch (e) {
      console.warn('[Storage] Fallback to tier1Cache:', e);
    } finally {
      _storageLocationsFetching = null;
    }
    return null;
  })();

  return _storageLocationsFetching;
}

window.updateStorageLocationDropdown = function updateStorageLocationDropdown(overrideCities = null) {
  const locSelect = $('storage-register-location');
  if (!locSelect) return;

  if (!locSelect.dataset.listenerBound) {
    locSelect.dataset.listenerBound = 'true';
    locSelect.addEventListener('change', function() {
      updateStorageLocationDisplayText();
    });
  }

  const prevValue = locSelect.value;

  const customCities = (Array.isArray(_storageLocationsCache) && _storageLocationsCache.length > 0)
    ? _storageLocationsCache
    : (Array.isArray(overrideCities) && overrideCities.length > 0 ? overrideCities : null);

  const targetCities = customCities || (Array.isArray(tier1Cache) && tier1Cache.length > 0 ? tier1Cache : null);

  locSelect.innerHTML = '';
  const cityList = [];

  if (Array.isArray(targetCities) && targetCities.length > 0) {
    targetCities.forEach(c => {
      const name = typeof c === 'string' ? c : (c.name || '');
      if (name && !cityList.includes(name)) {
        cityList.push(name);
      }
    });
  }

  if (cityList.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'データ読み込み中...';
    locSelect.appendChild(opt);
    updateStorageLocationDisplayText();
    return;
  }

  cityList.forEach(city => {
    const opt = document.createElement('option');
    opt.value = city;
    opt.textContent = city;
    locSelect.appendChild(opt);
  });

  if (prevValue && cityList.includes(prevValue)) {
    locSelect.value = prevValue;
  }

  updateStorageLocationDisplayText();
};

// 在庫データの In-flight リクエスト管理 & 世代管理
let _activeFlyerStockPromise = null;
let _flyerStockReqSeq = 0;

async function fetchFlyerStock() {
  // 1. 進行中 Promise がある場合は重複発射せず既存Promiseを共有
  if (_activeFlyerStockPromise) {
    return _activeFlyerStockPromise;
  }

  const currentSeq = ++_flyerStockReqSeq;

  _activeFlyerStockPromise = (async () => {
    try {
      const data = await callApiPost('getFlyerStock');
      // 世代チェック: 新しいリクエストが後に発行されていたら古い結果は破棄
      if (currentSeq !== _flyerStockReqSeq) {
        return null;
      }
      if (data && data.success) {
        if (Array.isArray(data.stocks)) {
          _stockData = data.stocks;
          _stockFetched = true;
        }
        if (data.myStock) {
          window._myStockData = data.myStock;
        }
      }
      return data;
    } catch (err) {
      console.warn('[fetchFlyerStock] Error:', err);
      throw err;
    } finally {
      _activeFlyerStockPromise = null;
    }
  })();

  return _activeFlyerStockPromise;
}

// 在庫登録フォームへのデータ反映（Backend判定済みの myStock / isMe を最優先）
function applyMyStockToForm(options = {}) {
  const { isAsyncResponse = false } = options;
  const countInput = $('storage-register-count');
  const locSelect = $('storage-register-location');
  if (!countInput) return;

  // Backend側が判定した myStock または isMe フラグを優先（staffIdによる照合は行わない）
  let myStock = window._myStockData || null;
  if (!myStock && Array.isArray(_stockData) && _stockData.length > 0) {
    myStock = _stockData.find(s => s.isMe === true) || null;
  }
  if (!myStock) return;

  // 【ユーザー入力保護（枚数）】
  // 非同期APIレスポンスの反映時、以下のいずれかならユーザー入力を保護し上書きしない:
  // ① document.activeElement === countInput (フォーカス中)
  // ② !countInput.classList.contains('hidden') (編集モード中)
  // ③ countInput.dataset.userEditing === 'true' (ユーザーが編集操作を行った)
  const isInputActive = document.activeElement === countInput ||
                        !countInput.classList.contains('hidden') ||
                        countInput.dataset.userEditing === 'true';

  if (!isAsyncResponse || !isInputActive) {
    const rawCount = parseInt(myStock.count, 10);
    countInput.value = isNaN(rawCount) ? '' : String(rawCount);
    // 同期初期反映時は userEditing フラグをクリア
    if (!isAsyncResponse) {
      delete countInput.dataset.userEditing;
    }
    updateStorageCountDisplay();
    updateStorageRegisterButtonText();
  }

  // 【ユーザー選択保護（保管場所）】
  // 非同期APIレスポンスの反映時、ユーザーが選択・操作中なら上書きしない:
  // ① document.activeElement === locSelect (フォーカス中)
  // ② locSelect.dataset.userSelected === 'true' (ユーザーが手動変更した)
  const isLocActive = document.activeElement === locSelect || (locSelect && locSelect.dataset.userSelected === 'true');
  if (locSelect && myStock.location && (!isAsyncResponse || !isLocActive)) {
    locSelect.value = myStock.location;
    updateStorageLocationDisplayText();
  }
}

function initStorageRegisterPage() {
  const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  const staffId = userInfo.id || '';
  const staffName = `${userInfo.last || ''} ${userInfo.first || ''}`.trim();
  const idEl = $('storage-register-staff-id');
  const nameEl = $('storage-register-staff-name');

  if (idEl) {
    if (staffId) {
      idEl.textContent = 'ID: ' + staffId;
      idEl.style.color = 'inherit';
      idEl.style.cursor = 'default';
      idEl.onclick = null;
    } else if (isRegistering) {
      idEl.textContent = 'ID: 登録中...';
      idEl.style.color = 'inherit';
      idEl.style.cursor = 'default';
      idEl.onclick = null;
    } else if (registrationError) {
      idEl.textContent = 'ID: 登録失敗 (タップして再試行)';
      idEl.style.color = '#ef4444';
      idEl.style.cursor = 'pointer';
      idEl.onclick = async () => {
        try {
          idEl.textContent = 'ID: 再登録中...';
          idEl.style.color = 'inherit';
          const profile = await liff.getProfile();
          triggerBackgroundRegistration(profile);
        } catch(e) {
          idEl.textContent = 'ID: 登録失敗 (タップして再試行)';
          idEl.style.color = '#ef4444';
        }
      };
    } else {
      idEl.textContent = 'ID: ---';
      idEl.style.color = 'inherit';
      idEl.style.cursor = 'default';
      idEl.onclick = null;
    }
  }
  if (nameEl) nameEl.textContent = staffName || '---';

  const countInput = $('storage-register-count');
  setupStorageRegisterInputFormatter(countInput);

  const locSelect = $('storage-register-location');
  if (locSelect && !locSelect.dataset.changeBound) {
    locSelect.dataset.changeBound = 'true';
    locSelect.addEventListener('change', function() {
      this.dataset.userSelected = 'true';
      updateStorageLocationDisplayText();
    });
  }

  updateStorageLocationDropdown();
  if (!_storageLocationsCache) {
    getStorageLocations().then(cities => {
      if (cities && Array.isArray(cities) && cities.length > 0) {
        updateStorageLocationDropdown(cities);
        updateStorageLocationDisplayText();
      }
    });
  }

  // 1. 【要件1】既存の _stockData が存在する場合、開いた瞬間にキャッシュから即座に同期反映！
  // API通信完了を待たず、画面遷移の体感遅延をゼロにする
  if (_stockFetched && Array.isArray(_stockData) && _stockData.length > 0) {
    applyMyStockToForm({ isAsyncResponse: false });
  }

  // 2. 【要件2・3・4】API取得（初回必須、またはバックグラウンド更新）
  // In-flight共有付きで実行し、画面表示はブロックしない
  if (staffId && countInput) {
    fetchFlyerStock().then(data => {
      if (data && data.success && Array.isArray(data.stocks)) {
        // 【要件5】非同期レスポンス到着時の反映。ユーザー入力操作中は絶対に上書きしない！
        applyMyStockToForm({ isAsyncResponse: true });
      }
    }).catch(err => {
      console.warn('[initStorageRegisterPage] fetchFlyerStock failed:', err);
      updateStorageCountDisplay();
      updateStorageRegisterButtonText();
    });
  }

  updateStorageCountDisplay();
  updateStorageRegisterButtonText();
}

function initStorageListPage() {
  const listContainer = $('storage-list-container');

  if (!_stockFetched) {
    if (listContainer) {
      listContainer.innerHTML = `
        <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
          <div class="w-8 h-8 rounded-full border-2 border-[#2563eb]/40 border-t-[#2563eb] animate-spin"></div>
          <p class="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Loading Inventory...</p>
        </div>`;
    }
    callApiPost('getFlyerStock').then(data => {
      if (data && data.success) {
        _stockData = data.stocks || [];
        _stockFetched = true;
        if (typeof renderStorageList === 'function') renderStorageList(_stockData);
      } else {
        if (listContainer) {
          listContainer.innerHTML = `
            <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
              <span class="text-2xl">⚠️</span>
              <p class="text-sm font-black text-white/60">データ取得に失敗しました</p>
            </div>`;
        }
      }
    }).catch(err => {
      if (listContainer) {
        listContainer.innerHTML = `
          <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
            <span class="text-2xl">⚠️</span>
            <p class="text-sm font-black text-white/60">エラーが発生しました</p>
          </div>`;
      }
    });
  } else {
    if (typeof renderStorageList === 'function') renderStorageList(_stockData);
  }
}


// 在庫登録フォームの処理
window.submitFlyerStock = async function() {
  const locSelect = $('storage-register-location');
  const countInput = $('storage-register-count');
  const btn = $('btn-storage-register-submit');

  if (!locSelect || !countInput || !btn) return;

  const location = locSelect.value;
  const count = parseInt(String(countInput.value).replace(/,/g, '').replace(/枚/g, ''), 10);

  if (!location) {
    alert("保管場所を選択してください。");
    return;
  }
  if (isNaN(count) || count < 0) {
    alert("正しい枚数を入力してください。");
    return;
  }

  const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  const staffId = userInfo.id || '';
  const staffName = `${userInfo.last || ''} ${userInfo.first || ''}`.trim();

  if (!staffId || !staffName) {
    alert("ID情報がありません。ID登録を行ってください。");
    return;
  }

  btn.disabled = true;
  btn.textContent = "更新中...";

  try {
    await waitForIdentityVerified();
  } catch (authErr) {
    alert("本人確認が完了していないか、未登録のため更新できません。");
    btn.disabled = false;
    btn.textContent = "チラシ枚数を更新";
    return;
  }

  try {
    const res = await callApiPost('updateFlyerStock', {
      location: location,
      count: count,
      staffName: staffName,
      staffId: staffId
    });

    if (res && res.success) {
      alert("✓ チラシ枚数を更新しました");
      window._myStockData = { location: location, count: count, updatedAt: "たった今" };
      // 成功した登録結果を _stockData に即時反映し、キャッシュ有効状態を維持する！
      if (!Array.isArray(_stockData)) _stockData = [];
      const idx = _stockData.findIndex(s => s.isMe === true);
      if (idx >= 0) {
        _stockData[idx] = { ..._stockData[idx], location: location, count: count, staffName: staffName, isMe: true };
      } else {
        _stockData.unshift({ staffId: staffId, staffName: staffName, location: location, count: count, isMe: true });
      }
      _stockFetched = true;

      // 入力完了のため編集フラグをクリア
      if (countInput) delete countInput.dataset.userEditing;
      if (locSelect) delete locSelect.dataset.userSelected;

      // 世代インクリメント: 登録前から走っている古い getFlyerStock のレスポンスを破棄し、上書きを完全防止
      _flyerStockReqSeq++;
    } else {
      alert("更新に失敗しました: " + (res.message || "エラー"));
    }
  } catch (e) {
    alert("エラーが発生しました: " + e.message);
  } finally {
    const btn = $('btn-storage-register-submit');
    if (btn) {
      btn.disabled = false;
      if (typeof updateStorageRegisterButtonText === 'function') {
        updateStorageRegisterButtonText();
      } else {
        btn.textContent = "チラシ枚数を更新する";
      }
    }
  }
};



let lastSummaryData = null;

/**
 * updateStats(summaryData) - 表示専用関数 (SystemSummaryService / AddressMasterService 参照)
 */
function updateStats(summaryData = null) {
  const countEl = $('header-count');
  const pctEl = $('header-pct');

  if (summaryData) {
    lastSummaryData = summaryData;
  } else {
    summaryData = lastSummaryData;
  }

  if (!summaryData) {
    if (countEl) countEl.textContent = '0/ 0';
    if (pctEl) pctEl.textContent = '0%';
    return;
  }

  // data/address_master.csv の件数を総エリア数 (total) のSSOTとして使用
  let total = 0;
  if (typeof AddressMasterService !== 'undefined' && AddressMasterService.getInstance) {
    const masterCache = AddressMasterService.getInstance().cache;
    if (masterCache && Array.isArray(masterCache) && masterCache.length > 0) {
      total = masterCache.length;
    }
  }

  const done = typeof summaryData.done === 'number' ? summaryData.done : 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  if (summaryData.districtName) {
    window.__districtName = summaryData.districtName;
    document.title = "POSTING MAP";
  }

  if (countEl) countEl.textContent = `${done}/ ${total}`;
  if (pctEl) pctEl.textContent = `${percent}%`;

  // AddressMasterServiceが未ロードの場合は非同期取得後に自動再反映
  if (total === 0 && typeof AddressMasterService !== 'undefined' && AddressMasterService.getInstance) {
    AddressMasterService.getInstance().getAll().then(master => {
      if (master && master.length > 0 && lastSummaryData) {
        updateStats(lastSummaryData);
      }
    }).catch(() => {});
  }
}

let _systemSummaryPromise = null;

async function fetchSystemSummary(forceRefresh = false) {
  if (_systemSummaryPromise && !forceRefresh) {
    return _systemSummaryPromise;
  }

  _systemSummaryPromise = (async () => {
    try {
      const res = await callApiPost('getSystemSummary');
      if (res && (res.code === 'CONTRACT_EXPIRED' || res.contractStatus === 'EXPIRED' || res.isExpired === true)) {
        window.__contractExpired = true;
        if (typeof setSyncStatus === 'function') setSyncStatus('offline');
        const statusEl = $('loading-status');
        if (statusEl) statusEl.textContent = '接続エラー: 接続できません。';
        const appEl = $('app');
        if (appEl) { appEl.classList.add('hidden'); appEl.classList.add('opacity-0'); }
        const loadingEl = $('loading');
        if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.classList.remove('opacity-0'); }
        return res;
      }
      if (res && res.success) {
        updateStats(res);
        return res;
      }
    } catch (err) {
      console.warn("fetchSystemSummary failed:", err);
    }
    return null;
  })();

  return _systemSummaryPromise;
}

/**
 * fetchTier1() - Tier 1 市町村サマリー取得
 */
let tier1Cache = null;

async function fetchTier1() {
  try {
    const cities = await AddressMasterService.getInstance().getCities();

    if (cities && cities.length > 0) {
      tier1Cache = cities;


      if (typeof updateStorageLocationDropdown === 'function') {
        updateStorageLocationDropdown(tier1Cache);
      }

      if (typeof renderAreas === 'function') {
        renderAreas();
      }

      if (lastSummaryData) {
        updateStats(lastSummaryData);
      }

      return tier1Cache;
    }
  } catch (err) {
    console.warn("fetchTier1 failed:", err);
  }

  return null;
}


async function safeInitApp() {
  // LIFF SDK が内部でトークン交換用に生成する非表示 iframe 内での二重実行（アクセストークン失効）を完全に防止するガード
  if (window !== window.top) {
    console.log("[DEBUG] Running inside iframe, skipping safeInitApp.");
    return;
  }

  logDebug("safeInitApp invoked.");
  console.log("POSTING MAP PRO safeInitApp started.");

  // URLに死んだパラメータが残っている、かつ初期化前（または失敗時）の保険
  const urlParams = new URLSearchParams(window.location.search);
  const hasOAuthParams = urlParams.has('code') || urlParams.has('liff.state');
  const isReturningFromLogin = sessionStorage.getItem('liff_initializing') === 'true';

  // liff.login()で戻ってきた場合（?code= あり & フラグあり）→ LIFFに正常処理させる
  // 孤立した ?code=（フラグなし）→ クリーンURLでやり直し（スタック防止）
  if (hasOAuthParams && !isReturningFromLogin) {
      sessionStorage.setItem('liff_initializing', 'true');
      window.location.href = window.location.origin + window.location.pathname;
      return;
  }
  // ※ フラグはここでは削除しない。ログイン確認成功後（isLoggedIn()=true）に削除する。

  // クライアント設定(PMS_CLIENT_CONFIG)からLIFF IDを取得、なければホスト名からフォールバック
  const liffId = (window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.line && window.PMS_CLIENT_CONFIG.line.liffId);
  if (!liffId) {
    throw new Error("LIFF ID missing in client configuration.");
  }

  startApp();

  if (typeof liff !== 'undefined') {
    try {
      logDebug("LIFF INIT START");
      await new Promise(r => setTimeout(r, 50));

      const liffInitPromise = liff.init({ liffId: liffId });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("LINEログインの応答がタイムアウトしました(5秒)")), 5000)
      );

      await Promise.race([liffInitPromise, timeoutPromise]);
      logDebug("LIFF INIT OK");
      setLoadingProgress(35, 'AUTHENTICATED');

      logDebug("LOGIN CHECK");
      if (liff.isLoggedIn()) {
        logDebug("LOGIN OK");
        sessionStorage.removeItem('liff_initializing');

        try {
          logDebug("PROFILE START");
          const profile = await liff.getProfile();
          logDebug("PROFILE OK");

          try {
            const cleanUrl = window.location.origin + window.location.pathname + window.location.search.replace(/[\?&](code|liff\.state)=[^&]*/g, '');
            window.history.replaceState({}, document.title, cleanUrl);
            logDebug("OAuth query parameters cleaned from address bar via history.replaceState (Safe Delay)");
          } catch (e) {
            console.warn("Failed to clean OAuth query parameters:", e);
          }

          const existingUserInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
          const hasExistingStaffId = existingUserInfo.id && String(existingUserInfo.id).trim() !== '';

          // 【Optimistic First Paint】既存 user_info.id がある場合は Identity API を待たずに即時先行表示！
          if (hasExistingStaffId) {
            logDebug("Optimistic First Paint: existing staffId found. Launching main app immediately.");
            if (typeof renderSettings === 'function') {
              renderSettings();
            }
            updateBottomNavVisibility();
            showMainApp();
          } else {
            // 初回・未登録端末: 従来どおり Identity 検証または登録完了までローディングを維持
            setLoadingProgress(50, 'VERIFYING IDENTITY...');
          }

          // 【Backend Identity 非同期同期】getStaffIdentity をバックグラウンド Promise で実行
          _identitySyncPromise = callApiPost('getStaffIdentity', {})
            .then(identityRes => {
              if (identityRes && identityRes.success && identityRes.registered) {
                // ① 登録済み: Backend の検証済み Identity を正として localStorage へ同期
                logDebug("STAFF IDENTITY VERIFIED (BG): " + identityRes.staffId);
                const verifiedUserInfo = {
                  last: identityRes.staffName || profile.displayName || '',
                  first: '',
                  id: identityRes.staffId,
                  lineUserId: profile.userId,
                  picture: profile.pictureUrl || ''
                };
                localStorage.setItem('user_info', JSON.stringify(verifiedUserInfo));
                _identityVerified = true;

                if (typeof renderSettings === 'function') {
                  renderSettings();
                }
                updateBottomNavVisibility();

                // 初回起動ユーザーの場合はここで画面を表示
                if (!hasExistingStaffId) {
                  setLoadingProgress(100, 'READY');
                  showMainApp();
                }
                return true;
              } else {
                // ② 未登録または不一致: キャッシュを無効化し、初回登録フローへ
                logDebug("STAFF NOT REGISTERED OR IDENTITY MISMATCH. PROCEEDING TO REGISTRATION...");
                _identityVerified = false;

                const initialUserInfo = {
                  last: profile.displayName || '',
                  first: '',
                  id: '',
                  lineUserId: profile.userId,
                  picture: profile.pictureUrl || ''
                };
                localStorage.setItem('user_info', JSON.stringify(initialUserInfo));

                // 既存表示していた場合でも未登録なら画面を戻して登録完了までロック
                $('app').classList.add('hidden');
                $('app').classList.add('opacity-0');
                const loadingEl = $('loading');
                if (loadingEl) { loadingEl.classList.remove('hidden'); loadingEl.classList.remove('opacity-0'); }
                setLoadingProgress(60, 'REGISTERING...');

                return triggerBackgroundRegistration(profile).then(() => {
                  setLoadingProgress(100, 'READY');
                  _identityVerified = true;
                  showMainApp();
                  return true;
                }).catch(rErr => {
                  _identityVerified = false;
                  throw rErr;
                });
              }
            })
            .catch(err => {
              console.warn("Identity verification failed:", err);
              logDebug("Identity verification failed: " + err.message);
              _identityVerified = false;
              throw err;
            });

          // 初回起動時のみ、非同期 Promise の完了を待ってから抜ける
          if (!hasExistingStaffId) {
            try {
              await _identitySyncPromise;
            } catch (waitErr) {
              console.warn("First-time identity wait encountered error:", waitErr);
            }
          }
        } catch (err) {
          console.error("LIFF PROFILE / AUTH ERROR", err);
          logDebug("LIFF PROFILE / AUTH ERROR: " + err.message);

          if (err.message && err.message.toUpperCase().includes("REVOKED")) {
            logDebug("Access token revoked detected. Forcing re-login...");
            liff.logout();
            liff.login({ redirectUri: window.location.href });
            return;
          }

          $('loading-status').textContent = "起動エラー: " + err.message;
        }
      } else {
        // LINEログイン処理中（OAuthコールバックのパラメータがある）なら、手動ログイン画面を出さずに少し待機して再チェックする
        const urlParams = new URLSearchParams(window.location.search);
        const isProcessing = urlParams.has('code') || urlParams.has('liff.state');
        if (isProcessing) {
          logDebug("LINE login is processing in background. Retrying login check in 1.5s...");
          setTimeout(() => {
            if (liff.isLoggedIn()) {
              logDebug("Retried Login: OK");
              safeInitApp(); // 再起動してメインフローへ入る
            } else {
              logDebug("Retried Login: FAIL. Redirecting to LINE Login automatically...");
              sessionStorage.setItem('liff_initializing', 'true');
              liff.login();
            }
          }, 1500);
          return;
        }

        logDebug("Not logged in. Redirecting to LINE Login automatically...");
        sessionStorage.setItem('liff_initializing', 'true');
        liff.login();
      }
    } catch (err) {
      console.error("LIFF Init Error:", err);
      logDebug("LIFF Error: " + err.message);
      $('loading-status').textContent = "起動エラー: " + err.message;
    }
  } else {
    logDebug("Running in standalone web browser. Blocked.");
    $('loading-status').textContent = "エラー: LINEアプリ内から起動してください。";
  }
}

if (document.readyState === 'complete') {
  safeInitApp();
} else {
  window.addEventListener('DOMContentLoaded', safeInitApp);
}

// 規約・ライセンスデータ
const ID_INFO_DATA = {
  terms: {
    title: 'Terms of Service',
    body: `
      <div class="space-y-4 text-[11px] leading-relaxed text-white/50 select-none">
        <p>POSTING MAP は、<br>認証された配布員・管理者向けの<br><span class="text-white font-bold">FIELD OPERATIONS SYSTEM</span> です。</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">本システムは：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・配布進捗</div>
            <div>・エリア管理</div>
            <div>・GPSログ</div>
            <div>・活動データ</div>
            <div>・ランキング</div>
          </div>
          <p class="text-white/40">をリアルタイム管理します。</p>
        </div>

        <div class="space-y-1">
          <p class="text-white/70 font-black">本システムの：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・無断複製</div>
            <div>・再配布</div>
            <div>・不正利用</div>
            <div>・地域外利用</div>
          </div>
          <p class="text-white/40">を禁止します。</p>
        </div>

        <p class="text-white/40 pt-2 border-t border-white/5">各地域ライセンスは、<br>契約支部・契約組織にのみ付与されます。</p>
      </div>
    `
  },
  privacy: {
    title: 'Privacy Policy',
    body: `
      <div class="space-y-4 text-[11px] leading-relaxed text-white/50 select-none">
        <p>POSTING MAP は、<br>FIELD OPERATIONS SYSTEM として、<br>以下の情報を取得・管理します。</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">【取得・管理する情報】</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・LINE認証情報</div>
            <div>・配布員ID</div>
            <div>・エリア進捗</div>
            <div>・配布ログ</div>
            <div>・GPS位置情報</div>
            <div>・写真エビデンス</div>
            <div>・デバイス情報</div>
          </div>
        </div>

        <div class="space-y-1">
          <p class="text-white/70 font-black">【取得データの利用目的】</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・配布進捗管理</div>
            <div>・エリア統制</div>
            <div>・FIELD OPERATIONS分析</div>
            <div>・不正防止</div>
            <div>・リアルタイム同期</div>
          </div>
        </div>

        <p class="text-white/40 pt-2 border-t border-white/5">GPSおよび写真情報は、<br>FIELD OPERATIONS の活動証跡として利用されます。</p>
      </div>
    `
  },
  license: {
    title: 'License',
    body: `
      <div class="space-y-4 text-[11px] leading-relaxed text-white/50 select-none">
        <p class="text-white font-bold">FIELD OPERATIONS LICENSE</p>

        <p class="text-white/60 font-black">LICENSED ORGANIZATION<br>【__BRANCH_NAME__】</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">AUTHORIZED SYSTEMS：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・STAFF APP</div>
            <div>・ADMIN CONTROL</div>
            <div>・HQ MONITORING</div>
            <div>・REALTIME FIELD SYNC</div>
          </div>
        </div>

        <p class="text-white/60 font-black">LICENSE STATUS:<br><span class="text-emerald-500/80 font-black">ACTIVE</span></p>

        <p class="text-white/40">本ライセンスは、契約地域内のみ有効です。<br>地域外利用・再配布は禁止します。</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">POSTING MAP は：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・LINE認証</div>
            <div>・STAFF ID</div>
            <div>・ライセンス管理</div>
            <div>・権限制御</div>
          </div>
          <p class="text-white/40">により、FIELD OPERATIONS を保護します。</p>
        </div>

        <p class="text-white/40 pt-2 border-t border-white/5">LICENSED FIELD OPERATIONS SYSTEM<br>© POSTING MAP</p>
      </div>
    `
  }
};

// ID情報モーダルの制御
function openIdInfoModal(type, event) {
  if (event) event.stopPropagation(); // イベントのバブリング防止

  const modal = $('id-info-modal');
  if (!modal) return;

  const data = ID_INFO_DATA[type];
  if (!data) return;

  const titleEl = $('id-info-title');
  const bodyEl = $('id-info-body');

  if (titleEl) titleEl.textContent = data.title;
  if (bodyEl) {
    let bodyText = data.body;

    // ライセンス表示時のみ、地区名を動的に差し替える（Google Sheetsファイル名SSOTから動的解決）
    if (type === 'license') {
      const displayBranch = window.__districtName || localStorage.getItem('branch_name') || '';
      bodyText = bodyText.replace('__BRANCH_NAME__', escapeHtml(displayBranch));
    }

    bodyEl.innerHTML = bodyText;
  }

  modal.classList.remove('pointer-events-none', 'opacity-0');
  modal.firstElementChild.classList.remove('translate-y-full');
}

function closeIdInfoModal() {
  const modal = $('id-info-modal');
  if (!modal) return;
  modal.classList.add('opacity-0', 'pointer-events-none');
  modal.firstElementChild.classList.add('translate-y-full');
}

// =============================
// 受渡要請システム (Flyer Transfer Request System)
// =============================
let currentTransferRequest = null;

window.openTransferRequestDialog = function(name, id, loc, count, storageId) {
  const displayStorageId = String(storageId || '').trim();
  currentTransferRequest = { holderName: name, holderUserId: id, requestArea: loc, stockCount: count, storageId: displayStorageId };

  // 既存を削除して再生成（CSS競合を完全排除）
  const prev = document.getElementById('dynamic-transfer-dialog');
  if (prev) prev.remove();

  const overlay = document.createElement('div');
  overlay.id = 'dynamic-transfer-dialog';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.85);';

  overlay.innerHTML = `
    <div style="background:#1C1C1E;border-radius:24px;border:1px solid rgba(255,255,255,0.12);padding:28px 20px;width:100%;max-width:340px;box-sizing:border-box;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:24px;margin-bottom:8px;">📦</div>
        <div style="color:white;font-size:16px;font-weight:900;letter-spacing:0.05em;">受渡要請</div>
      </div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:700;margin-bottom:20px;line-height:1.5;text-align:left;">
        ${escapeHtml(displayStorageId)}さんとの<br>連絡方法を入力してください。
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡方法】</label>
        <div style="display:flex;gap:16px;align-items:center;padding:4px 0;">
          <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
            <input type="radio" name="contact-method" value="LINE" checked style="accent-color:#2563eb;cursor:pointer;"> LINE
          </label>
          <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
            <input type="radio" name="contact-method" value="電話" style="accent-color:#2563eb;cursor:pointer;"> 電話
          </label>
          <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
            <input type="radio" name="contact-method" value="メール" style="accent-color:#2563eb;cursor:pointer;"> メール
          </label>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡先】</label>
        <input type="text" id="transfer-contact-value" placeholder="LINE ID"
          style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:12px 14px;color:white;font-size:14px;font-weight:700;outline:none;" />
      </div>

      <div style="display:flex;gap:10px;">
        <button id="dyn-cancel"
          style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
          onpointerdown="this.style.transform='scale(0.94)'; this.style.opacity='0.7';"
          onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
          onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">キャンセル</button>
        <button id="dyn-submit" class="btn-neu"
          style="flex:2;background:#2563eb;border:none;color:white;border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
          onpointerdown="this.style.transform='scale(0.96)'; this.style.opacity='0.85';"
          onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
          onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">受渡要請を送る</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const contactValueInput = document.getElementById('transfer-contact-value');
  const methodPlaceholders = {
    'LINE': 'LINE ID',
    '電話': '電話番号',
    'メール': 'メールアドレス'
  };

  document.querySelectorAll('input[name="contact-method"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (contactValueInput) {
        contactValueInput.placeholder = methodPlaceholders[e.target.value] || '連絡先を入力';
      }
    });
  });

  document.getElementById('dyn-cancel').addEventListener('click', () => overlay.remove());

  let isSubmittingTransfer = false;
  document.getElementById('dyn-submit').addEventListener('click', async () => {
    if (isSubmittingTransfer) return;

    const contactValueInput = document.getElementById('transfer-contact-value');
    const contactValue = contactValueInput ? contactValueInput.value.trim() : '';

    if (!contactValue) {
      alert('連絡先を入力してください。');
      if (contactValueInput) contactValueInput.focus();
      return;
    }

    const methodRadio = document.querySelector('input[name="contact-method"]:checked');
    const contactMethod = methodRadio ? methodRadio.value : 'LINE';

    const btn = document.getElementById('dyn-submit');
    if (btn) { btn.textContent = '送信中...'; btn.disabled = true; }
    isSubmittingTransfer = true;

    try {
      await waitForIdentityVerified();
    } catch (authErr) {
      alert("本人確認が完了していないため要請を送信できません。");
      if (btn) { btn.textContent = '要請を送信する'; btn.disabled = false; }
      isSubmittingTransfer = false;
      return;
    }

    const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
    const requestUserId = userInfo.id ? String(userInfo.id).trim() : 'UNKNOWN';
    const requestId = window.generateRequestId ? window.generateRequestId('req_tr') : `req_tr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const res = await callApiPost('requestFlyerTransfer', {
        requestId: requestId,
        requestUserId: requestUserId,
        holderUserId: currentTransferRequest.holderUserId,
        storageId: currentTransferRequest.storageId || '',
        contactMethod: contactMethod,
        contactValue: contactValue
      });

      overlay.remove();
      if (res && (res.status === 'SENT' || res.status === 'SKIPPED_NO_LINE_ID')) {
        alert('✅ 受渡要請を送信しました！\n保管者に通知されます。');
      } else if (res && res.status === 'UNKNOWN') {
        alert('⚠️ 送信結果を確認できませんでした。\n通信状態をご確認のうえ、二重送信を防ぐためしばらくお待ちください。');
      } else {
        alert('送信に失敗しました: ' + (res ? res.message : 'Unknown error'));
      }
    } catch(err) {
      alert('通信エラー: ' + err.message);
      isSubmittingTransfer = false;
      if (btn) { btn.textContent = '受渡要請を送る'; btn.disabled = false; }
    }
  });
};

window.closeTransferRequestDialog = function() {
  const d = document.getElementById('dynamic-transfer-dialog');
  if (d) d.remove();
};

window.updateBulletinCharCount = function(textarea) {
  const counter = document.getElementById('bulletin-char-counter');
  if (!counter || !textarea) return;
  const len = textarea.value.length;
  counter.textContent = len + ' / 150';
  if (len >= 150) {
    counter.classList.add('text-red-400');
    counter.classList.remove('text-white/40');
  } else {
    counter.classList.remove('text-red-400');
    counter.classList.add('text-white/40');
  }
};

// 掲示板データ取得ライフサイクル管理ステート
let _cachedBulletinPosts = null;       // 投稿データのメモリキャッシュ
let _bulletinFetched = false;          // 取得成功実績フラグ
let _activeBulletinPromise = null;      // 実際の通信プロミス（callApiPostが真にsettleするまで保持）
let _bulletinReqSeq = 0;               // 最新リクエスト世代番号
let _bulletinNeedsRefresh = false;     // in-flight中にforceが要求された場合の遅延再取得フラグ

window.fetchBulletinPosts = function(options = {}) {
  const force = options.force === true;
  const container = document.getElementById('bulletin-list-container');
  const bulletinPage = document.getElementById('page-bulletin');
  const isBulletinActive = bulletinPage && !bulletinPage.classList.contains('hidden');

  // 【最終設計原則】既に取得済みの掲示板データを、画面遷移のたびにLoadingで破壊しない
  if (_cachedBulletinPosts !== null && !force) {
    // 2回目以降：既存投稿一覧を即表示（Loading画面は一切出さない）
    if (isBulletinActive && typeof renderBulletinList === 'function') {
      renderBulletinList(_cachedBulletinPosts);
    }
    return Promise.resolve(_cachedBulletinPosts);
  } else if (!_bulletinFetched && isBulletinActive && container) {
    // 初回のみ：キャッシュがないためLoadingを表示
    container.innerHTML = `
      <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-[#2563eb]/40 border-t-[#2563eb] animate-spin"></div>
        <p class="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">Loading Bulletin...</p>
      </div>`;
  }

  // 【要件②】in-flight通信が存在する場合：同時GETを絶対に発生させない
  if (_activeBulletinPromise) {
    if (force) {
      // 通信中かつforce指定の場合：2本目の通信を発射せず、現在の通信完了後に1回再取得する予約を入れる
      _bulletinNeedsRefresh = true;
    }
    return _activeBulletinPromise;
  }

  // 新規通信開始
  const currentSeq = ++_bulletinReqSeq;
  let isUiSettled = false;
  let uiTimeoutTimer = null;

  // 【要件①】15秒の「UI待機限界」タイマー（通信本体とは完全分離）
  const uiTimeoutPromise = new Promise((_, reject) => {
    uiTimeoutTimer = setTimeout(() => {
      if (!isUiSettled) {
        reject(new Error("UI_TIMEOUT"));
      }
    }, 15000);
  });

  // 実際の通信処理（callApiPostが真にsettleするまで管理）
  const networkPromise = callApiPost('getBulletinPosts')
    .then(data => {
      if (data && data.success && Array.isArray(data.posts)) {
        return data.posts;
      }
      throw new Error((data && data.message) || "データ取得に失敗しました");
    });

  _activeBulletinPromise = networkPromise;

  // UI層への反映：networkPromise と uiTimeoutPromise のレース
  // ※ただし networkPromise はバックグラウンドで最後まで走り続ける
  Promise.race([networkPromise, uiTimeoutPromise])
    .then(posts => {
      isUiSettled = true;
      if (uiTimeoutTimer) clearTimeout(uiTimeoutTimer);

      // 【要件③】世代チェック：自分が最新リクエストか？
      if (currentSeq !== _bulletinReqSeq) return;

      // キャッシュ更新
      _cachedBulletinPosts = posts;
      _bulletinFetched = true;

      // 【要件③】画面状態チェック：現在 page-bulletin がアクティブか？
      const pageEl = document.getElementById('page-bulletin');
      const isActive = pageEl && !pageEl.classList.contains('hidden');
      if (isActive && typeof renderBulletinList === 'function') {
        renderBulletinList(posts);
      }
    })
    .catch(err => {
      isUiSettled = true;
      if (uiTimeoutTimer) clearTimeout(uiTimeoutTimer);

      // 【要件③】世代チェック：自分が最新リクエストか？
      if (currentSeq !== _bulletinReqSeq) return;

      const pageEl = document.getElementById('page-bulletin');
      const isActive = pageEl && !pageEl.classList.contains('hidden');

      // キャッシュがあればキャッシュ描画を維持（エラーで画面を破壊しない）
      if (_cachedBulletinPosts !== null) {
        if (isActive && typeof renderBulletinList === 'function') {
          renderBulletinList(_cachedBulletinPosts);
        }
        return;
      }

      // 初回でキャッシュがない場合のみエラーUIを表示
      if (isActive) {
        const curContainer = document.getElementById('bulletin-list-container');
        if (curContainer) {
          const errMsg = err.message === "UI_TIMEOUT" ? "通信がタイムアウトしました" : "データ取得に失敗しました";
          curContainer.innerHTML = `
            <div style="border: 1px solid rgba(255,255,255,0.04);" class="premium-glass p-8 flex flex-col items-center justify-center text-center gap-3">
              <span class="text-2xl">⚠️</span>
              <p class="text-sm font-black text-white/60">${errMsg}</p>
              <button type="button" onclick="window.fetchBulletinPosts({ force: true })"
                class="mt-2 px-4 py-1.5 rounded-full text-xs font-bold text-white bg-white/10 hover:bg-white/20 active:scale-95 transition">
                再読み込み
              </button>
            </div>`;
        }
      }
    });

  // 【要件①】通信本体（networkPromise）が真にsettleしたときのライフサイクルクリーンアップ
  networkPromise
    .then(posts => {
      // もしUIタイムアウト後に遅れて成功した場合でも、最新世代ならキャッシュを最新化
      if (currentSeq === _bulletinReqSeq) {
        _cachedBulletinPosts = posts;
        _bulletinFetched = true;
        // もし現在掲示板を表示中なら、遅れて届いた最新データを静かに描画更新
        const pageEl = document.getElementById('page-bulletin');
        const isActive = pageEl && !pageEl.classList.contains('hidden');
        if (isActive && typeof renderBulletinList === 'function') {
          renderBulletinList(posts);
        }
      }
    })
    .catch(err => {
      console.warn("[Bulletin Network Settle Warn]", err.message);
    })
    .finally(() => {
      // 【要件①】元のcallApiPostが実際にsettleするまでin-flightとして管理
      if (_activeBulletinPromise === networkPromise) {
        _activeBulletinPromise = null;
      }

      // 【要件②】in-flight中にforce再取得の要求があった場合、1回だけ最新再取得を発射
      if (_bulletinNeedsRefresh) {
        _bulletinNeedsRefresh = false;
        window.fetchBulletinPosts({ force: true });
      }
    });

  return networkPromise;
};

window.submitBulletinPost = async function() {
  const inputEl = document.getElementById('bulletin-message-input');
  const btn = document.getElementById('btn-bulletin-submit');
  const counter = document.getElementById('bulletin-char-counter');
  if (!inputEl || !btn) return;

  const msg = inputEl.value.trim();
  if (!msg) {
    alert('メッセージを入力してください。');
    inputEl.focus();
    return;
  }
  if (msg.length > 150) {
    alert('メッセージは150文字以内で入力してください。');
    return;
  }

  const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
  const staffId = userInfo.id ? String(userInfo.id).trim() : (window.currentUser && window.currentUser.id ? String(window.currentUser.id).trim() : '');
  const staffName = `${userInfo.last || ''} ${userInfo.first || ''}`.trim() || staffId;

  if (!staffId) {
    alert('配布員IDが取得できませんでした。');
    return;
  }

  const originalText = btn.textContent;
  btn.textContent = '投稿中...';
  btn.disabled = true;

  try {
    await waitForIdentityVerified();
  } catch (authErr) {
    alert("本人確認が完了していないため投稿できません。");
    btn.textContent = originalText;
    btn.disabled = false;
    return;
  }

  try {
    const res = await callApiPost('createBulletinPost', {
      staffId: staffId,
      staffName: staffName,
      message: msg
    });

    if (res && res.success) {
      inputEl.value = '';
      if (counter) counter.textContent = '0 / 150';
      alert('✓ 投稿が完了しました');
      // 投稿完了後：キャッシュを無視して最新取得を要求
      window.fetchBulletinPosts({ force: true });
    } else {
      alert('投稿に失敗しました: ' + (res ? res.message : 'Unknown error'));
    }
  } catch (err) {
    alert('通信エラー: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
};

window.openBulletinContactDialog = function(targetStaffId) {
  const prev = document.getElementById('dynamic-bulletin-contact-dialog');
  if (prev) prev.remove();

  const targetIdStr = String(targetStaffId || '').trim();
  const overlay = document.createElement('div');
  overlay.id = 'dynamic-bulletin-contact-dialog';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.85);';

  overlay.innerHTML = `
    <div style="background:#1C1C1E;border-radius:24px;border:1px solid rgba(255,255,255,0.12);padding:28px 20px;width:100%;max-width:340px;box-sizing:border-box;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:24px;margin-bottom:8px;">💬</div>
        <div style="color:white;font-size:16px;font-weight:900;letter-spacing:0.05em;">連絡</div>
      </div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;font-weight:700;margin-bottom:20px;line-height:1.5;text-align:left;">
        ${escapeHtml(targetIdStr)}さんとの<br>連絡方法を入力してください。
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡方法】</label>
        <div style="display:flex;gap:16px;align-items:center;padding:4px 0;">
          <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
            <input type="radio" name="bulletin-contact-method" value="LINE" checked style="accent-color:#2563eb;cursor:pointer;"> LINE
          </label>
          <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
            <input type="radio" name="bulletin-contact-method" value="電話" style="accent-color:#2563eb;cursor:pointer;"> 電話
          </label>
          <label style="display:flex;align-items:center;gap:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;">
            <input type="radio" name="bulletin-contact-method" value="メール" style="accent-color:#2563eb;cursor:pointer;"> メール
          </label>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <label style="display:block;color:rgba(255,255,255,0.45);font-size:11px;font-weight:900;letter-spacing:0.05em;margin-bottom:8px;">【連絡先】</label>
        <input type="text" id="bulletin-contact-value" placeholder="LINE ID"
          style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:12px 14px;color:white;font-size:14px;font-weight:700;outline:none;" />
      </div>

      <div style="display:flex;gap:10px;">
        <button id="btn-bulletin-contact-cancel"
          style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
          onpointerdown="this.style.transform='scale(0.94)'; this.style.opacity='0.7';"
          onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
          onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">キャンセル</button>
        <button id="btn-bulletin-contact-submit" class="btn-neu"
          style="flex:2;background:#2563eb;border:none;color:white;border-radius:14px;padding:14px 8px;font-size:13px;font-weight:900;cursor:pointer;transition:transform 0.12s ease, opacity 0.12s ease;"
          onpointerdown="this.style.transform='scale(0.96)'; this.style.opacity='0.85';"
          onpointerup="this.style.transform='scale(1)'; this.style.opacity='1';"
          onpointerleave="this.style.transform='scale(1)'; this.style.opacity='1';">連絡する</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const contactValueInput = document.getElementById('bulletin-contact-value');
  const methodPlaceholders = {
    'LINE': 'LINE ID',
    '電話': '電話番号',
    'メール': 'メールアドレス'
  };

  document.querySelectorAll('input[name="bulletin-contact-method"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (contactValueInput) {
        contactValueInput.placeholder = methodPlaceholders[e.target.value] || '連絡先を入力';
      }
    });
  });

  document.getElementById('btn-bulletin-contact-cancel').addEventListener('click', () => overlay.remove());

  let isSubmittingContact = false;
  document.getElementById('btn-bulletin-contact-submit').addEventListener('click', async () => {
    if (isSubmittingContact) return;

    const contactValueInput = document.getElementById('bulletin-contact-value');
    const contactValue = contactValueInput ? contactValueInput.value.trim() : '';

    if (!contactValue) {
      alert('連絡先を入力してください。');
      if (contactValueInput) contactValueInput.focus();
      return;
    }

    const methodRadio = document.querySelector('input[name="bulletin-contact-method"]:checked');
    const contactMethod = methodRadio ? methodRadio.value : 'LINE';

    const btn = document.getElementById('btn-bulletin-contact-submit');
    if (btn) { btn.textContent = '連絡中...'; btn.disabled = true; }
    isSubmittingContact = true;

    try {
      await waitForIdentityVerified();
    } catch (authErr) {
      alert("本人確認が完了していないため連絡を送信できません。");
      if (btn) { btn.textContent = '連絡する'; btn.disabled = false; }
      isSubmittingContact = false;
      return;
    }

    const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
    const requestUserId = userInfo.id ? String(userInfo.id).trim() : (window.currentUser && window.currentUser.id ? String(window.currentUser.id).trim() : 'UNKNOWN');
    const requestId = window.generateRequestId ? window.generateRequestId('req_bc') : `req_bc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const res = await callApiPost('sendBulletinContact', {
        requestId: requestId,
        requestUserId: requestUserId,
        targetStaffId: targetIdStr,
        contactMethod: contactMethod,
        contactValue: contactValue
      });

      overlay.remove();
      if (res && (res.status === 'SENT' || res.status === 'SKIPPED_NO_LINE_ID')) {
        alert('✓ 連絡を送信しました');
      } else if (res && res.status === 'UNKNOWN') {
        alert('⚠️ 送信結果を確認できませんでした。\n通信状態をご確認のうえ、二重送信を防ぐためしばらくお待ちください。');
      } else {
        alert('連絡の送信に失敗しました: ' + (res ? res.message : 'Unknown error'));
      }
    } catch(err) {
      alert('通信エラー: ' + err.message);
      isSubmittingContact = false;
      if (btn) { btn.textContent = '連絡する'; btn.disabled = false; }
    }
  });
};

window.closeBulletinContactDialog = function() {
  const d = document.getElementById('dynamic-bulletin-contact-dialog');
  if (d) d.remove();
};



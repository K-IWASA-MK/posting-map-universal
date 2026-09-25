/**
 * POSTING MAP — IndexedDB 送信キュー管理
 * 
 * オフラインでも作業を止めない FIELD OPERATIONS OS の核心モジュール。
 * 
 * フロー:
 *   enqueueSync() → processQueue() → callApiPost('updateRecordWithGPSPhoto')
 *                                   → 成功: dequeueSync()
 *                                   → 失敗: scheduleRetry() (指数バックオフ)
 * 
 * リトライスケジュール: 10s → 30s → 60s → 60s → 60s (最大5回)
 */

const DB_NAME    = 'PostingMapDB';
const STORE_NAME = 'syncQueue';
const DB_VERSION = 2; // スキーマ拡張のためバージョンアップ

// リトライ設定
const RETRY_DELAYS  = [10000, 30000, 60000, 60000, 60000]; // ms
const MAX_RETRIES   = 5;

// 同期中フラグ（多重実行防止）
let isProcessing = false;

// ── DB接続 ───────────────────────────────────────────────────
let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // v1 → v2: インデックスは不要だが syncStatus フィールドを追加
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror   = (e) => reject(e.target.error);
  });
  return dbPromise;
}

// ── キュー操作 ────────────────────────────────────────────────

/**
 * キューにタスクを追加して即座に送信を試みる
 * @param {Object} item - { areaName, rowId, isDone, count, latitude, longitude,
 *                          accuracy, branchCode, areaId, photoBase64, staffName, staffId }
 */
async function enqueueSync(item) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // 同一 readwrite トランザクション境界内で探索（競合窓を完全排除）
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const queue = getAllReq.result || [];
      const targetRowId = Number(item.rowId);

      // 同一 rowId のアイテムが既にキューに存在するかチェック
      const existing = queue.find(q => Number(q.rowId) === targetRowId);
      if (existing) {
        console.warn(`[Queue] Duplicate enqueue avoided for rowId=${targetRowId}, existingId=${existing.id}`);
        resolve(existing.id);
        processQueue();
        return;
      }

      // クライアント不変操作識別子 (requestId) を付与（Backend冪等性ロジックは変更せずクライアント識別子として活用）
      const record = {
        ...item,
        requestId:   item.requestId || ('req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
        syncStatus:  'PENDING',
        retryCount:  item.retryCount || 0,
        nextRetryAt: item.nextRetryAt || 0,
        timestamp:   item.timestamp || Date.now()
      };

      const addReq = store.add(record);
      addReq.onsuccess = () => {
        resolve(addReq.result);
        // 即座に同期を試みる（バックグラウンド）
        processQueue();
      };
      addReq.onerror = (e) => reject(e.target.error);
    };

    getAllReq.onerror = (e) => reject(e.target.error);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 全キューを取得
 */
async function getQueue() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_NAME, 'readonly');
    const store   = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * 特定アイテムを削除（送信完了時）
 */
async function dequeueSync(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_NAME, 'readwrite');
    const store   = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * アイテムのフィールドを更新
 */
async function updateQueueItem(id, fields) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_NAME, 'readwrite');
    const store  = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const data = getReq.result;
      if (data) {
        Object.assign(data, fields);
        store.put(data);
      }
      resolve();
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

/**
 * クライアント不変操作識別子 (requestId) を生成
 * @param {string} prefix プレフィックス (デフォルト: 'req')
 * @returns {string} 一意の識別子
 */
function generateRequestId(prefix = 'req') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
window.generateRequestId = generateRequestId;

/**
 * 特定 rowId の送信ステータスを取得（数値/文字列の型を正規化）
 * @returns {string|null} 'PENDING' | 'SYNCING' | 'RETRY' | null
 */
async function getRowStatus(rowId) {
  const targetId = Number(rowId);
  const queue = await getQueue();
  const found = queue.find(q => Number(q.rowId) === targetId);
  return found ? (found.syncStatus || found.status || 'PENDING') : null;
}
window.getRowStatus = getRowStatus;

/**
 * 現在キュー内に存在する全レコードの rowId 配列（数値）を取得
 * 起動時やデータロード時の待機ピン復元に使用
 * @returns {Promise<number[]>}
 */
async function getSyncQueueRowIds() {
  const queue = await getQueue();
  return (queue || []).map(item => Number(item.rowId)).filter(id => !isNaN(id));
}
window.getSyncQueueRowIds = getSyncQueueRowIds;

// ── 指数バックオフリトライスケジューリング ─────────────────────

/**
 * 失敗時にリトライをスケジュール
 * - retryCount >= MAX_RETRIES の場合は次回送信なし（永久保留）
 */
async function scheduleRetry(item) {
  const count = (item.retryCount || 0) + 1;
  const delay = RETRY_DELAYS[Math.min(count - 1, RETRY_DELAYS.length - 1)];

  console.log(`[Queue] Retry scheduled: id=${item.id}, attempt=${count}/${MAX_RETRIES}, delay=${delay / 1000}s`);

  await updateQueueItem(item.id, {
    syncStatus:  'RETRY',
    retryCount:  count,
    nextRetryAt: count >= MAX_RETRIES ? Infinity : Date.now() + delay
  });
}

// ── メイン同期処理 ────────────────────────────────────────────

/**
 * キュー内の送信待ちアイテムを順次送信する
 * - 多重実行防止（isProcessing フラグ）
 * - オフライン時はスキップ
 * - 指数バックオフによる nextRetryAt チェック
 * - クラッシュ復旧（SYNCING のまま中断されたレコードの再送）
 */
async function processQueue() {
  if (isProcessing) return;
  if (!navigator.onLine) {
    updateUISyncStatus();
    return;
  }

  isProcessing = true;
  updateUISyncStatus();

  try {
    const queue = await getQueue();

    // 送信対象: PENDING, クラッシュ後の SYNCING, または nextRetryAt を過ぎた RETRY
    const now = Date.now();
    const targets = queue.filter(item => {
      const s = item.syncStatus || item.status;
      if (s === 'PENDING' || s === 'pending' || s === 'SYNCING') return true;
      if (s === 'RETRY'   || s === 'failed') {
        return (item.nextRetryAt || 0) <= now;
      }
      return false;
    });

    if (targets.length === 0) {
      isProcessing = false;
      updateUISyncStatus();
      return;
    }

    console.log(`[Queue] Processing ${targets.length} item(s)...`);
    let anySuccess = false; // 全アイテム処理後に1回だけloadDataを呼ぶフラグ

    for (const item of targets) {
      // 送信中マーク
      await updateQueueItem(item.id, { syncStatus: 'SYNCING' });
      updateUISyncStatus();

      try {
        const payload = {
          requestId:  item.requestId  || '',
          clientEventId: item.clientEventId || item.requestId || '',
          areaName:   item.areaName,
          rowId:          item.rowId,
          isDone:         item.isDone,
          count:          item.count,
          latitude:       item.latitude   || '',
          longitude:      item.longitude  || '',
          accuracy:       item.accuracy   || '',
          photoData:      item.photoBase64 || '',
          staffName:      item.staffName,
          staffId:        item.staffId
        };

        // 写真データはURL長制限を超えるためPOSTで送信
        const res = await callApiPost('updateRecordWithGPSPhoto', payload);

        if (res && res._debug) {
          console.log('[DRIVE DEBUG]', JSON.stringify(res._debug));
        }

        if (res && res.success) {
          // ── 因果関係の絶対順序 ──────────────────────────────────
          // 1. Backend persistence confirmed (res.success === true)
          // 2. dequeueSync()
          await dequeueSync(item.id);

          // 3. COMPLETED 確定 & 4. p.isDone = true
          // メモリキャッシュ（一括保存用）の同期更新
          if (window.cityAreaCache && window.cityAreaCache[item.areaName]) {
            const cachedPoints = window.cityAreaCache[item.areaName];
            const p = cachedPoints.find(pt => pt.rowId === item.rowId);
            if (p) {
              p.photoUrl = res.photoUrl || '';
              if (item.latitude && item.longitude) {
                p.gps = `${item.latitude},${item.longitude}`;
              }
              p.syncStatus = undefined;
              p.isDone = true;
              delete p.tempPhotoUrl;
              delete p.isReadyToSubmit;
            }
          }

          // 現在開いているモーダル(L3)のallPointsを同期
          if (typeof allPoints !== 'undefined' && allPoints && window.currentCityDetailAreaName === item.areaName) {
            const p = allPoints.find(pt => pt.rowId === item.rowId);
            if (p) {
              p.photoUrl = res.photoUrl || '';
              if (item.latitude && item.longitude) {
                p.gps = `${item.latitude},${item.longitude}`;
              }
              p.syncStatus = undefined;
              p.isDone = true;
              delete p.tempPhotoUrl;
              delete p.isReadyToSubmit;
            }

            // 5. 完了ピン・ロック
            if (typeof window.setPinInProgress === 'function') {
              window.setPinInProgress(item.rowId, "remove");
            }
            if (window.globalPinStatus) {
              if (!window.globalPinStatus.completed.includes(item.rowId)) {
                window.globalPinStatus.completed.push(item.rowId);
              }
              window.globalPinStatus.inProgress = window.globalPinStatus.inProgress.filter(id => id !== item.rowId);
            }
            if (typeof window.lockActivePinAndBubble === 'function') {
              window.lockActivePinAndBubble(item.rowId);
            }

            if (window.currentPointDetailRowId === item.rowId) {
              const mc = document.getElementById('detail-modal-content');
              if (mc && typeof renderDetailModalContent === 'function') {
                const updatedPoint = allPoints.find(pt => pt.rowId === item.rowId);
                if (updatedPoint) mc.innerHTML = renderDetailModalContent(updatedPoint);
              }
            }
          }

          console.log(`[Queue] Synced: id=${item.id}, rowId=${item.rowId}, reqId=${item.requestId || 'legacy'}`);
          anySuccess = true; // 1件でも成功 → 後でまとめてUI更新
        } else {
          throw new Error(res ? (res.message || 'API failure') : 'No response');
        }

      } catch (err) {
        console.error(`[Queue] Failed: id=${item.id}`, err.message);
        await scheduleRetry(item);

        // 1. メモリキャッシュのステータス更新
        if (window.cityAreaCache && window.cityAreaCache[item.areaName]) {
          const cachedPoints = window.cityAreaCache[item.areaName];
          const p = cachedPoints.find(pt => pt.rowId === item.rowId);
          if (p) {
            p.syncStatus = 'RETRY';
          }
        }
      }
    }

    // 全キュー処理完了後に1回だけUI更新（件数分の連続API呼び出しを防止）
    if (anySuccess && typeof loadData === 'function') {
      loadData(true);
    }

  } catch (err) {
    console.error('[Queue] processQueue error:', err);
  } finally {
    isProcessing = false;
    updateUISyncStatus();
  }
}

// ── ユーティリティ ────────────────────────────────────────────

/**
 * Blob を Base64 Data URL に変換（Safari/LINE WebView 対応）
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}
window.blobToBase64 = blobToBase64;

/**
 * UI の同期ステータス表示を更新（app.js の triggerUISyncRefresh を呼ぶ）
 */
function updateUISyncStatus() {
  if (typeof window.triggerUISyncRefresh === 'function') {
    window.triggerUISyncRefresh();
  }
}

// ── イベントリスナー ──────────────────────────────────────────

// オンライン復帰時に自動同期
window.addEventListener('online', () => {
  console.log('[Queue] Online restored. Processing queue...');
  processQueue();
});

// 定期ポーリング: nextRetryAt を過ぎたアイテムを検出して送信
// 最小 RETRY_DELAYS[0] = 10s に合わせて10秒ごとにチェック
setInterval(() => {
  if (navigator.onLine) processQueue();
}, 10000);

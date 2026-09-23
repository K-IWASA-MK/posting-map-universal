function getApiUrl() {
  if (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.api && window.PMS_CLIENT_CONFIG.api.gasWebAppUrl) {
    return window.PMS_CLIENT_CONFIG.api.gasWebAppUrl;
  }
  throw new Error('[H-App Config Error] PMS_CLIENT_CONFIG.api.gasWebAppUrl が未設定です。config.js を確認してください。');
}
const API_URL = getApiUrl();

function getLiffAuthToken() {
  if (typeof liff === "undefined") {
    return null;
  }
  try {
    if (!liff.isLoggedIn()) {
      return null;
    }
    return liff.getAccessToken();
  } catch (e) {
    return null;
  }
}

async function callApiPost(action, payload = {}) {
  const MAX_RETRIES = 3;
  let delay = 1000;

  const districtId = (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.districtId) || "";
  if (districtId && !payload.districtId) {
    payload.districtId = districtId;
  }

  const token = getLiffAuthToken();
  if (token) {
    payload.liffToken = token;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const url = `${API_URL}?_t=${Date.now()}`;
    const body = JSON.stringify({ action, ...payload });

    const options = {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow'
    };

    try {
      logDebug(`[callApiPost] START (Attempt ${attempt}/${MAX_RETRIES}): action=${action}, bodySize=${body.length}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      const response = await fetch(url, { ...options, body, signal: controller.signal });
      clearTimeout(timeoutId);
      logDebug(`[callApiPost] FETCH OK. status=${response.status}`);

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const text = await response.text();
      logDebug(`[callApiPost] TEXT RECEIVED (length=${text.length})`);

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error("JSON形式ではない応答を受け取りました: " + parseErr.message);
      }

      if (data && typeof data === 'object' && 'data' in data && data.data !== null) {
        const innerSuccess = data.data.success !== undefined ? data.data.success : data.success;
        if (innerSuccess === false) throw new Error(data.data.message || data.message || "API Error");
        return data.data;
      }

      if (data.success === false) throw new Error(data.message || "API Error");
      return data;
    } catch (err) {
      logDebug(`[callApiPost] Attempt ${attempt} failed: ${err.message}`);
      if (attempt === MAX_RETRIES) {
        console.error("API POST Error:", err);
        throw err;
      }
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

window.getApiUrl = getApiUrl;
window.getLiffAuthToken = getLiffAuthToken;
window.callApiPost = callApiPost;

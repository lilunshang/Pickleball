// 內部網頁設定：這兩個值本來就是公開的，可以放在網頁裡（Token、Secret 一律不可放這裡）
window.APP_CONFIG = {
  // 內部系統 API（Apps Script 網頁應用程式網址，…/exec）
  GAS_URL: '填入內部系統 API 的網頁應用程式網址',
  // Google Cloud → API 和服務 → 憑證 → OAuth 用戶端 ID（網頁應用程式）
  GOOGLE_CLIENT_ID: '填入 OAuth 用戶端 ID（xxxx.apps.googleusercontent.com）',
};

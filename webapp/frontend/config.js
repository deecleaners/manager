/**
 * Dee Cleaners — frontend configuration
 * =====================================
 * The API URL and API key are stored in the browser (localStorage) so the
 * administrator can configure them from the Settings page without editing
 * code. When the API URL is missing, the app shows the Connect screen.
 *
 * The API key is only a password for the Apps Script backend — never put the
 * real key here. Configure it inside the app (Settings > API) and it is
 * stored on this device only.
 */
window.DEE_CLEANERS_CONFIG = {
  /**
   * Default API URL — the live Dee Cleaners Apps Script deployment.
   * Change it in the app (Settings ▸ API), or override per-open with
   * ?api=http://localhost:8787/api  (e.g. for the mock server).
   */
  apiUrl: localStorage.getItem('dee_api_url') ||
    new URLSearchParams(location.search).get('api') ||
    'https://script.google.com/macros/s/AKfycbxgewP_sTZEsqdfVp6Eqz_rZLYcg3LrdEaFgcWgn9z-rh6F2aAwWfUbIlyU2oefw2X0/exec',
  apiKey: localStorage.getItem('dee_api_key') || '',
  appName: 'Dee Cleaners',
  currency: 'TZS'
};

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
   * Default API URL — optional; leave '' to show the Connect screen.
   * You can also connect quickly by opening the app with
   * ?api=http://localhost:8787/api  (e.g. for the mock server).
   */
  apiUrl: localStorage.getItem('dee_api_url') ||
    new URLSearchParams(location.search).get('api') || '',
  apiKey: localStorage.getItem('dee_api_key') || '',
  appName: 'Dee Cleaners',
  currency: 'TZS'
};

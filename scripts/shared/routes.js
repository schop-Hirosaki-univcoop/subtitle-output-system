// routes.js: 各種アプリケーションページへの遷移URLを集中管理するルーティング定義です。
const LOCATION_API_UNAVAILABLE_WARNING =
  "Window location API is not available; navigation was skipped.";

/**
 * window.location.replace が利用可能な環境かを判定した上でURL遷移を実行します。
 * SSRやテスト環境ではwindowが存在しないことがあるため、安全なラッパーにしています。
 * @param {string} target 遷移先URL
 */
function replaceLocation(target) {
  if (typeof window === "undefined" || !window?.location) {
    console.warn(LOCATION_API_UNAVAILABLE_WARNING, { target });
    return;
  }
  window.location.replace(target);
}

// 静的ホスティングでのページ構成に合わせたファイル名を定義します。
export const LOGIN_PAGE = "login.html";
export const EVENTS_PAGE = "operator.html";

/**
 * ログインページへ遷移します。
 * window APIが利用できない場合は警告を出すのみで処理を終了します。
 */
export function goToLogin() {
  replaceLocation(LOGIN_PAGE);
}

/**
 * オペレーター用イベント一覧ページへ遷移します。
 */
export function goToEvents() {
  replaceLocation(EVENTS_PAGE);
}

/**
 * 任意のターゲットURLへ遷移します。
 * @param {string} target
 */
export function redirectTo(target) {
  replaceLocation(target);
}

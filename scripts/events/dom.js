export function queryDom() {
  return {
    loginCard: document.getElementById("events-login-card"),
    loginButton: document.getElementById("events-login-button"),
    loginError: document.getElementById("events-login-error"),
    main: document.getElementById("events-main"),
    loading: document.getElementById("events-loading"),
    loadingText: document.getElementById("events-loading-text"),
    alert: document.getElementById("events-alert"),
    list: document.getElementById("events-list"),
    empty: document.getElementById("events-empty"),
    adminLink: document.getElementById("events-admin-link"),
    metaNote: document.getElementById("events-meta")
  };
}

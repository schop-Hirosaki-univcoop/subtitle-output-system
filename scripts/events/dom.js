export function queryDom() {
  return {
    loginCard: document.getElementById("events-login-card"),
    loginButton: document.getElementById("events-login-button"),
    loginError: document.getElementById("events-login-error"),
    main: document.getElementById("events-main"),
    loading: document.getElementById("events-loading"),
    loadingText: document.getElementById("events-loading-text"),
    alert: document.getElementById("events-alert"),
    eventList: document.getElementById("event-list"),
    eventEmpty: document.getElementById("event-empty"),
    context: document.getElementById("events-context"),
    addEventButton: document.getElementById("add-event-button"),
    refreshButton: document.getElementById("events-refresh-button"),
    logoutButton: document.getElementById("events-logout-button"),
    adminLink: document.getElementById("events-admin-link"),
    metaNote: document.getElementById("events-meta"),
    eventDialog: document.getElementById("event-dialog"),
    eventForm: document.getElementById("event-form"),
    eventDialogTitle: document.getElementById("event-dialog-title"),
    eventNameInput: document.getElementById("event-name-input"),
    eventError: document.getElementById("event-error"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmDialogTitle: document.getElementById("confirm-dialog-title"),
    confirmDialogMessage: document.getElementById("confirm-dialog-message"),
    confirmAcceptButton: document.getElementById("confirm-accept-button"),
    confirmCancelButton: document.getElementById("confirm-cancel-button")
  };
}

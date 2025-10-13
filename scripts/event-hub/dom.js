export function queryDom() {
  return {
    loginCard: document.getElementById("event-hub-login-card"),
    loginButton: document.getElementById("event-hub-login-button"),
    loginError: document.getElementById("event-hub-login-error"),
    main: document.getElementById("event-hub-main"),
    loading: document.getElementById("event-hub-loading"),
    loadingText: document.getElementById("event-hub-loading-text"),
    alert: document.getElementById("event-hub-alert"),
    summary: document.getElementById("event-hub-summary"),
    eventName: document.getElementById("event-hub-event-name"),
    scheduleCount: document.getElementById("event-hub-schedule-count"),
    totalParticipants: document.getElementById("event-hub-total-participants"),
    scheduleList: document.getElementById("event-hub-schedule-list"),
    empty: document.getElementById("event-hub-empty"),
    backLink: document.getElementById("event-hub-back-link"),
    manageLink: document.getElementById("event-hub-manage-link"),
    metaNote: document.getElementById("event-hub-meta")
  };
}

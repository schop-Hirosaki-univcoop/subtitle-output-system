export function queryDom() {
  return {
    loading: document.getElementById("hub-loading"),
    loadingText: document.getElementById("hub-loading-text"),
    alert: document.getElementById("hub-alert"),
    summary: document.getElementById("hub-summary"),
    main: document.getElementById("hub-main"),
    loginCard: document.getElementById("hub-login-card"),
    loginButton: document.getElementById("hub-login-button"),
    loginError: document.getElementById("hub-login-error"),
    eventName: document.getElementById("hub-event-name"),
    scheduleLabel: document.getElementById("hub-schedule-label"),
    scheduleRange: document.getElementById("hub-schedule-range"),
    participantCount: document.getElementById("hub-participant-count"),
    actions: document.getElementById("hub-actions"),
    operatorLink: document.getElementById("open-operator"),
    participantsLink: document.getElementById("open-participants"),
    backLink: document.getElementById("hub-back-link"),
    metaNote: document.getElementById("hub-meta")
  };
}

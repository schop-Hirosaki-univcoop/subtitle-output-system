function getPrefix() {
  if (typeof document === "undefined") {
    return "";
  }
  return document.documentElement?.dataset?.operatorEmbedPrefix || "";
}

function resolve(id) {
  const prefix = getPrefix();
  if (prefix) {
    const prefixed = document.getElementById(`${prefix}${id}`);
    if (prefixed) {
      return prefixed;
    }
  }
  return document.getElementById(id);
}

function resolveQuery(selector) {
  const prefix = getPrefix();
  if (prefix) {
    const prefixedSelector = selector.replace(/#([a-zA-Z0-9_-]+)/g, (_, id) => `#${prefix}${id}`);
    const prefixedResult = document.querySelector(prefixedSelector);
    if (prefixedResult) {
      return prefixedResult;
    }
  }
  return document.querySelector(selector);
}

export function queryDom() {
  return {
    loginButton: resolve("login-button"),
    loginContainer: resolve("login-container"),
    mainContainer: resolve("main-container"),
    actionPanel: resolve("action-panel"),
    userInfo: resolve("user-info"),
    dictionaryToggle: resolve("dictionary-toggle"),
    dictionaryPanel: resolve("dictionary-panel"),
    logsToggle: resolve("logs-toggle"),
    logsPanel: resolve("logs-panel"),
    cardsContainer: resolve("questions-cards"),
    genreTabContainer: resolve("genre-tab-buttons"),
    scheduleEventName: resolve("schedule-event-name"),
    scheduleLabel: resolve("schedule-label"),
    scheduleTimeRange: resolve("schedule-time-range"),
    dictionaryCardsContainer: resolve("dictionary-cards"),
    dictionaryActionPanel: resolve("dictionary-action-panel"),
    dictionaryEnableButton: resolve("dictionary-btn-enable"),
    dictionaryDisableButton: resolve("dictionary-btn-disable"),
    dictionaryEditButton: resolve("dictionary-btn-edit"),
    dictionaryDeleteButton: resolve("dictionary-btn-delete"),
    dictionaryBatchEnableButton: resolve("dictionary-btn-batch-enable"),
    dictionaryBatchDisableButton: resolve("dictionary-btn-batch-disable"),
    dictionaryBatchDeleteButton: resolve("dictionary-btn-batch-delete"),
    dictionarySelectedInfo: resolve("dictionary-selected-info"),
    dictionarySelectAllCheckbox: resolve("dictionary-select-all"),
    dictionaryCount: resolve("dictionary-count"),
    addTermForm: resolve("add-term-form"),
    newTermInput: resolve("new-term"),
    newRubyInput: resolve("new-ruby"),
    dictionaryEditDialog: resolve("dictionary-edit-dialog"),
    dictionaryEditForm: resolve("dictionary-edit-form"),
    dictionaryEditTermInput: resolve("dictionary-edit-term"),
    dictionaryEditRubyInput: resolve("dictionary-edit-ruby"),
    dictionaryEditSaveButton: resolve("dictionary-edit-save-button"),
    dictionaryEditCancelButton: resolve("dictionary-edit-cancel-button"),
    editDialog: resolve("edit-dialog"),
    editTextarea: resolve("edit-textarea"),
    editSaveButton: resolve("edit-save-button"),
    editCancelButton: resolve("edit-cancel-button"),
    actionButtons: ["btn-display", "btn-unanswer", "btn-edit"].map((id) => resolve(id)),
    selectedInfo: resolve("selected-info"),
    selectAllCheckbox: resolve("select-all-checkbox"),
    batchUnanswerBtn: resolve("btn-batch-unanswer"),
    clearButton: resolve("btn-clear"),
    logsRefreshButton: resolve("logs-refresh-button"),
    fetchDictionaryButton: resolve("fetch-dictionary-button"),
    logSearch: resolve("log-search"),
    logAutoscroll: resolve("log-autoscroll"),
    logStream: resolve("log-stream"),
    logsStreamView: resolve("logs-stream-view"),
    dictionaryConfirmDialog: resolve("dictionary-confirm-dialog"),
    dictionaryConfirmTitle: resolve("dictionary-confirm-dialog-title"),
    dictionaryConfirmMessage: resolve("dictionary-confirm-dialog-message"),
    dictionaryConfirmAcceptButton: resolve("dictionary-confirm-accept-button"),
    dictionaryConfirmCancelButton: resolve("dictionary-confirm-cancel-button"),
    loadingOverlay: resolve("loading-overlay"),
    loadingText: resolve("loading-text"),
    loaderSteps: resolve("loader-steps"),
    copyrightYear: resolve("copyright-year"),
    confirmDialog: resolve("confirm-dialog"),
    confirmTitle: resolve("confirm-dialog-title"),
    confirmMessage: resolve("confirm-dialog-message"),
    confirmAcceptButton: resolve("confirm-accept-button"),
    confirmCancelButton: resolve("confirm-cancel-button"),
    render: {
      indicator: resolveQuery(".render-indicator"),
      lamp: resolve("render-lamp"),
      phase: resolve("render-phase"),
      summary: resolve("render-summary"),
      title: resolve("render-title"),
      question: resolve("render-question"),
      updated: resolve("render-updated")
    }
  };
}

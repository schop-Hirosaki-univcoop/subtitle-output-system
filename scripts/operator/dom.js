// dom.js: オペレーター画面のDOM参照取得やテンプレート生成をまとめたユーティリティです。
/**
 * 埋め込みモードで付与されるIDプレフィックスを取得します。
 * @returns {string}
 */
function getPrefix() {
  if (typeof document === "undefined") {
    return "";
  }
  return document.documentElement?.dataset?.operatorEmbedPrefix || "";
}

/**
 * 指定IDに対して埋め込みプレフィックスを考慮したDOM要素検索を行います。
 * @param {string} id
 * @returns {HTMLElement|null}
 */
function resolve(id) {
  const prefix = getPrefix();
  if (prefix) {
    const prefixed = document.getElementById(`${prefix}${id}`);
    if (prefixed) {
      return prefixed;
    }
  }

  // 予期せずプレフィックスが外れている環境でも要素を取得できるよう、
  // デフォルトの "op-" プレフィックスを試す。
  const fallbackPrefixed = document.getElementById(`op-${id}`);
  if (fallbackPrefixed) {
    return fallbackPrefixed;
  }

  return document.getElementById(id);
}

/**
 * CSSセレクタに対して埋め込みプレフィックスを適用したquerySelectorを実行します。
 * @param {string} selector
 * @returns {Element|null}
 */
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

/**
 * オペレーター画面で利用するDOM要素を事前に取得し、アクセスを簡素化します。
 * @returns {Record<string, any>}
 */
export function queryDom() {
  return {
    loginButton: resolve("login-button"),
    loginContainer: resolve("login-container"),
    mainContainer: resolve("main-container"),
    actionPanel: resolve("action-panel"),
    userInfo: resolve("user-info"),
    dictionaryToggle: resolve("dictionary-toggle"),
    dictionaryPanel: resolve("dictionary-panel"),
    pickupPanel: resolve("pickup-panel"),
    logsToggle: resolve("logs-toggle"),
    logsPanel: resolve("logs-panel"),
    cardsContainer: resolve("questions-cards"),
    genreTabContainer: resolve("genre-tab-buttons"),
    scheduleEventName: resolve("schedule-event-name"),
    scheduleLabel: resolve("schedule-label"),
    scheduleTimeRange: resolve("schedule-time-range"),
    channelBanner: resolve("op-channel-banner"),
    channelStatus: resolve("op-channel-status"),
    channelLockButton: resolve("op-channel-lock-button"),
    channelAssignment: resolve("op-channel-assignment"),
    channelPresenceList: resolve("op-channel-presence-list"),
    channelPresenceEmpty: resolve("op-channel-presence-empty"),
    dictionaryCardsContainer: resolve("dictionary-cards"),
    dictionaryLoadingOverlay: resolve("dictionary-loading-overlay"),
    dictionaryLoadingText: resolve("dictionary-loading-text"),
    dictionaryLoaderSteps: resolve("dictionary-loader-steps"),
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
    logsLoadingOverlay: resolve("logs-loading-overlay"),
    logsLoadingText: resolve("logs-loading-text"),
    logsLoaderSteps: resolve("logs-loader-steps"),
    dictionaryConfirmDialog: resolve("dictionary-confirm-dialog"),
    dictionaryConfirmTitle: resolve("dictionary-confirm-dialog-title"),
    dictionaryConfirmMessage: resolve("dictionary-confirm-dialog-message"),
    dictionaryConfirmAcceptButton: resolve("dictionary-confirm-accept-button"),
    dictionaryConfirmCancelButton: resolve("dictionary-confirm-cancel-button"),
    pickupOpenAddButton: resolve("pickup-open-add-button"),
    pickupForm: resolve("pickup-form"),
    pickupQuestionInput: resolve("pickup-question"),
    pickupGenreSelect: resolve("pickup-genre"),
    pickupTabs: resolve("pickup-tabs"),
    pickupRefreshButton: resolve("pickup-refresh-button"),
    pickupList: resolve("pickup-list"),
    pickupEmpty: resolve("pickup-empty"),
    pickupAlert: resolve("pickup-alert"),
    pickupLoadingOverlay: resolve("pickup-loading-overlay"),
    pickupLoadingText: resolve("pickup-loading-text"),
    pickupLoaderSteps: resolve("pickup-loader-steps"),
    pickupActionPanel: resolve("pickup-action-panel"),
    pickupSelectedInfo: resolve("pickup-selected-info"),
    pickupEditButton: resolve("pickup-btn-edit"),
    pickupDeleteButton: resolve("pickup-btn-delete"),
    pickupEditDialog: resolve("pickup-edit-dialog"),
    pickupEditForm: resolve("pickup-edit-form"),
    pickupEditQuestion: resolve("pickup-edit-question"),
    pickupEditGenre: resolve("pickup-edit-genre"),
    pickupEditSaveButton: resolve("pickup-edit-save-button"),
    pickupEditCancelButton: resolve("pickup-edit-cancel-button"),
    pickupConfirmDialog: resolve("pickup-confirm-dialog"),
    pickupConfirmMessage: resolve("pickup-confirm-message"),
    pickupConfirmAcceptButton: resolve("pickup-confirm-accept-button"),
    pickupConfirmCancelButton: resolve("pickup-confirm-cancel-button"),
    pickupAddDialog: resolve("pickup-add-dialog"),
    pickupAddCancelButton: resolve("pickup-add-cancel-button"),
    sideTelopPanel: resolve("side-telop-panel"),
    sideTelopList: resolve("side-telop-list"),
    sideTelopEmpty: resolve("side-telop-empty"),
    sideTelopForm: resolve("side-telop-form"),
    sideTelopText: resolve("side-telop-text"),
    sideTelopFormSubmit: resolve("side-telop-submit"),
    sideTelopFormCancel: resolve("side-telop-cancel"),
    loadingOverlay: resolve("loading-overlay"),
    loadingText: resolve("loading-text"),
    loaderSteps: resolve("loader-steps"),
    copyrightYear: resolve("copyright-year"),
    confirmDialog: resolve("confirm-dialog"),
    confirmTitle: resolve("confirm-dialog-title"),
    confirmMessage: resolve("confirm-dialog-message"),
    confirmAcceptButton: resolve("confirm-accept-button"),
    confirmCancelButton: resolve("confirm-cancel-button"),
    conflictDialog: resolve("op-conflict-dialog"),
    conflictForm: resolve("op-conflict-form"),
    conflictOptions: resolve("op-conflict-options"),
    conflictConfirmButton: resolve("op-conflict-confirm-button"),
    conflictCancelButton: resolve("op-conflict-cancel-button"),
    conflictError: resolve("op-conflict-error"),
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

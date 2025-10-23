import {
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  onValue,
  get,
  questionsRef,
  questionStatusRef,
  questionIntakeEventsRef,
  questionIntakeSchedulesRef,
  displaySessionRef,
  renderRef
} from "./firebase.js";
import { queryDom } from "./dom.js";
import { createInitialState } from "./state.js";
import { createApiClient } from "./api-client.js";
import { showToast } from "./toast.js";
import * as Questions from "./questions.js";
import { resolveGenreLabel } from "./utils.js";
import * as Dictionary from "./dictionary.js";
import * as Logs from "./logs.js";
import * as Display from "./display.js";
import * as Dialog from "./dialog.js";
import * as Loader from "./loader.js";
import * as Pickup from "./pickup.js";

const DOM_EVENT_BINDINGS = [
  { element: "loginButton", type: "click", handler: "login", guard: (app) => !app.isEmbedded },
  { element: "dictionaryToggle", type: "click", handler: "toggleDictionaryDrawer" },
  { element: "logsToggle", type: "click", handler: "toggleLogsDrawer" },
  { element: "logsRefreshButton", type: "click", handler: "fetchLogs" },
  { element: "clearButton", type: "click", handler: "clearTelop" },
  { element: "fetchDictionaryButton", type: "click", handler: "fetchDictionary" },
  { element: "addTermForm", type: "submit", handler: "addTerm" },
  { element: "dictionarySelectAllCheckbox", type: "change", handler: "handleDictionarySelectAll" },
  { element: "dictionaryEnableButton", type: "click", handler: "handleDictionaryEnable" },
  { element: "dictionaryDisableButton", type: "click", handler: "handleDictionaryDisable" },
  { element: "dictionaryEditButton", type: "click", handler: "handleDictionaryEdit" },
  { element: "dictionaryDeleteButton", type: "click", handler: "handleDictionaryDelete" },
  { element: "dictionaryBatchEnableButton", type: "click", handler: "handleDictionaryBatchEnable" },
  { element: "dictionaryBatchDisableButton", type: "click", handler: "handleDictionaryBatchDisable" },
  { element: "dictionaryBatchDeleteButton", type: "click", handler: "handleDictionaryBatchDelete" },
  { element: "dictionaryEditCancelButton", type: "click", handler: "closeDictionaryEditDialog" },
  { element: "dictionaryEditForm", type: "submit", handler: "handleDictionaryEditSubmit" },
  { element: "pickupOpenAddButton", type: "click", handler: "openPickupAddDialog" },
  { element: "pickupForm", type: "submit", handler: "handlePickupFormSubmit" },
  { element: "pickupTabs", type: "click", handler: "handlePickupFilterClick" },
  { element: "pickupTabs", type: "keydown", handler: "handlePickupFilterKeydown" },
  { element: "pickupRefreshButton", type: "click", handler: "fetchPickupQuestions" },
  { element: "pickupEditButton", type: "click", handler: "handlePickupActionEdit" },
  { element: "pickupDeleteButton", type: "click", handler: "handlePickupActionDelete" },
  { element: "pickupAddCancelButton", type: "click", handler: "closePickupAddDialog" },
  { element: "pickupEditCancelButton", type: "click", handler: "closePickupEditDialog" },
  { element: "pickupEditForm", type: "submit", handler: "handlePickupEditSubmit" },
  { element: "pickupConfirmCancelButton", type: "click", handler: "closePickupConfirmDialog" },
  { element: "pickupConfirmAcceptButton", type: "click", handler: "handlePickupDelete" },
  { element: "selectAllCheckbox", type: "change", handler: "handleSelectAll" },
  { element: "batchUnanswerBtn", type: "click", handler: "handleBatchUnanswer" },
  { element: "editCancelButton", type: "click", handler: "closeEditDialog" },
  { element: "editSaveButton", type: "click", handler: "handleEditSubmit" },
  { element: "logSearch", type: "input", handler: (app) => app.renderLogs() },
  {
    element: "logAutoscroll",
    type: "change",
    handler: (app, event) => {
      if (event?.target instanceof HTMLInputElement) {
        app.state.autoScrollLogs = event.target.checked;
      }
    }
  }
];

const ACTION_BUTTON_BINDINGS = [
  { index: 0, handler: "handleDisplay" },
  { index: 1, handler: "handleUnanswer" },
  { index: 2, handler: "handleEdit" }
];

const MODULE_METHOD_GROUPS = [
  {
    module: Dictionary,
    methods: [
      "fetchDictionary",
      "applyInitialDictionaryState",
      "toggleDictionaryDrawer",
      "addTerm",
      "handleDictionarySelectAll",
      "handleDictionaryEnable",
      "handleDictionaryDisable",
      "handleDictionaryEdit",
      "handleDictionaryDelete",
      "handleDictionaryBatchEnable",
      "handleDictionaryBatchDisable",
      "handleDictionaryBatchDelete",
      "handleDictionaryEditSubmit",
      "closeDictionaryEditDialog",
      "startDictionaryListener",
      "stopDictionaryListener"
    ]
  },
  {
    module: Pickup,
    methods: [
      "fetchPickupQuestions",
      "applyInitialPickupState",
      "startPickupListener",
      "stopPickupListener",
      "openPickupAddDialog",
      "closePickupAddDialog",
      "handlePickupFormSubmit",
      "handlePickupFilterClick",
      "handlePickupFilterKeydown",
      "handlePickupEditSubmit",
      "handlePickupActionEdit",
      "handlePickupActionDelete",
      "closePickupEditDialog",
      "closePickupConfirmDialog",
      "handlePickupDelete"
    ]
  },
  {
    module: Logs,
    methods: [
      "fetchLogs",
      "renderLogs",
      "applyLogFilters",
      "renderLogsStream",
      "applyInitialLogsState",
      "toggleLogsDrawer",
      "startLogsUpdateMonitor"
    ]
  },
  {
    module: Questions,
    methods: [
      "renderQuestions",
      "updateScheduleContext",
      "switchSubTab",
      "switchGenre",
      "handleDisplay",
      "handleUnanswer",
      "handleSelectAll",
      "handleBatchUnanswer",
      "clearTelop",
      "updateActionAvailability",
      "updateBatchButtonVisibility",
      "syncSelectAllState"
    ]
  },
  {
    module: Display,
    methods: ["handleRenderUpdate", "redrawUpdatedAt", "refreshStaleness", "refreshRenderSummary"]
  },
  {
    module: Dialog,
    methods: [
      "openDialog",
      "closeEditDialog",
      "handleDialogKeydown",
      "handleEdit",
      "handleEditSubmit"
    ]
  },
  {
    module: Loader,
    methods: [
      "showLoader",
      "updateLoader",
      "hideLoader",
      "initLoaderSteps",
      "setLoaderStep",
      "finishLoaderSteps"
    ]
  }
];

function bindModuleMethods(app) {
  MODULE_METHOD_GROUPS.forEach(({ module, methods }) => {
    methods.forEach((methodName) => {
      const implementation = module?.[methodName];
      if (typeof implementation !== "function") {
        throw new Error(`Missing method "${methodName}" on module.`);
      }
      Object.defineProperty(app, methodName, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: (...args) => implementation(app, ...args)
      });
    });
  });
}

function bindDomEvents(app) {
  DOM_EVENT_BINDINGS.forEach(({ element, type, handler, guard }) => {
    if (typeof guard === "function" && !guard(app)) {
      return;
    }
    const target = app.dom[element];
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    const listener = typeof handler === "string"
      ? (event) => {
          const method = app[handler];
          if (typeof method === "function") {
            method.call(app, event);
          }
        }
      : (event) => handler(app, event);
    target.addEventListener(type, listener);
  });
}

function bindActionButtons(app) {
  const buttons = app.dom.actionButtons || [];
  ACTION_BUTTON_BINDINGS.forEach(({ index, handler }) => {
    const target = buttons[index];
    const method = app[handler];
    if (!target || typeof target.addEventListener !== "function" || typeof method !== "function") {
      return;
    }
    target.addEventListener("click", (event) => method.call(app, event));
  });
}

export class OperatorApp {
  constructor() {
    this.dom = queryDom();
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    this.pageContext = this.extractPageContext();
    this.applyContextToState();
    this.api = createApiClient(auth, onAuthStateChanged);
    this.isEmbedded = Boolean(OperatorApp.embedPrefix);
    if (this.isEmbedded && this.dom.loginContainer) {
      this.dom.loginContainer.style.display = "none";
    }
    this.loaderStepLabels = this.isEmbedded ? [] : null;

    this.lastUpdatedAt = 0;
    this.renderTicker = null;
    this.questionsUnsubscribe = null;
    this.displaySessionUnsubscribe = null;
    this.updateTriggerUnsubscribe = null;
    this.renderUnsubscribe = null;
    this.logsUpdateTimer = null;
    this.eventsUnsubscribe = null;
    this.schedulesUnsubscribe = null;
    this.dictionaryUnsubscribe = null;
    this.dictionaryData = [];
    this.dictionaryEntries = [];
    this.dictionarySelectedId = "";
    this.dictionarySelectedEntry = null;
    this.dictionaryBatchSelection = new Set();
    this.dictionaryConfirmState = { resolver: null, lastFocused: null };
    this.dictionaryConfirmSetup = false;
    this.dictionaryEditState = { uid: "", originalTerm: "", originalRuby: "", submitting: false, lastFocused: null };
    this.dictionaryEditSetup = false;
    this.pickupUnsubscribe = null;
    this.pickupEntries = [];
    this.pickupLoaded = false;
    this.pickupActiveFilter = "all";
    this.pickupAddState = { submitting: false, lastFocused: null };
    this.pickupEditState = { uid: "", submitting: false, lastFocused: null };
    this.pickupConfirmState = { uid: "", submitting: false, lastFocused: null, question: "" };
    this.pickupAddDialogSetup = false;
    this.pickupEditDialogSetup = false;
    this.pickupConfirmDialogSetup = false;
    this.eventsBranch = {};
    this.schedulesBranch = {};
    this.authFlow = "idle";
    this.pendingAuthUser = null;
    this.isAuthorized = false;
    this.dictionaryLoaded = false;
    this.preferredDictionaryOpen = false;
    this.preferredLogsOpen = false;
    this.activeDialog = null;
    this.dialogLastFocused = null;
    this.pendingEditUid = null;
    this.pendingEditOriginal = "";
    this.editSubmitting = false;
    this.confirmState = { resolver: null, keydownHandler: null, lastFocused: null, initialized: false };

    this.toast = showToast;
    bindModuleMethods(this);
    if (typeof this.applyInitialPickupState === "function") {
      try {
        this.applyInitialPickupState();
      } catch (error) {
        console.debug("failed to initialize pickup panel", error);
      }
    }
    this.redirectingToIndex = false;
    this.embedReadyDeferred = null;
  }

  static get embedPrefix() {
    if (typeof document === "undefined") {
      return "";
    }
    return document.documentElement?.dataset?.operatorEmbedPrefix || "";
  }

  extractPageContext() {
    const context = {
      eventId: "",
      scheduleId: "",
      eventName: "",
      scheduleLabel: "",
      startAt: "",
      endAt: "",
      scheduleKey: ""
    };
    if (typeof window === "undefined") {
      return context;
    }
    try {
      const params = new URLSearchParams(window.location.search || "");
      context.eventId = String(params.get("eventId") ?? params.get("event") ?? "").trim();
      context.scheduleId = String(params.get("scheduleId") ?? params.get("schedule") ?? "").trim();
      context.eventName = String(params.get("eventName") ?? "").trim();
      context.scheduleLabel = String(params.get("scheduleLabel") ?? params.get("scheduleName") ?? "").trim();
      context.startAt = String(params.get("startAt") ?? params.get("scheduleStart") ?? params.get("start") ?? "").trim();
      context.endAt = String(params.get("endAt") ?? params.get("scheduleEnd") ?? params.get("end") ?? "").trim();
      context.scheduleKey = String(params.get("scheduleKey") ?? "").trim();
      if (!context.scheduleKey && context.eventId && context.scheduleId) {
        context.scheduleKey = `${context.eventId}::${context.scheduleId}`;
      }
    } catch (error) {
      console.debug("failed to parse page context", error);
    }
    return context;
  }

  applyContextToState() {
    if (!this.state) return;
    const context = this.pageContext || {};
    const scheduleKey = context.scheduleKey || (context.eventId && context.scheduleId ? `${context.eventId}::${context.scheduleId}` : "");
    this.state.activeEventId = context.eventId || "";
    this.state.activeScheduleId = context.scheduleId || "";
    this.state.activeEventName = context.eventName || "";
    this.state.activeScheduleLabel = context.scheduleLabel || "";
    if (scheduleKey) {
      this.state.currentSchedule = scheduleKey;
      this.state.lastNormalSchedule = scheduleKey;
    }
  }

  setExternalContext(context = {}) {
    const ensure = (value) => String(value ?? "").trim();
    const eventId = ensure(context.eventId);
    const scheduleId = ensure(context.scheduleId);
    const eventName = ensure(context.eventName);
    const scheduleLabel = ensure(context.scheduleLabel);
    const startAt = ensure(context.startAt);
    const endAt = ensure(context.endAt);
    const scheduleKey = eventId && scheduleId ? `${eventId}::${scheduleId}` : "";

    this.pageContext = {
      ...this.pageContext,
      eventId,
      scheduleId,
      eventName,
      scheduleLabel,
      startAt,
      endAt,
      scheduleKey
    };

    this.applyContextToState();

    if (!this.state.scheduleMetadata || !(this.state.scheduleMetadata instanceof Map)) {
      this.state.scheduleMetadata = new Map();
    }

    if (scheduleKey) {
      this.state.scheduleMetadata.set(scheduleKey, {
        key: scheduleKey,
        eventId,
        scheduleId,
        eventName,
        label: scheduleLabel || scheduleId,
        startAt,
        endAt
      });
    }

    if (this.isAuthorized) {
      if (this.dom.mainContainer) {
        this.dom.mainContainer.style.display = "";
        this.dom.mainContainer.hidden = false;
      }
      if (this.dom.actionPanel) {
        this.dom.actionPanel.style.display = "flex";
        this.dom.actionPanel.hidden = false;
      }
    }

    this.updateScheduleContext();
    this.renderQuestions();
    this.updateActionAvailability();
    this.updateBatchButtonVisibility();
  }

  waitUntilReady() {
    if (this.isAuthorized) {
      return Promise.resolve();
    }
    if (this.embedReadyDeferred?.promise) {
      return this.embedReadyDeferred.promise;
    }
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    this.embedReadyDeferred = { promise, resolve };
    return promise;
  }

  resolveEmbedReady() {
    if (this.embedReadyDeferred?.resolve) {
      this.embedReadyDeferred.resolve();
    }
    this.embedReadyDeferred = null;
  }

  init() {
    this.setupEventListeners();
    this.applyPreferredSubTab();
    this.updateActionAvailability();
    this.attachRenderMonitor();
    this.applyInitialDictionaryState();
    this.applyInitialLogsState();
    this.updateCopyrightYear();
    onAuthStateChanged(auth, (user) => {
      if (this.authFlow === "prompting") {
        this.pendingAuthUser = user || null;
        return;
      }
      this.handleAuthState(user);
    });
  }

  setupEventListeners() {
    bindDomEvents(this);
    bindActionButtons(this);
    this.bindDatasetButtons(".sub-tab-button", "subTab", (value) => this.switchSubTab(value));
    this.bindDatasetButtons(".genre-tab-button", "genre", (value) => this.switchGenre(value));
    if (this.dom.editDialog) {
      this.dom.editDialog.addEventListener("click", (event) => {
        if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
          event.preventDefault();
          this.closeEditDialog();
        }
      });
    }
    this.dom.cardsContainer?.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.classList.contains("row-checkbox")) {
        this.syncSelectAllState();
        this.updateBatchButtonVisibility();
        this.updateActionAvailability();
      }
    });
    this.setupConfirmDialog();
  }

  bindDatasetButtons(selector, datasetKey, callback) {
    document.querySelectorAll(selector).forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      element.addEventListener("click", () => {
        const value = element.dataset?.[datasetKey];
        callback(value, element);
      });
    });
  }

  applyPreferredSubTab() {
    const preferredSubTab = Questions.loadPreferredSubTab();
    if (preferredSubTab && preferredSubTab !== this.state.currentSubTab) {
      this.switchSubTab(preferredSubTab);
    } else {
      this.updateScheduleContext();
      this.renderQuestions();
    }
  }

  setupConfirmDialog() {
    if (!this.dom.confirmDialog || this.confirmState.initialized) {
      return;
    }
    this.confirmState.initialized = true;
    this.dom.confirmDialog.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
        event.preventDefault();
        this.finishConfirm(false);
      }
    });
    this.dom.confirmCancelButton?.addEventListener("click", (event) => {
      event.preventDefault();
      this.finishConfirm(false);
    });
    this.dom.confirmAcceptButton?.addEventListener("click", (event) => {
      event.preventDefault();
      this.finishConfirm(true);
    });
  }

  openConfirmDialog() {
    const dialog = this.dom.confirmDialog;
    if (!dialog) return;
    dialog.removeAttribute("hidden");
    document.body.classList.add("modal-open");
    this.confirmState.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.confirmState.keydownHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.finishConfirm(false);
      }
    };
    document.addEventListener("keydown", this.confirmState.keydownHandler, true);
    const focusTarget = this.dom.confirmAcceptButton || dialog.querySelector("button");
    if (focusTarget instanceof HTMLElement) {
      requestAnimationFrame(() => focusTarget.focus());
    }
  }

  finishConfirm(result) {
    const dialog = this.dom.confirmDialog;
    if (!dialog) return;
    if (!dialog.hasAttribute("hidden")) {
      dialog.setAttribute("hidden", "");
    }
    document.body.classList.remove("modal-open");
    if (this.confirmState.keydownHandler) {
      document.removeEventListener("keydown", this.confirmState.keydownHandler, true);
      this.confirmState.keydownHandler = null;
    }
    const resolver = this.confirmState.resolver;
    this.confirmState.resolver = null;
    const toFocus = this.confirmState.lastFocused;
    this.confirmState.lastFocused = null;
    if (toFocus && typeof toFocus.focus === "function") {
      requestAnimationFrame(() => toFocus.focus());
    }
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  async confirmAction({
    title = "確認",
    description = "",
    confirmLabel = "実行する",
    cancelLabel = "キャンセル",
    tone = "danger"
  } = {}) {
    if (!this.dom.confirmDialog) {
      return false;
    }
    this.setupConfirmDialog();
    if (this.confirmState.resolver) {
      this.finishConfirm(false);
    }
    if (this.dom.confirmTitle) {
      this.dom.confirmTitle.textContent = title || "確認";
    }
    if (this.dom.confirmMessage) {
      this.dom.confirmMessage.textContent = description || "";
    }
    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.textContent = confirmLabel || "実行する";
      this.dom.confirmAcceptButton.classList.remove("btn-danger", "btn-primary");
      this.dom.confirmAcceptButton.classList.add(tone === "danger" ? "btn-danger" : "btn-primary");
    }
    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.textContent = cancelLabel || "キャンセル";
    }
    this.openConfirmDialog();
    return await new Promise((resolve) => {
      this.confirmState.resolver = resolve;
    });
  }

  attachRenderMonitor() {
    if (this.renderUnsubscribe) {
      this.renderUnsubscribe();
    }
    this.renderUnsubscribe = onValue(renderRef, (snapshot) => this.handleRenderUpdate(snapshot), (error) => {
      console.error("Failed to monitor render state:", error);
    });
  }

  async login() {
    const btn = this.dom.loginButton;
    const originalText = btn ? btn.textContent : "";
    try {
      this.authFlow = "prompting";
      this.showLoader("サインイン中…");
      if (btn) {
        btn.disabled = true;
        btn.classList.add("is-busy");
        btn.textContent = "サインイン中…";
      }
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
      this.toast("ログインに失敗しました。", "error");
      this.hideLoader();
    } finally {
      this.authFlow = "done";
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-busy");
        btn.textContent = originalText;
      }
      if (this.pendingAuthUser !== null) {
        const user = this.pendingAuthUser;
        this.pendingAuthUser = null;
        this.handleAuthState(user);
      }
    }
  }

  async logout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
    this.authFlow = "idle";
    this.pendingAuthUser = null;
    this.hideLoader();
  }

  async handleAuthState(user) {
    if (!user) {
      this.showLoggedOutState();
      return;
    }
    try {
      this.showLoader(this.isEmbedded ? "利用準備を確認しています…" : "権限を確認しています…");
      this.initLoaderSteps();
      this.setLoaderStep(0, this.isEmbedded ? "利用状態を確認しています…" : "認証OK。ユーザー情報を確認中…");
      const result = await this.api.apiPost({ action: "fetchSheet", sheet: "users" });
      this.setLoaderStep(1, this.isEmbedded ? "必要な設定を確認しています…" : "在籍チェック中…");
      if (!result.success || !result.data) {
        throw new Error("ユーザー権限の確認に失敗しました。");
      }
      const authorizedUsers = result.data
        .map((item) => String(item["メールアドレス"] || "").trim().toLowerCase())
        .filter(Boolean);
      const loginEmail = String(user.email || "").trim().toLowerCase();
      if (!authorizedUsers.includes(loginEmail)) {
        this.toast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", "error");
        await this.logout();
        this.hideLoader();
        return;
      }

      this.setLoaderStep(2, this.isEmbedded ? "必要な権限を同期しています…" : "管理者権限の確認/付与…");
      try {
        await this.api.apiPost({ action: "ensureAdmin" });
      } catch (error) {
        console.warn("ensureAdmin non-fatal", error);
      }

      this.renderLoggedInUi(user);
      this.setLoaderStep(3, this.isEmbedded ? "初期データを準備しています…" : "初期ミラー実行中…");
      this.updateLoader("初期データを準備しています…");
      try {
        const snapshot = await get(questionsRef);
        if (!snapshot.exists()) {
          await this.api.apiPost({ action: "mirrorSheet" });
        }
      } catch (error) {
        console.warn("mirrorSheet skipped", error);
      }

      this.setLoaderStep(4, this.isEmbedded ? "リアルタイム購読を開始しています…" : "購読開始…");
      this.updateLoader("データ同期中…");
      const [questionsSnapshot, questionStatusSnapshot, eventsSnapshot, schedulesSnapshot] = await Promise.all([
        get(questionsRef),
        get(questionStatusRef),
        get(questionIntakeEventsRef),
        get(questionIntakeSchedulesRef)
      ]);
      this.eventsBranch = eventsSnapshot.val() || {};
      this.schedulesBranch = schedulesSnapshot.val() || {};
      this.applyQuestionsBranch(questionsSnapshot.val() || {});
      this.applyQuestionStatusSnapshot(questionStatusSnapshot.val() || {});
      this.rebuildScheduleMetadata();
      this.applyContextToState();
      this.startQuestionsStream();
      this.startQuestionStatusStream();
      this.startScheduleMetadataStreams();
      this.startDictionaryListener();
      this.startPickupListener();
      this.startDisplaySessionMonitor();
      this.setLoaderStep(5, this.isEmbedded ? "辞書データを取得しています…" : "辞書取得…");
      await this.fetchDictionary();
      if (this.preferredDictionaryOpen) {
        this.toggleDictionaryDrawer(true, false);
      } else {
        this.toggleDictionaryDrawer(false, false);
      }
      this.setLoaderStep(6, this.isEmbedded ? "操作ログを取得しています…" : "ログ取得…");
      await this.fetchLogs();
      if (this.preferredLogsOpen) {
        this.toggleLogsDrawer(true, false);
      } else {
        this.toggleLogsDrawer(false, false);
      }
      this.finishLoaderSteps("準備完了");
      this.hideLoader();
      this.toast(`ようこそ、${user.displayName || ""}さん`, "success");
      this.startLogsUpdateMonitor();
      this.resolveEmbedReady();
    } catch (error) {
      console.error("Authorization check failed:", error);
      this.toast("ユーザー権限の確認中にエラーが発生しました。", "error");
      await this.logout();
      this.hideLoader();
    }
  }

  renderLoggedInUi(user) {
    this.redirectingToIndex = false;
    if (this.dom.loginContainer) this.dom.loginContainer.style.display = "none";
    if (this.dom.mainContainer) {
      this.dom.mainContainer.style.display = "";
      this.dom.mainContainer.hidden = false;
    }
    if (this.dom.actionPanel) {
      this.dom.actionPanel.style.display = "flex";
      this.dom.actionPanel.hidden = false;
    }
    this.isAuthorized = true;
    if (this.dom.userInfo) {
      this.dom.userInfo.innerHTML = "";
      const label = document.createElement("span");
      label.className = "user-label";
      const safeDisplayName = String(user.displayName || "").trim();
      const safeEmail = String(user.email || "").trim();
      label.textContent = safeDisplayName && safeEmail ? `${safeDisplayName} (${safeEmail})` : safeDisplayName || safeEmail || "";
      const logoutButton = document.createElement("button");
      logoutButton.id = "logout-button";
      logoutButton.type = "button";
      logoutButton.textContent = "ログアウト";
      logoutButton.className = "btn btn-ghost btn-sm";
      logoutButton.addEventListener("click", () => this.logout());
      this.dom.userInfo.append(label, logoutButton);
      this.dom.userInfo.hidden = false;
    }
    this.applyPreferredSubTab();
  }

  showLoggedOutState() {
    if (this.redirectingToIndex) {
      return;
    }
    this.isAuthorized = false;
    this.dictionaryLoaded = false;
    this.toggleDictionaryDrawer(false, false);
    this.toggleLogsDrawer(false, false);
    this.cleanupRealtime();
    if (this.isEmbedded) {
      this.showLoader("サインイン状態を確認しています…");
    } else {
      this.hideLoader();
    }
    this.closeEditDialog();
    if (this.dom.loginContainer) {
      this.dom.loginContainer.style.display = this.isEmbedded ? "none" : "";
    }
    if (!this.isEmbedded && this.dom.loginButton) {
      this.dom.loginButton.disabled = false;
    }
    if (this.dom.mainContainer) {
      this.dom.mainContainer.style.display = "none";
    }
    if (this.dom.actionPanel) {
      this.dom.actionPanel.style.display = "none";
      this.dom.actionPanel.hidden = true;
    }
    if (this.dom.userInfo) {
      this.dom.userInfo.hidden = true;
      this.dom.userInfo.innerHTML = "";
    }
    if (typeof window !== "undefined" && !this.isEmbedded) {
      this.redirectingToIndex = true;
      window.location.replace("index.html");
    }
  }

  cleanupRealtime() {
    if (this.questionsUnsubscribe) {
      this.questionsUnsubscribe();
      this.questionsUnsubscribe = null;
    }
    if (this.displaySessionUnsubscribe) {
      this.displaySessionUnsubscribe();
      this.displaySessionUnsubscribe = null;
    }
    if (this.questionStatusUnsubscribe) {
      this.questionStatusUnsubscribe();
      this.questionStatusUnsubscribe = null;
    }
    if (this.updateTriggerUnsubscribe) {
      this.updateTriggerUnsubscribe();
      this.updateTriggerUnsubscribe = null;
    }
    if (this.eventsUnsubscribe) {
      this.eventsUnsubscribe();
      this.eventsUnsubscribe = null;
    }
    if (this.schedulesUnsubscribe) {
      this.schedulesUnsubscribe();
      this.schedulesUnsubscribe = null;
    }
    if (typeof this.stopDictionaryListener === "function") {
      this.stopDictionaryListener();
    }
    if (typeof this.stopPickupListener === "function") {
      this.stopPickupListener();
    }
    if (this.renderTicker) {
      clearInterval(this.renderTicker);
      this.renderTicker = null;
    }
    if (this.logsUpdateTimer) {
      clearTimeout(this.logsUpdateTimer);
      this.logsUpdateTimer = null;
    }
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    this.applyContextToState();
    if (this.dom.selectAllCheckbox) {
      this.dom.selectAllCheckbox.checked = false;
      this.dom.selectAllCheckbox.indeterminate = false;
    }
    document.querySelectorAll(".genre-tab-button").forEach((button, index) => {
      const isDefault = index === 0;
      button.classList.toggle("active", isDefault);
      button.setAttribute("aria-selected", String(isDefault));
    });
    document.querySelectorAll(".sub-tab-button").forEach((button) => {
      const isDefault = button.dataset.subTab === "all";
      button.classList.toggle("active", isDefault);
      button.setAttribute("aria-selected", String(isDefault));
    });
    if (this.dom.scheduleTimeRange) {
      this.dom.scheduleTimeRange.textContent = "";
      this.dom.scheduleTimeRange.hidden = true;
    }
    this.updateActionAvailability();
    this.updateBatchButtonVisibility();
    if (this.dom.cardsContainer) this.dom.cardsContainer.innerHTML = "";
    if (this.dom.logStream) this.dom.logStream.innerHTML = "";
    if (this.dom.dictionaryCardsContainer) this.dom.dictionaryCardsContainer.innerHTML = "";
    if (this.dom.pickupList) this.dom.pickupList.innerHTML = "";
    this.eventsBranch = {};
    this.schedulesBranch = {};
    this.dictionaryData = [];
    this.dictionaryEntries = [];
    this.dictionarySelectedId = "";
    this.dictionarySelectedEntry = null;
    if (this.dictionaryBatchSelection instanceof Set) {
      this.dictionaryBatchSelection.clear();
    } else {
      this.dictionaryBatchSelection = new Set();
    }
    if (this.dom.dictionarySelectAllCheckbox instanceof HTMLInputElement) {
      this.dom.dictionarySelectAllCheckbox.checked = false;
      this.dom.dictionarySelectAllCheckbox.indeterminate = false;
      this.dom.dictionarySelectAllCheckbox.disabled = true;
    }
    if (this.dom.dictionarySelectedInfo) {
      this.dom.dictionarySelectedInfo.textContent = "単語を選択してください";
    }
    if (this.dom.dictionaryActionPanel) {
      this.dom.dictionaryActionPanel.hidden = false;
      this.dom.dictionaryActionPanel.classList.add("is-idle");
    }
    if (this.dom.dictionaryCount) {
      this.dom.dictionaryCount.textContent = "登録なし";
    }
    this.dictionaryLoaded = false;
    this.pickupEntries = [];
    this.pickupLoaded = false;
    this.pickupActiveFilter = "all";
    if (this.dom.pickupEmpty) {
      this.dom.pickupEmpty.hidden = false;
    }
    if (this.dom.pickupAlert) {
      this.dom.pickupAlert.hidden = true;
      this.dom.pickupAlert.textContent = "";
    }
    if (typeof this.applyInitialPickupState === "function") {
      try {
        this.applyInitialPickupState();
      } catch (error) {
        console.debug("failed to reset pickup panel", error);
      }
    }
    this.updateScheduleContext();
  }

  startQuestionsStream() {
    if (this.questionsUnsubscribe) this.questionsUnsubscribe();
    this.questionsUnsubscribe = onValue(questionsRef, (snapshot) => {
      this.applyQuestionsBranch(snapshot.val());
    });
  }

  startQuestionStatusStream() {
    if (this.questionStatusUnsubscribe) this.questionStatusUnsubscribe();
    this.questionStatusUnsubscribe = onValue(questionStatusRef, (snapshot) => {
      this.applyQuestionStatusSnapshot(snapshot.val());
    });
  }

  applyQuestionsBranch(value) {
    const branch = value && typeof value === "object" ? value : {};
    const next = new Map();

    const mergeRecord = (uidKey, record, type) => {
      if (!record || typeof record !== "object") {
        return;
      }
      const resolvedUid = String(record.uid ?? uidKey ?? "").trim();
      if (!resolvedUid) {
        return;
      }
      const normalized = { ...record, uid: resolvedUid };
      if (type) {
        normalized.type = type;
      }
      if (type === "pickup" && normalized.pickup !== true) {
        normalized.pickup = true;
      }
      next.set(resolvedUid, normalized);
    };

    if (branch && (branch.normal || branch.pickup)) {
      const normal = branch.normal && typeof branch.normal === "object" ? branch.normal : {};
      const pickup = branch.pickup && typeof branch.pickup === "object" ? branch.pickup : {};
      Object.entries(normal).forEach(([uid, record]) => mergeRecord(uid, record, "normal"));
      Object.entries(pickup).forEach(([uid, record]) => mergeRecord(uid, record, "pickup"));
    } else {
      Object.entries(branch).forEach(([uid, record]) => mergeRecord(uid, record, record?.type));
    }

    this.state.questionsByUid = next;
    this.rebuildQuestions();
  }

  applyQuestionStatusSnapshot(value) {
    const branch = value && typeof value === "object" ? value : {};
    const next = new Map();
    Object.entries(branch).forEach(([uidKey, record]) => {
      if (!record || typeof record !== "object") {
        return;
      }
      const resolvedUid = String(record.uid ?? uidKey ?? "").trim();
      if (!resolvedUid) {
        return;
      }
      next.set(resolvedUid, {
        answered: record.answered === true,
        selecting: record.selecting === true,
        pickup: record.pickup === true,
        updatedAt: Number(record.updatedAt || 0)
      });
    });
    this.state.questionStatusByUid = next;
    this.rebuildQuestions();
  }

  normalizeQuestionRecord(item) {
    const record = item && typeof item === "object" ? item : {};
    const eventId = String(record.eventId ?? "").trim();
    const scheduleId = String(record.scheduleId ?? "").trim();
    const fallbackLabel = String(record.scheduleLabel ?? record.schedule ?? "").trim();
    let scheduleKey = "";
    if (eventId && scheduleId) {
      scheduleKey = `${eventId}::${scheduleId}`;
    } else if (scheduleId) {
      scheduleKey = scheduleId;
    } else if (fallbackLabel) {
      scheduleKey = fallbackLabel;
    }
    const scheduleMap = this.state.scheduleMetadata instanceof Map ? this.state.scheduleMetadata : null;
    const scheduleMeta = scheduleKey && scheduleMap ? scheduleMap.get(scheduleKey) : null;
    const eventsMap = this.state.eventsById instanceof Map ? this.state.eventsById : null;
    const eventNameFromMap = eventId && eventsMap ? String(eventsMap.get(eventId)?.name || "").trim() : "";
    const metaLabel = scheduleMeta ? String(scheduleMeta.label || "").trim() : "";
    const metaEventName = scheduleMeta ? String(scheduleMeta.eventName || "").trim() : "";
    const metaStart = scheduleMeta ? String(scheduleMeta.startAt || "").trim() : "";
    const metaEnd = scheduleMeta ? String(scheduleMeta.endAt || "").trim() : "";
    const rawStart = String(record.scheduleStart ?? "").trim();
    const rawEnd = String(record.scheduleEnd ?? "").trim();
    const label = metaLabel || fallbackLabel || scheduleId || "";
    const eventName = metaEventName || eventNameFromMap || String(record.eventName ?? "").trim();
    const startAt = metaStart || rawStart;
    const endAt = metaEnd || rawEnd;

    return {
      UID: record.uid,
      班番号: record.group ?? "",
      ラジオネーム: record.name,
      "質問・お悩み": record.question,
      ジャンル: resolveGenreLabel(record.genre),
      イベントID: eventId,
      イベント名: eventName,
      日程ID: scheduleId,
      日程: scheduleKey || label,
      日程表示: label,
      開始日時: startAt,
      終了日時: endAt,
      参加者ID: record.participantId ?? "",
      回答済: !!record.answered,
      選択中: !!record.selecting,
      ピックアップ: !!record.pickup,
      __ts: Number(record.ts || 0),
      __scheduleKey: scheduleKey || "",
      __scheduleLabel: label,
      __scheduleStart: startAt,
      __scheduleEnd: endAt
    };
  }

  rebuildQuestions() {
    const questionMap = this.state.questionsByUid instanceof Map ? this.state.questionsByUid : new Map();
    const statusMap = this.state.questionStatusByUid instanceof Map ? this.state.questionStatusByUid : new Map();
    const list = [];
    questionMap.forEach((record, uid) => {
      const status = statusMap.get(uid) || {};
      list.push(this.normalizeQuestionRecord({ ...record, ...status, uid }));
    });
    this.state.allQuestions = list;
    this.updateScheduleContext();
    this.renderQuestions();
  }

  rebuildScheduleMetadata() {
    const eventsValue = this.eventsBranch && typeof this.eventsBranch === "object" ? this.eventsBranch : {};
    const schedulesValue = this.schedulesBranch && typeof this.schedulesBranch === "object" ? this.schedulesBranch : {};
    const eventsMap = new Map();
    Object.entries(eventsValue).forEach(([eventId, eventValue]) => {
      const id = String(eventId);
      eventsMap.set(id, {
        id,
        name: String(eventValue?.name || "").trim(),
        raw: eventValue
      });
    });
    const scheduleMap = new Map();
    Object.entries(schedulesValue).forEach(([eventId, scheduleBranch]) => {
      if (!scheduleBranch || typeof scheduleBranch !== "object") return;
      const eventKey = String(eventId);
      const eventName = String(eventsMap.get(eventKey)?.name || "").trim();
      Object.entries(scheduleBranch).forEach(([scheduleId, scheduleValue]) => {
        const scheduleKey = `${eventKey}::${String(scheduleId)}`;
        const labelValue = String(scheduleValue?.label || "").trim();
        const dateValue = String(scheduleValue?.date || "").trim();
        const startValue = String(scheduleValue?.startAt || "").trim();
        const endValue = String(scheduleValue?.endAt || "").trim();
        scheduleMap.set(scheduleKey, {
          key: scheduleKey,
          eventId: eventKey,
          scheduleId: String(scheduleId),
          eventName,
          label: labelValue || dateValue || String(scheduleId),
          date: dateValue,
          startAt: startValue,
          endAt: endValue,
          raw: scheduleValue
        });
      });
    });
    this.state.eventsById = eventsMap;
    this.state.scheduleMetadata = scheduleMap;
    this.rebuildQuestions();
  }

  startScheduleMetadataStreams() {
    if (this.eventsUnsubscribe) this.eventsUnsubscribe();
    this.eventsUnsubscribe = onValue(questionIntakeEventsRef, (snapshot) => {
      this.eventsBranch = snapshot.val() || {};
      this.rebuildScheduleMetadata();
    });
    if (this.schedulesUnsubscribe) this.schedulesUnsubscribe();
    this.schedulesUnsubscribe = onValue(questionIntakeSchedulesRef, (snapshot) => {
      this.schedulesBranch = snapshot.val() || {};
      this.rebuildScheduleMetadata();
    });
  }

  startDisplaySessionMonitor() {
    if (this.displaySessionUnsubscribe) this.displaySessionUnsubscribe();
    this.displaySessionUnsubscribe = onValue(
      displaySessionRef,
      (snapshot) => {
        const data = snapshot.val() || null;
        const now = Date.now();
        const expiresAt = Number(data && data.expiresAt) || 0;
        const status = String((data && data.status) || "");
        const active = !!data && status === "active" && (!expiresAt || expiresAt > now);
        this.state.displaySession = data;
        this.state.displaySessionActive = active;
        if (this.state.displaySessionLastActive !== null && this.state.displaySessionLastActive !== active) {
          this.toast(active ? "送出端末とのセッションが確立されました。" : "送出端末の接続が確認できません。", active ? "success" : "error");
        }
        this.state.displaySessionLastActive = active;
        this.updateActionAvailability();
        this.updateBatchButtonVisibility();
        this.renderQuestions();
      },
      (error) => {
        console.error("Failed to monitor display session:", error);
      }
    );
  }

  updateCopyrightYear() {
    if (!this.dom.copyrightYear) return;
    const currentYear = new Date().getFullYear();
    if (currentYear <= 2025) {
      this.dom.copyrightYear.textContent = "2025";
    } else {
      this.dom.copyrightYear.textContent = `2025 - ${currentYear}`;
    }
  }
}

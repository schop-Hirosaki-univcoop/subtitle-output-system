import {
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  onValue,
  get,
  questionsRef,
  questionIntakeEventsRef,
  questionIntakeSchedulesRef,
  displaySessionRef,
  renderRef
} from "./firebase.js";
import { queryDom } from "./dom.js";
import { createInitialState } from "./state.js";
import { createApiClient } from "./api-client.js";
import { showToast } from "./toast.js";
import * as Dictionary from "./dictionary.js";
import * as Logs from "./logs.js";
import * as Questions from "./questions.js";
import * as Display from "./display.js";
import * as Dialog from "./dialog.js";
import * as Loader from "./loader.js";
import { resolveGenreLabel } from "./utils.js";

export class OperatorApp {
  constructor() {
    this.dom = queryDom();
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    this.pageContext = this.extractPageContext();
    this.applyContextToState();
    this.api = createApiClient(auth, onAuthStateChanged);

    this.lastUpdatedAt = 0;
    this.renderTicker = null;
    this.questionsUnsubscribe = null;
    this.displaySessionUnsubscribe = null;
    this.updateTriggerUnsubscribe = null;
    this.renderUnsubscribe = null;
    this.logsUpdateTimer = null;
    this.eventsUnsubscribe = null;
    this.schedulesUnsubscribe = null;
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

    this.fetchDictionary = () => Dictionary.fetchDictionary(this);
    this.applyInitialDictionaryState = () => Dictionary.applyInitialDictionaryState(this);
    this.toggleDictionaryDrawer = (force, persist = true) => Dictionary.toggleDictionaryDrawer(this, force, persist);
    this.addTerm = (event) => Dictionary.addTerm(this, event);

    this.fetchLogs = () => Logs.fetchLogs(this);
    this.renderLogs = () => Logs.renderLogs(this);
    this.applyLogFilters = (logs) => Logs.applyLogFilters(this, logs);
    this.renderLogsStream = (rows) => Logs.renderLogsStream(this, rows);
    this.applyInitialLogsState = () => Logs.applyInitialLogsState(this);
    this.toggleLogsDrawer = (force, persist = true) => Logs.toggleLogsDrawer(this, force, persist);
    this.startLogsUpdateMonitor = () => Logs.startLogsUpdateMonitor(this);

    this.renderQuestions = () => Questions.renderQuestions(this);
    this.updateScheduleContext = () => Questions.updateScheduleContext(this);
    this.switchSubTab = (tabName) => Questions.switchSubTab(this, tabName);
    this.switchGenre = (genre) => Questions.switchGenre(this, genre);
    this.handleDisplay = () => Questions.handleDisplay(this);
    this.handleUnanswer = () => Questions.handleUnanswer(this);
    this.handleSelectAll = (event) => Questions.handleSelectAll(this, event);
    this.handleBatchUnanswer = () => Questions.handleBatchUnanswer(this);
    this.clearTelop = () => Questions.clearTelop(this);
    this.updateActionAvailability = () => Questions.updateActionAvailability(this);
    this.updateBatchButtonVisibility = () => Questions.updateBatchButtonVisibility(this);
    this.syncSelectAllState = () => Questions.syncSelectAllState(this);

    this.handleRenderUpdate = (snapshot) => Display.handleRenderUpdate(this, snapshot);
    this.redrawUpdatedAt = () => Display.redrawUpdatedAt(this);
    this.refreshStaleness = () => Display.refreshStaleness(this);

    this.openDialog = (element, focusTarget) => Dialog.openDialog(this, element, focusTarget);
    this.closeEditDialog = () => Dialog.closeEditDialog(this);
    this.handleDialogKeydown = (event) => Dialog.handleDialogKeydown(this, event);
    this.handleEdit = () => Dialog.handleEdit(this);
    this.handleEditSubmit = () => Dialog.handleEditSubmit(this);

    this.showLoader = (message) => Loader.showLoader(this, message);
    this.updateLoader = (message) => Loader.updateLoader(this, message);
    this.hideLoader = () => Loader.hideLoader(this);
    this.initLoaderSteps = () => Loader.initLoaderSteps(this);
    this.setLoaderStep = (step, message) => Loader.setLoaderStep(this, step, message);
    this.finishLoaderSteps = (message) => Loader.finishLoaderSteps(this, message);
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
    this.dom.loginButton?.addEventListener("click", () => this.login());
    document.querySelectorAll(".sub-tab-button").forEach((button) => {
      button.addEventListener("click", () => this.switchSubTab(button.dataset.subTab));
    });
    document.querySelectorAll(".genre-tab-button").forEach((button) => {
      button.addEventListener("click", () => this.switchGenre(button.dataset.genre));
    });
    this.dom.dictionaryToggle?.addEventListener("click", () => this.toggleDictionaryDrawer());
    this.dom.logsToggle?.addEventListener("click", () => this.toggleLogsDrawer());
    this.dom.logsRefreshButton?.addEventListener("click", () => this.fetchLogs());
    this.dom.actionButtons[0]?.addEventListener("click", () => this.handleDisplay());
    this.dom.actionButtons[1]?.addEventListener("click", () => this.handleUnanswer());
    this.dom.actionButtons[2]?.addEventListener("click", () => this.handleEdit());
    this.dom.clearButton?.addEventListener("click", () => this.clearTelop());
    this.dom.fetchDictionaryButton?.addEventListener("click", () => this.fetchDictionary());
    this.dom.addTermForm?.addEventListener("submit", (event) => this.addTerm(event));
    this.dom.selectAllCheckbox?.addEventListener("change", (event) => this.handleSelectAll(event));
    this.dom.batchUnanswerBtn?.addEventListener("click", () => this.handleBatchUnanswer());
    if (this.dom.editDialog) {
      this.dom.editDialog.addEventListener("click", (event) => {
        if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
          event.preventDefault();
          this.closeEditDialog();
        }
      });
    }
    this.dom.editCancelButton?.addEventListener("click", () => this.closeEditDialog());
    this.dom.editSaveButton?.addEventListener("click", () => this.handleEditSubmit());
    this.dom.cardsContainer?.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.classList.contains("row-checkbox")) {
        this.syncSelectAllState();
        this.updateBatchButtonVisibility();
      }
    });
    if (this.dom.logSearch) {
      this.dom.logSearch.addEventListener("input", () => this.renderLogs());
    }
    if (this.dom.logAutoscroll) {
      this.dom.logAutoscroll.addEventListener("change", (event) => {
        this.state.autoScrollLogs = event.target.checked;
      });
    }
    this.setupConfirmDialog();
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
      this.showLoader("権限を確認しています…");
      this.initLoaderSteps();
      this.setLoaderStep(0, "認証OK。ユーザー情報を確認中…");
      const result = await this.api.apiPost({ action: "fetchSheet", sheet: "users" });
      this.setLoaderStep(1, "在籍チェック中…");
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

      this.setLoaderStep(2, "管理者権限の確認/付与…");
      try {
        await this.api.apiPost({ action: "ensureAdmin" });
      } catch (error) {
        console.warn("ensureAdmin non-fatal", error);
      }

      this.renderLoggedInUi(user);
      this.setLoaderStep(3, "初期ミラー実行中…");
      this.updateLoader("初期データを準備しています…");
      try {
        const snapshot = await get(questionsRef);
        if (!snapshot.exists()) {
          await this.api.apiPost({ action: "mirrorSheet" });
        }
      } catch (error) {
        console.warn("mirrorSheet skipped", error);
      }

      this.setLoaderStep(4, "購読開始…");
      this.updateLoader("データ同期中…");
      const [questionsSnapshot, eventsSnapshot, schedulesSnapshot] = await Promise.all([
        get(questionsRef),
        get(questionIntakeEventsRef),
        get(questionIntakeSchedulesRef)
      ]);
      this.eventsBranch = eventsSnapshot.val() || {};
      this.schedulesBranch = schedulesSnapshot.val() || {};
      const questionsValue = questionsSnapshot.val() || {};
      this.state.rawQuestions = Object.values(questionsValue).filter((item) => item && typeof item === "object");
      this.rebuildScheduleMetadata();
      this.startQuestionsStream();
      this.startScheduleMetadataStreams();
      this.startDisplaySessionMonitor();
      this.setLoaderStep(5, "辞書取得…");
      await this.fetchDictionary();
      if (this.preferredDictionaryOpen) {
        this.toggleDictionaryDrawer(true, false);
      } else {
        this.toggleDictionaryDrawer(false, false);
      }
      this.setLoaderStep(6, "ログ取得…");
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
    } catch (error) {
      console.error("Authorization check failed:", error);
      this.toast("ユーザー権限の確認中にエラーが発生しました。", "error");
      await this.logout();
      this.hideLoader();
    }
  }

  renderLoggedInUi(user) {
    if (this.dom.loginContainer) this.dom.loginContainer.style.display = "none";
    if (this.dom.mainContainer) this.dom.mainContainer.style.display = "";
    if (this.dom.actionPanel) this.dom.actionPanel.style.display = "flex";
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
    }
    this.applyPreferredSubTab();
  }

  showLoggedOutState() {
    if (this.dom.loginContainer) this.dom.loginContainer.style.display = "block";
    if (this.dom.mainContainer) this.dom.mainContainer.style.display = "none";
    if (this.dom.actionPanel) this.dom.actionPanel.style.display = "none";
    if (this.dom.userInfo) this.dom.userInfo.innerHTML = "";
    this.isAuthorized = false;
    this.dictionaryLoaded = false;
    this.toggleDictionaryDrawer(false, false);
    this.toggleLogsDrawer(false, false);
    this.cleanupRealtime();
    this.hideLoader();
    this.closeEditDialog();
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
    this.eventsBranch = {};
    this.schedulesBranch = {};
    this.updateScheduleContext();
  }

  startQuestionsStream() {
    if (this.questionsUnsubscribe) this.questionsUnsubscribe();
    this.questionsUnsubscribe = onValue(questionsRef, (snapshot) => {
      const value = snapshot.val() || {};
      this.state.rawQuestions = Object.values(value).filter((item) => item && typeof item === "object");
      this.rebuildQuestions();
    });
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
    const list = Array.isArray(this.state.rawQuestions) ? this.state.rawQuestions : [];
    this.state.allQuestions = list.map((item) => this.normalizeQuestionRecord(item));
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

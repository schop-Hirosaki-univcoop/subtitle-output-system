import { queryDom } from "./dom.js";
import {
  database,
  ref,
  get,
  set,
  update,
  auth,
  signOut,
  onAuthStateChanged
} from "../operator/firebase.js";
import { createApiClient } from "../operator/api-client.js";
import { generateShortId, normalizeKey, toMillis } from "../question-admin/utils.js";
import { formatRelative, formatScheduleRange } from "../operator/utils.js";
import { LoadingTracker } from "./loading-tracker.js";
import {
  ensureString,
  formatDateTimeLocal,
  buildContextDescription,
  logError,
  formatParticipantCount,
  collectParticipantTokens
} from "./helpers.js";
import {
  STAGE_SEQUENCE,
  STAGE_INFO,
  PANEL_CONFIG,
  PANEL_STAGE_INFO,
  FOCUSABLE_SELECTOR
} from "./config.js";
import { ToolCoordinator } from "./tool-coordinator.js";
import { EventChat } from "./chat.js";

function parseCssPixels(value) {
  if (typeof value !== "string") {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class EventAdminApp {
  constructor() {
    this.dom = queryDom();
    this.api = createApiClient(auth, onAuthStateChanged);
    this.authUnsubscribe = null;
    this.currentUser = null;
    this.events = [];
    this.selectedEventId = "";
    this.schedules = [];
    this.selectedScheduleId = "";
    this.selectionListeners = new Set();
    this.eventListeners = new Set();
    this.participantHostInterface = null;
    this.suppressSelectionNotifications = false;
    this.lastSelectionSignature = "";
    this.lastSelectionSource = "";
    this.forceSelectionBroadcast = true;
    this.stage = "events";
    this.stageHistory = new Set(["events"]);
    this.activePanel = "events";
    this.activeDialog = null;
    this.lastFocused = null;
    this.confirmResolver = null;
    this.redirectingToIndex = false;
    this.eventsLoadingTracker = new LoadingTracker({
      onChange: (state) => this.applyEventsLoadingState(state)
    });
    this.scheduleLoadingTracker = new LoadingTracker({
      onChange: (state) => this.applyScheduleLoadingState(state)
    });
    this.tools = new ToolCoordinator(this);
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
    this.cleanup = this.cleanup.bind(this);
    this.eventCountNote = "";
    this.stageNote = "";
    this.applyMetaNote();
    this.chat = new EventChat(this);
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.updateChatLayoutMetrics = this.updateChatLayoutMetrics.bind(this);
    this.chatLayoutResizeObserver = null;
    this.chatLayoutRaf = 0;
    this.visualViewportResize = null;
    this.activeMobilePanel = "";
    this.lastMobileFocus = null;
    this.handleMobileKeydown = this.handleMobileKeydown.bind(this);
  }

  logParticipantAction(message, detail = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[Participants] ${timestamp} ${message}`;
    if (detail && typeof detail === "object" && Object.keys(detail).length > 0) {
      console.info(prefix, detail);
    } else {
      console.info(prefix);
    }
  }

  init() {
    if (auth && auth.currentUser) {
      this.currentUser = auth.currentUser;
      this.updateUserLabel();
    }
    this.bindEvents();
    this.applyEventsLoadingState();
    this.applyScheduleLoadingState();
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateEventSummary();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    this.updateSelectionNotes();
    this.applyMetaNote();
    this.chat.init();
    this.setupChatLayoutObservers();
    this.observeAuthState();
    if (typeof document !== "undefined") {
      document.addEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.addEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", this.cleanup, { once: true });
    }
  }

  resetFlowState() {
    this.selectedEventId = "";
    this.schedules = [];
    this.selectedScheduleId = "";
    this.stage = "events";
    this.stageHistory = new Set(["events"]);
    this.activePanel = "events";
    this.eventsLoadingTracker.reset();
    this.scheduleLoadingTracker.reset();
    this.eventCountNote = "";
    this.stageNote = "";
    this.forceSelectionBroadcast = true;
    this.tools.resetFlowState();
    this.applyMetaNote();
    this.applyEventsLoadingState();
    this.applyScheduleLoadingState();
    this.renderEvents();
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateEventSummary();
    this.updateStageHeader();
    this.updateStageUi();
    this.updateFlowButtons();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    this.updateSelectionNotes();
  }

  bindEvents() {
    if (this.dom.addEventButton) {
      this.dom.addEventButton.addEventListener("click", () => this.openEventDialog({ mode: "create" }));
    }

    if (this.dom.refreshButton) {
      this.dom.refreshButton.addEventListener("click", async () => {
        if (this.dom.refreshButton.disabled) {
          return;
        }
        this.dom.refreshButton.disabled = true;
        try {
          this.beginEventsLoading("イベント情報を再読み込みしています…");
          await this.loadEvents();
        } catch (error) {
          logError("Failed to refresh events", error);
          this.showAlert(error.message || "イベントの再読み込みに失敗しました。");
        } finally {
          this.endEventsLoading();
          this.dom.refreshButton.disabled = false;
        }
      });
    }

    if (this.dom.logoutButton) {
      this.dom.logoutButton.addEventListener("click", () => {
        this.handleLogoutClick().catch((error) => {
          logError("Failed to handle logout", error);
        });
      });
    }

    (this.dom.panelButtons || []).forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.panelTarget || "";
        this.showPanel(target);
      });
    });

    (this.dom.navigationButtons || []).forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) {
          return;
        }
        const target = button.dataset.flowNavTarget || "";
        if (!target) {
          return;
        }
        this.showPanel(target);
      });
    });

    if (this.dom.eventForm) {
      this.dom.eventForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleEventFormSubmit().catch((error) => {
          logError("Event form submit failed", error);
          this.setFormError(this.dom.eventError, error.message || "イベントの保存に失敗しました。");
        });
      });
    }

    if (this.dom.scheduleForm) {
      this.dom.scheduleForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleScheduleFormSubmit().catch((error) => {
          logError("Schedule form submit failed", error);
          this.setFormError(this.dom.scheduleError, error.message || "日程の保存に失敗しました。");
        });
      });
    }

    this.bindDialogDismiss(this.dom.eventDialog);
    this.bindDialogDismiss(this.dom.scheduleDialog);
    this.bindDialogDismiss(this.dom.confirmDialog);

    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.addEventListener("click", () => {
        this.resolveConfirm(true);
      });
    }

    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.addEventListener("click", () => {
        this.resolveConfirm(false);
      });
    }

    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.addEventListener("click", () => this.openScheduleDialog({ mode: "create" }));
    }

    if (this.dom.scheduleRefreshButton) {
      this.dom.scheduleRefreshButton.addEventListener("click", async () => {
        if (this.dom.scheduleRefreshButton.disabled) {
          return;
        }
        this.dom.scheduleRefreshButton.disabled = true;
        try {
          await this.reloadSchedules();
        } catch (error) {
          logError("Failed to refresh schedules", error);
          this.showAlert(error.message || "日程の再読み込みに失敗しました。");
        } finally {
          this.dom.scheduleRefreshButton.disabled = false;
        }
      });
    }

    (this.dom.mobileToggleButtons || []).forEach((button) => {
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        const target = button.dataset.mobileTarget || "";
        this.toggleMobilePanel(target);
      });
    });

    (this.dom.mobileCloseButtons || []).forEach((button) => {
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        this.closeMobilePanel();
      });
    });

    if (this.dom.mobileOverlay) {
      this.dom.mobileOverlay.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        if (target === this.dom.mobileOverlay || target.closest("[data-mobile-overlay-dismiss]")) {
          this.closeMobilePanel();
        }
      });
    }
  }

  async handleLogoutClick() {
    if (this.dom.logoutButton) {
      this.dom.logoutButton.disabled = true;
    }
    try {
      await signOut(auth);
    } catch (error) {
      logError("Sign-out failed", error);
      this.showAlert("ログアウトに失敗しました。時間をおいて再度お試しください。");
      if (this.dom.logoutButton) {
        this.dom.logoutButton.disabled = false;
      }
    }
  }

  observeAuthState() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
    this.authUnsubscribe = onAuthStateChanged(auth, (user) => {
      this.handleAuthState(user).catch((error) => {
        logError("Failed to handle event admin auth state", error);
        this.showAlert(error.message || "初期化に失敗しました。時間をおいて再度お試しください。");
      });
    });
  }

  showLoggedOutState() {
    if (this.redirectingToIndex) {
      return;
    }
    this.resetFlowState();
    this.endEventsLoading();
    this.updateUserLabel();
    if (typeof window !== "undefined") {
      this.redirectingToIndex = true;
      window.location.replace("index.html");
    }
  }

  showLoggedInState() {
    if (this.dom.main) {
      this.dom.main.hidden = false;
    }
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateSelectionNotes();
  }

  beginEventsLoading(message = "") {
    this.eventsLoadingTracker.begin(message);
  }

  endEventsLoading() {
    this.eventsLoadingTracker.end();
  }

  updateEventsLoadingMessage(message = "") {
    this.eventsLoadingTracker.updateMessage(message);
  }

  applyEventsLoadingState(state = this.eventsLoadingTracker.getState()) {
    const { active, message } = state;
    if (this.dom.loading) {
      this.dom.loading.hidden = !active;
    }
    if (this.dom.loadingText) {
      this.dom.loadingText.textContent = active ? message || "" : "";
    }
  }

  clearAlert() {
    if (this.dom.alert) {
      this.dom.alert.hidden = true;
      this.dom.alert.textContent = "";
    }
  }

  showAlert(message) {
    if (this.dom.alert) {
      this.dom.alert.hidden = false;
      this.dom.alert.textContent = message;
    }
  }

  async handleAuthState(user) {
    this.currentUser = user;
    this.chat.handleAuthChange(user);
    this.updateUserLabel();
    if (!user) {
      this.events = [];
      this.renderEvents();
      this.notifyEventListeners();
      this.notifySelectionListeners("host");
      this.clearAlert();
      this.showLoggedOutState();
      return;
    }

    this.showLoggedInState();
    this.clearAlert();

    try {
      this.beginEventsLoading("権限を確認しています…");
      await this.ensureAdminAccess();
      this.updateEventsLoadingMessage("イベント情報を読み込んでいます…");
      await this.loadEvents();
      this.updateEventSummary();
      this.updateScheduleSummary();
      this.updateStageHeader();
      this.updateSelectionNotes();
      this.tools.preloadOperatorGlobals();
    } catch (error) {
      logError("Event admin initialization failed", error);
      if (this.isPermissionError(error)) {
        const message =
          (error instanceof Error && error.message) ||
          "アクセス権限がありません。管理者に確認してください。";
        this.showAlert(message);
        await this.safeSignOut();
        return;
      }
      const fallback = "イベント情報の読み込みに失敗しました。時間をおいて再度お試しください。";
      const message = error instanceof Error && error.message ? error.message : fallback;
      this.showAlert(message || fallback);
    } finally {
      this.endEventsLoading();
      this.clearLoadingIndicators();
    }
  }

  async ensureAdminAccess() {
    if (!this.api) {
      return;
    }
    try {
      await this.api.apiPost({ action: "ensureAdmin" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error || "");
      let message = "権限の確認に失敗しました。時間をおいて再度お試しください。";
      if (/not in users sheet/i.test(rawMessage)) {
        message = "あなたのアカウントにはこのページへのアクセス権限がありません。管理者に確認してください。";
      }
      const err = new Error(message);
      err.code = "EVENT_INDEX_ACCESS_DENIED";
      err.cause = error;
      throw err;
    }
  }

  async safeSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Failed to sign out after permission error:", error);
    }
  }

  isPermissionError(error) {
    if (!error) return false;
    if (error.code === "EVENT_INDEX_ACCESS_DENIED") return true;
    const code = typeof error.code === "string" ? error.code : "";
    if (code.includes("PERMISSION")) return true;
    const message = error instanceof Error ? error.message : String(error || "");
    return /permission/i.test(message) || message.includes("権限");
  }

  async loadEvents() {
    const [eventsSnapshot, schedulesSnapshot] = await Promise.all([
      get(ref(database, "questionIntake/events")),
      get(ref(database, "questionIntake/schedules"))
    ]);

    const eventsValue = eventsSnapshot.exists() ? eventsSnapshot.val() : {};
    const schedulesTree = schedulesSnapshot.exists() ? schedulesSnapshot.val() : {};

    const normalized = Object.entries(eventsValue).map(([eventId, eventValue]) => {
      const scheduleBranch = schedulesTree?.[eventId] && typeof schedulesTree[eventId] === "object"
        ? schedulesTree[eventId]
        : {};
      const schedules = Object.entries(scheduleBranch).map(([scheduleId, scheduleValue]) => ({
        id: ensureString(scheduleId),
        label: ensureString(scheduleValue?.label),
        date: ensureString(scheduleValue?.date || ""),
        startAt: ensureString(scheduleValue?.startAt || scheduleValue?.date),
        endAt: ensureString(scheduleValue?.endAt || ""),
        participantCount: Number(scheduleValue?.participantCount || 0),
        createdAt: scheduleValue?.createdAt || 0
      }));

      schedules.sort((a, b) => {
        const startDiff = toMillis(a.startAt || a.createdAt) - toMillis(b.startAt || b.createdAt);
        if (startDiff !== 0) return startDiff;
        return a.id.localeCompare(b.id, "ja", { numeric: true });
      });

      const totalParticipants = schedules.reduce((acc, item) => acc + (item.participantCount || 0), 0);

      return {
        id: ensureString(eventId),
        name: ensureString(eventValue?.name) || ensureString(eventId),
        schedules,
        totalParticipants,
        scheduleCount: schedules.length,
        createdAt: eventValue?.createdAt || 0,
        updatedAt: eventValue?.updatedAt || 0
      };
    });

    normalized.sort((a, b) => {
      const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });

    const previousEventId = this.selectedEventId;
    const previousScheduleId = this.selectedScheduleId;

    this.events = normalized;
    this.tools.resetContext();
    this.updateMetaNote();
    this.updateDocumentTitle();
    this.ensureSelectedEvent(previousEventId);
    this.renderEvents();
    this.updateScheduleStateFromSelection(previousScheduleId);

    if (this.stage === "tabs") {
      const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
      if (activeConfig.requireSchedule && this.selectedEventId && this.selectedScheduleId) {
        this.tools.syncEmbeddedTools().catch((error) => logError("Failed to sync tools after refresh", error));
      }
    }

    const eventChanged = previousEventId !== this.selectedEventId;
    const scheduleChanged = previousScheduleId !== this.selectedScheduleId;
    if (eventChanged || scheduleChanged) {
      this.notifySelectionListeners("host");
    }
    this.notifyEventListeners();

    return this.events;
  }

  renderEvents() {
    const list = this.dom.eventList;
    if (!list) return;

    list.innerHTML = "";
    if (!this.events.length) {
      list.hidden = true;
      if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = false;
      list.removeAttribute("role");
      list.removeAttribute("aria-label");
      list.removeAttribute("aria-orientation");
      return;
    }

    list.hidden = false;
    if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = true;

    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "イベント一覧");
    list.setAttribute("aria-orientation", "vertical");
    const fragment = document.createDocumentFragment();
    this.events.forEach((event) => {
      const item = document.createElement("li");
      item.className = "entity-item";
      item.dataset.eventId = event.id;
      item.setAttribute("role", "option");

      const isSelected = event.id === this.selectedEventId && this.selectedEventId;
      if (isSelected) {
        item.classList.add("is-selected");
        item.setAttribute("aria-selected", "true");
      } else {
        item.setAttribute("aria-selected", "false");
      }
      item.tabIndex = 0;

      const indicator = document.createElement("span");
      indicator.className = "entity-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const indicatorDot = document.createElement("span");
      indicatorDot.className = "entity-indicator__dot";
      indicator.appendChild(indicatorDot);

      const label = document.createElement("div");
      label.className = "entity-label";

      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = event.name || event.id;

      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      metaEl.textContent = `日程 ${event.scheduleCount} 件 / 参加者 ${formatParticipantCount(event.totalParticipants)}`;

      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "entity-action entity-action--edit";
      editBtn.setAttribute("aria-label", `${event.name || event.id} を編集`);
      editBtn.title = "イベントを編集";
      editBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z" fill="currentColor"/></svg></span><span class="entity-action__label">編集</span>';
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openEventDialog({ mode: "edit", event });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "entity-action entity-action--delete";
      deleteBtn.setAttribute("aria-label", `${event.name || event.id} を削除`);
      deleteBtn.title = "イベントを削除";
      deleteBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z"/></svg></span><span class="entity-action__label">削除</span>';
      deleteBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.deleteEvent(event).catch((error) => {
          logError("Failed to delete event", error);
          this.showAlert(error.message || "イベントの削除に失敗しました。");
        });
      });
      actions.appendChild(deleteBtn);

      item.append(indicator, label, actions);

      item.addEventListener("click", () => {
        this.selectEvent(event.id);
      });
      item.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          this.selectEvent(event.id);
        }
      });

      fragment.appendChild(item);
    });

    list.appendChild(fragment);
  }

  ensureSelectedEvent(preferredId = "") {
    const availableIds = new Set(this.events.map((event) => event.id));
    const desiredId = preferredId || this.selectedEventId;
    if (desiredId && availableIds.has(desiredId)) {
      this.selectedEventId = desiredId;
    } else {
      this.selectedEventId = "";
    }
  }

  getSelectedEvent() {
    if (!this.selectedEventId) return null;
    return this.events.find((event) => event.id === this.selectedEventId) || null;
  }

  selectEvent(eventId) {
    const previous = this.selectedEventId;
    const normalized = ensureString(eventId);
    this.logParticipantAction("イベント選択リクエストを受信しました", {
      requestedEventId: normalized || "",
      previousEventId: previous || "",
      totalEvents: this.events.length
    });
    if (normalized && !this.events.some((event) => event.id === normalized)) {
      this.logParticipantAction("指定されたイベントが見つからないため選択を維持します", {
        requestedEventId: normalized
      });
      return;
    }

    this.selectedEventId = normalized;
    const changed = previous !== normalized;
    if (changed) {
      this.logParticipantAction("イベント選択を更新しました", {
        eventId: normalized || "",
        previousEventId: previous || ""
      });
      this.tools.resetContext();
    } else {
      this.logParticipantAction("イベント選択は既に最新の状態です", {
        eventId: normalized || ""
      });
    }
    this.renderEvents();
    this.updateScheduleStateFromSelection();
    this.updateEventSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.tools.prepareContextForSelection();
    if (changed) {
      this.notifySelectionListeners("host");
    }
  }

  ensureSelectedSchedule(preferredId = "") {
    const availableIds = new Set(this.schedules.map((schedule) => schedule.id));
    const desiredId = preferredId || this.selectedScheduleId;
    if (desiredId && availableIds.has(desiredId)) {
      this.selectedScheduleId = desiredId;
      this.logParticipantAction("利用可能な日程選択を維持しました", {
        scheduleId: this.selectedScheduleId,
        preferredScheduleId: preferredId || ""
      });
    } else {
      const previousScheduleId = this.selectedScheduleId;
      this.selectedScheduleId = "";
      this.tools.resetContext({ clearDataset: true });
      this.logParticipantAction("利用可能な日程が見つからないため選択をクリアしました", {
        previousScheduleId: previousScheduleId || "",
        preferredScheduleId: preferredId || ""
      });
    }
  }

  getSelectedSchedule() {
    if (!this.selectedScheduleId) return null;
    return this.schedules.find((schedule) => schedule.id === this.selectedScheduleId) || null;
  }

  getCurrentSelectionContext() {
    const event = this.getSelectedEvent();
    const schedule = this.getSelectedSchedule();
    return {
      eventId: event?.id || "",
      eventName: event?.name || event?.id || "",
      scheduleId: schedule?.id || "",
      scheduleLabel: schedule?.label || schedule?.id || "",
      startAt: schedule?.startAt || "",
      endAt: schedule?.endAt || ""
    };
  }

  getParticipantEventsSnapshot() {
    return this.events.map((event) => ({
      ...event,
      schedules: Array.isArray(event.schedules)
        ? event.schedules.map((schedule) => ({ ...schedule }))
        : []
    }));
  }

  addSelectionListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.selectionListeners.add(listener);
    this.forceSelectionBroadcast = true;
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  addEventListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  notifySelectionListeners(source = "host") {
    if (this.suppressSelectionNotifications) {
      this.logParticipantAction("選択通知は抑制設定のため送信しません", { source });
      return;
    }
    const detail = { ...this.getCurrentSelectionContext(), source };
    const signature = [
      detail.eventId,
      detail.scheduleId,
      detail.eventName,
      detail.scheduleLabel,
      detail.startAt,
      detail.endAt
    ].join("::");
    if (
      !this.forceSelectionBroadcast &&
      signature === this.lastSelectionSignature &&
      source === this.lastSelectionSource
    ) {
      this.logParticipantAction("前回と同じ内容のため選択通知を省略しました", detail);
      return;
    }
    this.lastSelectionSignature = signature;
    this.lastSelectionSource = source;
    this.forceSelectionBroadcast = false;
    this.logParticipantAction("選択内容をリスナーに通知します", detail);
    this.selectionListeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        logError("Selection listener failed", error);
      }
    });
  }

  notifyEventListeners() {
    const snapshot = this.getParticipantEventsSnapshot();
    this.eventListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        logError("Event listener failed", error);
      }
    });
  }

  applySelectionFromParticipant(detail = {}) {
    const eventId = ensureString(detail?.eventId);
    const scheduleId = ensureString(detail?.scheduleId);
    const previousSuppression = this.suppressSelectionNotifications;
    this.suppressSelectionNotifications = true;
    this.logParticipantAction("参加者ツールからの選択反映リクエストを受け取りました", {
      eventId,
      scheduleId,
      source: detail?.source || "participants"
    });
    try {
      if (eventId || (!eventId && detail?.eventId === "")) {
        this.selectEvent(eventId);
      }
      if (scheduleId || (!scheduleId && detail?.scheduleId === "")) {
        this.selectSchedule(scheduleId);
      }
    } finally {
      this.suppressSelectionNotifications = previousSuppression;
    }
    this.notifySelectionListeners(detail?.source || "participants");
  }

  getParticipantHostInterface() {
    if (!this.participantHostInterface) {
      this.logParticipantAction("参加者ツール用ホストインターフェースを初期化します");
      this.participantHostInterface = {
        getSelection: () => this.getCurrentSelectionContext(),
        getEvents: () => this.getParticipantEventsSnapshot(),
        subscribeSelection: (listener) => this.addSelectionListener(listener),
        subscribeEvents: (listener) => this.addEventListener(listener),
        setSelection: (detail) => this.applySelectionFromParticipant(detail || {})
      };
    }
    return this.participantHostInterface;
  }

  selectSchedule(scheduleId) {
    const previous = this.selectedScheduleId;
    const normalized = ensureString(scheduleId);
    this.logParticipantAction("日程選択リクエストを受信しました", {
      requestedScheduleId: normalized || "",
      previousScheduleId: previous || "",
      totalSchedules: this.schedules.length
    });
    if (normalized && !this.schedules.some((schedule) => schedule.id === normalized)) {
      this.logParticipantAction("指定された日程が見つからないため選択を維持します", {
        requestedScheduleId: normalized
      });
      return;
    }

    this.selectedScheduleId = normalized;
    const changed = previous !== normalized;
    if (changed) {
      this.logParticipantAction("日程選択を更新しました", {
        scheduleId: normalized || "",
        previousScheduleId: previous || ""
      });
      this.tools.resetContext();
    } else {
      this.logParticipantAction("日程選択は既に最新の状態です", {
        scheduleId: normalized || ""
      });
    }
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.tools.prepareContextForSelection();
    if (changed) {
      this.notifySelectionListeners("host");
    }
  }

  updateScheduleStateFromSelection(preferredScheduleId = "") {
    const event = this.getSelectedEvent();
    this.schedules = event ? [...event.schedules] : [];
    this.logParticipantAction("イベント選択に基づいて日程一覧を更新します", {
      selectedEventId: event?.id || "",
      scheduleCount: this.schedules.length,
      preferredScheduleId
    });
    this.ensureSelectedSchedule(preferredScheduleId);
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.tools.prepareContextForSelection();
  }

  renderScheduleList() {
    const list = this.dom.scheduleList;
    if (!list) return;

    list.innerHTML = "";
    if (!this.schedules.length) {
      list.hidden = true;
      if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = false;
      list.removeAttribute("role");
      list.removeAttribute("aria-label");
      list.removeAttribute("aria-orientation");
      return;
    }

    list.hidden = false;
    if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = true;

    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "日程一覧");
    list.setAttribute("aria-orientation", "vertical");
    const fragment = document.createDocumentFragment();
    this.schedules.forEach((schedule) => {
      const item = document.createElement("li");
      item.className = "entity-item";
      item.dataset.scheduleId = schedule.id;
      item.setAttribute("role", "option");

      const isSelected = schedule.id === this.selectedScheduleId && this.selectedScheduleId;
      if (isSelected) {
        item.classList.add("is-selected");
        item.setAttribute("aria-selected", "true");
      } else {
        item.setAttribute("aria-selected", "false");
      }
      item.tabIndex = 0;

      const indicator = document.createElement("span");
      indicator.className = "entity-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const indicatorDot = document.createElement("span");
      indicatorDot.className = "entity-indicator__dot";
      indicator.appendChild(indicatorDot);

      const label = document.createElement("div");
      label.className = "entity-label";

      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = schedule.label || schedule.id;

      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
      const metaParts = [];
      if (rangeText) metaParts.push(rangeText);
      metaParts.push(`参加者 ${formatParticipantCount(schedule.participantCount)}`);
      metaEl.textContent = metaParts.join(" / ");

      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "entity-action entity-action--edit";
      editBtn.setAttribute("aria-label", `${schedule.label || schedule.id} を編集`);
      editBtn.title = "日程を編集";
      editBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z" fill="currentColor"/></svg></span><span class="entity-action__label">編集</span>';
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openScheduleDialog({ mode: "edit", schedule });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "entity-action entity-action--delete";
      deleteBtn.setAttribute("aria-label", `${schedule.label || schedule.id} を削除`);
      deleteBtn.title = "日程を削除";
      deleteBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z"/></svg></span><span class="entity-action__label">削除</span>';
      deleteBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.deleteSchedule(schedule).catch((error) => {
          logError("Failed to delete schedule", error);
          this.showAlert(error.message || "日程の削除に失敗しました。");
        });
      });
      actions.appendChild(deleteBtn);

      item.append(indicator, label, actions);

      item.addEventListener("click", () => {
        this.selectSchedule(schedule.id);
      });
      item.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          this.selectSchedule(schedule.id);
        }
      });

      fragment.appendChild(item);
    });

    list.appendChild(fragment);
  }

  updateEventSummary() {
    const event = this.getSelectedEvent();
    if (this.dom.eventSummaryName) {
      this.dom.eventSummaryName.textContent = event ? event.name || event.id : "—";
    }
    if (this.dom.eventSummarySchedules) {
      if (event) {
        const count = typeof event.scheduleCount === "number" ? event.scheduleCount : (event.schedules?.length || 0);
        this.dom.eventSummarySchedules.textContent = `${count}件`;
      } else {
        this.dom.eventSummarySchedules.textContent = "—";
      }
    }
    if (this.dom.eventSummaryParticipants) {
      this.dom.eventSummaryParticipants.textContent = event
        ? formatParticipantCount(event.totalParticipants)
        : "—";
    }
    this.updateStageHeader();
  }

  updateScheduleSummary() {
    if (!this.dom.scheduleSummary) return;

    const event = this.getSelectedEvent();
    const schedule = this.getSelectedSchedule();
    const hasSchedule = Boolean(event && schedule);
    const hasSelection = Boolean(this.selectedScheduleId);
    this.dom.scheduleSummary.hidden = !hasSchedule;
    if (this.dom.scheduleSummaryEmpty) {
      const shouldHidePlaceholder = hasSchedule || hasSelection;
      this.dom.scheduleSummaryEmpty.hidden = shouldHidePlaceholder;
      this.dom.scheduleSummaryEmpty.classList.toggle("is-hidden", shouldHidePlaceholder);
      if (!shouldHidePlaceholder) {
        this.dom.scheduleSummaryEmpty.textContent = event
          ? "日程を選択してください。"
          : "イベントを選択してください。";
      }
    }
    this.updateStageHeader();
    if (!hasSchedule) {
      return;
    }
    if (this.dom.scheduleSummaryEvent) {
      this.dom.scheduleSummaryEvent.textContent = event.name || event.id;
    }
    if (this.dom.scheduleSummaryLabel) {
      this.dom.scheduleSummaryLabel.textContent = schedule.label || schedule.id;
    }
    const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
    if (this.dom.scheduleSummaryRangeRow && this.dom.scheduleSummaryRange) {
      if (rangeText) {
        this.dom.scheduleSummaryRangeRow.hidden = false;
        this.dom.scheduleSummaryRange.textContent = rangeText;
      } else {
        this.dom.scheduleSummaryRangeRow.hidden = true;
        this.dom.scheduleSummaryRange.textContent = "";
      }
    }
  }

  clearLoadingIndicators() {
    this.eventsLoadingTracker.reset();
    this.scheduleLoadingTracker.reset();
  }

  updateStageUi() {
    if (this.dom.main) {
      this.dom.main.dataset.stage = this.stage;
    }
    this.updateStageHeader();
    this.updateStageIndicator();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    this.updateChatLayoutMetrics();
  }

  updateStageIndicator() {
    if (!Array.isArray(this.dom.stageIndicators)) return;
    const currentIndex = STAGE_SEQUENCE.indexOf(this.stage);
    this.dom.stageIndicators.forEach((indicator) => {
      const stageId = indicator?.dataset?.stageIndicator || "";
      const stageIndex = STAGE_SEQUENCE.indexOf(stageId);
      if (stageIndex === -1) return;
      indicator.classList.toggle("is-active", stageIndex === currentIndex);
      indicator.classList.toggle("is-complete", stageIndex < currentIndex);
      if (stageIndex === currentIndex) {
        indicator.setAttribute("aria-current", "step");
      } else {
        indicator.removeAttribute("aria-current");
      }
    });
  }

  updateStageHeader() {
    const activePanel = PANEL_CONFIG[this.activePanel] ? this.activePanel : "events";
    const panelConfig = PANEL_CONFIG[activePanel] || PANEL_CONFIG.events;
    const stageInfo = PANEL_STAGE_INFO[activePanel] || STAGE_INFO[panelConfig.stage] || null;

    const title = stageInfo?.title ? String(stageInfo.title).trim() : "";
    const description = stageInfo?.description ? String(stageInfo.description).trim() : "";
    let baseText = "";
    if (title && description) {
      baseText = `${title} — ${description}`;
    } else if (description) {
      baseText = description;
    } else if (title) {
      baseText = title;
    }

    const needsEvent = Boolean(panelConfig.requireEvent || panelConfig.requireSchedule);
    const needsSchedule = Boolean(panelConfig.requireSchedule);
    const event = needsEvent ? this.getSelectedEvent() : null;
    const schedule = needsSchedule ? this.getSelectedSchedule() : null;

    if (needsEvent || needsSchedule) {
      const prefix = baseText || title || "選択対象";
      baseText = buildContextDescription(prefix, event, needsSchedule ? schedule : null);
    }

    this.stageNote = (baseText || "").trim();
    this.applyMetaNote();
  }

  setModuleAccessibility(module, isActive) {
    if (!module) return;
    if (typeof module.inert !== "undefined") {
      module.inert = !isActive;
    } else if (!isActive) {
      module.setAttribute("inert", "");
    } else {
      module.removeAttribute("inert");
    }

    if (isActive) {
      module.removeAttribute("aria-hidden");
      module.classList.remove("is-inert");
    } else {
      module.setAttribute("aria-hidden", "true");
      module.classList.add("is-inert");
    }

    const focusable = module.querySelectorAll(FOCUSABLE_SELECTOR);
    focusable.forEach((element) => {
      if (isActive) {
        if (Object.prototype.hasOwnProperty.call(element.dataset, "flowSavedTabindex")) {
          const previous = element.dataset.flowSavedTabindex;
          if (previous === "") {
            element.removeAttribute("tabindex");
          } else {
            element.setAttribute("tabindex", previous);
          }
          delete element.dataset.flowSavedTabindex;
        }
      } else if (!Object.prototype.hasOwnProperty.call(element.dataset, "flowSavedTabindex")) {
        const current = element.getAttribute("tabindex");
        element.dataset.flowSavedTabindex = current ?? "";
        element.setAttribute("tabindex", "-1");
      } else {
        element.setAttribute("tabindex", "-1");
      }
    });
  }

  updateFlowButtons() {
    const signedIn = Boolean(this.currentUser);
    const hasEvent = Boolean(this.selectedEventId);
    const hasSchedule = Boolean(this.selectedScheduleId);

    if (this.dom.addEventButton) {
      this.dom.addEventButton.disabled = !signedIn;
    }
    if (this.dom.refreshButton) {
      this.dom.refreshButton.disabled = !signedIn;
    }
    if (this.dom.nextButton) {
      this.dom.nextButton.disabled = !signedIn || !hasEvent;
    }
    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.disabled = !signedIn || !hasEvent;
    }
    if (this.dom.scheduleRefreshButton) {
      this.dom.scheduleRefreshButton.disabled = !signedIn || !hasEvent;
    }
    if (this.dom.scheduleNextButton) {
      this.dom.scheduleNextButton.disabled = !signedIn || !hasSchedule;
    }
    this.updateNavigationButtons();
  }

  updateSelectionNotes() {
    if (this.dom.eventSelectionNote) {
      const shouldShow = !this.selectedEventId && this.events.length > 0;
      this.dom.eventSelectionNote.hidden = !shouldShow;
    }
    if (this.dom.scheduleSelectionNote) {
      const shouldShow = Boolean(this.selectedEventId) && !this.selectedScheduleId && this.schedules.length > 0;
      this.dom.scheduleSelectionNote.hidden = !shouldShow;
    }
  }

  setStage(stage) {
    if (!STAGE_SEQUENCE.includes(stage)) {
      return;
    }
    this.stage = stage;
    this.stageHistory.add(stage);
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateSelectionNotes();
  }

  canActivatePanel(panel, config = PANEL_CONFIG[panel]) {
    const rules = config || PANEL_CONFIG.events;
    if (rules.requireEvent && !this.selectedEventId) {
      return false;
    }
    if (rules.requireSchedule && (!this.selectedScheduleId || !this.currentUser)) {
      return false;
    }
    return true;
  }

  showPanel(panel) {
    const normalized = PANEL_CONFIG[panel] ? panel : "events";
    const config = PANEL_CONFIG[normalized] || PANEL_CONFIG.events;
    if (config.requireEvent && !this.selectedEventId) {
      this.revealEventSelectionCue();
      this.activePanel = "events";
      this.setStage("events");
      this.updatePanelVisibility();
      this.updatePanelNavigation();
      return;
    }
    if (config.requireSchedule && !this.selectedScheduleId) {
      this.revealScheduleSelectionCue();
      this.activePanel = this.selectedEventId ? "schedules" : "events";
      this.setStage(this.activePanel);
      this.updatePanelVisibility();
      this.updatePanelNavigation();
      return;
    }
    this.activePanel = normalized;
    this.setStage(config.stage);
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    if (config.stage === "tabs") {
      this.tools.prepareFrames();
      const hasSelection = this.selectedEventId && this.selectedScheduleId;
      if (config.requireSchedule && hasSelection) {
        this.tools.setPendingSync(false);
        this.tools.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
      } else if (this.tools.isPendingSync() && hasSelection) {
        this.tools.setPendingSync(false);
        this.tools.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
      }
    }
    this.handlePanelSetup(normalized, config).catch((error) => logError("Failed to prepare panel", error));
  }

  async handlePanelSetup(panel, config) {
    if (config.stage !== "tabs") {
      await this.tools.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (config.requireSchedule) {
      await this.tools.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (panel === "dictionary") {
      await this.tools.setDrawerState({ dictionary: true, logs: false });
    } else if (panel === "logs") {
      await this.tools.setDrawerState({ dictionary: false, logs: true });
    } else {
      await this.tools.setDrawerState({ dictionary: false, logs: false });
    }
  }

  getPanelModules() {
    return {
      events: this.dom.eventsModule,
      schedules: this.dom.schedulesModule,
      participants: this.dom.participantsPanel,
      operator: this.dom.operatorPanel,
      dictionary: this.dom.dictionaryPanel,
      pickup: this.dom.pickupPanel,
      logs: this.dom.logsPanel
    };
  }

  setModuleVisibility(module, isVisible) {
    if (!module) return;
    module.hidden = !isVisible;
    module.classList.toggle("is-active", isVisible);
    this.setModuleAccessibility(module, isVisible);
  }

  updatePanelVisibility() {
    const activePanel = PANEL_CONFIG[this.activePanel] ? this.activePanel : "events";
    const modules = this.getPanelModules();
    Object.entries(modules).forEach(([name, element]) => {
      this.setModuleVisibility(element, name === activePanel);
    });
  }

  updatePanelNavigation() {
    const buttons = this.dom.panelButtons || [];
    buttons.forEach((button) => {
      const target = button.dataset.panelTarget || "";
      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const disabled = !this.canActivatePanel(target, config);
      button.disabled = disabled;
      const isActive = target === this.activePanel;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
    const shouldHidePanelNavigation = activeConfig.stage === "tabs";
    const navigations = this.dom.flowNavigations || [];
    navigations.forEach((nav) => {
      if (!nav) return;
      const isPanelNavigation = nav.classList.contains("flow-navigation--panel");
      if (isPanelNavigation) {
        nav.hidden = shouldHidePanelNavigation;
      } else {
        nav.hidden = false;
      }
    });
    this.updateNavigationButtons();
  }

  updateNavigationButtons() {
    const buttons = this.dom.navigationButtons || [];
    buttons.forEach((button) => {
      if (!button) return;
      const target = button.dataset.flowNavTarget || "";
      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const disabled = !target || target === this.activePanel || !this.canActivatePanel(target, config);
      button.disabled = disabled;
    });
  }

  cleanup() {
    if (typeof document !== "undefined") {
      document.removeEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.removeEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.cleanup);
    }
    this.closeMobilePanel({ restoreFocus: false });
    this.selectionListeners.clear();
    this.eventListeners.clear();
    this.teardownChatLayoutObservers();
    this.chat.dispose();
  }

  setupChatLayoutObservers() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    this.updateChatLayoutMetrics();
    if (typeof ResizeObserver === "function") {
      if (this.chatLayoutResizeObserver) {
        this.chatLayoutResizeObserver.disconnect();
      }
      const observer = new ResizeObserver(() => this.updateChatLayoutMetrics());
      const header = document.querySelector(".op-header");
      const layout = this.dom.chatContainer?.closest(".events-layout");
      const targets = [
        document.body,
        header,
        this.dom.main,
        this.dom.flowStage,
        layout,
        this.dom.chatContainer,
        this.dom.chatPanel
      ];
      const uniqueTargets = Array.from(new Set(targets.filter(Boolean)));
      uniqueTargets.forEach((target) => observer.observe(target));
      this.chatLayoutResizeObserver = observer;
    }
    window.removeEventListener("resize", this.handleWindowResize);
    window.removeEventListener("orientationchange", this.handleWindowResize);
    window.addEventListener("resize", this.handleWindowResize, { passive: true });
    window.addEventListener("orientationchange", this.handleWindowResize);
    if (window.visualViewport) {
      if (this.visualViewportResize) {
        window.visualViewport.removeEventListener("resize", this.visualViewportResize);
        window.visualViewport.removeEventListener("scroll", this.visualViewportResize);
      }
      this.visualViewportResize = () => this.updateChatLayoutMetrics();
      window.visualViewport.addEventListener("resize", this.visualViewportResize);
      window.visualViewport.addEventListener("scroll", this.visualViewportResize);
    }
  }

  teardownChatLayoutObservers() {
    if (this.chatLayoutResizeObserver) {
      this.chatLayoutResizeObserver.disconnect();
      this.chatLayoutResizeObserver = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleWindowResize);
      window.removeEventListener("orientationchange", this.handleWindowResize);
      if (this.chatLayoutRaf) {
        window.cancelAnimationFrame(this.chatLayoutRaf);
        this.chatLayoutRaf = 0;
      }
      if (window.visualViewport && this.visualViewportResize) {
        window.visualViewport.removeEventListener("resize", this.visualViewportResize);
        window.visualViewport.removeEventListener("scroll", this.visualViewportResize);
        this.visualViewportResize = null;
      }
    }
    if (this.dom.chatContainer) {
      this.dom.chatContainer.style.removeProperty("--events-chat-top");
      this.dom.chatContainer.style.removeProperty("--events-chat-height");
    }
  }

  handleWindowResize() {
    if (typeof window === "undefined") {
      return;
    }
    if (this.chatLayoutRaf) {
      return;
    }
    this.chatLayoutRaf = window.requestAnimationFrame(() => {
      this.chatLayoutRaf = 0;
      this.updateChatLayoutMetrics();
      if (!this.isMobileLayout() && this.activeMobilePanel) {
        this.closeMobilePanel({ restoreFocus: false });
      }
    });
  }

  isMobileLayout() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(max-width: 960px)").matches;
  }

  getMobilePanel(target) {
    if (!target) {
      return null;
    }
    if (target === "sidebar") {
      return this.dom.sidebarContainer || (typeof document !== "undefined" ? document.getElementById("events-sidebar") : null);
    }
    if (target === "chat") {
      return this.dom.chatContainer || (typeof document !== "undefined" ? document.getElementById("events-chat") : null);
    }
    return null;
  }

  toggleMobilePanel(target) {
    if (!target) {
      return;
    }
    if (!this.isMobileLayout()) {
      const panel = this.getMobilePanel(target);
      if (panel && typeof panel.scrollIntoView === "function") {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (this.activeMobilePanel === target) {
      this.closeMobilePanel();
    } else {
      this.openMobilePanel(target);
    }
  }

  openMobilePanel(target) {
    if (!this.isMobileLayout()) {
      return;
    }
    const panel = this.getMobilePanel(target);
    if (!panel) {
      return;
    }
    if (this.activeMobilePanel && this.activeMobilePanel !== target) {
      this.closeMobilePanel({ restoreFocus: false });
    }
    this.activeMobilePanel = target;
    if (panel instanceof HTMLElement) {
      panel.classList.add("is-mobile-open");
      panel.setAttribute("data-mobile-open", "true");
    }
    const body = typeof document !== "undefined" ? document.body : null;
    if (body) {
      body.classList.add("events-mobile-locked");
    }
    if (this.dom.mobileOverlay) {
      this.dom.mobileOverlay.removeAttribute("hidden");
    }
    (this.dom.mobileToggleButtons || []).forEach((button) => {
      if (!button) {
        return;
      }
      const matches = (button.dataset.mobileTarget || "") === target;
      button.setAttribute("aria-expanded", matches ? "true" : "false");
    });
    this.lastMobileFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeButton = panel.querySelector("[data-mobile-close]");
    requestAnimationFrame(() => {
      if (closeButton instanceof HTMLElement) {
        closeButton.focus();
      } else if (panel instanceof HTMLElement && typeof panel.focus === "function") {
        panel.focus();
      }
    });
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", this.handleMobileKeydown, true);
    }
  }

  closeMobilePanel({ restoreFocus = true } = {}) {
    if (!this.activeMobilePanel) {
      (this.dom.mobileToggleButtons || []).forEach((button) => {
        if (button) {
          button.setAttribute("aria-expanded", "false");
        }
      });
      return;
    }
    const target = this.activeMobilePanel;
    const panel = this.getMobilePanel(target);
    if (panel instanceof HTMLElement) {
      panel.classList.remove("is-mobile-open");
      panel.removeAttribute("data-mobile-open");
    }
    if (this.dom.mobileOverlay && !this.dom.mobileOverlay.hasAttribute("hidden")) {
      this.dom.mobileOverlay.setAttribute("hidden", "");
    }
    const body = typeof document !== "undefined" ? document.body : null;
    if (body) {
      body.classList.remove("events-mobile-locked");
    }
    (this.dom.mobileToggleButtons || []).forEach((button) => {
      if (button) {
        button.setAttribute("aria-expanded", "false");
      }
    });
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", this.handleMobileKeydown, true);
    }
    const focusTarget = restoreFocus ? this.lastMobileFocus : null;
    this.activeMobilePanel = "";
    this.lastMobileFocus = null;
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus();
    }
  }

  handleMobileKeydown(event) {
    if (event.key === "Escape" && this.activeMobilePanel) {
      event.preventDefault();
      this.closeMobilePanel();
    }
  }

  updateChatLayoutMetrics() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const chatPanel = this.dom.chatPanel;
    const chatContainer = this.dom.chatContainer || chatPanel?.closest(".events-chat");
    if (!chatPanel || !chatContainer) {
      return;
    }
    if (window.matchMedia && window.matchMedia("(max-width: 960px)").matches) {
      chatContainer.style.removeProperty("--events-chat-top");
      chatContainer.style.removeProperty("--events-chat-height");
      return;
    }
    const docEl = document.documentElement;
    const header = document.querySelector(".op-header");
    const flowStage = this.dom.flowStage || document.querySelector(".flow-stage");
    const layout = chatContainer.closest(".events-layout");
    const bodyStyles = window.getComputedStyle(document.body);
    const docStyles = window.getComputedStyle(docEl);
    const mainStyles = this.dom.main ? window.getComputedStyle(this.dom.main) : null;
    const layoutStyles = layout ? window.getComputedStyle(layout) : null;

    const safeAreaTop = parseCssPixels(docStyles.getPropertyValue("--safe-area-top"));
    const safeAreaBottom = parseCssPixels(docStyles.getPropertyValue("--safe-area-bottom"));
    const bodyPaddingTop = parseCssPixels(bodyStyles.paddingTop);
    const bodyGap = parseCssPixels(bodyStyles.gap);
    const mainGap = mainStyles ? parseCssPixels(mainStyles.gap) : 0;
    const layoutPaddingTop = layoutStyles ? parseCssPixels(layoutStyles.paddingTop) : 0;
    const layoutPaddingBottom = layoutStyles ? parseCssPixels(layoutStyles.paddingBottom) : 0;

    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const flowStageHeight = flowStage ? flowStage.getBoundingClientRect().height : 0;

    const chatStyles = window.getComputedStyle(chatContainer);
    const cssStickyTop = parseCssPixels(chatStyles.top);
    const fallbackStickyTop = bodyPaddingTop + safeAreaTop + headerHeight + bodyGap;
    const stickyTop = cssStickyTop > 0 ? cssStickyTop : fallbackStickyTop;
    const chatOffset = stickyTop + flowStageHeight + mainGap + layoutPaddingTop;
    const viewportHeight = window.innerHeight || docEl.clientHeight;
    const availableHeight = viewportHeight - chatOffset - layoutPaddingBottom - safeAreaBottom;

    const heightValue = Math.max(0, Math.round(availableHeight));
    if (heightValue > 0) {
      chatContainer.style.setProperty("--events-chat-height", `${heightValue}px`);
    } else {
      chatContainer.style.removeProperty("--events-chat-height");
    }
  }

  revealEventSelectionCue() {
    if (this.dom.eventSelectionNote) {
      this.dom.eventSelectionNote.hidden = false;
      this.dom.eventSelectionNote.classList.add("section-focus-highlight");
      setTimeout(() => this.dom.eventSelectionNote.classList.remove("section-focus-highlight"), 600);
    }
    if (this.dom.eventList) {
      this.dom.eventList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  revealScheduleSelectionCue() {
    if (this.dom.scheduleSelectionNote) {
      this.dom.scheduleSelectionNote.hidden = false;
      this.dom.scheduleSelectionNote.classList.add("section-focus-highlight");
      setTimeout(() => this.dom.scheduleSelectionNote.classList.remove("section-focus-highlight"), 600);
    }
    if (this.dom.scheduleList) {
      this.dom.scheduleList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  beginScheduleLoading(message = "") {
    this.scheduleLoadingTracker.begin(message);
  }

  endScheduleLoading() {
    this.scheduleLoadingTracker.end();
  }

  updateScheduleLoadingMessage(message = "") {
    this.scheduleLoadingTracker.updateMessage(message);
  }

  applyScheduleLoadingState(state = this.scheduleLoadingTracker.getState()) {
    const { active, message } = state;
    if (this.dom.scheduleLoading) {
      this.dom.scheduleLoading.hidden = !active;
    }
    if (this.dom.scheduleLoadingText) {
      this.dom.scheduleLoadingText.textContent = active ? message || "" : "";
    }
  }

  async reloadSchedules() {
    if (!this.selectedEventId) {
      this.revealEventSelectionCue();
      return;
    }
    this.beginScheduleLoading("日程情報を再読み込みしています…");
    try {
      await this.loadEvents();
    } finally {
      this.endScheduleLoading();
    }
  }

  openScheduleDialog({ mode = "create", schedule = null } = {}) {
    if (!this.dom.scheduleDialog || !this.dom.scheduleForm) return;
    if (!this.selectedEventId) {
      this.revealEventSelectionCue();
      return;
    }

    this.dom.scheduleForm.reset();
    this.dom.scheduleForm.dataset.mode = mode;
    this.dom.scheduleForm.dataset.scheduleId = schedule?.id || "";
    this.setFormError(this.dom.scheduleError, "");

    if (this.dom.scheduleDialogTitle) {
      this.dom.scheduleDialogTitle.textContent = mode === "edit" ? "日程を編集" : "日程を追加";
    }
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }
    if (mode === "edit" && schedule) {
      if (this.dom.scheduleLabelInput) this.dom.scheduleLabelInput.value = schedule.label || "";
      if (this.dom.scheduleDateInput)
        this.dom.scheduleDateInput.value = schedule.startAt ? String(schedule.startAt).slice(0, 10) : schedule.date || "";
      if (this.dom.scheduleStartInput)
        this.dom.scheduleStartInput.value = schedule.startAt ? String(schedule.startAt).slice(11, 16) : "";
      if (this.dom.scheduleEndInput)
        this.dom.scheduleEndInput.value = schedule.endAt ? String(schedule.endAt).slice(11, 16) : "";
    }

    this.openDialog(this.dom.scheduleDialog);
  }

  async handleScheduleFormSubmit() {
    if (!this.dom.scheduleForm) return;
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    this.setFormError(this.dom.scheduleError, "");

    try {
      const mode = this.dom.scheduleForm.dataset.mode || "create";
      const scheduleId = this.dom.scheduleForm.dataset.scheduleId || "";
      const payload = {
        label: this.dom.scheduleLabelInput?.value,
        date: this.dom.scheduleDateInput?.value,
        start: this.dom.scheduleStartInput?.value,
        end: this.dom.scheduleEndInput?.value
      };
      if (mode === "edit") {
        await this.updateSchedule(scheduleId, payload);
      } else {
        await this.createSchedule(payload);
      }
      this.dom.scheduleForm.reset();
      this.closeDialog(this.dom.scheduleDialog);
    } catch (error) {
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  resolveScheduleFormValues({ label, date, start, end }) {
    const trimmedLabel = normalizeKey(label || "");
    if (!trimmedLabel) {
      throw new Error("日程の表示名を入力してください。");
    }

    const normalizedDate = ensureString(date);
    if (!normalizedDate) {
      throw new Error("日付を入力してください。");
    }

    const startTime = ensureString(start);
    const endTime = ensureString(end);
    if (!startTime || !endTime) {
      throw new Error("開始と終了の時刻を入力してください。");
    }

    const startDate = new Date(`${normalizedDate}T${startTime}`);
    const endDate = new Date(`${normalizedDate}T${endTime}`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new Error("開始・終了時刻の形式が正しくありません。");
    }

    if (endDate.getTime() <= startDate.getTime()) {
      endDate.setTime(endDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const startValue = formatDateTimeLocal(startDate);
    const endValue = formatDateTimeLocal(endDate);

    return {
      label: trimmedLabel,
      date: normalizedDate,
      startValue,
      endValue
    };
  }

  async createSchedule(payload) {
    const eventId = this.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }

    const { label, date, startValue, endValue } = this.resolveScheduleFormValues(payload);
    let scheduleId = generateShortId("sch_");
    const existingIds = new Set(this.schedules.map((schedule) => schedule.id));
    while (existingIds.has(scheduleId)) {
      scheduleId = generateShortId("sch_");
    }

    const now = Date.now();
    this.beginScheduleLoading("日程を保存しています…");
    try {
      await set(ref(database, `questionIntake/schedules/${eventId}/${scheduleId}`), {
        label,
        date,
        startAt: startValue,
        endAt: endValue,
        participantCount: 0,
        createdAt: now,
        updatedAt: now
      });

      await update(ref(database), {
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });

      await this.loadEvents();
      this.selectSchedule(scheduleId);
      await this.requestSheetSync();
    } finally {
      this.endScheduleLoading();
    }
  }

  async updateSchedule(scheduleId, payload) {
    const eventId = this.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }

    const { label, date, startValue, endValue } = this.resolveScheduleFormValues(payload);
    const now = Date.now();
    this.beginScheduleLoading("日程を更新しています…");
    try {
      await update(ref(database), {
        [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: label,
        [`questionIntake/schedules/${eventId}/${scheduleId}/date`]: date,
        [`questionIntake/schedules/${eventId}/${scheduleId}/startAt`]: startValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/endAt`]: endValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });

      await this.loadEvents();
      this.selectSchedule(scheduleId);
      await this.requestSheetSync();
    } finally {
      this.endScheduleLoading();
    }
  }

  async deleteSchedule(schedule) {
    const eventId = this.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    const scheduleId = schedule?.id;
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }
    const label = schedule?.label || scheduleId;

    const confirmed = await this.confirm({
      title: "日程の削除",
      description: `日程「${label}」と、紐づく参加者・専用リンクをすべて削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    try {
      this.beginScheduleLoading(`日程「${label}」を削除しています…`);
      const participantSnapshot = await get(ref(database, `questionIntake/participants/${eventId}/${scheduleId}`));
      const participantBranch = participantSnapshot.exists() ? participantSnapshot.val() : {};
      const tokens = new Set();
      if (participantBranch && typeof participantBranch === "object") {
        Object.values(participantBranch).forEach((entry) => {
          const token = entry?.token;
          if (token) tokens.add(String(token));
        });
      }

      const now = Date.now();
      const updates = {
        [`questionIntake/schedules/${eventId}/${scheduleId}`]: null,
        [`questionIntake/participants/${eventId}/${scheduleId}`]: null,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      };
      tokens.forEach((token) => {
        updates[`questionIntake/tokens/${token}`] = null;
      });

      await update(ref(database), updates);
      await this.loadEvents();
      this.selectSchedule("");
      await this.requestSheetSync();
    } catch (error) {
      throw new Error(error?.message || "日程の削除に失敗しました。");
    } finally {
      this.endScheduleLoading();
    }
  }

  applyMetaNote() {
    if (!this.dom.metaNote) {
      return;
    }
    const note = (this.eventCountNote || "").trim();
    if (!note) {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
      return;
    }
    this.dom.metaNote.hidden = false;
    this.dom.metaNote.textContent = note;
  }

  updateMetaNote() {
    const count = this.events.length;
    if (count > 0) {
      this.eventCountNote = `登録イベント数: ${count}件`;
    } else {
      this.eventCountNote = "";
    }
    this.applyMetaNote();
  }

  updateUserLabel() {
    const label = this.dom.userLabel;
    if (!label) {
      return;
    }
    const user = this.currentUser;
    if (!user) {
      label.textContent = "";
      label.hidden = true;
      label.removeAttribute("aria-label");
      return;
    }
    const displayName = String(user.displayName || "").trim();
    const email = String(user.email || "").trim();
    const text = displayName && email ? `${displayName} (${email})` : displayName || email;
    if (text) {
      label.textContent = text;
      label.hidden = false;
      label.setAttribute("aria-label", `ログイン中: ${text}`);
    } else {
      label.textContent = "";
      label.hidden = true;
      label.removeAttribute("aria-label");
    }
  }

  updateDocumentTitle() {
    if (typeof document === "undefined") {
      return;
    }
    const count = this.events.length;
    if (count > 0) {
      document.title = `イベントコントロールセンター (${count}件)`;
    } else {
      document.title = "イベントコントロールセンター";
    }
  }

  openEventDialog({ mode = "create", event = null } = {}) {
    if (!this.dom.eventDialog || !this.dom.eventForm) return;
    this.dom.eventForm.reset();
    this.dom.eventForm.dataset.mode = mode;
    this.dom.eventForm.dataset.eventId = event?.id || "";
    this.setFormError(this.dom.eventError, "");
    if (this.dom.eventDialogTitle) {
      this.dom.eventDialogTitle.textContent = mode === "edit" ? "イベントを編集" : "イベントを追加";
    }
    if (this.dom.eventNameInput) {
      this.dom.eventNameInput.value = mode === "edit" ? String(event?.name || "") : "";
    }
    const submitButton = this.dom.eventForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }
    this.openDialog(this.dom.eventDialog);
  }

  closeEventDialog() {
    if (this.dom.eventDialog) {
      this.closeDialog(this.dom.eventDialog);
    }
  }

  async handleEventFormSubmit() {
    if (!this.dom.eventForm || !this.dom.eventNameInput) return;
    const submitButton = this.dom.eventForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    this.setFormError(this.dom.eventError, "");

    try {
      const mode = this.dom.eventForm.dataset.mode || "create";
      const eventId = this.dom.eventForm.dataset.eventId || "";
      const name = this.dom.eventNameInput.value;
      if (mode === "edit") {
        await this.updateEvent(eventId, name);
        this.showAlert(`イベント「${name}」を更新しました。`);
      } else {
        await this.createEvent(name);
        this.showAlert(`イベント「${name}」を追加しました。`);
      }
      this.dom.eventForm.reset();
      this.closeEventDialog();
    } catch (error) {
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async createEvent(name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }

    const existingIds = new Set(this.events.map((event) => event.id));
    let eventId = generateShortId("evt_");
    while (existingIds.has(eventId)) {
      eventId = generateShortId("evt_");
    }

    const now = Date.now();
    this.beginEventsLoading("イベントを追加しています…");
    try {
      await set(ref(database, `questionIntake/events/${eventId}`), {
        name: trimmed,
        createdAt: now,
        updatedAt: now
      });
      await this.loadEvents();
      this.selectEvent(eventId);
      await this.requestSheetSync();
    } finally {
      this.endEventsLoading();
    }
  }

  async updateEvent(eventId, name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }

    const now = Date.now();
    this.beginEventsLoading("イベントを更新しています…");
    try {
      await update(ref(database), {
        [`questionIntake/events/${eventId}/name`]: trimmed,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });
      await this.loadEvents();
      this.selectEvent(eventId);
      await this.requestSheetSync();
    } finally {
      this.endEventsLoading();
    }
  }

  async deleteEvent(event) {
    const eventId = event?.id;
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }
    const label = event?.name || eventId;
    const confirmed = await this.confirm({
      title: "イベントの削除",
      description: `イベント「${label}」と、その日程・参加者・発行済みリンクをすべて削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    try {
      this.beginEventsLoading(`イベント「${label}」を削除しています…`);
      const participantSnapshot = await get(ref(database, `questionIntake/participants/${eventId}`));
      const participantBranch = participantSnapshot.exists() ? participantSnapshot.val() : {};
      const tokensToRemove = collectParticipantTokens(participantBranch);

      const updates = {
        [`questionIntake/events/${eventId}`]: null,
        [`questionIntake/schedules/${eventId}`]: null,
        [`questionIntake/participants/${eventId}`]: null
      };
      tokensToRemove.forEach((token) => {
        updates[`questionIntake/tokens/${token}`] = null;
      });

      await update(ref(database), updates);
      await this.loadEvents();
      await this.requestSheetSync();
      this.showAlert(`イベント「${label}」を削除しました。`);
    } catch (error) {
      throw new Error(error?.message || "イベントの削除に失敗しました。");
    } finally {
      this.endEventsLoading();
    }
  }

  requestSheetSync() {
    if (!this.api) {
      return;
    }
    this.api
      .apiPost({ action: "syncQuestionIntakeToSheet" })
      .catch((error) => {
        console.warn("Failed to request sheet sync:", error);
      });
  }

  bindDialogDismiss(element) {
    if (!element) return;
    element.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
        event.preventDefault();
        if (element === this.dom.confirmDialog) {
          this.resolveConfirm(false);
        } else {
          this.closeDialog(element);
        }
      }
    });
  }

  openDialog(element) {
    if (!element) return;
    if (this.activeDialog && this.activeDialog !== element) {
      this.closeDialog(this.activeDialog);
    }
    this.activeDialog = element;
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.removeAttribute("hidden");
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", this.handleGlobalKeydown, true);
    const focusTarget = element.querySelector("[data-autofocus]") || element.querySelector("input, button, select, textarea");
    if (focusTarget instanceof HTMLElement) {
      requestAnimationFrame(() => focusTarget.focus());
    }
  }

  closeDialog(element) {
    if (!element) return;
    if (!element.hasAttribute("hidden")) {
      element.setAttribute("hidden", "");
    }
    if (this.activeDialog === element) {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", this.handleGlobalKeydown, true);
      const toFocus = this.lastFocused;
      this.activeDialog = null;
      this.lastFocused = null;
      if (toFocus && typeof toFocus.focus === "function") {
        toFocus.focus();
      }
    }
    if (element === this.dom.eventDialog && this.dom.eventForm) {
      this.dom.eventForm.reset();
      this.setFormError(this.dom.eventError, "");
    }
  }

  handleGlobalKeydown(event) {
    if (event.key === "Escape" && this.activeDialog) {
      event.preventDefault();
      if (this.activeDialog === this.dom.confirmDialog) {
        this.resolveConfirm(false);
      } else {
        this.closeDialog(this.activeDialog);
      }
    }
  }

  async confirm({
    title = "確認",
    description = "",
    confirmLabel = "実行する",
    cancelLabel = "キャンセル",
    tone = "danger"
  } = {}) {
    if (!this.dom.confirmDialog) {
      return window.confirm(description || title);
    }

    if (this.confirmResolver) {
      this.finalizeConfirm(false);
    }

    if (this.dom.confirmDialogTitle) {
      this.dom.confirmDialogTitle.textContent = title || "確認";
    }
    if (this.dom.confirmDialogMessage) {
      this.dom.confirmDialogMessage.textContent = description || "";
    }
    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.textContent = confirmLabel || "実行する";
      this.dom.confirmAcceptButton.classList.remove("btn-danger", "btn-primary");
      this.dom.confirmAcceptButton.classList.add(tone === "danger" ? "btn-danger" : "btn-primary");
    }
    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.textContent = cancelLabel || "キャンセル";
    }

    this.openDialog(this.dom.confirmDialog);

    return await new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  resolveConfirm(result) {
    const resolver = this.confirmResolver;
    this.confirmResolver = null;
    if (this.dom.confirmDialog) {
      this.closeDialog(this.dom.confirmDialog);
    }
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  setFormError(element, message = "") {
    if (!element) return;
    if (message) {
      element.hidden = false;
      element.textContent = message;
    } else {
      element.hidden = true;
      element.textContent = "";
    }
  }
}

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

const ensureString = (value) => String(value ?? "").trim();

const formatDateTimeLocal = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const STAGE_SEQUENCE = ["events", "schedules", "tabs"];

const STAGE_INFO = {
  events: {
    title: "イベントの管理",
    description:
      "質問フォームで使用するイベントを追加・編集・削除し、選択したイベントを次のステップへ引き継ぎます。"
  },
  schedules: {
    title: "日程の管理",
    description: "選択したイベントに紐づく日程を整理し、次のツールに引き継ぐ日程を決めます。"
  }
};

const PANEL_CONFIG = {
  events: { stage: "events", requireEvent: false, requireSchedule: false },
  schedules: { stage: "schedules", requireEvent: true, requireSchedule: false },
  participants: { stage: "tabs", requireEvent: true, requireSchedule: true },
  operator: { stage: "tabs", requireEvent: true, requireSchedule: true },
  dictionary: { stage: "tabs", requireEvent: false, requireSchedule: false, dictionary: true },
  logs: { stage: "tabs", requireEvent: false, requireSchedule: false, logs: true }
};

const PANEL_STAGE_INFO = {
  events: STAGE_INFO.events,
  schedules: STAGE_INFO.schedules,
  participants: {
    title: "参加者リストの管理",
    description: "選択した日程の参加者リストを整理・更新します。"
  },
  operator: {
    title: "テロップ操作パネル",
    description: "質問の送出とステータス監視を行います。"
  },
  dictionary: {
    title: "ルビ辞書管理",
    description: "登録語句を編集して即座に共有できます。"
  },
  logs: {
    title: "操作ログ",
    description: "テロップ操作の履歴を確認します。"
  }
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

function buildContextDescription(baseDescription, event, schedule) {
  const segments = [];
  if (event) {
    segments.push(`イベント: ${event.name || event.id}`);
  }
  if (schedule) {
    segments.push(`日程: ${schedule.label || schedule.id}`);
    const range = formatScheduleRange(schedule.startAt, schedule.endAt);
    if (range) {
      segments.push(`時間: ${range}`);
    }
  }
  if (!segments.length) {
    return baseDescription;
  }
  return `${baseDescription} 選択中 — ${segments.join(" / ")}`;
}

const logError = (context, error) => {
  const detail =
    error && typeof error === "object" && "message" in error && error.message
      ? error.message
      : String(error ?? "不明なエラー");
  console.error(`${context}: ${detail}`);
};

function formatParticipantCount(value) {
  if (value == null || value === "") {
    return "—";
  }
  const numberValue = Number(value);
  if (!Number.isNaN(numberValue)) {
    return `${numberValue}名`;
  }
  return `${value}`;
}

function collectParticipantTokens(branch) {
  const tokens = new Set();
  if (!branch || typeof branch !== "object") {
    return tokens;
  }

  Object.values(branch).forEach((scheduleBranch) => {
    if (!scheduleBranch || typeof scheduleBranch !== "object") return;
    Object.values(scheduleBranch).forEach((participant) => {
      const token = participant?.token;
      if (token) {
        tokens.add(String(token));
      }
    });
  });
  return tokens;
}

const PARTICIPANT_SYNC_TIMEOUT_MS = 6000;
const PARTICIPANT_SYNC_POLL_INTERVAL_MS = 150;

const wait = (ms = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitForParticipantSelectionAck(expectedEventId, expectedScheduleId) {
  if (
    typeof window === "undefined" ||
    !window.questionAdminEmbed ||
    typeof window.questionAdminEmbed.getState !== "function"
  ) {
    return true;
  }

  const timeoutAt = Date.now() + PARTICIPANT_SYNC_TIMEOUT_MS;
  while (Date.now() < timeoutAt) {
    try {
      const state = window.questionAdminEmbed.getState();
      if (state && state.eventId === expectedEventId && state.scheduleId === expectedScheduleId) {
        return true;
      }
    } catch (error) {
      break;
    }
    await wait(PARTICIPANT_SYNC_POLL_INTERVAL_MS);
  }
  return false;
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
    this.stage = "events";
    this.stageHistory = new Set(["events"]);
    this.activePanel = "events";
    this.activeDialog = null;
    this.lastFocused = null;
    this.confirmResolver = null;
    this.redirectingToIndex = false;
    this.eventsLoadingDepth = 0;
    this.eventsLoadingMessage = "";
    this.scheduleLoadingDepth = 0;
    this.scheduleLoadingMessage = "";
    this.embeddedTools = {
      participants: { promise: null, ready: false },
      operator: { promise: null, ready: false }
    };
    this.lastToolContextSignature = "";
    this.lastToolContextApplied = false;
    this.pendingToolSync = false;
    this.toolSyncPromise = null;
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
    this.handleParticipantSyncEvent = this.handleParticipantSyncEvent.bind(this);
    this.handleParticipantSelectionBroadcast = this.handleParticipantSelectionBroadcast.bind(this);
    this.cleanup = this.cleanup.bind(this);
    this.eventCountNote = "";
    this.stageNote = "";
    this.lastParticipantsErrorMessage = "";
    this.participantSyncInfo = null;
    this.applyMetaNote();
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
    this.observeAuthState();
    if (typeof document !== "undefined") {
      document.addEventListener("qa:participants-synced", this.handleParticipantSyncEvent);
      document.addEventListener("qa:selection-changed", this.handleParticipantSelectionBroadcast);
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
    this.lastToolContextSignature = "";
    this.lastToolContextApplied = false;
    this.pendingToolSync = false;
    this.toolSyncPromise = null;
    this.eventsLoadingDepth = 0;
    this.eventsLoadingMessage = "";
    this.scheduleLoadingDepth = 0;
    this.scheduleLoadingMessage = "";
    this.eventCountNote = "";
    this.stageNote = "";
    this.lastParticipantsErrorMessage = "";
    this.applyMetaNote();
    this.applyEventsLoadingState();
    this.applyScheduleLoadingState();
    this.resetToolFrames();
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
    this.eventsLoadingDepth += 1;
    if (message || !this.eventsLoadingMessage) {
      this.eventsLoadingMessage = message;
    }
    this.applyEventsLoadingState();
  }

  endEventsLoading() {
    this.eventsLoadingDepth = Math.max(0, this.eventsLoadingDepth - 1);
    if (this.eventsLoadingDepth === 0) {
      this.eventsLoadingMessage = "";
    }
    this.applyEventsLoadingState();
  }

  updateEventsLoadingMessage(message = "") {
    if (this.eventsLoadingDepth === 0) {
      this.eventsLoadingMessage = "";
      this.applyEventsLoadingState();
      return;
    }
    this.eventsLoadingMessage = message || this.eventsLoadingMessage;
    this.applyEventsLoadingState();
  }

  applyEventsLoadingState() {
    const active = this.eventsLoadingDepth > 0;
    if (this.dom.loading) {
      this.dom.loading.hidden = !active;
    }
    if (this.dom.loadingText) {
      this.dom.loadingText.textContent = active ? this.eventsLoadingMessage || "" : "";
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
    this.updateUserLabel();
    if (!user) {
      this.events = [];
      this.renderEvents();
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
    this.lastToolContextSignature = "";
    this.lastToolContextApplied = false;
    this.updateMetaNote();
    this.updateDocumentTitle();
    this.ensureSelectedEvent(previousEventId);
    this.renderEvents();
    this.updateScheduleStateFromSelection(previousScheduleId);

    if (this.stage === "tabs") {
      const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
      if (activeConfig.requireSchedule && this.selectedEventId && this.selectedScheduleId) {
        this.syncEmbeddedTools().catch((error) => logError("Failed to sync tools after refresh", error));
      }
    }

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
      editBtn.className = "btn-icon";
      editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
      editBtn.title = "イベントを編集";
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openEventDialog({ mode: "edit", event });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-icon";
      deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
      deleteBtn.title = "イベントを削除";
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
    if (normalized && !this.events.some((event) => event.id === normalized)) {
      return;
    }

    this.selectedEventId = normalized;
    if (previous !== normalized) {
      this.lastToolContextSignature = "";
      this.lastToolContextApplied = false;
      this.pendingToolSync = false;
    }
    this.renderEvents();
    this.updateScheduleStateFromSelection();
    this.updateEventSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.handleToolContextAfterSelection();
  }

  ensureSelectedSchedule(preferredId = "") {
    const availableIds = new Set(this.schedules.map((schedule) => schedule.id));
    const desiredId = preferredId || this.selectedScheduleId;
    if (desiredId && availableIds.has(desiredId)) {
      this.selectedScheduleId = desiredId;
    } else {
      this.selectedScheduleId = "";
      this.pendingToolSync = false;
      this.lastToolContextSignature = "";
      this.lastToolContextApplied = false;
    }
  }

  getSelectedSchedule() {
    if (!this.selectedScheduleId) return null;
    return this.schedules.find((schedule) => schedule.id === this.selectedScheduleId) || null;
  }

  selectSchedule(scheduleId) {
    const previous = this.selectedScheduleId;
    const normalized = ensureString(scheduleId);
    if (normalized && !this.schedules.some((schedule) => schedule.id === normalized)) {
      return;
    }

    this.selectedScheduleId = normalized;
    if (previous !== normalized) {
      this.lastToolContextSignature = "";
      this.lastToolContextApplied = false;
      this.pendingToolSync = false;
    }
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.handleToolContextAfterSelection();
  }

  updateScheduleStateFromSelection(preferredScheduleId = "") {
    const event = this.getSelectedEvent();
    this.schedules = event ? [...event.schedules] : [];
    this.ensureSelectedSchedule(preferredScheduleId);
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.handleToolContextAfterSelection();
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
      editBtn.className = "btn-icon";
      editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
      editBtn.title = "日程を編集";
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openScheduleDialog({ mode: "edit", schedule });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-icon";
      deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
      deleteBtn.title = "日程を削除";
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
    this.dom.scheduleSummary.hidden = !hasSchedule;
    if (this.dom.scheduleSummaryEmpty) {
      if (hasSchedule) {
        this.dom.scheduleSummaryEmpty.hidden = true;
      } else {
        this.dom.scheduleSummaryEmpty.hidden = false;
        if (!event) {
          this.dom.scheduleSummaryEmpty.textContent = "イベントを選択してください。";
        } else {
          this.dom.scheduleSummaryEmpty.textContent = "日程を選択してください。";
        }
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

  handleToolContextAfterSelection() {
    if (!this.selectedEventId || !this.selectedScheduleId) {
      this.pendingToolSync = false;
      this.lastToolContextSignature = "";
      this.lastToolContextApplied = false;
      if (this.dom.participantsTool) {
        delete this.dom.participantsTool.dataset.expectedEventId;
        delete this.dom.participantsTool.dataset.expectedScheduleId;
        delete this.dom.participantsTool.dataset.expectedEventName;
        delete this.dom.participantsTool.dataset.expectedScheduleLabel;
        delete this.dom.participantsTool.dataset.expectedStartAt;
        delete this.dom.participantsTool.dataset.expectedEndAt;
        delete this.dom.participantsTool.dataset.syncedEventId;
        delete this.dom.participantsTool.dataset.syncedScheduleId;
        delete this.dom.participantsTool.dataset.syncedAt;
      }
      const message = this.selectedEventId
        ? "日程を選択すると参加者リストを読み込みます。"
        : "イベントと日程を選択すると参加者リストを読み込みます。";
      this.setParticipantStatus({ text: message, variant: "info" });
      return;
    }
    const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
    if (activeConfig.stage === "tabs" && activeConfig.requireSchedule) {
      this.pendingToolSync = false;
      this.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
    } else {
      this.pendingToolSync = true;
    }
  }

  setParticipantStatus({ text = "", meta = "", variant = "info" } = {}) {
    const container = this.dom.participantsStatus;
    if (!container) {
      return;
    }
    const baseClass = "flow-sync-status";
    const allowed = new Set(["info", "success", "error", "pending"]);
    const normalizedVariant = allowed.has(variant) ? variant : "info";
    const classes = [baseClass, `${baseClass}--${normalizedVariant}`];
    if (text) {
      classes.push("is-visible");
      container.hidden = false;
    } else {
      container.hidden = true;
    }
    container.className = classes.join(" ");
    const textEl = this.dom.participantsStatusText;
    const metaEl = this.dom.participantsStatusMeta;
    if (textEl) {
      textEl.textContent = text || "";
    } else if (text) {
      container.textContent = text;
    } else {
      container.textContent = "";
    }
    if (metaEl) {
      if (meta) {
        metaEl.hidden = false;
        metaEl.textContent = meta;
      } else {
        metaEl.hidden = true;
        metaEl.textContent = "";
      }
    }
  }

  handleParticipantSyncEvent(event) {
    if (!event || !event.detail) {
      return;
    }
    const detail = event.detail;
    const eventId = ensureString(detail.eventId);
    const scheduleId = ensureString(detail.scheduleId);
    if (eventId && this.selectedEventId && eventId !== this.selectedEventId) {
      return;
    }
    if (scheduleId && this.selectedScheduleId && scheduleId !== this.selectedScheduleId) {
      return;
    }
    const timestamp = Number(detail.timestamp) || Date.now();
    if (!eventId || !scheduleId) {
      if (!this.selectedEventId || !this.selectedScheduleId) {
        const message = this.selectedEventId
          ? "日程を選択すると参加者リストを読み込みます。"
          : "イベントと日程を選択すると参加者リストを読み込みます。";
        this.participantSyncInfo = null;
        this.setParticipantStatus({ text: message, variant: "info" });
        if (this.dom.participantsTool) {
          delete this.dom.participantsTool.dataset.syncedEventId;
          delete this.dom.participantsTool.dataset.syncedScheduleId;
          delete this.dom.participantsTool.dataset.syncedAt;
        }
      }
      return;
    }

    const success = detail.success !== false;
    if (success) {
      const participantCount = Number(detail.participantCount);
      const countText = Number.isFinite(participantCount) && participantCount >= 0 ? `参加者 ${participantCount}名` : "";
      let scheduleRange = ensureString(detail.scheduleRange);
      if (!scheduleRange) {
        const selectedSchedule = this.getSelectedSchedule();
        if (selectedSchedule) {
          scheduleRange = formatScheduleRange(selectedSchedule.startAt, selectedSchedule.endAt);
        }
      }
      const metaParts = [];
      if (countText) {
        metaParts.push(countText);
      }
      if (scheduleRange) {
        metaParts.push(`時間 ${scheduleRange}`);
      }
      const relative = timestamp ? formatRelative(timestamp) : "";
      if (relative && relative !== "—") {
        metaParts.push(`${relative}に更新`);
      }
      const selectedEvent = this.getSelectedEvent();
      const selectedSchedule = this.getSelectedSchedule();
      const eventLabel = ensureString(detail.eventName) || selectedEvent?.name || eventId;
      const scheduleLabel = ensureString(detail.scheduleLabel) || selectedSchedule?.label || scheduleId;
      this.participantSyncInfo = { ...detail, timestamp };
      this.setParticipantStatus({
        text: `参加者リストを同期しました: イベント「${eventLabel}」/ 日程「${scheduleLabel}」`,
        meta: metaParts.filter(Boolean).join(" / "),
        variant: "success"
      });
      if (this.dom.participantsTool) {
        this.dom.participantsTool.dataset.syncedEventId = eventId;
        this.dom.participantsTool.dataset.syncedScheduleId = scheduleId;
        this.dom.participantsTool.dataset.syncedAt = String(timestamp);
      }
      return;
    }

    const reason = ensureString(detail.reason);
    if (reason === "selection-missing") {
      const message = this.selectedEventId
        ? "日程を選択すると参加者リストを読み込みます。"
        : "イベントと日程を選択すると参加者リストを読み込みます。";
      this.participantSyncInfo = null;
      this.setParticipantStatus({ text: message, variant: "info" });
      if (this.dom.participantsTool) {
        delete this.dom.participantsTool.dataset.syncedEventId;
        delete this.dom.participantsTool.dataset.syncedScheduleId;
        delete this.dom.participantsTool.dataset.syncedAt;
      }
      return;
    }

    const errorMessage = ensureString(detail.error);
    const text = errorMessage
      ? `参加者リストの読み込みに失敗しました: ${errorMessage}`
      : "参加者リストの読み込みに失敗しました。";
    const relative = timestamp ? formatRelative(timestamp) : "";
    const metaParts = [];
    if (relative && relative !== "—") {
      metaParts.push(`${relative}に報告`);
    }
    this.participantSyncInfo = { ...detail, timestamp };
    this.setParticipantStatus({
      text,
      meta: metaParts.join(" / "),
      variant: "error"
    });
  }

  async handleParticipantSelectionBroadcast(event) {
    if (!event || !event.detail) {
      return;
    }
    const { detail } = event;
    const source = ensureString(detail.source);
    if (source && source !== "participants" && source !== "question-admin") {
      return;
    }
    const eventId = ensureString(detail.eventId);
    const scheduleId = ensureString(detail.scheduleId);
    if (!eventId) {
      return;
    }

    try {
      if (!this.events.some((item) => item.id === eventId)) {
        await this.loadEvents();
      }
    } catch (error) {
      logError("Failed to refresh events after participant selection", error);
      return;
    }

    const matchedEvent = this.events.find((item) => item.id === eventId) || null;
    if (!matchedEvent) {
      return;
    }

    const eventName = ensureString(detail.eventName);
    if (eventName) {
      matchedEvent.name = eventName;
    }

    if (!Array.isArray(matchedEvent.schedules)) {
      matchedEvent.schedules = [];
    }

    let scheduleRecord = null;
    if (scheduleId) {
      scheduleRecord = matchedEvent.schedules.find((item) => item.id === scheduleId) || null;
      if (!scheduleRecord) {
        scheduleRecord = {
          id: scheduleId,
          label: ensureString(detail.scheduleLabel) || scheduleId,
          startAt: ensureString(detail.startAt),
          endAt: ensureString(detail.endAt)
        };
        matchedEvent.schedules.push(scheduleRecord);
      } else {
        const label = ensureString(detail.scheduleLabel);
        if (label) {
          scheduleRecord.label = label;
        }
        if (detail.startAt !== undefined) {
          scheduleRecord.startAt = ensureString(detail.startAt);
        }
        if (detail.endAt !== undefined) {
          scheduleRecord.endAt = ensureString(detail.endAt);
        }
      }
    }

    matchedEvent.scheduleCount = matchedEvent.schedules.length;

    this.renderEvents();
    this.updateEventSummary();

    if (this.selectedEventId !== eventId) {
      this.selectEvent(eventId);
    } else {
      this.updateScheduleStateFromSelection(scheduleId);
    }

    if (scheduleId) {
      if (this.selectedScheduleId !== scheduleId) {
        this.selectSchedule(scheduleId);
      }
    } else if (this.selectedScheduleId) {
      this.selectSchedule("");
    }

    const tabPanels = new Set(["participants", "operator", "dictionary", "logs"]);
    const targetPanel = tabPanels.has(this.activePanel) ? this.activePanel : "participants";
    this.showPanel(targetPanel);
  }

  clearLoadingIndicators() {
    this.eventsLoadingDepth = 0;
    this.eventsLoadingMessage = "";
    this.scheduleLoadingDepth = 0;
    this.scheduleLoadingMessage = "";
    this.applyEventsLoadingState();
    this.applyScheduleLoadingState();
  }

  async loadEmbeddedTool(tool) {
    const entry = this.embeddedTools[tool];
    if (!entry) {
      return;
    }
    if (entry.ready) {
      return;
    }
    if (!entry.promise) {
      entry.promise = (async () => {
        if (typeof document !== "undefined") {
          if (tool === "participants") {
            document.documentElement.dataset.qaEmbedPrefix = "qa-";
          } else if (tool === "operator") {
            document.documentElement.dataset.operatorEmbedPrefix = "op-";
          }
        }
        if (tool === "participants") {
          await import("../question-admin/index.js");
        } else {
          await import("../operator/index.js");
        }
        entry.ready = true;
      })().catch((error) => {
        logError(`Failed to load ${tool} tool`, error);
        entry.ready = false;
        entry.promise = null;
        throw error;
      });
    }
    await entry.promise;
  }

  prepareToolFrames() {
    if (typeof document === "undefined") {
      return;
    }

    const html = document.documentElement;
    if (html) {
      if (!html.dataset.qaEmbedPrefix) {
        html.dataset.qaEmbedPrefix = "qa-";
      }
      if (!html.dataset.operatorEmbedPrefix) {
        html.dataset.operatorEmbedPrefix = "op-";
      }
    }

    const ensurePrepared = (element, loginSelector) => {
      if (!element || element.dataset.prepared === "true") {
        return;
      }
      element.dataset.prepared = "true";
      if (loginSelector) {
        const loginElement = element.querySelector(loginSelector);
        if (loginElement) {
          loginElement.remove();
        }
      }
    };

    ensurePrepared(this.dom.participantsTool, "#qa-login-card");
    ensurePrepared(this.dom.operatorTool, "#op-login-container");
    if (document.body) {
      document.body.classList.add("dictionary-collapsed", "logs-collapsed");
      document.body.classList.remove("dictionary-open", "logs-open");
    }
  }

  resetToolFrames() {
    this.embeddedTools = {
      participants: { promise: null, ready: false },
      operator: { promise: null, ready: false }
    };
    this.lastToolContextSignature = "";
    this.lastToolContextApplied = false;
    if (typeof window !== "undefined") {
      try {
        window.questionAdminEmbed?.reset?.();
      } catch (error) {
        console.warn("Failed to reset participant tool state", error);
      }
      try {
        window.operatorEmbed?.reset?.();
      } catch (error) {
        console.warn("Failed to reset operator tool state", error);
      }
    }
  }

  async syncEmbeddedTools() {
    if (this.toolSyncPromise) {
      return this.toolSyncPromise;
    }

    const run = (async () => {
      this.prepareToolFrames();
      const schedule = this.getSelectedSchedule();
      const event = this.getSelectedEvent();
      if (!schedule || !event) {
        this.lastToolContextSignature = "";
        this.lastToolContextApplied = false;
        this.pendingToolSync = false;
        return;
      }
      const eventLabel = event.name || event.id;
      const scheduleLabel = schedule.label || schedule.id;
      const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
      if (this.dom.participantsTool) {
        this.dom.participantsTool.dataset.expectedEventId = event.id;
        this.dom.participantsTool.dataset.expectedScheduleId = schedule.id;
        this.dom.participantsTool.dataset.expectedEventName = eventLabel;
        this.dom.participantsTool.dataset.expectedScheduleLabel = scheduleLabel;
        this.dom.participantsTool.dataset.expectedStartAt = schedule.startAt || "";
        this.dom.participantsTool.dataset.expectedEndAt = schedule.endAt || "";
      }
      const contextKey = [
        event.id,
        schedule.id,
        event.name || "",
        schedule.label || "",
        schedule.startAt || "",
        schedule.endAt || ""
      ].join("::");
      if (this.lastToolContextSignature === contextKey && this.lastToolContextApplied) {
        this.pendingToolSync = false;
        return;
      }
      this.lastToolContextApplied = false;
      const context = {
        eventId: event.id,
        eventName: event.name || event.id,
        scheduleId: schedule.id,
        scheduleLabel: schedule.label || schedule.id,
        startAt: schedule.startAt || "",
        endAt: schedule.endAt || ""
      };
      const pendingMeta = [];
      if (rangeText) {
        pendingMeta.push(`時間 ${rangeText}`);
      }
      pendingMeta.push("同期処理中…");
      this.setParticipantStatus({
        text: `参加者リストを同期しています: イベント「${eventLabel}」/ 日程「${scheduleLabel}」`,
        meta: pendingMeta.join(" / "),
        variant: "pending"
      });
      let participantsSynced = false;
      let participantsError = null;
      try {
        await this.loadEmbeddedTool("participants");
        if (window.questionAdminEmbed?.waitUntilReady) {
          await window.questionAdminEmbed.waitUntilReady();
        }
        if (window.questionAdminEmbed?.setSelection) {
          await window.questionAdminEmbed.setSelection(context);
          const acknowledged = await waitForParticipantSelectionAck(context.eventId, context.scheduleId);
          if (!acknowledged) {
            throw new Error("参加者ツールに選択内容が反映されませんでした。");
          }
        }
        participantsSynced = true;
      } catch (error) {
        participantsError = error instanceof Error ? error : new Error(String(error ?? ""));
        logError("Failed to sync participant tool", error);
      }
      try {
        await this.loadEmbeddedTool("operator");
        if (window.operatorEmbed?.waitUntilReady) {
          await window.operatorEmbed.waitUntilReady();
        }
        if (window.operatorEmbed?.setContext) {
          window.operatorEmbed.setContext(context);
        }
      } catch (error) {
        logError("Failed to sync operator tool", error);
      }
      const overlay = typeof document !== "undefined" ? document.getElementById("qa-loading-overlay") : null;
      if (overlay) {
        overlay.hidden = true;
      }
      if (participantsSynced) {
        this.lastToolContextSignature = contextKey;
        this.lastToolContextApplied = true;
        this.pendingToolSync = false;
        const successMeta = [];
        if (rangeText) {
          successMeta.push(`時間 ${rangeText}`);
        }
        successMeta.push("同期完了");
        this.setParticipantStatus({
          text: `参加者リストの同期を完了しました: イベント「${eventLabel}」/ 日程「${scheduleLabel}」`,
          meta: successMeta.join(" / "),
          variant: "success"
        });
        if (this.lastParticipantsErrorMessage && this.dom.alert && !this.dom.alert.hidden) {
          const currentText = String(this.dom.alert.textContent || "").trim();
          if (currentText === this.lastParticipantsErrorMessage.trim()) {
            this.clearAlert();
          }
        }
        this.lastParticipantsErrorMessage = "";
      } else {
        this.pendingToolSync = true;
        if (participantsError && this.activePanel === "participants") {
          const message = participantsError.message
            ? `参加者リストの初期化に失敗しました: ${participantsError.message}`
            : "参加者リストの初期化に失敗しました。時間をおいて再試行してください。";
          this.lastParticipantsErrorMessage = message;
          this.showAlert(message);
          this.setParticipantStatus({ text: message, variant: "error" });
        }
      }
    })();

    this.toolSyncPromise = run.finally(() => {
      if (this.toolSyncPromise === run) {
        this.toolSyncPromise = null;
      }
    });

    return this.toolSyncPromise;
  }

  updateStageUi() {
    if (this.dom.main) {
      this.dom.main.dataset.stage = this.stage;
    }
    this.updateStageHeader();
    this.updateStageIndicator();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
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
      this.prepareToolFrames();
      const hasSelection = this.selectedEventId && this.selectedScheduleId;
      if (config.requireSchedule && hasSelection) {
        this.pendingToolSync = false;
        this.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
      } else if (this.pendingToolSync && hasSelection) {
        this.pendingToolSync = false;
        this.syncEmbeddedTools().catch((error) => logError("Failed to sync tools", error));
      }
    }
    this.handlePanelSetup(normalized, config).catch((error) => logError("Failed to prepare panel", error));
  }

  async handlePanelSetup(panel, config) {
    if (config.stage !== "tabs") {
      await this.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (config.requireSchedule) {
      await this.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (panel === "dictionary") {
      await this.setDrawerState({ dictionary: true, logs: false });
    } else if (panel === "logs") {
      await this.setDrawerState({ dictionary: false, logs: true });
    } else {
      await this.setDrawerState({ dictionary: false, logs: false });
    }
  }

  getPanelModules() {
    return {
      events: this.dom.eventsModule,
      schedules: this.dom.schedulesModule,
      participants: this.dom.participantsPanel,
      operator: this.dom.operatorPanel,
      dictionary: this.dom.dictionaryPanel,
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

  async ensureOperatorAppReady() {
    await this.loadEmbeddedTool("operator");
    if (window.operatorEmbed?.waitUntilReady) {
      try {
        await window.operatorEmbed.waitUntilReady();
      } catch (error) {
        logError("Failed to wait for operator tool", error);
      }
    }
    return window.operatorEmbed?.app || null;
  }

  async setDrawerState({ dictionary, logs }) {
    const needsDictionary = typeof dictionary === "boolean";
    const needsLogs = typeof logs === "boolean";
    if (!needsDictionary && !needsLogs) {
      return;
    }
    if (!window.operatorEmbed?.app && dictionary === false && logs === false) {
      return;
    }
    const app = await this.ensureOperatorAppReady();
    if (!app) {
      return;
    }
    if (typeof dictionary === "boolean") {
      try {
        app.toggleDictionaryDrawer(dictionary, false);
      } catch (error) {
        logError("Failed to toggle dictionary drawer", error);
      }
    }
    if (typeof logs === "boolean") {
      try {
        app.toggleLogsDrawer(logs, false);
      } catch (error) {
        logError("Failed to toggle logs drawer", error);
      }
    }
  }

  cleanup() {
    if (typeof document !== "undefined") {
      document.removeEventListener("qa:participants-synced", this.handleParticipantSyncEvent);
      document.removeEventListener("qa:selection-changed", this.handleParticipantSelectionBroadcast);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.cleanup);
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
    this.scheduleLoadingDepth += 1;
    if (message || !this.scheduleLoadingMessage) {
      this.scheduleLoadingMessage = message;
    }
    this.applyScheduleLoadingState();
  }

  endScheduleLoading() {
    this.scheduleLoadingDepth = Math.max(0, this.scheduleLoadingDepth - 1);
    if (this.scheduleLoadingDepth === 0) {
      this.scheduleLoadingMessage = "";
    }
    this.applyScheduleLoadingState();
  }

  updateScheduleLoadingMessage(message = "") {
    if (this.scheduleLoadingDepth === 0) {
      this.scheduleLoadingMessage = "";
      this.applyScheduleLoadingState();
      return;
    }
    this.scheduleLoadingMessage = message || this.scheduleLoadingMessage;
    this.applyScheduleLoadingState();
  }

  applyScheduleLoadingState() {
    const active = this.scheduleLoadingDepth > 0;
    if (this.dom.scheduleLoading) {
      this.dom.scheduleLoading.hidden = !active;
    }
    if (this.dom.scheduleLoadingText) {
      this.dom.scheduleLoadingText.textContent = active ? this.scheduleLoadingMessage || "" : "";
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
    const parts = [this.eventCountNote, this.stageNote].filter(Boolean);
    if (!parts.length) {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
      return;
    }
    this.dom.metaNote.hidden = false;
    this.dom.metaNote.textContent = parts.join(" — ");
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

  async requestSheetSync() {
    if (!this.api) {
      return;
    }
    try {
      await this.api.apiPost({ action: "syncQuestionIntakeToSheet" });
    } catch (error) {
      console.warn("Failed to request sheet sync:", error);
    }
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

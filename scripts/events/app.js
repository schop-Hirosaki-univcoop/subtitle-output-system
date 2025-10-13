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
import { formatScheduleRange } from "../operator/utils.js";

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
    description: "イベントカードを追加・編集し、進めたいイベントを選択してください。"
  },
  schedules: {
    title: "日程の管理",
    description: "選択したイベントの日程カードから、次に進める日程を決めてください。"
  },
  tabs: {
    title: "参加者とテロップのツール",
    description: "まとめた情報を確認して、参加者リスト管理とテロップ操作パネルを切り替えて利用できます。"
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
    this.activeTab = "participants";
    this.activeDialog = null;
    this.lastFocused = null;
    this.confirmResolver = null;
    this.redirectingToIndex = false;
    this.toolFrames = {
      participants: { currentUrl: "", isLoaded: false },
      operator: { currentUrl: "", isLoaded: false }
    };
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
  }

  init() {
    this.bindEvents();
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateEventSummary();
    this.updateScheduleSummary();
    this.updateToolSummary();
    this.updateSelectionNotes();
    this.observeAuthState();
  }

  resetFlowState() {
    this.selectedEventId = "";
    this.schedules = [];
    this.selectedScheduleId = "";
    this.stage = "events";
    this.stageHistory = new Set(["events"]);
    this.activeTab = "participants";
    if (this.dom.scheduleLoading) {
      this.dom.scheduleLoading.hidden = true;
    }
    this.renderEvents();
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateEventSummary();
    this.updateToolSummary();
    this.resetToolFrames(true);
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateSelectionNotes();
  }

  bindEvents() {
    if (this.dom.addEventButton) {
      this.dom.addEventButton.addEventListener("click", () => this.openEventDialog({ mode: "create" }));
    }

    if (this.dom.refreshButton) {
      this.dom.refreshButton.addEventListener("click", () => {
        this.loadEvents().catch((error) => {
          console.error("Failed to refresh events:", error);
          this.showAlert(error.message || "イベントの再読み込みに失敗しました。");
        });
      });
    }

    if (this.dom.nextButton) {
      this.dom.nextButton.addEventListener("click", () => {
        this.goToStage("schedules");
      });
    }

    if (this.dom.eventChangeButton) {
      this.dom.eventChangeButton.addEventListener("click", () => {
        this.setStage("events");
      });
    }

    if (this.dom.scheduleBackButton) {
      this.dom.scheduleBackButton.addEventListener("click", () => {
        this.setStage("events");
      });
    }

    if (this.dom.scheduleChangeButton) {
      this.dom.scheduleChangeButton.addEventListener("click", () => {
        this.setStage("schedules");
      });
    }

    if (this.dom.scheduleNextButton) {
      this.dom.scheduleNextButton.addEventListener("click", () => {
        this.enterTabsStage("participants");
      });
    }

    if (this.dom.flowTabsBackButton) {
      this.dom.flowTabsBackButton.addEventListener("click", () => {
        this.setStage("schedules");
      });
    }

    if (this.dom.participantsTab) {
      this.dom.participantsTab.addEventListener("click", () => {
        this.switchTab("participants");
      });
    }

    if (this.dom.operatorTab) {
      this.dom.operatorTab.addEventListener("click", () => {
        this.switchTab("operator");
      });
    }

    if (this.dom.participantsFrame) {
      this.dom.participantsFrame.addEventListener("load", () => {
        this.handleToolFrameLoad("participants");
      });
    }

    if (this.dom.operatorFrame) {
      this.dom.operatorFrame.addEventListener("load", () => {
        this.handleToolFrameLoad("operator");
      });
    }

    if (this.dom.eventForm) {
      this.dom.eventForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleEventFormSubmit().catch((error) => {
          console.error("Event form submit failed:", error);
          this.setFormError(this.dom.eventError, error.message || "イベントの保存に失敗しました。");
        });
      });
    }

    if (this.dom.scheduleForm) {
      this.dom.scheduleForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleScheduleFormSubmit().catch((error) => {
          console.error("Schedule form submit failed:", error);
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
      this.dom.scheduleRefreshButton.addEventListener("click", () => {
        this.reloadSchedules().catch((error) => {
          console.error("Failed to refresh schedules:", error);
          this.showAlert(error.message || "日程の再読み込みに失敗しました。");
        });
      });
    }
  }

  observeAuthState() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
    this.authUnsubscribe = onAuthStateChanged(auth, (user) => {
      this.handleAuthState(user).catch((error) => {
        console.error("Failed to handle event admin auth state:", error);
        this.showAlert(error.message || "初期化に失敗しました。時間をおいて再度お試しください。");
      });
    });
  }

  showLoggedOutState() {
    if (this.redirectingToIndex) {
      return;
    }
    this.resetFlowState();
    this.toggleLoading(false);
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

  setLoadingMessage(message) {
    if (this.dom.loadingText) {
      this.dom.loadingText.textContent = message || "";
    }
  }

  toggleLoading(isLoading) {
    if (this.dom.loading) {
      this.dom.loading.hidden = !isLoading;
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
      this.setLoadingMessage("権限を確認しています…");
      this.toggleLoading(true);
      await this.ensureAdminAccess();
      this.setLoadingMessage("イベント情報を読み込んでいます…");
      await this.loadEvents();
      this.updateEventSummary();
      this.updateScheduleSummary();
      this.updateToolSummary();
      this.updateSelectionNotes();
    } catch (error) {
      console.error("Event admin initialization failed:", error);
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
      this.toggleLoading(false);
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
    this.updateMetaNote();
    this.updateDocumentTitle();
    this.ensureSelectedEvent(previousEventId);
    this.renderEvents();
    this.updateScheduleStateFromSelection(previousScheduleId);

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

      const hubLink = document.createElement("a");
      hubLink.className = "btn btn-primary btn-sm";
      hubLink.href = this.buildEventHubUrl(event);
      hubLink.textContent = "日程ハブ";
      actions.appendChild(hubLink);

      const participantsLink = document.createElement("a");
      participantsLink.className = "btn btn-ghost btn-sm";
      participantsLink.href = this.buildParticipantAdminUrl(event);
      participantsLink.target = "_blank";
      participantsLink.rel = "noreferrer noopener";
      participantsLink.textContent = "参加者管理";
      actions.appendChild(participantsLink);

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
          console.error("Failed to delete event:", error);
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
    const normalized = ensureString(eventId);
    if (normalized && !this.events.some((event) => event.id === normalized)) {
      return;
    }

    this.selectedEventId = normalized;
    this.renderEvents();
    this.updateScheduleStateFromSelection();
    this.updateEventSummary();
    this.updateToolSummary();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    if (this.stage === "tabs") {
      this.setStage(this.selectedEventId ? "schedules" : "events");
    } else if (!normalized && this.stage === "schedules") {
      this.setStage("events");
    }
  }

  ensureSelectedSchedule(preferredId = "") {
    const availableIds = new Set(this.schedules.map((schedule) => schedule.id));
    const desiredId = preferredId || this.selectedScheduleId;
    if (desiredId && availableIds.has(desiredId)) {
      this.selectedScheduleId = desiredId;
    } else {
      this.selectedScheduleId = "";
    }
  }

  getSelectedSchedule() {
    if (!this.selectedScheduleId) return null;
    return this.schedules.find((schedule) => schedule.id === this.selectedScheduleId) || null;
  }

  selectSchedule(scheduleId) {
    const normalized = ensureString(scheduleId);
    if (normalized && !this.schedules.some((schedule) => schedule.id === normalized)) {
      return;
    }

    this.selectedScheduleId = normalized;
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateToolSummary();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    if (this.stageHistory.has("tabs")) {
      if (this.selectedScheduleId) {
        this.prepareToolFrames();
      } else {
        this.resetToolFrames();
      }
    }
    if (this.stage === "tabs" && this.selectedScheduleId) {
      this.switchTab(this.activeTab);
    } else if (!normalized && this.stage === "tabs") {
      this.setStage("schedules");
    }
  }

  updateScheduleStateFromSelection(preferredScheduleId = "") {
    const event = this.getSelectedEvent();
    this.schedules = event ? [...event.schedules] : [];
    this.ensureSelectedSchedule(preferredScheduleId);
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateToolSummary();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    if (!this.selectedScheduleId) {
      this.resetToolFrames(true);
    }
    if (!event && (this.stage === "schedules" || this.stage === "tabs")) {
      this.setStage("events");
    }
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

      const hubLink = document.createElement("a");
      hubLink.className = "btn btn-primary btn-sm";
      hubLink.href = this.buildScheduleHubUrl(schedule);
      hubLink.textContent = "日程ハブ";
      actions.appendChild(hubLink);

      const participantsLink = document.createElement("a");
      participantsLink.className = "btn btn-ghost btn-sm";
      participantsLink.href = this.buildParticipantAdminUrlForSchedule(schedule);
      participantsLink.target = "_blank";
      participantsLink.rel = "noreferrer noopener";
      participantsLink.textContent = "参加者管理";
      actions.appendChild(participantsLink);

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
          console.error("Failed to delete schedule:", error);
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
    if (this.dom.eventChangeButton) {
      this.dom.eventChangeButton.disabled = !event;
    }
  }

  updateScheduleSummary() {
    if (!this.dom.scheduleSummary) return;

    const event = this.getSelectedEvent();
    const schedule = this.getSelectedSchedule();
    if (event && schedule) {
      this.dom.scheduleSummary.hidden = false;
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
    } else {
      this.dom.scheduleSummary.hidden = true;
    }
    if (this.dom.scheduleChangeButton) {
      this.dom.scheduleChangeButton.disabled = !schedule;
    }
  }

  updateToolSummary() {
    const event = this.getSelectedEvent();
    const schedule = this.getSelectedSchedule();
    if (this.dom.toolSummaryEvent) {
      this.dom.toolSummaryEvent.textContent = event ? event.name || event.id : "—";
    }
    if (this.dom.toolSummarySchedule) {
      this.dom.toolSummarySchedule.textContent = schedule ? schedule.label || schedule.id : "—";
    }
    if (this.dom.toolSummaryTime && this.dom.toolSummaryTimeRow) {
      const rangeText = schedule ? formatScheduleRange(schedule.startAt, schedule.endAt) : "";
      if (rangeText) {
        this.dom.toolSummaryTimeRow.hidden = false;
        this.dom.toolSummaryTime.textContent = rangeText;
      } else {
        this.dom.toolSummaryTimeRow.hidden = true;
        this.dom.toolSummaryTime.textContent = "";
      }
    }
  }

  prepareToolFrames() {
    const schedule = this.getSelectedSchedule();
    if (!schedule) {
      this.resetToolFrames();
      return;
    }
    this.updateToolFrame("participants", this.buildParticipantAdminUrlForSchedule(schedule));
    this.updateToolFrame("operator", this.buildOperatorPanelUrl(schedule));
  }

  updateToolFrame(tool, baseUrl) {
    if (typeof window === "undefined") {
      return;
    }
    if (!baseUrl) {
      return;
    }
    const frame = tool === "participants" ? this.dom.participantsFrame : this.dom.operatorFrame;
    const loader = tool === "participants" ? this.dom.participantsLoader : this.dom.operatorLoader;
    const state = this.toolFrames[tool];
    if (!frame || !state) {
      return;
    }
    const url = new URL(baseUrl, window.location.href);
    url.searchParams.set("embed", "1");
    const urlString = url.toString();
    if (state.currentUrl === urlString) {
      return;
    }
    state.currentUrl = urlString;
    state.isLoaded = false;
    frame.hidden = true;
    if (loader) {
      loader.hidden = false;
    }
    frame.src = urlString;
  }

  handleToolFrameLoad(tool) {
    const frame = tool === "participants" ? this.dom.participantsFrame : this.dom.operatorFrame;
    const loader = tool === "participants" ? this.dom.participantsLoader : this.dom.operatorLoader;
    const state = this.toolFrames[tool];
    if (!frame || !state) {
      return;
    }
    state.isLoaded = true;
    if (loader) {
      loader.hidden = true;
    }
    if (state.currentUrl) {
      frame.hidden = false;
    }
  }

  resetToolFrames(clearUrl = false) {
    this.resetToolFrame("participants", clearUrl);
    this.resetToolFrame("operator", clearUrl);
  }

  resetToolFrame(tool, clearUrl) {
    const frame = tool === "participants" ? this.dom.participantsFrame : this.dom.operatorFrame;
    const loader = tool === "participants" ? this.dom.participantsLoader : this.dom.operatorLoader;
    const state = this.toolFrames[tool];
    if (!state) {
      return;
    }
    state.isLoaded = false;
    if (clearUrl) {
      state.currentUrl = "";
    }
    if (frame) {
      frame.hidden = true;
      if (clearUrl) {
        frame.removeAttribute("src");
      }
    }
    if (loader) {
      loader.hidden = true;
    }
  }

  updateStageUi() {
    if (this.dom.main) {
      this.dom.main.dataset.stage = this.stage;
    }
    const info = STAGE_INFO[this.stage] || STAGE_INFO.events;
    if (this.dom.stageTitle) {
      this.dom.stageTitle.textContent = info.title;
    }
    if (this.dom.stageDescription) {
      this.dom.stageDescription.textContent = info.description;
    }
    this.updateStageIndicator();
    this.updateStageModulesAccessibility();
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
    });
  }

  updateStageModulesAccessibility() {
    const accessibleByStage = {
      events: new Set(["events"]),
      schedules: new Set(["events", "schedules"]),
      tabs: new Set(["events", "schedules", "tabs"])
    };
    const active = accessibleByStage[this.stage] || accessibleByStage.events;
    this.setModuleAccessibility(this.dom.eventsModule, active.has("events"));
    this.setModuleAccessibility(this.dom.schedulesModule, active.has("schedules"));
    this.setModuleAccessibility(this.dom.tabsModule, active.has("tabs"));
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
    if (this.dom.participantsTab) {
      this.dom.participantsTab.disabled = !signedIn || !hasSchedule;
    }
    if (this.dom.operatorTab) {
      this.dom.operatorTab.disabled = !signedIn || !hasSchedule;
    }
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

  goToStage(stage) {
    if (stage === "schedules" && !this.selectedEventId) {
      this.revealEventSelectionCue();
      return;
    }
    if (stage === "tabs") {
      if (!this.selectedEventId) {
        this.revealEventSelectionCue();
        return;
      }
      if (!this.selectedScheduleId) {
        this.revealScheduleSelectionCue();
        return;
      }
    }
    this.setStage(stage);
    if (stage === "tabs") {
      this.updateToolSummary();
      this.prepareToolFrames();
      this.switchTab(this.activeTab);
    }
  }

  enterTabsStage(tab) {
    this.activeTab = tab === "operator" ? "operator" : "participants";
    this.goToStage("tabs");
  }

  switchTab(tab) {
    const normalized = tab === "operator" ? "operator" : "participants";
    this.activeTab = normalized;
    if (this.dom.participantsTab) {
      this.dom.participantsTab.classList.toggle("is-active", normalized === "participants");
      this.dom.participantsTab.setAttribute("aria-selected", normalized === "participants" ? "true" : "false");
    }
    if (this.dom.operatorTab) {
      this.dom.operatorTab.classList.toggle("is-active", normalized === "operator");
      this.dom.operatorTab.setAttribute("aria-selected", normalized === "operator" ? "true" : "false");
    }
    if (this.dom.participantsPanel) {
      this.dom.participantsPanel.classList.toggle("is-active", normalized === "participants");
      this.dom.participantsPanel.hidden = normalized !== "participants";
    }
    if (this.dom.operatorPanel) {
      this.dom.operatorPanel.classList.toggle("is-active", normalized === "operator");
      this.dom.operatorPanel.hidden = normalized !== "operator";
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

  setScheduleLoading(isLoading, message = "") {
    if (this.dom.scheduleLoading) {
      this.dom.scheduleLoading.hidden = !isLoading;
    }
    if (this.dom.scheduleLoadingText) {
      this.dom.scheduleLoadingText.textContent = message || "";
    }
  }

  async reloadSchedules() {
    if (!this.selectedEventId) {
      this.revealEventSelectionCue();
      return;
    }
    this.setScheduleLoading(true, "日程情報を再読み込みしています…");
    try {
      await this.loadEvents();
    } finally {
      this.setScheduleLoading(false);
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
    this.selectedScheduleId = scheduleId;
    await this.requestSheetSync();
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
    await update(ref(database), {
      [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: label,
      [`questionIntake/schedules/${eventId}/${scheduleId}/date`]: date,
      [`questionIntake/schedules/${eventId}/${scheduleId}/startAt`]: startValue,
      [`questionIntake/schedules/${eventId}/${scheduleId}/endAt`]: endValue,
      [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });

    await this.loadEvents();
    this.selectedScheduleId = scheduleId;
    await this.requestSheetSync();
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
      this.ensureSelectedSchedule("");
      if (this.stage === "tabs") {
        this.setStage("schedules");
      }
      await this.requestSheetSync();
    } catch (error) {
      throw new Error(error?.message || "日程の削除に失敗しました。");
    }
  }

  updateMetaNote() {
    if (!this.dom.metaNote) return;
    const count = this.events.length;
    if (count > 0) {
      this.dom.metaNote.hidden = false;
      this.dom.metaNote.textContent = `登録イベント数: ${count} 件`;
    } else {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
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

  buildEventHubUrl(event) {
    if (typeof window === "undefined") return "event-hub.html";
    const url = new URL("event-hub.html", window.location.href);
    if (event?.id) {
      url.searchParams.set("eventId", event.id);
    }
    if (event?.name) {
      url.searchParams.set("eventName", event.name);
    }
    return url.toString();
  }

  buildParticipantAdminUrl(event) {
    if (typeof window === "undefined") return "question-admin.html";
    const url = new URL("question-admin.html", window.location.href);
    if (event?.id) {
      url.searchParams.set("eventId", event.id);
      url.searchParams.set("focus", "participants");
    }
    if (event?.name) {
      url.searchParams.set("eventName", event.name);
    }
    return url.toString();
  }

  buildScheduleHubUrl(schedule) {
    if (typeof window === "undefined") return "schedule-hub.html";
    const url = new URL("schedule-hub.html", window.location.href);
    const event = this.getSelectedEvent();
    const eventId = event?.id || this.selectedEventId;
    if (eventId) url.searchParams.set("eventId", eventId);
    if (schedule?.id) url.searchParams.set("scheduleId", schedule.id);
    const scheduleKey = eventId && schedule?.id ? `${eventId}::${schedule.id}` : "";
    if (scheduleKey) url.searchParams.set("scheduleKey", scheduleKey);
    const eventName = event?.name || "";
    if (eventName) url.searchParams.set("eventName", eventName);
    if (schedule?.label) url.searchParams.set("scheduleLabel", schedule.label);
    if (schedule?.startAt) url.searchParams.set("startAt", schedule.startAt);
    if (schedule?.endAt) url.searchParams.set("endAt", schedule.endAt);
    url.searchParams.set("source", "events");
    return url.toString();
  }

  buildParticipantAdminUrlForSchedule(schedule) {
    if (typeof window === "undefined") return "question-admin.html";
    const event = this.getSelectedEvent();
    const url = new URL("question-admin.html", window.location.href);
    if (event?.id) {
      url.searchParams.set("eventId", event.id);
      url.searchParams.set("focus", "participants");
    }
    if (schedule?.id) {
      url.searchParams.set("scheduleId", schedule.id);
    }
    if (event?.name) {
      url.searchParams.set("eventName", event.name);
    }
    if (schedule?.label) {
      url.searchParams.set("scheduleLabel", schedule.label);
    }
    if (schedule?.startAt) url.searchParams.set("startAt", schedule.startAt);
    if (schedule?.endAt) url.searchParams.set("endAt", schedule.endAt);
    return url.toString();
  }

  buildOperatorPanelUrl(schedule) {
    if (typeof window === "undefined") return "operator.html";
    const event = this.getSelectedEvent();
    const url = new URL("operator.html", window.location.href);
    if (event?.id) url.searchParams.set("eventId", event.id);
    if (schedule?.id) url.searchParams.set("scheduleId", schedule.id);
    if (event?.name) url.searchParams.set("eventName", event.name);
    if (schedule?.label) url.searchParams.set("scheduleLabel", schedule.label);
    if (schedule?.startAt) url.searchParams.set("startAt", schedule.startAt);
    if (schedule?.endAt) url.searchParams.set("endAt", schedule.endAt);
    const scheduleKey = event?.id && schedule?.id ? `${event.id}::${schedule.id}` : "";
    if (scheduleKey) url.searchParams.set("scheduleKey", scheduleKey);
    url.searchParams.set("source", "events");
    return url.toString();
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
    await set(ref(database, `questionIntake/events/${eventId}`), {
      name: trimmed,
      createdAt: now,
      updatedAt: now
    });
    await this.loadEvents();
    await this.requestSheetSync();
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
    await update(ref(database), {
      [`questionIntake/events/${eventId}/name`]: trimmed,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });
    await this.loadEvents();
    await this.requestSheetSync();
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

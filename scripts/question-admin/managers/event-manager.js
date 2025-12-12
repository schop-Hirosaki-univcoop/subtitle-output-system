// event-manager.js: イベント管理機能のマネージャークラス
// イベント一覧の読み込み、描画、選択、CRUD操作を担当します。

import { rootDbRef, fetchDbValue, set, update } from "../firebase.js";
import { toMillis, normalizeKey, generateShortId } from "../utils.js";
import { collectParticipantTokens } from "../../shared/participant-tokens.js";

/**
 * イベント管理機能のマネージャークラス
 * QuestionAdminApp からイベント管理機能を分離したモジュール
 */
export class EventManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    
    // 依存関数と定数
    this.isHostAttached = context.isHostAttached;
    this.hostIntegration = context.hostIntegration; // null が渡される（HostIntegrationManager に移行済み）
    this.getHostController = context.getHostController; // HostIntegrationManager 経由でホストコントローラーを取得
    this.applyHostEvents = context.applyHostEvents;
    this.finalizeEventLoad = context.finalizeEventLoad;
    this.renderSchedules = context.renderSchedules;
    this.renderParticipants = context.renderParticipants;
    this.updateParticipantContext = context.updateParticipantContext;
    this.loadGlDataForEvent = context.loadGlDataForEvent;
    this.loadParticipants = context.loadParticipants;
    this.broadcastSelectionChange = context.broadcastSelectionChange;
    this.selectSchedule = context.selectSchedule;
    this.setCalendarPickedDate = context.setCalendarPickedDate;
    this.captureParticipantBaseline = context.captureParticipantBaseline;
    this.syncTemplateButtons = context.syncTemplateButtons;
    this.syncClearButtonState = context.syncClearButtonState;
    this.openDialog = context.openDialog;
    this.closeDialog = context.closeDialog;
    this.setFormError = context.setFormError;
    this.confirmAction = context.confirmAction;
    this.setUploadStatus = context.setUploadStatus;
    this.refreshScheduleLocationHistory = context.refreshScheduleLocationHistory;
    this.populateScheduleLocationOptions = context.populateScheduleLocationOptions;
    this.getSelectionBroadcastSource = context.getSelectionBroadcastSource;
    
    this.bindDom();
  }

  bindDom() {
    // DOM イベントのバインドは app.js で行うため、ここでは最小限の初期化のみ
  }

  /**
   * イベント一覧を読み込む
   * @param {Object} options - オプション
   * @param {boolean} options.preserveSelection - 選択状態を保持するか
   * @returns {Promise<Array>} イベント一覧
   */
  async loadEvents({ preserveSelection = true } = {}) {
    if (this.isHostAttached()) {
      const controller = this.getHostController();
      if (controller) {
        try {
          if (typeof controller.getEvents === "function") {
            const events = controller.getEvents();
            this.applyHostEvents(events, { preserveSelection });
            return this.state.events;
          }
        } catch (error) {
          console.warn("Failed to retrieve host events", error);
        }
      }
    }
    const previousEventId = preserveSelection ? this.state.selectedEventId : null;
    const previousScheduleId = preserveSelection ? this.state.selectedScheduleId : null;

    const [eventsBranch, schedulesBranch] = await Promise.all([
      fetchDbValue("questionIntake/events"),
      fetchDbValue("questionIntake/schedules")
    ]);

    const events = eventsBranch && typeof eventsBranch === "object" ? eventsBranch : {};
    const schedulesTree = schedulesBranch && typeof schedulesBranch === "object" ? schedulesBranch : {};

    const normalized = Object.entries(events).map(([eventId, eventValue]) => {
      const scheduleBranch = schedulesTree[eventId] && typeof schedulesTree[eventId] === "object"
        ? schedulesTree[eventId]
        : {};
      const scheduleList = Object.entries(scheduleBranch).map(([scheduleId, scheduleValue]) => ({
        id: String(scheduleId),
        label: String(scheduleValue?.label || ""),
        location: String(scheduleValue?.location || ""),
        date: String(scheduleValue?.date || ""),
        startAt: String(scheduleValue?.startAt || ""),
        endAt: String(scheduleValue?.endAt || ""),
        createdAt: scheduleValue?.createdAt || 0,
        updatedAt: scheduleValue?.updatedAt || 0,
        participantCount: Number(scheduleValue?.participantCount || 0)
      }));

      scheduleList.sort((a, b) => {
        const startDiff = toMillis(a.startAt || `${a.date}T00:00`) - toMillis(b.startAt || `${b.date}T00:00`);
        if (startDiff !== 0) return startDiff;
        const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt);
        if (createdDiff !== 0) return createdDiff;
        return a.label.localeCompare(b.label, "ja", { numeric: true });
      });

      return {
        id: String(eventId),
        name: String(eventValue?.name || ""),
        createdAt: eventValue?.createdAt || 0,
        updatedAt: eventValue?.updatedAt || 0,
        schedules: scheduleList
      };
    });

    normalized.sort((a, b) => {
      const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });

    this.state.events = normalized;

    this.finalizeEventLoad({
      preserveSelection,
      previousEventId,
      previousScheduleId,
      preserveStatus: false
    });

    return this.state.events;
  }

  /**
   * イベント一覧を描画する
   */
  renderEvents() {
    const list = this.dom.eventList;
    if (!list) return;
    list.innerHTML = "";
    const totalEvents = this.state.events.length;

    if (!totalEvents) {
      if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = false;
      return;
    }
    if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = true;

    this.state.events.forEach(event => {
      const li = document.createElement("li");
      li.className = "entity-item" + (event.id === this.state.selectedEventId ? " is-active" : "");
      li.dataset.eventId = event.id;

      const label = document.createElement("div");
      label.className = "entity-label";
      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = event.name;
      const scheduleCount = event.schedules ? event.schedules.length : 0;
      const participantTotal = event.schedules
        ? event.schedules.reduce((acc, s) => acc + (s.participantCount || 0), 0)
        : 0;
      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      metaEl.textContent = `日程 ${scheduleCount} 件 / 参加者 ${participantTotal} 名`;
      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-icon";
      editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
      editBtn.title = "イベントを編集";
      editBtn.addEventListener("click", evt => {
        evt.stopPropagation();
        this.openEventForm({ mode: "edit", event });
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-icon";
      deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
      deleteBtn.title = "イベントを削除";
      deleteBtn.addEventListener("click", eventObj => {
        eventObj.stopPropagation();
        this.deleteEvent(event.id, event.name).catch(err => console.error(err));
      });
      actions.append(editBtn, deleteBtn);

      li.append(label, actions);
      li.addEventListener("click", () => this.selectEvent(event.id));
      list.appendChild(li);
    });
  }

  /**
   * イベントを選択する
   * @param {string} eventId - イベントID
   * @param {Object} options - オプション
   */
  selectEvent(eventId, options = {}) {
    const {
      nextScheduleId = null,
      skipContextUpdate = false,
      skipParticipantLoad = false,
      source = this.getSelectionBroadcastSource()
    } = options || {};

    const previousEventId = this.state.selectedEventId;
    const preservingScheduleId = nextScheduleId ? String(nextScheduleId) : null;

    if (previousEventId === eventId) {
      let scheduleHandled = false;
      if (preservingScheduleId && this.state.selectedScheduleId !== preservingScheduleId) {
        this.selectSchedule(preservingScheduleId, {
          preserveStatus: Boolean(preservingScheduleId),
          suppressParticipantLoad: skipParticipantLoad,
          source
        });
        scheduleHandled = true;
      } else {
        this.broadcastSelectionChange({ source });
      }
      if (!skipContextUpdate && !scheduleHandled) {
        this.updateParticipantContext({ preserveStatus: Boolean(preservingScheduleId) });
      }
      return;
    }

    this.state.selectedEventId = eventId;
    this.state.selectedScheduleId = preservingScheduleId;
    this.setCalendarPickedDate("", { updateInput: true });
    this.state.participants = [];
    this.state.participantTokenMap = new Map();
    this.state.duplicateMatches = new Map();
    this.state.duplicateGroups = new Map();
    this.captureParticipantBaseline([], { ready: false });
    if (this.state.eventParticipantCache instanceof Map && previousEventId) {
      this.state.eventParticipantCache.delete(previousEventId);
    }
    this.renderEvents();
    this.renderSchedules();
    this.renderParticipants();
    this.loadGlDataForEvent(eventId).catch(error => console.error(error));

    if (!skipContextUpdate) {
      this.updateParticipantContext({ preserveStatus: Boolean(preservingScheduleId) });
    } else {
      this.syncTemplateButtons();
      this.syncClearButtonState();
    }

    if (!skipParticipantLoad && !preservingScheduleId) {
      this.loadParticipants().catch(err => console.error(err));
    }

    this.broadcastSelectionChange({ source });
  }

  /**
   * イベントフォームを開く
   * @param {Object} options - オプション
   * @param {string} options.mode - モード（"create" または "edit"）
   * @param {Object} options.event - イベントオブジェクト（編集時）
   */
  openEventForm({ mode = "create", event = null } = {}) {
    if (!this.dom.eventForm) return;
    this.dom.eventForm.reset();
    this.dom.eventForm.dataset.mode = mode;
    this.dom.eventForm.dataset.eventId = event?.id || "";
    this.setFormError(this.dom.eventError);
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

  /**
   * イベントを追加する
   * @param {string} name - イベント名
   */
  async createEvent(name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }

    try {
      const now = Date.now();
      let eventId = generateShortId("evt_");
      const existingIds = new Set(this.state.events.map(evt => evt.id));
      while (existingIds.has(eventId)) {
        eventId = generateShortId("evt_");
      }

      await set(rootDbRef(`questionIntake/events/${eventId}`), {
        name: trimmed,
        createdAt: now,
        updatedAt: now
      });

      await this.loadEvents({ preserveSelection: false });
      this.selectEvent(eventId);
    } catch (error) {
      console.error(error);
      throw new Error(error.message || "イベントの追加に失敗しました。");
    }
  }

  /**
   * イベントを更新する
   * @param {string} eventId - イベントID
   * @param {string} name - イベント名
   */
  async updateEvent(eventId, name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }

    try {
      const now = Date.now();
      await update(rootDbRef(), {
        [`questionIntake/events/${eventId}/name`]: trimmed,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });
      await this.loadEvents({ preserveSelection: true });
      this.selectEvent(eventId);
    } catch (error) {
      console.error(error);
      throw new Error(error.message || "イベントの更新に失敗しました。");
    }
  }

  /**
   * イベントを削除する
   * @param {string} eventId - イベントID
   * @param {string} eventName - イベント名
   */
  async deleteEvent(eventId, eventName) {
    // イベントIDが空文字列でないことを確認（空文字列だとルートパスへの更新となり権限エラーになる）
    if (!eventId || String(eventId).trim() === "") {
      throw new Error("イベントIDが不明です。");
    }
    const trimmedEventId = String(eventId).trim();
    const label = eventName || trimmedEventId;
    const confirmed = await this.confirmAction({
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
      const participantBranch = await fetchDbValue(`questionIntake/participants/${trimmedEventId}`);
      const tokensToRemove = collectParticipantTokens(participantBranch);

      const updates = {
        [`questionIntake/events/${trimmedEventId}`]: null,
        [`questionIntake/schedules/${trimmedEventId}`]: null,
        [`questionIntake/participants/${trimmedEventId}`]: null
      };

      // 空文字列のトークンを除外して、不正なパスが生成されるのを防ぐ
      tokensToRemove.forEach(token => {
        const trimmedToken = String(token || "").trim();
        if (trimmedToken) {
          updates[`questionIntake/tokens/${trimmedToken}`] = null;
          this.state.knownTokens.delete(token);
          delete this.state.tokenRecords[token];
        }
      });

      await update(rootDbRef(), updates);

      if (this.state.selectedEventId === trimmedEventId) {
        this.state.selectedEventId = null;
        this.state.selectedScheduleId = null;
        this.state.participants = [];
        this.state.participantTokenMap = new Map();
        this.state.duplicateMatches = new Map();
        this.state.duplicateGroups = new Map();
        this.captureParticipantBaseline([], { ready: false });
      }

      if (this.state.eventParticipantCache instanceof Map) {
        this.state.eventParticipantCache.delete(eventId);
      }

      if (this.state.teamAssignments instanceof Map) {
        this.state.teamAssignments.delete(eventId);
      }

      await this.loadEvents({ preserveSelection: false });
      this.setUploadStatus(`イベント「${label}」を削除しました。`, "success");
    } catch (error) {
      console.error(error);
      throw new Error(error.message || "イベントの削除に失敗しました。");
    }
  }
}


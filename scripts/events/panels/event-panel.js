// event-panel.js: イベント管理パネルの実装です。
// イベントの作成、編集、削除、一覧表示を担当します。

import {
  database,
  ref,
  get,
  set,
  remove,
  update,
  serverTimestamp
} from "../../operator/firebase.js";
import { ensureString, logError, formatParticipantCount, collectParticipantTokens } from "../helpers.js";
import { generateShortId, toMillis, normalizeKey } from "../../question-admin/utils.js";

/**
 * イベント管理パネルのマネージャークラス
 * EventAdminApp からイベント管理機能を分離したモジュール
 */
export class EventPanelManager {
  constructor(app) {
    this.app = app;
    this.dom = app.dom;
    this.events = [];
    this.selectedEventId = "";
    this.eventBatchSet = new Set();
    this.bindDom();
  }

  bindDom() {
    // DOM イベントのバインドは app.js で行うため、ここでは最小限の初期化のみ
  }

  /**
   * イベント一覧を読み込む
   * @returns {Promise<Array>} 正規化されたイベント配列
   */
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
        location: ensureString(scheduleValue?.location),
        date: ensureString(scheduleValue?.date || ""),
        startAt: ensureString(scheduleValue?.startAt || scheduleValue?.date),
        endAt: ensureString(scheduleValue?.endAt || ""),
        participantCount: Number(scheduleValue?.participantCount || 0),
        recruitGl: scheduleValue?.recruitGl !== false,
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

    this.events = normalized;
    return this.events;
  }

  /**
   * イベント一覧を描画する
   */
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
      list.removeAttribute("aria-activedescendant");
      list.removeAttribute("tabindex");
      return;
    }

    list.hidden = false;
    if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = true;

    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "イベント一覧");
    list.setAttribute("aria-orientation", "vertical");
    list.tabIndex = 0;
    const fragment = document.createDocumentFragment();
    this.events.forEach((event) => {
      const item = document.createElement("li");
      item.className = "entity-item";
      item.dataset.eventId = event.id;
      item.setAttribute("role", "option");
      item.id = `flow-event-option-${event.id}`;

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

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "entity-checkbox";
      checkbox.setAttribute("aria-label", `${event.name || event.id} を選択`);
      checkbox.checked = this.eventBatchSet.has(event.id);
      checkbox.addEventListener("change", (evt) => {
        evt.stopPropagation();
        if (checkbox.checked) {
          this.eventBatchSet.add(event.id);
        } else {
          this.eventBatchSet.delete(event.id);
        }
        this.updateEventActionPanelState();
      });

      item.append(indicator, label, checkbox);

      item.addEventListener("click", () => {
        this.app.focusEventListItem(item, { select: true });
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
    this.app.updateEventListKeyboardMetadata();
    // app.js の eventBatchSet を同期してから updateEventActionPanelState を呼び出す
    this.app.eventBatchSet = this.eventBatchSet;
    this.app.updateEventActionPanelState();
  }

  /**
   * イベントを選択する
   * @param {string} eventId - 選択するイベントID
   */
  selectEvent(eventId) {
    // app.js の selectEvent を呼び出す（段階的移行のため）
    this.app.selectEvent(eventId);
  }

  /**
   * イベントを作成する
   * @param {string} name - イベント名
   * @returns {Promise<string>} 作成されたイベントID
   */
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
    this.app.beginEventsLoading("イベントを追加しています…");
    try {
      await set(ref(database, `questionIntake/events/${eventId}`), {
        name: trimmed,
        createdAt: now,
        updatedAt: now
      });
      await this.app.loadEvents();
      this.app.selectEvent(eventId);
    } finally {
      this.app.endEventsLoading();
    }
    return eventId;
  }

  /**
   * イベントを更新する
   * @param {string} eventId - 更新するイベントID
   * @param {string} name - 新しいイベント名
   */
  async updateEvent(eventId, name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }

    const now = Date.now();
    this.app.beginEventsLoading("イベントを更新しています…");
    try {
      await update(ref(database), {
        [`questionIntake/events/${eventId}/name`]: trimmed,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });
      await this.app.loadEvents();
      this.app.selectEvent(eventId);
    } finally {
      this.app.endEventsLoading();
    }
  }

  /**
   * イベントを削除する
   * @param {Object} event - 削除するイベントオブジェクト
   */
  async deleteEvent(event) {
    const eventId = event?.id;
    // イベントIDが空文字列でないことを確認（空文字列だとルートパスへの更新となり権限エラーになる）
    if (!eventId || String(eventId).trim() === "") {
      throw new Error("イベントIDが不明です。");
    }
    const trimmedEventId = String(eventId).trim();
    const label = event?.name || trimmedEventId;
    const confirmed = await this.app.confirm({
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
      this.app.beginEventsLoading(`イベント「${label}」を削除しています…`);
      
      // スケジュールと参加者のデータを取得
      const [schedulesSnapshot, participantSnapshot] = await Promise.all([
        get(ref(database, `questionIntake/schedules/${trimmedEventId}`)),
        get(ref(database, `questionIntake/participants/${trimmedEventId}`))
      ]);
      
      const schedulesBranch = schedulesSnapshot.exists() ? schedulesSnapshot.val() : {};
      const participantBranch = participantSnapshot.exists() ? participantSnapshot.val() : {};
      const tokensToRemove = collectParticipantTokens(participantBranch);

      const updates = {
        [`questionIntake/events/${trimmedEventId}`]: null
      };
      
      // 各スケジュールを個別に削除（セキュリティルールに準拠）
      if (schedulesBranch && typeof schedulesBranch === "object") {
        const scheduleIds = Object.keys(schedulesBranch);
        scheduleIds.forEach((scheduleId) => {
          const trimmedScheduleId = String(scheduleId || "").trim();
          if (trimmedScheduleId) {
            updates[`questionIntake/schedules/${trimmedEventId}/${trimmedScheduleId}`] = null;
          }
        });
      }
      
      // 各スケジュール配下の参加者を個別に削除（セキュリティルールに準拠）
      if (participantBranch && typeof participantBranch === "object") {
        const scheduleIds = Object.keys(participantBranch);
        scheduleIds.forEach((scheduleId) => {
          const trimmedScheduleId = String(scheduleId || "").trim();
          if (trimmedScheduleId) {
            updates[`questionIntake/participants/${trimmedEventId}/${trimmedScheduleId}`] = null;
          }
        });
      }
      
      // 空文字列のトークンを除外して、不正なパスが生成されるのを防ぐ
      tokensToRemove.forEach((token) => {
        const trimmedToken = String(token || "").trim();
        if (trimmedToken) {
          updates[`questionIntake/tokens/${trimmedToken}`] = null;
        }
      });

      await update(ref(database), updates);
      await this.app.loadEvents();
      this.app.showAlert(`イベント「${label}」を削除しました。`);
    } catch (error) {
      throw new Error(error?.message || "イベントの削除に失敗しました。");
    } finally {
      this.app.endEventsLoading();
    }
  }

  /**
   * イベントアクションパネルの状態を更新する
   * app.js に委譲（段階的移行のため）
   */
  updateEventActionPanelState() {
    // app.js の eventBatchSet を同期
    this.app.eventBatchSet = this.eventBatchSet;
    this.app.updateEventActionPanelState();
  }

  /**
   * 選択されたイベントを取得する
   * @returns {Object|null} 選択されたイベント、または null
   */
  getSelectedEvent() {
    if (!this.selectedEventId) return null;
    return this.events.find((event) => event.id === this.selectedEventId) || null;
  }
}


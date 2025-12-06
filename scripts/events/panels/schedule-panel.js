// schedule-panel.js: 日程管理パネルの実装です。
// 日程の作成、編集、削除、一覧表示を担当します。

import {
  database,
  ref,
  get,
  set,
  remove,
  update,
  serverTimestamp
} from "../../operator/firebase.js";
import { ensureString, logError, formatParticipantCount, collectParticipantTokens, normalizeDateInputValue, formatDateTimeLocal } from "../helpers.js";
import { formatScheduleRange } from "../../operator/utils.js";
import { normalizeScheduleId } from "../../shared/channel-paths.js";
import { generateShortId, normalizeKey } from "../../question-admin/utils.js";

/**
 * 日程管理パネルのマネージャークラス
 * EventAdminApp から日程管理機能を分離したモジュール
 */
export class SchedulePanelManager {
  constructor(app) {
    this.app = app;
    this.dom = app.dom;
    this.schedules = [];
    this.selectedScheduleId = "";
    this.scheduleBatchSet = new Set();
    this.bindDom();
  }

  bindDom() {
    // DOM イベントのバインドは app.js で行うため、ここでは最小限の初期化のみ
  }

  /**
   * 日程一覧を描画する
   */
  renderScheduleList() {
    const list = this.dom.scheduleList;
    if (!list) return;

    const committedId = ensureString(this.app.hostCommittedScheduleId);
    const committedLabel = ensureString(this.app.hostCommittedScheduleLabel);
    const committedSchedule = committedId
      ? this.schedules.find((schedule) => schedule.id === committedId) || null
      : null;
    const resolvedCommittedLabel = committedLabel || committedSchedule?.label || committedId;
    if (this.dom.scheduleCommittedNote) {
      const labelEl = this.dom.scheduleCommittedLabel;
      const hasCommitted = Boolean(committedId);
      this.dom.scheduleCommittedNote.hidden = !hasCommitted;
      if (labelEl) {
        labelEl.textContent = hasCommitted ? resolvedCommittedLabel || "未設定" : "未設定";
      }
    }

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
      if (committedId && schedule.id === committedId) {
        const badge = document.createElement("span");
        badge.className = "entity-badge entity-badge--active";
        badge.textContent = "テロップ操作中";
        nameEl.appendChild(badge);
      }

      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
      const metaParts = [];
      if (rangeText) metaParts.push(rangeText);
      const locationText = ensureString(schedule.location).trim();
      if (locationText) metaParts.push(`会場 ${locationText}`);
      metaParts.push(`参加者 ${formatParticipantCount(schedule.participantCount)}`);
      metaEl.textContent = metaParts.join(" / ");

      label.append(nameEl, metaEl);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "entity-checkbox";
      checkbox.setAttribute("aria-label", `${schedule.label || schedule.id} を選択`);
      checkbox.checked = this.scheduleBatchSet.has(schedule.id);
      checkbox.addEventListener("change", (evt) => {
        evt.stopPropagation();
        if (checkbox.checked) {
          this.scheduleBatchSet.add(schedule.id);
        } else {
          this.scheduleBatchSet.delete(schedule.id);
        }
        // app.js の scheduleBatchSet を同期してから updateScheduleActionPanelState を呼び出す
        this.app.scheduleBatchSet = this.scheduleBatchSet;
        this.app.updateScheduleActionPanelState();
      });

      item.append(indicator, label, checkbox);

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
    // app.js の scheduleBatchSet を同期してから updateScheduleActionPanelState を呼び出す
    this.app.scheduleBatchSet = this.scheduleBatchSet;
    this.app.updateScheduleActionPanelState();
  }

  /**
   * 日程を選択する
   * @param {string} scheduleId - 選択する日程ID
   */
  selectSchedule(scheduleId) {
    // app.js の selectSchedule を呼び出す（段階的移行のため）
    this.app.selectSchedule(scheduleId);
  }

  /**
   * 日程を作成する
   * @param {Object} payload - 日程データ（label, location, date, start, end）
   * @returns {Promise<string>} 作成された日程ID
   */
  async createSchedule(payload) {
    const eventId = this.app.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }

    const { label, location, date, startValue, endValue } = this.app.resolveScheduleFormValues(payload);
    let scheduleId = generateShortId("sch_");
    const existingIds = new Set(this.schedules.map((schedule) => schedule.id));
    while (existingIds.has(scheduleId)) {
      scheduleId = generateShortId("sch_");
    }

    const now = Date.now();
    this.app.beginScheduleLoading("日程を保存しています…");
    try {
      await set(ref(database, `questionIntake/schedules/${eventId}/${scheduleId}`), {
        label,
        location,
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

      await this.app.loadEvents();
      this.app.selectSchedule(scheduleId);
    } finally {
      this.app.endScheduleLoading();
    }
    return scheduleId;
  }

  /**
   * 日程を更新する
   * @param {string} scheduleId - 更新する日程ID
   * @param {Object} payload - 日程データ（label, location, date, start, end）
   */
  async updateSchedule(scheduleId, payload) {
    const eventId = this.app.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }

    const { label, location, date, startValue, endValue } = this.app.resolveScheduleFormValues(payload);
    const now = Date.now();
    this.app.beginScheduleLoading("日程を更新しています…");
    try {
      await update(ref(database), {
        [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: label,
        [`questionIntake/schedules/${eventId}/${scheduleId}/location`]: location,
        [`questionIntake/schedules/${eventId}/${scheduleId}/date`]: date,
        [`questionIntake/schedules/${eventId}/${scheduleId}/startAt`]: startValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/endAt`]: endValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });

      await this.app.loadEvents();
      this.app.selectSchedule(scheduleId);
    } finally {
      this.app.endScheduleLoading();
    }
  }

  /**
   * 日程を削除する
   * @param {Object} schedule - 削除する日程オブジェクト
   */
  async deleteSchedule(schedule) {
    const eventId = this.app.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    const scheduleId = schedule?.id;
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }
    const label = schedule?.label || scheduleId;

    const confirmed = await this.app.confirm({
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
      this.app.beginScheduleLoading(`日程「${label}」を削除しています…`);
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
      await this.app.loadEvents();
      this.app.selectSchedule("");
    } catch (error) {
      throw new Error(error?.message || "日程の削除に失敗しました。");
    } finally {
      this.app.endScheduleLoading();
    }
  }

  /**
   * 日程アクションパネルの状態を更新する
   * app.js に委譲（段階的移行のため）
   */
  updateScheduleActionPanelState() {
    // app.js の scheduleBatchSet を同期
    this.app.scheduleBatchSet = this.scheduleBatchSet;
    this.app.updateScheduleActionPanelState();
  }

  /**
   * 選択された日程を取得する
   * @returns {Object|null} 選択された日程、または null
   */
  getSelectedSchedule() {
    if (!this.selectedScheduleId) return null;
    return this.schedules.find((schedule) => schedule.id === this.selectedScheduleId) || null;
  }
}


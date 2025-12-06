// schedule-manager.js: 日程管理機能のマネージャークラス
// 日程一覧の描画、選択、CRUD操作を担当します。

import { rootDbRef, fetchDbValue, update } from "../firebase.js";
import { generateShortId, normalizeKey, toMillis } from "../utils.js";
import {
  formatDatePart,
  normalizeDateInputValue,
  formatDateTimeLocal,
  combineDateAndTime,
  prepareScheduleDialogCalendar,
  getSchedulePrimaryDate,
  describeScheduleRange,
  syncScheduleEndMin,
  MS_PER_DAY
} from "../calendar.js";
import { parseDateTimeLocal } from "../utils.js";

/**
 * 日程管理機能のマネージャークラス
 * QuestionAdminApp から日程管理機能を分離したモジュール
 */
export class ScheduleManager {
  constructor(context) {
    this.dom = context.dom;
    this.state = context.state;
    this.calendarState = context.calendarState;
    
    // 依存関数と定数
    this.loadEvents = context.loadEvents;
    this.selectEvent = context.selectEvent;
    this.setCalendarPickedDate = context.setCalendarPickedDate;
    this.renderParticipants = context.renderParticipants;
    this.updateParticipantContext = context.updateParticipantContext;
    this.captureParticipantBaseline = context.captureParticipantBaseline;
    this.syncSaveButtonState = context.syncSaveButtonState;
    this.queueRelocationPrompt = context.queueRelocationPrompt;
    this.getSelectionBroadcastSource = context.getSelectionBroadcastSource;
    this.populateScheduleLocationOptions = context.populateScheduleLocationOptions;
    this.prepareScheduleDialogCalendar = context.prepareScheduleDialogCalendar;
    this.syncScheduleEndMin = context.syncScheduleEndMin;
    this.openDialog = context.openDialog;
    this.closeDialog = context.closeDialog;
    this.setFormError = context.setFormError;
    this.confirmAction = context.confirmAction;
    this.setUploadStatus = context.setUploadStatus;
    this.getScheduleRecord = context.getScheduleRecord;
    this.loadParticipants = context.loadParticipants;
    this.broadcastSelectionChange = context.broadcastSelectionChange;
    
    this.bindDom();
  }

  bindDom() {
    // DOM イベントのバインドは app.js で行うため、ここでは最小限の初期化のみ
  }

  /**
   * 日程一覧を描画する
   */
  renderSchedules() {
    const list = this.dom.scheduleList;
    if (!list) return;
    list.innerHTML = "";

    const selectedEvent = this.state.events.find(evt => evt.id === this.state.selectedEventId);
    if (!selectedEvent) {
      if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = true;
      if (this.dom.scheduleDescription) {
        this.dom.scheduleDescription.textContent = "イベントを選択すると、日程の一覧が表示されます。";
      }
      if (this.dom.addScheduleButton) this.dom.addScheduleButton.disabled = true;
      return;
    }

    if (this.dom.addScheduleButton) this.dom.addScheduleButton.disabled = false;
    if (this.dom.scheduleDescription) {
      this.dom.scheduleDescription.textContent = `イベント「${selectedEvent.name}」の日程を管理します。`;
    }

    if (!selectedEvent.schedules || !selectedEvent.schedules.length) {
      if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = false;
      return;
    }
    if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = true;

    selectedEvent.schedules.forEach(schedule => {
      const li = document.createElement("li");
      li.className = "entity-item" + (schedule.id === this.state.selectedScheduleId ? " is-active" : "");
      li.dataset.scheduleId = schedule.id;

      const label = document.createElement("div");
      label.className = "entity-label";
      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = schedule.label || schedule.id;
      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      const rangeText = describeScheduleRange(schedule);
      const metaParts = [];
      if (rangeText) metaParts.push(rangeText);
      metaParts.push(`参加者 ${schedule.participantCount || 0} 名`);
      metaEl.textContent = metaParts.join(" / ");
      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-icon";
      editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
      editBtn.title = "日程を編集";
      editBtn.addEventListener("click", evt => {
        evt.stopPropagation();
        this.openScheduleForm({ mode: "edit", schedule });
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-icon";
      deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
      deleteBtn.title = "日程を削除";
      deleteBtn.addEventListener("click", evt => {
        evt.stopPropagation();
        this.handleDeleteSchedule(schedule.id, schedule.label).catch(err => console.error(err));
      });
      actions.append(editBtn, deleteBtn);

      li.append(label, actions);
      li.addEventListener("click", () => {
        // selectSchedule は自身のメソッドを呼び出す（循環参照を避けるため selectScheduleSelf を使用）
        if (this.selectScheduleSelf) {
          this.selectScheduleSelf(schedule.id);
        } else {
          this.selectSchedule(schedule.id);
        }
      });
      list.appendChild(li);
    });
  }

  /**
   * 日程を選択する
   */
  selectSchedule(scheduleId, options = {}) {
    const {
      preserveStatus = false,
      suppressParticipantLoad = false,
      forceReload = false,
      source = this.getSelectionBroadcastSource()
    } = options || {};

    const normalizedId = scheduleId ? String(scheduleId) : null;
    const previousScheduleId = this.state.selectedScheduleId;
    const shouldReload = forceReload || previousScheduleId !== normalizedId;

    this.state.selectedScheduleId = normalizedId;
    this.queueRelocationPrompt([], { replace: true });

    const selectedEvent = this.state.events.find(evt => evt.id === this.state.selectedEventId);
    const schedule = normalizedId ? selectedEvent?.schedules?.find(s => s.id === normalizedId) : null;
    if (schedule) {
      const primaryDate = getSchedulePrimaryDate(schedule);
      if (primaryDate) {
        this.setCalendarPickedDate(formatDatePart(primaryDate), { updateInput: true });
      }
    } else if (!normalizedId) {
      this.setCalendarPickedDate("", { updateInput: true });
    }

    this.renderSchedules();

    if (!normalizedId) {
      this.state.participants = [];
      this.state.participantTokenMap = new Map();
      this.state.duplicateMatches = new Map();
      this.state.duplicateGroups = new Map();
      this.captureParticipantBaseline([], { ready: false });
      this.renderParticipants();
      this.syncSaveButtonState();
    } else if (shouldReload) {
      this.captureParticipantBaseline([], { ready: false });
    }

    this.updateParticipantContext({ preserveStatus });

    const needsParticipantLoad = Boolean(
      normalizedId &&
      !suppressParticipantLoad &&
      (shouldReload || !this.state.participantBaselineReady)
    );

    if (needsParticipantLoad) {
      this.loadParticipants().catch(err => console.error(err));
    }

    this.broadcastSelectionChange({ source });
  }

  /**
   * フォーム値を解決する
   */
  resolveScheduleFormValues({ label, location, date, startTime, endTime }) {
    const trimmedLabel = normalizeKey(label || "");
    if (!trimmedLabel) {
      throw new Error("日程の表示名を入力してください。");
    }

    const normalizedLocation = String(location || "").trim();

    const normalizedDate = normalizeDateInputValue(date);
    if (!normalizedDate) {
      throw new Error("日付を入力してください。");
    }

    const startTimeValue = String(startTime || "").trim();
    const endTimeValue = String(endTime || "").trim();
    if (!startTimeValue || !endTimeValue) {
      throw new Error("開始と終了の時刻を入力してください。");
    }

    const startValueText = combineDateAndTime(normalizedDate, startTimeValue);
    const endValueText = combineDateAndTime(normalizedDate, endTimeValue);
    let startDate = parseDateTimeLocal(startValueText);
    let endDate = parseDateTimeLocal(endValueText);
    if (!startDate || !endDate) {
      throw new Error("開始・終了時刻の形式が正しくありません。");
    }

    if (endDate <= startDate) {
      endDate = new Date(endDate.getTime() + MS_PER_DAY);
    }

    const startValue = formatDateTimeLocal(startDate);
    const endValue = formatDateTimeLocal(endDate);

    return {
      label: trimmedLabel,
      location: normalizedLocation,
      date: normalizedDate,
      startValue,
      endValue
    };
  }

  /**
   * 日程フォームを開く
   */
  openScheduleForm({ mode = "create", schedule = null } = {}) {
    if (!this.dom.scheduleForm) return;
    this.dom.scheduleForm.reset();
    this.dom.scheduleForm.dataset.mode = mode;
    this.dom.scheduleForm.dataset.scheduleId = schedule?.id || "";
    this.setFormError(this.dom.scheduleError);
    if (this.dom.scheduleDialogTitle) {
      this.dom.scheduleDialogTitle.textContent = mode === "edit" ? "日程を編集" : "日程を追加";
    }
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }

    this.populateScheduleLocationOptions(schedule?.location || "");

    const selectedEvent = this.state.events.find(evt => evt.id === this.state.selectedEventId);
    if (mode === "edit" && schedule) {
      if (this.dom.scheduleLabelInput) this.dom.scheduleLabelInput.value = schedule.label || "";
      if (this.dom.scheduleLocationInput) this.dom.scheduleLocationInput.value = schedule.location || "";
      const dateValue = schedule.date || (schedule.startAt ? String(schedule.startAt).slice(0, 10) : "");
      if (this.dom.scheduleDateInput) this.dom.scheduleDateInput.value = normalizeDateInputValue(dateValue);
      const startTime = schedule.startAt ? String(schedule.startAt).slice(11, 16) : "";
      const endTime = schedule.endAt ? String(schedule.endAt).slice(11, 16) : "";
      if (this.dom.scheduleStartTimeInput) this.dom.scheduleStartTimeInput.value = startTime;
      if (this.dom.scheduleEndTimeInput) this.dom.scheduleEndTimeInput.value = endTime;
      this.setCalendarPickedDate(this.dom.scheduleDateInput?.value || dateValue || "", { updateInput: true });
    } else {
      if (this.dom.scheduleLabelInput) {
        this.dom.scheduleLabelInput.value = selectedEvent?.name ? `${selectedEvent.name}` : "";
      }
      if (this.dom.scheduleLocationInput) {
        this.dom.scheduleLocationInput.value = "";
      }
      if (this.dom.scheduleDateInput) {
        this.dom.scheduleDateInput.value = this.calendarState.pickedDate || "";
      }
      this.setCalendarPickedDate(this.dom.scheduleDateInput?.value || this.calendarState.pickedDate || "", { updateInput: true });
    }

    const initialDateValue = this.dom.scheduleDateInput?.value || this.calendarState.pickedDate || "";
    this.prepareScheduleDialogCalendar(initialDateValue);
    if (this.dom.scheduleEndTimeInput) {
      this.dom.scheduleEndTimeInput.min = this.dom.scheduleStartTimeInput?.value || "";
    }
    this.syncScheduleEndMin();
    this.openDialog(this.dom.scheduleDialog);
  }

  /**
   * 日程を追加する
   */
  async createSchedule({ label, location, date, startTime, endTime }) {
    const eventId = this.state.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }

    const { label: trimmedLabel, location: normalizedLocation, date: normalizedDate, startValue, endValue } = this.resolveScheduleFormValues({
      label,
      location,
      date,
      startTime,
      endTime
    });

    try {
      const now = Date.now();
      const event = this.state.events.find(evt => evt.id === eventId);
      const existingSchedules = new Set((event?.schedules || []).map(schedule => schedule.id));
      let scheduleId = generateShortId("sch_");
      while (existingSchedules.has(scheduleId)) {
        scheduleId = generateShortId("sch_");
      }

      await update(rootDbRef(), {
        [`questionIntake/schedules/${eventId}/${scheduleId}`]: {
          label: trimmedLabel,
          location: normalizedLocation,
          date: normalizedDate,
          startAt: startValue,
          endAt: endValue,
          participantCount: 0,
          createdAt: now,
          updatedAt: now
        },
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });

      await this.loadEvents({ preserveSelection: true });
      this.selectEvent(eventId);
      // selectSchedule は自身のメソッドを呼び出す（循環参照を避けるため selectScheduleSelf を使用）
      if (this.selectScheduleSelf) {
        this.selectScheduleSelf(scheduleId);
      } else {
        this.selectSchedule(scheduleId);
      }
      this.setCalendarPickedDate(normalizedDate, { updateInput: true });
    } catch (error) {
      console.error(error);
      throw new Error(error.message || "日程の追加に失敗しました。");
    }
  }

  /**
   * 日程を更新する
   */
  async updateSchedule(scheduleId, { label, location, date, startTime, endTime }) {
    const eventId = this.state.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }

    const { label: trimmedLabel, location: normalizedLocation, date: normalizedDate, startValue, endValue } = this.resolveScheduleFormValues({
      label,
      location,
      date,
      startTime,
      endTime
    });

    try {
      const now = Date.now();
      await update(rootDbRef(), {
        [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: trimmedLabel,
        [`questionIntake/schedules/${eventId}/${scheduleId}/location`]: normalizedLocation,
        [`questionIntake/schedules/${eventId}/${scheduleId}/date`]: normalizedDate,
        [`questionIntake/schedules/${eventId}/${scheduleId}/startAt`]: startValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/endAt`]: endValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });

      await this.loadEvents({ preserveSelection: true });
      this.selectEvent(eventId);
      // selectSchedule は自身のメソッドを呼び出す（循環参照を避けるため selectScheduleSelf を使用）
      if (this.selectScheduleSelf) {
        this.selectScheduleSelf(scheduleId);
      } else {
        this.selectSchedule(scheduleId);
      }
      this.setCalendarPickedDate(normalizedDate, { updateInput: true });
    } catch (error) {
      console.error(error);
      throw new Error(error.message || "日程の更新に失敗しました。");
    }
  }

  /**
   * 日程を削除する
   */
  async deleteSchedule(scheduleId, scheduleLabel) {
    const eventId = this.state.selectedEventId;
    if (!eventId) return;
    const label = scheduleLabel || scheduleId;
    const confirmed = await this.confirmAction({
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
      const participantBranch = await fetchDbValue(`questionIntake/participants/${eventId}/${scheduleId}`);
      const tokensToRemove = new Set();
      if (participantBranch && typeof participantBranch === "object") {
        Object.values(participantBranch).forEach(entry => {
          const token = entry?.token;
          if (token) tokensToRemove.add(String(token));
        });
      }

      const now = Date.now();
      const updates = {
        [`questionIntake/schedules/${eventId}/${scheduleId}`]: null,
        [`questionIntake/participants/${eventId}/${scheduleId}`]: null,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      };

      tokensToRemove.forEach(token => {
        updates[`questionIntake/tokens/${token}`] = null;
        this.state.knownTokens.delete(token);
        delete this.state.tokenRecords[token];
      });

      await update(rootDbRef(), updates);

      if (this.state.selectedScheduleId === scheduleId) {
        this.state.selectedScheduleId = null;
        this.state.participants = [];
        this.state.participantTokenMap = new Map();
        this.state.duplicateMatches = new Map();
        this.state.duplicateGroups = new Map();
        this.captureParticipantBaseline([], { ready: false });
      }

      if (this.state.eventParticipantCache instanceof Map) {
        const cache = this.state.eventParticipantCache.get(eventId);
        if (cache && typeof cache === "object") {
          delete cache[scheduleId];
          this.state.eventParticipantCache.set(eventId, cache);
        }
      }

      await this.loadEvents({ preserveSelection: true });
      this.renderParticipants();
      this.updateParticipantContext();
      this.state.tokenSnapshotFetchedAt = Date.now();
      this.setUploadStatus(`日程「${label}」を削除しました。`, "success");
    } catch (error) {
      console.error(error);
      this.setUploadStatus(error.message || "日程の削除に失敗しました。", "error");
    }
  }

  /**
   * 削除用のエイリアス（後方互換性のため）
   */
  async handleDeleteSchedule(scheduleId, scheduleLabel) {
    return await this.deleteSchedule(scheduleId, scheduleLabel);
  }
}


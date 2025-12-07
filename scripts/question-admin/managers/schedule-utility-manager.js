// schedule-utility-manager.js: スケジュール関連のユーティリティ機能を担当します。
export class ScheduleUtilityManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // 依存関数
    this.describeScheduleRange = context.describeScheduleRange;
    this.getScheduleLabel = context.getScheduleLabel;
    this.normalizeKey = context.normalizeKey;
    this.renderEvents = context.renderEvents;
    this.renderSchedules = context.renderSchedules;
    this.updateParticipantContext = context.updateParticipantContext;
  }

  /**
   * スケジュールレコードの取得
   * @param {string} eventId - イベントID
   * @param {string} scheduleId - スケジュールID
   * @returns {Object|null} スケジュールレコード
   */
  getScheduleRecord(eventId, scheduleId) {
    if (!eventId || !scheduleId) return null;
    const event = this.state.events.find(evt => evt.id === eventId);
    if (!event || !Array.isArray(event.schedules)) {
      return null;
    }
    return event.schedules.find(schedule => schedule.id === scheduleId) || null;
  }

  /**
   * スケジュールオプションラベルの構築
   * @param {Object} schedule - スケジュールオブジェクト
   * @returns {string} ラベル
   */
  buildScheduleOptionLabel(schedule) {
    if (!schedule) {
      return "";
    }
    const baseLabel = schedule.label || schedule.date || schedule.id || "";
    const rangeText = this.describeScheduleRange(schedule);
    if (rangeText && rangeText !== baseLabel) {
      return baseLabel ? `${baseLabel}（${rangeText}）` : rangeText;
    }
    return baseLabel || rangeText || "";
  }

  /**
   * スケジュール場所履歴の更新
   */
  refreshScheduleLocationHistory() {
    const history = new Set();
    if (Array.isArray(this.state.events)) {
      this.state.events.forEach((event) => {
        if (!Array.isArray(event?.schedules)) {
          return;
        }
        event.schedules.forEach((schedule) => {
          const location = typeof schedule?.location === "string"
            ? schedule.location.trim()
            : String(schedule?.location || "").trim();
          if (location) {
            history.add(location);
          }
        });
      });
    }
    if (this.state.scheduleContextOverrides instanceof Map) {
      this.state.scheduleContextOverrides.forEach((override) => {
        const location = typeof override?.location === "string"
          ? override.location.trim()
          : String(override?.location || "").trim();
        if (location) {
          history.add(location);
        }
      });
    }
    this.state.scheduleLocationHistory = history;
  }

  /**
   * スケジュール場所オプションの生成
   * @param {string} preferred - 優先される場所
   */
  populateScheduleLocationOptions(preferred = "") {
    const list = this.dom.scheduleLocationList;
    if (!list) {
      return;
    }
    const normalize = (value) => (value == null ? "" : String(value).trim());
    const options = new Set();

    if (this.state.scheduleLocationHistory instanceof Set) {
      this.state.scheduleLocationHistory.forEach((value) => {
        const location = normalize(value);
        if (location) {
          options.add(location);
        }
      });
    }

    const selectedEvent = this.state.events.find(evt => evt.id === this.state.selectedEventId);
    if (selectedEvent?.schedules) {
      selectedEvent.schedules.forEach((schedule) => {
        const location = normalize(schedule?.location);
        if (location) {
          options.add(location);
        }
      });
    }

    const preferredLocation = normalize(preferred);
    if (preferredLocation) {
      options.add(preferredLocation);
    }

    list.innerHTML = "";
    Array.from(options)
      .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }))
      .forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        list.appendChild(option);
      });
  }

  /**
   * イベント読み込みの確定
   * @param {Object} options - オプション
   * @param {boolean} options.preserveSelection - 選択を保持するか
   * @param {string} options.previousEventId - 前のイベントID
   * @param {string} options.previousScheduleId - 前のスケジュールID
   * @param {Array} options.previousEventsSnapshot - 前のイベントスナップショット
   * @param {boolean} options.preserveStatus - ステータスを保持するか
   */
  finalizeEventLoad({
    preserveSelection = true,
    previousEventId = null,
    previousScheduleId = null,
    previousEventsSnapshot = [],
    preserveStatus = false
  } = {}) {
    if (!preserveSelection) {
      this.state.selectedEventId = null;
      this.state.selectedScheduleId = null;
    }

    let selectionNotice = null;

    let initialSelectionSatisfied = false;

    if (!this.state.initialSelectionApplied && this.state.initialSelection?.eventId) {
      const {
        eventId,
        scheduleId,
        scheduleLabel,
        eventLabel,
        location: initialLocation = null,
        startAt: initialStartAt = null,
        endAt: initialEndAt = null
      } = this.state.initialSelection;
      const targetEvent = this.state.events.find(evt => evt.id === eventId) || null;
      if (targetEvent) {
        this.state.selectedEventId = eventId;
        if (scheduleId) {
          const targetSchedule = targetEvent.schedules?.find(s => s.id === scheduleId) || null;
          if (targetSchedule) {
            this.state.selectedScheduleId = scheduleId;
            if (this.state.scheduleContextOverrides instanceof Map) {
              this.state.scheduleContextOverrides.delete(`${eventId}::${scheduleId}`);
            }
          } else {
            const overrideKey = `${eventId}::${scheduleId}`;
            if (!(this.state.scheduleContextOverrides instanceof Map)) {
              this.state.scheduleContextOverrides = new Map();
            }
            const existingOverride = this.state.scheduleContextOverrides.get(overrideKey) || null;
            const override = existingOverride || {
              eventId,
              eventName: eventLabel || targetEvent.name || eventId,
              scheduleId,
              scheduleLabel: scheduleLabel || scheduleId,
              location: initialLocation || "",
              startAt: initialStartAt || "",
              endAt: initialEndAt || ""
            };
            this.state.scheduleContextOverrides.set(overrideKey, override);
            this.state.selectedScheduleId = scheduleId;
          }
        } else {
          this.state.selectedScheduleId = null;
        }
        initialSelectionSatisfied = true;
      } else {
        this.state.selectedEventId = null;
        this.state.selectedScheduleId = null;
        const label = eventLabel || eventId;
        selectionNotice = `指定されたイベント「${label}」が見つかりません。`;
      }
      this.state.initialSelectionApplied = initialSelectionSatisfied;
      if (initialSelectionSatisfied) {
        this.state.initialSelection = null;
      }
    } else if (preserveSelection && previousEventId && this.state.events.some(evt => evt.id === previousEventId)) {
      this.state.selectedEventId = previousEventId;
      if (previousScheduleId) {
        const selectedEvent = this.state.events.find(evt => evt.id === previousEventId) || null;
        const hasSchedule = selectedEvent?.schedules?.some(schedule => schedule.id === previousScheduleId) || false;
        const overrideKey = `${previousEventId}::${previousScheduleId}`;
        if (!(this.state.scheduleContextOverrides instanceof Map)) {
          this.state.scheduleContextOverrides = new Map();
        }
        let hasOverride = this.state.scheduleContextOverrides.has(overrideKey);
        if (!hasSchedule && previousEventsSnapshot?.length && previousEventId && previousScheduleId && !hasOverride) {
          const previousEvent = previousEventsSnapshot.find(event => event.id === previousEventId) || null;
          const previousSchedule = previousEvent?.schedules?.find(schedule => schedule.id === previousScheduleId) || null;
          if (previousSchedule) {
            const fallbackOverride = {
              eventId: previousEventId,
              eventName: previousEvent?.name || previousEventId,
              scheduleId: previousScheduleId,
              scheduleLabel: previousSchedule.label || previousScheduleId,
              location: previousSchedule.location || "",
              startAt: previousSchedule.startAt || "",
              endAt: previousSchedule.endAt || ""
            };
            this.state.scheduleContextOverrides.set(overrideKey, fallbackOverride);
            hasOverride = true;
          }
        }
        this.state.selectedScheduleId = hasSchedule || hasOverride ? previousScheduleId : null;
        if (hasSchedule && this.state.scheduleContextOverrides instanceof Map) {
          this.state.scheduleContextOverrides.delete(overrideKey);
        }
      } else {
        this.state.selectedScheduleId = null;
      }
    } else if (preserveSelection) {
      this.state.selectedEventId = null;
      this.state.selectedScheduleId = null;
    }

    this.refreshScheduleLocationHistory();
    this.populateScheduleLocationOptions(this.dom.scheduleLocationInput?.value || "");

    this.state.initialSelectionNotice = selectionNotice;
    this.renderEvents();
    this.renderSchedules();
    this.updateParticipantContext({ preserveStatus });
  }
}


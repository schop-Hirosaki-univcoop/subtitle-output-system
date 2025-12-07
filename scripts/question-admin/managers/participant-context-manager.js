// participant-context-manager.js: 参加者コンテキスト・イベント関連の機能を担当します。
export class ParticipantContextManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // 依存関数と定数
    this.isPlaceholderUploadStatus = context.isPlaceholderUploadStatus;
    this.getMissingSelectionStatusMessage = context.getMissingSelectionStatusMessage;
    this.setUploadStatus = context.setUploadStatus;
    this.syncTemplateButtons = context.syncTemplateButtons;
    this.syncClearButtonState = context.syncClearButtonState;
    this.PARTICIPANT_DESCRIPTION_DEFAULT = context.PARTICIPANT_DESCRIPTION_DEFAULT;
    this.FOCUS_TARGETS = context.FOCUS_TARGETS;
  }

  /**
   * URL からの初期選択の解析
   */
  parseInitialSelectionFromUrl() {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const params = new URLSearchParams(window.location.search || "");
      const ensure = (value) => String(value ?? "").trim();

      const eventId = ensure(params.get("eventId") ?? params.get("event"));
      const scheduleId = ensure(params.get("scheduleId") ?? params.get("schedule"));
      const scheduleLabel = ensure(params.get("scheduleLabel") ?? params.get("scheduleName"));
      const eventLabel = ensure(params.get("eventName") ?? params.get("eventLabel"));
      const focusParam = ensure(params.get("focus") ?? params.get("view"));

      if (eventId) {
        this.state.initialSelection = {
          eventId,
          scheduleId: scheduleId || null,
          scheduleLabel: scheduleLabel || null,
          eventLabel: eventLabel || null
        };
      }

      if (focusParam) {
        const normalizedFocus = focusParam.toLowerCase();
        if (this.FOCUS_TARGETS.has(normalizedFocus)) {
          this.state.initialFocusTarget = normalizedFocus;
        }
      }
    } catch (error) {
      console.debug("failed to parse initial selection", error);
    }
  }

  /**
   * 参加者同期イベントの送信
   * @param {Object} detail - イベント詳細
   */
  emitParticipantSyncEvent(detail = {}) {
    if (typeof document === "undefined") {
      return;
    }

    const payload = { ...detail };
    payload.source = "question-admin";
    payload.eventId = detail.eventId != null ? String(detail.eventId) : this.state.selectedEventId || "";
    payload.scheduleId = detail.scheduleId != null ? String(detail.scheduleId) : this.state.selectedScheduleId || "";
    if (typeof detail.participantCount === "number" && Number.isFinite(detail.participantCount)) {
      payload.participantCount = detail.participantCount;
    } else {
      payload.participantCount = Array.isArray(this.state.participants) ? this.state.participants.length : 0;
    }
    payload.timestamp = detail.timestamp ? Number(detail.timestamp) : Date.now();

    try {
      document.dispatchEvent(new CustomEvent("qa:participants-synced", { detail: payload }));
    } catch (error) {
      console.warn("Failed to dispatch participant sync event", error);
    }
  }

  /**
   * 参加者コンテキストの更新
   * @param {Object} options - オプション
   */
  updateParticipantContext(options = {}) {
    const { preserveStatus = false } = options;
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    const shouldPreserveStatus = preserveStatus && !this.isPlaceholderUploadStatus();
    const descriptionTarget = this.dom.participantDescriptionMain || this.dom.participantDescription;
    if (!eventId || !scheduleId) {
      if (descriptionTarget) {
        descriptionTarget.textContent = this.PARTICIPANT_DESCRIPTION_DEFAULT;
      }
      if (this.dom.saveButton) this.dom.saveButton.disabled = true;
      if (this.dom.csvInput) {
        this.dom.csvInput.disabled = true;
        this.dom.csvInput.value = "";
      }
      if (this.dom.teamCsvInput) {
        this.dom.teamCsvInput.disabled = true;
        this.dom.teamCsvInput.value = "";
      }
      if (!shouldPreserveStatus) this.setUploadStatus(this.getMissingSelectionStatusMessage());
      if (this.dom.fileLabel) this.dom.fileLabel.textContent = "参加者CSVをアップロード";
      if (this.dom.teamFileLabel) this.dom.teamFileLabel.textContent = "班番号CSVをアップロード";
      if (this.dom.participantCardList) this.dom.participantCardList.innerHTML = "";
      if (this.dom.adminSummary) this.dom.adminSummary.textContent = "";
      this.syncTemplateButtons();
      this.syncClearButtonState();
      return;
    }

    const overrideKey = `${eventId}::${scheduleId}`;
    const selectedEvent = this.state.events.find(evt => evt.id === eventId);
    const override = this.state.scheduleContextOverrides instanceof Map
      ? this.state.scheduleContextOverrides.get(overrideKey) || null
      : null;
    const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === scheduleId);

    if (this.dom.csvInput) this.dom.csvInput.disabled = false;
    if (this.dom.teamCsvInput) this.dom.teamCsvInput.disabled = false;
    if (descriptionTarget) {
      descriptionTarget.textContent = this.PARTICIPANT_DESCRIPTION_DEFAULT;
    }
    if (this.state.scheduleContextOverrides instanceof Map && override && selectedSchedule) {
      this.state.scheduleContextOverrides.delete(overrideKey);
    }
    if (!shouldPreserveStatus) {
      this.setUploadStatus("ファイルを選択して参加者リストを更新してください。");
    }

    this.syncTemplateButtons();
    this.syncClearButtonState();
  }
}


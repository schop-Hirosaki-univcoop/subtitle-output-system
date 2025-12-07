// participant-action-manager.js: 参加者操作ハンドラー関連の機能を担当します。
export class ParticipantActionManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // 依存関数
    this.hasUnsavedChanges = context.hasUnsavedChanges;
    this.confirmAction = context.confirmAction;
    this.setUploadStatus = context.setUploadStatus;
    this.loadParticipants = context.loadParticipants;
    this.cloneParticipantEntry = context.cloneParticipantEntry;
    this.captureParticipantBaseline = context.captureParticipantBaseline;
    this.renderParticipants = context.renderParticipants;
    this.handleSave = context.handleSave;
    this.updateDuplicateMatches = context.updateDuplicateMatches;
    this.getSelectedParticipantTarget = context.getSelectedParticipantTarget;
    this.getSelectionRequiredMessage = context.getSelectionRequiredMessage;
    this.handleQuickCancelAction = context.handleQuickCancelAction;
    this.handleDeleteParticipant = context.handleDeleteParticipant;
    this.openParticipantEditor = context.openParticipantEditor;
  }

  /**
   * 参加者の取り消し処理
   * @returns {Promise<void>}
   */
  async handleRevertParticipants() {
    if (!this.hasUnsavedChanges()) {
      this.setUploadStatus("取り消す変更はありません。");
      return;
    }

    const confirmed = await this.confirmAction({
      title: "変更の取り消し",
      description: "未保存の変更をすべて破棄し、最新の参加者リストを読み込み直します。よろしいですか？",
      confirmLabel: "取り消す",
      cancelLabel: "キャンセル"
    });

    if (!confirmed) {
      return;
    }

    this.setUploadStatus("未保存の変更を破棄しています…");
    try {
      const eventId = this.state.selectedEventId;
      if (eventId && this.state.teamAssignments instanceof Map) {
        this.state.teamAssignments.delete(eventId);
      }
      this.state.relocationDraftOriginals = new Map();
      await this.loadParticipants({ statusMessage: "未保存の変更を取り消しました。", statusVariant: "success" });
    } catch (error) {
      console.error(error);
      this.setUploadStatus(error.message || "変更の取り消しに失敗しました。", "error");
    }
  }

  /**
   * 参加者のクリア処理
   * @returns {Promise<void>}
   */
  async handleClearParticipants() {
    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    if (!eventId || !scheduleId) {
      this.setUploadStatus(this.getSelectionRequiredMessage(), "error");
      return;
    }

    if (!this.state.participants.length) {
      this.setUploadStatus("参加者リストは既に空です。", "success");
      return;
    }

    const selectedEvent = this.state.events.find(evt => evt.id === eventId);
    const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === scheduleId);
    const label = selectedSchedule?.label || scheduleId;

    const confirmed = await this.confirmAction({
      title: "参加者リストの全削除",
      description: `日程「${label}」に登録されている参加者を全て削除します。適用すると元に戻せません。よろしいですか？`,
      confirmLabel: "全て削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    const previousParticipants = this.state.participants.slice();
    const previousTokenMap = new Map(this.state.participantTokenMap);
    const previousSignature = this.state.lastSavedSignature;
    const previousSavedParticipants = Array.isArray(this.state.savedParticipants)
      ? this.state.savedParticipants.slice()
      : [];
    const previousSavedEntries = Array.isArray(this.state.savedParticipantEntries)
      ? this.state.savedParticipantEntries.map(entry => this.cloneParticipantEntry(entry))
      : [];
    const previousBaselineReady = this.state.participantBaselineReady;

    this.state.participants = [];
    this.state.participantTokenMap = new Map();
    this.state.duplicateMatches = new Map();
    this.state.duplicateGroups = new Map();
    this.captureParticipantBaseline(this.state.participants);
    this.renderParticipants();

    const success = await this.handleSave({ allowEmpty: true, successMessage: "参加者リストを全て削除しました。" });
    if (!success) {
      this.state.participants = previousParticipants;
      this.state.participantTokenMap = previousTokenMap;
      this.state.lastSavedSignature = previousSignature;
      this.state.savedParticipants = previousSavedParticipants;
      this.state.savedParticipantEntries = previousSavedEntries;
      this.state.participantBaselineReady = previousBaselineReady;
      this.updateDuplicateMatches();
      this.renderParticipants();
    }
  }

  /**
   * 選択参加者の編集処理
   */
  handleEditSelectedParticipant() {
    const target = this.getSelectedParticipantTarget();
    if (!target.entry) {
      this.setUploadStatus("参加者が選択されていません。", "error");
      return;
    }
    const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
    const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
    this.openParticipantEditor(participantId, rowKey);
  }

  /**
   * 選択参加者のキャンセル処理
   */
  handleCancelSelectedParticipant() {
    const target = this.getSelectedParticipantTarget();
    if (!target.entry) {
      this.setUploadStatus("キャンセル対象の参加者が見つかりません。", "error");
      return;
    }
    const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
    const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
    this.handleQuickCancelAction(participantId, null, rowKey);
  }

  /**
   * 選択参加者の削除処理
   */
  handleDeleteSelectedParticipant() {
    const target = this.getSelectedParticipantTarget();
    if (!target.entry) {
      this.setUploadStatus("削除対象の参加者が見つかりません。", "error");
      return;
    }
    const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
    const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
    this.handleDeleteParticipant(participantId, null, rowKey).catch(err => {
      console.error(err);
      this.setUploadStatus(err.message || "参加者の削除に失敗しました。", "error");
    });
  }
}


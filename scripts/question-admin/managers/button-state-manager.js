// button-state-manager.js: ボタン状態同期関連の機能を担当します。
export class ButtonStateManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // 依存関数
    this.hasUnsavedChanges = context.hasUnsavedChanges;
    this.resolveParticipantUid = context.resolveParticipantUid;
    this.syncMailActionState = context.syncMailActionState;
    // 循環参照を避けるため、関数として保持
    this._syncAllPrintButtonStates = context.syncAllPrintButtonStates;
    
    // 印刷関連の依存関数
    this.logPrintDebug = context.logPrintDebug;
    this.logPrintWarn = context.logPrintWarn;
    this.closeParticipantPrintPreview = context.closeParticipantPrintPreview;
    this.printManager = context.printManager;
    
    // 変数として移行
    this.printActionButtonMissingLogged = false;
    this.staffPrintActionButtonMissingLogged = false;
    
    // 参加者アクションパネル関連の依存関数
    this.getSelectedParticipantTarget = context.getSelectedParticipantTarget;
    this.formatParticipantIdentifier = context.formatParticipantIdentifier;
    
    // イベントサマリー関連の依存関数
    this.getScheduleLabel = context.getScheduleLabel;
    this.renderSchedules = context.renderSchedules;
    this.renderEvents = context.renderEvents;
  }

  /**
   * 参加者タブの設定
   * @param {string} tabKey - タブキー（"manage" または "csv"）
   */
  setParticipantTab(tabKey = "manage") {
    const target = tabKey === "csv" ? "csv" : "manage";
    this.state.activeParticipantTab = target;
    const entries = [
      { key: "manage", tab: this.dom.participantManageTab, panel: this.dom.participantManagePanel },
      { key: "csv", tab: this.dom.participantCsvTab, panel: this.dom.participantCsvPanel }
    ];
    entries.forEach(({ key, tab, panel }) => {
      const isActive = key === target;
      if (tab) {
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
        tab.setAttribute("tabindex", isActive ? "0" : "-1");
      }
      if (panel) {
        panel.hidden = !isActive;
        if (isActive) {
          panel.removeAttribute("aria-hidden");
        } else {
          panel.setAttribute("aria-hidden", "true");
        }
      }
    });
  }

  /**
   * 参加者タブへのフォーカス
   * @param {string} tabKey - タブキー（"manage" または "csv"）
   */
  focusParticipantTab(tabKey) {
    if (tabKey === "csv" && this.dom.participantCsvTab) {
      this.dom.participantCsvTab.focus();
      return;
    }
    if (this.dom.participantManageTab) {
      this.dom.participantManageTab.focus();
    }
  }

  /**
   * 参加者タブのセットアップ
   */
  setupParticipantTabs() {
    const entries = [
      { key: "manage", tab: this.dom.participantManageTab },
      { key: "csv", tab: this.dom.participantCsvTab }
    ].filter(entry => entry.tab instanceof HTMLElement);

    if (!entries.length) {
      return;
    }

    entries.forEach(({ key, tab }, index) => {
      tab.addEventListener("click", () => this.setParticipantTab(key));
      tab.addEventListener("keydown", event => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const nextIndex = (index + direction + entries.length) % entries.length;
          const next = entries[nextIndex];
          this.setParticipantTab(next.key);
          this.focusParticipantTab(next.key);
        } else if (event.key === "Home" || event.key === "PageUp") {
          event.preventDefault();
          const first = entries[0];
          this.setParticipantTab(first.key);
          this.focusParticipantTab(first.key);
        } else if (event.key === "End" || event.key === "PageDown") {
          event.preventDefault();
          const last = entries[entries.length - 1];
          this.setParticipantTab(last.key);
          this.focusParticipantTab(last.key);
        }
      });
    });

    this.setParticipantTab(this.state.activeParticipantTab || "manage");
  }

  /**
   * 選択イベントサマリーの同期
   */
  syncSelectedEventSummary() {
    const eventId = this.state.selectedEventId;
    if (!eventId) return;

    const selectedEvent = this.state.events.find(evt => evt.id === eventId);
    if (!selectedEvent) return;

    const schedules = Array.isArray(selectedEvent.schedules) ? selectedEvent.schedules : [];
    const participantCount = Array.isArray(this.state.participants) ? this.state.participants.length : 0;
    const scheduleId = this.state.selectedScheduleId;

    let changed = false;

    if (scheduleId && schedules.length) {
      const schedule = schedules.find(item => item.id === scheduleId);
      if (schedule && Number(schedule.participantCount || 0) !== participantCount) {
        schedule.participantCount = participantCount;
        changed = true;
      }
    }

    const totalParticipants = schedules.reduce(
      (acc, schedule) => acc + Number(schedule?.participantCount || 0),
      0
    );

    if (Number(selectedEvent.totalParticipants || 0) !== totalParticipants) {
      selectedEvent.totalParticipants = totalParticipants;
      changed = true;
    }

    if (Number(selectedEvent.scheduleCount || 0) !== schedules.length) {
      selectedEvent.scheduleCount = schedules.length;
      changed = true;
    }

    if (changed) {
      if (this.renderSchedules) {
        this.renderSchedules();
      }
      if (this.renderEvents) {
        this.renderEvents();
      }
    }
  }
}

  /**
   * アクションボタン状態の設定
   * @param {HTMLElement} button - ボタン要素
   * @param {boolean} disabled - 無効化するか
   */
  setActionButtonState(button, disabled) {
    if (!button) {
      return;
    }
    button.disabled = disabled;
    if (disabled) {
      button.setAttribute("aria-disabled", "true");
    } else {
      button.removeAttribute("aria-disabled");
    }
  }

  /**
   * 保存ボタン状態の同期
   */
  syncSaveButtonState() {
    const unsaved = this.hasUnsavedChanges();
    if (this.dom.saveButton) {
      this.dom.saveButton.disabled = this.state.saving || !unsaved;
    }
    if (this.dom.discardButton) {
      const disabled = this.state.saving || !unsaved;
      this.dom.discardButton.disabled = disabled;
      if (disabled) {
        this.dom.discardButton.setAttribute("aria-disabled", "true");
      } else {
        this.dom.discardButton.removeAttribute("aria-disabled");
      }
    }
    this.updateParticipantActionPanelState();
  }

  /**
   * クリアボタン状態の同期
   */
  syncClearButtonState() {
    if (!this.dom.clearParticipantsButton) return;
    const hasSelection = Boolean(this.state.selectedEventId && this.state.selectedScheduleId);
    const hasParticipants = hasSelection && this.state.participants.length > 0;
    this.dom.clearParticipantsButton.disabled = !hasSelection || !hasParticipants || this.state.saving;
    this.updateParticipantActionPanelState();
    this.syncMailActionState();
    if (this._syncAllPrintButtonStates) {
      this._syncAllPrintButtonStates();
    }
  }

  /**
   * テンプレートボタン状態の同期
   */
  syncTemplateButtons() {
    const hasSelection = Boolean(this.state.selectedEventId && this.state.selectedScheduleId);
    const hasParticipants = hasSelection && this.state.participants.some(entry => this.resolveParticipantUid(entry));

    if (this.dom.downloadParticipantTemplateButton) {
      this.dom.downloadParticipantTemplateButton.disabled = !hasSelection;
      if (hasSelection) {
        this.dom.downloadParticipantTemplateButton.removeAttribute("aria-disabled");
      } else {
        this.dom.downloadParticipantTemplateButton.setAttribute("aria-disabled", "true");
      }
    }

    if (this.dom.downloadTeamTemplateButton) {
      this.dom.downloadTeamTemplateButton.disabled = !hasParticipants;
      if (hasParticipants) {
        this.dom.downloadTeamTemplateButton.removeAttribute("aria-disabled");
        this.dom.downloadTeamTemplateButton.removeAttribute("title");
      } else {
        this.dom.downloadTeamTemplateButton.setAttribute("aria-disabled", "true");
        this.dom.downloadTeamTemplateButton.setAttribute("title", "参加者リストを読み込むとダウンロードできます。");
      }
    }

    this.syncMailActionState();
    if (this._syncAllPrintButtonStates) {
      this._syncAllPrintButtonStates();
    }
  }

  /**
   * すべての印刷ボタン状態の同期
   */
  syncAllPrintButtonStates() {
    this.syncPrintViewButtonState();
    this.syncStaffPrintViewButtonState();
  }

  /**
   * 印刷ビューボタン状態の同期
   */
  syncPrintViewButtonState() {
    this.logPrintDebug("syncPrintViewButtonState start");
    const button = this.dom.openPrintViewButton;
    if (!button) {
      if (!this.printActionButtonMissingLogged) {
        this.printActionButtonMissingLogged = true;
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("[Print] open-print-view-button が見つからないため、印刷アクションの状態を同期できませんでした。");
        }
      }
      this.logPrintWarn("syncPrintViewButtonState aborted: missing button");
      return;
    }

    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "印刷用リスト";
    }

    if (button.dataset.printing === "true") {
      this.logPrintDebug("syncPrintViewButtonState printing state");
      this.setActionButtonState(button, true);
      const busyLabel = button.dataset.printingLabel || "印刷準備中…";
      if (!button.dataset.printingLabel) {
        button.dataset.printingLabel = busyLabel;
      }
      if (button.textContent !== busyLabel) {
        button.textContent = busyLabel;
      }
      return;
    }

    if (button.dataset.printLocked === "true") {
      this.logPrintDebug("syncPrintViewButtonState locked state");
      this.setActionButtonState(button, true);
      const defaultLabel = button.dataset.defaultLabel || "印刷用リスト";
      if (button.textContent !== defaultLabel) {
        button.textContent = defaultLabel;
      }
      return;
    }

    const participantList = Array.isArray(this.state.participants) ? this.state.participants : [];
    const hasSelection = Boolean(this.state.selectedEventId && this.state.selectedScheduleId);
    const hasParticipants = hasSelection && participantList.length > 0;
    const disabled = !hasSelection || !hasParticipants;

    this.logPrintDebug("syncPrintViewButtonState resolved", { hasSelection, hasParticipants, disabled });

    this.setActionButtonState(button, disabled);

    if (disabled) {
      this.closeParticipantPrintPreview();
    }

    const baseLabel = button.dataset.defaultLabel || "印刷用リスト";
    if (button.textContent !== baseLabel) {
      button.textContent = baseLabel;
    }
  }

  /**
   * スタッフ印刷ビューボタン状態の同期
   */
  syncStaffPrintViewButtonState() {
    this.logPrintDebug("syncStaffPrintViewButtonState start");
    const button = this.dom.openStaffPrintViewButton;
    if (!button) {
      if (!this.staffPrintActionButtonMissingLogged) {
        this.staffPrintActionButtonMissingLogged = true;
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("[Print] open-staff-print-view-button が見つからないため、印刷アクションの状態を同期できませんでした。");
        }
      }
      this.logPrintWarn("syncStaffPrintViewButtonState aborted: missing button");
      return;
    }

    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "スタッフ印刷";
    }

    if (button.dataset.printing === "true") {
      this.setActionButtonState(button, true);
      const busyLabel = button.dataset.printingLabel || "印刷準備中…";
      if (!button.dataset.printingLabel) {
        button.dataset.printingLabel = busyLabel;
      }
      if (button.textContent !== busyLabel) {
        button.textContent = busyLabel;
      }
      return;
    }

    if (button.dataset.printLocked === "true") {
      this.setActionButtonState(button, true);
      const defaultLabel = button.dataset.defaultLabel || "スタッフ印刷";
      if (button.textContent !== defaultLabel) {
        button.textContent = defaultLabel;
      }
      return;
    }

    const eventId = this.state.selectedEventId;
    const scheduleId = this.state.selectedScheduleId;
    const hasSelection = Boolean(eventId && scheduleId);
    const staffGroups = hasSelection && this.printManager ? this.printManager.buildStaffPrintGroups({ eventId, scheduleId }) : [];
    const totalStaff = staffGroups.reduce((sum, group) => sum + (group.members?.length || 0), 0);
    const disabled = !hasSelection || totalStaff === 0;

    this.setActionButtonState(button, disabled);

    const baseLabel = button.dataset.defaultLabel || "スタッフ印刷";
    if (button.textContent !== baseLabel) {
      button.textContent = baseLabel;
    }
  }

  /**
   * 印刷ボタンのビジー状態設定
   * @param {boolean} isBusy - ビジー状態にするか
   */
  setPrintButtonBusy(isBusy) {
    const button = this.dom.openPrintViewButton;
    if (!button) return;
    this.logPrintDebug("setPrintButtonBusy", { isBusy });
    if (isBusy) {
      button.dataset.printing = "true";
    } else {
      delete button.dataset.printing;
    }
    this.syncAllPrintButtonStates();
  }

  /**
   * スタッフ印刷ボタンのビジー状態設定
   * @param {boolean} isBusy - ビジー状態にするか
   */
  setStaffPrintButtonBusy(isBusy) {
    const button = this.dom.openStaffPrintViewButton;
    if (!button) return;
    this.logPrintDebug("setStaffPrintButtonBusy", { isBusy });
    if (isBusy) {
      button.dataset.printing = "true";
    } else {
      delete button.dataset.printing;
    }
    this.syncAllPrintButtonStates();
  }

  /**
   * 参加者アクションパネル状態の更新
   */
  updateParticipantActionPanelState() {
    const panel = this.dom.participantActionPanel;
    const info = this.dom.participantActionInfo;
    const editButton = this.dom.editSelectedParticipantButton;
    const cancelButton = this.dom.cancelSelectedParticipantButton;
    const relocateButton = this.dom.relocateSelectedParticipantButton;
    const deleteButton = this.dom.deleteSelectedParticipantButton;

    const target = this.getSelectedParticipantTarget();
    const entry = target.entry;
    const hasSelection = Boolean(entry);
    const disableIndividual = this.state.saving || !hasSelection;

    this.setActionButtonState(editButton, disableIndividual);
    this.setActionButtonState(cancelButton, disableIndividual);
    this.setActionButtonState(relocateButton, disableIndividual);
    this.setActionButtonState(deleteButton, disableIndividual);

    const actionable = Boolean(
      (this.dom.saveButton && !this.dom.saveButton.disabled) ||
      (this.dom.discardButton && !this.dom.discardButton.disabled) ||
      (this.dom.clearParticipantsButton && !this.dom.clearParticipantsButton.disabled) ||
      (editButton && !editButton.disabled) ||
      (cancelButton && !cancelButton.disabled) ||
      (relocateButton && !relocateButton.disabled) ||
      (deleteButton && !deleteButton.disabled)
    );

    if (panel) {
      panel.classList.toggle("is-idle", !actionable);
    }

    if (info) {
      if (entry) {
        info.textContent = `${this.formatParticipantIdentifier(entry)}を選択中`;
      } else if (actionable) {
        info.textContent = "参加者を選択すると個別操作ができます。";
      } else {
        info.textContent = "操作可能なボタンはありません。";
      }
    }
  }
}


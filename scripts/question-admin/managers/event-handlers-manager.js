// event-handlers-manager.js: イベントハンドラーアタッチ関連の機能を担当します。
export class EventHandlersManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    
    // Managerインスタンス
    this.csvManager = context.csvManager;
    this.printManager = context.printManager;
    this.confirmDialogManager = context.confirmDialogManager;
    
    // 依存関数
    this.setupParticipantTabs = context.setupParticipantTabs;
    this.updateParticipantActionPanelState = context.updateParticipantActionPanelState;
    this.setLoginError = context.setLoginError;
    this.signInWithPopup = context.signInWithPopup;
    this.signOut = context.signOut;
    this.auth = context.auth;
    this.provider = context.provider;
    this.loadEvents = context.loadEvents;
    this.loadParticipants = context.loadParticipants;
    this.syncAllPrintButtonStates = context.syncAllPrintButtonStates;
    this.openStaffPrintView = context.openStaffPrintView;
    this.openParticipantPrintView = context.openParticipantPrintView;
    this.closeParticipantPrintPreview = context.closeParticipantPrintPreview;
    this.printParticipantPreview = context.printParticipantPreview;
    this.getPendingMailCount = context.getPendingMailCount;
    this.handleSendParticipantMail = context.handleSendParticipantMail;
    this.bindDialogDismiss = context.bindDialogDismiss;
    this.setupPrintSettingsDialog = context.setupPrintSettingsDialog;
    this.handleRelocationDialogClose = context.handleRelocationDialogClose;
    this.resetPrintPreview = context.resetPrintPreview;
    this.openEventForm = context.openEventForm;
    this.handleUpdateEvent = context.handleUpdateEvent;
    this.handleAddEvent = context.handleAddEvent;
    this.closeDialog = context.closeDialog;
    this.setFormError = context.setFormError;
    this.openScheduleForm = context.openScheduleForm;
    this.handleUpdateSchedule = context.handleUpdateSchedule;
    this.handleAddSchedule = context.handleAddSchedule;
    this.syncScheduleEndMin = context.syncScheduleEndMin;
    this.setCalendarPickedDate = context.setCalendarPickedDate;
    this.shiftScheduleDialogCalendarMonth = context.shiftScheduleDialogCalendarMonth;
    this.saveParticipantEdits = context.saveParticipantEdits;
    this.handleRelocationFormSubmit = context.handleRelocationFormSubmit;
    this.handleSave = context.handleSave;
    this.handleRevertParticipants = context.handleRevertParticipants;
    this.handleParticipantCardListClick = context.handleParticipantCardListClick;
    this.handleParticipantCardListKeydown = context.handleParticipantCardListKeydown;
    this.handleParticipantListFocus = context.handleParticipantListFocus;
    this.handleEditSelectedParticipant = context.handleEditSelectedParticipant;
    this.handleCancelSelectedParticipant = context.handleCancelSelectedParticipant;
    this.handleRelocateSelectedParticipant = context.handleRelocateSelectedParticipant;
    this.handleDeleteSelectedParticipant = context.handleDeleteSelectedParticipant;
    this.handleClearParticipants = context.handleClearParticipants;
    this.getMissingSelectionStatusMessage = context.getMissingSelectionStatusMessage;
    this.getSelectionRequiredMessage = context.getSelectionRequiredMessage;
    this.setUploadStatus = context.setUploadStatus;
    this.confirmAction = context.confirmAction;
    this.setupConfirmDialog = context.setupConfirmDialog;
    
    // ログ関数
    this.logPrintInfo = context.logPrintInfo;
    this.logPrintWarn = context.logPrintWarn;
    this.logPrintError = context.logPrintError;
  }

  /**
   * イベントハンドラーのアタッチ
   */
  attachEventHandlers() {
    this.setupParticipantTabs();
    this.updateParticipantActionPanelState();

    // ログインボタン
    if (this.dom.loginButton) {
      this.dom.loginButton.addEventListener("click", async () => {
        if (this.dom.loginButton.disabled) return;
        this.setLoginError("");
        this.dom.loginButton.disabled = true;
        this.dom.loginButton.classList.add("is-busy");
        try {
          await this.signInWithPopup(this.auth, this.provider);
        } catch (error) {
          console.error(error);
          this.setLoginError("ログインに失敗しました。時間をおいて再度お試しください。");
          this.dom.loginButton.disabled = false;
          this.dom.loginButton.classList.remove("is-busy");
        }
      });
    }

    // ログアウトボタン
    if (this.dom.logoutButton) {
      this.dom.logoutButton.addEventListener("click", () => this.signOut(this.auth));
    }
    if (this.dom.headerLogout) {
      this.dom.headerLogout.addEventListener("click", () => this.signOut(this.auth));
    }

    // ログアウトのキーボードショートカット「l」
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", (event) => {
        const target = event.target;
        const isFormField =
          target instanceof HTMLElement &&
          target.closest("input, textarea, select, [role='textbox'], [contenteditable=''], [contenteditable='true']");
        
        // 入力フィールドにフォーカスがある場合は無視
        if (!isFormField && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          if (event.key === "l" || event.key === "L") {
            const logoutButton = this.dom.logoutButton || this.dom.headerLogout;
            if (logoutButton && !logoutButton.disabled && !logoutButton.hidden) {
              event.preventDefault();
              this.signOut(this.auth);
            }
          }
        }
      });
    }

    // リフレッシュボタン
    if (this.dom.refreshButton) {
      this.dom.refreshButton.addEventListener("click", async () => {
        try {
          await this.loadEvents({ preserveSelection: true });
          await this.loadParticipants();
        } catch (error) {
          console.error(error);
        }
      });
    }

    // CSVテンプレートダウンロードボタン
    if (this.dom.downloadParticipantTemplateButton) {
      this.dom.downloadParticipantTemplateButton.addEventListener("click", () => {
        if (!this.csvManager) {
          throw new Error("CsvManager is not initialized");
        }
        this.csvManager.downloadParticipantTemplate();
      });
    }

    if (this.dom.downloadTeamTemplateButton) {
      this.dom.downloadTeamTemplateButton.addEventListener("click", () => {
        if (!this.csvManager) {
          throw new Error("CsvManager is not initialized");
        }
        this.csvManager.downloadTeamTemplate();
      });
    }

    // 印刷ボタン
    if (this.dom.openStaffPrintViewButton) {
      this.dom.openStaffPrintViewButton.addEventListener("click", () => {
        const button = this.dom.openStaffPrintViewButton;
        if (!button) {
          this.logPrintWarn("openStaffPrintViewButton click without button");
          return;
        }

        this.syncAllPrintButtonStates();

        this.logPrintInfo("openStaffPrintViewButton clicked", { disabled: button.disabled, printing: button.dataset.printing });

        if (button.disabled || button.dataset.printing === "true") {
          this.logPrintWarn("openStaffPrintViewButton ignored due to state", {
            disabled: button.disabled,
            printing: button.dataset.printing
          });
          return;
        }

        this.openStaffPrintView().catch(error => {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[Print] スタッフ印刷用リストの生成に失敗しました。", error);
          }
          this.logPrintError("openStaffPrintView failed from click", error);
          window.alert("印刷用リストの生成中にエラーが発生しました。時間をおいて再度お試しください。");
        });
      });
    }

    if (this.dom.openPrintViewButton) {
      this.dom.openPrintViewButton.addEventListener("click", () => {
        const button = this.dom.openPrintViewButton;
        if (!button) {
          this.logPrintWarn("openPrintViewButton click without button");
          return;
        }

        // ボタンの状態が古い場合に即時同期してから判定する
        this.syncAllPrintButtonStates();

        this.logPrintInfo("openPrintViewButton clicked", { disabled: button.disabled, printing: button.dataset.printing });

        if (button.disabled || button.dataset.printing === "true") {
          this.logPrintWarn("openPrintViewButton ignored due to state", {
            disabled: button.disabled,
            printing: button.dataset.printing
          });
          return;
        }

        this.openParticipantPrintView()
          .catch(error => {
            if (typeof console !== "undefined" && typeof console.error === "function") {
              console.error("[Print] 印刷用リストの生成に失敗しました。", error);
            }
            this.logPrintError("openParticipantPrintView failed from click", error);
            window.alert("印刷用リストの生成中にエラーが発生しました。時間をおいて再度お試しください。");
          });
      });
    }

    if (this.dom.printPreviewCloseButton) {
      this.dom.printPreviewCloseButton.addEventListener("click", () => {
        this.logPrintInfo("printPreviewCloseButton clicked");
        this.closeParticipantPrintPreview();
      });
    }

    if (this.dom.printPreviewPrintButton) {
      this.dom.printPreviewPrintButton.addEventListener("click", () => {
        if (this.dom.printPreviewPrintButton.disabled) {
          this.logPrintWarn("printPreviewPrintButton ignored: disabled");
          return;
        }
        this.logPrintInfo("printPreviewPrintButton clicked");
        this.printParticipantPreview({ showAlertOnFailure: true });
      });
    }

    // メール送信ボタン
    if (this.dom.sendMailButton) {
      this.dom.sendMailButton.addEventListener("click", async () => {
        if (this.dom.sendMailButton.disabled || this.state.mailSending) {
          return;
        }
        const pendingCount = this.getPendingMailCount();
        if (!this.state.selectedEventId || !this.state.selectedScheduleId) {
          this.setUploadStatus(this.getSelectionRequiredMessage("メールを送信するには"), "error");
          return;
        }
        if (pendingCount === 0) {
          this.setUploadStatus("送信対象の参加者が見つかりません。", "error");
          return;
        }
        const confirmed = await this.confirmAction({
          title: "案内メール送信の確認",
          description: `未送信の参加者 ${pendingCount} 名にHTMLメールを送信します。よろしいですか？`,
          confirmLabel: "送信する",
          cancelLabel: "キャンセル",
          tone: "primary"
        });
        if (!confirmed) {
          return;
        }
        await this.handleSendParticipantMail();
      });
    }

    // ダイアログの設定
    this.bindDialogDismiss(this.dom.eventDialog);
    this.bindDialogDismiss(this.dom.scheduleDialog);
    this.bindDialogDismiss(this.dom.participantDialog);
    this.bindDialogDismiss(this.dom.relocationDialog);
    this.bindDialogDismiss(this.dom.printPreviewDialog);
    if (this.printManager) {
      this.printManager.setupSettingsDialog();
    } else {
      // フォールバック（初期化前の場合）
      this.setupPrintSettingsDialog();
    }

    if (this.dom.relocationDialog) {
      this.dom.relocationDialog.addEventListener("dialog:close", this.handleRelocationDialogClose);
    }

    if (this.dom.printPreviewDialog) {
      this.dom.printPreviewDialog.addEventListener("dialog:close", () => {
        this.resetPrintPreview({ skipCloseDialog: true });
      });
    }

    // イベントフォーム
    if (this.dom.addEventButton) {
      this.dom.addEventButton.addEventListener("click", () => {
        this.openEventForm({ mode: "create" });
      });
    }

    if (this.dom.eventForm) {
      this.dom.eventForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (!this.dom.eventNameInput) return;
        const submitButton = this.dom.eventForm.querySelector("button[type='submit']");
        if (submitButton) submitButton.disabled = true;
        this.setFormError(this.dom.eventError);
        try {
          const mode = this.dom.eventForm.dataset.mode || "create";
          const targetEventId = this.dom.eventForm.dataset.eventId || "";
          if (mode === "edit") {
            await this.handleUpdateEvent(targetEventId, this.dom.eventNameInput.value);
          } else {
            await this.handleAddEvent(this.dom.eventNameInput.value);
          }
          this.dom.eventForm.reset();
          this.closeDialog(this.dom.eventDialog);
        } catch (error) {
          console.error(error);
          const message = this.dom.eventForm.dataset.mode === "edit"
            ? error.message || "イベントの更新に失敗しました。"
            : error.message || "イベントの追加に失敗しました。";
          this.setFormError(this.dom.eventError, message);
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
    }

    // スケジュールフォーム
    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.addEventListener("click", () => {
        this.openScheduleForm({ mode: "create" });
      });
    }

    if (this.dom.scheduleForm) {
      this.dom.scheduleForm.addEventListener("submit", async event => {
        event.preventDefault();
        const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
        if (submitButton) submitButton.disabled = true;
        this.setFormError(this.dom.scheduleError);
        try {
          const mode = this.dom.scheduleForm.dataset.mode || "create";
          const scheduleId = this.dom.scheduleForm.dataset.scheduleId || "";
          const payload = {
            label: this.dom.scheduleLabelInput?.value,
            location: this.dom.scheduleLocationInput?.value,
            date: this.dom.scheduleDateInput?.value,
            startTime: this.dom.scheduleStartTimeInput?.value,
            endTime: this.dom.scheduleEndTimeInput?.value
          };
          if (mode === "edit") {
            await this.handleUpdateSchedule(scheduleId, payload);
          } else {
            await this.handleAddSchedule(payload);
          }
          this.dom.scheduleForm.reset();
          this.closeDialog(this.dom.scheduleDialog);
        } catch (error) {
          console.error(error);
          const message = this.dom.scheduleForm.dataset.mode === "edit"
            ? error.message || "日程の更新に失敗しました。"
            : error.message || "日程の追加に失敗しました。";
          this.setFormError(this.dom.scheduleError, message);
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
    }

    if (this.dom.scheduleStartTimeInput) {
      this.dom.scheduleStartTimeInput.addEventListener("input", () => this.syncScheduleEndMin());
    }

    if (this.dom.scheduleDateInput) {
      this.dom.scheduleDateInput.addEventListener("input", () => {
        this.setCalendarPickedDate(this.dom.scheduleDateInput.value, { updateInput: false });
      });
    }

    if (this.dom.scheduleDialogCalendarPrev) {
      this.dom.scheduleDialogCalendarPrev.addEventListener("click", () => this.shiftScheduleDialogCalendarMonth(-1));
    }

    if (this.dom.scheduleDialogCalendarNext) {
      this.dom.scheduleDialogCalendarNext.addEventListener("click", () => this.shiftScheduleDialogCalendarMonth(1));
    }

    // CSV入力
    if (this.dom.csvInput) {
      this.dom.csvInput.addEventListener("change", (event) => {
        if (!this.csvManager) {
          throw new Error("CsvManager is not initialized");
        }
        this.csvManager.handleCsvChange(event);
      });
      this.dom.csvInput.disabled = true;
    }

    if (this.dom.teamCsvInput) {
      this.dom.teamCsvInput.addEventListener("change", (event) => {
        if (!this.csvManager) {
          throw new Error("CsvManager is not initialized");
        }
        this.csvManager.handleTeamCsvChange(event);
      });
      this.dom.teamCsvInput.disabled = true;
    }

    // 参加者フォーム
    if (this.dom.participantForm) {
      this.dom.participantForm.addEventListener("submit", event => {
        event.preventDefault();
        const submitButton = this.dom.participantForm.querySelector("button[type='submit']");
        if (submitButton) submitButton.disabled = true;
        try {
          this.setFormError(this.dom.participantError);
          this.saveParticipantEdits();
          this.closeDialog(this.dom.participantDialog);
          this.setUploadStatus("参加者情報を更新しました。適用または取消を選択してください。", "success");
        } catch (error) {
          console.error(error);
          this.setFormError(this.dom.participantError, error.message || "参加者情報の更新に失敗しました。");
        } finally {
          if (submitButton) submitButton.disabled = false;
        }
      });
    }

    if (this.dom.relocationForm) {
      this.dom.relocationForm.addEventListener("submit", this.handleRelocationFormSubmit);
    }

    // 保存・取消ボタン
    if (this.dom.saveButton) {
      this.dom.saveButton.addEventListener("click", () => {
        this.handleSave().catch(err => {
          console.error(err);
          this.setUploadStatus(err.message || "適用に失敗しました。", "error");
        });
      });
      this.dom.saveButton.disabled = true;
      this.updateParticipantActionPanelState();
    }

    if (this.dom.discardButton) {
      this.dom.discardButton.addEventListener("click", () => {
        this.handleRevertParticipants().catch(err => {
          console.error(err);
          this.setUploadStatus(err.message || "変更の取り消しに失敗しました。", "error");
        });
      });
      this.dom.discardButton.disabled = true;
      this.updateParticipantActionPanelState();
    }

    // 参加者カードリスト
    if (this.dom.participantCardList) {
      this.dom.participantCardList.addEventListener("click", this.handleParticipantCardListClick);
      this.dom.participantCardList.addEventListener("keydown", this.handleParticipantCardListKeydown);
      this.dom.participantCardList.addEventListener("focusin", this.handleParticipantListFocus);
    }

    // 参加者アクションボタン
    if (this.dom.editSelectedParticipantButton) {
      this.dom.editSelectedParticipantButton.addEventListener("click", this.handleEditSelectedParticipant);
    }

    if (this.dom.cancelSelectedParticipantButton) {
      this.dom.cancelSelectedParticipantButton.addEventListener("click", this.handleCancelSelectedParticipant);
    }

    if (this.dom.relocateSelectedParticipantButton) {
      this.dom.relocateSelectedParticipantButton.addEventListener("click", this.handleRelocateSelectedParticipant);
    }

    if (this.dom.deleteSelectedParticipantButton) {
      this.dom.deleteSelectedParticipantButton.addEventListener("click", this.handleDeleteSelectedParticipant);
    }

    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.disabled = true;
    }

    if (this.dom.clearParticipantsButton) {
      this.dom.clearParticipantsButton.addEventListener("click", () => {
        this.handleClearParticipants().catch(err => {
          console.error(err);
          this.setUploadStatus(err.message || "参加者リストの削除に失敗しました。", "error");
        });
      });
      this.updateParticipantActionPanelState();
    }

    // UI初期化
    if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = true;
    if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = true;

    if (this.dom.uploadStatus) {
      this.setUploadStatus(this.getMissingSelectionStatusMessage());
    }

    if (this.dom.fileLabel) this.dom.fileLabel.textContent = "参加者CSVをアップロード";
    if (this.dom.teamFileLabel) this.dom.teamFileLabel.textContent = "班番号CSVをアップロード";

    if (this.dom.copyrightYear) {
      this.dom.copyrightYear.textContent = String(new Date().getFullYear());
    }

    this.setupConfirmDialog();
  }
}


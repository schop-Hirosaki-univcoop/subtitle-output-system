// init-manager.js: アプリケーション初期化関連の機能を担当します。
export class InitManager {
  constructor(context) {
    this.state = context.state;
    this.dom = context.dom;
    this.calendarState = context.calendarState;
    
    // Manager変数の参照（初期化後に設定される）
    this.managerRefs = context.managerRefs;
    
    // Managerクラスの参照
    this.managerClasses = context.managerClasses;
    
    // 依存関数と定数
    this.openDialog = context.openDialog;
    this.closeDialog = context.closeDialog;
    this.setFormError = context.setFormError;
    this.setAuthUi = context.setAuthUi;
    this.setLoginError = context.setLoginError;
    this.showLoader = context.showLoader;
    this.hideLoader = context.hideLoader;
    this.initLoaderSteps = context.initLoaderSteps;
    this.setLoaderStep = context.setLoaderStep;
    this.finishLoaderSteps = context.finishLoaderSteps;
    this.resetState = context.resetState;
    this.renderUserSummary = context.renderUserSummary;
    this.isEmbeddedMode = context.isEmbeddedMode;
    this.getEmbedPrefix = context.getEmbedPrefix;
    this.parseInitialSelectionFromUrl = context.parseInitialSelectionFromUrl;
    this.startHostSelectionBridge = context.startHostSelectionBridge;
    this.initAuthWatcher = context.initAuthWatcher;
    this.attachEventHandlers = context.attachEventHandlers;
    this.applySelectionContext = context.applySelectionContext;
    this.loadParticipants = context.loadParticipants;
    this.loadEvents = context.loadEvents;
    this.waitForEmbedReady = context.waitForEmbedReady;
    this.detachHost = context.detachHost;
    this.attachHost = context.attachHost;
    this.applyHostSelectionFromDataset = context.applyHostSelectionFromDataset;
    
    // 定数
    this.STEP_LABELS = context.STEP_LABELS;
    this.FOCUS_TARGETS = context.FOCUS_TARGETS;
    this.UPLOAD_STATUS_PLACEHOLDERS = context.UPLOAD_STATUS_PLACEHOLDERS;
    this.PARTICIPANT_DESCRIPTION_DEFAULT = context.PARTICIPANT_DESCRIPTION_DEFAULT;
    this.PARTICIPANT_TEMPLATE_HEADERS = context.PARTICIPANT_TEMPLATE_HEADERS;
    this.TEAM_TEMPLATE_HEADERS = context.TEAM_TEMPLATE_HEADERS;
    this.NO_TEAM_GROUP_KEY = context.NO_TEAM_GROUP_KEY;
    this.CANCEL_LABEL = context.CANCEL_LABEL;
    this.RELOCATE_LABEL = context.RELOCATE_LABEL;
    this.GL_STAFF_GROUP_KEY = context.GL_STAFF_GROUP_KEY;
    this.GL_STAFF_LABEL = context.GL_STAFF_LABEL;
    this.MAIL_STATUS_ICON_SVG = context.MAIL_STATUS_ICON_SVG;
    this.CHANGE_ICON_SVG = context.CHANGE_ICON_SVG;
    this.GAS_API_URL = context.GAS_API_URL;
    this.FORM_PAGE_PATH = context.FORM_PAGE_PATH;
    this.HOST_SELECTION_ATTRIBUTE_KEYS = context.HOST_SELECTION_ATTRIBUTE_KEYS;
    this.PRINT_SETTING_STORAGE_KEY = context.PRINT_SETTING_STORAGE_KEY;
    this.DEFAULT_PRINT_SETTINGS = context.DEFAULT_PRINT_SETTINGS;
    this.redirectingToIndexRef = context.redirectingToIndexRef;
    
    // ユーティリティ関数
    this.sortParticipants = context.sortParticipants;
    this.getParticipantGroupKey = context.getParticipantGroupKey;
    this.describeParticipantGroup = context.describeParticipantGroup;
    this.collectGroupGlLeaders = context.collectGroupGlLeaders;
    this.getEventGlRoster = context.getEventGlRoster;
    this.getEventGlAssignmentsMap = context.getEventGlAssignmentsMap;
    this.resolveScheduleAssignment = context.resolveScheduleAssignment;
    this.loadGlDataForEvent = context.loadGlDataForEvent;
    this.normalizeKey = context.normalizeKey;
    this.normalizeGroupNumberValue = context.normalizeGroupNumberValue;
    this.signatureForEntries = context.signatureForEntries;
    this.snapshotParticipantList = context.snapshotParticipantList;
    this.getDisplayParticipantId = context.getDisplayParticipantId;
    this.resolveMailStatusInfo = context.resolveMailStatusInfo;
    this.resolveParticipantUid = context.resolveParticipantUid;
    this.resolveParticipantActionTarget = context.resolveParticipantActionTarget;
    this.updateParticipantActionPanelState = context.updateParticipantActionPanelState;
    this.createShareUrl = context.createShareUrl;
    this.describeDuplicateMatch = context.describeDuplicateMatch;
    this.diffParticipantLists = context.diffParticipantLists;
    this.getSelectionIdentifiers = context.getSelectionIdentifiers;
    this.getSelectionRequiredMessage = context.getSelectionRequiredMessage;
    this.setUploadStatus = context.setUploadStatus;
    this.hasUnsavedChanges = context.hasUnsavedChanges;
    this.confirmAction = context.confirmAction;
    this.renderParticipants = context.renderParticipants;
    this.renderEvents = context.renderEvents;
    this.getScheduleLabel = context.getScheduleLabel;
    this.describeScheduleRange = context.describeScheduleRange;
    this.updateParticipantContext = context.updateParticipantContext;
    this.captureParticipantBaseline = context.captureParticipantBaseline;
    this.syncSaveButtonState = context.syncSaveButtonState;
    this.syncMailActionState = context.syncMailActionState;
    this.syncAllPrintButtonStates = context.syncAllPrintButtonStates;
    this.syncClearButtonState = context.syncClearButtonState;
    this.syncTemplateButtons = context.syncTemplateButtons;
    this.syncSelectedEventSummary = context.syncSelectedEventSummary;
    this.setPrintButtonBusy = context.setPrintButtonBusy;
    this.setStaffPrintButtonBusy = context.setStaffPrintButtonBusy;
    this.queueRelocationPrompt = context.queueRelocationPrompt;
    this.applyParticipantSelectionStyles = context.applyParticipantSelectionStyles;
    this.emitParticipantSyncEvent = context.emitParticipantSyncEvent;
    this.selectSchedule = context.selectSchedule;
    this.selectEvent = context.selectEvent;
    this.setCalendarPickedDate = context.setCalendarPickedDate;
    this.refreshScheduleLocationHistory = context.refreshScheduleLocationHistory;
    this.populateScheduleLocationOptions = context.populateScheduleLocationOptions;
    this.finalizeEventLoad = context.finalizeEventLoad;
    this.broadcastSelectionChange = context.broadcastSelectionChange;
    this.getSelectionBroadcastSource = context.getSelectionBroadcastSource;
    this.hostSelectionSignature = context.hostSelectionSignature;
    this.getHostSelectionElement = context.getHostSelectionElement;
    this.readHostSelectionDataset = context.readHostSelectionDataset;
    this.stopHostSelectionBridge = context.stopHostSelectionBridge;
    this.startHostSelectionBridge = context.startHostSelectionBridge;
    this.ensureTokenSnapshot = context.ensureTokenSnapshot;
    this.drainQuestionQueue = context.drainQuestionQueue;
    this.generateQuestionToken = context.generateQuestionToken;
    this.getScheduleRecord = context.getScheduleRecord;
    this.ensureCrypto = context.ensureCrypto;
    this.base64UrlFromBytes = context.base64UrlFromBytes;
    this.fetchDbValue = context.fetchDbValue;
    this.logPrintDebug = context.logPrintDebug;
    this.logPrintWarn = context.logPrintWarn;
    this.logPrintError = context.logPrintError;
    this.maybeFocusInitialSection = context.maybeFocusInitialSection;
    this.resolveEmbedReady = context.resolveEmbedReady;
    this.handleSave = context.handleSave;
    this.updateDuplicateMatches = context.updateDuplicateMatches;
    this.ensureRowKey = context.ensureRowKey;
    this.resolveParticipantStatus = context.resolveParticipantStatus;
    this.ensureTeamAssignmentMap = context.ensureTeamAssignmentMap;
    this.applyAssignmentsToEventCache = context.applyAssignmentsToEventCache;
    this.syncCurrentScheduleCache = context.syncCurrentScheduleCache;
    this.findParticipantForSnapshot = context.findParticipantForSnapshot;
    this.formatParticipantIdentifier = context.formatParticipantIdentifier;
    this.createParticipantGroupElements = context.createParticipantGroupElements;
    this.clearParticipantSelection = context.clearParticipantSelection;
    this.participantChangeKey = context.participantChangeKey;
    this.renderGroupGlAssignments = context.renderGroupGlAssignments;
    this.openEventForm = context.openEventForm;
    this.openScheduleForm = context.openScheduleForm;
    this.saveParticipantEdits = context.saveParticipantEdits;
    this.handleDeleteParticipant = context.handleDeleteParticipant;
    this.openParticipantEditor = context.openParticipantEditor;
    this.handleQuickCancelAction = context.handleQuickCancelAction;
    this.commitParticipantQuickEdit = context.commitParticipantQuickEdit;
    this.renderParticipantChangePreview = context.renderParticipantChangePreview;
    this.renderRelocationPrompt = context.renderRelocationPrompt;
    this.ensurePendingRelocationMap = context.ensurePendingRelocationMap;
    this.applyRelocationDraft = context.applyRelocationDraft;
    this.handleRelocationFormSubmit = context.handleRelocationFormSubmit;
    this.handleRelocationDialogClose = context.handleRelocationDialogClose;
    this.handleRelocateSelectedParticipant = context.handleRelocateSelectedParticipant;
    this.buildScheduleOptionLabel = context.buildScheduleOptionLabel;
    this.prepareScheduleDialogCalendar = context.prepareScheduleDialogCalendar;
    this.syncScheduleEndMin = context.syncScheduleEndMin;
    this.shiftScheduleDialogCalendarMonth = context.shiftScheduleDialogCalendarMonth;
    this.setActionButtonState = context.setActionButtonState;
    this.sleep = context.sleep;
    this.setupPrintSettingsDialog = context.setupPrintSettingsDialog;
    this.bindDialogDismiss = context.bindDialogDismiss;
    this.signInWithPopup = context.signInWithPopup;
    this.signOut = context.signOut;
    
    // API関連
    this.api = context.api;
    this.auth = context.auth;
    this.provider = context.provider;
    this.getAuthIdToken = context.getAuthIdToken;
    this.firebaseConfig = context.firebaseConfig;
    this.goToLogin = context.goToLogin;
  }

  /**
   * アプリケーションの初期化
   * すべてのManagerを初期化し、初期化後の処理を実行します。
   */
  init() {
    const refs = this.managerRefs;
    const ManagerClasses = this.managerClasses;
    
    // PrintManager を初期化
    refs.printManager = new ManagerClasses.PrintManager({
      dom: this.dom,
      state: this.state,
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      // 依存関数と定数
      sortParticipants: this.sortParticipants,
      getParticipantGroupKey: this.getParticipantGroupKey,
      describeParticipantGroup: this.describeParticipantGroup,
      collectGroupGlLeaders: this.collectGroupGlLeaders,
      getEventGlRoster: this.getEventGlRoster,
      getEventGlAssignmentsMap: this.getEventGlAssignmentsMap,
      resolveScheduleAssignment: this.resolveScheduleAssignment,
      loadGlDataForEvent: async (eventId, options) => {
        if (refs.glManager) {
          return await refs.glManager.loadGlDataForEvent(eventId, options);
        } else {
          return await this.loadGlDataForEvent(eventId, options);
        }
      },
      normalizeKey: this.normalizeKey,
      normalizeGroupNumberValue: this.normalizeGroupNumberValue,
      NO_TEAM_GROUP_KEY: this.NO_TEAM_GROUP_KEY,
      CANCEL_LABEL: this.CANCEL_LABEL,
      RELOCATE_LABEL: this.RELOCATE_LABEL,
      GL_STAFF_GROUP_KEY: this.GL_STAFF_GROUP_KEY,
      // ボタン状態管理関数
      syncAllPrintButtonStates: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncAllPrintButtonStates();
        } else {
          return this.syncAllPrintButtonStates();
        }
      },
      setPrintButtonBusy: (isBusy) => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.setPrintButtonBusy(isBusy);
        } else {
          return this.setPrintButtonBusy(isBusy);
        }
      },
      setStaffPrintButtonBusy: (isBusy) => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.setStaffPrintButtonBusy(isBusy);
        } else {
          return this.setStaffPrintButtonBusy(isBusy);
        }
      }
    });
    
    refs.printManager.hydrateSettingsFromStorage();
    
    // StateManager を初期化
    refs.stateManager = new ManagerClasses.StateManager({
      state: this.state,
      dom: this.dom,
      // 依存関数と定数
      signatureForEntries: this.signatureForEntries,
      snapshotParticipantList: this.snapshotParticipantList,
      normalizeKey: this.normalizeKey,
      isEmbeddedMode: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.isEmbeddedMode();
        } else {
          return this.isEmbeddedMode();
        }
      },
      UPLOAD_STATUS_PLACEHOLDERS: this.UPLOAD_STATUS_PLACEHOLDERS
    });

    // UIManager を初期化
    refs.uiManager = new ManagerClasses.UIManager({
      state: this.state,
      dom: this.dom,
      // 依存関数と定数
      getEmbedPrefix: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.getEmbedPrefix();
        } else {
          return this.getEmbedPrefix();
        }
      },
      isEmbeddedMode: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.isEmbeddedMode();
        } else {
          return this.isEmbeddedMode();
        }
      },
      updateParticipantActionPanelState: () => {
        // ButtonStateManager が初期化された後に呼び出されるため、refs を使用
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        } else {
          // フォールバック: グローバル関数を使用（通常は実行されない）
          return this.updateParticipantActionPanelState();
        }
      },
      FOCUS_TARGETS: this.FOCUS_TARGETS
    });

    // ConfirmDialogManager を初期化
    refs.confirmDialogManager = new ManagerClasses.ConfirmDialogManager({
      dom: this.dom,
      // 依存関数
      openDialog: this.openDialog,
      closeDialog: this.closeDialog
    });

    // ScheduleUtilityManager を初期化
    refs.scheduleUtilityManager = new ManagerClasses.ScheduleUtilityManager({
      state: this.state,
      dom: this.dom,
      // 依存関数
      describeScheduleRange: this.describeScheduleRange,
      getScheduleLabel: this.getScheduleLabel,
      normalizeKey: this.normalizeKey,
      renderEvents: () => {
        if (refs.eventManager) {
          return refs.eventManager.renderEvents();
        } else {
          return this.renderEvents();
        }
      },
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        } else {
          return this.updateParticipantContext(options);
        }
      }
    });

    // ButtonStateManager を初期化
    refs.buttonStateManager = new ManagerClasses.ButtonStateManager({
      state: this.state,
      dom: this.dom,
      // 依存関数
      hasUnsavedChanges: () => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.hasUnsavedChanges();
      },
      resolveParticipantUid: this.resolveParticipantUid,
      syncMailActionState: () => {
        if (!refs.mailManager) return;
        return refs.mailManager.syncMailActionState();
      },
      syncAllPrintButtonStates: () => {
        // ButtonStateManager 自身のメソッドを呼び出すため、直接呼び出しは不要
        // この関数は PrintManager などから呼び出されるが、ButtonStateManager の初期化後なので問題ない
        // ただし、循環参照を避けるため、ここではフォールバックのみ
        return this.syncAllPrintButtonStates();
      },
      // 印刷関連の依存関数
      logPrintDebug: this.logPrintDebug,
      logPrintWarn: this.logPrintWarn,
      closeParticipantPrintPreview: () => {
        if (!refs.printManager) {
          throw new Error("PrintManager is not initialized");
        }
        return refs.printManager.closeParticipantPrintPreview();
      },
      printManager: refs.printManager,
      // 参加者アクションパネル関連の依存関数
      getSelectedParticipantTarget: () => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.getSelectedParticipantTarget();
      },
      formatParticipantIdentifier: (entry) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.formatParticipantIdentifier(entry);
      },
      // イベントサマリー関連の依存関数
      getScheduleLabel: this.getScheduleLabel,
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      renderEvents: this.renderEvents
    });
    
    // TokenApiManager を初期化
    refs.tokenApiManager = new ManagerClasses.TokenApiManager({
      state: this.state,
      // 依存関数と定数
      ensureCrypto: this.ensureCrypto,
      base64UrlFromBytes: this.base64UrlFromBytes,
      fetchDbValue: this.fetchDbValue,
      GAS_API_URL: this.GAS_API_URL
    });
    
    // ShareClipboardManager を初期化
    refs.shareClipboardManager = new ManagerClasses.ShareClipboardManager({
      state: this.state,
      // 依存関数と定数
      FORM_PAGE_PATH: this.FORM_PAGE_PATH
    });
    
    // apiオブジェクトを設定（tokenApiManager初期化後に設定）
    if (!this.api && refs.tokenApiManager) {
      this.api = refs.tokenApiManager.createApiClient(this.getAuthIdToken);
    }
    
    // MailManager を初期化
    refs.mailManager = new ManagerClasses.MailManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      api: this.api,
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        } else {
          return this.setUploadStatus(...arguments);
        }
      },
      getSelectionRequiredMessage: (prefix) => {
        if (refs.stateManager) {
          return refs.stateManager.getSelectionRequiredMessage(prefix);
        } else {
          return this.getSelectionRequiredMessage(prefix);
        }
      },
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        } else {
          return this.renderParticipants();
        }
      },
      hasUnsavedChanges: () => {
        if (refs.stateManager) {
          return refs.stateManager.hasUnsavedChanges();
        } else {
          return this.hasUnsavedChanges();
        }
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        } else {
          return this.captureParticipantBaseline(entries, options);
        }
      },
      setActionButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.setActionButtonState(...arguments);
        } else {
          return this.setActionButtonState(...arguments);
        }
      },
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        } else {
          return await this.confirmAction(options);
        }
      }
    });
    
    // AuthManager を初期化
    refs.authManager = new ManagerClasses.AuthManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      api: this.api,
      auth: this.auth,
      getAuthIdToken: this.getAuthIdToken,
      firebaseConfig: this.firebaseConfig,
      goToLogin: this.goToLogin,
      setAuthUi: () => {
        if (refs.uiManager) {
          return refs.uiManager.setAuthUi(...arguments);
        } else {
          return this.setAuthUi(...arguments);
        }
      },
      setLoginError: (message) => {
        if (refs.uiManager) {
          return refs.uiManager.setLoginError(message);
        } else {
          return this.setLoginError(message);
        }
      },
      showLoader: this.showLoader,
      hideLoader: this.hideLoader,
      initLoaderSteps: this.initLoaderSteps,
      setLoaderStep: this.setLoaderStep,
      finishLoaderSteps: this.finishLoaderSteps,
      resetState: () => {
        // resetState は複雑な処理を含むため、refs を使用する実装は resetState 内で行う
        // ここではフォールバックとしてグローバル関数を使用
        return this.resetState(...arguments);
      },
      renderUserSummary: (user) => {
        if (refs.uiManager) {
          return refs.uiManager.renderUserSummary(user);
        } else {
          return this.renderUserSummary(user);
        }
      },
      isEmbeddedMode: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.isEmbeddedMode();
        } else {
          return this.isEmbeddedMode();
        }
      },
      STEP_LABELS: this.STEP_LABELS,
      ensureTokenSnapshot: this.ensureTokenSnapshot,
      loadEvents: (options) => {
        if (!refs.eventManager) return Promise.resolve();
        return refs.eventManager.loadEvents(options);
      },
      loadParticipants: (options) => {
        if (!refs.participantManager) return Promise.resolve();
        return refs.participantManager.loadParticipants(options);
      },
      drainQuestionQueue: async () => {
        if (refs.tokenApiManager) {
          return await refs.tokenApiManager.drainQuestionQueue(this.api);
        } else {
          return await this.drainQuestionQueue();
        }
      },
      resolveEmbedReady: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.resolveEmbedReady();
        } else {
          return this.resolveEmbedReady();
        }
      },
      maybeFocusInitialSection: () => {
        if (refs.uiManager) {
          return refs.uiManager.maybeFocusInitialSection();
        } else {
          return this.maybeFocusInitialSection();
        }
      },
      sleep: this.sleep,
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        } else {
          return this.setUploadStatus(...arguments);
        }
      },
      redirectingToIndexRef: this.redirectingToIndexRef
    });
    
    // ParticipantManager を初期化
    refs.participantManager = new ManagerClasses.ParticipantManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      readHostSelectionDataset: (target) => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.readHostSelectionDataset(target);
        } else {
          return this.readHostSelectionDataset(target);
        }
      },
      getHostSelectionElement: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.getHostSelectionElement();
        } else {
          return this.getHostSelectionElement();
        }
      },
      loadGlDataForEvent: async (eventId, options) => {
        if (refs.glManager) {
          return await refs.glManager.loadGlDataForEvent(eventId, options);
        } else {
          return await this.loadGlDataForEvent(eventId, options);
        }
      },
      renderEvents: () => {
        if (refs.eventManager) {
          return refs.eventManager.renderEvents();
        } else {
          return this.renderEvents();
        }
      },
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        } else {
          return this.updateParticipantContext(options);
        }
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        } else {
          return this.captureParticipantBaseline(entries, options);
        }
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        } else {
          return this.syncSaveButtonState();
        }
      },
      syncMailActionState: () => {
        if (!refs.mailManager) return;
        return refs.mailManager.syncMailActionState();
      },
      syncAllPrintButtonStates: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncAllPrintButtonStates();
        } else {
          return this.syncAllPrintButtonStates();
        }
      },
      syncClearButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncClearButtonState();
        } else {
          return this.syncClearButtonState();
        }
      },
      syncTemplateButtons: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncTemplateButtons();
        } else {
          return this.syncTemplateButtons();
        }
      },
      syncSelectedEventSummary: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSelectedEventSummary();
        } else {
          return this.syncSelectedEventSummary();
        }
      },
      renderParticipantChangePreview: (diff, changeInfoByKey, participants) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.renderParticipantChangePreview(diff, changeInfoByKey, participants);
      },
      renderRelocationPrompt: () => {
        if (!refs.relocationManager) return;
        return refs.relocationManager.renderRelocationPrompt();
      },
      applyParticipantSelectionStyles: (options) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.applyParticipantSelectionStyles(options);
        } else {
          return this.applyParticipantSelectionStyles(options);
        }
      },
      updateParticipantActionPanelState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        } else {
          return this.updateParticipantActionPanelState();
        }
      },
      emitParticipantSyncEvent: (detail) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.emitParticipantSyncEvent(detail);
        } else {
          return this.emitParticipantSyncEvent(detail);
        }
      },
      describeScheduleRange: this.describeScheduleRange,
      ensureTokenSnapshot: async (force) => {
        if (refs.tokenApiManager) {
          return await refs.tokenApiManager.ensureTokenSnapshot(force);
        } else {
          return await this.ensureTokenSnapshot(force);
        }
      },
      generateQuestionToken: (existingTokens) => {
        if (refs.tokenApiManager) {
          return refs.tokenApiManager.generateQuestionToken(existingTokens);
        } else {
          return this.generateQuestionToken(existingTokens);
        }
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        } else {
          return this.setUploadStatus(...arguments);
        }
      },
      // renderParticipants に必要な依存関係
      buildParticipantCard: (entry, index, options) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.buildParticipantCard(entry, index, options);
      },
      getParticipantGroupKey: this.getParticipantGroupKey,
      createParticipantGroupElements: this.createParticipantGroupElements,
      getEventGlRoster: this.getEventGlRoster,
      getEventGlAssignmentsMap: this.getEventGlAssignmentsMap,
      resolveScheduleAssignment: this.resolveScheduleAssignment,
      renderGroupGlAssignments: this.renderGroupGlAssignments,
      clearParticipantSelection: this.clearParticipantSelection,
      participantChangeKey: this.participantChangeKey,
      CANCEL_LABEL: this.CANCEL_LABEL,
      GL_STAFF_GROUP_KEY: this.GL_STAFF_GROUP_KEY,
      // CRUD機能に必要な依存関係
      getDisplayParticipantId: this.getDisplayParticipantId,
      ensurePendingRelocationMap: () => {
        if (!refs.relocationManager) return new Map();
        return refs.relocationManager.ensurePendingRelocationMap();
      },
      applyRelocationDraft: (entry, destinationScheduleId, destinationTeamNumber) => {
        if (!refs.relocationManager) return;
        return refs.relocationManager.applyRelocationDraft(entry, destinationScheduleId, destinationTeamNumber);
      },
      ensureTeamAssignmentMap: this.ensureTeamAssignmentMap,
      applyAssignmentsToEventCache: this.applyAssignmentsToEventCache,
      hasUnsavedChanges: () => {
        if (refs.stateManager) {
          return refs.stateManager.hasUnsavedChanges();
        } else {
          return this.hasUnsavedChanges();
        }
      },
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        } else {
          return await this.confirmAction(options);
        }
      },
      setFormError: this.setFormError,
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      RELOCATE_LABEL: this.RELOCATE_LABEL,
      // handleSave に必要な依存関係
      getScheduleRecord: this.getScheduleRecord,
      loadEvents: (options) => {
        if (refs.eventManager) {
          return refs.eventManager.loadEvents(options);
        } else {
          return this.loadEvents(options);
        }
      }
    });
    
    // RelocationManager を初期化
    refs.relocationManager = new ManagerClasses.RelocationManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      RELOCATE_LABEL: this.RELOCATE_LABEL,
      resolveParticipantActionTarget: (options) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.resolveParticipantActionTarget(options);
      },
      resolveParticipantUid: this.resolveParticipantUid,
      resolveParticipantStatus: this.resolveParticipantStatus,
      getScheduleLabel: this.getScheduleLabel,
      buildScheduleOptionLabel: this.buildScheduleOptionLabel,
      normalizeGroupNumberValue: this.normalizeGroupNumberValue,
      sortParticipants: this.sortParticipants,
      syncCurrentScheduleCache: this.syncCurrentScheduleCache,
      updateDuplicateMatches: this.updateDuplicateMatches,
      renderParticipants: () => {
        if (!refs.participantManager) return;
        return refs.participantManager.renderParticipants();
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        } else {
          return this.syncSaveButtonState();
        }
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        } else {
          return this.setUploadStatus(...arguments);
        }
      },
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      formatParticipantIdentifier: this.formatParticipantIdentifier,
      commitParticipantQuickEdit: (index, updated, options) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.commitParticipantQuickEdit(index, updated, options);
      },
      getScheduleRecord: this.getScheduleRecord,
      ensureRowKey: this.ensureRowKey,
      ensureTeamAssignmentMap: this.ensureTeamAssignmentMap,
      findParticipantForSnapshot: this.findParticipantForSnapshot
    });
    
    // HostIntegrationManager を初期化
    refs.hostIntegrationManager = new ManagerClasses.HostIntegrationManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      normalizeKey: this.normalizeKey,
      selectEvent: (eventId, options) => {
        if (refs.eventManager) {
          return refs.eventManager.selectEvent(eventId, options);
        } else {
          return this.selectEvent(eventId, options);
        }
      },
      loadEvents: (options) => {
        if (refs.eventManager) {
          return refs.eventManager.loadEvents(options);
        } else {
          return this.loadEvents(options);
        }
      },
      finalizeEventLoad: (options) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.finalizeEventLoad(options);
        } else {
          return this.finalizeEventLoad(options);
        }
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        } else {
          return this.updateParticipantContext(options);
        }
      },
      HOST_SELECTION_ATTRIBUTE_KEYS: this.HOST_SELECTION_ATTRIBUTE_KEYS,
      // 一時的な依存関数（後で移行予定）
      selectSchedule: (scheduleId, options) => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.selectSchedule(scheduleId, options);
      },
      refreshScheduleLocationHistory: () => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.refreshScheduleLocationHistory();
        } else {
          return this.refreshScheduleLocationHistory();
        }
      },
      populateScheduleLocationOptions: (preferred) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.populateScheduleLocationOptions(preferred);
        } else {
          return this.populateScheduleLocationOptions(preferred);
        }
      },
      hostSelectionSignature: (selection) => {
        // HostIntegrationManager 自身のメソッドを呼び出すため、直接呼び出しは不要
        // この関数は HostIntegrationManager の初期化時に渡されるが、循環参照を避けるため、フォールバックのみ
        return this.hostSelectionSignature(selection);
      },
      stopHostSelectionBridge: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.stopHostSelectionBridge();
        } else {
          return this.stopHostSelectionBridge();
        }
      },
      startHostSelectionBridge: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.startHostSelectionBridge();
        } else {
          return this.startHostSelectionBridge();
        }
      }
    });
    
    // EventHandlersManager を初期化
    refs.eventHandlersManager = new ManagerClasses.EventHandlersManager({
      state: this.state,
      dom: this.dom,
      // Managerインスタンス
      csvManager: refs.csvManager,
      printManager: refs.printManager,
      confirmDialogManager: refs.confirmDialogManager,
      // 依存関数
      setupParticipantTabs: () => {
        if (!refs.buttonStateManager) {
          throw new Error("ButtonStateManager is not initialized");
        }
        return refs.buttonStateManager.setupParticipantTabs();
      },
      updateParticipantActionPanelState: () => {
        if (!refs.buttonStateManager) {
          throw new Error("ButtonStateManager is not initialized");
        }
        return refs.buttonStateManager.updateParticipantActionPanelState();
      },
      setLoginError: (message) => {
        if (!refs.uiManager) {
          throw new Error("UIManager is not initialized");
        }
        return refs.uiManager.setLoginError(message);
      },
      signInWithPopup: this.signInWithPopup,
      signOut: this.signOut,
      auth: this.auth,
      provider: this.provider,
      loadEvents: (options) => {
        if (!refs.eventManager) return Promise.resolve();
        return refs.eventManager.loadEvents(options);
      },
      loadParticipants: (options) => {
        if (!refs.participantManager) return Promise.resolve();
        return refs.participantManager.loadParticipants(options);
      },
      syncAllPrintButtonStates: () => {
        if (!refs.buttonStateManager) {
          throw new Error("ButtonStateManager is not initialized");
        }
        return refs.buttonStateManager.syncAllPrintButtonStates();
      },
      openStaffPrintView: () => {
        if (!refs.printManager) {
          throw new Error("PrintManager is not initialized");
        }
        return refs.printManager.openStaffPrintView();
      },
      openParticipantPrintView: () => {
        if (!refs.printManager) {
          throw new Error("PrintManager is not initialized");
        }
        return refs.printManager.openParticipantPrintView();
      },
      closeParticipantPrintPreview: () => {
        if (!refs.printManager) {
          throw new Error("PrintManager is not initialized");
        }
        return refs.printManager.closeParticipantPrintPreview();
      },
      printParticipantPreview: (options) => {
        if (!refs.printManager) {
          throw new Error("PrintManager is not initialized");
        }
        return refs.printManager.printParticipantPreview(options);
      },
      getPendingMailCount: () => {
        if (!refs.mailManager) return 0;
        return refs.mailManager.getPendingMailCount();
      },
      handleSendParticipantMail: () => {
        if (!refs.mailManager) {
          throw new Error("MailManager is not initialized");
        }
        return refs.mailManager.handleSendParticipantMail();
      },
      bindDialogDismiss: this.bindDialogDismiss,
      setupPrintSettingsDialog: this.setupPrintSettingsDialog,
      handleRelocationDialogClose: (event) => {
        if (!refs.relocationManager) return;
        return refs.relocationManager.handleRelocationDialogClose(event);
      },
      resetPrintPreview: (options) => {
        if (!refs.printManager) {
          throw new Error("PrintManager is not initialized");
        }
        return refs.printManager.resetPrintPreview(options);
      },
      openEventForm: ({ mode, event }) => {
        if (!refs.eventManager) return;
        return refs.eventManager.openEventForm({ mode, event });
      },
      handleUpdateEvent: async (eventId, name) => {
        if (!refs.eventManager) {
          throw new Error("EventManager is not initialized");
        }
        return await refs.eventManager.handleUpdateEvent(eventId, name);
      },
      handleAddEvent: async (name) => {
        if (!refs.eventManager) {
          throw new Error("EventManager is not initialized");
        }
        return await refs.eventManager.handleAddEvent(name);
      },
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      openScheduleForm: ({ mode, schedule }) => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.openScheduleForm({ mode, schedule });
      },
      handleUpdateSchedule: async (scheduleId, payload) => {
        if (!refs.scheduleManager) {
          throw new Error("ScheduleManager is not initialized");
        }
        return await refs.scheduleManager.handleUpdateSchedule(scheduleId, payload);
      },
      handleAddSchedule: async (payload) => {
        if (!refs.scheduleManager) {
          throw new Error("ScheduleManager is not initialized");
        }
        return await refs.scheduleManager.handleAddSchedule(payload);
      },
      syncScheduleEndMin: this.syncScheduleEndMin,
      setCalendarPickedDate: this.setCalendarPickedDate,
      shiftScheduleDialogCalendarMonth: this.shiftScheduleDialogCalendarMonth,
      saveParticipantEdits: () => {
        if (!refs.participantManager) {
          throw new Error("ParticipantManager is not initialized");
        }
        return refs.participantManager.saveParticipantEdits();
      },
      handleRelocationFormSubmit: (event) => {
        if (!refs.relocationManager) return;
        return refs.relocationManager.handleRelocationFormSubmit(event);
      },
      handleSave: async (options) => {
        if (!refs.participantManager) {
          throw new Error("ParticipantManager is not initialized");
        }
        return await refs.participantManager.handleSave(options);
      },
      handleRevertParticipants: () => {
        if (!refs.participantActionManager) {
          throw new Error("ParticipantActionManager is not initialized");
        }
        return refs.participantActionManager.handleRevertParticipants();
      },
      handleParticipantCardListClick: (event) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.handleParticipantCardListClick(event);
      },
      handleParticipantCardListKeydown: (event) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.handleParticipantCardListKeydown(event);
      },
      handleParticipantListFocus: (event) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.handleParticipantListFocus(event);
      },
      handleEditSelectedParticipant: () => {
        if (!refs.participantActionManager) {
          throw new Error("ParticipantActionManager is not initialized");
        }
        return refs.participantActionManager.handleEditSelectedParticipant();
      },
      handleCancelSelectedParticipant: () => {
        if (!refs.participantActionManager) {
          throw new Error("ParticipantActionManager is not initialized");
        }
        return refs.participantActionManager.handleCancelSelectedParticipant();
      },
      handleRelocateSelectedParticipant: () => {
        if (!refs.relocationManager) return;
        return refs.relocationManager.handleRelocateSelectedParticipant();
      },
      handleDeleteSelectedParticipant: () => {
        if (!refs.participantActionManager) {
          throw new Error("ParticipantActionManager is not initialized");
        }
        return refs.participantActionManager.handleDeleteSelectedParticipant();
      },
      handleClearParticipants: () => {
        if (!refs.participantActionManager) {
          throw new Error("ParticipantActionManager is not initialized");
        }
        return refs.participantActionManager.handleClearParticipants();
      },
      getMissingSelectionStatusMessage: () => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.getMissingSelectionStatusMessage();
      },
      getSelectionRequiredMessage: (prefix) => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.getSelectionRequiredMessage(prefix);
      },
      setUploadStatus: (message, variant) => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.setUploadStatus(message, variant);
      },
      confirmAction: (options) => {
        if (!refs.confirmDialogManager) {
          throw new Error("ConfirmDialogManager is not initialized");
        }
        return refs.confirmDialogManager.confirmAction(options);
      },
      setupConfirmDialog: () => {
        if (!refs.confirmDialogManager) {
          throw new Error("ConfirmDialogManager is not initialized");
        }
        return refs.confirmDialogManager.setupConfirmDialog();
      },
      // ログ関数
      logPrintInfo: this.logPrintInfo,
      logPrintWarn: this.logPrintWarn,
      logPrintError: this.logPrintError
    });
    
    // ParticipantContextManager を初期化
    refs.participantContextManager = new ManagerClasses.ParticipantContextManager({
      state: this.state,
      dom: this.dom,
      // 依存関数と定数
      isPlaceholderUploadStatus: () => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.isPlaceholderUploadStatus();
      },
      getMissingSelectionStatusMessage: () => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.getMissingSelectionStatusMessage();
      },
      setUploadStatus: (message, variant) => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.setUploadStatus(message, variant);
      },
      syncTemplateButtons: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncTemplateButtons();
        } else {
          return this.syncTemplateButtons();
        }
      },
      syncClearButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncClearButtonState();
        } else {
          return this.syncClearButtonState();
        }
      },
      PARTICIPANT_DESCRIPTION_DEFAULT: this.PARTICIPANT_DESCRIPTION_DEFAULT,
      FOCUS_TARGETS: this.FOCUS_TARGETS
    });
    
    // ParticipantActionManager を初期化
    refs.participantActionManager = new ManagerClasses.ParticipantActionManager({
      state: this.state,
      dom: this.dom,
      // 依存関数
      hasUnsavedChanges: () => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.hasUnsavedChanges();
      },
      confirmAction: (options) => {
        if (!refs.confirmDialogManager) {
          throw new Error("ConfirmDialogManager is not initialized");
        }
        return refs.confirmDialogManager.confirmAction(options);
      },
      setUploadStatus: (message, variant) => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.setUploadStatus(message, variant);
      },
      loadParticipants: (options) => {
        if (refs.participantManager) {
          return refs.participantManager.loadParticipants(options);
        } else {
          return this.loadParticipants(options);
        }
      },
      cloneParticipantEntry: (entry) => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.cloneParticipantEntry(entry);
      },
      captureParticipantBaseline: (entries, options) => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.captureParticipantBaseline(entries, options);
      },
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        } else {
          return this.renderParticipants();
        }
      },
      handleSave: async (options) => {
        if (refs.participantManager) {
          return await refs.participantManager.handleSave(options);
        } else {
          return await this.handleSave(options);
        }
      },
      updateDuplicateMatches: this.updateDuplicateMatches,
      getSelectedParticipantTarget: () => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.getSelectedParticipantTarget();
      },
      getSelectionRequiredMessage: (prefix) => {
        if (!refs.stateManager) {
          throw new Error("StateManager is not initialized");
        }
        return refs.stateManager.getSelectionRequiredMessage(prefix);
      },
      handleQuickCancelAction: (participantId, rowIndex, rowKey) => {
        if (!refs.participantUIManager) {
          throw new Error("ParticipantUIManager is not initialized");
        }
        return refs.participantUIManager.handleQuickCancelAction(participantId, rowIndex, rowKey);
      },
      handleDeleteParticipant: (participantId, rowIndex, rowKey) => {
        if (!refs.participantManager) {
          throw new Error("ParticipantManager is not initialized");
        }
        return refs.participantManager.handleDeleteParticipant(participantId, rowIndex, rowKey);
      },
      openParticipantEditor: (participantId, rowKey) => {
        if (!refs.participantManager) {
          throw new Error("ParticipantManager is not initialized");
        }
        return refs.participantManager.openParticipantEditor(participantId, rowKey);
      }
    });
    
    // GlManager を初期化
    refs.glManager = new ManagerClasses.GlManager({
      state: this.state,
      // 依存関数
      normalizeKey: this.normalizeKey,
      fetchDbValue: this.fetchDbValue,
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        } else {
          return this.renderParticipants();
        }
      },
      // 定数
      CANCEL_LABEL: this.CANCEL_LABEL,
      GL_STAFF_GROUP_KEY: this.GL_STAFF_GROUP_KEY,
      GL_STAFF_LABEL: this.GL_STAFF_LABEL
    });
    
    // ParticipantUIManager を初期化
    refs.participantUIManager = new ManagerClasses.ParticipantUIManager({
      state: this.state,
      dom: this.dom,
      // 依存関数
      normalizeGroupNumberValue: this.normalizeGroupNumberValue,
      getDisplayParticipantId: this.getDisplayParticipantId,
      resolveMailStatusInfo: this.resolveMailStatusInfo,
      resolveParticipantUid: this.resolveParticipantUid,
      resolveParticipantActionTarget: this.resolveParticipantActionTarget,
      updateParticipantActionPanelState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        } else {
          return this.updateParticipantActionPanelState();
        }
      },
      applyParticipantNoText: (element, index) => {
        if (!refs.uiManager) {
          throw new Error("UIManager is not initialized");
        }
        return refs.uiManager.applyParticipantNoText(element, index);
      },
      createShareUrl: this.createShareUrl,
      copyShareLink: (token) => {
        if (!refs.shareClipboardManager) {
          throw new Error("ShareClipboardManager is not initialized");
        }
        return refs.shareClipboardManager.copyShareLink(token, this.setUploadStatus);
      },
      describeDuplicateMatch: this.describeDuplicateMatch,
      diffParticipantLists: this.diffParticipantLists,
      // 定数
      CANCEL_LABEL: this.CANCEL_LABEL,
      RELOCATE_LABEL: this.RELOCATE_LABEL,
      GL_STAFF_GROUP_KEY: this.GL_STAFF_GROUP_KEY,
      GL_STAFF_LABEL: this.GL_STAFF_LABEL,
      NO_TEAM_GROUP_KEY: this.NO_TEAM_GROUP_KEY,
      MAIL_STATUS_ICON_SVG: this.MAIL_STATUS_ICON_SVG,
      CHANGE_ICON_SVG: this.CHANGE_ICON_SVG
    });
    
    // CsvManager を初期化
    refs.csvManager = new ManagerClasses.CsvManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      getSelectionIdentifiers: this.getSelectionIdentifiers,
      getSelectionRequiredMessage: (prefix) => {
        if (refs.stateManager) {
          return refs.stateManager.getSelectionRequiredMessage(prefix);
        } else {
          return this.getSelectionRequiredMessage(prefix);
        }
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        } else {
          return this.setUploadStatus(...arguments);
        }
      },
      PARTICIPANT_TEMPLATE_HEADERS: this.PARTICIPANT_TEMPLATE_HEADERS,
      TEAM_TEMPLATE_HEADERS: this.TEAM_TEMPLATE_HEADERS,
      sortParticipants: this.sortParticipants,
      resolveParticipantUid: this.resolveParticipantUid,
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        } else {
          return this.renderParticipants();
        }
      },
      updateParticipantActionPanelState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        } else {
          return this.updateParticipantActionPanelState();
        }
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        } else {
          return this.syncSaveButtonState();
        }
      },
      queueRelocationPrompt: (targets, options) => {
        if (refs.relocationManager) {
          return refs.relocationManager.queueRelocationPrompt(targets, options);
        } else {
          return this.queueRelocationPrompt(targets, options);
        }
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        } else {
          return this.captureParticipantBaseline(entries, options);
        }
      }
    });
    
    // EventManager を初期化
    refs.eventManager = new ManagerClasses.EventManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      isHostAttached: () => {
        if (!refs.hostIntegrationManager) return false;
        return refs.hostIntegrationManager.isHostAttached();
      },
      hostIntegration: null, // HostIntegrationManager に移行されたため、直接参照しない
      getHostController: () => {
        if (!refs.hostIntegrationManager) return null;
        return refs.hostIntegrationManager.getHostController();
      },
      applyHostEvents: (events, options) => {
        if (!refs.hostIntegrationManager) {
          throw new Error("HostIntegrationManager is not initialized");
        }
        return refs.hostIntegrationManager.applyHostEvents(events, options);
      },
      finalizeEventLoad: (options) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.finalizeEventLoad(options);
        } else {
          return this.finalizeEventLoad(options);
        }
      },
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        refs.scheduleManager.renderSchedules();
      },
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        } else {
          return this.renderParticipants();
        }
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        } else {
          return this.updateParticipantContext(options);
        }
      },
      loadGlDataForEvent: async (eventId, options) => {
        if (refs.glManager) {
          return await refs.glManager.loadGlDataForEvent(eventId, options);
        } else {
          return await this.loadGlDataForEvent(eventId, options);
        }
      },
      loadParticipants: (options) => {
        if (refs.participantManager) {
          return refs.participantManager.loadParticipants(options);
        } else {
          return this.loadParticipants(options);
        }
      },
      broadcastSelectionChange: (options) => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.broadcastSelectionChange(options);
        } else {
          return this.broadcastSelectionChange(options);
        }
      },
      selectSchedule: (scheduleId, options) => {
        if (refs.scheduleManager) {
          return refs.scheduleManager.selectSchedule(scheduleId, options);
        } else {
          return this.selectSchedule(scheduleId, options);
        }
      },
      setCalendarPickedDate: this.setCalendarPickedDate,
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        } else {
          return this.captureParticipantBaseline(entries, options);
        }
      },
      syncTemplateButtons: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncTemplateButtons();
        } else {
          return this.syncTemplateButtons();
        }
      },
      syncClearButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncClearButtonState();
        } else {
          return this.syncClearButtonState();
        }
      },
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        } else {
          return await this.confirmAction(options);
        }
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        } else {
          return this.setUploadStatus(...arguments);
        }
      },
      refreshScheduleLocationHistory: () => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.refreshScheduleLocationHistory();
        } else {
          return this.refreshScheduleLocationHistory();
        }
      },
      populateScheduleLocationOptions: (preferred) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.populateScheduleLocationOptions(preferred);
        } else {
          return this.populateScheduleLocationOptions(preferred);
        }
      },
      getSelectionBroadcastSource: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.getSelectionBroadcastSource();
        } else {
          return this.getSelectionBroadcastSource();
        }
      }
    });
    
    // ScheduleManager を初期化
    refs.scheduleManager = new ManagerClasses.ScheduleManager({
      dom: this.dom,
      state: this.state,
      calendarState: this.calendarState,
      // 依存関数と定数
      loadEvents: () => {
        if (!refs.eventManager) return Promise.resolve();
        return refs.eventManager.loadEvents();
      },
      selectEvent: (eventId) => {
        if (!refs.eventManager) return;
        refs.eventManager.selectEvent(eventId);
      },
      selectSchedule: (scheduleId, options) => {
        // 循環参照を避けるため、ここで直接実装を呼び出す
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.selectSchedule(scheduleId, options);
      },
      setCalendarPickedDate: this.setCalendarPickedDate,
      renderParticipants: () => {
        if (!refs.participantManager) return;
        return refs.participantManager.renderParticipants();
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        } else {
          return this.updateParticipantContext(options);
        }
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        } else {
          return this.captureParticipantBaseline(entries, options);
        }
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        } else {
          return this.syncSaveButtonState();
        }
      },
      queueRelocationPrompt: (targets, options) => {
        if (refs.relocationManager) {
          return refs.relocationManager.queueRelocationPrompt(targets, options);
        } else {
          return this.queueRelocationPrompt(targets, options);
        }
      },
      getSelectionBroadcastSource: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.getSelectionBroadcastSource();
        } else {
          return this.getSelectionBroadcastSource();
        }
      },
      populateScheduleLocationOptions: (preferred) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.populateScheduleLocationOptions(preferred);
        } else {
          return this.populateScheduleLocationOptions(preferred);
        }
      },
      prepareScheduleDialogCalendar: this.prepareScheduleDialogCalendar,
      syncScheduleEndMin: this.syncScheduleEndMin,
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        } else {
          return await this.confirmAction(options);
        }
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        } else {
          return this.setUploadStatus(...arguments);
        }
      },
      getScheduleRecord: this.getScheduleRecord,
      loadParticipants: (options) => {
        if (!refs.participantManager) return Promise.resolve();
        return refs.participantManager.loadParticipants(options);
      },
      broadcastSelectionChange: (options) => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.broadcastSelectionChange(options);
        } else {
          return this.broadcastSelectionChange(options);
        }
      },
      selectScheduleSelf: null // 後で設定
    });
    
    // 循環参照を避けるため、selectScheduleSelf を設定
    refs.scheduleManager.selectScheduleSelf = refs.scheduleManager.selectSchedule.bind(refs.scheduleManager);
    
    // ConfirmDialogManagerのセットアップ
    if (refs.confirmDialogManager) {
      refs.confirmDialogManager.setupConfirmDialog();
    }
    
    // 初期化後の処理
    if (refs.eventHandlersManager) {
      refs.eventHandlersManager.attachEventHandlers();
    } else {
      // フォールバック: グローバル関数を使用（通常は実行されない）
      this.attachEventHandlers();
    }
    if (refs.uiManager) {
      refs.uiManager.setAuthUi(Boolean(this.state.user));
    } else {
      // フォールバック: グローバル関数を使用（通常は実行されない）
      this.setAuthUi(Boolean(this.state.user));
    }
    const isEmbeddedForLoader = refs.hostIntegrationManager
      ? refs.hostIntegrationManager.isEmbeddedMode()
      : this.isEmbeddedMode();
    this.initLoaderSteps(isEmbeddedForLoader ? [] : this.STEP_LABELS);
    if (refs.stateManager) {
      refs.stateManager.resetState();
      if (refs.hostIntegrationManager) {
        refs.hostIntegrationManager.resetSelectionBroadcastSignature();
      }
      // UI更新とその他のリセット処理
      this.resetTokenState();
      if (refs.eventManager) {
        refs.eventManager.renderEvents();
      }
      if (refs.scheduleManager) {
        refs.scheduleManager.renderSchedules();
      }
      if (refs.participantManager) {
        refs.participantManager.renderParticipants();
      }
      if (refs.participantContextManager) {
        refs.participantContextManager.updateParticipantContext();
      }
      // その他のリセット処理
      if (refs.stateManager) {
        const statusMessage = refs.stateManager.getMissingSelectionStatusMessage();
        refs.stateManager.setUploadStatus(statusMessage);
      }
      if (refs.scheduleUtilityManager) {
        refs.scheduleUtilityManager.populateScheduleLocationOptions();
      }
      if (this.dom.fileLabel) this.dom.fileLabel.textContent = "参加者CSVをアップロード";
      if (this.dom.teamCsvInput) this.dom.teamCsvInput.value = "";
      if (this.dom.csvInput) this.dom.csvInput.value = "";
      if (refs.uiManager) {
        refs.uiManager.renderUserSummary(null);
      }
      if (refs.buttonStateManager) {
        refs.buttonStateManager.syncTemplateButtons();
        refs.buttonStateManager.syncSaveButtonState();
      }
      if (refs.mailManager) {
        refs.mailManager.syncMailActionState();
      }
    } else {
      // フォールバック: グローバル関数を使用（通常は実行されない）
      this.resetState();
    }
    const isEmbedded = refs.hostIntegrationManager
      ? refs.hostIntegrationManager.isEmbeddedMode()
      : this.isEmbeddedMode();
    if (isEmbedded) {
      this.showLoader("利用状態を確認しています…");
    }
    if (refs.participantContextManager) {
      refs.participantContextManager.parseInitialSelectionFromUrl();
    } else {
      // フォールバック: グローバル関数を使用（通常は実行されない）
      this.parseInitialSelectionFromUrl();
    }
    if (refs.hostIntegrationManager) {
      refs.hostIntegrationManager.startHostSelectionBridge();
    } else {
      // フォールバック: グローバル関数を使用（通常は実行されない）
      this.startHostSelectionBridge();
    }
    
    // 認証ウォッチャーの初期化
    if (refs.authManager) {
      refs.authManager.initAuthWatcher();
    } else {
      // フォールバック（初期化前の場合）
      this.initAuthWatcher();
    }
    
    // window.questionAdminEmbedの設定
    this.setupQuestionAdminEmbed();
    
    // すべてのManager初期化が完了しました
  }

  /**
   * window.questionAdminEmbed オブジェクトの設定
   */
  setupQuestionAdminEmbed() {
    if (typeof window === "undefined") {
      return;
    }
    
    const refs = this.managerRefs;
    const self = this;
    
    window.questionAdminEmbed = {
      setSelection(selection = {}) {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.applySelectionContext(selection);
        } else {
          return self.applySelectionContext(selection);
        }
      },
      refreshParticipants(options) {
        if (refs.participantManager) {
          return refs.participantManager.loadParticipants(options);
        } else {
          return self.loadParticipants(options);
        }
      },
      refreshEvents(options) {
        if (refs.eventManager) {
          return refs.eventManager.loadEvents(options);
        } else {
          return self.loadEvents(options);
        }
      },
      getState() {
        return {
          eventId: self.state.selectedEventId,
          scheduleId: self.state.selectedScheduleId
        };
      },
      waitUntilReady() {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.waitForEmbedReady();
        } else {
          return self.waitForEmbedReady();
        }
      },
      reset() {
        try {
          self.redirectingToIndexRef.current = false;
          self.state.user = null;
          self.hideLoader();
          if (refs.uiManager) {
            refs.uiManager.setAuthUi(false);
          } else {
            self.setAuthUi(false);
          }
          if (refs.stateManager) {
            refs.stateManager.resetState();
            if (refs.hostIntegrationManager) {
              refs.hostIntegrationManager.resetSelectionBroadcastSignature();
            }
            // UI更新とその他のリセット処理
            self.resetTokenState();
            if (refs.eventManager) {
              refs.eventManager.renderEvents();
            }
            if (refs.scheduleManager) {
              refs.scheduleManager.renderSchedules();
            }
            if (refs.participantManager) {
              refs.participantManager.renderParticipants();
            }
            if (refs.participantContextManager) {
              refs.participantContextManager.updateParticipantContext();
            }
            if (refs.stateManager) {
              const statusMessage = refs.stateManager.getMissingSelectionStatusMessage();
              refs.stateManager.setUploadStatus(statusMessage);
            }
            if (refs.scheduleUtilityManager) {
              refs.scheduleUtilityManager.populateScheduleLocationOptions();
            }
            if (self.dom.fileLabel) self.dom.fileLabel.textContent = "参加者CSVをアップロード";
            if (self.dom.teamCsvInput) self.dom.teamCsvInput.value = "";
            if (self.dom.csvInput) self.dom.csvInput.value = "";
            if (refs.uiManager) {
              refs.uiManager.renderUserSummary(null);
            }
            if (refs.buttonStateManager) {
              refs.buttonStateManager.syncTemplateButtons();
              refs.buttonStateManager.syncSaveButtonState();
            }
            if (refs.mailManager) {
              refs.mailManager.syncMailActionState();
            }
          } else {
            self.resetState();
          }
          if (refs.hostIntegrationManager) {
            refs.hostIntegrationManager.detachHost();
            refs.hostIntegrationManager.resetHostSelectionBridge();
            refs.hostIntegrationManager.applyHostSelectionFromDataset();
            refs.hostIntegrationManager.resetEmbedReady();
          } else {
            self.detachHost();
            self.applyHostSelectionFromDataset();
          }
          if (self.dom.loginButton) {
            self.dom.loginButton.disabled = false;
            self.dom.loginButton.classList.remove("is-busy");
          }
        } catch (error) {
          console.error("questionAdminEmbed.reset failed", error);
        }
      },
      attachHost(controller) {
        try {
          if (refs.hostIntegrationManager) {
            refs.hostIntegrationManager.attachHost(controller);
          } else {
            self.attachHost(controller);
          }
        } catch (error) {
          console.error("questionAdminEmbed.attachHost failed", error);
        }
      },
      detachHost() {
        try {
          if (refs.hostIntegrationManager) {
            refs.hostIntegrationManager.detachHost();
          } else {
            self.detachHost();
          }
        } catch (error) {
          console.error("questionAdminEmbed.detachHost failed", error);
        }
      }
    };
  }
}


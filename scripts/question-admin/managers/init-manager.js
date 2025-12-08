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
      loadGlDataForEvent: this.loadGlDataForEvent,
      normalizeKey: this.normalizeKey,
      normalizeGroupNumberValue: this.normalizeGroupNumberValue,
      NO_TEAM_GROUP_KEY: this.NO_TEAM_GROUP_KEY,
      CANCEL_LABEL: this.CANCEL_LABEL,
      RELOCATE_LABEL: this.RELOCATE_LABEL,
      GL_STAFF_GROUP_KEY: this.GL_STAFF_GROUP_KEY,
      // ボタン状態管理関数
      syncAllPrintButtonStates: this.syncAllPrintButtonStates,
      setPrintButtonBusy: this.setPrintButtonBusy,
      setStaffPrintButtonBusy: this.setStaffPrintButtonBusy
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
      isEmbeddedMode: this.isEmbeddedMode,
      UPLOAD_STATUS_PLACEHOLDERS: this.UPLOAD_STATUS_PLACEHOLDERS
    });

    // UIManager を初期化
    refs.uiManager = new ManagerClasses.UIManager({
      state: this.state,
      dom: this.dom,
      // 依存関数と定数
      getEmbedPrefix: this.getEmbedPrefix,
      isEmbeddedMode: this.isEmbeddedMode,
      updateParticipantActionPanelState: this.updateParticipantActionPanelState,
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
      renderEvents: this.renderEvents,
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      updateParticipantContext: this.updateParticipantContext
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
      syncAllPrintButtonStates: this.syncAllPrintButtonStates,
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
      setUploadStatus: this.setUploadStatus,
      getSelectionRequiredMessage: this.getSelectionRequiredMessage,
      renderParticipants: this.renderParticipants,
      hasUnsavedChanges: this.hasUnsavedChanges,
      captureParticipantBaseline: this.captureParticipantBaseline,
      setActionButtonState: this.setActionButtonState,
      confirmAction: this.confirmAction
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
      setAuthUi: this.setAuthUi,
      setLoginError: this.setLoginError,
      showLoader: this.showLoader,
      hideLoader: this.hideLoader,
      initLoaderSteps: this.initLoaderSteps,
      setLoaderStep: this.setLoaderStep,
      finishLoaderSteps: this.finishLoaderSteps,
      resetState: this.resetState,
      renderUserSummary: this.renderUserSummary,
      isEmbeddedMode: this.isEmbeddedMode,
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
      drainQuestionQueue: this.drainQuestionQueue,
      resolveEmbedReady: this.resolveEmbedReady,
      maybeFocusInitialSection: this.maybeFocusInitialSection,
      sleep: this.sleep,
      setUploadStatus: this.setUploadStatus,
      redirectingToIndexRef: this.redirectingToIndexRef
    });
    
    // ParticipantManager を初期化
    refs.participantManager = new ManagerClasses.ParticipantManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      readHostSelectionDataset: this.readHostSelectionDataset,
      getHostSelectionElement: this.getHostSelectionElement,
      loadGlDataForEvent: this.loadGlDataForEvent,
      renderEvents: this.renderEvents,
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      updateParticipantContext: this.updateParticipantContext,
      captureParticipantBaseline: this.captureParticipantBaseline,
      syncSaveButtonState: this.syncSaveButtonState,
      syncMailActionState: () => {
        if (!refs.mailManager) return;
        return refs.mailManager.syncMailActionState();
      },
      syncAllPrintButtonStates: this.syncAllPrintButtonStates,
      syncClearButtonState: this.syncClearButtonState,
      syncTemplateButtons: this.syncTemplateButtons,
      syncSelectedEventSummary: this.syncSelectedEventSummary,
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
      applyParticipantSelectionStyles: this.applyParticipantSelectionStyles,
      updateParticipantActionPanelState: this.updateParticipantActionPanelState,
      emitParticipantSyncEvent: this.emitParticipantSyncEvent,
      describeScheduleRange: this.describeScheduleRange,
      ensureTokenSnapshot: this.ensureTokenSnapshot,
      generateQuestionToken: this.generateQuestionToken,
      setUploadStatus: this.setUploadStatus,
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
      hasUnsavedChanges: this.hasUnsavedChanges,
      confirmAction: this.confirmAction,
      setFormError: this.setFormError,
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      RELOCATE_LABEL: this.RELOCATE_LABEL,
      // handleSave に必要な依存関係
      getScheduleRecord: this.getScheduleRecord,
      loadEvents: this.loadEvents
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
      syncSaveButtonState: this.syncSaveButtonState,
      setUploadStatus: this.setUploadStatus,
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
      selectEvent: this.selectEvent,
      loadEvents: this.loadEvents,
      finalizeEventLoad: this.finalizeEventLoad,
      updateParticipantContext: this.updateParticipantContext,
      HOST_SELECTION_ATTRIBUTE_KEYS: this.HOST_SELECTION_ATTRIBUTE_KEYS,
      // 一時的な依存関数（後で移行予定）
      selectSchedule: (scheduleId, options) => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.selectSchedule(scheduleId, options);
      },
      refreshScheduleLocationHistory: this.refreshScheduleLocationHistory,
      populateScheduleLocationOptions: this.populateScheduleLocationOptions,
      hostSelectionSignature: this.hostSelectionSignature,
      stopHostSelectionBridge: this.stopHostSelectionBridge,
      startHostSelectionBridge: this.startHostSelectionBridge
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
      syncTemplateButtons: this.syncTemplateButtons,
      syncClearButtonState: this.syncClearButtonState,
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
      loadParticipants: this.loadParticipants,
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
      renderParticipants: this.renderParticipants,
      handleSave: this.handleSave,
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
      renderParticipants: this.renderParticipants,
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
      updateParticipantActionPanelState: this.updateParticipantActionPanelState,
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
      getSelectionRequiredMessage: this.getSelectionRequiredMessage,
      setUploadStatus: this.setUploadStatus,
      PARTICIPANT_TEMPLATE_HEADERS: this.PARTICIPANT_TEMPLATE_HEADERS,
      TEAM_TEMPLATE_HEADERS: this.TEAM_TEMPLATE_HEADERS,
      sortParticipants: this.sortParticipants,
      resolveParticipantUid: this.resolveParticipantUid,
      renderParticipants: this.renderParticipants,
      updateParticipantActionPanelState: this.updateParticipantActionPanelState,
      syncSaveButtonState: this.syncSaveButtonState,
      queueRelocationPrompt: this.queueRelocationPrompt,
      captureParticipantBaseline: this.captureParticipantBaseline
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
      finalizeEventLoad: this.finalizeEventLoad,
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        refs.scheduleManager.renderSchedules();
      },
      renderParticipants: this.renderParticipants,
      updateParticipantContext: this.updateParticipantContext,
      loadGlDataForEvent: this.loadGlDataForEvent,
      loadParticipants: this.loadParticipants,
      broadcastSelectionChange: this.broadcastSelectionChange,
      selectSchedule: this.selectSchedule,
      setCalendarPickedDate: this.setCalendarPickedDate,
      captureParticipantBaseline: this.captureParticipantBaseline,
      syncTemplateButtons: this.syncTemplateButtons,
      syncClearButtonState: this.syncClearButtonState,
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      confirmAction: this.confirmAction,
      setUploadStatus: this.setUploadStatus,
      refreshScheduleLocationHistory: this.refreshScheduleLocationHistory,
      populateScheduleLocationOptions: this.populateScheduleLocationOptions,
      getSelectionBroadcastSource: this.getSelectionBroadcastSource
    });
    
    // ConfirmDialogManagerのセットアップ
    if (refs.confirmDialogManager) {
      refs.confirmDialogManager.setupConfirmDialog();
    }
    
    // 初期化後の処理
    this.attachEventHandlers();
    this.setAuthUi(Boolean(this.state.user));
    this.initLoaderSteps(this.isEmbeddedMode() ? [] : this.STEP_LABELS);
    this.resetState();
    if (this.isEmbeddedMode()) {
      this.showLoader("利用状態を確認しています…");
    }
    this.parseInitialSelectionFromUrl();
    this.startHostSelectionBridge();
    
    // 認証ウォッチャーの初期化
    if (refs.authManager) {
      refs.authManager.initAuthWatcher();
    } else {
      // フォールバック（初期化前の場合）
      this.initAuthWatcher();
    }
    
    // window.questionAdminEmbedの設定
    this.setupQuestionAdminEmbed();
    
    // 以降のManager初期化は次の段階で実装します
    // このファイルは非常に大きくなるため、段階的に移行します
    // TODO: 残りのManagerの初期化を段階的に移行
  }

  /**
   * window.questionAdminEmbed オブジェクトの設定
   */
  setupQuestionAdminEmbed() {
    if (typeof window === "undefined") {
      return;
    }
    
    const refs = this.managerRefs;
    
    window.questionAdminEmbed = {
      setSelection(selection = {}) {
        return this.applySelectionContext(selection);
      },
      refreshParticipants(options) {
        return this.loadParticipants(options);
      },
      refreshEvents(options) {
        return this.loadEvents(options);
      },
      getState() {
        return {
          eventId: this.state.selectedEventId,
          scheduleId: this.state.selectedScheduleId
        };
      },
      waitUntilReady() {
        return this.waitForEmbedReady();
      },
      reset() {
        try {
          this.redirectingToIndexRef.current = false;
          this.state.user = null;
          this.hideLoader();
          this.setAuthUi(false);
          this.resetState();
          this.detachHost();
          if (refs.hostIntegrationManager) {
            refs.hostIntegrationManager.resetHostSelectionBridge();
            this.applyHostSelectionFromDataset();
            refs.hostIntegrationManager.resetEmbedReady();
          } else {
            // フォールバック（初期化前の場合）
            // hostSelectionBridge.lastSignature = "";
            // hostSelectionBridge.pendingSignature = "";
            this.applyHostSelectionFromDataset();
            // if (embedReadyDeferred?.resolve) {
            //   embedReadyDeferred.resolve();
            // }
            // embedReadyDeferred = null;
          }
          if (this.dom.loginButton) {
            this.dom.loginButton.disabled = false;
            this.dom.loginButton.classList.remove("is-busy");
          }
        } catch (error) {
          console.error("questionAdminEmbed.reset failed", error);
        }
      },
      attachHost(controller) {
        try {
          this.attachHost(controller);
        } catch (error) {
          console.error("questionAdminEmbed.attachHost failed", error);
        }
      },
      detachHost() {
        try {
          this.detachHost();
        } catch (error) {
          console.error("questionAdminEmbed.detachHost failed", error);
        }
      }
    };
  }
}


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
    
    // 以降のManager初期化は次の段階で実装します
    // このファイルは非常に大きくなるため、段階的に移行します
    // TODO: すべてのManagerの初期化を段階的に移行
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


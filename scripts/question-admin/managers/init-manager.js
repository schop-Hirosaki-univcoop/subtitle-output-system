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
    this.resetTokenState = context.resetTokenState;
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
    this.logPrintInfo = context.logPrintInfo;
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
      getParticipantGroupKey: (entry) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.getParticipantGroupKey(entry);
        }
        // ParticipantUIManager が初期化されていない場合は NO_TEAM_GROUP_KEY を返す
        return this.NO_TEAM_GROUP_KEY;
      },
      describeParticipantGroup: (groupKey) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.describeParticipantGroup(groupKey);
        }
        // ParticipantUIManager が初期化されていない場合はデフォルト値を返す
        return { label: "班番号", value: "未設定" };
      },
      collectGroupGlLeaders: (groupKey, options) => {
        if (refs.glManager) {
          return refs.glManager.collectGroupGlLeaders(groupKey, options);
        }
        // GlManager が初期化されていない場合は空配列を返す
        return [];
      },
      getEventGlRoster: (eventId) => {
        if (refs.glManager) {
          return refs.glManager.getEventGlRoster(eventId);
        }
        // GlManager が初期化されていない場合は空の Map を返す
        return new Map();
      },
      getEventGlAssignmentsMap: (eventId) => {
        if (refs.glManager) {
          return refs.glManager.getEventGlAssignmentsMap(eventId);
        }
        // GlManager が初期化されていない場合は空の Map を返す
        return new Map();
      },
      resolveScheduleAssignment: (entry, scheduleId) => {
        if (refs.glManager) {
          return refs.glManager.resolveScheduleAssignment(entry, scheduleId);
        }
        // GlManager が初期化されていない場合は null を返す
        return null;
      },
      loadGlDataForEvent: async (eventId, options) => {
        if (refs.glManager) {
          return await refs.glManager.loadGlDataForEvent(eventId, options);
        }
        // GlManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
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
        }
        // ButtonStateManager が初期化されていない場合は何もしない
        // PrintManager の初期化中に呼び出される可能性は低いが、安全のため
      },
      setPrintButtonBusy: (isBusy) => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.setPrintButtonBusy(isBusy);
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      setStaffPrintButtonBusy: (isBusy) => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.setStaffPrintButtonBusy(isBusy);
        }
        // ButtonStateManager が初期化されていない場合は何もしない
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
        }
        // HostIntegrationManager が初期化されていない場合は false を返す
        return false;
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
        }
        // HostIntegrationManager が初期化されていない場合は空文字列を返す
        return "";
      },
      isEmbeddedMode: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.isEmbeddedMode();
        }
        // HostIntegrationManager が初期化されていない場合は false を返す
        return false;
      },
      updateParticipantActionPanelState: () => {
        // ButtonStateManager が初期化された後に呼び出されるため、refs を使用
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
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
        }
        // EventManager が初期化されていない場合は何もしない
      },
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        }
        // ParticipantContextManager が初期化されていない場合は何もしない
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
        // ButtonStateManager 自身のメソッドを呼び出す
        // 初期化中に呼び出される可能性があるため、refs.buttonStateManager が存在する場合はそれを呼び出す
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncAllPrintButtonStates();
        }
        // 初期化前の場合は何もしない（初期化後に _syncAllPrintButtonStates が更新される）
        // これにより、初期化中に呼び出されてもエラーが発生しない
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
        if (refs.participantUIManager) {
          return refs.participantUIManager.getSelectedParticipantTarget();
        }
        // ParticipantUIManager が初期化されていない場合は null を返す
        // ButtonStateManager の初期化時点では ParticipantUIManager はまだ初期化されていないため
        return null;
      },
      formatParticipantIdentifier: (entry) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.formatParticipantIdentifier(entry);
        }
        // ParticipantUIManager が初期化されていない場合は空文字列を返す
        // ButtonStateManager の初期化時点では ParticipantUIManager はまだ初期化されていないため
        return "";
      },
      // イベントサマリー関連の依存関数
      getScheduleLabel: this.getScheduleLabel,
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      renderEvents: this.renderEvents
    });
    
    // ButtonStateManager 初期化後に _syncAllPrintButtonStates を更新
    if (refs.buttonStateManager) {
      refs.buttonStateManager._syncAllPrintButtonStates = () => {
        return refs.buttonStateManager.syncAllPrintButtonStates();
      };
    }
    
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
        }
        // StateManager が初期化されていない場合は何もしない
      },
      getSelectionRequiredMessage: (prefix) => {
        if (refs.stateManager) {
          return refs.stateManager.getSelectionRequiredMessage(prefix);
        }
        // StateManager が初期化されていない場合は空文字列を返す
        return "";
      },
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        }
        // ParticipantManager が初期化されていない場合は何もしない
      },
      hasUnsavedChanges: () => {
        if (refs.stateManager) {
          return refs.stateManager.hasUnsavedChanges();
        }
        // StateManager が初期化されていない場合は false を返す
        return false;
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      setActionButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.setActionButtonState(...arguments);
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        }
        // ConfirmDialogManager が初期化されていない場合は false を返す
        return false;
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
        }
        // UIManager が初期化されていない場合は何もしない
      },
      setLoginError: (message) => {
        if (refs.uiManager) {
          return refs.uiManager.setLoginError(message);
        }
        // UIManager が初期化されていない場合は何もしない
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
        }
        // UIManager が初期化されていない場合は何もしない
      },
      isEmbeddedMode: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.isEmbeddedMode();
        }
        // HostIntegrationManager が初期化されていない場合は false を返す
        return false;
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
        }
        // TokenApiManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
      },
      resolveEmbedReady: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.resolveEmbedReady();
        }
        // HostIntegrationManager が初期化されていない場合は何もしない
      },
      maybeFocusInitialSection: () => {
        if (refs.uiManager) {
          return refs.uiManager.maybeFocusInitialSection();
        }
        // UIManager が初期化されていない場合は何もしない
      },
      sleep: this.sleep,
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        }
        // StateManager が初期化されていない場合は何もしない
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
        }
        // HostIntegrationManager が初期化されていない場合は null を返す
        return null;
      },
      getHostSelectionElement: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.getHostSelectionElement();
        }
        // HostIntegrationManager が初期化されていない場合は null を返す
        return null;
      },
      loadGlDataForEvent: async (eventId, options) => {
        if (refs.glManager) {
          return await refs.glManager.loadGlDataForEvent(eventId, options);
        }
        // GlManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
      },
      renderEvents: () => {
        if (refs.eventManager) {
          return refs.eventManager.renderEvents();
        }
        // EventManager が初期化されていない場合は何もしない
      },
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        return refs.scheduleManager.renderSchedules();
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        }
        // ParticipantContextManager が初期化されていない場合は何もしない
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      syncMailActionState: () => {
        if (!refs.mailManager) return;
        return refs.mailManager.syncMailActionState();
      },
      syncAllPrintButtonStates: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncAllPrintButtonStates();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      syncClearButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncClearButtonState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      syncTemplateButtons: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncTemplateButtons();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      syncSelectedEventSummary: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSelectedEventSummary();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      renderParticipantChangePreview: (diff, changeInfoByKey, participants) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.renderParticipantChangePreview(diff, changeInfoByKey, participants);
        }
        // ParticipantUIManager が初期化されていない場合は何もしない
        // MailManager の初期化時点では ParticipantUIManager はまだ初期化されていないため
      },
      renderRelocationPrompt: () => {
        if (!refs.relocationManager) return;
        return refs.relocationManager.renderRelocationPrompt();
      },
      applyParticipantSelectionStyles: (options) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.applyParticipantSelectionStyles(options);
        }
        // ParticipantUIManager が初期化されていない場合は何もしない
      },
      updateParticipantActionPanelState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      emitParticipantSyncEvent: (detail) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.emitParticipantSyncEvent(detail);
        }
        // ParticipantContextManager が初期化されていない場合は何もしない
      },
      describeScheduleRange: this.describeScheduleRange,
      ensureTokenSnapshot: async (force) => {
        if (refs.tokenApiManager) {
          return await refs.tokenApiManager.ensureTokenSnapshot(force);
        }
        // TokenApiManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
      },
      generateQuestionToken: (existingTokens) => {
        if (refs.tokenApiManager) {
          return refs.tokenApiManager.generateQuestionToken(existingTokens);
        }
        // TokenApiManager が初期化されていない場合は null を返す
        return null;
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      // renderParticipants に必要な依存関係
      buildParticipantCard: (entry, index, options) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.buildParticipantCard(entry, index, options);
        }
        // ParticipantUIManager が初期化されていない場合は null を返す
        // ParticipantManager の初期化時点では ParticipantUIManager はまだ初期化されていないため
        return null;
      },
      getParticipantGroupKey: (entry) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.getParticipantGroupKey(entry);
        }
        // ParticipantUIManager が初期化されていない場合は NO_TEAM_GROUP_KEY を返す
        return this.NO_TEAM_GROUP_KEY;
      },
      createParticipantGroupElements: (groupKey) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.createParticipantGroupElements(groupKey);
        }
        // ParticipantUIManager が初期化されていない場合は null を返す
        return null;
      },
      getEventGlRoster: (eventId) => {
        if (refs.glManager) {
          return refs.glManager.getEventGlRoster(eventId);
        }
        // GlManager が初期化されていない場合は空の Map を返す
        return new Map();
      },
      getEventGlAssignmentsMap: (eventId) => {
        if (refs.glManager) {
          return refs.glManager.getEventGlAssignmentsMap(eventId);
        }
        // GlManager が初期化されていない場合は空の Map を返す
        return new Map();
      },
      resolveScheduleAssignment: (entry, scheduleId) => {
        if (refs.glManager) {
          return refs.glManager.resolveScheduleAssignment(entry, scheduleId);
        }
        // GlManager が初期化されていない場合は null を返す
        return null;
      },
      renderGroupGlAssignments: (group, context) => {
        if (refs.glManager) {
          return refs.glManager.renderGroupGlAssignments(group, context);
        }
        // GlManager が初期化されていない場合は何もしない
      },
      clearParticipantSelection: (options) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.clearParticipantSelection(options);
        }
        // ParticipantUIManager が初期化されていない場合は何もしない
      },
      participantChangeKey: (entry, fallbackIndex) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.participantChangeKey(entry, fallbackIndex);
        }
        // ParticipantUIManager が初期化されていない場合は fallbackIndex を返す
        return fallbackIndex != null ? String(fallbackIndex) : "";
      },
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
        }
        // StateManager が初期化されていない場合は false を返す
        return false;
      },
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        }
        // ConfirmDialogManager が初期化されていない場合は false を返す
        return false;
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
        }
        // EventManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
      }
    });
    
    // RelocationManager を初期化
    refs.relocationManager = new ManagerClasses.RelocationManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      RELOCATE_LABEL: this.RELOCATE_LABEL,
      resolveParticipantActionTarget: (options) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.resolveParticipantActionTarget(options);
        }
        // ParticipantUIManager が初期化されていない場合は null を返す
        // RelocationManager の初期化時点では ParticipantUIManager はまだ初期化されていないため
        return null;
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
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      formatParticipantIdentifier: (entry) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.formatParticipantIdentifier(entry);
        }
        // ParticipantUIManager が初期化されていない場合は空文字列を返す
        return "";
      },
      commitParticipantQuickEdit: (index, updated, options) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.commitParticipantQuickEdit(index, updated, options);
        }
        // ParticipantUIManager が初期化されていない場合は Promise.resolve() を返す
        // RelocationManager の初期化時点では ParticipantUIManager はまだ初期化されていないため
        return Promise.resolve();
      },
      getScheduleRecord: this.getScheduleRecord,
      ensureRowKey: this.ensureRowKey,
      ensureTeamAssignmentMap: this.ensureTeamAssignmentMap,
      findParticipantForSnapshot: this.findParticipantForSnapshot
    });
    
    // RelocationManager 初期化後に ParticipantUIManager の relocationManager を更新
    if (refs.participantUIManager && refs.relocationManager) {
      refs.participantUIManager.relocationManager = refs.relocationManager;
    }
    
    // HostIntegrationManager を初期化
    refs.hostIntegrationManager = new ManagerClasses.HostIntegrationManager({
      dom: this.dom,
      state: this.state,
      // 依存関数と定数
      normalizeKey: this.normalizeKey,
      selectEvent: (eventId, options) => {
        if (refs.eventManager) {
          return refs.eventManager.selectEvent(eventId, options);
        }
        // EventManager が初期化されていない場合は何もしない
      },
      loadEvents: (options) => {
        if (refs.eventManager) {
          return refs.eventManager.loadEvents(options);
        }
        // EventManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
      },
      finalizeEventLoad: (options) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.finalizeEventLoad(options);
        }
        // ScheduleUtilityManager が初期化されていない場合は何もしない
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        }
        // ParticipantContextManager が初期化されていない場合は何もしない
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
        }
        // ScheduleUtilityManager が初期化されていない場合は何もしない
      },
      populateScheduleLocationOptions: (preferred) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.populateScheduleLocationOptions(preferred);
        }
        // ScheduleUtilityManager が初期化されていない場合は何もしない
      },
      hostSelectionSignature: (selection) => {
        // HostIntegrationManager 自身のメソッドを呼び出す
        // 初期化中に呼び出される可能性があるため、refs.hostIntegrationManager が存在する場合はそれを呼び出す
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.hostSelectionSignature(selection);
        }
        // 初期化前の場合は何もしない（初期化後に更新される）
      },
      stopHostSelectionBridge: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.stopHostSelectionBridge();
        }
        // HostIntegrationManager が初期化されていない場合は何もしない
      },
      startHostSelectionBridge: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.startHostSelectionBridge();
        }
        // HostIntegrationManager が初期化されていない場合は何もしない
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
      openDialog: this.openDialog,
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
      addParticipant: (formData) => {
        if (!refs.participantManager) {
          throw new Error("ParticipantManager is not initialized");
        }
        return refs.participantManager.addParticipant(formData);
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
        const getSelectedParticipantTarget = () => {
          if (!refs.participantUIManager) {
            throw new Error("ParticipantUIManager is not initialized");
          }
          return refs.participantUIManager.getSelectedParticipantTarget();
        };
        return refs.relocationManager.handleRelocateSelectedParticipant(getSelectedParticipantTarget);
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
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      syncClearButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncClearButtonState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
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
        }
        // ParticipantManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
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
        }
        // ParticipantManager が初期化されていない場合は何もしない
      },
      handleSave: async (options) => {
        if (refs.participantManager) {
          return await refs.participantManager.handleSave(options);
        }
        // ParticipantManager が初期化されていない場合は Promise.resolve() を返す
        // ParticipantUIManager の初期化時点では ParticipantManager は既に初期化されているため、通常は実行されない
        return Promise.resolve();
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
        }
        // ParticipantManager が初期化されていない場合は何もしない
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
      resolveParticipantActionTarget: (options) => {
        if (refs.participantUIManager) {
          return refs.participantUIManager.resolveParticipantActionTarget(options);
        }
        // ParticipantUIManager が初期化されていない場合は null を返す
        return null;
      },
      updateParticipantActionPanelState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      applyParticipantNoText: (element, index) => {
        if (!refs.uiManager) {
          throw new Error("UIManager is not initialized");
        }
        return refs.uiManager.applyParticipantNoText(element, index);
      },
      createShareUrl: (token) => {
        if (refs.shareClipboardManager) {
          return refs.shareClipboardManager.createShareUrl(token);
        }
        // ShareClipboardManager が初期化されていない場合は空文字列を返す
        return "";
      },
      copyShareLink: (token) => {
        if (!refs.shareClipboardManager) {
          throw new Error("ShareClipboardManager is not initialized");
        }
        return refs.shareClipboardManager.copyShareLink(token, this.setUploadStatus);
      },
      hasUnsavedChanges: () => {
        if (refs.stateManager) {
          return refs.stateManager.hasUnsavedChanges();
        }
        // StateManager が初期化されていない場合は false を返す
        return false;
      },
      relocationManager: refs.relocationManager || null,
      describeDuplicateMatch: this.describeDuplicateMatch,
      diffParticipantLists: this.diffParticipantLists,
      sortParticipants: this.sortParticipants,
      ensureRowKey: this.ensureRowKey,
      resolveParticipantStatus: this.resolveParticipantStatus,
      ensureTeamAssignmentMap: this.ensureTeamAssignmentMap,
      applyAssignmentsToEventCache: this.applyAssignmentsToEventCache,
      syncCurrentScheduleCache: this.syncCurrentScheduleCache,
      updateDuplicateMatches: this.updateDuplicateMatches,
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        }
        // ParticipantManager が初期化されていない場合は何もしない
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        }
        // StateManager が初期化されていない場合は何もしない
      },
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
      getSelectionIdentifiers: () => {
        if (refs.shareClipboardManager) {
          return refs.shareClipboardManager.getSelectionIdentifiers();
        }
        // ShareClipboardManager が初期化されていない場合は空のオブジェクトを返す
        return { eventId: "", scheduleId: "" };
      },
      getSelectionRequiredMessage: (prefix) => {
        if (refs.stateManager) {
          return refs.stateManager.getSelectionRequiredMessage(prefix);
        }
        // StateManager が初期化されていない場合は空文字列を返す
        return "";
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      PARTICIPANT_TEMPLATE_HEADERS: this.PARTICIPANT_TEMPLATE_HEADERS,
      TEAM_TEMPLATE_HEADERS: this.TEAM_TEMPLATE_HEADERS,
      sortParticipants: this.sortParticipants,
      resolveParticipantUid: this.resolveParticipantUid,
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        }
        // ParticipantManager が初期化されていない場合は何もしない
      },
      updateParticipantActionPanelState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.updateParticipantActionPanelState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      queueRelocationPrompt: (targets, options) => {
        if (refs.relocationManager) {
          return refs.relocationManager.queueRelocationPrompt(targets, options);
        }
        // RelocationManager が初期化されていない場合は何もしない
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        }
        // StateManager が初期化されていない場合は何もしない
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
        }
        // ScheduleUtilityManager が初期化されていない場合は何もしない
      },
      renderSchedules: () => {
        if (!refs.scheduleManager) return;
        refs.scheduleManager.renderSchedules();
      },
      renderParticipants: () => {
        if (refs.participantManager) {
          return refs.participantManager.renderParticipants();
        }
        // ParticipantManager が初期化されていない場合は何もしない
      },
      updateParticipantContext: (options) => {
        if (refs.participantContextManager) {
          return refs.participantContextManager.updateParticipantContext(options);
        }
        // ParticipantContextManager が初期化されていない場合は何もしない
      },
      loadGlDataForEvent: async (eventId, options) => {
        if (refs.glManager) {
          return await refs.glManager.loadGlDataForEvent(eventId, options);
        }
        // GlManager が初期化されていない場合は Promise.resolve() を返す
        // EventManager の初期化時点では GlManager は既に初期化されているため、通常は実行されない
        return Promise.resolve();
      },
      loadParticipants: (options) => {
        if (refs.participantManager) {
          return refs.participantManager.loadParticipants(options);
        }
        // ParticipantManager が初期化されていない場合は Promise.resolve() を返す
        return Promise.resolve();
      },
      broadcastSelectionChange: (options) => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.broadcastSelectionChange(options);
        }
        // HostIntegrationManager が初期化されていない場合は何もしない
      },
      selectSchedule: (scheduleId, options) => {
        if (refs.scheduleManager) {
          return refs.scheduleManager.selectSchedule(scheduleId, options);
        }
        // ScheduleManager が初期化されていない場合は何もしない
      },
      setCalendarPickedDate: this.setCalendarPickedDate,
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      syncTemplateButtons: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncTemplateButtons();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      syncClearButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncClearButtonState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        }
        // ConfirmDialogManager が初期化されていない場合は false を返す
        return false;
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      refreshScheduleLocationHistory: () => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.refreshScheduleLocationHistory();
        }
        // ScheduleUtilityManager が初期化されていない場合は何もしない
      },
      populateScheduleLocationOptions: (preferred) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.populateScheduleLocationOptions(preferred);
        }
        // ScheduleUtilityManager が初期化されていない場合は何もしない
      },
      getSelectionBroadcastSource: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.getSelectionBroadcastSource();
        }
        // HostIntegrationManager が初期化されていない場合は null を返す
        return null;
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
        }
        // ParticipantContextManager が初期化されていない場合は何もしない
      },
      captureParticipantBaseline: (entries, options) => {
        if (refs.stateManager) {
          return refs.stateManager.captureParticipantBaseline(entries, options);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      syncSaveButtonState: () => {
        if (refs.buttonStateManager) {
          return refs.buttonStateManager.syncSaveButtonState();
        }
        // ButtonStateManager が初期化されていない場合は何もしない
      },
      queueRelocationPrompt: (targets, options) => {
        if (refs.relocationManager) {
          return refs.relocationManager.queueRelocationPrompt(targets, options);
        }
        // RelocationManager が初期化されていない場合は何もしない
      },
      getSelectionBroadcastSource: () => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.getSelectionBroadcastSource();
        }
        // HostIntegrationManager が初期化されていない場合は null を返す
        return null;
      },
      populateScheduleLocationOptions: (preferred) => {
        if (refs.scheduleUtilityManager) {
          return refs.scheduleUtilityManager.populateScheduleLocationOptions(preferred);
        }
        // ScheduleUtilityManager が初期化されていない場合は何もしない
      },
      prepareScheduleDialogCalendar: this.prepareScheduleDialogCalendar,
      syncScheduleEndMin: this.syncScheduleEndMin,
      openDialog: this.openDialog,
      closeDialog: this.closeDialog,
      setFormError: this.setFormError,
      confirmAction: async (options) => {
        if (refs.confirmDialogManager) {
          return await refs.confirmDialogManager.confirmAction(options);
        }
        // ConfirmDialogManager が初期化されていない場合は false を返す
        return false;
      },
      setUploadStatus: () => {
        if (refs.stateManager) {
          return refs.stateManager.setUploadStatus(...arguments);
        }
        // StateManager が初期化されていない場合は何もしない
      },
      getScheduleRecord: this.getScheduleRecord,
      loadParticipants: (options) => {
        if (!refs.participantManager) return Promise.resolve();
        return refs.participantManager.loadParticipants(options);
      },
      broadcastSelectionChange: (options) => {
        if (refs.hostIntegrationManager) {
          return refs.hostIntegrationManager.broadcastSelectionChange(options);
        }
        // HostIntegrationManager が初期化されていない場合は何もしない
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


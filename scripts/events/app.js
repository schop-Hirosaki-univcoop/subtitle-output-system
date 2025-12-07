// app.js: イベント管理フローの中核ロジックを担い、Firebaseとの同期と画面遷移制御をまとめます。
// イベント管理と日程管理の機能は event-panel.js と schedule-panel.js に分離されています。
import { queryDom } from "./dom.js";
import {
  database,
  ref,
  get,
  set,
  update,
  remove,
  auth,
  signOut,
  signInWithCredential,
  onAuthStateChanged,
  GoogleAuthProvider,
  serverTimestamp,
  getOperatorScheduleConsensusRef,
  onValue,
  runTransaction
} from "../operator/firebase.js";
import { createApiClient } from "../operator/api-client.js";
import { generateShortId, normalizeKey, toMillis } from "../question-admin/utils.js";
import { formatRelative, formatScheduleRange } from "../operator/utils.js";
import { LoadingTracker } from "./loading-tracker.js";
import {
  ensureString,
  formatDateTimeLocal,
  logError,
  collectParticipantTokens
} from "./helpers.js";
import {
  createScheduleDialogCalendarController,
  normalizeDateInputValue
} from "./schedule-calendar.js";
import {
  OPERATOR_MODE_TELOP,
  OPERATOR_MODE_SUPPORT,
  normalizeOperatorMode,
  isTelopMode
} from "../shared/operator-modes.js";
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { goToLogin } from "../shared/routes.js";
import {
  STAGE_SEQUENCE,
  STAGE_INFO,
  PANEL_CONFIG,
  PANEL_STAGE_INFO,
  FOCUSABLE_SELECTOR
} from "./config.js";
import { ToolCoordinator } from "./tool-coordinator.js";
import { EventChat } from "./panels/chat-panel.js";
import { EventPanelManager } from "./panels/event-panel.js";
import { SchedulePanelManager } from "./panels/schedule-panel.js";
import { EventAuthManager } from "./managers/auth-manager.js";
import { EventStateManager } from "./managers/state-manager.js";
import { EventNavigationManager } from "./managers/navigation-manager.js";
import { EventUIRenderer } from "./managers/ui-renderer.js";
import { EventFirebaseManager } from "./managers/firebase-manager.js";
import { DisplayLockManager } from "./managers/display-lock-manager.js";
// consumeAuthTransfer, loadAuthPreflightContext, preflightContextMatchesUser は EventAuthManager に移行されました
import { appendAuthDebugLog, replayAuthDebugLog } from "../shared/auth-debug-log.js";
import {
  DEFAULT_PRINT_SETTINGS,
  PRINT_SETTING_STORAGE_KEY,
  normalizePrintSettings,
  buildEventSelectionPrintHtml,
  logPrintInfo,
  logPrintWarn
} from "../shared/print-utils.js";
import {
  DEFAULT_PREVIEW_NOTE,
  DEFAULT_LOAD_TIMEOUT_MS,
  createPrintPreviewController
} from "../shared/print-preview.js";

const PENDING_NAVIGATION_CLEAR_DELAY_MS = 5_000;
const AUTH_RESUME_FALLBACK_DELAY_MS = 4_000;
/**
 * setTimeout/clearTimeout を持つホストオブジェクトを検出します。
 * ブラウザ/Nodeの両環境で安全にタイマーを利用するためのフォールバックです。
 * @returns {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }}
 */
function getTimerHost() {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    return window;
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.setTimeout === "function") {
    return globalThis;
  }
  return {
    setTimeout,
    clearTimeout
  };
}

/**
 * CSSスタイル値を数値のピクセル値に変換します。
 * パースできない場合は 0 を返し、例外を発生させません。
 * @param {unknown} value
 * @returns {number}
 */
function parseCssPixels(value) {
  if (typeof value !== "string") {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractTimePart(value) {
  const text = ensureString(value).trim();
  if (!text) {
    return "";
  }
  const match = text.match(/(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

/**
 * イベント管理画面全体を統括するアプリケーションクラスです。
 * Firebaseの認証・Realtime Database・埋め込みツールを連携し
 * 画面遷移、選択状態の同期、各種トースト/ダイアログ制御を提供します。
 */
export class EventAdminApp {
  constructor() {
    this.dom = queryDom();
    this.scheduleCalendar = createScheduleDialogCalendarController(this.dom);
    this.api = createApiClient(auth, onAuthStateChanged);
    this.auth = auth; // Firebase auth サービスをインスタンスにアタッチ（後方互換性のため保持）
    this.authUnsubscribe = null; // EventAuthManager に移行（後方互換性のため保持）
    this.currentUser = null; // EventAuthManager に移行（後方互換性のため保持）
    this.events = []; // EventStateManager に移行（後方互換性のため保持）
    this.scheduleLocationHistory = new Set();
    this.lastScheduleLocation = "";
    this.lastScheduleStartTime = "";
    this.lastScheduleEndTime = "";
    this.selectedEventId = ""; // EventStateManager に移行（後方互換性のため保持）
    this.eventBatchSet = new Set(); // EventStateManager に移行（後方互換性のため保持）
    this.schedules = []; // EventStateManager に移行（後方互換性のため保持）
    this.selectedScheduleId = ""; // EventStateManager に移行（後方互換性のため保持）
    this.scheduleBatchSet = new Set(); // EventStateManager に移行（後方互換性のため保持）
    this.selectionListeners = new Set(); // EventStateManager に移行（後方互換性のため保持）
    this.eventListeners = new Set(); // EventStateManager に移行（後方互換性のため保持）
    this.participantHostInterface = null; // EventStateManager に移行（後方互換性のため保持）
    this.suppressSelectionNotifications = false; // EventStateManager に移行（後方互換性のため保持）
    this.lastSelectionSignature = ""; // EventStateManager に移行（後方互換性のため保持）
    this.lastSelectionSource = ""; // EventStateManager に移行（後方互換性のため保持）
    this.forceSelectionBroadcast = true; // EventStateManager に移行（後方互換性のため保持）
    this.stage = "events"; // EventNavigationManager に移行（後方互換性のため保持）
    this.preflightContext = null; // EventAuthManager に移行（後方互換性のため保持）
    this.stageHistory = new Set(["events"]); // EventNavigationManager に移行（後方互換性のため保持）
    this.activePanel = "events"; // EventNavigationManager に移行（後方互換性のため保持）
    this.activeDialog = null;
    this.lastFocused = null;
    this.confirmResolver = null;
    this.redirectingToIndex = false;
    this.fullscreenPromptShown = false;
    this.hasSeenAuthenticatedUser = Boolean(auth?.currentUser); // EventAuthManager に移行（後方互換性のため保持）
    this.authResumeFallbackTimer = 0; // EventAuthManager に移行（後方互換性のため保持）
    this.authResumeGracePeriodMs = AUTH_RESUME_FALLBACK_DELAY_MS; // EventAuthManager に移行（後方互換性のため保持）
    this.authResumeTimerHost = getTimerHost(); // EventAuthManager に移行（後方互換性のため保持）
    this.eventsLoadingTracker = new LoadingTracker({
      onChange: (state) => this.applyEventsLoadingState(state)
    });
    this.scheduleLoadingTracker = new LoadingTracker({
      onChange: (state) => this.applyScheduleLoadingState(state)
    });
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
    this.handleEventListKeydown = this.handleEventListKeydown.bind(this);
    this.handleEventListFocus = this.handleEventListFocus.bind(this);
    this.cleanup = this.cleanup.bind(this);
    this.eventCountNote = "";
    this.stageNote = "";
    this.applyMetaNote();
    this.chat = new EventChat(this);
    this.operatorMode = OPERATOR_MODE_TELOP;
    // 認証管理を初期化
    this.authManager = new EventAuthManager(this);
    // 状態管理を初期化
    this.stateManager = new EventStateManager(this);
    // 画面遷移制御を初期化
    this.navigationManager = new EventNavigationManager(this);
    // UI描画を初期化
    this.uiRenderer = new EventUIRenderer(this);
    // Firebase操作を初期化
    this.firebaseManager = new EventFirebaseManager(this);
    // ディスプレイロック機能を初期化
    this.displayLockManager = new DisplayLockManager(this);
    // プロパティを初期同期
    this.operatorPresenceEntries = this.firebaseManager.operatorPresenceEntries;
    this.operatorPresenceEventId = this.firebaseManager.operatorPresenceEventId;
    this.operatorPresenceUnsubscribe = this.firebaseManager.operatorPresenceUnsubscribe;
    this.hostPresenceSessionId = this.firebaseManager.hostPresenceSessionId;
    this.hostPresenceEntryKey = this.firebaseManager.hostPresenceEntryKey;
    this.hostPresenceEntryRef = this.firebaseManager.hostPresenceEntryRef;
    this.hostPresenceDisconnect = this.firebaseManager.hostPresenceDisconnect;
    this.hostPresenceHeartbeat = this.firebaseManager.hostPresenceHeartbeat;
    this.hostPresenceLastSignature = this.firebaseManager.hostPresenceLastSignature;
    this.scheduleConsensusEventId = this.firebaseManager.scheduleConsensusEventId;
    this.scheduleConsensusUnsubscribe = this.firebaseManager.scheduleConsensusUnsubscribe;
    this.scheduleConsensusState = this.firebaseManager.scheduleConsensusState;
    this.scheduleConsensusLastSignature = this.firebaseManager.scheduleConsensusLastSignature;
    this.scheduleConsensusLastKey = this.firebaseManager.scheduleConsensusLastKey;
    // auth のアタッチ後に ToolCoordinator を初期化する
    this.tools = new ToolCoordinator(this);
    // イベント管理パネルを初期化
    this.eventPanel = new EventPanelManager(this);
    // 日程管理パネルを初期化
    this.schedulePanel = new SchedulePanelManager(this);
    this.backupInFlight = false;
    this.restoreInFlight = false;
    this.displayUrlCopyTimer = 0;
    this.eventPrintSettings = DEFAULT_PRINT_SETTINGS;
    this.eventPrintPreviewController = null;
    this.eventPrintPreviewCache = null;
    this.eventPrintPreviewMode = "events";
    this.hostCommittedScheduleId = "";
    this.hostCommittedScheduleLabel = "";
    this.eventSelectionCommitted = false;
    this.scheduleSelectionCommitted = false;
    this.scheduleConflictContext = null;
    this.scheduleConflictLastSignature = "";
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.lastScheduleCommitChanged = false;
    this.pendingNavigationTarget = ""; // EventNavigationManager に移行（後方互換性のため保持）
    this.pendingNavigationMeta = null; // EventNavigationManager に移行（後方互換性のため保持）
    this.pendingNavigationClearTimer = 0; // EventNavigationManager に移行（後方互換性のため保持）
    this.awaitingScheduleConflictPrompt = false;
    this.scheduleConflictRadioName = generateShortId("flow-conflict-radio-");
    this.scheduleFallbackRadioName = generateShortId("flow-fallback-radio-");
    this.operatorModeRadioName = generateShortId("flow-operator-mode-radio-");
    this.flowDebugEnabled = false;
    this.operatorPresenceDebugEnabled = false;
    // EventFirebaseManager に移行（プロパティはfirebaseManagerの初期化後に同期済み）
    // 後方互換性のため、app.jsでもプロパティを保持（firebaseManagerから同期）
    this.scheduleConsensusToastTimer = 0;
    this.scheduleConsensusHideTimer = 0;
    this.scheduleFallbackContext = null;
    this.operatorModeChoiceContext = null;
    this.operatorModeChoiceResolver = null;
    this.suppressScheduleConflictPromptOnce = false;
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.updateChatLayoutMetrics = this.updateChatLayoutMetrics.bind(this);
    this.chatLayoutResizeObserver = null;
    this.chatLayoutRaf = 0;
    this.chatLayoutHeight = 0;
    this.chatLayoutScrollRaf = 0;
    this.visualViewportResize = null;
    this.activeMobilePanel = "";
    this.chatUnreadCount = 0;
    this.chatScrollUnreadCount = 0;
    this.authTransferAttempted = false; // EventAuthManager に移行（後方互換性のため保持）
    this.chatAcknowledged = true;
    this.chatMessages = [];
    this.chatLatestMessageId = "";
    this.chatLatestMessageTimestamp = 0;
    this.chatLastReadMessageId = "";
    this.chatLastReadMessageTimestamp = 0;
    this.chatReadUnsubscribe = null;
    this.lastMobileFocus = null;
    this.handleMobileKeydown = this.handleMobileKeydown.bind(this);
    this.handleChatInteraction = this.handleChatInteraction.bind(this);
    this.handleFullscreenChange = this.handleFullscreenChange.bind(this);
    this.handleFullscreenError = this.handleFullscreenError.bind(this);
    this.handleScheduleConflictSubmit = this.handleScheduleConflictSubmit.bind(this);
    this.handleScheduleFallbackSubmit = this.handleScheduleFallbackSubmit.bind(this);
    this.handleOperatorModeSubmit = this.handleOperatorModeSubmit.bind(this);
    this.resolveOperatorModeChoice = this.resolveOperatorModeChoice.bind(this);
    // EventAuthManager のプロパティを app に同期
    this.currentUser = this.authManager.currentUser;
    this.preflightContext = this.authManager.preflightContext;
    this.hasSeenAuthenticatedUser = this.authManager.hasSeenAuthenticatedUser;
    this.authResumeFallbackTimer = this.authManager.authResumeFallbackTimer;
    this.authResumeGracePeriodMs = this.authManager.authResumeGracePeriodMs;
    this.authResumeTimerHost = this.authManager.authResumeTimerHost;
    this.authTransferAttempted = this.authManager.authTransferAttempted;
    
    // EventStateManager のプロパティを app に同期
    this.events = this.stateManager.events;
    this.selectedEventId = this.stateManager.selectedEventId;
    this.eventBatchSet = this.stateManager.eventBatchSet;
    this.schedules = this.stateManager.schedules;
    this.selectedScheduleId = this.stateManager.selectedScheduleId;
    this.scheduleBatchSet = this.stateManager.scheduleBatchSet;
    this.selectionListeners = this.stateManager.selectionListeners;
    this.eventListeners = this.stateManager.eventListeners;
    this.participantHostInterface = this.stateManager.participantHostInterface;
    this.suppressSelectionNotifications = this.stateManager.suppressSelectionNotifications;
    this.lastSelectionSignature = this.stateManager.lastSelectionSignature;
    this.lastSelectionSource = this.stateManager.lastSelectionSource;
    this.forceSelectionBroadcast = this.stateManager.forceSelectionBroadcast;
    
    // EventNavigationManager のプロパティを app に同期
    this.stage = this.navigationManager.stage;
    this.stageHistory = this.navigationManager.stageHistory;
    this.activePanel = this.navigationManager.activePanel;
    this.pendingNavigationTarget = this.navigationManager.pendingNavigationTarget;
    this.pendingNavigationMeta = this.navigationManager.pendingNavigationMeta;
    this.pendingNavigationClearTimer = this.navigationManager.pendingNavigationClearTimer;
    
    appendAuthDebugLog("events:app-constructed", {
      hasCurrentUser: Boolean(this.currentUser)
    });
  }

  logParticipantAction(message, detail = null) {
    // 参加者リスト管理パネル向けのデバッグ出力は無効化します。
    void message;
    void detail;
  }

  logFlowEvent(message, detail = null) {
    if (!this.flowDebugEnabled) {
      return;
    }
    const timestamp = new Date().toISOString();
    const prefix = `[Flow] ${timestamp} ${message}`;
    if (detail && typeof detail === "object" && Object.keys(detail).length > 0) {
      console.info(prefix, detail);
    } else if (typeof detail !== "undefined" && detail !== null) {
      console.info(prefix, detail);
    } else {
      console.info(prefix);
    }
  }

  generatePresenceSessionId() {
    // EventFirebaseManager に委譲
    return this.firebaseManager.generatePresenceSessionId();
  }

  buildFlowState() {
    // EventStateManager に委譲
    return this.stateManager.buildFlowState();
  }

  logFlowState(message, detail = null) {
    const state = this.buildFlowState();
    const payload = {};
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      Object.assign(payload, detail);
    } else if (typeof detail !== "undefined" && detail !== null) {
      payload.detail = detail;
    }
    payload.flowState = state;
    this.logFlowEvent(message, payload);
  }

  buildOperatorPresenceDebugSummary(detail) {
    if (!detail || typeof detail !== "object") {
      return "";
    }

    const candidates = [];
    if (detail.payload && typeof detail.payload === "object") {
      candidates.push(detail.payload);
    }
    if (detail.entry && typeof detail.entry === "object") {
      candidates.push(detail.entry);
    }
    if (Array.isArray(detail.entries)) {
      const entry = detail.entries.length === 1 ? detail.entries[0] : null;
      if (entry && typeof entry === "object") {
        candidates.push(entry);
      }
    }
    if (!candidates.length && Object.keys(detail).length > 0) {
      candidates.push(detail);
    }

    const candidate = candidates.find((item) => item && typeof item === "object");
    if (!candidate) {
      return "";
    }

    const operatorName =
      ensureString(candidate.displayName) ||
      ensureString(candidate.email) ||
      ensureString(candidate.uid) ||
      "";

    const eventLabel =
      ensureString(candidate.eventName) || ensureString(candidate.eventId) || "";

    const scheduleLabel = ensureString(candidate.scheduleLabel);
    const scheduleId = ensureString(candidate.scheduleId);
    const selectedScheduleLabel = ensureString(candidate.selectedScheduleLabel);
    const selectedScheduleId = ensureString(candidate.selectedScheduleId);

    let scheduleSummary = scheduleLabel || selectedScheduleLabel || "";
    const idForSummary = scheduleId || selectedScheduleId || "";
    if (scheduleSummary && idForSummary && scheduleSummary !== idForSummary) {
      scheduleSummary = `${scheduleSummary} (${idForSummary})`;
    } else if (!scheduleSummary) {
      scheduleSummary = idForSummary;
    }

    const parts = [
      `operator=${operatorName || "(unknown)"}`,
      `event=${eventLabel || "(none)"}`,
      `schedule=${scheduleSummary || "(none)"}`
    ];

    return ` ${parts.join(" ")}`;
  }

  logOperatorPresenceDebug(message, detail = null) {
    if (!this.operatorPresenceDebugEnabled) {
      return;
    }
    const timestamp = new Date().toISOString();
    const suffix = this.buildOperatorPresenceDebugSummary(detail);
    const prefix = `[Presence] ${timestamp} ${message}${suffix}`;
    if (detail && typeof detail === "object" && Object.keys(detail).length > 0) {
      console.info(prefix, detail);
    } else if (typeof detail !== "undefined" && detail !== null) {
      console.info(prefix, detail);
    } else {
      console.info(prefix);
    }
  }

  describeOperatorPresenceEntries(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }
    return entries.map((entry) => ({
      sessionId: ensureString(entry?.sessionId || entry?.entryId),
      uid: ensureString(entry?.uid),
      displayName: ensureString(entry?.displayName),
      scheduleId: ensureString(entry?.scheduleId),
      scheduleLabel: ensureString(entry?.scheduleLabel),
      scheduleKey: ensureString(entry?.scheduleKey),
      selectedScheduleId: ensureString(entry?.selectedScheduleId),
      selectedScheduleLabel: ensureString(entry?.selectedScheduleLabel),
      mode: normalizeOperatorMode(entry?.mode),
      skipTelop: Boolean(entry?.skipTelop),
      source: ensureString(entry?.source),
      isSelf: Boolean(entry?.isSelf)
    }));
  }

  describeOperatorPresencePayload(payload = null) {
    if (!payload || typeof payload !== "object") {
      return {};
    }
    return {
      sessionId: ensureString(payload.sessionId),
      uid: ensureString(payload.uid),
      displayName:
        ensureString(payload.displayName) ||
        ensureString(payload.email) ||
        ensureString(payload.uid),
      eventId: ensureString(payload.eventId),
      eventName: ensureString(payload.eventName),
      scheduleId: ensureString(payload.scheduleId),
      scheduleLabel: ensureString(payload.scheduleLabel),
      scheduleKey: ensureString(payload.scheduleKey),
      selectedScheduleId: ensureString(payload.selectedScheduleId),
      selectedScheduleLabel: ensureString(payload.selectedScheduleLabel),
      mode: normalizeOperatorMode(payload.mode),
      skipTelop: Boolean(payload.skipTelop),
      reason: ensureString(payload.reason),
      source: ensureString(payload.source)
    };
  }

  init() {
    replayAuthDebugLog({ label: "[auth-debug] existing log (events)", clear: false });
    appendAuthDebugLog("events:init", {
      hasCurrentUser: Boolean(auth?.currentUser)
    });
    if (auth && auth.currentUser) {
      this.currentUser = auth.currentUser;
      this.authManager.currentUser = this.currentUser;
      this.updateUserLabel();
    }
    this.bindEvents();
    this.setupEventPrintPreview();
    this.applyEventsLoadingState();
    this.applyScheduleLoadingState();
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateEventSummary();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    this.updateSelectionNotes();
    this.applyMetaNote();
    this.chat.init();
    this.refreshChatIndicators();
    this.setupChatLayoutObservers();
    this.observeAuthState();
    this.syncMobilePanelAccessibility();
    // flow-stage-panelsをフォーカス可能にする
    if (this.dom.flowStagePanels) {
      this.dom.flowStagePanels.setAttribute("tabindex", "0");
      this.dom.flowStagePanels.setAttribute("role", "region");
      this.dom.flowStagePanels.setAttribute("aria-label", "メインパネル");
    }
    // 右サイドテロップ操作パネルをフォーカス可能にする
    const sideTelopPanel = document.getElementById("side-telop-panel");
    if (sideTelopPanel) {
      sideTelopPanel.setAttribute("tabindex", "0");
      sideTelopPanel.setAttribute("role", "region");
      sideTelopPanel.setAttribute("aria-label", "右サイドテロップ操作");
    }
    if (typeof document !== "undefined") {
      document.addEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.addEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", this.cleanup, { once: true });
    }
  }

  resetFlowState() {
    // EventStateManager の状態をリセット
    this.stateManager.resetState();
    // app の状態を EventStateManager と同期
    this.events = this.stateManager.events;
    this.selectedEventId = this.stateManager.selectedEventId;
    this.eventBatchSet = this.stateManager.eventBatchSet;
    this.schedules = this.stateManager.schedules;
    this.selectedScheduleId = this.stateManager.selectedScheduleId;
    this.scheduleBatchSet = this.stateManager.scheduleBatchSet;
    this.forceSelectionBroadcast = this.stateManager.forceSelectionBroadcast;
    
    // EventNavigationManager の状態をリセット
    this.navigationManager.resetState();
    // app の状態を EventNavigationManager と同期
    this.stage = this.navigationManager.stage;
    this.stageHistory = this.navigationManager.stageHistory;
    this.activePanel = this.navigationManager.activePanel;
    this.pendingNavigationTarget = this.navigationManager.pendingNavigationTarget;
    this.pendingNavigationMeta = this.navigationManager.pendingNavigationMeta;
    this.pendingNavigationClearTimer = this.navigationManager.pendingNavigationClearTimer;
    this.eventsLoadingTracker.reset();
    this.scheduleLoadingTracker.reset();
    this.clearOperatorPresenceState();
    this.eventCountNote = "";
    this.stageNote = "";
    this.tools.resetFlowState();
    this.chatUnreadCount = 0;
    this.chatScrollUnreadCount = 0;
    this.chatAcknowledged = true;
    this.chatMessages = [];
    this.chatLatestMessageId = "";
    this.chatLatestMessageTimestamp = 0;
    this.chatLastReadMessageId = "";
    this.chatLastReadMessageTimestamp = 0;
    this.applyMetaNote();
    this.applyEventsLoadingState();
    this.applyScheduleLoadingState();
    this.renderEvents();
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateEventSummary();
    this.updateStageHeader();
    this.updateStageUi();
    this.updateFlowButtons();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    this.updateSelectionNotes();
    this.refreshChatIndicators();
    this.applyBackupRestoreState();
  }

  bindEvents() {
    if (this.dom.addEventButton) {
      this.dom.addEventButton.addEventListener("click", () => this.openEventDialog({ mode: "create" }));
    }

    if (this.dom.eventPrintButton) {
      this.dom.eventPrintButton.addEventListener("click", () => {
        this.handleEventPrint();
      });
    }

    if (this.dom.glPrintButton) {
      this.dom.glPrintButton.addEventListener("click", () => {
        this.handleGlPrint();
      });
    }

    if (this.dom.refreshButton) {
      this.dom.refreshButton.addEventListener("click", async () => {
        if (this.dom.refreshButton.disabled) {
          return;
        }
        this.dom.refreshButton.disabled = true;
        try {
          this.beginEventsLoading("イベント情報を再読み込みしています…");
          await this.loadEvents();
        } catch (error) {
          logError("Failed to refresh events", error);
          this.showAlert(error.message || "イベントの再読み込みに失敗しました。");
        } finally {
          this.endEventsLoading();
          this.dom.refreshButton.disabled = false;
        }
      });
    }

    if (this.dom.backupButton) {
      this.dom.backupButton.addEventListener("click", () => {
        void this.handleBackupClick();
      });
    }

    if (this.dom.restoreButton) {
      this.dom.restoreButton.addEventListener("click", () => {
        void this.handleRestoreClick();
      });
    }

    if (this.dom.fullscreenButton) {
      this.dom.fullscreenButton.addEventListener("click", () => {
        this.toggleFullscreen().catch((error) => {
          logError("Failed to toggle fullscreen", error);
          this.updateFullscreenButton();
        });
      });
      this.updateFullscreenButton();
    }

    if (this.dom.fullscreenPromptEnterButton) {
      this.dom.fullscreenPromptEnterButton.addEventListener("click", () => {
        this.handleFullscreenPromptEnter().catch((error) => {
          logError("Failed to handle fullscreen prompt", error);
        });
      });
    }

    if (this.dom.fullscreenPromptStayButton) {
      this.dom.fullscreenPromptStayButton.addEventListener("click", () => {
        this.handleFullscreenPromptDismiss();
      });
    }

    if (typeof document !== "undefined") {
      document.addEventListener("fullscreenchange", this.handleFullscreenChange);
      document.addEventListener("webkitfullscreenchange", this.handleFullscreenChange);
      document.addEventListener("fullscreenerror", this.handleFullscreenError);
      document.addEventListener("webkitfullscreenerror", this.handleFullscreenError);
    }

    if (this.dom.logoutButton) {
      this.dom.logoutButton.addEventListener("click", () => {
        this.handleLogoutClick().catch((error) => {
          logError("Failed to handle logout", error);
        });
      });
    }

    (this.dom.panelButtons || []).forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.panelTarget || "";
        this.showPanel(target);
      });
    });

    (this.dom.navigationButtons || []).forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) {
          return;
        }
        const target = button.dataset.flowNavTarget || "";
        if (!target) {
          return;
        }
        void this.handleFlowNavigation(target, { sourceButton: button });
      });
    });

    if (this.dom.eventSummaryCopyButton) {
      const button = this.dom.eventSummaryCopyButton;
      if (!button.dataset.defaultLabel) {
        button.dataset.defaultLabel = button.textContent?.trim() || "表示URLをコピー";
      }
      this.dom.eventSummaryCopyButton.addEventListener("click", () => {
        this.handleDisplayUrlCopy().catch((error) => {
          logError("Failed to copy display URL", error);
          this.announceDisplayUrlCopy(false);
        });
      });
    }

    if (this.dom.eventSummaryGotoScheduleButton) {
      this.dom.eventSummaryGotoScheduleButton.addEventListener("click", () => {
        this.navigateToTelopSchedule();
      });
    }

    if (this.dom.operatorModeForm) {
      this.dom.operatorModeForm.addEventListener("submit", this.handleOperatorModeSubmit);
    }

    if (this.dom.operatorModeCancelButton) {
      this.dom.operatorModeCancelButton.addEventListener("click", () => {
        this.resolveOperatorModeChoice(null);
      });
    }

    if (this.dom.eventForm) {
      this.dom.eventForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleEventFormSubmit().catch((error) => {
          logError("Event form submit failed", error);
          this.setFormError(this.dom.eventError, error.message || "イベントの保存に失敗しました。");
        });
      });
    }

    if (this.dom.scheduleForm) {
      this.dom.scheduleForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleScheduleFormSubmit().catch((error) => {
          logError("Schedule form submit failed", error);
          this.setFormError(this.dom.scheduleError, error.message || "日程の保存に失敗しました。");
        });
      });
    }

    if (this.dom.scheduleConflictForm) {
      this.dom.scheduleConflictForm.addEventListener("submit", this.handleScheduleConflictSubmit);
    }

    if (this.dom.scheduleFallbackForm) {
      this.dom.scheduleFallbackForm.addEventListener("submit", this.handleScheduleFallbackSubmit);
    }

    this.bindDialogDismiss(this.dom.eventDialog);
    this.bindDialogDismiss(this.dom.scheduleDialog);
    this.bindDialogDismiss(this.dom.confirmDialog);
    this.bindDialogDismiss(this.dom.scheduleConflictDialog);
    this.bindDialogDismiss(this.dom.scheduleFallbackDialog);
    this.bindDialogDismiss(this.dom.operatorModeDialog);
    this.bindDialogDismiss(this.dom.fullscreenPromptDialog);
    this.bindDialogDismiss(this.dom.scheduleCompletionDialog);
    
    if (this.dom.scheduleCompletionCloseButton) {
      this.dom.scheduleCompletionCloseButton.addEventListener("click", () => {
        if (this.dom.scheduleCompletionDialog) {
          this.closeDialog(this.dom.scheduleCompletionDialog);
        }
      });
    }
    
    if (this.dom.scheduleCompletionCopyButton) {
      this.dom.scheduleCompletionCopyButton.addEventListener("click", () => {
        void this.handleScheduleCompletionCopyUrl();
      });
    }
    
    if (this.dom.scheduleCompletionButtons) {
      this.dom.scheduleCompletionButtons.forEach((button) => {
        if (!button) return;
        button.addEventListener("click", () => {
          const target = button.dataset.panelTarget || "";
          if (target && this.dom.scheduleCompletionDialog) {
            this.closeDialog(this.dom.scheduleCompletionDialog);
            this.showPanel(target);
          }
        });
      });
    }

    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.addEventListener("click", () => {
        this.resolveConfirm(true);
      });
    }

    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.addEventListener("click", () => {
        this.resolveConfirm(false);
      });
    }

    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.addEventListener("click", () => this.openScheduleDialog({ mode: "create" }));
    }

    if (this.dom.eventEditButton) {
      this.dom.eventEditButton.addEventListener("click", () => {
        const selected = this.getSelectedEvent();
        if (selected) {
          this.openEventDialog({ mode: "edit", event: selected });
        }
      });
    }

    if (this.dom.eventDeleteButton) {
      this.dom.eventDeleteButton.addEventListener("click", () => {
        const selected = this.getSelectedEvent();
        if (selected) {
          void this.deleteEvent(selected).catch((error) => {
            logError("Failed to delete event", error);
            this.showAlert(error.message || "イベントの削除に失敗しました。");
          });
        }
      });
    }

    if (this.dom.eventBatchDeleteButton) {
      this.dom.eventBatchDeleteButton.addEventListener("click", () => {
        this.handleEventBatchDelete();
      });
    }

    if (this.dom.scheduleEditButton) {
      this.dom.scheduleEditButton.addEventListener("click", () => {
        const selected = this.getSelectedSchedule();
        if (selected) {
          this.openScheduleDialog({ mode: "edit", schedule: selected });
        }
      });
    }

    if (this.dom.scheduleDeleteButton) {
      this.dom.scheduleDeleteButton.addEventListener("click", () => {
        const selected = this.getSelectedSchedule();
        if (selected) {
          void this.deleteSchedule(selected).catch((error) => {
            logError("Failed to delete schedule", error);
            this.showAlert(error.message || "日程の削除に失敗しました。");
          });
        }
      });
    }

    if (this.dom.scheduleBatchDeleteButton) {
      this.dom.scheduleBatchDeleteButton.addEventListener("click", () => {
        this.handleScheduleBatchDelete();
      });
    }

    if (this.dom.scheduleRefreshButton) {
      this.dom.scheduleRefreshButton.addEventListener("click", async () => {
        if (this.dom.scheduleRefreshButton.disabled) {
          return;
        }
        this.dom.scheduleRefreshButton.disabled = true;
        try {
          await this.reloadSchedules();
        } catch (error) {
          logError("Failed to refresh schedules", error);
          this.showAlert(error.message || "日程の再読み込みに失敗しました。");
        } finally {
          this.dom.scheduleRefreshButton.disabled = false;
        }
      });
    }

    (this.dom.mobileToggleButtons || []).forEach((button) => {
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        const target = button.dataset.mobileTarget || "";
        this.toggleMobilePanel(target);
      });
    });

    (this.dom.mobileCloseButtons || []).forEach((button) => {
      if (!button) {
        return;
      }
      button.addEventListener("click", () => {
        this.closeMobilePanel();
      });
    });

    if (this.dom.mobileOverlay) {
      this.dom.mobileOverlay.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        if (target === this.dom.mobileOverlay || target.closest("[data-mobile-overlay-dismiss]")) {
          this.closeMobilePanel();
        }
      });
    }

    if (this.dom.chatContainer) {
      this.dom.chatContainer.addEventListener("pointerdown", this.handleChatInteraction);
      this.dom.chatContainer.addEventListener("focusin", this.handleChatInteraction);
    }

    if (this.dom.eventList) {
      this.dom.eventList.addEventListener("keydown", this.handleEventListKeydown);
      this.dom.eventList.addEventListener("focusin", this.handleEventListFocus);
    }

    if (typeof document !== "undefined") {
      document.addEventListener("keydown", this.handleGlobalKeydown, true);
    }
  }

  async handleLogoutClick() {
    if (this.dom.logoutButton) {
      this.dom.logoutButton.disabled = true;
    }
    try {
      await signOut(auth);
    } catch (error) {
      logError("Sign-out failed", error);
      this.showAlert("ログアウトに失敗しました。時間をおいて再度お試しください。");
      if (this.dom.logoutButton) {
        this.dom.logoutButton.disabled = false;
      }
    }
  }

  applyBackupRestoreState() {
    const anyBusy = this.backupInFlight || this.restoreInFlight;
    const backupButton = this.dom.backupButton;
    if (backupButton) {
      backupButton.disabled = anyBusy;
      if (this.backupInFlight) {
        backupButton.setAttribute("aria-busy", "true");
      } else {
        backupButton.removeAttribute("aria-busy");
      }
    }
    const restoreButton = this.dom.restoreButton;
    if (restoreButton) {
      restoreButton.disabled = anyBusy;
      if (this.restoreInFlight) {
        restoreButton.setAttribute("aria-busy", "true");
      } else {
        restoreButton.removeAttribute("aria-busy");
      }
    }
  }

  formatBackupTimestamp(value) {
    if (!value) {
      return "";
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    try {
      return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    } catch (error) {
      console.warn("Failed to format backup timestamp", error);
      return date.toISOString();
    }
  }

  async handleBackupClick() {
    if (this.backupInFlight || this.restoreInFlight) {
      return;
    }
    this.backupInFlight = true;
    this.applyBackupRestoreState();
    try {
      const result = await this.api.apiPost({ action: "backupRealtimeDatabase" });
      const timestamp = this.formatBackupTimestamp(result?.timestamp);
      const message = timestamp
        ? `最新のバックアップを作成しました（${timestamp}）。`
        : "最新のバックアップを作成しました。";
      this.showAlert(message);
    } catch (error) {
      logError("Failed to backup realtime database", error);
      const detail = error && typeof error === "object" && "message" in error ? error.message : "";
      const fallback = "バックアップに失敗しました。時間をおいて再度お試しください。";
      this.showAlert(detail ? `バックアップに失敗しました: ${detail}` : fallback);
    } finally {
      this.backupInFlight = false;
      this.applyBackupRestoreState();
    }
  }

  async handleRestoreClick() {
    if (this.backupInFlight || this.restoreInFlight) {
      return;
    }
    const confirmed = await this.confirm({
      title: "バックアップを復元",
      description: "最新のバックアップでRealtime Databaseを上書きします。現在のデータは失われますがよろしいですか？",
      confirmLabel: "復元する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    this.restoreInFlight = true;
    this.applyBackupRestoreState();
    try {
      const result = await this.api.apiPost({ action: "restoreRealtimeDatabase" });
      const timestamp = this.formatBackupTimestamp(result?.timestamp);
      const message = timestamp
        ? `バックアップ（${timestamp}）を復元しました。`
        : "バックアップを復元しました。";
      this.showAlert(message);
      await this.loadEvents();
    } catch (error) {
      logError("Failed to restore realtime database", error);
      const detail = error && typeof error === "object" && "message" in error ? error.message : "";
      const fallback = "復元に失敗しました。時間をおいて再度お試しください。";
      this.showAlert(detail ? `復元に失敗しました: ${detail}` : fallback);
    } finally {
      this.restoreInFlight = false;
      this.applyBackupRestoreState();
    }
  }

  observeAuthState() {
    // EventAuthManager に委譲
    this.authManager.observeAuthState();
    this.authUnsubscribe = this.authManager.authUnsubscribe;
  }

  showLoggedOutState() {
    if (this.redirectingToIndex) {
      return;
    }
    appendAuthDebugLog("events:redirect:login");
    this.resetFlowState();
    this.endEventsLoading();
    this.updateUserLabel();
    if (typeof window !== "undefined") {
      this.redirectingToIndex = true;
      goToLogin();
    }
  }

  showLoggedInState() {
    if (this.dom.main) {
      this.dom.main.hidden = false;
    }
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateSelectionNotes();
  }

  beginEventsLoading(message = "") {
    this.eventsLoadingTracker.begin(message);
  }

  endEventsLoading() {
    this.eventsLoadingTracker.end();
  }

  updateEventsLoadingMessage(message = "") {
    this.eventsLoadingTracker.updateMessage(message);
  }

  applyEventsLoadingState(state = this.eventsLoadingTracker.getState()) {
    const { active, message } = state;
    if (this.dom.loading) {
      this.dom.loading.hidden = !active;
    }
    if (this.dom.loadingText) {
      this.dom.loadingText.textContent = active ? message || "" : "";
    }
  }

  clearAlert() {
    if (this.dom.alert) {
      this.dom.alert.hidden = true;
      this.dom.alert.textContent = "";
    }
  }

  showAlert(message) {
    if (this.dom.alert) {
      this.dom.alert.hidden = false;
      this.dom.alert.textContent = message;
    }
  }

  loadPreflightContextForUser(user) {
    // EventAuthManager に委譲
    return this.authManager.loadPreflightContextForUser(user);
  }

  async tryResumeAuth() {
    // EventAuthManager に委譲
    return await this.authManager.tryResumeAuth();
  }

  isValidTransferPayload(payload) {
    // EventAuthManager に委譲
    return this.authManager.isValidTransferPayload(payload);
  }

  scheduleAuthResumeFallback(reason = "unknown") {
    // EventAuthManager に委譲
    this.authManager.scheduleAuthResumeFallback(reason);
    this.authResumeFallbackTimer = this.authManager.authResumeFallbackTimer;
  }

  cancelAuthResumeFallback(reason = "unknown") {
    // EventAuthManager に委譲
    this.authManager.cancelAuthResumeFallback(reason);
    this.authResumeFallbackTimer = this.authManager.authResumeFallbackTimer;
  }

  async handleAuthState(user) {
    // EventAuthManager に委譲
    await this.authManager.handleAuthState(user);
    // EventAuthManager のプロパティを app に同期
    this.currentUser = this.authManager.currentUser;
    this.preflightContext = this.authManager.preflightContext;
    this.hasSeenAuthenticatedUser = this.authManager.hasSeenAuthenticatedUser;
  }

  async ensureAdminAccess() {
    // EventAuthManager に委譲
    return await this.authManager.ensureAdminAccess();
  }

  async safeSignOut() {
    // EventAuthManager に委譲
    return await this.authManager.safeSignOut();
  }

  isPermissionError(error) {
    // EventAuthManager に委譲
    return this.authManager.isPermissionError(error);
  }

  async loadEvents() {
    // EventPanelManager に委譲してイベント一覧を読み込む
    const normalized = await this.eventPanel.loadEvents();

    const previousEventId = this.selectedEventId;
    const previousScheduleId = this.selectedScheduleId;

    // eventPanel の events を app と EventStateManager に同期
    this.events = this.eventPanel.events;
    this.stateManager.events = this.events;
    // eventPanel の selectedEventId と eventBatchSet を app と同期
    this.eventPanel.selectedEventId = this.selectedEventId;
    this.eventPanel.eventBatchSet = this.eventBatchSet;

    // scheduleLocationHistory を更新
    const locationHistory = new Set();
    normalized.forEach((event) => {
      if (!Array.isArray(event?.schedules)) {
        return;
      }
      event.schedules.forEach((schedule) => {
        const location = ensureString(schedule?.location).trim();
        if (location) {
          locationHistory.add(location);
        }
      });
    });
    this.scheduleLocationHistory = locationHistory;
    this.tools.resetContext({ reason: "events-refreshed" });
    this.updateMetaNote();
    this.updateDocumentTitle();
    this.ensureSelectedEvent(previousEventId);
    this.renderEvents();
    this.updateScheduleStateFromSelection(previousScheduleId);
    this.updateFlowButtons();

    if (this.stage === "tabs") {
      const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
      if (activeConfig.requireSchedule && this.selectedEventId && this.selectedScheduleId) {
        this.tools
          .syncEmbeddedTools({ reason: "events-refreshed" })
          .catch((error) => logError("Failed to sync tools after refresh", error));
      }
    }

    const eventChanged = previousEventId !== this.selectedEventId;
    const scheduleChanged = previousScheduleId !== this.selectedScheduleId;
    if (eventChanged || scheduleChanged) {
      this.notifySelectionListeners("host");
    }
    this.notifyEventListeners();
    this.syncOperatorPresenceSubscription();
    this.updateScheduleConflictState();
    this.logFlowState("イベントと日程のロードが完了しました", {
      eventCount: this.events.length,
      scheduleCount: this.schedules.length
    });
    this.syncHostPresence(
      eventChanged ? "event-change" : scheduleChanged ? "schedule-change" : "events-sync"
    );

    return this.events;
  }

  renderEvents() {
    // eventPanel の selectedEventId と eventBatchSet を EventStateManager と同期
    this.eventPanel.selectedEventId = this.selectedEventId;
    this.eventPanel.eventBatchSet = this.eventBatchSet;
    this.stateManager.selectedEventId = this.selectedEventId;
    this.stateManager.eventBatchSet = this.eventBatchSet;
    // EventPanelManager に委譲
    this.eventPanel.renderEvents();
    // app.js 固有の処理を実行
    this.updateEventListKeyboardMetadata();
  }

  getEventListItems() {
    const list = this.dom.eventList;
    if (!list) return [];
    return Array.from(list.querySelectorAll(".entity-item"));
  }

  getEventListItemByEventId(eventId) {
    const items = this.getEventListItems();
    if (!eventId) {
      return items[0] || null;
    }
    return items.find((item) => item.dataset.eventId === eventId) || null;
  }

  updateEventListKeyboardMetadata(activeElement = null) {
    const list = this.dom.eventList;
    if (!list) return;
    const items = this.getEventListItems();
    if (!items.length) {
      list.removeAttribute("aria-activedescendant");
      return;
    }
    const target =
      activeElement || this.getEventListItemByEventId(this.selectedEventId) || items[0] || null;
    if (target instanceof HTMLElement && target.id) {
      list.setAttribute("aria-activedescendant", target.id);
    } else {
      list.removeAttribute("aria-activedescendant");
    }
  }

  focusEventListItem(element, { select = false } = {}) {
    if (!(element instanceof HTMLElement)) return;
    const eventId = ensureString(element.dataset.eventId);
    if (select && eventId) {
      this.selectEvent(eventId);
      requestAnimationFrame(() => {
        const refreshed = this.getEventListItemByEventId(eventId);
        if (refreshed instanceof HTMLElement) {
          refreshed.focus();
          this.updateEventListKeyboardMetadata(refreshed);
        }
      });
      return;
    }
    element.focus();
    this.updateEventListKeyboardMetadata(element);
  }

  handleEventListFocus(event) {
    const list = this.dom.eventList;
    if (!list || !this.events.length) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest(".entity-item");
    if (item) {
      this.updateEventListKeyboardMetadata(item);
      return;
    }
    if (target === list) {
      const activeItem =
        this.getEventListItemByEventId(this.selectedEventId) || this.getEventListItems()[0] || null;
      if (activeItem) {
        this.focusEventListItem(activeItem);
      }
    }
  }

  handleEventListKeydown(event) {
    const list = this.dom.eventList;
    if (!list || !this.events.length) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest(".entity-item");
    const isListFocused = target === list;
    const actionableControl = target.closest(
      "button, [role='button'], input, select, textarea, a, [data-interactive]"
    );
    if (actionableControl && actionableControl !== item && actionableControl !== list) {
      return;
    }
    if (!item && !isListFocused) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const items = this.getEventListItems();
    if (!items.length) return;

    const currentIndex = item
      ? items.indexOf(item)
      : items.findIndex((el) => el.dataset.eventId === this.selectedEventId);
    const activeIndex = currentIndex >= 0 ? currentIndex : -1;

    let nextIndex = activeIndex >= 0 ? activeIndex : 0;
    switch (event.key) {
      case "ArrowDown":
      case "Down":
        nextIndex = Math.min(items.length - 1, activeIndex + 1 || 0);
        break;
      case "ArrowUp":
      case "Up":
        nextIndex = Math.max(0, activeIndex >= 0 ? activeIndex - 1 : 0);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      case "Enter": {
        const activeItem = item || items[Math.max(0, activeIndex)] || null;
        if (!activeItem) return;
        event.preventDefault();
        this.focusEventListItem(activeItem, { select: true });
        const committed = this.confirmEventSelection({ reason: "event-confirm:keyboard" });
        if (committed) {
          void this.handleFlowNavigation("schedules");
        }
        return;
      }
      default:
        return;
    }

    const nextItem = items[nextIndex];
    if (!nextItem) return;
    event.preventDefault();
    this.focusEventListItem(nextItem, { select: true });
  }

  ensureSelectedEvent(preferredId = "") {
    const availableIds = new Set(this.events.map((event) => event.id));
    const desiredId = preferredId || this.selectedEventId;
    if (desiredId && availableIds.has(desiredId)) {
      this.selectedEventId = desiredId;
      this.stateManager.selectedEventId = desiredId;
    } else {
      this.selectedEventId = "";
      this.stateManager.selectedEventId = "";
    }
  }

  getSelectedEvent() {
    if (!this.selectedEventId) return null;
    return this.events.find((event) => event.id === this.selectedEventId) || null;
  }

  selectEvent(eventId) {
    const previous = this.selectedEventId;
    const normalized = ensureString(eventId);
    this.logFlowEvent("イベント選択が要求されました", {
      requestedEventId: normalized || "",
      previousEventId: previous || "",
      totalEvents: this.events.length
    });
    if (normalized && !this.events.some((event) => event.id === normalized)) {
      this.logFlowState("指定されたイベントが見つからないため選択を維持します", {
        requestedEventId: normalized
      });
      return;
    }

    this.selectedEventId = normalized;
    // EventStateManager と eventPanel の selectedEventId を同期
    this.stateManager.selectedEventId = normalized;
    this.eventPanel.selectedEventId = normalized;
    const changed = previous !== normalized;
    if (changed) {
      this.eventSelectionCommitted = false;
      this.scheduleSelectionCommitted = false;
      this.clearHostPresence();
    }
    if (changed) {
      this.logFlowState("イベント選択を更新しました", {
        eventId: normalized || "",
        previousEventId: previous || ""
      });
      this.tools.resetContext({ reason: "event-change" });
      this.setHostCommittedSchedule("", { reason: "event-change", sync: false, updateContext: false, force: true });
    } else {
      this.logFlowState("イベント選択は既に最新の状態です", {
        eventId: normalized || ""
      });
    }
    this.renderEvents();
    this.updateScheduleStateFromSelection();
    this.updateEventSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSidebarButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.tools.prepareContextForSelection();
    this.updateScheduleConflictState();
    this.syncOperatorPresenceSubscription();
    this.syncScheduleConsensusSubscription();
    this.updateEventActionPanelState();
    if (changed) {
      this.notifySelectionListeners("host");
    }
  }

  confirmEventSelection({ reason = "event-confirm" } = {}) {
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      this.logFlowState("イベント未選択のため確定できません", { reason });
      return false;
    }
    if (!this.eventSelectionCommitted) {
      this.eventSelectionCommitted = true;
      this.scheduleSelectionCommitted = false;
      this.hostPresenceLastSignature = "";
      this.logFlowState("イベント選択を確定しました", { eventId, reason });
    } else {
      this.logFlowState("イベント選択は既に確定済みです", { eventId, reason });
    }
    this.syncHostPresence(reason);
    return true;
  }

  ensureSelectedSchedule(preferredId = "") {
    const availableIds = new Set(this.schedules.map((schedule) => schedule.id));
    const desiredId = preferredId || this.selectedScheduleId;
    if (desiredId && availableIds.has(desiredId)) {
      this.selectedScheduleId = desiredId;
      this.stateManager.selectedScheduleId = desiredId;
      this.logFlowState("利用可能な日程選択を維持しました", {
        scheduleId: this.selectedScheduleId,
        preferredScheduleId: preferredId || ""
      });
    } else {
      const previousScheduleId = this.selectedScheduleId;
      this.selectedScheduleId = "";
      this.stateManager.selectedScheduleId = "";
      this.tools.resetContext({ clearDataset: true });
      this.logFlowState("利用可能な日程が見つからないため選択をクリアしました", {
        previousScheduleId: previousScheduleId || "",
        preferredScheduleId: preferredId || ""
      });
      if (previousScheduleId && previousScheduleId === this.hostCommittedScheduleId) {
        this.setHostCommittedSchedule("", {
          reason: "schedule-unavailable",
          sync: true,
          updateContext: false,
          force: true
        });
      }
    }
  }

  getSelectedSchedule() {
    if (!this.selectedScheduleId) return null;
    return this.schedules.find((schedule) => schedule.id === this.selectedScheduleId) || null;
  }

  getCommittedSchedule() {
    if (!this.hostCommittedScheduleId) {
      return null;
    }
    return this.schedules.find((schedule) => schedule.id === this.hostCommittedScheduleId) || null;
  }

  getCurrentSelectionContext() {
    // EventStateManager に委譲
    return this.stateManager.getCurrentSelectionContext();
  }

  resolveHostScheduleContext(eventId = "", { scheduleMap = null } = {}) {
    // EventFirebaseManager に委譲
    return this.firebaseManager.resolveHostScheduleContext(eventId, { scheduleMap });
  }

  derivePresenceScheduleKey(eventId, payload = {}, entryId = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.derivePresenceScheduleKey(eventId, payload, entryId);
  }

  getDisplayUrlForEvent(eventId) {
    const normalized = ensureString(eventId);
    if (!normalized) {
      return "";
    }
    if (typeof window === "undefined") {
      return `display.html?evt=${encodeURIComponent(normalized)}`;
    }
    const base = new URL("display.html", window.location.href);
    base.searchParams.set("evt", normalized);
    return base.toString();
  }

  async handleDisplayUrlCopy() {
    if (!this.dom.eventSummaryCopyButton) {
      return;
    }
    const button = this.dom.eventSummaryCopyButton;
    if (button.disabled) {
      return;
    }
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      this.announceDisplayUrlCopy(false);
      return;
    }
    const url = this.getDisplayUrlForEvent(eventId);
    if (!url) {
      this.announceDisplayUrlCopy(false);
      return;
    }
    button.disabled = true;
    let success = false;
    try {
      if (navigator?.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
        success = true;
      }
    } catch (error) {
      console.warn("navigator.clipboard.writeText failed", error);
    }
    if (!success) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        success = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch (error) {
        console.warn("Fallback clipboard copy failed", error);
        success = false;
      }
    }
    this.announceDisplayUrlCopy(success, url);
    button.disabled = false;
  }

  announceDisplayUrlCopy(success, url = "") {
    const button = this.dom.eventSummaryCopyButton;
    if (!button) {
      return;
    }
    const status = this.dom.eventSummaryCopyStatus;
    const defaultLabel = button.dataset.defaultLabel || "表示URLをコピー";
    if (this.displayUrlCopyTimer) {
      clearTimeout(this.displayUrlCopyTimer);
      this.displayUrlCopyTimer = 0;
    }
    if (success) {
      button.classList.remove("is-error");
      button.classList.add("is-success");
      button.textContent = "コピーしました";
      if (status) {
        status.textContent = "ディスプレイURLをコピーしました。";
      }
    } else {
      button.classList.remove("is-success");
      button.classList.add("is-error");
      button.textContent = "コピーできません";
      if (status) {
        status.textContent = url ? `コピーに失敗しました。URL: ${url}` : "コピーに失敗しました。";
      }
    }
    if (typeof window !== "undefined") {
      this.displayUrlCopyTimer = window.setTimeout(() => {
        button.classList.remove("is-success", "is-error");
        button.textContent = defaultLabel;
        if (status) {
          status.textContent = "";
        }
        this.displayUrlCopyTimer = 0;
      }, 3200);
    }
  }

  findScheduleByIdOrAlias(scheduleId = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.findScheduleByIdOrAlias(scheduleId);
  }

  resolveScheduleFromPresenceEntry(entry = null) {
    // EventFirebaseManager に委譲
    return this.firebaseManager.resolveScheduleFromPresenceEntry(entry);
  }

  getPresenceSourcePriority(entry = null) {
    // EventFirebaseManager に委譲
    return this.firebaseManager.getPresenceSourcePriority(entry);
  }

  getAssignedScheduleFromPresence() {
    // EventFirebaseManager に委譲
    return this.firebaseManager.getAssignedScheduleFromPresence();
  }

  navigateToTelopSchedule() {
    if (!this.selectedEventId) {
      this.showPanel("events");
      this.revealEventSelectionCue();
      return;
    }

    const assignment = this.getAssignedScheduleFromPresence();
    const committedId = ensureString(this.hostCommittedScheduleId);
    let targetScheduleId = committedId;

    if (!targetScheduleId && assignment?.scheduleId) {
      const assignedSchedule = assignment.schedule || this.findScheduleByIdOrAlias(assignment.scheduleId);
      if (assignedSchedule) {
        targetScheduleId = ensureString(assignedSchedule.id);
      }
    }

    if (!targetScheduleId) {
      this.logFlowState("テロップ操作用日程が未確定のため日程選択パネルを案内します", {});
      const fallbackPanel = this.getOperatorPanelFallbackTarget({ preferSchedules: true });
      const normalizedTarget = fallbackPanel === "operator" ? "schedules" : fallbackPanel;
      this.showPanel(normalizedTarget);
      this.revealScheduleSelectionCue();
      return;
    }

    const schedule = this.findScheduleByIdOrAlias(targetScheduleId);
    if (!schedule) {
      this.logFlowState("テロップ操作有効日程が現在のイベントに見つかりません", {
        scheduleId: targetScheduleId
      });
      const fallbackPanel = this.getOperatorPanelFallbackTarget({ preferSchedules: true });
      const normalizedTarget = fallbackPanel === "operator" ? "schedules" : fallbackPanel;
      this.showPanel(normalizedTarget);
      this.revealScheduleSelectionCue();
      return;
    }

    if (schedule.id !== ensureString(this.selectedScheduleId)) {
      this.logFlowState("テロップ操作有効日程へ選択を切り替えます", {
        scheduleId: schedule.id,
        scheduleLabel: schedule.label || ""
      });
      this.selectSchedule(schedule.id);
    }

    if (ensureString(this.selectedScheduleId) === ensureString(this.hostCommittedScheduleId)) {
      this.scheduleSelectionCommitted = true;
    }

    if (this.operatorMode !== OPERATOR_MODE_TELOP) {
      this.setOperatorMode(OPERATOR_MODE_TELOP);
    }

    if (this.canActivatePanel("operator", PANEL_CONFIG.operator)) {
      this.showPanel("operator");
    }
  }

  setOperatorMode(mode, { fromControl = false } = {}) {
    const normalized = normalizeOperatorMode(mode);
    const previous = this.operatorMode;
    this.operatorMode = normalized;
    this.syncOperatorModeUi();
    if (previous === normalized) {
      return;
    }
    if (normalized === OPERATOR_MODE_SUPPORT && this.activePanel === "operator") {
      this.showPanel("operator");
    }
    this.tools
      .syncOperatorContext({ force: true })
      .catch((error) => logError("Failed to apply operator mode to embed", error));
    const hasSelection = Boolean(this.selectedEventId && this.selectedScheduleId);
    if (!hasSelection) {
      return;
    }
    const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
    if (activeConfig.stage === "tabs") {
      this.tools
        .syncEmbeddedTools({ reason: "operator-mode-changed" })
        .catch((error) => logError("Failed to resync tools after mode change", error));
    } else {
      this.tools.setPendingSync(true);
    }
  }

  syncOperatorModeUi() {
    // EventUIRenderer に委譲
    this.uiRenderer.syncOperatorModeUi();
  }

  getParticipantEventsSnapshot() {
    // EventStateManager に委譲
    return this.stateManager.getParticipantEventsSnapshot();
  }

  addSelectionListener(listener) {
    // EventStateManager に委譲
    return this.stateManager.addSelectionListener(listener);
  }

  addEventListener(listener) {
    // EventStateManager に委譲
    return this.stateManager.addEventListener(listener);
  }

  notifySelectionListeners(source = "host") {
    // EventStateManager に委譲
    this.stateManager.notifySelectionListeners(source);
    // EventStateManager のプロパティを app に同期
    this.lastSelectionSignature = this.stateManager.lastSelectionSignature;
    this.lastSelectionSource = this.stateManager.lastSelectionSource;
    this.forceSelectionBroadcast = this.stateManager.forceSelectionBroadcast;
  }

  notifyEventListeners() {
    // EventStateManager に委譲
    this.stateManager.notifyEventListeners();
  }

  applySelectionFromParticipant(detail = {}) {
    // EventStateManager に委譲
    this.stateManager.applySelectionFromParticipant(detail);
    // EventStateManager のプロパティを app に同期
    this.suppressSelectionNotifications = this.stateManager.suppressSelectionNotifications;
  }

  getParticipantHostInterface() {
    // EventStateManager に委譲
    const interface = this.stateManager.getParticipantHostInterface();
    this.participantHostInterface = interface;
    return interface;
  }

  selectSchedule(scheduleId) {
    const previous = this.selectedScheduleId;
    const normalized = ensureString(scheduleId);
    this.logFlowEvent("日程選択が要求されました", {
      requestedScheduleId: normalized || "",
      previousScheduleId: previous || "",
      totalSchedules: this.schedules.length
    });
    if (normalized && !this.schedules.some((schedule) => schedule.id === normalized)) {
      this.logFlowState("指定された日程が見つからないため選択を維持します", {
        requestedScheduleId: normalized
      });
      return;
    }

    this.selectedScheduleId = normalized;
    // EventStateManager と schedulePanel の selectedScheduleId を同期
    this.stateManager.selectedScheduleId = normalized;
    this.schedulePanel.selectedScheduleId = normalized;
    const changed = previous !== normalized;
    const selectedSchedule = this.getSelectedSchedule();
    this.rememberLastScheduleLocation(selectedSchedule?.location);
    this.rememberLastScheduleTimeRange(selectedSchedule?.startAt, selectedSchedule?.endAt);
    if (changed) {
      this.logFlowState("日程選択を更新しました", {
        scheduleId: normalized || "",
        previousScheduleId: previous || ""
      });
      this.tools.resetContext({ reason: "schedule-change" });
      this.scheduleSelectionCommitted = false;
    } else {
      this.logFlowState("日程選択は既に最新の状態です", {
        scheduleId: normalized || ""
      });
    }
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.tools.prepareContextForSelection();
    this.updateScheduleConflictState();
    this.updateScheduleActionPanelState();
    if (changed) {
      this.syncOperatorPresenceSubscription();
      this.notifySelectionListeners("host");
    }
  }

  updateScheduleStateFromSelection(preferredScheduleId = "") {
    const event = this.getSelectedEvent();
    this.schedules = event ? [...event.schedules] : [];
    // EventStateManager と schedulePanel の schedules を同期
    this.stateManager.schedules = this.schedules;
    this.schedulePanel.schedules = this.schedules;
    // schedulePanel の selectedScheduleId と scheduleBatchSet を EventStateManager と同期
    this.schedulePanel.selectedScheduleId = this.selectedScheduleId;
    this.schedulePanel.scheduleBatchSet = this.scheduleBatchSet;
    this.stateManager.selectedScheduleId = this.selectedScheduleId;
    this.stateManager.scheduleBatchSet = this.scheduleBatchSet;
    this.logFlowState("イベント選択に基づいて日程一覧を更新します", {
      selectedEventId: event?.id || "",
      scheduleCount: this.schedules.length,
      preferredScheduleId
    });
    this.ensureSelectedSchedule(preferredScheduleId);
    const selectedSchedule = this.getSelectedSchedule();
    this.rememberLastScheduleLocation(selectedSchedule?.location);
    this.renderScheduleList();
    this.updateScheduleSummary();
    this.updateStageHeader();
    this.updateFlowButtons();
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.tools.prepareContextForSelection();
    this.updateScheduleConflictState();
    if (this.eventSelectionCommitted) {
      this.syncHostPresence("schedule-sync");
    }
  }

  renderScheduleList() {
    // schedulePanel の selectedScheduleId と scheduleBatchSet を EventStateManager と同期
    this.schedulePanel.selectedScheduleId = this.selectedScheduleId;
    this.schedulePanel.scheduleBatchSet = this.scheduleBatchSet;
    this.stateManager.selectedScheduleId = this.selectedScheduleId;
    this.stateManager.scheduleBatchSet = this.scheduleBatchSet;
    // SchedulePanelManager に委譲
    this.schedulePanel.renderScheduleList();
    // app.js 固有の処理を実行
        this.updateScheduleActionPanelState();
  }

  updateEventActionPanelState() {
    // EventUIRenderer に委譲
    this.uiRenderer.updateEventActionPanelState();
  }

  updateScheduleActionPanelState() {
    // EventUIRenderer に委譲
    this.uiRenderer.updateScheduleActionPanelState();
  }

  async handleEventBatchDelete() {
    const batchIds = Array.from(this.eventBatchSet);
    if (!batchIds.length) {
      return;
    }
    const events = batchIds.map((id) => this.events.find((e) => e.id === id)).filter(Boolean);
    if (!events.length) {
      return;
    }
    const confirmed = await this.confirm({
      title: "選択したイベントを削除",
      description: `${events.length}件のイベントを削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル"
    });
    if (!confirmed) {
      return;
    }
    const selectedId = this.selectedEventId;
    this.eventBatchSet.clear();
    this.stateManager.eventBatchSet.clear();
    if (selectedId && batchIds.includes(selectedId)) {
      this.selectedEventId = "";
      this.stateManager.selectedEventId = "";
    }
    this.updateEventActionPanelState();
    try {
      await Promise.all(events.map((event) => this.deleteEvent(event)));
    } catch (error) {
      logError("Failed to delete events in batch", error);
      this.showAlert(error.message || "イベントの削除に失敗しました。");
    }
  }

  async handleScheduleBatchDelete() {
    const batchIds = Array.from(this.scheduleBatchSet);
    if (!batchIds.length) {
      return;
    }
    const schedules = batchIds.map((id) => this.schedules.find((s) => s.id === id)).filter(Boolean);
    if (!schedules.length) {
      return;
    }
    const confirmed = await this.confirm({
      title: "選択した日程を削除",
      description: `${schedules.length}件の日程を削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル"
    });
    if (!confirmed) {
      return;
    }
    const selectedId = this.selectedScheduleId;
    this.scheduleBatchSet.clear();
    this.stateManager.scheduleBatchSet.clear();
    if (selectedId && batchIds.includes(selectedId)) {
      this.selectedScheduleId = "";
      this.stateManager.selectedScheduleId = "";
    }
    this.updateScheduleActionPanelState();
    try {
      await Promise.all(schedules.map((schedule) => this.deleteSchedule(schedule)));
    } catch (error) {
      logError("Failed to delete schedules in batch", error);
      this.showAlert(error.message || "日程の削除に失敗しました。");
    }
  }

  updateEventSummary() {
    // EventUIRenderer に委譲
    this.uiRenderer.updateEventSummary();
  }

  getScheduleListItems() {
    const list = this.dom.scheduleList;
    if (!list) return [];
    return Array.from(list.querySelectorAll(".entity-item"));
  }

  getScheduleListItemByScheduleId(scheduleId) {
    const items = this.getScheduleListItems();
    if (!scheduleId) {
      return items[0] || null;
    }
    return items.find((item) => item.dataset.scheduleId === scheduleId) || null;
  }

  focusScheduleListItem(element, { select = false } = {}) {
    if (!(element instanceof HTMLElement)) return;
    const scheduleId = ensureString(element.dataset.scheduleId);
    if (select && scheduleId) {
      this.selectSchedule(scheduleId);
      requestAnimationFrame(() => {
        const refreshed = this.getScheduleListItemByScheduleId(scheduleId);
        if (refreshed instanceof HTMLElement) {
          refreshed.focus();
        }
      });
      return;
    }
    element.focus();
  }

  updateScheduleSummary() {
    // EventUIRenderer に委譲
    this.uiRenderer.updateScheduleSummary();
  }

  clearLoadingIndicators() {
    this.eventsLoadingTracker.reset();
    this.scheduleLoadingTracker.reset();
  }

  updateStageUi() {
    // EventNavigationManager に委譲
    this.navigationManager.updateStageUi();
    // EventNavigationManager のプロパティを app に同期
    this.stage = this.navigationManager.stage;
  }

  updateStageIndicator() {
    // EventNavigationManager に委譲
    this.navigationManager.updateStageIndicator();
  }

  updateStageHeader() {
    // EventNavigationManager に委譲
    this.navigationManager.updateStageHeader();
  }

  setModuleAccessibility(module, isActive) {
    // EventNavigationManager に委譲
    this.navigationManager.setModuleAccessibility(module, isActive);
  }

  isFullscreenSupported() {
    if (typeof document === "undefined") {
      return false;
    }
    const doc = document;
    const element = doc.documentElement || doc.body;
    return Boolean(
      doc.fullscreenEnabled ||
        doc.webkitFullscreenEnabled ||
        doc.msFullscreenEnabled ||
        element?.requestFullscreen ||
        element?.webkitRequestFullscreen ||
        element?.msRequestFullscreen
    );
  }

  isFullscreenActive() {
    if (typeof document === "undefined") {
      return false;
    }
    return Boolean(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement
    );
  }

  updateFullscreenButton() {
    const button = this.dom.fullscreenButton;
    if (!button) {
      return;
    }
    const supported = this.isFullscreenSupported();
    const isActive = supported && this.isFullscreenActive();
    button.disabled = !supported;
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (supported) {
      if (isActive) {
        button.innerHTML = "フルスクリーン解除 <kbd>F</kbd> <kbd>Esc</kbd>";
      } else {
        button.innerHTML = "フルスクリーン <kbd>F</kbd>";
      }
      button.dataset.state = isActive ? "active" : "inactive";
      button.title = isActive ? "フルスクリーンを終了します" : "画面をフルスクリーン表示します";
    } else {
      button.innerHTML = "フルスクリーン <kbd>F</kbd>";
      button.dataset.state = "unsupported";
      button.title = "このブラウザではフルスクリーン表示に対応していません";
    }
  }

  promptFullscreenChoice() {
    if (this.fullscreenPromptShown) {
      return;
    }
    this.fullscreenPromptShown = true;
    const dialog = this.dom.fullscreenPromptDialog;
    if (!dialog) {
      return;
    }
    const supported = this.isFullscreenSupported();
    if (this.dom.fullscreenPromptEnterButton) {
      this.dom.fullscreenPromptEnterButton.disabled = !supported;
    }
    if (this.dom.fullscreenPromptSupportNote) {
      this.dom.fullscreenPromptSupportNote.hidden = supported;
    }
    this.openDialog(dialog);
  }

  async handleFullscreenPromptEnter() {
    this.closeDialog(this.dom.fullscreenPromptDialog);
    try {
      await this.enterFullscreen();
    } catch (error) {
      logError("Failed to enter fullscreen from prompt", error);
    }
    this.updateFullscreenButton();
  }

  handleFullscreenPromptDismiss() {
    this.closeDialog(this.dom.fullscreenPromptDialog);
    this.updateFullscreenButton();
  }

  async toggleFullscreen() {
    if (!this.isFullscreenSupported()) {
      this.updateFullscreenButton();
      return;
    }
    const isActive = this.isFullscreenActive();
    try {
      if (isActive) {
        await this.exitFullscreen();
      } else {
        await this.enterFullscreen();
      }
    } catch (error) {
      this.updateFullscreenButton();
      throw error;
    }
    this.updateFullscreenButton();
  }

  async enterFullscreen() {
    if (typeof document === "undefined") {
      return;
    }
    const element = document.documentElement || document.body;
    if (!element) {
      return;
    }
    if (element.requestFullscreen) {
      await element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) {
      element.msRequestFullscreen();
    }
  }

  async exitFullscreen() {
    if (typeof document === "undefined") {
      return;
    }
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  handleFullscreenChange() {
    this.updateFullscreenButton();
  }

  handleFullscreenError(event) {
    this.updateFullscreenButton();
    logError("Fullscreen operation failed", event);
  }

  updateFlowButtons() {
    // EventNavigationManager に委譲
    this.navigationManager.updateFlowButtons();
  }

  loadEventPrintSettings() {
    if (typeof localStorage === "undefined") {
      this.eventPrintSettings = DEFAULT_PRINT_SETTINGS;
      return this.eventPrintSettings;
    }

    try {
      const stored = localStorage.getItem(PRINT_SETTING_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.eventPrintSettings = normalizePrintSettings(parsed, DEFAULT_PRINT_SETTINGS);
        logPrintInfo("Event print settings loaded", {
          paperSize: this.eventPrintSettings.paperSize,
          margin: this.eventPrintSettings.margin
        });
      } else {
        this.eventPrintSettings = DEFAULT_PRINT_SETTINGS;
      }
    } catch (error) {
      logPrintWarn("Failed to load event print settings", error);
      this.eventPrintSettings = DEFAULT_PRINT_SETTINGS;
    }

    return this.eventPrintSettings;
  }

  persistEventPrintSettings(settings) {
    const normalized = normalizePrintSettings(settings, DEFAULT_PRINT_SETTINGS);
    this.eventPrintSettings = normalized;
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(PRINT_SETTING_STORAGE_KEY, JSON.stringify(normalized));
        logPrintInfo("Event print settings saved", { paperSize: normalized.paperSize, margin: normalized.margin });
      } catch (error) {
        logPrintWarn("Failed to persist event print settings", error);
      }
    }
    return normalized;
  }

  applyEventPrintSettingsToForm(settings) {
    const normalized = normalizePrintSettings(settings, DEFAULT_PRINT_SETTINGS);
    if (this.dom.printPaperSizeInput) {
      this.dom.printPaperSizeInput.value = normalized.paperSize;
    }
    if (this.dom.printOrientationInput) {
      this.dom.printOrientationInput.value = normalized.orientation;
    }
    if (this.dom.printMarginInput) {
      this.dom.printMarginInput.value = normalized.margin;
    }
    if (this.dom.printCustomWidthInput) {
      this.dom.printCustomWidthInput.value = normalized.customWidth;
    }
    if (this.dom.printCustomHeightInput) {
      this.dom.printCustomHeightInput.value = normalized.customHeight;
    }
    if (this.dom.printShowHeaderInput) {
      this.dom.printShowHeaderInput.checked = normalized.showHeader;
    }
    if (this.dom.printRepeatHeaderInput) {
      this.dom.printRepeatHeaderInput.checked = normalized.repeatHeader && normalized.showHeader;
      this.dom.printRepeatHeaderInput.disabled = !normalized.showHeader;
    }
    if (this.dom.printShowPageNumberInput) {
      this.dom.printShowPageNumberInput.checked = normalized.showPageNumbers;
    }
    if (this.dom.printShowDateInput) {
      this.dom.printShowDateInput.checked = normalized.showDate;
    }
    if (this.dom.printShowTimeInput) {
      this.dom.printShowTimeInput.checked = normalized.showTime;
    }
    if (this.dom.printShowPhoneInput) {
      this.dom.printShowPhoneInput.checked = normalized.showPhone;
    }
    if (this.dom.printShowEmailInput) {
      this.dom.printShowEmailInput.checked = normalized.showEmail;
    }
  }

  readEventPrintSettingsFromForm() {
    const settings = {
      paperSize: this.dom.printPaperSizeInput?.value,
      orientation: this.dom.printOrientationInput?.value,
      margin: this.dom.printMarginInput?.value,
      customWidth: this.dom.printCustomWidthInput?.value,
      customHeight: this.dom.printCustomHeightInput?.value,
      showHeader: this.dom.printShowHeaderInput ? this.dom.printShowHeaderInput.checked : undefined,
      repeatHeader: this.dom.printRepeatHeaderInput ? this.dom.printRepeatHeaderInput.checked : undefined,
      showPageNumbers: this.dom.printShowPageNumberInput ? this.dom.printShowPageNumberInput.checked : undefined,
      showDate: this.dom.printShowDateInput ? this.dom.printShowDateInput.checked : undefined,
      showTime: this.dom.printShowTimeInput ? this.dom.printShowTimeInput.checked : undefined,
      showPhone: this.dom.printShowPhoneInput ? this.dom.printShowPhoneInput.checked : undefined,
      showEmail: this.dom.printShowEmailInput ? this.dom.printShowEmailInput.checked : undefined
    };

    if (settings.showHeader === false) {
      settings.repeatHeader = false;
    }

    const normalized = normalizePrintSettings(settings, this.eventPrintSettings || DEFAULT_PRINT_SETTINGS);
    logPrintInfo("Read event print settings from form", normalized);
    return normalized;
  }

  setupEventPrintPreview() {
    const loadedSettings = this.loadEventPrintSettings();
    this.eventPrintSettings = normalizePrintSettings(loadedSettings, DEFAULT_PRINT_SETTINGS);
    this.applyEventPrintSettingsToForm(this.eventPrintSettings);

    const syncHeaderControls = () => {
      if (!this.dom.printShowHeaderInput || !this.dom.printRepeatHeaderInput) return;
      const enabled = Boolean(this.dom.printShowHeaderInput.checked);
      this.dom.printRepeatHeaderInput.disabled = !enabled;
      if (!enabled) {
        this.dom.printRepeatHeaderInput.checked = false;
      }
    };

    const syncCustomSizeVisibility = () => {
      if (!this.dom.printPaperSizeInput || !this.dom.printCustomSizeField) return;
      const isCustom = this.dom.printPaperSizeInput.value === "Custom";
      this.dom.printCustomSizeField.hidden = !isCustom;
    };

    this.eventPrintPreviewController = createPrintPreviewController({
      previewContainer: this.dom.printPreview,
      previewFrame: this.dom.printPreviewFrame,
      previewMeta: this.dom.printPreviewMeta,
      previewNote: this.dom.printPreviewNote,
      previewPrintButton: this.dom.printPreviewPrintButton,
      previewDialog: this.dom.printPreviewDialog,
      defaultNote: DEFAULT_PREVIEW_NOTE,
      loadTimeoutMs: DEFAULT_LOAD_TIMEOUT_MS,
      defaultSettings: () => this.eventPrintSettings || DEFAULT_PRINT_SETTINGS,
      normalizeSettings: (settings, fallback) => normalizePrintSettings(settings, fallback),
      onCacheChange: (nextCache) => {
        this.eventPrintPreviewCache = nextCache;
      },
      openDialog: (element) => this.openDialog(element),
      closeDialog: (element) => this.closeDialog(element)
    });

    this.eventPrintPreviewCache = this.eventPrintPreviewController.getCache();
    syncHeaderControls();
    syncCustomSizeVisibility();

    if (this.dom.printShowHeaderInput) {
      this.dom.printShowHeaderInput.addEventListener("change", syncHeaderControls);
    }
    if (this.dom.printPaperSizeInput) {
      this.dom.printPaperSizeInput.addEventListener("change", syncCustomSizeVisibility);
    }

    if (this.dom.printSettingsForm) {
      this.dom.printSettingsForm.addEventListener("change", () => {
        const settings = this.readEventPrintSettingsFromForm();
        this.persistEventPrintSettings(settings);
        this.updateEventPrintPreview({ autoPrint: false, forceReveal: true, quiet: true });
      });

      this.dom.printSettingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const settings = this.readEventPrintSettingsFromForm();
        this.persistEventPrintSettings(settings);
        this.updateEventPrintPreview({ autoPrint: false, forceReveal: true });
      });
    }

    if (this.dom.printPreviewCloseButton) {
      this.dom.printPreviewCloseButton.addEventListener("click", () => {
        this.closeEventPrintPreview();
      });
    }

    if (this.dom.printPreviewPrintButton) {
      this.dom.printPreviewPrintButton.addEventListener("click", () => {
        if (this.dom.printPreviewPrintButton.disabled) {
          return;
        }
        this.printEventPreview({ showAlertOnFailure: true });
      });
    }
  }

  ensureEventPrintDialogVisible() {
    if (!this.dom.printPreviewDialog) {
      logPrintWarn("Print preview dialog is missing; cannot reveal preview");
      return;
    }

    if (this.eventPrintPreviewController) {
      this.eventPrintPreviewController.setVisibility(true);
    }

    // フォールバックとして必ずダイアログを開く
    this.openDialog(this.dom.printPreviewDialog);
  }

  updateEventPrintPreview({ autoPrint = false, forceReveal = false, quiet = false, mode } = {}) {
    if (!this.eventPrintPreviewController) {
      return false;
    }

    const effectiveMode = mode || this.eventPrintPreviewMode || "events";
    this.eventPrintPreviewMode = effectiveMode;

    const printSettings = this.readEventPrintSettingsFromForm();
    this.persistEventPrintSettings(printSettings);

    if (effectiveMode === "glShift") {
      if (!this.tools?.gl) {
        logPrintWarn("GL print requested but GL tool is unavailable");
        return false;
      }

      const preview = this.tools.gl.buildShiftTablePrintPreview({ printSettings });

      if (forceReveal) {
        this.ensureEventPrintDialogVisible();
      }

      if (!preview || !preview.html) {
        const message = preview?.message || "印刷できるシフト情報がありません。";
        this.eventPrintPreviewController.setVisibility(true);
        this.eventPrintPreviewController.setNote(message, {
          forceAnnounce: true,
          politeness: "assertive",
          role: "alert"
        });
        if (this.dom.printPreviewPrintButton) {
          this.dom.printPreviewPrintButton.disabled = true;
          delete this.dom.printPreviewPrintButton.dataset.popupFallback;
        }
        return false;
      }

      return this.eventPrintPreviewController.renderPreview({
        html: preview.html,
        metaText: preview.metaText,
        title: preview.docTitle,
        autoPrint,
        printSettings
      });
    }

    const events = Array.isArray(this.events) ? this.events : [];
    if (!events.length) {
      this.eventPrintPreviewController.setVisibility(true);
      this.eventPrintPreviewController.setNote("印刷できるイベントがありません。まずはイベントを登録してください。", {
        forceAnnounce: true,
        politeness: "assertive",
        role: "alert"
      });
      if (this.dom.printPreviewMeta) {
        this.dom.printPreviewMeta.textContent = "";
      }
      if (this.dom.printPreviewPrintButton) {
        this.dom.printPreviewPrintButton.disabled = true;
        delete this.dom.printPreviewPrintButton.dataset.popupFallback;
      }
      if (!quiet) {
        this.showAlert("印刷できるイベントがありません。まずはイベントを登録してください。");
      }
      return false;
    }

    const { html, docTitle, metaText } = buildEventSelectionPrintHtml({
      events,
      generatedAt: new Date(),
      printOptions: printSettings
    });

    if (forceReveal) {
      this.ensureEventPrintDialogVisible();
    }

    return this.eventPrintPreviewController.renderPreview({
      html,
      metaText,
      title: docTitle,
      autoPrint,
      printSettings
    });
  }

  printEventPreview(options = {}) {
    if (!this.eventPrintPreviewController) {
      return false;
    }
    return this.eventPrintPreviewController.printPreview(options);
  }

  closeEventPrintPreview() {
    if (!this.eventPrintPreviewController) {
      return;
    }
    this.eventPrintPreviewController.reset();
    this.eventPrintPreviewController.setVisibility(false);
  }

  handleEventPrint() {
    this.eventPrintPreviewMode = "events";
    this.ensureEventPrintDialogVisible();
    const updated = this.updateEventPrintPreview({ autoPrint: false, forceReveal: true, mode: "events" });
    if (updated) {
      logPrintInfo("Triggered event selection print", { eventCount: this.events.length });
    }
  }

  handleGlPrint() {
    if (!this.eventPrintPreviewController || !this.tools?.gl) {
      logPrintWarn("GL print requested but preview controller is unavailable");
      return false;
    }

    this.eventPrintPreviewMode = "glShift";
    return this.updateEventPrintPreview({ autoPrint: false, forceReveal: true, mode: "glShift" });
  }

  updateSelectionNotes() {
    // EventUIRenderer に委譲
    this.uiRenderer.updateSelectionNotes();
  }

  setStage(stage) {
    // EventNavigationManager に委譲
    this.navigationManager.setStage(stage);
    // EventNavigationManager のプロパティを app に同期
    this.stage = this.navigationManager.stage;
    this.stageHistory = this.navigationManager.stageHistory;
  }

  canActivatePanel(panel, config = PANEL_CONFIG[panel]) {
    // EventNavigationManager に委譲
    return this.navigationManager.canActivatePanel(panel, config);
  }

  showPanel(panel) {
    // EventNavigationManager に委譲
    this.navigationManager.showPanel(panel);
    // EventNavigationManager のプロパティを app に同期
    this.activePanel = this.navigationManager.activePanel;
    this.stage = this.navigationManager.stage;
    this.stageHistory = this.navigationManager.stageHistory;
  }

  async handlePanelSetup(panel, config) {
    // EventNavigationManager に委譲
    return await this.navigationManager.handlePanelSetup(panel, config);
  }

  getOperatorPanelFallbackTarget({ preferSchedules = false } = {}) {
    // EventNavigationManager に委譲
    return this.navigationManager.getOperatorPanelFallbackTarget({ preferSchedules });
  }

  getPanelModules() {
    // EventNavigationManager に委譲
    return this.navigationManager.getPanelModules();
  }

  setModuleVisibility(module, isVisible) {
    // EventNavigationManager に委譲
    this.navigationManager.setModuleVisibility(module, isVisible);
  }

  updatePanelVisibility() {
    // EventNavigationManager に委譲
    this.navigationManager.updatePanelVisibility();
  }

  updatePanelNavigation() {
    // EventNavigationManager に委譲
    this.navigationManager.updatePanelNavigation();
    // EventNavigationManager のプロパティを app に同期
    this.activePanel = this.navigationManager.activePanel;
  }

  updateNavigationButtons() {
    // EventNavigationManager に委譲
    this.navigationManager.updateNavigationButtons();
  }

  updateSidebarButtons() {
    // EventNavigationManager に委譲
    this.navigationManager.updateSidebarButtons();
  }

  clearPendingNavigationTimer() {
    // EventNavigationManager に委譲
    this.navigationManager.clearPendingNavigationTimer();
    // EventNavigationManager のプロパティを app に同期
    this.pendingNavigationClearTimer = this.navigationManager.pendingNavigationClearTimer;
  }

  schedulePendingNavigationClear() {
    // EventNavigationManager に委譲
    this.navigationManager.schedulePendingNavigationClear();
    // EventNavigationManager のプロパティを app に同期
    this.pendingNavigationClearTimer = this.navigationManager.pendingNavigationClearTimer;
    this.pendingNavigationTarget = this.navigationManager.pendingNavigationTarget;
    this.pendingNavigationMeta = this.navigationManager.pendingNavigationMeta;
  }

  async handleFlowNavigation(target, { sourceButton = null, originPanel: providedOriginPanel = null } = {}) {
    let normalized = PANEL_CONFIG[target] ? target : "events";
    const originPanel = providedOriginPanel || sourceButton?.closest("[data-panel]")?.dataset?.panel || "";
    let config = PANEL_CONFIG[normalized] || PANEL_CONFIG.events;
    this.clearPendingNavigationTimer();
    this.pendingNavigationTarget = "";
    this.navigationManager.pendingNavigationTarget = "";
    this.awaitingScheduleConflictPrompt = false;
    this.pendingNavigationMeta = null;
    this.navigationManager.pendingNavigationMeta = null;
    this.logFlowState("フローナビゲーションが要求されました", {
      target: normalized,
      originPanel
    });
    if (normalized === "operator" && this.operatorMode !== OPERATOR_MODE_TELOP) {
      const fallbackTarget = this.getOperatorPanelFallbackTarget();
      this.logFlowState("テロップ操作なしモードのためテロップ操作パネルへの移動をスキップします", {
        requestedTarget: normalized,
        fallbackTarget
      });
      if (!fallbackTarget || fallbackTarget === "operator") {
        return;
      }
      normalized = fallbackTarget;
      config = PANEL_CONFIG[normalized] || PANEL_CONFIG.events;
    }
    if (
      normalized === "participants" &&
      originPanel === "schedules" &&
      config.requireSchedule &&
      this.selectedEventId
    ) {
      const modeChoice = await this.requestOperatorModeChoice({
        schedule: this.getSelectedSchedule(),
        defaultMode: this.operatorMode,
        reason: "navigation"
      });
      if (!modeChoice) {
        this.lastScheduleCommitChanged = false;
        return;
      }
      const normalizedModeChoice = normalizeOperatorMode(modeChoice);
      if (normalizedModeChoice !== this.operatorMode) {
        this.setOperatorMode(normalizedModeChoice, { fromControl: true });
      }
      if (normalizedModeChoice === OPERATOR_MODE_SUPPORT) {
        this.pendingNavigationTarget = "";
        this.navigationManager.pendingNavigationTarget = "";
        this.pendingNavigationMeta = null;
        this.navigationManager.pendingNavigationMeta = null;
        this.awaitingScheduleConflictPrompt = false;
        this.setHostCommittedSchedule("", {
          reason: "support-mode",
          sync: true,
          updateContext: true,
          force: true
        });
        this.syncScheduleConflictPromptState();
        this.lastScheduleCommitChanged = false;
      } else {
        this.pendingNavigationTarget = normalized;
        this.navigationManager.pendingNavigationTarget = normalized;
        this.pendingNavigationMeta = {
          target: normalized,
          originPanel,
          reason: "flow-navigation"
        };
        this.navigationManager.pendingNavigationMeta = this.pendingNavigationMeta;
        this.awaitingScheduleConflictPrompt = true;
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[handleFlowNavigation] About to call commitSelectedScheduleForTelop", {
            selectedScheduleId: ensureString(this.selectedScheduleId) || "(empty)",
            selectedEventId: ensureString(this.selectedEventId) || "(empty)",
            hostCommittedScheduleId: ensureString(this.hostCommittedScheduleId) || "(empty)"
          });
        }
        const committed = this.commitSelectedScheduleForTelop({ reason: "navigation" });
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[handleFlowNavigation] commitSelectedScheduleForTelop returned", {
            committed,
            selectedScheduleId: ensureString(this.selectedScheduleId) || "(empty)"
          });
        }
        if (!committed) {
          this.pendingNavigationTarget = "";
          this.navigationManager.pendingNavigationTarget = "";
          this.pendingNavigationMeta = null;
          this.navigationManager.pendingNavigationMeta = null;
          this.awaitingScheduleConflictPrompt = false;
          this.syncScheduleConflictPromptState();
          this.lastScheduleCommitChanged = false;
          return;
        }
        const context = this.buildScheduleConflictContext();
        this.scheduleConflictContext = context;
        if (context.hasConflict) {
          this.clearPendingNavigationTimer();
          this.awaitingScheduleConflictPrompt = false;
          void this.requestScheduleConflictPrompt(context);
          this.openScheduleConflictDialog(context, {
            reason: "navigation",
            originPanel,
            target: normalized
          });
          this.syncScheduleConflictPromptState(context);
          this.lastScheduleCommitChanged = false;
          return;
        }
        this.schedulePendingNavigationClear();
        this.enforceScheduleConflictState(context);
        this.syncScheduleConflictPromptState(context);
        this.lastScheduleCommitChanged = false;
      }
    }
    this.schedulePendingNavigationClear();
    if (normalized === "schedules") {
      const confirmed = this.confirmEventSelection({ reason: "event-confirm" });
      if (!confirmed) {
        this.lastScheduleCommitChanged = false;
        return;
      }
    }
    this.showPanel(normalized);
    this.logFlowState("フローナビゲーションを実行しました", {
      target: normalized,
      originPanel
    });
  }

  isScheduleConflictDialogOpen() {
    return Boolean(this.dom.scheduleConflictDialog && !this.dom.scheduleConflictDialog.hasAttribute("hidden"));
  }

  clearScheduleConflictError() {
    if (this.dom.scheduleConflictError) {
      this.dom.scheduleConflictError.hidden = true;
      this.dom.scheduleConflictError.textContent = "";
    }
  }

  setScheduleConflictError(message = "") {
    if (!this.dom.scheduleConflictError) {
      return;
    }
    const trimmed = String(message || "").trim();
    if (!trimmed) {
      this.clearScheduleConflictError();
      return;
    }
    this.dom.scheduleConflictError.hidden = false;
    this.dom.scheduleConflictError.textContent = trimmed;
  }

  renderScheduleConflictDialog(context = null) {
    if (!context) {
      context = this.buildScheduleConflictContext();
    }
    const description = this.dom.scheduleConflictDescription;
    if (description) {
      if (!description.dataset.defaultText) {
        description.dataset.defaultText = description.textContent || "";
      }
      const event = this.getSelectedEvent();
      const eventName = event?.name || event?.id || "";
      if (eventName) {
        description.textContent = `イベント「${eventName}」で複数の日程が選択されています。テロップ操作パネルで操作する日程を選んでください。`;
      } else {
        description.textContent = description.dataset.defaultText || description.textContent || "";
      }
    }
    this.renderScheduleConflictPresence(context);
    this.renderScheduleConflictOptions(context);
  }

  openScheduleConflictDialog(context = null, meta = {}) {
    // EventUIRenderer に委譲
    this.uiRenderer.openScheduleConflictDialog(context, meta);
  }

  renderScheduleConflictPresence(context = null) {
    const list = this.dom.scheduleConflictPresence;
    const placeholder = this.dom.scheduleConflictPresenceEmpty;
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const options = Array.isArray(context?.options) ? context.options : [];
    if (!options.length) {
      list.hidden = true;
      if (placeholder) {
        placeholder.hidden = false;
      }
      return;
    }
    list.hidden = false;
    if (placeholder) {
      placeholder.hidden = true;
    }
    options.forEach((option) => {
      const item = document.createElement("li");
      item.className = "channel-presence-group";
      if (option.containsSelf) {
        item.classList.add("is-active");
      }
      const label = document.createElement("div");
      label.className = "channel-presence-group__label";
      const rangeText = option.scheduleRange ? `（${option.scheduleRange}）` : "";
      label.textContent = option.scheduleLabel ? `${option.scheduleLabel}${rangeText}` : `未選択${rangeText}`;
      item.appendChild(label);
      const members = document.createElement("div");
      members.className = "channel-presence-group__names";
      if (Array.isArray(option.members) && option.members.length) {
        option.members.forEach((member) => {
          const entry = document.createElement("span");
          entry.className = "channel-presence-group__name";
          entry.textContent = member.displayName || member.uid || "—";
          if (member.isSelf) {
            const badge = document.createElement("span");
            badge.className = "channel-presence-self";
            badge.textContent = "自分";
            entry.appendChild(badge);
          }
          if (member.skipTelop) {
            const badge = document.createElement("span");
            badge.className = "channel-presence-support";
            badge.textContent = "テロップ操作なし";
            entry.appendChild(badge);
          }
          members.appendChild(entry);
        });
      } else {
        const empty = document.createElement("span");
        empty.className = "channel-presence-group__name";
        empty.textContent = "オペレーターなし";
        members.appendChild(empty);
      }
      item.appendChild(members);
      list.appendChild(item);
    });
  }

  renderScheduleConflictOptions(context = null) {
    const container = this.dom.scheduleConflictOptions;
    if (!container) {
      return;
    }
    const legend = container.querySelector("legend");
    container.innerHTML = "";
    if (legend) {
      container.appendChild(legend);
    }
    const options = Array.isArray(context?.selectableOptions) && context.selectableOptions.length
      ? context.selectableOptions
      : Array.isArray(context?.options)
        ? context.options.filter((option) => option.isSelectable)
        : [];
    if (!options.length) {
      const helper = document.createElement("p");
      helper.className = "modal-helper";
      helper.textContent = "選択できる日程がありません。いずれかのオペレーターが日程を選択するまでお待ちください。";
      container.appendChild(helper);
      return;
    }
    const eventId = ensureString(context?.eventId || this.selectedEventId);
    const updateSelectionState = () => {
      const wrappers = container.querySelectorAll(".conflict-option");
      wrappers.forEach((wrapperEl) => {
        const input = wrapperEl.querySelector(`input[name="${this.scheduleConflictRadioName}"]`);
        wrapperEl.classList.toggle("is-selected", Boolean(input?.checked));
      });
    };
    const defaultKey = context?.hostScheduleKey || context?.defaultKey || options[0]?.key || "";
    options.forEach((option, index) => {
      const optionId = `flow-schedule-conflict-option-${index}`;
      const wrapper = document.createElement("label");
      wrapper.className = "conflict-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = optionId;
      radio.name = this.scheduleConflictRadioName;
      const scheduleId = option.scheduleId || this.extractScheduleIdFromKey(option.key, eventId);
      const radioValue = option.key || this.derivePresenceScheduleKey(eventId, {
        scheduleId,
        scheduleLabel: option.scheduleLabel
      });
      radio.value = radioValue || "";
      radio.className = "visually-hidden";
      radio.required = true;
      radio.dataset.scheduleId = scheduleId || "";
      wrapper.dataset.scheduleId = scheduleId || "";
      wrapper.dataset.scheduleKey = radioValue || "";
      wrapper.dataset.containsSelf = option.containsSelf ? "true" : "false";
      const shouldCheck = option.key === defaultKey || (!defaultKey && index === 0);
      if (shouldCheck) {
        radio.checked = true;
      }
      radio.addEventListener("change", updateSelectionState);
      wrapper.appendChild(radio);

      const header = document.createElement("div");
      header.className = "conflict-option__header";
      const title = document.createElement("span");
      title.className = "conflict-option__title";
      title.textContent = option.scheduleLabel || "未選択";
      header.appendChild(title);
      if (option.scheduleRange) {
        const meta = document.createElement("span");
        meta.className = "conflict-option__meta";
        meta.textContent = option.scheduleRange;
        header.appendChild(meta);
      }
      wrapper.appendChild(header);

      const membersLine = document.createElement("div");
      membersLine.className = "conflict-option__members";
      if (Array.isArray(option.members) && option.members.length) {
          const names = option.members.map((member) => {
            let text = member.displayName || member.uid || "—";
            const badges = [];
            if (member.isSelf) {
              badges.push("自分");
            }
            if (member.skipTelop) {
              badges.push("テロップ操作なし");
            }
            if (badges.length) {
              text += `（${badges.join("・")}）`;
            }
            return text;
          });
        membersLine.textContent = names.join("、");
      } else {
        membersLine.textContent = "選択しているオペレーターはいません";
      }
      wrapper.appendChild(membersLine);

      container.appendChild(wrapper);
    });
    updateSelectionState();
  }

  buildPresenceScheduleKey(eventId, payload = {}, entryId = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.buildPresenceScheduleKey(eventId, payload, entryId);
  }

  extractScheduleIdFromKey(scheduleKey, eventId = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.extractScheduleIdFromKey(scheduleKey, eventId);
  }

  normalizeOperatorPresenceEntries(raw = {}, eventId = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.normalizeOperatorPresenceEntries(raw, eventId);
  }

  buildScheduleConflictContext() {
    // EventUIRenderer に委譲
    return this.uiRenderer.buildScheduleConflictContext();
  }

  syncScheduleConflictPromptState(context = null) {
    // EventUIRenderer に委譲
    this.uiRenderer.syncScheduleConflictPromptState(context);
  }

  updateScheduleConflictState() {
    // EventUIRenderer に委譲
    this.uiRenderer.updateScheduleConflictState();
  }

  enforceScheduleConflictState(context = null) {
    // EventUIRenderer に委譲
    this.uiRenderer.enforceScheduleConflictState(context);
  }

  syncOperatorPresenceSubscription() {
    // EventFirebaseManager に委譲
    this.firebaseManager.syncOperatorPresenceSubscription();
    // プロパティを同期
    this.operatorPresenceEventId = this.firebaseManager.operatorPresenceEventId;
    this.operatorPresenceUnsubscribe = this.firebaseManager.operatorPresenceUnsubscribe;
    this.operatorPresenceEntries = this.firebaseManager.operatorPresenceEntries;
  }

  syncScheduleConsensusSubscription() {
    // EventFirebaseManager に委譲
    this.firebaseManager.syncScheduleConsensusSubscription();
    // プロパティを同期
    this.scheduleConsensusEventId = this.firebaseManager.scheduleConsensusEventId;
    this.scheduleConsensusUnsubscribe = this.firebaseManager.scheduleConsensusUnsubscribe;
    this.scheduleConsensusState = this.firebaseManager.scheduleConsensusState;
    this.scheduleConsensusLastSignature = this.firebaseManager.scheduleConsensusLastSignature;
    this.scheduleConsensusLastKey = this.firebaseManager.scheduleConsensusLastKey;
    // app固有の処理
    this.hideScheduleConsensusToast();
  }

  clearScheduleConsensusState({ reason = "" } = {}) {
    // EventFirebaseManager に委譲
    this.firebaseManager.clearScheduleConsensusState({ reason });
    // プロパティを同期
    this.scheduleConsensusEventId = this.firebaseManager.scheduleConsensusEventId;
    this.scheduleConsensusUnsubscribe = this.firebaseManager.scheduleConsensusUnsubscribe;
    this.scheduleConsensusState = this.firebaseManager.scheduleConsensusState;
    this.scheduleConsensusLastSignature = this.firebaseManager.scheduleConsensusLastSignature;
    this.scheduleConsensusLastKey = this.firebaseManager.scheduleConsensusLastKey;
    // app固有のプロパティをクリア
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.hideScheduleConsensusToast();
  }

  normalizeScheduleConsensus(raw = null) {
    // EventFirebaseManager に委譲
    return this.firebaseManager.normalizeScheduleConsensus(raw);
  }

  scheduleHostPresenceHeartbeat() {
    // EventFirebaseManager に委譲
    this.firebaseManager.scheduleHostPresenceHeartbeat();
    // プロパティを同期
    this.hostPresenceHeartbeat = this.firebaseManager.hostPresenceHeartbeat;
  }

  clearHostPresence() {
    // EventFirebaseManager に委譲
    this.firebaseManager.clearHostPresence();
    // プロパティを同期
    this.hostPresenceEntryKey = this.firebaseManager.hostPresenceEntryKey;
    this.hostPresenceEntryRef = this.firebaseManager.hostPresenceEntryRef;
    this.hostPresenceDisconnect = this.firebaseManager.hostPresenceDisconnect;
    this.hostPresenceHeartbeat = this.firebaseManager.hostPresenceHeartbeat;
    this.hostPresenceLastSignature = this.firebaseManager.hostPresenceLastSignature;
  }

  handleScheduleConsensusUpdate(eventId, consensus) {
    if (!eventId || eventId !== ensureString(this.selectedEventId)) {
      if (!consensus) {
        this.hideScheduleConsensusToast();
      }
      return;
    }
    this.scheduleConsensusState = consensus || null;
    if (!consensus) {
      if (this.scheduleConsensusLastSignature || this.scheduleConsensusLastKey) {
        this.logFlowState("スケジュール合意情報をクリアしました", {
          eventId
        });
      }
      this.scheduleConsensusLastSignature = "";
      this.scheduleConsensusLastKey = "";
      this.scheduleConflictPromptSignature = "";
      this.scheduleConflictLastPromptSignature = "";
      this.hideScheduleConsensusToast();
      return;
    }
    const signature = consensus.conflictSignature || "";
    const key = consensus.scheduleKey || "";
    const changed =
      this.scheduleConsensusLastSignature !== signature ||
      this.scheduleConsensusLastKey !== key;
    if (changed) {
      this.logFlowState("スケジュール合意情報を受信しました", {
        eventId,
        conflictSignature: signature,
        scheduleKey: key,
        scheduleId: consensus.scheduleId || "",
        resolvedByUid: consensus.resolvedByUid || ""
      });
      this.scheduleConsensusLastSignature = signature;
      this.scheduleConsensusLastKey = key;
      if (signature && key) {
        this.scheduleConflictPromptSignature = "";
        this.scheduleConflictLastPromptSignature = "";
        this.applyScheduleConsensus(consensus);
      } else if (signature && !key) {
        this.scheduleConflictPromptSignature = signature;
        this.hideScheduleConsensusToast();
        this.handleScheduleConsensusPrompt(consensus);
      } else {
        this.hideScheduleConsensusToast();
      }
    }
  }

  handleScheduleConsensusPrompt(consensus) {
    if (!consensus) {
      return;
    }
    const signature = ensureString(consensus.conflictSignature);
    if (!signature) {
      return;
    }
    const context = this.scheduleConflictContext || this.buildScheduleConflictContext();
    this.scheduleConflictContext = context;
    if (!context?.hasConflict || ensureString(context.signature) !== signature) {
      return;
    }
    this.scheduleConflictContext = context;
    if (context?.signature) {
      this.scheduleConflictLastSignature = context.signature;
    }
    this.syncScheduleConflictPromptState(context);
    this.logFlowState("スケジュール合意の確認が保留中です", {
      eventId: context?.eventId || "",
      conflictSignature: signature,
      originPanel: this.activePanel,
      pendingNavigationTarget: this.pendingNavigationTarget || ""
    });

    const requestedBySessionId = ensureString(consensus.requestedBySessionId);
    const hostSessionId = ensureString(this.hostPresenceSessionId);
    const isRequester = requestedBySessionId && requestedBySessionId === hostSessionId;
    const hasCommittedSchedule = Boolean(ensureString(this.hostCommittedScheduleId));
    const hasSelection = Boolean(ensureString(this.selectedScheduleId));
    if (!isRequester && hasCommittedSchedule && hasSelection && !this.isScheduleConflictDialogOpen()) {
      this.openScheduleConflictDialog(context, {
        reason: "consensus-prompt",
        originPanel: this.activePanel,
        target: this.activePanel
      });
    }
  }

  applyScheduleConsensus(consensus) {
    if (!consensus) {
      return;
    }
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      return;
    }
    this.setScheduleConflictSubmitting(false);
    const scheduleKey = ensureString(consensus.scheduleKey);
    let scheduleId = ensureString(consensus.scheduleId);
    const context = this.scheduleConflictContext || this.buildScheduleConflictContext();
    const options = Array.isArray(context?.selectableOptions) && context.selectableOptions.length
      ? context.selectableOptions
      : Array.isArray(context?.options)
        ? context.options
        : [];
    let option = null;
    if (options.length) {
      option =
        options.find((item) => {
          if (scheduleKey && item.key === scheduleKey) return true;
          if (scheduleId && item.scheduleId === scheduleId) return true;
          return false;
        }) || null;
    }
    if (!scheduleId && option && option.scheduleId) {
      scheduleId = option.scheduleId;
    }
    if (this.dom.scheduleConflictForm) {
      this.dom.scheduleConflictForm.reset();
    }
    if (this.dom.scheduleConflictDialog) {
      this.closeDialog(this.dom.scheduleConflictDialog);
    }
    this.clearScheduleConflictError();
    const navMeta = this.pendingNavigationMeta;
    const pendingTarget = this.pendingNavigationTarget || "";
    this.pendingNavigationTarget = "";
    this.navigationManager.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
    this.navigationManager.pendingNavigationMeta = null;
    this.awaitingScheduleConflictPrompt = false;
    this.clearPendingNavigationTimer();
    let resolvedTarget = pendingTarget;
    let usedFallback = false;
    const metaOrigin = navMeta?.originPanel || "";
    const metaTarget = navMeta?.target || "";
    const isFlowFromSchedules =
      navMeta?.reason === "flow-navigation" && metaOrigin === "schedules";
    if (!resolvedTarget && metaTarget) {
      resolvedTarget = metaTarget;
      usedFallback = resolvedTarget !== pendingTarget;
    }
    if (isFlowFromSchedules) {
      const preferredTarget = metaTarget && metaTarget !== metaOrigin ? metaTarget : "";
      const fallbackTarget = preferredTarget || "participants";
      if (resolvedTarget !== fallbackTarget) {
        usedFallback = usedFallback || resolvedTarget !== pendingTarget;
        resolvedTarget = fallbackTarget;
      }
    }
    if (resolvedTarget) {
      this.showPanel(resolvedTarget);
      const message = usedFallback
        ? "スケジュール合意の適用により参加者パネルへ移動しました"
        : "スケジュール合意の適用後に保留していたパネルを開きます";
      this.logFlowState(message, {
        target: resolvedTarget,
        scheduleId: scheduleId || "",
        scheduleKey
      });
    }
    const fallbackSchedule = scheduleId
      ? this.schedules.find((schedule) => schedule.id === scheduleId) || null
      : null;
    const label = option?.scheduleLabel || ensureString(consensus.scheduleLabel) || fallbackSchedule?.label || scheduleId || "";
    let range = option?.scheduleRange || ensureString(consensus.scheduleRange);
    if (!range && fallbackSchedule) {
      range = formatScheduleRange(fallbackSchedule.startAt, fallbackSchedule.endAt);
    }
    const byline = ensureString(consensus.resolvedByDisplayName) || ensureString(consensus.resolvedByUid);
    this.logFlowState("スケジュール合意を適用しました", {
      eventId,
      scheduleId: scheduleId || "",
      scheduleKey,
      label,
      range,
      byline
    });
    this.showScheduleConsensusToast({ label, range, byline });
    const selectedScheduleId = ensureString(this.selectedScheduleId);
    const committedScheduleId = ensureString(this.hostCommittedScheduleId);
    const selectionMatches = Boolean(scheduleId) && scheduleId === selectedScheduleId;
    const shouldFollow = Boolean(scheduleId) &&
      (scheduleId === committedScheduleId || selectionMatches || (!selectedScheduleId && scheduleId));
    if (shouldFollow) {
      if (!selectionMatches && scheduleId && this.schedules.some((schedule) => schedule.id === scheduleId)) {
        this.selectSchedule(scheduleId);
      }
      this.setHostCommittedSchedule(scheduleId, {
        schedule: fallbackSchedule,
        reason: "consensus-apply",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
    } else if (scheduleId && selectedScheduleId && scheduleId !== selectedScheduleId) {
      const currentSchedule = this.schedules.find((schedule) => schedule.id === selectedScheduleId) || null;
      const currentLabel = currentSchedule?.label || selectedScheduleId;
      this.setHostCommittedSchedule("", {
        reason: "consensus-pending",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      if (this.operatorMode === OPERATOR_MODE_SUPPORT) {
        this.logFlowState("テロップ操作なしモードのためスケジュール合意モーダルを表示しません", {
          consensusScheduleId: scheduleId,
          currentScheduleId: selectedScheduleId,
          consensusLabel: label || "",
          consensusRange: range || ""
        });
      } else {
        const conflictContext =
          (this.scheduleConflictContext &&
            ensureString(this.scheduleConflictContext?.signature) === ensureString(consensus.conflictSignature))
            ? this.scheduleConflictContext
            : this.buildScheduleConflictContext();
        this.openScheduleFallbackDialog({
          consensusScheduleId: scheduleId,
          consensusLabel: label,
          consensusRange: range,
          consensusByline: byline,
          currentScheduleId: selectedScheduleId,
          currentScheduleLabel: currentLabel,
          conflictContext,
          pendingNavigationTarget: this.pendingNavigationTarget || ""
        });
      }
    } else if (scheduleId) {
      this.setHostCommittedSchedule(scheduleId, {
        schedule: fallbackSchedule,
        reason: "consensus-align",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
    } else {
      this.setHostCommittedSchedule("", {
        reason: "consensus-clear",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
    }
    this.syncScheduleConflictPromptState();
  }

  showScheduleConsensusToast({ label = "", range = "", byline = "" } = {}) {
    // EventUIRenderer に委譲
    return this.uiRenderer.showScheduleConsensusToast({ label, range, byline });
  }

  hideScheduleConsensusToast() {
    // EventUIRenderer に委譲
    return this.uiRenderer.hideScheduleConsensusToast();
  }

  maybeClearScheduleConsensus(context = null) {
    // EventFirebaseManager に委譲
    return this.firebaseManager.maybeClearScheduleConsensus(context);
  }

  setHostCommittedSchedule(
    scheduleId,
    {
      schedule = null,
      reason = "state-change",
      sync = true,
      updateContext = true,
      force = false,
      suppressConflictPrompt = false
    } = {}
  ) {
    // EventFirebaseManager に委譲（Firebase関連の処理）
    const changed = this.firebaseManager.setHostCommittedSchedule(scheduleId, {
      schedule,
      reason,
      sync,
      force
    });
    
    const normalizedId = ensureString(scheduleId);
    
    // UI関連の処理
    if (suppressConflictPrompt) {
      this.suppressScheduleConflictPromptOnce = true;
    }
    if (updateContext) {
      this.uiRenderer.updateScheduleConflictState();
    }
    if (changed) {
      this.logFlowState("テロップ操作用のコミット済み日程を更新しました", {
        scheduleId: normalizedId || "",
        scheduleLabel: this.hostCommittedScheduleLabel || "",
        reason
      });
      this.renderScheduleList();
      this.uiRenderer.updateScheduleSummary();
      this.navigationManager.updateStageHeader();
      this.uiRenderer.updateSelectionNotes();
    }
    if (normalizedId && this.shouldAutoLockDisplaySchedule(reason)) {
      const resolvedSchedule = schedule || this.schedules.find((item) => item.id === normalizedId) || null;
      this.requestDisplayScheduleLockWithRetry(normalizedId, {
        schedule: resolvedSchedule,
        reason
      });
    }
    return changed;
  }

  shouldAutoLockDisplaySchedule(reason = "") {
    // DisplayLockManager に委譲
    return this.displayLockManager.shouldAutoLockDisplaySchedule(reason);
  }

  async requestDisplayScheduleLock(scheduleId, { schedule = null, reason = "" } = {}) {
    // DisplayLockManager に委譲
    return this.displayLockManager.requestDisplayScheduleLock(scheduleId, { schedule, reason });
  }

  requestDisplayScheduleLockWithRetry(scheduleId, { schedule = null, reason = "" } = {}) {
    // DisplayLockManager に委譲
    return this.displayLockManager.requestDisplayScheduleLockWithRetry(scheduleId, { schedule, reason });
  }

  async performDisplayLockAttempt() {
    // DisplayLockManager に委譲
    return this.displayLockManager.performDisplayLockAttempt();
  }

  scheduleDisplayLockRetry(scheduleId, { schedule = null, reason = "" } = {}) {
    // DisplayLockManager に委譲
    return this.displayLockManager.scheduleDisplayLockRetry(scheduleId, { schedule, reason });
  }

  clearDisplayLockRetryTimer() {
    // DisplayLockManager に委譲
    return this.displayLockManager.clearDisplayLockRetryTimer();
  }

  clearPendingDisplayLock() {
    // DisplayLockManager に委譲
    return this.displayLockManager.clearPendingDisplayLock();
  }

  getHostPresenceStorage() {
    // EventFirebaseManager に委譲
    return this.firebaseManager.getHostPresenceStorage();
  }

  getHostPresenceStorageKey(uid = "", eventId = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.getHostPresenceStorageKey(uid, eventId);
  }

  loadStoredHostPresenceSessionId(uid = "", eventId = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.loadStoredHostPresenceSessionId(uid, eventId);
  }

  persistHostPresenceSessionId(uid = "", eventId = "", sessionId = "") {
    // EventFirebaseManager に委譲
    this.firebaseManager.persistHostPresenceSessionId(uid, eventId, sessionId);
  }

  collectLocalHostPresenceEntries(presenceEntries = [], uid = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.collectLocalHostPresenceEntries(presenceEntries, uid);
  }

  async fetchHostPresenceEntries(eventId = "", uid = "") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.fetchHostPresenceEntries(eventId, uid);
  }

  pruneHostPresenceEntries(eventId = "", entries = [], sessionId = "") {
    // EventFirebaseManager に委譲
    this.firebaseManager.pruneHostPresenceEntries(eventId, entries, sessionId);
  }

  async reconcileHostPresenceSessions(eventId = "", uid = "", sessionId = "", prefetchedEntries = null) {
    // EventFirebaseManager に委譲
    await this.firebaseManager.reconcileHostPresenceSessions(eventId, uid, sessionId, prefetchedEntries);
    // プロパティを同期
    this.hostPresenceSessionId = this.firebaseManager.hostPresenceSessionId;
    this.hostPresenceEntryKey = this.firebaseManager.hostPresenceEntryKey;
    this.hostPresenceEntryRef = this.firebaseManager.hostPresenceEntryRef;
  }

  async syncHostPresence(reason = "state-change") {
    // EventFirebaseManager に委譲
    return this.firebaseManager.syncHostPresence(reason);
  }

  clearOperatorPresenceState() {
    // EventFirebaseManager に委譲
    this.firebaseManager.clearOperatorPresenceState();
    // プロパティを同期
    this.operatorPresenceEventId = this.firebaseManager.operatorPresenceEventId;
    this.operatorPresenceUnsubscribe = this.firebaseManager.operatorPresenceUnsubscribe;
    this.operatorPresenceEntries = this.firebaseManager.operatorPresenceEntries;
    // app固有のプロパティをクリア
    this.hostCommittedScheduleId = "";
    this.hostCommittedScheduleLabel = "";
    this.eventSelectionCommitted = false;
    this.scheduleSelectionCommitted = false;
    this.scheduleConflictContext = null;
    this.scheduleConflictLastSignature = "";
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.pendingNavigationTarget = "";
    this.navigationManager.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
    this.navigationManager.pendingNavigationMeta = null;
    this.awaitingScheduleConflictPrompt = false;
    this.clearPendingNavigationTimer();
    this.setScheduleConflictSubmitting(false);
    this.clearScheduleConflictError();
    if (this.dom.scheduleConflictForm) {
      this.dom.scheduleConflictForm.reset();
    }
    if (this.dom.scheduleConflictDialog) {
      this.closeDialog(this.dom.scheduleConflictDialog);
    }
    this.scheduleFallbackContext = null;
    this.clearScheduleConsensusState({ reason: "presence-reset" });
    this.hideScheduleConsensusToast();
    this.lastScheduleCommitChanged = false;
    this.logFlowState("オペレーター選択状況をリセットしました");
    this.updateScheduleConflictState();
  }

  async requestScheduleConflictPrompt(context = null) {
    // EventFirebaseManager に委譲
    return this.firebaseManager.requestScheduleConflictPrompt(context);
  }

  clearOperatorModeChoiceError() {
    if (this.dom.operatorModeError) {
      this.dom.operatorModeError.hidden = true;
      this.dom.operatorModeError.textContent = "";
    }
  }

  setOperatorModeChoiceError(message = "") {
    if (!this.dom.operatorModeError) {
      return;
    }
    const trimmed = String(message || "").trim();
    if (!trimmed) {
      this.clearOperatorModeChoiceError();
      return;
    }
    this.dom.operatorModeError.hidden = false;
    this.dom.operatorModeError.textContent = trimmed;
  }

  renderOperatorModeDialog(context = null) {
    const summary = this.dom.operatorModeSummary;
    const scheduleLabel = ensureString(context?.scheduleLabel) || ensureString(context?.scheduleId);
    const scheduleRange = ensureString(context?.scheduleRange);
    if (summary) {
      if (!summary.dataset.defaultText) {
        summary.dataset.defaultText = summary.textContent || "";
      }
      if (scheduleLabel) {
        summary.textContent = scheduleRange
          ? `日程「${scheduleLabel}」（${scheduleRange}）をどのモードで扱うか選択してください。`
          : `日程「${scheduleLabel}」をどのモードで扱うか選択してください。`;
      } else {
        summary.textContent = summary.dataset.defaultText || "テロップ操作を行うかどうかを選択してください。";
      }
    }
    const container = this.dom.operatorModeOptions;
    if (container) {
      const legend = container.querySelector("legend");
      container.innerHTML = "";
      if (legend) {
        container.appendChild(legend);
      }
      const options = [
        {
          value: OPERATOR_MODE_TELOP,
          title: "テロップ操作ありで進行する",
          description: scheduleLabel
            ? `テロップ操作パネルを日程「${scheduleLabel}」で開きます。`
            : "テロップ操作パネルを利用します。"
        },
        {
          value: OPERATOR_MODE_SUPPORT,
          title: "テロップ操作なしモードで進行する",
          description: scheduleLabel
            ? `日程「${scheduleLabel}」はテロップ操作パネルで扱わず、参加者リストなどのみ利用します。`
            : "テロップ操作を行わず、補助ツールのみ利用します。"
        }
      ];
      const radioName = this.operatorModeRadioName;
      const defaultMode = normalizeOperatorMode(context?.defaultMode || this.operatorMode);
      const updateSelectionState = () => {
        const wrappers = container.querySelectorAll(".conflict-option");
        wrappers.forEach((wrapperEl) => {
          const input = wrapperEl.querySelector(`input[name="${radioName}"]`);
          wrapperEl.classList.toggle("is-selected", Boolean(input?.checked));
        });
      };
      options.forEach((option, index) => {
        const optionId = `flow-operator-mode-option-${index}`;
        const wrapper = document.createElement("label");
        wrapper.className = "conflict-option";

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = radioName;
        radio.id = optionId;
        radio.value = option.value;
        radio.className = "visually-hidden";
        radio.required = true;
        if (option.value === defaultMode || (!defaultMode && index === 0)) {
          radio.checked = true;
        }
        radio.addEventListener("change", updateSelectionState);
        wrapper.appendChild(radio);

        const header = document.createElement("div");
        header.className = "conflict-option__header";
        const title = document.createElement("span");
        title.className = "conflict-option__title";
        title.textContent = option.title;
        header.appendChild(title);
        wrapper.appendChild(header);

        if (option.description) {
          const meta = document.createElement("div");
          meta.className = "conflict-option__meta";
          meta.textContent = option.description;
          wrapper.appendChild(meta);
        }

        container.appendChild(wrapper);
      });
      updateSelectionState();
    }
    this.clearOperatorModeChoiceError();
  }

  resolveOperatorModeChoice(result) {
    const resolver = this.operatorModeChoiceResolver;
    this.operatorModeChoiceResolver = null;
    const normalized = result ? normalizeOperatorMode(result) : null;
    if (this.dom.operatorModeDialog) {
      this.closeDialog(this.dom.operatorModeDialog);
    }
    if (typeof resolver === "function") {
      resolver(normalized);
    }
    this.operatorModeChoiceContext = null;
  }

  handleOperatorModeSubmit(event) {
    if (event) {
      event.preventDefault();
    }
    if (!this.dom.operatorModeForm) {
      return;
    }
    const container = this.dom.operatorModeOptions;
    const inputs = Array.from(
      container?.querySelectorAll(`input[name="${this.operatorModeRadioName}"]`) || []
    );
    const selected = inputs.find((input) => input.checked);
    if (!selected) {
      this.setOperatorModeChoiceError("モードを選択してください。");
      return;
    }
    this.clearOperatorModeChoiceError();
    this.resolveOperatorModeChoice(selected.value || OPERATOR_MODE_TELOP);
  }

  async requestOperatorModeChoice(context = null) {
    if (!context) {
      context = {};
    }
    const schedule = context.schedule || this.getSelectedSchedule?.();
    if (schedule) {
      context.scheduleId = ensureString(schedule.id);
      context.scheduleLabel = ensureString(schedule.label) || context.scheduleId || "";
      context.scheduleRange = formatScheduleRange(schedule.startAt, schedule.endAt);
    } else {
      context.scheduleId = ensureString(context.scheduleId);
      context.scheduleLabel = ensureString(context.scheduleLabel) || context.scheduleId || "";
      context.scheduleRange = ensureString(context.scheduleRange);
    }
    context.defaultMode = normalizeOperatorMode(context.defaultMode || this.operatorMode);
    if (!this.dom.operatorModeDialog || !this.dom.operatorModeForm || !this.dom.operatorModeOptions) {
      return context.defaultMode;
    }
    if (this.operatorModeChoiceResolver) {
      this.resolveOperatorModeChoice(null);
    }
    this.operatorModeChoiceContext = context;
    this.renderOperatorModeDialog(context);
    this.openDialog(this.dom.operatorModeDialog);
    return await new Promise((resolve) => {
      this.operatorModeChoiceResolver = resolve;
    });
  }

  handleScheduleConflictSubmit(event) {
    // EventUIRenderer に委譲
    this.uiRenderer.handleScheduleConflictSubmit(event);
  }

  openScheduleCompletionDialog() {
    if (!this.dom.scheduleCompletionDialog) {
      return;
    }
    this.updateScheduleCompletionButtons();
    this.openDialog(this.dom.scheduleCompletionDialog);
  }

  updateScheduleCompletionButtons() {
    const buttons = this.dom.scheduleCompletionButtons || [];
    buttons.forEach((button) => {
      if (!button) return;
      const target = button.dataset.panelTarget || "";
      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const canActivate = this.canActivatePanel(target, config);
      button.disabled = !canActivate;
    });
  }

  async handleScheduleCompletionCopyUrl() {
    if (!this.dom.scheduleCompletionCopyButton) {
      return;
    }
    const button = this.dom.scheduleCompletionCopyButton;
    if (button.disabled) {
      return;
    }
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      this.announceScheduleCompletionCopy(false);
      return;
    }
    const url = this.getDisplayUrlForEvent(eventId);
    if (!url) {
      this.announceScheduleCompletionCopy(false);
      return;
    }
    button.disabled = true;
    let success = false;
    try {
      if (navigator?.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(url);
        success = true;
      }
    } catch (error) {
      console.warn("navigator.clipboard.writeText failed", error);
    }
    if (!success) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        success = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch (error) {
        console.warn("Fallback clipboard copy failed", error);
        success = false;
      }
    }
    this.announceScheduleCompletionCopy(success, url);
    button.disabled = false;
  }

  announceScheduleCompletionCopy(success, url = "") {
    const status = this.dom.scheduleCompletionCopyStatus;
    if (!status) {
      return;
    }
    if (success) {
      status.textContent = "表示URLをコピーしました。";
      status.removeAttribute("hidden");
      setTimeout(() => {
        if (status) {
          status.setAttribute("hidden", "");
          status.textContent = "";
        }
      }, 2000);
    } else {
      status.textContent = "表示URLのコピーに失敗しました。";
      status.removeAttribute("hidden");
      setTimeout(() => {
        if (status) {
          status.setAttribute("hidden", "");
          status.textContent = "";
        }
      }, 3000);
    }
  }

  clearScheduleFallbackError() {
    if (this.dom.scheduleFallbackError) {
      this.dom.scheduleFallbackError.hidden = true;
      this.dom.scheduleFallbackError.textContent = "";
    }
  }

  setScheduleFallbackError(message = "") {
    if (!this.dom.scheduleFallbackError) {
      return;
    }
    const trimmed = String(message || "").trim();
    if (!trimmed) {
      this.clearScheduleFallbackError();
      return;
    }
    this.dom.scheduleFallbackError.hidden = false;
    this.dom.scheduleFallbackError.textContent = trimmed;
  }

  renderScheduleFallbackDialog(context = null) {
    if (!context) {
      context = this.scheduleFallbackContext || {};
    }
    const summary = this.dom.scheduleFallbackSummary;
    if (summary) {
      if (!summary.dataset.defaultText) {
        summary.dataset.defaultText = summary.textContent || "";
      }
      const label = ensureString(context?.consensusLabel) || ensureString(context?.consensusScheduleId);
      const range = ensureString(context?.consensusRange);
      if (label) {
        summary.textContent = range
          ? `テロップ操作では日程「${label}」（${range}）を使用します。`
          : `テロップ操作では日程「${label}」を使用します。`;
      } else {
        summary.textContent = summary.dataset.defaultText || "テロップ操作に使用する日程が確定しました。";
      }
    }
    const current = this.dom.scheduleFallbackCurrent;
    if (current) {
      if (!current.dataset.defaultText) {
        current.dataset.defaultText = current.textContent || "";
      }
      const currentLabel = ensureString(context?.currentScheduleLabel) || ensureString(context?.currentScheduleId);
      if (currentLabel) {
        current.textContent = `現在あなたは日程「${currentLabel}」を選択しています。対応を選んでください。`;
      } else {
        current.textContent = current.dataset.defaultText || "対応方法を選択してください。";
      }
    }
    const container = this.dom.scheduleFallbackOptions;
    if (container) {
      container.innerHTML = "";
      const winnerLabel = ensureString(context?.consensusLabel) || ensureString(context?.consensusScheduleId);
      const winnerRange = ensureString(context?.consensusRange);
      const currentLabel = ensureString(context?.currentScheduleLabel) || ensureString(context?.currentScheduleId);
      const hasConflictContext = Boolean(context?.conflictContext?.hasConflict);
      const options = [
        {
          value: "retry",
          title: "もう一度テロップ操作する日程を選び直す",
          description: hasConflictContext
            ? "再度、テロップ操作に使用する日程を選ぶモーダルを開きます。"
            : "テロップ操作に使用する日程を改めて選択します。"
        },
        {
          value: "support",
          title: "自分が選んでいた日程をテロップ操作なしモードで開く",
          description: currentLabel
            ? `日程「${currentLabel}」をテロップ操作なしモードで開きます。`
            : "テロップ操作を行わず、参加者向けツールのみ利用します。"
        },
        {
          value: "follow",
          title: "現在のテロップ操作ありモードの日程を開く",
          description: winnerLabel
            ? winnerRange
              ? `テロップ操作パネルを「${winnerLabel}」（${winnerRange}）で開きます。`
              : `テロップ操作パネルを「${winnerLabel}」で開きます。`
            : "確定した日程でテロップ操作を行います。"
        },
        {
          value: "reselect",
          title: "日程選択パネルに戻って選び直す",
          description: "日程管理パネルへ戻ります。"
        }
      ];
      const radioName = this.scheduleFallbackRadioName;
      const updateSelectionState = () => {
        const wrappers = container.querySelectorAll(".conflict-option");
        wrappers.forEach((wrapperEl) => {
          const input = wrapperEl.querySelector(`input[name="${radioName}"]`);
          wrapperEl.classList.toggle("is-selected", Boolean(input?.checked));
        });
      };
      options.forEach((option, index) => {
        const optionId = `flow-schedule-fallback-option-${index}`;
        const wrapper = document.createElement("label");
        wrapper.className = "conflict-option";

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = radioName;
        radio.id = optionId;
        radio.value = option.value;
        radio.className = "visually-hidden";
        if (index === 0) {
          radio.checked = true;
          radio.setAttribute("data-autofocus", "true");
          radio.required = true;
        } else {
          radio.required = false;
        }
        radio.addEventListener("change", updateSelectionState);
        wrapper.appendChild(radio);

        const header = document.createElement("div");
        header.className = "conflict-option__header";
        const title = document.createElement("span");
        title.className = "conflict-option__title";
        title.textContent = option.title;
        header.appendChild(title);
        wrapper.appendChild(header);

        if (option.description) {
          const meta = document.createElement("div");
          meta.className = "conflict-option__meta";
          meta.textContent = option.description;
          wrapper.appendChild(meta);
        }

        container.appendChild(wrapper);
      });
      updateSelectionState();
    }
    this.clearScheduleFallbackError();
  }

  openScheduleFallbackDialog(context = null) {
    if (!this.dom.scheduleFallbackDialog) {
      return;
    }
    this.scheduleFallbackContext = context || {};
    this.renderScheduleFallbackDialog(context);
    this.openDialog(this.dom.scheduleFallbackDialog);
    this.logFlowState("テロップ操作の対応選択モーダルを表示します", {
      consensusScheduleId: ensureString(context?.consensusScheduleId) || "",
      currentScheduleId: ensureString(context?.currentScheduleId) || ""
    });
  }

  handleScheduleFallbackSubmit(event) {
    if (event) {
      event.preventDefault();
    }
    if (!this.dom.scheduleFallbackForm) {
      return;
    }
    const formData = new FormData(this.dom.scheduleFallbackForm);
    const action = ensureString(formData.get(this.scheduleFallbackRadioName || "fallbackAction")) || "";
    if (!action) {
      this.setScheduleFallbackError("対応方法を選択してください。");
      return;
    }
    const context = this.scheduleFallbackContext || {};
    const consensusScheduleId = ensureString(context.consensusScheduleId);
    const schedule = consensusScheduleId
      ? this.schedules.find((item) => item.id === consensusScheduleId) || null
      : null;
    this.clearScheduleFallbackError();
    let followupAction = null;
    if (action === "follow") {
      if (consensusScheduleId) {
        this.selectSchedule(consensusScheduleId);
      }
      if (this.operatorMode !== OPERATOR_MODE_TELOP) {
        this.setOperatorMode(OPERATOR_MODE_TELOP);
      }
      this.setHostCommittedSchedule(consensusScheduleId, {
        schedule,
        reason: "consensus-follow",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.logFlowState("確定した日程に移動する対応を選択しました", {
        scheduleId: consensusScheduleId || ""
      });
    } else if (action === "support") {
      if (this.operatorMode !== OPERATOR_MODE_SUPPORT) {
        this.setOperatorMode(OPERATOR_MODE_SUPPORT);
      }
      this.setHostCommittedSchedule("", {
        reason: "consensus-support",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.logFlowState("テロップ操作なしモードで続ける対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else if (action === "reselect") {
      this.setHostCommittedSchedule("", {
        reason: "consensus-reselect",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.selectSchedule("");
      this.showPanel("schedules");
      this.logFlowState("別の日程を選び直す対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else if (action === "retry") {
      const conflictContext =
        context.conflictContext && context.conflictContext.hasConflict
          ? context.conflictContext
          : this.buildScheduleConflictContext();
      if (this.operatorMode !== OPERATOR_MODE_TELOP) {
        this.setOperatorMode(OPERATOR_MODE_TELOP);
      }
      this.setHostCommittedSchedule("", {
        reason: "consensus-retry",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.pendingNavigationTarget = context.pendingNavigationTarget || "participants";
      this.navigationManager.pendingNavigationTarget = this.pendingNavigationTarget;
      this.pendingNavigationMeta = {
        target: this.pendingNavigationTarget,
        originPanel: "schedules",
        reason: "fallback-retry"
      };
      this.navigationManager.pendingNavigationMeta = this.pendingNavigationMeta;
      this.awaitingScheduleConflictPrompt = false;
      if (conflictContext && conflictContext.hasConflict) {
        followupAction = { type: "conflict", context: conflictContext };
      } else {
        this.showPanel("schedules");
      }
      this.logFlowState("テロップ操作日程を再選択する対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else {
      this.setScheduleFallbackError("対応方法を選択してください。");
      return;
    }
    this.closeDialog(this.dom.scheduleFallbackDialog);
    if (this.dom.scheduleFallbackForm) {
      this.dom.scheduleFallbackForm.reset();
    }
    if (this.dom.scheduleFallbackOptions) {
      this.dom.scheduleFallbackOptions.innerHTML = "";
    }
    this.scheduleFallbackContext = null;
    if (followupAction?.type === "conflict") {
      const conflictContext = followupAction.context;
      this.scheduleConflictContext = conflictContext;
      void this.requestScheduleConflictPrompt(conflictContext);
      this.openScheduleConflictDialog(conflictContext, {
        reason: "fallback-retry",
        originPanel: "schedules",
        target: this.pendingNavigationTarget || "participants"
      });
      this.syncScheduleConflictPromptState(conflictContext);
    }
  }

  async confirmScheduleConsensus(selection) {
    // EventFirebaseManager に委譲
    return this.firebaseManager.confirmScheduleConsensus(selection);
  }

  cleanup() {
    // EventAuthManager のクリーンアップ
    if (this.authManager) {
      this.authManager.cleanup();
    }
    this.cancelAuthResumeFallback("cleanup");
    this.clearOperatorPresenceState();
    if (typeof document !== "undefined") {
      document.removeEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.removeEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("fullscreenerror", this.handleFullscreenError);
      document.removeEventListener("webkitfullscreenerror", this.handleFullscreenError);
      document.removeEventListener("keydown", this.handleGlobalKeydown, true);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.cleanup);
    }
    if (this.dom.chatContainer) {
      this.dom.chatContainer.removeEventListener("pointerdown", this.handleChatInteraction);
      this.dom.chatContainer.removeEventListener("focusin", this.handleChatInteraction);
    }
    if (this.dom.eventList) {
      this.dom.eventList.removeEventListener("keydown", this.handleEventListKeydown);
      this.dom.eventList.removeEventListener("focusin", this.handleEventListFocus);
    }
    this.closeMobilePanel({ restoreFocus: false });
    // EventStateManager のクリーンアップ
    if (this.stateManager) {
      this.stateManager.cleanup();
    }
    // DisplayLockManager のクリーンアップ
    if (this.displayLockManager) {
      this.displayLockManager.cleanup();
    }
    this.teardownChatLayoutObservers();
    this.stopChatReadListener();
    this.chat.dispose();
  }

  setupChatLayoutObservers() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    this.updateChatLayoutMetrics();
    if (typeof ResizeObserver === "function") {
      if (this.chatLayoutResizeObserver) {
        this.chatLayoutResizeObserver.disconnect();
      }
      const observer = new ResizeObserver(() => this.updateChatLayoutMetrics());
      const header = document.querySelector(".op-header");
      const layout = this.dom.chatContainer?.closest(".events-layout");
      const telopPanel = typeof document !== "undefined" ? document.getElementById("side-telop-panel") : null;
      const targets = [
        document.body,
        header,
        this.dom.main,
        this.dom.flowStage,
        layout,
        this.dom.chatContainer,
        this.dom.chatPanel,
        telopPanel
      ];
      const uniqueTargets = Array.from(new Set(targets.filter(Boolean)));
      uniqueTargets.forEach((target) => observer.observe(target));
      this.chatLayoutResizeObserver = observer;
    }
    window.removeEventListener("resize", this.handleWindowResize);
    window.removeEventListener("orientationchange", this.handleWindowResize);
    window.addEventListener("resize", this.handleWindowResize, { passive: true });
    window.addEventListener("orientationchange", this.handleWindowResize);
    if (window.visualViewport) {
      if (this.visualViewportResize) {
        window.visualViewport.removeEventListener("resize", this.visualViewportResize);
        window.visualViewport.removeEventListener("scroll", this.visualViewportResize);
      }
      this.visualViewportResize = () => this.updateChatLayoutMetrics();
      window.visualViewport.addEventListener("resize", this.visualViewportResize);
      window.visualViewport.addEventListener("scroll", this.visualViewportResize);
    }
  }

  teardownChatLayoutObservers() {
    if (this.chatLayoutResizeObserver) {
      this.chatLayoutResizeObserver.disconnect();
      this.chatLayoutResizeObserver = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleWindowResize);
      window.removeEventListener("orientationchange", this.handleWindowResize);
      if (this.chatLayoutRaf) {
        window.cancelAnimationFrame(this.chatLayoutRaf);
        this.chatLayoutRaf = 0;
      }
      if (this.chatLayoutScrollRaf) {
        window.cancelAnimationFrame(this.chatLayoutScrollRaf);
        this.chatLayoutScrollRaf = 0;
      }
      if (window.visualViewport && this.visualViewportResize) {
        window.visualViewport.removeEventListener("resize", this.visualViewportResize);
        window.visualViewport.removeEventListener("scroll", this.visualViewportResize);
        this.visualViewportResize = null;
      }
    }
    const layout = this.dom.chatContainer?.closest(".events-layout");
    if (this.dom.chatContainer) {
      this.dom.chatContainer.style.removeProperty("--events-chat-top");
      this.dom.chatContainer.style.removeProperty("--events-chat-height");
    }
    if (layout) {
      layout.style.removeProperty("--events-main-panel-height");
    }
  }

  handleWindowResize() {
    if (typeof window === "undefined") {
      return;
    }
    if (this.chatLayoutRaf) {
      return;
    }
    this.chatLayoutRaf = window.requestAnimationFrame(() => {
      this.chatLayoutRaf = 0;
      this.updateChatLayoutMetrics();
      if (!this.isMobileLayout() && this.activeMobilePanel) {
        this.closeMobilePanel({ restoreFocus: false });
      }
      this.syncMobilePanelAccessibility();
      this.refreshChatIndicators();
    });
  }

  isMobileLayout() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(max-width: 960px)").matches;
  }

  getMobilePanel(target) {
    if (!target) {
      return null;
    }
    if (target === "sidebar") {
      return this.dom.sidebarContainer || (typeof document !== "undefined" ? document.getElementById("events-sidebar") : null);
    }
    if (target === "chat") {
      return this.dom.chatContainer || (typeof document !== "undefined" ? document.getElementById("events-chat") : null);
    }
    return null;
  }

  syncMobilePanelAccessibility() {
    const isMobile = this.isMobileLayout();
    ["sidebar", "chat"].forEach((target) => {
      const panel = this.getMobilePanel(target);
      if (!(panel instanceof HTMLElement)) {
        return;
      }
      if (isMobile) {
        const isOpen = panel.classList.contains("is-mobile-open");
        panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
      } else {
        panel.removeAttribute("aria-hidden");
      }
    });
  }

  handleChatMessagesChange({ messages, latestMessage, latestMessageId } = {}) {
    this.chatMessages = Array.isArray(messages) ? messages : [];
    const resolvedLatest = latestMessage && typeof latestMessage === "object"
      ? latestMessage
      : this.chatMessages.length > 0
        ? this.chatMessages[this.chatMessages.length - 1]
        : null;
    const resolvedId = typeof latestMessageId === "string" && latestMessageId
      ? latestMessageId
      : resolvedLatest && typeof resolvedLatest.id === "string"
        ? resolvedLatest.id
        : "";
    this.chatLatestMessageId = resolvedId;
    this.chatLatestMessageTimestamp = resolvedLatest && Number.isFinite(resolvedLatest.timestamp)
      ? resolvedLatest.timestamp
      : 0;
    this.syncChatUnreadCount();
  }

  handleChatUnreadCountChange(count) {
    const numeric = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    this.chatScrollUnreadCount = numeric;
    this.refreshChatIndicators();
  }

  handleChatActivity(activity = {}) {
    if (!activity || typeof activity !== "object") {
      return;
    }
    const external = Number.isFinite(activity.externalCount)
      ? Math.max(0, Math.trunc(activity.externalCount))
      : 0;
    if (external > 0) {
      this.chatAcknowledged = false;
    }
  }

  commitSelectedScheduleForTelop({ reason = "schedule-commit" } = {}) {
    const scheduleId = ensureString(this.selectedScheduleId);
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[commitSelectedScheduleForTelop] Called (second definition)", {
        reason,
        scheduleId: scheduleId || "(empty)",
        selectedEventId: ensureString(this.selectedEventId) || "(empty)",
        hostCommittedScheduleId: ensureString(this.hostCommittedScheduleId) || "(empty)",
        scheduleSelectionCommitted: this.scheduleSelectionCommitted
      });
    }
    this.lastScheduleCommitChanged = false;
    if (!scheduleId) {
      this.logFlowState("日程未選択のためテロップ操作の日程を確定できません", { reason });
      return false;
    }
    const schedule = this.getSelectedSchedule();
    const changed = this.setHostCommittedSchedule(scheduleId, {
      schedule,
      reason,
      sync: true,
      updateContext: false,
      force: true
    });
    this.lastScheduleCommitChanged = changed;
    this.scheduleSelectionCommitted = true;
    this.logFlowState("テロップ操作の日程の確定リクエストを処理しました", {
      scheduleId,
      scheduleLabel: schedule?.label || scheduleId,
      reason,
      changed
    });
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[commitSelectedScheduleForTelop] About to sync operator context (second definition)", {
        scheduleId,
        eventId: ensureString(this.selectedEventId) || "(empty)",
        hostCommittedScheduleId: ensureString(this.hostCommittedScheduleId) || "(empty)",
        scheduleSelectionCommitted: this.scheduleSelectionCommitted,
        hasTools: Boolean(this.tools),
        hasSyncOperatorContext: Boolean(this.tools?.syncOperatorContext)
      });
    }
    if (this.tools?.syncOperatorContext) {
      this.tools
        .syncOperatorContext({ force: true, reason: "schedule-commit" })
        .catch((error) => logError("Failed to sync operator context after schedule commit", error));
    }
    return true;
  }

  setScheduleConflictSubmitting(isSubmitting) {
    const confirmButton = this.dom.scheduleConflictConfirmButton;
    const cancelButton = this.dom.scheduleConflictCancelButton;
    if (confirmButton) {
      confirmButton.disabled = Boolean(isSubmitting);
      if (isSubmitting) {
        confirmButton.setAttribute("aria-busy", "true");
      } else {
        confirmButton.removeAttribute("aria-busy");
      }
    }
    if (cancelButton) {
      cancelButton.disabled = Boolean(isSubmitting);
    }
  }

  handleScheduleConflictCancel() {
    this.setScheduleConflictSubmitting(false);
    this.pendingNavigationTarget = "";
    this.navigationManager.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
    this.navigationManager.pendingNavigationMeta = null;
    this.awaitingScheduleConflictPrompt = false;
    this.clearPendingNavigationTimer();
    if (this.dom.scheduleConflictForm) {
      this.dom.scheduleConflictForm.reset();
    }
    this.clearScheduleConflictError();
    this.closeDialog(this.dom.scheduleConflictDialog);
    this.syncScheduleConflictPromptState();
  }

  clearScheduleFallbackError() {
    if (this.dom.scheduleFallbackError) {
      this.dom.scheduleFallbackError.hidden = true;
      this.dom.scheduleFallbackError.textContent = "";
    }
  }

  setScheduleFallbackError(message = "") {
    if (!this.dom.scheduleFallbackError) {
      return;
    }
    const trimmed = String(message || "").trim();
    if (!trimmed) {
      this.clearScheduleFallbackError();
      return;
    }
    this.dom.scheduleFallbackError.hidden = false;
    this.dom.scheduleFallbackError.textContent = trimmed;
  }

  renderScheduleFallbackDialog(context = null) {
    if (!context) {
      context = this.scheduleFallbackContext || {};
    }
    const summary = this.dom.scheduleFallbackSummary;
    if (summary) {
      if (!summary.dataset.defaultText) {
        summary.dataset.defaultText = summary.textContent || "";
      }
      const label = ensureString(context?.consensusLabel) || ensureString(context?.consensusScheduleId);
      const range = ensureString(context?.consensusRange);
      if (label) {
        summary.textContent = range
          ? `テロップ操作では日程「${label}」（${range}）を使用します。`
          : `テロップ操作では日程「${label}」を使用します。`;
      } else {
        summary.textContent = summary.dataset.defaultText || "テロップ操作に使用する日程が確定しました。";
      }
    }
    const current = this.dom.scheduleFallbackCurrent;
    if (current) {
      if (!current.dataset.defaultText) {
        current.dataset.defaultText = current.textContent || "";
      }
      const currentLabel = ensureString(context?.currentScheduleLabel) || ensureString(context?.currentScheduleId);
      if (currentLabel) {
        current.textContent = `現在あなたは日程「${currentLabel}」を選択しています。対応を選んでください。`;
      } else {
        current.textContent = current.dataset.defaultText || "対応方法を選択してください。";
      }
    }
    const container = this.dom.scheduleFallbackOptions;
    if (container) {
      container.innerHTML = "";
      const winnerLabel = ensureString(context?.consensusLabel) || ensureString(context?.consensusScheduleId);
      const winnerRange = ensureString(context?.consensusRange);
      const currentLabel = ensureString(context?.currentScheduleLabel) || ensureString(context?.currentScheduleId);
      const hasConflictContext = Boolean(context?.conflictContext?.hasConflict);
      const options = [
        {
          value: "retry",
          title: "もう一度テロップ操作する日程を選び直す",
          description: hasConflictContext
            ? "再度、テロップ操作に使用する日程を選ぶモーダルを開きます。"
            : "テロップ操作に使用する日程を改めて選択します。"
        },
        {
          value: "support",
          title: "自分が選んでいた日程をテロップ操作なしモードで開く",
          description: currentLabel
            ? `日程「${currentLabel}」をテロップ操作なしモードで開きます。`
            : "テロップ操作を行わず、参加者向けツールのみ利用します。"
        },
        {
          value: "follow",
          title: "現在のテロップ操作ありモードの日程を開く",
          description: winnerLabel
            ? winnerRange
              ? `テロップ操作パネルを「${winnerLabel}」（${winnerRange}）で開きます。`
              : `テロップ操作パネルを「${winnerLabel}」で開きます。`
            : "確定した日程でテロップ操作を行います。"
        },
        {
          value: "reselect",
          title: "日程選択パネルに戻って選び直す",
          description: "日程管理パネルへ戻ります。"
        }
      ];
      const radioName = this.scheduleFallbackRadioName;
      const updateSelectionState = () => {
        const wrappers = container.querySelectorAll(".conflict-option");
        wrappers.forEach((wrapperEl) => {
          const input = wrapperEl.querySelector(`input[name="${radioName}"]`);
          wrapperEl.classList.toggle("is-selected", Boolean(input?.checked));
        });
      };
      options.forEach((option, index) => {
        const optionId = `flow-schedule-fallback-option-${index}`;
        const wrapper = document.createElement("label");
        wrapper.className = "conflict-option";

        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = radioName;
        radio.id = optionId;
        radio.value = option.value;
        radio.className = "visually-hidden";
        if (index === 0) {
          radio.checked = true;
          radio.setAttribute("data-autofocus", "true");
          radio.required = true;
        } else {
          radio.required = false;
        }
        radio.addEventListener("change", updateSelectionState);
        wrapper.appendChild(radio);

        const header = document.createElement("div");
        header.className = "conflict-option__header";
        const title = document.createElement("span");
        title.className = "conflict-option__title";
        title.textContent = option.title;
        header.appendChild(title);
        wrapper.appendChild(header);

        if (option.description) {
          const meta = document.createElement("div");
          meta.className = "conflict-option__meta";
          meta.textContent = option.description;
          wrapper.appendChild(meta);
        }

        container.appendChild(wrapper);
      });
      updateSelectionState();
    }
    this.clearScheduleFallbackError();
  }

  openScheduleFallbackDialog(context = null) {
    if (!this.dom.scheduleFallbackDialog) {
      return;
    }
    this.scheduleFallbackContext = context || {};
    this.renderScheduleFallbackDialog(context);
    this.openDialog(this.dom.scheduleFallbackDialog);
    this.logFlowState("テロップ操作の対応選択モーダルを表示します", {
      consensusScheduleId: ensureString(context?.consensusScheduleId) || "",
      currentScheduleId: ensureString(context?.currentScheduleId) || ""
    });
  }

  handleScheduleFallbackSubmit(event) {
    if (event) {
      event.preventDefault();
    }
    if (!this.dom.scheduleFallbackForm) {
      return;
    }
    const formData = new FormData(this.dom.scheduleFallbackForm);
    const action = ensureString(formData.get(this.scheduleFallbackRadioName || "fallbackAction")) || "";
    if (!action) {
      this.setScheduleFallbackError("対応方法を選択してください。");
      return;
    }
    const context = this.scheduleFallbackContext || {};
    const consensusScheduleId = ensureString(context.consensusScheduleId);
    const schedule = consensusScheduleId
      ? this.schedules.find((item) => item.id === consensusScheduleId) || null
      : null;
    this.clearScheduleFallbackError();
    let followupAction = null;
    if (action === "follow") {
      if (consensusScheduleId) {
        this.selectSchedule(consensusScheduleId);
      }
      if (this.operatorMode !== OPERATOR_MODE_TELOP) {
        this.setOperatorMode(OPERATOR_MODE_TELOP);
      }
      this.setHostCommittedSchedule(consensusScheduleId, {
        schedule,
        reason: "consensus-follow",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.logFlowState("確定した日程に移動する対応を選択しました", {
        scheduleId: consensusScheduleId || ""
      });
    } else if (action === "support") {
      if (this.operatorMode !== OPERATOR_MODE_SUPPORT) {
        this.setOperatorMode(OPERATOR_MODE_SUPPORT);
      }
      this.setHostCommittedSchedule("", {
        reason: "consensus-support",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.logFlowState("テロップ操作なしモードで続ける対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else if (action === "reselect") {
      this.setHostCommittedSchedule("", {
        reason: "consensus-reselect",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.selectSchedule("");
      this.showPanel("schedules");
      this.logFlowState("別の日程を選び直す対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else if (action === "retry") {
      const conflictContext =
        context.conflictContext && context.conflictContext.hasConflict
          ? context.conflictContext
          : this.buildScheduleConflictContext();
      if (this.operatorMode !== OPERATOR_MODE_TELOP) {
        this.setOperatorMode(OPERATOR_MODE_TELOP);
      }
      this.setHostCommittedSchedule("", {
        reason: "consensus-retry",
        sync: true,
        updateContext: true,
        force: true,
        suppressConflictPrompt: true
      });
      this.pendingNavigationTarget = context.pendingNavigationTarget || "participants";
      this.navigationManager.pendingNavigationTarget = this.pendingNavigationTarget;
      this.pendingNavigationMeta = {
        target: this.pendingNavigationTarget,
        originPanel: "schedules",
        reason: "fallback-retry"
      };
      this.navigationManager.pendingNavigationMeta = this.pendingNavigationMeta;
      this.awaitingScheduleConflictPrompt = false;
      if (conflictContext && conflictContext.hasConflict) {
        followupAction = { type: "conflict", context: conflictContext };
      } else {
        this.showPanel("schedules");
      }
      this.logFlowState("テロップ操作日程を再選択する対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else {
      this.setScheduleFallbackError("対応方法を選択してください。");
      return;
    }
    this.closeDialog(this.dom.scheduleFallbackDialog);
    if (this.dom.scheduleFallbackForm) {
      this.dom.scheduleFallbackForm.reset();
    }
    if (this.dom.scheduleFallbackOptions) {
      this.dom.scheduleFallbackOptions.innerHTML = "";
    }
    this.scheduleFallbackContext = null;
    if (followupAction?.type === "conflict") {
      const conflictContext = followupAction.context;
      this.scheduleConflictContext = conflictContext;
      void this.requestScheduleConflictPrompt(conflictContext);
      this.openScheduleConflictDialog(conflictContext, {
        reason: "fallback-retry",
        originPanel: "schedules",
        target: this.pendingNavigationTarget || "participants"
      });
      this.syncScheduleConflictPromptState(conflictContext);
    }
  }

  cleanup() {
    // EventAuthManager のクリーンアップ
    if (this.authManager) {
      this.authManager.cleanup();
    }
    this.cancelAuthResumeFallback("cleanup");
    this.clearOperatorPresenceState();
    if (typeof document !== "undefined") {
      document.removeEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.removeEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("fullscreenerror", this.handleFullscreenError);
      document.removeEventListener("webkitfullscreenerror", this.handleFullscreenError);
      document.removeEventListener("keydown", this.handleGlobalKeydown, true);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.cleanup);
    }
    if (this.dom.chatContainer) {
      this.dom.chatContainer.removeEventListener("pointerdown", this.handleChatInteraction);
      this.dom.chatContainer.removeEventListener("focusin", this.handleChatInteraction);
    }
    if (this.dom.eventList) {
      this.dom.eventList.removeEventListener("keydown", this.handleEventListKeydown);
      this.dom.eventList.removeEventListener("focusin", this.handleEventListFocus);
    }
    this.closeMobilePanel({ restoreFocus: false });
    // EventStateManager のクリーンアップ
    if (this.stateManager) {
      this.stateManager.cleanup();
    }
    // DisplayLockManager のクリーンアップ
    if (this.displayLockManager) {
      this.displayLockManager.cleanup();
    }
    this.teardownChatLayoutObservers();
    this.stopChatReadListener();
    this.chat.dispose();
  }

  setupChatLayoutObservers() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    this.updateChatLayoutMetrics();
    if (typeof ResizeObserver === "function") {
      if (this.chatLayoutResizeObserver) {
        this.chatLayoutResizeObserver.disconnect();
      }
      const observer = new ResizeObserver(() => this.updateChatLayoutMetrics());
      const header = document.querySelector(".op-header");
      const layout = this.dom.chatContainer?.closest(".events-layout");
      const telopPanel = typeof document !== "undefined" ? document.getElementById("side-telop-panel") : null;
      const targets = [
        document.body,
        header,
        this.dom.main,
        this.dom.flowStage,
        layout,
        this.dom.chatContainer,
        this.dom.chatPanel,
        telopPanel
      ];
      const uniqueTargets = Array.from(new Set(targets.filter(Boolean)));
      uniqueTargets.forEach((target) => observer.observe(target));
      this.chatLayoutResizeObserver = observer;
    }
    window.removeEventListener("resize", this.handleWindowResize);
    window.removeEventListener("orientationchange", this.handleWindowResize);
    window.addEventListener("resize", this.handleWindowResize, { passive: true });
    window.addEventListener("orientationchange", this.handleWindowResize);
    if (window.visualViewport) {
      if (this.visualViewportResize) {
        window.visualViewport.removeEventListener("resize", this.visualViewportResize);
        window.visualViewport.removeEventListener("scroll", this.visualViewportResize);
      }
      this.visualViewportResize = () => this.updateChatLayoutMetrics();
      window.visualViewport.addEventListener("resize", this.visualViewportResize);
      window.visualViewport.addEventListener("scroll", this.visualViewportResize);
    }
  }

  teardownChatLayoutObservers() {
    if (this.chatLayoutResizeObserver) {
      this.chatLayoutResizeObserver.disconnect();
      this.chatLayoutResizeObserver = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleWindowResize);
      window.removeEventListener("orientationchange", this.handleWindowResize);
      if (this.chatLayoutRaf) {
        window.cancelAnimationFrame(this.chatLayoutRaf);
        this.chatLayoutRaf = 0;
      }
      if (this.chatLayoutScrollRaf) {
        window.cancelAnimationFrame(this.chatLayoutScrollRaf);
        this.chatLayoutScrollRaf = 0;
      }
      if (window.visualViewport && this.visualViewportResize) {
        window.visualViewport.removeEventListener("resize", this.visualViewportResize);
        window.visualViewport.removeEventListener("scroll", this.visualViewportResize);
        this.visualViewportResize = null;
      }
    }
    if (this.dom.chatContainer) {
      this.dom.chatContainer.style.removeProperty("--events-chat-top");
      this.dom.chatContainer.style.removeProperty("--events-chat-height");
    }
  }

  handleWindowResize() {
    if (typeof window === "undefined") {
      return;
    }
    if (this.chatLayoutRaf) {
      return;
    }
    this.chatLayoutRaf = window.requestAnimationFrame(() => {
      this.chatLayoutRaf = 0;
      this.updateChatLayoutMetrics();
      if (!this.isMobileLayout() && this.activeMobilePanel) {
        this.closeMobilePanel({ restoreFocus: false });
      }
      this.syncMobilePanelAccessibility();
      this.refreshChatIndicators();
    });
  }

  isMobileLayout() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(max-width: 960px)").matches;
  }

  getMobilePanel(target) {
    if (!target) {
      return null;
    }
    if (target === "sidebar") {
      return this.dom.sidebarContainer || (typeof document !== "undefined" ? document.getElementById("events-sidebar") : null);
    }
    if (target === "chat") {
      return this.dom.chatContainer || (typeof document !== "undefined" ? document.getElementById("events-chat") : null);
    }
    return null;
  }

  syncMobilePanelAccessibility() {
    const isMobile = this.isMobileLayout();
    ["sidebar", "chat"].forEach((target) => {
      const panel = this.getMobilePanel(target);
      if (!(panel instanceof HTMLElement)) {
        return;
      }
      if (isMobile) {
        const isOpen = panel.classList.contains("is-mobile-open");
        panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
      } else {
        panel.removeAttribute("aria-hidden");
      }
    });
  }

  handleChatMessagesChange({ messages, latestMessage, latestMessageId } = {}) {
    this.chatMessages = Array.isArray(messages) ? messages : [];
    const resolvedLatest = latestMessage && typeof latestMessage === "object"
      ? latestMessage
      : this.chatMessages.length > 0
        ? this.chatMessages[this.chatMessages.length - 1]
        : null;
    const resolvedId = typeof latestMessageId === "string" && latestMessageId
      ? latestMessageId
      : resolvedLatest && typeof resolvedLatest.id === "string"
        ? resolvedLatest.id
        : "";
    this.chatLatestMessageId = resolvedId;
    this.chatLatestMessageTimestamp = resolvedLatest && Number.isFinite(resolvedLatest.timestamp)
      ? resolvedLatest.timestamp
      : 0;
    this.syncChatUnreadCount();
  }

  handleChatUnreadCountChange(count) {
    const numeric = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    this.chatScrollUnreadCount = numeric;
    this.refreshChatIndicators();
  }

  handleChatActivity(activity = {}) {
    if (!activity || typeof activity !== "object") {
      return;
    }
    const external = Number.isFinite(activity.externalCount)
      ? Math.max(0, Math.trunc(activity.externalCount))
      : 0;
    if (external > 0) {
      this.chatAcknowledged = false;
    }
    this.syncChatUnreadCount();
  }

  hasChatAttention() {
    return !this.chatAcknowledged && this.chatUnreadCount > 0;
  }

  handleChatInteraction() {
    if (!this.hasChatAttention()) {
      return;
    }
    this.acknowledgeChatActivity();
  }

  acknowledgeChatActivity() {
    const latestId = typeof this.chatLatestMessageId === "string" ? this.chatLatestMessageId : "";
    if (!latestId) {
      this.chatLastReadMessageId = "";
      this.chatLastReadMessageTimestamp = 0;
      this.syncChatUnreadCount();
      return;
    }
    const hasChanged = latestId !== this.chatLastReadMessageId;
    this.chatLastReadMessageId = latestId;
    this.chatLastReadMessageTimestamp = Number.isFinite(this.chatLatestMessageTimestamp)
      ? this.chatLatestMessageTimestamp
      : 0;
    this.syncChatUnreadCount();
    if (hasChanged) {
      void this.persistChatReadState(latestId).catch((error) => {
        logError("Failed to record chat read marker", error);
      });
    }
  }

  syncChatUnreadCount() {
    if (!this.currentUser) {
      this.chatUnreadCount = 0;
      this.chatAcknowledged = true;
      this.refreshChatIndicators();
      return;
    }
    const messages = Array.isArray(this.chatMessages) ? this.chatMessages : [];
    const lastReadId = typeof this.chatLastReadMessageId === "string" ? this.chatLastReadMessageId : "";
    const matchIndex = lastReadId
      ? messages.findIndex((message) => message && message.id === lastReadId)
      : -1;
    const fallbackTimestamp = matchIndex < 0 && Number.isFinite(this.chatLastReadMessageTimestamp)
      ? this.chatLastReadMessageTimestamp
      : 0;
    let unread = 0;
    for (let index = 0; index < messages.length; index += 1) {
      if (matchIndex >= 0 && index <= matchIndex) {
        continue;
      }
      const message = messages[index];
      if (!message) {
        continue;
      }
      if (matchIndex < 0 && fallbackTimestamp > 0) {
        const timestamp = Number.isFinite(message.timestamp) ? message.timestamp : 0;
        if (timestamp > 0 && timestamp <= fallbackTimestamp) {
          continue;
        }
      }
      if (this.chat && typeof this.chat.isMessageFromCurrentUser === "function" && this.chat.isMessageFromCurrentUser(message)) {
        continue;
      }
      unread += 1;
    }
    this.chatUnreadCount = unread;
    this.chatAcknowledged = unread <= 0;
    this.refreshChatIndicators();
  }

  startChatReadListener(user) {
    this.stopChatReadListener();
    if (!user || !user.uid) {
      this.chatLastReadMessageId = "";
      this.chatLastReadMessageTimestamp = 0;
      this.syncChatUnreadCount();
      return;
    }
    const readRef = this.getChatReadRef(user.uid);
    if (!readRef) {
      return;
    }
    this.chatReadUnsubscribe = onValue(
      readRef,
      (snapshot) => {
        const value = snapshot.val();
        const lastReadId = value && typeof value.lastReadMessageId === "string" ? value.lastReadMessageId : "";
        this.chatLastReadMessageId = lastReadId;
        const timestampValue = value && Object.prototype.hasOwnProperty.call(value, "lastReadMessageTimestamp")
          ? Number(value.lastReadMessageTimestamp)
          : NaN;
        this.chatLastReadMessageTimestamp = Number.isFinite(timestampValue) ? timestampValue : 0;
        this.syncChatUnreadCount();
      },
      (error) => {
        logError("Failed to observe chat read marker", error);
      }
    );
  }

  stopChatReadListener() {
    if (typeof this.chatReadUnsubscribe === "function") {
      try {
        this.chatReadUnsubscribe();
      } catch (error) {
        logError("Failed to dispose chat read listener", error);
      }
    }
    this.chatReadUnsubscribe = null;
  }

  getChatReadRef(uid) {
    if (!uid) {
      return null;
    }
    try {
      return ref(database, `operatorChat/reads/${uid}`);
    } catch (error) {
      logError("Failed to build chat read ref", error);
      return null;
    }
  }

  async persistChatReadState(messageId) {
    const user = this.currentUser;
    if (!user || !user.uid) {
      return;
    }
    const normalizedId = typeof messageId === "string" ? messageId : "";
    if (!normalizedId) {
      return;
    }
    const readRef = this.getChatReadRef(user.uid);
    if (!readRef) {
      return;
    }
    const payload = {
      lastReadMessageId: normalizedId,
      updatedAt: serverTimestamp()
    };
    const readTimestamp = Number.isFinite(this.chatLastReadMessageTimestamp)
      ? this.chatLastReadMessageTimestamp
      : 0;
    if (readTimestamp > 0) {
      payload.lastReadMessageTimestamp = readTimestamp;
    }
    await set(readRef, payload);
  }

  refreshChatIndicators() {
    // EventUIRenderer に委譲
    this.uiRenderer.refreshChatIndicators();
  }

  toggleMobilePanel(target) {
    if (!target) {
      return;
    }
    if (!this.isMobileLayout()) {
      const panel = this.getMobilePanel(target);
      if (panel && typeof panel.scrollIntoView === "function") {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (panel instanceof HTMLElement) {
        panel.removeAttribute("aria-hidden");
      }
      return;
    }
    if (this.activeMobilePanel === target) {
      this.closeMobilePanel();
    } else {
      this.openMobilePanel(target);
    }
  }

  openMobilePanel(target) {
    if (!this.isMobileLayout()) {
      return;
    }
    const panel = this.getMobilePanel(target);
    if (!panel) {
      return;
    }
    if (this.activeMobilePanel && this.activeMobilePanel !== target) {
      this.closeMobilePanel({ restoreFocus: false });
    }
    this.activeMobilePanel = target;
    if (panel instanceof HTMLElement) {
      panel.classList.add("is-mobile-open");
      panel.setAttribute("data-mobile-open", "true");
      panel.setAttribute("aria-hidden", "false");
    }
    const body = typeof document !== "undefined" ? document.body : null;
    if (body) {
      body.classList.add("events-mobile-locked");
    }
    if (this.dom.mobileOverlay) {
      this.dom.mobileOverlay.removeAttribute("hidden");
    }
    (this.dom.mobileToggleButtons || []).forEach((button) => {
      if (!button) {
        return;
      }
      const matches = (button.dataset.mobileTarget || "") === target;
      button.setAttribute("aria-expanded", matches ? "true" : "false");
    });
    this.lastMobileFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeButton = panel.querySelector("[data-mobile-close]");
    requestAnimationFrame(() => {
      if (closeButton instanceof HTMLElement) {
        closeButton.focus();
      } else if (panel instanceof HTMLElement && typeof panel.focus === "function") {
        panel.focus();
      }
    });
    if (typeof document !== "undefined") {
      document.addEventListener("keydown", this.handleMobileKeydown, true);
    }
    if (target === "chat") {
      this.acknowledgeChatActivity();
    } else {
      this.refreshChatIndicators();
    }
    this.syncMobilePanelAccessibility();
  }

  closeMobilePanel({ restoreFocus = true } = {}) {
    if (!this.activeMobilePanel) {
      (this.dom.mobileToggleButtons || []).forEach((button) => {
        if (button) {
          button.setAttribute("aria-expanded", "false");
        }
      });
      this.syncMobilePanelAccessibility();
      this.refreshChatIndicators();
      return;
    }
    const target = this.activeMobilePanel;
    const panel = this.getMobilePanel(target);
    if (panel instanceof HTMLElement) {
      panel.classList.remove("is-mobile-open");
      panel.removeAttribute("data-mobile-open");
      if (this.isMobileLayout()) {
        panel.setAttribute("aria-hidden", "true");
      } else {
        panel.removeAttribute("aria-hidden");
      }
    }
    if (this.dom.mobileOverlay && !this.dom.mobileOverlay.hasAttribute("hidden")) {
      this.dom.mobileOverlay.setAttribute("hidden", "");
    }
    const body = typeof document !== "undefined" ? document.body : null;
    if (body) {
      body.classList.remove("events-mobile-locked");
    }
    (this.dom.mobileToggleButtons || []).forEach((button) => {
      if (button) {
        button.setAttribute("aria-expanded", "false");
      }
    });
    if (typeof document !== "undefined") {
      document.removeEventListener("keydown", this.handleMobileKeydown, true);
    }
    const focusTarget = restoreFocus ? this.lastMobileFocus : null;
    this.activeMobilePanel = "";
    this.lastMobileFocus = null;
    this.syncMobilePanelAccessibility();
    this.refreshChatIndicators();
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus();
    }
  }

  handleMobileKeydown(event) {
    // N でモバイルパネルを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
    if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && this.activeMobilePanel) {
      event.preventDefault();
      this.closeMobilePanel();
    }
  }

  requestChatScrollAfterLayout() {
    if (typeof window === "undefined") {
      return;
    }
    if (!this.chat || !this.chat.state || !this.chat.state.autoScroll) {
      return;
    }
    if (this.chatLayoutScrollRaf) {
      window.cancelAnimationFrame(this.chatLayoutScrollRaf);
    }
    this.chatLayoutScrollRaf = window.requestAnimationFrame(() => {
      this.chatLayoutScrollRaf = 0;
      this.chat.scrollToLatest(false);
    });
  }

  updateChatLayoutMetrics() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const chatPanel = this.dom.chatPanel;
    const chatContainer = this.dom.chatContainer || chatPanel?.closest(".events-chat");
    if (!chatPanel || !chatContainer) {
      return;
    }
    let nextHeight = 0;
    if (window.matchMedia && window.matchMedia("(max-width: 960px)").matches) {
      chatContainer.style.removeProperty("--events-chat-top");
      chatContainer.style.removeProperty("--events-chat-height");
    } else {
      const docEl = document.documentElement;
      const header = document.querySelector(".op-header");
      const layout = chatContainer.closest(".events-layout");
      const flowStage = this.dom.flowStage || document.querySelector(".flow-stage");
      const mainPanel =
        layout?.querySelector(".flow-stage-panel.is-active") ||
        layout?.querySelector(".flow-stage-panel");
      const bodyStyles = window.getComputedStyle(document.body);
      const docStyles = window.getComputedStyle(docEl);
      const mainStyles = this.dom.main ? window.getComputedStyle(this.dom.main) : null;
      const layoutStyles = layout ? window.getComputedStyle(layout) : null;

      const safeAreaTop = parseCssPixels(docStyles.getPropertyValue("--safe-area-top"));
      const safeAreaBottom = parseCssPixels(docStyles.getPropertyValue("--safe-area-bottom"));
      const bodyPaddingTop = parseCssPixels(bodyStyles.paddingTop);
      const bodyPaddingBottom = parseCssPixels(bodyStyles.paddingBottom);
      const bodyGap = parseCssPixels(bodyStyles.gap);
      const mainGap = mainStyles ? parseCssPixels(mainStyles.gap) : 0;
      const layoutPaddingTop = layoutStyles ? parseCssPixels(layoutStyles.paddingTop) : 0;
      const layoutPaddingBottom = layoutStyles ? parseCssPixels(layoutStyles.paddingBottom) : 0;

      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      const flowStageHeight = flowStage ? flowStage.getBoundingClientRect().height : 0;
      const mainPanelHeight = mainPanel ? mainPanel.getBoundingClientRect().height : 0;

      if (layout) {
        if (mainPanelHeight > 0) {
          layout.style.setProperty("--events-main-panel-height", `${mainPanelHeight}px`);
        } else {
          layout.style.removeProperty("--events-main-panel-height");
        }
      }

      const chatStyles = window.getComputedStyle(chatContainer);
      const cssStickyTop = parseCssPixels(chatStyles.top);
      const fallbackStickyTop = bodyPaddingTop + safeAreaTop + headerHeight + bodyGap;
      const stickyTop = cssStickyTop > 0 ? cssStickyTop : fallbackStickyTop;
      const chatOffset = stickyTop + flowStageHeight + mainGap + layoutPaddingTop;
      const viewportHeight = window.innerHeight || docEl.clientHeight;
      const availableHeight = viewportHeight - chatOffset - layoutPaddingBottom - bodyPaddingBottom - safeAreaBottom;

      const heightValue = Math.max(0, Math.round(availableHeight));
      nextHeight = heightValue;
      if (heightValue > 0) {
        chatContainer.style.setProperty("--events-chat-height", `${heightValue}px`);
      } else {
        chatContainer.style.removeProperty("--events-chat-height");
      }
    }

    const heightChanged = this.chatLayoutHeight !== nextHeight;
    this.chatLayoutHeight = nextHeight;
    if (heightChanged) {
      this.requestChatScrollAfterLayout();
    }
  }

  revealEventSelectionCue() {
    // EventUIRenderer に委譲
    this.uiRenderer.revealEventSelectionCue();
  }

  revealScheduleSelectionCue() {
    // EventUIRenderer に委譲
    this.uiRenderer.revealScheduleSelectionCue();
  }

  beginScheduleLoading(message = "") {
    this.scheduleLoadingTracker.begin(message);
  }

  endScheduleLoading() {
    this.scheduleLoadingTracker.end();
  }

  updateScheduleLoadingMessage(message = "") {
    this.scheduleLoadingTracker.updateMessage(message);
  }

  applyScheduleLoadingState(state = this.scheduleLoadingTracker.getState()) {
    const { active, message } = state;
    if (this.dom.scheduleLoading) {
      this.dom.scheduleLoading.hidden = !active;
    }
    if (this.dom.scheduleLoadingText) {
      this.dom.scheduleLoadingText.textContent = active ? message || "" : "";
    }
  }

  async reloadSchedules() {
    if (!this.selectedEventId) {
      this.revealEventSelectionCue();
      return;
    }
    this.beginScheduleLoading("日程情報を再読み込みしています…");
    try {
      await this.loadEvents();
    } finally {
      this.endScheduleLoading();
    }
  }

  openScheduleDialog({ mode = "create", schedule = null } = {}) {
    if (!this.dom.scheduleDialog || !this.dom.scheduleForm) return;
    if (!this.selectedEventId) {
      this.revealEventSelectionCue();
      return;
    }

    this.dom.scheduleForm.reset();
    this.dom.scheduleForm.dataset.mode = mode;
    this.dom.scheduleForm.dataset.scheduleId = schedule?.id || "";
    this.setFormError(this.dom.scheduleError, "");
    const selectedSchedule = this.getSelectedSchedule();
    const rememberedLocation = ensureString(this.lastScheduleLocation);
    const initialLocation =
      mode === "edit" && schedule
        ? ensureString(schedule.location)
        : rememberedLocation || ensureString(selectedSchedule?.location);
    this.populateScheduleLocationOptions(initialLocation);
    if (this.dom.scheduleLocationInput) {
      this.dom.scheduleLocationInput.value = initialLocation;
    }

    if (this.dom.scheduleDialogTitle) {
      this.dom.scheduleDialogTitle.textContent = mode === "edit" ? "日程を編集" : "日程を追加";
    }
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }
    const lastPickedDate = ensureString(this.scheduleCalendar?.calendarState?.pickedDate);
    let initialDateValue = lastPickedDate;
    if (mode === "edit" && schedule) {
      if (this.dom.scheduleLabelInput) this.dom.scheduleLabelInput.value = schedule.label || "";
      const scheduleDateSource = schedule?.startAt || schedule?.date || lastPickedDate;
      const normalizedDate = normalizeDateInputValue(scheduleDateSource);
      if (this.dom.scheduleDateInput) {
        this.dom.scheduleDateInput.value = normalizedDate;
      }
      initialDateValue = normalizedDate || lastPickedDate;
      if (this.dom.scheduleStartInput) {
        this.dom.scheduleStartInput.value = extractTimePart(schedule.startAt);
      }
      if (this.dom.scheduleEndInput) {
        this.dom.scheduleEndInput.value = extractTimePart(schedule.endAt);
      }
    } else {
      let normalizedLastPicked = normalizeDateInputValue(lastPickedDate);
      if (!normalizedLastPicked) {
        const fallbackSource =
          ensureString(selectedSchedule?.date) ||
          ensureString(selectedSchedule?.startAt) ||
          ensureString(selectedSchedule?.endAt) ||
          new Date().toISOString();
        normalizedLastPicked = normalizeDateInputValue(fallbackSource);
      }
      if (this.dom.scheduleDateInput) {
        this.dom.scheduleDateInput.value = normalizedLastPicked;
      }
      initialDateValue = this.dom.scheduleDateInput?.value || normalizedLastPicked;
      const startSeed = ensureString(this.lastScheduleStartTime) || extractTimePart(selectedSchedule?.startAt);
      const endSeed = ensureString(this.lastScheduleEndTime) || extractTimePart(selectedSchedule?.endAt);
      if (this.dom.scheduleStartInput) {
        this.dom.scheduleStartInput.value = startSeed;
      }
      if (this.dom.scheduleEndInput) {
        this.dom.scheduleEndInput.value = endSeed || startSeed;
      }
    }

    const normalizedInitialDate = normalizeDateInputValue(initialDateValue);
    if (this.scheduleCalendar) {
      this.scheduleCalendar.setCalendarPickedDate(normalizedInitialDate, { updateInput: true });
      this.scheduleCalendar.prepareScheduleDialogCalendar(normalizedInitialDate);
      this.scheduleCalendar.syncScheduleEndMin();
    }

    this.openDialog(this.dom.scheduleDialog);
  }

  populateScheduleLocationOptions(preferred = "") {
    const list = this.dom.scheduleLocationList;
    if (!list) {
      return;
    }
    const normalize = (value) => ensureString(value).trim();
    const options = new Set();
    if (this.scheduleLocationHistory instanceof Set) {
      this.scheduleLocationHistory.forEach((value) => {
        const location = normalize(value);
        if (location) {
          options.add(location);
        }
      });
    }
    if (Array.isArray(this.schedules)) {
      this.schedules.forEach((schedule) => {
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

  async handleScheduleFormSubmit() {
    if (!this.dom.scheduleForm) return;
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    this.setFormError(this.dom.scheduleError, "");

    try {
      const mode = this.dom.scheduleForm.dataset.mode || "create";
      const scheduleId = this.dom.scheduleForm.dataset.scheduleId || "";
      const locationValue = ensureString(this.dom.scheduleLocationInput?.value).trim();
      const payload = {
        label: this.dom.scheduleLabelInput?.value,
        location: locationValue,
        date: this.dom.scheduleDateInput?.value,
        start: this.dom.scheduleStartInput?.value,
        end: this.dom.scheduleEndInput?.value
      };
      if (mode === "edit") {
        await this.updateSchedule(scheduleId, payload);
      } else {
        await this.createSchedule(payload);
      }
      this.rememberLastScheduleLocation(locationValue);
      this.rememberLastScheduleTimeRange(payload.start, payload.end);
      this.dom.scheduleForm.reset();
      this.closeDialog(this.dom.scheduleDialog);
    } catch (error) {
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  rememberLastScheduleLocation(value) {
    const normalized = ensureString(value).trim();
    this.lastScheduleLocation = normalized;
    if (normalized && this.scheduleLocationHistory instanceof Set) {
      this.scheduleLocationHistory.add(normalized);
    }
  }

  rememberLastScheduleTimeRange(start, end) {
    const startPart = extractTimePart(start);
    const endPart = extractTimePart(end);
    if (startPart) {
      this.lastScheduleStartTime = startPart;
    }
    if (endPart) {
      this.lastScheduleEndTime = endPart;
    }
  }

  resolveScheduleFormValues({ label, location, date, start, end }) {
    // schedulePanel に委譲
    return this.schedulePanel.resolveScheduleFormValues({ label, location, date, start, end });
  }

  async createSchedule(payload) {
    // schedulePanel に委譲
    return await this.schedulePanel.createSchedule(payload);
  }

  async updateSchedule(scheduleId, payload) {
    // schedulePanel に委譲
    return await this.schedulePanel.updateSchedule(scheduleId, payload);
  }

  async deleteSchedule(schedule) {
    // schedulePanel に委譲
    return await this.schedulePanel.deleteSchedule(schedule);
  }

  applyMetaNote() {
    // EventUIRenderer に委譲
    this.uiRenderer.applyMetaNote();
  }

  updateMetaNote() {
    const count = this.events.length;
    if (count > 0) {
      this.eventCountNote = `登録イベント数: ${count}件`;
    } else {
      this.eventCountNote = "";
    }
    this.applyMetaNote();
  }

  updateUserLabel() {
    const label = this.dom.userLabel;
    if (!label) {
      return;
    }
    const user = this.currentUser;
    if (!user) {
      label.textContent = "";
      label.hidden = true;
      label.removeAttribute("aria-label");
      return;
    }
    const displayName = String(user.displayName || "").trim();
    const email = String(user.email || "").trim();
    const text = displayName && email ? `${displayName} (${email})` : displayName || email;
    if (text) {
      label.textContent = text;
      label.hidden = false;
      label.setAttribute("aria-label", `ログイン中: ${text}`);
    } else {
      label.textContent = "";
      label.hidden = true;
      label.removeAttribute("aria-label");
    }
  }

  updateDocumentTitle() {
    if (typeof document === "undefined") {
      return;
    }
    const count = this.events.length;
    if (count > 0) {
      document.title = `イベントコントロールセンター (${count}件)`;
    } else {
      document.title = "イベントコントロールセンター";
    }
  }

  openEventDialog({ mode = "create", event = null } = {}) {
    if (!this.dom.eventDialog || !this.dom.eventForm) return;
    this.dom.eventForm.reset();
    this.dom.eventForm.dataset.mode = mode;
    this.dom.eventForm.dataset.eventId = event?.id || "";
    this.setFormError(this.dom.eventError, "");
    if (this.dom.eventDialogTitle) {
      this.dom.eventDialogTitle.textContent = mode === "edit" ? "イベントを編集" : "イベントを追加";
    }
    if (this.dom.eventNameInput) {
      this.dom.eventNameInput.value = mode === "edit" ? String(event?.name || "") : "";
    }
    const submitButton = this.dom.eventForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }
    this.openDialog(this.dom.eventDialog);
  }

  closeEventDialog() {
    if (this.dom.eventDialog) {
      this.closeDialog(this.dom.eventDialog);
    }
  }

  async handleEventFormSubmit() {
    if (!this.dom.eventForm || !this.dom.eventNameInput) return;
    const submitButton = this.dom.eventForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    this.setFormError(this.dom.eventError, "");

    try {
      const mode = this.dom.eventForm.dataset.mode || "create";
      const eventId = this.dom.eventForm.dataset.eventId || "";
      const name = this.dom.eventNameInput.value;
      if (mode === "edit") {
        await this.updateEvent(eventId, name);
        this.showAlert(`イベント「${name}」を更新しました。`);
      } else {
        await this.createEvent(name);
        this.showAlert(`イベント「${name}」を追加しました。`);
      }
      this.dom.eventForm.reset();
      this.closeEventDialog();
    } catch (error) {
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async createEvent(name) {
    // eventPanel に委譲
    return await this.eventPanel.createEvent(name);
  }

  async updateEvent(eventId, name) {
    // eventPanel に委譲
    return await this.eventPanel.updateEvent(eventId, name);
  }

  async deleteEvent(event) {
    // eventPanel に委譲
    return await this.eventPanel.deleteEvent(event);
  }

  bindDialogDismiss(element) {
    if (!element) return;
    element.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
        event.preventDefault();
        if (element === this.dom.confirmDialog) {
          this.resolveConfirm(false);
        } else if (element === this.dom.scheduleConflictDialog) {
          return;
        } else if (element === this.dom.operatorModeDialog) {
          this.resolveOperatorModeChoice(null);
          return;
        } else {
          this.closeDialog(element);
        }
      }
    });
  }

  openDialog(element) {
    if (!element) return;
    if (this.activeDialog && this.activeDialog !== element) {
      this.closeDialog(this.activeDialog);
    }
    this.activeDialog = element;
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.removeAttribute("hidden");
    document.body.classList.add("modal-open");
    const focusTarget = element.querySelector("[data-autofocus]") || element.querySelector("input, button, select, textarea");
    if (focusTarget instanceof HTMLElement) {
      requestAnimationFrame(() => focusTarget.focus());
    }
  }

  closeDialog(element) {
    if (!element) return;
    if (!element.hasAttribute("hidden")) {
      element.setAttribute("hidden", "");
    }
    if (this.activeDialog === element) {
      document.body.classList.remove("modal-open");
      const toFocus = this.lastFocused;
      this.activeDialog = null;
      this.lastFocused = null;
      if (toFocus && typeof toFocus.focus === "function") {
        toFocus.focus();
      }
    }
    if (element === this.dom.eventDialog && this.dom.eventForm) {
      this.dom.eventForm.reset();
      this.setFormError(this.dom.eventError, "");
    }
    if (element === this.dom.scheduleConflictDialog) {
      if (this.dom.scheduleConflictForm) {
        this.dom.scheduleConflictForm.reset();
      }
      this.clearScheduleConflictError();
      this.pendingNavigationTarget = "";
      this.navigationManager.pendingNavigationTarget = "";
      this.pendingNavigationMeta = null;
      this.navigationManager.pendingNavigationMeta = null;
      this.awaitingScheduleConflictPrompt = false;
      this.clearPendingNavigationTimer();
    }
    if (element === this.dom.scheduleFallbackDialog) {
      if (this.dom.scheduleFallbackForm) {
        this.dom.scheduleFallbackForm.reset();
      }
      if (this.dom.scheduleFallbackOptions) {
        this.dom.scheduleFallbackOptions.innerHTML = "";
      }
      this.clearScheduleFallbackError();
      this.scheduleFallbackContext = null;
    }
    if (element === this.dom.operatorModeDialog) {
      if (this.dom.operatorModeForm) {
        this.dom.operatorModeForm.reset();
      }
      if (this.dom.operatorModeOptions) {
        this.dom.operatorModeOptions.innerHTML = "";
      }
      this.clearOperatorModeChoiceError();
      this.operatorModeChoiceContext = null;
      this.operatorModeChoiceResolver = null;
    }
  }

  handleGlobalKeydown(event) {
    // モーダルパネル「表示モードを選択」が開いている時のキーボードショートカット
    if (this.activeDialog === this.dom.fullscreenPromptDialog) {
      const target = event.target;
      const isFormField =
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [role='textbox'], [contenteditable=''], [contenteditable='true']");
      
      // 入力フィールドにフォーカスがある場合は無視
      if (!isFormField && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.key === "f" || event.key === "F") {
          // 「f」でフルスクリーンで続行
          event.preventDefault();
          if (this.dom.fullscreenPromptEnterButton && !this.dom.fullscreenPromptEnterButton.disabled) {
            this.handleFullscreenPromptEnter().catch((error) => {
              logError("Failed to handle fullscreen prompt", error);
            });
          }
          return;
        }
        if (event.key === "n" || event.key === "N") {
          // 「n」で通常表示のまま
          event.preventDefault();
          if (this.dom.fullscreenPromptStayButton && !this.dom.fullscreenPromptStayButton.disabled) {
            this.handleFullscreenPromptDismiss();
          }
          return;
        }
      }
    }

    // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
    if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (this.activeDialog) {
        // ダイアログが開いている時は既存の処理
        event.preventDefault();
        if (this.activeDialog === this.dom.confirmDialog) {
          this.resolveConfirm(false);
        } else if (this.activeDialog === this.dom.operatorModeDialog) {
          this.resolveOperatorModeChoice(null);
        } else {
          this.closeDialog(this.activeDialog);
        }
        return;
      }
    }

    // ESC で入力状態から回復（チャット入力 → チャットスクロール）
    if (event.key === "Escape" && !this.isFullscreenActive()) {
      const activeElement = document.activeElement;
      const isChatInputFocused = this.dom.chatInput && (
        activeElement === this.dom.chatInput ||
        (activeElement instanceof HTMLElement && this.dom.chatInput.contains(activeElement))
      );

      if (isChatInputFocused) {
        // チャット入力にフォーカスがある時 → チャット本体にフォーカス
        event.preventDefault();
        if (this.dom.chatScroll) {
          this.dom.chatScroll.focus();
        }
        return;
      }
    }

    // M でflow-stage-panelsにフォーカスを戻す（チャットスクロールや右サイドテロップ操作パネルから）
    if ((event.key === "m" || event.key === "M") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const activeElement = document.activeElement;
      const sideTelopPanel = document.getElementById("side-telop-panel");
      const isSideTelopFocused = sideTelopPanel && (
        activeElement === sideTelopPanel ||
        (activeElement instanceof HTMLElement && sideTelopPanel.contains(activeElement))
      );
      const isChatScrollFocused = this.dom.chatScroll && (
        activeElement === this.dom.chatScroll ||
        (activeElement === this.dom.chatScroll)
      );

      if (isChatScrollFocused) {
        // チャット本体にフォーカスがある時 → flow-stage-panels に戻る
        event.preventDefault();
        if (this.dom.flowStagePanels) {
          this.dom.flowStagePanels.focus();
        }
        return;
      }

      if (isSideTelopFocused) {
        // 右サイドテロップ操作パネルにフォーカスがある時 → flow-stage-panels に戻る
        event.preventDefault();
        if (this.dom.flowStagePanels) {
          this.dom.flowStagePanels.focus();
        }
        return;
      }
    }

    if (this.activeDialog) {
      return;
    }

    if (event.defaultPrevented) {
      return;
    }

    const target = event.target;
    const isFormField =
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [role='textbox'], [contenteditable=''], [contenteditable='true']");

    // サイドバーボタンのキーボードショートカット（1-9）
    // 入力フィールドにフォーカスがある場合は無視
    if (!isFormField && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = typeof event.key === "string" ? event.key : "";
      const numKey = parseInt(key, 10);
      if (numKey >= 1 && numKey <= 9) {
        const sidebarButtons = this.dom.sidebarPanelButtons || [];
        const buttonIndex = numKey - 1;
        if (buttonIndex < sidebarButtons.length) {
          const button = sidebarButtons[buttonIndex];
          if (button && !button.disabled && !button.hidden) {
            event.preventDefault();
            button.click();
            return;
          }
        }
      }
    }

    // Option/ALT + T で右サイドテロップ操作パネルにフォーカス
    if ((event.altKey || event.metaKey) && !event.ctrlKey && !event.shiftKey && (event.key === "t" || event.key === "T")) {
      const sideTelopPanel = document.getElementById("side-telop-panel");
      if (sideTelopPanel && !sideTelopPanel.hidden) {
        event.preventDefault();
        sideTelopPanel.focus();
        return;
      }
    }

    // ログアウトのキーボードショートカット「l」
    if (!isFormField && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === "l" || event.key === "L") {
        if (this.dom.logoutButton && !this.dom.logoutButton.disabled && !this.dom.logoutButton.hidden) {
          event.preventDefault();
          this.handleLogoutClick().catch((error) => {
            logError("Failed to handle logout", error);
          });
          return;
        }
      }
    }

    // フルスクリーン切り替えのキーボードショートカット「f」
    if (!isFormField && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === "f" || event.key === "F") {
        if (this.dom.fullscreenButton && !this.dom.fullscreenButton.disabled && !this.dom.fullscreenButton.hidden) {
          event.preventDefault();
          this.toggleFullscreen().catch((error) => {
            logError("Failed to toggle fullscreen", error);
            this.updateFullscreenButton();
          });
          return;
        }
      }
    }

    // スラッシュ（/）でチャット入力にフォーカス
    // 入力フィールドにフォーカスがある場合は無視（ただし、チャット入力自体は除く）
    if (!isFormField && !event.altKey && !event.ctrlKey && !event.metaKey && event.key === "/") {
      const chatInput = this.dom.chatInput;
      if (chatInput && !chatInput.disabled) {
        event.preventDefault();
        chatInput.focus();
        return;
      }
    }

    // フォーカス位置を確認
    const activeElement = document.activeElement;
    const sideTelopPanel = document.getElementById("side-telop-panel");
    const isSideTelopFocused = sideTelopPanel && (
      activeElement === sideTelopPanel ||
      (activeElement instanceof HTMLElement && sideTelopPanel.contains(activeElement))
    );
    const isFlowStagePanelsFocused = this.dom.flowStagePanels && (
      activeElement === this.dom.flowStagePanels ||
      (activeElement instanceof HTMLElement && this.dom.flowStagePanels.contains(activeElement) && !isSideTelopFocused)
    );

    // 右サイドテロップ操作パネルのキーボードショートカット
    // 右サイドテロップ操作パネルにフォーカスがある時だけ有効にする
    if (isSideTelopFocused && sideTelopPanel && !sideTelopPanel.hidden && !isFormField && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = typeof event.key === "string" ? event.key : "";
      const normalized = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
      
      // 右サイドテロップ操作
      // 上下矢印キーの処理
      if (key === "ArrowUp" || key === "Up") {
        // 上矢印: テロップリストで上に移動
        event.preventDefault();
        const sideTelopList = document.getElementById("side-telop-list");
        if (sideTelopList) {
          const items = Array.from(sideTelopList.querySelectorAll(".side-telop-item"));
          const currentIndex = items.findIndex((item) => item.classList.contains("is-selected"));
          if (currentIndex > 0) {
            const prevItem = items[currentIndex - 1];
            if (prevItem) {
              prevItem.click();
              prevItem.focus();
            }
          } else if (items.length > 0) {
            const lastItem = items[items.length - 1];
            lastItem.click();
            lastItem.focus();
          }
        }
        return;
      }
      
      if (key === "ArrowDown" || key === "Down") {
        // 下矢印: テロップリストで下に移動
        event.preventDefault();
        const sideTelopList = document.getElementById("side-telop-list");
        if (sideTelopList) {
          const items = Array.from(sideTelopList.querySelectorAll(".side-telop-item"));
          const currentIndex = items.findIndex((item) => item.classList.contains("is-selected"));
          if (currentIndex >= 0 && currentIndex < items.length - 1) {
            const nextItem = items[currentIndex + 1];
            if (nextItem) {
              nextItem.click();
              nextItem.focus();
            }
          } else if (items.length > 0) {
            const firstItem = items[0];
            firstItem.click();
            firstItem.focus();
          }
        }
        return;
      }
      
      // Deleteキーの処理（normalizedの前にチェック）
      if (key === "Delete") {
        const sideTelopDeleteButton = document.getElementById("side-telop-delete");
        if (sideTelopDeleteButton && !sideTelopDeleteButton.disabled) {
          event.preventDefault();
          sideTelopDeleteButton.click();
          return;
        }
      }
      
      switch (normalized) {
        case "a": {
          // Aキー: テロップ追加（テキストエリアにフォーカス）
          const sideTelopText = document.getElementById("side-telop-text");
          if (sideTelopText && !sideTelopText.disabled) {
            event.preventDefault();
            sideTelopText.focus();
            return;
          }
          break;
        }
        case "e": {
          // Eキー: 選択中のテロップを編集
          const sideTelopEditButton = document.getElementById("side-telop-edit");
          if (sideTelopEditButton && !sideTelopEditButton.disabled) {
            event.preventDefault();
            sideTelopEditButton.click();
            return;
          }
          break;
        }
        default:
          break;
      }
    }

    // チャット本体にフォーカスがある時の上下キーでスクロール
    const isChatScrollFocused = this.dom.chatScroll && (
      activeElement === this.dom.chatScroll
    );
    if (isChatScrollFocused && !isFormField && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = typeof event.key === "string" ? event.key : "";
      if (key === "ArrowDown" || key === "Down" || key === "ArrowUp" || key === "Up") {
        event.preventDefault();
        const scrollAmount = 100; // スクロール量（ピクセル）
        if (key === "ArrowDown" || key === "Down") {
          this.dom.chatScroll.scrollBy({ top: scrollAmount, behavior: "smooth" });
        } else if (key === "ArrowUp" || key === "Up") {
          this.dom.chatScroll.scrollBy({ top: -scrollAmount, behavior: "smooth" });
        }
        return;
      }
    }

    // flow-stage-panelsにフォーカスがある時の上下キー操作
    // パネル内のカード（イベントリスト、日程リストなど）を操作できるようにする
    if (isFlowStagePanelsFocused && !isFormField && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const key = typeof event.key === "string" ? event.key : "";
      if (key === "ArrowDown" || key === "Down" || key === "ArrowUp" || key === "Up") {
        // 日程選択パネルがアクティブで、日程リストがある場合
        if (this.activePanel === "schedules" && this.dom.scheduleList) {
          const items = this.getScheduleListItems?.() || [];
          if (items.length > 0) {
            event.preventDefault();
            const currentIndex = items.findIndex((el) => el.dataset.scheduleId === this.selectedScheduleId);
            const activeIndex = currentIndex >= 0 ? currentIndex : -1;
            let nextIndex = activeIndex >= 0 ? activeIndex : 0;
            
            if (key === "ArrowDown" || key === "Down") {
              nextIndex = Math.min(items.length - 1, activeIndex + 1 || 0);
            } else if (key === "ArrowUp" || key === "Up") {
              nextIndex = Math.max(0, activeIndex >= 0 ? activeIndex - 1 : 0);
            }
            
            const nextItem = items[nextIndex];
            if (nextItem) {
              this.focusScheduleListItem(nextItem, { select: true });
            }
            return;
          }
        }
        // イベントパネルがアクティブで、イベントリストがある場合
        if (this.activePanel === "events" && this.dom.eventList) {
          const items = this.getEventListItems?.() || [];
          if (items.length > 0) {
            event.preventDefault();
            const currentIndex = items.findIndex((el) => el.dataset.eventId === this.selectedEventId);
            const activeIndex = currentIndex >= 0 ? currentIndex : -1;
            let nextIndex = activeIndex >= 0 ? activeIndex : 0;
            
            if (key === "ArrowDown" || key === "Down") {
              nextIndex = Math.min(items.length - 1, activeIndex + 1 || 0);
            } else if (key === "ArrowUp" || key === "Up") {
              nextIndex = Math.max(0, activeIndex >= 0 ? activeIndex - 1 : 0);
            }
            
            const nextItem = items[nextIndex];
            if (nextItem) {
              this.focusEventListItem(nextItem, { select: true });
            }
            return;
          }
        }
        // 他のパネルでも同様の操作を追加できるようにする
      }
    }

    // flow-stage-panelsにフォーカスがある時の上下キー操作は上で処理済み
    // ここから下は、activePanel === "events"の時の他のキーボードショートカット処理
    if (this.activePanel === "events") {
      const key = typeof event.key === "string" ? event.key : "";
      const normalized = key.length === 1 ? key.toLowerCase() : key;
      
      if (isFormField && !(event.ctrlKey || event.metaKey)) {
        return;
      }

      switch (normalized) {
        case "a": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          if (this.dom.addEventButton?.disabled) return;
          this.openEventDialog({ mode: "create" });
          return;
        }
        case "p": {
          if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
          event.preventDefault();
          const printButton = this.dom.eventPrintButton;
          if (printButton && printButton.disabled) return;
          this.handleEventPrint();
          return;
        }
        case "r": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const refreshButton = this.dom.refreshButton;
          if (!refreshButton || refreshButton.disabled) return;
          event.preventDefault();
          refreshButton.disabled = true;
          void (async () => {
            try {
              this.beginEventsLoading("イベント情報を再読み込みしています…");
              await this.loadEvents();
            } catch (error) {
              logError("Failed to refresh events via shortcut", error);
              this.showAlert(error?.message || "イベントの再読み込みに失敗しました。");
            } finally {
              this.endEventsLoading();
              refreshButton.disabled = false;
            }
          })();
          return;
        }
        case "e": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const selected = this.getSelectedEvent();
          if (!selected) return;
          event.preventDefault();
          this.openEventDialog({ mode: "edit", event: selected });
          return;
        }
        case "Delete": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const selected = this.getSelectedEvent();
          if (!selected) return;
          event.preventDefault();
          void this.deleteEvent(selected).catch((error) => {
            logError("Failed to delete event via shortcut", error);
            this.showAlert(error?.message || "イベントの削除に失敗しました。");
          });
          return;
        }
        default:
          break;
      }
      return;
    }

    // 日程選択パネルがアクティブな時のキーボードショートカット処理
    if (this.activePanel === "schedules") {
      const key = typeof event.key === "string" ? event.key : "";
      const normalized = key.length === 1 ? key.toLowerCase() : key;
      
      if (isFormField && !(event.ctrlKey || event.metaKey)) {
        return;
      }

      switch (normalized) {
        case "a": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          if (this.dom.addScheduleButton?.disabled) return;
          this.openScheduleDialog({ mode: "create" });
          return;
        }
        case "r": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const refreshButton = this.dom.scheduleRefreshButton;
          if (!refreshButton || refreshButton.disabled) return;
          event.preventDefault();
          refreshButton.disabled = true;
          void (async () => {
            try {
              this.beginScheduleLoading("日程情報を再読み込みしています…");
              await this.reloadSchedules();
            } catch (error) {
              logError("Failed to refresh schedules via shortcut", error);
              this.showAlert(error?.message || "日程の再読み込みに失敗しました。");
            } finally {
              this.endScheduleLoading();
              refreshButton.disabled = false;
            }
          })();
          return;
        }
        case "e": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const selected = this.getSelectedSchedule();
          if (!selected) return;
          event.preventDefault();
          this.openScheduleDialog({ mode: "edit", schedule: selected });
          return;
        }
        case "Delete": {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const selected = this.getSelectedSchedule();
          if (!selected) return;
          event.preventDefault();
          void this.deleteSchedule(selected).catch((error) => {
            logError("Failed to delete schedule via shortcut", error);
            this.showAlert(error?.message || "日程の削除に失敗しました。");
          });
          return;
        }
        case "Enter": {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          const selected = this.getSelectedSchedule();
          if (!selected) return;
          if (!this.selectedScheduleId) return;
          event.preventDefault();
          // 確定ボタンと同じ挙動にするため、originPanelを明示的に設定
          void this.handleFlowNavigation("participants", { 
            sourceButton: null,
            originPanel: "schedules"
          });
          return;
        }
        default:
          break;
      }
    }
  }

  async confirm({
    title = "確認",
    description = "",
    confirmLabel = "実行する",
    cancelLabel = "キャンセル",
    tone = "danger"
  } = {}) {
    if (!this.dom.confirmDialog) {
      return window.confirm(description || title);
    }

    if (this.confirmResolver) {
      this.finalizeConfirm(false);
    }

    if (this.dom.confirmDialogTitle) {
      this.dom.confirmDialogTitle.textContent = title || "確認";
    }
    if (this.dom.confirmDialogMessage) {
      this.dom.confirmDialogMessage.textContent = description || "";
    }
    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.textContent = confirmLabel || "実行する";
      this.dom.confirmAcceptButton.classList.remove("btn-danger", "btn-primary");
      this.dom.confirmAcceptButton.classList.add(tone === "danger" ? "btn-danger" : "btn-primary");
    }
    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.textContent = cancelLabel || "キャンセル";
    }

    this.openDialog(this.dom.confirmDialog);

    return await new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  resolveConfirm(result) {
    const resolver = this.confirmResolver;
    this.confirmResolver = null;
    if (this.dom.confirmDialog) {
      this.closeDialog(this.dom.confirmDialog);
    }
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  setFormError(element, message = "") {
    if (!element) return;
    if (message) {
      element.hidden = false;
      element.textContent = message;
    } else {
      element.hidden = true;
      element.textContent = "";
    }
  }
}

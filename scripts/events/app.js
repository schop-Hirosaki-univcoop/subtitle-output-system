// app.js: イベント管理フローの中核ロジックを担い、Firebaseとの同期と画面遷移制御をまとめます。
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
  onValue,
  serverTimestamp,
  onDisconnect,
  getOperatorPresenceEventRef,
  getOperatorPresenceEntryRef,
  getOperatorScheduleConsensusRef,
  runTransaction
} from "../operator/firebase.js";
import { createApiClient } from "../operator/api-client.js";
import { generateShortId, normalizeKey, toMillis } from "../question-admin/utils.js";
import { formatRelative, formatScheduleRange } from "../operator/utils.js";
import { LoadingTracker } from "./loading-tracker.js";
import {
  ensureString,
  formatDateTimeLocal,
  buildContextDescription,
  logError,
  formatParticipantCount,
  collectParticipantTokens
} from "./helpers.js";
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
import { EventChat } from "./chat.js";
import { consumeAuthTransfer } from "../shared/auth-transfer.js";
import {
  loadAuthPreflightContext,
  preflightContextMatchesUser
} from "../shared/auth-preflight.js";
import { appendAuthDebugLog, replayAuthDebugLog } from "../shared/auth-debug-log.js";

const HOST_PRESENCE_HEARTBEAT_MS = 60_000;
const SCHEDULE_CONSENSUS_TOAST_MS = 3_000;
const PENDING_NAVIGATION_CLEAR_DELAY_MS = 5_000;
const AUTH_RESUME_FALLBACK_DELAY_MS = 4_000;
const DISPLAY_LOCK_REASONS = new Set([
  "schedule-commit",
  "navigation",
  "consensus-submit",
  "consensus-apply",
  "consensus-align",
  "consensus-follow"
]);

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

/**
 * イベント管理画面全体を統括するアプリケーションクラスです。
 * Firebaseの認証・Realtime Database・埋め込みツールを連携し
 * 画面遷移、選択状態の同期、各種トースト/ダイアログ制御を提供します。
 */
export class EventAdminApp {
  constructor() {
    this.dom = queryDom();
    this.api = createApiClient(auth, onAuthStateChanged);
    this.authUnsubscribe = null;
    this.currentUser = null;
    this.events = [];
    this.selectedEventId = "";
    this.schedules = [];
    this.selectedScheduleId = "";
    this.selectionListeners = new Set();
    this.eventListeners = new Set();
    this.participantHostInterface = null;
    this.suppressSelectionNotifications = false;
    this.lastSelectionSignature = "";
    this.lastSelectionSource = "";
    this.forceSelectionBroadcast = true;
    this.stage = "events";
    this.preflightContext = null;
    this.stageHistory = new Set(["events"]);
    this.activePanel = "events";
    this.activeDialog = null;
    this.lastFocused = null;
    this.confirmResolver = null;
    this.redirectingToIndex = false;
    this.hasSeenAuthenticatedUser = Boolean(auth?.currentUser);
    this.authResumeFallbackTimer = 0;
    this.authResumeGracePeriodMs = AUTH_RESUME_FALLBACK_DELAY_MS;
    this.authResumeTimerHost = getTimerHost();
    this.eventsLoadingTracker = new LoadingTracker({
      onChange: (state) => this.applyEventsLoadingState(state)
    });
    this.scheduleLoadingTracker = new LoadingTracker({
      onChange: (state) => this.applyScheduleLoadingState(state)
    });
    this.tools = new ToolCoordinator(this);
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
    this.cleanup = this.cleanup.bind(this);
    this.eventCountNote = "";
    this.stageNote = "";
    this.applyMetaNote();
    this.chat = new EventChat(this);
    this.operatorMode = OPERATOR_MODE_TELOP;
    this.backupInFlight = false;
    this.restoreInFlight = false;
    this.displayUrlCopyTimer = 0;
    this.operatorPresenceEntries = [];
    this.operatorPresenceEventId = "";
    this.operatorPresenceUnsubscribe = null;
    this.hostPresenceSessionId = this.generatePresenceSessionId();
    this.hostPresenceEntryKey = "";
    this.hostPresenceEntryRef = null;
    this.hostPresenceDisconnect = null;
    this.hostPresenceHeartbeat = null;
    this.hostPresenceLastSignature = "";
    this.cachedHostPresenceStorage = undefined;
    this.hostCommittedScheduleId = "";
    this.hostCommittedScheduleLabel = "";
    this.eventSelectionCommitted = false;
    this.scheduleSelectionCommitted = false;
    this.scheduleConflictContext = null;
    this.scheduleConflictLastSignature = "";
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.lastScheduleCommitChanged = false;
    this.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
    this.pendingNavigationClearTimer = 0;
    this.awaitingScheduleConflictPrompt = false;
    this.scheduleConflictRadioName = generateShortId("flow-conflict-radio-");
    this.scheduleFallbackRadioName = generateShortId("flow-fallback-radio-");
    this.flowDebugEnabled = false;
    this.operatorPresenceDebugEnabled = true;
    this.scheduleConsensusEventId = "";
    this.scheduleConsensusUnsubscribe = null;
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    this.scheduleConsensusToastTimer = 0;
    this.scheduleConsensusHideTimer = 0;
    this.scheduleFallbackContext = null;
    this.handleWindowResize = this.handleWindowResize.bind(this);
    this.updateChatLayoutMetrics = this.updateChatLayoutMetrics.bind(this);
    this.chatLayoutResizeObserver = null;
    this.chatLayoutRaf = 0;
    this.visualViewportResize = null;
    this.activeMobilePanel = "";
    this.chatUnreadCount = 0;
    this.chatScrollUnreadCount = 0;
    this.authTransferAttempted = false;
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
    if (typeof crypto !== "undefined") {
      if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
      if (typeof crypto.getRandomValues === "function") {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, (value) => value.toString(16).padStart(2, "0")).join("");
      }
    }
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  buildFlowState() {
    const event = this.getSelectedEvent();
    const schedule = this.getSelectedSchedule();
    const presence = this.operatorPresenceEntries.map((entry) => ({
      entryId: entry.entryId,
      uid: entry.uid,
      displayName: entry.displayName,
      scheduleId: entry.scheduleId,
      scheduleKey: entry.scheduleKey,
      scheduleLabel: entry.scheduleLabel,
      isSelf: Boolean(entry.isSelf),
      mode: entry.mode,
      updatedAt: entry.updatedAt
    }));
    const conflict = this.scheduleConflictContext
      ? {
          eventId: this.scheduleConflictContext.eventId,
          hasConflict: this.scheduleConflictContext.hasConflict,
          hasOtherOperators: this.scheduleConflictContext.hasOtherOperators,
          hostScheduleId: this.scheduleConflictContext.hostScheduleId,
          hostScheduleKey: this.scheduleConflictContext.hostScheduleKey,
          defaultKey: this.scheduleConflictContext.defaultKey,
          options: this.scheduleConflictContext.options.map((option) => ({
            key: option.key,
            scheduleId: option.scheduleId,
            scheduleLabel: option.scheduleLabel,
            scheduleRange: option.scheduleRange,
            containsSelf: option.containsSelf,
            memberCount: option.members?.length || 0
          }))
        }
      : null;
    return {
      stage: this.stage,
      activePanel: this.activePanel,
      pendingNavigationTarget: this.pendingNavigationTarget || "",
      operatorMode: this.operatorMode,
      currentUser: this.currentUser
        ? {
            uid: this.currentUser.uid || "",
            displayName: this.currentUser.displayName || "",
            email: this.currentUser.email || ""
          }
        : null,
      selectedEvent: event
        ? {
            id: event.id,
            name: event.name || "",
            scheduleCount: Array.isArray(event.schedules) ? event.schedules.length : 0
          }
        : null,
      selectedSchedule: schedule
        ? {
            id: schedule.id,
            label: schedule.label || "",
            startAt: schedule.startAt || "",
            endAt: schedule.endAt || ""
          }
        : null,
      operatorPresenceEventId: this.operatorPresenceEventId || "",
      operatorPresence: presence,
      scheduleConflict: conflict
    };
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

  logOperatorPresenceDebug(message, detail = null) {
    if (!this.operatorPresenceDebugEnabled) {
      return;
    }
    const timestamp = new Date().toISOString();
    const prefix = `[Presence] ${timestamp} ${message}`;
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
      this.updateUserLabel();
    }
    this.bindEvents();
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
    if (typeof document !== "undefined") {
      document.addEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.addEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", this.cleanup, { once: true });
    }
  }

  resetFlowState() {
    this.selectedEventId = "";
    this.schedules = [];
    this.selectedScheduleId = "";
    this.stage = "events";
    this.stageHistory = new Set(["events"]);
    this.activePanel = "events";
    this.eventsLoadingTracker.reset();
    this.scheduleLoadingTracker.reset();
    this.clearOperatorPresenceState();
    this.eventCountNote = "";
    this.stageNote = "";
    this.forceSelectionBroadcast = true;
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

    if (this.dom.operatorModeToggle) {
      this.dom.operatorModeToggle.addEventListener("change", (event) => {
        const checked = event.target instanceof HTMLInputElement ? event.target.checked : this.dom.operatorModeToggle.checked;
        const mode = checked ? OPERATOR_MODE_SUPPORT : OPERATOR_MODE_TELOP;
        this.setOperatorMode(mode, { fromControl: true });
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
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
    this.authUnsubscribe = onAuthStateChanged(auth, (user) => {
      this.handleAuthState(user).catch((error) => {
        logError("Failed to handle event admin auth state", error);
        this.showAlert(error.message || "初期化に失敗しました。時間をおいて再度お試しください。");
      });
    });
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
    if (!user) {
      appendAuthDebugLog("events:preflight-context:skip", { reason: "no-user" }, { level: "debug" });
      return null;
    }
    const context = loadAuthPreflightContext();
    if (!context) {
      appendAuthDebugLog("events:preflight-context:missing");
      return null;
    }
    if (!preflightContextMatchesUser(context, user)) {
      appendAuthDebugLog("events:preflight-context:identity-mismatch", {
        contextUid: context?.uid || null,
        userUid: user?.uid || null
      });
      return null;
    }
    appendAuthDebugLog("events:preflight-context:loaded", {
      questionCount: context?.mirror?.questionCount ?? null
    });
    return context;
  }

  async tryResumeAuth() {
    if (this.authTransferAttempted) {
      appendAuthDebugLog("events:auth-resume:skipped", { reason: "already-attempted" }, { level: "debug" });
      return false;
    }
    this.authTransferAttempted = true;
    appendAuthDebugLog("events:auth-resume:start");

    let transfer = consumeAuthTransfer();
    if (!this.isValidTransferPayload(transfer)) {
      const fallbackContext = loadAuthPreflightContext();
      appendAuthDebugLog("events:auth-resume:transfer-missing", {
        hasFallbackContext: Boolean(fallbackContext)
      });
      const fallbackCredential = fallbackContext?.credential;
      if (fallbackCredential && (fallbackCredential.idToken || fallbackCredential.accessToken)) {
        appendAuthDebugLog("events:auth-resume:fallback-credential", {
          hasIdToken: Boolean(fallbackCredential.idToken),
          hasAccessToken: Boolean(fallbackCredential.accessToken)
        });
        transfer = {
          providerId: fallbackCredential.providerId || GoogleAuthProvider.PROVIDER_ID,
          signInMethod: fallbackCredential.signInMethod || "",
          idToken: fallbackCredential.idToken || "",
          accessToken: fallbackCredential.accessToken || "",
          timestamp: Date.now()
        };
      }
    }

    if (!this.isValidTransferPayload(transfer)) {
      appendAuthDebugLog("events:auth-resume:invalid-payload", null, { level: "warn" });
      return false;
    }

    const providerId = transfer.providerId || "";
    if (providerId && providerId !== GoogleAuthProvider.PROVIDER_ID) {
      logError("Unsupported auth transfer provider", new Error(providerId));
      appendAuthDebugLog("events:auth-resume:unsupported-provider", { providerId }, { level: "error" });
      return false;
    }

    const idToken = transfer.idToken || "";
    const accessToken = transfer.accessToken || "";
    const credential = GoogleAuthProvider.credential(
      idToken || undefined,
      accessToken || undefined
    );
    if (!credential) {
      return false;
    }

    try {
      await signInWithCredential(auth, credential);
      appendAuthDebugLog("events:auth-resume:success");
      return true;
    } catch (error) {
      logError("Failed to resume auth from transfer payload", error);
      appendAuthDebugLog(
        "events:auth-resume:error",
        { code: error?.code || null, message: error?.message || null },
        { level: "error" }
      );
      return false;
    }
  }

  isValidTransferPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return false;
    }
    const hasToken = Boolean((payload.idToken || "").trim()) || Boolean((payload.accessToken || "").trim());
    return hasToken;
  }

  scheduleAuthResumeFallback(reason = "unknown") {
    if (this.authResumeFallbackTimer) {
      appendAuthDebugLog("events:auth-resume:fallback-already-scheduled", { reason }, { level: "debug" });
      return;
    }
    const host = this.authResumeTimerHost || getTimerHost();
    const delayMs = Number.isFinite(this.authResumeGracePeriodMs)
      ? Math.max(0, this.authResumeGracePeriodMs)
      : 0;
    this.authResumeFallbackTimer = host.setTimeout(() => {
      this.authResumeFallbackTimer = 0;
      if (auth?.currentUser) {
        appendAuthDebugLog("events:auth-resume:fallback-aborted", {
          reason,
          uid: auth.currentUser.uid || null
        });
        return;
      }
      appendAuthDebugLog("events:auth-resume:fallback-trigger", { reason });
      this.showLoggedOutState();
    }, delayMs);
    appendAuthDebugLog("events:auth-resume:fallback-scheduled", { reason, delayMs });
  }

  cancelAuthResumeFallback(reason = "unknown") {
    if (!this.authResumeFallbackTimer) {
      return;
    }
    const host = this.authResumeTimerHost || getTimerHost();
    host.clearTimeout(this.authResumeFallbackTimer);
    this.authResumeFallbackTimer = 0;
    appendAuthDebugLog("events:auth-resume:fallback-cancelled", { reason }, { level: "debug" });
  }

  async handleAuthState(user) {
    appendAuthDebugLog("events:handle-auth-state", {
      uid: user?.uid || null
    });
    this.currentUser = user;
    this.chat.handleAuthChange(user);
    this.startChatReadListener(user);
    this.updateUserLabel();
    this.preflightContext = this.loadPreflightContextForUser(user);
    if (!user) {
      if (this.hasSeenAuthenticatedUser) {
        appendAuthDebugLog("events:handle-auth-state:signed-out");
        this.cancelAuthResumeFallback("signed-out");
        this.clearHostPresence();
        this.events = [];
        this.renderEvents();
        this.notifyEventListeners();
        this.notifySelectionListeners("host");
        this.clearAlert();
        this.showLoggedOutState();
        return;
      }
      if (await this.tryResumeAuth()) {
        appendAuthDebugLog("events:handle-auth-state:resuming");
        return;
      }
      this.scheduleAuthResumeFallback("initial-null-user");
      this.clearHostPresence();
      this.events = [];
      this.renderEvents();
      this.notifyEventListeners();
      this.notifySelectionListeners("host");
      this.clearAlert();
      return;
    }

    this.hasSeenAuthenticatedUser = true;
    this.cancelAuthResumeFallback("user-present");
    appendAuthDebugLog("events:handle-auth-state:user-present", {
      uid: user.uid || null
    });
    this.showLoggedInState();
    this.clearAlert();

    try {
      this.beginEventsLoading("権限を確認しています…");
      await this.ensureAdminAccess();
      this.updateEventsLoadingMessage("イベント情報を読み込んでいます…");
      await this.loadEvents();
      this.updateEventSummary();
      this.updateScheduleSummary();
      this.updateStageHeader();
      this.updateSelectionNotes();
      this.tools.preloadOperatorGlobals();
    } catch (error) {
      logError("Event admin initialization failed", error);
      if (this.isPermissionError(error)) {
        const message =
          (error instanceof Error && error.message) ||
          "アクセス権限がありません。管理者に確認してください。";
        this.showAlert(message);
        await this.safeSignOut();
        return;
      }
      const fallback = "イベント情報の読み込みに失敗しました。時間をおいて再度お試しください。";
      const message = error instanceof Error && error.message ? error.message : fallback;
      this.showAlert(message || fallback);
    } finally {
      this.endEventsLoading();
      this.clearLoadingIndicators();
      if (user) {
        this.syncHostPresence("auth-refresh");
      }
    }
  }

  async ensureAdminAccess() {
    if (!this.api) {
      return;
    }
    if (this.preflightContext?.admin?.ensuredAt) {
      return;
    }
    try {
      await this.api.apiPost({ action: "ensureAdmin" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error || "");
      let message = "権限の確認に失敗しました。時間をおいて再度お試しください。";
      if (/not in users sheet/i.test(rawMessage)) {
        message = "あなたのアカウントにはこのページへのアクセス権限がありません。管理者に確認してください。";
      }
      const err = new Error(message);
      err.code = "EVENT_INDEX_ACCESS_DENIED";
      err.cause = error;
      throw err;
    }
  }

  async safeSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Failed to sign out after permission error:", error);
    }
  }

  isPermissionError(error) {
    if (!error) return false;
    if (error.code === "EVENT_INDEX_ACCESS_DENIED") return true;
    const code = typeof error.code === "string" ? error.code : "";
    if (code.includes("PERMISSION")) return true;
    const message = error instanceof Error ? error.message : String(error || "");
    return /permission/i.test(message) || message.includes("権限");
  }

  async loadEvents() {
    const [eventsSnapshot, schedulesSnapshot] = await Promise.all([
      get(ref(database, "questionIntake/events")),
      get(ref(database, "questionIntake/schedules"))
    ]);

    const eventsValue = eventsSnapshot.exists() ? eventsSnapshot.val() : {};
    const schedulesTree = schedulesSnapshot.exists() ? schedulesSnapshot.val() : {};

    const normalized = Object.entries(eventsValue).map(([eventId, eventValue]) => {
      const scheduleBranch = schedulesTree?.[eventId] && typeof schedulesTree[eventId] === "object"
        ? schedulesTree[eventId]
        : {};
      const schedules = Object.entries(scheduleBranch).map(([scheduleId, scheduleValue]) => ({
        id: ensureString(scheduleId),
        label: ensureString(scheduleValue?.label),
        date: ensureString(scheduleValue?.date || ""),
        startAt: ensureString(scheduleValue?.startAt || scheduleValue?.date),
        endAt: ensureString(scheduleValue?.endAt || ""),
        participantCount: Number(scheduleValue?.participantCount || 0),
        createdAt: scheduleValue?.createdAt || 0
      }));

      schedules.sort((a, b) => {
        const startDiff = toMillis(a.startAt || a.createdAt) - toMillis(b.startAt || b.createdAt);
        if (startDiff !== 0) return startDiff;
        return a.id.localeCompare(b.id, "ja", { numeric: true });
      });

      const totalParticipants = schedules.reduce((acc, item) => acc + (item.participantCount || 0), 0);

      return {
        id: ensureString(eventId),
        name: ensureString(eventValue?.name) || ensureString(eventId),
        schedules,
        totalParticipants,
        scheduleCount: schedules.length,
        createdAt: eventValue?.createdAt || 0,
        updatedAt: eventValue?.updatedAt || 0
      };
    });

    normalized.sort((a, b) => {
      const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });

    const previousEventId = this.selectedEventId;
    const previousScheduleId = this.selectedScheduleId;

    this.events = normalized;
    this.tools.resetContext();
    this.updateMetaNote();
    this.updateDocumentTitle();
    this.ensureSelectedEvent(previousEventId);
    this.renderEvents();
    this.updateScheduleStateFromSelection(previousScheduleId);

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
    const list = this.dom.eventList;
    if (!list) return;

    list.innerHTML = "";
    if (!this.events.length) {
      list.hidden = true;
      if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = false;
      list.removeAttribute("role");
      list.removeAttribute("aria-label");
      list.removeAttribute("aria-orientation");
      return;
    }

    list.hidden = false;
    if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = true;

    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "イベント一覧");
    list.setAttribute("aria-orientation", "vertical");
    const fragment = document.createDocumentFragment();
    this.events.forEach((event) => {
      const item = document.createElement("li");
      item.className = "entity-item";
      item.dataset.eventId = event.id;
      item.setAttribute("role", "option");

      const isSelected = event.id === this.selectedEventId && this.selectedEventId;
      if (isSelected) {
        item.classList.add("is-selected");
        item.setAttribute("aria-selected", "true");
      } else {
        item.setAttribute("aria-selected", "false");
      }
      item.tabIndex = 0;

      const indicator = document.createElement("span");
      indicator.className = "entity-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const indicatorDot = document.createElement("span");
      indicatorDot.className = "entity-indicator__dot";
      indicator.appendChild(indicatorDot);

      const label = document.createElement("div");
      label.className = "entity-label";

      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = event.name || event.id;

      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      metaEl.textContent = `日程 ${event.scheduleCount} 件 / 参加者 ${formatParticipantCount(event.totalParticipants)}`;

      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "entity-action entity-action--edit";
      editBtn.setAttribute("aria-label", `${event.name || event.id} を編集`);
      editBtn.title = "イベントを編集";
      editBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z" fill="currentColor"/></svg></span><span class="entity-action__label">編集</span>';
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openEventDialog({ mode: "edit", event });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "entity-action entity-action--delete";
      deleteBtn.setAttribute("aria-label", `${event.name || event.id} を削除`);
      deleteBtn.title = "イベントを削除";
      deleteBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z"/></svg></span><span class="entity-action__label">削除</span>';
      deleteBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.deleteEvent(event).catch((error) => {
          logError("Failed to delete event", error);
          this.showAlert(error.message || "イベントの削除に失敗しました。");
        });
      });
      actions.appendChild(deleteBtn);

      item.append(indicator, label, actions);

      item.addEventListener("click", () => {
        this.selectEvent(event.id);
      });
      item.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          this.selectEvent(event.id);
        }
      });

      fragment.appendChild(item);
    });

    list.appendChild(fragment);
  }

  ensureSelectedEvent(preferredId = "") {
    const availableIds = new Set(this.events.map((event) => event.id));
    const desiredId = preferredId || this.selectedEventId;
    if (desiredId && availableIds.has(desiredId)) {
      this.selectedEventId = desiredId;
    } else {
      this.selectedEventId = "";
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
      this.tools.resetContext();
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
    this.updateSelectionNotes();
    this.showPanel(this.activePanel);
    this.tools.prepareContextForSelection();
    this.updateScheduleConflictState();
    this.syncOperatorPresenceSubscription();
    this.syncScheduleConsensusSubscription();
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
      this.logFlowState("利用可能な日程選択を維持しました", {
        scheduleId: this.selectedScheduleId,
        preferredScheduleId: preferredId || ""
      });
    } else {
      const previousScheduleId = this.selectedScheduleId;
      this.selectedScheduleId = "";
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
    const event = this.getSelectedEvent();
    const selectedSchedule = this.getSelectedSchedule();
    const committedScheduleId = ensureString(this.hostCommittedScheduleId);
    const committedScheduleLabel = ensureString(this.hostCommittedScheduleLabel);
    const committedSchedule = committedScheduleId ? this.getCommittedSchedule() : null;
    const schedule = selectedSchedule || committedSchedule || null;
    const fallbackScheduleId = ensureString(this.selectedScheduleId) || committedScheduleId;
    const scheduleId = ensureString(schedule?.id) || fallbackScheduleId;
    const scheduleLabel = ensureString(schedule?.label) || committedScheduleLabel || scheduleId;
    const startAt = ensureString(schedule?.startAt) || ensureString(committedSchedule?.startAt);
    const endAt = ensureString(schedule?.endAt) || ensureString(committedSchedule?.endAt);
    const committedScheduleKey = committedScheduleId
      ? this.derivePresenceScheduleKey(
          ensureString(event?.id || ""),
          { scheduleId: committedScheduleId, scheduleLabel: committedScheduleLabel },
          ensureString(this.hostPresenceSessionId)
        )
      : "";
    return {
      eventId: event?.id || "",
      eventName: event?.name || event?.id || "",
      scheduleId,
      scheduleLabel,
      startAt,
      endAt,
      operatorMode: this.operatorMode,
      committedScheduleId,
      committedScheduleLabel,
      committedScheduleKey
    };
  }

  resolveHostScheduleContext(eventId = "", { scheduleMap = null } = {}) {
    const normalizedEventId = ensureString(eventId) || ensureString(this.selectedEventId);
    const map =
      scheduleMap instanceof Map
        ? scheduleMap
        : new Map(this.schedules.map((schedule) => [schedule.id, schedule]));
    const selectedScheduleId = ensureString(this.selectedScheduleId);
    const committedScheduleId = ensureString(this.hostCommittedScheduleId);
    const pendingNavigationTarget = ensureString(this.pendingNavigationTarget);
    let resolvedScheduleId = "";
    if (this.scheduleSelectionCommitted) {
      resolvedScheduleId = selectedScheduleId || committedScheduleId;
    } else if (pendingNavigationTarget && selectedScheduleId) {
      resolvedScheduleId = selectedScheduleId;
    }
    if (!resolvedScheduleId && committedScheduleId) {
      resolvedScheduleId = committedScheduleId;
    }
    const schedule = resolvedScheduleId ? map.get(resolvedScheduleId) || null : null;
    let scheduleLabel = "";
    if (resolvedScheduleId) {
      if (resolvedScheduleId === committedScheduleId) {
        scheduleLabel = ensureString(this.hostCommittedScheduleLabel);
      }
      if (!scheduleLabel) {
        scheduleLabel = ensureString(schedule?.label) || resolvedScheduleId;
      }
    }
    const selectedSchedule = selectedScheduleId ? map.get(selectedScheduleId) || null : null;
    const selectedScheduleLabel = selectedSchedule
      ? ensureString(selectedSchedule.label) || selectedScheduleId
      : selectedScheduleId;
    const scheduleRange = schedule ? formatScheduleRange(schedule.startAt, schedule.endAt) : "";
    const scheduleKey = resolvedScheduleId
      ? this.derivePresenceScheduleKey(
          normalizedEventId,
          { scheduleId: resolvedScheduleId, scheduleLabel },
          this.hostPresenceSessionId
        )
      : "";
    return {
      eventId: normalizedEventId,
      scheduleId: resolvedScheduleId,
      scheduleLabel,
      scheduleRange,
      scheduleKey,
      schedule,
      committedScheduleId,
      selectedScheduleId,
      selectedScheduleLabel
    };
  }

  derivePresenceScheduleKey(eventId, payload = {}, entryId = "") {
    const ensure = (value) => String(value ?? "").trim();
    const normalizedEvent = ensure(eventId);
    const normalizedEntry = ensure(entryId);
    const source = payload && typeof payload === "object" ? payload : {};
    const rawKey = ensure(source.scheduleKey);
    if (rawKey) {
      return rawKey;
    }
    const scheduleId = ensure(source.scheduleId);
    if (normalizedEvent && scheduleId) {
      return `${normalizedEvent}::${normalizeScheduleId(scheduleId)}`;
    }
    if (scheduleId) {
      return normalizeScheduleId(scheduleId);
    }
    const scheduleLabel = ensure(source.scheduleLabel);
    if (scheduleLabel) {
      const sanitizedLabel = scheduleLabel.replace(/\s+/g, " ").trim().replace(/::/g, "／");
      if (normalizedEvent) {
        return `${normalizedEvent}::label::${sanitizedLabel}`;
      }
      return `label::${sanitizedLabel}`;
    }
    if (normalizedEvent && normalizedEntry) {
      return `${normalizedEvent}::session::${normalizedEntry}`;
    }
    return normalizedEntry || normalizedEvent || "";
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
    const normalized = ensureString(scheduleId);
    if (!normalized) {
      return null;
    }
    const directMatch = this.schedules.find((schedule) => schedule.id === normalized) || null;
    if (directMatch) {
      return directMatch;
    }
    const normalizedCandidate = normalizeScheduleId(normalized);
    if (!normalizedCandidate) {
      return null;
    }
    return (
      this.schedules.find((schedule) => normalizeScheduleId(schedule.id) === normalizedCandidate) || null
    );
  }

  resolveScheduleFromPresenceEntry(entry = null) {
    if (!entry || typeof entry !== "object") {
      return { scheduleId: "", schedule: null };
    }
    const direct = this.findScheduleByIdOrAlias(entry.scheduleId);
    if (direct) {
      return { scheduleId: direct.id, schedule: direct };
    }
    const derivedId = this.extractScheduleIdFromKey(entry.scheduleKey, this.selectedEventId);
    const derived = this.findScheduleByIdOrAlias(derivedId);
    if (derived) {
      return { scheduleId: derived.id, schedule: derived };
    }
    const label = ensureString(entry.scheduleLabel);
    if (label) {
      const labelMatch = this.schedules.find((schedule) => ensureString(schedule.label) === label) || null;
      if (labelMatch) {
        return { scheduleId: labelMatch.id, schedule: labelMatch };
      }
    }
    const fallbackId = ensureString(entry.scheduleId) || ensureString(derivedId);
    return { scheduleId: fallbackId, schedule: null };
  }

  getPresenceSourcePriority(entry = null) {
    const source = ensureString(entry?.source).toLowerCase();
    if (!source) {
      return 0;
    }
    if (source.includes("operator")) {
      return 3;
    }
    if (source === "events") {
      return 2;
    }
    return 1;
  }

  getAssignedScheduleFromPresence() {
    const uid = ensureString(this.currentUser?.uid);
    if (!uid) {
      return null;
    }
    const entries = Array.isArray(this.operatorPresenceEntries) ? this.operatorPresenceEntries : [];
    if (!entries.length) {
      return null;
    }
    const matches = entries.filter((entry) => ensureString(entry?.uid) === uid);
    if (!matches.length) {
      return null;
    }
    const evaluated = matches.map((entry) => {
      const { scheduleId, schedule } = this.resolveScheduleFromPresenceEntry(entry);
      return {
        entry,
        scheduleId,
        schedule,
        hasSchedule: Boolean(scheduleId),
        priority: this.getPresenceSourcePriority(entry),
        updatedAt: Number(entry?.updatedAt || 0) || 0
      };
    });
    const pool = evaluated.some((item) => item.hasSchedule)
      ? evaluated.filter((item) => item.hasSchedule)
      : evaluated;
    if (!pool.length) {
      return null;
    }
    pool.sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      const aId = ensureString(a.entry?.entryId);
      const bId = ensureString(b.entry?.entryId);
      return aId.localeCompare(bId, "ja");
    });
    const best = pool[0];
    if (!best) {
      return null;
    }
    return { entry: best.entry, scheduleId: best.scheduleId, schedule: best.schedule };
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
    if (!fromControl && this.dom.operatorModeToggle) {
      this.dom.operatorModeToggle.checked = normalized === OPERATOR_MODE_SUPPORT;
    }
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
    const panel = this.dom.operatorModePanel;
    const toggle = this.dom.operatorModeToggle;
    const description = this.dom.operatorModeDescription;
    const hasEvent = Boolean(this.selectedEventId);
    const hasSchedule = Boolean(this.selectedScheduleId);
    if (panel) {
      panel.hidden = !hasEvent;
    }
    if (this.dom.eventSummaryActions) {
      this.dom.eventSummaryActions.hidden = !hasEvent;
    }
    if (toggle) {
      toggle.checked = this.operatorMode === OPERATOR_MODE_SUPPORT;
      toggle.disabled = !hasSchedule;
      if (description) {
        if (!hasSchedule) {
          description.textContent = "日程を選択するとモードを切り替えられます。";
        } else if (this.operatorMode === OPERATOR_MODE_SUPPORT) {
          description.textContent = "参加者リストなどのツールのみ利用するモードです。テロップ操作は無効になります。";
        } else {
          description.textContent = "テロップ操作を含む全機能を利用できます。";
        }
      }
      if (description) {
        toggle.setAttribute("aria-describedby", description.id);
      }
    }
    const copyButton = this.dom.eventSummaryCopyButton;
    if (copyButton) {
      const hasEventSelection = Boolean(this.selectedEventId);
      copyButton.disabled = !hasEventSelection;
      if (!hasEventSelection) {
        copyButton.classList.remove("is-success", "is-error");
        const defaultLabel = copyButton.dataset.defaultLabel || "表示URLをコピー";
        copyButton.textContent = defaultLabel;
        if (this.displayUrlCopyTimer) {
          clearTimeout(this.displayUrlCopyTimer);
          this.displayUrlCopyTimer = 0;
        }
        if (this.dom.eventSummaryCopyStatus) {
          this.dom.eventSummaryCopyStatus.textContent = "";
        }
      }
    }
    const gotoScheduleButton = this.dom.eventSummaryGotoScheduleButton;
    if (gotoScheduleButton) {
      gotoScheduleButton.disabled = !this.selectedEventId;
    }
  }

  getParticipantEventsSnapshot() {
    return this.events.map((event) => ({
      ...event,
      schedules: Array.isArray(event.schedules)
        ? event.schedules.map((schedule) => ({ ...schedule }))
        : []
    }));
  }

  addSelectionListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.selectionListeners.add(listener);
    this.forceSelectionBroadcast = true;
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  addEventListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  notifySelectionListeners(source = "host") {
    if (this.suppressSelectionNotifications) {
      this.logParticipantAction("選択通知は抑制設定のため送信しません", { source });
      return;
    }
    const detail = { ...this.getCurrentSelectionContext(), source };
    const signature = [
      detail.eventId,
      detail.scheduleId,
      detail.eventName,
      detail.scheduleLabel,
      detail.startAt,
      detail.endAt
    ].join("::");
    if (
      !this.forceSelectionBroadcast &&
      signature === this.lastSelectionSignature &&
      source === this.lastSelectionSource
    ) {
      this.logParticipantAction("前回と同じ内容のため選択通知を省略しました", detail);
      return;
    }
    this.lastSelectionSignature = signature;
    this.lastSelectionSource = source;
    this.forceSelectionBroadcast = false;
    this.logParticipantAction("選択内容をリスナーに通知します", detail);
    this.selectionListeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        logError("Selection listener failed", error);
      }
    });
  }

  notifyEventListeners() {
    const snapshot = this.getParticipantEventsSnapshot();
    this.eventListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        logError("Event listener failed", error);
      }
    });
  }

  applySelectionFromParticipant(detail = {}) {
    const eventId = ensureString(detail?.eventId);
    const scheduleId = ensureString(detail?.scheduleId);
    const previousSuppression = this.suppressSelectionNotifications;
    this.suppressSelectionNotifications = true;
    this.logParticipantAction("参加者ツールからの選択反映リクエストを受け取りました", {
      eventId,
      scheduleId,
      source: detail?.source || "participants"
    });
    try {
      if (eventId || (!eventId && detail?.eventId === "")) {
        this.selectEvent(eventId);
      }
      if (scheduleId || (!scheduleId && detail?.scheduleId === "")) {
        this.selectSchedule(scheduleId);
      }
    } finally {
      this.suppressSelectionNotifications = previousSuppression;
    }
    this.notifySelectionListeners(detail?.source || "participants");
  }

  getParticipantHostInterface() {
    if (!this.participantHostInterface) {
      this.logParticipantAction("参加者ツール用ホストインターフェースを初期化します");
      this.participantHostInterface = {
        getSelection: () => this.getCurrentSelectionContext(),
        getEvents: () => this.getParticipantEventsSnapshot(),
        subscribeSelection: (listener) => this.addSelectionListener(listener),
        subscribeEvents: (listener) => this.addEventListener(listener),
        setSelection: (detail) => this.applySelectionFromParticipant(detail || {})
      };
    }
    return this.participantHostInterface;
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
    const changed = previous !== normalized;
    if (changed) {
      this.logFlowState("日程選択を更新しました", {
        scheduleId: normalized || "",
        previousScheduleId: previous || ""
      });
      this.tools.resetContext();
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
    if (changed) {
      this.syncOperatorPresenceSubscription();
      this.notifySelectionListeners("host");
    }
  }

  updateScheduleStateFromSelection(preferredScheduleId = "") {
    const event = this.getSelectedEvent();
    this.schedules = event ? [...event.schedules] : [];
    this.logFlowState("イベント選択に基づいて日程一覧を更新します", {
      selectedEventId: event?.id || "",
      scheduleCount: this.schedules.length,
      preferredScheduleId
    });
    this.ensureSelectedSchedule(preferredScheduleId);
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
    const list = this.dom.scheduleList;
    if (!list) return;

    const committedId = ensureString(this.hostCommittedScheduleId);
    const committedLabel = ensureString(this.hostCommittedScheduleLabel);
    const committedSchedule = committedId
      ? this.schedules.find((schedule) => schedule.id === committedId) || null
      : null;
    const resolvedCommittedLabel = committedLabel || committedSchedule?.label || committedId;
    if (this.dom.scheduleCommittedNote) {
      const labelEl = this.dom.scheduleCommittedLabel;
      const hasCommitted = Boolean(committedId);
      this.dom.scheduleCommittedNote.hidden = !hasCommitted;
      if (labelEl) {
        labelEl.textContent = hasCommitted ? resolvedCommittedLabel || "未設定" : "未設定";
      }
    }

    list.innerHTML = "";
    if (!this.schedules.length) {
      list.hidden = true;
      if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = false;
      list.removeAttribute("role");
      list.removeAttribute("aria-label");
      list.removeAttribute("aria-orientation");
      return;
    }

    list.hidden = false;
    if (this.dom.scheduleEmpty) this.dom.scheduleEmpty.hidden = true;

    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "日程一覧");
    list.setAttribute("aria-orientation", "vertical");
    const fragment = document.createDocumentFragment();
    this.schedules.forEach((schedule) => {
      const item = document.createElement("li");
      item.className = "entity-item";
      item.dataset.scheduleId = schedule.id;
      item.setAttribute("role", "option");

      const isSelected = schedule.id === this.selectedScheduleId && this.selectedScheduleId;
      if (isSelected) {
        item.classList.add("is-selected");
        item.setAttribute("aria-selected", "true");
      } else {
        item.setAttribute("aria-selected", "false");
      }
      item.tabIndex = 0;

      const indicator = document.createElement("span");
      indicator.className = "entity-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const indicatorDot = document.createElement("span");
      indicatorDot.className = "entity-indicator__dot";
      indicator.appendChild(indicatorDot);

      const label = document.createElement("div");
      label.className = "entity-label";

      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = schedule.label || schedule.id;
      if (committedId && schedule.id === committedId) {
        const badge = document.createElement("span");
        badge.className = "entity-badge entity-badge--active";
        badge.textContent = "テロップ操作中";
        nameEl.appendChild(badge);
      }

      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
      const metaParts = [];
      if (rangeText) metaParts.push(rangeText);
      metaParts.push(`参加者 ${formatParticipantCount(schedule.participantCount)}`);
      metaEl.textContent = metaParts.join(" / ");

      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "entity-action entity-action--edit";
      editBtn.setAttribute("aria-label", `${schedule.label || schedule.id} を編集`);
      editBtn.title = "日程を編集";
      editBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z" fill="currentColor"/></svg></span><span class="entity-action__label">編集</span>';
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openScheduleDialog({ mode: "edit", schedule });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "entity-action entity-action--delete";
      deleteBtn.setAttribute("aria-label", `${schedule.label || schedule.id} を削除`);
      deleteBtn.title = "日程を削除";
      deleteBtn.innerHTML =
        '<span class="entity-action__icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z"/></svg></span><span class="entity-action__label">削除</span>';
      deleteBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.deleteSchedule(schedule).catch((error) => {
          logError("Failed to delete schedule", error);
          this.showAlert(error.message || "日程の削除に失敗しました。");
        });
      });
      actions.appendChild(deleteBtn);

      item.append(indicator, label, actions);

      item.addEventListener("click", () => {
        this.selectSchedule(schedule.id);
      });
      item.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          this.selectSchedule(schedule.id);
        }
      });

      fragment.appendChild(item);
    });

    list.appendChild(fragment);
  }

  updateEventSummary() {
    const event = this.getSelectedEvent();
    if (this.dom.eventSummaryName) {
      this.dom.eventSummaryName.textContent = event ? event.name || event.id : "—";
    }
    if (this.dom.eventSummarySchedules) {
      if (event) {
        const count = typeof event.scheduleCount === "number" ? event.scheduleCount : (event.schedules?.length || 0);
        this.dom.eventSummarySchedules.textContent = `${count}件`;
      } else {
        this.dom.eventSummarySchedules.textContent = "—";
      }
    }
    if (this.dom.eventSummaryParticipants) {
      this.dom.eventSummaryParticipants.textContent = event
        ? formatParticipantCount(event.totalParticipants)
        : "—";
    }
    this.updateStageHeader();
    this.syncOperatorModeUi();
  }

  updateScheduleSummary() {
    if (!this.dom.scheduleSummary) return;

    const event = this.getSelectedEvent();
    const schedule = this.getSelectedSchedule();
    const hasSchedule = Boolean(event && schedule);
    const hasSelection = Boolean(this.selectedScheduleId);
    this.dom.scheduleSummary.hidden = !hasSchedule;
    if (this.dom.scheduleSummaryEmpty) {
      const shouldHidePlaceholder = hasSchedule || hasSelection;
      this.dom.scheduleSummaryEmpty.hidden = shouldHidePlaceholder;
      this.dom.scheduleSummaryEmpty.classList.toggle("is-hidden", shouldHidePlaceholder);
      if (!shouldHidePlaceholder) {
        this.dom.scheduleSummaryEmpty.textContent = event
          ? "日程を選択してください。"
          : "イベントを選択してください。";
      }
    }
    this.updateStageHeader();
    if (!hasSchedule) {
      return;
    }
    if (this.dom.scheduleSummaryEvent) {
      this.dom.scheduleSummaryEvent.textContent = event.name || event.id;
    }
    if (this.dom.scheduleSummaryLabel) {
      this.dom.scheduleSummaryLabel.textContent = schedule.label || schedule.id;
    }
    const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
    if (this.dom.scheduleSummaryRangeRow && this.dom.scheduleSummaryRange) {
      if (rangeText) {
        this.dom.scheduleSummaryRangeRow.hidden = false;
        this.dom.scheduleSummaryRange.textContent = rangeText;
      } else {
        this.dom.scheduleSummaryRangeRow.hidden = true;
        this.dom.scheduleSummaryRange.textContent = "";
      }
    }
    this.syncOperatorModeUi();
  }

  clearLoadingIndicators() {
    this.eventsLoadingTracker.reset();
    this.scheduleLoadingTracker.reset();
  }

  updateStageUi() {
    if (this.dom.main) {
      this.dom.main.dataset.stage = this.stage;
    }
    this.updateStageHeader();
    this.updateStageIndicator();
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    this.updateChatLayoutMetrics();
  }

  updateStageIndicator() {
    if (!Array.isArray(this.dom.stageIndicators)) return;
    const currentIndex = STAGE_SEQUENCE.indexOf(this.stage);
    this.dom.stageIndicators.forEach((indicator) => {
      const stageId = indicator?.dataset?.stageIndicator || "";
      const stageIndex = STAGE_SEQUENCE.indexOf(stageId);
      if (stageIndex === -1) return;
      indicator.classList.toggle("is-active", stageIndex === currentIndex);
      indicator.classList.toggle("is-complete", stageIndex < currentIndex);
      if (stageIndex === currentIndex) {
        indicator.setAttribute("aria-current", "step");
      } else {
        indicator.removeAttribute("aria-current");
      }
    });
  }

  updateStageHeader() {
    const activePanel = PANEL_CONFIG[this.activePanel] ? this.activePanel : "events";
    const panelConfig = PANEL_CONFIG[activePanel] || PANEL_CONFIG.events;
    const stageInfo = PANEL_STAGE_INFO[activePanel] || STAGE_INFO[panelConfig.stage] || null;

    const title = stageInfo?.title ? String(stageInfo.title).trim() : "";
    const description = stageInfo?.description ? String(stageInfo.description).trim() : "";
    let baseText = "";
    if (title && description) {
      baseText = `${title} — ${description}`;
    } else if (description) {
      baseText = description;
    } else if (title) {
      baseText = title;
    }

    const needsEvent = Boolean(panelConfig.requireEvent || panelConfig.requireSchedule);
    const needsSchedule = Boolean(panelConfig.requireSchedule);
    const event = needsEvent ? this.getSelectedEvent() : null;
    const schedule = needsSchedule ? this.getSelectedSchedule() : null;

    if (needsEvent || needsSchedule) {
      const prefix = baseText || title || "選択対象";
      baseText = buildContextDescription(prefix, event, needsSchedule ? schedule : null);
    }

    this.stageNote = (baseText || "").trim();
    this.applyMetaNote();
  }

  setModuleAccessibility(module, isActive) {
    if (!module) return;
    if (typeof module.inert !== "undefined") {
      module.inert = !isActive;
    } else if (!isActive) {
      module.setAttribute("inert", "");
    } else {
      module.removeAttribute("inert");
    }

    if (isActive) {
      module.removeAttribute("aria-hidden");
      module.classList.remove("is-inert");
    } else {
      module.setAttribute("aria-hidden", "true");
      module.classList.add("is-inert");
    }

    const focusable = module.querySelectorAll(FOCUSABLE_SELECTOR);
    focusable.forEach((element) => {
      if (isActive) {
        if (Object.prototype.hasOwnProperty.call(element.dataset, "flowSavedTabindex")) {
          const previous = element.dataset.flowSavedTabindex;
          if (previous === "") {
            element.removeAttribute("tabindex");
          } else {
            element.setAttribute("tabindex", previous);
          }
          delete element.dataset.flowSavedTabindex;
        }
      } else if (!Object.prototype.hasOwnProperty.call(element.dataset, "flowSavedTabindex")) {
        const current = element.getAttribute("tabindex");
        element.dataset.flowSavedTabindex = current ?? "";
        element.setAttribute("tabindex", "-1");
      } else {
        element.setAttribute("tabindex", "-1");
      }
    });
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
      button.textContent = isActive ? "フルスクリーン解除" : "フルスクリーン";
      button.dataset.state = isActive ? "active" : "inactive";
      button.title = isActive ? "フルスクリーンを終了します" : "画面をフルスクリーン表示します";
    } else {
      button.textContent = "フルスクリーン";
      button.dataset.state = "unsupported";
      button.title = "このブラウザではフルスクリーン表示に対応していません";
    }
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
    const signedIn = Boolean(this.currentUser);
    const hasEvent = Boolean(this.selectedEventId);
    const hasSchedule = Boolean(this.selectedScheduleId);

    if (this.dom.addEventButton) {
      this.dom.addEventButton.disabled = !signedIn;
    }
    if (this.dom.refreshButton) {
      this.dom.refreshButton.disabled = !signedIn;
    }
    if (this.dom.nextButton) {
      this.dom.nextButton.disabled = !signedIn || !hasEvent;
    }
    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.disabled = !signedIn || !hasEvent;
    }
    if (this.dom.scheduleRefreshButton) {
      this.dom.scheduleRefreshButton.disabled = !signedIn || !hasEvent;
    }
    if (this.dom.scheduleNextButton) {
      this.dom.scheduleNextButton.disabled = !signedIn || !hasSchedule;
    }
    this.updateNavigationButtons();
  }

  updateSelectionNotes() {
    if (this.dom.eventSelectionNote) {
      const shouldShow = !this.selectedEventId && this.events.length > 0;
      this.dom.eventSelectionNote.hidden = !shouldShow;
    }
    if (this.dom.scheduleSelectionNote) {
      const shouldShow = Boolean(this.selectedEventId) && !this.selectedScheduleId && this.schedules.length > 0;
      this.dom.scheduleSelectionNote.hidden = !shouldShow;
    }
  }

  setStage(stage) {
    if (!STAGE_SEQUENCE.includes(stage)) {
      return;
    }
    this.stage = stage;
    this.stageHistory.add(stage);
    this.updateStageUi();
    this.updateFlowButtons();
    this.updateSelectionNotes();
  }

  canActivatePanel(panel, config = PANEL_CONFIG[panel]) {
    const rules = config || PANEL_CONFIG.events;
    if ((panel || "") === "operator" && this.operatorMode !== OPERATOR_MODE_TELOP) {
      return false;
    }
    if (rules.requireEvent && !this.selectedEventId) {
      return false;
    }
    if (rules.requireSchedule && (!this.selectedScheduleId || !this.currentUser)) {
      return false;
    }
    return true;
  }

  showPanel(panel) {
    let normalized = PANEL_CONFIG[panel] ? panel : "events";
    if (normalized === "operator" && this.operatorMode !== OPERATOR_MODE_TELOP) {
      const fallback = this.getOperatorPanelFallbackTarget();
      if (fallback && fallback !== "operator") {
        this.logFlowState("テロップ操作なしモードのためテロップ操作パネルを開けません", {
          requestedPanel: panel || "",
          fallbackPanel: fallback
        });
        normalized = fallback;
      } else {
        normalized = "events";
      }
    }
    const config = PANEL_CONFIG[normalized] || PANEL_CONFIG.events;
    if (config.requireEvent && !this.selectedEventId) {
      this.revealEventSelectionCue();
      this.activePanel = "events";
      this.setStage("events");
      this.updatePanelVisibility();
      this.updatePanelNavigation();
      return;
    }
    if (config.requireSchedule && !this.selectedScheduleId) {
      this.revealScheduleSelectionCue();
      this.activePanel = this.selectedEventId ? "schedules" : "events";
      this.setStage(this.activePanel);
      this.updatePanelVisibility();
      this.updatePanelNavigation();
      return;
    }
    this.activePanel = normalized;
    this.setStage(config.stage);
    this.updatePanelVisibility();
    this.updatePanelNavigation();
    if (config.stage === "tabs") {
      this.tools.prepareFrames();
      const hasSelection = this.selectedEventId && this.selectedScheduleId;
      if (config.requireSchedule && hasSelection) {
        this.tools.setPendingSync(false);
        this.tools
          .syncEmbeddedTools({ reason: "panel-activation" })
          .catch((error) => logError("Failed to sync tools", error));
      } else if (this.tools.isPendingSync() && hasSelection) {
        this.tools.setPendingSync(false);
        this.tools
          .syncEmbeddedTools({ reason: "pending-sync-flush" })
          .catch((error) => logError("Failed to sync tools", error));
      }
    }
    this.handlePanelSetup(normalized, config).catch((error) => logError("Failed to prepare panel", error));
  }

  async handlePanelSetup(panel, config) {
    if (config.stage !== "tabs") {
      await this.tools.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (config.requireSchedule) {
      await this.tools.setDrawerState({ dictionary: false, logs: false });
      return;
    }
    if (panel === "dictionary") {
      await this.tools.setDrawerState({ dictionary: true, logs: false });
    } else if (panel === "logs") {
      await this.tools.setDrawerState({ dictionary: false, logs: true });
    } else {
      await this.tools.setDrawerState({ dictionary: false, logs: false });
    }
  }

  getOperatorPanelFallbackTarget({ preferSchedules = false } = {}) {
    if (!preferSchedules && this.canActivatePanel("participants", PANEL_CONFIG.participants)) {
      return "participants";
    }
    if (this.canActivatePanel("schedules", PANEL_CONFIG.schedules)) {
      return "schedules";
    }
    return "events";
  }

  getPanelModules() {
    return {
      events: this.dom.eventsModule,
      schedules: this.dom.schedulesModule,
      participants: this.dom.participantsPanel,
      operator: this.dom.operatorPanel,
      dictionary: this.dom.dictionaryPanel,
      pickup: this.dom.pickupPanel,
      logs: this.dom.logsPanel
    };
  }

  setModuleVisibility(module, isVisible) {
    if (!module) return;
    module.hidden = !isVisible;
    module.classList.toggle("is-active", isVisible);
    this.setModuleAccessibility(module, isVisible);
  }

  updatePanelVisibility() {
    const activePanel = PANEL_CONFIG[this.activePanel] ? this.activePanel : "events";
    const modules = this.getPanelModules();
    Object.entries(modules).forEach(([name, element]) => {
      this.setModuleVisibility(element, name === activePanel);
    });
  }

  updatePanelNavigation() {
    const buttons = this.dom.panelButtons || [];
    buttons.forEach((button) => {
      const target = button.dataset.panelTarget || "";
      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const disabled = !this.canActivatePanel(target, config);
      button.disabled = disabled;
      const isActive = target === this.activePanel;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    const activeConfig = PANEL_CONFIG[this.activePanel] || PANEL_CONFIG.events;
    const shouldHidePanelNavigation = activeConfig.stage === "tabs";
    const navigations = this.dom.flowNavigations || [];
    navigations.forEach((nav) => {
      if (!nav) return;
      const isPanelNavigation = nav.classList.contains("flow-navigation--panel");
      if (isPanelNavigation) {
        nav.hidden = shouldHidePanelNavigation;
      } else {
        nav.hidden = false;
      }
    });
    this.updateNavigationButtons();
  }

  updateNavigationButtons() {
    const buttons = this.dom.navigationButtons || [];
    buttons.forEach((button) => {
      if (!button) return;
      const target = button.dataset.flowNavTarget || "";
      const config = PANEL_CONFIG[target] || PANEL_CONFIG.events;
      const disabled = !target || target === this.activePanel || !this.canActivatePanel(target, config);
      button.disabled = disabled;
    });
  }

  clearPendingNavigationTimer() {
    if (!this.pendingNavigationClearTimer) {
      return;
    }
    const timerHost = getTimerHost();
    timerHost.clearTimeout(this.pendingNavigationClearTimer);
    this.pendingNavigationClearTimer = 0;
  }

  schedulePendingNavigationClear() {
    const timerHost = getTimerHost();
    this.clearPendingNavigationTimer();
    this.pendingNavigationClearTimer = timerHost.setTimeout(() => {
      this.pendingNavigationClearTimer = 0;
      this.pendingNavigationTarget = "";
      this.pendingNavigationMeta = null;
      this.awaitingScheduleConflictPrompt = false;
      this.syncScheduleConflictPromptState();
    }, PENDING_NAVIGATION_CLEAR_DELAY_MS);
  }

  async handleFlowNavigation(target, { sourceButton = null } = {}) {
    let normalized = PANEL_CONFIG[target] ? target : "events";
    const originPanel = sourceButton?.closest("[data-panel]")?.dataset?.panel || "";
    let config = PANEL_CONFIG[normalized] || PANEL_CONFIG.events;
    this.clearPendingNavigationTimer();
    this.pendingNavigationTarget = "";
    this.awaitingScheduleConflictPrompt = false;
    this.pendingNavigationMeta = null;
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
      this.pendingNavigationTarget = normalized;
      this.pendingNavigationMeta = {
        target: normalized,
        originPanel,
        reason: "flow-navigation"
      };
      this.awaitingScheduleConflictPrompt = true;
      const committed = this.commitSelectedScheduleForTelop({ reason: "navigation" });
      if (!committed) {
        this.pendingNavigationTarget = "";
        this.pendingNavigationMeta = null;
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
    if (!this.dom.scheduleConflictDialog) {
      return;
    }
    if (!context) {
      context = this.buildScheduleConflictContext();
      this.scheduleConflictContext = context;
    }
    const { reason = "unspecified", originPanel = "", target = "" } = meta || {};
    this.renderScheduleConflictDialog(context);
    this.clearScheduleConflictError();
    const signature = ensureString(context?.signature);
    if (signature) {
      this.scheduleConflictLastPromptSignature = signature;
    }
    const wasOpen = this.isScheduleConflictDialogOpen();
    if (!wasOpen) {
      this.openDialog(this.dom.scheduleConflictDialog);
      this.logFlowState("スケジュール確認モーダルを表示します", {
        reason,
        target,
        originPanel,
        conflict: {
          eventId: context?.eventId || "",
          hasConflict: Boolean(context?.hasConflict),
          optionCount: Array.isArray(context?.options) ? context.options.length : 0,
          entryCount: Array.isArray(context?.entries) ? context.entries.length : 0
        }
      });
    }
    this.scheduleConflictLastSignature = context?.signature || this.scheduleConflictLastSignature;
    this.syncScheduleConflictPromptState(context);
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
    const ensure = (value) => String(value ?? "").trim();
    const normalizedEvent = ensure(eventId);
    const normalizedEntry = ensure(entryId);
    const source = payload && typeof payload === "object" ? payload : {};
    const rawKey = ensure(source.scheduleKey);
    if (rawKey) {
      return rawKey;
    }
    const scheduleId = ensure(source.scheduleId);
    if (normalizedEvent && scheduleId) {
      return `${normalizedEvent}::${normalizeScheduleId(scheduleId)}`;
    }
    if (scheduleId) {
      return normalizeScheduleId(scheduleId);
    }
    const scheduleLabel = ensure(source.scheduleLabel);
    if (scheduleLabel) {
      const sanitized = scheduleLabel.replace(/\s+/g, " ").trim().replace(/::/g, "／");
      if (normalizedEvent) {
        return `${normalizedEvent}::label::${sanitized}`;
      }
      return `label::${sanitized}`;
    }
    if (normalizedEvent && normalizedEntry) {
      return `${normalizedEvent}::session::${normalizedEntry}`;
    }
    return normalizedEntry || normalizedEvent || "";
  }

  extractScheduleIdFromKey(scheduleKey, eventId = "") {
    const key = ensureString(scheduleKey);
    if (!key) {
      return "";
    }
    const normalizedEvent = ensureString(eventId) || ensureString(this.selectedEventId);
    let working = key;
    if (normalizedEvent && working.startsWith(`${normalizedEvent}::`)) {
      working = working.slice(normalizedEvent.length + 2);
    }
    if (!working) {
      return "";
    }
    const [firstPart] = working.split("::");
    if (!firstPart || firstPart === "label" || firstPart === "session") {
      return "";
    }
    const normalizedCandidate = normalizeScheduleId(firstPart);
    const candidates = [firstPart];
    if (normalizedCandidate && normalizedCandidate !== firstPart) {
      candidates.push(normalizedCandidate);
    }
    const match = this.schedules.find((schedule) => {
      if (!schedule || !schedule.id) {
        return false;
      }
      if (candidates.includes(schedule.id)) {
        return true;
      }
      const normalizedId = normalizeScheduleId(schedule.id);
      return Boolean(normalizedId) && candidates.includes(normalizedId);
    });
    return match ? match.id : "";
  }

  normalizeOperatorPresenceEntries(raw = {}, eventId = "") {
    const entries = [];
    if (!raw || typeof raw !== "object") {
      this.logOperatorPresenceDebug("Read operator presence snapshot", {
        eventId: ensureString(eventId),
        entryCount: 0,
        entries: []
      });
      return entries;
    }
    const selfUid = ensureString(this.currentUser?.uid);
    Object.entries(raw).forEach(([entryId, payload]) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const normalizedId = ensureString(entryId) || generateShortId("presence-");
      const scheduleKey = this.buildPresenceScheduleKey(eventId, payload, normalizedId);
      const scheduleId = ensureString(payload.scheduleId) || ensureString(payload.selectedScheduleId);
      const scheduleLabel = ensureString(payload.scheduleLabel) || ensureString(payload.selectedScheduleLabel);
      const displayName = ensureString(payload.displayName) || ensureString(payload.email) || ensureString(payload.uid) || normalizedId;
      const uid = ensureString(payload.uid);
      const mode = normalizeOperatorMode(payload.mode);
      const skipTelop = payload.skipTelop === true || mode === OPERATOR_MODE_SUPPORT;
      const updatedAt = Number(payload.clientTimestamp || payload.updatedAt || 0) || 0;
      const sessionId = ensureString(payload.sessionId) || normalizedId;
      const source = ensureString(payload.source);
      entries.push({
        entryId: normalizedId,
        sessionId,
        source,
        uid,
        displayName,
        scheduleId,
        scheduleLabel,
        scheduleKey,
        selectedScheduleId: ensureString(payload.selectedScheduleId),
        selectedScheduleLabel: ensureString(payload.selectedScheduleLabel),
        mode,
        skipTelop,
        updatedAt,
        isSelf: Boolean(selfUid && uid && uid === selfUid)
      });
    });
    entries.sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
    const summary = this.describeOperatorPresenceEntries(entries);
    this.logOperatorPresenceDebug("Read operator presence snapshot", {
      eventId: ensureString(eventId),
      entryCount: summary.length,
      entries: summary
    });
    return entries;
  }

  buildScheduleConflictContext() {
    const event = this.getSelectedEvent();
    const eventId = event?.id || "";
    const context = {
      eventId,
      entries: [],
      options: [],
      selectableOptions: [],
      hasConflict: false,
      hasOtherOperators: false,
      hostScheduleId: "",
      hostScheduleKey: "",
      hostScheduleLabel: "",
      defaultKey: "",
      signature: ""
    };
    if (!eventId) {
      return context;
    }
    const scheduleMap = new Map(this.schedules.map((schedule) => [schedule.id, schedule]));
    const entries = [];
    const selfUid = ensureString(this.currentUser?.uid);
    const selfLabel = ensureString(this.currentUser?.displayName) || ensureString(this.currentUser?.email) || "あなた";
    let hasSelfPresence = false;
    this.operatorPresenceEntries.forEach((entry) => {
      const baseScheduleId = ensureString(entry.scheduleId);
      const scheduleFromMap = baseScheduleId ? scheduleMap.get(baseScheduleId) : null;
      const derivedFromKey = this.extractScheduleIdFromKey(entry.scheduleKey, eventId);
      const resolvedScheduleId = ensureString(scheduleFromMap?.id || baseScheduleId || derivedFromKey);
      const schedule = resolvedScheduleId ? scheduleMap.get(resolvedScheduleId) || scheduleFromMap : scheduleFromMap;
      const normalizedMode = normalizeOperatorMode(entry.mode);
      const skipTelop = entry.skipTelop === true || normalizedMode === OPERATOR_MODE_SUPPORT;
      const isSelf = Boolean(entry.isSelf || (selfUid && entry.uid && entry.uid === selfUid));
      if (isSelf) {
        hasSelfPresence = true;
      }
      const scheduleLabel = schedule?.label || entry.scheduleLabel || resolvedScheduleId || "未選択";
      const scheduleRange = schedule ? formatScheduleRange(schedule.startAt, schedule.endAt) : "";
      const scheduleKey = ensureString(
        entry.scheduleKey ||
          (resolvedScheduleId
            ? this.derivePresenceScheduleKey(
                eventId,
                { scheduleId: resolvedScheduleId, scheduleLabel },
                ensureString(entry.entryId)
              )
            : "")
      );
      entries.push({
        entryId: entry.entryId,
        uid: entry.uid,
        displayName: entry.displayName || entry.uid || entry.entryId,
        scheduleId: resolvedScheduleId,
        scheduleKey,
        scheduleLabel,
        scheduleRange,
        isSelf,
        mode: normalizedMode,
        skipTelop,
        updatedAt: entry.updatedAt || 0
      });
    });
    const hostContext = this.resolveHostScheduleContext(eventId, { scheduleMap });
    const hostScheduleId = ensureString(hostContext.scheduleId);
    const hostScheduleKey = ensureString(hostContext.scheduleKey);
    const hostScheduleLabel = ensureString(hostContext.scheduleLabel);
    const hostScheduleRange = ensureString(hostContext.scheduleRange);
    const hostSchedule = hostContext.schedule || (hostScheduleId ? scheduleMap.get(hostScheduleId) || null : null);
    const committedScheduleId = ensureString(this.hostCommittedScheduleId);
    const committedSchedule = committedScheduleId ? scheduleMap.get(committedScheduleId) || null : null;
    const committedScheduleLabel = ensureString(this.hostCommittedScheduleLabel) || committedSchedule?.label || committedScheduleId;
    const committedScheduleRange = committedSchedule
      ? formatScheduleRange(committedSchedule.startAt, committedSchedule.endAt)
      : "";

    const selfEntry = entries.find((entry) => entry.isSelf);
    if (selfEntry) {
      selfEntry.scheduleId = hostScheduleId;
      if (hostScheduleKey) {
        selfEntry.scheduleKey = hostScheduleKey;
      }
      selfEntry.scheduleLabel = hostScheduleLabel || hostScheduleId || "未選択";
      selfEntry.scheduleRange = hostScheduleRange || selfEntry.scheduleRange || "";
      selfEntry.selectedScheduleId = ensureString(hostContext.selectedScheduleId);
      selfEntry.selectedScheduleLabel = ensureString(hostContext.selectedScheduleLabel);
    }

    context.hostScheduleId = hostScheduleId;
    context.hostScheduleKey = hostScheduleKey;
    context.hostScheduleLabel = hostScheduleLabel;
    context.hostScheduleRange = hostScheduleRange;
    context.hostSelectedScheduleId = ensureString(hostContext.selectedScheduleId);
    context.hostCommittedScheduleId = ensureString(hostContext.committedScheduleId);
    context.telopScheduleId = committedScheduleId;
    context.telopScheduleLabel = committedScheduleLabel;
    context.telopScheduleRange = committedScheduleRange;

    if (!hasSelfPresence && hostScheduleId) {
      entries.push({
        entryId: selfUid ? `self::${selfUid}` : "self",
        uid: selfUid,
        displayName: selfLabel,
        scheduleId: hostScheduleId,
        scheduleKey: hostScheduleKey || hostScheduleId,
        scheduleLabel: hostScheduleLabel || hostScheduleId || "未選択",
        scheduleRange: hostScheduleRange || formatScheduleRange(hostSchedule?.startAt, hostSchedule?.endAt),
        isSelf: true,
        mode: this.operatorMode,
        skipTelop: this.operatorMode === OPERATOR_MODE_SUPPORT,
        selectedScheduleId: ensureString(hostContext.selectedScheduleId),
        selectedScheduleLabel: ensureString(hostContext.selectedScheduleLabel),
        updatedAt: Date.now()
      });
      hasSelfPresence = true;
    }
    entries.sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (!a.isSelf && b.isSelf) return 1;
      return (a.displayName || "").localeCompare(b.displayName || "", "ja");
    });
    const telopEntries = entries.filter((entry) => ensureString(entry.scheduleId) && !entry.skipTelop);
    context.entries = telopEntries;
    context.allEntries = entries;
    const groups = new Map();
    entries.forEach((entry) => {
      const key = entry.scheduleKey || "";
      const existing = groups.get(key) || {
        key,
        scheduleId: entry.scheduleId || "",
        scheduleLabel: entry.scheduleLabel || "未選択",
        scheduleRange: entry.scheduleRange || "",
        members: [],
        telopMembers: []
      };
      if (!groups.has(key)) {
        groups.set(key, existing);
      }
      if (!existing.scheduleId && entry.scheduleId) {
        existing.scheduleId = entry.scheduleId;
      }
      if (!existing.scheduleLabel && entry.scheduleLabel) {
        existing.scheduleLabel = entry.scheduleLabel;
      }
      if (!existing.scheduleRange && entry.scheduleRange) {
        existing.scheduleRange = entry.scheduleRange;
      }
      existing.members.push(entry);
      if (!entry.skipTelop && ensureString(entry.scheduleId)) {
        existing.telopMembers.push(entry);
      }
    });
    const options = Array.from(groups.values())
      .filter((group) => group.telopMembers && group.telopMembers.length > 0)
      .map((group) => {
        const derivedScheduleId = group.scheduleId || this.extractScheduleIdFromKey(group.key, eventId) || "";
        const schedule = derivedScheduleId ? scheduleMap.get(derivedScheduleId) : null;
        const scheduleId = schedule?.id || derivedScheduleId || "";
        const scheduleLabel = group.scheduleLabel || schedule?.label || scheduleId || "未選択";
        const scheduleRange = group.scheduleRange || formatScheduleRange(schedule?.startAt, schedule?.endAt);
        const containsSelf = group.telopMembers.some((member) => member.isSelf);
        return {
          key: group.key,
          scheduleId,
          scheduleLabel,
          scheduleRange,
          members: group.members,
          containsSelf,
          isSelectable: Boolean(scheduleId)
        };
      });
    options.sort((a, b) => {
      if (a.containsSelf && !b.containsSelf) return -1;
      if (!a.containsSelf && b.containsSelf) return 1;
      return (a.scheduleLabel || "").localeCompare(b.scheduleLabel || "", "ja");
    });
    const selectableOptions = options.filter((option) => option.scheduleId);
    context.options = selectableOptions;
    context.hasOtherOperators = telopEntries.some((entry) => !entry.isSelf);
    context.selectableOptions = selectableOptions;
    const uniqueSelectableKeys = new Set(
      selectableOptions.map((option) => option.key || option.scheduleId || "")
    );
    const telopScheduleId = committedScheduleId;
    const conflictingTelopEntries = telopEntries.filter((entry) => {
      const entryScheduleId = ensureString(entry.scheduleId);
      return Boolean(telopScheduleId && entryScheduleId && entryScheduleId !== telopScheduleId);
    });
    context.hasConflict = Boolean(telopScheduleId) && conflictingTelopEntries.length > 0;
    const preferredOption =
      selectableOptions.find((option) => option.containsSelf) || selectableOptions[0] || null;
    context.defaultKey = preferredOption?.key || "";
    const signatureSource = telopEntries.length ? telopEntries : entries;
    const signatureParts = signatureSource.map((entry) => {
      const entryId = entry.uid || entry.entryId || "anon";
      const scheduleKey = entry.scheduleKey || "none";
      return `${entryId}::${scheduleKey}`;
    });
    signatureParts.sort();
    const baseSignature = signatureParts.join("|") || "none";
    context.signature = `${eventId || "event"}::${baseSignature}`;
    return context;
  }

  syncScheduleConflictPromptState(context = null) {
    const button = this.dom.scheduleNextButton;
    if (!button) {
      return;
    }
    const resolvedContext = context || this.scheduleConflictContext || this.buildScheduleConflictContext();
    const contextSignature = ensureString(resolvedContext?.signature);
    const pendingSignature = ensureString(this.scheduleConflictPromptSignature);
    const hasConflict = Boolean(resolvedContext?.hasConflict);
    const hasResolvedKey = Boolean(this.scheduleConsensusLastKey);
    const shouldIndicate =
      hasConflict &&
      pendingSignature &&
      contextSignature &&
      contextSignature === pendingSignature &&
      !hasResolvedKey;
    if (shouldIndicate) {
      if (!Object.prototype.hasOwnProperty.call(button.dataset, "conflictOriginalTitle")) {
        button.dataset.conflictOriginalTitle = button.getAttribute("title") || "";
      }
      button.setAttribute("data-conflict-pending", "true");
      button.setAttribute(
        "title",
        "他のオペレーターと日程の調整が必要です。「確定」で日程を確定してください。"
      );
    } else {
      button.removeAttribute("data-conflict-pending");
      if (Object.prototype.hasOwnProperty.call(button.dataset, "conflictOriginalTitle")) {
        const original = button.dataset.conflictOriginalTitle || "";
        if (original) {
          button.setAttribute("title", original);
        } else {
          button.removeAttribute("title");
        }
        delete button.dataset.conflictOriginalTitle;
      }
    }
  }

  updateScheduleConflictState() {
    const context = this.buildScheduleConflictContext();
    this.scheduleConflictContext = context;
    if (this.isScheduleConflictDialogOpen()) {
      this.renderScheduleConflictDialog(context);
    }
    this.enforceScheduleConflictState(context);
    this.syncScheduleConflictPromptState(context);
  }

  enforceScheduleConflictState(context = null) {
    const hasConflict = Boolean(context?.hasConflict);
    if (!hasConflict) {
      if (this.isScheduleConflictDialogOpen()) {
        if (this.dom.scheduleConflictForm) {
          this.dom.scheduleConflictForm.reset();
        }
        this.closeDialog(this.dom.scheduleConflictDialog);
      }
      this.scheduleConflictLastSignature = "";
      this.scheduleConflictPromptSignature = "";
      this.scheduleConflictLastPromptSignature = "";
      this.maybeClearScheduleConsensus(context);
      return;
    }
    const signature = ensureString(context?.signature);
    this.scheduleConflictLastSignature = signature;
    const hasSelection = Boolean(this.selectedScheduleId);
    const shouldPromptDueToNavigation = Boolean(this.pendingNavigationTarget);
    const shouldPromptDueToConflict =
      !shouldPromptDueToNavigation &&
      hasSelection &&
      signature &&
      signature !== this.scheduleConflictLastPromptSignature;
    if (!this.isScheduleConflictDialogOpen()) {
      if (shouldPromptDueToNavigation && hasSelection) {
        this.openScheduleConflictDialog(context, {
          reason: "presence",
          originPanel: this.activePanel,
          target: this.pendingNavigationTarget || this.activePanel
        });
      } else if (shouldPromptDueToConflict) {
        this.openScheduleConflictDialog(context, {
          reason: "presence-auto",
          originPanel: this.activePanel,
          target: this.activePanel
        });
      }
    } else if (shouldPromptDueToConflict && signature) {
      this.scheduleConflictLastPromptSignature = signature;
    }
  }

  syncOperatorPresenceSubscription() {
    const eventId = ensureString(this.selectedEventId);
    if (this.operatorPresenceEventId === eventId) {
      this.logFlowState("オペレーター選択状況の購読は既に最新です", {
        eventId
      });
      this.updateScheduleConflictState();
      return;
    }
    if (this.operatorPresenceUnsubscribe) {
      this.logFlowEvent("オペレーター選択状況の購読を解除します", {
        previousEventId: this.operatorPresenceEventId
      });
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    this.operatorPresenceEventId = eventId;
    this.operatorPresenceEntries = [];
    if (!eventId) {
      this.logFlowState("イベント未選択のためオペレーター選択状況をクリアしました");
      this.updateScheduleConflictState();
      return;
    }
    this.logFlowEvent("オペレーター選択状況の購読を開始します", {
      eventId
    });
    try {
      const ref = getOperatorPresenceEventRef(eventId);
      this.operatorPresenceUnsubscribe = onValue(
        ref,
        (snapshot) => {
          const raw = snapshot.exists() ? snapshot.val() : {};
          this.operatorPresenceEntries = this.normalizeOperatorPresenceEntries(raw, eventId);
          this.updateScheduleConflictState();
          this.logFlowState("オペレーター選択状況を受信しました", {
            eventId,
            entryCount: this.operatorPresenceEntries.length
          });
        },
        (error) => {
          console.error("Failed to monitor operator presence:", error);
        }
      );
    } catch (error) {
      console.error("Failed to subscribe operator presence:", error);
      this.operatorPresenceUnsubscribe = null;
    }
    this.updateScheduleConflictState();
  }

  syncScheduleConsensusSubscription() {
    const eventId = ensureString(this.selectedEventId);
    if (this.scheduleConsensusEventId === eventId) {
      return;
    }
    if (this.scheduleConsensusUnsubscribe) {
      this.scheduleConsensusUnsubscribe();
      this.scheduleConsensusUnsubscribe = null;
    }
    this.scheduleConsensusEventId = eventId;
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    this.hideScheduleConsensusToast();
    if (!eventId) {
      return;
    }
    try {
      const ref = getOperatorScheduleConsensusRef(eventId);
      this.scheduleConsensusUnsubscribe = onValue(
        ref,
        (snapshot) => {
          const raw = snapshot.exists() ? snapshot.val() : null;
          const consensus = this.normalizeScheduleConsensus(raw);
          this.scheduleConsensusState = consensus;
          this.handleScheduleConsensusUpdate(eventId, consensus);
        },
        (error) => {
          console.error("Failed to monitor schedule consensus:", error);
        }
      );
    } catch (error) {
      console.error("Failed to subscribe schedule consensus:", error);
      this.scheduleConsensusUnsubscribe = null;
    }
  }

  clearScheduleConsensusState({ reason = "" } = {}) {
    if (this.scheduleConsensusUnsubscribe) {
      this.scheduleConsensusUnsubscribe();
      this.scheduleConsensusUnsubscribe = null;
    }
    this.scheduleConsensusEventId = "";
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.hideScheduleConsensusToast();
    if (reason) {
      this.logFlowState("スケジュール合意情報をリセットしました", { reason });
    }
  }

  normalizeScheduleConsensus(raw = null) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return {
      conflictSignature: ensureString(raw.conflictSignature),
      scheduleKey: ensureString(raw.scheduleKey),
      scheduleId: ensureString(raw.scheduleId),
      scheduleLabel: ensureString(raw.scheduleLabel),
      scheduleRange: ensureString(raw.scheduleRange),
      status: ensureString(raw.status),
      requestedByUid: ensureString(raw.requestedByUid),
      requestedByDisplayName: ensureString(raw.requestedByDisplayName),
      requestedBySessionId: ensureString(raw.requestedBySessionId),
      requestedAt: Number(raw.requestedAt || raw.updatedAt || 0) || 0,
      resolvedByUid: ensureString(raw.resolvedByUid),
      resolvedByDisplayName: ensureString(raw.resolvedByDisplayName),
      resolvedBySessionId: ensureString(raw.resolvedBySessionId),
      resolvedAt: Number(raw.resolvedAt || 0) || 0,
      updatedAt: Number(raw.updatedAt || 0) || 0
    };
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
    this.pendingNavigationMeta = null;
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
        force: true
      });
    } else if (scheduleId && selectedScheduleId && scheduleId !== selectedScheduleId) {
      const currentSchedule = this.schedules.find((schedule) => schedule.id === selectedScheduleId) || null;
      const currentLabel = currentSchedule?.label || selectedScheduleId;
      this.setHostCommittedSchedule("", {
        reason: "consensus-pending",
        sync: true,
        updateContext: true,
        force: true
      });
      if (this.operatorMode === OPERATOR_MODE_SUPPORT) {
        this.logFlowState("テロップ操作なしモードのためスケジュール合意モーダルを表示しません", {
          consensusScheduleId: scheduleId,
          currentScheduleId: selectedScheduleId,
          consensusLabel: label || "",
          consensusRange: range || ""
        });
      } else {
        this.openScheduleFallbackDialog({
          consensusScheduleId: scheduleId,
          consensusLabel: label,
          consensusRange: range,
          consensusByline: byline,
          currentScheduleId: selectedScheduleId,
          currentScheduleLabel: currentLabel
        });
      }
    } else if (scheduleId) {
      this.setHostCommittedSchedule(scheduleId, {
        schedule: fallbackSchedule,
        reason: "consensus-align",
        sync: true,
        updateContext: true,
        force: true
      });
    } else {
      this.setHostCommittedSchedule("", {
        reason: "consensus-clear",
        sync: true,
        updateContext: true,
        force: true
      });
    }
    this.syncScheduleConflictPromptState();
  }

  showScheduleConsensusToast({ label = "", range = "", byline = "" } = {}) {
    const toast = this.dom.scheduleConsensusToast;
    if (!toast) {
      return;
    }
    const timerHost = getTimerHost();
    this.hideScheduleConsensusToast();
    if (this.scheduleConsensusHideTimer) {
      timerHost.clearTimeout(this.scheduleConsensusHideTimer);
      this.scheduleConsensusHideTimer = 0;
    }
    toast.innerHTML = "";
    const title = document.createElement("div");
    if (label) {
      title.textContent = `テロップ操作は「${label}」で進行します`;
    } else {
      title.textContent = "テロップ操作の日程が確定しました";
    }
    toast.appendChild(title);
    if (range) {
      const rangeLine = document.createElement("div");
      rangeLine.className = "flow-consensus-toast__range";
      rangeLine.textContent = range;
      toast.appendChild(rangeLine);
    }
    if (byline) {
      const bylineLine = document.createElement("div");
      bylineLine.className = "flow-consensus-toast__byline";
      bylineLine.textContent = `確定: ${byline}`;
      toast.appendChild(bylineLine);
    }
    toast.hidden = false;
    // force reflow for transition
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    this.scheduleConsensusToastTimer = timerHost.setTimeout(() => {
      this.scheduleConsensusToastTimer = 0;
      this.hideScheduleConsensusToast();
    }, SCHEDULE_CONSENSUS_TOAST_MS);
  }

  hideScheduleConsensusToast() {
    const toast = this.dom.scheduleConsensusToast;
    if (!toast) {
      return;
    }
    const timerHost = getTimerHost();
    if (this.scheduleConsensusToastTimer) {
      timerHost.clearTimeout(this.scheduleConsensusToastTimer);
      this.scheduleConsensusToastTimer = 0;
    }
    if (this.scheduleConsensusHideTimer) {
      timerHost.clearTimeout(this.scheduleConsensusHideTimer);
      this.scheduleConsensusHideTimer = 0;
    }
    if (toast.hidden) {
      toast.textContent = "";
      toast.classList.remove("is-visible");
      return;
    }
    toast.classList.remove("is-visible");
    this.scheduleConsensusHideTimer = timerHost.setTimeout(() => {
      toast.hidden = true;
      toast.textContent = "";
      this.scheduleConsensusHideTimer = 0;
    }, 220);
  }

  maybeClearScheduleConsensus(context = null) {
    const consensus = this.scheduleConsensusState;
    if (!consensus || !consensus.conflictSignature) {
      return;
    }
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      return;
    }
    if (context?.hasConflict) {
      return;
    }
    try {
      const ref = getOperatorScheduleConsensusRef(eventId);
      const signature = consensus.conflictSignature;
      this.scheduleConsensusState = null;
      this.scheduleConsensusLastSignature = "";
      this.scheduleConsensusLastKey = "";
      this.scheduleConflictPromptSignature = "";
      this.scheduleConflictLastPromptSignature = "";
      remove(ref)
        .then(() => {
          this.logFlowState("スケジュール合意情報を削除しました", {
            eventId,
            conflictSignature: signature
          });
        })
        .catch((error) => {
          console.debug("Failed to clear schedule consensus:", error);
        });
      this.syncScheduleConflictPromptState(context);
    } catch (error) {
      console.debug("Failed to clear schedule consensus:", error);
    }
  }

  scheduleHostPresenceHeartbeat() {
    if (this.hostPresenceHeartbeat) {
      return;
    }
    this.hostPresenceHeartbeat = setInterval(
      () => this.touchHostPresence(),
      HOST_PRESENCE_HEARTBEAT_MS
    );
  }

  touchHostPresence() {
    if (!this.hostPresenceEntryRef || !this.hostPresenceEntryKey) {
      this.stopHostPresenceHeartbeat();
      return;
    }
    const now = Date.now();
    const key = ensureString(this.hostPresenceEntryKey);
    const [eventIdPart = "", sessionIdPart = ""] = key.split("/");
    this.logOperatorPresenceDebug("Write operator presence heartbeat", {
      eventId: ensureString(eventIdPart) || ensureString(this.selectedEventId),
      sessionId: ensureString(sessionIdPart),
      update: {
        clientTimestamp: now
      }
    });
    update(this.hostPresenceEntryRef, {
      clientTimestamp: now
    }).catch((error) => {
      console.debug("Host presence heartbeat failed:", error);
    });
  }

  stopHostPresenceHeartbeat() {
    if (this.hostPresenceHeartbeat) {
      clearInterval(this.hostPresenceHeartbeat);
      this.hostPresenceHeartbeat = null;
    }
  }

  clearHostPresence() {
    this.stopHostPresenceHeartbeat();
    this.hostPresenceLastSignature = "";
    const disconnectHandle = this.hostPresenceDisconnect;
    this.hostPresenceDisconnect = null;
    if (disconnectHandle && typeof disconnectHandle.cancel === "function") {
      disconnectHandle.cancel().catch(() => {});
    }
    const entryRef = this.hostPresenceEntryRef;
    this.hostPresenceEntryRef = null;
    const hadKey = !!this.hostPresenceEntryKey;
    const entryKey = ensureString(this.hostPresenceEntryKey);
    this.hostPresenceEntryKey = "";
    if (entryRef && hadKey) {
      const [eventIdPart = "", sessionIdPart = ""] = entryKey.split("/");
      this.logOperatorPresenceDebug("Remove operator presence entry", {
        eventId: ensureString(eventIdPart) || ensureString(this.selectedEventId),
        sessionId: ensureString(sessionIdPart),
        reason: "clear-host-presence"
      });
      remove(entryRef).catch((error) => {
        console.debug("Failed to clear host presence:", error);
      });
    }
  }

  setHostCommittedSchedule(
    scheduleId,
    { schedule = null, reason = "state-change", sync = true, updateContext = true, force = false } = {}
  ) {
    const normalizedId = ensureString(scheduleId);
    let resolvedSchedule = schedule;
    if (normalizedId && (!resolvedSchedule || resolvedSchedule.id !== normalizedId)) {
      resolvedSchedule = this.schedules.find((item) => item.id === normalizedId) || null;
    }
    const previousId = ensureString(this.hostCommittedScheduleId);
    const previousLabel = ensureString(this.hostCommittedScheduleLabel);
    const nextLabel = normalizedId ? ensureString(resolvedSchedule?.label) || normalizedId : "";
    const changed = previousId !== normalizedId || previousLabel !== nextLabel;
    this.hostCommittedScheduleId = normalizedId;
    this.hostCommittedScheduleLabel = normalizedId ? nextLabel : "";
    if (normalizedId) {
      this.scheduleSelectionCommitted = true;
    } else {
      this.scheduleSelectionCommitted = false;
    }
    if (force) {
      this.hostPresenceLastSignature = "";
    }
    if (sync) {
      this.syncHostPresence(reason);
    } else if (changed) {
      this.hostPresenceLastSignature = "";
    }
    if (updateContext) {
      this.updateScheduleConflictState();
    }
    if (changed) {
      this.logFlowState("テロップ操作用のコミット済み日程を更新しました", {
        scheduleId: normalizedId || "",
        scheduleLabel: this.hostCommittedScheduleLabel || "",
        reason
      });
      this.renderScheduleList();
      this.updateScheduleSummary();
      this.updateStageHeader();
      this.updateSelectionNotes();
    }
    if (normalizedId && this.shouldAutoLockDisplaySchedule(reason)) {
      const scheduleForLock =
        resolvedSchedule || this.schedules.find((item) => item.id === normalizedId) || null;
      void this.requestDisplayScheduleLock(normalizedId, {
        schedule: scheduleForLock,
        reason
      });
    }
    return changed;
  }

  commitSelectedScheduleForTelop({ reason = "schedule-commit" } = {}) {
    const scheduleId = ensureString(this.selectedScheduleId);
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
    if (this.tools?.syncOperatorContext) {
      this.tools
        .syncOperatorContext({ force: true, reason: "schedule-commit" })
        .catch((error) => logError("Failed to sync operator context after schedule commit", error));
    }
    return true;
  }

  shouldAutoLockDisplaySchedule(reason = "") {
    const normalized = ensureString(reason);
    return DISPLAY_LOCK_REASONS.has(normalized);
  }

  async requestDisplayScheduleLock(scheduleId, { schedule = null, reason = "" } = {}) {
    const eventId = ensureString(this.selectedEventId);
    const normalizedScheduleId = ensureString(scheduleId);
    if (!eventId || !normalizedScheduleId) {
      this.logFlowState("ディスプレイ固定リクエストをスキップします", {
        reason,
        eventId,
        scheduleId: normalizedScheduleId
      });
      return false;
    }
    if (!this.api) {
      this.logFlowState("API未初期化のためディスプレイ固定リクエストをスキップします", {
        reason,
        eventId,
        scheduleId: normalizedScheduleId
      });
      return false;
    }
    const scheduleLabel =
      ensureString(schedule?.label) || ensureString(this.hostCommittedScheduleLabel) || normalizedScheduleId;
    const operatorName =
      ensureString(this.currentUser?.displayName) || ensureString(this.currentUser?.email) || "";
    try {
      await this.api.apiPost({
        action: "lockDisplaySchedule",
        eventId,
        scheduleId: normalizedScheduleId,
        scheduleLabel,
        operatorName
      });
      this.logFlowState("ディスプレイのチャンネル固定を要求しました", {
        eventId,
        scheduleId: normalizedScheduleId,
        scheduleLabel,
        reason
      });
      return true;
    } catch (error) {
      this.logFlowState("ディスプレイのチャンネル固定に失敗しました", {
        eventId,
        scheduleId: normalizedScheduleId,
        scheduleLabel,
        reason,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
      logError("Failed to lock display schedule", error);
      return false;
    }
  }

  getHostPresenceStorage() {
    if (typeof this.cachedHostPresenceStorage !== "undefined") {
      return this.cachedHostPresenceStorage;
    }
    if (typeof window === "undefined") {
      this.cachedHostPresenceStorage = null;
      return null;
    }
    const candidates = [window.sessionStorage, window.localStorage];
    for (const storage of candidates) {
      if (!storage) {
        continue;
      }
      try {
        const probeKey = "__events_host_presence_probe__";
        storage.setItem(probeKey, "1");
        storage.removeItem(probeKey);
        this.cachedHostPresenceStorage = storage;
        return storage;
      } catch (error) {
        // Ignore storage access errors and continue checking fallbacks.
      }
    }
    this.cachedHostPresenceStorage = null;
    return null;
  }

  getHostPresenceStorageKey(uid = "", eventId = "") {
    const normalizedUid = ensureString(uid);
    const normalizedEventId = ensureString(eventId);
    if (!normalizedUid || !normalizedEventId) {
      return "";
    }
    return `events:host-presence:${normalizedUid}:${normalizedEventId}`;
  }

  loadStoredHostPresenceSessionId(uid = "", eventId = "") {
    const storage = this.getHostPresenceStorage();
    const key = this.getHostPresenceStorageKey(uid, eventId);
    if (!storage || !key) {
      return "";
    }
    try {
      return ensureString(storage.getItem(key));
    } catch (error) {
      return "";
    }
  }

  persistHostPresenceSessionId(uid = "", eventId = "", sessionId = "") {
    const storage = this.getHostPresenceStorage();
    const key = this.getHostPresenceStorageKey(uid, eventId);
    const normalizedSessionId = ensureString(sessionId);
    if (!storage || !key || !normalizedSessionId) {
      return;
    }
    try {
      storage.setItem(key, normalizedSessionId);
    } catch (error) {
      // Ignore storage persistence failures.
    }
  }

  collectLocalHostPresenceEntries(presenceEntries = [], uid = "") {
    const normalizedUid = ensureString(uid);
    if (!normalizedUid || !Array.isArray(presenceEntries)) {
      return [];
    }
    return presenceEntries
      .filter((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        const entryUid = ensureString(entry.uid);
        if (!entryUid || entryUid !== normalizedUid) {
          return false;
        }
        const source = ensureString(entry.source);
        return !source || source === "events";
      })
      .map((entry) => ({
        entryId: ensureString(entry.entryId),
        sessionId: ensureString(entry.sessionId || entry.entryId),
        source: ensureString(entry.source),
        updatedAt: Number(entry.updatedAt || 0) || 0
      }));
  }

  async fetchHostPresenceEntries(eventId = "", uid = "") {
    const normalizedEventId = ensureString(eventId);
    const normalizedUid = ensureString(uid);
    if (!normalizedEventId || !normalizedUid) {
      return [];
    }
    try {
      const snapshot = await get(getOperatorPresenceEventRef(normalizedEventId));
      const raw = snapshot.exists() ? snapshot.val() : {};
      if (!raw || typeof raw !== "object") {
        this.logOperatorPresenceDebug("Read operator presence (get)", {
          eventId: normalizedEventId,
          uid: normalizedUid,
          entryCount: 0,
          entries: []
        });
        return [];
      }
      const entries = [];
      Object.entries(raw).forEach(([entryId, payload]) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        const entryUid = ensureString(payload.uid);
        if (!entryUid || entryUid !== normalizedUid) {
          return;
        }
        const source = ensureString(payload.source);
        if (source && source !== "events") {
          return;
        }
        const normalizedEntryId = ensureString(entryId);
        const sessionId = ensureString(payload.sessionId) || normalizedEntryId;
        if (!sessionId) {
          return;
        }
        const updatedAt = Number(payload.clientTimestamp || payload.updatedAt || 0) || 0;
        entries.push({
          entryId: normalizedEntryId,
          sessionId,
          source,
          updatedAt
        });
      });
      entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      this.logOperatorPresenceDebug("Read operator presence (get)", {
        eventId: normalizedEventId,
        uid: normalizedUid,
        entryCount: entries.length,
        entries: entries.map((entry) => ({
          entryId: ensureString(entry.entryId),
          sessionId: ensureString(entry.sessionId),
          source: ensureString(entry.source),
          updatedAt: Number(entry.updatedAt || 0) || 0
        }))
      });
      return entries;
    } catch (error) {
      console.debug("Failed to fetch host presence entries:", error);
      return [];
    }
  }

  pruneHostPresenceEntries(eventId = "", entries = [], sessionId = "") {
    const normalizedEventId = ensureString(eventId);
    if (!normalizedEventId || !Array.isArray(entries) || entries.length === 0) {
      return;
    }
    const keepSessionId = ensureString(sessionId);
    entries.forEach((entry) => {
      const entrySessionId = ensureString(entry?.sessionId || entry?.entryId);
      if (!entrySessionId || entrySessionId === keepSessionId) {
        return;
      }
      try {
        this.logOperatorPresenceDebug("Remove stale operator presence entry", {
          eventId: normalizedEventId,
          sessionId: entrySessionId
        });
        remove(getOperatorPresenceEntryRef(normalizedEventId, entrySessionId)).catch(() => {});
      } catch (error) {
        console.debug("Failed to remove stale host presence entry:", error);
      }
    });
  }

  async reconcileHostPresenceSessions(eventId = "", uid = "", sessionId = "", prefetchedEntries = null) {
    const normalizedEventId = ensureString(eventId);
    const normalizedUid = ensureString(uid);
    if (!normalizedEventId || !normalizedUid) {
      return;
    }
    let entries = Array.isArray(prefetchedEntries) ? prefetchedEntries.slice() : null;
    if (!entries || entries.length === 0) {
      entries = await this.fetchHostPresenceEntries(normalizedEventId, normalizedUid);
    }
    if (!entries || entries.length === 0) {
      return;
    }
    const keepSessionId = ensureString(sessionId);
    let preferredEntry = null;
    if (keepSessionId) {
      preferredEntry = entries.find((entry) => ensureString(entry.sessionId || entry.entryId) === keepSessionId) || null;
    }
    if (!preferredEntry) {
      preferredEntry = entries[0] || null;
    }
    const preferredSessionId = ensureString(preferredEntry?.sessionId || preferredEntry?.entryId);
    if (!preferredSessionId) {
      return;
    }
    const targetSessionId = keepSessionId && preferredSessionId === keepSessionId ? keepSessionId : preferredSessionId;
    if (ensureString(this.hostPresenceSessionId) !== targetSessionId) {
      this.hostPresenceSessionId = targetSessionId;
      this.persistHostPresenceSessionId(normalizedUid, normalizedEventId, targetSessionId);
    }
    this.hostPresenceEntryKey = `${normalizedEventId}/${targetSessionId}`;
    this.hostPresenceEntryRef = getOperatorPresenceEntryRef(normalizedEventId, targetSessionId);
    const staleEntries = entries.filter((entry) => {
      const entrySessionId = ensureString(entry.sessionId || entry.entryId);
      return entrySessionId && entrySessionId !== targetSessionId;
    });
    this.pruneHostPresenceEntries(normalizedEventId, staleEntries, targetSessionId);
  }

  async syncHostPresence(reason = "state-change") {
    const user = this.currentUser || auth.currentUser || null;
    const uid = ensureString(user?.uid);
    if (!uid) {
      this.clearHostPresence();
      this.logFlowState("在席情報をクリアしました (未ログイン)", { reason });
      return;
    }

    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      this.clearHostPresence();
      this.logFlowState("在席情報をクリアしました (イベント未選択)", { reason });
      return;
    }

    if (!this.eventSelectionCommitted) {
      this.clearHostPresence();
      this.logFlowState("イベント未確定のため在席情報の更新を保留します", {
        reason,
        eventId
      });
      return;
    }

    const presenceEntries = Array.isArray(this.operatorPresenceEntries)
      ? this.operatorPresenceEntries
      : [];
    let hostEntries = this.collectLocalHostPresenceEntries(presenceEntries, uid);
    if (hostEntries.length === 0) {
      const fetchedEntries = await this.fetchHostPresenceEntries(eventId, uid);
      hostEntries = Array.isArray(fetchedEntries) ? fetchedEntries : [];
    }
    hostEntries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const hostSessionIds = new Set(
      hostEntries.map((entry) => ensureString(entry.sessionId || entry.entryId)).filter(Boolean)
    );
    const entryKey = ensureString(this.hostPresenceEntryKey);
    const [entryKeyEventId = ""] = entryKey.split("/");
    const previousSessionId = entryKeyEventId === eventId ? ensureString(this.hostPresenceSessionId) : "";
    const storedSessionId = ensureString(this.loadStoredHostPresenceSessionId(uid, eventId));
    const preferredEntry = hostEntries.length > 0 ? hostEntries[0] : null;
    const preferredSessionId = ensureString(preferredEntry?.sessionId || preferredEntry?.entryId);
    const baselineSessionId = previousSessionId || storedSessionId || "";

    let sessionId = "";
    let reusedSessionId = "";

    if (previousSessionId && hostSessionIds.has(previousSessionId)) {
      sessionId = previousSessionId;
      reusedSessionId = previousSessionId;
    } else if (storedSessionId && hostSessionIds.has(storedSessionId)) {
      sessionId = storedSessionId;
      reusedSessionId = storedSessionId;
    } else if (preferredSessionId) {
      sessionId = preferredSessionId;
      reusedSessionId = preferredSessionId;
    } else if (storedSessionId) {
      sessionId = storedSessionId;
    } else if (previousSessionId) {
      sessionId = previousSessionId;
    } else {
      sessionId = this.generatePresenceSessionId();
    }

    this.hostPresenceSessionId = sessionId;
    this.persistHostPresenceSessionId(uid, eventId, sessionId);
    const nextKey = `${eventId}/${sessionId}`;
    if (this.hostPresenceEntryKey && this.hostPresenceEntryKey !== nextKey) {
      this.clearHostPresence();
      this.hostPresenceSessionId = sessionId;
    }

    if (reusedSessionId) {
      this.logFlowState("既存の在席セッションを引き継ぎます", {
        reason,
        eventId,
        previousSessionId: baselineSessionId || "",
        sessionId
      });
    }

    const event = this.getSelectedEvent();
    const hostContext = this.resolveHostScheduleContext(eventId);
    let presenceScheduleId = ensureString(hostContext.scheduleId);
    const committedScheduleId = ensureString(hostContext.committedScheduleId);
    const selectedScheduleId = ensureString(hostContext.selectedScheduleId);
    const selectedScheduleLabel = ensureString(hostContext.selectedScheduleLabel);
    const scheduleLabel = ensureString(hostContext.scheduleLabel);
    const scheduleKey = ensureString(hostContext.scheduleKey);
    const pendingNavigationTarget = ensureString(this.pendingNavigationTarget);
    if (!presenceScheduleId && selectedScheduleId && pendingNavigationTarget) {
      presenceScheduleId = selectedScheduleId;
    }
    if (!presenceScheduleId && committedScheduleId) {
      presenceScheduleId = committedScheduleId;
    }
    let effectiveScheduleLabel = scheduleLabel;
    if (!effectiveScheduleLabel && presenceScheduleId) {
      if (presenceScheduleId === committedScheduleId) {
        effectiveScheduleLabel = ensureString(this.hostCommittedScheduleLabel) || presenceScheduleId;
      } else if (selectedScheduleId === presenceScheduleId) {
        effectiveScheduleLabel = selectedScheduleLabel || presenceScheduleId;
      } else {
        const fallbackSchedule = this.findScheduleByIdOrAlias(presenceScheduleId);
        effectiveScheduleLabel = ensureString(fallbackSchedule?.label) || presenceScheduleId;
      }
    }
    const operatorMode = normalizeOperatorMode(this.operatorMode);
    const skipTelop = operatorMode === OPERATOR_MODE_SUPPORT;
    const signature = JSON.stringify({
      eventId,
      scheduleId: presenceScheduleId,
      scheduleKey,
      scheduleLabel: effectiveScheduleLabel,
      sessionId,
      skipTelop,
      committedScheduleId,
      selectedScheduleId,
      selectedScheduleLabel,
      committedScheduleLabel: ensureString(this.hostCommittedScheduleLabel)
    });
    if (reason !== "heartbeat" && signature === this.hostPresenceLastSignature) {
      this.scheduleHostPresenceHeartbeat();
      this.logFlowState("在席情報に変更はありません", {
        reason,
        eventId,
        scheduleId: presenceScheduleId,
        committedScheduleId,
        scheduleKey,
        sessionId
      });
      return;
    }
    this.hostPresenceLastSignature = signature;

    const entryRef = getOperatorPresenceEntryRef(eventId, sessionId);
    this.hostPresenceEntryKey = nextKey;
    this.hostPresenceEntryRef = entryRef;

    const payload = {
      sessionId,
      uid,
      email: ensureString(user?.email),
      displayName: ensureString(user?.displayName),
      eventId,
      eventName: ensureString(event?.name || eventId),
      scheduleId: presenceScheduleId,
      scheduleKey,
      scheduleLabel: effectiveScheduleLabel,
      selectedScheduleId,
      selectedScheduleLabel,
      skipTelop,
      updatedAt: serverTimestamp(),
      clientTimestamp: Date.now(),
      reason,
      source: "events"
    };

    this.logOperatorPresenceDebug("Write operator presence entry", {
      eventId,
      sessionId,
      payload: this.describeOperatorPresencePayload(payload)
    });

    set(entryRef, payload).catch((error) => {
      console.error("Failed to persist host presence:", error);
    });

    const staleEntries = hostEntries.filter((entry) => {
      const entrySessionId = ensureString(entry.sessionId || entry.entryId);
      return entrySessionId && entrySessionId !== sessionId;
    });
    this.pruneHostPresenceEntries(eventId, staleEntries, sessionId);

    try {
      if (this.hostPresenceDisconnect) {
        this.hostPresenceDisconnect.cancel().catch(() => {});
      }
      const disconnectHandle = onDisconnect(entryRef);
      this.hostPresenceDisconnect = disconnectHandle;
      disconnectHandle.remove().catch(() => {});
    } catch (error) {
      console.debug("Failed to register host presence cleanup:", error);
    }

    this.scheduleHostPresenceHeartbeat();
    this.logFlowState("在席情報を更新しました", {
      reason,
      eventId,
      scheduleId: presenceScheduleId,
      committedScheduleId,
      scheduleKey,
      sessionId
    });

    this.reconcileHostPresenceSessions(eventId, uid, sessionId).catch(() => {});
  }

  clearOperatorPresenceState() {
    if (this.operatorPresenceUnsubscribe) {
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    this.clearHostPresence();
    this.operatorPresenceEventId = "";
    this.operatorPresenceEntries = [];
    this.hostCommittedScheduleId = "";
    this.hostCommittedScheduleLabel = "";
    this.eventSelectionCommitted = false;
    this.scheduleSelectionCommitted = false;
    this.scheduleConflictContext = null;
    this.scheduleConflictLastSignature = "";
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
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

  setScheduleConflictSubmitting(isSubmitting) {
    const confirmButton = this.dom.scheduleConflictConfirmButton;
    if (confirmButton) {
      confirmButton.disabled = Boolean(isSubmitting);
      if (isSubmitting) {
        confirmButton.setAttribute("aria-busy", "true");
      } else {
        confirmButton.removeAttribute("aria-busy");
      }
    }
  }

  async requestScheduleConflictPrompt(context = null) {
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      return false;
    }
    const resolvedContext = context || this.scheduleConflictContext || this.buildScheduleConflictContext();
    const signature = ensureString(resolvedContext?.signature);
    if (!resolvedContext?.hasConflict || !signature) {
      return false;
    }
    if (this.scheduleConflictPromptSignature === signature) {
      return true;
    }
    const consensus = this.scheduleConsensusState;
    if (consensus && ensureString(consensus.conflictSignature) === signature) {
      const existingKey = ensureString(consensus.scheduleKey);
      if (!existingKey) {
        this.scheduleConflictPromptSignature = signature;
      }
      return true;
    }
    const user = this.currentUser || auth.currentUser || null;
    const requestedByUid = ensureString(user?.uid);
    if (!requestedByUid) {
      return false;
    }
    const requestedByDisplayName =
      ensureString(user?.displayName) || ensureString(user?.email) || requestedByUid;
    const requestedBySessionId = ensureString(this.hostPresenceSessionId);
    const consensusRef = getOperatorScheduleConsensusRef(eventId);
    try {
      const result = await runTransaction(consensusRef, (current) => {
        if (current && typeof current === "object") {
          const currentSignature = ensureString(current.conflictSignature);
          const currentKey = ensureString(current.scheduleKey);
          if (currentSignature === signature) {
            if (!currentKey) {
              return {
                ...current,
                requestedByUid: requestedByUid || current.requestedByUid || "",
                requestedByDisplayName:
                  requestedByDisplayName || current.requestedByDisplayName || "",
                requestedBySessionId:
                  requestedBySessionId || current.requestedBySessionId || "",
                requestedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                status: ensureString(current.status) || "pending"
              };
            }
            return current;
          }
        }
        return {
          conflictSignature: signature,
          scheduleKey: "",
          scheduleId: "",
          scheduleLabel: "",
          scheduleRange: "",
          requestedByUid,
          requestedByDisplayName,
          requestedBySessionId,
          requestedAt: serverTimestamp(),
          status: "pending",
          updatedAt: serverTimestamp()
        };
      });
      if (result.committed) {
        this.scheduleConflictPromptSignature = signature;
        this.logFlowState("スケジュール合意の確認を要求しました", {
          eventId,
          conflictSignature: signature,
          requestedByUid,
          requestedBySessionId
        });
        this.syncScheduleConflictPromptState(resolvedContext);
      }
      return result.committed;
    } catch (error) {
      console.debug("Failed to request schedule consensus prompt:", error);
      return false;
    }
  }

  handleScheduleConflictSubmit(event) {
    event.preventDefault();
    const options = Array.from(
      this.dom.scheduleConflictOptions?.querySelectorAll(`input[name="${this.scheduleConflictRadioName}"]`) || []
    );
    const selected = options.find((input) => input.checked);
    if (!selected) {
      this.setScheduleConflictError("日程を選択してください。");
      return;
    }
    let scheduleId = ensureString(selected.dataset.scheduleId);
    const scheduleKey = ensureString(selected.value);
    if (!scheduleKey) {
      this.setScheduleConflictError("この日程の情報を取得できませんでした。もう一度選択してください。");
      return;
    }
    if (!scheduleId) {
      scheduleId = this.extractScheduleIdFromKey(scheduleKey) || "";
      if (scheduleId) {
        selected.dataset.scheduleId = scheduleId;
      }
    }
    if (!scheduleId) {
      this.setScheduleConflictError("この日程の情報を取得できませんでした。もう一度選択してください。");
      return;
    }
    const scheduleMatch = this.schedules.find((schedule) => {
      if (!schedule?.id) {
        return false;
      }
      if (schedule.id === scheduleId) {
        return true;
      }
      return normalizeScheduleId(schedule.id) === normalizeScheduleId(scheduleId);
    });
    if (!scheduleMatch) {
      this.setScheduleConflictError("選択した日程が現在のイベントに存在しません。日程一覧を確認してください。");
      return;
    }
    scheduleId = scheduleMatch.id;
    selected.dataset.scheduleId = scheduleId;
    const context = this.scheduleConflictContext || this.buildScheduleConflictContext();
    const optionsContext = Array.isArray(context?.selectableOptions) && context.selectableOptions.length
      ? context.selectableOptions
      : Array.isArray(context?.options)
        ? context.options
        : [];
    const option = optionsContext.find((item) => item.key === scheduleKey || item.scheduleId === scheduleId) || null;
    this.scheduleConflictContext = context;
    this.clearScheduleConflictError();
    this.setScheduleConflictSubmitting(true);
    this.confirmScheduleConsensus({ scheduleId, scheduleKey, option, context })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        if (this.dom.scheduleConflictForm) {
          this.dom.scheduleConflictForm.reset();
        }
        this.clearScheduleConflictError();
        if (this.dom.scheduleConflictDialog) {
          this.closeDialog(this.dom.scheduleConflictDialog);
        }
        const navMeta = this.pendingNavigationMeta;
        const navTarget = this.pendingNavigationTarget || "";
        this.pendingNavigationTarget = "";
        this.pendingNavigationMeta = null;
        this.awaitingScheduleConflictPrompt = false;
        this.clearPendingNavigationTimer();
        let resolvedTarget = navTarget;
        let usedFallback = false;
        const metaOrigin = navMeta?.originPanel || "";
        const metaTarget = navMeta?.target || "";
        const isFlowFromSchedules =
          navMeta?.reason === "flow-navigation" && metaOrigin === "schedules";
        if (!resolvedTarget && metaTarget) {
          resolvedTarget = metaTarget;
          usedFallback = resolvedTarget !== navTarget;
        }
        if (isFlowFromSchedules) {
          const preferredTarget = metaTarget && metaTarget !== metaOrigin ? metaTarget : "";
          const fallbackTarget = preferredTarget || "participants";
          if (resolvedTarget !== fallbackTarget) {
            usedFallback = usedFallback || resolvedTarget !== navTarget;
            resolvedTarget = fallbackTarget;
          }
        }
        if (resolvedTarget) {
          this.showPanel(resolvedTarget);
          const message = usedFallback
            ? "スケジュール合意の確定後に参加者リストへ移動しました"
            : "スケジュール合意の確定後にナビゲーションを継続します";
          this.logFlowState(message, {
            target: resolvedTarget,
            scheduleId,
            scheduleKey,
            fallback: usedFallback
          });
        }
      })
      .catch((error) => {
        console.error("Failed to resolve schedule conflict:", error);
        this.setScheduleConflictError("日程の確定に失敗しました。ネットワーク接続を確認して再度お試しください。");
      })
      .finally(() => {
        this.setScheduleConflictSubmitting(false);
      });
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
      const options = [
        {
          value: "follow",
          title: "テロップを操作する日程を選ぶ",
          description: winnerLabel
            ? winnerRange
              ? `テロップ操作パネルを「${winnerLabel}」（${winnerRange}）で開きます。`
              : `テロップ操作パネルを「${winnerLabel}」で開きます。`
            : "確定した日程でテロップ操作を行います。"
        },
        {
          value: "support",
          title: "自分が選んでいた日程をテロップ操作なしモードで開く",
          description: currentLabel
            ? `日程「${currentLabel}」をテロップ操作なしモードで開きます。`
            : "テロップ操作を行わず、参加者向けツールのみ利用します。"
        },
        {
          value: "reselect",
          title: "もう一度日程を選び直す",
          description: "日程一覧に戻り、テロップ操作で使用する日程を改めて選び直します。"
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
        force: true
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
        force: true
      });
      this.logFlowState("テロップ操作なしモードで続ける対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else if (action === "reselect") {
      this.setHostCommittedSchedule("", {
        reason: "consensus-reselect",
        sync: true,
        updateContext: true,
        force: true
      });
      this.showPanel("schedules");
      this.logFlowState("別の日程を選び直す対応を選択しました", {
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
  }

  async confirmScheduleConsensus(selection) {
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      this.setScheduleConflictError("イベントが選択されていません。イベントを選択し直してください。");
      return false;
    }
    const context = selection?.context || this.scheduleConflictContext || this.buildScheduleConflictContext();
    const signature = ensureString(context?.signature);
    if (!signature) {
      this.setScheduleConflictError("現在の選択状況を確認できませんでした。再度お試しください。");
      return false;
    }
    let scheduleId = ensureString(selection?.scheduleId);
    const scheduleKey = ensureString(selection?.scheduleKey);
    if (!scheduleKey) {
      this.setScheduleConflictError("日程情報を取得できませんでした。もう一度選択してください。");
      return false;
    }
    if (!scheduleId) {
      scheduleId = this.extractScheduleIdFromKey(scheduleKey, eventId);
    }
    if (!scheduleId) {
      this.setScheduleConflictError("日程情報を取得できませんでした。もう一度選択してください。");
      return false;
    }
    const scheduleMatch = this.schedules.find((schedule) => {
      if (!schedule?.id) {
        return false;
      }
      if (schedule.id === scheduleId) {
        return true;
      }
      return normalizeScheduleId(schedule.id) === normalizeScheduleId(scheduleId);
    });
    if (!scheduleMatch) {
      this.setScheduleConflictError("選択した日程が現在のイベントに存在しません。日程一覧を確認してください。");
      return false;
    }
    scheduleId = scheduleMatch.id;
    const user = this.currentUser || auth.currentUser || null;
    const resolvedByUid = ensureString(user?.uid);
    if (!resolvedByUid) {
      this.setScheduleConflictError("ログイン状態を確認できませんでした。ページを再読み込みしてください。");
      return false;
    }
    const resolvedByDisplayName =
      ensureString(user?.displayName) || ensureString(user?.email) || resolvedByUid;
    const resolvedBySessionId = ensureString(this.hostPresenceSessionId);
    const option = selection?.option || null;
    const fallbackSchedule = this.schedules.find((schedule) => schedule.id === scheduleId) || null;
    const scheduleLabel =
      ensureString(option?.scheduleLabel) || ensureString(fallbackSchedule?.label) || scheduleId;
    let scheduleRange = ensureString(option?.scheduleRange);
    if (!scheduleRange && fallbackSchedule) {
      scheduleRange = formatScheduleRange(fallbackSchedule.startAt, fallbackSchedule.endAt);
    }
    const consensusRef = getOperatorScheduleConsensusRef(eventId);
    try {
      const result = await runTransaction(consensusRef, (current) => {
        if (current && typeof current === "object") {
          const currentSignature = ensureString(current.conflictSignature);
          const currentKey = ensureString(current.scheduleKey);
          if (currentSignature && currentSignature !== signature) {
            return current;
          }
          if (currentSignature === signature && currentKey) {
            return current;
          }
          const next = {
            ...current,
            conflictSignature: signature,
            scheduleKey,
            scheduleId,
            scheduleLabel,
            scheduleRange,
            resolvedByUid,
            resolvedByDisplayName,
            resolvedBySessionId,
            resolvedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: "resolved"
          };
          return next;
        }
        return {
          conflictSignature: signature,
          scheduleKey,
          scheduleId,
          scheduleLabel,
          scheduleRange,
          resolvedByUid,
          resolvedByDisplayName,
          resolvedBySessionId,
          resolvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          status: "resolved"
        };
      });
      if (!result.committed) {
        this.setScheduleConflictError("別のオペレーターが日程を確定しました。最新の状態に更新しています…");
        return false;
      }
      this.clearScheduleConflictError();
      this.logFlowState("スケジュール合意の書き込みが完了しました", {
        eventId,
        scheduleId,
        scheduleKey,
        conflictSignature: signature
      });
      const scheduleForCommit = fallbackSchedule || scheduleMatch || null;
      this.setHostCommittedSchedule(scheduleId, {
        schedule: scheduleForCommit,
        reason: "consensus-submit",
        sync: true,
        updateContext: true,
        force: true
      });
      this.tools.prepareContextForSelection();
      if (
        this.tools.isPendingSync() ||
        this.activePanel === "participants" ||
        this.activePanel === "operator"
      ) {
        this.tools
          .syncEmbeddedTools({ reason: "consensus-submit" })
          .catch((error) => logError("Failed to sync tools after schedule consensus", error));
      } else {
        this.tools
          .syncOperatorContext({ force: true })
          .catch((error) => logError("Failed to sync operator context after schedule consensus", error));
      }
      return true;
    } catch (error) {
      console.error("Failed to confirm schedule consensus:", error);
      this.setScheduleConflictError("日程の確定に失敗しました。通信環境を確認して再度お試しください。");
      return false;
    }
  }

  cleanup() {
    this.cancelAuthResumeFallback("cleanup");
    this.clearOperatorPresenceState();
    if (typeof document !== "undefined") {
      document.removeEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.removeEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("fullscreenerror", this.handleFullscreenError);
      document.removeEventListener("webkitfullscreenerror", this.handleFullscreenError);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.cleanup);
    }
    if (this.dom.chatContainer) {
      this.dom.chatContainer.removeEventListener("pointerdown", this.handleChatInteraction);
      this.dom.chatContainer.removeEventListener("focusin", this.handleChatInteraction);
    }
    this.closeMobilePanel({ restoreFocus: false });
    this.selectionListeners.clear();
    this.eventListeners.clear();
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
      const targets = [
        document.body,
        header,
        this.dom.main,
        this.dom.flowStage,
        layout,
        this.dom.chatContainer,
        this.dom.chatPanel
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
    const selfUid = ensureString(this.currentUser?.uid);
    Object.entries(raw).forEach(([entryId, payload]) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const normalizedId = ensureString(entryId) || generateShortId("presence-");
      const scheduleKey = this.buildPresenceScheduleKey(eventId, payload, normalizedId);
      const scheduleId = ensureString(payload.scheduleId);
      const displayName = ensureString(payload.displayName) || ensureString(payload.email) || ensureString(payload.uid) || normalizedId;
      const uid = ensureString(payload.uid);
      const mode = normalizeOperatorMode(payload.mode);
      const updatedAt = Number(payload.clientTimestamp || payload.updatedAt || 0) || 0;
      entries.push({
        entryId: normalizedId,
        uid,
        displayName,
        scheduleId,
        scheduleLabel: ensureString(payload.scheduleLabel),
        scheduleKey,
        mode,
        updatedAt,
        isSelf: Boolean(selfUid && uid && uid === selfUid)
      });
    });
    entries.sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
    return entries;
  }

  buildScheduleConflictContext() {
    const event = this.getSelectedEvent();
    const eventId = event?.id || "";
    const context = {
      eventId,
      entries: [],
      options: [],
      selectableOptions: [],
      hasConflict: false,
      hasOtherOperators: false,
      hostScheduleId: "",
      hostScheduleKey: "",
      hostScheduleLabel: "",
      defaultKey: "",
      signature: ""
    };
    if (!eventId) {
      return context;
    }
    const scheduleMap = new Map(this.schedules.map((schedule) => [schedule.id, schedule]));
    const entries = [];
    const selfUid = ensureString(this.currentUser?.uid);
    const selfLabel = ensureString(this.currentUser?.displayName) || ensureString(this.currentUser?.email) || "あなた";
    let hasSelfPresence = false;
    this.operatorPresenceEntries.forEach((entry) => {
      const baseScheduleId = ensureString(entry.scheduleId);
      const scheduleFromMap = baseScheduleId ? scheduleMap.get(baseScheduleId) : null;
      const derivedFromKey = this.extractScheduleIdFromKey(entry.scheduleKey, eventId);
      const resolvedScheduleId = ensureString(scheduleFromMap?.id || baseScheduleId || derivedFromKey);
      const schedule = resolvedScheduleId ? scheduleMap.get(resolvedScheduleId) || scheduleFromMap : scheduleFromMap;
      const normalizedMode = normalizeOperatorMode(entry.mode);
      const skipTelop = entry.skipTelop === true || normalizedMode === OPERATOR_MODE_SUPPORT;
      const isSelf = Boolean(entry.isSelf || (selfUid && entry.uid && entry.uid === selfUid));
      if (isSelf) {
        hasSelfPresence = true;
      }
      const scheduleLabel = schedule?.label || entry.scheduleLabel || resolvedScheduleId || "未選択";
      const scheduleRange = schedule ? formatScheduleRange(schedule.startAt, schedule.endAt) : "";
      const scheduleKey = ensureString(
        entry.scheduleKey ||
          (resolvedScheduleId
            ? this.derivePresenceScheduleKey(
                eventId,
                { scheduleId: resolvedScheduleId, scheduleLabel },
                ensureString(entry.entryId)
              )
            : "")
      );
      entries.push({
        entryId: entry.entryId,
        uid: entry.uid,
        displayName: entry.displayName || entry.uid || entry.entryId,
        scheduleId: resolvedScheduleId,
        scheduleKey,
        scheduleLabel,
        scheduleRange,
        isSelf,
        mode: normalizedMode,
        skipTelop,
        updatedAt: entry.updatedAt || 0
      });
    });
    const hostContext = this.resolveHostScheduleContext(eventId, { scheduleMap });
    const hostScheduleId = ensureString(hostContext.scheduleId);
    const hostScheduleKey = ensureString(hostContext.scheduleKey);
    const hostScheduleLabel = ensureString(hostContext.scheduleLabel);
    const hostScheduleRange = ensureString(hostContext.scheduleRange);
    const hostSchedule = hostContext.schedule || (hostScheduleId ? scheduleMap.get(hostScheduleId) || null : null);
    const committedScheduleId = ensureString(this.hostCommittedScheduleId);
    const committedSchedule = committedScheduleId ? scheduleMap.get(committedScheduleId) || null : null;
    const committedScheduleLabel = ensureString(this.hostCommittedScheduleLabel) || committedSchedule?.label || committedScheduleId;
    const committedScheduleRange = committedSchedule
      ? formatScheduleRange(committedSchedule.startAt, committedSchedule.endAt)
      : "";

    const selfEntry = entries.find((entry) => entry.isSelf);
    if (selfEntry) {
      selfEntry.scheduleId = hostScheduleId;
      if (hostScheduleKey) {
        selfEntry.scheduleKey = hostScheduleKey;
      }
      selfEntry.scheduleLabel = hostScheduleLabel || hostScheduleId || "未選択";
      selfEntry.scheduleRange = hostScheduleRange || selfEntry.scheduleRange || "";
    }

    context.hostScheduleId = hostScheduleId;
    context.hostScheduleKey = hostScheduleKey;
    context.hostScheduleLabel = hostScheduleLabel;
    context.hostScheduleRange = hostScheduleRange;
    context.hostSelectedScheduleId = ensureString(hostContext.selectedScheduleId);
    context.hostCommittedScheduleId = ensureString(hostContext.committedScheduleId);
    context.telopScheduleId = committedScheduleId;
    context.telopScheduleLabel = committedScheduleLabel;
    context.telopScheduleRange = committedScheduleRange;

    if (!hasSelfPresence && hostScheduleId) {
      entries.push({
        entryId: selfUid ? `self::${selfUid}` : "self",
        uid: selfUid,
        displayName: selfLabel,
        scheduleId: hostScheduleId,
        scheduleKey: hostScheduleKey || hostScheduleId,
        scheduleLabel: hostScheduleLabel || hostScheduleId || "未選択",
        scheduleRange: hostScheduleRange || formatScheduleRange(hostSchedule?.startAt, hostSchedule?.endAt),
        isSelf: true,
        mode: this.operatorMode,
        skipTelop: this.operatorMode === OPERATOR_MODE_SUPPORT,
        updatedAt: Date.now()
      });
      hasSelfPresence = true;
    }
    entries.sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (!a.isSelf && b.isSelf) return 1;
      return (a.displayName || "").localeCompare(b.displayName || "", "ja");
    });
    const committedEntries = entries.filter((entry) => ensureString(entry.scheduleId) && !entry.skipTelop);
    context.entries = committedEntries;
    context.allEntries = entries;
    const groups = new Map();
    entries.forEach((entry) => {
      const key = entry.scheduleKey || "";
      const existing = groups.get(key) || {
        key,
        scheduleId: entry.scheduleId || "",
        scheduleLabel: entry.scheduleLabel || "未選択",
        scheduleRange: entry.scheduleRange || "",
        members: [],
        telopMembers: []
      };
      if (!groups.has(key)) {
        groups.set(key, existing);
      }
      if (!existing.scheduleId && entry.scheduleId) {
        existing.scheduleId = entry.scheduleId;
      }
      if (!existing.scheduleLabel && entry.scheduleLabel) {
        existing.scheduleLabel = entry.scheduleLabel;
      }
      if (!existing.scheduleRange && entry.scheduleRange) {
        existing.scheduleRange = entry.scheduleRange;
      }
      existing.members.push(entry);
      if (!entry.skipTelop && ensureString(entry.scheduleId)) {
        existing.telopMembers.push(entry);
      }
    });
    const options = Array.from(groups.values())
      .filter((group) => group.telopMembers && group.telopMembers.length > 0)
      .map((group) => {
        const derivedScheduleId = group.scheduleId || this.extractScheduleIdFromKey(group.key, eventId) || "";
        const schedule = derivedScheduleId ? scheduleMap.get(derivedScheduleId) : null;
        const scheduleId = schedule?.id || derivedScheduleId || "";
        const scheduleLabel = group.scheduleLabel || schedule?.label || scheduleId || "未選択";
        const scheduleRange = group.scheduleRange || formatScheduleRange(schedule?.startAt, schedule?.endAt);
        const containsSelf = group.telopMembers.some((member) => member.isSelf);
        return {
          key: group.key,
          scheduleId,
          scheduleLabel,
          scheduleRange,
          members: group.members,
          containsSelf,
          isSelectable: Boolean(scheduleId)
        };
      });
    options.sort((a, b) => {
      if (a.containsSelf && !b.containsSelf) return -1;
      if (!a.containsSelf && b.containsSelf) return 1;
      return (a.scheduleLabel || "").localeCompare(b.scheduleLabel || "", "ja");
    });
    const selectableOptions = options.filter((option) => option.scheduleId);
    context.options = selectableOptions;
    context.hasOtherOperators = committedEntries.some((entry) => !entry.isSelf);
    context.selectableOptions = selectableOptions;
    const uniqueSelectableKeys = new Set(
      selectableOptions.map((option) => option.key || option.scheduleId || "")
    );
    const telopScheduleId = committedScheduleId;
    const conflictingTelopEntries = committedEntries.filter((entry) => {
      const entryScheduleId = ensureString(entry.scheduleId);
      return Boolean(telopScheduleId && entryScheduleId && entryScheduleId !== telopScheduleId);
    });
    context.hasConflict = Boolean(telopScheduleId) && conflictingTelopEntries.length > 0;
    const preferredOption =
      selectableOptions.find((option) => option.containsSelf) || selectableOptions[0] || null;
    context.defaultKey = preferredOption?.key || "";
    const signatureSource = committedEntries.length ? committedEntries : entries;
    const signatureParts = signatureSource.map((entry) => {
      const entryId = entry.uid || entry.entryId || "anon";
      const scheduleKey = entry.scheduleKey || "none";
      return `${entryId}::${scheduleKey}`;
    });
    signatureParts.sort();
    const baseSignature = signatureParts.join("|") || "none";
    context.signature = `${eventId || "event"}::${baseSignature}`;
    return context;
  }

  syncScheduleConflictPromptState(context = null) {
    const button = this.dom.scheduleNextButton;
    if (!button) {
      return;
    }
    const resolvedContext = context || this.scheduleConflictContext || this.buildScheduleConflictContext();
    const contextSignature = ensureString(resolvedContext?.signature);
    const pendingSignature = ensureString(this.scheduleConflictPromptSignature);
    const hasConflict = Boolean(resolvedContext?.hasConflict);
    const hasResolvedKey = Boolean(this.scheduleConsensusLastKey);
    const shouldIndicate =
      hasConflict &&
      pendingSignature &&
      contextSignature &&
      contextSignature === pendingSignature &&
      !hasResolvedKey;
    if (shouldIndicate) {
      if (!Object.prototype.hasOwnProperty.call(button.dataset, "conflictOriginalTitle")) {
        button.dataset.conflictOriginalTitle = button.getAttribute("title") || "";
      }
      button.setAttribute("data-conflict-pending", "true");
      button.setAttribute(
        "title",
        "他のオペレーターと日程の調整が必要です。「確定」で日程を確定してください。"
      );
    } else {
      button.removeAttribute("data-conflict-pending");
      if (Object.prototype.hasOwnProperty.call(button.dataset, "conflictOriginalTitle")) {
        const original = button.dataset.conflictOriginalTitle || "";
        if (original) {
          button.setAttribute("title", original);
        } else {
          button.removeAttribute("title");
        }
        delete button.dataset.conflictOriginalTitle;
      }
    }
  }

  updateScheduleConflictState() {
    const context = this.buildScheduleConflictContext();
    this.scheduleConflictContext = context;
    if (this.isScheduleConflictDialogOpen()) {
      this.renderScheduleConflictDialog(context);
    }
    this.enforceScheduleConflictState(context);
    this.syncScheduleConflictPromptState(context);
  }

  enforceScheduleConflictState(context = null) {
    const hasConflict = Boolean(context?.hasConflict);
    if (!hasConflict) {
      if (this.isScheduleConflictDialogOpen()) {
        if (this.dom.scheduleConflictForm) {
          this.dom.scheduleConflictForm.reset();
        }
        this.closeDialog(this.dom.scheduleConflictDialog);
      }
      this.scheduleConflictLastSignature = "";
      this.scheduleConflictPromptSignature = "";
      this.scheduleConflictLastPromptSignature = "";
      this.maybeClearScheduleConsensus(context);
      return;
    }
    const signature = ensureString(context?.signature);
    this.scheduleConflictLastSignature = signature;
    const hasSelection = Boolean(this.selectedScheduleId);
    const shouldPromptDueToNavigation = Boolean(this.pendingNavigationTarget);
    const shouldPromptDueToConflict =
      !shouldPromptDueToNavigation &&
      hasSelection &&
      signature &&
      signature !== this.scheduleConflictLastPromptSignature;
    if (!this.isScheduleConflictDialogOpen()) {
      if (shouldPromptDueToNavigation && hasSelection) {
        this.openScheduleConflictDialog(context, {
          reason: "presence",
          originPanel: this.activePanel,
          target: this.pendingNavigationTarget || this.activePanel
        });
      } else if (shouldPromptDueToConflict) {
        this.openScheduleConflictDialog(context, {
          reason: "presence-auto",
          originPanel: this.activePanel,
          target: this.activePanel
        });
      }
    } else if (shouldPromptDueToConflict && signature) {
      this.scheduleConflictLastPromptSignature = signature;
    }
  }

  syncOperatorPresenceSubscription() {
    const eventId = ensureString(this.selectedEventId);
    if (this.operatorPresenceEventId === eventId) {
      this.logFlowState("オペレーター選択状況の購読は既に最新です", {
        eventId
      });
      this.updateScheduleConflictState();
      return;
    }
    if (this.operatorPresenceUnsubscribe) {
      this.logFlowEvent("オペレーター選択状況の購読を解除します", {
        previousEventId: this.operatorPresenceEventId
      });
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    this.operatorPresenceEventId = eventId;
    this.operatorPresenceEntries = [];
    if (!eventId) {
      this.logFlowState("イベント未選択のためオペレーター選択状況をクリアしました");
      this.updateScheduleConflictState();
      return;
    }
    this.logFlowEvent("オペレーター選択状況の購読を開始します", {
      eventId
    });
    try {
      const ref = getOperatorPresenceEventRef(eventId);
      this.operatorPresenceUnsubscribe = onValue(
        ref,
        (snapshot) => {
          const raw = snapshot.exists() ? snapshot.val() : {};
          this.operatorPresenceEntries = this.normalizeOperatorPresenceEntries(raw, eventId);
          this.updateScheduleConflictState();
          this.logFlowState("オペレーター選択状況を受信しました", {
            eventId,
            entryCount: this.operatorPresenceEntries.length
          });
        },
        (error) => {
          console.error("Failed to monitor operator presence:", error);
        }
      );
    } catch (error) {
      console.error("Failed to subscribe operator presence:", error);
      this.operatorPresenceUnsubscribe = null;
    }
    this.updateScheduleConflictState();
  }

  syncScheduleConsensusSubscription() {
    const eventId = ensureString(this.selectedEventId);
    if (this.scheduleConsensusEventId === eventId) {
      return;
    }
    if (this.scheduleConsensusUnsubscribe) {
      this.scheduleConsensusUnsubscribe();
      this.scheduleConsensusUnsubscribe = null;
    }
    this.scheduleConsensusEventId = eventId;
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    this.hideScheduleConsensusToast();
    if (!eventId) {
      return;
    }
    try {
      const ref = getOperatorScheduleConsensusRef(eventId);
      this.scheduleConsensusUnsubscribe = onValue(
        ref,
        (snapshot) => {
          const raw = snapshot.exists() ? snapshot.val() : null;
          const consensus = this.normalizeScheduleConsensus(raw);
          this.scheduleConsensusState = consensus;
          this.handleScheduleConsensusUpdate(eventId, consensus);
        },
        (error) => {
          console.error("Failed to monitor schedule consensus:", error);
        }
      );
    } catch (error) {
      console.error("Failed to subscribe schedule consensus:", error);
      this.scheduleConsensusUnsubscribe = null;
    }
  }

  clearScheduleConsensusState({ reason = "" } = {}) {
    if (this.scheduleConsensusUnsubscribe) {
      this.scheduleConsensusUnsubscribe();
      this.scheduleConsensusUnsubscribe = null;
    }
    this.scheduleConsensusEventId = "";
    this.scheduleConsensusState = null;
    this.scheduleConsensusLastSignature = "";
    this.scheduleConsensusLastKey = "";
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.hideScheduleConsensusToast();
    if (reason) {
      this.logFlowState("スケジュール合意情報をリセットしました", { reason });
    }
  }

  normalizeScheduleConsensus(raw = null) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return {
      conflictSignature: ensureString(raw.conflictSignature),
      scheduleKey: ensureString(raw.scheduleKey),
      scheduleId: ensureString(raw.scheduleId),
      scheduleLabel: ensureString(raw.scheduleLabel),
      scheduleRange: ensureString(raw.scheduleRange),
      status: ensureString(raw.status),
      requestedByUid: ensureString(raw.requestedByUid),
      requestedByDisplayName: ensureString(raw.requestedByDisplayName),
      requestedBySessionId: ensureString(raw.requestedBySessionId),
      requestedAt: Number(raw.requestedAt || raw.updatedAt || 0) || 0,
      resolvedByUid: ensureString(raw.resolvedByUid),
      resolvedByDisplayName: ensureString(raw.resolvedByDisplayName),
      resolvedBySessionId: ensureString(raw.resolvedBySessionId),
      resolvedAt: Number(raw.resolvedAt || 0) || 0,
      updatedAt: Number(raw.updatedAt || 0) || 0
    };
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
    this.pendingNavigationMeta = null;
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
        force: true
      });
    } else if (scheduleId && selectedScheduleId && scheduleId !== selectedScheduleId) {
      const currentSchedule = this.schedules.find((schedule) => schedule.id === selectedScheduleId) || null;
      const currentLabel = currentSchedule?.label || selectedScheduleId;
      this.setHostCommittedSchedule("", {
        reason: "consensus-pending",
        sync: true,
        updateContext: true,
        force: true
      });
      if (this.operatorMode === OPERATOR_MODE_SUPPORT) {
        this.logFlowState("テロップ操作なしモードのためスケジュール合意モーダルを表示しません", {
          consensusScheduleId: scheduleId,
          currentScheduleId: selectedScheduleId,
          consensusLabel: label || "",
          consensusRange: range || ""
        });
      } else {
        this.openScheduleFallbackDialog({
          consensusScheduleId: scheduleId,
          consensusLabel: label,
          consensusRange: range,
          consensusByline: byline,
          currentScheduleId: selectedScheduleId,
          currentScheduleLabel: currentLabel
        });
      }
    } else if (scheduleId) {
      this.setHostCommittedSchedule(scheduleId, {
        schedule: fallbackSchedule,
        reason: "consensus-align",
        sync: true,
        updateContext: true,
        force: true
      });
    } else {
      this.setHostCommittedSchedule("", {
        reason: "consensus-clear",
        sync: true,
        updateContext: true,
        force: true
      });
    }
    this.syncScheduleConflictPromptState();
  }

  showScheduleConsensusToast({ label = "", range = "", byline = "" } = {}) {
    const toast = this.dom.scheduleConsensusToast;
    if (!toast) {
      return;
    }
    const timerHost = getTimerHost();
    this.hideScheduleConsensusToast();
    if (this.scheduleConsensusHideTimer) {
      timerHost.clearTimeout(this.scheduleConsensusHideTimer);
      this.scheduleConsensusHideTimer = 0;
    }
    toast.innerHTML = "";
    const title = document.createElement("div");
    if (label) {
      title.textContent = `テロップ操作は「${label}」で進行します`;
    } else {
      title.textContent = "テロップ操作の日程が確定しました";
    }
    toast.appendChild(title);
    if (range) {
      const rangeLine = document.createElement("div");
      rangeLine.className = "flow-consensus-toast__range";
      rangeLine.textContent = range;
      toast.appendChild(rangeLine);
    }
    if (byline) {
      const bylineLine = document.createElement("div");
      bylineLine.className = "flow-consensus-toast__byline";
      bylineLine.textContent = `確定: ${byline}`;
      toast.appendChild(bylineLine);
    }
    toast.hidden = false;
    // force reflow for transition
    void toast.offsetWidth;
    toast.classList.add("is-visible");
    this.scheduleConsensusToastTimer = timerHost.setTimeout(() => {
      this.scheduleConsensusToastTimer = 0;
      this.hideScheduleConsensusToast();
    }, SCHEDULE_CONSENSUS_TOAST_MS);
  }

  hideScheduleConsensusToast() {
    const toast = this.dom.scheduleConsensusToast;
    if (!toast) {
      return;
    }
    const timerHost = getTimerHost();
    if (this.scheduleConsensusToastTimer) {
      timerHost.clearTimeout(this.scheduleConsensusToastTimer);
      this.scheduleConsensusToastTimer = 0;
    }
    if (this.scheduleConsensusHideTimer) {
      timerHost.clearTimeout(this.scheduleConsensusHideTimer);
      this.scheduleConsensusHideTimer = 0;
    }
    if (toast.hidden) {
      toast.textContent = "";
      toast.classList.remove("is-visible");
      return;
    }
    toast.classList.remove("is-visible");
    this.scheduleConsensusHideTimer = timerHost.setTimeout(() => {
      toast.hidden = true;
      toast.textContent = "";
      this.scheduleConsensusHideTimer = 0;
    }, 220);
  }

  maybeClearScheduleConsensus(context = null) {
    const consensus = this.scheduleConsensusState;
    if (!consensus || !consensus.conflictSignature) {
      return;
    }
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      return;
    }
    if (context?.hasConflict) {
      return;
    }
    try {
      const ref = getOperatorScheduleConsensusRef(eventId);
      const signature = consensus.conflictSignature;
      this.scheduleConsensusState = null;
      this.scheduleConsensusLastSignature = "";
      this.scheduleConsensusLastKey = "";
      this.scheduleConflictPromptSignature = "";
      this.scheduleConflictLastPromptSignature = "";
      remove(ref)
        .then(() => {
          this.logFlowState("スケジュール合意情報を削除しました", {
            eventId,
            conflictSignature: signature
          });
        })
        .catch((error) => {
          console.debug("Failed to clear schedule consensus:", error);
        });
      this.syncScheduleConflictPromptState(context);
    } catch (error) {
      console.debug("Failed to clear schedule consensus:", error);
    }
  }

  scheduleHostPresenceHeartbeat() {
    if (this.hostPresenceHeartbeat) {
      return;
    }
    this.hostPresenceHeartbeat = setInterval(
      () => this.touchHostPresence(),
      HOST_PRESENCE_HEARTBEAT_MS
    );
  }

  touchHostPresence() {
    if (!this.hostPresenceEntryRef || !this.hostPresenceEntryKey) {
      this.stopHostPresenceHeartbeat();
      return;
    }
    const now = Date.now();
    update(this.hostPresenceEntryRef, {
      clientTimestamp: now
    }).catch((error) => {
      console.debug("Host presence heartbeat failed:", error);
    });
  }

  stopHostPresenceHeartbeat() {
    if (this.hostPresenceHeartbeat) {
      clearInterval(this.hostPresenceHeartbeat);
      this.hostPresenceHeartbeat = null;
    }
  }

  clearHostPresence() {
    this.stopHostPresenceHeartbeat();
    this.hostPresenceLastSignature = "";
    const disconnectHandle = this.hostPresenceDisconnect;
    this.hostPresenceDisconnect = null;
    if (disconnectHandle && typeof disconnectHandle.cancel === "function") {
      disconnectHandle.cancel().catch(() => {});
    }
    const entryRef = this.hostPresenceEntryRef;
    this.hostPresenceEntryRef = null;
    const hadKey = !!this.hostPresenceEntryKey;
    this.hostPresenceEntryKey = "";
    if (entryRef && hadKey) {
      remove(entryRef).catch((error) => {
        console.debug("Failed to clear host presence:", error);
      });
    }
  }

  setHostCommittedSchedule(
    scheduleId,
    { schedule = null, reason = "state-change", sync = true, updateContext = true, force = false } = {}
  ) {
    const normalizedId = ensureString(scheduleId);
    let resolvedSchedule = schedule;
    if (normalizedId && (!resolvedSchedule || resolvedSchedule.id !== normalizedId)) {
      resolvedSchedule = this.schedules.find((item) => item.id === normalizedId) || null;
    }
    const previousId = ensureString(this.hostCommittedScheduleId);
    const previousLabel = ensureString(this.hostCommittedScheduleLabel);
    const nextLabel = normalizedId ? ensureString(resolvedSchedule?.label) || normalizedId : "";
    const changed = previousId !== normalizedId || previousLabel !== nextLabel;
    this.hostCommittedScheduleId = normalizedId;
    this.hostCommittedScheduleLabel = normalizedId ? nextLabel : "";
    if (force) {
      this.hostPresenceLastSignature = "";
    }
    if (sync) {
      this.syncHostPresence(reason);
    } else if (changed) {
      this.hostPresenceLastSignature = "";
    }
    if (updateContext) {
      this.updateScheduleConflictState();
    }
    if (changed) {
      this.logFlowState("テロップ操作用のコミット済み日程を更新しました", {
        scheduleId: normalizedId || "",
        scheduleLabel: this.hostCommittedScheduleLabel || "",
        reason
      });
    }
    if (normalizedId && this.shouldAutoLockDisplaySchedule(reason)) {
      const scheduleForLock =
        resolvedSchedule || this.schedules.find((item) => item.id === normalizedId) || null;
      void this.requestDisplayScheduleLock(normalizedId, {
        schedule: scheduleForLock,
        reason
      });
    }
    return changed;
  }

  commitSelectedScheduleForTelop({ reason = "schedule-commit" } = {}) {
    const scheduleId = ensureString(this.selectedScheduleId);
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
    this.logFlowState("テロップ操作の日程の確定リクエストを処理しました", {
      scheduleId,
      scheduleLabel: schedule?.label || scheduleId,
      reason,
      changed
    });
    if (this.tools?.syncOperatorContext) {
      this.tools
        .syncOperatorContext({ force: true, reason: "schedule-commit" })
        .catch((error) => logError("Failed to sync operator context after schedule commit", error));
    }
    return true;
  }

  clearOperatorPresenceState() {
    if (this.operatorPresenceUnsubscribe) {
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    this.clearHostPresence();
    this.operatorPresenceEventId = "";
    this.operatorPresenceEntries = [];
    this.hostCommittedScheduleId = "";
    this.hostCommittedScheduleLabel = "";
    this.eventSelectionCommitted = false;
    this.scheduleSelectionCommitted = false;
    this.scheduleConflictContext = null;
    this.scheduleConflictLastSignature = "";
    this.scheduleConflictPromptSignature = "";
    this.scheduleConflictLastPromptSignature = "";
    this.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
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

  async requestScheduleConflictPrompt(context = null) {
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      return false;
    }
    const resolvedContext = context || this.scheduleConflictContext || this.buildScheduleConflictContext();
    const signature = ensureString(resolvedContext?.signature);
    if (!resolvedContext?.hasConflict || !signature) {
      return false;
    }
    if (this.scheduleConflictPromptSignature === signature) {
      return true;
    }
    const consensus = this.scheduleConsensusState;
    if (consensus && ensureString(consensus.conflictSignature) === signature) {
      const existingKey = ensureString(consensus.scheduleKey);
      if (!existingKey) {
        this.scheduleConflictPromptSignature = signature;
      }
      return true;
    }
    const user = this.currentUser || auth.currentUser || null;
    const requestedByUid = ensureString(user?.uid);
    if (!requestedByUid) {
      return false;
    }
    const requestedByDisplayName =
      ensureString(user?.displayName) || ensureString(user?.email) || requestedByUid;
    const requestedBySessionId = ensureString(this.hostPresenceSessionId);
    const consensusRef = getOperatorScheduleConsensusRef(eventId);
    try {
      const result = await runTransaction(consensusRef, (current) => {
        if (current && typeof current === "object") {
          const currentSignature = ensureString(current.conflictSignature);
          const currentKey = ensureString(current.scheduleKey);
          if (currentSignature === signature) {
            if (!currentKey) {
              return {
                ...current,
                requestedByUid: requestedByUid || current.requestedByUid || "",
                requestedByDisplayName:
                  requestedByDisplayName || current.requestedByDisplayName || "",
                requestedBySessionId:
                  requestedBySessionId || current.requestedBySessionId || "",
                requestedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                status: ensureString(current.status) || "pending"
              };
            }
            return current;
          }
        }
        return {
          conflictSignature: signature,
          scheduleKey: "",
          scheduleId: "",
          scheduleLabel: "",
          scheduleRange: "",
          requestedByUid,
          requestedByDisplayName,
          requestedBySessionId,
          requestedAt: serverTimestamp(),
          status: "pending",
          updatedAt: serverTimestamp()
        };
      });
      if (result.committed) {
        this.scheduleConflictPromptSignature = signature;
        this.logFlowState("スケジュール合意の確認を要求しました", {
          eventId,
          conflictSignature: signature,
          requestedByUid,
          requestedBySessionId
        });
        this.syncScheduleConflictPromptState(resolvedContext);
      }
      return result.committed;
    } catch (error) {
      console.debug("Failed to request schedule consensus prompt:", error);
      return false;
    }
  }

  handleScheduleConflictSubmit(event) {
    event.preventDefault();
    const options = Array.from(
      this.dom.scheduleConflictOptions?.querySelectorAll(`input[name="${this.scheduleConflictRadioName}"]`) || []
    );
    const selected = options.find((input) => input.checked);
    if (!selected) {
      this.setScheduleConflictError("日程を選択してください。");
      return;
    }
    let scheduleId = ensureString(selected.dataset.scheduleId);
    const scheduleKey = ensureString(selected.value);
    if (!scheduleKey) {
      this.setScheduleConflictError("この日程の情報を取得できませんでした。もう一度選択してください。");
      return;
    }
    if (!scheduleId) {
      scheduleId = this.extractScheduleIdFromKey(scheduleKey) || "";
      if (scheduleId) {
        selected.dataset.scheduleId = scheduleId;
      }
    }
    if (!scheduleId) {
      this.setScheduleConflictError("この日程の情報を取得できませんでした。もう一度選択してください。");
      return;
    }
    const scheduleMatch = this.schedules.find((schedule) => {
      if (!schedule?.id) {
        return false;
      }
      if (schedule.id === scheduleId) {
        return true;
      }
      return normalizeScheduleId(schedule.id) === normalizeScheduleId(scheduleId);
    });
    if (!scheduleMatch) {
      this.setScheduleConflictError("選択した日程が現在のイベントに存在しません。日程一覧を確認してください。");
      return;
    }
    scheduleId = scheduleMatch.id;
    selected.dataset.scheduleId = scheduleId;
    const context = this.scheduleConflictContext || this.buildScheduleConflictContext();
    const optionsContext = Array.isArray(context?.selectableOptions) && context.selectableOptions.length
      ? context.selectableOptions
      : Array.isArray(context?.options)
        ? context.options
        : [];
    const option = optionsContext.find((item) => item.key === scheduleKey || item.scheduleId === scheduleId) || null;
    this.scheduleConflictContext = context;
    this.clearScheduleConflictError();
    this.setScheduleConflictSubmitting(true);
    this.confirmScheduleConsensus({ scheduleId, scheduleKey, option, context })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        if (this.dom.scheduleConflictForm) {
          this.dom.scheduleConflictForm.reset();
        }
        this.clearScheduleConflictError();
        if (this.dom.scheduleConflictDialog) {
          this.closeDialog(this.dom.scheduleConflictDialog);
        }
        const navMeta = this.pendingNavigationMeta;
        const navTarget = this.pendingNavigationTarget || "";
        this.pendingNavigationTarget = "";
        this.pendingNavigationMeta = null;
        this.awaitingScheduleConflictPrompt = false;
        this.clearPendingNavigationTimer();
        let resolvedTarget = navTarget;
        let usedFallback = false;
        const metaOrigin = navMeta?.originPanel || "";
        const metaTarget = navMeta?.target || "";
        const isFlowFromSchedules =
          navMeta?.reason === "flow-navigation" && metaOrigin === "schedules";
        if (!resolvedTarget && metaTarget) {
          resolvedTarget = metaTarget;
          usedFallback = resolvedTarget !== navTarget;
        }
        if (isFlowFromSchedules) {
          const preferredTarget = metaTarget && metaTarget !== metaOrigin ? metaTarget : "";
          const fallbackTarget = preferredTarget || "participants";
          if (resolvedTarget !== fallbackTarget) {
            usedFallback = usedFallback || resolvedTarget !== navTarget;
            resolvedTarget = fallbackTarget;
          }
        }
        if (resolvedTarget) {
          this.showPanel(resolvedTarget);
          const message = usedFallback
            ? "スケジュール合意の確定後に参加者リストへ移動しました"
            : "スケジュール合意の確定後にナビゲーションを継続します";
          this.logFlowState(message, {
            target: resolvedTarget,
            scheduleId,
            scheduleKey,
            fallback: usedFallback
          });
        }
      })
      .catch((error) => {
        console.error("Failed to resolve schedule conflict:", error);
        this.setScheduleConflictError("日程の確定に失敗しました。ネットワーク接続を確認して再度お試しください。");
      })
      .finally(() => {
        this.setScheduleConflictSubmitting(false);
      });
  }

  handleScheduleConflictCancel() {
    this.setScheduleConflictSubmitting(false);
    this.pendingNavigationTarget = "";
    this.pendingNavigationMeta = null;
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
      const options = [
        {
          value: "follow",
          title: "テロップを操作する日程を選ぶ",
          description: winnerLabel
            ? winnerRange
              ? `テロップ操作パネルを「${winnerLabel}」（${winnerRange}）で開きます。`
              : `テロップ操作パネルを「${winnerLabel}」で開きます。`
            : "確定した日程でテロップ操作を行います。"
        },
        {
          value: "support",
          title: "自分が選んでいた日程をテロップ操作なしモードで開く",
          description: currentLabel
            ? `日程「${currentLabel}」をテロップ操作なしモードで開きます。`
            : "テロップ操作を行わず、参加者向けツールのみ利用します。"
        },
        {
          value: "reselect",
          title: "もう一度日程を選び直す",
          description: "日程一覧に戻り、テロップ操作で使用する日程を改めて選び直します。"
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
        force: true
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
        force: true
      });
      this.logFlowState("テロップ操作なしモードで続ける対応を選択しました", {
        previousScheduleId: ensureString(context.currentScheduleId) || ""
      });
    } else if (action === "reselect") {
      this.setHostCommittedSchedule("", {
        reason: "consensus-reselect",
        sync: true,
        updateContext: true,
        force: true
      });
      this.showPanel("schedules");
      this.logFlowState("別の日程を選び直す対応を選択しました", {
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
  }

  async confirmScheduleConsensus(selection) {
    const eventId = ensureString(this.selectedEventId);
    if (!eventId) {
      this.setScheduleConflictError("イベントが選択されていません。イベントを選択し直してください。");
      return false;
    }
    const context = selection?.context || this.scheduleConflictContext || this.buildScheduleConflictContext();
    const signature = ensureString(context?.signature);
    if (!signature) {
      this.setScheduleConflictError("現在の選択状況を確認できませんでした。再度お試しください。");
      return false;
    }
    let scheduleId = ensureString(selection?.scheduleId);
    const scheduleKey = ensureString(selection?.scheduleKey);
    if (!scheduleKey) {
      this.setScheduleConflictError("日程情報を取得できませんでした。もう一度選択してください。");
      return false;
    }
    if (!scheduleId) {
      scheduleId = this.extractScheduleIdFromKey(scheduleKey, eventId);
    }
    if (!scheduleId) {
      this.setScheduleConflictError("日程情報を取得できませんでした。もう一度選択してください。");
      return false;
    }
    const scheduleMatch = this.schedules.find((schedule) => {
      if (!schedule?.id) {
        return false;
      }
      if (schedule.id === scheduleId) {
        return true;
      }
      return normalizeScheduleId(schedule.id) === normalizeScheduleId(scheduleId);
    });
    if (!scheduleMatch) {
      this.setScheduleConflictError("選択した日程が現在のイベントに存在しません。日程一覧を確認してください。");
      return false;
    }
    scheduleId = scheduleMatch.id;
    const user = this.currentUser || auth.currentUser || null;
    const resolvedByUid = ensureString(user?.uid);
    if (!resolvedByUid) {
      this.setScheduleConflictError("ログイン状態を確認できませんでした。ページを再読み込みしてください。");
      return false;
    }
    const resolvedByDisplayName =
      ensureString(user?.displayName) || ensureString(user?.email) || resolvedByUid;
    const resolvedBySessionId = ensureString(this.hostPresenceSessionId);
    const option = selection?.option || null;
    const fallbackSchedule = this.schedules.find((schedule) => schedule.id === scheduleId) || null;
    const scheduleLabel =
      ensureString(option?.scheduleLabel) || ensureString(fallbackSchedule?.label) || scheduleId;
    let scheduleRange = ensureString(option?.scheduleRange);
    if (!scheduleRange && fallbackSchedule) {
      scheduleRange = formatScheduleRange(fallbackSchedule.startAt, fallbackSchedule.endAt);
    }
    const consensusRef = getOperatorScheduleConsensusRef(eventId);
    try {
      const result = await runTransaction(consensusRef, (current) => {
        if (current && typeof current === "object") {
          const currentSignature = ensureString(current.conflictSignature);
          const currentKey = ensureString(current.scheduleKey);
          if (currentSignature && currentSignature !== signature) {
            return current;
          }
          if (currentSignature === signature && currentKey) {
            return current;
          }
          const next = {
            ...current,
            conflictSignature: signature,
            scheduleKey,
            scheduleId,
            scheduleLabel,
            scheduleRange,
            resolvedByUid,
            resolvedByDisplayName,
            resolvedBySessionId,
            resolvedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            status: "resolved"
          };
          return next;
        }
        return {
          conflictSignature: signature,
          scheduleKey,
          scheduleId,
          scheduleLabel,
          scheduleRange,
          resolvedByUid,
          resolvedByDisplayName,
          resolvedBySessionId,
          resolvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          status: "resolved"
        };
      });
      if (!result.committed) {
        this.setScheduleConflictError("別のオペレーターが日程を確定しました。最新の状態に更新しています…");
        return false;
      }
      this.clearScheduleConflictError();
      this.logFlowState("スケジュール合意の書き込みが完了しました", {
        eventId,
        scheduleId,
        scheduleKey,
        conflictSignature: signature
      });
      const scheduleForCommit = fallbackSchedule || scheduleMatch || null;
      this.setHostCommittedSchedule(scheduleId, {
        schedule: scheduleForCommit,
        reason: "consensus-submit",
        sync: true,
        updateContext: true,
        force: true
      });
      this.tools.prepareContextForSelection();
      if (
        this.tools.isPendingSync() ||
        this.activePanel === "participants" ||
        this.activePanel === "operator"
      ) {
        this.tools
          .syncEmbeddedTools({ reason: "consensus-submit" })
          .catch((error) => logError("Failed to sync tools after schedule consensus", error));
      } else {
        this.tools
          .syncOperatorContext({ force: true })
          .catch((error) => logError("Failed to sync operator context after schedule consensus", error));
      }
      return true;
    } catch (error) {
      console.error("Failed to confirm schedule consensus:", error);
      this.setScheduleConflictError("日程の確定に失敗しました。通信環境を確認して再度お試しください。");
      return false;
    }
  }

  cleanup() {
    this.cancelAuthResumeFallback("cleanup");
    this.clearOperatorPresenceState();
    if (typeof document !== "undefined") {
      document.removeEventListener("qa:participants-synced", this.tools.handleParticipantSyncEvent);
      document.removeEventListener("qa:selection-changed", this.tools.handleParticipantSelectionBroadcast);
      document.removeEventListener("fullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", this.handleFullscreenChange);
      document.removeEventListener("fullscreenerror", this.handleFullscreenError);
      document.removeEventListener("webkitfullscreenerror", this.handleFullscreenError);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", this.cleanup);
    }
    if (this.dom.chatContainer) {
      this.dom.chatContainer.removeEventListener("pointerdown", this.handleChatInteraction);
      this.dom.chatContainer.removeEventListener("focusin", this.handleChatInteraction);
    }
    this.closeMobilePanel({ restoreFocus: false });
    this.selectionListeners.clear();
    this.eventListeners.clear();
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
      const targets = [
        document.body,
        header,
        this.dom.main,
        this.dom.flowStage,
        layout,
        this.dom.chatContainer,
        this.dom.chatPanel
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
    this.refreshMobileChatIndicator();
    this.refreshDesktopChatIndicator();
  }

  refreshDesktopChatIndicator() {
    const container = this.dom.chatContainer;
    const indicator = this.dom.chatAttention;
    const countNode = this.dom.chatAttentionCount;
    const textNode = this.dom.chatAttentionText;
    const hasAttention = this.hasChatAttention();
    const count = this.chatUnreadCount || 0;

    if (container) {
      if (hasAttention) {
        container.setAttribute("data-has-updates", "true");
      } else {
        container.removeAttribute("data-has-updates");
      }
    }

    if (indicator) {
      if (hasAttention) {
        indicator.hidden = false;
      } else {
        indicator.hidden = true;
      }
    }

    if (countNode) {
      countNode.textContent = hasAttention ? (count > 99 ? "99+" : String(count)) : "";
    }

    if (textNode) {
      if (hasAttention) {
        const announce = count > 99 ? "99件以上" : `${count}件`;
        textNode.textContent = `新着メッセージが${announce}あります`;
      } else {
        textNode.textContent = "";
      }
    }
  }

  refreshMobileChatIndicator() {
    const button = this.dom.chatMobileToggle;
    const badge = this.dom.chatMobileBadge;
    const srText = this.dom.chatMobileBadgeText;
    const count = this.chatUnreadCount || 0;
    const hasAttention = this.hasChatAttention();
    const isMobile = this.isMobileLayout();
    const isChatOpen = this.activeMobilePanel === "chat";
    const shouldShow = isMobile && !isChatOpen && hasAttention;

    if (button) {
      if (shouldShow) {
        button.setAttribute("data-has-updates", "true");
      } else {
        button.removeAttribute("data-has-updates");
      }
    }

    if (badge) {
      if (shouldShow) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.removeAttribute("hidden");
      } else {
        badge.textContent = "";
        badge.setAttribute("hidden", "");
      }
    }

    if (srText) {
      if (hasAttention) {
        const announce = count > 99 ? "99件以上" : `${count}件`;
        srText.textContent = `新着メッセージが${announce}あります`;
      } else {
        srText.textContent = "";
      }
    }
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
    if (event.key === "Escape" && this.activeMobilePanel) {
      event.preventDefault();
      this.closeMobilePanel();
    }
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
    if (window.matchMedia && window.matchMedia("(max-width: 960px)").matches) {
      chatContainer.style.removeProperty("--events-chat-top");
      chatContainer.style.removeProperty("--events-chat-height");
      return;
    }
    const docEl = document.documentElement;
    const header = document.querySelector(".op-header");
    const flowStage = this.dom.flowStage || document.querySelector(".flow-stage");
    const layout = chatContainer.closest(".events-layout");
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

    const chatStyles = window.getComputedStyle(chatContainer);
    const cssStickyTop = parseCssPixels(chatStyles.top);
    const fallbackStickyTop = bodyPaddingTop + safeAreaTop + headerHeight + bodyGap;
    const stickyTop = cssStickyTop > 0 ? cssStickyTop : fallbackStickyTop;
    const chatOffset = stickyTop + flowStageHeight + mainGap + layoutPaddingTop;
    const viewportHeight = window.innerHeight || docEl.clientHeight;
    const availableHeight = viewportHeight - chatOffset - layoutPaddingBottom - bodyPaddingBottom - safeAreaBottom;

    const heightValue = Math.max(0, Math.round(availableHeight));
    if (heightValue > 0) {
      chatContainer.style.setProperty("--events-chat-height", `${heightValue}px`);
    } else {
      chatContainer.style.removeProperty("--events-chat-height");
    }
  }

  revealEventSelectionCue() {
    if (this.dom.eventSelectionNote) {
      this.dom.eventSelectionNote.hidden = false;
      this.dom.eventSelectionNote.classList.add("section-focus-highlight");
      setTimeout(() => this.dom.eventSelectionNote.classList.remove("section-focus-highlight"), 600);
    }
    if (this.dom.eventList) {
      this.dom.eventList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  revealScheduleSelectionCue() {
    if (this.dom.scheduleSelectionNote) {
      this.dom.scheduleSelectionNote.hidden = false;
      this.dom.scheduleSelectionNote.classList.add("section-focus-highlight");
      setTimeout(() => this.dom.scheduleSelectionNote.classList.remove("section-focus-highlight"), 600);
    }
    if (this.dom.scheduleList) {
      this.dom.scheduleList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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

    if (this.dom.scheduleDialogTitle) {
      this.dom.scheduleDialogTitle.textContent = mode === "edit" ? "日程を編集" : "日程を追加";
    }
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }
    if (mode === "edit" && schedule) {
      if (this.dom.scheduleLabelInput) this.dom.scheduleLabelInput.value = schedule.label || "";
      if (this.dom.scheduleDateInput)
        this.dom.scheduleDateInput.value = schedule.startAt ? String(schedule.startAt).slice(0, 10) : schedule.date || "";
      if (this.dom.scheduleStartInput)
        this.dom.scheduleStartInput.value = schedule.startAt ? String(schedule.startAt).slice(11, 16) : "";
      if (this.dom.scheduleEndInput)
        this.dom.scheduleEndInput.value = schedule.endAt ? String(schedule.endAt).slice(11, 16) : "";
    }

    this.openDialog(this.dom.scheduleDialog);
  }

  async handleScheduleFormSubmit() {
    if (!this.dom.scheduleForm) return;
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    this.setFormError(this.dom.scheduleError, "");

    try {
      const mode = this.dom.scheduleForm.dataset.mode || "create";
      const scheduleId = this.dom.scheduleForm.dataset.scheduleId || "";
      const payload = {
        label: this.dom.scheduleLabelInput?.value,
        date: this.dom.scheduleDateInput?.value,
        start: this.dom.scheduleStartInput?.value,
        end: this.dom.scheduleEndInput?.value
      };
      if (mode === "edit") {
        await this.updateSchedule(scheduleId, payload);
      } else {
        await this.createSchedule(payload);
      }
      this.dom.scheduleForm.reset();
      this.closeDialog(this.dom.scheduleDialog);
    } catch (error) {
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  resolveScheduleFormValues({ label, date, start, end }) {
    const trimmedLabel = normalizeKey(label || "");
    if (!trimmedLabel) {
      throw new Error("日程の表示名を入力してください。");
    }

    const normalizedDate = ensureString(date);
    if (!normalizedDate) {
      throw new Error("日付を入力してください。");
    }

    const startTime = ensureString(start);
    const endTime = ensureString(end);
    if (!startTime || !endTime) {
      throw new Error("開始と終了の時刻を入力してください。");
    }

    const startDate = new Date(`${normalizedDate}T${startTime}`);
    const endDate = new Date(`${normalizedDate}T${endTime}`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new Error("開始・終了時刻の形式が正しくありません。");
    }

    if (endDate.getTime() <= startDate.getTime()) {
      endDate.setTime(endDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const startValue = formatDateTimeLocal(startDate);
    const endValue = formatDateTimeLocal(endDate);

    return {
      label: trimmedLabel,
      date: normalizedDate,
      startValue,
      endValue
    };
  }

  async createSchedule(payload) {
    const eventId = this.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }

    const { label, date, startValue, endValue } = this.resolveScheduleFormValues(payload);
    let scheduleId = generateShortId("sch_");
    const existingIds = new Set(this.schedules.map((schedule) => schedule.id));
    while (existingIds.has(scheduleId)) {
      scheduleId = generateShortId("sch_");
    }

    const now = Date.now();
    this.beginScheduleLoading("日程を保存しています…");
    try {
      await set(ref(database, `questionIntake/schedules/${eventId}/${scheduleId}`), {
        label,
        date,
        startAt: startValue,
        endAt: endValue,
        participantCount: 0,
        createdAt: now,
        updatedAt: now
      });

      await update(ref(database), {
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });

      await this.loadEvents();
      this.selectSchedule(scheduleId);
    } finally {
      this.endScheduleLoading();
    }
  }

  async updateSchedule(scheduleId, payload) {
    const eventId = this.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }

    const { label, date, startValue, endValue } = this.resolveScheduleFormValues(payload);
    const now = Date.now();
    this.beginScheduleLoading("日程を更新しています…");
    try {
      await update(ref(database), {
        [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: label,
        [`questionIntake/schedules/${eventId}/${scheduleId}/date`]: date,
        [`questionIntake/schedules/${eventId}/${scheduleId}/startAt`]: startValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/endAt`]: endValue,
        [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });

      await this.loadEvents();
      this.selectSchedule(scheduleId);
    } finally {
      this.endScheduleLoading();
    }
  }

  async deleteSchedule(schedule) {
    const eventId = this.selectedEventId;
    if (!eventId) {
      throw new Error("イベントを選択してください。");
    }
    const scheduleId = schedule?.id;
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }
    const label = schedule?.label || scheduleId;

    const confirmed = await this.confirm({
      title: "日程の削除",
      description: `日程「${label}」と、紐づく参加者・専用リンクをすべて削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    try {
      this.beginScheduleLoading(`日程「${label}」を削除しています…`);
      const participantSnapshot = await get(ref(database, `questionIntake/participants/${eventId}/${scheduleId}`));
      const participantBranch = participantSnapshot.exists() ? participantSnapshot.val() : {};
      const tokens = new Set();
      if (participantBranch && typeof participantBranch === "object") {
        Object.values(participantBranch).forEach((entry) => {
          const token = entry?.token;
          if (token) tokens.add(String(token));
        });
      }

      const now = Date.now();
      const updates = {
        [`questionIntake/schedules/${eventId}/${scheduleId}`]: null,
        [`questionIntake/participants/${eventId}/${scheduleId}`]: null,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      };
      tokens.forEach((token) => {
        updates[`questionIntake/tokens/${token}`] = null;
      });

      await update(ref(database), updates);
      await this.loadEvents();
      this.selectSchedule("");
    } catch (error) {
      throw new Error(error?.message || "日程の削除に失敗しました。");
    } finally {
      this.endScheduleLoading();
    }
  }

  applyMetaNote() {
    if (!this.dom.metaNote) {
      return;
    }
    const note = (this.eventCountNote || "").trim();
    if (!note) {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
      return;
    }
    this.dom.metaNote.hidden = false;
    this.dom.metaNote.textContent = note;
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
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }

    const existingIds = new Set(this.events.map((event) => event.id));
    let eventId = generateShortId("evt_");
    while (existingIds.has(eventId)) {
      eventId = generateShortId("evt_");
    }

    const now = Date.now();
    this.beginEventsLoading("イベントを追加しています…");
    try {
      await set(ref(database, `questionIntake/events/${eventId}`), {
        name: trimmed,
        createdAt: now,
        updatedAt: now
      });
      await this.loadEvents();
      this.selectEvent(eventId);
    } finally {
      this.endEventsLoading();
    }
  }

  async updateEvent(eventId, name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }

    const now = Date.now();
    this.beginEventsLoading("イベントを更新しています…");
    try {
      await update(ref(database), {
        [`questionIntake/events/${eventId}/name`]: trimmed,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      });
      await this.loadEvents();
      this.selectEvent(eventId);
    } finally {
      this.endEventsLoading();
    }
  }

  async deleteEvent(event) {
    const eventId = event?.id;
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }
    const label = event?.name || eventId;
    const confirmed = await this.confirm({
      title: "イベントの削除",
      description: `イベント「${label}」と、その日程・参加者・発行済みリンクをすべて削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    try {
      this.beginEventsLoading(`イベント「${label}」を削除しています…`);
      const participantSnapshot = await get(ref(database, `questionIntake/participants/${eventId}`));
      const participantBranch = participantSnapshot.exists() ? participantSnapshot.val() : {};
      const tokensToRemove = collectParticipantTokens(participantBranch);

      const updates = {
        [`questionIntake/events/${eventId}`]: null,
        [`questionIntake/schedules/${eventId}`]: null,
        [`questionIntake/participants/${eventId}`]: null
      };
      tokensToRemove.forEach((token) => {
        updates[`questionIntake/tokens/${token}`] = null;
      });

      await update(ref(database), updates);
      await this.loadEvents();
      this.showAlert(`イベント「${label}」を削除しました。`);
    } catch (error) {
      throw new Error(error?.message || "イベントの削除に失敗しました。");
    } finally {
      this.endEventsLoading();
    }
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
    document.addEventListener("keydown", this.handleGlobalKeydown, true);
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
      document.removeEventListener("keydown", this.handleGlobalKeydown, true);
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
      this.pendingNavigationMeta = null;
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
  }

  handleGlobalKeydown(event) {
    if (event.key === "Escape" && this.activeDialog) {
      event.preventDefault();
      if (this.activeDialog === this.dom.confirmDialog) {
        this.resolveConfirm(false);
      } else {
        this.closeDialog(this.activeDialog);
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

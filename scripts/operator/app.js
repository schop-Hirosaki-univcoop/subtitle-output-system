// app.js: オペレーター向け操作画面のブートストラップとユーザー操作制御を担います。
import {
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  onValue,
  get,
  questionsRef,
  pickupQuestionsRef,
  getQuestionStatusRef,
  questionIntakeEventsRef,
  questionIntakeSchedulesRef,
  questionIntakeTokensRef,
  displayPresenceRootRef,
  getDisplayPresenceEntryRef,
  getRenderRef,
  getOperatorPresenceEventRef,
  getOperatorPresenceEntryRef,
  set,
  update,
  remove,
  serverTimestamp,
  onDisconnect,
  ref,
  database,
  getQuestionStatusRef
} from "./firebase.js";
import { getRenderStatePath, parseChannelParams, normalizeScheduleId, normalizeEventId, getQuestionStatusPath } from "../shared/channel-paths.js";
import { derivePresenceScheduleKey as sharedDerivePresenceScheduleKey } from "../shared/presence-keys.js";
import { OPERATOR_MODE_TELOP, normalizeOperatorMode, isTelopMode } from "../shared/operator-modes.js";
import { goToLogin } from "../shared/routes.js";
import { info as logDisplayLinkInfo, error as logDisplayLinkError } from "../shared/display-link-logger.js";
import { queryDom } from "./dom.js";
import { createApiClient } from "./api-client.js";
import { showToast } from "./toast.js";
import {
  loadAuthPreflightContext,
  preflightContextMatchesUser
} from "../shared/auth-preflight.js";
import * as Questions from "./questions.js";
import { resolveGenreLabel } from "./utils.js";
import * as Dictionary from "./panels/dictionary-panel.js";
import * as Logs from "./panels/logs-panel.js";
import * as Display from "./display.js";
import * as UIHelpers from "./ui-helpers.js";
import * as Pickup from "./panels/pickup-panel.js";
import * as SideTelop from "./panels/side-telop-panel.js";
import { ContextManager } from "./context-manager.js";
import { AuthManager } from "./auth-manager.js";
import { PresenceManager } from "./presence-manager.js";
import { ChannelManager, extractScheduleKeyParts } from "./channel-manager.js";
import { UIRenderer } from "./ui-renderer.js";

// ============================================================================
// 状態管理
// ============================================================================

/**
 * オペレーター画面の初期状態を生成します。
 * @param {boolean} autoScroll - ログの自動スクロールを有効にするか
 * @returns {object} 初期状態オブジェクト
 */
function createInitialState(autoScroll = true) {
  return {
    questionsByUid: new Map(),
    questionStatusByUid: new Map(),
    allQuestions: [],
    allLogs: [],
    currentSubTab: "all",
    currentGenre: "",
    currentSchedule: "",
    lastNormalSchedule: "",
    availableSchedules: [],
    scheduleDetails: new Map(),
    scheduleMetadata: new Map(),
    activeEventId: "",
    activeScheduleId: "",
    activeEventName: "",
    activeScheduleLabel: "",
    committedScheduleId: "",
    committedScheduleLabel: "",
    committedScheduleKey: "",
    operatorPresenceIntentId: "",
    operatorPresenceIntentLabel: "",
    operatorPresenceIntentKey: "",
    selectionConfirmed: false,
    eventsById: new Map(),
    tokensByToken: new Map(),
    selectedRowData: null,
    lastDisplayedUid: null,
    autoScrollLogs: autoScroll,
    renderState: null,
    displaySession: null,
    displaySessions: [], // 複数display.htmlの同時表示に対応
    isDisplaySessionActive: false,
    displaySessionLastActive: null,
    displayPresenceEntries: [],
    renderChannelOnline: null,
    displayAssetAvailable: null,
    isDisplayAssetChecked: false,
    isDisplayAssetChecking: false,
    autoLockAttemptKey: "",
    autoLockAttemptAt: 0,
    operatorPresenceEventId: "",
    operatorPresenceByUser: new Map(),
    operatorPresenceSelf: null,
    channelAssignment: null,
    isChannelLocking: false,
    scheduleConflict: null,
    conflictSelection: "",
    operatorMode: OPERATOR_MODE_TELOP,
    sideTelopChannelKey: "",
    sideTelopLastPushedText: "",
    sideTelopEntries: [],
    sideTelopActiveIndex: 0,
    sideTelopEditingIndex: null,
    sideTelopSelectedIndex: null
  };
}

const DOM_EVENT_BINDINGS = [
  { element: "loginButton", type: "click", handler: "login", guard: (app) => !app.isEmbedded },
  { element: "dictionaryToggle", type: "click", handler: "toggleDictionaryDrawer" },
  { element: "logsToggle", type: "click", handler: "toggleLogsDrawer" },
  { element: "logsRefreshButton", type: "click", handler: "fetchLogs" },
  { element: "clearButton", type: "click", handler: "clearNowShowing" },
  { element: "fetchDictionaryButton", type: "click", handler: "fetchDictionary" },
  { element: "addTermForm", type: "submit", handler: "addTerm" },
  { element: "dictionarySelectAllCheckbox", type: "change", handler: "handleDictionarySelectAll" },
  { element: "dictionaryEnableButton", type: "click", handler: "handleDictionaryEnable" },
  { element: "dictionaryDisableButton", type: "click", handler: "handleDictionaryDisable" },
  { element: "dictionaryEditButton", type: "click", handler: "handleDictionaryEdit" },
  { element: "dictionaryDeleteButton", type: "click", handler: "handleDictionaryDelete" },
  { element: "dictionaryBatchEnableButton", type: "click", handler: "handleDictionaryBatchEnable" },
  { element: "dictionaryBatchDisableButton", type: "click", handler: "handleDictionaryBatchDisable" },
  { element: "dictionaryBatchDeleteButton", type: "click", handler: "handleDictionaryBatchDelete" },
  { element: "dictionaryEditCancelButton", type: "click", handler: "closeDictionaryEditDialog" },
  { element: "dictionaryEditForm", type: "submit", handler: "handleDictionaryEditSubmit" },
  { element: "pickupOpenAddButton", type: "click", handler: "openPickupAddDialog" },
  { element: "pickupForm", type: "submit", handler: "handlePickupFormSubmit" },
  { element: "pickupTabs", type: "click", handler: "handlePickupFilterClick" },
  { element: "pickupTabs", type: "keydown", handler: "handlePickupFilterKeydown" },
  { element: "pickupRefreshButton", type: "click", handler: "fetchPickupQuestions" },
  { element: "pickupEditButton", type: "click", handler: "handlePickupActionEdit" },
  { element: "pickupDeleteButton", type: "click", handler: "handlePickupActionDelete" },
  { element: "pickupAddCancelButton", type: "click", handler: "closePickupAddDialog" },
  { element: "pickupEditCancelButton", type: "click", handler: "closePickupEditDialog" },
  { element: "pickupEditForm", type: "submit", handler: "handlePickupEditSubmit" },
  { element: "pickupConfirmCancelButton", type: "click", handler: "closePickupConfirmDialog" },
  { element: "pickupConfirmAcceptButton", type: "click", handler: "handlePickupDelete" },
  { element: "sideTelopForm", type: "submit", handler: "handleSideTelopFormSubmit" },
  { element: "sideTelopFormCancel", type: "click", handler: "handleSideTelopCancel" },
  { element: "sideTelopAddButton", type: "click", handler: "handleSideTelopAddRequest" },
  { element: "sideTelopList", type: "click", handler: "handleSideTelopListClick" },
  { element: "sideTelopList", type: "keydown", handler: "handleSideTelopListKeydown" },
  { element: "sideTelopEditButton", type: "click", handler: "handleSideTelopEditRequest" },
  { element: "sideTelopDeleteButton", type: "click", handler: "handleSideTelopDeleteRequest" },
  { element: "sideTelopDialogForm", type: "submit", handler: "handleSideTelopDialogSubmit" },
  { element: "sideTelopDialogCancel", type: "click", handler: "closeSideTelopDialog" },
  { element: "selectAllCheckbox", type: "change", handler: "handleSelectAll" },
  { element: "cardsContainer", type: "change", handler: "handleRowCheckboxChange" },
  { element: "exportCsvUnansweredButton", type: "click", handler: "exportUnansweredCsv" },
  { element: "exportCsvAnsweredButton", type: "click", handler: "exportAnsweredCsv" },
  { element: "batchUnanswerBtn", type: "click", handler: "handleBatchUnanswer" },
  { element: "editCancelButton", type: "click", handler: "closeEditDialog" },
  { element: "editSaveButton", type: "click", handler: "handleEditSubmit" },
  { element: "logSearch", type: "input", handler: (app) => app.renderLogs() },
  {
    element: "logAutoscroll",
    type: "change",
    handler: (app, event) => {
      if (event?.target instanceof HTMLInputElement) {
        app.state.autoScrollLogs = event.target.checked;
      }
    }
  }
];


const ACTION_BUTTON_BINDINGS = [
  { index: 0, handler: "handleDisplay" },
  { index: 1, handler: "handleUnanswer" },
  { index: 2, handler: "handleEdit" }
];

const OPERATOR_PRESENCE_HEARTBEAT_MS = 60_000;
const DISPLAY_PRESENCE_HEARTBEAT_MS = 20_000;
const DISPLAY_PRESENCE_STALE_THRESHOLD_MS = 90_000;
const DISPLAY_PRESENCE_CLEANUP_INTERVAL_MS = 30_000;
const DISPLAY_SESSION_TTL_MS = 60_000;
const DISPLAY_SESSION_REFRESH_MARGIN_MS = 15_000;

const MODULE_METHOD_GROUPS = [
  {
    module: Dictionary,
    methods: [
      "fetchDictionary",
      "applyInitialDictionaryState",
      "toggleDictionaryDrawer",
      "addTerm",
      "handleDictionarySelectAll",
      "handleDictionaryEnable",
      "handleDictionaryDisable",
      "handleDictionaryEdit",
      "handleDictionaryDelete",
      "handleDictionaryBatchEnable",
      "handleDictionaryBatchDisable",
      "handleDictionaryBatchDelete",
      "handleDictionaryEditSubmit",
      "closeDictionaryEditDialog",
      "startDictionaryListener",
      "stopDictionaryListener"
    ]
  },
  {
    module: Pickup,
    methods: [
      "fetchPickupQuestions",
      "applyInitialPickupState",
      "startPickupListener",
      "stopPickupListener",
      "openPickupAddDialog",
      "closePickupAddDialog",
      "handlePickupFormSubmit",
      "handlePickupFilterClick",
      "handlePickupFilterKeydown",
      "handlePickupEditSubmit",
      "handlePickupActionEdit",
      "handlePickupActionDelete",
      "closePickupEditDialog",
      "closePickupConfirmDialog",
      "handlePickupDelete"
    ]
  },
  {
    module: SideTelop,
    methods: [
      "startSideTelopListener",
      "stopSideTelopListener",
      "renderSideTelopList",
      "handleSideTelopFormSubmit",
      "handleSideTelopListClick",
      "handleSideTelopCancel",
      "handleSideTelopListKeydown",
      "handleSideTelopAddRequest",
      "handleSideTelopEditRequest",
      "handleSideTelopDeleteRequest",
      "handleSideTelopDialogSubmit",
      "closeSideTelopDialog",
      "syncSideTelopToChannel"
    ]
  },
  {
    module: Logs,
    methods: [
      "fetchLogs",
      "renderLogs",
      "applyLogFilters",
      "renderLogsStream",
      "applyInitialLogsState",
      "toggleLogsDrawer",
      "startLogsUpdateMonitor"
    ]
  },
  {
    module: Questions,
    methods: [
      "renderQuestions",
      "updateScheduleContext",
      "switchSubTab",
      "switchGenre",
      "handleDisplay",
      "handleUnanswer",
      "handleSelectAll",
      "handleRowCheckboxChange",
      "exportUnansweredCsv",
      "exportAnsweredCsv",
      "handleBatchUnanswer",
      "clearNowShowing",
      "updateActionAvailability",
      "updateBatchButtonVisibility",
      "syncSelectAllState"
    ]
  },
  {
    module: Display,
    methods: ["handleRenderUpdate", "redrawUpdatedAt", "refreshStaleness", "refreshRenderSummary"]
  },
  {
    module: UIHelpers,
    methods: [
      "openDialog",
      "closeEditDialog",
      "handleDialogKeydown",
      "handleEdit",
      "handleEditSubmit",
      "showLoader",
      "updateLoader",
      "hideLoader",
      "initLoaderSteps",
      "setLoaderStep",
      "finishLoaderSteps"
    ]
  }
];

/**
 * 各ドメインモジュールから公開されているメソッドをOperatorAppインスタンスにバインドします。
 * メソッド呼び出し時にアプリケーションコンテキストを暗黙的に先頭引数として渡すことで、
 * 個別モジュールが状態にアクセスしやすくします。
 * @param {OperatorApp} app
 */
function bindModuleMethods(app) {
  MODULE_METHOD_GROUPS.forEach(({ module, methods }) => {
    methods.forEach((methodName) => {
      const implementation = module?.[methodName];
      if (typeof implementation !== "function") {
        throw new Error(`Missing method "${methodName}" on module.`);
      }
      Object.defineProperty(app, methodName, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: (...args) => implementation(app, ...args)
      });
    });
  });
}

/**
 * DOMイベントの一覧定義を走査し、対応するハンドラをアプリケーションに紐付けます。
 * Guard条件がある場合は評価し、利用不可のUI要素にはイベントを登録しません。
 * @param {OperatorApp} app
 */
function bindDomEvents(app) {
  DOM_EVENT_BINDINGS.forEach(({ element, type, handler, guard }) => {
    if (typeof guard === "function" && !guard(app)) {
      return;
    }
    const target = app.dom[element];
    if (!target || typeof target.addEventListener !== "function") {
      return;
    }
    const listener = typeof handler === "string"
      ? (event) => {
          const method = app[handler];
          if (typeof method === "function") {
            method.call(app, event);
          }
        }
      : (event) => handler(app, event);
    target.addEventListener(type, listener);
  });
}

/**
 * テーブル行の操作ボタンと対応するハンドラを結び付け、
 * クリック時にOperatorAppコンテキストで処理が行われるように設定します。
 * @param {OperatorApp} app
 */
function bindActionButtons(app) {
  const buttons = app.dom.actionButtons || [];
  ACTION_BUTTON_BINDINGS.forEach(({ index, handler }) => {
    const target = buttons[index];
    const method = app[handler];
    if (!target || typeof target.addEventListener !== "function" || typeof method !== "function") {
      return;
    }
    target.addEventListener("click", (event) => method.call(app, event));
  });
}

/**
 * setTimeout/clearTimeout を提供するホストを解決します。
 * ブラウザ環境が存在しないテスト実行時でも安定してタイマーを利用するためのフォールバックです。
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

export class OperatorApp {
  /**
   * 画面構築時にDOMキャッシュと初期状態を準備し、埋め込みモードなどの文脈情報を読み取ります。
   * 重い初期化処理はinitで遅延実行するため、ここでは純粋な状態生成に留めます。
   */
  constructor() {
    this.dom = queryDom();
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    this.api = createApiClient(auth, onAuthStateChanged);
    
    // 認証管理の初期化
    this.authManager = new AuthManager(this);
    
    // プレゼンス管理の初期化（contextManager.applyContextToStateで必要）
    this.presenceManager = new PresenceManager(this);
    
    // コンテキスト管理の初期化
    this.contextManager = new ContextManager(this);
    this.pageContext = this.contextManager.extractPageContext();
    this.initialPageContext = { ...(this.pageContext || {}) };
    this.contextManager.applyContextToState();
    
    // チャンネル管理の初期化
    this.channelManager = new ChannelManager(this);
    
    // UI描画の初期化
    this.uiRenderer = new UIRenderer(this);
    this.isEmbedded = Boolean(OperatorApp.embedPrefix);
    if (this.isEmbedded && this.dom.loginContainer) {
      this.dom.loginContainer.style.display = "none";
    }
    this.loaderStepLabels = this.isEmbedded ? [] : null;

    this.lastUpdatedAt = 0;
    this.renderTicker = null;
    this.questionsUnsubscribe = null;
    this.displaySessionUnsubscribe = null;
    this.displaySessionSubscribedEventId = "";
    this.displayPresenceUnsubscribe = null;
    this.displayPresenceCleanupTimer = 0;
    this.displayPresenceEntries = [];
    this.displayPresenceRefreshedAt = 0;
    this.displayPresenceLastInactiveAt = 0;
    this.displayPresencePrimedForSession = false;
    this.displayPresencePrimedSessionId = "";
    this.displaySessionStatusFromSnapshot = false;
    this.displayAssetProbe = null;
    this.updateTriggerUnsubscribe = null;
    this.renderUnsubscribe = null;
    this.currentRenderPath = null;
    this.logsUpdateTimer = null;
    this.eventsUnsubscribe = null;
    this.schedulesUnsubscribe = null;
    this.dictionaryUnsubscribe = null;
    this.dictionaryData = [];
    this.dictionaryEntries = [];
    this.dictionarySelectedId = "";
    this.dictionarySelectedEntry = null;
    this.dictionaryBatchSelection = new Set();
    this.dictionaryConfirmState = { resolver: null, lastFocused: null };
    this.dictionaryConfirmSetup = false;
    this.dictionaryEditState = { uid: "", originalTerm: "", originalRuby: "", submitting: false, lastFocused: null };
    this.dictionaryEditSetup = false;
    this.dictionaryLoaderSetup = false;
    this.dictionaryLoaderCurrentStep = 0;
    this.dictionaryLoaderCompleted = false;
    this.pickupUnsubscribe = null;
    this.pickupEntries = [];
    this.pickupLoaded = false;
    this.pickupActiveFilter = "all";
    this.pickupAddState = { submitting: false, lastFocused: null };
    this.pickupEditState = { uid: "", submitting: false, lastFocused: null };
    this.pickupConfirmState = { uid: "", submitting: false, lastFocused: null, question: "" };
    this.pickupAddDialogSetup = false;
    this.pickupEditDialogSetup = false;
    this.pickupConfirmDialogSetup = false;
    this.pickupLoaderSetup = false;
    this.pickupLoaderCurrentStep = 0;
    this.pickupLoaderCompleted = false;
    this.sideTelopUnsubscribe = null;
    this.eventsBranch = {};
    this.schedulesBranch = {};
    this.authFlow = "idle";
    this.pendingAuthUser = null;
    this.isAuthorized = false;
    this.dictionaryLoaded = false;
    this.preferredDictionaryOpen = false;
    this.preferredLogsOpen = false;
    this.logsLoaded = false;
    this.logsLoaderSetup = false;
    this.logsLoaderCurrentStep = 0;
    this.logsLoaderCompleted = false;
    this.logsLoaderHasData = false;
    this.logsLoaderMonitorReady = false;
    this.activeDialog = null;
    this.dialogLastFocused = null;
    this.pendingEditUid = null;
    this.pendingEditOriginal = "";
    this.editSubmitting = false;
    this.confirmState = { resolver: null, keydownHandler: null, lastFocused: null, initialized: false };
    this.operatorIdentity = { uid: "", email: "", displayName: "" };
    this.pendingExternalContext = null;
    this.operatorPresenceEntryKey = "";
    this.operatorPresenceEntryRef = null;
    this.operatorPresenceDisconnect = null;
    this.operatorPresenceHeartbeat = null;
    this.presenceSubscribedEventId = "";
    this.operatorPresenceUnsubscribe = null;
    this.operatorPresenceLastSignature = "";
    this.operatorPresenceSessionId = this.presenceManager.generatePresenceSessionId();
    this.operatorPresenceSyncQueued = false;
    this.operatorPresencePrimePromise = null;
    this.operatorPresencePrimedEventId = "";
    this.operatorPresencePrimeRequestId = 0;
    this.operatorPresencePrimeTargetEventId = "";
    this.operatorPresencePurgePromise = null;
    this.operatorPresencePurgeUid = "";
    this.operatorPresencePurgeExclude = "";
    this.operatorPresencePurgeRequestId = 0;
    this.conflictDialogOpen = false;
    this.operatorMode = OPERATOR_MODE_TELOP;
    this.currentConflictSignature = "";
    this.conflictDialogSnoozedSignature = "";
    this.preflightContext = null;
    this.pendingConsensusAdoption = null;
    this.consensusAdoptionScheduled = false;

    this.toast = showToast;
    bindModuleMethods(this);
    if (typeof this.applyInitialPickupState === "function") {
      try {
        this.applyInitialPickupState();
      } catch (error) {
        // Swallow errors from optional pickup panel initialisation.
      }
    }
    if (typeof Dictionary.resetDictionaryLoader === "function") {
      Dictionary.resetDictionaryLoader(this);
    }
    if (typeof Pickup.resetPickupLoader === "function") {
      Pickup.resetPickupLoader(this);
    }
    if (typeof Logs.resetLogsLoader === "function") {
      Logs.resetLogsLoader(this);
    }
    this.redirectingToIndex = false;
    this.embedReadyDeferred = null;
  }

  /**
   * 埋め込みモード時に使用されるURLプレフィックスを取得します。
   * @returns {string}
   */
  static get embedPrefix() {
    if (typeof document === "undefined") {
      return "";
    }
    return document.documentElement?.dataset?.operatorEmbedPrefix || "";
  }

  /**
   * オペレーターpresence用のセッションIDを生成します。
   * @returns {string}
   */
  generatePresenceSessionId() {
    return this.presenceManager.generatePresenceSessionId();
  }

  /**
   * URLクエリや埋め込み設定からイベント/日程情報を解析し、ページコンテキストとして返却します。
   * エラーに強い実装とし、欠落値には空文字を設定します。
   * @returns {{ eventId: string, scheduleId: string, eventName: string, scheduleLabel: string, startAt: string, endAt: string, scheduleKey: string, operatorMode: string }}
   * @deprecated ContextManagerを使用してください
   */
  extractPageContext() {
    return this.contextManager.extractPageContext();
  }

  /**
   * ページ読み込み時に抽出した文脈情報をアプリケーションのstateに反映します。
   */
  applyContextToState() {
    return this.contextManager.applyContextToState();
  }

  /**
   * 画面コンテキストに保持しているイベント/日程選択情報を初期状態へ戻します。
   */
  resetPageContextSelection() {
    return this.contextManager.resetPageContextSelection();
  }

  /**
   * stateとURLから現在操作対象となるイベント/日程を決定します。
   * @returns {{ eventId: string, scheduleId: string }}
   */
  getActiveChannel() {
    return this.channelManager.getActiveChannel();
  }

  /**
   * 現在アクティブなイベントと日程IDを基に正規化されたチャンネルキーを生成します。
   * @returns {string}
   */
  getCurrentScheduleKey() {
    return this.channelManager.getCurrentScheduleKey();
  }

  /**
   * presenceデータから比較・集計に利用する一意のキーを導出します。
   * @param {string} eventId
   * @param {object} payload
   * @param {string} entryId
   * @returns {string}
   */
  derivePresenceScheduleKey(eventId, payload = {}, entryId = "") {
    if (
      this.presenceManager &&
      typeof this.presenceManager.derivePresenceScheduleKey === "function"
    ) {
      return this.presenceManager.derivePresenceScheduleKey(eventId, payload, entryId);
    }

    return sharedDerivePresenceScheduleKey(eventId, payload, entryId);
  }

  /**
   * オペレーターモードがテロップ操作を許可する状態かどうかを判定します。
   * @returns {boolean}
   */
  isTelopEnabled() {
    return isTelopMode(this.operatorMode);
  }

  /**
   * レンダリングチャンネルのリアルタイム更新が有効かどうかを確認します。
   * presenceが有効でもレンダーが切断されている場合はfalseを返します。
   * @returns {boolean}
   */
  isDisplayOnline() {
    const renderOnline = this.state?.renderChannelOnline !== false;
    return !!this.state?.isDisplaySessionActive && renderOnline;
  }

  /**
   * レンダリングチャンネルの到達状況を更新し、UIへ反映します。
   * @param {boolean|null|undefined} status
   */
  updateRenderAvailability(status) {
    return this.uiRenderer.updateRenderAvailability(status);
  }

  /**
   * 送出端末のセッション状態から現在の割当情報を抽出します。
   * @returns {null|{ eventId: string, scheduleId: string, label: string, updatedAt?: number, lockedAt?: number }}
   */
  getDisplayAssignment() {
    return this.channelManager.getDisplayAssignment();
  }

  /**
   * 日程キーから表示用ラベルを決定します。
   * @param {string} scheduleKey
   * @param {string} fallbackLabel
   * @param {string} fallbackScheduleId
   * @returns {string}
   */
  resolveScheduleLabel(scheduleKey, fallbackLabel = "", fallbackScheduleId = "") {
    return this.channelManager.resolveScheduleLabel(scheduleKey, fallbackLabel, fallbackScheduleId);
  }

  /**
   * オペレーター視点での割当状況を判定し、UI表示用の説明文を組み立てます。
   * @returns {string}
   */
  describeChannelAssignment() {
    return this.channelManager.describeChannelAssignment();
  }


  createScheduleDebugSnapshot() {
    const ensureString = (value) => {
      if (typeof value === "string") {
        return value;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
      if (value === null || value === undefined) {
        return "";
      }
      return String(value);
    };
    const transformForLog = (value) => {
      if (value instanceof Map) {
        return Array.from(value.entries()).map(([key, entry]) => ({
          key,
          value: transformForLog(entry)
        }));
      }
      if (Array.isArray(value)) {
        return value.map((item) => transformForLog(item));
      }
      if (value && typeof value === "object") {
        const result = {};
        Object.entries(value).forEach(([entryKey, entryValue]) => {
          if (typeof entryValue === "function") {
            return;
          }
          result[entryKey] = transformForLog(entryValue);
        });
        return result;
      }
      return value;
    };

    const state = this.state || {};
    const activeChannel =
      typeof this.getActiveChannel === "function" ? this.getActiveChannel() : { eventId: "", scheduleId: "" };
    const currentScheduleKey =
      typeof this.getCurrentScheduleKey === "function" ? String(this.getCurrentScheduleKey() || "") : "";
    // activeEventIdが空の場合は、getDisplayAssignment()を呼ばずにnullにする
    // これにより、イベントを選んでいない状態で古いassignmentが評価されることを防ぐ
    const activeEventId = String(state.activeEventId || "").trim();
    const channelAssignment = activeEventId
      ? (state.channelAssignment || this.getDisplayAssignment())
      : null;
    const displaySession = state.displaySession || null;
    const sessionAssignment =
      displaySession && typeof displaySession.assignment === "object" ? displaySession.assignment : null;
    const presenceSelf = state.operatorPresenceSelf || null;

    const scheduleState = {};
    Object.entries(state).forEach(([key, value]) => {
      if (/(event|schedule)/i.test(key) || key === "channelAssignment" || key === "operatorPresenceSelf") {
        scheduleState[key] = transformForLog(value);
      }
    });

    const operatorPresenceEventId = String(state.operatorPresenceEventId || "").trim();
    const presenceSessionId = String(this.operatorPresenceSessionId || "").trim();
    const presenceEntryKey = String(this.operatorPresenceEntryKey || "").trim();
    let derivedPresenceKey = "";
    if (presenceSelf && typeof this.derivePresenceScheduleKey === "function") {
      const presenceEventId = String(
        presenceSelf.eventId || operatorPresenceEventId || activeChannel.eventId || ""
      ).trim();
      const presenceSession = String(presenceSelf.sessionId || presenceSessionId || "").trim();
      derivedPresenceKey = this.derivePresenceScheduleKey(presenceEventId, presenceSelf, presenceSession);
    }

    return {
      activeChannel,
      currentScheduleKey,
      pageContext: this.pageContext
        ? {
            eventId: ensureString(this.pageContext.eventId),
            scheduleId: ensureString(this.pageContext.scheduleId),
            scheduleKey: ensureString(this.pageContext.scheduleKey),
            scheduleLabel: ensureString(this.pageContext.scheduleLabel),
            selectionConfirmed: this.pageContext.selectionConfirmed === true
          }
        : null,
      scheduleState,
      channelAssignment: channelAssignment
        ? {
            eventId: ensureString(channelAssignment.eventId),
            scheduleId: ensureString(channelAssignment.scheduleId),
            scheduleLabel: ensureString(channelAssignment.scheduleLabel),
            scheduleKey: ensureString(channelAssignment.scheduleKey),
            canonicalScheduleId: ensureString(channelAssignment.canonicalScheduleId),
            canonicalScheduleKey: ensureString(channelAssignment.canonicalScheduleKey),
            lockedByUid: ensureString(channelAssignment.lockedByUid),
            lockedByName: ensureString(channelAssignment.lockedByName),
            lockedAt: channelAssignment.lockedAt ?? null,
            updatedAt: channelAssignment.updatedAt ?? null
          }
        : null,
      displaySession: displaySession
        ? {
            eventId: ensureString(displaySession.eventId),
            scheduleId: ensureString(displaySession.scheduleId),
            scheduleLabel: ensureString(displaySession.scheduleLabel),
            scheduleKey: ensureString(displaySession.scheduleKey),
            canonicalScheduleId: ensureString(displaySession.canonicalScheduleId),
            canonicalScheduleKey: ensureString(displaySession.canonicalScheduleKey),
            startAt: ensureString(displaySession.startAt),
            endAt: ensureString(displaySession.endAt),
            updatedAt: displaySession.updatedAt ?? null,
            nowShowing: transformForLog(displaySession.nowShowing),
            assignment: sessionAssignment
              ? {
                  eventId: ensureString(sessionAssignment.eventId),
                  scheduleId: ensureString(sessionAssignment.scheduleId),
                  scheduleLabel: ensureString(sessionAssignment.scheduleLabel),
                  scheduleKey: ensureString(sessionAssignment.scheduleKey),
                  canonicalScheduleId: ensureString(sessionAssignment.canonicalScheduleId),
                  canonicalScheduleKey: ensureString(sessionAssignment.canonicalScheduleKey),
                  lockedByUid: ensureString(sessionAssignment.lockedByUid),
                  lockedByName: ensureString(sessionAssignment.lockedByName),
                  lockedAt: sessionAssignment.lockedAt ?? null,
                  updatedAt: sessionAssignment.updatedAt ?? null
                }
              : null
          }
        : null,
      operatorPresence: {
        eventId: operatorPresenceEventId,
        sessionId: presenceSessionId,
        entryKey: presenceEntryKey,
        derivedKey: derivedPresenceKey,
        self: transformForLog(presenceSelf)
      }
    };
  }

  logScheduleDebug(context, details = {}) {
    if (typeof console === "undefined" || typeof console.log !== "function") {
      return;
    }
    const snapshot = this.createScheduleDebugSnapshot();
    const payload = {
      timestamp: new Date().toISOString(),
      context,
      schedule: snapshot
    };
    if (details && typeof details === "object" && Object.keys(details).length > 0) {
      payload.details = details;
    }
//    console.log("[Operator] schedule-debug", payload);
  }

  /**
   * 表示端末がロックしているチャンネルとオペレーターの選択が矛盾しているか判定します。
   * @returns {boolean}
   */
  hasChannelMismatch() {
    return this.channelManager.hasChannelMismatch();
  }


  /**
   * 現在のチャンネル選択に基づいてリアルタイム購読を再設定します。
   * displayセッションが存在しない場合は安全に購読を解除します。
   */
  refreshChannelSubscriptions() {
    return this.channelManager.refreshChannelSubscriptions();
  }

  /**
   * オペレーターpresenceの監視対象を切り替えます。
   */
  refreshOperatorPresenceSubscription() {
    return this.presenceManager.refreshOperatorPresenceSubscription();
  }


  /**
   * presenceに自身のセッションを登録する準備を行います。
   * @param {string} eventId
   * @returns {Promise<void>}
   */
  primeOperatorPresenceSession(eventId = "") {
    return this.presenceManager.primeOperatorPresenceSession(eventId);
  }

  /**
   * presence一覧から自身に該当するエントリを特定します。
   * @param {string} eventId
   * @param {Map<string, any>} presenceMap
   * @returns {{ payload: any, sessionId: string, duplicates: any[] }|null}
   */
  resolveSelfPresenceEntry(eventId, presenceMap) {
    return this.presenceManager.resolveSelfPresenceEntry(eventId, presenceMap);
  }

  /**
   * 自身のセッションIDが変化した場合にローカル状態を更新し、新しいIDでpresence監視を継続します。
   * @param {string} eventId
   * @param {string} sessionId
   */
  adoptOperatorPresenceSession(eventId, sessionId) {
    return this.presenceManager.adoptOperatorPresenceSession(eventId, sessionId);
  }

  /**
   * 現在のユーザーに紐づく古いpresenceエントリを全イベントから削除します。
   * @param {string} uid
   * @param {{ excludeSessionId?: string }} [options]
   * @returns {Promise<void>}
   */
  purgeOperatorPresenceSessionsForUser(uid = "", options = {}) {
    return this.presenceManager.purgeOperatorPresenceSessionsForUser(uid, options);
  }

  /**
   * presence同期処理を次のマイクロタスクに遅延させ、短時間に複数回呼ばれた場合もまとめて実行します。
   */
  queueOperatorPresenceSync() {
    return this.presenceManager.queueOperatorPresenceSync();
  }

  /**
   * 現在のオペレーター状態をpresenceツリーに反映します。
   * @param {string} reason
   * @param {object} options
   * @returns {Promise<void>}
   */
  syncOperatorPresence(reason = "context-sync", options = {}) {
    return this.presenceManager.syncOperatorPresence(reason, options);
  }


  /**
   * 定期的にpresenceを更新するハートビートタイマーを設定します。
   */
  scheduleOperatorPresenceHeartbeat() {
    return this.presenceManager.scheduleOperatorPresenceHeartbeat();
  }

  /**
   * 現在のpresenceレコードにアクセスし、最終更新時刻をサーバータイムスタンプで更新します。
   * @returns {Promise<void>}
   */
  touchOperatorPresence() {
    return this.presenceManager.touchOperatorPresence();
  }


  /**
   * ハートビートタイマーを解除して、追加のpresence更新を停止します。
   */
  stopOperatorPresenceHeartbeat() {
    return this.presenceManager.stopOperatorPresenceHeartbeat();
  }

  /**
   * presenceから自身のエントリを削除し、ローカルに保持している参照も破棄します。
   * @returns {Promise<void>}
   */
  clearOperatorPresence() {
    return this.presenceManager.clearOperatorPresence();
  }


  /**
   * オペレーターpresenceで使用する日程意図をクリアします。
   */
  clearOperatorPresenceIntent() {
    return this.presenceManager.clearOperatorPresenceIntent();
  }

  /**
   * presenceで公開する日程意図を設定します。
   * @param {string} eventId
   * @param {string} scheduleId
   * @param {string} scheduleLabel
   */
  markOperatorPresenceIntent(eventId, scheduleId, scheduleLabel = "") {
    return this.presenceManager.markOperatorPresenceIntent(eventId, scheduleId, scheduleLabel);
  }

  /**
   * 現在のチャンネル割当状況をヘッダーバナーに描画します。
   * 表示端末との整合性やconflictの有無によって表示を切り替えます。
   */
  /**
   * 日程情報をYYYY.MM/DD形式の文字列にフォーマットします
   * @param {object} assignment - 割り当て情報
   * @param {string} scheduleKey - スケジュールキー
   * @returns {string} フォーマットされた日付文字列
   */
  formatScheduleDateForLog(assignment, scheduleKey) {
    if (!assignment) {
      return "(未設定)";
    }
    const metadataMap = this.state?.scheduleMetadata instanceof Map ? this.state.scheduleMetadata : null;
    let startAt = "";
    if (metadataMap && scheduleKey && metadataMap.has(scheduleKey)) {
      const meta = metadataMap.get(scheduleKey);
      startAt = String(meta?.startAt || "").trim();
    }
    if (!startAt && assignment.startAt) {
      startAt = String(assignment.startAt).trim();
    }
    if (startAt) {
      try {
        const date = new Date(startAt);
        if (!isNaN(date.getTime())) {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          return `${year}.${month}/${day}`;
        }
      } catch (e) {
        // 日付パースに失敗した場合はscheduleLabelを使用
      }
    }
    // 完全正規化: scheduleLabelは参照先から取得（既存データとの互換性のため、assignmentから直接取得をフォールバックとして使用）
      const fallbackScheduleLabel = String(assignment.scheduleLabel || "").trim();
      const scheduleId = String(assignment.scheduleId || "").trim();
      const eventId = String(assignment.eventId || "").trim();
      const derivedScheduleKey = scheduleKey || assignment.scheduleKey || (eventId && scheduleId ? `${eventId}::${scheduleId}` : "");
      const normalizedScheduleKey = String(derivedScheduleKey || "").trim();
      const scheduleLabel = normalizedScheduleKey && typeof this.resolveScheduleLabel === "function"
        ? this.resolveScheduleLabel(normalizedScheduleKey, fallbackScheduleLabel, scheduleId) || fallbackScheduleLabel || scheduleId || "(未設定)"
        : fallbackScheduleLabel || scheduleId || "(未設定)";
    return scheduleLabel;
  }

  renderChannelBanner() {
    return this.uiRenderer.renderChannelBanner();
  }

  /**
   * 現在イベントに参加しているオペレーター一覧を描画します。
   * 自身のpresenceやスキップ設定に応じて補足情報を加えます。
   */
  renderChannelPresenceList() {
    return this.uiRenderer.renderChannelPresenceList();
  }

  /**
   * presence衝突情報を元にダイアログのUIを更新します。
   * 選択肢の表示と操作ボタンの活性状態を整えます。
   */
  renderConflictDialog() {
    return this.uiRenderer.renderConflictDialog();
  }

  /**
   * ダイアログ要素を開き、フォーカスマネジメントを開始します。
   */
  openConflictDialog() {
    if (!this.dom.conflictDialog) {
      return;
    }
    UIHelpers.openDialog(this, this.dom.conflictDialog, this.dom.conflictConfirmButton);
    this.conflictDialogOpen = true;
  }

  /**
   * ダイアログを閉じてフォーカスを元の要素に戻します。
   */
  closeConflictDialog() {
    if (!this.dom.conflictDialog) {
      return;
    }
    if (this.dom.conflictError) {
      this.dom.conflictError.hidden = true;
      this.dom.conflictError.textContent = "";
    }
    UIHelpers.closeDialog(this, this.dom.conflictDialog);
    this.conflictDialogOpen = false;
  }

  /**
   * 利用者が選択したスケジュールで表示端末のロックを試行します。
   * 選択肢が無効な場合は操作をブロックします。
   */
  submitConflictSelection() {
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[submitConflictSelection] Called");
    }
    const conflict = this.state?.scheduleConflict;
    if (!conflict || !Array.isArray(conflict.options) || conflict.options.length === 0) {
      this.closeConflictDialog();
      return;
    }
    const selectedKey = String(this.state.conflictSelection || "").trim();
    const option = conflict.options.find((item) => item.key === selectedKey);
    if (!option) {
      if (this.dom.conflictError) {
        this.dom.conflictError.textContent = "日程を選択してください。";
        this.dom.conflictError.hidden = false;
      }
      return;
    }
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[submitConflictSelection] Calling lockDisplayToSchedule", {
        eventId: option.eventId || conflict.eventId,
        scheduleId: option.scheduleId,
        label: option.label
      });
    }
    this.lockDisplayToSchedule(option.eventId || conflict.eventId, option.scheduleId, option.label, { fromModal: true });
  }

  /**
   * 現在選択中のイベント/日程を送出端末にロックさせます。
   * サイレントモードや自動ロック時の挙動をオプションで制御します。
   * @param {{ silent?: boolean, autoLock?: boolean }} options
   */
  lockDisplayToCurrentSchedule(options = {}) {
    if (!this.isTelopEnabled()) {
      this.toast("テロップ操作なしモードでは固定できません。", "error");
      return;
    }
    const { eventId, scheduleId } = this.getActiveChannel();
    const normalizedEvent = String(eventId || "").trim();
    if (!normalizedEvent) {
      this.toast("イベントが選択されていません。", "error");
      return;
    }
    const scheduleKey = this.getCurrentScheduleKey();
    const label = this.resolveScheduleLabel(scheduleKey, this.state?.activeScheduleLabel, scheduleId);
    return this.lockDisplayToSchedule(eventId, scheduleId, label, options);
  }

  async lockDisplayToSchedule(eventId, scheduleId, scheduleLabel, options = {}) {
    return this.channelManager.lockDisplayToSchedule(eventId, scheduleId, scheduleLabel, options);
  }

  /**
   * displayセッションの割当変更をローカルstateに反映します。
   * レンダリングの更新とpresence評価を適宜行います。
   * @param {object|null} assignment
   */
  applyAssignmentLocally(assignment) {
    return this.channelManager.applyAssignmentLocally(assignment);
  }

  /**
   * 現在のpresence状況から衝突状態を特定するシグネチャを生成します。
   * シグネチャを使って前回の状態との差分を検出します。
   * @param {Array<{ key: string }>} options
   * @returns {string}
   */
  computeConflictSignature(options = []) {
    return this.channelManager.computeConflictSignature(options);
  }

  /**
   * 指定した衝突シグネチャを一時的にスヌーズし、同一状態の再通知を抑制します。
   * @param {string} signature
   */
  snoozeConflictDialog(signature = "") {
    if (!signature) {
      return;
    }
    this.conflictDialogSnoozedSignature = signature;
  }

  /**
   * 衝突状態が既にスヌーズされているか、または再通知不要かを判定します。
   * @param {string} signature
   * @param {Array} options
   * @param {{ uniqueKeys: Set<string>, channelAligned: boolean, assignmentAlignedKey: string }} meta
   * @returns {boolean}
   */
  isConflictDialogSnoozed(signature = "", options = [], { uniqueKeys = new Set(), channelAligned = false, assignmentAlignedKey = "" } = {}) {
    return this.channelManager.isConflictDialogSnoozed(signature, options, { uniqueKeys, channelAligned, assignmentAlignedKey });
  }

  /**
   * 衝突解消後に合意された日程へ自動的に合わせる処理を遅延実行でスケジュールします。
   * evaluateScheduleConflict内で直接stateを書き換えると再帰が発生するため、マイクロタスクで適用します。
   * @param {{ eventId?: string, scheduleId?: string, key?: string, label?: string, startAt?: string, endAt?: string }} option
   * @param {{ reason?: string, presenceOptions?: object, publishPresence?: boolean }} meta
   */
  scheduleConsensusAdoption(option, meta = {}) {
    return this.channelManager.scheduleConsensusAdoption(option, meta);
  }

  /**
   * 合意された日程をローカルstateとpresenceへ反映します。
   * @param {{ eventId?: string, scheduleId?: string, key?: string, label?: string, startAt?: string, endAt?: string }} option
   * @param {{ reason?: string, presenceOptions?: object, publishPresence?: boolean }} meta
   */
  applyConsensusAdoption(option, meta = {}) {
    return this.channelManager.applyConsensusAdoption(option, meta);
  }

  /**
   * presence情報と割当を照合し、衝突ダイアログの表示や自動ロックを制御します。
   */
  evaluateScheduleConflict() {
    return this.channelManager.evaluateScheduleConflict();
  }

  /**
   * 現在開いている任意のダイアログを閉じ、関連する状態をクリアします。
   */
  closeActiveDialog() {
    if (!this.activeDialog) {
      return;
    }
    if (this.activeDialog === this.dom.editDialog) {
      this.closeEditDialog();
      return;
    }
    if (this.activeDialog === this.dom.conflictDialog) {
      this.closeConflictDialog();
      return;
    }
    UIHelpers.closeDialog(this, this.activeDialog);
  }

  /**
   * 埋め込み環境などから渡された外部コンテキストをstateに適用します。
   * 受領直後にpresence同期と表示の更新を実行します。
   * @param {Record<string, any>} context
   */
  setExternalContext(context = {}) {
    return this.contextManager.setExternalContext(context);
  }


  /**
   * 埋め込み利用時に外部ホストが完了通知を送るまで待機します。
   * 通常利用では即座に解決します。
   * @returns {Promise<void>}
   */
  waitUntilReady() {
    return this.contextManager.waitUntilReady();
  }

  /**
   * 埋め込み準備待機に使用しているDeferredを解決します。
   */
  resolveEmbedReady() {
    if (this.embedReadyDeferred?.resolve) {
      this.embedReadyDeferred.resolve();
    }
    this.embedReadyDeferred = null;
  }

  /**
   * アプリケーションの初期化エントリーポイント。
   * 認証状態監視やUI初期化を開始します。
   */
  init() {
    this.setupEventListeners();
    this.applyPreferredSubTab();
    this.updateActionAvailability();
    this.attachRenderMonitor();
    this.applyInitialDictionaryState();
    this.applyInitialLogsState();
    this.updateCopyrightYear();
    this.probeDisplayAssetAvailability().catch(() => {});
    onAuthStateChanged(auth, (user) => {
      if (this.authFlow === "prompting") {
        this.pendingAuthUser = user || null;
        return;
      }
      this.authManager.handleAuthState(user);
    });
  }

  /**
   * display.html の存在可否を確認し、送出機能の利用可否と整合させます。
   * @returns {Promise<boolean>}
   */
  probeDisplayAssetAvailability() {
    if (this.displayAssetProbe) {
      return this.displayAssetProbe;
    }
    const finalize = (available) => {
      const normalized = available === true ? true : available === false ? false : null;
      this.state.displayAssetAvailable = normalized;
      this.state.isDisplayAssetChecked = true;
      this.state.isDisplayAssetChecking = false;
      this.displayAssetProbe = null;
      this.updateActionAvailability();
      this.renderChannelBanner();
      return normalized;
    };
    if (!this.state.isDisplayAssetChecking) {
      this.state.isDisplayAssetChecking = true;
    }
    if (typeof window === "undefined" || typeof fetch !== "function") {
      return Promise.resolve(finalize(true));
    }
    let assetUrl;
    try {
      assetUrl = new URL("display.html", window.location.href);
    } catch (error) {
      return Promise.resolve(finalize(true));
    }
    const fetchWithMethod = async (method) => {
      const response = await fetch(assetUrl.toString(), {
        method,
        cache: "no-store",
        credentials: "same-origin"
      });
      return response;
    };
    const performProbe = async () => {
      try {
        const headResponse = await fetchWithMethod("HEAD");
        if (headResponse.status === 404) {
          return false;
        }
        if (headResponse.ok) {
          return true;
        }
        if (headResponse.status !== 405 && headResponse.status !== 501) {
          return headResponse.ok ? true : null;
        }
      } catch (error) {
        // Fallback to GET probe below.
      }
      try {
        const getResponse = await fetchWithMethod("GET");
        if (getResponse.status === 404) {
          return false;
        }
        if (getResponse.ok) {
          return true;
        }
        return null;
      } catch (error) {
        return null;
      }
    };
    this.displayAssetProbe = performProbe()
      .then((available) => finalize(available))
      .catch(() => finalize(null));
    return this.displayAssetProbe;
  }

  /**
   * DOMイベントのバインディングと画面固有の初期描画をまとめて実行します。
   */
  setupEventListeners() {
    bindDomEvents(this);
    bindActionButtons(this);
    this.bindDatasetButtons(".sub-tab-button", "subTab", (value) => this.switchSubTab(value));
    this.bindDatasetButtons(".genre-tab-button", "genre", (value) => this.switchGenre(value));
    if (this.dom.editDialog) {
      this.dom.editDialog.addEventListener("click", (event) => {
        if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
          event.preventDefault();
          this.closeEditDialog();
        }
      });
    }
    if (this.dom.conflictDialog) {
      this.dom.conflictDialog.addEventListener("click", (event) => {
        if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
          event.preventDefault();
          this.closeConflictDialog();
        }
      });
    }
    if (this.dom.channelLockButton) {
      this.dom.channelLockButton.addEventListener("click", (event) => {
        event.preventDefault();
        this.lockDisplayToCurrentSchedule();
      });
    }
    if (this.dom.conflictForm) {
      this.dom.conflictForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submitConflictSelection();
      });
    }
    if (this.dom.conflictOptions) {
      this.dom.conflictOptions.addEventListener("change", (event) => {
        if (!(event.target instanceof HTMLInputElement) || event.target.type !== "radio") {
          return;
        }
        const nextValue = String(event.target.value || "").trim();
        if (this.state.conflictSelection === nextValue) {
          return;
        }
        this.state.conflictSelection = nextValue;
        if (nextValue) {
          this.state.currentSchedule = nextValue;
          this.state.lastNormalSchedule = nextValue;
          this.updateScheduleContext({ syncPresence: false });
          this.renderQuestions();
        }
      });
    }
    this.dom.cardsContainer?.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.classList.contains("row-checkbox")) {
        this.syncSelectAllState();
        this.updateBatchButtonVisibility();
        this.updateActionAvailability();
      }
    });
    this.setupConfirmDialog();
  }

  /**
   * 指定セレクタで取得したボタン群に対し、dataset属性から値を取り出してコールバックへ渡します。
   * @param {string} selector
   * @param {string} datasetKey
   * @param {(value: string, element: HTMLElement) => void} callback
   */
  bindDatasetButtons(selector, datasetKey, callback) {
    document.querySelectorAll(selector).forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      element.addEventListener("click", () => {
        const value = element.dataset?.[datasetKey];
        callback(value, element);
      });
    });
  }

  /**
   * 直近操作したサブタブ情報をlocalStorageから復元し、UIへ反映します。
   */
  applyPreferredSubTab() {
    const preferredSubTab = Questions.loadPreferredSubTab();
    if (preferredSubTab && preferredSubTab !== this.state.currentSubTab) {
      this.switchSubTab(preferredSubTab);
    } else {
      this.updateScheduleContext({ syncPresence: false });
      this.refreshChannelSubscriptions();
      this.renderQuestions();
    }
  }

  /**
   * 共通確認ダイアログのDOM参照とイベントを初期化します。
   */
  setupConfirmDialog() {
    if (!this.dom.confirmDialog || this.confirmState.initialized) {
      return;
    }
    this.confirmState.initialized = true;
    this.dom.confirmDialog.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
        event.preventDefault();
        this.finishConfirm(false);
      }
    });
    this.dom.confirmCancelButton?.addEventListener("click", (event) => {
      event.preventDefault();
      this.finishConfirm(false);
    });
    this.dom.confirmAcceptButton?.addEventListener("click", (event) => {
      event.preventDefault();
      this.finishConfirm(true);
    });
  }

  /**
   * 確認ダイアログを開き、フォーカスを初期ボタンへ移動します。
   */
  openConfirmDialog() {
    const dialog = this.dom.confirmDialog;
    if (!dialog) return;
    dialog.removeAttribute("hidden");
    document.body.classList.add("modal-open");
    this.confirmState.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.confirmState.keydownHandler = (event) => {
      // 入力欄に入力中はESC以外の単キーボードショートカット（修飾キーを使わないもの、Shiftを使うもの）は反応しないようにする
      const activeElement = document.activeElement;
      const isInputFocused = activeElement && (
        activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.isContentEditable
      );
      
      // ESCキーは常に有効（フルスクリーン解除などで使用されるため）
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.finishConfirm(false);
        return;
      }
      
      // 入力欄にフォーカスがある場合は、単キーボードショートカットを無効化
      if (isInputFocused && !event.ctrlKey && !event.metaKey && !event.altKey) {
        return;
      }
      
      // N で確認ダイアログをキャンセル（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
      if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.finishConfirm(false);
      }
    };
    document.addEventListener("keydown", this.confirmState.keydownHandler, true);
    const focusTarget = this.dom.confirmAcceptButton || dialog.querySelector("button");
    if (focusTarget instanceof HTMLElement) {
      requestAnimationFrame(() => focusTarget.focus());
    }
  }

  /**
   * 確認ダイアログを閉じて結果を呼び出し元へ返します。
   * @param {boolean} result
   */
  finishConfirm(result) {
    const dialog = this.dom.confirmDialog;
    if (!dialog) return;
    if (!dialog.hasAttribute("hidden")) {
      dialog.setAttribute("hidden", "");
    }
    document.body.classList.remove("modal-open");
    if (this.confirmState.keydownHandler) {
      document.removeEventListener("keydown", this.confirmState.keydownHandler, true);
      this.confirmState.keydownHandler = null;
    }
    const resolver = this.confirmState.resolver;
    this.confirmState.resolver = null;
    const toFocus = this.confirmState.lastFocused;
    this.confirmState.lastFocused = null;
    if (toFocus && typeof toFocus.focus === "function") {
      requestAnimationFrame(() => toFocus.focus());
    }
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  async confirmAction({
    title = "確認",
    description = "",
    confirmLabel = "実行する",
    cancelLabel = "キャンセル",
    tone = "danger"
  } = {}) {
    if (!this.dom.confirmDialog) {
      return false;
    }
    this.setupConfirmDialog();
    if (this.confirmState.resolver) {
      this.finishConfirm(false);
    }
    if (this.dom.confirmTitle) {
      this.dom.confirmTitle.textContent = title || "確認";
    }
    if (this.dom.confirmMessage) {
      this.dom.confirmMessage.textContent = description || "";
    }
    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.textContent = confirmLabel || "実行する";
      this.dom.confirmAcceptButton.classList.remove("btn-danger", "btn-primary");
      this.dom.confirmAcceptButton.classList.add(tone === "danger" ? "btn-danger" : "btn-primary");
    }
    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.textContent = cancelLabel || "キャンセル";
    }
    this.openConfirmDialog();
    return await new Promise((resolve) => {
      this.confirmState.resolver = resolve;
    });
  }

  /**
   * テロップ送出状態のFirebaseノードを監視し、UI更新に必要なハンドラを登録します。
   */
  attachRenderMonitor() {
    this.currentRenderPath = null;
    this.refreshChannelSubscriptions();
  }

  async login() {
    return this.authManager.login();
  }

  async logout() {
    return this.authManager.logout();
  }

  loadPreflightContextForUser(user) {
    return this.authManager.loadPreflightContextForUser(user);
  }

  async handleAuthState(user) {
    return this.authManager.handleAuthState(user);
  }

  async renderLoggedInUi(user) {
    return this.authManager.renderLoggedInUi(user);
  }

  showLoggedOutState() {
    return this.authManager.showLoggedOutState();
  }



  /**
   * すべてのリアルタイム購読とpresence関連のリソースを破棄します。
   */
  cleanupRealtime() {
    this.clearOperatorPresence();
    this.closeConflictDialog();
    if (this.questionsUnsubscribe) {
      this.questionsUnsubscribe();
      this.questionsUnsubscribe = null;
    }
    if (this.displaySessionUnsubscribe) {
      this.displaySessionUnsubscribe();
      this.displaySessionUnsubscribe = null;
    }
    if (this.displayPresenceUnsubscribe) {
      this.displayPresenceUnsubscribe();
      this.displayPresenceUnsubscribe = null;
    }
    if (this.displayPresenceCleanupTimer) {
      clearTimeout(this.displayPresenceCleanupTimer);
      this.displayPresenceCleanupTimer = 0;
    }
    this.displayPresenceEntries = [];
    this.displayPresenceRefreshedAt = 0;
    this.displayPresenceLastInactiveAt = 0;
    this.displayPresencePrimedForSession = false;
    this.displayPresencePrimedSessionId = "";
    if (this.questionStatusUnsubscribe) {
      this.questionStatusUnsubscribe();
      this.questionStatusUnsubscribe = null;
    }
    if (this.updateTriggerUnsubscribe) {
      this.updateTriggerUnsubscribe();
      this.updateTriggerUnsubscribe = null;
    }
    if (this.eventsUnsubscribe) {
      this.eventsUnsubscribe();
      this.eventsUnsubscribe = null;
    }
    if (this.schedulesUnsubscribe) {
      this.schedulesUnsubscribe();
      this.schedulesUnsubscribe = null;
    }
    if (this.tokensUnsubscribe) {
      this.tokensUnsubscribe();
      this.tokensUnsubscribe = null;
    }
    if (typeof this.stopDictionaryListener === "function") {
      this.stopDictionaryListener();
    }
    if (typeof this.stopPickupListener === "function") {
      this.stopPickupListener();
    }
    if (typeof this.stopSideTelopListener === "function") {
      this.stopSideTelopListener();
    }
    if (this.renderTicker) {
      clearInterval(this.renderTicker);
      this.renderTicker = null;
    }
    if (this.logsUpdateTimer) {
      clearTimeout(this.logsUpdateTimer);
      this.logsUpdateTimer = null;
    }
    if (this.operatorPresenceUnsubscribe) {
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    this.presenceSubscribedEventId = "";
    this.state.operatorPresenceEventId = "";
    this.state.operatorPresenceByUser = new Map();
    this.state.operatorPresenceSelf = null;
    this.state.channelAssignment = null;
    this.state.isChannelLocking = false;
    this.state.scheduleConflict = null;
    this.state.conflictSelection = "";
    this.conflictDialogOpen = false;
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    this.operatorMode = OPERATOR_MODE_TELOP;
    this.resetPageContextSelection();
    if (this.pageContext && typeof this.pageContext === "object") {
      this.pageContext.operatorMode = OPERATOR_MODE_TELOP;
    }
    this.applyContextToState();
    if (this.dom.selectAllCheckbox) {
      this.dom.selectAllCheckbox.checked = false;
      this.dom.selectAllCheckbox.indeterminate = false;
    }
    document.querySelectorAll(".genre-tab-button").forEach((button, index) => {
      const isDefault = index === 0;
      button.classList.toggle("active", isDefault);
      button.setAttribute("aria-selected", String(isDefault));
    });
    document.querySelectorAll(".sub-tab-button").forEach((button) => {
      const isDefault = button.dataset.subTab === "all";
      button.classList.toggle("active", isDefault);
      button.setAttribute("aria-selected", String(isDefault));
    });
    if (this.dom.scheduleTimeRange) {
      this.dom.scheduleTimeRange.textContent = "";
      this.dom.scheduleTimeRange.hidden = true;
    }
    this.updateActionAvailability();
    this.updateBatchButtonVisibility();
    // Vueコンポーネントが有効な場合は、innerHTMLをクリアしない（Vueの仮想DOMと不整合になるため）
    if (this.dom.cardsContainer && !window.__vueExperimentEnabled) {
      this.dom.cardsContainer.innerHTML = "";
    }
    if (this.dom.logStream) this.dom.logStream.innerHTML = "";
    if (this.dom.dictionaryCardsContainer) this.dom.dictionaryCardsContainer.innerHTML = "";
    if (this.dom.pickupList) this.dom.pickupList.innerHTML = "";
    this.renderChannelBanner();
    this.eventsBranch = {};
    this.schedulesBranch = {};
    this.dictionaryData = [];
    this.dictionaryEntries = [];
    this.dictionarySelectedId = "";
    this.dictionarySelectedEntry = null;
    if (this.dictionaryBatchSelection instanceof Set) {
      this.dictionaryBatchSelection.clear();
    } else {
      this.dictionaryBatchSelection = new Set();
    }
    if (this.dom.dictionarySelectAllCheckbox instanceof HTMLInputElement) {
      this.dom.dictionarySelectAllCheckbox.checked = false;
      this.dom.dictionarySelectAllCheckbox.indeterminate = false;
      this.dom.dictionarySelectAllCheckbox.disabled = true;
    }
    if (this.dom.dictionarySelectedInfo) {
      this.dom.dictionarySelectedInfo.textContent = "単語を選択してください";
    }
    if (this.dom.dictionaryActionPanel) {
      this.dom.dictionaryActionPanel.hidden = false;
      this.dom.dictionaryActionPanel.classList.add("is-idle");
    }
    if (this.dom.dictionaryCount) {
      this.dom.dictionaryCount.textContent = "登録なし";
    }
    this.dictionaryLoaded = false;
    this.pickupEntries = [];
    this.pickupLoaded = false;
    this.pickupActiveFilter = "all";
    if (this.dom.pickupEmpty) {
      this.dom.pickupEmpty.hidden = false;
    }
    if (this.dom.pickupAlert) {
      this.dom.pickupAlert.hidden = true;
      this.dom.pickupAlert.textContent = "";
    }
    if (typeof this.applyInitialPickupState === "function") {
      try {
        this.applyInitialPickupState();
      } catch (error) {
        // Ignore pickup reset issues while clearing operator state.
      }
    }
    this.dictionaryLoaderCurrentStep = 0;
    this.dictionaryLoaderCompleted = false;
    this.pickupLoaderCurrentStep = 0;
    this.pickupLoaderCompleted = false;
    this.logsLoaded = false;
    this.logsLoaderHasData = false;
    this.logsLoaderMonitorReady = false;
    this.logsLoaderCompleted = false;
    if (typeof Dictionary.resetDictionaryLoader === "function") {
      Dictionary.resetDictionaryLoader(this);
    }
    if (typeof Pickup.resetPickupLoader === "function") {
      Pickup.resetPickupLoader(this);
    }
    if (typeof Logs.resetLogsLoader === "function") {
      Logs.resetLogsLoader(this);
    }
    this.updateScheduleContext({ syncPresence: false });
  }

  /**
   * 質問一覧のリアルタイム購読を開始します。
   */
  startQuestionsStream() {
    if (this.questionsUnsubscribe) this.questionsUnsubscribe();
    this.questionsUnsubscribe = onValue(questionsRef, (snapshot) => {
      this.applyQuestionsBranch(snapshot.val());
    });
  }

  /**
   * 全ての日程の全てのPUQのquestionStatusを初期化します。
   * 日程選択時に一度だけ実行されます。
   */
  async initializePickupQuestionStatuses() {
    const eventId = String(this.state?.activeEventId || "").trim();
    if (!eventId) {
      return;
    }

    try {
      // 全てのPUQを取得
      const pickupSnapshot = await get(pickupQuestionsRef);
      const pickupQuestions = pickupSnapshot.val() || {};
      if (Object.keys(pickupQuestions).length === 0) {
        return;
      }

      // 全ての日程を取得
      const schedulesRef = ref(database, `questionIntake/schedules/${eventId}`);
      const schedulesSnapshot = await get(schedulesRef);
      const schedules = schedulesSnapshot.val() || {};
      if (Object.keys(schedules).length === 0) {
        return;
      }

      const now = Date.now();
      const updates = {};
      const normalizedEventId = normalizeEventId(eventId);

      // 既存のquestionStatusを取得して、存在しないもののみ初期化
      const eventStatusRef = ref(database, `questionStatus/${normalizedEventId}`);
      const eventStatusSnapshot = await get(eventStatusRef);
      const existingStatuses = eventStatusSnapshot.val() || {};

      // 各日程×各PUQの組み合わせで初期化
      Object.keys(schedules).forEach((scheduleId) => {
        const normalizedScheduleId = normalizeScheduleId(scheduleId);
        Object.keys(pickupQuestions).forEach((uid) => {
          const statusPath = getQuestionStatusPath(normalizedEventId, true, normalizedScheduleId);
          const statusKey = `${statusPath}/${uid}`;
          // 既存のstatusが存在するか確認（存在しない場合のみ初期化）
          const existingScheduleStatus = existingStatuses[normalizedScheduleId];
          const existingUidStatus = existingScheduleStatus && existingScheduleStatus[uid];
          if (!existingUidStatus) {
            // 既存のstatusが存在しない場合のみ初期化
            updates[statusKey] = {
              answered: false,
              selecting: false,
              pickup: true,
              updatedAt: now
            };
          }
        });
      });

      if (Object.keys(updates).length > 0) {
        await update(ref(database), updates);
        console.log(`[initializePickupQuestionStatuses] Initialized ${Object.keys(updates).length} pickup question statuses for ${Object.keys(schedules).length} schedules`);
      }
    } catch (error) {
      console.error("[initializePickupQuestionStatuses] Failed to initialize pickup question statuses:", error);
      // エラーが発生しても処理を続行（初期化は非同期で実行されるため）
    }
  }

  /**
   * 質問状態ノードの購読を開始し、ステータスの変化を反映します。
   * 現在のイベントIDのquestionStatusを監視します（通常質問もPick Up Questionも同じパス）。
   */
  startQuestionStatusStream() {
    if (this.questionStatusUnsubscribe) this.questionStatusUnsubscribe();
    const eventId = String(this.state?.activeEventId || "").trim();
    if (!eventId) {
      console.debug("startQuestionStatusStream: activeEventId is empty; skipping subscription.");
      this.questionStatusUnsubscribe = null;
      return;
    }

    // 日程選択時に全ての日程の全てのPUQを初期化（非同期で実行）
    this.initializePickupQuestionStatuses().catch((error) => {
      console.error("[startQuestionStatusStream] Failed to initialize pickup question statuses:", error);
    });

    const { scheduleId = "" } = this.getActiveChannel() || {};
    const normalizedScheduleId = scheduleId ? normalizeScheduleId(scheduleId) : "";

    // 通常質問とPick Up Questionは、全てスケジュールごとに分かれたパスで管理される
    // 通常質問: questionStatus/${eventId}/${scheduleId}
    // Pick Up Question: questionStatus/${eventId}/${scheduleId}
    // 全てのスケジュールのquestionStatusを監視するため、questionStatus/${eventId}を監視し、
    // その配下の各スケジュールノードから通常質問とPUQを抽出する
    const eventStatusRef = ref(database, `questionStatus/${normalizeEventId(eventId)}`);

    // イベント全体のquestionStatusを監視（全てのスケジュールを含む）
    const eventUnsubscribe = onValue(eventStatusRef, (snapshot) => {
      const value = snapshot.val() || {};
      const allStatus = {};
      const questionsByUid = this.state.questionsByUid instanceof Map ? this.state.questionsByUid : new Map();
      
      // 各スケジュールノードを走査
      Object.entries(value).forEach(([scheduleKey, scheduleStatus]) => {
        if (!scheduleStatus || typeof scheduleStatus !== "object") {
          return;
        }
        // スケジュールノード配下の各UIDを処理
        Object.entries(scheduleStatus).forEach(([uidKey, status]) => {
          if (!status || typeof status !== "object") {
            return;
          }
          // 通常質問とPUQの両方を処理
          if (status.answered !== undefined || status.selecting !== undefined) {
            allStatus[uidKey] = status;
          }
        });
      });
      
      // 全てのstatusを適用
      this.applyQuestionStatusSnapshot(allStatus);
    });

    this.questionStatusUnsubscribe = () => {
      eventUnsubscribe();
    };
  }

  /**
   * Firebaseから取得した質問データをMap構造へ変換し、ローカルstateに取り込みます。
   * @param {Record<string, any>} value
   */
  applyQuestionsBranch(value) {
    const branch = value && typeof value === "object" ? value : {};
    const next = new Map();

    const mergeRecord = (uidKey, record, type) => {
      if (!record || typeof record !== "object") {
        return;
      }
      const resolvedUid = String(record.uid ?? uidKey ?? "").trim();
      if (!resolvedUid) {
        return;
      }
      const normalized = { ...record, uid: resolvedUid };
      if (type) {
        normalized.type = type;
      }
      if (type === "pickup" && normalized.pickup !== true) {
        normalized.pickup = true;
      }
      next.set(resolvedUid, normalized);
    };

    if (branch && (branch.normal || branch.pickup)) {
      const normal = branch.normal && typeof branch.normal === "object" ? branch.normal : {};
      const pickup = branch.pickup && typeof branch.pickup === "object" ? branch.pickup : {};
      Object.entries(normal).forEach(([uid, record]) => mergeRecord(uid, record, "normal"));
      Object.entries(pickup).forEach(([uid, record]) => mergeRecord(uid, record, "pickup"));
    } else {
      Object.entries(branch).forEach(([uid, record]) => mergeRecord(uid, record, record?.type));
    }

    this.state.questionsByUid = next;
    this.rebuildQuestions();
  }

  /**
   * 質問のステータス情報をMapへ変換し、既存リストにマージします。
   * 通常質問とpickupquestionの両方のリスナーから呼び出される可能性があるため、
   * 既存のquestionStatusByUidとマージする。
   * @param {Record<string, any>} value
   */
  applyQuestionStatusSnapshot(value) {
    const branch = value && typeof value === "object" ? value : {};
    // 既存のquestionStatusByUidを取得（マージするため）
    const current = this.state.questionStatusByUid instanceof Map ? this.state.questionStatusByUid : new Map();
    Object.entries(branch).forEach(([uidKey, record]) => {
      if (!record || typeof record !== "object") {
        return;
      }
      const resolvedUid = String(record.uid ?? uidKey ?? "").trim();
      if (!resolvedUid) {
        return;
      }
      // 既存のstatusを更新または追加
      current.set(resolvedUid, {
        answered: record.answered === true,
        selecting: record.selecting === true,
        pickup: record.pickup === true,
        updatedAt: Number(record.updatedAt || 0)
      });
    });
    this.state.questionStatusByUid = current;
    this.rebuildQuestions();
  }

  /**
   * 生の質問データをUI表示用に整形します。
   * @param {Record<string, any>} item
   * @returns {import("./questions.js").QuestionRecord}
   */
  normalizeQuestionRecord(item) {
    const record = item && typeof item === "object" ? item : {};
    // tokenから取得できる情報は削除されているため、scheduleMetadataやeventsByIdから取得
    const rawScheduleKey = String(record.scheduleKey ?? "").trim();
    const scheduleMap = this.state.scheduleMetadata instanceof Map ? this.state.scheduleMetadata : null;
    const eventsMap = this.state.eventsById instanceof Map ? this.state.eventsById : null;
    const tokensMap = this.state.tokensByToken instanceof Map ? this.state.tokensByToken : null;
    
    // tokenからscheduleKeyを解決
    let eventId = "";
    let rawScheduleId = "";
    let scheduleKey = rawScheduleKey;
    let scheduleMeta = null;
    
    // tokenからscheduleKeyを取得
    if (!scheduleKey) {
      const token = String(record.token ?? "").trim();
      if (token && tokensMap) {
        const tokenInfo = tokensMap.get(token);
        if (tokenInfo) {
          scheduleKey = tokenInfo.scheduleKey || "";
          eventId = tokenInfo.eventId || "";
          rawScheduleId = tokenInfo.scheduleId || "";
        }
      }
    }
    
    // scheduleKeyから情報を取得
    if (scheduleKey && scheduleMap) {
      scheduleMeta = scheduleMap.get(scheduleKey);
      if (scheduleMeta) {
        eventId = String(scheduleMeta.eventId || "").trim();
        rawScheduleId = String(scheduleMeta.scheduleId || "").trim();
      }
    }
    
    // scheduleKeyがなければ空文字列として扱う
    const normalizedScheduleId = eventId ? normalizeScheduleId(rawScheduleId) : rawScheduleId;
    const metaLabel = scheduleMeta ? String(scheduleMeta.label || "").trim() : "";
    const metaEventName = scheduleMeta ? String(scheduleMeta.eventName || "").trim() : "";
    const metaStart = scheduleMeta ? String(scheduleMeta.startAt || "").trim() : "";
    const metaEnd = scheduleMeta ? String(scheduleMeta.endAt || "").trim() : "";
    const eventNameFromMap = eventId && eventsMap ? String(eventsMap.get(eventId)?.name || "").trim() : "";
    const label = metaLabel || "";
    const eventName = metaEventName || eventNameFromMap || "";
    const startAt = metaStart;
    const endAt = metaEnd;

    return {
      UID: record.uid,
      班番号: "", // groupは削除されているため空文字列
      ラジオネーム: record.name,
      "質問・お悩み": record.question,
      ジャンル: resolveGenreLabel(record.genre),
      イベントID: eventId,
      イベント名: eventName,
      日程ID: rawScheduleId || (eventId ? normalizedScheduleId : ""),
      日程: scheduleKey || label,
      日程表示: label,
      開始日時: startAt,
      終了日時: endAt,
      参加者ID: "", // participantIdは削除されているため空文字列
      回答済: !!record.answered,
      選択中: !!record.selecting,
      ピックアップ: !!record.pickup,
      __ts: Number(record.ts || 0),
      __scheduleKey: scheduleKey || "",
      __scheduleLabel: label,
      __scheduleStart: startAt,
      __scheduleEnd: endAt
    };
  }

  /**
   * 質問とステータスのMapから一覧配列を再構築し、派生状態を更新します。
   */
  rebuildQuestions() {
    const questionMap = this.state.questionsByUid instanceof Map ? this.state.questionsByUid : new Map();
    const statusMap = this.state.questionStatusByUid instanceof Map ? this.state.questionStatusByUid : new Map();
    const list = [];
    questionMap.forEach((record, uid) => {
      const status = statusMap.get(uid) || {};
      list.push(this.normalizeQuestionRecord({ ...record, ...status, uid }));
    });
    this.state.allQuestions = list;
    this.updateScheduleContext({ syncPresence: false });
    this.refreshChannelSubscriptions();
    this.renderQuestions();
  }

  /**
   * イベントおよび日程のメタデータをMapに整理し、派生する表示情報を更新します。
   */
  rebuildScheduleMetadata() {
    const eventsValue = this.eventsBranch && typeof this.eventsBranch === "object" ? this.eventsBranch : {};
    const schedulesValue = this.schedulesBranch && typeof this.schedulesBranch === "object" ? this.schedulesBranch : {};
    const eventsMap = new Map();
    Object.entries(eventsValue).forEach(([eventId, eventValue]) => {
      const id = String(eventId);
      eventsMap.set(id, {
        id,
        name: String(eventValue?.name || "").trim(),
        raw: eventValue
      });
    });
    const scheduleMap = new Map();
    Object.entries(schedulesValue).forEach(([eventId, scheduleBranch]) => {
      if (!scheduleBranch || typeof scheduleBranch !== "object") return;
      const eventKey = String(eventId);
      const eventName = String(eventsMap.get(eventKey)?.name || "").trim();
      Object.entries(scheduleBranch).forEach(([scheduleId, scheduleValue]) => {
        const scheduleKey = `${eventKey}::${String(scheduleId)}`;
        const labelValue = String(scheduleValue?.label || "").trim();
        const dateValue = String(scheduleValue?.date || "").trim();
        const startValue = String(scheduleValue?.startAt || "").trim();
        const endValue = String(scheduleValue?.endAt || "").trim();
        scheduleMap.set(scheduleKey, {
          key: scheduleKey,
          eventId: eventKey,
          scheduleId: String(scheduleId),
          eventName,
          label: labelValue || dateValue || String(scheduleId),
          date: dateValue,
          startAt: startValue,
          endAt: endValue,
          raw: scheduleValue
        });
      });
    });
    this.state.eventsById = eventsMap;
    this.state.scheduleMetadata = scheduleMap;
    this.rebuildQuestions();
    this.renderChannelBanner();
    this.evaluateScheduleConflict();
  }

  /**
   * イベントと日程のメタデータに対するリアルタイム購読を開始します。
   */
  startScheduleMetadataStreams() {
    if (this.eventsUnsubscribe) this.eventsUnsubscribe();
    this.eventsUnsubscribe = onValue(questionIntakeEventsRef, (snapshot) => {
      this.eventsBranch = snapshot.val() || {};
      this.rebuildScheduleMetadata();
    });
    if (this.schedulesUnsubscribe) this.schedulesUnsubscribe();
    this.schedulesUnsubscribe = onValue(questionIntakeSchedulesRef, (snapshot) => {
      this.schedulesBranch = snapshot.val() || {};
      this.rebuildScheduleMetadata();
    });
    if (this.tokensUnsubscribe) this.tokensUnsubscribe();
    this.tokensUnsubscribe = onValue(questionIntakeTokensRef, (snapshot) => {
      const tokensValue = snapshot.val() || {};
      const tokensMap = new Map();
      Object.entries(tokensValue).forEach(([token, tokenRecord]) => {
        if (tokenRecord && typeof tokenRecord === "object") {
          const eventId = String(tokenRecord.eventId || "").trim();
          const scheduleId = String(tokenRecord.scheduleId || "").trim();
          if (eventId && scheduleId) {
            const normalizedScheduleId = normalizeScheduleId(scheduleId);
            const scheduleKey = `${eventId}::${normalizedScheduleId}`;
            tokensMap.set(token, {
              eventId,
              scheduleId: normalizedScheduleId,
              scheduleKey
            });
          }
        }
      });
      this.state.tokensByToken = tokensMap;
      this.rebuildQuestions();
    });
  }

  /**
   * 送出端末とのセッション情報を監視し、リンク状態の変化をUIへ反映します。
   */
  startDisplaySessionMonitor() {
    if (this.displaySessionUnsubscribe) this.displaySessionUnsubscribe();
    // 選択中のイベントに対応するセッションを監視（複数display.htmlの同時表示に対応）
    const activeEventId = String(this.state?.activeEventId || "").trim();
    if (!activeEventId) {
      // eventIdが必須のため、空の場合は監視しない
      this.displaySessionUnsubscribe = null;
      this.state.displaySession = null;
      this.state.displaySessions = [];
      this.displaySessionStatusFromSnapshot = false;
      return;
    }
    const sessionsPath = `render/events/${activeEventId}/sessions`;
    const sessionsRef = ref(database, sessionsPath);
    this.displaySessionUnsubscribe = onValue(
      sessionsRef,
      (snapshot) => {
        const raw = snapshot.val() || null;
        const now = Date.now();
        const activeEventId = String(this.state?.activeEventId || "").trim();
        
        // 複数のdisplay.htmlが同じeventIdで同時に表示できるように、全てのセッションを処理
        let activeSessions = [];
        let hasActiveSession = false;
        let representativeSession = null;
        let representativeAssignment = null;

        if (raw && typeof raw === "object") {
          // オブジェクトの場合（sessions/{uid}形式）
          Object.entries(raw).forEach(([uid, data]) => {
            if (!data || typeof data !== "object") return;
            const expiresAt = Number(data.expiresAt || 0);
            const status = String((data.status || "")).trim();
            const isActive = status === "active" && expiresAt > now;
            if (isActive) {
              hasActiveSession = true;
              activeSessions.push({ uid, session: data });
              
              // assignmentが存在するセッションを優先的に代表として使用
              const sessionAssignment = data.assignment && typeof data.assignment === "object" ? data.assignment : null;
              const sessionEventId = String(data.eventId || "").trim();
              const sessionScheduleId = String(data.scheduleId || "").trim();
              const hasAssignment = !!sessionAssignment;
              const hasEventAndSchedule = !!sessionEventId && !!sessionScheduleId;
              
              // まだ代表セッションが選ばれていない場合、または現在の代表セッションにassignmentがなく、このセッションにassignmentがある場合
              if (!representativeSession || (!representativeAssignment && hasAssignment)) {
                representativeSession = data;
                representativeAssignment = sessionAssignment;
                
                // assignmentが存在しないが、eventIdとscheduleIdがある場合は、それらからassignmentを構築
                if (!representativeAssignment && hasEventAndSchedule) {
                  const scheduleLabel = String(data.scheduleLabel || "").trim() || sessionScheduleId;
                  const normalizedScheduleId = normalizeScheduleId(sessionScheduleId);
                  representativeAssignment = {
                    eventId: sessionEventId,
                    scheduleId: normalizedScheduleId,
                    scheduleLabel: scheduleLabel,
                    scheduleKey: `${sessionEventId}::${normalizedScheduleId}`,
                    canonicalScheduleId: normalizedScheduleId,
                    canonicalScheduleKey: `${sessionEventId}::${normalizedScheduleId}`
                  };
                }
              }
            }
          });
        }

        // representativeSessionにassignmentを設定（getDisplayAssignment()で参照されるため）
        if (representativeSession && representativeAssignment) {
          representativeSession.assignment = representativeAssignment;
        }

        this.state.displaySession = representativeSession;
        this.state.displaySessions = activeSessions.map(({ session }) => session); // 全有効セッションを保存
        this.displaySessionStatusFromSnapshot = hasActiveSession;
        this.evaluateDisplaySessionActivity("session-snapshot");
        
        // デバッグログ: セッション情報を確認
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[Operator] Display session monitor snapshot", {
            activeEventId,
            hasActiveSession,
            activeSessionsCount: activeSessions.length,
            hasRepresentativeSession: !!representativeSession,
            hasRepresentativeAssignment: !!representativeAssignment,
            representativeSessionEventId: representativeSession ? String(representativeSession.eventId || "").trim() : null,
            representativeSessionScheduleId: representativeSession ? String(representativeSession.scheduleId || "").trim() : null,
            representativeAssignmentEventId: representativeAssignment ? String(representativeAssignment.eventId || "").trim() : null,
            representativeAssignmentScheduleId: representativeAssignment ? String(representativeAssignment.scheduleId || "").trim() : null,
            representativeAssignmentScheduleLabel: representativeAssignment ? String(representativeAssignment.scheduleLabel || "").trim() : null
          });
        }
        
        // 現在選択中のイベントと一致する場合のみchannelAssignmentを設定
        // イベントが選択されていない場合、または別のイベントの場合はnullに設定
        if (!activeEventId) {
          // イベントが選択されていない場合は、channelAssignmentをnullに設定
          this.state.channelAssignment = null;
        } else {
          if (representativeAssignment) {
            const assignmentEventId = String(representativeAssignment.eventId || "").trim();
            this.state.channelAssignment = assignmentEventId === activeEventId ? representativeAssignment : null;
            
            // デバッグログ: channelAssignment設定
            if (typeof console !== "undefined" && typeof console.log === "function") {
              console.log("[Operator] Setting channelAssignment from representativeAssignment", {
                assignmentEventId,
                activeEventId,
                matches: assignmentEventId === activeEventId,
                channelAssignment: this.state.channelAssignment ? {
                  eventId: this.state.channelAssignment.eventId,
                  scheduleId: this.state.channelAssignment.scheduleId,
                  scheduleLabel: this.state.channelAssignment.scheduleLabel
                } : null
              });
            }
          } else {
            const rawAssignment = this.getDisplayAssignment();
            if (rawAssignment && activeEventId) {
              const assignmentEventId = String(rawAssignment.eventId || "").trim();
              this.state.channelAssignment = assignmentEventId === activeEventId ? rawAssignment : null;
              
              // デバッグログ: channelAssignment設定（フォールバック）
              if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log("[Operator] Setting channelAssignment from getDisplayAssignment (fallback)", {
                  assignmentEventId,
                  activeEventId,
                  matches: assignmentEventId === activeEventId,
                  channelAssignment: this.state.channelAssignment ? {
                    eventId: this.state.channelAssignment.eventId,
                    scheduleId: this.state.channelAssignment.scheduleId,
                    scheduleLabel: this.state.channelAssignment.scheduleLabel
                  } : null
                });
              }
            } else {
              this.state.channelAssignment = null;
              
              // デバッグログ: channelAssignmentがnullに設定された
              if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log("[Operator] channelAssignment set to null", {
                  hasRawAssignment: !!rawAssignment,
                  activeEventId,
                  representativeSession: representativeSession ? {
                    eventId: representativeSession.eventId,
                    scheduleId: representativeSession.scheduleId,
                    hasAssignment: !!representativeSession.assignment
                  } : null
                });
              }
            }
          }
        }
        this.updateScheduleContext({ presenceOptions: { allowFallback: false }, trackIntent: false });
        this.updateActionAvailability();
        this.updateBatchButtonVisibility();
        this.renderQuestions();
        this.renderChannelBanner();
        this.evaluateScheduleConflict();
      },
      (error) => {
        logDisplayLinkError("Display session monitor error", error);
      }
    );
  }

  /**
   * 送出端末からのpresenceハートビートを監視し、必要に応じてセッションの生存期間を更新します。
   */
  startDisplayPresenceMonitor() {
    if (this.displayPresenceUnsubscribe) this.displayPresenceUnsubscribe();
    this.displayPresenceUnsubscribe = onValue(
      displayPresenceRootRef,
      (snapshot) => {
        const raw = snapshot.val() || {};
        this.displayPresenceEntries = this.normalizeDisplayPresenceEntries(raw);
        this.state.displayPresenceEntries = this.displayPresenceEntries;
        this.evaluateDisplaySessionActivity("presence-update");
        this.performDisplayPresenceCleanup({ scheduleNext: false, reason: "presence-snapshot" });
        this.scheduleDisplayPresenceCleanup();
      },
      (error) => {
        logDisplayLinkError("Display presence monitor error", error);
      }
    );
    this.scheduleDisplayPresenceCleanup();
  }

  /**
   * presenceノードを配列形式に正規化し、更新時刻でソートした結果を返します。
   * @param {Record<string, any>} raw
   * @returns {Array<object>}
   */
  normalizeDisplayPresenceEntries(raw) {
    const now = Date.now();
    const entries = [];
    if (!raw || typeof raw !== "object") {
      return entries;
    }
    Object.entries(raw).forEach(([uid, payload]) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const sessionId = String(payload.sessionId || "").trim();
      const normalizedUid = String(uid || "").trim();
      if (!sessionId || !normalizedUid) {
        return;
      }
      const entry = {
        uid: normalizedUid,
        sessionId,
        eventId: String(payload.eventId || "").trim(),
        scheduleId: normalizeScheduleId(payload.scheduleId || ""),
        channelEventId: String(payload.channelEventId || "").trim(),
        channelScheduleId: normalizeScheduleId(payload.channelScheduleId || ""),
        assignmentEventId: String(payload.assignmentEventId || "").trim(),
        assignmentScheduleId: normalizeScheduleId(payload.assignmentScheduleId || ""),
        status: String(payload.status || "").trim(),
        reason: String(payload.reason || "").trim(),
        updatedBy: String(payload.updatedBy || "").trim(),
        version: String(payload.version || "").trim(),
        clientTimestamp: Number(payload.clientTimestamp || 0) || 0,
        lastSeenAt: Number(payload.lastSeenAt || 0) || 0
      };
      entry.freshTimestamp = Math.max(entry.lastSeenAt || 0, entry.clientTimestamp || 0);
      entry.isStale = entry.freshTimestamp ? now - entry.freshTimestamp > DISPLAY_PRESENCE_STALE_THRESHOLD_MS : true;
      entries.push(entry);
    });
    entries.sort((a, b) => (b.freshTimestamp || 0) - (a.freshTimestamp || 0));
    return entries;
  }

  /**
   * displayのpresence・セッション情報からアクティブ状態を再計算し、必要に応じてセッションTTLを更新します。
   * @param {string} reason
   */
  evaluateDisplaySessionActivity(reason = "unknown") {
    const previousActive = this.state.isDisplaySessionActive;
    const activeEventId = String(this.state?.activeEventId || "").trim();
    const presenceEntries = Array.isArray(this.displayPresenceEntries) ? this.displayPresenceEntries : [];
    const displaySessions = Array.isArray(this.state.displaySessions) ? this.state.displaySessions : [];
    const representativeSession = this.state.displaySession || null;
    
    // 複数display.html対応: いずれかのセッションが接続していればOK
    // presenceエントリとセッションを照合して、有効な接続があるか確認
    let hasActiveConnection = false;
    let activePresenceEntry = null;
    
    // セッションスナップショットが有効な場合
    if (this.displaySessionStatusFromSnapshot) {
      // セッションスナップショットから有効なセッションを確認
      if (representativeSession) {
        const sessionEventId = String(representativeSession?.eventId || "").trim();
        const assignmentEventId = representativeSession?.assignment && typeof representativeSession.assignment === "object"
          ? String(representativeSession.assignment.eventId || "").trim()
          : "";
        const sessionMatchesActiveEvent = !activeEventId || !sessionEventId || sessionEventId === activeEventId || assignmentEventId === activeEventId;
        if (sessionMatchesActiveEvent) {
          hasActiveConnection = true;
        }
      }
      // displaySessionsからも確認（複数セッションがある場合）
      if (displaySessions.length > 0) {
        const hasMatchingSession = displaySessions.some((session) => {
          if (!session) return false;
          const sessionEventId = String(session.eventId || "").trim();
          const assignmentEventId = session.assignment && typeof session.assignment === "object"
            ? String(session.assignment.eventId || "").trim()
            : "";
          return !activeEventId || !sessionEventId || sessionEventId === activeEventId || assignmentEventId === activeEventId;
        });
        if (hasMatchingSession) {
          hasActiveConnection = true;
        }
      }
    }
    
    // presenceエントリから有効な接続を確認
    if (presenceEntries.length > 0) {
      activePresenceEntry = presenceEntries.find((entry) => {
        // イベントが選択されていない場合は、すべてのエントリを対象とする（後方互換性）
        if (!activeEventId) {
          return !entry.isStale;
        }
        // 現在選択中のイベントに対応するエントリを探す
        const entryEventId = String(entry.eventId || entry.channelEventId || entry.assignmentEventId || "").trim();
        if (entryEventId !== activeEventId) {
          return false;
        }
        return !entry.isStale;
      }) || null;
      
      if (activePresenceEntry) {
        hasActiveConnection = true;
        this.displayPresencePrimedForSession = true;
        this.displayPresencePrimedSessionId = String(activePresenceEntry.sessionId || "").trim();
        
        // presenceエントリに対応するセッションがあれば、TTLを延長
        const matchingSession = displaySessions.find((s) => 
          s && String(s.uid || "").trim() === String(activePresenceEntry.uid || "").trim() &&
          String(s.sessionId || "").trim() === String(activePresenceEntry.sessionId || "").trim()
        ) || representativeSession;
        if (matchingSession && String(matchingSession.uid || "").trim() === String(activePresenceEntry.uid || "").trim()) {
          this.refreshDisplaySessionFromPresence(matchingSession, activePresenceEntry, reason);
        }
      }
    }
    
    const assetChecked = this.state.isDisplayAssetChecked === true;
    const assetAvailable = this.state.displayAssetAvailable !== false;
    const allowActive = !assetChecked || assetAvailable;
    const nextActive = allowActive && hasActiveConnection;
    this.state.isDisplaySessionActive = nextActive;

    if (nextActive && this.state.renderChannelOnline === false) {
      this.updateRenderAvailability(null);
    }

    if (!nextActive && displaySessions.length > 0) {
      // 有効なセッションがない場合、非アクティブ状態としてマーク
      this.markDisplaySessionInactive(reason);
    }

    if (this.state.displaySessionLastActive !== null && this.state.displaySessionLastActive !== nextActive) {
      this.toast(
        nextActive ? "送出端末とのセッションが確立されました。" : "送出端末の接続が確認できません。",
        nextActive ? "success" : "error"
      );
    }
    this.state.displaySessionLastActive = nextActive;

    if (previousActive !== nextActive) {
      this.updateActionAvailability();
      this.updateBatchButtonVisibility();
    }
  }

  /**
   * presenceの最新情報をもとに render/events/$eventId/sessions/$uid のTTLを延長します。
   * @param {any} session
   * @param {any} entry
   * @param {string} reason
   */
  refreshDisplaySessionFromPresence(session, entry, reason = "presence") {
    const sessionId = String(session?.sessionId || "").trim();
    const entrySessionId = String(entry?.sessionId || "").trim();
    const uid = String(session?.uid || entry?.uid || "").trim();
    if (!sessionId || !entrySessionId || !uid || sessionId !== entrySessionId) {
      return;
    }
    const now = Date.now();
    const lastRefresh = this.displayPresenceRefreshedAt || 0;
    const expiresAt = Number(session?.expiresAt || 0) || 0;
    const shouldRefresh =
      !expiresAt ||
      expiresAt <= now + DISPLAY_SESSION_REFRESH_MARGIN_MS ||
      now - lastRefresh >= DISPLAY_PRESENCE_HEARTBEAT_MS;
    if (!shouldRefresh) {
      return;
    }
    const payload = {
      status: "active",
      lastSeenAt: entry.lastSeenAt || entry.clientTimestamp || now,
      expiresAt: now + DISPLAY_SESSION_TTL_MS,
      lastPresenceReason: reason,
      lastPresenceUid: uid,
      lastPresenceClientTimestamp: entry.clientTimestamp || now,
      presenceUpdatedAt: now
    };
    if (!session?.eventId && entry.eventId) {
      payload.eventId = entry.eventId;
    }
    if (!session?.scheduleId && entry.scheduleId) {
      payload.scheduleId = entry.scheduleId;
    }
    // 複数display.html対応: セッションのイベントIDとuidに基づいて正しいパスを使用
    const sessionEventId = String(session?.eventId || entry?.eventId || "").trim();
    if (!sessionEventId) {
      // eventIdが必須のため、ない場合は処理をスキップ
      console.debug("refreshDisplaySessionTTL: eventId is missing, skipping TTL refresh");
      return;
    }
    const sessionRef = uid
      ? ref(database, `render/events/${sessionEventId}/sessions/${uid}`)
      : ref(database, `render/events/${sessionEventId}/sessions`);
    update(sessionRef, payload).catch((error) => {
      console.debug("Failed to extend display session TTL:", error);
    });
    this.displayPresenceRefreshedAt = now;
  }

  /**
   * presence情報の定期的なクリーンアップを予約します。
   */
  scheduleDisplayPresenceCleanup() {
    if (this.displayPresenceCleanupTimer) {
      return;
    }
    const timerHost = getTimerHost();
    this.displayPresenceCleanupTimer = timerHost.setTimeout(() => {
      this.displayPresenceCleanupTimer = 0;
      this.performDisplayPresenceCleanup();
    }, DISPLAY_PRESENCE_CLEANUP_INTERVAL_MS);
  }

  /**
   * 古いpresenceエントリの削除やセッション失効処理を実行します。
   */
  performDisplayPresenceCleanup(options = {}) {
    const { scheduleNext = true, reason = "presence-cleanup" } = options || {};
    const entries = Array.isArray(this.displayPresenceEntries) ? this.displayPresenceEntries : [];
    const now = Date.now();
    entries.forEach((entry) => {
      if (!entry || !entry.uid || !entry.isStale) {
        return;
      }
      const staleFor = now - (entry.freshTimestamp || 0);
      if (staleFor > DISPLAY_PRESENCE_STALE_THRESHOLD_MS * 1.5) {
        remove(getDisplayPresenceEntryRef(entry.uid)).catch(() => {});
      }
    });
    this.evaluateDisplaySessionActivity(reason);
    if (scheduleNext) {
      this.scheduleDisplayPresenceCleanup();
    }
  }

  /**
   * presenceが確認できない場合にセッションを失効状態としてマークします。
   * @param {string} reason
   */
  markDisplaySessionInactive(reason = "presence-missing") {
    const session = this.state.displaySession || null;
    if (!session) {
      return;
    }
    const sessionId = String(session.sessionId || "").trim();
    const uid = String(session.uid || "").trim();
    if (!sessionId || !uid) {
      return;
    }
    const now = Date.now();
    if (now - this.displayPresenceLastInactiveAt < DISPLAY_PRESENCE_HEARTBEAT_MS) {
      return;
    }
    const currentStatus = String(session.status || "").trim();
    if (currentStatus && currentStatus !== "active") {
      this.displayPresenceLastInactiveAt = now;
      return;
    }
    const payload = {
      status: "inactive",
      expiresAt: now,
      presenceUpdatedAt: now,
      lastPresenceReason: reason,
      lastPresenceUid: uid
    };
    update(displaySessionRef, payload).catch(() => {});
    this.displayPresenceLastInactiveAt = now;
  }

  /**
   * フッターに表示する著作権表記を現在の年に合わせて更新します。
   */
  updateCopyrightYear() {
    return this.uiRenderer.updateCopyrightYear();
  }
}

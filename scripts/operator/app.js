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
  questionStatusRef,
  questionIntakeEventsRef,
  questionIntakeSchedulesRef,
  displaySessionRef,
  displayPresenceRootRef,
  getDisplayPresenceEntryRef,
  getRenderRef,
  getOperatorPresenceEventRef,
  getOperatorPresenceEntryRef,
  set,
  update,
  remove,
  serverTimestamp,
  onDisconnect
} from "./firebase.js";
import { getRenderStatePath, parseChannelParams, normalizeScheduleId } from "../shared/channel-paths.js";
import { derivePresenceScheduleKey as sharedDerivePresenceScheduleKey } from "../shared/presence-keys.js";
import { OPERATOR_MODE_TELOP, normalizeOperatorMode, isTelopMode } from "../shared/operator-modes.js";
import { goToLogin } from "../shared/routes.js";
import { info as logDisplayLinkInfo, error as logDisplayLinkError } from "../shared/display-link-logger.js";
import { queryDom } from "./dom.js";
import { createInitialState } from "./state.js";
import { createApiClient } from "./api-client.js";
import { showToast } from "./toast.js";
import {
  loadAuthPreflightContext,
  preflightContextMatchesUser
} from "../shared/auth-preflight.js";
import * as Questions from "./questions.js";
import { resolveGenreLabel } from "./utils.js";
import * as Dictionary from "./dictionary.js";
import * as Logs from "./logs.js";
import * as Display from "./display.js";
import * as Dialog from "./dialog.js";
import * as Loader from "./loader.js";
import * as Pickup from "./pickup.js";

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
  { element: "selectAllCheckbox", type: "change", handler: "handleSelectAll" },
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
    module: Dialog,
    methods: [
      "openDialog",
      "closeEditDialog",
      "handleDialogKeydown",
      "handleEdit",
      "handleEditSubmit"
    ]
  },
  {
    module: Loader,
    methods: [
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
    this.pageContext = this.extractPageContext();
    this.initialPageContext = { ...(this.pageContext || {}) };
    this.applyContextToState();
    this.api = createApiClient(auth, onAuthStateChanged);
    this.isEmbedded = Boolean(OperatorApp.embedPrefix);
    if (this.isEmbedded && this.dom.loginContainer) {
      this.dom.loginContainer.style.display = "none";
    }
    this.loaderStepLabels = this.isEmbedded ? [] : null;

    this.lastUpdatedAt = 0;
    this.renderTicker = null;
    this.questionsUnsubscribe = null;
    this.displaySessionUnsubscribe = null;
    this.displayPresenceUnsubscribe = null;
    this.displayPresenceCleanupTimer = 0;
    this.displayPresenceEntries = [];
    this.displayPresenceLastRefreshAt = 0;
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
    this.operatorPresenceSubscribedEventId = "";
    this.operatorPresenceUnsubscribe = null;
    this.operatorPresenceLastSignature = "";
    this.operatorPresenceSessionId = this.generatePresenceSessionId();
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
   * crypto APIの利用可否に応じて最適な乱数生成手段を選択します。
   * @returns {string}
   */
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

  /**
   * URLクエリや埋め込み設定からイベント/日程情報を解析し、ページコンテキストとして返却します。
   * エラーに強い実装とし、欠落値には空文字を設定します。
   * @returns {{ eventId: string, scheduleId: string, eventName: string, scheduleLabel: string, startAt: string, endAt: string, scheduleKey: string, operatorMode: string }}
   */
  extractPageContext() {
    const context = {
      eventId: "",
      scheduleId: "",
      eventName: "",
      scheduleLabel: "",
      startAt: "",
      endAt: "",
      scheduleKey: "",
      operatorMode: OPERATOR_MODE_TELOP
    };
    if (typeof window === "undefined") {
      return context;
    }
    try {
      const params = new URLSearchParams(window.location.search || "");
      const channel = parseChannelParams(params);
      context.eventId = channel.eventId || "";
      context.scheduleId = channel.scheduleId || "";
      context.eventName = String(params.get("eventName") ?? "").trim();
      context.scheduleLabel = String(params.get("scheduleLabel") ?? params.get("scheduleName") ?? "").trim();
      context.startAt = String(params.get("startAt") ?? params.get("scheduleStart") ?? params.get("start") ?? "").trim();
      context.endAt = String(params.get("endAt") ?? params.get("scheduleEnd") ?? params.get("end") ?? "").trim();
      const rawScheduleKey = String(params.get("scheduleKey") ?? "").trim();
      context.scheduleKey = this.derivePresenceScheduleKey(
        context.eventId,
        {
          scheduleKey: rawScheduleKey,
          scheduleId: context.scheduleId,
          scheduleLabel: context.scheduleLabel
        }
      );
      const hasInitialSelection = Boolean(context.eventId || context.scheduleId || context.scheduleKey);
      if (hasInitialSelection) {
        context.selectionConfirmed = false;
      }
    } catch (error) {
      // Ignore malformed page context payloads.
    }
    return context;
  }

  /**
   * ページ読み込み時に抽出した文脈情報をアプリケーションのstateに反映します。
   * URL指定のチャンネルが存在する場合にはローカルstateの選択肢として保持します。
   */
  applyContextToState() {
    if (!this.state) return;
    const context = this.pageContext || {};
    const selectionConfirmed = context.selectionConfirmed === true;
    const scheduleKey = this.derivePresenceScheduleKey(
      context.eventId,
      {
        scheduleKey: context.scheduleKey,
        scheduleId: context.scheduleId,
        scheduleLabel: context.scheduleLabel
      }
    );
    const committedScheduleKey = this.derivePresenceScheduleKey(
      context.eventId,
      {
        scheduleKey: context.committedScheduleKey,
        scheduleId: context.committedScheduleId,
        scheduleLabel: context.committedScheduleLabel
      }
    );
    this.state.activeEventId = selectionConfirmed ? context.eventId || "" : "";
    this.state.activeScheduleId = selectionConfirmed ? context.scheduleId || "" : "";
    this.state.activeEventName = selectionConfirmed ? context.eventName || "" : "";
    this.state.activeScheduleLabel = selectionConfirmed ? context.scheduleLabel || "" : "";
    this.state.selectionConfirmed = selectionConfirmed;
    this.state.committedScheduleId = context.committedScheduleId || "";
    this.state.committedScheduleLabel = context.committedScheduleLabel || "";
    this.state.committedScheduleKey = committedScheduleKey;
    if (selectionConfirmed && committedScheduleKey) {
      this.state.currentSchedule = committedScheduleKey;
      this.state.lastNormalSchedule = committedScheduleKey;
    } else if (selectionConfirmed && scheduleKey) {
      this.state.currentSchedule = scheduleKey;
      this.state.lastNormalSchedule = scheduleKey;
    } else if (!selectionConfirmed) {
      this.state.currentSchedule = "";
      this.state.lastNormalSchedule = "";
    }
    this.state.operatorMode = this.operatorMode;
  }

  /**
   * 画面コンテキストに保持しているイベント/日程選択情報を初期状態へ戻します。
   * 既存のその他のメタデータは維持しつつ、selectionConfirmedをfalseに戻します。
   */
  resetPageContextSelection() {
    let baseContext = {};
    if (this.pageContext && typeof this.pageContext === "object") {
      baseContext = { ...this.pageContext };
    } else if (this.initialPageContext && typeof this.initialPageContext === "object") {
      baseContext = { ...this.initialPageContext };
    }
    const normalizedMode = normalizeOperatorMode(baseContext.operatorMode ?? this.operatorMode);
    this.pageContext = {
      ...baseContext,
      eventId: "",
      scheduleId: "",
      eventName: "",
      scheduleLabel: "",
      startAt: "",
      endAt: "",
      scheduleKey: "",
      committedScheduleId: "",
      committedScheduleLabel: "",
      committedScheduleKey: "",
      selectionConfirmed: false,
      operatorMode: normalizedMode || OPERATOR_MODE_TELOP
    };
    if (this.state) {
      this.state.selectionConfirmed = false;
    }
  }

  /**
   * stateとURLから現在操作対象となるイベント/日程を決定します。
   * いずれかの値が欠落している場合はscheduleKeyから復元を試みます。
   * @returns {{ eventId: string, scheduleId: string }}
   */
  getActiveChannel() {
    const ensure = (value) => String(value ?? "").trim();
    const context = this.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    let eventId = ensure(this.state?.activeEventId || (contextConfirmed ? context.eventId : ""));
    let scheduleId = ensure(this.state?.activeScheduleId || (contextConfirmed ? context.scheduleId : ""));

    if (!eventId || !scheduleId) {
      const scheduleKey = ensure(
        this.state?.currentSchedule || (contextConfirmed ? context.scheduleKey : "") || ""
      );
      if (scheduleKey) {
        const [eventPart = "", schedulePart = ""] = scheduleKey.split("::");
        if (!eventId && eventPart) {
          eventId = ensure(eventPart);
        }
        if (!scheduleId && schedulePart) {
          scheduleId = ensure(schedulePart);
        }
      }
    }

    return { eventId, scheduleId };
  }

  /**
   * 現在アクティブなイベントと日程IDを基に正規化されたチャンネルキーを生成します。
   * @returns {string}
   */
  getCurrentScheduleKey() {
    const ensure = (value) => String(value ?? "").trim();
    const context = this.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const directKey = ensure(this.state?.currentSchedule || (contextConfirmed ? context.scheduleKey : "") || "");
    if (directKey) {
      return directKey;
    }
    const { eventId, scheduleId } = this.getActiveChannel();
    const scheduleLabel = ensure(
      this.state?.activeScheduleLabel || (contextConfirmed ? context.scheduleLabel : "") || ""
    );
    const entryId = ensure(this.operatorPresenceSessionId);
    return this.derivePresenceScheduleKey(eventId, { scheduleId, scheduleLabel }, entryId);
  }

  /**
   * presenceデータから比較・集計に利用する一意のキーを導出します。
   * scheduleKey > scheduleId > label > entryIdの優先順位で構成します。
   * @param {string} eventId
   * @param {object} payload
   * @param {string} entryId
   * @returns {string}
   */
  derivePresenceScheduleKey(eventId, payload = {}, entryId = "") {
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
    return !!this.state?.displaySessionActive && renderOnline;
  }

  /**
   * レンダリングチャンネルの到達状況を更新し、UIへ反映します。
   * @param {boolean|null|undefined} status
   */
  updateRenderAvailability(status) {
    if (!this.state) {
      return;
    }
    const sessionActive = this.state.displaySessionActive === true;
    const snapshotActive = this.displaySessionStatusFromSnapshot === true;
    let normalized = status === true ? true : status === false ? false : null;
    if (normalized === false && (sessionActive || snapshotActive)) {
      normalized = null;
    }
    if (this.state.renderChannelOnline === normalized) {
      return;
    }
    this.state.renderChannelOnline = normalized;
    if (typeof this.updateActionAvailability === "function") {
      this.updateActionAvailability();
    }
    if (typeof this.updateBatchButtonVisibility === "function") {
      this.updateBatchButtonVisibility();
    }
    this.renderChannelBanner();
  }

  /**
   * 送出端末のセッション状態から現在の割当情報を抽出します。
   * @returns {null|{ eventId: string, scheduleId: string, label: string, updatedAt?: number, lockedAt?: number }}
   */
  getDisplayAssignment() {
    const session = this.state?.displaySession || null;
    const rawAssignment = session && typeof session === "object" ? session.assignment || null : null;
    const candidate = rawAssignment && typeof rawAssignment === "object" ? rawAssignment : null;
    const eventId = String((candidate && candidate.eventId) || (session && session.eventId) || "").trim();
    if (!eventId) {
      return null;
    }
    const scheduleId = String((candidate && candidate.scheduleId) || (session && session.scheduleId) || "").trim();
    const scheduleLabel = String((candidate && candidate.scheduleLabel) || (session && session.scheduleLabel) || "").trim();
    const lockedByUid = String((candidate && candidate.lockedByUid) || (session && session.lockedByUid) || "").trim();
    const lockedByName = String((candidate && candidate.lockedByName) || (session && session.lockedByName) || "").trim();
    const lockedAt = Number((candidate && candidate.lockedAt) || (session && session.lockedAt) || 0);
    const scheduleKey = `${eventId}::${normalizeScheduleId(scheduleId)}`;
    return {
      eventId,
      scheduleId,
      scheduleLabel,
      scheduleKey,
      lockedByUid,
      lockedByName,
      lockedAt
    };
  }

  /**
   * 日程キーから表示用ラベルを決定します。
   * メタデータが存在しない場合はフォールバックのラベルや日程IDを使用します。
   * @param {string} scheduleKey
   * @param {string} fallbackLabel
   * @param {string} fallbackScheduleId
   * @returns {string}
   */
  resolveScheduleLabel(scheduleKey, fallbackLabel = "", fallbackScheduleId = "") {
    const metadataMap = this.state?.scheduleMetadata instanceof Map ? this.state.scheduleMetadata : null;
    if (metadataMap && scheduleKey && metadataMap.has(scheduleKey)) {
      const meta = metadataMap.get(scheduleKey);
      const label = String(meta?.label || "").trim();
      if (label) {
        return label;
      }
    }
    const directLabel = String(fallbackLabel || "").trim();
    if (directLabel) {
      return directLabel;
    }
    const scheduleId = String(fallbackScheduleId || "").trim();
    if (scheduleId && scheduleId !== "__default_schedule__") {
      return scheduleId;
    }
    return "未選択";
  }

  /**
   * オペレーター視点での割当状況を判定し、UI表示用の説明文を組み立てます。
   * @returns {{ label: string, type: "normal"|"conflict"|"missing"|"unassigned" }}
   */
  describeChannelAssignment() {
    const assignment = this.state?.channelAssignment || this.getDisplayAssignment();
    if (!assignment || !assignment.eventId) {
      return "";
    }
    const eventId = String(assignment.eventId || "").trim();
    const scheduleId = String(assignment.scheduleId || "").trim();
    const scheduleKey = `${eventId}::${normalizeScheduleId(scheduleId)}`;
    const metadataMap = this.state?.scheduleMetadata instanceof Map ? this.state.scheduleMetadata : null;
    const eventsMap = this.state?.eventsById instanceof Map ? this.state.eventsById : null;
    let eventName = "";
    if (metadataMap && metadataMap.has(scheduleKey)) {
      eventName = String(metadataMap.get(scheduleKey)?.eventName || "").trim();
    }
    if (!eventName && eventsMap && eventsMap.has(eventId)) {
      eventName = String(eventsMap.get(eventId)?.name || "").trim();
    }
    const label = this.resolveScheduleLabel(scheduleKey, assignment.scheduleLabel, scheduleId);
    if (eventName && label) {
      return `「${eventName} / ${label}」`;
    }
    if (label) {
      return `「${label}」`;
    }
    if (eventName) {
      return `「${eventName}」`;
    }
    return "「指定された日程」";
  }

  /**
   * 表示端末がロックしているチャンネルとオペレーターの選択が矛盾しているか判定します。
   * @returns {boolean}
   */
  hasChannelMismatch() {
    const assignment = this.state?.channelAssignment || this.getDisplayAssignment();
    if (!assignment || !assignment.eventId) {
      return true;
    }

    const assignedEvent = String(assignment.eventId || "").trim();
    const assignedSchedule = normalizeScheduleId(assignment.scheduleId || "");
    const assignedKey = `${assignedEvent}::${assignedSchedule}`;

    const currentKey = String(this.getCurrentScheduleKey() || "").trim();
    if (currentKey) {
      return currentKey !== assignedKey;
    }

    const { eventId, scheduleId } = this.getActiveChannel();
    const normalizedEvent = String(eventId || "").trim();
    if (!normalizedEvent) {
      return true;
    }
    const currentSchedule = normalizeScheduleId(scheduleId);
    return assignedEvent !== normalizedEvent || assignedSchedule !== currentSchedule;
  }

  /**
   * 現在のチャンネル選択に基づいてリアルタイム購読を再設定します。
   * displayセッションが存在しない場合は安全に購読を解除します。
   */
  refreshChannelSubscriptions() {
    const { eventId, scheduleId } = this.getActiveChannel();
    const path = getRenderStatePath(eventId, scheduleId);
    if (this.currentRenderPath !== path) {
      const normalizedEvent = String(eventId || "").trim();
      const normalizedSchedule = normalizeScheduleId(scheduleId || "");
      // logDisplayLinkInfo("Switching render subscription", {
      //   path,
      //   eventId: normalizedEvent || null,
      //   scheduleId: normalizedSchedule || null
      // });
    }
    if (this.currentRenderPath === path && this.renderUnsubscribe) {
      return;
    }
    if (this.renderUnsubscribe) {
      this.renderUnsubscribe();
      this.renderUnsubscribe = null;
    }
    this.currentRenderPath = path;
    this.updateRenderAvailability(null);
    const channelRef = getRenderRef(eventId, scheduleId);
    this.renderUnsubscribe = onValue(
      channelRef,
      (snapshot) => this.handleRenderUpdate(snapshot),
      (error) => {
        logDisplayLinkError("Render state monitor error", error);
      }
    );
    this.refreshOperatorPresenceSubscription();
    this.renderChannelBanner();
    this.evaluateScheduleConflict();
  }

  /**
   * オペレーターpresenceの監視対象を切り替えます。
   * イベントが変わった際には既存購読を解除し、新しいイベントのpresenceノードを監視します。
   */
  refreshOperatorPresenceSubscription() {
    const { eventId } = this.getActiveChannel();
    const nextEventId = String(eventId || "").trim();
    if (this.operatorPresenceSubscribedEventId === nextEventId) {
      return;
    }
    if (this.operatorPresenceUnsubscribe) {
      this.operatorPresenceUnsubscribe();
      this.operatorPresenceUnsubscribe = null;
    }
    if (this.operatorPresencePrimedEventId && this.operatorPresencePrimedEventId !== nextEventId) {
      this.operatorPresencePrimedEventId = "";
    }
    this.operatorPresenceSubscribedEventId = nextEventId;
    this.state.operatorPresenceEventId = nextEventId;
    this.state.operatorPresenceByUser = new Map();
    if (!nextEventId) {
      this.state.operatorPresenceSelf = null;
      this.renderChannelBanner();
      this.evaluateScheduleConflict();
      return;
    }

    const eventRef = getOperatorPresenceEventRef(nextEventId);
    this.operatorPresenceUnsubscribe = onValue(
      eventRef,
      (snapshot) => {
        const raw = snapshot.val() || {};
        const presenceMap = new Map();
        Object.entries(raw).forEach(([entryId, payload]) => {
          presenceMap.set(String(entryId), payload || {});
        });
        this.state.operatorPresenceEventId = nextEventId;
        this.state.operatorPresenceByUser = presenceMap;
        const selfResolution = this.resolveSelfPresenceEntry(nextEventId, presenceMap);
        let selfEntry = null;
        if (selfResolution) {
          const { payload, sessionId: resolvedSessionId, duplicates } = selfResolution;
          selfEntry = payload ? { ...payload, sessionId: resolvedSessionId || String(payload.sessionId || "") } : null;
          if (resolvedSessionId) {
            this.adoptOperatorPresenceSession(nextEventId, resolvedSessionId);
          }
          if (Array.isArray(duplicates) && duplicates.length) {
            duplicates.forEach((duplicate) => {
              const duplicateSessionId = String(duplicate?.sessionId || duplicate?.entryId || "").trim();
              if (!duplicateSessionId || duplicateSessionId === resolvedSessionId) {
                return;
              }
              try {
                remove(getOperatorPresenceEntryRef(nextEventId, duplicateSessionId)).catch(() => {});
              } catch (error) {
                // Ignore removal failures.
              }
            });
          }
        } else {
          const sessionId = String(this.operatorPresenceSessionId || "").trim();
          if (sessionId && presenceMap.has(sessionId)) {
            selfEntry = presenceMap.get(sessionId) || null;
          }
        }
        this.state.operatorPresenceSelf = selfEntry || null;
        this.renderChannelBanner();
        this.evaluateScheduleConflict();
      },
      () => {}
    );
  }

  /**
   * presenceに自身のセッションを登録する準備を行います。
   * 書き込み競合を避けるため、既存のエントリを確認しながら初期データを投入します。
   * @param {string} eventId
   * @returns {Promise<void>}
   */
  primeOperatorPresenceSession(eventId = "") {
    const ensure = (value) => String(value ?? "").trim();
    const normalizedEventId = ensure(eventId);
    const uid = ensure(this.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!normalizedEventId || !uid) {
      this.operatorPresencePrimedEventId = normalizedEventId ? normalizedEventId : "";
      return Promise.resolve();
    }
    if (this.operatorPresencePrimedEventId === normalizedEventId && !this.operatorPresencePrimePromise) {
      return Promise.resolve();
    }
    const presenceMap = this.state?.operatorPresenceByUser instanceof Map ? this.state.operatorPresenceByUser : null;
    if (presenceMap && presenceMap.size) {
      const resolution = this.resolveSelfPresenceEntry(normalizedEventId, presenceMap);
      const resolvedSessionId = ensure(resolution?.sessionId);
      if (resolvedSessionId) {
        this.operatorPresencePrimedEventId = normalizedEventId;
        this.adoptOperatorPresenceSession(normalizedEventId, resolvedSessionId);
        return Promise.resolve();
      }
    }
    if (this.operatorPresencePrimePromise) {
      if (this.operatorPresencePrimeTargetEventId === normalizedEventId) {
        return this.operatorPresencePrimePromise;
      }
    }
    const requestId = ++this.operatorPresencePrimeRequestId;
    this.operatorPresencePrimeTargetEventId = normalizedEventId;
    const primePromise = get(getOperatorPresenceEventRef(normalizedEventId))
      .then((snapshot) => {
        if (this.operatorPresencePrimeRequestId !== requestId) {
          return;
        }
        if (!snapshot.exists()) {
          return;
        }
        const raw = snapshot.val();
        if (!raw || typeof raw !== "object") {
          return;
        }
        let resolvedSessionId = "";
        Object.entries(raw).some(([entryId, payload]) => {
          if (resolvedSessionId) {
            return true;
          }
          if (!payload || typeof payload !== "object") {
            return false;
          }
          const entryUid = ensure(payload.uid);
          if (!entryUid || entryUid !== uid) {
            return false;
          }
          const sessionId = ensure(payload.sessionId) || ensure(entryId);
          if (!sessionId) {
            return false;
          }
          resolvedSessionId = sessionId;
          return true;
        });
        if (resolvedSessionId) {
          this.adoptOperatorPresenceSession(normalizedEventId, resolvedSessionId);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.operatorPresencePrimeRequestId === requestId) {
          this.operatorPresencePrimePromise = null;
          this.operatorPresencePrimedEventId = normalizedEventId;
          this.operatorPresencePrimeTargetEventId = "";
        }
      });
    this.operatorPresencePrimePromise = primePromise;
    return primePromise;
  }

  /**
   * presence一覧から自身に該当するエントリを特定します。
   * セッションIDの競合や重複がある場合には整理された結果を返します。
   * @param {string} eventId
   * @param {Map<string, any>} presenceMap
   * @returns {{ payload: any, sessionId: string, duplicates: any[] }|null}
   */
  resolveSelfPresenceEntry(eventId, presenceMap) {
    const ensure = (value) => String(value ?? "").trim();
    const normalizedEventId = ensure(eventId);
    if (!normalizedEventId) {
      return null;
    }
    const selfUid = ensure(this.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!selfUid) {
      return null;
    }
    const map = presenceMap instanceof Map ? presenceMap : new Map();
    const entries = [];
    map.forEach((value, entryId) => {
      if (!value) {
        return;
      }
      const valueEventId = ensure(value.eventId);
      if (valueEventId && valueEventId !== normalizedEventId) {
        return;
      }
      const valueUid = ensure(value.uid);
      if (!valueUid || valueUid !== selfUid) {
        return;
      }
      const normalizedEntryId = ensure(entryId);
      const sessionId = ensure(value.sessionId) || normalizedEntryId;
      if (!sessionId) {
        return;
      }
      const timestamp = Number(value.clientTimestamp || value.updatedAt || 0) || 0;
      entries.push({
        entryId: normalizedEntryId,
        sessionId,
        payload: value,
        timestamp
      });
    });
    if (!entries.length) {
      return null;
    }
    const existingSessionId = ensure(this.operatorPresenceSessionId);
    let canonical = null;
    if (existingSessionId) {
      canonical = entries.find((entry) => entry.sessionId === existingSessionId) || null;
    }
    if (!canonical) {
      entries.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return (b.timestamp || 0) - (a.timestamp || 0);
        }
        return a.sessionId.localeCompare(b.sessionId);
      });
      canonical = entries[0];
    }
    const duplicates = entries.filter((entry) => entry !== canonical);
    return {
      eventId: normalizedEventId,
      entryId: canonical.entryId,
      sessionId: canonical.sessionId,
      payload: canonical.payload,
      duplicates
    };
  }

  /**
   * 自身のセッションIDが変化した場合にローカル状態を更新し、新しいIDでpresence監視を継続します。
   * @param {string} eventId
   * @param {string} sessionId
   */
  adoptOperatorPresenceSession(eventId, sessionId) {
    const ensure = (value) => String(value ?? "").trim();
    const normalizedEventId = ensure(eventId);
    const normalizedSessionId = ensure(sessionId);
    if (!normalizedEventId || !normalizedSessionId) {
      return;
    }
    const currentSessionId = ensure(this.operatorPresenceSessionId);
    if (currentSessionId === normalizedSessionId) {
      const currentKey = ensure(this.operatorPresenceEntryKey);
      if (currentKey !== `${normalizedEventId}/${normalizedSessionId}`) {
        this.operatorPresenceEntryKey = "";
        this.operatorPresenceEntryRef = null;
        this.operatorPresenceLastSignature = "";
        this.queueOperatorPresenceSync();
      }
      return;
    }
    this.stopOperatorPresenceHeartbeat();
    if (this.operatorPresenceDisconnect && typeof this.operatorPresenceDisconnect.cancel === "function") {
      try {
        this.operatorPresenceDisconnect.cancel().catch(() => {});
      } catch (error) {
        // Ignore disconnect cancellation errors.
      }
    }
    this.operatorPresenceDisconnect = null;
    this.operatorPresenceEntryRef = null;
    this.operatorPresenceEntryKey = "";
    this.operatorPresenceLastSignature = "";
    this.operatorPresenceSessionId = normalizedSessionId;
    this.queueOperatorPresenceSync();
  }

  /**
   * 現在のユーザーに紐づく古いpresenceエントリを全イベントから削除します。
   * sessionIdを指定した場合はそのエントリを除外します。
   * @param {string} uid
   * @param {{ excludeSessionId?: string }} [options]
   * @returns {Promise<void>}
   */
  purgeOperatorPresenceSessionsForUser(uid = "", options = {}) {
    const ensure = (value) => String(value ?? "").trim();
    const normalizedUid = ensure(uid || this.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!normalizedUid) {
      return Promise.resolve();
    }
    const excludeSessionId = ensure(options?.excludeSessionId);
    if (
      this.operatorPresencePurgePromise &&
      this.operatorPresencePurgeUid === normalizedUid &&
      this.operatorPresencePurgeExclude === excludeSessionId
    ) {
      return this.operatorPresencePurgePromise;
    }
    const requestId = ++this.operatorPresencePurgeRequestId;
    this.operatorPresencePurgeUid = normalizedUid;
    this.operatorPresencePurgeExclude = excludeSessionId;
    const rootRef = getOperatorPresenceEventRef();
    const purgePromise = get(rootRef)
      .then((snapshot) => {
        if (!snapshot || typeof snapshot.exists !== "function" || !snapshot.exists()) {
          return;
        }
        const removals = [];
        snapshot.forEach((eventSnap) => {
          const eventId = ensure(eventSnap.key);
          if (!eventId || typeof eventSnap.forEach !== "function") {
            return;
          }
          eventSnap.forEach((entrySnap) => {
            const value = entrySnap && typeof entrySnap.val === "function" ? entrySnap.val() || {} : {};
            const entryUid = ensure(value.uid);
            if (!entryUid || entryUid !== normalizedUid) {
              return;
            }
            const sessionId = ensure(value.sessionId || entrySnap.key);
            if (excludeSessionId && sessionId === excludeSessionId) {
              return;
            }
            if (!sessionId) {
              return;
            }
            removals.push(remove(getOperatorPresenceEntryRef(eventId, sessionId)).catch(() => {}));
          });
        });
        if (removals.length) {
          return Promise.all(removals).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.operatorPresencePurgeRequestId === requestId) {
          this.operatorPresencePurgePromise = null;
          this.operatorPresencePurgeUid = "";
          this.operatorPresencePurgeExclude = "";
        }
      });
    this.operatorPresencePurgePromise = purgePromise;
    return purgePromise;
  }

  /**
   * presence同期処理を次のマイクロタスクに遅延させ、短時間に複数回呼ばれた場合もまとめて実行します。
   */
  queueOperatorPresenceSync() {
    if (this.operatorPresenceSyncQueued) {
      return;
    }
    this.operatorPresenceSyncQueued = true;
    Promise.resolve().then(() => {
      this.operatorPresenceSyncQueued = false;
      this.syncOperatorPresence();
    });
  }

  /**
   * 現在のオペレーター状態をpresenceツリーに反映します。
   * 書き込みは必要な場合のみ行い、サーバータイムスタンプで同期性を確保します。
   * @param {string} reason
   * @returns {Promise<void>}
   */
  syncOperatorPresence(reason = "context-sync", options = {}) {
    const primePending = Boolean(this.operatorPresencePrimePromise);
    const user = this.operatorIdentity?.uid ? this.operatorIdentity : auth.currentUser || null;
    const uid = String(user?.uid || "").trim();
    if (!uid || !this.isAuthorized) {
      this.clearOperatorPresence();
      return;
    }

    const context = this.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const selectionConfirmed = contextConfirmed && this.state?.selectionConfirmed === true;
    const eventId = selectionConfirmed
      ? String(this.state?.activeEventId || context.eventId || "").trim()
      : "";
    if (!selectionConfirmed || !eventId) {
      this.clearOperatorPresence();
      return;
    }

    if (primePending) {
      return;
    }

    const ensure = (value) => String(value ?? "").trim();
    const committedScheduleId = selectionConfirmed ? ensure(this.state?.committedScheduleId) : "";
    const committedScheduleLabel = selectionConfirmed ? ensure(this.state?.committedScheduleLabel) : "";
    const committedScheduleKey = selectionConfirmed ? ensure(this.state?.committedScheduleKey) : "";
    const intentScheduleId = ensure(this.state?.operatorPresenceIntentId);
    const intentScheduleLabel = ensure(this.state?.operatorPresenceIntentLabel);
    const intentScheduleKey = ensure(this.state?.operatorPresenceIntentKey);
    const activeScheduleId = selectionConfirmed
      ? ensure(this.state?.activeScheduleId || context.scheduleId || "")
      : "";
    const activeScheduleLabel = selectionConfirmed
      ? ensure(this.state?.activeScheduleLabel || context.scheduleLabel || "")
      : "";
    const activeScheduleKey = selectionConfirmed
      ? ensure(
          this.state?.currentSchedule ||
            this.state?.lastNormalSchedule ||
            context.scheduleKey || ""
        )
      : "";
    const previousPresence = this.state?.operatorPresenceSelf || null;
    const allowPresenceFallback =
      typeof options?.allowFallback === "boolean"
        ? options.allowFallback
        : reason === "heartbeat";
    const useActiveSchedule = options?.useActiveSchedule !== false;
    const publishScheduleOption = options?.publishSchedule;
    const sessionId = ensure(this.operatorPresenceSessionId) || this.generatePresenceSessionId();

    const schedulePublicationExplicit = publishScheduleOption === true;
    const scheduleSuppressed =
      publishScheduleOption === false || (!selectionConfirmed && !schedulePublicationExplicit);
    const activeScheduleAvailable =
      useActiveSchedule && (activeScheduleKey || activeScheduleId || activeScheduleLabel);
    const shouldPublishSchedule =
      schedulePublicationExplicit ||
      (!scheduleSuppressed &&
        (committedScheduleKey || intentScheduleKey || intentScheduleId || intentScheduleLabel || activeScheduleAvailable));

    let scheduleId = "";
    let scheduleLabel = "";
    let scheduleKey = "";

    if (shouldPublishSchedule) {
      scheduleId = committedScheduleId || (useActiveSchedule ? activeScheduleId : "");
      if (!scheduleId && intentScheduleId) {
        scheduleId = intentScheduleId;
      }
      if (!scheduleId && intentScheduleKey) {
        const [, schedulePart = ""] = intentScheduleKey.split("::");
        scheduleId = ensure(schedulePart || intentScheduleKey);
      }
      if (!scheduleId && allowPresenceFallback) {
        scheduleId = ensure(previousPresence?.scheduleId);
      }

      scheduleLabel = committedScheduleLabel || (useActiveSchedule ? activeScheduleLabel : "");
      if (!scheduleLabel && intentScheduleLabel) {
        scheduleLabel = intentScheduleLabel;
      }
      if (!scheduleLabel && allowPresenceFallback) {
        scheduleLabel = ensure(previousPresence?.scheduleLabel);
      }
      if (!scheduleLabel && scheduleId) {
        scheduleLabel = scheduleId;
      }

      scheduleKey = committedScheduleKey || (useActiveSchedule ? activeScheduleKey : "");
      if (!scheduleKey && intentScheduleKey) {
        scheduleKey = intentScheduleKey;
      }
      if (!scheduleKey && scheduleId && eventId) {
        scheduleKey = `${eventId}::${normalizeScheduleId(scheduleId)}`;
      }
      if (!scheduleKey && allowPresenceFallback) {
        scheduleKey = ensure(previousPresence?.scheduleKey);
      }
      if (!scheduleKey && scheduleId) {
        scheduleKey = this.derivePresenceScheduleKey(eventId, { scheduleId, scheduleLabel }, sessionId);
      }
      if (!scheduleKey && scheduleLabel) {
        scheduleKey = this.derivePresenceScheduleKey(
          eventId,
          {
            scheduleId: "",
            scheduleLabel
          },
          sessionId
        );
      }
    }
    const publishEvent = shouldPublishSchedule || options?.publishEvent === true;
    const eventName = publishEvent
      ? String(this.state?.activeEventName || (selectionConfirmed ? context.eventName : "") || "").trim()
      : "";
    const skipTelop = !this.isTelopEnabled();
    this.operatorPresenceSessionId = sessionId;
    const nextKey = `${eventId}/${sessionId}`;

    if (this.operatorPresenceEntryKey && this.operatorPresenceEntryKey !== nextKey) {
      this.clearOperatorPresence();
    }

    const signature = JSON.stringify({
      eventId,
      scheduleId,
      scheduleKey,
      scheduleLabel,
      sessionId,
      skipTelop
    });
    if (reason !== "heartbeat" && signature === this.operatorPresenceLastSignature) {
      this.scheduleOperatorPresenceHeartbeat();
      return;
    }
    this.operatorPresenceLastSignature = signature;

    const entryRef = getOperatorPresenceEntryRef(eventId, sessionId);
    this.operatorPresenceEntryKey = nextKey;
    this.operatorPresenceEntryRef = entryRef;

    const payload = {
      sessionId,
      uid,
      email: String(user?.email || "").trim(),
      displayName: String(user?.displayName || "").trim(),
      eventId: publishEvent ? eventId : "",
      eventName,
      scheduleId,
      scheduleKey,
      scheduleLabel,
      skipTelop,
      updatedAt: serverTimestamp(),
      clientTimestamp: Date.now(),
      reason,
      source: "operator"
    };

    if (typeof console !== "undefined" && typeof console.log === "function") {
      const timestamp = new Date().toISOString();
      const operatorName = String(payload.displayName || payload.email || uid || "").trim() || uid || "(unknown)";
      const eventLabel = String(eventId || payload.eventId || "").trim() || "(none)";
      const scheduleIdLabel = String(scheduleId || payload.scheduleId || "").trim();
      const scheduleNameLabel = String(scheduleLabel || payload.scheduleLabel || "").trim();
      let scheduleSummary = scheduleNameLabel || scheduleIdLabel;
      if (scheduleNameLabel && scheduleIdLabel && scheduleNameLabel !== scheduleIdLabel) {
        scheduleSummary = `${scheduleNameLabel} (${scheduleIdLabel})`;
      }
      if (!scheduleSummary) {
        scheduleSummary = "(none)";
      }
      console.log(
        `[OperatorPresence] ${timestamp} operator=${operatorName} event=${eventLabel} schedule=${scheduleSummary}`
      );
    }

    set(entryRef, payload).catch(() => {});

    try {
      if (this.operatorPresenceDisconnect) {
        this.operatorPresenceDisconnect.cancel().catch(() => {});
      }
      const disconnectHandle = onDisconnect(entryRef);
      this.operatorPresenceDisconnect = disconnectHandle;
      disconnectHandle.remove().catch(() => {});
    } catch (error) {
      // Ignore disconnect cleanup errors.
    }

    this.state.operatorPresenceSelf = {
      ...payload,
      updatedAt: Date.now()
    };

    this.scheduleOperatorPresenceHeartbeat();
    this.renderChannelBanner();
    this.evaluateScheduleConflict();
  }

  /**
   * 定期的にpresenceを更新するハートビートタイマーを設定します。
   */
  scheduleOperatorPresenceHeartbeat() {
    if (this.operatorPresenceHeartbeat) {
      return;
    }
    this.operatorPresenceHeartbeat = setInterval(() => this.touchOperatorPresence(), OPERATOR_PRESENCE_HEARTBEAT_MS);
  }

  /**
   * 現在のpresenceレコードにアクセスし、最終更新時刻をサーバータイムスタンプで更新します。
   * @returns {Promise<void>}
   */
  touchOperatorPresence() {
    if (!this.operatorPresenceEntryRef || !this.operatorPresenceEntryKey) {
      this.stopOperatorPresenceHeartbeat();
      return;
    }

    const ensure = (value) => {
      if (typeof value === "string") {
        return value.trim();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
      if (value === null || value === undefined) {
        return "";
      }
      return String(value).trim();
    };

    const uid = ensure(this.operatorIdentity?.uid || auth.currentUser?.uid || "");
    if (!uid || !this.isAuthorized) {
      this.clearOperatorPresence();
      return;
    }

    const selfEntry = this.state?.operatorPresenceSelf || null;
    const entryUid = ensure(selfEntry?.uid);
    if (!selfEntry || !entryUid || entryUid !== uid) {
      this.stopOperatorPresenceHeartbeat();
      this.operatorPresenceEntryRef = null;
      this.operatorPresenceEntryKey = "";
      this.operatorPresenceLastSignature = "";
      Promise.resolve().then(() =>
        this.syncOperatorPresence("heartbeat-recover", { allowFallback: true })
      );
      return;
    }

    const now = Date.now();
    update(this.operatorPresenceEntryRef, {
      clientTimestamp: now
    }).catch((error) => {
      const codeText = typeof error?.code === "string" ? error.code.toUpperCase() : "";
      const messageText = typeof error?.message === "string" ? error.message.toLowerCase() : "";
      const permissionDenied =
        codeText === "PERMISSION_DENIED" || messageText.includes("permission_denied");
      if (permissionDenied) {
        this.stopOperatorPresenceHeartbeat();
        this.operatorPresenceEntryRef = null;
        this.operatorPresenceEntryKey = "";
        this.operatorPresenceLastSignature = "";
        Promise.resolve().then(() =>
          this.syncOperatorPresence("heartbeat-recover", { allowFallback: true })
        );
      }
    });

    if (this.state.operatorPresenceSelf) {
      this.state.operatorPresenceSelf = {
        ...this.state.operatorPresenceSelf,
        clientTimestamp: now
      };
    }
  }

  /**
   * ハートビートタイマーを解除して、追加のpresence更新を停止します。
   */
  stopOperatorPresenceHeartbeat() {
    if (this.operatorPresenceHeartbeat) {
      clearInterval(this.operatorPresenceHeartbeat);
      this.operatorPresenceHeartbeat = null;
    }
  }

  /**
   * presenceから自身のエントリを削除し、ローカルに保持している参照も破棄します。
   * @returns {Promise<void>}
   */
  clearOperatorPresence() {
    this.stopOperatorPresenceHeartbeat();
    this.operatorPresenceSyncQueued = false;
    this.operatorPresenceLastSignature = "";
    this.operatorPresencePrimedEventId = "";
    this.operatorPresencePrimePromise = null;
    this.operatorPresencePrimeTargetEventId = "";
    this.operatorPresencePrimeRequestId += 1;
    const disconnectHandle = this.operatorPresenceDisconnect;
    this.operatorPresenceDisconnect = null;
    if (disconnectHandle && typeof disconnectHandle.cancel === "function") {
      disconnectHandle.cancel().catch(() => {});
    }
    const entryRef = this.operatorPresenceEntryRef;
    this.operatorPresenceEntryRef = null;
    const hadKey = !!this.operatorPresenceEntryKey;
    this.operatorPresenceEntryKey = "";
    const ensure = (value) => String(value ?? "").trim();
    const sessionId = ensure(this.operatorPresenceSessionId);
    if (entryRef && hadKey) {
      remove(entryRef).catch(() => {});
    } else {
      const uid = ensure(this.operatorIdentity?.uid || auth.currentUser?.uid || "");
      if (uid) {
        this.purgeOperatorPresenceSessionsForUser(uid, { excludeSessionId: sessionId });
      }
    }
    this.state.operatorPresenceSelf = null;
    this.clearOperatorPresenceIntent();
  }

  /**
   * オペレーターpresenceで使用する日程意図をクリアします。
   */
  clearOperatorPresenceIntent() {
    if (!this.state) {
      return;
    }
    this.state.operatorPresenceIntentId = "";
    this.state.operatorPresenceIntentLabel = "";
    this.state.operatorPresenceIntentKey = "";
  }

  /**
   * presenceで公開する日程意図を設定します。
   * @param {string} eventId
   * @param {string} scheduleId
   * @param {string} scheduleLabel
   */
  markOperatorPresenceIntent(eventId, scheduleId, scheduleLabel = "") {
    if (!this.state) {
      return;
    }
    const normalizedEvent = String(eventId || "").trim();
    const normalizedSchedule = normalizeScheduleId(scheduleId || "");
    const label = String(scheduleLabel || "").trim();
    const scheduleKey = normalizedEvent && normalizedSchedule ? `${normalizedEvent}::${normalizedSchedule}` : "";
    this.state.operatorPresenceIntentId = normalizedSchedule;
    this.state.operatorPresenceIntentLabel = label || normalizedSchedule;
    this.state.operatorPresenceIntentKey = scheduleKey;
  }

  /**
   * 現在のチャンネル割当状況をヘッダーバナーに描画します。
   * 表示端末との整合性やconflictの有無によって表示を切り替えます。
   */
  renderChannelBanner() {
    const banner = this.dom.channelBanner;
    if (!banner) {
      return;
    }
    const eventId = String(this.state?.activeEventId || "").trim();
    if (!eventId || !this.isAuthorized) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    const statusEl = this.dom.channelStatus;
    const assignmentEl = this.dom.channelAssignment;
    const lockButton = this.dom.channelLockButton;
    const displaySessionActive = !!this.state.displaySessionActive;
    const renderOnline = this.state.renderChannelOnline !== false;
    const displayActive = this.isDisplayOnline();
    const assignment = this.state?.channelAssignment || this.getDisplayAssignment();
    const channelAligned = !this.hasChannelMismatch();
    const telopEnabled = this.isTelopEnabled();
    const assetChecked = this.state.displayAssetChecked === true;
    const assetAvailable = this.state.displayAssetAvailable !== false;
    let statusText = "";
    let statusClass = "channel-banner__status";
    if (assetChecked && !assetAvailable) {
      statusText = "表示端末ページ（display.html）が見つかりません。";
      statusClass += " is-alert";
    } else if (!telopEnabled) {
      statusText = "テロップ操作なしモードです。送出・固定は行えません。";
      statusClass += " is-muted";
    } else if (!renderOnline) {
      statusText = "送出端末の表示画面が切断されています。";
      statusClass += " is-alert";
    } else if (!displaySessionActive) {
      statusText = "送出端末が接続されていません。";
      statusClass += " is-alert";
    } else if (!assignment || !assignment.eventId) {
      statusText = "ディスプレイの日程が未確定です。";
      statusClass += " is-alert";
    } else if (!channelAligned) {
      const summary = this.describeChannelAssignment();
      statusText = summary ? `ディスプレイは${summary}に固定されています。` : "ディスプレイは別の日程に固定されています。";
      statusClass += " is-alert";
    } else {
      statusText = "ディスプレイと日程が同期しています。";
    }
    if (statusEl) {
      statusEl.className = statusClass;
      statusEl.textContent = statusText;
    }
    if (assignmentEl) {
      const summary = this.describeChannelAssignment();
      assignmentEl.textContent = summary || "—";
    }
    if (lockButton) {
      if (assetChecked && !assetAvailable) {
        lockButton.textContent = "ページ未配置";
        lockButton.disabled = true;
      } else if (!telopEnabled) {
        lockButton.textContent = "テロップ操作なし";
        lockButton.disabled = true;
      } else {
        const { eventId: activeEventId, scheduleId } = this.getActiveChannel();
        const canLock =
          displayActive &&
          !!String(activeEventId || "").trim() &&
          !!String(scheduleId || "").trim() &&
          !this.state.channelLocking;
        if (displayActive && assignment && assignment.eventId && channelAligned) {
          lockButton.textContent = "固定済み";
          lockButton.disabled = true;
        } else {
          lockButton.textContent = assignment && assignment.eventId ? "この日程に切り替え" : "この日程に固定";
          lockButton.disabled = !canLock;
        }
        if (!displayActive) {
          lockButton.textContent = "この日程に固定";
        }
      }
    }
    this.renderChannelPresenceList();
  }

  /**
   * 現在イベントに参加しているオペレーター一覧を描画します。
   * 自身のpresenceやスキップ設定に応じて補足情報を加えます。
   */
  renderChannelPresenceList() {
    const list = this.dom.channelPresenceList;
    const placeholder = this.dom.channelPresenceEmpty;
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const eventId = String(this.state?.activeEventId || "").trim();
    if (!eventId) {
      if (placeholder) {
        placeholder.hidden = false;
      }
      return;
    }
    const presenceMap = this.state?.operatorPresenceByUser instanceof Map ? this.state.operatorPresenceByUser : new Map();
    const groups = new Map();
    const selfUid = String(this.operatorIdentity?.uid || auth.currentUser?.uid || "").trim();
    const selfSessionId = String(this.operatorPresenceSessionId || "").trim();
    presenceMap.forEach((value, entryId) => {
      if (!value) return;
      const valueEventId = String(value.eventId || "").trim();
      if (valueEventId && valueEventId !== eventId) return;
      const scheduleKey = this.derivePresenceScheduleKey(eventId, value, entryId);
      const label = this.resolveScheduleLabel(scheduleKey, value.scheduleLabel, value.scheduleId);
      const skipTelop = Boolean(value.skipTelop);
      const entry = groups.get(scheduleKey) || {
        key: scheduleKey,
        scheduleId: String(value.scheduleId || ""),
        label,
        members: []
      };
      if (!groups.has(scheduleKey)) {
        groups.set(scheduleKey, entry);
      }
      entry.label = entry.label || label;
      const memberUid = String(value.uid || "").trim();
      const fallbackId = String(entryId);
      const isSelfSession = selfSessionId && fallbackId === selfSessionId;
      const isSelfUid = memberUid && memberUid === selfUid;
      entry.members.push({
        uid: memberUid || fallbackId,
        name: String(value.displayName || value.email || memberUid || fallbackId || "").trim() || memberUid || fallbackId,
        isSelf: Boolean(isSelfSession || isSelfUid),
        skipTelop
      });
    });
    const items = Array.from(groups.values());
    if (!items.length) {
      if (placeholder) {
        placeholder.hidden = false;
      }
      return;
    }
    if (placeholder) {
      placeholder.hidden = true;
    }
    items.sort((a, b) => (a.label || "").localeCompare(b.label || "", "ja"));
    const currentKey = this.getCurrentScheduleKey();
    items.forEach((group) => {
      const item = document.createElement("li");
      item.className = "channel-presence-group";
      if (group.key && group.key === currentKey) {
        item.classList.add("is-active");
      }
      const title = document.createElement("div");
      title.className = "channel-presence-group__label";
      title.textContent = group.label || "未選択";
      item.appendChild(title);
      const members = document.createElement("div");
      members.className = "channel-presence-group__names";
      if (group.members && group.members.length) {
        group.members.forEach((member) => {
          const entry = document.createElement("span");
          entry.className = "channel-presence-group__name";
          entry.textContent = member.name || member.uid || "—";
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

  /**
   * presence衝突情報を元にダイアログのUIを更新します。
   * 選択肢の表示と操作ボタンの活性状態を整えます。
   */
  renderConflictDialog() {
    const conflict = this.state?.scheduleConflict;
    const optionsContainer = this.dom.conflictOptions;
    if (!optionsContainer) {
      return;
    }
    optionsContainer.innerHTML = "";
    if (this.dom.conflictError) {
      this.dom.conflictError.hidden = true;
      this.dom.conflictError.textContent = "";
    }
    if (!conflict || !Array.isArray(conflict.options) || conflict.options.length === 0) {
      return;
    }
    const radioName = "op-conflict-schedule";
    conflict.options.forEach((option, index) => {
      const optionKey = option.key || `${conflict.eventId}::${normalizeScheduleId(option.scheduleId || "")}`;
      const optionId = `op-conflict-option-${index}`;
      const labelEl = document.createElement("label");
      labelEl.className = "conflict-option";
      labelEl.setAttribute("for", optionId);

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.id = optionId;
      radio.name = radioName;
      radio.value = optionKey;
      radio.checked = optionKey === this.state.conflictSelection;
      radio.className = "visually-hidden";
      labelEl.appendChild(radio);

      const header = document.createElement("div");
      header.className = "conflict-option__header";
      const title = document.createElement("span");
      title.className = "conflict-option__title";
      title.textContent = this.resolveScheduleLabel(optionKey, option.label, option.scheduleId);
      header.appendChild(title);
      if (conflict.assignmentKey && conflict.assignmentKey === optionKey) {
        const badge = document.createElement("span");
        badge.className = "conflict-option__badge";
        badge.textContent = "ディスプレイ";
        header.appendChild(badge);
      }
      labelEl.appendChild(header);

      const members = document.createElement("div");
      members.className = "conflict-option__members";
      if (option.members && option.members.length) {
        members.textContent = option.members
          .map((member) => {
            const base = String(member.name || member.uid || "").trim() || member.uid;
            const tags = [];
            if (member.isSelf) {
              tags.push("自分");
            }
            if (member.skipTelop) {
              tags.push("テロップ操作なし");
            }
            if (!tags.length) {
              return base;
            }
            return `${base}（${tags.join("・")}）`;
          })
          .join("、");
      } else {
        members.textContent = "参加オペレーターなし";
      }
      labelEl.appendChild(members);

      optionsContainer.appendChild(labelEl);
    });
  }

  /**
   * ダイアログ要素を開き、フォーカスマネジメントを開始します。
   */
  openConflictDialog() {
    if (!this.dom.conflictDialog) {
      return;
    }
    Dialog.openDialog(this, this.dom.conflictDialog, this.dom.conflictConfirmButton);
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
    Dialog.closeDialog(this, this.dom.conflictDialog);
    this.conflictDialogOpen = false;
  }

  /**
   * 利用者が選択したスケジュールで表示端末のロックを試行します。
   * 選択肢が無効な場合は操作をブロックします。
   */
  submitConflictSelection() {
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
    const normalizedEvent = String(eventId || "").trim();
    const normalizedSchedule = String(scheduleId || "").trim();
    const label = String(scheduleLabel || "").trim();
    const fromModal = options?.fromModal === true;
    const silent = options?.silent === true;
    const assetChecked = this.state.displayAssetChecked === true;
    const assetAvailable = this.state.displayAssetAvailable !== false;
    if (assetChecked && !assetAvailable) {
      const message = "表示端末ページ（display.html）が配置されていないため固定できません。";
      if (fromModal && this.dom.conflictError) {
        this.dom.conflictError.textContent = message;
        this.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.toast(message, "error");
      }
      return;
    }
    if (!this.isTelopEnabled()) {
      const message = "テロップ操作なしモードでは固定できません。";
      if (fromModal && this.dom.conflictError) {
        this.dom.conflictError.textContent = message;
        this.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.toast(message, "error");
      }
      return;
    }
    if (!normalizedEvent) {
      const message = "イベントが選択されていないため固定できません。";
      if (fromModal && this.dom.conflictError) {
        this.dom.conflictError.textContent = message;
        this.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.toast(message, "error");
      }
      return;
    }
    if (!normalizedSchedule) {
      const message = "日程が選択されていないため固定できません。";
      if (fromModal && this.dom.conflictError) {
        this.dom.conflictError.textContent = message;
        this.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.toast(message, "error");
      }
      return;
    }
    if (this.state.channelLocking) {
      return;
    }
    this.state.channelLocking = true;
    this.renderChannelBanner();
    if (fromModal && this.dom.conflictConfirmButton) {
      this.dom.conflictConfirmButton.disabled = true;
    }
    if (fromModal && this.dom.conflictError) {
      this.dom.conflictError.hidden = true;
      this.dom.conflictError.textContent = "";
    }
    try {
      const response = await this.api.apiPost({
        action: "lockDisplaySchedule",
        eventId: normalizedEvent,
        scheduleId: normalizedSchedule,
        scheduleLabel: label,
        operatorName: String(this.operatorIdentity?.displayName || "").trim()
      });
      const normalizedScheduleId = normalizeScheduleId(normalizedSchedule);
      const fallbackLabel =
        label ||
        (normalizedScheduleId === "__default_schedule__"
          ? "未選択"
          : normalizedSchedule || normalizedScheduleId || normalizedEvent);
      const fallbackAssignment = {
        eventId: normalizedEvent,
        scheduleId: normalizedScheduleId,
        scheduleLabel: fallbackLabel,
        scheduleKey: `${normalizedEvent}::${normalizedScheduleId}`,
        lockedAt: Date.now(),
        lockedByUid: String(this.operatorIdentity?.uid || auth.currentUser?.uid || "").trim(),
        lockedByEmail: String(this.operatorIdentity?.email || "").trim(),
        lockedByName:
          String(this.operatorIdentity?.displayName || "").trim() ||
          String(this.operatorIdentity?.email || "").trim()
      };
      const appliedAssignment = response && response.assignment ? response.assignment : fallbackAssignment;
      this.applyAssignmentLocally(appliedAssignment);
      const committedEventId = String(appliedAssignment?.eventId || normalizedEvent).trim();
      const committedScheduleId = normalizeScheduleId(appliedAssignment?.scheduleId || normalizedScheduleId);
      const committedLabel =
        String(appliedAssignment?.scheduleLabel || "").trim() || fallbackLabel || committedScheduleId;
      const committedKey = committedEventId && committedScheduleId ? `${committedEventId}::${committedScheduleId}` : "";
      if (this.state) {
        this.state.committedScheduleId = committedScheduleId;
        this.state.committedScheduleLabel = committedLabel;
        this.state.committedScheduleKey = committedKey;
      }
      this.pageContext = {
        ...(this.pageContext || {}),
        eventId: committedEventId,
        scheduleId: committedScheduleId,
        scheduleKey: committedKey,
        scheduleLabel: committedLabel,
        selectionConfirmed: true
      };
      this.markOperatorPresenceIntent(committedEventId, committedScheduleId, committedLabel);
      this.updateScheduleContext({
        presenceReason: "schedule-commit",
        presenceOptions: { allowFallback: false, publishSchedule: true },
        trackIntent: true,
        selectionConfirmed: true
      });
      const summary = this.describeChannelAssignment();
      if (!silent) {
        this.toast(summary ? `${summary}に固定しました。` : "ディスプレイのチャンネルを固定しました。", "success");
      }
      this.state.autoLockAttemptKey = "";
      this.state.autoLockAttemptAt = 0;
      if (fromModal) {
        this.snoozeConflictDialog(this.currentConflictSignature);
        this.closeConflictDialog();
      }
      return appliedAssignment;
    } catch (error) {
      logDisplayLinkError("Failed to lock display schedule", {
        eventId: normalizedEvent || null,
        scheduleId: normalizeScheduleId(normalizedSchedule) || null,
        error
      });
      const message = error?.message || "日程の固定に失敗しました。";
      if (fromModal && this.dom.conflictError) {
        this.dom.conflictError.textContent = message;
        this.dom.conflictError.hidden = false;
      } else if (!silent) {
        this.toast(message, "error");
      }
    } finally {
      this.state.channelLocking = false;
      if (fromModal && this.dom.conflictConfirmButton) {
        this.dom.conflictConfirmButton.disabled = false;
      }
      this.renderChannelBanner();
      this.evaluateScheduleConflict();
    }
  }

  /**
   * 現在のpresence状況から衝突状態を特定するシグネチャを生成します。
   * シグネチャを使って前回の状態との差分を検出します。
   * @param {Array<{ key: string }>} options
   * @returns {string}
   */
  computeConflictSignature(options = []) {
    if (!Array.isArray(options) || options.length === 0) {
      return "";
    }
    const keys = options
      .map((option) => {
        if (!option || typeof option !== "object") {
          return "";
        }
        const key = String(option.key || "").trim();
        if (key) {
          return key;
        }
        const eventId = String(option.eventId || "").trim();
        const scheduleId = normalizeScheduleId(option.scheduleId || "");
        if (eventId && scheduleId) {
          return `${eventId}::${scheduleId}`;
        }
        return scheduleId || eventId;
      })
      .filter(Boolean)
      .sort();
    if (!keys.length) {
      return "";
    }
    return keys.join("|");
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
    if (!signature || !this.conflictDialogSnoozedSignature) {
      return false;
    }
    if (signature !== this.conflictDialogSnoozedSignature) {
      return false;
    }
    if (!channelAligned) {
      return false;
    }
    const currentKey = this.getCurrentScheduleKey();
    if (!currentKey) {
      return false;
    }
    if (assignmentAlignedKey && assignmentAlignedKey !== currentKey) {
      return false;
    }
    if (uniqueKeys && !uniqueKeys.has(currentKey)) {
      return false;
    }
    const targetOption = Array.isArray(options) ? options.find((option) => option && option.key === currentKey) : null;
    if (!targetOption) {
      return false;
    }
    const members = Array.isArray(targetOption.members) ? targetOption.members : [];
    if (!members.some((member) => member && member.isSelf)) {
      return false;
    }
    return true;
  }

  /**
   * displayセッションの割当変更をローカルstateに反映します。
   * レンダリングの更新とpresence評価を適宜行います。
   * @param {object|null} assignment
   */
  applyAssignmentLocally(assignment) {
    if (!assignment || typeof assignment !== "object") {
      return;
    }
    const eventId = String(assignment.eventId || "").trim();
    const scheduleId = String(assignment.scheduleId || "").trim();
    const scheduleLabel = String(assignment.scheduleLabel || "").trim();
    const normalizedScheduleId = normalizeScheduleId(scheduleId);
    const scheduleKey = eventId ? `${eventId}::${normalizedScheduleId}` : "";
    const enriched = {
      ...assignment,
      eventId,
      scheduleId,
      scheduleLabel,
      scheduleKey
    };
    const nextSession = {
      ...(this.state.displaySession || {}),
      assignment: enriched,
      eventId,
      scheduleId,
      scheduleLabel
    };
    // logDisplayLinkInfo("Applied display assignment", {
    //   eventId: eventId || null,
    //   scheduleId: normalizedScheduleId || null,
    //   scheduleLabel: scheduleLabel || null
    // });
    this.state.displaySession = nextSession;
    this.state.channelAssignment = enriched;
    this.state.autoLockAttemptKey = "";
    this.state.autoLockAttemptAt = 0;
  }

  /**
   * 衝突解消後に合意された日程へ自動的に合わせる処理を遅延実行でスケジュールします。
   * evaluateScheduleConflict内で直接stateを書き換えると再帰が発生するため、マイクロタスクで適用します。
   * @param {{ eventId?: string, scheduleId?: string, key?: string, label?: string, startAt?: string, endAt?: string }} option
   * @param {{ reason?: string, presenceOptions?: object, publishPresence?: boolean }} meta
   */
  scheduleConsensusAdoption(option, meta = {}) {
    if (!option || typeof option !== "object") {
      return;
    }
    const payload = {
      option: { ...option },
      meta: { ...meta }
    };
    this.pendingConsensusAdoption = payload;
    if (this.consensusAdoptionScheduled) {
      return;
    }
    this.consensusAdoptionScheduled = true;
    Promise.resolve().then(() => {
      this.consensusAdoptionScheduled = false;
      const pending = this.pendingConsensusAdoption;
      this.pendingConsensusAdoption = null;
      if (!pending || !pending.option) {
        return;
      }
      this.applyConsensusAdoption(pending.option, pending.meta || {});
    });
  }

  /**
   * 合意された日程をローカルstateとpresenceへ反映します。
   * @param {{ eventId?: string, scheduleId?: string, key?: string, label?: string, startAt?: string, endAt?: string }} option
   * @param {{ reason?: string, presenceOptions?: object, publishPresence?: boolean }} meta
   */
  applyConsensusAdoption(option, meta = {}) {
    if (!option || typeof option !== "object") {
      return;
    }
    const ensure = (value) => String(value ?? "").trim();
    const context = this.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const eventId = ensure(
      option.eventId || this.state?.activeEventId || (contextConfirmed ? context.eventId : "") || ""
    );
    const scheduleIdRaw = ensure(option.scheduleId || "");
    const scheduleId = normalizeScheduleId(scheduleIdRaw);
    const keyCandidate = ensure(option.key);
    const scheduleKey = keyCandidate || (eventId && scheduleId ? `${eventId}::${scheduleId}` : "");
    if (!eventId || !scheduleId || !scheduleKey) {
      return;
    }

    const resolvedLabel = this.resolveScheduleLabel(scheduleKey, option.label, option.scheduleId);
    const reason = ensure(meta.reason) || "consensus-adopt";
    const publishPresence = meta.publishPresence !== false;
    const presenceOptions = {
      allowFallback: false,
      ...(meta.presenceOptions || {})
    };

    const contextStart = ensure(option.startAt || option.scheduleStart || this.pageContext?.startAt || "");
    const contextEnd = ensure(option.endAt || option.scheduleEnd || this.pageContext?.endAt || "");

    this.pageContext = {
      ...(this.pageContext || {}),
      eventId,
      scheduleId,
      scheduleKey,
      scheduleLabel: resolvedLabel,
      startAt: contextStart,
      endAt: contextEnd,
      selectionConfirmed: true
    };

    Questions.updateScheduleContext(this, {
      syncPresence: false,
      presenceOptions,
      selectionConfirmed: true
    });

    this.state.conflictSelection = scheduleKey;
    this.markOperatorPresenceIntent(eventId, scheduleId, resolvedLabel);

    if (publishPresence) {
      this.syncOperatorPresence(reason, {
        allowFallback: false,
        publishSchedule: true,
        useActiveSchedule: true
      });
    }
  }

  /**
   * presence情報と割当を照合し、衝突ダイアログの表示や自動ロックを制御します。
   */
  evaluateScheduleConflict() {
    if (!this.isTelopEnabled()) {
      this.state.scheduleConflict = null;
      this.state.conflictSelection = "";
      this.closeConflictDialog();
      return;
    }
    const eventId = String(this.state?.activeEventId || "").trim();
    if (!eventId) {
      this.state.scheduleConflict = null;
      this.state.conflictSelection = "";
      this.closeConflictDialog();
      return;
    }
    const selectionConfirmed = this.state?.selectionConfirmed === true;
    const presenceMap = this.state?.operatorPresenceByUser instanceof Map ? this.state.operatorPresenceByUser : new Map();
    const groups = new Map();
    let latestPresenceAt = 0;
    const selfUid = String(this.operatorIdentity?.uid || auth.currentUser?.uid || "").trim();
    const selfSessionId = String(this.operatorPresenceSessionId || "").trim();
    presenceMap.forEach((value, entryId) => {
      if (!value) return;
      const valueEventId = String(value.eventId || "").trim();
      if (valueEventId && valueEventId !== eventId) return;
      const resolvedEventId = valueEventId || eventId;
      const scheduleId = String(value.scheduleId || "").trim();
      if (!scheduleId) {
        return;
      }
      const scheduleKey = this.derivePresenceScheduleKey(resolvedEventId, value, entryId);
      const label = this.resolveScheduleLabel(scheduleKey, value.scheduleLabel, value.scheduleId);
      const skipTelop = Boolean(value.skipTelop);
      const entry = groups.get(scheduleKey) || {
        key: scheduleKey,
        eventId: resolvedEventId || eventId,
        scheduleId,
        label,
        members: []
      };
      if (!groups.has(scheduleKey)) {
        groups.set(scheduleKey, entry);
      }
      entry.label = entry.label || label;
      const memberUid = String(value.uid || "").trim();
      const isSelfSession = selfSessionId && String(entryId) === selfSessionId;
      const isSelfUid = memberUid && memberUid === selfUid;
      const fallbackId = String(entryId);
      const updatedAt = Number(value.updatedAt || value.clientTimestamp || 0);
      if (updatedAt > latestPresenceAt) {
        latestPresenceAt = updatedAt;
      }
      entry.members.push({
        uid: memberUid || fallbackId,
        name: String(value.displayName || value.email || memberUid || fallbackId || "").trim() || memberUid || fallbackId,
        isSelf: Boolean(isSelfSession || isSelfUid),
        skipTelop,
        updatedAt
      });
    });
    const assignment = this.state?.channelAssignment || this.getDisplayAssignment();
    const assignmentKey = assignment && assignment.eventId ? `${assignment.eventId}::${normalizeScheduleId(assignment.scheduleId || "")}` : "";
    if (assignment && assignment.eventId && assignmentKey && !groups.has(assignmentKey)) {
      const label = this.resolveScheduleLabel(assignmentKey, assignment.scheduleLabel, assignment.scheduleId);
      groups.set(assignmentKey, {
        key: assignmentKey,
        eventId: assignment.eventId,
        scheduleId: String(assignment.scheduleId || ""),
        label,
        members: []
      });
    }
    const options = Array.from(groups.values());
    if (!options.length) {
      this.state.autoLockAttemptKey = "";
      this.state.autoLockAttemptAt = 0;
      this.state.scheduleConflict = null;
      this.state.conflictSelection = "";
      this.closeConflictDialog();
      this.currentConflictSignature = "";
      this.conflictDialogSnoozedSignature = "";
      return;
    }
    options.sort((a, b) => (a.label || "").localeCompare(b.label || "", "ja"));
    const conflictSignature = this.computeConflictSignature(options);
    if (conflictSignature && this.conflictDialogSnoozedSignature && conflictSignature !== this.conflictDialogSnoozedSignature) {
      this.conflictDialogSnoozedSignature = "";
    }
    this.currentConflictSignature = conflictSignature;
    const resolveOptionKey = (option) => {
      if (!option || typeof option !== "object") {
        return "";
      }
      const explicitKey = String(option.key || "").trim();
      if (explicitKey) {
        return explicitKey;
      }
      const optionEventId = String(option.eventId || eventId || "").trim();
      const optionScheduleId = normalizeScheduleId(option.scheduleId || "");
      if (optionEventId && optionScheduleId) {
        return `${optionEventId}::${optionScheduleId}`;
      }
      if (optionScheduleId) {
        return optionScheduleId;
      }
      return explicitKey;
    };

    const uniqueKeys = new Set(options.map((opt) => resolveOptionKey(opt) || ""));
    uniqueKeys.delete("");
    const presenceHasMultipleSchedules = uniqueKeys.size > 1;
    const hasPresence = options.length > 0;
    let channelAligned = !this.hasChannelMismatch();
    const assignmentTimestamp = Number(
      (this.state?.channelAssignment &&
        (this.state.channelAssignment.updatedAt || this.state.channelAssignment.lockedAt)) ||
        (assignment && (assignment.updatedAt || assignment.lockedAt)) ||
        0
    );
    const presenceNewerThanAssignment =
      latestPresenceAt > assignmentTimestamp || (assignmentTimestamp === 0 && hasPresence);
    const now = Date.now();
    const selfEntry = this.state?.operatorPresenceSelf || null;
    const selfEntrySessionId = String(selfEntry?.sessionId || this.operatorPresenceSessionId || "").trim();
    const selfEntryEventId = String(selfEntry?.eventId || eventId || "").trim();
    let selfPresenceKey = selfEntry
      ? this.derivePresenceScheduleKey(selfEntryEventId, selfEntry, selfEntrySessionId || selfEntry?.sessionId || "")
      : "";
    if (!selfPresenceKey) {
      selfPresenceKey = this.getCurrentScheduleKey();
    }

    let winningOption = null;
    let winningKey = "";
    if (assignmentKey && uniqueKeys.has(assignmentKey)) {
      winningKey = assignmentKey;
      winningOption = options.find((opt) => resolveOptionKey(opt) === assignmentKey) || null;
    }
    if (!winningKey) {
      let bestTimestamp = Number.POSITIVE_INFINITY;
      options.forEach((opt) => {
        const timestamps = Array.isArray(opt?.members)
          ? opt.members.map((member) => Number(member?.updatedAt || 0)).filter((value) => value > 0)
          : [];
        const earliest = timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY;
        if (!winningOption || earliest < bestTimestamp) {
          winningOption = opt;
          bestTimestamp = earliest;
        }
      });
      if (!winningOption && options.length) {
        winningOption = options[0];
      }
      winningKey = resolveOptionKey(winningOption);
    }
    const selfHasSchedule = !!selfPresenceKey;
    const selfOnWinning = Boolean(winningKey && selfPresenceKey && selfPresenceKey === winningKey);
    if (uniqueKeys.size === 1) {
      const [soleKeyCandidate] = uniqueKeys;
      let consensusOption = null;
      if (soleKeyCandidate) {
        consensusOption = options.find((opt) => opt && (opt.key === soleKeyCandidate || opt.scheduleId === soleKeyCandidate));
      }
      if (!consensusOption && options.length) {
        consensusOption = options[0];
      }
      if (consensusOption && selectionConfirmed) {
        const consensusEventId = String(consensusOption.eventId || eventId || "").trim();
        const consensusScheduleId = normalizeScheduleId(consensusOption.scheduleId || "");
        const consensusKey =
          String(consensusOption.key || "").trim() ||
          (consensusEventId && consensusScheduleId ? `${consensusEventId}::${consensusScheduleId}` : "");
        const currentKey = this.getCurrentScheduleKey();
        const needsAlignment = consensusKey && (currentKey !== consensusKey || !channelAligned);
        if (needsAlignment) {
          const assignmentMatches = assignmentKey && consensusKey ? assignmentKey === consensusKey : !assignmentKey;
          this.scheduleConsensusAdoption(consensusOption, {
            reason: assignmentMatches ? "assignment-align" : "consensus-adopt",
            presenceOptions: { allowFallback: false },
            publishPresence: true
          });
          if (!assignmentKey || assignmentMatches) {
            channelAligned = true;
          }
        }
      }
    }

    let shouldPrompt = false;
    if (hasPresence && presenceNewerThanAssignment && selfHasSchedule) {
      if (presenceHasMultipleSchedules) {
        shouldPrompt = !selfOnWinning;
      } else if (assignmentKey && (!uniqueKeys.has(assignmentKey) || !channelAligned)) {
        shouldPrompt = !selfOnWinning;
      } else if (!channelAligned && assignmentKey) {
        shouldPrompt = !selfOnWinning;
      }
    }
    const assignmentAlignedKey = assignmentKey && uniqueKeys.has(assignmentKey) ? assignmentKey : "";
    const suppressed = this.isConflictDialogSnoozed(conflictSignature, options, {
      uniqueKeys,
      channelAligned,
      assignmentAlignedKey
    });
    if (uniqueKeys.size === 1) {
      const soleOption = options[0] || null;
      const soleKey = soleOption?.key || "";
      const attemptKey = String(this.state?.autoLockAttemptKey || "").trim();
      const attemptAt = Number(this.state?.autoLockAttemptAt || 0);
      const recentlyAttempted = soleKey && attemptKey === soleKey && attemptAt && now - attemptAt < 15000;
      const targetEventId = String((soleOption?.eventId || eventId) || "").trim();
      const targetScheduleId = String(soleOption?.scheduleId || "").trim();
      const assignmentMatches = Boolean(assignmentKey && assignmentKey === soleKey && channelAligned);
      if (assignmentMatches) {
        this.state.autoLockAttemptKey = "";
        this.state.autoLockAttemptAt = 0;
      }
      const members = Array.isArray(soleOption?.members) ? soleOption.members : [];
      const hasTelopOperators = members.some((member) => member && !member.skipTelop);
      const canLock = Boolean(targetEventId && targetScheduleId && soleKey && hasTelopOperators);
      if (!assignmentMatches && canLock && !recentlyAttempted && !this.state.channelLocking) {
        this.state.autoLockAttemptKey = soleKey;
        this.state.autoLockAttemptAt = now;
        this.lockDisplayToSchedule(targetEventId, targetScheduleId, soleOption?.label || "", { silent: true, autoLock: true });
        return;
      }
    }
    if (!shouldPrompt) {
      this.state.scheduleConflict = null;
      this.state.conflictSelection = "";
      this.closeConflictDialog();
      if (!uniqueKeys.size) {
        this.conflictDialogSnoozedSignature = "";
      }
      return;
    }
    if (suppressed) {
      this.state.scheduleConflict = { eventId, assignmentKey, options };
      if (!this.state.conflictSelection || !uniqueKeys.has(this.state.conflictSelection)) {
        const preferredKey = this.getCurrentScheduleKey();
        if (uniqueKeys.has(preferredKey)) {
          this.state.conflictSelection = preferredKey;
        } else if (assignmentKey && uniqueKeys.has(assignmentKey)) {
          this.state.conflictSelection = assignmentKey;
        } else {
          this.state.conflictSelection = options[0]?.key || "";
        }
      }
      if (this.conflictDialogOpen) {
        this.closeConflictDialog();
      }
      return;
    }
    this.state.scheduleConflict = { eventId, assignmentKey, options };
    if (!this.state.conflictSelection || !uniqueKeys.has(this.state.conflictSelection)) {
      const preferredKey = this.getCurrentScheduleKey();
      if (uniqueKeys.has(preferredKey)) {
        this.state.conflictSelection = preferredKey;
      } else if (assignmentKey && uniqueKeys.has(assignmentKey)) {
        this.state.conflictSelection = assignmentKey;
      } else {
        this.state.conflictSelection = options[0]?.key || "";
      }
    }
    this.renderConflictDialog();
    if (!this.conflictDialogOpen) {
      this.openConflictDialog();
    }
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
    Dialog.closeDialog(this, this.activeDialog);
  }

  /**
   * 埋め込み環境などから渡された外部コンテキストをstateに適用します。
   * 受領直後にpresence同期と表示の更新を実行します。
   * @param {Record<string, any>} context
   */
  setExternalContext(context = {}) {
    const ensure = (value) => String(value ?? "").trim();
    const ownerUid = ensure(context.ownerUid || context.operatorUid || context.uid);
    if (ownerUid) {
      const currentUid = ensure(this.operatorIdentity?.uid || auth.currentUser?.uid || "");
      if (!currentUid) {
        this.pendingExternalContext = { ...context };
        return;
      }
      if (ownerUid !== currentUid) {
        return;
      }
    }
    const eventId = ensure(context.eventId);
    const scheduleId = ensure(context.scheduleId);
    const eventName = ensure(context.eventName);
    const scheduleLabel = ensure(context.scheduleLabel);
    const committedScheduleId = ensure(context.committedScheduleId);
    const committedScheduleLabel = ensure(context.committedScheduleLabel);
    const committedScheduleKey = ensure(context.committedScheduleKey);
    const startAt = ensure(context.startAt);
    const endAt = ensure(context.endAt);
    const scheduleKeyFromContext = ensure(context.scheduleKey);
    const presenceEntryId = ensure(context.presenceEntryId || context.entryId || context.sessionId);
    const scheduleKey = this.derivePresenceScheduleKey(
      eventId,
      { scheduleKey: scheduleKeyFromContext, scheduleId, scheduleLabel },
      presenceEntryId
    );
    const resolvedCommittedKey = this.derivePresenceScheduleKey(
      eventId,
      {
        scheduleKey: committedScheduleKey,
        scheduleId: committedScheduleId,
        scheduleLabel: committedScheduleLabel
      },
      presenceEntryId
    );
    const operatorMode = normalizeOperatorMode(context.operatorMode ?? context.mode);

    this.clearOperatorPresenceIntent();

    const selectionConfirmed = context.selectionConfirmed === true;
    const effectiveEventId = selectionConfirmed ? eventId : "";
    const baseContext = { ...(this.pageContext || {}) };
    if (!selectionConfirmed) {
      baseContext.eventId = "";
      baseContext.scheduleId = "";
      baseContext.eventName = "";
      baseContext.scheduleLabel = "";
      baseContext.startAt = "";
      baseContext.endAt = "";
      baseContext.scheduleKey = "";
      baseContext.committedScheduleId = "";
      baseContext.committedScheduleLabel = "";
      baseContext.committedScheduleKey = "";
    }

    this.pageContext = {
      ...baseContext,
      eventId: selectionConfirmed ? eventId : "",
      scheduleId: selectionConfirmed ? scheduleId : "",
      eventName: selectionConfirmed ? eventName : "",
      scheduleLabel: selectionConfirmed ? scheduleLabel : "",
      committedScheduleId: selectionConfirmed ? committedScheduleId : "",
      committedScheduleLabel: selectionConfirmed ? committedScheduleLabel : "",
      committedScheduleKey: selectionConfirmed ? resolvedCommittedKey : "",
      startAt: selectionConfirmed ? startAt : "",
      endAt: selectionConfirmed ? endAt : "",
      scheduleKey: selectionConfirmed ? scheduleKey : "",
      operatorMode,
      selectionConfirmed
    };

    this.operatorMode = operatorMode;

    this.applyContextToState();

    if (!this.state.scheduleMetadata || !(this.state.scheduleMetadata instanceof Map)) {
      this.state.scheduleMetadata = new Map();
    }

    if (scheduleKey) {
      this.state.scheduleMetadata.set(scheduleKey, {
        key: scheduleKey,
        eventId,
        scheduleId,
        eventName,
        label: scheduleLabel || scheduleId,
        startAt,
        endAt
      });
    }
    if (resolvedCommittedKey) {
      this.state.scheduleMetadata.set(resolvedCommittedKey, {
        key: resolvedCommittedKey,
        eventId,
        scheduleId: committedScheduleId,
        eventName,
        label: committedScheduleLabel || committedScheduleId,
        startAt,
        endAt
      });
    }

    if (this.isAuthorized) {
      if (this.dom.mainContainer) {
        this.dom.mainContainer.style.display = "";
        this.dom.mainContainer.hidden = false;
      }
      if (this.dom.actionPanel) {
        this.dom.actionPanel.style.display = "flex";
        this.dom.actionPanel.hidden = false;
      }
    }

    const presenceOptions = selectionConfirmed
      ? { allowFallback: false }
      : { allowFallback: false, publishSchedule: false, publishEvent: false, useActiveSchedule: false };
    this.updateScheduleContext({ syncPresence: false, presenceOptions });
    this.refreshChannelSubscriptions();
    if (this.operatorPresencePrimedEventId && this.operatorPresencePrimedEventId !== effectiveEventId) {
      this.operatorPresencePrimedEventId = "";
    }
    this.primeOperatorPresenceSession(effectiveEventId).finally(() =>
      this.syncOperatorPresence("context-sync", presenceOptions)
    );
    this.renderChannelBanner();
    this.renderQuestions();
    this.updateActionAvailability();
    this.updateBatchButtonVisibility();
  }

  /**
   * 埋め込み利用時に外部ホストが完了通知を送るまで待機します。
   * 通常利用では即座に解決します。
   * @returns {Promise<void>}
   */
  waitUntilReady() {
    if (this.isAuthorized) {
      return Promise.resolve();
    }
    if (this.embedReadyDeferred?.promise) {
      return this.embedReadyDeferred.promise;
    }
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    this.embedReadyDeferred = { promise, resolve };
    return promise;
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
      this.handleAuthState(user);
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
      this.state.displayAssetChecked = true;
      this.state.displayAssetChecking = false;
      this.displayAssetProbe = null;
      this.updateActionAvailability();
      this.renderChannelBanner();
      return normalized;
    };
    if (!this.state.displayAssetChecking) {
      this.state.displayAssetChecking = true;
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
      if (event.key === "Escape") {
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
    const btn = this.dom.loginButton;
    const originalText = btn ? btn.textContent : "";
    try {
      this.authFlow = "prompting";
      this.showLoader("サインイン中…");
      if (btn) {
        btn.disabled = true;
        btn.classList.add("is-busy");
        btn.textContent = "サインイン中…";
      }
      await signInWithPopup(auth, provider);
    } catch (error) {
      this.toast("ログインに失敗しました。", "error");
      this.hideLoader();
    } finally {
      this.authFlow = "done";
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-busy");
        btn.textContent = originalText;
      }
      if (this.pendingAuthUser !== null) {
        const user = this.pendingAuthUser;
        this.pendingAuthUser = null;
        this.handleAuthState(user);
      }
    }
  }

  async logout() {
    try {
      await signOut(auth);
    } catch (error) {
      // Ignore logout errors; UI state will refresh on auth callbacks.
    }
    this.authFlow = "idle";
    this.pendingAuthUser = null;
    this.preflightContext = null;
    this.hideLoader();
  }

  loadPreflightContextForUser(user) {
    if (!user) {
      return null;
    }
    const context = loadAuthPreflightContext();
    if (!context) {
      return null;
    }
    if (!preflightContextMatchesUser(context, user)) {
      return null;
    }
    return context;
  }

  async handleAuthState(user) {
    if (!user) {
      this.preflightContext = null;
      this.showLoggedOutState();
      return;
    }
    this.preflightContext = this.loadPreflightContextForUser(user);
    const preflight = this.preflightContext;
    try {
      this.showLoader(this.isEmbedded ? "利用準備を確認しています…" : "権限を確認しています…");
      this.initLoaderSteps();
      const loginEmail = String(user.email || "").trim().toLowerCase();
      if (!preflight) {
        this.setLoaderStep(0, this.isEmbedded ? "利用状態を確認しています…" : "認証OK。ユーザー情報を確認中…");
        const result = await this.api.apiPost({ action: "fetchSheet", sheet: "users" });
        this.setLoaderStep(1, this.isEmbedded ? "必要な設定を確認しています…" : "在籍チェック中…");
        if (!result.success || !result.data) {
          throw new Error("ユーザー権限の確認に失敗しました。");
        }
        const authorizedUsers = result.data
          .map((item) => String(item["メールアドレス"] || "").trim().toLowerCase())
          .filter(Boolean);
        if (!authorizedUsers.includes(loginEmail)) {
          this.toast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", "error");
          await this.logout();
          this.hideLoader();
          return;
        }
      } else {
        this.setLoaderStep(0, this.isEmbedded ? "プリフライト結果を確認しています…" : "プリフライト結果を適用しています…");
        this.setLoaderStep(1, this.isEmbedded ? "権限キャッシュを適用しています…" : "在籍チェックをスキップしました。");
      }

      const shouldEnsureAdmin = !preflight?.admin?.ensuredAt;
      if (shouldEnsureAdmin) {
        this.setLoaderStep(2, this.isEmbedded ? "必要な権限を同期しています…" : "管理者権限の確認/付与…");
        try {
          await this.api.apiPost({ action: "ensureAdmin" });
        } catch (error) {
          // Allow the operator to continue even if ensureAdmin fails.
        }
      } else {
        this.setLoaderStep(2, this.isEmbedded ? "管理者権限を適用しています…" : "管理者権限はプリフライト済みです。");
      }

      await this.renderLoggedInUi(user);
      this.setLoaderStep(3, this.isEmbedded ? "初期データを準備しています…" : "初期ミラーを確認しています…");
      this.updateLoader("初期データを準備しています…");
      let questionsSnapshot = null;
      try {
        questionsSnapshot = await get(questionsRef);
      } catch (error) {
        console.warn("Failed to load questions before subscriptions", error);
      }

      const hasQuestions = questionsSnapshot?.exists?.() && questionsSnapshot.exists();
      if (!hasQuestions) {
        this.setLoaderStep(3, this.isEmbedded ? "プリフライト済みの空データを適用しています…" : "プリフライトの結果を適用しています…");
      }

      this.setLoaderStep(4, this.isEmbedded ? "リアルタイム購読を開始しています…" : "購読開始…");
      this.updateLoader("データ同期中…");
      const [questionStatusSnapshot, eventsSnapshot, schedulesSnapshot] = await Promise.all([
        get(questionStatusRef),
        get(questionIntakeEventsRef),
        get(questionIntakeSchedulesRef)
      ]);
      const questionsValue = hasQuestions && questionsSnapshot?.val ? questionsSnapshot.val() || {} : {};
      this.eventsBranch = eventsSnapshot.val() || {};
      this.schedulesBranch = schedulesSnapshot.val() || {};
      this.applyQuestionsBranch(questionsValue);
      this.applyQuestionStatusSnapshot(questionStatusSnapshot.val() || {});
      this.rebuildScheduleMetadata();
      this.applyContextToState();
      this.startQuestionsStream();
      this.startQuestionStatusStream();
      this.startScheduleMetadataStreams();
      this.fetchDictionary().catch((error) => {
        console.error("辞書の取得に失敗しました", error);
      });
      this.startDictionaryListener();
      this.startPickupListener();
      this.startDisplaySessionMonitor();
      this.startDisplayPresenceMonitor();
      this.fetchLogs().catch((error) => {
        console.error("ログの取得に失敗しました", error);
      });
      this.finishLoaderSteps("準備完了");
      this.hideLoader();
      this.toggleDictionaryDrawer(!!this.preferredDictionaryOpen, false);
      this.toggleLogsDrawer(!!this.preferredLogsOpen, false);
      this.toast(`ようこそ、${user.displayName || ""}さん`, "success");
      this.startLogsUpdateMonitor();
      this.resolveEmbedReady();
    } catch (error) {
      this.toast("ユーザー権限の確認中にエラーが発生しました。", "error");
      await this.logout();
      this.hideLoader();
    }
  }

  /**
   * ログイン済みユーザー向けにUIを初期化し、必要な購読を開始します。
   * @param {import("firebase/auth").User} user
   * @returns {Promise<void>}
   */
  async renderLoggedInUi(user) {
    const previousUid = String(this.operatorIdentity?.uid || "").trim();
    const nextUid = String(user?.uid || "").trim();
    const wasAuthorized = this.isAuthorized === true;
    this.redirectingToIndex = false;
    this.operatorIdentity = {
      uid: nextUid,
      email: String(user?.email || "").trim(),
      displayName: String(user?.displayName || "").trim()
    };
    if (this.dom.loginContainer) this.dom.loginContainer.style.display = "none";
    if (this.dom.mainContainer) {
      this.dom.mainContainer.style.display = "";
      this.dom.mainContainer.hidden = false;
    }
    if (this.dom.actionPanel) {
      this.dom.actionPanel.style.display = "flex";
      this.dom.actionPanel.hidden = false;
    }
    const userChanged = !wasAuthorized || !previousUid || previousUid !== nextUid;
    this.isAuthorized = true;
    if (userChanged) {
      this.operatorMode = OPERATOR_MODE_TELOP;
      this.stopOperatorPresenceHeartbeat();
      this.operatorPresenceSyncQueued = false;
      this.operatorPresenceEntryKey = "";
      this.operatorPresenceEntryRef = null;
      this.operatorPresenceLastSignature = "";
      this.operatorPresenceSessionId = this.generatePresenceSessionId();
      this.operatorPresencePrimedEventId = "";
      this.operatorPresencePrimePromise = null;
      this.operatorPresencePrimeTargetEventId = "";
      await this.purgeOperatorPresenceSessionsForUser(nextUid, {
        excludeSessionId: String(this.operatorPresenceSessionId || "")
      });
      if (this.state) {
        this.state.operatorPresenceEventId = "";
        this.state.operatorPresenceByUser = new Map();
        this.state.operatorPresenceSelf = null;
      }
      this.resetPageContextSelection();
      if (this.pageContext && typeof this.pageContext === "object") {
        this.pageContext.operatorMode = OPERATOR_MODE_TELOP;
      }
      this.applyContextToState();
      if (typeof this.clearOperatorPresenceIntent === "function") {
        this.clearOperatorPresenceIntent();
      }
      Questions.updateScheduleContext(this, {
        syncPresence: false,
        trackIntent: false,
        presenceReason: "context-reset",
        selectionConfirmed: false,
        presenceOptions: {
          allowFallback: false,
          publishSchedule: false,
          publishEvent: false,
          useActiveSchedule: false
        }
      });
      this.renderChannelBanner();
      this.evaluateScheduleConflict();
    }
    if (this.dom.userInfo) {
      this.dom.userInfo.innerHTML = "";
      const label = document.createElement("span");
      label.className = "user-label";
      const safeDisplayName = String(user.displayName || "").trim();
      const safeEmail = String(user.email || "").trim();
      label.textContent = safeDisplayName && safeEmail ? `${safeDisplayName} (${safeEmail})` : safeDisplayName || safeEmail || "";
      const logoutButton = document.createElement("button");
      logoutButton.id = "logout-button";
      logoutButton.type = "button";
      logoutButton.textContent = "ログアウト";
      logoutButton.className = "btn btn-ghost btn-sm";
      logoutButton.addEventListener("click", () => this.logout());
      this.dom.userInfo.append(label, logoutButton);
      this.dom.userInfo.hidden = false;
    }
    if (this.pendingExternalContext) {
      const pendingContext = this.pendingExternalContext;
      this.pendingExternalContext = null;
      this.setExternalContext(pendingContext);
    }
    this.applyPreferredSubTab();
    const context = this.pageContext || {};
    const contextConfirmed = context.selectionConfirmed === true;
    const activeEventId = String(
      this.state?.activeEventId || (contextConfirmed ? context.eventId : "") || ""
    ).trim();
    if (this.operatorPresencePrimedEventId && this.operatorPresencePrimedEventId !== activeEventId) {
      this.operatorPresencePrimedEventId = "";
    }
    this.primeOperatorPresenceSession(activeEventId).finally(() => this.syncOperatorPresence());
    this.refreshOperatorPresenceSubscription();
  }

  /**
   * 未ログイン時のUIを表示し、リアルタイム購読やpresenceを解放します。
   */
  showLoggedOutState() {
    if (this.redirectingToIndex) {
      return;
    }
    const ensure = (value) => String(value ?? "").trim();
    const previousUid = ensure(this.operatorIdentity?.uid || auth.currentUser?.uid || "");
    const sessionId = ensure(this.operatorPresenceSessionId);
    if (previousUid) {
      this.purgeOperatorPresenceSessionsForUser(previousUid, { excludeSessionId: sessionId });
    }
    this.isAuthorized = false;
    this.operatorIdentity = { uid: "", email: "", displayName: "" };
    this.dictionaryLoaded = false;
    this.toggleDictionaryDrawer(false, false);
    this.toggleLogsDrawer(false, false);
    this.cleanupRealtime();
    if (this.isEmbedded) {
      this.showLoader("サインイン状態を確認しています…");
    } else {
      this.hideLoader();
    }
    this.closeEditDialog();
    if (this.dom.loginContainer) {
      this.dom.loginContainer.style.display = this.isEmbedded ? "none" : "";
    }
    if (!this.isEmbedded && this.dom.loginButton) {
      this.dom.loginButton.disabled = false;
    }
    if (this.dom.mainContainer) {
      this.dom.mainContainer.style.display = "none";
    }
    if (this.dom.actionPanel) {
      this.dom.actionPanel.style.display = "none";
      this.dom.actionPanel.hidden = true;
    }
    if (this.dom.userInfo) {
      this.dom.userInfo.hidden = true;
      this.dom.userInfo.innerHTML = "";
    }
    if (typeof window !== "undefined" && !this.isEmbedded) {
      this.redirectingToIndex = true;
      goToLogin();
    }
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
    this.displayPresenceLastRefreshAt = 0;
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
    if (typeof this.stopDictionaryListener === "function") {
      this.stopDictionaryListener();
    }
    if (typeof this.stopPickupListener === "function") {
      this.stopPickupListener();
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
    this.operatorPresenceSubscribedEventId = "";
    this.state.operatorPresenceEventId = "";
    this.state.operatorPresenceByUser = new Map();
    this.state.operatorPresenceSelf = null;
    this.state.channelAssignment = null;
    this.state.channelLocking = false;
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
    if (this.dom.cardsContainer) this.dom.cardsContainer.innerHTML = "";
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
   * 質問状態ノードの購読を開始し、ステータスの変化を反映します。
   */
  startQuestionStatusStream() {
    if (this.questionStatusUnsubscribe) this.questionStatusUnsubscribe();
    this.questionStatusUnsubscribe = onValue(questionStatusRef, (snapshot) => {
      this.applyQuestionStatusSnapshot(snapshot.val());
    });
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
   * @param {Record<string, any>} value
   */
  applyQuestionStatusSnapshot(value) {
    const branch = value && typeof value === "object" ? value : {};
    const next = new Map();
    Object.entries(branch).forEach(([uidKey, record]) => {
      if (!record || typeof record !== "object") {
        return;
      }
      const resolvedUid = String(record.uid ?? uidKey ?? "").trim();
      if (!resolvedUid) {
        return;
      }
      next.set(resolvedUid, {
        answered: record.answered === true,
        selecting: record.selecting === true,
        pickup: record.pickup === true,
        updatedAt: Number(record.updatedAt || 0)
      });
    });
    this.state.questionStatusByUid = next;
    this.rebuildQuestions();
  }

  /**
   * 生の質問データをUI表示用に整形します。
   * @param {Record<string, any>} item
   * @returns {import("./questions.js").QuestionRecord}
   */
  normalizeQuestionRecord(item) {
    const record = item && typeof item === "object" ? item : {};
    const eventId = String(record.eventId ?? "").trim();
    const rawScheduleId = String(record.scheduleId ?? "").trim();
    const fallbackLabel = String(record.scheduleLabel ?? record.schedule ?? "").trim();
    const normalizedScheduleId = eventId ? normalizeScheduleId(rawScheduleId) : rawScheduleId;
    let scheduleKey = "";
    if (eventId && normalizedScheduleId) {
      scheduleKey = `${eventId}::${normalizedScheduleId}`;
    } else if (rawScheduleId) {
      scheduleKey = rawScheduleId;
    } else if (fallbackLabel) {
      scheduleKey = fallbackLabel;
    }
    const scheduleMap = this.state.scheduleMetadata instanceof Map ? this.state.scheduleMetadata : null;
    const scheduleMeta = scheduleKey && scheduleMap ? scheduleMap.get(scheduleKey) : null;
    const eventsMap = this.state.eventsById instanceof Map ? this.state.eventsById : null;
    const eventNameFromMap = eventId && eventsMap ? String(eventsMap.get(eventId)?.name || "").trim() : "";
    const metaLabel = scheduleMeta ? String(scheduleMeta.label || "").trim() : "";
    const metaEventName = scheduleMeta ? String(scheduleMeta.eventName || "").trim() : "";
    const metaStart = scheduleMeta ? String(scheduleMeta.startAt || "").trim() : "";
    const metaEnd = scheduleMeta ? String(scheduleMeta.endAt || "").trim() : "";
    const rawStart = String(record.scheduleStart ?? "").trim();
    const rawEnd = String(record.scheduleEnd ?? "").trim();
    const label = metaLabel || fallbackLabel || rawScheduleId || "";
    const eventName = metaEventName || eventNameFromMap || String(record.eventName ?? "").trim();
    const startAt = metaStart || rawStart;
    const endAt = metaEnd || rawEnd;

    return {
      UID: record.uid,
      班番号: record.group ?? "",
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
      参加者ID: record.participantId ?? "",
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
  }

  /**
   * 送出端末とのセッション情報を監視し、リンク状態の変化をUIへ反映します。
   */
  startDisplaySessionMonitor() {
    if (this.displaySessionUnsubscribe) this.displaySessionUnsubscribe();
    this.displaySessionUnsubscribe = onValue(
      displaySessionRef,
      (snapshot) => {
        const data = snapshot.val() || null;
        const now = Date.now();
        const expiresAt = Number(data && data.expiresAt) || 0;
        const status = String((data && data.status) || "");
        const activeFromSnapshot = !!data && status === "active" && (!expiresAt || expiresAt > now);
        const assignment = data && typeof data.assignment === "object" ? data.assignment : null;
        const normalizedEvent = String(data?.eventId || "").trim();
        const normalizedSchedule = normalizeScheduleId(data?.scheduleId || "");
        const assignmentEvent = assignment && typeof assignment.eventId === "string" ? assignment.eventId.trim() : "";
        const assignmentSchedule =
          assignment && typeof assignment.scheduleId === "string" ? normalizeScheduleId(assignment.scheduleId) : "";
        // logDisplayLinkInfo("Display session snapshot", {
        //   active: activeFromSnapshot,
        //   status,
        //   sessionId: data?.sessionId || null,
        //   eventId: normalizedEvent || null,
        //   scheduleId: normalizedSchedule || null,
        //   assignmentEvent: assignmentEvent || null,
        //   assignmentSchedule: assignmentSchedule || null
        // });
        this.state.displaySession = data;
        this.displaySessionStatusFromSnapshot = activeFromSnapshot;
        this.evaluateDisplaySessionActivity("session-snapshot");
        this.state.channelAssignment = this.getDisplayAssignment();
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
    const previousActive = this.state.displaySessionActive;
    const session = this.state.displaySession || null;
    const sessionUid = String(session?.uid || "").trim();
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      this.displayPresencePrimedSessionId = "";
      this.displayPresencePrimedForSession = false;
    } else if (this.displayPresencePrimedSessionId !== sessionId) {
      this.displayPresencePrimedSessionId = sessionId;
      this.displayPresencePrimedForSession = false;
    }
    const presenceEntries = Array.isArray(this.displayPresenceEntries) ? this.displayPresenceEntries : [];
    const presenceEntry = presenceEntries.find((entry) => entry.uid === sessionUid) || null;
    const presenceActive = !!presenceEntry && !presenceEntry.isStale && presenceEntry.sessionId === sessionId;
    if (presenceEntry && presenceEntry.sessionId === sessionId) {
      this.displayPresencePrimedForSession = true;
    }
    const assetChecked = this.state.displayAssetChecked === true;
    const assetAvailable = this.state.displayAssetAvailable !== false;
    const allowActive = !assetChecked || assetAvailable;
    const snapshotFallbackAllowed = !this.displayPresencePrimedForSession;
    const snapshotActive = snapshotFallbackAllowed && !!this.displaySessionStatusFromSnapshot;
    const nextActive = allowActive && (presenceActive || snapshotActive);
    this.state.displaySessionActive = nextActive;

    if (nextActive && this.state.renderChannelOnline === false) {
      this.updateRenderAvailability(null);
    }

    if (presenceActive) {
      this.refreshDisplaySessionFromPresence(session, presenceEntry, reason);
    } else if (!nextActive && sessionUid && sessionId) {
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
   * presenceの最新情報をもとに render/session のTTLを延長します。
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
    const lastRefresh = this.displayPresenceLastRefreshAt || 0;
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
    update(displaySessionRef, payload).catch((error) => {
      console.debug("Failed to extend display session TTL:", error);
    });
    this.displayPresenceLastRefreshAt = now;
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
    if (!this.dom.copyrightYear) return;
    const currentYear = new Date().getFullYear();
    if (currentYear <= 2025) {
      this.dom.copyrightYear.textContent = "2025";
    } else {
      this.dom.copyrightYear.textContent = `2025 - ${currentYear}`;
    }
  }
}

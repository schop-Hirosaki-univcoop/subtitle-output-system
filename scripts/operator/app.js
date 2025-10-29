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
import { OPERATOR_MODE_TELOP, normalizeOperatorMode, isTelopMode } from "../shared/operator-modes.js";
import { goToLogin } from "../shared/routes.js";
import { info as logDisplayLinkInfo, error as logDisplayLinkError } from "../shared/display-link-logger.js";
import { queryDom } from "./dom.js";
import { createInitialState } from "./state.js";
import { createApiClient } from "./api-client.js";
import { showToast } from "./toast.js";
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
  { element: "clearButton", type: "click", handler: "clearTelop" },
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
      "clearTelop",
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

export class OperatorApp {
  constructor() {
    this.dom = queryDom();
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    this.pageContext = this.extractPageContext();
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
    this.eventsBranch = {};
    this.schedulesBranch = {};
    this.authFlow = "idle";
    this.pendingAuthUser = null;
    this.isAuthorized = false;
    this.dictionaryLoaded = false;
    this.preferredDictionaryOpen = false;
    this.preferredLogsOpen = false;
    this.activeDialog = null;
    this.dialogLastFocused = null;
    this.pendingEditUid = null;
    this.pendingEditOriginal = "";
    this.editSubmitting = false;
    this.confirmState = { resolver: null, keydownHandler: null, lastFocused: null, initialized: false };
    this.operatorIdentity = { uid: "", email: "", displayName: "" };
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
    this.conflictDialogOpen = false;
    this.operatorMode = OPERATOR_MODE_TELOP;
    this.currentConflictSignature = "";
    this.conflictDialogSnoozedSignature = "";

    this.toast = showToast;
    bindModuleMethods(this);
    if (typeof this.applyInitialPickupState === "function") {
      try {
        this.applyInitialPickupState();
    } catch (error) {
      // Swallow errors from optional pickup panel initialisation.
    }
    }
    this.redirectingToIndex = false;
    this.embedReadyDeferred = null;
  }

  static get embedPrefix() {
    if (typeof document === "undefined") {
      return "";
    }
    return document.documentElement?.dataset?.operatorEmbedPrefix || "";
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
      context.scheduleKey = String(params.get("scheduleKey") ?? "").trim();
      if (!context.scheduleKey && context.eventId && context.scheduleId) {
        context.scheduleKey = `${context.eventId}::${context.scheduleId}`;
      }
    } catch (error) {
      // Ignore malformed page context payloads.
    }
    return context;
  }

  applyContextToState() {
    if (!this.state) return;
    const context = this.pageContext || {};
    const scheduleKey = context.scheduleKey ||
      (context.eventId && context.scheduleId ? `${context.eventId}::${context.scheduleId}` : "");
    const committedScheduleKey = context.committedScheduleKey ||
      (context.eventId && context.committedScheduleId
        ? `${context.eventId}::${context.committedScheduleId}`
        : "");
    this.state.activeEventId = context.eventId || "";
    this.state.activeScheduleId = context.scheduleId || "";
    this.state.activeEventName = context.eventName || "";
    this.state.activeScheduleLabel = context.scheduleLabel || "";
    this.state.committedScheduleId = context.committedScheduleId || "";
    this.state.committedScheduleLabel = context.committedScheduleLabel || "";
    this.state.committedScheduleKey = committedScheduleKey;
    if (committedScheduleKey) {
      this.state.currentSchedule = committedScheduleKey;
      this.state.lastNormalSchedule = committedScheduleKey;
    } else if (scheduleKey) {
      this.state.currentSchedule = scheduleKey;
      this.state.lastNormalSchedule = scheduleKey;
    }
    this.state.operatorMode = this.operatorMode;
  }

  getActiveChannel() {
    const ensure = (value) => String(value ?? "").trim();
    let eventId = ensure(this.state?.activeEventId || this.pageContext?.eventId || "");
    let scheduleId = ensure(this.state?.activeScheduleId || this.pageContext?.scheduleId || "");

    if (!eventId || !scheduleId) {
      const scheduleKey = ensure(
        this.state?.currentSchedule || this.pageContext?.scheduleKey || ""
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

  getCurrentScheduleKey() {
    const { eventId, scheduleId } = this.getActiveChannel();
    const normalizedEvent = String(eventId || "").trim();
    if (!normalizedEvent) {
      return "";
    }
    return `${normalizedEvent}::${normalizeScheduleId(scheduleId)}`;
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

  isTelopEnabled() {
    return isTelopMode(this.operatorMode);
  }

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

  hasChannelMismatch() {
    const assignment = this.state?.channelAssignment || this.getDisplayAssignment();
    const { eventId, scheduleId } = this.getActiveChannel();
    const normalizedEvent = String(eventId || "").trim();
    if (!assignment || !assignment.eventId) {
      return true;
    }
    if (!normalizedEvent) {
      return true;
    }
    const assignedEvent = String(assignment.eventId || "").trim();
    const assignedSchedule = normalizeScheduleId(assignment.scheduleId || "");
    const currentSchedule = normalizeScheduleId(scheduleId);
    return assignedEvent !== normalizedEvent || assignedSchedule !== currentSchedule;
  }

  refreshChannelSubscriptions() {
    const { eventId, scheduleId } = this.getActiveChannel();
    const path = getRenderStatePath(eventId, scheduleId);
    if (this.currentRenderPath !== path) {
      const normalizedEvent = String(eventId || "").trim();
      const normalizedSchedule = normalizeScheduleId(scheduleId || "");
      logDisplayLinkInfo("Switching render subscription", {
        path,
        eventId: normalizedEvent || null,
        scheduleId: normalizedSchedule || null
      });
    }
    if (this.currentRenderPath === path && this.renderUnsubscribe) {
      return;
    }
    if (this.renderUnsubscribe) {
      this.renderUnsubscribe();
      this.renderUnsubscribe = null;
    }
    this.currentRenderPath = path;
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

  syncOperatorPresence(reason = "context-sync") {
    if (this.operatorPresencePrimePromise) {
      return;
    }
    const user = this.operatorIdentity?.uid ? this.operatorIdentity : auth.currentUser || null;
    const uid = String(user?.uid || "").trim();
    if (!uid || !this.isAuthorized) {
      this.clearOperatorPresence();
      return;
    }

    const eventId = String(this.state?.activeEventId || "").trim();
    if (!eventId) {
      this.clearOperatorPresence();
      return;
    }

    const ensure = (value) => String(value ?? "").trim();
    const committedScheduleId = ensure(this.state?.committedScheduleId);
    const committedScheduleLabel = ensure(this.state?.committedScheduleLabel);
    const committedScheduleKey = ensure(this.state?.committedScheduleKey);
    const activeScheduleId = ensure(this.state?.activeScheduleId || this.pageContext?.scheduleId);
    const activeScheduleLabel = ensure(this.state?.activeScheduleLabel || this.pageContext?.scheduleLabel);
    const activeScheduleKey = ensure(
      this.state?.currentSchedule || this.state?.lastNormalSchedule || this.pageContext?.scheduleKey
    );
    const previousPresence = this.state?.operatorPresenceSelf || null;
    const allowPresenceFallback = reason === "context-sync" || reason === "heartbeat";
    const sessionId = ensure(this.operatorPresenceSessionId) || this.generatePresenceSessionId();

    let scheduleId = committedScheduleId || activeScheduleId;
    if (!scheduleId && allowPresenceFallback) {
      scheduleId = ensure(previousPresence?.scheduleId);
    }

    let scheduleLabel = committedScheduleLabel || activeScheduleLabel;
    if (!scheduleLabel && allowPresenceFallback) {
      scheduleLabel = ensure(previousPresence?.scheduleLabel);
    }
    if (!scheduleLabel && scheduleId) {
      scheduleLabel = scheduleId;
    }

    let scheduleKey = committedScheduleKey || activeScheduleKey;
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
    const eventName = String(this.state?.activeEventName || "").trim();
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
      eventId,
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

  scheduleOperatorPresenceHeartbeat() {
    if (this.operatorPresenceHeartbeat) {
      return;
    }
    this.operatorPresenceHeartbeat = setInterval(() => this.touchOperatorPresence(), OPERATOR_PRESENCE_HEARTBEAT_MS);
  }

  touchOperatorPresence() {
    if (!this.operatorPresenceEntryRef || !this.operatorPresenceEntryKey) {
      this.stopOperatorPresenceHeartbeat();
      return;
    }
    const now = Date.now();
    update(this.operatorPresenceEntryRef, {
      clientTimestamp: now
    }).catch(() => {});
    if (this.state.operatorPresenceSelf) {
      this.state.operatorPresenceSelf = {
        ...this.state.operatorPresenceSelf,
        clientTimestamp: now
      };
    }
  }

  stopOperatorPresenceHeartbeat() {
    if (this.operatorPresenceHeartbeat) {
      clearInterval(this.operatorPresenceHeartbeat);
      this.operatorPresenceHeartbeat = null;
    }
  }

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
    if (entryRef && hadKey) {
      remove(entryRef).catch(() => {});
    }
    this.state.operatorPresenceSelf = null;
  }

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
    const displayActive = !!this.state.displaySessionActive;
    const assignment = this.state?.channelAssignment || this.getDisplayAssignment();
    const channelAligned = !this.hasChannelMismatch();
    const telopEnabled = this.isTelopEnabled();
    let statusText = "";
    let statusClass = "channel-banner__status";
    if (!telopEnabled) {
      statusText = "テロップ操作なしモードです。送出・固定は行えません。";
      statusClass += " is-muted";
    } else if (!displayActive) {
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
      if (!telopEnabled) {
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

  openConflictDialog() {
    if (!this.dom.conflictDialog) {
      return;
    }
    Dialog.openDialog(this, this.dom.conflictDialog, this.dom.conflictConfirmButton);
    this.conflictDialogOpen = true;
  }

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

  snoozeConflictDialog(signature = "") {
    if (!signature) {
      return;
    }
    this.conflictDialogSnoozedSignature = signature;
  }

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
    logDisplayLinkInfo("Applied display assignment", {
      eventId: eventId || null,
      scheduleId: normalizedScheduleId || null,
      scheduleLabel: scheduleLabel || null
    });
    this.state.displaySession = nextSession;
    this.state.channelAssignment = enriched;
    this.state.autoLockAttemptKey = "";
    this.state.autoLockAttemptAt = 0;
  }

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
      if (skipTelop) {
        return;
      }
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
    const uniqueKeys = new Set(options.map((opt) => opt.key || opt.scheduleId || ""));
    uniqueKeys.delete("");
    const presenceHasMultipleSchedules = uniqueKeys.size > 1;
    const hasPresence = options.length > 0;
    const channelAligned = !this.hasChannelMismatch();
    const assignmentTimestamp = Number(
      (this.state?.channelAssignment &&
        (this.state.channelAssignment.updatedAt || this.state.channelAssignment.lockedAt)) ||
        (assignment && (assignment.updatedAt || assignment.lockedAt)) ||
        0
    );
    const presenceNewerThanAssignment =
      latestPresenceAt > assignmentTimestamp || (assignmentTimestamp === 0 && hasPresence);
    const now = Date.now();
    let shouldPrompt = false;
    if (hasPresence && presenceNewerThanAssignment) {
      if (presenceHasMultipleSchedules) {
        shouldPrompt = true;
      } else if (assignmentKey && (!uniqueKeys.has(assignmentKey) || !channelAligned)) {
        shouldPrompt = true;
      } else if (!channelAligned && assignmentKey) {
        shouldPrompt = true;
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
      const canLock = Boolean(targetEventId && targetScheduleId && soleKey);
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

  setExternalContext(context = {}) {
    const ensure = (value) => String(value ?? "").trim();
    const eventId = ensure(context.eventId);
    const scheduleId = ensure(context.scheduleId);
    const eventName = ensure(context.eventName);
    const scheduleLabel = ensure(context.scheduleLabel);
    const committedScheduleId = ensure(context.committedScheduleId);
    const committedScheduleLabel = ensure(context.committedScheduleLabel);
    const committedScheduleKey = ensure(context.committedScheduleKey);
    const startAt = ensure(context.startAt);
    const endAt = ensure(context.endAt);
    const scheduleKey = eventId && scheduleId ? `${eventId}::${scheduleId}` : "";
    const resolvedCommittedKey = committedScheduleKey ||
      (eventId && committedScheduleId ? `${eventId}::${committedScheduleId}` : "");
    const operatorMode = normalizeOperatorMode(context.operatorMode ?? context.mode);

    this.pageContext = {
      ...this.pageContext,
      eventId,
      scheduleId,
      eventName,
      scheduleLabel,
      committedScheduleId,
      committedScheduleLabel,
      committedScheduleKey: resolvedCommittedKey,
      startAt,
      endAt,
      scheduleKey,
      operatorMode
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

    this.updateScheduleContext();
    this.refreshChannelSubscriptions();
    if (this.operatorPresencePrimedEventId && this.operatorPresencePrimedEventId !== eventId) {
      this.operatorPresencePrimedEventId = "";
    }
    this.primeOperatorPresenceSession(eventId).finally(() => this.syncOperatorPresence());
    this.renderChannelBanner();
    this.renderQuestions();
    this.updateActionAvailability();
    this.updateBatchButtonVisibility();
  }

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

  resolveEmbedReady() {
    if (this.embedReadyDeferred?.resolve) {
      this.embedReadyDeferred.resolve();
    }
    this.embedReadyDeferred = null;
  }

  init() {
    this.setupEventListeners();
    this.applyPreferredSubTab();
    this.updateActionAvailability();
    this.attachRenderMonitor();
    this.applyInitialDictionaryState();
    this.applyInitialLogsState();
    this.updateCopyrightYear();
    onAuthStateChanged(auth, (user) => {
      if (this.authFlow === "prompting") {
        this.pendingAuthUser = user || null;
        return;
      }
      this.handleAuthState(user);
    });
  }

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
          this.updateScheduleContext();
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

  applyPreferredSubTab() {
    const preferredSubTab = Questions.loadPreferredSubTab();
    if (preferredSubTab && preferredSubTab !== this.state.currentSubTab) {
      this.switchSubTab(preferredSubTab);
    } else {
      this.updateScheduleContext();
      this.refreshChannelSubscriptions();
      this.renderQuestions();
    }
  }

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
    this.hideLoader();
  }

  async handleAuthState(user) {
    if (!user) {
      this.showLoggedOutState();
      return;
    }
    try {
      this.showLoader(this.isEmbedded ? "利用準備を確認しています…" : "権限を確認しています…");
      this.initLoaderSteps();
      this.setLoaderStep(0, this.isEmbedded ? "利用状態を確認しています…" : "認証OK。ユーザー情報を確認中…");
      const result = await this.api.apiPost({ action: "fetchSheet", sheet: "users" });
      this.setLoaderStep(1, this.isEmbedded ? "必要な設定を確認しています…" : "在籍チェック中…");
      if (!result.success || !result.data) {
        throw new Error("ユーザー権限の確認に失敗しました。");
      }
      const authorizedUsers = result.data
        .map((item) => String(item["メールアドレス"] || "").trim().toLowerCase())
        .filter(Boolean);
      const loginEmail = String(user.email || "").trim().toLowerCase();
      if (!authorizedUsers.includes(loginEmail)) {
        this.toast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", "error");
        await this.logout();
        this.hideLoader();
        return;
      }

      this.setLoaderStep(2, this.isEmbedded ? "必要な権限を同期しています…" : "管理者権限の確認/付与…");
      try {
        await this.api.apiPost({ action: "ensureAdmin" });
      } catch (error) {
        // Allow the operator to continue even if ensureAdmin fails.
      }

      this.renderLoggedInUi(user);
      this.setLoaderStep(3, this.isEmbedded ? "初期データを準備しています…" : "初期ミラー実行中…");
      this.updateLoader("初期データを準備しています…");
      try {
        const snapshot = await get(questionsRef);
        if (!snapshot.exists()) {
          await this.api.apiPost({ action: "mirrorSheet" });
        }
      } catch (error) {
        // Skip initial mirror if the dataset is already populated.
      }

      this.setLoaderStep(4, this.isEmbedded ? "リアルタイム購読を開始しています…" : "購読開始…");
      this.updateLoader("データ同期中…");
      const [questionsSnapshot, questionStatusSnapshot, eventsSnapshot, schedulesSnapshot] = await Promise.all([
        get(questionsRef),
        get(questionStatusRef),
        get(questionIntakeEventsRef),
        get(questionIntakeSchedulesRef)
      ]);
      this.eventsBranch = eventsSnapshot.val() || {};
      this.schedulesBranch = schedulesSnapshot.val() || {};
      this.applyQuestionsBranch(questionsSnapshot.val() || {});
      this.applyQuestionStatusSnapshot(questionStatusSnapshot.val() || {});
      this.rebuildScheduleMetadata();
      this.applyContextToState();
      this.startQuestionsStream();
      this.startQuestionStatusStream();
      this.startScheduleMetadataStreams();
      this.startDictionaryListener();
      this.startPickupListener();
      this.startDisplaySessionMonitor();
      this.setLoaderStep(5, this.isEmbedded ? "辞書データを取得しています…" : "辞書取得…");
      await this.fetchDictionary();
      if (this.preferredDictionaryOpen) {
        this.toggleDictionaryDrawer(true, false);
      } else {
        this.toggleDictionaryDrawer(false, false);
      }
      this.setLoaderStep(6, this.isEmbedded ? "操作ログを取得しています…" : "ログ取得…");
      await this.fetchLogs();
      if (this.preferredLogsOpen) {
        this.toggleLogsDrawer(true, false);
      } else {
        this.toggleLogsDrawer(false, false);
      }
      this.finishLoaderSteps("準備完了");
      this.hideLoader();
      this.toast(`ようこそ、${user.displayName || ""}さん`, "success");
      this.startLogsUpdateMonitor();
      this.resolveEmbedReady();
    } catch (error) {
      this.toast("ユーザー権限の確認中にエラーが発生しました。", "error");
      await this.logout();
      this.hideLoader();
    }
  }

  renderLoggedInUi(user) {
    this.redirectingToIndex = false;
    this.operatorIdentity = {
      uid: String(user?.uid || "").trim(),
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
    this.isAuthorized = true;
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
    this.applyPreferredSubTab();
    const activeEventId = String(this.state?.activeEventId || this.pageContext?.eventId || "").trim();
    if (this.operatorPresencePrimedEventId && this.operatorPresencePrimedEventId !== activeEventId) {
      this.operatorPresencePrimedEventId = "";
    }
    this.primeOperatorPresenceSession(activeEventId).finally(() => this.syncOperatorPresence());
    this.refreshOperatorPresenceSubscription();
  }

  showLoggedOutState() {
    if (this.redirectingToIndex) {
      return;
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
    this.updateScheduleContext();
  }

  startQuestionsStream() {
    if (this.questionsUnsubscribe) this.questionsUnsubscribe();
    this.questionsUnsubscribe = onValue(questionsRef, (snapshot) => {
      this.applyQuestionsBranch(snapshot.val());
    });
  }

  startQuestionStatusStream() {
    if (this.questionStatusUnsubscribe) this.questionStatusUnsubscribe();
    this.questionStatusUnsubscribe = onValue(questionStatusRef, (snapshot) => {
      this.applyQuestionStatusSnapshot(snapshot.val());
    });
  }

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

  rebuildQuestions() {
    const questionMap = this.state.questionsByUid instanceof Map ? this.state.questionsByUid : new Map();
    const statusMap = this.state.questionStatusByUid instanceof Map ? this.state.questionStatusByUid : new Map();
    const list = [];
    questionMap.forEach((record, uid) => {
      const status = statusMap.get(uid) || {};
      list.push(this.normalizeQuestionRecord({ ...record, ...status, uid }));
    });
    this.state.allQuestions = list;
    this.updateScheduleContext();
    this.refreshChannelSubscriptions();
    this.renderQuestions();
  }

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

  startDisplaySessionMonitor() {
    if (this.displaySessionUnsubscribe) this.displaySessionUnsubscribe();
    this.displaySessionUnsubscribe = onValue(
      displaySessionRef,
      (snapshot) => {
        const data = snapshot.val() || null;
        const now = Date.now();
        const expiresAt = Number(data && data.expiresAt) || 0;
        const status = String((data && data.status) || "");
        const active = !!data && status === "active" && (!expiresAt || expiresAt > now);
        const assignment = data && typeof data.assignment === "object" ? data.assignment : null;
        const normalizedEvent = String(data?.eventId || "").trim();
        const normalizedSchedule = normalizeScheduleId(data?.scheduleId || "");
        const assignmentEvent = assignment && typeof assignment.eventId === "string" ? assignment.eventId.trim() : "";
        const assignmentSchedule =
          assignment && typeof assignment.scheduleId === "string" ? normalizeScheduleId(assignment.scheduleId) : "";
        logDisplayLinkInfo("Display session snapshot", {
          active,
          status,
          sessionId: data?.sessionId || null,
          eventId: normalizedEvent || null,
          scheduleId: normalizedSchedule || null,
          assignmentEvent: assignmentEvent || null,
          assignmentSchedule: assignmentSchedule || null
        });
        this.state.displaySession = data;
        this.state.displaySessionActive = active;
        this.state.channelAssignment = this.getDisplayAssignment();
        this.updateScheduleContext();
        if (this.state.displaySessionLastActive !== null && this.state.displaySessionLastActive !== active) {
          logDisplayLinkInfo("Display session activity changed", { active });
          this.toast(active ? "送出端末とのセッションが確立されました。" : "送出端末の接続が確認できません。", active ? "success" : "error");
        }
        this.state.displaySessionLastActive = active;
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

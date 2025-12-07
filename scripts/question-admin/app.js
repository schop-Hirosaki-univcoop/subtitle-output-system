// app.js: 質問管理機能のエントリーで、画面初期化とユーザー操作制御をまとめます。
import {
  GAS_API_URL,
  FORM_PAGE_PATH,
  STEP_LABELS,
  PARTICIPANT_TEMPLATE_HEADERS,
  TEAM_TEMPLATE_HEADERS,
  firebaseConfig
} from "./constants.js";
import {
  auth,
  provider,
  getAuthIdToken,
  rootDbRef,
  fetchDbValue,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  set,
  update
} from "./firebase.js";
import {
  state,
  calendarState,
  dialogCalendarState,
  loaderState,
  resetTokenState
} from "./state.js";
import { dom } from "./dom.js";
import { goToLogin } from "../shared/routes.js";
// loadAuthPreflightContext, preflightContextMatchesUser は AuthManager に移行されました
import { collectParticipantTokens } from "../shared/participant-tokens.js";
import {
  sleep,
  toMillis,
  ensureCrypto,
  generateShortId,
  base64UrlFromBytes,
  normalizeKey,
  readFileAsText,
  parseCsv,
  parseDateTimeLocal
} from "./utils.js";
import {
  normalizeEventParticipantCache,
  getScheduleLabel,
  describeDuplicateMatch,
  updateDuplicateMatches,
  syncCurrentScheduleCache,
  parseParticipantRows,
  parseTeamAssignmentRows,
  ensureTeamAssignmentMap,
  getTeamAssignmentMap,
  applyAssignmentsToEntries,
  applyAssignmentsToEventCache,
  normalizeParticipantRecord,
  assignParticipantIds,
  ensureRowKey,
  resolveParticipantUid,
  resolveParticipantStatus,
  sortParticipants,
  signatureForEntries,
  snapshotParticipantList,
  diffParticipantLists,
  normalizeGroupNumberValue,
  isMailDeliveryPending,
  resolveMailStatusInfo
} from "./participants.js";
import {
  PRINT_SETTING_STORAGE_KEY,
  DEFAULT_PRINT_SETTINGS,
  normalizePrintSettings,
  formatPrintDateTimeRange,
  buildParticipantPrintHtml,
  buildStaffPrintHtml,
  logPrintInfo,
  logPrintWarn,
  logPrintError,
  logPrintDebug
} from "../shared/print-utils.js";
// DEFAULT_PREVIEW_NOTE, DEFAULT_LOAD_TIMEOUT_MS, createPrintPreviewController は PrintManager に移行されました
import { PrintManager } from "./managers/print-manager.js";
import { CsvManager } from "./managers/csv-manager.js";
import { EventManager } from "./managers/event-manager.js";
import { StateManager } from "./managers/state-manager.js";
import { ParticipantManager } from "./managers/participant-manager.js";
import { ScheduleManager } from "./managers/schedule-manager.js";
import { MailManager } from "./managers/mail-manager.js";
import { AuthManager } from "./managers/auth-manager.js";
import { RelocationManager } from "./managers/relocation-manager.js";
import { HostIntegrationManager } from "./managers/host-integration-manager.js";

// redirectingToIndex は AuthManager と共有するため、参照オブジェクトとして管理
const redirectingToIndexRef = { current: false };
let printManager = null;
let csvManager = null;
let eventManager = null;
let participantManager = null;
let scheduleManager = null;
let mailManager = null;
let authManager = null;
let relocationManager = null;
let hostIntegrationManager = null;
let stateManager = null;

const glDataFetchCache = new Map();

function getEmbedPrefix() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    if (typeof document === "undefined") {
      return "";
    }
    const html = document.documentElement;
    const existingPrefix = html?.dataset?.qaEmbedPrefix?.trim();
    if (existingPrefix) {
      return existingPrefix;
    }
    const embedSurface = document.querySelector("[data-qa-embed]");
    if (embedSurface) {
      const detectedPrefix =
        embedSurface.getAttribute("data-qa-embed-prefix")?.trim() || "qa-";
      if (html) {
        html.dataset.qaEmbedPrefix = detectedPrefix;
      }
      return detectedPrefix;
    }
    return "";
  }
  return hostIntegrationManager.getEmbedPrefix();
}

function isEmbeddedMode() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    return Boolean(getEmbedPrefix());
  }
  return hostIntegrationManager.isEmbeddedMode();
}

function cloneParticipantEntry(entry) {
  // StateManager に委譲
  if (!stateManager) {
    throw new Error("StateManager is not initialized");
  }
  return stateManager.cloneParticipantEntry(entry);
}

function captureParticipantBaseline(entries = state.participants, options = {}) {
  // StateManager に委譲
  if (!stateManager) {
    throw new Error("StateManager is not initialized");
  }
  return stateManager.captureParticipantBaseline(entries, options);
}

let embedReadyDeferred = null;

const HOST_SELECTION_ATTRIBUTE_KEYS = [
  "data-expected-event-id",
  "data-expected-event-name",
  "data-expected-schedule-id",
  "data-expected-schedule-label",
  "data-expected-start-at",
  "data-expected-end-at"
];

const UPLOAD_STATUS_PLACEHOLDERS = new Set(
  [
    "日程を選択してください。",
    "イベントコントロールセンターで対象の日程を選択してください。"
  ].map(normalizeKey)
);

const PARTICIPANT_DESCRIPTION_DEFAULT =
  "選択したイベント・日程の参加者情報を管理できます。各参加者ごとに質問フォームの専用リンクを発行でき、「編集」から詳細や班番号を更新できます。電話番号とメールアドレスは内部で管理され、編集時のみ確認できます。同じイベント内で名前と学部学科が一致する参加者は重複候補として件数付きで表示されます。専用リンクは各行のボタンまたはURLから取得できます。";

const CANCEL_LABEL = "キャンセル";
const RELOCATE_LABEL = "別日";
const GL_STAFF_GROUP_KEY = "__gl_staff__";
const GL_STAFF_LABEL = "運営待機";
const NO_TEAM_GROUP_KEY = "__no_team__";
// AUTHORIZED_EMAIL_CACHE_MS, cachedAuthorizedEmails, cachedAuthorizedFetchedAt, authorizedEmailsPromise は AuthManager に移行されました

function getMissingSelectionStatusMessage() {
  // StateManager に委譲
  if (!stateManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    return isEmbeddedMode()
      ? "イベントコントロールセンターで対象の日程を選択してください。"
      : "日程を選択してください。";
  }
  return stateManager.getMissingSelectionStatusMessage();
}

function getSelectionRequiredMessage(prefix = "") {
  // StateManager に委譲
  if (!stateManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    const requirement = isEmbeddedMode()
      ? "イベントコントロールセンターで対象の日程を選択してください。"
      : "イベントと日程を選択してください。";
    if (!prefix) {
      return requirement;
    }
    return `${prefix}${requirement}`;
  }
  return stateManager.getSelectionRequiredMessage(prefix);
}

// embedReadyDeferred, hostSelectionBridge, lastSelectionBroadcastSignature, hostIntegration は HostIntegrationManager に移行されました（段階4-6で完全移行予定）
const hostSelectionBridge = {
  observer: null,
  lastSignature: "",
  pendingSignature: ""
}; // フォールバック処理用（段階4-6で削除予定）

let lastSelectionBroadcastSignature = ""; // フォールバック処理用（段階4-6で削除予定）

const hostIntegration = {
  controller: null,
  selectionUnsubscribe: null,
  eventsUnsubscribe: null
}; // フォールバック処理用（段階4-6で削除予定）

function getSelectionBroadcastSource() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    return isEmbeddedMode() ? "participants" : "question-admin";
  }
  return hostIntegrationManager.getSelectionBroadcastSource();
}

function isHostAttached() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    return false;
  }
  return hostIntegrationManager.isHostAttached();
}

function detachHost() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    return;
  }
  hostIntegrationManager.detachHost();
}

function cloneHostEvent(event) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  return hostIntegrationManager.cloneHostEvent(event);
}

function refreshScheduleLocationHistory() {
  const history = new Set();
  if (Array.isArray(state.events)) {
    state.events.forEach((event) => {
      if (!Array.isArray(event?.schedules)) {
        return;
      }
      event.schedules.forEach((schedule) => {
        const location = typeof schedule?.location === "string"
          ? schedule.location.trim()
          : String(schedule?.location || "").trim();
        if (location) {
          history.add(location);
        }
      });
    });
  }
  if (state.scheduleContextOverrides instanceof Map) {
    state.scheduleContextOverrides.forEach((override) => {
      const location = typeof override?.location === "string"
        ? override.location.trim()
        : String(override?.location || "").trim();
      if (location) {
        history.add(location);
      }
    });
  }
  state.scheduleLocationHistory = history;
}

function populateScheduleLocationOptions(preferred = "") {
  const list = dom.scheduleLocationList;
  if (!list) {
    return;
  }
  const normalize = (value) => (value == null ? "" : String(value).trim());
  const options = new Set();

  if (state.scheduleLocationHistory instanceof Set) {
    state.scheduleLocationHistory.forEach((value) => {
      const location = normalize(value);
      if (location) {
        options.add(location);
      }
    });
  }

  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  if (selectedEvent?.schedules) {
    selectedEvent.schedules.forEach((schedule) => {
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

function finalizeEventLoad({
  preserveSelection = true,
  previousEventId = null,
  previousScheduleId = null,
  previousEventsSnapshot = [],
  preserveStatus = false
} = {}) {
  if (!preserveSelection) {
    state.selectedEventId = null;
    state.selectedScheduleId = null;
  }

  let selectionNotice = null;

  let initialSelectionSatisfied = false;

  if (!state.initialSelectionApplied && state.initialSelection?.eventId) {
    const {
      eventId,
      scheduleId,
      scheduleLabel,
      eventLabel,
      location: initialLocation = null,
      startAt: initialStartAt = null,
      endAt: initialEndAt = null
    } = state.initialSelection;
    const targetEvent = state.events.find(evt => evt.id === eventId) || null;
    if (targetEvent) {
      state.selectedEventId = eventId;
      if (scheduleId) {
        const targetSchedule = targetEvent.schedules?.find(s => s.id === scheduleId) || null;
        if (targetSchedule) {
          state.selectedScheduleId = scheduleId;
          if (state.scheduleContextOverrides instanceof Map) {
            state.scheduleContextOverrides.delete(`${eventId}::${scheduleId}`);
          }
        } else {
          const overrideKey = `${eventId}::${scheduleId}`;
          if (!(state.scheduleContextOverrides instanceof Map)) {
            state.scheduleContextOverrides = new Map();
          }
          const existingOverride = state.scheduleContextOverrides.get(overrideKey) || null;
          const override = existingOverride || {
            eventId,
            eventName: eventLabel || targetEvent.name || eventId,
            scheduleId,
            scheduleLabel: scheduleLabel || scheduleId,
            location: initialLocation || "",
            startAt: initialStartAt || "",
            endAt: initialEndAt || ""
          };
          state.scheduleContextOverrides.set(overrideKey, override);
          state.selectedScheduleId = scheduleId;
        }
      } else {
        state.selectedScheduleId = null;
      }
      initialSelectionSatisfied = true;
    } else {
      state.selectedEventId = null;
      state.selectedScheduleId = null;
      const label = eventLabel || eventId;
      selectionNotice = `指定されたイベント「${label}」が見つかりません。`;
    }
    state.initialSelectionApplied = initialSelectionSatisfied;
    if (initialSelectionSatisfied) {
      state.initialSelection = null;
    }
  } else if (preserveSelection && previousEventId && state.events.some(evt => evt.id === previousEventId)) {
    state.selectedEventId = previousEventId;
    if (previousScheduleId) {
      const selectedEvent = state.events.find(evt => evt.id === previousEventId) || null;
      const hasSchedule = selectedEvent?.schedules?.some(schedule => schedule.id === previousScheduleId) || false;
      const overrideKey = `${previousEventId}::${previousScheduleId}`;
      if (!(state.scheduleContextOverrides instanceof Map)) {
        state.scheduleContextOverrides = new Map();
      }
      let hasOverride = state.scheduleContextOverrides.has(overrideKey);
      if (!hasSchedule && previousEventsSnapshot?.length && previousEventId && previousScheduleId && !hasOverride) {
        const previousEvent = previousEventsSnapshot.find(event => event.id === previousEventId) || null;
        const previousSchedule = previousEvent?.schedules?.find(schedule => schedule.id === previousScheduleId) || null;
        if (previousSchedule) {
          const fallbackOverride = {
            eventId: previousEventId,
            eventName: previousEvent?.name || previousEventId,
            scheduleId: previousScheduleId,
            scheduleLabel: previousSchedule.label || previousScheduleId,
            location: previousSchedule.location || "",
            startAt: previousSchedule.startAt || "",
            endAt: previousSchedule.endAt || ""
          };
          state.scheduleContextOverrides.set(overrideKey, fallbackOverride);
          hasOverride = true;
        }
      }
      state.selectedScheduleId = hasSchedule || hasOverride ? previousScheduleId : null;
      if (hasSchedule && state.scheduleContextOverrides instanceof Map) {
        state.scheduleContextOverrides.delete(overrideKey);
      }
    } else {
      state.selectedScheduleId = null;
    }
  } else if (preserveSelection) {
    state.selectedEventId = null;
    state.selectedScheduleId = null;
  }

  refreshScheduleLocationHistory();
  populateScheduleLocationOptions(dom.scheduleLocationInput?.value || "");

  state.initialSelectionNotice = selectionNotice;
  renderEvents();
  renderSchedules();
  updateParticipantContext({ preserveStatus });
}

function applyHostEvents(events = [], { preserveSelection = true } = {}) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  hostIntegrationManager.applyHostEvents(events, { preserveSelection });
}

function handleHostSelection(detail) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  hostIntegrationManager.handleHostSelection(detail);
}

function handleHostEventsUpdate(events) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  hostIntegrationManager.handleHostEventsUpdate(events);
}

function attachHost(controller) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  hostIntegrationManager.attachHost(controller);
}

function signatureForSelectionDetail(detail) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    if (!detail || typeof detail !== "object") {
      return "";
    }
    const {
      eventId = "",
      scheduleId = "",
      eventName = "",
      scheduleLabel = "",
      startAt = "",
      endAt = ""
    } = detail;
    return [eventId, scheduleId, eventName, scheduleLabel, startAt, endAt].join("::");
  }
  return hostIntegrationManager.signatureForSelectionDetail(detail);
}

function buildSelectionDetail() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    const eventId = state.selectedEventId || "";
    const scheduleId = state.selectedScheduleId || "";
    const selectedEvent = Array.isArray(state.events)
      ? state.events.find(evt => evt.id === eventId) || null
      : null;
    const schedules = selectedEvent?.schedules || [];
    const schedule = scheduleId ? schedules.find(item => item.id === scheduleId) || null : null;
    const overrideKey = `${eventId}::${scheduleId}`;
    const override =
      scheduleId && state.scheduleContextOverrides instanceof Map
        ? state.scheduleContextOverrides.get(overrideKey) || null
        : null;

    return {
      eventId,
      scheduleId,
      eventName: selectedEvent?.name || "",
      scheduleLabel: schedule?.label || override?.scheduleLabel || "",
      startAt: schedule?.startAt || override?.startAt || "",
      endAt: schedule?.endAt || override?.endAt || ""
    };
  }
  return hostIntegrationManager.buildSelectionDetail();
}

function broadcastSelectionChange(options = {}) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    const source = options.source || getSelectionBroadcastSource();
    const detail = buildSelectionDetail();
    const signature = signatureForSelectionDetail(detail);
    const changed = signature !== lastSelectionBroadcastSignature;
    lastSelectionBroadcastSignature = signature;
    if (!changed || source === "host") {
      return;
    }
    if (hostIntegration && hostIntegration.controller && typeof hostIntegration.controller.setSelection === "function") {
      try {
        hostIntegration.controller.setSelection({ ...detail, source });
      } catch (error) {
        console.warn("Failed to propagate selection to host", error);
      }
    }
    if (typeof document === "undefined") {
      return;
    }
    try {
      document.dispatchEvent(
        new CustomEvent("qa:selection-changed", {
          detail: {
            ...detail,
            source
          }
        })
      );
    } catch (error) {
      console.warn("Failed to dispatch selection change event", error);
    }
    return;
  }
  hostIntegrationManager.broadcastSelectionChange(options);
}

function waitForEmbedReady() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    if (state.user) {
      return Promise.resolve();
    }
    if (embedReadyDeferred?.promise) {
      return embedReadyDeferred.promise;
    }
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    embedReadyDeferred = { promise, resolve };
    return promise;
  }
  return hostIntegrationManager.waitForEmbedReady();
}

function resolveEmbedReady() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    if (embedReadyDeferred?.resolve) {
      embedReadyDeferred.resolve();
    }
    embedReadyDeferred = null;
    return;
  }
  hostIntegrationManager.resolveEmbedReady();
}

function getElementById(id) {
  const prefix = getEmbedPrefix();
  const candidates = [];

  if (prefix) {
    candidates.push(`${prefix}${id}`);
  }

  candidates.push(id);

  if (!prefix) {
    candidates.push(`qa-${id}`);
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const element = document.getElementById(candidate);
    if (element) {
      return element;
    }
  }

  return null;
}
import {
  openDialog,
  closeDialog,
  bindDialogDismiss,
  setFormError
} from "./dialog.js";
// combineDateAndTime などの時間結合ヘルパーは calendar.js に集約しており、
// 印刷ビューでも同じロジックを共有するため utils.js からは import しない。
import {
  formatDatePart,
  normalizeDateInputValue,
  formatDateTimeLocal,
  combineDateAndTime,
  setCalendarPickedDate,
  shiftScheduleDialogCalendarMonth,
  prepareScheduleDialogCalendar,
  getSchedulePrimaryDate,
  describeScheduleRange,
  syncScheduleEndMin,
  MS_PER_DAY
} from "./calendar.js";
import {
  showLoader,
  hideLoader,
  updateLoaderText,
  initLoaderSteps,
  setLoaderStep,
  finishLoaderSteps
} from "./loader.js";

const FOCUS_TARGETS = new Set(["participants", "schedules", "events"]);

function parseInitialSelectionFromUrl() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const params = new URLSearchParams(window.location.search || "");
    const ensure = (value) => String(value ?? "").trim();

    const eventId = ensure(params.get("eventId") ?? params.get("event"));
    const scheduleId = ensure(params.get("scheduleId") ?? params.get("schedule"));
    const scheduleLabel = ensure(params.get("scheduleLabel") ?? params.get("scheduleName"));
    const eventLabel = ensure(params.get("eventName") ?? params.get("eventLabel"));
    const focusParam = ensure(params.get("focus") ?? params.get("view"));

    if (eventId) {
      state.initialSelection = {
        eventId,
        scheduleId: scheduleId || null,
        scheduleLabel: scheduleLabel || null,
        eventLabel: eventLabel || null
      };
    }

    if (focusParam) {
      const normalizedFocus = focusParam.toLowerCase();
      if (FOCUS_TARGETS.has(normalizedFocus)) {
        state.initialFocusTarget = normalizedFocus;
      }
    }
  } catch (error) {
    console.debug("failed to parse initial selection", error);
  }
}

function generateQuestionToken(existingTokens = state.knownTokens) {
  const used = existingTokens instanceof Set ? existingTokens : new Set();
  const cryptoObj = ensureCrypto();

  while (true) {
    let candidate = "";
    if (cryptoObj) {
      const bytes = new Uint8Array(24);
      cryptoObj.getRandomValues(bytes);
      candidate = base64UrlFromBytes(bytes).slice(0, 32);
    } else {
      const seed = `${Math.random()}::${Date.now()}::${Math.random()}`;
      candidate = btoa(seed).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "").slice(0, 32);
    }

    if (!candidate || candidate.length < 12) {
      continue;
    }
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

async function ensureTokenSnapshot(force = false) {
  if (!force && state.tokenSnapshotFetchedAt && Date.now() - state.tokenSnapshotFetchedAt < 10000) {
    return state.tokenRecords;
  }
  const tokens = (await fetchDbValue("questionIntake/tokens")) || {};
  state.tokenRecords = tokens;
  state.knownTokens = new Set(Object.keys(tokens));
  state.tokenSnapshotFetchedAt = Date.now();
  return state.tokenRecords;
}

async function fetchAuthorizedEmails() {
  // AuthManager に委譲
  if (!authManager) {
    throw new Error("AuthManager is not initialized");
  }
  return await authManager.fetchAuthorizedEmails();
}

function renderUserSummary(user) {
  if (!dom.userInfo) return;
  dom.userInfo.innerHTML = "";
  if (!user) {
    dom.userInfo.hidden = true;
    dom.userInfo.setAttribute("aria-hidden", "true");
    return;
  }

  const safeName = String(user.displayName || "").trim();
  const safeEmail = String(user.email || "").trim();
  const label = document.createElement("span");
  label.className = "user-label";
  label.textContent = safeName && safeEmail ? `${safeName} (${safeEmail})` : safeName || safeEmail || "";
  dom.userInfo.appendChild(label);
  dom.userInfo.hidden = false;
  dom.userInfo.removeAttribute("aria-hidden");
}

function createApiClient(getIdToken) {
  async function apiPost(payload, retryOnAuthError = true) {
    const idToken = await getIdToken();
    const response = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...payload, idToken })
    });
    let json;
    try {
      json = await response.json();
    } catch (error) {
      throw new Error("サーバー応答の解析に失敗しました。");
    }
    if (!json.success) {
      const message = String(json.error || "");
      if (retryOnAuthError && /Auth/.test(message)) {
        await getIdToken(true);
        return await apiPost(payload, false);
      }
      throw new Error(message || "APIリクエストに失敗しました。");
    }
    return json;
  }

  return { apiPost };
}

const api = createApiClient(getAuthIdToken);

async function drainQuestionQueue() {
  try {
    await api.apiPost({ action: "processQuestionQueue" });
  } catch (error) {
    console.warn("processQuestionQueue failed", error);
  }
}

function getDisplayParticipantId(participantId) {
  return String(participantId || "").trim();
}

function applyParticipantNoText(element, index) {
  if (!element) return;
  if (Number.isFinite(index)) {
    element.textContent = String(index);
  } else {
    element.textContent = "";
  }
}

function ensurePendingRelocationMap() {
  // RelocationManager に委譲
  if (!relocationManager) {
    return new Map();
  }
  return relocationManager.ensurePendingRelocationMap();
}

function ensureRelocationDraftMap() {
  // RelocationManager に委譲
  if (!relocationManager) {
    return new Map();
  }
  return relocationManager.ensureRelocationDraftMap();
}

function storeRelocationDraftOriginal(entry) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return null;
  }
  return relocationManager.storeRelocationDraftOriginal(entry);
}

function findParticipantForSnapshot(snapshot) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return null;
  }
  return relocationManager.findParticipantForSnapshot(snapshot);
}

function restoreRelocationDrafts(keys = []) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return false;
  }
  return relocationManager.restoreRelocationDrafts(keys);
}

function resolveRelocationDraftKey(entry, target = null, draftMap = state.relocationDraftOriginals) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return null;
  }
  return relocationManager.resolveRelocationDraftKey(entry, target, draftMap);
}

function resolveParticipantActionTarget({ participantId = "", rowKey = "", rowIndex = null } = {}) {
  const normalizedId = String(participantId || "").trim();
  const normalizedRowKey = String(rowKey || "").trim();
  const numericIndex = Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : null;

  let index = -1;
  let entry = null;

  if (normalizedRowKey) {
    index = state.participants.findIndex(item => String(item?.rowKey || "") === normalizedRowKey);
    if (index !== -1) {
      entry = state.participants[index];
    }
  }

  if (!entry && normalizedId) {
    index = state.participants.findIndex(item => String(item?.participantId || "") === normalizedId);
    if (index !== -1) {
      entry = state.participants[index];
    }
  }

  if (!entry && numericIndex !== null) {
    const sorted = sortParticipants(state.participants);
    const candidate = sorted[numericIndex];
    if (candidate) {
      index = state.participants.findIndex(item => item === candidate);
      if (index === -1) {
        const candidateRowKey = String(candidate?.rowKey || "");
        if (candidateRowKey) {
          index = state.participants.findIndex(item => String(item?.rowKey || "") === candidateRowKey);
        }
      }
      if (index === -1) {
        const candidateId = String(candidate?.participantId || "");
        if (candidateId) {
          index = state.participants.findIndex(item => String(item?.participantId || "") === candidateId);
        }
      }
      if (index !== -1) {
        entry = state.participants[index];
      }
    }
  }

  return { entry: entry || null, index };
}

function formatParticipantIdentifier(entry) {
  if (!entry) {
    return "参加者";
  }
  const name = String(entry.name || "").trim();
  if (name) {
    return `参加者「${name}」`;
  }
  const displayId = getDisplayParticipantId(entry.participantId);
  if (displayId) {
    return `UID: ${displayId}`;
  }
  return "UID未設定";
}

function commitParticipantQuickEdit(index, updated, { successMessage, successVariant = "success" } = {}) {
  if (index < 0 || !updated) {
    return null;
  }

  const nextEntry = ensureRowKey({ ...updated });
  const rowKey = String(nextEntry.rowKey || "");
  const uid = resolveParticipantUid(nextEntry) || String(nextEntry.participantId || "");

  state.participants[index] = nextEntry;
  state.participants = sortParticipants(state.participants);

  const eventId = state.selectedEventId;
  const groupNumber = String(nextEntry.groupNumber || "");
  if (eventId && uid) {
    const assignmentMap = ensureTeamAssignmentMap(eventId);
    if (assignmentMap) {
      assignmentMap.set(uid, groupNumber);
    }
    const singleMap = new Map([[uid, groupNumber]]);
    applyAssignmentsToEventCache(eventId, singleMap);
  }

  syncCurrentScheduleCache();
  updateDuplicateMatches();
  renderParticipants();
  syncSaveButtonState();

  if (successMessage) {
    setUploadStatus(successMessage, successVariant);
  } else if (hasUnsavedChanges()) {
    setUploadStatus("編集内容は未保存です。「適用」で確定します。");
  } else {
    setUploadStatus("適用済みの内容と同じため変更はありません。");
  }

  if (rowKey) {
    return state.participants.find(item => String(item?.rowKey || "") === rowKey) || nextEntry;
  }
  if (uid) {
    return (
      state.participants.find(item => {
        const itemUid = resolveParticipantUid(item) || String(item?.participantId || "");
        return itemUid === uid;
      }) || nextEntry
    );
  }
  return nextEntry;
}

function handleQuickCancelAction(participantId, rowIndex, rowKey) {
  const target = resolveParticipantActionTarget({ participantId, rowKey, rowIndex });
  const entry = target.entry;
  const index = target.index;
  if (!entry || index === -1) {
    setUploadStatus("キャンセル対象の参加者が見つかりません。", "error");
    return;
  }

  const cancellationLabel = CANCEL_LABEL;
  const updated = {
    ...entry,
    groupNumber: cancellationLabel
  };
  const nextStatus = resolveParticipantStatus(updated, cancellationLabel);
  updated.status = nextStatus;
  updated.isCancelled = nextStatus === "cancelled";
  updated.isRelocated = nextStatus === "relocated";
  updated.relocationDestinationScheduleId = "";
  updated.relocationDestinationScheduleLabel = "";
  updated.relocationDestinationTeamNumber = "";

  const uid = resolveParticipantUid(updated) || String(updated.participantId || "");
  if (uid && relocationManager) {
    const relocationMap = relocationManager.ensurePendingRelocationMap();
    const previous = relocationMap.get(uid);
    if (previous) {
      relocationManager.clearRelocationPreview(previous);
      relocationMap.delete(uid);
    }
  }

  const identifier = formatParticipantIdentifier(entry);
  const message = `${identifier}を${CANCEL_LABEL}に設定しました。「適用」で確定します。`;
  commitParticipantQuickEdit(index, updated, { successMessage: message, successVariant: "success" });

  if (uid && relocationManager && Array.isArray(state.relocationPromptTargets)) {
    const previousLength = state.relocationPromptTargets.length;
    state.relocationPromptTargets = state.relocationPromptTargets.filter(item => {
      const key = item?.uid || item?.participantId || item?.rowKey;
      return key && key !== uid && key !== String(updated.rowKey || "");
    });
    if (state.relocationPromptTargets.length !== previousLength) {
      relocationManager.renderRelocationPrompt();
    }
  }

  if (relocationManager && state.relocationDraftOriginals instanceof Map) {
    const draftMap = state.relocationDraftOriginals;
    [uid, String(updated.rowKey || ""), String(updated.participantId || "")]
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .forEach(key => draftMap.delete(key));
  }
}

function handleQuickRelocateAction(participantId, rowIndex, rowKey) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.handleQuickRelocateAction(participantId, rowIndex, rowKey);
}

function getRelocationScheduleOptions(eventId, excludeScheduleId) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return [];
  }
  return relocationManager.getRelocationScheduleOptions(eventId, excludeScheduleId);
}

function resolveRelocationDefault(entry) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return { destinationId: "", destinationTeam: "" };
  }
  return relocationManager.resolveRelocationDefault(entry);
}

function renderRelocationPrompt() {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.renderRelocationPrompt();
}

function focusRelocationPromptItem(targetKey = "") {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.focusRelocationPromptItem(targetKey);
}

function queueRelocationPrompt(targets = [], { replace = false, focusKey = "" } = {}) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return false;
  }
  return relocationManager.queueRelocationPrompt(targets, { replace, focusKey });
}

function handleRelocationFormSubmit(event) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.handleRelocationFormSubmit(event);
}

function handleRelocationDialogClose(event) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.handleRelocationDialogClose(event);
}

function getScheduleRecord(eventId, scheduleId) {
  if (!eventId || !scheduleId) return null;
  const event = state.events.find(evt => evt.id === eventId);
  if (!event || !Array.isArray(event.schedules)) {
    return null;
  }
  return event.schedules.find(schedule => schedule.id === scheduleId) || null;
}

function buildScheduleOptionLabel(schedule) {
  if (!schedule) {
    return "";
  }
  const baseLabel = schedule.label || schedule.date || schedule.id || "";
  const rangeText = describeScheduleRange(schedule);
  if (rangeText && rangeText !== baseLabel) {
    return baseLabel ? `${baseLabel}（${rangeText}）` : rangeText;
  }
  return baseLabel || rangeText || "";
}



function clearRelocationPreview(relocation) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.clearRelocationPreview(relocation);
}

function upsertRelocationPreview(relocation) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.upsertRelocationPreview(relocation);
}

function applyRelocationDraft(entry, destinationScheduleId, destinationTeamNumber) {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.applyRelocationDraft(entry, destinationScheduleId, destinationTeamNumber);
}

function hasUnsavedChanges() {
  // StateManager に委譲
  if (!stateManager) {
    throw new Error("StateManager is not initialized");
  }
  return stateManager.hasUnsavedChanges();
}

function setUploadStatus(message, variant = "") {
  // StateManager に委譲
  if (!stateManager) {
    throw new Error("StateManager is not initialized");
  }
  return stateManager.setUploadStatus(message, variant);
}

function isPlaceholderUploadStatus() {
  // StateManager に委譲
  if (!stateManager) {
    throw new Error("StateManager is not initialized");
  }
  return stateManager.isPlaceholderUploadStatus();
}

const confirmState = {
  resolver: null,
  keydownHandler: null
};

function cleanupConfirmState() {
  if (confirmState.keydownHandler) {
    document.removeEventListener("keydown", confirmState.keydownHandler, true);
    confirmState.keydownHandler = null;
  }
  confirmState.resolver = null;
}

function finalizeConfirm(result) {
  const resolver = confirmState.resolver;
  cleanupConfirmState();
  if (dom.confirmDialog) {
    closeDialog(dom.confirmDialog);
  }
  if (typeof resolver === "function") {
    resolver(result);
  }
}

function setupConfirmDialog() {
  if (!dom.confirmDialog) return;
  dom.confirmDialog.addEventListener("click", event => {
    if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
      event.preventDefault();
      finalizeConfirm(false);
    }
  });
  if (dom.confirmCancelButton) {
    dom.confirmCancelButton.addEventListener("click", event => {
      event.preventDefault();
      finalizeConfirm(false);
    });
  }
  if (dom.confirmAcceptButton) {
    dom.confirmAcceptButton.addEventListener("click", event => {
      event.preventDefault();
      finalizeConfirm(true);
    });
  }
}

async function confirmAction({
  title = "確認",
  description = "",
  confirmLabel = "実行する",
  cancelLabel = "キャンセル",
  tone = "danger",
  showCancel = true
} = {}) {
  if (!dom.confirmDialog) {
    console.warn("Confirm dialog is unavailable; skipping confirmation.");
    return false;
  }

  if (confirmState.resolver) {
    finalizeConfirm(false);
  }

  if (dom.confirmDialogTitle) {
    dom.confirmDialogTitle.textContent = title || "確認";
  }
  if (dom.confirmDialogMessage) {
    dom.confirmDialogMessage.textContent = description || "";
  }
  if (dom.confirmAcceptButton) {
    dom.confirmAcceptButton.textContent = confirmLabel || "実行する";
    dom.confirmAcceptButton.classList.remove("btn-danger", "btn-primary");
    dom.confirmAcceptButton.classList.add(tone === "danger" ? "btn-danger" : "btn-primary");
  }
  if (dom.confirmCancelButton) {
    dom.confirmCancelButton.textContent = cancelLabel || "キャンセル";
    dom.confirmCancelButton.hidden = !showCancel;
  }

  openDialog(dom.confirmDialog);

  return await new Promise(resolve => {
    confirmState.resolver = resolve;
    confirmState.keydownHandler = event => {
      // N で確認ダイアログをキャンセル（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
      if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        finalizeConfirm(false);
      }
    };
    document.addEventListener("keydown", confirmState.keydownHandler, true);
  });
}

function setLoginError(message = "") {
  if (!dom.loginError) return;
  if (message) {
    dom.loginError.textContent = message;
    dom.loginError.hidden = false;
  } else {
    dom.loginError.textContent = "";
    dom.loginError.hidden = true;
  }
}

function legacyCopyToClipboard(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let success = false;
  try {
    success = typeof document.execCommand === "function" ? document.execCommand("copy") : false;
  } catch (error) {
    success = false;
  }
  document.body.removeChild(textarea);
  return success;
}

function toggleSectionVisibility(element, visible) {
  if (!element) return;
  element.hidden = !visible;
  if (visible) {
    element.removeAttribute("aria-hidden");
    element.removeAttribute("inert");
  } else {
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("inert", "");
  }
}

function emitParticipantSyncEvent(detail = {}) {
  if (typeof document === "undefined") {
    return;
  }

  const payload = { ...detail };
  payload.source = "question-admin";
  payload.eventId = detail.eventId != null ? String(detail.eventId) : state.selectedEventId || "";
  payload.scheduleId = detail.scheduleId != null ? String(detail.scheduleId) : state.selectedScheduleId || "";
  if (typeof detail.participantCount === "number" && Number.isFinite(detail.participantCount)) {
    payload.participantCount = detail.participantCount;
  } else {
    payload.participantCount = Array.isArray(state.participants) ? state.participants.length : 0;
  }
  payload.timestamp = detail.timestamp ? Number(detail.timestamp) : Date.now();

  try {
    document.dispatchEvent(new CustomEvent("qa:participants-synced", { detail: payload }));
  } catch (error) {
    console.warn("Failed to dispatch participant sync event", error);
  }
}

function getSelectionIdentifiers() {
  return {
    eventId: state.selectedEventId ? String(state.selectedEventId) : "",
    scheduleId: state.selectedScheduleId ? String(state.selectedScheduleId) : ""
  };
}

// encodeCsvValue, createCsvContent, buildParticipantCsvFilename, buildTeamCsvFilename, downloadCsvFile は CsvManager に移行されました

function createShareUrl(token) {
  const url = new URL(FORM_PAGE_PATH, window.location.href);
  url.searchParams.set("token", token);
  return url.toString();
}

async function copyShareLink(token) {
  if (!token) return;
  const url = createShareUrl(token);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      setUploadStatus("専用リンクをクリップボードへコピーしました。", "success");
    } else {
      throw new Error("Clipboard API is unavailable");
    }
  } catch (error) {
    console.error(error);
    const copied = legacyCopyToClipboard(url);
    if (copied) {
      setUploadStatus("専用リンクをクリップボードへコピーしました。", "success");
    } else {
      setUploadStatus(`クリップボードにコピーできませんでした。URL: ${url}`, "error");
    }
  }
}

function getParticipantGroupKey(entry) {
  const raw = entry && entry.groupNumber;
  const value = raw != null ? String(raw).trim() : "";
  if (!value) {
    return NO_TEAM_GROUP_KEY;
  }
  if (value === CANCEL_LABEL || value === RELOCATE_LABEL || value === GL_STAFF_GROUP_KEY) {
    return value;
  }
  const normalized = normalizeGroupNumberValue(value);
  return normalized || NO_TEAM_GROUP_KEY;
}

function describeParticipantGroup(groupKey) {
  const raw = String(groupKey || "").trim();
  if (!raw || raw === NO_TEAM_GROUP_KEY) {
    return { label: "班番号", value: "未設定" };
  }
  if (raw === CANCEL_LABEL) {
    return { label: "ステータス", value: CANCEL_LABEL };
  }
  if (raw === RELOCATE_LABEL) {
    return { label: "ステータス", value: RELOCATE_LABEL };
  }
  if (raw === GL_STAFF_GROUP_KEY) {
    return { label: "ステータス", value: GL_STAFF_LABEL };
  }
  const normalized = normalizeGroupNumberValue(raw) || raw;
  return { label: "班番号", value: normalized };
}

function createParticipantGroupElements(groupKey) {
  const { label, value } = describeParticipantGroup(groupKey);
  const section = document.createElement("section");
  section.className = "participant-card-group";
  section.setAttribute("role", "group");
  if (groupKey && groupKey !== NO_TEAM_GROUP_KEY) {
    section.dataset.team = groupKey;
  }
  if (label || value) {
    section.setAttribute("aria-label", `${label} ${value}`.trim());
  }

  const header = document.createElement("header");
  header.className = "participant-card-group__header";

  const badge = document.createElement("span");
  badge.className = "participant-card-group__badge";
  const badgeLabel = document.createElement("span");
  badgeLabel.className = "participant-card-group__badge-label";
  badgeLabel.textContent = label;
  const badgeValue = document.createElement("span");
  badgeValue.className = "participant-card-group__badge-value";
  badgeValue.textContent = value;
  badge.append(badgeLabel, badgeValue);

  const countElement = document.createElement("span");
  countElement.className = "participant-card-group__count";

  const cardsContainer = document.createElement("div");
  cardsContainer.className = "participant-card-group__cards";

  const leadersContainer = document.createElement("div");
  leadersContainer.className = "participant-card-group__leaders";
  leadersContainer.hidden = true;

  const leadersLabel = document.createElement("span");
  leadersLabel.className = "participant-card-group__leaders-label";
  leadersLabel.textContent = "GL";

  const leadersList = document.createElement("div");
  leadersList.className = "participant-card-group__leaders-list";

  leadersContainer.append(leadersLabel, leadersList);

  header.append(badge, leadersContainer, countElement);
  section.append(header, cardsContainer);

  return {
    section,
    cardsContainer,
    countElement,
    leadersContainer,
    leadersList
  };
}

function getEventGlRoster(eventId) {
  if (!(state.glRoster instanceof Map)) {
    state.glRoster = new Map();
  }
  const roster = state.glRoster.get(eventId);
  return roster instanceof Map ? roster : null;
}

function getEventGlAssignmentsMap(eventId) {
  if (!(state.glAssignments instanceof Map)) {
    state.glAssignments = new Map();
  }
  const assignments = state.glAssignments.get(eventId);
  return assignments instanceof Map ? assignments : null;
}

function normalizeGlRoster(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object") {
    return map;
  }
  Object.entries(raw).forEach(([glId, value]) => {
    if (!glId || !value || typeof value !== "object") return;
    map.set(String(glId), {
      id: String(glId),
      name: normalizeKey(value.name || value.fullName || ""),
      phonetic: normalizeKey(value.phonetic || value.furigana || ""),
      grade: normalizeKey(value.grade || ""),
      faculty: normalizeKey(value.faculty || ""),
      department: normalizeKey(value.department || ""),
      email: normalizeKey(value.email || ""),
      club: normalizeKey(value.club || ""),
      sourceType: value.sourceType === "internal" ? "internal" : "external"
    });
  });
  return map;
}

function normalizeGlAssignmentEntry(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const statusRaw = String(raw.status || "").trim().toLowerCase();
  let status = "";
  if (statusRaw === "absent" || statusRaw === "欠席") {
    status = "absent";
  } else if (statusRaw === "unavailable" || statusRaw === "参加不可") {
    status = "unavailable";
  } else if (statusRaw === "staff" || statusRaw === "運営" || statusRaw === "運営待機") {
    status = "staff";
  } else if (statusRaw === "team") {
    status = "team";
  }
  const teamId = normalizeKey(raw.teamId || "");
  if (!status && teamId) {
    status = "team";
  }
  if (!status && !teamId) {
    return null;
  }
  return {
    status,
    teamId,
    updatedAt: Number(raw.updatedAt || 0) || 0,
    updatedByName: normalizeKey(raw.updatedByName || ""),
    updatedByUid: normalizeKey(raw.updatedByUid || "")
  };
}

function normalizeGlAssignments(raw) {
  const map = new Map();
  if (!raw || typeof raw !== "object") {
    return map;
  }

  const ensureEntry = (glId) => {
    const id = String(glId || "").trim();
    if (!id) {
      return null;
    }
    if (!map.has(id)) {
      map.set(id, { fallback: null, schedules: new Map() });
    }
    return map.get(id) || null;
  };

  Object.entries(raw).forEach(([outerKey, outerValue]) => {
    if (!outerValue || typeof outerValue !== "object") {
      return;
    }

    const legacyAssignment = normalizeGlAssignmentEntry(outerValue);
    if (legacyAssignment) {
      const entry = ensureEntry(outerKey);
      if (!entry) {
        return;
      }
      entry.fallback = legacyAssignment;
      const excludedKeys = new Set(["status", "teamId", "updatedAt", "updatedByUid", "updatedByName", "schedules"]);
      Object.entries(outerValue).forEach(([scheduleId, scheduleValue]) => {
        if (excludedKeys.has(scheduleId)) {
          return;
        }
        const normalized = normalizeGlAssignmentEntry(scheduleValue);
        if (!normalized) {
          return;
        }
        const key = String(scheduleId || "").trim();
        if (!key) {
          return;
        }
        entry.schedules.set(key, normalized);
      });
      const scheduleOverrides = outerValue?.schedules && typeof outerValue.schedules === "object"
        ? outerValue.schedules
        : null;
      if (scheduleOverrides) {
        Object.entries(scheduleOverrides).forEach(([scheduleId, scheduleValue]) => {
          const normalized = normalizeGlAssignmentEntry(scheduleValue);
          if (!normalized) {
            return;
          }
          const key = String(scheduleId || "").trim();
          if (!key) {
            return;
          }
          entry.schedules.set(key, normalized);
        });
      }
      return;
    }

    const scheduleId = String(outerKey || "").trim();
    if (!scheduleId) {
      return;
    }
    Object.entries(outerValue).forEach(([glId, value]) => {
      const normalized = normalizeGlAssignmentEntry(value);
      if (!normalized) {
        return;
      }
      const entry = ensureEntry(glId);
      if (!entry) {
        return;
      }
      entry.schedules.set(scheduleId, normalized);
    });
  });

  return map;
}

function resolveScheduleAssignment(entry, scheduleId) {
  if (!entry) {
    return null;
  }
  const key = String(scheduleId || "").trim();
  if (key && entry.schedules instanceof Map && entry.schedules.has(key)) {
    return entry.schedules.get(key) || null;
  }
  return entry.fallback || null;
}

function collectGroupGlLeaders(groupKey, { eventId, rosterMap, assignmentsMap, scheduleId }) {
  const assignments = assignmentsMap instanceof Map ? assignmentsMap : getEventGlAssignmentsMap(eventId);
  const roster = rosterMap instanceof Map ? rosterMap : getEventGlRoster(eventId);
  if (!(assignments instanceof Map) || !(roster instanceof Map)) {
    return [];
  }

  const rawGroupKey = String(groupKey || "").trim();
  const normalizedGroupKey = normalizeKey(rawGroupKey);
  const normalizedCancelLabel = normalizeKey(CANCEL_LABEL);
  const normalizedStaffLabel = normalizeKey(GL_STAFF_LABEL);
  const isCancelGroup = normalizedGroupKey === normalizedCancelLabel;
  const isStaffGroup = rawGroupKey === GL_STAFF_GROUP_KEY || normalizedGroupKey === normalizedStaffLabel;

  const leaders = [];
  assignments.forEach((entry, glId) => {
    const assignment = resolveScheduleAssignment(entry, scheduleId);
    if (!assignment) return;
    const status = assignment.status || "";
    const teamId = normalizeKey(assignment.teamId || "");
    if (status === "team") {
      if (!teamId || isCancelGroup || isStaffGroup || teamId !== normalizedGroupKey) {
        return;
      }
    } else if (status === "absent") {
      if (!isCancelGroup) return;
    } else if (status === "staff") {
      if (!isStaffGroup) return;
    } else {
      return;
    }

    const profile = roster.get(String(glId)) || {};
    const name = profile.name || String(glId);
    const metaParts = [];
    if (status === "absent") {
      metaParts.push("欠席");
    } else if (status === "staff") {
      metaParts.push(GL_STAFF_LABEL);
    }
    if (profile.faculty) {
      metaParts.push(profile.faculty);
    }
    if (profile.department && profile.department !== profile.faculty) {
      metaParts.push(profile.department);
    }
    leaders.push({
      name,
      meta: metaParts.join(" / ")
    });
  });

  leaders.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
  return leaders;
}

function renderGroupGlAssignments(group, context) {
  if (!group || !group.leadersContainer || !group.leadersList) {
    return;
  }
  const container = group.leadersContainer;
  const list = group.leadersList;
  list.innerHTML = "";
  container.hidden = true;
  container.dataset.count = "0";

  const leaders = collectGroupGlLeaders(group.key, context);
  if (!leaders.length) {
    return;
  }

  leaders.forEach(leader => {
    const item = document.createElement("span");
    item.className = "participant-group-gl";
    const nameEl = document.createElement("span");
    nameEl.className = "participant-group-gl__name";
    nameEl.textContent = leader.name;
    item.appendChild(nameEl);
    if (leader.meta) {
      const metaEl = document.createElement("span");
      metaEl.className = "participant-group-gl__meta";
      metaEl.textContent = leader.meta;
      item.appendChild(metaEl);
    }
    list.appendChild(item);
  });

  container.hidden = false;
  container.dataset.count = String(leaders.length);
}

async function loadGlDataForEvent(eventId, { force = false } = {}) {
  const key = normalizeKey(eventId || "");
  if (!key) {
    return;
  }
  if (!force && glDataFetchCache.has(key)) {
    try {
      await glDataFetchCache.get(key);
    } catch (error) {
      // Swallow errors from prior attempts; a manual refresh will retry.
    }
    return;
  }

  const fetchPromise = (async () => {
    try {
      const [applicationsRaw, assignmentsRaw] = await Promise.all([
        fetchDbValue(`glIntake/applications/${key}`),
        fetchDbValue(`glAssignments/${key}`)
      ]);
      const rosterMap = normalizeGlRoster(applicationsRaw || {});
      const assignmentsMap = normalizeGlAssignments(assignmentsRaw || {});
      if (!(state.glRoster instanceof Map)) {
        state.glRoster = new Map();
      }
      if (!(state.glAssignments instanceof Map)) {
        state.glAssignments = new Map();
      }
      state.glRoster.set(key, rosterMap);
      state.glAssignments.set(key, assignmentsMap);
    } catch (error) {
      console.error("Failed to load GL roster", error);
      if (!(state.glRoster instanceof Map)) {
        state.glRoster = new Map();
      }
      if (!(state.glAssignments instanceof Map)) {
        state.glAssignments = new Map();
      }
      if (!state.glRoster.has(key)) {
        state.glRoster.set(key, new Map());
      }
      if (!state.glAssignments.has(key)) {
        state.glAssignments.set(key, new Map());
      }
      throw error;
    } finally {
      if (state.selectedEventId && normalizeKey(state.selectedEventId) === key) {
        renderParticipants();
      }
    }
  })();

  glDataFetchCache.set(key, fetchPromise);
  try {
    await fetchPromise;
  } finally {
    glDataFetchCache.delete(key);
  }
}

function createParticipantBadge(label, value, { hideLabel = false } = {}) {
  const badge = document.createElement("span");
  badge.className = "participant-badge";
  const textValue = value ? String(value) : "—";
  if (!hideLabel && label) {
    const labelSpan = document.createElement("span");
    labelSpan.className = "participant-badge__label";
    labelSpan.textContent = label;
    badge.appendChild(labelSpan);
  }
  const valueSpan = document.createElement("span");
  valueSpan.className = "participant-badge__value";
  valueSpan.textContent = textValue;
  if (label) {
    badge.title = `${label}: ${textValue}`;
  }
  badge.appendChild(valueSpan);
  return badge;
}

const MAIL_STATUS_ICON_SVG = {
  sent:
    "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M13.854 4.146a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0Z\"/></svg>",
  pending:
    "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 1a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm.5 2a.5.5 0 0 0-1 0v3.25a.5.5 0 0 0 .252.434l2 1.143a.5.5 0 0 0 .496-.868L8.5 7.667V4.5Z\"/></svg>",
  error:
    "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 2a.75.75 0 0 0-.75.75v3.5a.75.75 0 1 0 1.5 0v-3.5A.75.75 0 0 0 8 3.5Zm0 6a.875.875 0 1 0 0 1.75.875.875 0 0 0 0-1.75Z\"/></svg>",
  missing:
    "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm3.5 6a.5.5 0 0 0-.5-.5h-6a.5.5 0 0 0 0 1h6a.5.5 0 0 0 .5-.5Z\"/></svg>",
  default:
    "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M2.75 3A1.75 1.75 0 0 0 1 4.75v6.5A1.75 1.75 0 0 0 2.75 13h10.5A1.75 1.75 0 0 0 15 11.25v-6.5A1.75 1.75 0 0 0 13.25 3H2.75Zm.25 1.5h9.5a.25.25 0 0 1 .163.438L8.46 8.735a.75.75 0 0 1-.92 0L2.587 4.938A.25.25 0 0 1 3 4.5ZM2.5 5.809v5.441c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V5.81l-4.62 3.696a2.25 2.25 0 0 1-2.76 0L2.5 5.809Z\"/></svg>"
};

function createMailStatusBadge(entry) {
  const info = resolveMailStatusInfo(entry);
  const badge = document.createElement("span");
  badge.className = "participant-badge participant-mail-badge";
  const statusKey = info.key || "unknown";
  badge.dataset.mailStatus = statusKey;
  badge.classList.add(`participant-mail-badge--${statusKey}`);
  if (info.description) {
    badge.title = info.description;
  } else {
    badge.removeAttribute("title");
  }
  badge.setAttribute("role", "text");
  badge.setAttribute("aria-label", info.ariaLabel || info.label);

  const icon = document.createElement("span");
  icon.className = "participant-mail-badge__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = MAIL_STATUS_ICON_SVG[statusKey] || MAIL_STATUS_ICON_SVG.default;

  const text = document.createElement("span");
  text.className = "participant-badge__value participant-mail-badge__text";
  text.textContent = info.label;

  badge.append(icon, text);
  return { badge, info };
}

function getEntryIdentifiers(entry) {
  const rowKey = entry && entry.rowKey != null ? String(entry.rowKey) : "";
  const participantId = entry && entry.participantId != null ? String(entry.participantId) : "";
  const uidValue = resolveParticipantUid(entry);
  const uid = uidValue != null ? String(uidValue) : "";
  return { rowKey, participantId, uid };
}

function isEntryCurrentlySelected(entry) {
  if (!entry) {
    return false;
  }
  const identifiers = getEntryIdentifiers(entry);
  const selectedRowKey = String(state.selectedParticipantRowKey || "");
  if (selectedRowKey) {
    return identifiers.rowKey && identifiers.rowKey === selectedRowKey;
  }
  const selectedId = String(state.selectedParticipantId || "");
  if (!selectedId) {
    return false;
  }
  return (
    (identifiers.participantId && identifiers.participantId === selectedId) ||
    (identifiers.uid && identifiers.uid === selectedId)
  );
}

function getSelectedParticipantTarget() {
  const selectedRowKey = String(state.selectedParticipantRowKey || "");
  const selectedId = String(state.selectedParticipantId || "");
  if (!selectedRowKey && !selectedId) {
    return { entry: null, index: -1 };
  }
  const target = resolveParticipantActionTarget({ rowKey: selectedRowKey, participantId: selectedId });
  if (!target.entry) {
    clearParticipantSelection({ silent: true });
    applyParticipantSelectionStyles();
    return { entry: null, index: -1 };
  }
  return target;
}

function applyParticipantSelectionStyles({ focusCard = null } = {}) {
  const list = dom.participantCardList;
  if (!list) {
    return;
  }
  const cards = list.querySelectorAll(".participant-card");
  const selectedRowKey = String(state.selectedParticipantRowKey || "");
  const selectedId = String(state.selectedParticipantId || "");
  const shouldFocus = Boolean(focusCard);
  let focusTarget = focusCard || null;
  cards.forEach(card => {
    const rowKey = card.dataset.rowKey ? String(card.dataset.rowKey) : "";
    const participantId = card.dataset.participantId ? String(card.dataset.participantId) : "";
    const uid = card.dataset.uid ? String(card.dataset.uid) : "";
    const matches = selectedRowKey
      ? rowKey && rowKey === selectedRowKey
      : selectedId && (participantId === selectedId || uid === selectedId);
    card.classList.toggle("is-selected", matches);
    card.setAttribute("aria-selected", matches ? "true" : "false");
    if (shouldFocus && matches && !focusTarget) {
      focusTarget = card;
    }
  });
  if (shouldFocus && focusTarget) {
    focusTarget.focus();
  }
}

function clearParticipantSelection({ silent = false } = {}) {
  state.selectedParticipantRowKey = "";
  state.selectedParticipantId = "";
  if (!silent) {
    applyParticipantSelectionStyles();
    updateParticipantActionPanelState();
  }
}

function selectParticipantFromCardElement(card, { focus = false } = {}) {
  if (!card) {
    return;
  }
  const rowKey = card.dataset.rowKey ? String(card.dataset.rowKey) : "";
  const participantId = card.dataset.participantId ? String(card.dataset.participantId) : "";
  const uid = card.dataset.uid ? String(card.dataset.uid) : "";
  const currentRowKey = String(state.selectedParticipantRowKey || "");
  const currentId = String(state.selectedParticipantId || "");
  const nextId = participantId || uid || "";
  if (currentRowKey === rowKey && currentId === nextId) {
    if (focus) {
      card.focus();
    }
    return;
  }
  state.selectedParticipantRowKey = rowKey;
  state.selectedParticipantId = nextId;
  applyParticipantSelectionStyles({ focusCard: focus ? card : null });
  updateParticipantActionPanelState();
}

function buildParticipantCard(entry, index, { changeInfo, duplicateMap, eventId, scheduleId }) {
  const card = document.createElement("article");
  card.className = "participant-card";
  card.setAttribute("role", "listitem");

  const identifiers = getEntryIdentifiers(entry);
  if (identifiers.rowKey) {
    card.dataset.rowKey = identifiers.rowKey;
  }
  if (identifiers.participantId) {
    card.dataset.participantId = identifiers.participantId;
  }
  if (identifiers.uid) {
    card.dataset.uid = identifiers.uid;
  }
  card.dataset.rowIndex = String(index);

  const isSelected = isEntryCurrentlySelected(entry);
  card.classList.toggle("is-selected", isSelected);
  card.setAttribute("aria-selected", isSelected ? "true" : "false");
  card.tabIndex = 0;

  const header = document.createElement("header");
  header.className = "participant-card__header";

  const headerMain = document.createElement("div");
  headerMain.className = "participant-card__header-main";

  const badgeRow = document.createElement("div");
  badgeRow.className = "participant-card__badges";

  const numberBadge = document.createElement("span");
  numberBadge.className = "participant-card__no";
  applyParticipantNoText(numberBadge, index + 1);
  badgeRow.appendChild(numberBadge);

  const departmentText = entry.department || entry.groupNumber || "";
  const departmentBadge = createParticipantBadge("学部学科", departmentText, { hideLabel: true });
  badgeRow.appendChild(departmentBadge);

  const genderText = entry.gender || "";
  const genderBadge = createParticipantBadge("性別", genderText, { hideLabel: true });
  badgeRow.appendChild(genderBadge);

  const { badge: mailBadge, info: mailStatusInfo } = createMailStatusBadge(entry);
  badgeRow.appendChild(mailBadge);

  headerMain.appendChild(badgeRow);

  if (mailStatusInfo?.key) {
    card.dataset.mailStatus = mailStatusInfo.key;
    card.classList.add(`participant-card--mail-${mailStatusInfo.key}`);
  }

  const nameWrapper = document.createElement("span");
  nameWrapper.className = "participant-card__name participant-name";
  const phoneticText = entry.phonetic || entry.furigana || "";
  if (phoneticText) {
    const phoneticSpan = document.createElement("span");
    phoneticSpan.className = "participant-name__phonetic";
    phoneticSpan.textContent = phoneticText;
    nameWrapper.appendChild(phoneticSpan);
  }
  const fullNameSpan = document.createElement("span");
  fullNameSpan.className = "participant-name__text";
  fullNameSpan.textContent = entry.name || "";
  nameWrapper.appendChild(fullNameSpan);

  headerMain.appendChild(nameWrapper);

  header.appendChild(headerMain);

  const body = document.createElement("div");
  body.className = "participant-card__body";

  const actions = document.createElement("div");
  actions.className = "participant-card__actions";
  const linkRow = document.createElement("div");
  linkRow.className = "link-action-row participant-card__buttons participant-card__link-row";

  if (entry.token) {
    const shareUrl = createShareUrl(entry.token);
    const previewLink = document.createElement("a");
    previewLink.href = shareUrl;
    previewLink.target = "_blank";
    previewLink.rel = "noopener noreferrer";
    previewLink.className = "share-link-preview";
    previewLink.textContent = shareUrl;
    linkRow.appendChild(previewLink);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "link-action-btn copy-link-btn";
    copyButton.dataset.token = entry.token;
    copyButton.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M6.25 1.75A2.25 2.25 0 0 0 4 4v7A2.25 2.25 0 0 0 6.25 13.25h4A2.25 2.25 0 0 0 12.5 11V4A2.25 2.25 0 0 0 10.25 1.75h-4Zm0 1.5h4c.414 0 .75.336.75.75v7c0 .414-.336.75-.75.75h-4a.75.75 0 0 1-.75-.75V4c0-.414.336-.75.75-.75ZM3 4.75A.75.75 0 0 0 2.25 5.5v7A2.25 2.25 0 0 0 4.5 14.75h4a.75.75 0 0 0 0-1.5h-4a.75.75 0 0 1-.75-.75v-7A.75.75 0 0 0 3 4.75Z\" fill=\"currentColor\"/></svg><span>コピー</span>";
    linkRow.appendChild(copyButton);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "link-placeholder";
    placeholder.textContent = "リンク未発行";
    linkRow.appendChild(placeholder);
  }

  actions.appendChild(linkRow);

  body.appendChild(actions);

  const duplicateKey = entry.rowKey
    ? String(entry.rowKey)
    : entry.participantId
      ? String(entry.participantId)
      : `__row${index}`;
  const duplicateInfo = duplicateMap.get(duplicateKey);
  const matches = duplicateInfo?.others || [];
  const duplicateCount = duplicateInfo?.totalCount || (matches.length ? matches.length + 1 : 0);
  if (matches.length) {
    card.classList.add("is-duplicate");
    const warning = document.createElement("div");
    warning.className = "duplicate-warning participant-card__warning";
    warning.setAttribute("role", "text");

    const icon = document.createElement("span");
    icon.className = "duplicate-warning__icon";
    icon.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.333a6.667 6.667 0 1 0 0 13.334A6.667 6.667 0 0 0 8 1.333Zm0 2a.833.833 0 0 1 .833.834v3.75a.833.833 0 1 1-1.666 0v-3.75A.833.833 0 0 1 8 3.333Zm0 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z\"/></svg>";

    const text = document.createElement("span");
    text.className = "duplicate-warning__text";
    const detail = matches
      .map(match => describeDuplicateMatch(match, eventId, scheduleId))
      .filter(Boolean)
      .join("、");
    if (duplicateCount > 1) {
      text.textContent = detail
        ? `重複候補 (${duplicateCount}件): ${detail}`
        : `重複候補 (${duplicateCount}件)`;
    } else {
      text.textContent = detail ? `重複候補: ${detail}` : "重複候補があります";
    }

    warning.append(icon, text);
    body.appendChild(warning);
  }

  if (entry.isCancelled) {
    card.classList.add("is-cancelled-origin");
  }
  if (entry.isRelocated) {
    card.classList.add("is-relocated-destination");
  }

  if (changeInfo?.type === "added") {
    card.classList.add("is-added");
  } else if (changeInfo?.type === "updated") {
    card.classList.add("is-updated");
  }

  if (changeInfo) {
    const chip = document.createElement("span");
    chip.className = `change-chip change-chip--${changeInfo.type}`;
    chip.textContent = changeInfo.type === "added" ? "新規" : "更新";
    if (changeInfo.type === "updated" && Array.isArray(changeInfo.changes) && changeInfo.changes.length) {
      chip.title = changeInfo.changes
        .map(change => `${change.label}: ${formatChangeValue(change.previous)} → ${formatChangeValue(change.current)}`)
        .join("\n");
    }
    nameWrapper.appendChild(chip);
  }

  card.append(header, body);
  return { card, isSelected };
}

function renderParticipants() {
  // ParticipantManager に委譲
  if (!participantManager) {
    throw new Error("ParticipantManager is not initialized");
  }
  participantManager.renderParticipants();
}

// 元の renderParticipants 実装は ParticipantManager に移行されました

// buildParticipantPrintGroups と buildStaffPrintGroups は PrintManager に移行されました

function hydratePrintSettingsFromStorage() {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.hydrateSettingsFromStorage();
}

function persistPrintSettings(settings) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.persistSettings(settings);
}

function applyPrintSettingsToForm(settings = state.printSettings) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.applySettingsToForm(settings);
}

function readPrintSettingsFromForm() {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.readSettingsFromForm();
}

function setupPrintSettingsDialog() {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.setupSettingsDialog();
}

// PRINT_PREVIEW_DEFAULT_NOTE と PRINT_PREVIEW_LOAD_TIMEOUT_MS は PrintManager に移行されました

function cacheParticipantPrintPreview(data = {}, options = {}) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.cacheParticipantPrintPreview(data, options);
}

function setPrintPreviewNote(text, options = {}) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.setPrintPreviewNote(text, options);
}
function setPrintPreviewVisibility(visible) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.setPrintPreviewVisibility(visible);
}

function setPrintPreviewBusy(isBusy = false) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.setPrintPreviewBusy(isBusy);
}

function clearParticipantPrintPreviewLoader() {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.clearParticipantPrintPreviewLoader();
}

function resetPrintPreview(options = {}) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.resetPrintPreview(options);
}

function renderPreviewFallbackNote(message, metaText = "") {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.renderPreviewFallbackNote(message, metaText);
}
function openPopupPrintWindow(html, docTitle, printSettings = state.printSettings) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.openPopupPrintWindow(html, docTitle, printSettings);
}

function renderParticipantPrintPreview({
  html,
  metaText,
  title,
  autoPrint = false,
  printSettings
} = {}) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.renderParticipantPrintPreview({
    html,
    metaText,
    title,
    autoPrint,
    printSettings
  });
}
function triggerPrintFromPreview() {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.triggerPrintFromPreview();
}

function printParticipantPreview({ showAlertOnFailure = false } = {}) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  return printManager.printParticipantPreview({ showAlertOnFailure });
}

function closeParticipantPrintPreview() {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  printManager.closeParticipantPrintPreview();
}


async function updateParticipantPrintPreview({ autoPrint = false, forceReveal = false, quiet = false } = {}) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
        }
  return await printManager.updateParticipantPrintPreview({ autoPrint, forceReveal, quiet });
}


async function openParticipantPrintView() {
  logPrintInfo("openParticipantPrintView start");
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    window.alert("印刷するにはイベントと日程を選択してください。");
    logPrintWarn("openParticipantPrintView missing selection");
    return;
  }

  if (!Array.isArray(state.participants) || state.participants.length === 0) {
    window.alert("印刷できる参加者がまだ登録されていません。");
    logPrintWarn("openParticipantPrintView no participants");
    return;
  }

  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  if (printManager.participantPrintInProgress) {
    logPrintWarn("openParticipantPrintView skipped: print in progress");
    return;
  }

  setPrintPreviewVisibility(true);
  applyPrintSettingsToForm(state.printSettings);
  logPrintInfo("openParticipantPrintView updating preview");
  await updateParticipantPrintPreview({ autoPrint: false, forceReveal: true });
}

async function updateStaffPrintPreview({ autoPrint = false, forceReveal = false, quiet = false } = {}) {
  // PrintManager に委譲
  if (!printManager) {
    throw new Error("PrintManager is not initialized");
      }
  return await printManager.updateStaffPrintPreview({ autoPrint, forceReveal, quiet });
}


async function openStaffPrintView() {
  logPrintInfo("openStaffPrintView start");
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    window.alert("印刷するにはイベントと日程を選択してください。");
    logPrintWarn("openStaffPrintView missing selection");
    return;
  }

  if (!printManager) {
    throw new Error("PrintManager is not initialized");
  }
  const staffGroups = printManager.buildStaffPrintGroups({ eventId, scheduleId });
  const totalStaff = staffGroups.reduce((sum, group) => sum + (group.members?.length || 0), 0);
  if (!totalStaff) {
    window.alert("印刷できるスタッフがまだ登録されていません。");
    logPrintWarn("openStaffPrintView no staff");
    return;
  }

  const inProgress = printManager.staffPrintInProgress;
  if (inProgress) {
    logPrintWarn("openStaffPrintView skipped: print in progress");
    return;
  }

  setPrintPreviewVisibility(true);
  applyPrintSettingsToForm(state.printSettings);
  logPrintInfo("openStaffPrintView updating preview");
  await updateStaffPrintPreview({ autoPrint: false, forceReveal: true });
}

function participantChangeKey(entry, fallbackIndex = 0) {
  if (!entry) {
    return `__row${fallbackIndex}`;
  }
  const id = entry.participantId ? String(entry.participantId) : "";
  if (id) return id;
  const rowKey = entry.rowKey ? String(entry.rowKey) : "";
  if (rowKey) return rowKey;
  return `__row${fallbackIndex}`;
}

function formatChangeValue(value) {
  const text = String(value ?? "").trim();
  return text ? text : "（空欄）";
}

const CHANGE_ICON_SVG = {
  added: "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.5a.5.5 0 0 1 .5.5v5.5H14a.5.5 0 0 1 0 1H8.5V14a.5.5 0 0 1-1 0V8.5H2a.5.5 0 0 1 0-1h5.5V2a.5.5 0 0 1 .5-.5Z\"/></svg>",
  updated: "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>",
  removed: "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>"
};

function changeTypeLabel(type) {
  switch (type) {
    case "added":
      return "新規追加";
    case "updated":
      return "更新";
    case "removed":
      return "削除予定";
    default:
      return "変更";
  }
}

function describeParticipantForChange(entry) {
  if (!entry) return "参加者";
  const name = String(entry.name || "").trim();
  const displayId = getDisplayParticipantId(entry.participantId);
  if (name && displayId) {
    return `参加者「${name}」（UID: ${displayId}）`;
  }
  if (name) {
    return `参加者「${name}」`;
  }
  if (displayId) {
    return `UID: ${displayId}`;
  }
  return "参加者";
}

function buildChangeMeta(entry) {
  if (!entry) return "";
  const metaParts = [];
  const displayId = getDisplayParticipantId(entry.participantId);
  metaParts.push(displayId ? `UID: ${displayId}` : "UID: 未設定");
  const team = String(entry.groupNumber || "").trim();
  if (team) {
    metaParts.push(`班番号: ${team}`);
  }
  const department = String(entry.department || "").trim();
  if (department) {
    metaParts.push(department);
  }
  return metaParts.join(" / ");
}

function createChangePreviewItem(type, entry, info = {}) {
  const item = document.createElement("li");
  item.className = `change-preview__item change-preview__item--${type}`;

  const icon = document.createElement("span");
  icon.className = "change-preview__icon";
  icon.innerHTML = CHANGE_ICON_SVG[type] || "";
  icon.setAttribute("aria-hidden", "true");
  item.appendChild(icon);

  const body = document.createElement("div");
  body.className = "change-preview__body";

  const heading = document.createElement("p");
  heading.className = "change-preview__line";
  heading.textContent = `${changeTypeLabel(type)}: ${describeParticipantForChange(entry)}`;
  body.appendChild(heading);

  const metaText = buildChangeMeta(entry);
  if (metaText) {
    const meta = document.createElement("p");
    meta.className = "change-preview__line change-preview__line--meta";
    meta.textContent = metaText;
    body.appendChild(meta);
  }

  if (type === "updated" && Array.isArray(info.changes) && info.changes.length) {
    const changeList = document.createElement("ul");
    changeList.className = "change-preview__changes";
    info.changes.forEach(change => {
      const changeItem = document.createElement("li");
      changeItem.className = "change-preview__change";
      changeItem.textContent = `${change.label}: ${formatChangeValue(change.previous)} → ${formatChangeValue(change.current)}`;
      changeList.appendChild(changeItem);
    });
    body.appendChild(changeList);
  }

  item.appendChild(body);
  return item;
}

function renderParticipantChangePreview(diff, changeInfoByKey, participants = []) {
  if (!dom.changePreview || !dom.changePreviewList) {
    return;
  }

  const totalChanges = (diff.added?.length || 0) + (diff.updated?.length || 0) + (diff.removed?.length || 0);
  if (!hasUnsavedChanges() || totalChanges === 0) {
    dom.changePreview.hidden = true;
    dom.changePreviewList.innerHTML = "";
    if (dom.changePreviewCount) dom.changePreviewCount.textContent = "";
    return;
  }

  dom.changePreview.hidden = false;

  const summaryParts = [];
  if (diff.updated?.length) summaryParts.push(`更新 ${diff.updated.length}件`);
  if (diff.added?.length) summaryParts.push(`新規 ${diff.added.length}件`);
  if (diff.removed?.length) summaryParts.push(`削除 ${diff.removed.length}件`);
  if (dom.changePreviewCount) {
    dom.changePreviewCount.textContent = summaryParts.join(" / ");
  }

  const fragment = document.createDocumentFragment();
  const seenKeys = new Set();

  (participants || []).forEach((entry, index) => {
    const key = participantChangeKey(entry, index);
    const info = changeInfoByKey.get(key);
    if (!info) return;
    seenKeys.add(key);
    const snapshot = info.current || entry;
    fragment.appendChild(createChangePreviewItem(info.type, snapshot, info));
  });

  (diff.removed || []).forEach(entry => {
    const key = participantChangeKey(entry);
    if (seenKeys.has(key)) return;
    fragment.appendChild(createChangePreviewItem("removed", entry));
  });

  dom.changePreviewList.innerHTML = "";
  dom.changePreviewList.appendChild(fragment);

  if (dom.changePreviewNote) {
    dom.changePreviewNote.textContent = "「適用」で変更を確定し、「取消」で破棄できます。";
  }
}

function syncSelectedEventSummary() {
  const eventId = state.selectedEventId;
  if (!eventId) return;

  const selectedEvent = state.events.find(evt => evt.id === eventId);
  if (!selectedEvent) return;

  const schedules = Array.isArray(selectedEvent.schedules) ? selectedEvent.schedules : [];
  const participantCount = Array.isArray(state.participants) ? state.participants.length : 0;
  const scheduleId = state.selectedScheduleId;

  let changed = false;

  if (scheduleId && schedules.length) {
    const schedule = schedules.find(item => item.id === scheduleId);
    if (schedule && Number(schedule.participantCount || 0) !== participantCount) {
      schedule.participantCount = participantCount;
      changed = true;
    }
  }

  const totalParticipants = schedules.reduce(
    (acc, schedule) => acc + Number(schedule?.participantCount || 0),
    0
  );

  if (Number(selectedEvent.totalParticipants || 0) !== totalParticipants) {
    selectedEvent.totalParticipants = totalParticipants;
    changed = true;
  }

  if (Number(selectedEvent.scheduleCount || 0) !== schedules.length) {
    selectedEvent.scheduleCount = schedules.length;
    changed = true;
  }

  if (changed) {
    renderSchedules();
    renderEvents();
  }
}

function renderEvents() {
  // EventManager に委譲
  if (!eventManager) {
    throw new Error("EventManager is not initialized");
  }
  eventManager.renderEvents();
}

function renderSchedules() {
  // ScheduleManager に委譲
  if (!scheduleManager) {
    return;
  }
  scheduleManager.renderSchedules();
}

function syncSaveButtonState() {
  const unsaved = hasUnsavedChanges();
  if (dom.saveButton) {
    dom.saveButton.disabled = state.saving || !unsaved;
  }
  if (dom.discardButton) {
    const disabled = state.saving || !unsaved;
    dom.discardButton.disabled = disabled;
    if (disabled) {
      dom.discardButton.setAttribute("aria-disabled", "true");
    } else {
      dom.discardButton.removeAttribute("aria-disabled");
    }
  }
  updateParticipantActionPanelState();
}

function syncClearButtonState() {
  if (!dom.clearParticipantsButton) return;
  const hasSelection = Boolean(state.selectedEventId && state.selectedScheduleId);
  const hasParticipants = hasSelection && state.participants.length > 0;
  dom.clearParticipantsButton.disabled = !hasSelection || !hasParticipants || state.saving;
  updateParticipantActionPanelState();
  syncMailActionState();
  syncAllPrintButtonStates();
}

function syncTemplateButtons() {
  const hasSelection = Boolean(state.selectedEventId && state.selectedScheduleId);
  const hasParticipants = hasSelection && state.participants.some(entry => resolveParticipantUid(entry));

  if (dom.downloadParticipantTemplateButton) {
    dom.downloadParticipantTemplateButton.disabled = !hasSelection;
    if (hasSelection) {
      dom.downloadParticipantTemplateButton.removeAttribute("aria-disabled");
    } else {
      dom.downloadParticipantTemplateButton.setAttribute("aria-disabled", "true");
    }
  }

  if (dom.downloadTeamTemplateButton) {
    dom.downloadTeamTemplateButton.disabled = !hasParticipants;
    if (hasParticipants) {
      dom.downloadTeamTemplateButton.removeAttribute("aria-disabled");
      dom.downloadTeamTemplateButton.removeAttribute("title");
    } else {
      dom.downloadTeamTemplateButton.setAttribute("aria-disabled", "true");
      dom.downloadTeamTemplateButton.setAttribute("title", "参加者リストを読み込むとダウンロードできます。");
    }
  }

  syncMailActionState();
  syncAllPrintButtonStates();
}

function setActionButtonState(button, disabled) {
  if (!button) {
    return;
  }
  button.disabled = disabled;
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
  } else {
    button.removeAttribute("aria-disabled");
  }
}

function getPendingMailCount() {
  // MailManager に委譲
  if (!mailManager) {
    return 0;
  }
  return mailManager.getPendingMailCount();
}

let printActionButtonMissingLogged = false;
let staffPrintActionButtonMissingLogged = false;

function syncAllPrintButtonStates() {
  syncPrintViewButtonState();
  syncStaffPrintViewButtonState();
}

function syncPrintViewButtonState() {
  logPrintDebug("syncPrintViewButtonState start");
  const button = dom.openPrintViewButton;
  if (!button) {
    if (!printActionButtonMissingLogged) {
      printActionButtonMissingLogged = true;
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[Print] open-print-view-button が見つからないため、印刷アクションの状態を同期できませんでした。");
      }
    }
    logPrintWarn("syncPrintViewButtonState aborted: missing button");
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "印刷用リスト";
  }

  if (button.dataset.printing === "true") {
    logPrintDebug("syncPrintViewButtonState printing state");
    setActionButtonState(button, true);
    const busyLabel = button.dataset.printingLabel || "印刷準備中…";
    if (!button.dataset.printingLabel) {
      button.dataset.printingLabel = busyLabel;
    }
    if (button.textContent !== busyLabel) {
      button.textContent = busyLabel;
    }
    return;
  }

  if (button.dataset.printLocked === "true") {
    logPrintDebug("syncPrintViewButtonState locked state");
    setActionButtonState(button, true);
    const defaultLabel = button.dataset.defaultLabel || "印刷用リスト";
    if (button.textContent !== defaultLabel) {
      button.textContent = defaultLabel;
    }
    return;
  }

  const participantList = Array.isArray(state.participants) ? state.participants : [];
  const hasSelection = Boolean(state.selectedEventId && state.selectedScheduleId);
  const hasParticipants = hasSelection && participantList.length > 0;
  const disabled = !hasSelection || !hasParticipants;

  logPrintDebug("syncPrintViewButtonState resolved", { hasSelection, hasParticipants, disabled });

  setActionButtonState(button, disabled);

  if (disabled) {
    closeParticipantPrintPreview();
  }

  const baseLabel = button.dataset.defaultLabel || "印刷用リスト";
  if (button.textContent !== baseLabel) {
    button.textContent = baseLabel;
  }

}

function syncStaffPrintViewButtonState() {
  logPrintDebug("syncStaffPrintViewButtonState start");
  const button = dom.openStaffPrintViewButton;
  if (!button) {
    if (!staffPrintActionButtonMissingLogged) {
      staffPrintActionButtonMissingLogged = true;
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[Print] open-staff-print-view-button が見つからないため、印刷アクションの状態を同期できませんでした。");
      }
    }
    logPrintWarn("syncStaffPrintViewButtonState aborted: missing button");
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "スタッフ印刷";
  }

  if (button.dataset.printing === "true") {
    setActionButtonState(button, true);
    const busyLabel = button.dataset.printingLabel || "印刷準備中…";
    if (!button.dataset.printingLabel) {
      button.dataset.printingLabel = busyLabel;
    }
    if (button.textContent !== busyLabel) {
      button.textContent = busyLabel;
    }
    return;
  }

  if (button.dataset.printLocked === "true") {
    setActionButtonState(button, true);
    const defaultLabel = button.dataset.defaultLabel || "スタッフ印刷";
    if (button.textContent !== defaultLabel) {
      button.textContent = defaultLabel;
    }
    return;
  }

  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  const hasSelection = Boolean(eventId && scheduleId);
  const staffGroups = hasSelection && printManager ? printManager.buildStaffPrintGroups({ eventId, scheduleId }) : [];
  const totalStaff = staffGroups.reduce((sum, group) => sum + (group.members?.length || 0), 0);
  const disabled = !hasSelection || totalStaff === 0;

  setActionButtonState(button, disabled);

  const baseLabel = button.dataset.defaultLabel || "スタッフ印刷";
  if (button.textContent !== baseLabel) {
    button.textContent = baseLabel;
  }
}

function setPrintButtonBusy(isBusy) {
  const button = dom.openPrintViewButton;
  if (!button) return;
  logPrintDebug("setPrintButtonBusy", { isBusy });
  if (isBusy) {
    button.dataset.printing = "true";
  } else {
    delete button.dataset.printing;
  }
  syncAllPrintButtonStates();
}

function setStaffPrintButtonBusy(isBusy) {
  const button = dom.openStaffPrintViewButton;
  if (!button) return;
  logPrintDebug("setStaffPrintButtonBusy", { isBusy });
  if (isBusy) {
    button.dataset.printing = "true";
  } else {
    delete button.dataset.printing;
  }
  syncAllPrintButtonStates();
}

// logMailInfo, logMailWarn, logMailError, MAIL_LOG_ENABLED, MAIL_LOG_OUTPUT_ENABLED, MAIL_LOG_PREFIX, mailActionButtonMissingLogged, lastMailActionStateSignature は MailManager に移行されました

function syncMailActionState() {
  // MailManager に委譲
  if (!mailManager) {
    return;
  }
  mailManager.syncMailActionState();
}

function updateParticipantActionPanelState() {
  const panel = dom.participantActionPanel;
  const info = dom.participantActionInfo;
  const editButton = dom.editSelectedParticipantButton;
  const cancelButton = dom.cancelSelectedParticipantButton;
  const relocateButton = dom.relocateSelectedParticipantButton;
  const deleteButton = dom.deleteSelectedParticipantButton;

  const target = getSelectedParticipantTarget();
  const entry = target.entry;
  const hasSelection = Boolean(entry);
  const disableIndividual = state.saving || !hasSelection;

  setActionButtonState(editButton, disableIndividual);
  setActionButtonState(cancelButton, disableIndividual);
  setActionButtonState(relocateButton, disableIndividual);
  setActionButtonState(deleteButton, disableIndividual);

  const actionable = Boolean(
    (dom.saveButton && !dom.saveButton.disabled) ||
    (dom.discardButton && !dom.discardButton.disabled) ||
    (dom.clearParticipantsButton && !dom.clearParticipantsButton.disabled) ||
    (editButton && !editButton.disabled) ||
    (cancelButton && !cancelButton.disabled) ||
    (relocateButton && !relocateButton.disabled) ||
    (deleteButton && !deleteButton.disabled)
  );

  if (panel) {
    panel.classList.toggle("is-idle", !actionable);
  }

  if (info) {
    if (entry) {
      info.textContent = `${formatParticipantIdentifier(entry)}を選択中`;
    } else if (actionable) {
      info.textContent = "参加者を選択すると個別操作ができます。";
    } else {
      info.textContent = "操作可能なボタンはありません。";
    }
  }
}

function setParticipantTab(tabKey = "manage") {
  const target = tabKey === "csv" ? "csv" : "manage";
  state.activeParticipantTab = target;
  const entries = [
    { key: "manage", tab: dom.participantManageTab, panel: dom.participantManagePanel },
    { key: "csv", tab: dom.participantCsvTab, panel: dom.participantCsvPanel }
  ];
  entries.forEach(({ key, tab, panel }) => {
    const isActive = key === target;
    if (tab) {
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.setAttribute("tabindex", isActive ? "0" : "-1");
    }
    if (panel) {
      panel.hidden = !isActive;
      if (isActive) {
        panel.removeAttribute("aria-hidden");
      } else {
        panel.setAttribute("aria-hidden", "true");
      }
    }
  });
}

function focusParticipantTab(tabKey) {
  if (tabKey === "csv" && dom.participantCsvTab) {
    dom.participantCsvTab.focus();
    return;
  }
  if (dom.participantManageTab) {
    dom.participantManageTab.focus();
  }
}

function setupParticipantTabs() {
  const entries = [
    { key: "manage", tab: dom.participantManageTab },
    { key: "csv", tab: dom.participantCsvTab }
  ].filter(entry => entry.tab instanceof HTMLElement);

  if (!entries.length) {
    return;
  }

  entries.forEach(({ key, tab }, index) => {
    tab.addEventListener("click", () => setParticipantTab(key));
    tab.addEventListener("keydown", event => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (index + direction + entries.length) % entries.length;
        const next = entries[nextIndex];
        setParticipantTab(next.key);
        focusParticipantTab(next.key);
      } else if (event.key === "Home" || event.key === "PageUp") {
        event.preventDefault();
        const first = entries[0];
        setParticipantTab(first.key);
        focusParticipantTab(first.key);
      } else if (event.key === "End" || event.key === "PageDown") {
        event.preventDefault();
        const last = entries[entries.length - 1];
        setParticipantTab(last.key);
        focusParticipantTab(last.key);
      }
    });
  });

  setParticipantTab(state.activeParticipantTab || "manage");
}

function updateParticipantContext(options = {}) {
  const { preserveStatus = false } = options;
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  const shouldPreserveStatus = preserveStatus && !isPlaceholderUploadStatus();
  const descriptionTarget = dom.participantDescriptionMain || dom.participantDescription;
  if (!eventId || !scheduleId) {
    if (descriptionTarget) {
      descriptionTarget.textContent = PARTICIPANT_DESCRIPTION_DEFAULT;
    }
    if (dom.saveButton) dom.saveButton.disabled = true;
    if (dom.csvInput) {
      dom.csvInput.disabled = true;
      dom.csvInput.value = "";
    }
    if (dom.teamCsvInput) {
      dom.teamCsvInput.disabled = true;
      dom.teamCsvInput.value = "";
    }
    if (!shouldPreserveStatus) setUploadStatus(getMissingSelectionStatusMessage());
    if (dom.fileLabel) dom.fileLabel.textContent = "参加者CSVをアップロード";
    if (dom.teamFileLabel) dom.teamFileLabel.textContent = "班番号CSVをアップロード";
    if (dom.participantCardList) dom.participantCardList.innerHTML = "";
    if (dom.adminSummary) dom.adminSummary.textContent = "";
    syncTemplateButtons();
    syncClearButtonState();
    return;
  }

  const overrideKey = `${eventId}::${scheduleId}`;
  const selectedEvent = state.events.find(evt => evt.id === eventId);
  const override = state.scheduleContextOverrides instanceof Map
    ? state.scheduleContextOverrides.get(overrideKey) || null
    : null;
  const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === scheduleId);

  if (dom.csvInput) dom.csvInput.disabled = false;
  if (dom.teamCsvInput) dom.teamCsvInput.disabled = false;
  if (descriptionTarget) {
    descriptionTarget.textContent = PARTICIPANT_DESCRIPTION_DEFAULT;
  }
  if (state.scheduleContextOverrides instanceof Map && override && selectedSchedule) {
    state.scheduleContextOverrides.delete(overrideKey);
  }
  if (!shouldPreserveStatus) {
    setUploadStatus("ファイルを選択して参加者リストを更新してください。");
  }

  syncTemplateButtons();
  syncClearButtonState();
}

async function loadEvents({ preserveSelection = true } = {}) {
  // EventManager に委譲
  if (!eventManager) {
    throw new Error("EventManager is not initialized");
    }
  return await eventManager.loadEvents({ preserveSelection });
}

async function loadParticipants(options = {}) {
  // ParticipantManager に委譲
  if (!participantManager) {
    throw new Error("ParticipantManager is not initialized");
  }
  return await participantManager.loadParticipants(options);
}

// 元の loadParticipants 実装は ParticipantManager に移行されました

function selectEvent(eventId, options = {}) {
  // EventManager に委譲
  if (!eventManager) {
    throw new Error("EventManager is not initialized");
  }
  eventManager.selectEvent(eventId, options);
}

function selectSchedule(scheduleId, options = {}) {
  // ScheduleManager に委譲
  if (!scheduleManager) {
    return;
  }
  scheduleManager.selectSchedule(scheduleId, options);
  }

// resolveScheduleFormValues は ScheduleManager に移行されました

function openEventForm({ mode = "create", event = null } = {}) {
  // EventManager に委譲
  if (!eventManager) {
    throw new Error("EventManager is not initialized");
  }
  eventManager.openEventForm({ mode, event });
}

function openScheduleForm({ mode = "create", schedule = null } = {}) {
  // ScheduleManager に委譲
  if (!scheduleManager) {
    return;
  }
  scheduleManager.openScheduleForm({ mode, schedule });
}

async function handleAddEvent(name) {
  // EventManager に委譲
  if (!eventManager) {
    throw new Error("EventManager is not initialized");
    }
  return await eventManager.createEvent(name);
}

async function handleUpdateEvent(eventId, name) {
  // EventManager に委譲
  if (!eventManager) {
    throw new Error("EventManager is not initialized");
  }
  return await eventManager.updateEvent(eventId, name);
}

async function handleDeleteEvent(eventId, eventName) {
  // EventManager に委譲
  if (!eventManager) {
    throw new Error("EventManager is not initialized");
    }
  return await eventManager.deleteEvent(eventId, eventName);
}

async function handleAddSchedule({ label, location, date, startTime, endTime }) {
  // ScheduleManager に委譲
  if (!scheduleManager) {
    throw new Error("ScheduleManager is not initialized");
  }
  return await scheduleManager.createSchedule({ label, location, date, startTime, endTime });
}

async function handleUpdateSchedule(scheduleId, { label, location, date, startTime, endTime }) {
  // ScheduleManager に委譲
  if (!scheduleManager) {
    throw new Error("ScheduleManager is not initialized");
  }
  return await scheduleManager.updateSchedule(scheduleId, { label, location, date, startTime, endTime });
}

async function handleDeleteSchedule(scheduleId, scheduleLabel) {
  // ScheduleManager に委譲
  if (!scheduleManager) {
    return;
  }
  return await scheduleManager.deleteSchedule(scheduleId, scheduleLabel);
}

// handleCsvChange, handleTeamCsvChange, downloadParticipantTemplate, downloadTeamTemplate は CsvManager に移行されました

async function handleSave(options = {}) {
  // ParticipantManager に委譲
  if (!participantManager) {
    throw new Error("ParticipantManager is not initialized");
  }
  return await participantManager.handleSave(options);
}

// 元の handleSave 実装は ParticipantManager に移行されました

function buildMailStatusMessage({
  sent = 0,
  failed = 0,
  skippedMissingEmail = 0,
  skippedAlreadySent = 0
} = {}) {
  // MailManager に委譲
  if (!mailManager) {
    return "送信対象の参加者が見つかりませんでした。";
  }
  return mailManager.buildMailStatusMessage({ sent, failed, skippedMissingEmail, skippedAlreadySent });
}

function applyMailSendResults(results = []) {
  // MailManager に委譲
  if (!mailManager) {
    return 0;
  }
  return mailManager.applyMailSendResults(results);
}

async function handleSendParticipantMail() {
  // MailManager に委譲
  if (!mailManager) {
    return;
  }
  return await mailManager.handleSendParticipantMail();
}

async function handleRevertParticipants() {
  if (!hasUnsavedChanges()) {
    setUploadStatus("取り消す変更はありません。");
    return;
  }

  const confirmed = await confirmAction({
    title: "変更の取り消し",
    description: "未保存の変更をすべて破棄し、最新の参加者リストを読み込み直します。よろしいですか？",
    confirmLabel: "取り消す",
    cancelLabel: "キャンセル"
  });

  if (!confirmed) {
    return;
  }

  setUploadStatus("未保存の変更を破棄しています…");
  try {
    const eventId = state.selectedEventId;
    if (eventId && state.teamAssignments instanceof Map) {
      state.teamAssignments.delete(eventId);
    }
    state.relocationDraftOriginals = new Map();
    await loadParticipants({ statusMessage: "未保存の変更を取り消しました。", statusVariant: "success" });
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "変更の取り消しに失敗しました。", "error");
  }
}

async function handleClearParticipants() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    setUploadStatus(getSelectionRequiredMessage(), "error");
    return;
  }

  if (!state.participants.length) {
    setUploadStatus("参加者リストは既に空です。", "success");
    return;
  }

  const selectedEvent = state.events.find(evt => evt.id === eventId);
  const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === scheduleId);
  const label = selectedSchedule?.label || scheduleId;

  const confirmed = await confirmAction({
    title: "参加者リストの全削除",
    description: `日程「${label}」に登録されている参加者を全て削除します。適用すると元に戻せません。よろしいですか？`,
    confirmLabel: "全て削除する",
    cancelLabel: "キャンセル",
    tone: "danger"
  });

  if (!confirmed) {
    return;
  }

  const previousParticipants = state.participants.slice();
  const previousTokenMap = new Map(state.participantTokenMap);
  const previousSignature = state.lastSavedSignature;
  const previousSavedParticipants = Array.isArray(state.savedParticipants)
    ? state.savedParticipants.slice()
    : [];
  const previousSavedEntries = Array.isArray(state.savedParticipantEntries)
    ? state.savedParticipantEntries.map(entry => cloneParticipantEntry(entry))
    : [];
  const previousBaselineReady = state.participantBaselineReady;

  state.participants = [];
  state.participantTokenMap = new Map();
  state.duplicateMatches = new Map();
  state.duplicateGroups = new Map();
  captureParticipantBaseline(state.participants);
  renderParticipants();

  const success = await handleSave({ allowEmpty: true, successMessage: "参加者リストを全て削除しました。" });
  if (!success) {
    state.participants = previousParticipants;
    state.participantTokenMap = previousTokenMap;
    state.lastSavedSignature = previousSignature;
    state.savedParticipants = previousSavedParticipants;
    state.savedParticipantEntries = previousSavedEntries;
    state.participantBaselineReady = previousBaselineReady;
    updateDuplicateMatches();
    renderParticipants();
  }
}
function setAuthUi(signedIn) {
  const embedded = isEmbeddedMode();
  const shouldShowLogin = !signedIn && !embedded;
  const shouldShowAdmin = signedIn || embedded;
  toggleSectionVisibility(dom.loginCard, shouldShowLogin);
  toggleSectionVisibility(dom.adminMain, shouldShowAdmin);

  if (signedIn) {
    renderUserSummary(state.user);
    setLoginError("");
  } else {
    renderUserSummary(null);
  }

  if (dom.headerLogout) {
    dom.headerLogout.hidden = !signedIn;
    if (signedIn) {
      dom.headerLogout.removeAttribute("aria-hidden");
      dom.headerLogout.removeAttribute("inert");
      dom.headerLogout.disabled = false;
    } else {
      dom.headerLogout.setAttribute("aria-hidden", "true");
      dom.headerLogout.setAttribute("inert", "");
      dom.headerLogout.disabled = true;
    }
  }

  if (dom.logoutButton) {
    dom.logoutButton.hidden = !signedIn;
    dom.logoutButton.disabled = !signedIn;
    if (signedIn) {
      dom.logoutButton.removeAttribute("aria-hidden");
      dom.logoutButton.removeAttribute("inert");
    } else {
      dom.logoutButton.setAttribute("aria-hidden", "true");
      dom.logoutButton.setAttribute("inert", "");
    }
  }

  if (dom.addEventButton) {
    dom.addEventButton.disabled = !signedIn;
  }

  if (!signedIn) {
    if (dom.addScheduleButton) dom.addScheduleButton.disabled = true;
    if (dom.csvInput) dom.csvInput.disabled = true;
    if (dom.saveButton) dom.saveButton.disabled = true;
  }

  updateParticipantActionPanelState();
}

function resolveFocusTargetElement(target) {
  if (typeof document === "undefined") {
    return null;
  }

  switch (target) {
    case "participants":
      return getElementById("participant-title") || dom.participantDescription || null;
    case "schedules":
      return getElementById("schedule-title") || dom.scheduleDescription || null;
    case "events":
      return getElementById("event-title") || dom.eventList || null;
    default:
      return null;
  }
}

function maybeFocusInitialSection() {
  const target = state.initialFocusTarget;
  if (!target) return;

  state.initialFocusTarget = "";
  const element = resolveFocusTargetElement(target);
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const needsTabIndex = !element.hasAttribute("tabindex");
  if (needsTabIndex) {
    element.setAttribute("tabindex", "-1");
    element.dataset.tempFocusTarget = "true";
  }

  requestAnimationFrame(() => {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    element.focus({ preventScroll: true });
    element.classList.add("section-focus-highlight");
    window.setTimeout(() => {
      element.classList.remove("section-focus-highlight");
      if (element.dataset.tempFocusTarget) {
        element.removeAttribute("tabindex");
        delete element.dataset.tempFocusTarget;
      }
    }, 2000);
  });
}

function resetState() {
  // StateManager に委譲（状態のリセット）
  if (!stateManager) {
    throw new Error("StateManager is not initialized");
  }
  stateManager.resetState();
  
  // HostIntegrationManager に委譲
  if (hostIntegrationManager) {
    hostIntegrationManager.resetSelectionBroadcastSignature();
  } else {
    lastSelectionBroadcastSignature = "";
  }
  
  // UI更新とその他のリセット処理
  resetTokenState();
  renderEvents();
  renderSchedules();
  renderParticipants();
  updateParticipantContext();
  setUploadStatus(getMissingSelectionStatusMessage());
  populateScheduleLocationOptions();
  if (dom.fileLabel) dom.fileLabel.textContent = "参加者CSVをアップロード";
  if (dom.teamCsvInput) dom.teamCsvInput.value = "";
  if (dom.csvInput) dom.csvInput.value = "";
  renderUserSummary(null);
  syncTemplateButtons();
  syncSaveButtonState();
  syncMailActionState();
}

function handleParticipantCardListClick(event) {
  const card = event.target.closest(".participant-card");
  if (card) {
    selectParticipantFromCardElement(card);
  }

  const copyButton = event.target.closest(".copy-link-btn");
  if (copyButton) {
    event.preventDefault();
    const token = copyButton.dataset.token;
    copyShareLink(token).catch(err => console.error(err));
  }
}

function handleParticipantCardListKeydown(event) {
  const card = event.target.closest(".participant-card");
  if (!card) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectParticipantFromCardElement(card, { focus: true });
    return;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    const list = dom.participantCardList;
    if (!list) return;
    const cards = Array.from(list.querySelectorAll(".participant-card"));
    const currentIndex = cards.indexOf(card);
    if (currentIndex === -1) return;
    const delta = event.key === "ArrowUp" ? -1 : 1;
    const nextCard = cards[currentIndex + delta];
    if (nextCard) {
      selectParticipantFromCardElement(nextCard, { focus: true });
    }
  }
}

function handleParticipantListFocus(event) {
  const card = event.target.closest(".participant-card");
  if (!card) {
    return;
  }
  selectParticipantFromCardElement(card);
}

function handleEditSelectedParticipant() {
  const target = getSelectedParticipantTarget();
  if (!target.entry) {
    setUploadStatus("参加者が選択されていません。", "error");
    return;
  }
  const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
  const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
  // ParticipantManager に委譲
  if (!participantManager) {
    throw new Error("ParticipantManager is not initialized");
  }
  participantManager.openParticipantEditor(participantId, rowKey);
}

function handleCancelSelectedParticipant() {
  const target = getSelectedParticipantTarget();
  if (!target.entry) {
    setUploadStatus("キャンセル対象の参加者が見つかりません。", "error");
    return;
  }
  const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
  const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
  handleQuickCancelAction(participantId, null, rowKey);
}

function handleRelocateSelectedParticipant() {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.handleRelocateSelectedParticipant(getSelectedParticipantTarget);
}

function handleDeleteSelectedParticipant() {
  const target = getSelectedParticipantTarget();
  if (!target.entry) {
    setUploadStatus("削除対象の参加者が見つかりません。", "error");
    return;
  }
  const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
  const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
  handleDeleteParticipant(participantId, null, rowKey).catch(err => {
    console.error(err);
    setUploadStatus(err.message || "参加者の削除に失敗しました。", "error");
  });
}

async function handleDeleteParticipant(participantId, rowIndex, rowKey) {
  // ParticipantManager に委譲
  if (!participantManager) {
    throw new Error("ParticipantManager is not initialized");
    }
  return await participantManager.handleDeleteParticipant(participantId, rowIndex, rowKey);
}

function openParticipantEditor(participantId, rowKey) {
  // ParticipantManager に委譲
  if (!participantManager) {
    throw new Error("ParticipantManager is not initialized");
    }
  participantManager.openParticipantEditor(participantId, rowKey);
}

function saveParticipantEdits() {
  // ParticipantManager に委譲
  if (!participantManager) {
    throw new Error("ParticipantManager is not initialized");
  }
  participantManager.saveParticipantEdits();
    }

// 元の removeParticipantFromState 実装は ParticipantManager に移行されました

function getCachedAuthorizedEmails() {
  // AuthManager に委譲
  if (!authManager) {
    return null;
  }
  return authManager.getCachedAuthorizedEmails();
}

// getFreshPreflightContext は AuthManager に移行されました

async function verifyEnrollment(user) {
  // AuthManager に委譲
  if (!authManager) {
    throw new Error("AuthManager is not initialized");
  }
  return await authManager.verifyEnrollment(user);
}

// waitForQuestionIntakeAccess, probeQuestionIntakeAccess, isNotInUsersSheetError は AuthManager に移行されました

async function ensureAdminAccess() {
  // AuthManager に委譲
  if (!authManager) {
    throw new Error("AuthManager is not initialized");
  }
  return await authManager.ensureAdminAccess();
}

function attachEventHandlers() {
  setupParticipantTabs();
  updateParticipantActionPanelState();

  if (dom.loginButton) {
    dom.loginButton.addEventListener("click", async () => {
      if (dom.loginButton.disabled) return;
      setLoginError("");
      dom.loginButton.disabled = true;
      dom.loginButton.classList.add("is-busy");
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        console.error(error);
        setLoginError("ログインに失敗しました。時間をおいて再度お試しください。");
        dom.loginButton.disabled = false;
        dom.loginButton.classList.remove("is-busy");
      }
    });
  }

  if (dom.logoutButton) {
    dom.logoutButton.addEventListener("click", () => signOut(auth));
  }
  if (dom.headerLogout) {
    dom.headerLogout.addEventListener("click", () => signOut(auth));
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
          const logoutButton = dom.logoutButton || dom.headerLogout;
          if (logoutButton && !logoutButton.disabled && !logoutButton.hidden) {
            event.preventDefault();
            signOut(auth);
          }
        }
      }
    });
  }

  if (dom.refreshButton) {
    dom.refreshButton.addEventListener("click", async () => {
      try {
        await loadEvents({ preserveSelection: true });
        await loadParticipants();
      } catch (error) {
        console.error(error);
      }
    });
  }

  if (dom.downloadParticipantTemplateButton) {
    dom.downloadParticipantTemplateButton.addEventListener("click", () => {
      if (!csvManager) {
        throw new Error("CsvManager is not initialized");
      }
      csvManager.downloadParticipantTemplate();
    });
  }

  if (dom.downloadTeamTemplateButton) {
    dom.downloadTeamTemplateButton.addEventListener("click", () => {
      if (!csvManager) {
        throw new Error("CsvManager is not initialized");
      }
      csvManager.downloadTeamTemplate();
    });
  }

  if (dom.openStaffPrintViewButton) {
    dom.openStaffPrintViewButton.addEventListener("click", () => {
      const button = dom.openStaffPrintViewButton;
      if (!button) {
        logPrintWarn("openStaffPrintViewButton click without button");
        return;
      }

      syncAllPrintButtonStates();

      logPrintInfo("openStaffPrintViewButton clicked", { disabled: button.disabled, printing: button.dataset.printing });

      if (button.disabled || button.dataset.printing === "true") {
        logPrintWarn("openStaffPrintViewButton ignored due to state", {
          disabled: button.disabled,
          printing: button.dataset.printing
        });
        return;
      }

      openStaffPrintView().catch(error => {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[Print] スタッフ印刷用リストの生成に失敗しました。", error);
        }
        logPrintError("openStaffPrintView failed from click", error);
        window.alert("印刷用リストの生成中にエラーが発生しました。時間をおいて再度お試しください。");
      });
    });
  }

  if (dom.openPrintViewButton) {
    dom.openPrintViewButton.addEventListener("click", () => {
      const button = dom.openPrintViewButton;
      if (!button) {
        logPrintWarn("openPrintViewButton click without button");
        return;
      }

      // ボタンの状態が古い場合に即時同期してから判定する
      syncAllPrintButtonStates();

      logPrintInfo("openPrintViewButton clicked", { disabled: button.disabled, printing: button.dataset.printing });

      if (button.disabled || button.dataset.printing === "true") {
        logPrintWarn("openPrintViewButton ignored due to state", {
          disabled: button.disabled,
          printing: button.dataset.printing
        });
        return;
      }

      openParticipantPrintView()
        .catch(error => {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[Print] 印刷用リストの生成に失敗しました。", error);
          }
          logPrintError("openParticipantPrintView failed from click", error);
          window.alert("印刷用リストの生成中にエラーが発生しました。時間をおいて再度お試しください。");
        });
    });
  }

  if (dom.printPreviewCloseButton) {
    dom.printPreviewCloseButton.addEventListener("click", () => {
      logPrintInfo("printPreviewCloseButton clicked");
      closeParticipantPrintPreview();
    });
  }

  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.addEventListener("click", () => {
      if (dom.printPreviewPrintButton.disabled) {
        logPrintWarn("printPreviewPrintButton ignored: disabled");
        return;
      }
      logPrintInfo("printPreviewPrintButton clicked");
      printParticipantPreview({ showAlertOnFailure: true });
    });
  }

  if (dom.sendMailButton) {
    dom.sendMailButton.addEventListener("click", async () => {
      if (dom.sendMailButton.disabled || state.mailSending) {
        return;
      }
      const pendingCount = getPendingMailCount();
      if (!state.selectedEventId || !state.selectedScheduleId) {
        setUploadStatus(getSelectionRequiredMessage("メールを送信するには"), "error");
        return;
      }
      if (pendingCount === 0) {
        setUploadStatus("送信対象の参加者が見つかりません。", "error");
        return;
      }
      const confirmed = await confirmAction({
        title: "案内メール送信の確認",
        description: `未送信の参加者 ${pendingCount} 名にHTMLメールを送信します。よろしいですか？`,
        confirmLabel: "送信する",
        cancelLabel: "キャンセル",
        tone: "primary"
      });
      if (!confirmed) {
        return;
      }
      await handleSendParticipantMail();
    });
  }

  bindDialogDismiss(dom.eventDialog);
  bindDialogDismiss(dom.scheduleDialog);
  bindDialogDismiss(dom.participantDialog);
  bindDialogDismiss(dom.relocationDialog);
  bindDialogDismiss(dom.printPreviewDialog);
  if (printManager) {
    printManager.setupSettingsDialog();
  } else {
    // フォールバック（初期化前の場合）
  setupPrintSettingsDialog();
  }

  if (dom.relocationDialog) {
    dom.relocationDialog.addEventListener("dialog:close", handleRelocationDialogClose);
  }

  if (dom.printPreviewDialog) {
    dom.printPreviewDialog.addEventListener("dialog:close", () => {
      resetPrintPreview({ skipCloseDialog: true });
    });
  }

  if (dom.addEventButton) {
    dom.addEventButton.addEventListener("click", () => {
      openEventForm({ mode: "create" });
    });
  }

  if (dom.eventForm) {
    dom.eventForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (!dom.eventNameInput) return;
      const submitButton = dom.eventForm.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      setFormError(dom.eventError);
      try {
        const mode = dom.eventForm.dataset.mode || "create";
        const targetEventId = dom.eventForm.dataset.eventId || "";
        if (mode === "edit") {
          await handleUpdateEvent(targetEventId, dom.eventNameInput.value);
        } else {
          await handleAddEvent(dom.eventNameInput.value);
        }
        dom.eventForm.reset();
        closeDialog(dom.eventDialog);
      } catch (error) {
        console.error(error);
        const message = dom.eventForm.dataset.mode === "edit"
          ? error.message || "イベントの更新に失敗しました。"
          : error.message || "イベントの追加に失敗しました。";
        setFormError(dom.eventError, message);
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  if (dom.addScheduleButton) {
    dom.addScheduleButton.addEventListener("click", () => {
      openScheduleForm({ mode: "create" });
    });
  }

  if (dom.scheduleForm) {
    dom.scheduleForm.addEventListener("submit", async event => {
      event.preventDefault();
      const submitButton = dom.scheduleForm.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      setFormError(dom.scheduleError);
      try {
        const mode = dom.scheduleForm.dataset.mode || "create";
        const scheduleId = dom.scheduleForm.dataset.scheduleId || "";
        const payload = {
          label: dom.scheduleLabelInput?.value,
          location: dom.scheduleLocationInput?.value,
          date: dom.scheduleDateInput?.value,
          startTime: dom.scheduleStartTimeInput?.value,
          endTime: dom.scheduleEndTimeInput?.value
        };
        if (mode === "edit") {
          await handleUpdateSchedule(scheduleId, payload);
        } else {
          await handleAddSchedule(payload);
        }
        dom.scheduleForm.reset();
        closeDialog(dom.scheduleDialog);
      } catch (error) {
        console.error(error);
        const message = dom.scheduleForm.dataset.mode === "edit"
          ? error.message || "日程の更新に失敗しました。"
          : error.message || "日程の追加に失敗しました。";
        setFormError(dom.scheduleError, message);
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  if (dom.scheduleStartTimeInput) {
    dom.scheduleStartTimeInput.addEventListener("input", () => syncScheduleEndMin());
  }

  if (dom.scheduleDateInput) {
    dom.scheduleDateInput.addEventListener("input", () => {
      setCalendarPickedDate(dom.scheduleDateInput.value, { updateInput: false });
    });
  }

  if (dom.scheduleDialogCalendarPrev) {
    dom.scheduleDialogCalendarPrev.addEventListener("click", () => shiftScheduleDialogCalendarMonth(-1));
  }

  if (dom.scheduleDialogCalendarNext) {
    dom.scheduleDialogCalendarNext.addEventListener("click", () => shiftScheduleDialogCalendarMonth(1));
  }

  if (dom.csvInput) {
    dom.csvInput.addEventListener("change", (event) => {
      if (!csvManager) {
        throw new Error("CsvManager is not initialized");
      }
      csvManager.handleCsvChange(event);
    });
    dom.csvInput.disabled = true;
  }

  if (dom.teamCsvInput) {
    dom.teamCsvInput.addEventListener("change", (event) => {
      if (!csvManager) {
        throw new Error("CsvManager is not initialized");
      }
      csvManager.handleTeamCsvChange(event);
    });
    dom.teamCsvInput.disabled = true;
  }

  if (dom.participantForm) {
    dom.participantForm.addEventListener("submit", event => {
      event.preventDefault();
      const submitButton = dom.participantForm.querySelector("button[type='submit']");
      if (submitButton) submitButton.disabled = true;
      try {
        setFormError(dom.participantError);
        saveParticipantEdits();
        closeDialog(dom.participantDialog);
        setUploadStatus("参加者情報を更新しました。適用または取消を選択してください。", "success");
      } catch (error) {
        console.error(error);
        setFormError(dom.participantError, error.message || "参加者情報の更新に失敗しました。");
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  if (dom.relocationForm) {
    dom.relocationForm.addEventListener("submit", handleRelocationFormSubmit);
  }

  if (dom.saveButton) {
    dom.saveButton.addEventListener("click", () => {
      handleSave().catch(err => {
        console.error(err);
        setUploadStatus(err.message || "適用に失敗しました。", "error");
      });
    });
    dom.saveButton.disabled = true;
    updateParticipantActionPanelState();
  }

  if (dom.discardButton) {
    dom.discardButton.addEventListener("click", () => {
      handleRevertParticipants().catch(err => {
        console.error(err);
        setUploadStatus(err.message || "変更の取り消しに失敗しました。", "error");
      });
    });
    dom.discardButton.disabled = true;
    updateParticipantActionPanelState();
  }

  if (dom.participantCardList) {
    dom.participantCardList.addEventListener("click", handleParticipantCardListClick);
    dom.participantCardList.addEventListener("keydown", handleParticipantCardListKeydown);
    dom.participantCardList.addEventListener("focusin", handleParticipantListFocus);
  }

  if (dom.editSelectedParticipantButton) {
    dom.editSelectedParticipantButton.addEventListener("click", handleEditSelectedParticipant);
  }

  if (dom.cancelSelectedParticipantButton) {
    dom.cancelSelectedParticipantButton.addEventListener("click", handleCancelSelectedParticipant);
  }

  if (dom.relocateSelectedParticipantButton) {
    dom.relocateSelectedParticipantButton.addEventListener("click", handleRelocateSelectedParticipant);
  }

  if (dom.deleteSelectedParticipantButton) {
    dom.deleteSelectedParticipantButton.addEventListener("click", handleDeleteSelectedParticipant);
  }

  if (dom.addScheduleButton) {
    dom.addScheduleButton.disabled = true;
  }

  if (dom.clearParticipantsButton) {
    dom.clearParticipantsButton.addEventListener("click", () => {
      handleClearParticipants().catch(err => {
        console.error(err);
        setUploadStatus(err.message || "参加者リストの削除に失敗しました。", "error");
      });
    });
    updateParticipantActionPanelState();
  }

  if (dom.eventEmpty) dom.eventEmpty.hidden = true;
  if (dom.scheduleEmpty) dom.scheduleEmpty.hidden = true;

  if (dom.uploadStatus) {
    setUploadStatus(getMissingSelectionStatusMessage());
  }

  if (dom.fileLabel) dom.fileLabel.textContent = "参加者CSVをアップロード";
  if (dom.teamFileLabel) dom.teamFileLabel.textContent = "班番号CSVをアップロード";

  if (dom.copyrightYear) {
    dom.copyrightYear.textContent = String(new Date().getFullYear());
  }

  setupConfirmDialog();
}

function initAuthWatcher() {
  // AuthManager に委譲
  if (!authManager) {
    // フォールバック（初期化前の場合）
    onAuthStateChanged(auth, async user => {
      state.user = user;
      const embedded = isEmbeddedMode();
      if (!user) {
        if (embedded) {
          showLoader("利用状態を確認しています…");
        } else {
          hideLoader();
          if (dom.loginButton) {
            dom.loginButton.disabled = false;
            dom.loginButton.classList.remove("is-busy");
          }
        }
        setAuthUi(false);
        resetState();
        if (!redirectingToIndexRef.current && typeof window !== "undefined" && !embedded) {
          redirectingToIndexRef.current = true;
          goToLogin();
        }
        return;
      }

      redirectingToIndexRef.current = false;
      showLoader(embedded ? "利用準備を確認しています…" : "権限を確認しています…");
      const loaderLabels = embedded ? [] : STEP_LABELS;
      initLoaderSteps(loaderLabels);

      try {
        setLoaderStep(0, embedded ? "利用状態を確認しています…" : "認証OK。ユーザー情報を確認中…");
        setLoaderStep(1, embedded ? "利用条件を確認しています…" : "在籍状況を確認しています…");
        await verifyEnrollment(user);
        setLoaderStep(2, embedded ? "必要な権限を同期しています…" : "管理者権限を確認・同期しています…");
        await ensureAdminAccess();
        setLoaderStep(3, embedded ? "参加者データを準備しています…" : "初期データを取得しています…");
        // --- FIX 3: Parallelize token and event loading ---
        await Promise.all([
          ensureTokenSnapshot(true),
          loadEvents({ preserveSelection: false })
        ]);
        await loadParticipants();
        if (state.initialSelectionNotice) {
          setUploadStatus(state.initialSelectionNotice, "error");
          state.initialSelectionNotice = null;
        }
        await drainQuestionQueue();
        setLoaderStep(4, embedded ? "仕上げ処理を行っています…" : "初期データの取得が完了しました。仕上げ中…");
        setAuthUi(true);
        finishLoaderSteps("準備完了");
        resolveEmbedReady();
        if (state.initialFocusTarget) {
          window.setTimeout(() => maybeFocusInitialSection(), 400);
        }
      } catch (error) {
        console.error(error);
        setLoginError(error.message || "権限の確認に失敗しました。");
        await signOut(auth);
        resetState();
      } finally {
        hideLoader();
      }
    });
    return;
  }
  authManager.initAuthWatcher();
}

function hostSelectionSignature(selection = {}) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    const eventId = normalizeKey(selection.eventId || "");
    const scheduleId = normalizeKey(selection.scheduleId || "");
    const eventName = selection.eventName != null ? String(selection.eventName) : "";
    const scheduleLabel = selection.scheduleLabel != null ? String(selection.scheduleLabel) : "";
    const scheduleLocation = selection.location != null ? String(selection.location) : "";
    const startAt = selection.startAt != null ? String(selection.startAt) : "";
    const endAt = selection.endAt != null ? String(selection.endAt) : "";
    return [eventId, scheduleId, eventName, scheduleLabel, scheduleLocation, startAt, endAt].join("::");
  }
  return hostIntegrationManager.hostSelectionSignature(selection);
}

function getHostSelectionElement() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    if (typeof document === "undefined") {
      return null;
    }
    return document.querySelector("[data-tool='participants']");
  }
  return hostIntegrationManager.getHostSelectionElement();
}

function readHostSelectionDataset(target) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    if (!target) return null;
    const dataset = target.dataset || {};
    const eventId = normalizeKey(dataset.expectedEventId || "");
    if (!eventId) {
      return null;
    }
    return {
      eventId,
      scheduleId: normalizeKey(dataset.expectedScheduleId || ""),
      eventName: dataset.expectedEventName ? String(dataset.expectedEventName) : "",
      scheduleLabel: dataset.expectedScheduleLabel ? String(dataset.expectedScheduleLabel) : "",
      location: dataset.expectedScheduleLocation ? String(dataset.expectedScheduleLocation) : "",
      startAt: dataset.expectedStartAt ? String(dataset.expectedStartAt) : "",
      endAt: dataset.expectedEndAt ? String(dataset.expectedEndAt) : ""
    };
  }
  return hostIntegrationManager.readHostSelectionDataset(target);
}

function applyHostSelectionFromDataset() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  return hostIntegrationManager.applyHostSelectionFromDataset();
}

function startHostSelectionBridge() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  hostIntegrationManager.startHostSelectionBridge();
}

function stopHostSelectionBridge() {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    // フォールバック: Manager初期化前の呼び出しに対応
    if (hostSelectionBridge.observer) {
      try {
        hostSelectionBridge.observer.disconnect();
      } catch (error) {
        console.warn("Failed to disconnect host selection observer", error);
      }
      hostSelectionBridge.observer = null;
    }
    return;
  }
  hostIntegrationManager.stopHostSelectionBridge();
}

async function applySelectionContext(selection = {}) {
  // HostIntegrationManager に委譲
  if (!hostIntegrationManager) {
    throw new Error("HostIntegrationManager is not initialized");
  }
  return hostIntegrationManager.applySelectionContext(selection);
}

function init() {
  // PrintManager を初期化
  printManager = new PrintManager({
    dom,
    state,
    openDialog,
    closeDialog,
    // 依存関数と定数
    sortParticipants,
    getParticipantGroupKey,
    describeParticipantGroup,
    collectGroupGlLeaders,
    getEventGlRoster,
    getEventGlAssignmentsMap,
    resolveScheduleAssignment,
    loadGlDataForEvent,
    normalizeKey,
    normalizeGroupNumberValue,
    NO_TEAM_GROUP_KEY,
    CANCEL_LABEL,
    RELOCATE_LABEL,
    GL_STAFF_GROUP_KEY,
    // ボタン状態管理関数
    syncAllPrintButtonStates,
    setPrintButtonBusy,
    setStaffPrintButtonBusy
  });
  
  printManager.hydrateSettingsFromStorage();
  
  // StateManager を初期化
  stateManager = new StateManager({
    state,
    dom,
    // 依存関数と定数
    signatureForEntries,
    snapshotParticipantList,
    normalizeKey,
    isEmbeddedMode,
    UPLOAD_STATUS_PLACEHOLDERS
  });

  // CsvManager を初期化
  csvManager = new CsvManager({
    dom,
    state,
    // 依存関数と定数
    getSelectionIdentifiers,
    getSelectionRequiredMessage,
    setUploadStatus,
    PARTICIPANT_TEMPLATE_HEADERS,
    TEAM_TEMPLATE_HEADERS,
    sortParticipants,
    resolveParticipantUid,
    renderParticipants,
    updateParticipantActionPanelState,
    syncSaveButtonState,
    queueRelocationPrompt,
    captureParticipantBaseline
  });
  
  // EventManager を初期化
  eventManager = new EventManager({
    dom,
    state,
    // 依存関数と定数
    isHostAttached: () => {
      if (!hostIntegrationManager) return false;
      return hostIntegrationManager.isHostAttached();
    },
    hostIntegration: null, // HostIntegrationManager に移行されたため、直接参照しない
    getHostController: () => {
      if (!hostIntegrationManager) return null;
      return hostIntegrationManager.getHostController();
    },
    applyHostEvents: (events, options) => {
      if (!hostIntegrationManager) {
        throw new Error("HostIntegrationManager is not initialized");
      }
      return hostIntegrationManager.applyHostEvents(events, options);
    },
    finalizeEventLoad,
    renderSchedules: () => {
      if (!scheduleManager) return;
      scheduleManager.renderSchedules();
    },
    renderParticipants,
    updateParticipantContext,
    loadGlDataForEvent,
    loadParticipants,
    broadcastSelectionChange,
    selectSchedule,
    setCalendarPickedDate,
    captureParticipantBaseline,
    syncTemplateButtons,
    syncClearButtonState,
    openDialog,
    closeDialog,
    setFormError,
    confirmAction,
    setUploadStatus,
    refreshScheduleLocationHistory,
    populateScheduleLocationOptions,
    getSelectionBroadcastSource
  });
  
  // MailManager を初期化
  mailManager = new MailManager({
    dom,
    state,
    // 依存関数と定数
    api,
    setUploadStatus,
    getSelectionRequiredMessage,
    renderParticipants,
    hasUnsavedChanges,
    captureParticipantBaseline,
    setActionButtonState,
    confirmAction
  });
  
  // AuthManager を初期化
  authManager = new AuthManager({
    dom,
    state,
    // 依存関数と定数
    api,
    auth,
    getAuthIdToken,
    firebaseConfig,
    goToLogin,
    setAuthUi,
    setLoginError,
    showLoader,
    hideLoader,
    initLoaderSteps,
    setLoaderStep,
    finishLoaderSteps,
    resetState,
    renderUserSummary,
    isEmbeddedMode,
    STEP_LABELS,
    ensureTokenSnapshot,
    loadEvents: (options) => {
      if (!eventManager) return Promise.resolve();
      return eventManager.loadEvents(options);
    },
    loadParticipants: (options) => {
      if (!participantManager) return Promise.resolve();
      return participantManager.loadParticipants(options);
    },
    drainQuestionQueue,
    resolveEmbedReady,
    maybeFocusInitialSection,
    sleep,
    setUploadStatus,
    redirectingToIndexRef
  });
  
  // ParticipantManager を初期化
  participantManager = new ParticipantManager({
    dom,
    state,
    // 依存関数と定数
    readHostSelectionDataset,
    getHostSelectionElement,
    loadGlDataForEvent,
    renderEvents,
    renderSchedules: () => {
      if (!scheduleManager) return;
      scheduleManager.renderSchedules();
    },
    updateParticipantContext,
    captureParticipantBaseline,
    syncSaveButtonState,
    syncMailActionState: () => {
      if (!mailManager) return;
      mailManager.syncMailActionState();
    },
    syncAllPrintButtonStates,
    syncClearButtonState,
    syncTemplateButtons,
    syncSelectedEventSummary,
    renderParticipantChangePreview,
    renderRelocationPrompt: () => {
      if (!relocationManager) return;
      relocationManager.renderRelocationPrompt();
    },
    applyParticipantSelectionStyles,
    updateParticipantActionPanelState,
    emitParticipantSyncEvent,
    describeScheduleRange,
    ensureTokenSnapshot,
    generateQuestionToken,
    setUploadStatus,
    // renderParticipants に必要な依存関係
    buildParticipantCard,
    getParticipantGroupKey,
    createParticipantGroupElements,
    getEventGlRoster,
    getEventGlAssignmentsMap,
    resolveScheduleAssignment,
    renderGroupGlAssignments,
    clearParticipantSelection,
    participantChangeKey,
    CANCEL_LABEL,
    GL_STAFF_GROUP_KEY,
    // CRUD機能に必要な依存関係
    getDisplayParticipantId,
    ensurePendingRelocationMap: () => {
      if (!relocationManager) return new Map();
      return relocationManager.ensurePendingRelocationMap();
    },
    applyRelocationDraft: (entry, destinationScheduleId, destinationTeamNumber) => {
      if (!relocationManager) return;
      relocationManager.applyRelocationDraft(entry, destinationScheduleId, destinationTeamNumber);
    },
    ensureTeamAssignmentMap,
    applyAssignmentsToEventCache,
    hasUnsavedChanges,
    confirmAction,
    setFormError,
    openDialog,
    closeDialog,
    RELOCATE_LABEL,
    // handleSave に必要な依存関係
    getScheduleRecord,
    loadEvents
  });
  
  // RelocationManager を初期化
  relocationManager = new RelocationManager({
    dom,
    state,
    // 依存関数と定数
    RELOCATE_LABEL,
    resolveParticipantActionTarget,
    resolveParticipantUid,
    resolveParticipantStatus,
    getScheduleLabel,
    buildScheduleOptionLabel,
    normalizeGroupNumberValue,
    sortParticipants,
    syncCurrentScheduleCache,
    updateDuplicateMatches,
    renderParticipants: () => {
      if (!participantManager) return;
      participantManager.renderParticipants();
    },
    syncSaveButtonState,
    setUploadStatus,
    openDialog,
    closeDialog,
    setFormError,
    formatParticipantIdentifier,
    commitParticipantQuickEdit,
    getScheduleRecord,
    ensureRowKey,
    ensureTeamAssignmentMap,
    findParticipantForSnapshot
  });
  
  // HostIntegrationManager を初期化
  hostIntegrationManager = new HostIntegrationManager({
    dom,
    state,
    // 依存関数と定数
    normalizeKey,
    selectEvent,
    loadEvents,
    finalizeEventLoad,
    updateParticipantContext,
    HOST_SELECTION_ATTRIBUTE_KEYS,
    // 一時的な依存関数（後で移行予定）
    selectSchedule: (scheduleId, options) => {
      if (!scheduleManager) return;
      scheduleManager.selectSchedule(scheduleId, options);
    },
    refreshScheduleLocationHistory,
    populateScheduleLocationOptions,
    hostSelectionSignature,
    stopHostSelectionBridge,
    startHostSelectionBridge
  });
  
  // ScheduleManager を初期化
  scheduleManager = new ScheduleManager({
    dom,
    state,
    calendarState,
    // 依存関数と定数
    loadEvents: () => {
      if (!eventManager) return Promise.resolve();
      return eventManager.loadEvents();
    },
    selectEvent: (eventId) => {
      if (!eventManager) return;
      eventManager.selectEvent(eventId);
    },
    selectSchedule: (scheduleId, options) => {
      // 循環参照を避けるため、ここで直接実装を呼び出す
      if (!scheduleManager) return;
      scheduleManager.selectSchedule(scheduleId, options);
    },
    setCalendarPickedDate,
    renderParticipants: () => {
      if (!participantManager) return;
      participantManager.renderParticipants();
    },
    updateParticipantContext,
    captureParticipantBaseline,
    syncSaveButtonState,
    queueRelocationPrompt,
    getSelectionBroadcastSource,
    populateScheduleLocationOptions,
    prepareScheduleDialogCalendar,
    syncScheduleEndMin,
    openDialog,
    closeDialog,
    setFormError,
    confirmAction,
    setUploadStatus,
    getScheduleRecord,
    loadParticipants: (options) => {
      if (!participantManager) return Promise.resolve();
      return participantManager.loadParticipants(options);
    },
    broadcastSelectionChange,
    selectScheduleSelf: null // 後で設定
  });
  
  // 循環参照を避けるため、selectScheduleSelf を設定
  scheduleManager.selectScheduleSelf = scheduleManager.selectSchedule.bind(scheduleManager);
  
  attachEventHandlers();
  setAuthUi(Boolean(state.user));
  initLoaderSteps(isEmbeddedMode() ? [] : STEP_LABELS);
  resetState();
  if (isEmbeddedMode()) {
    showLoader("利用状態を確認しています…");
  }
  parseInitialSelectionFromUrl();
  startHostSelectionBridge();
  if (authManager) {
    authManager.initAuthWatcher();
  } else {
    // フォールバック（初期化前の場合）
    initAuthWatcher();
  }
}

init();

if (typeof window !== "undefined") {
  window.questionAdminEmbed = {
    setSelection(selection = {}) {
      return applySelectionContext(selection);
    },
    refreshParticipants(options) {
      return loadParticipants(options);
    },
    refreshEvents(options) {
      return loadEvents(options);
    },
    getState() {
      return {
        eventId: state.selectedEventId,
        scheduleId: state.selectedScheduleId
      };
    },
    waitUntilReady() {
      return waitForEmbedReady();
    },
    reset() {
      try {
        redirectingToIndexRef.current = false;
        state.user = null;
        hideLoader();
        setAuthUi(false);
        resetState();
        detachHost();
        if (hostIntegrationManager) {
          hostIntegrationManager.resetHostSelectionBridge();
          applyHostSelectionFromDataset();
          hostIntegrationManager.resetEmbedReady();
        } else {
          hostSelectionBridge.lastSignature = "";
          hostSelectionBridge.pendingSignature = "";
          applyHostSelectionFromDataset();
          if (embedReadyDeferred?.resolve) {
            embedReadyDeferred.resolve();
          }
          embedReadyDeferred = null;
        }
        if (dom.loginButton) {
          dom.loginButton.disabled = false;
          dom.loginButton.classList.remove("is-busy");
        }
      } catch (error) {
        console.error("questionAdminEmbed.reset failed", error);
      }
    },
    attachHost(controller) {
      try {
        attachHost(controller);
      } catch (error) {
        console.error("questionAdminEmbed.attachHost failed", error);
      }
    },
    detachHost() {
      try {
        detachHost();
      } catch (error) {
        console.error("questionAdminEmbed.detachHost failed", error);
      }
    }
  };
}

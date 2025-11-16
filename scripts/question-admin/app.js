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
import {
  loadAuthPreflightContext,
  preflightContextMatchesUser
} from "../shared/auth-preflight.js";
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

let redirectingToIndex = false;

const glDataFetchCache = new Map();

function getEmbedPrefix() {
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

function isEmbeddedMode() {
  return Boolean(getEmbedPrefix());
}

function cloneParticipantEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return {};
  }
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(entry);
    } catch (error) {
      console.warn("Failed to structuredClone participant entry, falling back to JSON", error);
    }
  }
  try {
    return JSON.parse(JSON.stringify(entry));
  } catch (error) {
    console.warn("Failed to JSON-clone participant entry", error);
    return { ...entry };
  }
}

function captureParticipantBaseline(entries = state.participants, options = {}) {
  const { ready = true } = options || {};
  const list = Array.isArray(entries) ? entries : [];
  state.savedParticipantEntries = list.map(entry => cloneParticipantEntry(entry));
  state.savedParticipants = snapshotParticipantList(list);
  state.lastSavedSignature = signatureForEntries(list);
  state.participantBaselineReady = Boolean(ready);
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
const AUTHORIZED_EMAIL_CACHE_MS = 5 * 60 * 1000;

let cachedAuthorizedEmails = null;
let cachedAuthorizedFetchedAt = 0;
let authorizedEmailsPromise = null;

function getMissingSelectionStatusMessage() {
  return isEmbeddedMode()
    ? "イベントコントロールセンターで対象の日程を選択してください。"
    : "日程を選択してください。";
}

function getSelectionRequiredMessage(prefix = "") {
  const requirement = isEmbeddedMode()
    ? "イベントコントロールセンターで対象の日程を選択してください。"
    : "イベントと日程を選択してください。";
  if (!prefix) {
    return requirement;
  }
  return `${prefix}${requirement}`;
}

const hostSelectionBridge = {
  observer: null,
  lastSignature: "",
  pendingSignature: ""
};

let lastSelectionBroadcastSignature = "";

const hostIntegration = {
  controller: null,
  selectionUnsubscribe: null,
  eventsUnsubscribe: null
};

function getSelectionBroadcastSource() {
  return isEmbeddedMode() ? "participants" : "question-admin";
}

function isHostAttached() {
  return Boolean(hostIntegration.controller);
}

function detachHost() {
  if (hostIntegration.selectionUnsubscribe) {
    try {
      hostIntegration.selectionUnsubscribe();
    } catch (error) {
      console.warn("Failed to detach host selection listener", error);
    }
  }
  if (hostIntegration.eventsUnsubscribe) {
    try {
      hostIntegration.eventsUnsubscribe();
    } catch (error) {
      console.warn("Failed to detach host events listener", error);
    }
  }
  hostIntegration.controller = null;
  hostIntegration.selectionUnsubscribe = null;
  hostIntegration.eventsUnsubscribe = null;
  startHostSelectionBridge();
}

function cloneHostEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const schedules = Array.isArray(event.schedules)
    ? event.schedules.map((schedule) => ({ ...schedule }))
    : [];
  const scheduleCount = typeof event.scheduleCount === "number" ? event.scheduleCount : schedules.length;
  const totalParticipants = typeof event.totalParticipants === "number"
    ? event.totalParticipants
    : schedules.reduce((acc, item) => acc + Number(item?.participantCount || 0), 0);
  return {
    ...event,
    schedules,
    scheduleCount,
    totalParticipants
  };
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
  const previousEventId = preserveSelection ? state.selectedEventId : null;
  const previousScheduleId = preserveSelection ? state.selectedScheduleId : null;
  const previousEventsSnapshot = preserveSelection && Array.isArray(state.events)
    ? state.events.map((event) => ({
        id: event.id,
        name: event.name,
        schedules: Array.isArray(event.schedules)
          ? event.schedules.map((schedule) => ({ ...schedule }))
          : []
      }))
    : [];
  const cloned = Array.isArray(events)
    ? events.map((event) => cloneHostEvent(event)).filter(Boolean)
    : [];
  state.events = cloned;
  finalizeEventLoad({
    preserveSelection,
    previousEventId,
    previousScheduleId,
    previousEventsSnapshot,
    preserveStatus: true
  });
}

function handleHostSelection(detail) {
  if (!detail || typeof detail !== "object") {
    return;
  }
  const promise = applySelectionContext(detail);
  if (promise && typeof promise.catch === "function") {
    promise.catch((error) => {
      console.error("Failed to apply selection from host", error);
    });
  }
}

function handleHostEventsUpdate(events) {
  applyHostEvents(events, { preserveSelection: true });
}

function attachHost(controller) {
  detachHost();
  if (!controller || typeof controller !== "object") {
    return;
  }
  hostIntegration.controller = controller;
  stopHostSelectionBridge();
  hostSelectionBridge.lastSignature = "";
  hostSelectionBridge.pendingSignature = "";

  if (typeof controller.subscribeSelection === "function") {
    hostIntegration.selectionUnsubscribe = controller.subscribeSelection(handleHostSelection);
  }
  if (typeof controller.subscribeEvents === "function") {
    hostIntegration.eventsUnsubscribe = controller.subscribeEvents(handleHostEventsUpdate);
  }

  if (typeof controller.getEvents === "function") {
    try {
      const events = controller.getEvents();
      applyHostEvents(events, { preserveSelection: true });
    } catch (error) {
      console.warn("Failed to fetch events from host", error);
    }
  }

  if (typeof controller.getSelection === "function") {
    try {
      const selection = controller.getSelection();
      if (selection) {
        const promise = applySelectionContext(selection);
        if (promise && typeof promise.catch === "function") {
          promise.catch((error) => {
            console.error("Failed to apply initial host selection", error);
          });
        }
      }
    } catch (error) {
      console.warn("Failed to fetch selection from host", error);
    }
  }
}

function signatureForSelectionDetail(detail) {
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

function buildSelectionDetail() {
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

function broadcastSelectionChange(options = {}) {
  const source = options.source || getSelectionBroadcastSource();
  const detail = buildSelectionDetail();
  const signature = signatureForSelectionDetail(detail);
  const changed = signature !== lastSelectionBroadcastSignature;
  lastSelectionBroadcastSignature = signature;
  if (!changed || source === "host") {
    return;
  }
  if (hostIntegration.controller && typeof hostIntegration.controller.setSelection === "function") {
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
}

function waitForEmbedReady() {
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

function resolveEmbedReady() {
  if (embedReadyDeferred?.resolve) {
    embedReadyDeferred.resolve();
  }
  embedReadyDeferred = null;
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
  const cached = getCachedAuthorizedEmails();
  if (cached) {
    return cached;
  }

  if (!authorizedEmailsPromise) {
    authorizedEmailsPromise = (async () => {
      const result = await api.apiPost({ action: "fetchSheet", sheet: "users" });
      if (!result || !result.success || !Array.isArray(result.data)) {
        throw new Error("ユーザー権限の確認に失敗しました。");
      }
      const emails = result.data
        .map(entry =>
          String(entry["メールアドレス"] || entry.email || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean);
      cachedAuthorizedEmails = emails;
      cachedAuthorizedFetchedAt = Date.now();
      return emails;
    })();
  }

  try {
    const emails = await authorizedEmailsPromise;
    return emails;
  } finally {
    authorizedEmailsPromise = null;
  }
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
  if (!(state.pendingRelocations instanceof Map)) {
    state.pendingRelocations = new Map();
  }
  return state.pendingRelocations;
}

function ensureRelocationDraftMap() {
  if (!(state.relocationDraftOriginals instanceof Map)) {
    state.relocationDraftOriginals = new Map();
  }
  return state.relocationDraftOriginals;
}

function storeRelocationDraftOriginal(entry) {
  if (!entry) {
    return null;
  }
  const uid = resolveParticipantUid(entry) || "";
  const rowKey = String(entry.rowKey || "");
  const participantId = String(entry.participantId || "");
  const key = uid || rowKey || participantId;
  if (!key) {
    return null;
  }
  const map = ensureRelocationDraftMap();
  if (map.has(key)) {
    return key;
  }
  const teamValue = String(entry.teamNumber ?? entry.groupNumber ?? "");
  map.set(key, {
    key,
    uid,
    rowKey,
    participantId,
    teamNumber: entry.teamNumber ?? "",
    groupNumber: entry.groupNumber ?? "",
    status: entry.status || resolveParticipantStatus(entry, teamValue),
    isCancelled: Boolean(entry.isCancelled),
    isRelocated: Boolean(entry.isRelocated),
    relocationDestinationScheduleId: entry.relocationDestinationScheduleId || "",
    relocationDestinationScheduleLabel: entry.relocationDestinationScheduleLabel || "",
    relocationDestinationTeamNumber: entry.relocationDestinationTeamNumber || ""
  });
  return key;
}

function findParticipantForSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }
  const uid = String(snapshot.uid || snapshot.key || "").trim();
  if (uid) {
    const matchByUid = state.participants.find(entry => {
      const entryUid = resolveParticipantUid(entry) || String(entry?.participantId || "");
      return entryUid === uid;
    });
    if (matchByUid) {
      return matchByUid;
    }
  }
  const rowKey = String(snapshot.rowKey || "").trim();
  if (rowKey) {
    const matchByRow = state.participants.find(entry => String(entry?.rowKey || "") === rowKey);
    if (matchByRow) {
      return matchByRow;
    }
  }
  const participantId = String(snapshot.participantId || "").trim();
  if (participantId) {
    const matchById = state.participants.find(entry => String(entry?.participantId || "") === participantId);
    if (matchById) {
      return matchById;
    }
  }
  return null;
}

function restoreRelocationDrafts(keys = []) {
  if (!(state.relocationDraftOriginals instanceof Map)) {
    state.relocationDraftOriginals = new Map();
  }
  const draftMap = state.relocationDraftOriginals;
  const keyList = Array.isArray(keys) && keys.length ? keys : Array.from(draftMap.keys());
  if (!keyList.length) {
    return false;
  }
  const eventId = state.selectedEventId;
  const assignmentMap = eventId ? ensureTeamAssignmentMap(eventId) : null;
  let changed = false;
  keyList.forEach(key => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      return;
    }
    const snapshot = draftMap.get(normalizedKey);
    draftMap.delete(normalizedKey);
    if (!snapshot) {
      return;
    }
    const entry = findParticipantForSnapshot(snapshot);
    if (!entry) {
      return;
    }
    entry.teamNumber = snapshot.teamNumber || "";
    entry.groupNumber = snapshot.groupNumber || "";
    const teamValue = String(entry.teamNumber || entry.groupNumber || "");
    entry.status = snapshot.status || resolveParticipantStatus(entry, teamValue);
    entry.isCancelled = Boolean(snapshot.isCancelled);
    entry.isRelocated = Boolean(snapshot.isRelocated);
    entry.relocationDestinationScheduleId = snapshot.relocationDestinationScheduleId || "";
    entry.relocationDestinationScheduleLabel = snapshot.relocationDestinationScheduleLabel || "";
    entry.relocationDestinationTeamNumber = snapshot.relocationDestinationTeamNumber || "";
    if (assignmentMap) {
      const assignmentKey = String(snapshot.uid || snapshot.participantId || snapshot.rowKey || normalizedKey).trim();
      const assignmentValue = String(snapshot.teamNumber || snapshot.groupNumber || "");
      if (assignmentKey) {
        if (assignmentValue) {
          assignmentMap.set(assignmentKey, assignmentValue);
        } else {
          assignmentMap.delete(assignmentKey);
        }
      }
    }
    changed = true;
  });
  if (changed) {
    state.participants = sortParticipants(state.participants);
    syncCurrentScheduleCache();
    updateDuplicateMatches();
    renderParticipants();
    syncSaveButtonState();
  }
  return changed;
}

function resolveRelocationDraftKey(entry, target = null, draftMap = state.relocationDraftOriginals) {
  if (!entry || !(draftMap instanceof Map) || !draftMap.size) {
    return null;
  }
  const candidates = [
    resolveParticipantUid(entry),
    target?.uid,
    entry?.participantId,
    target?.participantId,
    entry?.rowKey,
    target?.rowKey
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized && draftMap.has(normalized)) {
      return normalized;
    }
  }
  return null;
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
  const teamNumber = String(nextEntry.teamNumber || nextEntry.groupNumber || "");
  if (eventId && uid) {
    const assignmentMap = ensureTeamAssignmentMap(eventId);
    if (assignmentMap) {
      assignmentMap.set(uid, teamNumber);
    }
    const singleMap = new Map([[uid, teamNumber]]);
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
    teamNumber: cancellationLabel,
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
  if (uid) {
    const relocationMap = ensurePendingRelocationMap();
    const previous = relocationMap.get(uid);
    if (previous) {
      clearRelocationPreview(previous);
      relocationMap.delete(uid);
    }
  }

  const identifier = formatParticipantIdentifier(entry);
  const message = `${identifier}を${CANCEL_LABEL}に設定しました。「適用」で確定します。`;
  commitParticipantQuickEdit(index, updated, { successMessage: message, successVariant: "success" });

  if (uid && Array.isArray(state.relocationPromptTargets)) {
    const previousLength = state.relocationPromptTargets.length;
    state.relocationPromptTargets = state.relocationPromptTargets.filter(item => {
      const key = item?.uid || item?.participantId || item?.rowKey;
      return key && key !== uid && key !== String(updated.rowKey || "");
    });
    if (state.relocationPromptTargets.length !== previousLength) {
      renderRelocationPrompt();
    }
  }

  if (state.relocationDraftOriginals instanceof Map) {
    const draftMap = state.relocationDraftOriginals;
    [uid, String(updated.rowKey || ""), String(updated.participantId || "")]
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .forEach(key => draftMap.delete(key));
  }
}

function handleQuickRelocateAction(participantId, rowIndex, rowKey) {
  const target = resolveParticipantActionTarget({ participantId, rowKey, rowIndex });
  const entry = target.entry;
  const index = target.index;
  if (!entry || index === -1) {
    setUploadStatus("別日に移動する対象の参加者が見つかりません。", "error");
    return;
  }

  storeRelocationDraftOriginal(entry);

  const relocationLabel = RELOCATE_LABEL;
  const updated = {
    ...entry,
    teamNumber: relocationLabel,
    groupNumber: relocationLabel
  };
  const nextStatus = resolveParticipantStatus(updated, relocationLabel);
  updated.status = nextStatus;
  updated.isCancelled = nextStatus === "cancelled";
  updated.isRelocated = nextStatus === "relocated";
  updated.relocationDestinationScheduleId = "";
  updated.relocationDestinationScheduleLabel = "";
  updated.relocationDestinationTeamNumber = "";

  const uid = resolveParticipantUid(updated) || String(updated.participantId || "");
  if (uid) {
    const relocationMap = ensurePendingRelocationMap();
    const previous = relocationMap.get(uid);
    if (previous) {
      clearRelocationPreview(previous);
      relocationMap.delete(uid);
    }
  }

  const identifier = formatParticipantIdentifier(entry);
  const message = `${identifier}を${RELOCATE_LABEL}の移動対象として設定しました。移動先を選んで適用してください。`;
  const actionRowKey = String(entry.rowKey || "");
  const actionParticipantId = String(entry.participantId || "");
  const focusKey = uid || actionRowKey || actionParticipantId;

  commitParticipantQuickEdit(index, updated, { successMessage: message, successVariant: "info" });

  queueRelocationPrompt([{ participantId: actionParticipantId, rowKey: actionRowKey }], {
    focusKey
  });
}

function getRelocationScheduleOptions(eventId, excludeScheduleId) {
  const event = state.events.find(evt => evt.id === eventId);
  if (!event || !Array.isArray(event.schedules)) {
    return [];
  }
  return event.schedules
    .filter(schedule => schedule && schedule.id && schedule.id !== excludeScheduleId)
    .map(schedule => ({ id: schedule.id, label: buildScheduleOptionLabel(schedule) || schedule.id }));
}

function resolveRelocationDefault(entry) {
  const uid = resolveParticipantUid(entry) || String(entry.participantId || "");
  const relocationMap = ensurePendingRelocationMap();
  const pending = uid ? relocationMap.get(uid) : null;
  return {
    destinationId: pending?.toScheduleId || entry.relocationDestinationScheduleId || "",
    destinationTeam: pending?.destinationTeamNumber || entry.relocationDestinationTeamNumber || ""
  };
}

function renderRelocationPrompt() {
  if (!dom.relocationList) {
    return;
  }

  const targets = Array.isArray(state.relocationPromptTargets) ? state.relocationPromptTargets.slice() : [];
  const cleanedTargets = [];
  const eventId = state.selectedEventId;
  const currentScheduleId = state.selectedScheduleId;
  const scheduleOptions = getRelocationScheduleOptions(eventId, currentScheduleId);
  const scheduleOptionMap = new Map(scheduleOptions.map(option => [option.id, option.label]));

  dom.relocationList.innerHTML = "";

  targets.forEach((target, index) => {
    if (!target) {
      return;
    }
    const { entry } = resolveParticipantActionTarget({
      participantId: target.participantId,
      rowKey: target.rowKey
    });
    if (!entry) {
      return;
    }

    const teamValue = String(entry.teamNumber || entry.groupNumber || "");
    const status = resolveParticipantStatus(entry, teamValue);
    if (status !== "relocated") {
      return;
    }

    const uid = resolveParticipantUid(entry) || String(entry.participantId || "");
    const defaultInfo = resolveRelocationDefault(entry);
    const destinationId = defaultInfo.destinationId;
    const destinationTeam = defaultInfo.destinationTeam;
    const destinationLabel = destinationId
      ? getScheduleLabel(eventId, destinationId) || scheduleOptionMap.get(destinationId) || destinationId
      : "";
    const listItem = document.createElement("li");
    listItem.className = "relocation-item";
    listItem.dataset.uid = uid;
    listItem.dataset.participantId = entry.participantId || "";
    listItem.dataset.rowKey = entry.rowKey || "";

    const header = document.createElement("div");
    header.className = "relocation-item__header";
    const nameSpan = document.createElement("span");
    nameSpan.className = "relocation-item__name";
    nameSpan.textContent = entry.name || "氏名未設定";
    header.appendChild(nameSpan);

    const deptSpan = document.createElement("span");
    deptSpan.className = "relocation-item__meta";
    const department = entry.department || entry.groupNumber || "";
    const currentScheduleLabel = getScheduleLabel(eventId, currentScheduleId) || currentScheduleId || "";
    const currentTeam = entry.teamNumber || entry.groupNumber || "";
    const metaParts = [];
    if (department) metaParts.push(department);
    if (currentScheduleLabel) metaParts.push(`現在: ${currentScheduleLabel}`);
    if (currentTeam && currentTeam !== RELOCATE_LABEL) metaParts.push(`班番号: ${currentTeam}`);
    deptSpan.textContent = metaParts.join(" / ");
    header.appendChild(deptSpan);

    const body = document.createElement("div");
    body.className = "relocation-item__body";

    const scheduleField = document.createElement("label");
    scheduleField.className = "relocation-item__field";
    const scheduleSelectId = `qa-relocation-schedule-${index}`;
    scheduleField.setAttribute("for", scheduleSelectId);
    scheduleField.textContent = "移動先の日程";

    const scheduleSelect = document.createElement("select");
    scheduleSelect.className = "input";
    scheduleSelect.id = scheduleSelectId;
    scheduleSelect.dataset.relocationSelect = "true";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "選択してください";
    scheduleSelect.appendChild(placeholderOption);

    let hasOptions = false;
    scheduleOptions.forEach(option => {
      const opt = document.createElement("option");
      opt.value = option.id;
      opt.textContent = option.label;
      if (destinationId && destinationId === option.id) {
        opt.selected = true;
      }
      scheduleSelect.appendChild(opt);
      hasOptions = true;
    });

    if (destinationId && !scheduleOptionMap.has(destinationId)) {
      const fallbackOption = document.createElement("option");
      fallbackOption.value = destinationId;
      fallbackOption.textContent = destinationLabel || destinationId;
      fallbackOption.selected = true;
      scheduleSelect.appendChild(fallbackOption);
      hasOptions = true;
    }

    if (!hasOptions) {
      scheduleSelect.disabled = true;
      placeholderOption.textContent = "移動先の日程がありません";
    }

    body.appendChild(scheduleSelect);

    const teamField = document.createElement("label");
    teamField.className = "relocation-item__field";
    const teamInputId = `qa-relocation-team-${index}`;
    teamField.setAttribute("for", teamInputId);
    teamField.textContent = "移動先の班番号";

    const teamInput = document.createElement("input");
    teamInput.className = "input";
    teamInput.type = "text";
    teamInput.id = teamInputId;
    teamInput.placeholder = "未定の場合は空欄";
    teamInput.dataset.relocationTeam = "true";
    teamInput.value = destinationTeam || "";

    teamField.appendChild(teamInput);

    body.appendChild(teamField);

    const note = document.createElement("p");
    note.className = "relocation-item__note";
    if (destinationId) {
      note.textContent = destinationLabel
        ? `現在の設定: ${destinationLabel}${destinationTeam ? ` / 班番号: ${destinationTeam}` : " / 班番号: 未定"}`
        : "現在の設定があります";
    } else if (!hasOptions) {
      note.textContent = "別日に移動するには他の日程を追加してください。";
    } else {
      note.textContent = "移動先の日程と班番号を確認してください。";
    }
    body.appendChild(note);

    listItem.appendChild(header);
    listItem.appendChild(body);

    dom.relocationList.appendChild(listItem);
    cleanedTargets.push({
      uid,
      participantId: entry.participantId || "",
      rowKey: entry.rowKey || ""
    });
  });

  state.relocationPromptTargets = cleanedTargets;

  if (dom.relocationDescription) {
    const count = cleanedTargets.length;
    dom.relocationDescription.textContent = count
      ? `「別日」と指定された参加者が${count}名います。移動先の日程と班番号を確認してください。`
      : "CSVで「別日」と入力された参加者、または「別日」ボタンから設定した参加者の移動先を選択してください。";
  }

  if (dom.relocationError) {
    dom.relocationError.hidden = true;
    dom.relocationError.textContent = "";
  }

  if (!cleanedTargets.length && dom.relocationDialog) {
    closeDialog(dom.relocationDialog, { reason: "empty" });
  }

}

function focusRelocationPromptItem(targetKey = "") {
  const normalizedKey = String(targetKey || "").trim();
  if (!normalizedKey || !dom.relocationList) {
    return;
  }

  const rows = Array.from(dom.relocationList.querySelectorAll(".relocation-item"));
  if (!rows.length) {
    return;
  }

  const findMatch = () =>
    rows.find(row => {
      if (!row) return false;
      const candidates = [row.dataset.uid, row.dataset.rowKey, row.dataset.participantId]
        .map(value => String(value || "").trim())
        .filter(Boolean);
      return candidates.includes(normalizedKey);
    });

  const focusRow = () => {
    const match = findMatch();
    if (!match) return;
    const select = match.querySelector("[data-relocation-select]");
    if (select && !select.disabled && typeof select.focus === "function") {
      select.focus();
      return;
    }
    const teamInput = match.querySelector("[data-relocation-team]");
    if (teamInput && typeof teamInput.focus === "function") {
      teamInput.focus();
    }
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(focusRow);
  } else {
    setTimeout(focusRow, 0);
  }
}

function queueRelocationPrompt(targets = [], { replace = false, focusKey = "" } = {}) {
  if (replace) {
    state.relocationPromptTargets = [];
  }

  const targetList = Array.isArray(targets) ? targets : [];
  if (!targetList.length) {
    if (replace || state.relocationPromptTargets?.length) {
      renderRelocationPrompt();
    }
    return false;
  }

  const existing = new Map();
  if (!replace && Array.isArray(state.relocationPromptTargets)) {
    state.relocationPromptTargets.forEach(item => {
      const key = item?.uid || item?.participantId || item?.rowKey;
      if (key) {
        existing.set(key, item);
      }
    });
  }

  const addedKeys = [];

  targetList.forEach(target => {
    const resolved = resolveParticipantActionTarget(target);
    const entry = resolved.entry;
    if (!entry) {
      return;
    }
    const teamValue = String(entry.teamNumber || entry.groupNumber || "");
    const status = resolveParticipantStatus(entry, teamValue);
    if (status !== "relocated") {
      return;
    }
    const uid = resolveParticipantUid(entry) || String(entry.participantId || "");
    const key = uid || String(entry.rowKey || "") || String(resolved.index);
    if (!key) {
      return;
    }
    if (!existing.has(key)) {
      addedKeys.push(key);
    }
    existing.set(key, {
      uid,
      participantId: entry.participantId || "",
      rowKey: entry.rowKey || ""
    });
  });

  state.relocationPromptTargets = Array.from(existing.values());
  if (!state.relocationPromptTargets.length) {
    return false;
  }

  renderRelocationPrompt();

  const preferredFocusKey = String(focusKey || "").trim() || addedKeys[0] ||
    String(state.relocationPromptTargets[0]?.uid || "") ||
    String(state.relocationPromptTargets[0]?.rowKey || "") ||
    String(state.relocationPromptTargets[0]?.participantId || "");

  if (dom.relocationDialog) {
    openDialog(dom.relocationDialog);
  }

  if (preferredFocusKey) {
    focusRelocationPromptItem(preferredFocusKey);
  }

  return true;
}

function handleRelocationFormSubmit(event) {
  event.preventDefault();
  if (!dom.relocationList) {
    return;
  }

  const rows = Array.from(dom.relocationList.querySelectorAll(".relocation-item"));
  if (!rows.length) {
    closeDialog(dom.relocationDialog, { reason: "empty" });
    return;
  }

  const updates = [];
  let hasSelectableSchedule = false;
  rows.forEach(row => {
    const select = row.querySelector("[data-relocation-select]");
    const teamInput = row.querySelector("[data-relocation-team]");
    const participantId = row.dataset.participantId || "";
    const rowKey = row.dataset.rowKey || "";
    const uid = row.dataset.uid || participantId || "";
    const scheduleId = String(select?.value || "").trim();
    const teamNumber = normalizeGroupNumberValue(teamInput?.value || "");
    const selectable = Boolean(select && !select.disabled);
    if (selectable) {
      hasSelectableSchedule = true;
    }
    if (!scheduleId) {
      return;
    }
    updates.push({ uid, participantId, rowKey, scheduleId, teamNumber });
  });

  if (!updates.length) {
    if (dom.relocationError) {
      dom.relocationError.hidden = false;
      dom.relocationError.textContent = hasSelectableSchedule
        ? "移動先の日程を選択してください。"
        : "移動先として選択できる日程がありません。";
    }
    if (hasSelectableSchedule) {
      const focusRow = rows.find(row => {
        const select = row.querySelector("[data-relocation-select]");
        return select && !select.disabled && !select.value;
      });
      const focusTarget = focusRow?.querySelector("[data-relocation-select]");
      if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
      }
    }
    return;
  }

  const processed = [];

  updates.forEach(update => {
    const resolved = resolveParticipantActionTarget({
      participantId: update.participantId,
      rowKey: update.rowKey
    });
    const entry = resolved.entry;
    const index = resolved.index;
    if (!entry || index === -1) {
      return;
    }
    const uid = resolveParticipantUid(entry) || update.uid || "";
    const rowKey = String(entry.rowKey || update.rowKey || "");
    const participantId = String(entry.participantId || update.participantId || "");
    if (!uid && !rowKey && !participantId) {
      return;
    }
    entry.teamNumber = RELOCATE_LABEL;
    entry.groupNumber = RELOCATE_LABEL;
    entry.status = "relocated";
    entry.isRelocated = true;
    entry.isCancelled = false;
    applyRelocationDraft(entry, update.scheduleId, update.teamNumber);
    state.participants[index] = entry;
    processed.push({ uid, rowKey, participantId });
  });

  if (!processed.length) {
    if (dom.relocationError) {
      dom.relocationError.hidden = false;
      dom.relocationError.textContent = "移動先の更新に失敗しました。";
    }
    return;
  }

  state.participants = sortParticipants(state.participants);
  syncCurrentScheduleCache();
  updateDuplicateMatches();
  renderParticipants();
  syncSaveButtonState();

  const processedKeys = new Set();
  processed.forEach(item => {
    [item.uid, item.participantId, item.rowKey]
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .forEach(key => processedKeys.add(key));
  });
  state.relocationPromptTargets = Array.isArray(state.relocationPromptTargets)
    ? state.relocationPromptTargets.filter(item => {
        const key = item?.uid || item?.participantId || item?.rowKey;
        return key && !processedKeys.has(String(key));
      })
    : [];

  if (state.relocationDraftOriginals instanceof Map) {
    const draftMap = state.relocationDraftOriginals;
    processedKeys.forEach(key => {
      if (draftMap.has(key)) {
        draftMap.delete(key);
      }
    });
  }

  if (dom.relocationError) {
    dom.relocationError.hidden = true;
    dom.relocationError.textContent = "";
  }

  if (state.relocationPromptTargets.length) {
    renderRelocationPrompt();
  } else {
    closeDialog(dom.relocationDialog, { reason: "submit" });
  }

  const message = processed.length === 1
    ? "別日の移動先を設定しました。変更は未保存です。"
    : `別日の移動先を${processed.length}名分設定しました。変更は未保存です。`;
  setUploadStatus(message, "info");
}

function handleRelocationDialogClose(event) {
  const reason = event?.detail?.reason || "dismiss";
  if (reason === "submit" || reason === "empty") {
    return;
  }
  if (!(state.relocationDraftOriginals instanceof Map) || !state.relocationDraftOriginals.size) {
    return;
  }

  const draftMap = state.relocationDraftOriginals;
  const remainingTargets = [];
  const revertKeys = new Set();

  if (Array.isArray(state.relocationPromptTargets)) {
    state.relocationPromptTargets.forEach(target => {
      if (!target) {
        return;
      }
      const { entry } = resolveParticipantActionTarget({
        participantId: target.participantId,
        rowKey: target.rowKey
      });
      if (!entry) {
        return;
      }
      const key = resolveRelocationDraftKey(entry, target, draftMap);
      if (key) {
        revertKeys.add(key);
      } else {
        remainingTargets.push(target);
      }
    });
  }

  state.relocationPromptTargets = remainingTargets;

  if (dom.relocationError) {
    dom.relocationError.hidden = true;
    dom.relocationError.textContent = "";
  }

  if (remainingTargets.length) {
    renderRelocationPrompt();
  } else if (dom.relocationList) {
    dom.relocationList.innerHTML = "";
  }

  if (!revertKeys.size) {
    return;
  }

  const restored = restoreRelocationDrafts(Array.from(revertKeys));
  if (restored) {
    setUploadStatus("別日の設定を取り消しました。", "info");
  }
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
  if (!relocation || !relocation.eventId || !relocation.toScheduleId) {
    return;
  }
  if (!(state.eventParticipantCache instanceof Map)) {
    return;
  }
  const cache = state.eventParticipantCache.get(relocation.eventId);
  if (!cache || typeof cache !== "object") {
    return;
  }
  const list = Array.isArray(cache[relocation.toScheduleId]) ? cache[relocation.toScheduleId] : [];
  cache[relocation.toScheduleId] = list.filter(entry => {
    const entryUid = resolveParticipantUid(entry) || String(entry?.participantId || "");
    return entryUid !== relocation.uid;
  });
  state.eventParticipantCache.set(relocation.eventId, cache);
}

function upsertRelocationPreview(relocation) {
  if (!relocation || !relocation.eventId || !relocation.toScheduleId) {
    return;
  }
  if (!(state.eventParticipantCache instanceof Map)) {
    state.eventParticipantCache = new Map();
  }
  const cache = state.eventParticipantCache.get(relocation.eventId) || {};
  const list = Array.isArray(cache[relocation.toScheduleId]) ? cache[relocation.toScheduleId].slice() : [];
  const filtered = list.filter(entry => {
    const entryUid = resolveParticipantUid(entry) || String(entry?.participantId || "");
    return entryUid !== relocation.uid;
  });

  const base = relocation.entrySnapshot || {};
  const destinationTeam = String(relocation.destinationTeamNumber || "");
  const sourceLabel = getScheduleLabel(relocation.eventId, relocation.fromScheduleId) || relocation.fromScheduleId || "";
  const scheduleRecord = getScheduleRecord(relocation.eventId, relocation.toScheduleId);
  const clone = ensureRowKey({
    key: relocation.uid,
    uid: relocation.uid,
    participantId: relocation.uid,
    legacyParticipantId: base.legacyParticipantId || "",
    name: base.name || "",
    phonetic: base.phonetic || base.furigana || "",
    furigana: base.phonetic || base.furigana || "",
    gender: base.gender || "",
    department: base.department || base.groupNumber || "",
    groupNumber: destinationTeam,
    teamNumber: destinationTeam,
    scheduleId: relocation.toScheduleId,
    status: "relocated",
    isCancelled: false,
    isRelocated: true,
    relocationSourceScheduleId: relocation.fromScheduleId || "",
    relocationSourceScheduleLabel: sourceLabel,
    relocationDestinationTeamNumber: destinationTeam,
    token: base.token || "",
    phone: base.phone || "",
    email: base.email || "",
    guidance: base.guidance || "",
    scheduleLabel: scheduleRecord?.label || scheduleRecord?.date || scheduleRecord?.id || ""
  }, "relocation-preview");

  filtered.push(clone);
  cache[relocation.toScheduleId] = sortParticipants(filtered);
  state.eventParticipantCache.set(relocation.eventId, cache);
}

function applyRelocationDraft(entry, destinationScheduleId, destinationTeamNumber) {
  const eventId = state.selectedEventId;
  const sourceScheduleId = state.selectedScheduleId;
  const uid = resolveParticipantUid(entry) || String(entry?.participantId || "");
  if (!eventId || !sourceScheduleId || !uid) {
    return;
  }

  const relocationMap = ensurePendingRelocationMap();
  const previous = relocationMap.get(uid);

  if (!destinationScheduleId) {
    if (previous) {
      clearRelocationPreview(previous);
      relocationMap.delete(uid);
    }
    entry.relocationDestinationScheduleId = "";
    entry.relocationDestinationScheduleLabel = "";
    entry.relocationDestinationTeamNumber = "";
    syncCurrentScheduleCache();
    updateDuplicateMatches();
    return;
  }

  const destinationLabel = getScheduleLabel(eventId, destinationScheduleId) || destinationScheduleId;
  entry.relocationDestinationScheduleId = destinationScheduleId;
  entry.relocationDestinationScheduleLabel = destinationLabel;
  entry.relocationDestinationTeamNumber = destinationTeamNumber;

  if (previous && previous.toScheduleId !== destinationScheduleId) {
    clearRelocationPreview(previous);
  }

  const snapshot = { ...entry };
  const relocation = {
    uid,
    participantId: entry.participantId,
    eventId,
    fromScheduleId: sourceScheduleId,
    toScheduleId: destinationScheduleId,
    destinationTeamNumber: destinationTeamNumber || "",
    entrySnapshot: snapshot
  };

  relocationMap.set(uid, relocation);
  upsertRelocationPreview(relocation);
  syncCurrentScheduleCache();
  updateDuplicateMatches();
}

function hasUnsavedChanges() {
  return signatureForEntries(state.participants) !== state.lastSavedSignature;
}

function setUploadStatus(message, variant = "") {
  const normalized = normalizeKey(message);
  if (normalized && UPLOAD_STATUS_PLACEHOLDERS.has(normalized)) {
    message = getMissingSelectionStatusMessage();
  }
  state.lastUploadStatusMessage = message;
  state.lastUploadStatusVariant = variant || "";
  if (!dom.uploadStatus) return;
  dom.uploadStatus.textContent = message;
  dom.uploadStatus.classList.remove("status-pill--success", "status-pill--error");
  if (variant === "success") {
    dom.uploadStatus.classList.add("status-pill--success");
  } else if (variant === "error") {
    dom.uploadStatus.classList.add("status-pill--error");
  }
}

function isPlaceholderUploadStatus() {
  const message = normalizeKey(state.lastUploadStatusMessage || "");
  if (!message) {
    return true;
  }
  return UPLOAD_STATUS_PLACEHOLDERS.has(message);
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
      if (event.key === "Escape") {
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

function encodeCsvValue(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function createCsvContent(rows) {
  return rows.map(row => row.map(encodeCsvValue).join(",")).join("\r\n");
}

function getSelectionIdentifiers() {
  return {
    eventId: state.selectedEventId ? String(state.selectedEventId) : "",
    scheduleId: state.selectedScheduleId ? String(state.selectedScheduleId) : ""
  };
}

function buildParticipantCsvFilename(eventId, scheduleId) {
  return `${eventId}_${scheduleId}_participants.csv`;
}

function buildTeamCsvFilename(eventId, scheduleId) {
  return `${eventId}_${scheduleId}_teams.csv`;
}

function downloadCsvFile(filename, rows) {
  if (!rows || !rows.length) return;
  const content = createCsvContent(rows);
  const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf]);
  let blob;

  if (typeof TextEncoder !== "undefined") {
    const encoder = new TextEncoder();
    const body = encoder.encode(content);
    blob = new Blob([bomBytes, body], { type: "text/csv;charset=utf-8;" });
  } else {
    blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

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
  const raw = entry && (entry.teamNumber ?? entry.groupNumber);
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
      club: normalizeKey(value.club || "")
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
  const list = dom.participantCardList;
  if (!list) {
    syncSelectedEventSummary();
    return;
  }
  list.innerHTML = "";

  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  const duplicateMap = state.duplicateMatches instanceof Map ? state.duplicateMatches : new Map();
  const participants = sortParticipants(state.participants);
  const glRosterMap = getEventGlRoster(eventId);
  const glAssignmentsMap = getEventGlAssignmentsMap(eventId);

  const diff = diffParticipantLists(state.participants, state.savedParticipants || []);
  const changeInfoByKey = new Map();
  diff.added.forEach(entry => {
    const key = participantChangeKey(entry);
    if (!key || changeInfoByKey.has(key)) return;
    changeInfoByKey.set(key, { type: "added", current: entry });
  });
  diff.updated.forEach(item => {
    const key = participantChangeKey(item.current);
    if (!key || changeInfoByKey.has(key)) return;
    changeInfoByKey.set(key, {
      type: "updated",
      current: item.current,
      previous: item.previous,
      changes: item.changes
    });
  });

  list.setAttribute("data-count", String(participants.length));

  const fragment = document.createDocumentFragment();
  const groupMap = new Map();
  let selectionFound = false;
  const ensuredTeamGroups = new Set();
  let needsCancelGroup = false;
  let needsStaffGroup = false;

  participants.forEach((entry, index) => {
    const changeKey = participantChangeKey(entry, index);
    const changeInfo = changeInfoByKey.get(changeKey);
    const { card, isSelected } = buildParticipantCard(entry, index, {
      changeInfo,
      duplicateMap,
      eventId,
      scheduleId
    });
    if (isSelected) {
      selectionFound = true;
    }
    const groupKey = getParticipantGroupKey(entry);
    let group = groupMap.get(groupKey);
    if (!group) {
      const elements = createParticipantGroupElements(groupKey);
      group = { ...elements, count: 0, key: groupKey };
      groupMap.set(groupKey, group);
      fragment.appendChild(elements.section);
    }
    group.cardsContainer.appendChild(card);
    group.count += 1;
    ensuredTeamGroups.add(normalizeKey(groupKey || ""));
  });

  if (glAssignmentsMap instanceof Map) {
    glAssignmentsMap.forEach(entry => {
      const assignment = resolveScheduleAssignment(entry, scheduleId);
      if (!assignment) return;
      if (assignment.status === "absent") {
        needsCancelGroup = true;
      } else if (assignment.status === "staff") {
        needsStaffGroup = true;
      } else if (assignment.status === "team") {
        const teamKey = normalizeKey(assignment.teamId || "");
        if (teamKey) {
          if (!groupMap.has(teamKey)) {
            const elements = createParticipantGroupElements(teamKey);
            groupMap.set(teamKey, { ...elements, count: 0, key: teamKey });
            fragment.appendChild(elements.section);
          }
          ensuredTeamGroups.add(teamKey);
        }
      }
    });
  }

  if (needsCancelGroup && !groupMap.has(CANCEL_LABEL)) {
    const elements = createParticipantGroupElements(CANCEL_LABEL);
    groupMap.set(CANCEL_LABEL, { ...elements, count: 0, key: CANCEL_LABEL });
    fragment.appendChild(elements.section);
    ensuredTeamGroups.add(normalizeKey(CANCEL_LABEL));
  }

  if (needsStaffGroup && !groupMap.has(GL_STAFF_GROUP_KEY)) {
    const elements = createParticipantGroupElements(GL_STAFF_GROUP_KEY);
    groupMap.set(GL_STAFF_GROUP_KEY, { ...elements, count: 0, key: GL_STAFF_GROUP_KEY });
    fragment.appendChild(elements.section);
    ensuredTeamGroups.add(normalizeKey(GL_STAFF_GROUP_KEY));
  }

  groupMap.forEach(group => {
    group.countElement.textContent = `${group.count}名`;
    renderGroupGlAssignments(group, {
      eventId,
      rosterMap: glRosterMap,
      assignmentsMap: glAssignmentsMap,
      scheduleId
    });
  });

  list.appendChild(fragment);
  list.setAttribute("data-group-count", String(groupMap.size));

  if ((state.selectedParticipantRowKey || state.selectedParticipantId) && !selectionFound) {
    clearParticipantSelection({ silent: true });
  }

  list.appendChild(fragment);

  if (dom.adminSummary) {
    const total = state.participants.length;
    const summaryEntries = [];
    const duplicateGroups = state.duplicateGroups instanceof Map ? state.duplicateGroups : new Map();
    duplicateGroups.forEach(group => {
      if (!group || !Array.isArray(group.records) || !group.records.length) return;
      const hasCurrent = group.records.some(record => record.isCurrent && String(record.scheduleId) === String(scheduleId));
      if (!hasCurrent) return;
      const detail = group.records
        .map(record => describeDuplicateMatch(record, eventId, scheduleId))
        .filter(Boolean)
        .join(" / ");
      if (!detail) return;
      const totalCount = group.totalCount || group.records.length;
      summaryEntries.push({ detail, totalCount });
    });

    let summaryText = total
      ? `登録済みの参加者: ${total}名`
      : "参加者リストはまだ登録されていません。";

    if (summaryEntries.length) {
      const preview = summaryEntries
        .slice(0, 3)
        .map(entry => `${entry.detail}（${entry.totalCount}件）`)
        .join(" / ");
      const remainder = summaryEntries.length > 3 ? ` / 他${summaryEntries.length - 3}件` : "";
      summaryText += ` / 重複候補 ${summaryEntries.length}件 (${preview}${remainder})`;
    }

    dom.adminSummary.textContent = summaryText;
  }

  renderParticipantChangePreview(diff, changeInfoByKey, participants);
  syncSaveButtonState();
  syncClearButtonState();
  syncTemplateButtons();
  renderRelocationPrompt();
  syncSelectedEventSummary();
  applyParticipantSelectionStyles();
  updateParticipantActionPanelState();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPrintCell(value, { placeholder = "&nbsp;" } = {}) {
  const text = String(value ?? "").trim();
  if (!text) {
    return placeholder;
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function formatMetaDisplay(primary, id) {
  const primaryText = String(primary ?? "").trim();
  const idText = String(id ?? "").trim();
  if (primaryText && idText && primaryText !== idText) {
    return `${primaryText}（ID: ${idText}）`;
  }
  return primaryText || idText;
}

function formatPrintDateTimeRange(startAt, endAt) {
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  const startValid = start && !Number.isNaN(start.getTime());
  const endValid = end && !Number.isNaN(end.getTime());
  if (!startValid && !endValid) {
    return "";
  }

  const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  if (startValid && endValid) {
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const startText = dateFormatter.format(start);
    if (sameDay) {
      return `${startText} 〜 ${timeFormatter.format(end)}`;
    }
    return `${startText} 〜 ${dateFormatter.format(end)}`;
  }

  if (startValid) {
    return `${dateFormatter.format(start)} 〜`;
  }
  return `〜 ${dateFormatter.format(end)}`;
}

function buildParticipantPrintGroups({ eventId, scheduleId }) {
  const participants = sortParticipants(state.participants);
  const rosterMap = getEventGlRoster(eventId);
  const assignmentsMap = getEventGlAssignmentsMap(eventId);
  const groupsByKey = new Map();

  participants.forEach(entry => {
    const groupKey = getParticipantGroupKey(entry);
    let group = groupsByKey.get(groupKey);
    if (!group) {
      const { label, value } = describeParticipantGroup(groupKey);
      group = {
        key: groupKey,
        label,
        value,
        participants: []
      };
      groupsByKey.set(groupKey, group);
    }
    group.participants.push(entry);
  });

  return Array.from(groupsByKey.values())
    .filter(group => Array.isArray(group.participants) && group.participants.length > 0)
    .map(group => ({
      ...group,
      glLeaders: collectGroupGlLeaders(group.key, {
        eventId,
        scheduleId,
        rosterMap,
        assignmentsMap
      })
    }));
}

const PRINT_SETTING_STORAGE_KEY = "qa.printSettings.v1";
const PRINT_PAPER_SIZES = new Set(["A4", "A3", "Letter"]);
const PRINT_ORIENTATIONS = new Set(["portrait", "landscape"]);
const PRINT_MARGINS = new Set(["5mm", "10mm", "15mm"]);

function normalizePrintSettings(settings = {}) {
  const normalized = {
    paperSize: PRINT_PAPER_SIZES.has(settings?.paperSize) ? settings.paperSize : state.printSettings.paperSize,
    orientation: PRINT_ORIENTATIONS.has(settings?.orientation) ? settings.orientation : state.printSettings.orientation,
    margin: PRINT_MARGINS.has(settings?.margin) ? settings.margin : state.printSettings.margin,
    showHeader: settings?.showHeader !== undefined ? Boolean(settings.showHeader) : state.printSettings.showHeader,
    repeatHeader: settings?.repeatHeader !== undefined ? Boolean(settings.repeatHeader) : state.printSettings.repeatHeader,
    showPageNumbers: settings?.showPageNumbers !== undefined ? Boolean(settings.showPageNumbers) : state.printSettings.showPageNumbers,
    showDate: settings?.showDate !== undefined ? Boolean(settings.showDate) : state.printSettings.showDate,
    showTime: settings?.showTime !== undefined ? Boolean(settings.showTime) : state.printSettings.showTime
  };

  if (!normalized.showHeader) {
    normalized.repeatHeader = false;
  }

  return normalized;
}

function hydratePrintSettingsFromStorage() {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const stored = localStorage.getItem(PRINT_SETTING_STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    const normalized = normalizePrintSettings(parsed);
    state.printSettings = normalized;
  } catch (error) {
    console.warn("[Print] Failed to load print settings from storage", error);
  }
}

function persistPrintSettings(settings) {
  const normalized = normalizePrintSettings(settings);
  state.printSettings = normalized;
  if (typeof localStorage === "undefined") {
    return normalized;
  }
  try {
    localStorage.setItem(PRINT_SETTING_STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn("[Print] Failed to persist print settings", error);
  }
  return normalized;
}

function applyPrintSettingsToForm(settings = state.printSettings) {
  const normalized = normalizePrintSettings(settings);
  if (dom.printPaperSizeInput) {
    dom.printPaperSizeInput.value = normalized.paperSize;
  }
  if (dom.printOrientationInput) {
    dom.printOrientationInput.value = normalized.orientation;
  }
  if (dom.printMarginInput) {
    dom.printMarginInput.value = normalized.margin;
  }
  if (dom.printShowHeaderInput) {
    dom.printShowHeaderInput.checked = normalized.showHeader;
  }
  if (dom.printRepeatHeaderInput) {
    dom.printRepeatHeaderInput.checked = normalized.repeatHeader && normalized.showHeader;
    dom.printRepeatHeaderInput.disabled = !normalized.showHeader;
  }
  if (dom.printShowPageNumberInput) {
    dom.printShowPageNumberInput.checked = normalized.showPageNumbers;
  }
  if (dom.printShowDateInput) {
    dom.printShowDateInput.checked = normalized.showDate;
  }
  if (dom.printShowTimeInput) {
    dom.printShowTimeInput.checked = normalized.showTime;
  }
}

function readPrintSettingsFromForm() {
  const settings = {
    paperSize: dom.printPaperSizeInput?.value,
    orientation: dom.printOrientationInput?.value,
    margin: dom.printMarginInput?.value,
    showHeader: dom.printShowHeaderInput ? dom.printShowHeaderInput.checked : undefined,
    repeatHeader: dom.printRepeatHeaderInput ? dom.printRepeatHeaderInput.checked : undefined,
    showPageNumbers: dom.printShowPageNumberInput ? dom.printShowPageNumberInput.checked : undefined,
    showDate: dom.printShowDateInput ? dom.printShowDateInput.checked : undefined,
    showTime: dom.printShowTimeInput ? dom.printShowTimeInput.checked : undefined
  };
  if (settings.showHeader === false) {
    settings.repeatHeader = false;
  }
  return normalizePrintSettings(settings);
}

function setupPrintSettingsDialog() {
  if (!dom.printSettingsForm) return;

  const syncHeaderControls = () => {
    if (!dom.printShowHeaderInput || !dom.printRepeatHeaderInput) return;
    const enabled = Boolean(dom.printShowHeaderInput.checked);
    dom.printRepeatHeaderInput.disabled = !enabled;
    if (!enabled) {
      dom.printRepeatHeaderInput.checked = false;
    }
  };

  dom.printShowHeaderInput?.addEventListener("change", syncHeaderControls);
  dom.printSettingsForm.addEventListener("change", () => {
    const settings = readPrintSettingsFromForm();
    persistPrintSettings(settings);
    updateParticipantPrintPreview({ autoPrint: false, forceReveal: true, quiet: true });
  });

  dom.printSettingsForm.addEventListener("submit", event => {
    event.preventDefault();
    const settings = readPrintSettingsFromForm();
    persistPrintSettings(settings);
    updateParticipantPrintPreview({ autoPrint: false, forceReveal: true });
  });

  applyPrintSettingsToForm(state.printSettings);
  syncHeaderControls();
}

function buildParticipantPrintHtml({
  eventId,
  scheduleId,
  eventName,
  scheduleLabel,
  scheduleLocation,
  scheduleRange,
  groups,
  totalCount,
  generatedAt,
  printOptions
}) {
  const printSettings = normalizePrintSettings(printOptions);
  const eventDisplayRaw = formatMetaDisplay(eventName, eventId);
  const scheduleDisplayRaw = formatMetaDisplay(scheduleLabel, scheduleId);
  const locationDisplayRaw = String(scheduleLocation || "").trim();
  const rangeDisplayRaw = String(scheduleRange || "").trim();
  const generatedAtDate = generatedAt instanceof Date && !Number.isNaN(generatedAt.getTime())
    ? generatedAt
    : new Date();
  const generatedDateFormatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const generatedTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const generatedDateText = generatedDateFormatter.format(generatedAtDate);
  const generatedTimeText = generatedTimeFormatter.format(generatedAtDate);
  const totalValue = Number.isFinite(totalCount)
    ? totalCount
    : groups.reduce((sum, group) => sum + (group.participants?.length || 0), 0);

  const titleParts = [eventDisplayRaw, scheduleDisplayRaw]
    .map(part => String(part || "").trim())
    .filter(Boolean);
  const headingText = titleParts.length
    ? `${titleParts.join(" / ")} の参加者リスト`
    : "参加者リスト";
  const docTitle = titleParts.length
    ? `${titleParts.join(" / ")} - 参加者リスト`
    : "参加者リスト";

  const metaItems = [];
  if (eventDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">イベント:</span> <span class="print-meta__value">${escapeHtml(eventDisplayRaw)}</span></li>`
    );
  }
  if (scheduleDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">日程:</span> <span class="print-meta__value">${escapeHtml(scheduleDisplayRaw)}</span></li>`
    );
  }
  if (locationDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">会場:</span> <span class="print-meta__value">${escapeHtml(locationDisplayRaw)}</span></li>`
    );
  }
  if (rangeDisplayRaw) {
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">時間:</span> <span class="print-meta__value">${escapeHtml(rangeDisplayRaw)}</span></li>`
    );
  }
  metaItems.push(
    `<li class="print-meta__item"><span class="print-meta__label">参加者数:</span> <span class="print-meta__value">${escapeHtml(`${totalValue}名`)}</span></li>`
  );
  if (printSettings.showDate || printSettings.showTime) {
    const generatedParts = [
      printSettings.showDate ? generatedDateText : "",
      printSettings.showTime ? generatedTimeText : ""
    ].filter(Boolean);
    const generatedLabel = printSettings.showDate && printSettings.showTime
      ? "出力日時"
      : printSettings.showDate
        ? "出力日"
        : "出力時刻";
    metaItems.push(
      `<li class="print-meta__item"><span class="print-meta__label">${escapeHtml(generatedLabel)}:</span> <span class="print-meta__value">${escapeHtml(generatedParts.join(" "))}</span></li>`
    );
  }

  const groupsMarkup = groups
    .map(group => {
      const labelText = group.label || "班番号";
      const rawValue = String(group.value || "").trim();
      const displayValue = rawValue || (labelText === "班番号" ? "未設定" : "");
      const safeLabel = escapeHtml(labelText);
      const safeValue = displayValue ? escapeHtml(displayValue) : "—";
      const accessibleLabel = [labelText, displayValue].filter(Boolean).join(" ").trim();
      const tableAriaLabel = escapeHtml(accessibleLabel ? `${accessibleLabel} の参加者一覧` : "参加者一覧");
      const groupKeyAttr = escapeHtml(String(group.key || ""));
      const glRows = group.glLeaders && group.glLeaders.length
        ? group.glLeaders
            .map(leader => {
              const nameCell = formatPrintCell(leader.name, { placeholder: "—" });
              const metaCell = formatPrintCell(leader.meta, { placeholder: "—" });
              return `<tr><td>${nameCell}</td><td>${metaCell}</td></tr>`;
            })
            .join("\n")
        : '<tr><td colspan="2" class="print-group__gl-empty">—</td></tr>';
      const participantRows = group.participants && group.participants.length
        ? group.participants
            .map((entry, index) => {
              const phonetic = entry?.phonetic || entry?.furigana || "";
              const department = entry?.department || "";
              const phone = entry?.phone || "";
              const email = entry?.email || "";
              return `<tr><td class="print-table__index">${index + 1}</td><td class="print-table__name">${formatPrintCell(entry?.name)}</td><td class="print-table__phonetic">${formatPrintCell(phonetic)}</td><td class="print-table__department">${formatPrintCell(department)}</td><td class="print-table__contact">${formatPrintCell(phone)}</td><td class="print-table__contact">${formatPrintCell(email)}</td></tr>`;
            })
            .join("\n")
        : '<tr class="print-table__empty"><td colspan="6">参加者がいません</td></tr>';

      return `<section class="print-group" data-group-key="${groupKeyAttr}">
        <div class="print-group__header">
          <div class="print-group__meta">
            <div class="print-group__label">${safeLabel}</div>
            <div class="print-group__value">${safeValue}</div>
          </div>
          <div class="print-group__gl">
            <table class="print-group__gl-table" aria-label="GL情報">
              <thead>
                <tr><th scope="col">GL名前</th><th scope="col">学部学科</th></tr>
              </thead>
              <tbody>
                ${glRows}
              </tbody>
            </table>
          </div>
        </div>
        <table class="print-table" aria-label="${tableAriaLabel}">
          <thead>
            <tr>
              <th scope="col" class="print-table__index">No.</th>
              <th scope="col">参加者名</th>
              <th scope="col">フリガナ</th>
              <th scope="col">学部学科</th>
              <th scope="col">電話番号</th>
              <th scope="col">メールアドレス</th>
            </tr>
          </thead>
          <tbody>
            ${participantRows}
          </tbody>
        </table>
      </section>`;
    })
      .join("\n\n");

  const metaMarkup = metaItems.length
    ? `<ul class="print-meta">${metaItems.join("\n")}</ul>`
    : "";
  const sectionsMarkup = groupsMarkup || '<p class="print-empty">参加者リストが登録されていません。</p>';
  const pageMargin = printSettings.margin || "5mm";
  const pageSize = printSettings.paperSize || "A4";
  const pageOrientation = printSettings.orientation || "portrait";
  const headerClass = printSettings.repeatHeader ? "print-header print-header--repeat" : "print-header";
  const footerTimestamp = [
    printSettings.showDate ? generatedDateText : "",
    printSettings.showTime ? generatedTimeText : ""
  ].filter(Boolean).join(" ");
  const footerItems = [];
  if (printSettings.showPageNumbers) {
    footerItems.push('<span class="print-footer__item print-footer__page" aria-label="ページ番号"><span class="print-footer__page-number" aria-hidden="true"></span></span>');
  }
  if (footerTimestamp) {
    footerItems.push(`<span class="print-footer__item">${escapeHtml(footerTimestamp)}</span>`);
  }
  const footerMarkup = footerItems.length
    ? `<footer class="print-footer"><div class="print-footer__items">${footerItems.join("")}</div></footer>`
    : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(docTitle)}</title>
  <style>
    :root { color-scheme: light; --page-margin: ${pageMargin}; }
    @font-face { font-family: "GenEi Gothic"; src: url("/assets/fonts/genei-gothic/GenEiGothicP-Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }
    @font-face { font-family: "GenEi Gothic"; src: url("/assets/fonts/genei-gothic/GenEiGothicP-SemiBold.woff2") format("woff2"); font-weight: 600; font-style: normal; font-display: swap; }
    @font-face { font-family: "GenEi Gothic"; src: url("/assets/fonts/genei-gothic/GenEiGothicP-Heavy.woff2") format("woff2"); font-weight: 700; font-style: normal; font-display: swap; }
    @page { size: ${pageSize} ${pageOrientation}; margin: ${pageMargin}; counter-increment: page; }
    body { margin: var(--page-margin); font-family: "GenEi Gothic", "Noto Sans JP", "Yu Gothic", "Meiryo", system-ui, sans-serif; font-size: 8.8pt; line-height: 1.5; color: #000; background: #fff; }
    .print-controls { margin-bottom: 6mm; }
    .print-controls__button { border: 0.25mm solid #000; background: #fff; color: #000; padding: 4px 12px; font-size: 8pt; cursor: pointer; }
    .print-controls__button:focus { outline: 1px solid #000; outline-offset: 2px; }
    .print-header { margin-bottom: 8mm; }
    .print-title { font-size: 14.4pt; margin: 0 0 4mm; }
    .print-meta { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 2mm 12mm; font-size: 8pt; }
    .print-meta__label { font-weight: 600; margin-right: 2mm; }
    .print-group { border: 0.3mm solid #000; padding: 3mm; margin-bottom: 12mm; background: #fff; page-break-inside: avoid; break-inside: avoid; }
    .print-group__header { display: flex; justify-content: space-between; align-items: flex-start; gap: 5mm; margin-bottom: 4mm; }
    .print-group__meta { min-width: 40mm; }
    .print-group__label { font-size: 7.2pt; color: #555; letter-spacing: 0.08em; margin-bottom: 1mm; text-transform: uppercase;}
    .print-group__value { font-size: 12.8pt; font-weight: 600; }
    .print-group__gl { flex: 1 1 auto; }
    .print-group__gl-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .print-group__gl-table th, .print-group__gl-table td { border: 0.25mm solid #000; padding: 1.5mm 2mm; text-align: left; }
    .print-group__gl-table th { background: #f0f0f0; }
    .print-group__gl-empty { text-align: center; color: #555; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .print-table th, .print-table td { border: 0.25mm solid #000; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
    .print-table th { background: #f5f5f5; }
    .print-table__index { width: 12mm; text-align: right; }
    .print-table__phonetic { font-size: 7.2pt; }
    .print-table__contact { white-space: nowrap; }
    .print-table__empty td { text-align: center; color: #555; }
    .print-empty { font-size: 8.8pt; margin: 0; }
    .print-footer { margin-top: 6mm; font-size: 8pt; color: #000; }
    .print-footer__items { display: flex; gap: 6mm; align-items: center; }
    .print-footer__item { white-space: nowrap; }
    @media print {
      body { -webkit-print-color-adjust: exact; margin: 0; counter-reset: page 0; }
      .print-controls { display: none; }
      .print-group { break-inside: avoid-page; }
      .print-footer { position: fixed; bottom: var(--page-margin); left: var(--page-margin); right: var(--page-margin); }
      .print-footer__page-number::after { content: counter(page) " / " counter(pages); }
      ${printSettings.repeatHeader ? `.print-header--repeat { position: running(printHeader); }
      @page { @top-center { content: element(printHeader); } }
      .print-header--repeat { background: #fff; }
      .print-header--repeat { position: sticky; top: 0; }` : ""}
    }
  </style>
</head>
<body>
  <div class="print-controls">
    <button type="button" class="print-controls__button" onclick="window.print()">このリストを印刷</button>
  </div>
  ${printSettings.showHeader ? `<header class="${headerClass}">
    <h1 class="print-title">${escapeHtml(headingText)}</h1>
    ${metaMarkup}
  </header>` : ""}
  ${sectionsMarkup}
  ${footerMarkup}
</body>
</html>`;
}

const PRINT_PREVIEW_DEFAULT_NOTE = "印刷設定を選ぶとここに最新のプレビューが表示されます。";
const PRINT_PREVIEW_LOAD_TIMEOUT_MS = 4000;

let participantPrintInProgress = false;

let participantPrintAutoPrintPending = false;

let participantPrintPreviewCache = {
  html: "",
  title: "",
  metaText: "",
  forcePopupFallback: false
};

let participantPrintPreviewLoadAbort = null;

function normalizeLivePoliteness(value, { defaultValue = "" } = {}) {
  const normalize = (input) => {
    const trimmed = (input || "").trim().toLowerCase();
    return trimmed === "assertive" || trimmed === "polite" || trimmed === "off"
      ? trimmed
      : "";
  };

  return normalize(value) || normalize(defaultValue);
}

function normalizeLiveRegionRole(value) {
  const trimmed = (value || "").trim().toLowerCase();
  return trimmed === "status" || trimmed === "alert" ? trimmed : "";
}

function cacheParticipantPrintPreview(
  { html = "", title = "", metaText = "", forcePopupFallback } = {},
  { preserveFallbackFlag = false } = {}
) {
  const nextForcePopupFallback =
    forcePopupFallback !== undefined
      ? Boolean(forcePopupFallback)
      : preserveFallbackFlag
      ? Boolean(participantPrintPreviewCache.forcePopupFallback)
      : false;

  participantPrintPreviewCache = {
    html: html || "",
    title: title || "",
    metaText: metaText || "",
    forcePopupFallback: nextForcePopupFallback
  };
}

function setPrintPreviewNote(text = PRINT_PREVIEW_DEFAULT_NOTE, options = {}) {
  const { forceAnnounce = false, politeness, role } = options || {};
  if (!dom.printPreviewNote) {
    return;
  }

  const nextText = text || "";
  const currentText = dom.printPreviewNote.textContent || "";
  const rawCurrentLive = dom.printPreviewNote.getAttribute("aria-live");
  const roleOverride = role !== undefined ? normalizeLiveRegionRole(role) : null;
  const defaultPoliteness = roleOverride === "alert" ? "assertive" : "polite";
  const nextLive = normalizeLivePoliteness(politeness, { defaultValue: defaultPoliteness });
  const currentLive = normalizeLivePoliteness(rawCurrentLive, { defaultValue: "" });
  let nextRole =
    roleOverride !== null
      ? roleOverride
      : nextLive === "assertive"
      ? "alert"
      : nextLive === "polite"
      ? "status"
      : "";

  if (nextLive === "off") {
    nextRole = "";
  }
  const rawCurrentRole = dom.printPreviewNote.getAttribute("role");
  const currentRole = normalizeLiveRegionRole(rawCurrentRole);
  const liveChanged = nextLive !== currentLive;
  const roleChanged = nextRole !== currentRole;
  const liveNeedsClear = !nextLive && rawCurrentLive !== null;
  const roleNeedsClear = !nextRole && rawCurrentRole !== null;

  dom.printPreviewNote.classList.remove("print-preview__note--error");

  const shouldAnnounce =
    forceAnnounce || liveChanged || roleChanged || liveNeedsClear || roleNeedsClear;
  const shouldUpdateRole = roleChanged || roleNeedsClear || forceAnnounce;
  const shouldForceLiveReset = forceAnnounce && nextLive !== "off";
  const shouldForceRoleReset = forceAnnounce && shouldUpdateRole;

  const applyLive = (value) => {
    if (!value || value === "off") {
      dom.printPreviewNote.removeAttribute("aria-live");
    } else {
      dom.printPreviewNote.setAttribute("aria-live", value);
    }
  };

  if (!shouldAnnounce && currentText === nextText) {
    return;
  }

  if (shouldForceLiveReset) {
    applyLive("off");
  } else if (liveChanged || liveNeedsClear || nextLive === "off") {
    applyLive(nextLive);
  }

  if (shouldForceRoleReset) {
    dom.printPreviewNote.removeAttribute("role");
  }

  if (shouldUpdateRole && !shouldForceRoleReset) {
    if (nextRole) {
      dom.printPreviewNote.setAttribute("role", nextRole);
    } else {
      dom.printPreviewNote.removeAttribute("role");
    }
  }

  dom.printPreviewNote.textContent = "";

  const restoreLive = () => {
    if (shouldForceLiveReset) {
      applyLive(nextLive);
    }
  };

  const renderText = () => {
    if (shouldForceRoleReset) {
      if (nextRole) {
        dom.printPreviewNote.setAttribute("role", nextRole);
      } else {
        dom.printPreviewNote.removeAttribute("role");
      }
    }
    restoreLive();
    dom.printPreviewNote.textContent = nextText;
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(renderText);
  } else {
    renderText();
  }
}

function setPrintPreviewVisibility(visible) {
  const dialog = dom.printPreviewDialog;
  if (dialog) {
    if (visible) {
      openDialog(dialog);
      if (dom.printPreview) {
        dom.printPreview.hidden = false;
      }
    } else {
      closeDialog(dialog);
    }
    return true;
  }
  if (dom.printPreview) {
    dom.printPreview.hidden = !visible;
    return true;
  }
  return false;
}

function setPrintPreviewBusy(isBusy = false) {
  if (!dom.printPreview) {
    return;
  }
  dom.printPreview.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function clearParticipantPrintPreviewLoader() {
  if (!participantPrintPreviewLoadAbort) {
    return;
  }

  const { loadHandler, errorHandler, timeoutId } = participantPrintPreviewLoadAbort;

  if (timeoutId) {
    window.clearTimeout(timeoutId);
  }

  if (loadHandler && dom.printPreviewFrame) {
    try {
      dom.printPreviewFrame.removeEventListener("load", loadHandler);
    } catch (error) {
      // Ignore listener cleanup errors
    }
  }

  if (errorHandler && dom.printPreviewFrame) {
    try {
      dom.printPreviewFrame.removeEventListener("error", errorHandler);
    } catch (error) {
      // Ignore listener cleanup errors
    }
  }

  participantPrintPreviewLoadAbort = null;
}

function resetPrintPreview(options = {}) {
  const { skipCloseDialog = false } = options || {};
  clearParticipantPrintPreviewLoader();
  if (dom.printPreviewFrame) {
    dom.printPreviewFrame.srcdoc = "";
  }
  if (dom.printPreview) {
    dom.printPreview.classList.remove("print-preview--fallback");
  }
  setPrintPreviewBusy(false);
  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.disabled = true;
    delete dom.printPreviewPrintButton.dataset.popupFallback;
  }
  if (dom.printPreviewNote) {
    dom.printPreviewNote.classList.remove("print-preview__note--error");
  }
  if (dom.printPreviewMeta) {
    dom.printPreviewMeta.textContent = "";
  }
  cacheParticipantPrintPreview({ forcePopupFallback: false });
  participantPrintAutoPrintPending = false;
  setPrintPreviewNote();
  if (skipCloseDialog) {
    if (dom.printPreview) {
      dom.printPreview.hidden = true;
    }
  } else {
    setPrintPreviewVisibility(false);
  }
}

function renderPreviewFallbackNote(message, metaText = "") {
  clearParticipantPrintPreviewLoader();
  if (dom.printPreviewFrame) {
    dom.printPreviewFrame.srcdoc = "";
  }
  if (dom.printPreview) {
    dom.printPreview.classList.add("print-preview--fallback");
  }
  const hasCachedHtml = Boolean(participantPrintPreviewCache?.html);
  const popupHint = hasCachedHtml
    ? " 画面右の「このリストを印刷」からポップアップ印刷を再試行できます。"
    : "";
  const noteText = `${message || "プレビューを表示できませんでした。"}${popupHint}`;
  const nextMetaText = metaText || participantPrintPreviewCache.metaText || "";

  setPrintPreviewVisibility(true);
  setPrintPreviewNote(noteText, { forceAnnounce: true, politeness: "assertive" });
  setPrintPreviewBusy(false);
  cacheParticipantPrintPreview({
    ...participantPrintPreviewCache,
    metaText: nextMetaText,
    forcePopupFallback: true
  });
  participantPrintAutoPrintPending = false;
  if (dom.printPreviewMeta) {
    dom.printPreviewMeta.textContent = nextMetaText;
  }
  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.disabled = !hasCachedHtml;
    if (hasCachedHtml) {
      dom.printPreviewPrintButton.dataset.popupFallback = "true";
    } else {
      delete dom.printPreviewPrintButton.dataset.popupFallback;
    }
  }
  if (dom.printPreviewNote) {
    dom.printPreviewNote.classList.add("print-preview__note--error");
  }
}

function openPopupPrintWindow(html, docTitle) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    return false;
  }

  try {
    printWindow.opener = null;
  } catch (error) {
    // Ignore opener errors
  }

  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  } catch (error) {
    // Ignore document write errors
  }

  try {
    if (docTitle) {
      printWindow.document.title = docTitle;
    }
  } catch (error) {
    // Ignore title assignment errors
  }

  window.setTimeout(() => {
    try {
      printWindow.print();
    } catch (error) {
      // Ignore print errors
    }
  }, 150);

  return true;
}

function renderParticipantPrintPreview({
  html,
  metaText,
  title,
  autoPrint = false
} = {}) {
  if (!dom.printPreview || !dom.printPreviewFrame) {
    return false;
  }

  setPrintPreviewBusy(true);

  if (participantPrintPreviewCache.forcePopupFallback) {
    renderPreviewFallbackNote(
      "プレビューを利用できないためポップアップ印刷を使用します。",
      metaText || participantPrintPreviewCache.metaText || ""
    );

    if (autoPrint && participantPrintPreviewCache.html) {
      const fallbackOpened = openPopupPrintWindow(
        participantPrintPreviewCache.html,
        participantPrintPreviewCache.title
      );
      if (!fallbackOpened) {
        window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
      }
    }

    return false;
  }

  setPrintPreviewVisibility(true);
  if (dom.printPreview) {
    dom.printPreview.classList.remove("print-preview--fallback");
  }
  setPrintPreviewNote(autoPrint ? "プレビューを準備しています…" : "プレビューを更新しています…");
  if (dom.printPreviewNote) {
    dom.printPreviewNote.classList.remove("print-preview__note--error");
  }
  if (dom.printPreviewMeta) {
    dom.printPreviewMeta.textContent = metaText || "";
  }
  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.disabled = true;
    delete dom.printPreviewPrintButton.dataset.popupFallback;
  }

  cacheParticipantPrintPreview({ html, title, metaText }, { preserveFallbackFlag: true });
  participantPrintAutoPrintPending = Boolean(autoPrint);
  clearParticipantPrintPreviewLoader();

  let loadTimeoutId = null;
  let settled = false;

  const settleLoad = () => {
    if (settled) {
      return false;
    }
    settled = true;
    if (loadTimeoutId) {
      window.clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    }
    if (dom.printPreviewFrame && participantPrintPreviewLoadAbort) {
      try {
        if (participantPrintPreviewLoadAbort.loadHandler) {
          dom.printPreviewFrame.removeEventListener("load", participantPrintPreviewLoadAbort.loadHandler);
        }
        if (participantPrintPreviewLoadAbort.errorHandler) {
          dom.printPreviewFrame.removeEventListener("error", participantPrintPreviewLoadAbort.errorHandler);
        }
      } catch (error) {
        // Ignore listener cleanup errors
      }
    }
    participantPrintPreviewLoadAbort = null;
    setPrintPreviewBusy(false);
    return true;
  };

  const handleLoad = () => {
    if (!settleLoad()) {
      return;
    }
    const hasWindow = Boolean(dom.printPreviewFrame?.contentWindow);
    const hasDocument = Boolean(dom.printPreviewFrame?.contentDocument);

    if (!hasWindow || !hasDocument) {
      renderPreviewFallbackNote(
        "プレビューの描画に失敗しました。ポップアップ印刷に切り替えました。",
        metaText
      );

      if (autoPrint && html) {
        const fallbackOpened = openPopupPrintWindow(html, title);
        if (!fallbackOpened) {
          window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
        }
      }
      return;
    }

    if (dom.printPreviewPrintButton) {
      dom.printPreviewPrintButton.disabled = false;
    }
    setPrintPreviewNote(
      autoPrint
        ? "プレビューを更新しました。印刷ダイアログを開きます。"
        : "プレビューを更新しました。画面右のボタンから印刷できます。"
    );

    try {
      if (title && dom.printPreviewFrame?.contentDocument) {
        dom.printPreviewFrame.contentDocument.title = title;
      }
    } catch (error) {
      // Ignore title assignment errors
    }

    if (participantPrintAutoPrintPending) {
      participantPrintAutoPrintPending = false;
      window.setTimeout(() => {
        printParticipantPreview({ showAlertOnFailure: true });
      }, 150);
    }
  };

  const handleError = () => {
    if (!settleLoad()) {
      return;
    }

    renderPreviewFallbackNote(
      "プレビューの読み込み中にエラーが発生しました。ポップアップ印刷に切り替えました。",
      metaText
    );

    if (autoPrint && html) {
      const fallbackOpened = openPopupPrintWindow(html, title);
      if (!fallbackOpened) {
        window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
      }
    }
  };

  dom.printPreviewFrame.addEventListener("load", handleLoad);
  dom.printPreviewFrame.addEventListener("error", handleError);
  participantPrintPreviewLoadAbort = { loadHandler: handleLoad, errorHandler: handleError };

  dom.printPreviewFrame.srcdoc = html || "<!doctype html><title>プレビュー</title>";

  const handleTimeout = () => {
    if (!settleLoad()) {
      return;
    }

    renderPreviewFallbackNote(
      "プレビューの読み込みがタイムアウトしました。ポップアップ印刷に切り替えました。",
      metaText
    );

    if (autoPrint && html) {
      const fallbackOpened = openPopupPrintWindow(html, title);
      if (!fallbackOpened) {
        window.alert("印刷用のポップアップを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
      }
    }
  };

  loadTimeoutId = window.setTimeout(handleTimeout, PRINT_PREVIEW_LOAD_TIMEOUT_MS);
  participantPrintPreviewLoadAbort.timeoutId = loadTimeoutId;
  return true;
}

function triggerPrintFromPreview() {
  if (!dom.printPreviewFrame) {
    return false;
  }
  const printWindow = dom.printPreviewFrame.contentWindow;
  if (!printWindow) {
    return false;
  }
  try {
    printWindow.focus();
    printWindow.print();
    return true;
  } catch (error) {
    return false;
  }
}

function printParticipantPreview({ showAlertOnFailure = false } = {}) {
  const cachedHtml = participantPrintPreviewCache?.html || "";
  const cachedTitle = participantPrintPreviewCache?.title || "";
  const cachedMeta = participantPrintPreviewCache?.metaText || "";

  if (cachedHtml) {
    renderPreviewFallbackNote("ブラウザの印刷ダイアログを新しいタブで開いています。", cachedMeta);

    const popupOpened = openPopupPrintWindow(cachedHtml, cachedTitle);
    if (popupOpened) {
      cacheParticipantPrintPreview({ ...participantPrintPreviewCache, forcePopupFallback: true });
      if (dom.printPreviewPrintButton) {
        dom.printPreviewPrintButton.dataset.popupFallback = "true";
      }
      return true;
    }
  }

  const printedInline = triggerPrintFromPreview();
  if (printedInline) {
    return true;
  }

  if (showAlertOnFailure) {
    window.alert("印刷を開始できませんでした。ブラウザのポップアップ設定をご確認ください。");
  }

  return false;
}

function closeParticipantPrintPreview() {
  resetPrintPreview();
}

async function updateParticipantPrintPreview({ autoPrint = false, forceReveal = false, quiet = false } = {}) {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    clearParticipantPrintPreviewLoader();
    if (dom.printPreview) {
      dom.printPreview.classList.remove("print-preview--fallback");
    }
    if (dom.printPreviewFrame) {
      dom.printPreviewFrame.srcdoc = "";
    }
    if (dom.printPreviewMeta) {
      dom.printPreviewMeta.textContent = "";
    }
    cacheParticipantPrintPreview({ forcePopupFallback: false });
    setPrintPreviewVisibility(true);
    setPrintPreviewNote("印刷するにはイベントと日程を選択してください。", {
      forceAnnounce: true,
      politeness: "assertive",
      role: "alert"
    });
    if (dom.printPreviewPrintButton) {
      dom.printPreviewPrintButton.disabled = true;
      delete dom.printPreviewPrintButton.dataset.popupFallback;
    }
    if (!quiet) {
      window.alert("印刷するにはイベントと日程を選択してください。");
    }
    return false;
  }

  if (!Array.isArray(state.participants) || state.participants.length === 0) {
    clearParticipantPrintPreviewLoader();
    if (dom.printPreview) {
      dom.printPreview.classList.remove("print-preview--fallback");
    }
    if (dom.printPreviewFrame) {
      dom.printPreviewFrame.srcdoc = "";
    }
    if (dom.printPreviewMeta) {
      dom.printPreviewMeta.textContent = "";
    }
    cacheParticipantPrintPreview({ forcePopupFallback: false });
    setPrintPreviewVisibility(true);
    setPrintPreviewNote("印刷できる参加者がまだ登録されていません。", {
      forceAnnounce: true,
      politeness: "assertive",
      role: "alert"
    });
    if (dom.printPreviewPrintButton) {
      dom.printPreviewPrintButton.disabled = true;
      delete dom.printPreviewPrintButton.dataset.popupFallback;
    }
    if (!quiet) {
      window.alert("印刷できる参加者がまだ登録されていません。");
    }
    return false;
  }

  if (participantPrintInProgress) {
    return false;
  }

  const button = dom.openPrintViewButton;
  participantPrintInProgress = true;

  if (button) {
    button.dataset.printLocked = "true";
    syncPrintViewButtonState();
  }

  if (forceReveal) {
    setPrintPreviewVisibility(true);
  }

  const printSettings = readPrintSettingsFromForm();
  persistPrintSettings(printSettings);

  try {
    setPrintButtonBusy(true);
    try {
      try {
        await loadGlDataForEvent(eventId);
      } catch (error) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error("[Print] GLデータの取得に失敗しました。最新の情報が反映されない場合があります。", error);
        }
      }

      const groups = buildParticipantPrintGroups({ eventId, scheduleId });
      if (!groups.length) {
        if (!quiet) {
          window.alert("印刷できる参加者がまだ登録されていません。");
        }
        return false;
      }

      const selectedEvent = state.events.find(evt => evt.id === eventId) || null;
      const schedule = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
      const eventName = selectedEvent?.name || "";
      const scheduleLabel = schedule?.label || "";
      const scheduleLocation = schedule?.location || schedule?.place || "";
      let startAt = schedule?.startAt || "";
      let endAt = schedule?.endAt || "";
      const scheduleDate = String(schedule?.date || "").trim();
      if (scheduleDate) {
        if (!startAt && schedule?.startTime) {
          startAt = combineDateAndTime(scheduleDate, schedule.startTime);
        }
        if (!endAt && schedule?.endTime) {
          endAt = combineDateAndTime(scheduleDate, schedule.endTime);
        }
      }
      const scheduleRange = formatPrintDateTimeRange(startAt, endAt);
      const totalCount = state.participants.length;
      const generatedAt = new Date();

      const html = buildParticipantPrintHtml({
        eventId,
        scheduleId,
        eventName,
        scheduleLabel,
        scheduleLocation,
        scheduleRange,
        groups,
        totalCount,
        generatedAt,
        printOptions: printSettings
      });

      const titleParts = [eventName || eventId || "", scheduleLabel || scheduleId || ""].filter(Boolean);
      const docTitle = titleParts.length ? `${titleParts.join(" / ")} - 参加者リスト` : "参加者リスト";

      const metaText = [eventName || eventId || "", scheduleLabel || scheduleId || "", `${totalCount}名`]
        .filter(text => String(text || "").trim())
        .join(" / ");

      cacheParticipantPrintPreview(
        { html, title: docTitle, metaText },
        { preserveFallbackFlag: true }
      );

      const previewRendered = renderParticipantPrintPreview({
        html,
        metaText,
        title: docTitle,
        autoPrint
      });

      if (participantPrintPreviewCache.forcePopupFallback) {
        return true;
      }

      if (!previewRendered) {
        renderPreviewFallbackNote(
          "プレビュー枠を開けませんでした。ポップアップ許可後に再度お試しください。",
          metaText
        );

        const fallbackOpened = openPopupPrintWindow(html, docTitle);
        if (!fallbackOpened) {
          window.alert("印刷プレビューを開けませんでした。ブラウザのポップアップ設定をご確認ください。");
          return false;
        }
      }
      return true;
    } finally {
      setPrintButtonBusy(false);
    }
  } finally {
    participantPrintInProgress = false;
    if (button) {
      delete button.dataset.printLocked;
    }
    syncPrintViewButtonState();
  }
}

async function openParticipantPrintView() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    window.alert("印刷するにはイベントと日程を選択してください。");
    return;
  }

  if (!Array.isArray(state.participants) || state.participants.length === 0) {
    window.alert("印刷できる参加者がまだ登録されていません。");
    return;
  }

  if (participantPrintInProgress) {
    return;
  }

  setPrintPreviewVisibility(true);
  applyPrintSettingsToForm(state.printSettings);
  await updateParticipantPrintPreview({ autoPrint: false, forceReveal: true });
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
  const team = String(entry.teamNumber || "").trim();
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
  const list = dom.eventList;
  if (!list) return;
  list.innerHTML = "";
  const totalEvents = state.events.length;

  if (!totalEvents) {
    if (dom.eventEmpty) dom.eventEmpty.hidden = false;
    return;
  }
  if (dom.eventEmpty) dom.eventEmpty.hidden = true;

  state.events.forEach(event => {
    const li = document.createElement("li");
    li.className = "entity-item" + (event.id === state.selectedEventId ? " is-active" : "");
    li.dataset.eventId = event.id;

    const label = document.createElement("div");
    label.className = "entity-label";
    const nameEl = document.createElement("span");
    nameEl.className = "entity-name";
    nameEl.textContent = event.name;
    const scheduleCount = event.schedules ? event.schedules.length : 0;
    const participantTotal = event.schedules
      ? event.schedules.reduce((acc, s) => acc + (s.participantCount || 0), 0)
      : 0;
    const metaEl = document.createElement("span");
    metaEl.className = "entity-meta";
    metaEl.textContent = `日程 ${scheduleCount} 件 / 参加者 ${participantTotal} 名`;
    label.append(nameEl, metaEl);

    const actions = document.createElement("div");
    actions.className = "entity-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-icon";
    editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
    editBtn.title = "イベントを編集";
    editBtn.addEventListener("click", evt => {
      evt.stopPropagation();
      openEventForm({ mode: "edit", event });
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-icon";
    deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
    deleteBtn.title = "イベントを削除";
    deleteBtn.addEventListener("click", eventObj => {
      eventObj.stopPropagation();
      handleDeleteEvent(event.id, event.name).catch(err => console.error(err));
    });
    actions.append(editBtn, deleteBtn);

    li.append(label, actions);
    li.addEventListener("click", () => selectEvent(event.id));
    list.appendChild(li);
  });
}

function renderSchedules() {
  const list = dom.scheduleList;
  if (!list) return;
  list.innerHTML = "";

  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  if (!selectedEvent) {
    if (dom.scheduleEmpty) dom.scheduleEmpty.hidden = true;
    if (dom.scheduleDescription) {
      dom.scheduleDescription.textContent = "イベントを選択すると、日程の一覧が表示されます。";
    }
    if (dom.addScheduleButton) dom.addScheduleButton.disabled = true;
    return;
  }

  if (dom.addScheduleButton) dom.addScheduleButton.disabled = false;
  if (dom.scheduleDescription) {
    dom.scheduleDescription.textContent = `イベント「${selectedEvent.name}」の日程を管理します。`;
  }

  if (!selectedEvent.schedules || !selectedEvent.schedules.length) {
    if (dom.scheduleEmpty) dom.scheduleEmpty.hidden = false;
    return;
  }
  if (dom.scheduleEmpty) dom.scheduleEmpty.hidden = true;

  selectedEvent.schedules.forEach(schedule => {
    const li = document.createElement("li");
    li.className = "entity-item" + (schedule.id === state.selectedScheduleId ? " is-active" : "");
    li.dataset.scheduleId = schedule.id;

    const label = document.createElement("div");
    label.className = "entity-label";
    const nameEl = document.createElement("span");
    nameEl.className = "entity-name";
    nameEl.textContent = schedule.label || schedule.id;
    const metaEl = document.createElement("span");
    metaEl.className = "entity-meta";
    const rangeText = describeScheduleRange(schedule);
    const metaParts = [];
    if (rangeText) metaParts.push(rangeText);
    metaParts.push(`参加者 ${schedule.participantCount || 0} 名`);
    metaEl.textContent = metaParts.join(" / ");
    label.append(nameEl, metaEl);

    const actions = document.createElement("div");
    actions.className = "entity-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-icon";
    editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
    editBtn.title = "日程を編集";
    editBtn.addEventListener("click", evt => {
      evt.stopPropagation();
      openScheduleForm({ mode: "edit", schedule });
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-icon";
    deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
    deleteBtn.title = "日程を削除";
    deleteBtn.addEventListener("click", evt => {
      evt.stopPropagation();
      handleDeleteSchedule(schedule.id, schedule.label).catch(err => console.error(err));
    });
    actions.append(editBtn, deleteBtn);

    li.append(label, actions);
    li.addEventListener("click", () => selectSchedule(schedule.id));
    list.appendChild(li);
  });

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
  syncPrintViewButtonState();
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
  syncPrintViewButtonState();
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
  if (!state.participants || !state.participants.length) {
    return 0;
  }
  return state.participants.filter(entry => isMailDeliveryPending(entry)).length;
}

let printActionButtonMissingLogged = false;

function syncPrintViewButtonState() {
  const button = dom.openPrintViewButton;
  if (!button) {
    if (!printActionButtonMissingLogged) {
      printActionButtonMissingLogged = true;
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[Print] open-print-view-button が見つからないため、印刷アクションの状態を同期できませんでした。");
      }
    }
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "印刷用リスト";
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
    const defaultLabel = button.dataset.defaultLabel || "印刷用リスト";
    if (button.textContent !== defaultLabel) {
      button.textContent = defaultLabel;
    }
    return;
  }

  const hasSelection = Boolean(state.selectedEventId && state.selectedScheduleId);
  const hasParticipants = hasSelection && state.participants.length > 0;
  const disabled = !hasSelection || !hasParticipants;

  setActionButtonState(button, disabled);

  if (disabled) {
    closeParticipantPrintPreview();
  }

  const baseLabel = button.dataset.defaultLabel || "印刷用リスト";
  if (button.textContent !== baseLabel) {
    button.textContent = baseLabel;
  }

}

function setPrintButtonBusy(isBusy) {
  const button = dom.openPrintViewButton;
  if (!button) return;
  if (isBusy) {
    button.dataset.printing = "true";
  } else {
    delete button.dataset.printing;
  }
  syncPrintViewButtonState();
}

const MAIL_LOG_PREFIX = "[Mail]";

function logMailInfo(message, details) {
  if (typeof console === "undefined") {
    return;
  }
  const log = typeof console.info === "function" ? console.info.bind(console) : console.log.bind(console);
  if (details !== undefined) {
    log(`${MAIL_LOG_PREFIX} ${message}`, details);
  } else {
    log(`${MAIL_LOG_PREFIX} ${message}`);
  }
}

function logMailWarn(message, details) {
  if (typeof console === "undefined") {
    return;
  }
  const log = typeof console.warn === "function" ? console.warn.bind(console) : console.log.bind(console);
  if (details !== undefined) {
    log(`${MAIL_LOG_PREFIX} ${message}`, details);
  } else {
    log(`${MAIL_LOG_PREFIX} ${message}`);
  }
}

function logMailError(message, error, details) {
  if (typeof console === "undefined") {
    return;
  }
  const log = typeof console.error === "function" ? console.error.bind(console) : console.log.bind(console);
  if (details !== undefined) {
    log(`${MAIL_LOG_PREFIX} ${message}`, error, details);
  } else if (error !== undefined) {
    log(`${MAIL_LOG_PREFIX} ${message}`, error);
  } else {
    log(`${MAIL_LOG_PREFIX} ${message}`);
  }
}

let mailActionButtonMissingLogged = false;
let lastMailActionStateSignature = "";

function syncMailActionState() {
  const button = dom.sendMailButton;
  if (!button) {
    if (!mailActionButtonMissingLogged) {
      mailActionButtonMissingLogged = true;
      logMailWarn("send-mail-button が見つからないため、メールアクションの状態を同期できませんでした。");
    }
    return;
  }
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent ? button.textContent.trim() : "参加者へ案内メール送信";
  }

  const hasSelection = Boolean(state.selectedEventId && state.selectedScheduleId);
  const hasParticipantsWithEmail = hasSelection
    ? state.participants.some(entry => String(entry?.email || "").trim())
    : false;
  const pendingCount = hasSelection ? getPendingMailCount() : 0;
  const disabled =
    state.mailSending ||
    state.saving ||
    !hasSelection ||
    !hasParticipantsWithEmail ||
    pendingCount === 0;

  setActionButtonState(button, disabled);

  if (state.mailSending) {
    button.textContent = "メール送信中…";
    button.setAttribute("aria-busy", "true");
  } else {
    const baseLabel = button.dataset.defaultLabel || "参加者へ案内メール送信";
    button.textContent = pendingCount > 0 ? `${baseLabel}（${pendingCount}件）` : baseLabel;
    button.removeAttribute("aria-busy");
  }

  button.dataset.pendingCount = String(pendingCount);

  const signature = JSON.stringify({
    hasSelection,
    hasParticipantsWithEmail,
    pendingCount,
    mailSending: state.mailSending,
    disabled
  });
  if (signature !== lastMailActionStateSignature) {
    lastMailActionStateSignature = signature;
    logMailInfo("メールアクションの状態を更新しました", {
      hasSelection,
      hasParticipantsWithEmail,
      pendingCount,
      mailSending: state.mailSending,
      disabled
    });
  }
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
  if (isHostAttached() && hostIntegration.controller) {
    try {
      if (typeof hostIntegration.controller.getEvents === "function") {
        const events = hostIntegration.controller.getEvents();
        applyHostEvents(events, { preserveSelection });
        return state.events;
      }
    } catch (error) {
      console.warn("Failed to retrieve host events", error);
    }
  }
  const previousEventId = preserveSelection ? state.selectedEventId : null;
  const previousScheduleId = preserveSelection ? state.selectedScheduleId : null;

  const [eventsBranch, schedulesBranch] = await Promise.all([
    fetchDbValue("questionIntake/events"),
    fetchDbValue("questionIntake/schedules")
  ]);

  const events = eventsBranch && typeof eventsBranch === "object" ? eventsBranch : {};
  const schedulesTree = schedulesBranch && typeof schedulesBranch === "object" ? schedulesBranch : {};

  const normalized = Object.entries(events).map(([eventId, eventValue]) => {
    const scheduleBranch = schedulesTree[eventId] && typeof schedulesTree[eventId] === "object"
      ? schedulesTree[eventId]
      : {};
    const scheduleList = Object.entries(scheduleBranch).map(([scheduleId, scheduleValue]) => ({
      id: String(scheduleId),
      label: String(scheduleValue?.label || ""),
      location: String(scheduleValue?.location || ""),
      date: String(scheduleValue?.date || ""),
      startAt: String(scheduleValue?.startAt || ""),
      endAt: String(scheduleValue?.endAt || ""),
      createdAt: scheduleValue?.createdAt || 0,
      updatedAt: scheduleValue?.updatedAt || 0,
      participantCount: Number(scheduleValue?.participantCount || 0)
    }));

    scheduleList.sort((a, b) => {
      const startDiff = toMillis(a.startAt || `${a.date}T00:00`) - toMillis(b.startAt || `${b.date}T00:00`);
      if (startDiff !== 0) return startDiff;
      const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return a.label.localeCompare(b.label, "ja", { numeric: true });
    });

    return {
      id: String(eventId),
      name: String(eventValue?.name || ""),
      createdAt: eventValue?.createdAt || 0,
      updatedAt: eventValue?.updatedAt || 0,
      schedules: scheduleList
    };
  });

  normalized.sort((a, b) => {
    const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return a.name.localeCompare(b.name, "ja", { numeric: true });
  });

  state.events = normalized;

  finalizeEventLoad({
    preserveSelection,
    previousEventId,
    previousScheduleId,
    preserveStatus: false
  });

  return state.events;
}

async function loadParticipants(options = {}) {
  const { statusMessage, statusVariant = "success", suppressStatus = false } = options || {};
  let eventId = state.selectedEventId ? String(state.selectedEventId) : "";
  let scheduleId = state.selectedScheduleId ? String(state.selectedScheduleId) : "";
  let selectionRecovered = false;

  if (!eventId || !scheduleId) {
    const hostSelection = readHostSelectionDataset(getHostSelectionElement());
    if (hostSelection) {
      const hostEventId = normalizeKey(hostSelection.eventId || "");
      const hostScheduleId = normalizeKey(hostSelection.scheduleId || "");
      if (hostEventId) {
        if (eventId !== hostEventId) {
          state.selectedEventId = hostEventId;
          eventId = hostEventId;
          selectionRecovered = true;
        }
        const matchedEvent = state.events.find(evt => evt.id === hostEventId) || null;
        if (matchedEvent && hostSelection.eventName) {
          matchedEvent.name = hostSelection.eventName;
        }
      }
      if (hostScheduleId && eventId && (!hostEventId || hostEventId === eventId)) {
        if (scheduleId !== hostScheduleId) {
          state.selectedScheduleId = hostScheduleId;
          scheduleId = hostScheduleId;
          selectionRecovered = true;
        }
        const parentEvent = state.events.find(evt => evt.id === eventId) || null;
        const scheduleRecord = parentEvent?.schedules?.find(s => s.id === hostScheduleId) || null;
        if (scheduleRecord) {
          if (hostSelection.scheduleLabel) scheduleRecord.label = hostSelection.scheduleLabel;
          if (hostSelection.location) scheduleRecord.location = hostSelection.location;
          if (hostSelection.startAt) scheduleRecord.startAt = hostSelection.startAt;
          if (hostSelection.endAt) scheduleRecord.endAt = hostSelection.endAt;
        }
      }
      if (eventId && scheduleId && state.scheduleContextOverrides instanceof Map) {
        const overrideKey = `${eventId}::${scheduleId}`;
        const selectedEvent = state.events.find(evt => evt.id === eventId) || null;
        const scheduleRecord = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
        if (!scheduleRecord) {
          const override = state.scheduleContextOverrides.get(overrideKey) || {};
          override.eventId = eventId;
          override.eventName = hostSelection.eventName || override.eventName || selectedEvent?.name || eventId;
          override.scheduleId = scheduleId;
          override.scheduleLabel = hostSelection.scheduleLabel || override.scheduleLabel || scheduleId;
          override.location = hostSelection.location || override.location || "";
          override.startAt = hostSelection.startAt || override.startAt || "";
          override.endAt = hostSelection.endAt || override.endAt || "";
          state.scheduleContextOverrides.set(overrideKey, override);
        }
      }
    }
  }

  state.selectedEventId = eventId || null;
  state.selectedScheduleId = scheduleId || null;
  state.mailSending = false;

  if (eventId) {
    loadGlDataForEvent(eventId).catch(error => console.error(error));
  }

  if (selectionRecovered) {
    renderEvents();
    renderSchedules();
    updateParticipantContext({ preserveStatus: true });
  }

  if (!eventId || !scheduleId) {
    state.participants = [];
    state.participantTokenMap = new Map();
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    captureParticipantBaseline([], { ready: false });
    renderParticipants();
    updateParticipantContext();
    syncSaveButtonState();
    syncMailActionState();
    emitParticipantSyncEvent({
      success: false,
      eventId,
      scheduleId,
      participantCount: 0,
      reason: "selection-missing"
    });
    return;
  }

  try {
    await ensureTokenSnapshot(false);
    // --- FIX 1: Load current schedule participants ONLY ---
    let scheduleBranch = await fetchDbValue(
      `questionIntake/participants/${eventId}/${scheduleId}`
    );
    scheduleBranch =
      scheduleBranch && typeof scheduleBranch === "object" ? scheduleBranch : {};
    // Temporarily set eventBranch to just this schedule's data
    let eventBranch = { [scheduleId]: scheduleBranch };
    let normalized = Object.entries(scheduleBranch)
      .map(([participantKey, participantValue]) =>
        normalizeParticipantRecord(participantValue, participantKey)
      )
      .filter(entry => resolveParticipantUid(entry));
    
    // This cache is now incomplete, containing only the current schedule.
    // We will populate it fully in the deferred step.
    if (!(state.eventParticipantCache instanceof Map)) {
      state.eventParticipantCache = new Map();
    }
    state.eventParticipantCache.set(eventId, normalizeEventParticipantCache(eventBranch));

    let participants = sortParticipants(normalized);
    const assignmentMap = getTeamAssignmentMap(eventId);
    if (assignmentMap?.size) {
      const applyResult = applyAssignmentsToEntries(participants, assignmentMap);
      participants = sortParticipants(applyResult.entries);
    }

    state.participants = participants;
    state.pendingRelocations = new Map();
    state.relocationDraftOriginals = new Map();
    captureParticipantBaseline(participants);
    state.participantTokenMap = new Map(
      state.participants.map(entry => {
        const key = resolveParticipantUid(entry) || String(entry.participantId || "").trim();
        return [key, entry.token];
      }).filter(([key]) => Boolean(key))
    );
    state.participantTokenMap.forEach(token => {
      if (token) {
        state.knownTokens.add(token);
      }
    });
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    const overrideKey = eventId && scheduleId ? `${eventId}::${scheduleId}` : "";
    const override = overrideKey && state.scheduleContextOverrides instanceof Map
      ? state.scheduleContextOverrides.get(overrideKey)
      : null;
    const selectedEvent = state.events.find(evt => evt.id === eventId) || null;
    const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === scheduleId) || null;
    const scheduleLabel = selectedSchedule?.label || override?.scheduleLabel || scheduleId;
    const eventName = selectedEvent?.name || override?.eventName || eventId;
    const scheduleRange = selectedSchedule
      ? describeScheduleRange(selectedSchedule)
      : override
        ? describeScheduleRange({
            id: scheduleId,
            label: scheduleLabel,
            startAt: override.startAt || "",
            endAt: override.endAt || "",
            date: override.date || (override.startAt ? String(override.startAt).slice(0, 10) : "")
          })
        : "";
    if (selectedSchedule) {
      selectedSchedule.participantCount = participants.length;
    }
    syncCurrentScheduleCache();
    if (dom.fileLabel) dom.fileLabel.textContent = "参加者CSVをアップロード";
    if (dom.teamFileLabel) dom.teamFileLabel.textContent = "班番号CSVをアップロード";
    if (dom.csvInput) dom.csvInput.value = "";
    if (!suppressStatus) {
      const defaultMessage = "現在の参加者リストを読み込みました。";
      setUploadStatus(statusMessage || defaultMessage, statusVariant);
    }

    // --- FIX 2: Defer duplicate check ---
    // Render the participant list immediately
    renderParticipants();

    // Now, load the full event data in the background for the duplicate check
    setTimeout(() => {
      if (state.selectedEventId !== eventId) return; // Abort if user navigated away
      fetchDbValue(`questionIntake/participants/${eventId}`).then(eventBranchRaw => {
        if (!eventBranchRaw || typeof eventBranchRaw !== "object" || state.selectedEventId !== eventId) {
          return;
        }
        // Now populate the cache with the FULL event data
        state.eventParticipantCache.set(eventId, normalizeEventParticipantCache(eventBranchRaw));
        // And NOW run the expensive duplicate check
        updateDuplicateMatches();
        // Re-render to show duplicate icons
        renderParticipants();
      }).catch(err => {
        console.warn("Background duplicate check failed:", err);
      });
    }, 100); // 100ms delay to ensure UI is responsive
    updateParticipantContext({ preserveStatus: true });
    syncSaveButtonState();
    emitParticipantSyncEvent({
      success: true,
      eventId,
      scheduleId,
      participantCount: participants.length,
      eventName,
      scheduleLabel,
      scheduleRange
    });
  } catch (error) {
    console.error(error);
    state.participants = [];
    state.participantTokenMap = new Map();
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    state.mailSending = false;
    captureParticipantBaseline([], { ready: false });
    setUploadStatus(error.message || "参加者リストの読み込みに失敗しました。", "error");
    renderParticipants();
    updateParticipantContext();
    syncSaveButtonState();
    syncMailActionState();
    emitParticipantSyncEvent({
      success: false,
      eventId,
      scheduleId,
      participantCount: 0,
      error: error.message || "参加者リストの読み込みに失敗しました。"
    });
  }
}

function selectEvent(eventId, options = {}) {
  const {
    nextScheduleId = null,
    skipContextUpdate = false,
    skipParticipantLoad = false,
    source = getSelectionBroadcastSource()
  } = options || {};

  const previousEventId = state.selectedEventId;
  const preservingScheduleId = nextScheduleId ? String(nextScheduleId) : null;

  if (previousEventId === eventId) {
    let scheduleHandled = false;
    if (preservingScheduleId && state.selectedScheduleId !== preservingScheduleId) {
      selectSchedule(preservingScheduleId, {
        preserveStatus: Boolean(preservingScheduleId),
        suppressParticipantLoad: skipParticipantLoad,
        source
      });
      scheduleHandled = true;
    } else {
      broadcastSelectionChange({ source });
    }
    if (!skipContextUpdate && !scheduleHandled) {
      updateParticipantContext({ preserveStatus: Boolean(preservingScheduleId) });
    }
    return;
  }

  state.selectedEventId = eventId;
  state.selectedScheduleId = preservingScheduleId;
  setCalendarPickedDate("", { updateInput: true });
  state.participants = [];
  state.participantTokenMap = new Map();
  state.duplicateMatches = new Map();
  state.duplicateGroups = new Map();
  captureParticipantBaseline([], { ready: false });
  if (state.eventParticipantCache instanceof Map && previousEventId) {
    state.eventParticipantCache.delete(previousEventId);
  }
  renderEvents();
  renderSchedules();
  renderParticipants();
  loadGlDataForEvent(eventId).catch(error => console.error(error));

  if (!skipContextUpdate) {
    updateParticipantContext({ preserveStatus: Boolean(preservingScheduleId) });
  } else {
    syncTemplateButtons();
    syncClearButtonState();
  }

  if (!skipParticipantLoad && !preservingScheduleId) {
    loadParticipants().catch(err => console.error(err));
  }

  broadcastSelectionChange({ source });
}

function selectSchedule(scheduleId, options = {}) {
  const {
    preserveStatus = false,
    suppressParticipantLoad = false,
    forceReload = false,
    source = getSelectionBroadcastSource()
  } = options || {};

  const normalizedId = scheduleId ? String(scheduleId) : null;
  const previousScheduleId = state.selectedScheduleId;
  const shouldReload = forceReload || previousScheduleId !== normalizedId;

  state.selectedScheduleId = normalizedId;
  queueRelocationPrompt([], { replace: true });

  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  const schedule = normalizedId ? selectedEvent?.schedules?.find(s => s.id === normalizedId) : null;
  if (schedule) {
    const primaryDate = getSchedulePrimaryDate(schedule);
    if (primaryDate) {
      setCalendarPickedDate(formatDatePart(primaryDate), { updateInput: true });
    }
  } else if (!normalizedId) {
    setCalendarPickedDate("", { updateInput: true });
  }

  renderSchedules();

  if (!normalizedId) {
    state.participants = [];
    state.participantTokenMap = new Map();
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    captureParticipantBaseline([], { ready: false });
    renderParticipants();
    syncSaveButtonState();
  } else if (shouldReload) {
    captureParticipantBaseline([], { ready: false });
  }

  updateParticipantContext({ preserveStatus });

  const needsParticipantLoad = Boolean(
    normalizedId &&
    !suppressParticipantLoad &&
    (shouldReload || !state.participantBaselineReady)
  );

  if (needsParticipantLoad) {
    loadParticipants().catch(err => console.error(err));
  }

  broadcastSelectionChange({ source });
}

function resolveScheduleFormValues({ label, location, date, startTime, endTime }) {
  const trimmedLabel = normalizeKey(label || "");
  if (!trimmedLabel) {
    throw new Error("日程の表示名を入力してください。");
  }

  const normalizedLocation = String(location || "").trim();

  const normalizedDate = normalizeDateInputValue(date);
  if (!normalizedDate) {
    throw new Error("日付を入力してください。");
  }

  const startTimeValue = String(startTime || "").trim();
  const endTimeValue = String(endTime || "").trim();
  if (!startTimeValue || !endTimeValue) {
    throw new Error("開始と終了の時刻を入力してください。");
  }

  const startValueText = combineDateAndTime(normalizedDate, startTimeValue);
  const endValueText = combineDateAndTime(normalizedDate, endTimeValue);
  let startDate = parseDateTimeLocal(startValueText);
  let endDate = parseDateTimeLocal(endValueText);
  if (!startDate || !endDate) {
    throw new Error("開始・終了時刻の形式が正しくありません。");
  }

  if (endDate <= startDate) {
    endDate = new Date(endDate.getTime() + MS_PER_DAY);
  }

  const startValue = formatDateTimeLocal(startDate);
  const endValue = formatDateTimeLocal(endDate);

  return {
    label: trimmedLabel,
    location: normalizedLocation,
    date: normalizedDate,
    startValue,
    endValue,
    startTimeValue,
    endTimeValue
  };
}

function openEventForm({ mode = "create", event = null } = {}) {
  if (!dom.eventForm) return;
  dom.eventForm.reset();
  dom.eventForm.dataset.mode = mode;
  dom.eventForm.dataset.eventId = event?.id || "";
  setFormError(dom.eventError);
  if (dom.eventDialogTitle) {
    dom.eventDialogTitle.textContent = mode === "edit" ? "イベントを編集" : "イベントを追加";
  }
  if (dom.eventNameInput) {
    dom.eventNameInput.value = mode === "edit" ? String(event?.name || "") : "";
  }
  const submitButton = dom.eventForm.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.textContent = mode === "edit" ? "保存" : "追加";
  }
  openDialog(dom.eventDialog);
}

function openScheduleForm({ mode = "create", schedule = null } = {}) {
  if (!dom.scheduleForm) return;
  dom.scheduleForm.reset();
  dom.scheduleForm.dataset.mode = mode;
  dom.scheduleForm.dataset.scheduleId = schedule?.id || "";
  setFormError(dom.scheduleError);
  if (dom.scheduleDialogTitle) {
    dom.scheduleDialogTitle.textContent = mode === "edit" ? "日程を編集" : "日程を追加";
  }
  const submitButton = dom.scheduleForm.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.textContent = mode === "edit" ? "保存" : "追加";
  }

  populateScheduleLocationOptions(schedule?.location || "");

  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  if (mode === "edit" && schedule) {
    if (dom.scheduleLabelInput) dom.scheduleLabelInput.value = schedule.label || "";
    if (dom.scheduleLocationInput) dom.scheduleLocationInput.value = schedule.location || "";
    const dateValue = schedule.date || (schedule.startAt ? String(schedule.startAt).slice(0, 10) : "");
    if (dom.scheduleDateInput) dom.scheduleDateInput.value = normalizeDateInputValue(dateValue);
    const startTime = schedule.startAt ? String(schedule.startAt).slice(11, 16) : "";
    const endTime = schedule.endAt ? String(schedule.endAt).slice(11, 16) : "";
    if (dom.scheduleStartTimeInput) dom.scheduleStartTimeInput.value = startTime;
    if (dom.scheduleEndTimeInput) dom.scheduleEndTimeInput.value = endTime;
    setCalendarPickedDate(dom.scheduleDateInput?.value || dateValue || "", { updateInput: true });
  } else {
    if (dom.scheduleLabelInput) {
      dom.scheduleLabelInput.value = selectedEvent?.name ? `${selectedEvent.name}` : "";
    }
    if (dom.scheduleLocationInput) {
      dom.scheduleLocationInput.value = "";
    }
    if (dom.scheduleDateInput) {
      dom.scheduleDateInput.value = calendarState.pickedDate || "";
    }
    setCalendarPickedDate(dom.scheduleDateInput?.value || calendarState.pickedDate || "", { updateInput: true });
  }

  const initialDateValue = dom.scheduleDateInput?.value || calendarState.pickedDate || "";
  prepareScheduleDialogCalendar(initialDateValue);
  if (dom.scheduleEndTimeInput) {
    dom.scheduleEndTimeInput.min = dom.scheduleStartTimeInput?.value || "";
  }
  syncScheduleEndMin();
  openDialog(dom.scheduleDialog);
}

async function handleAddEvent(name) {
  const trimmed = normalizeKey(name || "");
  if (!trimmed) {
    throw new Error("イベント名を入力してください。");
  }

  try {
    const now = Date.now();
    let eventId = generateShortId("evt_");
    const existingIds = new Set(state.events.map(evt => evt.id));
    while (existingIds.has(eventId)) {
      eventId = generateShortId("evt_");
    }

    await set(rootDbRef(`questionIntake/events/${eventId}`), {
      name: trimmed,
      createdAt: now,
      updatedAt: now
    });

    await loadEvents({ preserveSelection: false });
    selectEvent(eventId);
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "イベントの追加に失敗しました。");
  }
}

async function handleUpdateEvent(eventId, name) {
  const trimmed = normalizeKey(name || "");
  if (!trimmed) {
    throw new Error("イベント名を入力してください。");
  }
  if (!eventId) {
    throw new Error("イベントIDが不明です。");
  }

  try {
    const now = Date.now();
    await update(rootDbRef(), {
      [`questionIntake/events/${eventId}/name`]: trimmed,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });
    await loadEvents({ preserveSelection: true });
    selectEvent(eventId);
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "イベントの更新に失敗しました。");
  }
}

async function handleDeleteEvent(eventId, eventName) {
  const label = eventName || eventId;
  const confirmed = await confirmAction({
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
    const participantBranch = await fetchDbValue(`questionIntake/participants/${eventId}`);
    const tokensToRemove = collectParticipantTokens(participantBranch);

    const updates = {
      [`questionIntake/events/${eventId}`]: null,
      [`questionIntake/schedules/${eventId}`]: null,
      [`questionIntake/participants/${eventId}`]: null
    };

    tokensToRemove.forEach(token => {
      updates[`questionIntake/tokens/${token}`] = null;
      if (token) {
        state.knownTokens.delete(token);
        delete state.tokenRecords[token];
      }
    });

    await update(rootDbRef(), updates);

    if (state.selectedEventId === eventId) {
      state.selectedEventId = null;
      state.selectedScheduleId = null;
      state.participants = [];
      state.participantTokenMap = new Map();
      state.duplicateMatches = new Map();
      state.duplicateGroups = new Map();
      captureParticipantBaseline([], { ready: false });
    }

    if (state.eventParticipantCache instanceof Map) {
      state.eventParticipantCache.delete(eventId);
    }

    if (state.teamAssignments instanceof Map) {
      state.teamAssignments.delete(eventId);
    }

    await loadEvents({ preserveSelection: false });
    renderParticipants();
    updateParticipantContext();
    state.tokenSnapshotFetchedAt = Date.now();
    setUploadStatus(`イベント「${label}」を削除しました。`, "success");
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "イベントの削除に失敗しました。", "error");
  }
}

async function handleAddSchedule({ label, location, date, startTime, endTime }) {
  const eventId = state.selectedEventId;
  if (!eventId) {
    throw new Error("イベントを選択してください。");
  }

  const { label: trimmedLabel, location: normalizedLocation, date: normalizedDate, startValue, endValue } = resolveScheduleFormValues({
    label,
    location,
    date,
    startTime,
    endTime
  });

  try {
    const now = Date.now();
    const event = state.events.find(evt => evt.id === eventId);
    const existingSchedules = new Set((event?.schedules || []).map(schedule => schedule.id));
    let scheduleId = generateShortId("sch_");
    while (existingSchedules.has(scheduleId)) {
      scheduleId = generateShortId("sch_");
    }

    await update(rootDbRef(), {
      [`questionIntake/schedules/${eventId}/${scheduleId}`]: {
        label: trimmedLabel,
        location: normalizedLocation,
        date: normalizedDate,
        startAt: startValue,
        endAt: endValue,
        participantCount: 0,
        createdAt: now,
        updatedAt: now
      },
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });

    await loadEvents({ preserveSelection: true });
    selectEvent(eventId);
    selectSchedule(scheduleId);
    setCalendarPickedDate(normalizedDate, { updateInput: true });
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "日程の追加に失敗しました。");
  }
}

async function handleUpdateSchedule(scheduleId, { label, location, date, startTime, endTime }) {
  const eventId = state.selectedEventId;
  if (!eventId) {
    throw new Error("イベントを選択してください。");
  }
  if (!scheduleId) {
    throw new Error("日程IDが不明です。");
  }

  const { label: trimmedLabel, location: normalizedLocation, date: normalizedDate, startValue, endValue } = resolveScheduleFormValues({
    label,
    location,
    date,
    startTime,
    endTime
  });

  try {
    const now = Date.now();
    await update(rootDbRef(), {
      [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: trimmedLabel,
      [`questionIntake/schedules/${eventId}/${scheduleId}/location`]: normalizedLocation,
      [`questionIntake/schedules/${eventId}/${scheduleId}/date`]: normalizedDate,
      [`questionIntake/schedules/${eventId}/${scheduleId}/startAt`]: startValue,
      [`questionIntake/schedules/${eventId}/${scheduleId}/endAt`]: endValue,
      [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });

    await loadEvents({ preserveSelection: true });
    selectEvent(eventId);
    selectSchedule(scheduleId);
    setCalendarPickedDate(normalizedDate, { updateInput: true });
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "日程の更新に失敗しました。");
  }
}

async function handleDeleteSchedule(scheduleId, scheduleLabel) {
  const eventId = state.selectedEventId;
  if (!eventId) return;
  const label = scheduleLabel || scheduleId;
  const confirmed = await confirmAction({
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
    const participantBranch = await fetchDbValue(`questionIntake/participants/${eventId}/${scheduleId}`);
    const tokensToRemove = new Set();
    if (participantBranch && typeof participantBranch === "object") {
      Object.values(participantBranch).forEach(entry => {
        const token = entry?.token;
        if (token) tokensToRemove.add(String(token));
      });
    }

    const now = Date.now();
    const updates = {
      [`questionIntake/schedules/${eventId}/${scheduleId}`]: null,
      [`questionIntake/participants/${eventId}/${scheduleId}`]: null,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    };

    tokensToRemove.forEach(token => {
      updates[`questionIntake/tokens/${token}`] = null;
      state.knownTokens.delete(token);
      delete state.tokenRecords[token];
    });

    await update(rootDbRef(), updates);

    if (state.selectedScheduleId === scheduleId) {
      state.selectedScheduleId = null;
      state.participants = [];
      state.participantTokenMap = new Map();
      state.duplicateMatches = new Map();
      state.duplicateGroups = new Map();
      captureParticipantBaseline([], { ready: false });
    }

    if (state.eventParticipantCache instanceof Map) {
      const cache = state.eventParticipantCache.get(eventId);
      if (cache && typeof cache === "object") {
        delete cache[scheduleId];
        state.eventParticipantCache.set(eventId, cache);
      }
    }

    await loadEvents({ preserveSelection: true });
    renderParticipants();
    updateParticipantContext();
    state.tokenSnapshotFetchedAt = Date.now();
    setUploadStatus(`日程「${label}」を削除しました。`, "success");
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "日程の削除に失敗しました。", "error");
  }
}

async function handleCsvChange(event) {
  const files = event.target.files;
  if (!files || !files.length) {
    return;
  }

  const file = files[0];
  const { eventId, scheduleId } = getSelectionIdentifiers();

  try {
    if (!eventId || !scheduleId) {
      throw new Error(getSelectionRequiredMessage());
    }

    const expectedName = buildParticipantCsvFilename(eventId, scheduleId);
    if (file.name !== expectedName) {
      throw new Error(`ファイル名が一致しません。${expectedName} をアップロードしてください。`);
    }

    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    const parsedEntries = parseParticipantRows(rows);
    const sortedEntries = parsedEntries.slice().sort((a, b) => {
      const deptA = String(a.department || "");
      const deptB = String(b.department || "");
      const deptCompare = deptA.localeCompare(deptB, "ja", { sensitivity: "base", numeric: true });
      if (deptCompare !== 0) return deptCompare;
      const phoneticA = String(a.phonetic || a.furigana || a.name || "");
      const phoneticB = String(b.phonetic || b.furigana || b.name || "");
      const phoneticCompare = phoneticA.localeCompare(phoneticB, "ja", { sensitivity: "base", numeric: true });
      if (phoneticCompare !== 0) return phoneticCompare;
      return String(a.name || "").localeCompare(String(b.name || ""), "ja", { sensitivity: "base", numeric: true });
    });
    const entries = assignParticipantIds(
      sortedEntries,
      state.participants,
      { eventId: state.selectedEventId, scheduleId: state.selectedScheduleId }
    );
    const existingMap = new Map(
      state.participants
        .map(entry => {
          const key = resolveParticipantUid(entry) || entry.participantId || entry.id;
          return key ? [key, entry] : null;
        })
        .filter(Boolean)
    );
    state.participants = sortParticipants(
      entries.map(entry => {
        const uid = resolveParticipantUid(entry) || entry.participantId;
        const entryKey = uid;
        const existing = entryKey ? existingMap.get(entryKey) || {} : {};
        const department = entry.department || existing.department || "";
        const teamNumber = entry.teamNumber || existing.teamNumber || existing.groupNumber || "";
        const phonetic = entry.phonetic || entry.furigana || existing.phonetic || existing.furigana || "";
        const status = resolveParticipantStatus({ ...existing, ...entry, teamNumber }, teamNumber) || existing.status || "active";
        const legacyParticipantId = existing.legacyParticipantId || (existing.participantId && existing.participantId !== uid ? existing.participantId : "");
        return {
          participantId: uid,
          uid,
          legacyParticipantId,
          name: entry.name || existing.name || "",
          phonetic,
          furigana: phonetic,
          gender: entry.gender || existing.gender || "",
          department,
          groupNumber: teamNumber,
          teamNumber,
          phone: entry.phone || existing.phone || "",
          email: entry.email || existing.email || "",
          token: existing.token || "",
          guidance: existing.guidance || "",
          status,
          isCancelled: status === "cancelled",
          isRelocated: status === "relocated"
        };
      })
    );
    syncCurrentScheduleCache();
    updateDuplicateMatches();
    if (dom.fileLabel) dom.fileLabel.textContent = file.name;
    renderParticipants();
    const relocationCandidates = state.participants
      .filter(entry => {
        const teamValue = String(entry.teamNumber || entry.groupNumber || "");
        return resolveParticipantStatus(entry, teamValue) === "relocated";
      })
      .map(entry => ({ participantId: entry.participantId || "", rowKey: entry.rowKey || "" }));
    queueRelocationPrompt(relocationCandidates, { replace: true });
    const signature = signatureForEntries(state.participants);
    if (signature === state.lastSavedSignature) {
      if (dom.saveButton) dom.saveButton.disabled = true;
      setUploadStatus("既存のデータと同じ内容です。", "success");
    } else {
      if (dom.saveButton) dom.saveButton.disabled = false;
      setUploadStatus(`読み込み成功: ${state.participants.length}名`, "success");
    }
    updateParticipantActionPanelState();
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "CSVの読み込みに失敗しました。", "error");
  } finally {
    if (dom.csvInput) {
      dom.csvInput.value = "";
    }
  }
}

async function handleTeamCsvChange(event) {
  const files = event.target.files;
  if (!files || !files.length) {
    return;
  }

  const file = files[0];
  const { eventId, scheduleId } = getSelectionIdentifiers();

  try {
    if (!eventId || !scheduleId) {
      throw new Error(getSelectionRequiredMessage());
    }

    const expectedName = buildTeamCsvFilename(eventId, scheduleId);
    if (file.name !== expectedName) {
      throw new Error(`ファイル名が一致しません。${expectedName} をアップロードしてください。`);
    }

    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    const assignments = parseTeamAssignmentRows(rows);
    const eventAssignmentMap = ensureTeamAssignmentMap(eventId);
    const currentMapMatches = applyAssignmentsToEntries(state.participants, assignments);

    assignments.forEach((teamNumber, participantId) => {
      if (eventAssignmentMap) {
        eventAssignmentMap.set(participantId, teamNumber);
      }
    });

    const aggregateMap = eventAssignmentMap || assignments;
    const applyResult = applyAssignmentsToEntries(state.participants, aggregateMap);
    state.participants = sortParticipants(applyResult.entries);
    syncCurrentScheduleCache();
    const cacheMatched = applyAssignmentsToEventCache(eventId, aggregateMap);
    updateDuplicateMatches();
    renderParticipants();
    syncSaveButtonState();

    if (dom.teamFileLabel) {
      dom.teamFileLabel.textContent = file.name;
    }

    const matchedIds = currentMapMatches.matchedIds || new Set();
    const updatedIds = currentMapMatches.updatedIds || new Set();
    const allMatched = new Set([...(matchedIds || []), ...(cacheMatched || [])]);
    const unmatchedCount = Math.max(assignments.size - allMatched.size, 0);
    const summaryParts = [];
    summaryParts.push(`班番号を照合: ${allMatched.size}名`);
    summaryParts.push(`変更: ${updatedIds.size}件`);
    if (unmatchedCount > 0) {
      summaryParts.push(`未一致: ${unmatchedCount}名`);
    }
    setUploadStatus(summaryParts.join(" / "), "success");
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "班番号CSVの読み込みに失敗しました。", "error");
  } finally {
    if (dom.teamCsvInput) {
      dom.teamCsvInput.value = "";
    }
  }
}

function downloadParticipantTemplate() {
  const { eventId, scheduleId } = getSelectionIdentifiers();
  if (!eventId || !scheduleId) {
    setUploadStatus(getSelectionRequiredMessage("参加者CSVテンプレをダウンロードするには"), "error");
    return;
  }

  const filename = buildParticipantCsvFilename(eventId, scheduleId);
  downloadCsvFile(filename, [PARTICIPANT_TEMPLATE_HEADERS]);
  setUploadStatus(`${filename} をダウンロードしました。`, "success");
}

function downloadTeamTemplate() {
  const { eventId, scheduleId } = getSelectionIdentifiers();
  if (!eventId || !scheduleId) {
    setUploadStatus(getSelectionRequiredMessage("班番号CSVテンプレをダウンロードするには"), "error");
    return;
  }

  const rows = sortParticipants(state.participants)
    .filter(entry => resolveParticipantUid(entry))
    .map(entry => [
      String(entry.department || ""),
      String(entry.gender || ""),
      String(entry.name || ""),
      String(entry.teamNumber || entry.groupNumber || ""),
      resolveParticipantUid(entry)
    ]);

  if (!rows.length) {
    setUploadStatus("テンプレに出力できる参加者が見つかりません。参加者リストを読み込んでからお試しください。", "error");
    return;
  }

  const filename = buildTeamCsvFilename(eventId, scheduleId);
  downloadCsvFile(filename, [TEAM_TEMPLATE_HEADERS, ...rows]);
  setUploadStatus(`${filename} をダウンロードしました。（${rows.length}名）`, "success");
}

async function handleSave(options = {}) {
  const { allowEmpty = false, successMessage = "参加者リストを更新しました。" } = options || {};
  if (state.saving) return;
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) return;
  const savingEmptyList = state.participants.length === 0;
  const hasPendingChanges = hasUnsavedChanges();

  if (!allowEmpty && savingEmptyList && !hasPendingChanges) {
    setUploadStatus("適用する参加者がありません。", "error");
    return false;
  }

  state.saving = true;
  if (dom.saveButton) dom.saveButton.disabled = true;
  syncSaveButtonState();
  setUploadStatus("適用中です…");
  syncClearButtonState();

  try {
    await ensureTokenSnapshot(true);
    const event = state.events.find(evt => evt.id === eventId);
    if (!event) {
      throw new Error("選択中のイベントが見つかりません。");
    }
    const schedule = event.schedules.find(s => s.id === scheduleId);
    if (!schedule) {
      throw new Error("選択中の日程が見つかりません。");
    }

    const scheduleDateText = schedule.date || (schedule.startAt ? String(schedule.startAt).slice(0, 10) : "");
    const scheduleStartAt = schedule.startAt || "";
    const scheduleEndAt = schedule.endAt || "";
    const scheduleLocationText = schedule.location || "";

    const now = Date.now();
    const previousTokens = new Map(state.participantTokenMap || []);
    const tokensToRemove = new Set(previousTokens.values());
    const participantsPayload = {};
    const nextTokenMap = new Map();
    const knownTokens = state.knownTokens instanceof Set ? state.knownTokens : new Set();
    const tokenRecords = state.tokenRecords || {};
    state.tokenRecords = tokenRecords;

    state.participants.forEach(entry => {
      const uid = resolveParticipantUid(entry);
      const participantId = uid || String(entry.participantId || "").trim();
      if (!participantId) return;

      let token = String(entry.token || "").trim();
      const previousToken = previousTokens.get(participantId) || "";
      if (previousToken) {
        tokensToRemove.delete(previousToken);
      }

      if (!token || (token !== previousToken && knownTokens.has(token))) {
        token = generateQuestionToken(knownTokens);
      } else if (!knownTokens.has(token)) {
        knownTokens.add(token);
      }

      entry.token = token;
      nextTokenMap.set(participantId, token);

      const guidance = String(entry.guidance || "");
      const departmentValue = String(entry.department || "");
      const storedDepartment = departmentValue;
      const teamNumber = String(entry.teamNumber || entry.groupNumber || "");
      const status = entry.status || resolveParticipantStatus(entry, teamNumber) || "active";
      const isCancelled = entry.isCancelled === true || status === "cancelled";
      const isRelocated = entry.isRelocated === true || status === "relocated";
      const legacyIdRaw = String(entry.legacyParticipantId || "").trim();
      const legacyParticipantId = legacyIdRaw && legacyIdRaw !== participantId ? legacyIdRaw : "";
      const mailStatus = String(entry.mailStatus || "");
      const mailSentAtValue = Number(entry.mailSentAt || 0);
      const mailSentAt = Number.isFinite(mailSentAtValue) && mailSentAtValue >= 0 ? mailSentAtValue : 0;
      const mailError = String(entry.mailError || "");
      const mailLastSubject = String(entry.mailLastSubject || "");
      const mailLastMessageId = String(entry.mailLastMessageId || "");
      const mailSentBy = String(entry.mailSentBy || "");
      const mailLastAttemptAtValue = Number(entry.mailLastAttemptAt || 0);
      const mailLastAttemptAt =
        Number.isFinite(mailLastAttemptAtValue) && mailLastAttemptAtValue >= 0
          ? mailLastAttemptAtValue
          : 0;
      const mailLastAttemptBy = String(entry.mailLastAttemptBy || "");

      participantsPayload[participantId] = {
        participantId,
        uid: participantId,
        legacyParticipantId,
        name: String(entry.name || ""),
        phonetic: String(entry.phonetic || entry.furigana || ""),
        furigana: String(entry.phonetic || entry.furigana || ""),
        gender: String(entry.gender || ""),
        department: storedDepartment,
        groupNumber: teamNumber,
        teamNumber,
        phone: String(entry.phone || ""),
        email: String(entry.email || ""),
        token,
        guidance,
        status,
        isCancelled,
        isRelocated,
        relocationSourceScheduleId: String(entry.relocationSourceScheduleId || ""),
        relocationSourceScheduleLabel: String(entry.relocationSourceScheduleLabel || ""),
        relocationDestinationScheduleId: String(entry.relocationDestinationScheduleId || ""),
        relocationDestinationScheduleLabel: String(entry.relocationDestinationScheduleLabel || ""),
        relocationDestinationTeamNumber: String(entry.relocationDestinationTeamNumber || ""),
        mailStatus,
        mailSentAt,
        mailError,
        mailLastSubject,
        mailLastMessageId,
        mailSentBy,
        mailLastAttemptAt,
        mailLastAttemptBy,
        updatedAt: now
      };

      const existingTokenRecord = tokenRecords[token] || {};
      tokenRecords[token] = {
        eventId,
        eventName: event.name || existingTokenRecord.eventName || "",
        scheduleId,
        scheduleLabel: schedule.label || existingTokenRecord.scheduleLabel || "",
        scheduleLocation: scheduleLocationText || existingTokenRecord.scheduleLocation || "",
        scheduleDate: scheduleDateText || existingTokenRecord.scheduleDate || "",
        scheduleStart: scheduleStartAt || existingTokenRecord.scheduleStart || "",
        scheduleEnd: scheduleEndAt || existingTokenRecord.scheduleEnd || "",
        participantId,
        participantUid: participantId,
        displayName: String(entry.name || ""),
        groupNumber: teamNumber,
        teamNumber,
        guidance: guidance || existingTokenRecord.guidance || "",
        revoked: false,
        createdAt: existingTokenRecord.createdAt || now,
        updatedAt: now
      };
    });

    const relocationMap = ensurePendingRelocationMap();
    const relocationsToProcess = [];
    if (relocationMap instanceof Map) {
      relocationMap.forEach(relocation => {
        if (relocation && relocation.eventId === eventId && relocation.fromScheduleId === scheduleId) {
          relocationsToProcess.push(relocation);
        }
      });
    }

    const additionalUpdates = [];
    const processedRelocations = [];
    const questionsByParticipant = new Map();
    let questionStatusBranch = {};

    if (relocationsToProcess.length) {
      try {
        const fetchedQuestions = await fetchDbValue("questions/normal");
        if (fetchedQuestions && typeof fetchedQuestions === "object") {
          Object.entries(fetchedQuestions).forEach(([questionUid, record]) => {
            if (!record || typeof record !== "object") return;
            const participantKey = String(record.participantId || "");
            if (!participantKey) return;
            if (!questionsByParticipant.has(participantKey)) {
              questionsByParticipant.set(participantKey, []);
            }
            questionsByParticipant.get(participantKey).push({ questionUid, record });
          });
        }
      } catch (error) {
        console.warn("質問データの取得に失敗しました", error);
      }

      try {
        const fetchedStatuses = await fetchDbValue("questionStatus");
        if (fetchedStatuses && typeof fetchedStatuses === "object") {
          questionStatusBranch = fetchedStatuses;
        }
      } catch (error) {
        console.warn("questionStatusの取得に失敗しました", error);
      }
    }

    relocationsToProcess.forEach(relocation => {
      if (!relocation || !relocation.toScheduleId) {
        return;
      }
      const uid = String(relocation.uid || relocation.participantId || "");
      if (!uid) {
        return;
      }
      const destinationScheduleId = String(relocation.toScheduleId);
      const originEntry = state.participants.find(item => String(item.participantId || "") === uid) || relocation.entrySnapshot || {};
      const destinationSchedule = getScheduleRecord(eventId, destinationScheduleId) || {};
      const destinationLabel = destinationSchedule.label || destinationSchedule.date || destinationSchedule.id || "";
      const destinationDate = destinationSchedule.date || "";
      const destinationStart = destinationSchedule.startAt || "";
      const destinationEnd = destinationSchedule.endAt || "";
      const destinationLocation = destinationSchedule.location || "";
      const destinationTeam = String(relocation.destinationTeamNumber || "");
      const token = nextTokenMap.get(uid) || "";
      const legacyId = String(originEntry.legacyParticipantId || "").trim();
      const guidanceText = String(originEntry.guidance || "");

      const relocatedRecord = {
        participantId: uid,
        uid: uid,
        legacyParticipantId: legacyId && legacyId !== uid ? legacyId : "",
        name: String(originEntry.name || ""),
        phonetic: String(originEntry.phonetic || originEntry.furigana || ""),
        furigana: String(originEntry.phonetic || originEntry.furigana || ""),
        gender: String(originEntry.gender || ""),
        department: String(originEntry.department || ""),
        phone: String(originEntry.phone || ""),
        email: String(originEntry.email || ""),
        groupNumber: destinationTeam,
        teamNumber: destinationTeam,
        token,
        guidance: guidanceText,
        status: "relocated",
        isCancelled: false,
        isRelocated: true,
        relocationSourceScheduleId: scheduleId,
        relocationSourceScheduleLabel: schedule.label || scheduleId,
        relocationDestinationTeamNumber: destinationTeam,
        updatedAt: now
      };

      additionalUpdates.push([
        `questionIntake/participants/${eventId}/${destinationScheduleId}/${uid}`,
        relocatedRecord
      ]);

      const cacheBranch = state.eventParticipantCache instanceof Map ? state.eventParticipantCache.get(eventId) : null;
      const destinationList = cacheBranch && Array.isArray(cacheBranch[destinationScheduleId])
        ? cacheBranch[destinationScheduleId]
        : [];
      additionalUpdates.push([
        `questionIntake/schedules/${eventId}/${destinationScheduleId}/participantCount`,
        destinationList.length
      ]);
      additionalUpdates.push([
        `questionIntake/schedules/${eventId}/${destinationScheduleId}/updatedAt`,
        now
      ]);

      if (token) {
        const existingTokenRecord = state.tokenRecords[token] || {};
        state.tokenRecords[token] = {
          eventId,
          eventName: event.name || existingTokenRecord.eventName || "",
          scheduleId: destinationScheduleId,
          scheduleLabel: destinationLabel || existingTokenRecord.scheduleLabel || "",
          scheduleLocation: destinationLocation || existingTokenRecord.scheduleLocation || "",
          scheduleDate: destinationDate || existingTokenRecord.scheduleDate || "",
          scheduleStart: destinationStart || existingTokenRecord.scheduleStart || "",
          scheduleEnd: destinationEnd || existingTokenRecord.scheduleEnd || "",
          participantId: uid,
          participantUid: uid,
          displayName: String(originEntry.name || existingTokenRecord.displayName || ""),
          groupNumber: destinationTeam,
          teamNumber: destinationTeam,
          guidance: guidanceText || existingTokenRecord.guidance || "",
          revoked: false,
          createdAt: existingTokenRecord.createdAt || now,
          updatedAt: now
        };
      }

      const questionEntries = questionsByParticipant.get(uid) || [];
      questionEntries.forEach(({ questionUid, record }) => {
        if (!questionUid || !record) return;
        const updatedQuestion = { ...record };
        updatedQuestion.eventId = eventId;
        updatedQuestion.scheduleId = destinationScheduleId;
        updatedQuestion.schedule = destinationLabel || updatedQuestion.schedule || "";
        updatedQuestion.scheduleStart = destinationStart || updatedQuestion.scheduleStart || "";
        updatedQuestion.scheduleEnd = destinationEnd || updatedQuestion.scheduleEnd || "";
        updatedQuestion.scheduleDate = destinationDate || updatedQuestion.scheduleDate || "";
        updatedQuestion.scheduleLocation = destinationLocation || updatedQuestion.scheduleLocation || "";
        if (destinationTeam) {
          updatedQuestion.group = destinationTeam;
        }
        updatedQuestion.updatedAt = now;
        additionalUpdates.push([
          `questions/normal/${questionUid}`,
          updatedQuestion
        ]);

        const statusRecord = questionStatusBranch && questionStatusBranch[questionUid];
        if (statusRecord && typeof statusRecord === "object") {
          additionalUpdates.push([
            `questionStatus/${questionUid}`,
            { ...statusRecord, updatedAt: now }
          ]);
        }
      });

      processedRelocations.push(uid);
    });

    tokensToRemove.forEach(token => {
      if (!token) return;
      knownTokens.delete(token);
      delete state.tokenRecords[token];
    });

    state.knownTokens = knownTokens;

    const updates = {
      [`questionIntake/participants/${eventId}/${scheduleId}`]: participantsPayload,
      [`questionIntake/schedules/${eventId}/${scheduleId}/participantCount`]: state.participants.length,
      [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    };

    additionalUpdates.forEach(([path, value]) => {
      updates[path] = value;
    });

    Object.entries(state.tokenRecords).forEach(([token, record]) => {
      updates[`questionIntake/tokens/${token}`] = record;
    });

    tokensToRemove.forEach(token => {
      if (!token) return;
      updates[`questionIntake/tokens/${token}`] = null;
    });

    await update(rootDbRef(), updates);

    if (processedRelocations.length) {
      const relocationState = ensurePendingRelocationMap();
      processedRelocations.forEach(uid => {
        relocationState.delete(uid);
      });
    }

    state.participantTokenMap = nextTokenMap;
    captureParticipantBaseline(state.participants);
    setUploadStatus(successMessage || "参加者リストを更新しました。", "success");
    await loadEvents({ preserveSelection: true });
    await loadParticipants();
    state.tokenSnapshotFetchedAt = Date.now();
    updateParticipantContext({ preserveStatus: true });
    return true;
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "適用に失敗しました。", "error");
    if (dom.saveButton) dom.saveButton.disabled = false;
    return false;
  } finally {
    state.saving = false;
    syncSaveButtonState();
    syncClearButtonState();
  }
}

function buildMailStatusMessage({
  sent = 0,
  failed = 0,
  skippedMissingEmail = 0,
  skippedAlreadySent = 0
} = {}) {
  const parts = [];
  if (sent > 0) {
    parts.push(`${sent}件のメールを送信しました。`);
  }
  if (failed > 0) {
    parts.push(`${failed}件でエラーが発生しました。`);
  }
  if (skippedMissingEmail > 0) {
    parts.push(`${skippedMissingEmail}件はメールアドレス未設定のため除外しました。`);
  }
  if (skippedAlreadySent > 0) {
    parts.push(`${skippedAlreadySent}件は送信済みのためスキップしました。`);
  }
  if (!parts.length) {
    const message = "送信対象の参加者が見つかりませんでした。";
    logMailInfo("メール送信結果メッセージを生成しました", {
      sent,
      failed,
      skippedMissingEmail,
      skippedAlreadySent,
      message
    });
    return message;
  }
  const message = parts.join(" ");
  logMailInfo("メール送信結果メッセージを生成しました", {
    sent,
    failed,
    skippedMissingEmail,
    skippedAlreadySent,
    message
  });
  return message;
}

function applyMailSendResults(results = []) {
  const count = Array.isArray(results) ? results.length : 0;
  logMailInfo("メール送信結果の適用を開始します", { count });
  if (!Array.isArray(results) || !results.length) {
    logMailInfo("適用可能なメール送信結果がありません");
    syncMailActionState();
    return 0;
  }

  const hadUnsavedChangesBefore = hasUnsavedChanges();
  const resultMap = new Map();
  results.forEach(item => {
    const key = normalizeKey(item?.participantId || item?.uid || "");
    if (!key) {
      return;
    }
    resultMap.set(key, {
      mailStatus: item.mailStatus,
      mailSentAt: item.mailSentAt,
      mailError: item.mailError,
      mailLastSubject: item.mailLastSubject,
      mailLastMessageId: item.mailLastMessageId,
      mailSentBy: item.mailSentBy,
      mailLastAttemptAt: item.mailLastAttemptAt,
      mailLastAttemptBy: item.mailLastAttemptBy
    });
  });

  if (!resultMap.size) {
    logMailInfo("適用すべきメール送信結果がありませんでした");
    syncMailActionState();
    return 0;
  }

  let updatedCount = 0;
  const updatedRowKeys = new Set();
  const updatedParticipantKeys = new Set();
  state.participants = state.participants.map(entry => {
    const key = resolveParticipantUid(entry) || String(entry.participantId || "").trim();
    if (!key || !resultMap.has(key)) {
      return entry;
    }
    const patch = resultMap.get(key);
    const nextEntry = { ...entry };

    if (patch.mailStatus !== undefined) {
      nextEntry.mailStatus = String(patch.mailStatus || "");
    }
    if (patch.mailSentAt !== undefined) {
      const value = Number(patch.mailSentAt);
      if (Number.isFinite(value) && value >= 0) {
        nextEntry.mailSentAt = value;
      }
    }
    if (patch.mailError !== undefined) {
      nextEntry.mailError = String(patch.mailError || "");
    }
    if (patch.mailLastSubject !== undefined) {
      nextEntry.mailLastSubject = String(patch.mailLastSubject || "");
    }
    if (patch.mailLastMessageId !== undefined) {
      nextEntry.mailLastMessageId = String(patch.mailLastMessageId || "");
    }
    if (patch.mailSentBy !== undefined) {
      nextEntry.mailSentBy = String(patch.mailSentBy || "");
    }
    if (patch.mailLastAttemptAt !== undefined) {
      const attemptValue = Number(patch.mailLastAttemptAt);
      if (Number.isFinite(attemptValue) && attemptValue >= 0) {
        nextEntry.mailLastAttemptAt = attemptValue;
      }
    }
    if (patch.mailLastAttemptBy !== undefined) {
      nextEntry.mailLastAttemptBy = String(patch.mailLastAttemptBy || "");
    }

    updatedCount += 1;
    updatedParticipantKeys.add(key);
    const rowKey = String(nextEntry.rowKey || entry.rowKey || "");
    if (rowKey) {
      updatedRowKeys.add(rowKey);
    }
    return nextEntry;
  });

  if (updatedCount > 0) {
    if (!hadUnsavedChangesBefore) {
      captureParticipantBaseline(state.participants);
    } else {
      if (Array.isArray(state.savedParticipantEntries) && state.savedParticipantEntries.length) {
        const baselineByParticipant = new Map();
        const baselineByRowKey = new Map();
        state.savedParticipantEntries.forEach(entry => {
          const participantKey =
            resolveParticipantUid(entry) || String(entry.participantId || "").trim();
          const rowKey = String(entry?.rowKey || "");
          if (participantKey) {
            baselineByParticipant.set(participantKey, entry);
          }
          if (rowKey) {
            baselineByRowKey.set(rowKey, entry);
          }
        });
        updatedParticipantKeys.forEach(key => {
          const baseline = baselineByParticipant.get(key);
          const patch = resultMap.get(key);
          if (!baseline || !patch) {
            return;
          }
          if (patch.mailStatus !== undefined) {
            baseline.mailStatus = String(patch.mailStatus || "");
          }
          if (patch.mailSentAt !== undefined) {
            const value = Number(patch.mailSentAt);
            if (Number.isFinite(value) && value >= 0) {
              baseline.mailSentAt = value;
            }
          }
          if (patch.mailError !== undefined) {
            baseline.mailError = String(patch.mailError || "");
          }
          if (patch.mailLastSubject !== undefined) {
            baseline.mailLastSubject = String(patch.mailLastSubject || "");
          }
          if (patch.mailLastMessageId !== undefined) {
            baseline.mailLastMessageId = String(patch.mailLastMessageId || "");
          }
          if (patch.mailSentBy !== undefined) {
            baseline.mailSentBy = String(patch.mailSentBy || "");
          }
          if (patch.mailLastAttemptAt !== undefined) {
            const attemptValue = Number(patch.mailLastAttemptAt);
            if (Number.isFinite(attemptValue) && attemptValue >= 0) {
              baseline.mailLastAttemptAt = attemptValue;
            }
          }
          if (patch.mailLastAttemptBy !== undefined) {
            baseline.mailLastAttemptBy = String(patch.mailLastAttemptBy || "");
          }
        });
        state.lastSavedSignature = signatureForEntries(state.savedParticipantEntries);

        if (
          Array.isArray(state.savedParticipants) &&
          state.savedParticipants.length &&
          updatedRowKeys.size
        ) {
          state.savedParticipants = state.savedParticipants.map(snapshot => {
            const rowKey = String(snapshot?.rowKey || "");
            if (!rowKey || !updatedRowKeys.has(rowKey)) {
              return snapshot;
            }
            const baseline = baselineByRowKey.get(rowKey);
            if (!baseline) {
              return snapshot;
            }
            const [nextSnapshot] = snapshotParticipantList([baseline]);
            return nextSnapshot || snapshot;
          });
        }
      }
    }
  }

  renderParticipants();
  syncMailActionState();
  logMailInfo("メール送信結果の適用が完了しました", {
    updatedCount,
    totalParticipants: state.participants.length
  });
  return updatedCount;
}

async function handleSendParticipantMail() {
  const eventId = state.selectedEventId ? String(state.selectedEventId) : "";
  const scheduleId = state.selectedScheduleId ? String(state.selectedScheduleId) : "";
  if (!eventId || !scheduleId) {
    logMailWarn("メール送信を開始できません。イベントまたは日程が未選択です。", {
      eventId,
      scheduleId
    });
    setUploadStatus(getSelectionRequiredMessage("メールを送信するには"), "error");
    syncMailActionState();
    return;
  }

  const pendingCount = getPendingMailCount();
  logMailInfo("送信対象の参加者数を集計しました", {
    eventId,
    scheduleId,
    pendingCount
  });
  if (pendingCount === 0) {
    logMailWarn("送信対象の参加者が見つかりませんでした", {
      eventId,
      scheduleId
    });
    setUploadStatus("送信対象の参加者が見つかりません。", "error");
    syncMailActionState();
    return;
  }

  state.mailSending = true;
  syncMailActionState();
  setUploadStatus("メール送信を開始しています…");
  logMailInfo("参加者メール送信処理を開始します", {
    eventId,
    scheduleId,
    pendingCount
  });

  try {
    logMailInfo("Apps Script にメール送信リクエストを送信します", {
      eventId,
      scheduleId
    });
    const response = await api.apiPost({
      action: "sendParticipantMail",
      eventId,
      scheduleId
    });
    const summary = response?.summary || {};
    const results = Array.isArray(response?.results) ? response.results : [];
    const messageText = String(response?.message || "").trim();
    logMailInfo("メール送信APIから応答を受信しました", {
      eventId,
      scheduleId,
      summary: {
        total: Number(summary.total || 0),
        sent: Number(summary.sent || 0),
        failed: Number(summary.failed || 0),
        skippedMissingEmail: Number(summary.skippedMissingEmail || 0),
        skippedAlreadySent: Number(summary.skippedAlreadySent || 0)
      },
      resultsCount: results.length
    });

    const appliedCount = applyMailSendResults(results);
    logMailInfo("メール送信結果を状態に反映しました", {
      eventId,
      scheduleId,
      appliedCount
    });

    const sent = Number(summary.sent || 0);
    const failed = Number(summary.failed || 0);
    const skippedMissingEmail = Number(summary.skippedMissingEmail || 0);
    const skippedAlreadySent = Number(summary.skippedAlreadySent || 0);
    const statusMessage =
      messageText ||
      buildMailStatusMessage({ sent, failed, skippedMissingEmail, skippedAlreadySent });
    const variant = failed > 0 ? "error" : sent > 0 ? "success" : "info";
    setUploadStatus(statusMessage, variant === "info" ? "" : variant);
    logMailInfo("メール送信処理が完了しました", {
      eventId,
      scheduleId,
      sent,
      failed,
      skippedMissingEmail,
      skippedAlreadySent,
      statusMessage,
      variant
    });
  } catch (error) {
    logMailError("メール送信リクエストでエラーが発生しました", error, {
      eventId,
      scheduleId
    });
    console.error(error);
    setUploadStatus(error?.message || "メール送信に失敗しました。", "error");
  } finally {
    state.mailSending = false;
    syncMailActionState();
    logMailInfo("メール送信処理を終了しました", {
      eventId,
      scheduleId
    });
  }
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
  state.events = [];
  state.participants = [];
  state.selectedEventId = null;
  state.selectedScheduleId = null;
  state.mailSending = false;
  lastSelectionBroadcastSignature = "";
  state.participantTokenMap = new Map();
  state.duplicateMatches = new Map();
  state.duplicateGroups = new Map();
  captureParticipantBaseline([], { ready: false });
  state.eventParticipantCache = new Map();
  state.teamAssignments = new Map();
  state.scheduleContextOverrides = new Map();
  state.scheduleLocationHistory = new Set();
  state.editingParticipantId = null;
  state.editingRowKey = null;
  state.selectedParticipantId = "";
  state.selectedParticipantRowKey = "";
  state.pendingRelocations = new Map();
  state.relocationDraftOriginals = new Map();
  state.relocationPromptTargets = [];
  state.initialSelection = null;
  state.initialSelectionApplied = false;
  state.initialSelectionNotice = null;
  state.initialFocusTarget = "";
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
  openParticipantEditor(participantId, rowKey);
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
  const target = getSelectedParticipantTarget();
  if (!target.entry) {
    setUploadStatus("別日に移動する対象の参加者が見つかりません。", "error");
    return;
  }
  const participantId = target.entry.participantId != null ? String(target.entry.participantId) : "";
  const rowKey = target.entry.rowKey != null ? String(target.entry.rowKey) : "";
  handleQuickRelocateAction(participantId, null, rowKey);
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
  let entry = null;
  if (rowKey) {
    entry = state.participants.find(item => String(item.rowKey || "") === String(rowKey));
  }
  if (participantId) {
    entry = entry || state.participants.find(item => String(item.participantId) === String(participantId));
  }
  if (!entry && Number.isInteger(rowIndex) && rowIndex >= 0) {
    const sorted = sortParticipants(state.participants);
    const candidate = sorted[rowIndex];
    if (candidate) {
      entry = state.participants.find(item => item === candidate || String(item.participantId) === String(candidate.participantId));
    }
  }

  if (!entry) {
    setUploadStatus("削除対象の参加者が見つかりません。", "error");
    return;
  }

  const nameLabel = entry.name ? `「${entry.name}」` : "";
  const displayId = getDisplayParticipantId(entry.participantId);
  const idLabel = entry.participantId ? `UID: ${displayId}` : "UID未設定";
  const description = nameLabel
    ? `参加者${nameLabel}（${idLabel}）を削除します。適用するまで確定されません。よろしいですか？`
    : `参加者（${idLabel}）を削除します。適用するまで確定されません。よろしいですか？`;

  const confirmed = await confirmAction({
    title: "参加者の削除",
    description,
    confirmLabel: "削除する",
    cancelLabel: "キャンセル",
    tone: "danger"
  });

  if (!confirmed) {
    return;
  }

  const removed = removeParticipantFromState(entry.participantId, entry, entry.rowKey);
  if (!removed) {
    setUploadStatus("参加者の削除に失敗しました。", "error");
    return;
  }

  const removedDisplayId = getDisplayParticipantId(removed.participantId);
  const identifier = removed.name
    ? `参加者「${removed.name}」`
    : removed.participantId
      ? `UID: ${removedDisplayId}`
      : "UID未設定";

  updateDuplicateMatches();
  renderParticipants();
  if (hasUnsavedChanges()) {
    setUploadStatus(`${identifier}を削除予定です。「適用」で確定します。`);
  } else {
    setUploadStatus("変更は適用済みの状態に戻りました。");
  }
}

function openParticipantEditor(participantId, rowKey) {
  if (!dom.participantDialog) {
    setUploadStatus("編集対象の参加者が見つかりません。", "error");
    return;
  }
  const eventId = state.selectedEventId;
  let entry = null;
  if (rowKey) {
    entry = state.participants.find(item => String(item.rowKey || "") === String(rowKey));
  }
  if (!entry && participantId) {
    entry = state.participants.find(item => String(item.participantId) === String(participantId));
  }
  if (!entry) {
    setUploadStatus("指定された参加者が現在のリストに存在しません。", "error");
    return;
  }
  state.editingParticipantId = entry.participantId;
  state.editingRowKey = entry.rowKey || null;
  if (dom.participantDialogTitle) {
    const displayId = getDisplayParticipantId(entry.participantId);
    if (entry.participantId) {
      dom.participantDialogTitle.textContent = `参加者情報を編集（UID: ${displayId}）`;
      if (displayId !== String(entry.participantId).trim()) {
        dom.participantDialogTitle.setAttribute("title", `UID: ${entry.participantId}`);
      } else {
        dom.participantDialogTitle.removeAttribute("title");
      }
    } else {
      dom.participantDialogTitle.textContent = "参加者情報を編集";
      dom.participantDialogTitle.removeAttribute("title");
    }
  }
  if (dom.participantNameInput) dom.participantNameInput.value = entry.name || "";
  if (dom.participantPhoneticInput) dom.participantPhoneticInput.value = entry.phonetic || entry.furigana || "";
  if (dom.participantGenderInput) dom.participantGenderInput.value = entry.gender || "";
  if (dom.participantDepartmentInput) dom.participantDepartmentInput.value = entry.department || "";
  if (dom.participantTeamInput) dom.participantTeamInput.value = entry.teamNumber || entry.groupNumber || "";
  if (dom.participantPhoneInput) dom.participantPhoneInput.value = entry.phone || "";
  if (dom.participantEmailInput) dom.participantEmailInput.value = entry.email || "";
  if (dom.participantMailSentInput) {
    const mailInfo = resolveMailStatusInfo(entry);
    dom.participantMailSentInput.checked = mailInfo.key === "sent";
    dom.participantMailSentInput.indeterminate = mailInfo.key === "missing";
    dom.participantMailSentInput.disabled = false;
  }

  const currentStatus = entry.status || resolveParticipantStatus(entry, entry.teamNumber || entry.groupNumber || "");
  const isCancelled = currentStatus === "cancelled";
  const isRelocated = currentStatus === "relocated";
  const relocationMap = ensurePendingRelocationMap();
  const uid = resolveParticipantUid(entry) || String(entry.participantId || "");

  if (dom.participantRelocationSummary) {
    let summaryText = "";
    if (isRelocated) {
      const pendingRelocation = relocationMap.get(uid);
      const destinationId = pendingRelocation?.toScheduleId || entry.relocationDestinationScheduleId || "";
      const destinationTeam = pendingRelocation?.destinationTeamNumber || entry.relocationDestinationTeamNumber || "";
      const destinationLabel = destinationId ? getScheduleLabel(eventId, destinationId) || destinationId : "";
      if (destinationId) {
        summaryText = destinationTeam
          ? `移動先: ${destinationLabel} / 班番号: ${destinationTeam || "未定"}`
          : `移動先: ${destinationLabel} / 班番号: 未定`;
      } else {
        summaryText = `${RELOCATE_LABEL}の設定があります。ポップアップから移動先を指定してください。`;
      }
    }
    dom.participantRelocationSummary.hidden = !summaryText;
    if (dom.participantRelocationSummaryText) {
      dom.participantRelocationSummaryText.textContent = summaryText;
    }
  }

  setFormError(dom.participantError);
  openDialog(dom.participantDialog);
}

function saveParticipantEdits() {
  const eventId = state.selectedEventId;
  const participantId = state.editingParticipantId || "";
  const rowKey = state.editingRowKey || "";
  if (!participantId && !rowKey) {
    throw new Error("編集対象の参加者が不明です。");
  }
  let index = -1;
  if (rowKey) {
    index = state.participants.findIndex(entry => String(entry.rowKey || "") === String(rowKey));
  }
  if (index === -1) {
    index = state.participants.findIndex(entry => String(entry.participantId) === String(participantId));
  }
  if (index === -1) {
    throw new Error("対象の参加者が見つかりません。");
  }
  const name = String(dom.participantNameInput?.value || "").trim();
  if (!name) {
    throw new Error("氏名を入力してください。");
  }
  const phonetic = String(dom.participantPhoneticInput?.value || "").trim();
  const gender = String(dom.participantGenderInput?.value || "").trim();
  const department = String(dom.participantDepartmentInput?.value || "").trim();
  const teamNumber = normalizeGroupNumberValue(dom.participantTeamInput?.value || "");
  const phone = String(dom.participantPhoneInput?.value || "").trim();
  const email = String(dom.participantEmailInput?.value || "").trim();

  const existing = state.participants[index];
  const mailSentControl = dom.participantMailSentInput;
  const mailSentChecked = Boolean(mailSentControl && mailSentControl.checked && !mailSentControl.indeterminate);
  const updated = {
    ...existing,
    name,
    phonetic,
    furigana: phonetic,
    gender,
    department,
    teamNumber,
    groupNumber: teamNumber,
    phone,
    email
  };
  const existingMailSentAt = Number(existing?.mailSentAt || 0);
  if (!email) {
    updated.mailStatus = "";
    updated.mailSentAt = 0;
    updated.mailError = "";
  } else if (mailSentChecked) {
    const resolvedSentAt = existingMailSentAt > 0 ? existingMailSentAt : Date.now();
    updated.mailStatus = "sent";
    updated.mailSentAt = resolvedSentAt;
    updated.mailError = "";
    const existingAttempt = Number(existing?.mailLastAttemptAt || 0);
    const nextAttempt = Number.isFinite(existingAttempt) && existingAttempt > 0
      ? Math.max(existingAttempt, resolvedSentAt)
      : resolvedSentAt;
    updated.mailLastAttemptAt = nextAttempt;
  } else {
    updated.mailStatus = "";
    updated.mailSentAt = 0;
    updated.mailError = "";
  }
  const nextStatus = resolveParticipantStatus(updated, teamNumber);
  updated.status = nextStatus;
  updated.isCancelled = nextStatus === "cancelled";
  updated.isRelocated = nextStatus === "relocated";

  const uid = resolveParticipantUid(updated) || participantId;
  if (updated.isRelocated) {
    const relocationMap = ensurePendingRelocationMap();
    const pendingRelocation = uid ? relocationMap.get(uid) : null;
    const destinationScheduleId = String(
      pendingRelocation?.toScheduleId || existing.relocationDestinationScheduleId || ""
    ).trim();
    const destinationTeamNumber = String(
      pendingRelocation?.destinationTeamNumber || existing.relocationDestinationTeamNumber || ""
    ).trim();
    applyRelocationDraft(updated, destinationScheduleId, destinationTeamNumber);
  } else {
    applyRelocationDraft(updated, "", "");
  }

  state.participants[index] = updated;
  state.participants = sortParticipants(state.participants);

  if (eventId && uid) {
    const assignmentMap = ensureTeamAssignmentMap(eventId);
    if (assignmentMap) {
      assignmentMap.set(uid, teamNumber);
    }
    const singleMap = new Map([[uid, teamNumber]]);
    applyAssignmentsToEventCache(eventId, singleMap);
  }

  syncCurrentScheduleCache();
  updateDuplicateMatches();
  renderParticipants();
  syncSaveButtonState();
  if (hasUnsavedChanges()) {
    setUploadStatus("編集内容は未保存です。「適用」で確定します。");
  } else {
    setUploadStatus("適用済みの内容と同じため変更はありません。");
  }

  state.editingParticipantId = null;
  state.editingRowKey = null;
}

function removeParticipantFromState(participantId, fallbackEntry, rowKey) {
  const targetId = String(participantId || "").trim();
  let removed = null;
  let nextList = [];

  if (rowKey) {
    const index = state.participants.findIndex(entry => String(entry.rowKey || "") === String(rowKey));
    if (index !== -1) {
      removed = state.participants[index];
      nextList = state.participants.filter((_, idx) => idx !== index);
    }
  }

  if (targetId) {
    removed = removed || state.participants.find(entry => String(entry.participantId) === targetId) || null;
    if (!removed) {
      return null;
    }
    if (!nextList.length) {
      nextList = state.participants.filter(entry => {
        if (String(entry.participantId) !== targetId) return true;
        if (!rowKey) return false;
        return String(entry.rowKey || "") !== String(rowKey);
      });
    }
  } else if (fallbackEntry) {
    const index = state.participants.findIndex(entry => entry === fallbackEntry);
    if (index === -1) {
      return null;
    }
    removed = state.participants[index];
    nextList = state.participants.filter((_, idx) => idx !== index);
  } else {
    return null;
  }

  state.participants = sortParticipants(nextList);

  syncCurrentScheduleCache();
  updateDuplicateMatches();

  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  if (selectedEvent?.schedules) {
    const schedule = selectedEvent.schedules.find(s => s.id === state.selectedScheduleId);
    if (schedule) {
      schedule.participantCount = state.participants.length;
    }
  }

  renderParticipants();
  updateParticipantContext({ preserveStatus: true });
  state.editingParticipantId = null;
  state.editingRowKey = null;
  return removed;
}

function getCachedAuthorizedEmails() {
  if (!cachedAuthorizedEmails || !cachedAuthorizedFetchedAt) {
    return null;
  }
  if (Date.now() - cachedAuthorizedFetchedAt > AUTHORIZED_EMAIL_CACHE_MS) {
    return null;
  }
  return cachedAuthorizedEmails;
}

function getFreshPreflightContext(user) {
  if (!user) {
    return null;
  }
  try {
    const context = loadAuthPreflightContext();
    if (!context) {
      return null;
    }
    if (!preflightContextMatchesUser(context, user)) {
      return null;
    }
    if (!context?.admin || !context.admin.ensuredAt) {
      return null;
    }
    return context;
  } catch (error) {
    console.warn("Failed to load auth preflight context", error);
    return null;
  }
}

async function verifyEnrollment(user) {
  if (!user) {
    throw new Error("サインイン情報を確認できませんでした。");
  }

  const preflight = getFreshPreflightContext(user);
  if (preflight) {
    return;
  }

  const email = String(user.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("メールアドレスを確認できませんでした。");
  }

  const cached = getCachedAuthorizedEmails();
  if (cached && cached.includes(email)) {
    return;
  }

  try {
    const authorized = await fetchAuthorizedEmails();
    if (authorized.includes(email)) {
      return;
    }
  } catch (error) {
    console.warn("Failed to fetch authorized emails", error);
    throw new Error(error.message || "ユーザー権限の確認に失敗しました。");
  }

  throw new Error("あなたのアカウントはこのシステムへのアクセスが許可されていません。");
}

async function waitForQuestionIntakeAccess(options = {}) {
  const {
    attempts = 5,
    initialDelay = 250,
    backoffFactor = 1.8,
    maxDelay = 2000
  } = options || {};

  const attemptCount = Number.isFinite(attempts) && attempts > 0 ? Math.ceil(attempts) : 1;
  const sanitizedInitial = Number.isFinite(initialDelay) && initialDelay >= 0 ? initialDelay : 250;
  const sanitizedBackoff = Number.isFinite(backoffFactor) && backoffFactor > 1 ? backoffFactor : 1.5;
  const sanitizedMaxDelay = Number.isFinite(maxDelay) && maxDelay > 0 ? maxDelay : 4000;
  const baseUrl = String(firebaseConfig.databaseURL || "").replace(/\/$/, "");

  if (!baseUrl) {
    throw new Error("リアルタイムデータベースのURLが設定されていません。");
  }

  let waitMs = sanitizedInitial || 250;
  let lastError = null;

  for (let attempt = 0; attempt < attemptCount; attempt++) {
    try {
      const token = await getAuthIdToken(attempt > 0);
      const url =
        `${baseUrl}/questionIntake/events.json?shallow=true&limitToFirst=1&auth=${encodeURIComponent(token)}`;
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }

      const bodyText = await response.text().catch(() => "");
      const permissionIssue =
        response.status === 401 ||
        response.status === 403 ||
        /permission\s*denied/i.test(bodyText);

      if (!permissionIssue) {
        const message = bodyText || `Realtime Database request failed (${response.status})`;
        throw new Error(message);
      }

      lastError = new Error("管理者権限の反映に時間がかかっています。数秒後に再度お試しください。");
    } catch (error) {
      lastError = error;
    }

    if (attempt < attemptCount - 1) {
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      const nextDelay = Math.max(waitMs * sanitizedBackoff, sanitizedInitial || 250);
      waitMs = Math.min(sanitizedMaxDelay, Math.round(nextDelay));
    }
  }

  throw lastError || new Error("管理者権限の確認がタイムアウトしました。");
}

async function probeQuestionIntakeAccess() {
  const baseUrl = String(firebaseConfig.databaseURL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("リアルタイムデータベースのURLが設定されていません。");
  }

  const token = await getAuthIdToken(false);
  const url = `${baseUrl}/questionIntake/events.json?shallow=true&limitToFirst=1&auth=${encodeURIComponent(
    token
  )}`;
  const response = await fetch(url, { method: "GET" });
  if (response.ok) {
    return true;
  }

  const bodyText = await response.text().catch(() => "");
  const permissionIssue =
    response.status === 401 || response.status === 403 || /permission\s*denied/i.test(bodyText);
  if (permissionIssue) {
    return false;
  }

  const message = bodyText || `Realtime Database request failed (${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  throw error;
}

function isNotInUsersSheetError(error) {
  if (!error) {
    return false;
  }
  const message = String(error?.message || error || "");
  return /not in users sheet/i.test(message) || /NOT_IN_USER_SHEET/i.test(message);
}

async function ensureAdminAccess() {
  let ensureRequired = true;
  try {
    const hasAccess = await probeQuestionIntakeAccess();
    if (hasAccess) {
      ensureRequired = false;
    }
  } catch (error) {
    console.warn("Failed to probe question intake access", error);
  }

  if (!ensureRequired) {
    return;
  }

  try {
    await api.apiPost({ action: "ensureAdmin" });
  } catch (error) {
    if (isNotInUsersSheetError(error)) {
      throw new Error("あなたのアカウントはこのシステムへのアクセスが許可されていません。");
    }
    throw new Error(error?.message || "管理者権限の確認に失敗しました。");
  }

  try {
    await waitForQuestionIntakeAccess({ attempts: 6, initialDelay: 250 });
  } catch (error) {
    throw new Error(error?.message || "管理者権限の確認に失敗しました。");
  }
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
      downloadParticipantTemplate();
    });
  }

  if (dom.downloadTeamTemplateButton) {
    dom.downloadTeamTemplateButton.addEventListener("click", () => {
      downloadTeamTemplate();
    });
  }

  if (dom.openPrintViewButton) {
    dom.openPrintViewButton.addEventListener("click", () => {
      const button = dom.openPrintViewButton;
      if (!button || button.disabled || button.dataset.printing === "true") {
        return;
      }

      openParticipantPrintView()
        .catch(error => {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error("[Print] 印刷用リストの生成に失敗しました。", error);
          }
          window.alert("印刷用リストの生成中にエラーが発生しました。時間をおいて再度お試しください。");
        });
    });
  }

  if (dom.printPreviewCloseButton) {
    dom.printPreviewCloseButton.addEventListener("click", () => {
      closeParticipantPrintPreview();
    });
  }

  if (dom.printPreviewPrintButton) {
    dom.printPreviewPrintButton.addEventListener("click", () => {
      if (dom.printPreviewPrintButton.disabled) {
        return;
      }
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
  setupPrintSettingsDialog();

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
    dom.csvInput.addEventListener("change", handleCsvChange);
    dom.csvInput.disabled = true;
  }

  if (dom.teamCsvInput) {
    dom.teamCsvInput.addEventListener("change", handleTeamCsvChange);
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
      if (!redirectingToIndex && typeof window !== "undefined" && !embedded) {
        redirectingToIndex = true;
        goToLogin();
      }
      return;
    }

    redirectingToIndex = false;
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
}

function hostSelectionSignature(selection = {}) {
  const eventId = normalizeKey(selection.eventId || "");
  const scheduleId = normalizeKey(selection.scheduleId || "");
  const eventName = selection.eventName != null ? String(selection.eventName) : "";
  const scheduleLabel = selection.scheduleLabel != null ? String(selection.scheduleLabel) : "";
  const scheduleLocation = selection.location != null ? String(selection.location) : "";
  const startAt = selection.startAt != null ? String(selection.startAt) : "";
  const endAt = selection.endAt != null ? String(selection.endAt) : "";
  return [eventId, scheduleId, eventName, scheduleLabel, scheduleLocation, startAt, endAt].join("::");
}

function getHostSelectionElement() {
  if (typeof document === "undefined") {
    return null;
  }
  return document.querySelector("[data-tool='participants']");
}

function readHostSelectionDataset(target) {
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

function applyHostSelectionFromDataset() {
  if (isHostAttached()) {
    return;
  }
  const selection = readHostSelectionDataset(getHostSelectionElement());
  if (!selection) {
    hostSelectionBridge.lastSignature = "";
    hostSelectionBridge.pendingSignature = "";
    return;
  }
  const signature = hostSelectionSignature(selection);
  const selectedEventKey = normalizeKey(state.selectedEventId || "");
  const selectedScheduleKey = normalizeKey(state.selectedScheduleId || "");
  const matchesCurrentSelection = Boolean(
    normalizeKey(selection.eventId || "") === selectedEventKey &&
    normalizeKey(selection.scheduleId || "") === selectedScheduleKey &&
    selectedEventKey &&
    selectedScheduleKey
  );
  const signatureUnchanged = Boolean(
    signature &&
    (signature === hostSelectionBridge.lastSignature || signature === hostSelectionBridge.pendingSignature)
  );
  if (signatureUnchanged && matchesCurrentSelection) {
    return;
  }
  hostSelectionBridge.pendingSignature = signature;
  applySelectionContext(selection)
    .catch((error) => {
      console.error("Failed to sync selection from host dataset", error);
    })
    .finally(() => {
      if (hostSelectionBridge.pendingSignature === signature) {
        hostSelectionBridge.pendingSignature = "";
      }
    });
}

function startHostSelectionBridge() {
  if (isHostAttached()) {
    return;
  }
  if (typeof document === "undefined") {
    return;
  }
  const target = getHostSelectionElement();
  if (!target) {
    return;
  }
  if (typeof MutationObserver === "function" && !hostSelectionBridge.observer) {
    const observer = new MutationObserver(() => applyHostSelectionFromDataset());
    observer.observe(target, {
      attributes: true,
      attributeFilter: HOST_SELECTION_ATTRIBUTE_KEYS
    });
    hostSelectionBridge.observer = observer;
  }
  applyHostSelectionFromDataset();
}

function stopHostSelectionBridge() {
  if (hostSelectionBridge.observer) {
    try {
      hostSelectionBridge.observer.disconnect();
    } catch (error) {
      console.warn("Failed to disconnect host selection observer", error);
    }
    hostSelectionBridge.observer = null;
  }
}

async function applySelectionContext(selection = {}) {
  const {
    eventId = "",
    scheduleId = "",
    eventName = "",
    scheduleLabel = "",
    location = "",
    startAt = "",
    endAt = ""
  } = selection || {};
  const trimmedEventId = normalizeKey(eventId);
  const trimmedScheduleId = normalizeKey(scheduleId);
  if (!trimmedEventId) {
    hostSelectionBridge.lastSignature = "";
    return;
  }

  try {
    if (!(state.scheduleContextOverrides instanceof Map)) {
      state.scheduleContextOverrides = new Map();
    }
    if (!state.user) {
      state.initialSelection = {
        eventId: trimmedEventId,
        scheduleId: trimmedScheduleId || null,
        scheduleLabel: scheduleLabel || null,
        location: location || null,
        eventLabel: eventName || null,
        startAt: startAt || null,
        endAt: endAt || null
      };
      state.initialSelectionApplied = false;
      hostSelectionBridge.lastSignature = hostSelectionSignature({
        eventId: trimmedEventId,
        scheduleId: trimmedScheduleId,
        eventName,
        scheduleLabel,
        location,
        startAt,
        endAt
      });
      return;
    }

    if (!Array.isArray(state.events) || !state.events.some(evt => evt.id === trimmedEventId)) {
      await loadEvents({ preserveSelection: true });
    }

    const previousEventId = state.selectedEventId;
    const previousScheduleId = state.selectedScheduleId;
    const eventChanged = previousEventId !== trimmedEventId;
    const shouldReloadSchedule = Boolean(trimmedScheduleId)
      ? eventChanged || previousScheduleId !== trimmedScheduleId
      : false;

    if (eventChanged) {
      selectEvent(trimmedEventId, {
        nextScheduleId: trimmedScheduleId || null,
        skipParticipantLoad: Boolean(trimmedScheduleId),
        source: "host"
      });
    } else if (!trimmedScheduleId) {
      selectEvent(trimmedEventId, { source: "host" });
    }

    const selectedEvent = state.events.find(evt => evt.id === trimmedEventId) || null;
    if (selectedEvent && eventName) {
      selectedEvent.name = eventName;
    }

    const effectiveEventName = selectedEvent?.name || eventName || trimmedEventId;
    let effectiveScheduleLabel = scheduleLabel || (trimmedScheduleId ? trimmedScheduleId : "");
    let effectiveLocation = location || "";
    let effectiveStartAt = startAt || "";
    let effectiveEndAt = endAt || "";

    if (trimmedScheduleId) {
      const schedule = selectedEvent?.schedules?.find(item => item.id === trimmedScheduleId) || null;
      if (schedule) {
        if (scheduleLabel) schedule.label = scheduleLabel;
        if (location) schedule.location = location;
        if (startAt) schedule.startAt = startAt;
        if (endAt) schedule.endAt = endAt;
        effectiveScheduleLabel = schedule.label || trimmedScheduleId;
        effectiveLocation = schedule.location || "";
        effectiveStartAt = schedule.startAt || "";
        effectiveEndAt = schedule.endAt || "";
        if (state.scheduleContextOverrides instanceof Map) {
          state.scheduleContextOverrides.delete(`${trimmedEventId}::${trimmedScheduleId}`);
        }
      } else if (state.scheduleContextOverrides instanceof Map) {
        const override = {
          eventId: trimmedEventId,
          eventName: effectiveEventName,
          scheduleId: trimmedScheduleId,
          scheduleLabel: scheduleLabel || trimmedScheduleId,
          location: location || "",
          startAt: startAt || "",
          endAt: endAt || ""
        };
        state.scheduleContextOverrides.set(`${trimmedEventId}::${trimmedScheduleId}`, override);
        effectiveScheduleLabel = override.scheduleLabel;
        effectiveLocation = override.location || "";
        effectiveStartAt = override.startAt;
        effectiveEndAt = override.endAt;
      }
      selectSchedule(trimmedScheduleId, {
        forceReload: shouldReloadSchedule,
        preserveStatus: !shouldReloadSchedule,
        source: "host"
      });
    } else {
      updateParticipantContext({ preserveStatus: true });
    }

    refreshScheduleLocationHistory();
    populateScheduleLocationOptions(dom.scheduleLocationInput?.value || "");

    hostSelectionBridge.lastSignature = hostSelectionSignature({
      eventId: trimmedEventId,
      scheduleId: trimmedScheduleId,
      eventName: effectiveEventName,
      scheduleLabel: effectiveScheduleLabel,
      location: effectiveLocation,
      startAt: effectiveStartAt,
      endAt: effectiveEndAt
    });
  } catch (error) {
    console.error("questionAdminEmbed.setSelection failed", error);
    throw error;
  }
}

function init() {
  hydratePrintSettingsFromStorage();
  attachEventHandlers();
  setAuthUi(Boolean(state.user));
  initLoaderSteps(isEmbeddedMode() ? [] : STEP_LABELS);
  resetState();
  if (isEmbeddedMode()) {
    showLoader("利用状態を確認しています…");
  }
  parseInitialSelectionFromUrl();
  startHostSelectionBridge();
  initAuthWatcher();
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
        redirectingToIndex = false;
        state.user = null;
        hideLoader();
        setAuthUi(false);
        resetState();
        detachHost();
        hostSelectionBridge.lastSignature = "";
        hostSelectionBridge.pendingSignature = "";
        applyHostSelectionFromDataset();
        if (dom.loginButton) {
          dom.loginButton.disabled = false;
          dom.loginButton.classList.remove("is-busy");
        }
        if (embedReadyDeferred?.resolve) {
          embedReadyDeferred.resolve();
        }
        embedReadyDeferred = null;
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

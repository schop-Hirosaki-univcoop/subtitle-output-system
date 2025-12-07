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
import { ScheduleUtilityManager } from "./managers/schedule-utility-manager.js";
import { ButtonStateManager } from "./managers/button-state-manager.js";
import { StateManager } from "./managers/state-manager.js";
import { UIManager } from "./managers/ui-manager.js";
import { ConfirmDialogManager } from "./managers/confirm-dialog-manager.js";
import { ParticipantManager } from "./managers/participant-manager.js";
import { ScheduleManager } from "./managers/schedule-manager.js";
import { MailManager } from "./managers/mail-manager.js";
import { AuthManager } from "./managers/auth-manager.js";
import { RelocationManager } from "./managers/relocation-manager.js";
import { HostIntegrationManager } from "./managers/host-integration-manager.js";
import { GlManager } from "./managers/gl-manager.js";
import { ParticipantUIManager } from "./managers/participant-ui-manager.js";

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
let uiManager = null;
let confirmDialogManager = null;
let glManager = null;
let participantUIManager = null;
let buttonStateManager = null;

// glDataFetchCache は GlManager に移行されました

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
  // ScheduleUtilityManager に委譲
  if (!scheduleUtilityManager) {
    throw new Error("ScheduleUtilityManager is not initialized");
  }
  return scheduleUtilityManager.refreshScheduleLocationHistory();
}

function populateScheduleLocationOptions(preferred = "") {
  // ScheduleUtilityManager に委譲
  if (!scheduleUtilityManager) {
    throw new Error("ScheduleUtilityManager is not initialized");
  }
  return scheduleUtilityManager.populateScheduleLocationOptions(preferred);
}

function finalizeEventLoad({
  preserveSelection = true,
  previousEventId = null,
  previousScheduleId = null,
  previousEventsSnapshot = [],
  preserveStatus = false
} = {}) {
  // ScheduleUtilityManager に委譲
  if (!scheduleUtilityManager) {
    throw new Error("ScheduleUtilityManager is not initialized");
  }
  return scheduleUtilityManager.finalizeEventLoad({
    preserveSelection,
    previousEventId,
    previousScheduleId,
    previousEventsSnapshot,
    preserveStatus
  });
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
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.getElementById(id);
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
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.renderUserSummary(user);
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
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.applyParticipantNoText(element, index);
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
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.resolveParticipantActionTarget({ participantId, rowKey, rowIndex });
}

function formatParticipantIdentifier(entry) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.formatParticipantIdentifier(entry);
}

function commitParticipantQuickEdit(index, updated, { successMessage, successVariant = "success" } = {}) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.commitParticipantQuickEdit(index, updated, { successMessage, successVariant });
}

function handleQuickCancelAction(participantId, rowIndex, rowKey) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.handleQuickCancelAction(participantId, rowIndex, rowKey);
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
  // ScheduleUtilityManager に委譲
  if (!scheduleUtilityManager) {
    throw new Error("ScheduleUtilityManager is not initialized");
  }
  return scheduleUtilityManager.getScheduleRecord(eventId, scheduleId);
}

function buildScheduleOptionLabel(schedule) {
  // ScheduleUtilityManager に委譲
  if (!scheduleUtilityManager) {
    throw new Error("ScheduleUtilityManager is not initialized");
  }
  return scheduleUtilityManager.buildScheduleOptionLabel(schedule);
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

function cleanupConfirmState() {
  // ConfirmDialogManager に委譲
  if (!confirmDialogManager) {
    throw new Error("ConfirmDialogManager is not initialized");
  }
  return confirmDialogManager.cleanupConfirmState();
}

function finalizeConfirm(result) {
  // ConfirmDialogManager に委譲
  if (!confirmDialogManager) {
    throw new Error("ConfirmDialogManager is not initialized");
  }
  return confirmDialogManager.finalizeConfirm(result);
}

function setupConfirmDialog() {
  // ConfirmDialogManager に委譲
  if (!confirmDialogManager) {
    throw new Error("ConfirmDialogManager is not initialized");
  }
  return confirmDialogManager.setupConfirmDialog();
}

async function confirmAction({
  title = "確認",
  description = "",
  confirmLabel = "実行する",
  cancelLabel = "キャンセル",
  tone = "danger",
  showCancel = true
} = {}) {
  // ConfirmDialogManager に委譲
  if (!confirmDialogManager) {
    throw new Error("ConfirmDialogManager is not initialized");
  }
  return await confirmDialogManager.confirmAction({
    title,
    description,
    confirmLabel,
    cancelLabel,
    tone,
    showCancel
  });
}

function setLoginError(message = "") {
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.setLoginError(message);
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
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.toggleSectionVisibility(element, visible);
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
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.getParticipantGroupKey(entry);
}

function describeParticipantGroup(groupKey) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.describeParticipantGroup(groupKey);
}

function createParticipantGroupElements(groupKey) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.createParticipantGroupElements(groupKey);
}

function getEventGlRoster(eventId) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.getEventGlRoster(eventId);
}

function getEventGlAssignmentsMap(eventId) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.getEventGlAssignmentsMap(eventId);
}

function normalizeGlRoster(raw) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.normalizeGlRoster(raw);
}

function normalizeGlAssignmentEntry(raw) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.normalizeGlAssignmentEntry(raw);
}

function normalizeGlAssignments(raw) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.normalizeGlAssignments(raw);
}

function resolveScheduleAssignment(entry, scheduleId) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.resolveScheduleAssignment(entry, scheduleId);
}

function collectGroupGlLeaders(groupKey, { eventId, rosterMap, assignmentsMap, scheduleId }) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.collectGroupGlLeaders(groupKey, { eventId, rosterMap, assignmentsMap, scheduleId });
}

function renderGroupGlAssignments(group, context) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return glManager.renderGroupGlAssignments(group, context);
}

async function loadGlDataForEvent(eventId, { force = false } = {}) {
  // GlManager に委譲
  if (!glManager) {
    throw new Error("GlManager is not initialized");
  }
  return await glManager.loadGlDataForEvent(eventId, { force });
}

function createParticipantBadge(label, value, { hideLabel = false } = {}) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.createParticipantBadge(label, value, { hideLabel });
}

// MAIL_STATUS_ICON_SVG は ParticipantUIManager に移行されました（初期化時に渡すため、定義を保持）
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
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.createMailStatusBadge(entry);
}

function getEntryIdentifiers(entry) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.getEntryIdentifiers(entry);
}

function isEntryCurrentlySelected(entry) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.isEntryCurrentlySelected(entry);
}

function getSelectedParticipantTarget() {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.getSelectedParticipantTarget();
}

function applyParticipantSelectionStyles({ focusCard = null } = {}) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    return;
  }
  return participantUIManager.applyParticipantSelectionStyles({ focusCard });
}

function clearParticipantSelection({ silent = false } = {}) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    return;
  }
  return participantUIManager.clearParticipantSelection({ silent });
}

function selectParticipantFromCardElement(card, { focus = false } = {}) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    return;
  }
  return participantUIManager.selectParticipantFromCardElement(card, { focus });
}

function buildParticipantCard(entry, index, { changeInfo, duplicateMap, eventId, scheduleId }) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.buildParticipantCard(entry, index, { changeInfo, duplicateMap, eventId, scheduleId });
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
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.participantChangeKey(entry, fallbackIndex);
}

function formatChangeValue(value) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.formatChangeValue(value);
}

// CHANGE_ICON_SVG は ParticipantUIManager に移行されました（初期化時に渡すため、定義を保持）
const CHANGE_ICON_SVG = {
  added: "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.5a.5.5 0 0 1 .5.5v5.5H14a.5.5 0 0 1 0 1H8.5V14a.5.5 0 0 1-1 0V8.5H2a.5.5 0 0 1 0-1h5.5V2a.5.5 0 0 1 .5-.5Z\"/></svg>",
  updated: "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>",
  removed: "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>"
};

function changeTypeLabel(type) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.changeTypeLabel(type);
}

function describeParticipantForChange(entry) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.describeParticipantForChange(entry);
}

function buildChangeMeta(entry) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.buildChangeMeta(entry);
}

function createChangePreviewItem(type, entry, info = {}) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.createChangePreviewItem(type, entry, info);
}

function renderParticipantChangePreview(diff, changeInfoByKey, participants = []) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.renderParticipantChangePreview(diff, changeInfoByKey, participants);
}

function syncSelectedEventSummary() {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.syncSelectedEventSummary();
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
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.syncSaveButtonState();
}

function syncClearButtonState() {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.syncClearButtonState();
}

function syncTemplateButtons() {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.syncTemplateButtons();
}

function setActionButtonState(button, disabled) {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.setActionButtonState(button, disabled);
}

function getPendingMailCount() {
  // MailManager に委譲
  if (!mailManager) {
    return 0;
  }
  return mailManager.getPendingMailCount();
}

// printActionButtonMissingLogged, staffPrintActionButtonMissingLogged は ButtonStateManager に移行されました

function syncAllPrintButtonStates() {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.syncAllPrintButtonStates();
}

function syncPrintViewButtonState() {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.syncPrintViewButtonState();
}

function syncStaffPrintViewButtonState() {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.syncStaffPrintViewButtonState();
}

function setPrintButtonBusy(isBusy) {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.setPrintButtonBusy(isBusy);
}

function setStaffPrintButtonBusy(isBusy) {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.setStaffPrintButtonBusy(isBusy);
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
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.updateParticipantActionPanelState();
}

function setParticipantTab(tabKey = "manage") {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.setParticipantTab(tabKey);
}

function focusParticipantTab(tabKey) {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.focusParticipantTab(tabKey);
}

function setupParticipantTabs() {
  // ButtonStateManager に委譲
  if (!buttonStateManager) {
    throw new Error("ButtonStateManager is not initialized");
  }
  return buttonStateManager.setupParticipantTabs();
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
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.setAuthUi(signedIn);
}

function resolveFocusTargetElement(target) {
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.resolveFocusTargetElement(target);
}

function maybeFocusInitialSection() {
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.maybeFocusInitialSection();
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

  // UIManager を初期化
  uiManager = new UIManager({
    state,
    dom,
    // 依存関数と定数
    getEmbedPrefix,
    isEmbeddedMode,
    updateParticipantActionPanelState,
    FOCUS_TARGETS
  });

  // ConfirmDialogManager を初期化
  confirmDialogManager = new ConfirmDialogManager({
    dom,
    // 依存関数
    openDialog,
    closeDialog
  });

  // ScheduleUtilityManager を初期化
  scheduleUtilityManager = new ScheduleUtilityManager({
    state,
    dom,
    // 依存関数
    describeScheduleRange,
    getScheduleLabel,
    normalizeKey,
    renderEvents,
    renderSchedules: () => {
      if (!scheduleManager) return;
      scheduleManager.renderSchedules();
    },
    updateParticipantContext
  });

  // ButtonStateManager を初期化
  buttonStateManager = new ButtonStateManager({
    state,
    dom,
    // 依存関数
    hasUnsavedChanges: () => {
      if (!stateManager) {
        throw new Error("StateManager is not initialized");
      }
      return stateManager.hasUnsavedChanges();
    },
    resolveParticipantUid,
    syncMailActionState: () => {
      if (!mailManager) return;
      mailManager.syncMailActionState();
    },
    syncAllPrintButtonStates,
    // 印刷関連の依存関数
    logPrintDebug,
    logPrintWarn,
    closeParticipantPrintPreview: () => {
      if (!printManager) {
        throw new Error("PrintManager is not initialized");
      }
      printManager.closeParticipantPrintPreview();
    },
    printManager,
    // 参加者アクションパネル関連の依存関数
    getSelectedParticipantTarget: () => {
      if (!participantUIManager) {
        throw new Error("ParticipantUIManager is not initialized");
      }
      return participantUIManager.getSelectedParticipantTarget();
    },
    formatParticipantIdentifier: (entry) => {
      if (!participantUIManager) {
        throw new Error("ParticipantUIManager is not initialized");
      }
      return participantUIManager.formatParticipantIdentifier(entry);
    },
    // イベントサマリー関連の依存関数
    getScheduleLabel,
    renderSchedules: () => {
      if (!scheduleManager) return;
      scheduleManager.renderSchedules();
    },
    renderEvents
  });

  // GlManager を初期化
  glManager = new GlManager({
    state,
    // 依存関数
    normalizeKey,
    fetchDbValue,
    renderParticipants,
    // 定数
    CANCEL_LABEL,
    GL_STAFF_GROUP_KEY,
    GL_STAFF_LABEL
  });

  // ParticipantUIManager を初期化
  participantUIManager = new ParticipantUIManager({
    state,
    dom,
    // 依存関数
    normalizeGroupNumberValue,
    getDisplayParticipantId,
    resolveMailStatusInfo,
    resolveParticipantUid,
    resolveParticipantActionTarget,
    updateParticipantActionPanelState,
    applyParticipantNoText: (element, index) => {
      if (!uiManager) {
        throw new Error("UIManager is not initialized");
      }
      return uiManager.applyParticipantNoText(element, index);
    },
    createShareUrl,
    describeDuplicateMatch,
    diffParticipantLists,
    // 定数
    CANCEL_LABEL,
    RELOCATE_LABEL,
    GL_STAFF_GROUP_KEY,
    GL_STAFF_LABEL,
    NO_TEAM_GROUP_KEY,
    MAIL_STATUS_ICON_SVG,
    CHANGE_ICON_SVG
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
    renderParticipantChangePreview: (diff, changeInfoByKey, participants) => {
      if (!participantUIManager) {
        throw new Error("ParticipantUIManager is not initialized");
      }
      return participantUIManager.renderParticipantChangePreview(diff, changeInfoByKey, participants);
    },
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
    buildParticipantCard: (entry, index, options) => {
      if (!participantUIManager) {
        throw new Error("ParticipantUIManager is not initialized");
      }
      return participantUIManager.buildParticipantCard(entry, index, options);
    },
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
    resolveParticipantActionTarget: (options) => {
      if (!participantUIManager) {
        throw new Error("ParticipantUIManager is not initialized");
      }
      return participantUIManager.resolveParticipantActionTarget(options);
    },
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
    commitParticipantQuickEdit: (index, updated, options) => {
      if (!participantUIManager) {
        throw new Error("ParticipantUIManager is not initialized");
      }
      return participantUIManager.commitParticipantQuickEdit(index, updated, options);
    },
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

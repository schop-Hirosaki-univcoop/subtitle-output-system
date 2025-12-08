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
import { openDialog, closeDialog, bindDialogDismiss } from "./dialog.js";
import { showLoader, hideLoader, initLoaderSteps, setLoaderStep, finishLoaderSteps } from "./loader.js";
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
import { TokenApiManager } from "./managers/token-api-manager.js";
import { ShareClipboardManager } from "./managers/share-clipboard-manager.js";
import { ParticipantContextManager } from "./managers/participant-context-manager.js";
import { ParticipantActionManager } from "./managers/participant-action-manager.js";
import { EventHandlersManager } from "./managers/event-handlers-manager.js";
import { InitManager } from "./managers/init-manager.js";

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
let tokenApiManager = null;
let shareClipboardManager = null;
let participantContextManager = null;
let participantActionManager = null;
let eventHandlersManager = null;
let scheduleUtilityManager = null;
let initManager = null;

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
  // ParticipantContextManager に委譲
  if (!participantContextManager) {
    throw new Error("ParticipantContextManager is not initialized");
  }
  return participantContextManager.parseInitialSelectionFromUrl();
}

function generateQuestionToken(existingTokens = state.knownTokens) {
  // TokenApiManager に委譲
  if (!tokenApiManager) {
    throw new Error("TokenApiManager is not initialized");
  }
  return tokenApiManager.generateQuestionToken(existingTokens);
}

async function ensureTokenSnapshot(force = false) {
  // TokenApiManager に委譲
  if (!tokenApiManager) {
    throw new Error("TokenApiManager is not initialized");
  }
  return await tokenApiManager.ensureTokenSnapshot(force);
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
  // TokenApiManager に委譲
  if (!tokenApiManager) {
    throw new Error("TokenApiManager is not initialized");
  }
  return tokenApiManager.createApiClient(getIdToken);
}

const api = createApiClient(getAuthIdToken);

async function drainQuestionQueue() {
  // TokenApiManager に委譲
  if (!tokenApiManager) {
    throw new Error("TokenApiManager is not initialized");
  }
  return await tokenApiManager.drainQuestionQueue(api);
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
  // ShareClipboardManager に委譲
  if (!shareClipboardManager) {
    throw new Error("ShareClipboardManager is not initialized");
  }
  return shareClipboardManager.legacyCopyToClipboard(text);
}

function toggleSectionVisibility(element, visible) {
  // UIManager に委譲
  if (!uiManager) {
    throw new Error("UIManager is not initialized");
  }
  return uiManager.toggleSectionVisibility(element, visible);
}

function emitParticipantSyncEvent(detail = {}) {
  // ParticipantContextManager に委譲
  if (!participantContextManager) {
    throw new Error("ParticipantContextManager is not initialized");
  }
  return participantContextManager.emitParticipantSyncEvent(detail);
}

function getSelectionIdentifiers() {
  // ShareClipboardManager に委譲
  if (!shareClipboardManager) {
    throw new Error("ShareClipboardManager is not initialized");
  }
  return shareClipboardManager.getSelectionIdentifiers();
}

// encodeCsvValue, createCsvContent, buildParticipantCsvFilename, buildTeamCsvFilename, downloadCsvFile は CsvManager に移行されました

function createShareUrl(token) {
  // ShareClipboardManager に委譲
  if (!shareClipboardManager) {
    throw new Error("ShareClipboardManager is not initialized");
  }
  return shareClipboardManager.createShareUrl(token);
}

async function copyShareLink(token) {
  // ShareClipboardManager に委譲
  if (!shareClipboardManager) {
    throw new Error("ShareClipboardManager is not initialized");
  }
  return await shareClipboardManager.copyShareLink(token, setUploadStatus);
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
  // ParticipantContextManager に委譲
  if (!participantContextManager) {
    throw new Error("ParticipantContextManager is not initialized");
  }
  return participantContextManager.updateParticipantContext(options);
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
  // ParticipantActionManager に委譲
  if (!participantActionManager) {
    throw new Error("ParticipantActionManager is not initialized");
  }
  return await participantActionManager.handleRevertParticipants();
}

async function handleClearParticipants() {
  // ParticipantActionManager に委譲
  if (!participantActionManager) {
    throw new Error("ParticipantActionManager is not initialized");
  }
  return await participantActionManager.handleClearParticipants();
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
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.handleParticipantCardListClick(event);
}

function handleParticipantCardListKeydown(event) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.handleParticipantCardListKeydown(event);
}

function handleParticipantListFocus(event) {
  // ParticipantUIManager に委譲
  if (!participantUIManager) {
    throw new Error("ParticipantUIManager is not initialized");
  }
  return participantUIManager.handleParticipantListFocus(event);
}

function handleEditSelectedParticipant() {
  // ParticipantActionManager に委譲
  if (!participantActionManager) {
    throw new Error("ParticipantActionManager is not initialized");
  }
  return participantActionManager.handleEditSelectedParticipant();
}

function handleCancelSelectedParticipant() {
  // ParticipantActionManager に委譲
  if (!participantActionManager) {
    throw new Error("ParticipantActionManager is not initialized");
  }
  return participantActionManager.handleCancelSelectedParticipant();
}

function handleRelocateSelectedParticipant() {
  // RelocationManager に委譲
  if (!relocationManager) {
    return;
  }
  relocationManager.handleRelocateSelectedParticipant(getSelectedParticipantTarget);
}

function handleDeleteSelectedParticipant() {
  // ParticipantActionManager に委譲
  if (!participantActionManager) {
    throw new Error("ParticipantActionManager is not initialized");
  }
  return participantActionManager.handleDeleteSelectedParticipant();
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
  // EventHandlersManager に委譲
  if (!eventHandlersManager) {
    throw new Error("EventHandlersManager is not initialized");
  }
  return eventHandlersManager.attachEventHandlers();
}

// 元の attachEventHandlers 実装は EventHandlersManager に移行されました

function initAuthWatcher() {
  // AuthManager に委譲
  // 注意: InitManagerのinit()メソッドでauthManagerが初期化されるため、
  // このフォールバック実装は通常は実行されません。
  // ただし、InitManagerの初期化前に呼び出された場合に備えて残しています。
  if (!authManager) {
    // フォールバック（初期化前の場合）
    // この実装はAuthManager.initAuthWatcher()と同等の処理を行いますが、
    // 段階的な移行のため、ここでは簡略化された実装のみを提供します。
    // 完全な実装はAuthManagerに移行されています。
    console.warn("initAuthWatcher: AuthManager is not initialized, using fallback");
    // フォールバック実装は削除（AuthManagerに完全移行済み）
    // InitManagerのinit()メソッドでauthManager.initAuthWatcher()が呼び出されるため、
    // このフォールバックは通常は実行されません。
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

// setFormError関数の定義を確認
function setFormError(element, message = "") {
  if (!element) return;
  const errorElement = element.querySelector(".form-error, [data-form-error]");
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = message ? "block" : "none";
  }
}

// Manager変数の参照オブジェクト
const managerRefs = {
  printManager: null,
  csvManager: null,
  eventManager: null,
  participantManager: null,
  scheduleManager: null,
  mailManager: null,
  authManager: null,
  relocationManager: null,
  hostIntegrationManager: null,
  stateManager: null,
  uiManager: null,
  confirmDialogManager: null,
  glManager: null,
  participantUIManager: null,
  buttonStateManager: null,
  tokenApiManager: null,
  shareClipboardManager: null,
  participantContextManager: null,
  participantActionManager: null,
  eventHandlersManager: null,
  scheduleUtilityManager: null
};

// Managerクラスの参照オブジェクト
const managerClasses = {
  PrintManager,
  CsvManager,
  EventManager,
  ParticipantManager,
  ScheduleManager,
  MailManager,
  AuthManager,
  RelocationManager,
  HostIntegrationManager,
  StateManager,
  UIManager,
  ConfirmDialogManager,
  GlManager,
  ParticipantUIManager,
  ButtonStateManager,
  TokenApiManager,
  ShareClipboardManager,
  ParticipantContextManager,
  ParticipantActionManager,
  EventHandlersManager,
  ScheduleUtilityManager
};

// InitManagerを初期化（apiは後で設定）
initManager = new InitManager({
  state,
  dom,
  calendarState,
  managerRefs,
  managerClasses,
  // 依存関数
  openDialog,
  closeDialog,
  setFormError,
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
  getEmbedPrefix,
  parseInitialSelectionFromUrl,
  startHostSelectionBridge,
  initAuthWatcher,
  attachEventHandlers,
  applySelectionContext,
  loadParticipants,
  loadEvents,
  waitForEmbedReady,
  detachHost,
  attachHost,
  applyHostSelectionFromDataset,
  // 定数
  STEP_LABELS,
  FOCUS_TARGETS,
  UPLOAD_STATUS_PLACEHOLDERS,
  PARTICIPANT_DESCRIPTION_DEFAULT,
  PARTICIPANT_TEMPLATE_HEADERS,
  TEAM_TEMPLATE_HEADERS,
  NO_TEAM_GROUP_KEY,
  CANCEL_LABEL,
  RELOCATE_LABEL,
  GL_STAFF_GROUP_KEY,
  GL_STAFF_LABEL,
  MAIL_STATUS_ICON_SVG,
  CHANGE_ICON_SVG,
  GAS_API_URL,
  FORM_PAGE_PATH,
  HOST_SELECTION_ATTRIBUTE_KEYS,
  PRINT_SETTING_STORAGE_KEY,
  DEFAULT_PRINT_SETTINGS,
  redirectingToIndexRef,
  // ユーティリティ関数
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
  signatureForEntries,
  snapshotParticipantList,
  getDisplayParticipantId,
  resolveMailStatusInfo,
  resolveParticipantUid,
  resolveParticipantActionTarget,
  updateParticipantActionPanelState,
  createShareUrl,
  describeDuplicateMatch,
  diffParticipantLists,
  getSelectionIdentifiers,
  getSelectionRequiredMessage,
  setUploadStatus,
  hasUnsavedChanges,
  confirmAction,
  renderParticipants,
  renderEvents,
  getScheduleLabel,
  describeScheduleRange,
  updateParticipantContext,
  captureParticipantBaseline,
  syncSaveButtonState,
  syncMailActionState,
  syncAllPrintButtonStates,
  syncClearButtonState,
  syncTemplateButtons,
  syncSelectedEventSummary,
  setPrintButtonBusy,
  setStaffPrintButtonBusy,
  queueRelocationPrompt,
  applyParticipantSelectionStyles,
  emitParticipantSyncEvent,
  selectSchedule,
  selectEvent,
  setCalendarPickedDate,
  refreshScheduleLocationHistory,
  populateScheduleLocationOptions,
  finalizeEventLoad,
  broadcastSelectionChange,
  getSelectionBroadcastSource,
  hostSelectionSignature,
  getHostSelectionElement,
  readHostSelectionDataset,
  stopHostSelectionBridge,
  ensureTokenSnapshot,
  drainQuestionQueue,
  generateQuestionToken,
  getScheduleRecord,
  ensureCrypto,
  base64UrlFromBytes,
  fetchDbValue,
  logPrintDebug,
  logPrintWarn,
  logPrintError,
  maybeFocusInitialSection,
  resolveEmbedReady,
  handleSave,
  updateDuplicateMatches,
  ensureRowKey,
  resolveParticipantStatus,
  ensureTeamAssignmentMap,
  applyAssignmentsToEventCache,
  syncCurrentScheduleCache,
  findParticipantForSnapshot,
  formatParticipantIdentifier,
  createParticipantGroupElements,
  clearParticipantSelection,
  participantChangeKey,
  renderGroupGlAssignments,
  openEventForm,
  openScheduleForm,
  saveParticipantEdits,
  handleDeleteParticipant,
  openParticipantEditor,
  handleQuickCancelAction,
  commitParticipantQuickEdit,
  renderParticipantChangePreview,
  renderRelocationPrompt,
  ensurePendingRelocationMap,
  applyRelocationDraft,
  handleRelocationFormSubmit,
  handleRelocationDialogClose,
  handleRelocateSelectedParticipant,
  buildScheduleOptionLabel,
  prepareScheduleDialogCalendar,
  syncScheduleEndMin,
  shiftScheduleDialogCalendarMonth,
  setActionButtonState,
  sleep,
  setupPrintSettingsDialog,
  bindDialogDismiss,
  signInWithPopup,
  signOut,
  // API関連（後で設定）
  api: null,
  auth,
  provider,
  getAuthIdToken,
  firebaseConfig,
  goToLogin
});

// managerRefsとグローバル変数の同期はinit()関数内で行う
// Object.definePropertyは使用しない（グローバル変数に直接同期する方式を採用）

function init() {
  // InitManagerを使用して初期化
  if (!initManager) {
    throw new Error("InitManager is not initialized");
  }
  
  // apiオブジェクトを設定（tokenApiManager初期化後に設定）
  // 注意: apiはtokenApiManagerに依存するため、後で設定される
  
  // InitManagerのinit()を呼び出し
  initManager.init();
  
  // グローバル変数にmanagerRefsを同期（InitManagerで初期化されたManager）
  printManager = managerRefs.printManager;
  stateManager = managerRefs.stateManager;
  uiManager = managerRefs.uiManager;
  confirmDialogManager = managerRefs.confirmDialogManager;
  scheduleUtilityManager = managerRefs.scheduleUtilityManager;
  buttonStateManager = managerRefs.buttonStateManager;
  tokenApiManager = managerRefs.tokenApiManager;
  shareClipboardManager = managerRefs.shareClipboardManager;
  participantContextManager = managerRefs.participantContextManager;
  participantActionManager = managerRefs.participantActionManager;
  glManager = managerRefs.glManager;
  participantUIManager = managerRefs.participantUIManager;
  csvManager = managerRefs.csvManager;
  eventManager = managerRefs.eventManager;
  mailManager = managerRefs.mailManager;
  authManager = managerRefs.authManager;
  participantManager = managerRefs.participantManager;
  relocationManager = managerRefs.relocationManager;
  hostIntegrationManager = managerRefs.hostIntegrationManager;
  eventHandlersManager = managerRefs.eventHandlersManager;
  
  // 残りのManager初期化（段階的にInitManagerに移行予定）
  // 現在はapp.jsで初期化し、managerRefsにも代入
  // MailManager, AuthManager, ParticipantManager, RelocationManager, HostIntegrationManager, EventHandlersManagerはInitManagerに移行済み

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
  managerRefs.scheduleManager = scheduleManager;
  
  // 循環参照を避けるため、selectScheduleSelf を設定
  scheduleManager.selectScheduleSelf = scheduleManager.selectSchedule.bind(scheduleManager);
  
  // すべてのManagerをグローバル変数に同期（managerRefsから）
  // tokenApiManager, shareClipboardManager, participantContextManager, participantActionManager, glManager, participantUIManager, csvManager, eventManager, mailManager, authManager, participantManager, relocationManager, hostIntegrationManager, eventHandlersManagerは既にInitManagerで初期化され、上で同期済み
  scheduleManager = managerRefs.scheduleManager;
  
  // 初期化後の処理はInitManagerのinit()メソッドで実行される
  // 以下の処理はInitManagerに移行済み:
  // - attachEventHandlers()
  // - setAuthUi(Boolean(state.user))
  // - initLoaderSteps(isEmbeddedMode() ? [] : STEP_LABELS)
  // - resetState()
  // - parseInitialSelectionFromUrl()
  // - startHostSelectionBridge()
  // - initAuthWatcher()
  // - window.questionAdminEmbedの設定
}

init();

// window.questionAdminEmbedはInitManager.setupQuestionAdminEmbed()で設定されます

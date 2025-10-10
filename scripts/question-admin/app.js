import {
  GAS_API_URL,
  FORM_PAGE_PATH,
  STEP_LABELS,
  PARTICIPANT_TEMPLATE_HEADERS,
  TEAM_TEMPLATE_HEADERS
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
import {
  sleep,
  isPermissionDenied,
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
  signatureForEntries
} from "./participants.js";
import {
  openDialog,
  closeDialog,
  bindDialogDismiss,
  setFormError
} from "./dialog.js";
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

function collectParticipantTokens(branch) {
  const tokens = new Set();
  if (!branch || typeof branch !== "object") {
    return tokens;
  }

  Object.values(branch).forEach(scheduleBranch => {
    if (!scheduleBranch || typeof scheduleBranch !== "object") return;
    Object.values(scheduleBranch).forEach(participant => {
      const token = participant?.token;
      if (token) {
        tokens.add(String(token));
      }
    });
  });
  return tokens;
}

async function fetchAuthorizedEmails() {
  const result = await api.apiPost({ action: "fetchSheet", sheet: "users" });
  if (!result || !result.success || !Array.isArray(result.data)) {
    throw new Error("ユーザー権限の確認に失敗しました。");
  }
  return result.data
    .map(entry =>
      String(entry["メールアドレス"] || entry.email || "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
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

async function requestSheetSync({ suppressError = true } = {}) {
  try {
    await api.apiPost({ action: "syncQuestionIntakeToSheet" });
    return true;
  } catch (error) {
    console.error("Failed to request sheet sync", error);
    if (!suppressError) {
      throw error;
    }
    return false;
  }
}

function setUploadStatus(message, variant = "") {
  if (!dom.uploadStatus) return;
  dom.uploadStatus.textContent = message;
  dom.uploadStatus.classList.remove("status-pill--success", "status-pill--error");
  if (variant === "success") {
    dom.uploadStatus.classList.add("status-pill--success");
  } else if (variant === "error") {
    dom.uploadStatus.classList.add("status-pill--error");
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

function sortParticipants(entries) {
  return entries.slice().sort((a, b) => {
    const idA = String(a.participantId || "");
    const idB = String(b.participantId || "");
    const numA = Number(idA);
    const numB = Number(idB);
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
      return numA - numB;
    }
    if (idA !== idB) {
      return idA.localeCompare(idB, "ja", { numeric: true });
    }
    return String(a.name || "").localeCompare(String(b.name || ""), "ja", { numeric: true });
  });
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

function renderParticipants() {
  const tbody = dom.mappingTbody;
  if (!tbody) return;
  tbody.innerHTML = "";

  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  const duplicateMap = state.duplicateMatches instanceof Map ? state.duplicateMatches : new Map();
  const participants = sortParticipants(state.participants);

  participants.forEach((entry, index) => {
    const tr = document.createElement("tr");
    const idTd = document.createElement("td");
    idTd.textContent = entry.participantId;
    const nameTd = document.createElement("td");
    nameTd.textContent = entry.name;
    const phoneticTd = document.createElement("td");
    phoneticTd.textContent = entry.phonetic || entry.furigana || "";
    const genderTd = document.createElement("td");
    genderTd.textContent = entry.gender || "";
    const departmentTd = document.createElement("td");
    departmentTd.textContent = entry.department || entry.groupNumber || "";
    const teamTd = document.createElement("td");
    teamTd.className = "team-cell";
    teamTd.textContent = entry.teamNumber || entry.groupNumber || "";
    const linkTd = document.createElement("td");
    linkTd.className = "link-cell";
    const linkActions = document.createElement("div");
    linkActions.className = "link-action-row";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-link-btn";
    editButton.dataset.participantId = entry.participantId;
    editButton.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg><span>編集</span>";

    let shareUrl = "";
    if (entry.token) {
      shareUrl = createShareUrl(entry.token);
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "copy-link-btn";
      copyButton.dataset.token = entry.token;
      copyButton.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M6.25 1.75A2.25 2.25 0 0 0 4 4v7A2.25 2.25 0 0 0 6.25 13.25h4A2.25 2.25 0 0 0 12.5 11V4A2.25 2.25 0 0 0 10.25 1.75h-4Zm0 1.5h4c.414 0 .75.336.75.75v7c0 .414-.336.75-.75.75h-4a.75.75 0 0 1-.75-.75V4c0-.414.336-.75.75-.75ZM3 4.75A.75.75 0 0 0 2.25 5.5v7A2.25 2.25 0 0 0 4.5 14.75h4a.75.75 0 0 0 0-1.5h-4a.75.75 0 0 1-.75-.75v-7A.75.75 0 0 0 3 4.75Z\" fill=\"currentColor\"/></svg><span>コピー</span>";
      linkActions.appendChild(copyButton);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "link-placeholder";
      placeholder.textContent = "リンク未発行";
      linkActions.appendChild(placeholder);
    }

    linkActions.appendChild(editButton);
    linkTd.appendChild(linkActions);

    if (shareUrl) {
      const previewLink = document.createElement("a");
      previewLink.href = shareUrl;
      previewLink.target = "_blank";
      previewLink.rel = "noopener noreferrer";
      previewLink.className = "share-link-preview";
      previewLink.textContent = shareUrl;
      linkTd.appendChild(previewLink);
    }

    const duplicateKey = entry.participantId ? String(entry.participantId) : `__row${index}`;
    const duplicateInfo = duplicateMap.get(duplicateKey);
    const matches = duplicateInfo?.others || [];
    const duplicateCount = duplicateInfo?.totalCount || (matches.length ? matches.length + 1 : 0);
    if (matches.length) {
      tr.classList.add("is-duplicate");
      const warning = document.createElement("div");
      warning.className = "duplicate-warning";
      warning.setAttribute("role", "text");

      const icon = document.createElement("span");
      icon.className = "duplicate-warning__icon";
      icon.innerHTML =
        "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M8 1.333a6.667 6.667 0 1 0 0 13.334A6.667 6.667 0 0 0 8 1.333Zm0 2a.833.833 0 0 1 .833.834v3.75a.833.833 0 1 1-1.666 0v-3.75A.833.833 0 0 1 8 3.333Zm0 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z\"/></svg>";

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
      departmentTd.appendChild(warning);
    }

    tr.append(idTd, nameTd, phoneticTd, genderTd, departmentTd, teamTd, linkTd);
    tbody.appendChild(tr);
  });

  if (dom.adminSummary) {
    const total = state.participants.length;
    const summaryEntries = [];
    const groupMap = state.duplicateGroups instanceof Map ? state.duplicateGroups : new Map();
    groupMap.forEach(group => {
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

  syncSaveButtonState();
  syncTemplateButtons();
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
  if (!dom.saveButton) return;
  const currentSignature = signatureForEntries(state.participants);
  dom.saveButton.disabled = state.saving || currentSignature === state.lastSavedSignature;
}

function syncTemplateButtons() {
  const hasSelection = Boolean(state.selectedEventId && state.selectedScheduleId);
  const hasParticipants = hasSelection && state.participants.some(entry => entry.participantId);

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
}

function updateParticipantContext(options = {}) {
  const { preserveStatus = false } = options;
  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === state.selectedScheduleId);

  if (!selectedEvent || !selectedSchedule) {
    if (dom.participantContext) {
      dom.participantContext.textContent = "日程を選択すると、現在登録されている参加者が表示されます。";
    }
    if (dom.participantDescription) {
      dom.participantDescription.textContent = "日程を選択し、参加者ID・名前・フリガナ・性別・学部学科・携帯電話・メールアドレスを含むCSVをアップロードしてください。保存後は各参加者ごとに専用リンクを発行できます。";
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
    if (!preserveStatus) setUploadStatus("日程を選択してください。");
    if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
    if (dom.teamFileLabel) dom.teamFileLabel.textContent = "班番号CSVを選択";
    if (dom.mappingTbody) dom.mappingTbody.innerHTML = "";
    if (dom.adminSummary) dom.adminSummary.textContent = "";
    syncTemplateButtons();
    return;
  }

  if (dom.csvInput) dom.csvInput.disabled = false;
  if (dom.teamCsvInput) dom.teamCsvInput.disabled = false;
  if (dom.participantContext) {
    const scheduleName = selectedSchedule.label || selectedSchedule.id;
    const scheduleRange = describeScheduleRange(selectedSchedule);
    const rangeSuffix = scheduleRange ? `（${scheduleRange}）` : "";
    dom.participantContext.textContent = `イベント「${selectedEvent.name}」/ 日程「${scheduleName}」${rangeSuffix}の参加者を管理しています。専用リンクは各行のボタンまたはURLから取得できます。`;
  }
  if (!preserveStatus) {
    setUploadStatus("ファイルを選択して参加者リストを更新してください。");
  }

  syncTemplateButtons();
}

async function loadEvents({ preserveSelection = true } = {}) {
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

  if (previousEventId && state.events.some(evt => evt.id === previousEventId)) {
    state.selectedEventId = previousEventId;
    const schedules = state.events.find(evt => evt.id === previousEventId)?.schedules || [];
    if (previousScheduleId && schedules.some(s => s.id === previousScheduleId)) {
      state.selectedScheduleId = previousScheduleId;
    } else {
      state.selectedScheduleId = null;
    }
  } else {
    state.selectedEventId = null;
    state.selectedScheduleId = null;
  }

  renderEvents();
  renderSchedules();
  updateParticipantContext();

  return state.events;
}

async function loadParticipants() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    state.participants = [];
    state.participantTokenMap = new Map();
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    renderParticipants();
    updateParticipantContext();
    return;
  }

  try {
    await ensureTokenSnapshot(false);
    const eventBranchRaw = await fetchDbValue(`questionIntake/participants/${eventId}`);
    const eventBranch = eventBranchRaw && typeof eventBranchRaw === "object" ? eventBranchRaw : {};
    if (!(state.eventParticipantCache instanceof Map)) {
      state.eventParticipantCache = new Map();
    }
    state.eventParticipantCache.set(eventId, normalizeEventParticipantCache(eventBranch));

    const scheduleBranch = eventBranch && typeof eventBranch[scheduleId] === "object"
      ? eventBranch[scheduleId]
      : {};
    const normalized = Object.values(scheduleBranch)
      .map(normalizeParticipantRecord)
      .filter(entry => entry.participantId);

    let participants = sortParticipants(normalized);
    const savedSignature = signatureForEntries(participants);
    const assignmentMap = getTeamAssignmentMap(eventId);
    if (assignmentMap?.size) {
      const applyResult = applyAssignmentsToEntries(participants, assignmentMap);
      participants = sortParticipants(applyResult.entries);
    }

    state.participants = participants;
    state.lastSavedSignature = savedSignature;
    state.participantTokenMap = new Map(
      state.participants.map(entry => [entry.participantId, entry.token])
    );
    state.participantTokenMap.forEach(token => {
      if (token) {
        state.knownTokens.add(token);
      }
    });
    syncCurrentScheduleCache();
    if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
    if (dom.teamFileLabel) dom.teamFileLabel.textContent = "班番号CSVを選択";
    if (dom.csvInput) dom.csvInput.value = "";
    setUploadStatus("現在の参加者リストを読み込みました。", "success");
    updateDuplicateMatches();
    renderParticipants();
    updateParticipantContext({ preserveStatus: true });
  } catch (error) {
    console.error(error);
    state.participants = [];
    state.participantTokenMap = new Map();
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    setUploadStatus(error.message || "参加者リストの読み込みに失敗しました。", "error");
    renderParticipants();
    updateParticipantContext();
  }
}

function selectEvent(eventId) {
  const previousEventId = state.selectedEventId;
  if (previousEventId === eventId) return;
  state.selectedEventId = eventId;
  state.selectedScheduleId = null;
  setCalendarPickedDate("", { updateInput: true });
  state.participants = [];
  state.participantTokenMap = new Map();
  state.lastSavedSignature = "";
  state.duplicateMatches = new Map();
  state.duplicateGroups = new Map();
  if (state.eventParticipantCache instanceof Map && previousEventId) {
    state.eventParticipantCache.delete(previousEventId);
  }
  renderEvents();
  renderSchedules();
  updateParticipantContext();
  loadParticipants().catch(err => console.error(err));
}

function selectSchedule(scheduleId) {
  if (state.selectedScheduleId === scheduleId) return;
  state.selectedScheduleId = scheduleId;
  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  const schedule = selectedEvent?.schedules?.find(s => s.id === scheduleId);
  if (schedule) {
    const primaryDate = getSchedulePrimaryDate(schedule);
    if (primaryDate) {
      setCalendarPickedDate(formatDatePart(primaryDate), { updateInput: true });
    }
  }
  renderSchedules();
  updateParticipantContext();
  loadParticipants().catch(err => console.error(err));
}

function resolveScheduleFormValues({ label, date, startTime, endTime }) {
  const trimmedLabel = normalizeKey(label || "");
  if (!trimmedLabel) {
    throw new Error("日程の表示名を入力してください。");
  }

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

  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  if (mode === "edit" && schedule) {
    if (dom.scheduleLabelInput) dom.scheduleLabelInput.value = schedule.label || "";
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
    requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
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
    requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "イベントの更新に失敗しました。");
  }
}

async function handleDeleteEvent(eventId, eventName) {
  if (!window.confirm(`イベント「${eventName}」を削除しますか？\n関連する日程と参加者も削除されます。`)) {
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
      state.lastSavedSignature = "";
      state.duplicateMatches = new Map();
      state.duplicateGroups = new Map();
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
    requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
  } catch (error) {
    console.error(error);
    alert(error.message || "イベントの削除に失敗しました。");
  }
}

async function handleAddSchedule({ label, date, startTime, endTime }) {
  const eventId = state.selectedEventId;
  if (!eventId) {
    throw new Error("イベントを選択してください。");
  }

  const { label: trimmedLabel, date: normalizedDate, startValue, endValue } = resolveScheduleFormValues({
    label,
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
    requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "日程の追加に失敗しました。");
  }
}

async function handleUpdateSchedule(scheduleId, { label, date, startTime, endTime }) {
  const eventId = state.selectedEventId;
  if (!eventId) {
    throw new Error("イベントを選択してください。");
  }
  if (!scheduleId) {
    throw new Error("日程IDが不明です。");
  }

  const { label: trimmedLabel, date: normalizedDate, startValue, endValue } = resolveScheduleFormValues({
    label,
    date,
    startTime,
    endTime
  });

  try {
    const now = Date.now();
    await update(rootDbRef(), {
      [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: trimmedLabel,
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
    requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "日程の更新に失敗しました。");
  }
}

async function handleDeleteSchedule(scheduleId, scheduleLabel) {
  const eventId = state.selectedEventId;
  if (!eventId) return;
  if (!window.confirm(`日程「${scheduleLabel || scheduleId}」を削除しますか？\n関連する参加者も削除されます。`)) {
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
      state.lastSavedSignature = "";
      state.duplicateMatches = new Map();
      state.duplicateGroups = new Map();
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
    requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
  } catch (error) {
    console.error(error);
    alert(error.message || "日程の削除に失敗しました。");
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
      throw new Error("イベントと日程を選択してください。");
    }

    const expectedName = buildParticipantCsvFilename(eventId, scheduleId);
    if (file.name !== expectedName) {
      throw new Error(`ファイル名が一致しません。${expectedName} をアップロードしてください。`);
    }

    const text = await readFileAsText(file);
    const rows = parseCsv(text);
    const entries = assignParticipantIds(parseParticipantRows(rows), state.participants);
    const existingMap = new Map(state.participants.map(entry => [entry.participantId, entry]));
    state.participants = sortParticipants(
      entries.map(entry => {
        const existing = existingMap.get(entry.participantId) || {};
        const department = entry.department || existing.department || "";
        const teamNumber = entry.teamNumber || existing.teamNumber || existing.groupNumber || "";
        const phonetic = entry.phonetic || entry.furigana || existing.phonetic || existing.furigana || "";
        return {
          participantId: entry.participantId,
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
          guidance: existing.guidance || ""
        };
      })
    );
    syncCurrentScheduleCache();
    updateDuplicateMatches();
    if (dom.fileLabel) dom.fileLabel.textContent = file.name;
    renderParticipants();
    const signature = signatureForEntries(state.participants);
    if (signature === state.lastSavedSignature) {
      if (dom.saveButton) dom.saveButton.disabled = true;
      setUploadStatus("既存のデータと同じ内容です。", "success");
    } else {
      if (dom.saveButton) dom.saveButton.disabled = false;
      setUploadStatus(`読み込み成功: ${state.participants.length}名`, "success");
    }
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
      throw new Error("イベントと日程を選択してください。");
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
    setUploadStatus("参加者CSVテンプレートを作成するにはイベントと日程を選択してください。", "error");
    return;
  }

  const filename = buildParticipantCsvFilename(eventId, scheduleId);
  downloadCsvFile(filename, [PARTICIPANT_TEMPLATE_HEADERS]);
  setUploadStatus(`${filename} をダウンロードしました。`, "success");
}

function downloadTeamTemplate() {
  const { eventId, scheduleId } = getSelectionIdentifiers();
  if (!eventId || !scheduleId) {
    setUploadStatus("班番号テンプレートを作成するにはイベントと日程を選択してください。", "error");
    return;
  }

  const rows = sortParticipants(state.participants)
    .filter(entry => entry.participantId)
    .map(entry => [
      String(entry.participantId || ""),
      String(entry.teamNumber || entry.groupNumber || "")
    ]);

  if (!rows.length) {
    setUploadStatus("テンプレートに出力できる参加者が見つかりません。参加者リストを読み込んでからお試しください。", "error");
    return;
  }

  const filename = buildTeamCsvFilename(eventId, scheduleId);
  downloadCsvFile(filename, [TEAM_TEMPLATE_HEADERS, ...rows]);
  setUploadStatus(`${filename} をダウンロードしました。（${rows.length}名）`, "success");
}

async function handleSave() {
  if (state.saving) return;
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) return;
  if (!state.participants.length) {
    setUploadStatus("保存する参加者がありません。", "error");
    return;
  }

  state.saving = true;
  if (dom.saveButton) dom.saveButton.disabled = true;
  setUploadStatus("保存中です…");

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

    const now = Date.now();
    const previousTokens = new Map(state.participantTokenMap || []);
    const tokensToRemove = new Set(previousTokens.values());
    const participantsPayload = {};
    const nextTokenMap = new Map();
    const knownTokens = state.knownTokens instanceof Set ? state.knownTokens : new Set();
    const tokenRecords = state.tokenRecords || {};
    state.tokenRecords = tokenRecords;

    state.participants.forEach(entry => {
      const participantId = String(entry.participantId || "").trim();
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

      participantsPayload[participantId] = {
        participantId,
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
        updatedAt: now
      };

      const existingTokenRecord = tokenRecords[token] || {};
      tokenRecords[token] = {
        eventId,
        eventName: event.name || existingTokenRecord.eventName || "",
        scheduleId,
        scheduleLabel: schedule.label || existingTokenRecord.scheduleLabel || "",
        scheduleDate: scheduleDateText || existingTokenRecord.scheduleDate || "",
        scheduleStart: scheduleStartAt || existingTokenRecord.scheduleStart || "",
        scheduleEnd: scheduleEndAt || existingTokenRecord.scheduleEnd || "",
        participantId,
        displayName: String(entry.name || ""),
        groupNumber: teamNumber,
        teamNumber,
        guidance: guidance || existingTokenRecord.guidance || "",
        revoked: false,
        createdAt: existingTokenRecord.createdAt || now,
        updatedAt: now
      };
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

    Object.entries(state.tokenRecords).forEach(([token, record]) => {
      updates[`questionIntake/tokens/${token}`] = record;
    });

    await update(rootDbRef(), updates);

    state.participantTokenMap = nextTokenMap;
    state.lastSavedSignature = signatureForEntries(state.participants);
    setUploadStatus("参加者リストを更新しました。", "success");
    await loadEvents({ preserveSelection: true });
    await loadParticipants();
    state.tokenSnapshotFetchedAt = Date.now();
    updateParticipantContext({ preserveStatus: true });
    requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "保存に失敗しました。", "error");
    if (dom.saveButton) dom.saveButton.disabled = false;
  } finally {
    state.saving = false;
    syncSaveButtonState();
  }
}
function setAuthUi(signedIn) {
  toggleSectionVisibility(dom.loginCard, !signedIn);
  toggleSectionVisibility(dom.adminMain, signedIn);

  if (signedIn) {
    renderUserSummary(state.user);
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
}

function resetState() {
  state.events = [];
  state.participants = [];
  state.selectedEventId = null;
  state.selectedScheduleId = null;
  state.lastSavedSignature = "";
  state.participantTokenMap = new Map();
  state.duplicateMatches = new Map();
  state.duplicateGroups = new Map();
  state.eventParticipantCache = new Map();
  state.teamAssignments = new Map();
  state.editingParticipantId = null;
  resetTokenState();
  renderEvents();
  renderSchedules();
  renderParticipants();
  updateParticipantContext();
  setUploadStatus("日程を選択してください。");
  if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
  if (dom.teamCsvInput) dom.teamCsvInput.value = "";
  if (dom.csvInput) dom.csvInput.value = "";
  renderUserSummary(null);
  syncTemplateButtons();
}

function handleMappingTableClick(event) {
  const copyButton = event.target.closest(".copy-link-btn");
  if (copyButton) {
    event.preventDefault();
    const token = copyButton.dataset.token;
    copyShareLink(token).catch(err => console.error(err));
    return;
  }

  const editButton = event.target.closest(".edit-link-btn");
  if (editButton) {
    event.preventDefault();
    const participantId = editButton.dataset.participantId;
    openParticipantEditor(participantId);
  }
}

function openParticipantEditor(participantId) {
  if (!dom.participantDialog || !participantId) {
    setUploadStatus("編集対象の参加者が見つかりません。", "error");
    return;
  }
  const entry = state.participants.find(item => String(item.participantId) === String(participantId));
  if (!entry) {
    setUploadStatus("指定された参加者が現在のリストに存在しません。", "error");
    return;
  }
  state.editingParticipantId = entry.participantId;
  if (dom.participantDialogTitle) {
    dom.participantDialogTitle.textContent = `参加者情報を編集（ID: ${entry.participantId}）`;
  }
  if (dom.participantIdInput) dom.participantIdInput.value = entry.participantId;
  if (dom.participantNameInput) dom.participantNameInput.value = entry.name || "";
  if (dom.participantPhoneticInput) dom.participantPhoneticInput.value = entry.phonetic || entry.furigana || "";
  if (dom.participantGenderInput) dom.participantGenderInput.value = entry.gender || "";
  if (dom.participantDepartmentInput) dom.participantDepartmentInput.value = entry.department || "";
  if (dom.participantTeamInput) dom.participantTeamInput.value = entry.teamNumber || entry.groupNumber || "";
  if (dom.participantPhoneInput) dom.participantPhoneInput.value = entry.phone || "";
  if (dom.participantEmailInput) dom.participantEmailInput.value = entry.email || "";
  setFormError(dom.participantError);
  openDialog(dom.participantDialog);
}

function saveParticipantEdits() {
  const eventId = state.selectedEventId;
  const participantId = state.editingParticipantId || String(dom.participantIdInput?.value || "").trim();
  if (!participantId) {
    throw new Error("参加者IDが不明です。");
  }
  const index = state.participants.findIndex(entry => String(entry.participantId) === String(participantId));
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
  const teamNumber = String(dom.participantTeamInput?.value || "").trim();
  const phone = String(dom.participantPhoneInput?.value || "").trim();
  const email = String(dom.participantEmailInput?.value || "").trim();

  const existing = state.participants[index];
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

  state.participants[index] = updated;
  state.participants = sortParticipants(state.participants);

  if (eventId) {
    const assignmentMap = ensureTeamAssignmentMap(eventId);
    if (assignmentMap) {
      assignmentMap.set(participantId, teamNumber);
    }
    const singleMap = new Map([[participantId, teamNumber]]);
    applyAssignmentsToEventCache(eventId, singleMap);
  }

  syncCurrentScheduleCache();
  updateDuplicateMatches();
  renderParticipants();
  syncSaveButtonState();

  state.editingParticipantId = null;
}

async function verifyEnrollment(user) {
  const authorized = await fetchAuthorizedEmails();
  const email = String(user.email || "").trim().toLowerCase();
  if (!authorized.includes(email)) {
    throw new Error("あなたのアカウントはこのシステムへのアクセスが許可されていません。");
  }
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

async function ensureAdminAccess() {
  try {
    await api.apiPost({ action: "ensureAdmin" });
    await waitForQuestionIntakeAccess({ attempts: 6, initialDelay: 250 });
  } catch (error) {
    throw new Error(error.message || "管理者権限の確認に失敗しました。");
  }
}

function attachEventHandlers() {
  if (dom.loginButton) {
    dom.loginButton.addEventListener("click", async () => {
      if (dom.loginButton.disabled) return;
      dom.loginButton.disabled = true;
      dom.loginButton.classList.add("is-busy");
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        console.error(error);
        alert("ログインに失敗しました。時間をおいて再度お試しください。");
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
        requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
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

  bindDialogDismiss(dom.eventDialog);
  bindDialogDismiss(dom.scheduleDialog);
  bindDialogDismiss(dom.participantDialog);

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
        setUploadStatus("参加者情報を更新しました。保存ボタンから反映してください。", "success");
      } catch (error) {
        console.error(error);
        setFormError(dom.participantError, error.message || "参加者情報の更新に失敗しました。");
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  if (dom.saveButton) {
    dom.saveButton.addEventListener("click", () => {
      handleSave().catch(err => {
        console.error(err);
        setUploadStatus(err.message || "保存に失敗しました。", "error");
      });
    });
    dom.saveButton.disabled = true;
  }

  if (dom.mappingTbody) {
    dom.mappingTbody.addEventListener("click", handleMappingTableClick);
  }

  if (dom.addScheduleButton) {
    dom.addScheduleButton.disabled = true;
  }

  if (dom.eventEmpty) dom.eventEmpty.hidden = true;
  if (dom.scheduleEmpty) dom.scheduleEmpty.hidden = true;

  if (dom.uploadStatus) {
    setUploadStatus("日程を選択してください。");
  }

  if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
  if (dom.teamFileLabel) dom.teamFileLabel.textContent = "班番号CSVを選択";

  if (dom.copyrightYear) {
    dom.copyrightYear.textContent = String(new Date().getFullYear());
  }
}

function initAuthWatcher() {
  onAuthStateChanged(auth, async user => {
    state.user = user;
    if (!user) {
      hideLoader();
      setAuthUi(false);
      if (dom.loginButton) {
        dom.loginButton.disabled = false;
        dom.loginButton.classList.remove("is-busy");
      }
      resetState();
      return;
    }

    showLoader("権限を確認しています…");
    initLoaderSteps(STEP_LABELS);

    try {
      setLoaderStep(0, "認証OK。ユーザー情報を確認中…");
      await verifyEnrollment(user);
      setLoaderStep(1, "在籍チェック完了。管理者権限を確認しています…");
      await ensureAdminAccess();
      setLoaderStep(2, "管理者権限を同期しました。データベースから読み込み中…");
      await ensureTokenSnapshot(true);
      await loadEvents({ preserveSelection: false });
      await loadParticipants();
      setLoaderStep(3, "初期データの取得が完了しました。仕上げ中…");
      setAuthUi(true);
      finishLoaderSteps("準備完了");
      requestSheetSync().catch(err => console.warn("Sheet sync request failed", err));
    } catch (error) {
      console.error(error);
      alert(error.message || "権限の確認に失敗しました。");
      await signOut(auth);
      resetState();
    } finally {
      hideLoader();
    }
  });
}

function init() {
  attachEventHandlers();
  initLoaderSteps(STEP_LABELS);
  resetState();
  initAuthWatcher();
}

init();

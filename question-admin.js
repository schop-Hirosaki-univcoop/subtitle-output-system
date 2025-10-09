import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  get,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  initializeAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const FORM_PAGE_PATH = "question-form.html";
const LOADER_LABELS = ["認証", "在籍チェック", "データ同期", "完了"];

const firebaseConfig = {
  apiKey: "AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY",
  authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
  databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "subtitle-output-system-9bc14",
  storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
  messagingSenderId: "154494683809",
  appId: "1:154494683809:web:2a309509672f2e86314e61"
};

const apps = getApps();
const app = apps.length ? getApp() : initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = initializeAuth(app, {
  persistence: browserSessionPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const dom = {
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingText: document.getElementById("loading-text"),
  loaderSteps: document.getElementById("loader-steps"),
  loginCard: document.getElementById("login-card"),
  loginButton: document.getElementById("login-button"),
  adminMain: document.getElementById("admin-main"),
  headerLogout: document.getElementById("header-logout"),
  logoutButton: document.getElementById("logout-button"),
  refreshButton: document.getElementById("refresh-button"),
  addEventButton: document.getElementById("add-event-button"),
  addScheduleButton: document.getElementById("add-schedule-button"),
  eventList: document.getElementById("event-list"),
  eventEmpty: document.getElementById("event-empty"),
  scheduleList: document.getElementById("schedule-list"),
  scheduleEmpty: document.getElementById("schedule-empty"),
  scheduleDescription: document.getElementById("schedule-description"),
  participantContext: document.getElementById("participant-context"),
  participantDescription: document.getElementById("participant-description"),
  csvInput: document.getElementById("csv-input"),
  saveButton: document.getElementById("save-button"),
  uploadStatus: document.getElementById("upload-status"),
  fileLabel: document.getElementById("file-label"),
  mappingTbody: document.getElementById("mapping-tbody"),
  adminSummary: document.getElementById("admin-summary"),
  copyrightYear: document.getElementById("copyright-year")
};

const state = {
  events: [],
  selectedEventId: null,
  selectedScheduleId: null,
  participants: [],
  lastSavedSignature: "",
  user: null,
  saving: false
};

const loaderState = {
  items: [],
  currentIndex: -1
};

function createApiClient(authInstance) {
  async function getIdToken(force = false) {
    const user = authInstance.currentUser;
    if (!user) throw new Error("Not signed in");
    return await user.getIdToken(force);
  }

  async function apiPost(payload, retry = true) {
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
      if (retry && /Auth/.test(message)) {
        await getIdToken(true);
        return await apiPost(payload, false);
      }
      throw new Error(message || "APIリクエストに失敗しました。");
    }
    return json;
  }

  return { apiPost };
}

const api = createApiClient(auth);

function normalizeKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFKC");
}

function parseCsv(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      row.push(current);
      current = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(current);
      rows.push(row);
      current = "";
      row = [];
      continue;
    }
    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows.map(cols => cols.map(col => col.trim()));
}

function parseParticipantRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const headerCandidate = rows[0].map(cell => cell.toLowerCase());
  const hasHeader = headerCandidate.some(cell => /id|氏名|name|班/.test(cell));

  let dataRows = rows;
  let idIndex = 0;
  let nameIndex = 1;
  let groupIndex = 2;

  if (hasHeader) {
    const findIndex = (keywords, fallback) => {
      for (const keyword of keywords) {
        const idx = headerCandidate.findIndex(cell => cell.includes(keyword));
        if (idx !== -1) return idx;
      }
      return fallback;
    };
    idIndex = findIndex(["id", "参加", "member"], 0);
    nameIndex = findIndex(["name", "氏名", "ラジオ", "radio"], 1);
    groupIndex = findIndex(["group", "班", "number"], 2);
    dataRows = rows.slice(1);
  }

  const entries = [];
  const seen = new Set();
  dataRows.forEach(cols => {
    const participantId = normalizeKey(cols[idIndex]);
    const name = normalizeKey(cols[nameIndex]);
    const group = normalizeKey(cols[groupIndex]);
    if (!participantId || seen.has(participantId)) {
      return;
    }
    seen.add(participantId);
    entries.push({ participantId, name, groupNumber: group });
  });

  if (!entries.length) {
    throw new Error("有効な参加者データがありません。");
  }

  return entries;
}

function signatureForEntries(entries) {
  return JSON.stringify(entries.map(entry => [entry.participantId, entry.name, entry.groupNumber]));
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

function showLoader(message = "初期化しています…") {
  if (dom.loadingOverlay) dom.loadingOverlay.hidden = false;
  updateLoaderText(message);
}

function hideLoader() {
  if (dom.loadingOverlay) dom.loadingOverlay.hidden = true;
}

function updateLoaderText(message) {
  if (dom.loadingText && message) {
    dom.loadingText.textContent = message;
  }
}

function initLoaderSteps(labels = []) {
  if (!dom.loaderSteps) return;
  dom.loaderSteps.innerHTML = "";
  loaderState.items = labels.map(label => {
    const li = document.createElement("li");
    li.textContent = label;
    dom.loaderSteps.appendChild(li);
    return li;
  });
  loaderState.currentIndex = -1;
}

function setLoaderStep(index, message) {
  if (!loaderState.items.length) return;
  loaderState.items.forEach((li, idx) => {
    li.classList.remove("current", "done");
    if (idx < index) {
      li.classList.add("done");
    }
    if (idx === index) {
      li.classList.add("current");
      if (message) {
        li.textContent = message;
      }
    }
  });
  loaderState.currentIndex = index;
  updateLoaderText(message);
}

function finishLoaderSteps(message) {
  if (!loaderState.items.length) return;
  const lastIndex = loaderState.items.length - 1;
  setLoaderStep(lastIndex, message || loaderState.items[lastIndex].textContent);
  loaderState.items.forEach(li => li.classList.add("done"));
}

function sortParticipants(entries) {
  return entries.slice().sort((a, b) => {
    const groupA = a.groupNumber || "";
    const groupB = b.groupNumber || "";
    const numA = Number(groupA);
    const numB = Number(groupB);
    if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) {
      return numA - numB;
    }
    if (groupA !== groupB) {
      return groupA.localeCompare(groupB, "ja", { numeric: true });
    }
    return a.participantId.localeCompare(b.participantId, "ja", { numeric: true });
  });
}

function generateToken() {
  if (typeof crypto !== "undefined") {
    if (crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "");
    }
    if (crypto.getRandomValues) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    }
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createShareUrl(token) {
  const url = new URL(FORM_PAGE_PATH, window.location.href);
  url.searchParams.set("token", token);
  return url.toString();
}

function buildTokenPayload(entry, event, schedule, { isNew = false } = {}) {
  const payload = {
    eventId: event?.id || state.selectedEventId || "",
    eventName: event?.name || "",
    scheduleId: schedule?.id || state.selectedScheduleId || "",
    scheduleLabel: schedule?.label || schedule?.id || "",
    scheduleDate: schedule?.date || "",
    participantId: entry.participantId,
    displayName: entry.name,
    groupNumber: entry.groupNumber,
    guidance: entry.guidance || "",
    updatedAt: serverTimestamp(),
    revoked: false
  };
  if (isNew) {
    payload.createdAt = serverTimestamp();
  }
  return payload;
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
    const fallback = window.prompt("以下のURLをコピーしてください", url);
    if (fallback !== null) {
      setUploadStatus("URLを手動でコピーしてください。", "");
    }
  }
}

function renderParticipants() {
  const tbody = dom.mappingTbody;
  if (!tbody) return;
  tbody.innerHTML = "";

  sortParticipants(state.participants).forEach(entry => {
    const tr = document.createElement("tr");
    const idTd = document.createElement("td");
    idTd.textContent = entry.participantId;
    const nameTd = document.createElement("td");
    nameTd.textContent = entry.name;
    const groupTd = document.createElement("td");
    groupTd.textContent = entry.groupNumber;
    const linkTd = document.createElement("td");
    linkTd.className = "link-cell";
    if (entry.token) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-link-btn";
      button.dataset.token = entry.token;
      button.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M6.25 1.75A2.25 2.25 0 0 0 4 4v7A2.25 2.25 0 0 0 6.25 13.25h4A2.25 2.25 0 0 0 12.5 11V4A2.25 2.25 0 0 0 10.25 1.75h-4Zm0 1.5h4c.414 0 .75.336.75.75v7c0 .414-.336.75-.75.75h-4a.75.75 0 0 1-.75-.75V4c0-.414.336-.75.75-.75ZM3 4.75A.75.75 0 0 0 2.25 5.5v7A2.25 2.25 0 0 0 4.5 14.75h4a.75.75 0 0 0 0-1.5h-4a.75.75 0 0 1-.75-.75v-7A.75.75 0 0 0 3 4.75Z\" fill=\"currentColor\"/></svg><span>コピー</span>";
      linkTd.appendChild(button);
    } else {
      linkTd.textContent = "-";
    }
    tr.append(idTd, nameTd, groupTd, linkTd);
    tbody.appendChild(tr);
  });

  if (dom.adminSummary) {
    const total = state.participants.length;
    dom.adminSummary.textContent = total
      ? `登録済みの参加者: ${total}名`
      : "参加者リストはまだ登録されていません。";
  }

  syncSaveButtonState();
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
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-icon";
    deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
    deleteBtn.title = "イベントを削除";
    deleteBtn.addEventListener("click", eventObj => {
      eventObj.stopPropagation();
      handleDeleteEvent(event.id, event.name).catch(err => console.error(err));
    });
    actions.appendChild(deleteBtn);

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
    const datePart = schedule.date ? `日程: ${schedule.date}` : "";
    metaEl.textContent = `${datePart}${datePart && schedule.participantCount ? " / " : ""}参加者 ${schedule.participantCount || 0} 名`;
    label.append(nameEl, metaEl);

    const actions = document.createElement("div");
    actions.className = "entity-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-icon";
    deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
    deleteBtn.title = "日程を削除";
    deleteBtn.addEventListener("click", evt => {
      evt.stopPropagation();
      handleDeleteSchedule(schedule.id, schedule.label).catch(err => console.error(err));
    });
    actions.appendChild(deleteBtn);

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

function updateParticipantContext(options = {}) {
  const { preserveStatus = false } = options;
  const selectedEvent = state.events.find(evt => evt.id === state.selectedEventId);
  const selectedSchedule = selectedEvent?.schedules?.find(s => s.id === state.selectedScheduleId);

  if (!selectedEvent || !selectedSchedule) {
    if (dom.participantContext) {
      dom.participantContext.textContent = "日程を選択すると、現在登録されている参加者が表示されます。";
    }
    if (dom.participantDescription) {
      dom.participantDescription.textContent = "日程を選択し、参加者IDと班番号のリストをアップロードしてください。保存後は各参加者ごとに専用リンクを発行できます。";
    }
    if (dom.saveButton) dom.saveButton.disabled = true;
    if (dom.csvInput) {
      dom.csvInput.disabled = true;
      dom.csvInput.value = "";
    }
    if (!preserveStatus) setUploadStatus("日程を選択してください。");
    if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
    if (dom.mappingTbody) dom.mappingTbody.innerHTML = "";
    if (dom.adminSummary) dom.adminSummary.textContent = "";
    return;
  }

  if (dom.csvInput) dom.csvInput.disabled = false;
  if (dom.participantContext) {
    dom.participantContext.textContent = `イベント「${selectedEvent.name}」/ 日程「${selectedSchedule.label || selectedSchedule.id}」の参加者を管理しています。専用リンクは各行の「コピー」から取得できます。`;
  }
  if (!preserveStatus) {
    setUploadStatus("ファイルを選択して参加者リストを更新してください。");
  }
}

async function loadEvents() {
  const [eventsSnap, schedulesSnap] = await Promise.all([
    get(ref(database, "questionIntake/events")),
    get(ref(database, "questionIntake/schedules"))
  ]);
  const eventsData = eventsSnap.val() || {};
  const schedulesData = schedulesSnap.val() || {};

  const events = Object.entries(eventsData).map(([eventId, eventValue]) => {
    const scheduleEntries = Object.entries(schedulesData[eventId] || {}).map(([scheduleId, scheduleValue]) => ({
      id: scheduleId,
      label: scheduleValue.label || "",
      date: scheduleValue.date || "",
      participantCount: Number(scheduleValue.participantCount || 0),
      createdAt: scheduleValue.createdAt || 0
    }));
    scheduleEntries.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.label.localeCompare(b.label, "ja", { numeric: true }));
    return {
      id: eventId,
      name: eventValue.name || "",
      createdAt: eventValue.createdAt || 0,
      updatedAt: eventValue.updatedAt || 0,
      schedules: scheduleEntries
    };
  });

  events.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.name.localeCompare(b.name, "ja", { numeric: true }));
  state.events = events;

  if (state.selectedEventId && !state.events.some(evt => evt.id === state.selectedEventId)) {
    state.selectedEventId = null;
    state.selectedScheduleId = null;
  }

  renderEvents();
  renderSchedules();
  updateParticipantContext();
}

async function loadParticipants() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    state.participants = [];
    renderParticipants();
    updateParticipantContext();
    return;
  }

  const participantsRef = ref(database, `questionIntake/participants/${eventId}/${scheduleId}`);
  const snapshot = await get(participantsRef);
  const data = snapshot.val() || {};
  const event = state.events.find(evt => evt.id === eventId);
  const schedule = event?.schedules?.find(s => s.id === scheduleId);

  const entries = Object.entries(data).map(([participantId, value]) => ({
    participantId,
    name: value.name || "",
    groupNumber: value.groupNumber || "",
    token: value.token || "",
    guidance: value.guidance || ""
  }));

  const updates = {};
  let needsUpdate = false;
  entries.forEach(entry => {
    if (!entry.token) {
      entry.token = generateToken();
      updates[`questionIntake/participants/${eventId}/${scheduleId}/${entry.participantId}/token`] = entry.token;
      updates[`questionIntake/tokens/${entry.token}`] = buildTokenPayload(entry, event, schedule, { isNew: true });
      needsUpdate = true;
    }
  });

  if (needsUpdate) {
    updates[`questionIntake/schedules/${eventId}/${scheduleId}/participantCount`] = entries.length;
    updates[`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`] = serverTimestamp();
    updates[`questionIntake/events/${eventId}/updatedAt`] = serverTimestamp();
    await update(ref(database), updates);
  }

  state.participants = sortParticipants(entries);
  state.lastSavedSignature = signatureForEntries(state.participants);
  if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
  if (dom.csvInput) dom.csvInput.value = "";
  setUploadStatus("現在の参加者リストを読み込みました。", "success");
  renderParticipants();
  updateParticipantContext({ preserveStatus: true });
}

function selectEvent(eventId) {
  if (state.selectedEventId === eventId) return;
  state.selectedEventId = eventId;
  state.selectedScheduleId = null;
  state.participants = [];
  state.lastSavedSignature = "";
  renderEvents();
  renderSchedules();
  updateParticipantContext();
  loadParticipants().catch(err => console.error(err));
}

function selectSchedule(scheduleId) {
  if (state.selectedScheduleId === scheduleId) return;
  state.selectedScheduleId = scheduleId;
  renderSchedules();
  updateParticipantContext();
  loadParticipants().catch(err => console.error(err));
}
async function handleAddEvent() {
  const name = window.prompt("追加するイベント名を入力してください。");
  const trimmed = normalizeKey(name || "");
  if (!trimmed) return;
  const eventsRef = ref(database, "questionIntake/events");
  const newRef = push(eventsRef);
  await set(newRef, {
    name: trimmed,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await loadEvents();
  if (newRef.key) {
    selectEvent(newRef.key);
  }
}

async function purgeTokens(predicate) {
  const snapshot = await get(ref(database, "questionIntake/tokens"));
  if (!snapshot.exists()) return;
  const updates = {};
  snapshot.forEach(child => {
    const value = child.val();
    if (predicate(value, child.key)) {
      updates[`questionIntake/tokens/${child.key}`] = null;
    }
  });
  if (Object.keys(updates).length) {
    await update(ref(database), updates);
  }
}

async function handleDeleteEvent(eventId, eventName) {
  if (!window.confirm(`イベント「${eventName}」を削除しますか？\n関連する日程と参加者も削除されます。`)) {
    return;
  }
  const updates = {
    [`questionIntake/events/${eventId}`]: null,
    [`questionIntake/schedules/${eventId}`]: null,
    [`questionIntake/participants/${eventId}`]: null
  };
  await update(ref(database), updates);
  await purgeTokens(value => value?.eventId === eventId);
  if (state.selectedEventId === eventId) {
    state.selectedEventId = null;
    state.selectedScheduleId = null;
    state.participants = [];
  }
  await loadEvents();
  renderParticipants();
  updateParticipantContext();
}

async function handleAddSchedule() {
  const eventId = state.selectedEventId;
  if (!eventId) return;
  const label = normalizeKey(window.prompt("日程の表示名を入力してください。") || "");
  if (!label) return;
  const date = normalizeKey(window.prompt("日程の日付（例: 2024-05-01）を入力してください。") || "");
  const schedulesRef = ref(database, `questionIntake/schedules/${eventId}`);
  const newRef = push(schedulesRef);
  await set(newRef, {
    label,
    date,
    participantCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await loadEvents();
  selectEvent(eventId);
  if (newRef.key) {
    selectSchedule(newRef.key);
  }
}

async function handleDeleteSchedule(scheduleId, scheduleLabel) {
  const eventId = state.selectedEventId;
  if (!eventId) return;
  if (!window.confirm(`日程「${scheduleLabel || scheduleId}」を削除しますか？\n関連する参加者も削除されます。`)) {
    return;
  }
  const updates = {
    [`questionIntake/schedules/${eventId}/${scheduleId}`]: null,
    [`questionIntake/participants/${eventId}/${scheduleId}`]: null
  };
  await update(ref(database), updates);
  await purgeTokens(value => value?.eventId === eventId && value?.scheduleId === scheduleId);
  if (state.selectedScheduleId === scheduleId) {
    state.selectedScheduleId = null;
    state.participants = [];
  }
  await loadEvents();
  if (state.selectedEventId) {
    selectEvent(state.selectedEventId);
  }
}

function handleCsvChange(event) {
  const files = event.target.files;
  if (!files || !files.length) {
    return;
  }
  const file = files[0];
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const rows = parseCsv(String(e.target.result || ""));
      const entries = parseParticipantRows(rows);
      const existingMap = new Map(state.participants.map(entry => [entry.participantId, entry]));
      state.participants = sortParticipants(entries.map(entry => ({
        participantId: entry.participantId,
        name: entry.name,
        groupNumber: entry.groupNumber,
        token: existingMap.get(entry.participantId)?.token || "",
        guidance: existingMap.get(entry.participantId)?.guidance || ""
      })));
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
      if (dom.csvInput) {
        dom.csvInput.value = "";
      }
    } catch (error) {
      console.error(error);
      setUploadStatus(error.message || "CSVの読み込みに失敗しました。", "error");
      if (dom.csvInput) dom.csvInput.value = "";
    }
  };
  reader.onerror = () => {
    setUploadStatus("ファイルの読み込みに失敗しました。", "error");
  };
  reader.readAsText(file, "utf-8");
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

  const signature = signatureForEntries(state.participants);
  state.saving = true;
  if (dom.saveButton) dom.saveButton.disabled = true;
  setUploadStatus("保存中です…");

  try {
    const participantsRef = ref(database, `questionIntake/participants/${eventId}/${scheduleId}`);
    const existingSnap = await get(participantsRef);
    const existingData = existingSnap.val() || {};
    const existingTokensByParticipant = new Map();
    Object.entries(existingData).forEach(([participantId, value]) => {
      if (value && value.token) {
        existingTokensByParticipant.set(participantId, value.token);
      }
    });

    const event = state.events.find(evt => evt.id === eventId);
    const schedule = event?.schedules?.find(s => s.id === scheduleId);

    const updates = {};
    const nextIds = new Set();

    state.participants.forEach(entry => {
      const participantId = entry.participantId;
      nextIds.add(participantId);
      let token = entry.token || existingTokensByParticipant.get(participantId);
      const isNewToken = !token;
      if (!token) {
        token = generateToken();
      }
      entry.token = token;

      updates[`questionIntake/participants/${eventId}/${scheduleId}/${participantId}`] = {
        participantId,
        name: entry.name,
        groupNumber: entry.groupNumber,
        token,
        guidance: entry.guidance || "",
        updatedAt: serverTimestamp()
      };

      updates[`questionIntake/tokens/${token}`] = buildTokenPayload(entry, event, schedule, { isNew: isNewToken });
    });

    Object.keys(existingData).forEach(participantId => {
      if (!nextIds.has(participantId)) {
        updates[`questionIntake/participants/${eventId}/${scheduleId}/${participantId}`] = null;
        const token = existingData[participantId]?.token;
        if (token) {
          updates[`questionIntake/tokens/${token}`] = null;
        }
      }
    });

    updates[`questionIntake/schedules/${eventId}/${scheduleId}/participantCount`] = state.participants.length;
    updates[`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`] = serverTimestamp();
    updates[`questionIntake/events/${eventId}/updatedAt`] = serverTimestamp();

    await update(ref(database), updates);

    state.lastSavedSignature = signature;
    setUploadStatus("参加者リストを更新しました。", "success");
    await loadEvents();
    await loadParticipants();
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
  if (dom.loginCard) dom.loginCard.hidden = signedIn;
  if (dom.adminMain) dom.adminMain.hidden = !signedIn;
  if (dom.headerLogout) dom.headerLogout.hidden = !signedIn;
}

function resetState() {
  state.events = [];
  state.participants = [];
  state.selectedEventId = null;
  state.selectedScheduleId = null;
  state.lastSavedSignature = "";
  renderEvents();
  renderSchedules();
  renderParticipants();
  updateParticipantContext();
  setUploadStatus("日程を選択してください。");
  if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
  if (dom.csvInput) dom.csvInput.value = "";
}

function handleMappingTableClick(event) {
  const button = event.target.closest(".copy-link-btn");
  if (!button) return;
  event.preventDefault();
  const token = button.dataset.token;
  copyShareLink(token).catch(err => console.error(err));
}

async function verifyEnrollment(user) {
  const result = await api.apiPost({ action: "fetchSheet", sheet: "users" });
  const rows = Array.isArray(result.data) ? result.data : [];
  const authorized = rows
    .map(item => String(item["メールアドレス"] || item.email || "").trim().toLowerCase())
    .filter(Boolean);
  const email = String(user.email || "").trim().toLowerCase();
  if (!authorized.includes(email)) {
    throw new Error("あなたのアカウントはこのシステムへのアクセスが許可されていません。");
  }
}

async function ensureAdminAccess() {
  try {
    await api.apiPost({ action: "ensureAdmin" });
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
    dom.refreshButton.addEventListener("click", () => {
      loadEvents()
        .then(() => loadParticipants())
        .catch(err => console.error(err));
    });
  }

  if (dom.addEventButton) {
    dom.addEventButton.addEventListener("click", () => {
      handleAddEvent().catch(err => {
        console.error(err);
        alert(err.message || "イベントの追加に失敗しました。");
      });
    });
  }

  if (dom.addScheduleButton) {
    dom.addScheduleButton.addEventListener("click", () => {
      handleAddSchedule().catch(err => {
        console.error(err);
        alert(err.message || "日程の追加に失敗しました。");
      });
    });
  }

  if (dom.csvInput) {
    dom.csvInput.addEventListener("change", handleCsvChange);
    dom.csvInput.disabled = true;
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
    initLoaderSteps(LOADER_LABELS);

    try {
      setLoaderStep(0, "認証済み。ユーザー情報を確認中…");
      await verifyEnrollment(user);
      setLoaderStep(1, "在籍チェック完了。権限を同期しています…");
      await ensureAdminAccess();
      setLoaderStep(2, "データ同期中…");
      setAuthUi(true);
      await loadEvents();
      await loadParticipants();
      finishLoaderSteps("準備完了");
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
  initLoaderSteps(LOADER_LABELS);
  resetState();
  initAuthWatcher();
}

init();

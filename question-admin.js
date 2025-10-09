import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const firebaseConfig = {
  apiKey: "AIzaSyDLv4p0m03pWxca_HPnBkm2ZkfTgGe0uyE",
  authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
  databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "subtitle-output-system-9bc14",
  storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
  messagingSenderId: "154494683809",
  appId: "1:154494683809:web:2a309509672f2e86314e61"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const dom = {
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

function renderParticipants() {
  const tbody = dom.mappingTbody;
  if (!tbody) return;
  tbody.innerHTML = "";

  state.participants.forEach(entry => {
    const tr = document.createElement("tr");
    const idTd = document.createElement("td");
    idTd.textContent = entry.participantId;
    const nameTd = document.createElement("td");
    nameTd.textContent = entry.name;
    const groupTd = document.createElement("td");
    groupTd.textContent = entry.groupNumber;
    tr.append(idTd, nameTd, groupTd);
    tbody.appendChild(tr);
  });

  if (dom.adminSummary) {
    const total = state.participants.length;
    dom.adminSummary.textContent = total
      ? `登録済みの参加者: ${total}名`
      : "参加者リストはまだ登録されていません。";
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
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-icon";
    deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
    deleteBtn.title = "イベントを削除";
    deleteBtn.addEventListener("click", eventObj => {
      eventObj.stopPropagation();
      handleDeleteEvent(event.id, event.name);
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
      handleDeleteSchedule(schedule.id, schedule.label);
    });
    actions.appendChild(deleteBtn);

    li.append(label, actions);
    li.addEventListener("click", () => selectSchedule(schedule.id));
    list.appendChild(li);
  });
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
      dom.participantDescription.textContent = "日程を選択し、参加者IDと班番号のリストをアップロードしてください。";
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
    dom.participantContext.textContent = `イベント「${selectedEvent.name}」/ 日程「${selectedSchedule.label || selectedSchedule.id}」の参加者を管理しています。`;
  }
  if (dom.participantDescription) {
    dom.participantDescription.textContent = "CSVを読み込み後、保存ボタンで更新します。";
  }
  if (!preserveStatus) {
    setUploadStatus("ファイルを選択して参加者リストを更新してください。");
  }
}

async function loadEvents() {
  const result = await api.apiPost({ action: "listQuestionEvents" });
  state.events = Array.isArray(result.events) ? result.events : [];
  if (state.selectedEventId) {
    const stillExists = state.events.some(evt => evt.id === state.selectedEventId);
    if (!stillExists) {
      state.selectedEventId = null;
      state.selectedScheduleId = null;
    }
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

  const result = await api.apiPost({
    action: "fetchQuestionParticipants",
    eventId,
    scheduleId
  });
  const participants = Array.isArray(result.participants) ? result.participants : [];
  state.participants = participants;
  state.lastSavedSignature = signatureForEntries(participants);
  if (dom.fileLabel) dom.fileLabel.textContent = "CSVファイルを選択";
  if (dom.csvInput) dom.csvInput.value = "";
  setUploadStatus("現在の参加者リストを読み込みました。", "success");
  if (dom.saveButton) dom.saveButton.disabled = true;
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
  const result = await api.apiPost({ action: "createQuestionEvent", name: trimmed });
  await loadEvents();
  const newEventId = result && result.event && result.event.id;
  if (newEventId) {
    selectEvent(newEventId);
  }
}

async function handleDeleteEvent(eventId, eventName) {
  if (!window.confirm(`イベント「${eventName}」を削除しますか？\n関連する日程と参加者も削除されます。`)) {
    return;
  }
  await api.apiPost({ action: "deleteQuestionEvent", eventId });
  if (state.selectedEventId === eventId) {
    state.selectedEventId = null;
    state.selectedScheduleId = null;
    state.participants = [];
  }
  await loadEvents();
}

async function handleAddSchedule() {
  const eventId = state.selectedEventId;
  if (!eventId) return;
  const label = normalizeKey(window.prompt("日程の表示名を入力してください。") || "");
  if (!label) return;
  const date = normalizeKey(window.prompt("日程の日付（例: 2024-05-01）を入力してください。") || "");
  const result = await api.apiPost({ action: "createQuestionSchedule", eventId, label, date });
  await loadEvents();
  selectEvent(eventId);
  const newScheduleId = result && result.schedule && result.schedule.id;
  if (newScheduleId) {
    selectSchedule(newScheduleId);
  }
}

async function handleDeleteSchedule(scheduleId, scheduleLabel) {
  if (!state.selectedEventId) return;
  if (!window.confirm(`日程「${scheduleLabel || scheduleId}」を削除しますか？\n関連する参加者も削除されます。`)) {
    return;
  }
  await api.apiPost({ action: "deleteQuestionSchedule", eventId: state.selectedEventId, scheduleId });
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
      state.participants = entries;
      const signature = signatureForEntries(entries);
      if (dom.fileLabel) dom.fileLabel.textContent = file.name;
      renderParticipants();
      if (signature === state.lastSavedSignature) {
        if (dom.saveButton) dom.saveButton.disabled = true;
        setUploadStatus("既存のデータと同じ内容です。", "success");
      } else {
        if (dom.saveButton) dom.saveButton.disabled = false;
        setUploadStatus(`読み込み成功: ${entries.length}名`, "success");
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
  if (!state.selectedEventId || !state.selectedScheduleId) return;
  const signature = signatureForEntries(state.participants);
  if (!state.participants.length) {
    setUploadStatus("保存する参加者がありません。", "error");
    return;
  }

  state.saving = true;
  if (dom.saveButton) dom.saveButton.disabled = true;
  setUploadStatus("保存中です…");
  try {
    await api.apiPost({
      action: "saveQuestionParticipants",
      eventId: state.selectedEventId,
      scheduleId: state.selectedScheduleId,
      entries: state.participants
    });
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
  }
}

function setAuthUi(signedIn) {
  if (dom.loginCard) dom.loginCard.hidden = signedIn;
  if (dom.adminMain) dom.adminMain.hidden = !signedIn;
  if (dom.headerLogout) dom.headerLogout.hidden = !signedIn;
}

function attachEventHandlers() {
  dom.loginButton.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
      alert("ログインに失敗しました。時間をおいて再度お試しください。");
    }
  });

  dom.logoutButton.addEventListener("click", () => signOut(auth));
  if (dom.headerLogout) {
    dom.headerLogout.addEventListener("click", () => signOut(auth));
  }
  dom.refreshButton.addEventListener("click", () => {
    loadEvents().then(() => loadParticipants()).catch(err => console.error(err));
  });
  dom.addEventButton.addEventListener("click", () => {
    handleAddEvent().catch(err => {
      console.error(err);
      alert(err.message || "イベントの追加に失敗しました。");
    });
  });
  dom.addScheduleButton.addEventListener("click", () => {
    handleAddSchedule().catch(err => {
      console.error(err);
      alert(err.message || "日程の追加に失敗しました。");
    });
  });
  dom.csvInput.addEventListener("change", handleCsvChange);
  dom.saveButton.addEventListener("click", () => {
    handleSave().catch(err => {
      console.error(err);
      setUploadStatus(err.message || "保存に失敗しました。", "error");
    });
  });

  if (dom.copyrightYear) {
    dom.copyrightYear.textContent = String(new Date().getFullYear());
  }
}

function init() {
  attachEventHandlers();

  onAuthStateChanged(auth, async user => {
    state.user = user;
    if (!user) {
      setAuthUi(false);
      state.events = [];
      state.participants = [];
      state.selectedEventId = null;
      state.selectedScheduleId = null;
      renderEvents();
      renderSchedules();
      renderParticipants();
      updateParticipantContext();
      return;
    }

    setAuthUi(true);
    try {
      await api.apiPost({ action: "ensureAdmin" });
      await loadEvents();
      await loadParticipants();
    } catch (error) {
      console.error(error);
      alert(error.message || "権限の確認に失敗しました。");
      await signOut(auth);
    }
  });
}

init();

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const FORM_PAGE_PATH = "question-form.html";
const STEP_LABELS = [
  "認証",
  "在籍チェック",
  "管理者付与",
  "初期データ取得",
  "準備完了"
];

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

async function getAuthIdToken(forceRefresh = false) {
  const currentUser = auth.currentUser;
  if (currentUser) {
    return await currentUser.getIdToken(forceRefresh);
  }

  return await new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      user => {
        unsubscribe();
        if (!user) {
          reject(new Error("認証情報が確認できません。再度ログインしてください。"));
          return;
        }
        user.getIdToken(forceRefresh).then(resolve).catch(reject);
      },
      error => {
        unsubscribe();
        reject(error);
      }
    );
  });
}

const dom = {
  loadingOverlay: document.getElementById("loading-overlay"),
  loadingText: document.getElementById("loading-text"),
  loaderSteps: document.getElementById("loader-steps"),
  loginCard: document.getElementById("login-card"),
  loginButton: document.getElementById("login-button"),
  adminMain: document.getElementById("admin-main"),
  headerLogout: document.getElementById("header-logout"),
  userInfo: document.getElementById("user-info"),
  logoutButton: document.getElementById("logout-button"),
  refreshButton: document.getElementById("refresh-button"),
  addEventButton: document.getElementById("add-event-button"),
  addScheduleButton: document.getElementById("add-schedule-button"),
  eventDialog: document.getElementById("event-dialog"),
  eventForm: document.getElementById("event-form"),
  eventNameInput: document.getElementById("event-name-input"),
  eventError: document.getElementById("event-error"),
  scheduleDialog: document.getElementById("schedule-dialog"),
  scheduleForm: document.getElementById("schedule-form"),
  scheduleLabelInput: document.getElementById("schedule-label-input"),
  scheduleDateInput: document.getElementById("schedule-date-input"),
  scheduleStartTimeInput: document.getElementById("schedule-start-time-input"),
  scheduleEndTimeInput: document.getElementById("schedule-end-time-input"),
  scheduleError: document.getElementById("schedule-error"),
  scheduleDialogCalendar: document.getElementById("schedule-dialog-calendar"),
  scheduleDialogCalendarTitle: document.getElementById("schedule-dialog-calendar-title"),
  scheduleDialogCalendarGrid: document.getElementById("schedule-dialog-calendar-grid"),
  scheduleDialogCalendarPrev: document.getElementById("schedule-dialog-calendar-prev"),
  scheduleDialogCalendarNext: document.getElementById("schedule-dialog-calendar-next"),
  eventList: document.getElementById("event-list"),
  eventEmpty: document.getElementById("event-empty"),
  scheduleList: document.getElementById("schedule-list"),
  scheduleEmpty: document.getElementById("schedule-empty"),
  scheduleDescription: document.getElementById("schedule-description"),
  participantContext: document.getElementById("participant-context"),
  participantDescription: document.getElementById("participant-description"),
  csvInput: document.getElementById("csv-input"),
  teamCsvInput: document.getElementById("team-csv-input"),
  saveButton: document.getElementById("save-button"),
  uploadStatus: document.getElementById("upload-status"),
  fileLabel: document.getElementById("file-label"),
  teamFileLabel: document.getElementById("team-file-label"),
  mappingTbody: document.getElementById("mapping-tbody"),
  adminSummary: document.getElementById("admin-summary"),
  copyrightYear: document.getElementById("copyright-year")
};

dom.eventDialogTitle = document.getElementById("event-dialog-title");
dom.scheduleDialogTitle = document.getElementById("schedule-dialog-title");
dom.participantDialog = document.getElementById("participant-dialog");
dom.participantForm = document.getElementById("participant-form");
dom.participantDialogTitle = document.getElementById("participant-dialog-title");
dom.participantError = document.getElementById("participant-error");
dom.participantIdInput = document.getElementById("participant-id-input");
dom.participantNameInput = document.getElementById("participant-name-input");
dom.participantPhoneticInput = document.getElementById("participant-phonetic-input");
dom.participantGenderInput = document.getElementById("participant-gender-input");
dom.participantDepartmentInput = document.getElementById("participant-department-input");
dom.participantTeamInput = document.getElementById("participant-team-input");
dom.participantPhoneInput = document.getElementById("participant-phone-input");
dom.participantEmailInput = document.getElementById("participant-email-input");

const state = {
  events: [],
  selectedEventId: null,
  selectedScheduleId: null,
  participants: [],
  lastSavedSignature: "",
  user: null,
  saving: false,
  tokenRecords: {},
  knownTokens: new Set(),
  participantTokenMap: new Map(),
  eventParticipantCache: new Map(),
  duplicateMatches: new Map(),
  duplicateGroups: new Map(),
  teamAssignments: new Map(),
  tokenSnapshotFetchedAt: 0,
  editingParticipantId: null
};

const calendarState = {
  pickedDate: ""
};

const dialogCalendarState = {
  referenceDate: new Date(),
  selectedDate: ""
};

const loaderState = {
  items: [],
  currentIndex: -1
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPermissionDenied(error) {
  if (!error || typeof error !== "object") return false;
  const code = String(error.code || error?.message || "").toLowerCase();
  return (
    code.includes("permission_denied") ||
    code.includes("permission-denied") ||
    code.includes("permission denied")
  );
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === "number" && !Number.isNaN(value)) {
    if (value > 1e12) return value;
    if (value > 1e10) return value * 1000;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }
  return 0;
}

function rootDbRef(path = "") {
  return path ? ref(database, path) : ref(database);
}

async function fetchDbValue(path) {
  const snapshot = await get(rootDbRef(path));
  return snapshot.exists() ? snapshot.val() : null;
}

function resetTokenState() {
  state.tokenRecords = {};
  state.knownTokens = new Set();
  state.participantTokenMap = new Map();
  state.tokenSnapshotFetchedAt = 0;
}

function ensureCrypto() {
  return (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : null;
}

function generateShortId(prefix = "") {
  const cryptoObj = ensureCrypto();
  if (cryptoObj) {
    const bytes = new Uint8Array(8);
    cryptoObj.getRandomValues(bytes);
    let hex = "";
    bytes.forEach(byte => {
      hex += byte.toString(16).padStart(2, "0");
    });
    return `${prefix}${hex}`;
  }

  const fallback = Math.random().toString(16).slice(2, 10);
  return `${prefix}${fallback}`;
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

function participantIdentityKey(entry) {
  if (!entry) return "";
  const phonetic = entry.phonetic ?? entry.furigana ?? "";
  const department = entry.department ?? entry.groupNumber ?? "";
  return [
    normalizeKey(entry.name),
    normalizeKey(phonetic),
    normalizeKey(department)
  ].join("::");
}

function normalizeDuplicateField(value) {
  return normalizeKey(value)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function duplicateKeyFromValues(name, department) {
  const nameKey = normalizeDuplicateField(name);
  const deptKey = normalizeDuplicateField(department);
  if (!nameKey || !deptKey) return "";
  return `${nameKey}::${deptKey}`;
}

function duplicateKeyFor(entry) {
  if (!entry) return "";
  const department = entry.department ?? entry.groupNumber ?? "";
  return duplicateKeyFromValues(entry.name, department);
}

function getScheduleLabel(eventId, scheduleId) {
  if (!eventId || !scheduleId) return "";
  const event = state.events.find(evt => evt.id === eventId);
  if (!event) return "";
  const schedule = event.schedules?.find(s => s.id === scheduleId);
  if (!schedule) return "";
  return schedule.label || schedule.date || schedule.id || "";
}

function normalizeEventParticipantCache(eventBranch) {
  const cache = {};
  if (!eventBranch || typeof eventBranch !== "object") {
    return cache;
  }
  Object.entries(eventBranch).forEach(([scheduleId, scheduleBranch]) => {
    if (!scheduleBranch || typeof scheduleBranch !== "object") {
      cache[String(scheduleId)] = [];
      return;
    }
    const normalized = Object.values(scheduleBranch).map(entry => ({
      participantId: String(entry?.participantId || entry?.id || ""),
      name: String(entry?.name || ""),
      department: String(entry?.department || entry?.groupNumber || ""),
      groupNumber: String(entry?.groupNumber || entry?.teamNumber || ""),
      teamNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
      scheduleId: String(scheduleId)
    }));
    cache[String(scheduleId)] = normalized;
  });
  return cache;
}

function describeDuplicateMatch(match, eventId, currentScheduleId) {
  if (!match) return "";
  const name = String(match.name || "").trim();
  const idLabel = match.participantId ? `ID:${match.participantId}` : "ID未登録";
  const scheduleId = String(match.scheduleId || "").trim();
  if (match.isCurrent && scheduleId === String(currentScheduleId || "")) {
    const label = name || "同日程";
    return `${label}（同日程・${idLabel}）`;
  }
  const scheduleLabel = getScheduleLabel(eventId, scheduleId) || (scheduleId ? `日程ID:${scheduleId}` : "");
  if (name && scheduleLabel) {
    return `${name}（${scheduleLabel}・${idLabel}）`;
  }
  if (scheduleLabel) {
    return `${scheduleLabel}（${idLabel}）`;
  }
  if (name) {
    return `${name}（${idLabel}）`;
  }
  return idLabel;
}

function updateDuplicateMatches() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) {
    state.duplicateMatches = new Map();
    state.duplicateGroups = new Map();
    return;
  }

  if (!(state.eventParticipantCache instanceof Map)) {
    state.eventParticipantCache = new Map();
  }

  const eventCache = state.eventParticipantCache.get(eventId);
  const scheduleCache = eventCache && typeof eventCache === "object" ? eventCache : {};
  const keyMap = new Map();
  const addRecord = (key, record) => {
    if (!key) return;
    if (!keyMap.has(key)) {
      keyMap.set(key, []);
    }
    keyMap.get(key).push(record);
  };

  Object.entries(scheduleCache).forEach(([cacheScheduleId, entries]) => {
    if (String(cacheScheduleId) === String(scheduleId)) return;
    const list = Array.isArray(entries) ? entries : [];
    list.forEach(entry => {
      const record = {
        participantId: String(entry?.participantId || ""),
        name: String(entry?.name || ""),
        department: String(entry?.department || ""),
        scheduleId: String(entry?.scheduleId || cacheScheduleId),
        isCurrent: false
      };
      const key = duplicateKeyFromValues(record.name, record.department);
      addRecord(key, record);
    });
  });

  state.participants.forEach((entry, index) => {
    const record = {
      key: String(entry?.participantId || `__row${index}`),
      participantId: String(entry?.participantId || ""),
      name: String(entry?.name || ""),
      department: String(entry?.department || entry?.groupNumber || ""),
      scheduleId: String(scheduleId),
      isCurrent: true
    };
    const key = duplicateKeyFromValues(record.name, record.department);
    addRecord(key, record);
  });

  const duplicates = new Map();
  const groups = new Map();
  keyMap.forEach((records, groupKey) => {
    const current = records.filter(record => record.isCurrent);
    if (!current.length) return;
    if (records.length <= 1) return;
    const normalizedRecords = records.map(record => ({ ...record }));
    groups.set(groupKey, {
      key: groupKey,
      totalCount: records.length,
      records: normalizedRecords
    });
    current.forEach(record => {
      const others = records.filter(candidate => {
        if (!candidate) return false;
        if (candidate.isCurrent && candidate.key && record.key && candidate.key === record.key) {
          return false;
        }
        return candidate !== record;
      });
      if (!others.length) return;
      duplicates.set(record.key, {
        groupKey,
        totalCount: records.length,
        others: others.map(candidate => ({
          participantId: candidate.participantId,
          name: candidate.name,
          department: candidate.department,
          scheduleId: candidate.scheduleId,
          isCurrent: candidate.isCurrent
        }))
      });
    });
  });

  state.duplicateMatches = duplicates;
  state.duplicateGroups = groups;
}

function syncCurrentScheduleCache() {
  const eventId = state.selectedEventId;
  const scheduleId = state.selectedScheduleId;
  if (!eventId || !scheduleId) return;
  if (!(state.eventParticipantCache instanceof Map)) {
    state.eventParticipantCache = new Map();
  }
  const cache = state.eventParticipantCache.get(eventId) || {};
  cache[scheduleId] = state.participants.map(entry => ({
    participantId: String(entry?.participantId || ""),
    name: String(entry?.name || ""),
    department: String(entry?.department || entry?.groupNumber || ""),
    groupNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
    teamNumber: String(entry?.teamNumber || entry?.groupNumber || ""),
    scheduleId: String(scheduleId),
    isCurrent: true
  }));
  state.eventParticipantCache.set(eventId, cache);
}

function parseParticipantRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const headerCandidate = rows[0].map(cell => cell.toLowerCase());
  const hasHeader = headerCandidate.some(cell => /id|氏名|name|フリ|furigana|性別|gender|学部|department|mail|メール|phone|電話/.test(cell));

  let dataRows = rows;
  const indexMap = {
    id: 0,
    name: 1,
    phonetic: 2,
    gender: 3,
    department: 4,
    phone: 5,
    email: 6,
    team: -1
  };

  if (hasHeader) {
    const findIndex = (keywords, fallback = -1) => {
      for (const keyword of keywords) {
        const idx = headerCandidate.findIndex(cell => cell.includes(keyword));
        if (idx !== -1) return idx;
      }
      return fallback;
    };
    indexMap.id = findIndex(["id", "参加", "member"], -1);
    indexMap.name = findIndex(["name", "氏名", "ラジオ", "radio"], 1);
    indexMap.phonetic = findIndex(["フリ", "ふり", "furigana", "yomi", "reading"], 2);
    indexMap.gender = findIndex(["性別", "gender"], 3);
    indexMap.department = findIndex(["学部", "department", "学科", "faculty"], 4);
    indexMap.phone = findIndex(["電話", "tel", "phone"], 5);
    indexMap.email = findIndex(["mail", "メール", "email"], 6);
    indexMap.team = findIndex(["班", "group", "team"], -1);
    dataRows = rows.slice(1);
  }

  const normalizeColumn = (cols, index) => {
    if (index == null || index < 0 || index >= cols.length) return "";
    return normalizeKey(cols[index]);
  };

  const entries = [];
  const seenIds = new Set();
  const seenKeys = new Set();

  dataRows.forEach(cols => {
    const participantId = normalizeColumn(cols, indexMap.id);
    const name = normalizeColumn(cols, indexMap.name);
    const phonetic = normalizeColumn(cols, indexMap.phonetic);
    const gender = normalizeColumn(cols, indexMap.gender);
    const department = normalizeColumn(cols, indexMap.department);
    const phone = normalizeColumn(cols, indexMap.phone);
    const email = normalizeColumn(cols, indexMap.email);
    const teamNumber = normalizeColumn(cols, indexMap.team);

    if (!participantId && !name && !phonetic && !gender && !department && !phone && !email) {
      return;
    }

    if (!name) {
      throw new Error("氏名のない行があります。CSVを確認してください。");
    }

    if (participantId) {
      if (seenIds.has(participantId)) {
        return;
      }
      seenIds.add(participantId);
    } else {
      const key = participantIdentityKey({ name, phonetic, department });
      if (key) {
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
      }
    }

    entries.push({
      participantId,
      name,
      phonetic,
      furigana: phonetic,
      gender,
      department,
      teamNumber,
      groupNumber: teamNumber,
      phone,
      email
    });
  });

  if (!entries.length) {
    throw new Error("有効な参加者データがありません。");
  }

  return entries;
}

function parseTeamAssignmentRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const headerCandidate = rows[0].map(cell => cell.toLowerCase());
  const hasHeader = headerCandidate.some(cell => /id|参加/.test(cell)) && headerCandidate.some(cell => /班|group|team/.test(cell));

  let dataRows = rows;
  let idIndex = 0;
  let teamIndex = 1;

  if (hasHeader) {
    const findIndex = (keywords, fallback) => {
      for (const keyword of keywords) {
        const idx = headerCandidate.findIndex(cell => cell.includes(keyword));
        if (idx !== -1) return idx;
      }
      return fallback;
    };
    idIndex = findIndex(["id", "参加", "member"], 0);
    teamIndex = findIndex(["班", "group", "team"], 1);
    dataRows = rows.slice(1);
  }

  if (idIndex < 0 || teamIndex < 0) {
    throw new Error("CSVの列が認識できません。参加者IDと班番号の列を用意してください。");
  }

  const assignments = new Map();
  dataRows.forEach(cols => {
    const participantId = normalizeKey(cols[idIndex] ?? "");
    const teamNumber = normalizeKey(cols[teamIndex] ?? "");
    if (!participantId) {
      return;
    }
    assignments.set(participantId, teamNumber);
  });

  if (!assignments.size) {
    throw new Error("有効な参加者IDが含まれていません。");
  }

  return assignments;
}

function ensureTeamAssignmentMap(eventId) {
  if (!eventId) return null;
  if (!(state.teamAssignments instanceof Map)) {
    state.teamAssignments = new Map();
  }
  if (!state.teamAssignments.has(eventId)) {
    state.teamAssignments.set(eventId, new Map());
  }
  const map = state.teamAssignments.get(eventId);
  return map instanceof Map ? map : null;
}

function getTeamAssignmentMap(eventId) {
  if (!eventId) return null;
  if (!(state.teamAssignments instanceof Map)) return null;
  const map = state.teamAssignments.get(eventId);
  return map instanceof Map ? map : null;
}

function applyAssignmentsToEntries(entries, assignmentMap) {
  if (!Array.isArray(entries) || !(assignmentMap instanceof Map) || !assignmentMap.size) {
    return { entries, matchedIds: new Set(), updatedIds: new Set() };
  }
  const matchedIds = new Set();
  const updatedIds = new Set();
  const updatedEntries = entries.map(entry => {
    const participantId = String(entry?.participantId || "");
    if (!participantId || !assignmentMap.has(participantId)) {
      return entry;
    }
    matchedIds.add(participantId);
    const teamNumber = String(assignmentMap.get(participantId) || "");
    const currentTeam = String(entry?.teamNumber || entry?.groupNumber || "");
    if (currentTeam === teamNumber) {
      return entry;
    }
    updatedIds.add(participantId);
    return {
      ...entry,
      teamNumber,
      groupNumber: teamNumber
    };
  });

  return { entries: updatedEntries, matchedIds, updatedIds };
}

function applyAssignmentsToEventCache(eventId, assignmentMap) {
  if (!eventId || !(assignmentMap instanceof Map) || !assignmentMap.size) {
    return new Set();
  }
  if (!(state.eventParticipantCache instanceof Map)) {
    state.eventParticipantCache = new Map();
  }
  const cache = state.eventParticipantCache.get(eventId);
  if (!cache || typeof cache !== "object") {
    return new Set();
  }
  const matchedIds = new Set();
  Object.keys(cache).forEach(scheduleId => {
    const list = Array.isArray(cache[scheduleId]) ? cache[scheduleId] : [];
    cache[scheduleId] = list.map(record => {
      const participantId = String(record?.participantId || "");
      if (!participantId || !assignmentMap.has(participantId)) {
        return record;
      }
      matchedIds.add(participantId);
      const teamNumber = String(assignmentMap.get(participantId) || "");
      return {
        ...record,
        groupNumber: teamNumber,
        teamNumber
      };
    });
  });
  state.eventParticipantCache.set(eventId, cache);
  return matchedIds;
}

function normalizeParticipantRecord(entry) {
  const participantId = String(entry?.participantId || entry?.id || "");
  const name = String(entry?.name || "");
  const phonetic = String(entry?.phonetic || entry?.furigana || "");
  const gender = String(entry?.gender || "");
  const department = String(entry?.department || entry?.faculty || entry?.groupNumber || "");
  const rawGroup = entry?.teamNumber ?? entry?.groupNumber ?? "";
  const teamNumber = String(rawGroup || "");
  const phone = String(entry?.phone || "");
  const email = String(entry?.email || "");
  const token = String(entry?.token || "");
  const guidance = String(entry?.guidance || "");
  return {
    participantId,
    name,
    phonetic,
    furigana: phonetic,
    gender,
    department,
    groupNumber: teamNumber,
    teamNumber,
    phone,
    email,
    token,
    guidance
  };
}

function assignParticipantIds(entries, existingParticipants = []) {
  const resolved = entries.map(entry => ({ ...entry }));

  const usedIds = new Set();
  const existingByKey = new Map();

  existingParticipants.forEach(participant => {
    const participantId = normalizeKey(participant.participantId || participant.id || "");
    if (participantId) {
      usedIds.add(participantId);
    }
    const key = participantIdentityKey(participant);
    if (key && participantId && !existingByKey.has(key)) {
      existingByKey.set(key, participantId);
    }
  });

  resolved.forEach(entry => {
    if (entry.participantId) {
      usedIds.add(entry.participantId);
    }
  });

  const assignedExistingIds = new Set();
  resolved.forEach(entry => {
    if (entry.participantId) return;
    const key = participantIdentityKey(entry);
    if (!key) return;
    const existingId = existingByKey.get(key);
    if (existingId && !assignedExistingIds.has(existingId)) {
      entry.participantId = existingId;
      usedIds.add(existingId);
      assignedExistingIds.add(existingId);
    }
  });

  const numericInfo = Array.from(usedIds)
    .map(id => {
      const match = id.match(/^\d+$/);
      if (!match) return null;
      return { value: Number(id), length: id.length };
    })
    .filter(Boolean);

  const maxNumber = numericInfo.reduce((acc, info) => Math.max(acc, info.value), 0);
  const padLength = numericInfo.reduce((acc, info) => Math.max(acc, info.length), 0) || 1;
  let nextNumber = maxNumber ? maxNumber + 1 : 1;

  resolved.forEach(entry => {
    if (entry.participantId) return;
    let candidateNumber = nextNumber;
    let candidateId = "";
    while (!candidateId || usedIds.has(candidateId)) {
      candidateId = String(candidateNumber).padStart(padLength, "0");
      candidateNumber += 1;
    }
    nextNumber = candidateNumber;
    entry.participantId = candidateId;
    usedIds.add(candidateId);
  });

  return resolved;
}

function signatureForEntries(entries) {
  return JSON.stringify(entries.map(entry => [
    entry.participantId,
    entry.name,
    entry.phonetic || entry.furigana || "",
    entry.gender || "",
    entry.teamNumber || entry.groupNumber || "",
    entry.department || entry.groupNumber || "",
    entry.phone || "",
    entry.email || ""
  ]));
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

const dialogState = {
  active: null,
  lastFocused: null
};

function handleDialogKeydown(event) {
  if (event.key === "Escape" && dialogState.active) {
    event.preventDefault();
    closeDialog(dialogState.active);
  }
}

function openDialog(element) {
  if (!element) return;
  if (dialogState.active && dialogState.active !== element) {
    closeDialog(dialogState.active);
  }
  dialogState.active = element;
  dialogState.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  element.removeAttribute("hidden");
  document.body.classList.add("modal-open");
  document.addEventListener("keydown", handleDialogKeydown);
  const focusTarget = element.querySelector("[data-autofocus]") || element.querySelector("input, select, textarea, button");
  if (focusTarget instanceof HTMLElement) {
    requestAnimationFrame(() => focusTarget.focus());
  }
}

function closeDialog(element) {
  if (!element) return;
  if (!element.hasAttribute("hidden")) {
    element.setAttribute("hidden", "");
  }
  if (element === dom.participantDialog) {
    state.editingParticipantId = null;
    if (dom.participantForm) {
      dom.participantForm.reset();
    }
    setFormError(dom.participantError);
  }
  if (dialogState.active === element) {
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", handleDialogKeydown);
    const toFocus = dialogState.lastFocused;
    dialogState.active = null;
    dialogState.lastFocused = null;
    if (toFocus && typeof toFocus.focus === "function") {
      toFocus.focus();
    }
  }
}

function bindDialogDismiss(element) {
  if (!element) return;
  element.addEventListener("click", event => {
    if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
      event.preventDefault();
      closeDialog(element);
    }
  });
}

function setFormError(element, message = "") {
  if (!element) return;
  if (message) {
    element.textContent = message;
    element.hidden = false;
  } else {
    element.textContent = "";
    element.hidden = true;
  }
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function formatDatePart(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTimePart(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseDateOnly(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.length <= 10 ? `${trimmed}T00:00` : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function normalizeDateInputValue(value) {
  const parsed = parseDateOnly(value || "");
  return parsed ? formatDatePart(parsed) : "";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDateTimeLocal(date) {
  return `${formatDatePart(date)}T${formatTimePart(date)}`;
}

function combineDateAndTime(dateValue, timeValue) {
  const datePart = normalizeDateInputValue(dateValue);
  const timePart = String(timeValue || "").trim();
  if (!datePart || !timePart) return "";
  return `${datePart}T${timePart}`;
}

function setCalendarPickedDate(value, { updateInput = true } = {}) {
  const normalized = normalizeDateInputValue(value);
  calendarState.pickedDate = normalized;
  if (updateInput && dom.scheduleDateInput) {
    dom.scheduleDateInput.value = normalized;
  }
  setDialogCalendarPickedDate(normalized);
}

function setDialogCalendarPickedDate(value) {
  const normalized = normalizeDateInputValue(value);
  dialogCalendarState.selectedDate = normalized;
  const parsed = normalized ? parseDateOnly(normalized) : null;
  if (parsed) {
    dialogCalendarState.referenceDate = startOfMonth(parsed);
  } else if (!normalized) {
    dialogCalendarState.referenceDate = startOfMonth(new Date());
  }
  renderScheduleDialogCalendar();
}

function renderScheduleDialogCalendar() {
  const grid = dom.scheduleDialogCalendarGrid;
  const title = dom.scheduleDialogCalendarTitle;
  if (!grid || !title) return;

  const referenceMonth = startOfMonth(
    dialogCalendarState.referenceDate instanceof Date ? dialogCalendarState.referenceDate : new Date()
  );
  dialogCalendarState.referenceDate = referenceMonth;

  title.textContent = formatMonthTitle(referenceMonth);

  const today = startOfDay(new Date());
  const firstVisible = startOfDay(new Date(referenceMonth));
  firstVisible.setDate(firstVisible.getDate() - firstVisible.getDay());

  grid.innerHTML = "";

  for (let index = 0; index < 42; index++) {
    const cellDate = new Date(firstVisible);
    cellDate.setDate(firstVisible.getDate() + index);

    const key = formatDatePart(cellDate);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dialog-calendar-date";
    button.dataset.date = key;
    button.setAttribute("aria-label", `${key} を選択`);
    button.setAttribute("role", "gridcell");

    if (cellDate.getMonth() !== referenceMonth.getMonth()) {
      button.classList.add("is-outside");
    }
    if (isSameDay(cellDate, today)) {
      button.classList.add("is-today");
    }
    if (dialogCalendarState.selectedDate && dialogCalendarState.selectedDate === key) {
      button.classList.add("is-selected");
    }

    const label = document.createElement("span");
    label.textContent = String(cellDate.getDate());
    button.appendChild(label);

    button.addEventListener("click", () => {
      setCalendarPickedDate(key);
      if (dom.scheduleDateInput) {
        dom.scheduleDateInput.focus();
      }
    });

    grid.appendChild(button);
  }
}

function shiftScheduleDialogCalendarMonth(offset) {
  if (!offset) return;
  const base = startOfMonth(
    dialogCalendarState.referenceDate instanceof Date ? dialogCalendarState.referenceDate : new Date()
  );
  base.setMonth(base.getMonth() + offset);
  dialogCalendarState.referenceDate = base;
  renderScheduleDialogCalendar();
}

function prepareScheduleDialogCalendar(initialValue) {
  const normalized = normalizeDateInputValue(initialValue);
  if (normalized) {
    const parsed = parseDateOnly(normalized);
    if (parsed) {
      dialogCalendarState.referenceDate = startOfMonth(parsed);
    }
  } else {
    dialogCalendarState.referenceDate = startOfMonth(new Date());
  }
  dialogCalendarState.selectedDate = normalized;
  renderScheduleDialogCalendar();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long"
});

function formatMonthTitle(date) {
  return monthFormatter.format(date);
}

function getSchedulePrimaryDate(schedule) {
  if (!schedule) return null;
  const start = parseDateTimeLocal(schedule.startAt || "");
  if (start) return start;
  const dateOnly = parseDateOnly(schedule.date || "");
  if (dateOnly) return dateOnly;
  const end = parseDateTimeLocal(schedule.endAt || "");
  return end || null;
}

function describeScheduleRange(schedule) {
  if (!schedule) return "";
  const start = parseDateTimeLocal(schedule.startAt || "");
  const end = parseDateTimeLocal(schedule.endAt || "");
  const baseDate = String(schedule.date || "").trim();
  if (start && end) {
    const startDate = formatDatePart(start);
    const endDate = formatDatePart(end);
    const startText = `${startDate} ${formatTimePart(start)}`;
    const endTimeText = formatTimePart(end);
    const endText = startDate === endDate ? endTimeText : `${endDate} ${endTimeText}`;
    return `${startText}〜${endText}`;
  }
  if (start) {
    return `${formatDatePart(start)} ${formatTimePart(start)}〜`;
  }
  if (end) {
    return `${formatDatePart(end)} ${formatTimePart(end)}まで`;
  }
  if (baseDate) {
    return `日程: ${baseDate}`;
  }
  return "";
}

function syncScheduleEndMin() {
  if (!dom.scheduleStartTimeInput || !dom.scheduleEndTimeInput) return;
  dom.scheduleEndTimeInput.removeAttribute("min");
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
    if (entry.token) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-link-btn";
      button.dataset.token = entry.token;
      button.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M6.25 1.75A2.25 2.25 0 0 0 4 4v7A2.25 2.25 0 0 0 6.25 13.25h4A2.25 2.25 0 0 0 12.5 11V4A2.25 2.25 0 0 0 10.25 1.75h-4Zm0 1.5h4c.414 0 .75.336.75.75v7c0 .414-.336.75-.75.75h-4a.75.75 0 0 1-.75-.75V4c0-.414.336-.75.75-.75ZM3 4.75A.75.75 0 0 0 2.25 5.5v7A2.25 2.25 0 0 0 4.5 14.75h4a.75.75 0 0 0 0-1.5h-4a.75.75 0 0 1-.75-.75v-7A.75.75 0 0 0 3 4.75Z\" fill=\"currentColor\"/></svg><span>コピー</span>";
      linkTd.appendChild(button);
    } else {
      const placeholder = document.createElement("span");
      placeholder.textContent = "-";
      linkTd.appendChild(placeholder);
    }

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "edit-link-btn";
    editButton.dataset.participantId = entry.participantId;
    editButton.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg><span>編集</span>";
    linkTd.appendChild(editButton);

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
    return;
  }

  if (dom.csvInput) dom.csvInput.disabled = false;
  if (dom.teamCsvInput) dom.teamCsvInput.disabled = false;
  if (dom.participantContext) {
    const scheduleName = selectedSchedule.label || selectedSchedule.id;
    const scheduleRange = describeScheduleRange(selectedSchedule);
    const rangeSuffix = scheduleRange ? `（${scheduleRange}）` : "";
    dom.participantContext.textContent = `イベント「${selectedEvent.name}」/ 日程「${scheduleName}」${rangeSuffix}の参加者を管理しています。専用リンクは各行の「コピー」から取得できます。`;
  }
  if (!preserveStatus) {
    setUploadStatus("ファイルを選択して参加者リストを更新してください。");
  }
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
      const entries = assignParticipantIds(parseParticipantRows(rows), state.participants);
      const existingMap = new Map(state.participants.map(entry => [entry.participantId, entry]));
      state.participants = sortParticipants(entries.map(entry => {
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
      }));
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

function handleTeamCsvChange(event) {
  const files = event.target.files;
  if (!files || !files.length) {
    return;
  }

  const file = files[0];
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const eventId = state.selectedEventId;
      if (!eventId) {
        throw new Error("イベントを選択してください。");
      }
      const text = String(e.target.result || "");
      const rows = parseCsv(text);
      const assignments = parseTeamAssignmentRows(rows);
      const scheduleId = state.selectedScheduleId;
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
  };
  reader.onerror = () => {
    setUploadStatus("班番号CSVの読み込みに失敗しました。", "error");
    if (dom.teamCsvInput) {
      dom.teamCsvInput.value = "";
    }
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

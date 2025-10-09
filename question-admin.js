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
  csvInput: document.getElementById("csv-input"),
  saveButton: document.getElementById("save-button"),
  uploadStatus: document.getElementById("upload-status"),
  fileLabel: document.getElementById("file-label"),
  mappingTbody: document.getElementById("mapping-tbody"),
  adminSummary: document.getElementById("admin-summary"),
  copyrightYear: document.getElementById("copyright-year")
};

const state = {
  entries: [],
  lastSavedSignature: "",
  user: null
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

function normalizeNameForLookup(value) {
  return normalizeKey(value).replace(/[\u200B-\u200D\uFEFF]/g, "");
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

function buildEntriesFromRows(rows) {
  if (!rows.length) {
    throw new Error("CSVにデータがありません。");
  }

  const headerCandidate = rows[0].map(cell => cell.toLowerCase());
  const hasHeader = headerCandidate.some(cell => /ラジオ|radio|name|班|group/.test(cell));

  let dataRows = rows;
  let nameIndex = 0;
  let groupIndex = 1;

  if (hasHeader) {
    const findIndex = (keywords, fallback) => {
      for (const keyword of keywords) {
        const idx = headerCandidate.findIndex(cell => cell.includes(keyword));
        if (idx !== -1) return idx;
      }
      return fallback;
    };
    nameIndex = findIndex(["ラジオ", "radio", "name", "名前"], 0);
    groupIndex = findIndex(["班", "group", "number", "番号"], 1);
    dataRows = rows.slice(1);
  }

  const entries = [];
  const seen = new Set();
  dataRows.forEach(row => {
    if (!row) return;
    const name = normalizeKey(row[nameIndex]);
    const group = normalizeKey(row[groupIndex]);
    if (!name || !group) return;
    const lookup = normalizeNameForLookup(name);
    if (seen.has(lookup)) return;
    seen.add(lookup);
    entries.push({ name, groupNumber: group });
  });

  return entries;
}

function setUploadStatus(message, variant = "idle") {
  if (!dom.uploadStatus) return;
  dom.uploadStatus.textContent = message;
  dom.uploadStatus.classList.remove("status-pill--success", "status-pill--error");
  if (variant === "success") {
    dom.uploadStatus.classList.add("status-pill--success");
  } else if (variant === "error") {
    dom.uploadStatus.classList.add("status-pill--error");
  }
}

function renderTable(entries) {
  if (!dom.mappingTbody) return;
  dom.mappingTbody.textContent = "";
  const fragment = document.createDocumentFragment();
  entries.forEach(entry => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.textContent = entry.name;
    const groupTd = document.createElement("td");
    groupTd.textContent = entry.groupNumber;
    tr.append(nameTd, groupTd);
    fragment.appendChild(tr);
  });
  dom.mappingTbody.appendChild(fragment);
}

function signature(entries) {
  return JSON.stringify(entries);
}

function updateSummary(entries, source) {
  if (!dom.adminSummary) return;
  const count = entries.length;
  const sourceLabel = source === "upload" ? "CSVファイル" : "スプレッドシート";
  dom.adminSummary.textContent = `登録件数: ${count}件（表示中: ${sourceLabel}）`;
}

function showLoggedOutUi() {
  dom.loginCard?.removeAttribute("hidden");
  dom.adminMain?.setAttribute("hidden", "true");
  dom.headerLogout?.setAttribute("hidden", "true");
  state.entries = [];
  renderTable([]);
  updateSummary([], "server");
  setUploadStatus("班番号リストは未読み込みです。");
  if (dom.saveButton) {
    dom.saveButton.disabled = true;
  }
}

async function loadFromServer() {
  try {
    setUploadStatus("スプレッドシートから読み込んでいます…");
    const result = await api.apiPost({ action: "fetchNameMappings" });
    const entries = Array.isArray(result.mappings)
      ? result.mappings.map(item => ({
          name: normalizeKey(item.name),
          groupNumber: normalizeKey(item.groupNumber)
        }))
      : [];
    state.entries = entries;
    state.lastSavedSignature = signature(entries);
    renderTable(entries);
    updateSummary(entries, "server");
    if (dom.fileLabel) {
      dom.fileLabel.textContent = "CSVファイルを選択";
    }
    if (entries.length) {
      setUploadStatus(`スプレッドシートから${entries.length}件読み込みました。`, "success");
    } else {
      setUploadStatus("スプレッドシートに登録がありません。");
    }
    if (dom.saveButton) {
      dom.saveButton.disabled = true;
    }
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "スプレッドシートの読み込みに失敗しました。", "error");
  }
}

async function saveEntries() {
  try {
    setUploadStatus("スプレッドシートを更新しています…");
    const payload = { entries: state.entries };
    await api.apiPost({ action: "saveNameMappings", ...payload });
    setUploadStatus(`スプレッドシートを更新しました。（${state.entries.length}件）`, "success");
    await loadFromServer();
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "更新に失敗しました。", "error");
  }
}

async function handleCsvImport(file) {
  if (!file) return;
  try {
    setUploadStatus("CSVファイルを解析しています…");
    const text = await file.text();
    const rows = parseCsv(text);
    const entries = buildEntriesFromRows(rows);
    state.entries = entries;
    renderTable(entries);
    updateSummary(entries, "upload");
    const sig = signature(entries);
    dom.saveButton.disabled = sig === state.lastSavedSignature;
    if (entries.length) {
      setUploadStatus(`CSVから${entries.length}件読み込みました。`, "success");
    } else {
      setUploadStatus("有効なデータがありません。保存するとリストが空になります。", "error");
    }
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || "CSVの読み込みに失敗しました。", "error");
    dom.saveButton.disabled = true;
  }
}

async function ensureAdminAccess() {
  try {
    await api.apiPost({ action: "ensureAdmin" });
    return true;
  } catch (error) {
    console.error("ensureAdmin failed", error);
    setUploadStatus("このアカウントには管理権限がありません。", "error");
    await signOut(auth);
    alert("このアカウントは管理者として登録されていません。別のアカウントでお試しください。");
    return false;
  }
}

function setCopyrightYear() {
  if (dom.copyrightYear) {
    dom.copyrightYear.textContent = new Date().getFullYear().toString();
  }
}

function registerEventListeners() {
  dom.loginButton?.addEventListener("click", async () => {
    try {
      dom.loginButton.disabled = true;
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
    } finally {
      dom.loginButton.disabled = false;
    }
  });

  const logout = () => signOut(auth).catch(error => console.error(error));
  dom.logoutButton?.addEventListener("click", logout);
  dom.headerLogout?.addEventListener("click", logout);

  dom.refreshButton?.addEventListener("click", () => loadFromServer());

  dom.csvInput?.addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    dom.fileLabel.textContent = file.name;
    handleCsvImport(file);
    event.target.value = "";
  });

  dom.saveButton?.addEventListener("click", () => {
    if (!state.entries.length && state.lastSavedSignature === "[]") {
      if (!confirm("登録が0件になります。よろしいですか？")) {
        return;
      }
    }
    saveEntries();
  });
}

function showLoggedInUi() {
  dom.loginCard?.setAttribute("hidden", "true");
  dom.adminMain?.removeAttribute("hidden");
  dom.headerLogout?.removeAttribute("hidden");
}

onAuthStateChanged(auth, async user => {
  state.user = user;
  if (!user) {
    showLoggedOutUi();
    return;
  }
  showLoggedInUi();
  setUploadStatus("権限を確認しています…");
  const ok = await ensureAdminAccess();
  if (!ok) return;
  await loadFromServer();
});

registerEventListeners();
setCopyrightYear();
updateSummary([], "server");

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  remove,
  get,
  onValue,
  off
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

const firebaseConfig = {
  apiKey: "AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY",
  authDomain: "subtitle-output-system-9bc14.firebaseapp.com",
  databaseURL: "https://subtitle-output-system-9bc14-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "subtitle-output-system-9bc14",
  storageBucket: "subtitle-output-system-9bc14.firebasestorage.app",
  messagingSenderId: "378400426909",
  appId: "1:378400426909:web:f1549aad61e3f7aacebd74"
};

const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxYtklsVbr2OmtaMISPMw0x2u0shjiUdwkym2oTZW7Xk14pcWxXG1lTcVC2GZAzjobapQ/exec";
const STEP_LABELS = [
  "認証",
  "在籍チェック",
  "管理者付与",
  "初期ミラー",
  "購読開始",
  "辞書取得",
  "ログ取得",
  "準備完了"
];

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = initializeAuth(app, {
  persistence: browserSessionPersistence,
  popupRedirectResolver: browserPopupRedirectResolver
});
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const renderRef = ref(database, "render_state");
const displaySessionRef = ref(database, "render_control/session");
const questionsRef = ref(database, "questions");
const telopRef = ref(database, "currentTelop");
const updateTriggerRef = ref(database, "update_trigger");
const dictionaryRef = ref(database, "dictionary");
const DICTIONARY_STATE_KEY = "telop-ops-dictionary-open";

function createInitialState(autoScroll = true) {
  return {
    allQuestions: [],
    allLogs: [],
    currentMainTab: "questions",
    currentSubTab: "normal",
    selectedRowData: null,
    lastDisplayedUid: null,
    autoScrollLogs: autoScroll,
    displaySession: null,
    displaySessionActive: false,
    displaySessionLastActive: null
  };
}

function escapeHtml(value) {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeUpdatedAt(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

function formatRelative(ms) {
  if (!ms) return "—";
  const diff = Math.max(0, Date.now() - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

function normKey(key) {
  return String(key || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function parseLogTimestamp(ts) {
  if (ts == null) return null;
  if (ts instanceof Date && !isNaN(ts)) return ts;
  if (typeof ts === "number") {
    if (ts > 1e12) return new Date(ts);
    if (ts > 1e10) return new Date(ts * 1000);
    const ms = (ts - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof ts === "string") {
    let s = ts.trim();
    if (!s) return null;
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
      const [dPart, tPart = "00:00:00"] = s.split(" ");
      const [y, m, d] = dPart.split("/").map(Number);
      const [hh = 0, mm = 0, ss = 0] = tPart.split(":").map(Number);
      return new Date(y, m - 1, d, hh, mm, ss);
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
      s = s.replace(" ", "T");
    }
    const date = new Date(s);
    if (!isNaN(date)) return date;
  }
  return null;
}

function getLogLevel(log) {
  const action = String(log.Action || "").toLowerCase();
  const details = String(log.Details || "").toLowerCase();
  if (/(error|failed|exception|timeout|unauthorized|forbidden|denied)/.test(action + details)) return "error";
  if (/\b5\d{2}\b|\b4\d{2}\b/.test(details)) return "error";
  if (/(delete|clear|remove|reset|unanswer)/.test(action)) return "warn";
  if (/(display|send|answer|set_answered|batch_set_answered|edit|add|toggle|update)/.test(action)) return "success";
  if (/(fetch|read|log|whoami)/.test(action)) return "info";
  return "info";
}

function createApiClient(authInstance) {
  async function getIdTokenSafe(force = false) {
    const user =
      authInstance.currentUser ||
      (await new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(authInstance, (u) => {
          unsubscribe();
          resolve(u);
        });
      }));
    if (!user) throw new Error("Not signed in");
    return await user.getIdToken(force);
  }

  async function apiPost(payload, retryOnAuthError = true) {
    const idToken = await getIdTokenSafe();
    const res = await fetch(GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...payload, idToken })
    });
    let json;
    try {
      json = await res.json();
    } catch (error) {
      throw new Error("Bad JSON response");
    }
    if (!json.success) {
      const message = String(json.error || "");
      if (retryOnAuthError && /Auth/.test(message)) {
        await getIdTokenSafe(true);
        return await apiPost(payload, false);
      }
      throw new Error(`${message}${json.errorId ? " [" + json.errorId + "]" : ""}`);
    }
    return json;
  }

  function fireAndForgetApi(payload) {
    apiPost(payload).catch((error) => {
      console.warn("API fire-and-forget failed", error);
    });
  }

  async function logAction(actionName, details = "") {
    try {
      await apiPost({
        action: "logAction",
        action_type: actionName,
        details
      });
    } catch (error) {
      console.error("Failed to write log:", error);
    }
  }

  return { apiPost, fireAndForgetApi, logAction };
}

function showToast(message, type = "success") {
  const backgroundColor =
    type === "success"
      ? "linear-gradient(to right, #4CAF50, #77dd77)"
      : "linear-gradient(to right, #f06595, #ff6b6b)";
  const safeMessage = escapeHtml(String(message ?? ""));
  Toastify({
    text: safeMessage,
    duration: 3000,
    close: true,
    gravity: "top",
    position: "right",
    stopOnFocus: true,
    style: { background: backgroundColor },
    className: `toastify-${type}`
  }).showToast();
}

class OperatorApp {
  constructor() {
    this.dom = {
      loginButton: document.getElementById("login-button"),
      loginContainer: document.getElementById("login-container"),
      mainContainer: document.getElementById("main-container"),
      actionPanel: document.getElementById("action-panel"),
      userInfo: document.getElementById("user-info"),
      dictionaryToggle: document.getElementById("dictionary-toggle"),
      dictionaryPanel: document.getElementById("dictionary-panel"),
      cardsContainer: document.getElementById("questions-cards"),
      dictionaryTableBody: document.querySelector("#dictionary-table tbody"),
      logsTableBody: document.querySelector("#logs-table tbody"),
      addTermForm: document.getElementById("add-term-form"),
      newTermInput: document.getElementById("new-term"),
      newRubyInput: document.getElementById("new-ruby"),
      actionButtons: ["btn-display", "btn-unanswer", "btn-edit"].map((id) => document.getElementById(id)),
      selectedInfo: document.getElementById("selected-info"),
      selectAllCheckbox: document.getElementById("select-all-checkbox"),
      batchUnanswerBtn: document.getElementById("btn-batch-unanswer"),
      clearButton: document.getElementById("btn-clear"),
      manualUpdateButton: document.getElementById("manual-update-button"),
      fetchDictionaryButton: document.getElementById("fetch-dictionary-button"),
      logSearch: document.getElementById("log-search"),
      logAutoscroll: document.getElementById("log-autoscroll"),
      logStream: document.getElementById("log-stream"),
      logsStreamView: document.getElementById("logs-stream-view"),
      loadingOverlay: document.getElementById("loading-overlay"),
      loadingText: document.getElementById("loading-text"),
      loaderSteps: document.getElementById("loader-steps"),
      render: {
        indicator: document.querySelector(".render-indicator"),
        lamp: document.getElementById("render-lamp"),
        phase: document.getElementById("render-phase"),
        summary: document.getElementById("render-summary"),
        title: document.getElementById("render-title"),
        question: document.getElementById("render-question"),
        updated: document.getElementById("render-updated")
      }
    };

    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);

    this.api = createApiClient(auth);

    this.lastUpdatedAt = 0;
    this.renderTicker = null;
    this.questionsUnsubscribe = null;
    this.displaySessionUnsubscribe = null;
    this.updateTriggerUnsubscribe = null;
    this.renderUnsubscribe = null;
    this.logsUpdateTimer = null;
    this.authFlow = "idle";
    this.pendingAuthUser = null;
    this.isAuthorized = false;
    this.dictionaryLoaded = false;
    this.preferredDictionaryOpen = false;

    this.handleRenderUpdate = this.handleRenderUpdate.bind(this);
    this.login = this.login.bind(this);
    this.logout = this.logout.bind(this);
    this.handleDisplay = this.handleDisplay.bind(this);
    this.handleUnanswer = this.handleUnanswer.bind(this);
    this.handleEdit = this.handleEdit.bind(this);
    this.clearTelop = this.clearTelop.bind(this);
    this.handleSelectAll = this.handleSelectAll.bind(this);
    this.handleBatchUnanswer = this.handleBatchUnanswer.bind(this);
    this.switchMainTab = this.switchMainTab.bind(this);
    this.switchSubTab = this.switchSubTab.bind(this);
    this.fetchDictionary = this.fetchDictionary.bind(this);
    this.fetchLogs = this.fetchLogs.bind(this);
    this.addTerm = this.addTerm.bind(this);
    this.toggleDictionaryDrawer = this.toggleDictionaryDrawer.bind(this);
  }

  init() {
    this.setupEventListeners();
    this.updateActionAvailability();
    this.attachRenderMonitor();
    this.applyInitialDictionaryState();
    onAuthStateChanged(auth, (user) => {
      if (this.authFlow === "prompting") {
        this.pendingAuthUser = user || null;
        return;
      }
      this.handleAuthState(user);
    });
  }

  setupEventListeners() {
    this.dom.loginButton?.addEventListener("click", this.login);
    document.querySelectorAll(".main-tab-button").forEach((button) => {
      button.addEventListener("click", () => this.switchMainTab(button.dataset.tab));
    });
    document.querySelectorAll(".sub-tab-button").forEach((button) => {
      button.addEventListener("click", () => this.switchSubTab(button.dataset.subTab));
    });
    this.dom.dictionaryToggle?.addEventListener("click", () => this.toggleDictionaryDrawer());
    this.dom.manualUpdateButton?.addEventListener("click", this.fetchLogs);
    this.dom.actionButtons[0]?.addEventListener("click", this.handleDisplay);
    this.dom.actionButtons[1]?.addEventListener("click", this.handleUnanswer);
    this.dom.actionButtons[2]?.addEventListener("click", this.handleEdit);
    this.dom.clearButton?.addEventListener("click", this.clearTelop);
    this.dom.fetchDictionaryButton?.addEventListener("click", this.fetchDictionary);
    this.dom.addTermForm?.addEventListener("submit", this.addTerm);
    this.dom.selectAllCheckbox?.addEventListener("change", this.handleSelectAll);
    this.dom.batchUnanswerBtn?.addEventListener("click", this.handleBatchUnanswer);
    this.dom.cardsContainer?.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.classList.contains("row-checkbox")) {
        this.updateBatchButtonVisibility();
      }
    });
    if (this.dom.logSearch) {
      this.dom.logSearch.addEventListener("input", () => this.renderLogs());
    }
    if (this.dom.logAutoscroll) {
      this.dom.logAutoscroll.addEventListener("change", (event) => {
        this.state.autoScrollLogs = event.target.checked;
      });
    }
  }

  attachRenderMonitor() {
    if (this.renderUnsubscribe) {
      this.renderUnsubscribe();
    }
    this.renderUnsubscribe = onValue(renderRef, this.handleRenderUpdate, (error) => {
      console.error("Failed to monitor render state:", error);
    });
  }

  handleRenderUpdate(snapshot) {
    const value = snapshot.val() || {};
    this.setLamp(value.phase);
    const isHidden = value.phase === "hidden";
    const now = isHidden ? null : value.nowShowing || null;
    if (!now) {
      if (this.dom.render.title) this.dom.render.title.textContent = "（非表示）";
      if (this.dom.render.question) this.dom.render.question.textContent = "";
    } else {
      const name = (now.name || "").trim();
      if (this.dom.render.title) {
        this.dom.render.title.textContent =
          name === "Pick Up Question" ? name : `ラジオネーム：${name}`;
      }
      if (this.dom.render.question) {
        this.dom.render.question.textContent = String(now.question || "").replace(/\s+/g, " ").trim();
      }
    }

    const updatedAt = normalizeUpdatedAt(value.updatedAt) || 0;
    const previous = this.lastUpdatedAt || 0;
    this.lastUpdatedAt = updatedAt;
    this.redrawUpdatedAt();
    if (updatedAt > previous) {
      this.dom.render.summary?.classList.add("is-updated");
      this.dom.render.indicator?.classList.add("is-updated");
      setTimeout(() => {
        this.dom.render.summary?.classList.remove("is-updated");
        this.dom.render.indicator?.classList.remove("is-updated");
      }, 800);
    }
    if (!this.renderTicker) {
      this.renderTicker = setInterval(() => {
        this.redrawUpdatedAt();
        this.refreshStaleness();
      }, 1000);
    }
    this.refreshStaleness();
  }

  setLamp(phase) {
    if (!this.dom.render.lamp) return;
    this.dom.render.lamp.className = "lamp";
    switch (phase) {
      case "visible":
        this.dom.render.lamp.classList.add("is-visible");
        break;
      case "showing":
      case "hiding":
        this.dom.render.lamp.classList.add("is-showing");
        break;
      case "hidden":
        this.dom.render.lamp.classList.add("is-hidden");
        break;
      case "error":
        this.dom.render.lamp.classList.add("is-error");
        break;
      default:
        this.dom.render.lamp.classList.add("is-hidden");
        break;
    }
    if (this.dom.render.phase) {
      this.dom.render.phase.textContent = phase || "-";
    }
  }

  redrawUpdatedAt() {
    if (!this.dom.render.updated) return;
    if (!this.lastUpdatedAt) {
      this.dom.render.updated.textContent = "—";
      return;
    }
    const timeText = new Date(this.lastUpdatedAt).toLocaleTimeString("ja-JP", { hour12: false });
    this.dom.render.updated.textContent = `${timeText}（${formatRelative(this.lastUpdatedAt)}）`;
  }

  refreshStaleness() {
    if (!this.dom.render.indicator) return;
    if (!this.lastUpdatedAt) {
      this.dom.render.indicator.classList.remove("is-stale");
      return;
    }
    const age = Date.now() - this.lastUpdatedAt;
    if (Number.isFinite(age) && age >= 30000) {
      this.dom.render.indicator.classList.add("is-stale");
    } else {
      this.dom.render.indicator.classList.remove("is-stale");
    }
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
      console.error("Login failed:", error);
      showToast("ログインに失敗しました。", "error");
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
      console.error("Logout failed:", error);
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
      this.showLoader("権限を確認しています…");
      this.initLoaderSteps();
      this.setLoaderStep(0, "認証OK。ユーザー情報を確認中…");
      const result = await this.api.apiPost({ action: "fetchSheet", sheet: "users" });
      this.setLoaderStep(1, "在籍チェック中…");
      if (!result.success || !result.data) {
        throw new Error("ユーザー権限の確認に失敗しました。");
      }
      const authorizedUsers = result.data
        .map((item) => String(item["メールアドレス"] || "").trim().toLowerCase())
        .filter(Boolean);
      const loginEmail = String(user.email || "").trim().toLowerCase();
      if (!authorizedUsers.includes(loginEmail)) {
        showToast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", "error");
        await this.logout();
        this.hideLoader();
        return;
      }

      this.setLoaderStep(2, "管理者権限の確認/付与…");
      try {
        await this.api.apiPost({ action: "ensureAdmin" });
      } catch (error) {
        console.warn("ensureAdmin non-fatal", error);
      }

      this.renderLoggedInUi(user);
      this.setLoaderStep(3, "初期ミラー実行中…");
      this.updateLoader("初期データを準備しています…");
      try {
        const snapshot = await get(questionsRef);
        if (!snapshot.exists()) {
          await this.api.apiPost({ action: "mirrorSheet" });
        }
      } catch (error) {
        console.warn("mirrorSheet skipped", error);
      }

      this.setLoaderStep(4, "購読開始…");
      this.updateLoader("データ同期中…");
      const firstSnapshot = await get(questionsRef);
      const firstValue = firstSnapshot.val() || {};
      this.state.allQuestions = Object.values(firstValue).map((item) => ({
        UID: item.uid,
        班番号: item.group ?? "",
        ラジオネーム: item.name,
        "質問・お悩み": item.question,
        回答済: !!item.answered,
        選択中: !!item.selecting,
        __ts: Number(item.ts || 0)
      }));
      await this.renderQuestions();
      this.startQuestionsStream();
      this.startDisplaySessionMonitor();
      this.setLoaderStep(5, "辞書取得…");
      await this.fetchDictionary();
      if (this.preferredDictionaryOpen) {
        this.toggleDictionaryDrawer(true, false);
      } else {
        this.toggleDictionaryDrawer(false, false);
      }
      this.setLoaderStep(6, "ログ取得…");
      await this.fetchLogs();
      this.finishLoaderSteps("準備完了");
      this.hideLoader();
      showToast(`ようこそ、${user.displayName || ""}さん`, "success");
      this.startLogsUpdateMonitor();
    } catch (error) {
      console.error("Authorization check failed:", error);
      showToast("ユーザー権限の確認中にエラーが発生しました。", "error");
      await this.logout();
      this.hideLoader();
    }
  }

  renderLoggedInUi(user) {
    if (this.dom.loginContainer) this.dom.loginContainer.style.display = "none";
    if (this.dom.mainContainer) this.dom.mainContainer.style.display = "";
    if (this.dom.actionPanel) this.dom.actionPanel.style.display = "flex";
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
      logoutButton.addEventListener("click", this.logout);
      this.dom.userInfo.append(label, logoutButton);
    }
  }

  showLoggedOutState() {
    if (this.dom.loginContainer) this.dom.loginContainer.style.display = "block";
    if (this.dom.mainContainer) this.dom.mainContainer.style.display = "none";
    if (this.dom.actionPanel) this.dom.actionPanel.style.display = "none";
    if (this.dom.userInfo) this.dom.userInfo.innerHTML = "";
    this.isAuthorized = false;
    this.dictionaryLoaded = false;
    this.toggleDictionaryDrawer(false, false);
    this.cleanupRealtime();
    this.hideLoader();
  }

  cleanupRealtime() {
    if (this.questionsUnsubscribe) {
      this.questionsUnsubscribe();
      this.questionsUnsubscribe = null;
    }
    if (this.displaySessionUnsubscribe) {
      this.displaySessionUnsubscribe();
      this.displaySessionUnsubscribe = null;
    }
    if (this.updateTriggerUnsubscribe) {
      this.updateTriggerUnsubscribe();
      this.updateTriggerUnsubscribe = null;
    }
    if (this.renderTicker) {
      clearInterval(this.renderTicker);
      this.renderTicker = null;
    }
    this.logsUpdateTimer && clearTimeout(this.logsUpdateTimer);
    this.logsUpdateTimer = null;
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    if (this.dom.selectAllCheckbox) this.dom.selectAllCheckbox.checked = false;
    this.updateActionAvailability();
    this.updateBatchButtonVisibility();
    if (this.dom.cardsContainer) this.dom.cardsContainer.innerHTML = "";
    if (this.dom.logStream) this.dom.logStream.innerHTML = "";
  }

  startQuestionsStream() {
    if (this.questionsUnsubscribe) this.questionsUnsubscribe();
    this.questionsUnsubscribe = onValue(questionsRef, (snapshot) => {
      const value = snapshot.val() || {};
      this.state.allQuestions = Object.values(value).map((item) => ({
        UID: item.uid,
        班番号: item.group ?? "",
        ラジオネーム: item.name,
        "質問・お悩み": item.question,
        回答済: !!item.answered,
        選択中: !!item.selecting,
        __ts: Number(item.ts || 0)
      }));
      this.renderQuestions();
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
        this.state.displaySession = data;
        this.state.displaySessionActive = active;
        if (this.state.displaySessionLastActive !== null && this.state.displaySessionLastActive !== active) {
          showToast(
            active ? "表示端末とのセッションが確立されました。" : "表示端末の接続が確認できません。",
            active ? "success" : "error"
          );
        }
        this.state.displaySessionLastActive = active;
        this.updateActionAvailability();
        this.updateBatchButtonVisibility();
      },
      (error) => {
        console.error("Failed to monitor display session:", error);
      }
    );
  }

  startLogsUpdateMonitor() {
    if (this.updateTriggerUnsubscribe) this.updateTriggerUnsubscribe();
    this.updateTriggerUnsubscribe = onValue(updateTriggerRef, (snapshot) => {
      if (!snapshot.exists()) return;
      if (this.logsUpdateTimer) clearTimeout(this.logsUpdateTimer);
      this.logsUpdateTimer = setTimeout(() => this.fetchLogs(), 150);
    });
  }

  async fetchDictionary() {
    try {
      const result = await this.api.apiPost({ action: "fetchSheet", sheet: "dictionary" });
      if (!result.success) return;
      if (this.dom.dictionaryTableBody) this.dom.dictionaryTableBody.innerHTML = "";
      (result.data || []).forEach((item) => {
        const tr = document.createElement("tr");
        const toggleBtn = document.createElement("button");
        toggleBtn.textContent = item.enabled ? "無効にする" : "有効にする";
        toggleBtn.type = "button";
        toggleBtn.className = "btn btn-ghost btn-sm";
        toggleBtn.addEventListener("click", () => this.toggleTerm(item.term, !item.enabled));
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "削除";
        deleteBtn.type = "button";
        deleteBtn.className = "btn btn-danger btn-sm";
        deleteBtn.addEventListener("click", () => this.deleteTerm(item.term));
        tr.innerHTML = `
          <td>${escapeHtml(item.term)}</td>
          <td>${escapeHtml(item.ruby)}</td>
          <td>${item.enabled ? "有効" : "無効"}</td>
        `;
        const actionTd = document.createElement("td");
        actionTd.className = "table-actions";
        actionTd.append(toggleBtn, deleteBtn);
        tr.appendChild(actionTd);
        if (!item.enabled) tr.classList.add("disabled");
        this.dom.dictionaryTableBody?.appendChild(tr);
      });
      this.dictionaryLoaded = true;
      const enabledOnly = (result.data || []).filter((item) => item.enabled === true);
      await set(dictionaryRef, enabledOnly);
    } catch (error) {
      alert("辞書の取得に失敗: " + error.message);
    }
  }

  async fetchLogs() {
    try {
      const result = await this.api.apiPost({ action: "fetchSheet", sheet: "logs" });
      if (result.success) {
        this.state.allLogs = result.data || [];
        this.renderLogs();
      }
    } catch (error) {
      console.error("ログの取得に失敗:", error);
    }
  }

  renderLogs() {
    const rows = this.applyLogFilters(this.state.allLogs || []);
    this.renderLogsStream(rows);
  }

  applyLogFilters(logs) {
    const query = (this.dom.logSearch?.value || "").trim().toLowerCase();
    if (!query) return logs;
    return logs.filter((row) => {
      const rawTs = row.Timestamp ?? row.timestamp ?? row["時刻"] ?? row["タイムスタンプ"] ?? "";
      const tsText = (parseLogTimestamp(rawTs)?.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) || String(rawTs)).toLowerCase();
      const user = String(row.User ?? row.user ?? row["ユーザー"] ?? "").toLowerCase();
      const action = String(row.Action ?? row.action ?? row["アクション"] ?? "").toLowerCase();
      const details = String(row.Details ?? row.details ?? row["詳細"] ?? "").toLowerCase();
      const level = getLogLevel(row).toLowerCase();
      return tsText.includes(query) || user.includes(query) || action.includes(query) || details.includes(query) || level.includes(query);
    });
  }

  renderLogsStream(rows) {
    if (!this.dom.logStream) return;
    const max = 500;
    const viewRows = rows.slice(-max);
    this.dom.logStream.innerHTML = "";
    for (const log of viewRows) {
      const rawTs = log.Timestamp ?? log.timestamp ?? log["時刻"] ?? log["タイムスタンプ"] ?? "";
      const d = parseLogTimestamp(rawTs);
      const tsText = d ? d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : String(rawTs || "");
      const user = String(log.User ?? "");
      const action = String(log.Action ?? "");
      const details = String(log.Details ?? "");
      const level = getLogLevel(log);
      const line = document.createElement("div");
      line.className = `log-line lvl-${level}`;
      line.innerHTML =
        `<span class="ts">[${escapeHtml(tsText)}]</span> ` +
        `<span class="badge level ${escapeHtml(level)}">${escapeHtml(level.toUpperCase())}</span> ` +
        `<span class="badge user">@${escapeHtml(user)}</span> ` +
        `<span class="badge action">${escapeHtml(action.toUpperCase())}</span> ` +
        `<span class="details">${escapeHtml(details)}</span>`;
      this.dom.logStream.appendChild(line);
    }
    if (this.state.autoScrollLogs) {
      this.dom.logStream.scrollTop = this.dom.logStream.scrollHeight;
    }
  }

  applyInitialDictionaryState() {
    let saved = "0";
    try {
      saved = localStorage.getItem(DICTIONARY_STATE_KEY) || "0";
    } catch (error) {
      saved = "0";
    }
    this.preferredDictionaryOpen = saved === "1";
    this.toggleDictionaryDrawer(false, false);
  }

  toggleDictionaryDrawer(force, persist = true) {
    const body = document.body;
    if (!body) return;
    const currentOpen = body.classList.contains("dictionary-open");
    const nextOpen = typeof force === "boolean" ? force : !currentOpen;
    body.classList.toggle("dictionary-open", nextOpen);
    body.classList.toggle("dictionary-collapsed", !nextOpen);
    if (this.dom.dictionaryPanel) {
      if (nextOpen) {
        this.dom.dictionaryPanel.removeAttribute("hidden");
      } else {
        this.dom.dictionaryPanel.setAttribute("hidden", "");
      }
    }
    if (this.dom.dictionaryToggle) {
      this.dom.dictionaryToggle.setAttribute("aria-expanded", String(nextOpen));
      this.dom.dictionaryToggle.setAttribute("aria-label", nextOpen ? "ルビ辞書管理を閉じる" : "ルビ辞書管理を開く");
    }
    if (persist) {
      try {
        localStorage.setItem(DICTIONARY_STATE_KEY, nextOpen ? "1" : "0");
      } catch (error) {
        console.debug("dictionary toggle state not persisted", error);
      }
      this.preferredDictionaryOpen = nextOpen;
    }
    if (nextOpen && this.isAuthorized && !this.dictionaryLoaded) {
      this.fetchDictionary().catch((error) => console.error("辞書の読み込みに失敗しました", error));
    }
  }

  async renderQuestions() {
    if (!this.dom.cardsContainer) return;
    let list = this.state.allQuestions.filter((item) => {
      const isPuq = item["ラジオネーム"] === "Pick Up Question";
      return this.state.currentSubTab === "puq" ? isPuq : !isPuq;
    });
    const isPUQ = this.state.currentSubTab === "puq";
    list.sort((a, b) => {
      if (isPUQ) {
        const ta = String(a["質問・お悩み"] ?? "");
        const tb = String(b["質問・お悩み"] ?? "");
        const t = ta.localeCompare(tb, "ja", { numeric: true, sensitivity: "base" });
        if (t) return t;
        const da = a.__ts || 0;
        const db = b.__ts || 0;
        if (da !== db) return da - db;
        return String(a.UID).localeCompare(String(b.UID));
      }
      const da = a.__ts || 0;
      const db = b.__ts || 0;
      if (da !== db) return da - db;
      const na = String(a["ラジオネーム"] ?? "");
      const nb = String(b["ラジオネーム"] ?? "");
      const n = na.localeCompare(nb, "ja", { numeric: true, sensitivity: "base" });
      if (n) return n;
      return String(a.UID).localeCompare(String(b.UID));
    });

    const snapshot = await get(telopRef);
    const live = snapshot.val();
    const selectedUid = this.state.selectedRowData ? String(this.state.selectedRowData.uid) : null;
    let nextSelection = null;

    this.dom.cardsContainer.innerHTML = "";
    list.forEach((item) => {
      const isAnswered = item["回答済"] === true;
      const status = item["選択中"] ? "live" : isAnswered ? "answered" : "pending";
      const statusText = status === "live" ? "表示中" : status === "answered" ? "回答済" : "未回答";
      const card = document.createElement("article");
      card.className = `q-card ${status === "live" ? "is-live" : ""} ${isAnswered ? "is-answered" : "is-pending"}`;
      card.dataset.uid = String(item.UID);
      if (live && live.name === item["ラジオネーム"] && live.question === item["質問・お悩み"]) {
        card.classList.add("now-displaying");
        if (this.state.lastDisplayedUid === item.UID) {
          card.classList.add("flash");
          card.addEventListener(
            "animationend",
            () => card.classList.remove("flash"),
            { once: true }
          );
          this.state.lastDisplayedUid = null;
        }
      }
      const uid = String(item.UID);
      if (uid === selectedUid) {
        card.classList.add("is-selected");
        nextSelection = {
          uid,
          name: item["ラジオネーム"],
          question: item["質問・お悩み"],
          isAnswered
        };
      }
      card.innerHTML = `
        <header class="q-head">
          <div class="q-title">
            <span class="q-name">${escapeHtml(item["ラジオネーム"])}</span>
            ${item["ラジオネーム"] === "Pick Up Question" ? '<span class="q-badge q-badge--puq">PUQ</span>' : ""}
          </div>
          <div class="q-meta">
            <span class="q-group">${escapeHtml(item["班番号"] ?? "") || ""}</span>
            <span class="chip chip--${status}">${statusText}</span>
            <label class="q-check">
              <input type="checkbox" class="row-checkbox" data-uid="${escapeHtml(uid)}">
            </label>
          </div>
        </header>
        <div class="q-text">${escapeHtml(item["質問・お悩み"])}</div>
      `;
      card.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".q-check")) return;
        this.dom.cardsContainer?.querySelectorAll(".q-card").forEach((el) => el.classList.remove("is-selected"));
        card.classList.add("is-selected");
        this.state.selectedRowData = {
          uid,
          name: item["ラジオネーム"],
          question: item["質問・お悩み"],
          isAnswered
        };
        this.updateActionAvailability();
      });
      this.dom.cardsContainer.appendChild(card);
    });

    if (selectedUid && nextSelection) {
      this.state.selectedRowData = nextSelection;
      this.updateActionAvailability();
    } else if (!list.some((item) => String(item.UID) === selectedUid)) {
      this.state.selectedRowData = null;
      this.updateActionAvailability();
    }
    this.updateBatchButtonVisibility();
  }

  async handleDisplay() {
    if (!this.state.displaySessionActive) {
      showToast("表示端末が接続されていません。", "error");
      return;
    }
    if (!this.state.selectedRowData || this.state.selectedRowData.isAnswered) return;
    const snapshot = await get(telopRef);
    const previousTelop = snapshot.val();
    try {
      const updates = {};
      if (previousTelop) {
        const prev = this.state.allQuestions.find(
          (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
        );
        if (prev) {
          updates[`questions/${prev.UID}/selecting`] = false;
          updates[`questions/${prev.UID}/answered`] = true;
        }
      }
      updates[`questions/${this.state.selectedRowData.uid}/selecting`] = true;
      updates[`questions/${this.state.selectedRowData.uid}/answered`] = false;
      await update(ref(database), updates);
      await set(telopRef, {
        name: this.state.selectedRowData.name,
        question: this.state.selectedRowData.question
      });
      this.api.fireAndForgetApi({ action: "updateSelectingStatus", uid: this.state.selectedRowData.uid });
      if (previousTelop) {
        const prev = this.state.allQuestions.find(
          (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
        );
        if (prev) {
          this.api.fireAndForgetApi({ action: "updateStatus", uid: prev.UID, status: true });
        }
      }
      this.state.lastDisplayedUid = this.state.selectedRowData.uid;
      this.api.logAction("DISPLAY", `RN: ${this.state.selectedRowData.name}`);
      showToast(`「${this.state.selectedRowData.name}」さんの質問を表示しました。`, "success");
    } catch (error) {
      showToast("表示処理中にエラーが発生しました: " + error.message, "error");
    }
  }

  async handleEdit() {
    if (!this.state.selectedRowData) return;
    const newText = prompt("質問内容を編集してください：", this.state.selectedRowData.question);
    if (newText === null || newText.trim() === this.state.selectedRowData.question.trim()) return;
    try {
      await update(ref(database, `questions/${this.state.selectedRowData.uid}`), { question: newText.trim() });
      this.api.fireAndForgetApi({ action: "editQuestion", uid: this.state.selectedRowData.uid, text: newText.trim() });
      this.api.logAction("EDIT", `UID: ${this.state.selectedRowData.uid}`);
      showToast("質問を更新しました。", "success");
    } catch (error) {
      showToast("通信エラー: " + error.message, "error");
    }
  }

  async clearTelop() {
    if (!this.state.displaySessionActive) {
      showToast("表示端末が接続されていません。", "error");
      return;
    }
    const snapshot = await get(telopRef);
    const previousTelop = snapshot.val();
    try {
      const updates = {};
      const selectingItems = this.state.allQuestions.filter((item) => item["選択中"] === true);
      selectingItems.forEach((item) => {
        updates[`questions/${item.UID}/selecting`] = false;
      });
      if (previousTelop) {
        const prevItem = this.state.allQuestions.find(
          (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
        );
        if (prevItem) {
          updates[`questions/${prevItem.UID}/answered`] = true;
          this.api.fireAndForgetApi({ action: "updateStatus", uid: prevItem.UID, status: true });
        }
      }
      if (Object.keys(updates).length > 0) {
        await update(ref(database), updates);
      }
      await remove(telopRef);
      this.api.fireAndForgetApi({ action: "clearSelectingStatus" });
      this.api.logAction("CLEAR");
      showToast("テロップを消去しました。", "success");
    } catch (error) {
      showToast("テロップの消去中にエラーが発生しました: " + error.message, "error");
    }
  }

  handleUnanswer() {
    if (!this.state.displaySessionActive) {
      showToast("表示端末が接続されていません。", "error");
      return;
    }
    if (!this.state.selectedRowData || !this.state.selectedRowData.isAnswered) return;
    if (!confirm(`「${this.state.selectedRowData.name}」の質問を「未回答」に戻しますか？`)) return;
    update(ref(database, `questions/${this.state.selectedRowData.uid}`), { answered: false });
    this.api.fireAndForgetApi({ action: "updateStatus", uid: this.state.selectedRowData.uid, status: false });
  }

  handleSelectAll(event) {
    this.dom.cardsContainer
      ?.querySelectorAll(".row-checkbox")
      .forEach((checkbox) => {
        checkbox.checked = event.target.checked;
      });
    this.updateBatchButtonVisibility();
  }

  handleBatchUnanswer() {
    if (!this.state.displaySessionActive) {
      showToast("表示端末が接続されていません。", "error");
      return;
    }
    const checkedBoxes = this.dom.cardsContainer?.querySelectorAll(".row-checkbox:checked");
    if (!checkedBoxes || checkedBoxes.length === 0) return;
    if (!confirm(`${checkedBoxes.length}件の質問を「未回答」に戻しますか？`)) return;
    const uidsToUpdate = Array.from(checkedBoxes).map((checkbox) => checkbox.dataset.uid);
    const updates = {};
    for (const uid of uidsToUpdate) {
      updates[`questions/${uid}/answered`] = false;
    }
    update(ref(database), updates);
    this.api.fireAndForgetApi({ action: "batchUpdateStatus", uids: uidsToUpdate, status: false });
  }

  switchMainTab(tabName) {
    if (!tabName) return;
    this.state.currentMainTab = tabName;
    document.querySelectorAll(".main-tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tabName);
    });
    document.querySelectorAll(".main-tab-content").forEach((content) => {
      content.classList.toggle("active", content.id === `${tabName}-content`);
    });
  }

  switchSubTab(tabName) {
    if (!tabName) return;
    this.state.currentSubTab = tabName;
    document.querySelectorAll(".sub-tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.subTab === tabName);
    });
    this.renderQuestions();
  }

  updateActionAvailability() {
    const active = !!this.state.displaySessionActive;
    const selection = this.state.selectedRowData;
    this.dom.actionButtons.forEach((button) => {
      if (button) button.disabled = true;
    });
    if (this.dom.clearButton) this.dom.clearButton.disabled = !active;
    if (!this.dom.selectedInfo) {
      this.updateBatchButtonVisibility();
      return;
    }
    if (!active) {
      this.dom.selectedInfo.textContent = "表示端末が接続されていません";
      this.updateBatchButtonVisibility();
      return;
    }
    if (!selection) {
      this.dom.selectedInfo.textContent = "行を選択してください";
      this.updateBatchButtonVisibility();
      return;
    }
    this.dom.actionButtons.forEach((button) => {
      if (button) button.disabled = false;
    });
    if (this.dom.actionButtons[0]) this.dom.actionButtons[0].disabled = !!selection.isAnswered;
    if (this.dom.actionButtons[1]) this.dom.actionButtons[1].disabled = !selection.isAnswered;
    const safeName = String(selection.name ?? "");
    this.dom.selectedInfo.textContent = `選択中: ${safeName}`;
    this.updateBatchButtonVisibility();
  }

  updateBatchButtonVisibility() {
    if (!this.dom.batchUnanswerBtn) return;
    const active = !!this.state.displaySessionActive;
    const checkedCount = active ? this.dom.cardsContainer?.querySelectorAll(".row-checkbox:checked").length || 0 : 0;
    this.dom.batchUnanswerBtn.style.display = active && checkedCount > 0 ? "inline-block" : "none";
    this.dom.batchUnanswerBtn.disabled = !active || checkedCount === 0;
  }

  async addTerm(event) {
    event.preventDefault();
    const term = this.dom.newTermInput?.value.trim();
    const ruby = this.dom.newRubyInput?.value.trim();
    if (!term || !ruby) return;
    try {
      const result = await this.api.apiPost({ action: "addTerm", term, ruby });
      if (result.success) {
        if (this.dom.newTermInput) this.dom.newTermInput.value = "";
        if (this.dom.newRubyInput) this.dom.newRubyInput.value = "";
        await this.fetchDictionary();
      } else {
        showToast("追加失敗: " + result.error, "error");
      }
    } catch (error) {
      showToast("通信エラー: " + error.message, "error");
    }
  }

  async deleteTerm(term) {
    if (!confirm(`「${term}」を辞書から削除しますか？`)) return;
    try {
      const result = await this.api.apiPost({ action: "deleteTerm", term });
      if (result.success) {
        await this.fetchDictionary();
      } else {
        showToast("削除失敗: " + result.error, "error");
      }
    } catch (error) {
      showToast("通信エラー: " + error.message, "error");
    }
  }

  async toggleTerm(term, newStatus) {
    try {
      const result = await this.api.apiPost({ action: "toggleTerm", term, enabled: newStatus });
      if (result.success) {
        await this.fetchDictionary();
      } else {
        showToast("状態の更新失敗: " + result.error, "error");
      }
    } catch (error) {
      showToast("通信エラー: " + error.message, "error");
    }
  }

  showLoader(message) {
    if (this.dom.loadingOverlay) this.dom.loadingOverlay.removeAttribute("hidden");
    this.updateLoader(message);
    document.body?.setAttribute("aria-busy", "true");
  }

  updateLoader(message) {
    if (message && this.dom.loadingText) this.dom.loadingText.textContent = message;
  }

  hideLoader() {
    if (this.dom.loadingOverlay) this.dom.loadingOverlay.setAttribute("hidden", "");
    document.body?.removeAttribute("aria-busy");
  }

  initLoaderSteps() {
    if (!this.dom.loaderSteps) return;
    this.dom.loaderSteps.innerHTML = STEP_LABELS.map((label, index) => `<li data-step="${index}">${escapeHtml(label)}</li>`).join("");
  }

  setLoaderStep(stepIndex, message) {
    this.updateLoader(message);
    if (!this.dom.loaderSteps) return;
    const items = this.dom.loaderSteps.querySelectorAll("li");
    items.forEach((item, index) => {
      item.classList.toggle("current", index === stepIndex);
      item.classList.toggle("done", index < stepIndex);
    });
  }

  finishLoaderSteps(message = "準備完了") {
    this.setLoaderStep(STEP_LABELS.length - 1, message);
  }
}

const appInstance = new OperatorApp();
appInstance.init();


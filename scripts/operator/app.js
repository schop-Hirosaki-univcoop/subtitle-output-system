import {
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  onValue,
  get,
  questionsRef,
  displaySessionRef,
  renderRef
} from "./firebase.js";
import { queryDom } from "./dom.js";
import { createInitialState } from "./state.js";
import { createApiClient } from "./api-client.js";
import { showToast } from "./toast.js";
import * as Dictionary from "./dictionary.js";
import * as Logs from "./logs.js";
import * as Questions from "./questions.js";
import * as Display from "./display.js";
import * as Dialog from "./dialog.js";
import * as Loader from "./loader.js";
import { resolveGenreLabel } from "./utils.js";

export class OperatorApp {
  constructor() {
    this.dom = queryDom();
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    this.api = createApiClient(auth, onAuthStateChanged);

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
    this.preferredLogsOpen = false;
    this.activeDialog = null;
    this.dialogLastFocused = null;
    this.pendingEditUid = null;
    this.pendingEditOriginal = "";
    this.editSubmitting = false;

    this.toast = showToast;

    this.fetchDictionary = () => Dictionary.fetchDictionary(this);
    this.applyInitialDictionaryState = () => Dictionary.applyInitialDictionaryState(this);
    this.toggleDictionaryDrawer = (force, persist = true) => Dictionary.toggleDictionaryDrawer(this, force, persist);
    this.addTerm = (event) => Dictionary.addTerm(this, event);

    this.fetchLogs = () => Logs.fetchLogs(this);
    this.renderLogs = () => Logs.renderLogs(this);
    this.applyLogFilters = (logs) => Logs.applyLogFilters(this, logs);
    this.renderLogsStream = (rows) => Logs.renderLogsStream(this, rows);
    this.applyInitialLogsState = () => Logs.applyInitialLogsState(this);
    this.toggleLogsDrawer = (force, persist = true) => Logs.toggleLogsDrawer(this, force, persist);
    this.startLogsUpdateMonitor = () => Logs.startLogsUpdateMonitor(this);

    this.renderQuestions = () => Questions.renderQuestions(this);
    this.updateScheduleOptions = () => Questions.updateScheduleOptions(this);
    this.switchSubTab = (tabName) => Questions.switchSubTab(this, tabName);
    this.switchGenre = (genre) => Questions.switchGenre(this, genre);
    this.handleScheduleChange = (event) => Questions.handleScheduleChange(this, event);
    this.handleDisplay = () => Questions.handleDisplay(this);
    this.handleUnanswer = () => Questions.handleUnanswer(this);
    this.handleSelectAll = (event) => Questions.handleSelectAll(this, event);
    this.handleBatchUnanswer = () => Questions.handleBatchUnanswer(this);
    this.clearTelop = () => Questions.clearTelop(this);
    this.updateActionAvailability = () => Questions.updateActionAvailability(this);
    this.updateBatchButtonVisibility = () => Questions.updateBatchButtonVisibility(this);
    this.syncSelectAllState = () => Questions.syncSelectAllState(this);

    this.handleRenderUpdate = (snapshot) => Display.handleRenderUpdate(this, snapshot);
    this.redrawUpdatedAt = () => Display.redrawUpdatedAt(this);
    this.refreshStaleness = () => Display.refreshStaleness(this);

    this.openDialog = (element, focusTarget) => Dialog.openDialog(this, element, focusTarget);
    this.closeEditDialog = () => Dialog.closeEditDialog(this);
    this.handleDialogKeydown = (event) => Dialog.handleDialogKeydown(this, event);
    this.handleEdit = () => Dialog.handleEdit(this);
    this.handleEditSubmit = () => Dialog.handleEditSubmit(this);

    this.showLoader = (message) => Loader.showLoader(this, message);
    this.updateLoader = (message) => Loader.updateLoader(this, message);
    this.hideLoader = () => Loader.hideLoader(this);
    this.initLoaderSteps = () => Loader.initLoaderSteps(this);
    this.setLoaderStep = (step, message) => Loader.setLoaderStep(this, step, message);
    this.finishLoaderSteps = (message) => Loader.finishLoaderSteps(this, message);
  }

  init() {
    this.setupEventListeners();
    this.updateActionAvailability();
    this.attachRenderMonitor();
    this.applyInitialDictionaryState();
    this.applyInitialLogsState();
    this.updateCopyrightYear();
    onAuthStateChanged(auth, (user) => {
      if (this.authFlow === "prompting") {
        this.pendingAuthUser = user || null;
        return;
      }
      this.handleAuthState(user);
    });
  }

  setupEventListeners() {
    this.dom.loginButton?.addEventListener("click", () => this.login());
    document.querySelectorAll(".sub-tab-button").forEach((button) => {
      button.addEventListener("click", () => this.switchSubTab(button.dataset.subTab));
    });
    document.querySelectorAll(".genre-tab-button").forEach((button) => {
      button.addEventListener("click", () => this.switchGenre(button.dataset.genre));
    });
    this.dom.dictionaryToggle?.addEventListener("click", () => this.toggleDictionaryDrawer());
    this.dom.logsToggle?.addEventListener("click", () => this.toggleLogsDrawer());
    this.dom.logsRefreshButton?.addEventListener("click", () => this.fetchLogs());
    this.dom.actionButtons[0]?.addEventListener("click", () => this.handleDisplay());
    this.dom.actionButtons[1]?.addEventListener("click", () => this.handleUnanswer());
    this.dom.actionButtons[2]?.addEventListener("click", () => this.handleEdit());
    this.dom.clearButton?.addEventListener("click", () => this.clearTelop());
    this.dom.fetchDictionaryButton?.addEventListener("click", () => this.fetchDictionary());
    this.dom.addTermForm?.addEventListener("submit", (event) => this.addTerm(event));
    this.dom.selectAllCheckbox?.addEventListener("change", (event) => this.handleSelectAll(event));
    this.dom.batchUnanswerBtn?.addEventListener("click", () => this.handleBatchUnanswer());
    if (this.dom.editDialog) {
      this.dom.editDialog.addEventListener("click", (event) => {
        if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
          event.preventDefault();
          this.closeEditDialog();
        }
      });
    }
    this.dom.editCancelButton?.addEventListener("click", () => this.closeEditDialog());
    this.dom.editSaveButton?.addEventListener("click", () => this.handleEditSubmit());
    if (this.dom.scheduleFilter) {
      this.dom.scheduleFilter.value = this.state.currentSchedule;
      this.dom.scheduleFilter.addEventListener("change", (event) => this.handleScheduleChange(event));
    }
    this.dom.cardsContainer?.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.classList.contains("row-checkbox")) {
        this.syncSelectAllState();
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
    this.renderUnsubscribe = onValue(renderRef, (snapshot) => this.handleRenderUpdate(snapshot), (error) => {
      console.error("Failed to monitor render state:", error);
    });
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
      this.toast("ログインに失敗しました。", "error");
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
        this.toast("あなたのアカウントはこのシステムへのアクセスが許可されていません。", "error");
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
        ジャンル: resolveGenreLabel(item.genre),
        日程: String(item.schedule ?? "").trim(),
        参加者ID: item.participantId ?? "",
        回答済: !!item.answered,
        選択中: !!item.selecting,
        __ts: Number(item.ts || 0)
      }));
      this.updateScheduleOptions();
      this.renderQuestions();
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
      if (this.preferredLogsOpen) {
        this.toggleLogsDrawer(true, false);
      } else {
        this.toggleLogsDrawer(false, false);
      }
      this.finishLoaderSteps("準備完了");
      this.hideLoader();
      this.toast(`ようこそ、${user.displayName || ""}さん`, "success");
      this.startLogsUpdateMonitor();
    } catch (error) {
      console.error("Authorization check failed:", error);
      this.toast("ユーザー権限の確認中にエラーが発生しました。", "error");
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
      logoutButton.addEventListener("click", () => this.logout());
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
    this.toggleLogsDrawer(false, false);
    this.cleanupRealtime();
    this.hideLoader();
    this.closeEditDialog();
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
    if (this.logsUpdateTimer) {
      clearTimeout(this.logsUpdateTimer);
      this.logsUpdateTimer = null;
    }
    const autoScroll = this.dom.logAutoscroll ? this.dom.logAutoscroll.checked : true;
    this.state = createInitialState(autoScroll);
    if (this.dom.selectAllCheckbox) {
      this.dom.selectAllCheckbox.checked = false;
      this.dom.selectAllCheckbox.indeterminate = false;
    }
    document.querySelectorAll(".genre-tab-button").forEach((button, index) => {
      const isDefault = index === 0;
      button.classList.toggle("active", isDefault);
      button.setAttribute("aria-selected", String(isDefault));
    });
    if (this.dom.scheduleFilter) {
      this.dom.scheduleFilter.innerHTML = "";
      this.dom.scheduleFilter.value = "";
      this.dom.scheduleFilter.disabled = true;
      const wrapper = this.dom.scheduleFilter.closest(".schedule-filter");
      if (wrapper) wrapper.classList.add("is-disabled");
    }
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
        ジャンル: resolveGenreLabel(item.genre),
        日程: String(item.schedule ?? "").trim(),
        参加者ID: item.participantId ?? "",
        回答済: !!item.answered,
        選択中: !!item.selecting,
        __ts: Number(item.ts || 0)
      }));
      this.updateScheduleOptions();
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
          this.toast(active ? "送出端末とのセッションが確立されました。" : "送出端末の接続が確認できません。", active ? "success" : "error");
        }
        this.state.displaySessionLastActive = active;
        this.updateActionAvailability();
        this.updateBatchButtonVisibility();
        this.renderQuestions();
      },
      (error) => {
        console.error("Failed to monitor display session:", error);
      }
    );
  }

  updateCopyrightYear() {
    if (!this.dom.copyrightYear) return;
    const currentYear = new Date().getFullYear();
    if (currentYear <= 2025) {
      this.dom.copyrightYear.textContent = "2025";
    } else {
      this.dom.copyrightYear.textContent = `2025 - ${currentYear}`;
    }
  }
}

import { queryDom } from "./dom.js";
import {
  database,
  ref,
  get,
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "../operator/firebase.js";
import { createApiClient } from "../operator/api-client.js";
import { formatScheduleRange } from "../operator/utils.js";

const ensureString = (value) => String(value ?? "").trim();

function formatParticipantCount(value) {
  if (value == null || value === "") {
    return "—";
  }
  const numberValue = Number(value);
  if (!Number.isNaN(numberValue)) {
    return `${numberValue}名`;
  }
  return `${value}`;
}

export class ScheduleHubApp {
  constructor() {
    this.dom = queryDom();
    this.context = this.parseContext();
    this.eventData = null;
    this.scheduleData = null;
    this.api = createApiClient(auth, onAuthStateChanged);
    this.authUnsubscribe = null;
    this.currentUser = null;
    this.pendingLoginError = "";
  }

  parseContext() {
    const base = {
      eventId: "",
      scheduleId: "",
      eventName: "",
      scheduleLabel: "",
      startAt: "",
      endAt: "",
      participantCount: "",
      scheduleKey: ""
    };

    if (typeof window === "undefined") {
      return base;
    }

    try {
      const params = new URLSearchParams(window.location.search || "");
      base.eventId = ensureString(params.get("eventId") ?? params.get("event"));
      base.scheduleId = ensureString(params.get("scheduleId") ?? params.get("schedule"));
      base.eventName = ensureString(params.get("eventName") ?? params.get("eventLabel"));
      base.scheduleLabel = ensureString(params.get("scheduleLabel") ?? params.get("scheduleName"));
      base.startAt = ensureString(params.get("startAt") ?? params.get("scheduleStart"));
      base.endAt = ensureString(params.get("endAt") ?? params.get("scheduleEnd"));
      base.participantCount = ensureString(params.get("participantCount") ?? params.get("participants"));
      base.scheduleKey = ensureString(params.get("scheduleKey"));
    } catch (error) {
      console.debug("failed to parse schedule hub context", error);
    }

    return base;
  }

  init() {
    this.bindEvents();
    this.showLoggedOutState();
    this.updateBackLink();
    this.renderSummaryFromContext();
    this.updateActionLinks();
    this.observeAuthState();

    if (!this.context.eventId || !this.context.scheduleId) {
      this.showError("イベントIDまたは日程IDが指定されていません。URL を確認してください。");
      this.setLoginError("イベントIDまたは日程IDが指定されていません。URL を確認してください。");
    }
  }

  bindEvents() {
    if (this.dom.loginButton) {
      this.dom.loginButton.addEventListener("click", () => this.login());
    }
  }

  observeAuthState() {
    if (this.authUnsubscribe) {
      this.authUnsubscribe();
      this.authUnsubscribe = null;
    }
    this.authUnsubscribe = onAuthStateChanged(auth, (user) => {
      this.handleAuthState(user).catch((error) => {
        console.error("Failed to handle auth state:", error);
      });
    });
  }

  async login() {
    const button = this.dom.loginButton;
    if (!button) return;

    const originalLabel = button.textContent;
    try {
      button.disabled = true;
      button.classList.add("is-busy");
      button.textContent = "サインイン中…";
      this.setLoginError("");
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Hub login failed:", error);
      this.setLoginError("ログインに失敗しました。もう一度お試しください。");
    } finally {
      button.disabled = false;
      button.classList.remove("is-busy");
      button.textContent = originalLabel;
    }
  }

  showLoggedOutState() {
    this.setLoginError(this.pendingLoginError);
    if (this.dom.loginCard) {
      this.dom.loginCard.hidden = false;
    }
    if (this.dom.main) {
      this.dom.main.hidden = true;
    }
    if (this.dom.summary) {
      this.dom.summary.hidden = true;
    }
    if (this.dom.actions) {
      this.dom.actions.hidden = true;
    }
    this.toggleLoading(false);
  }

  showLoggedInState() {
    this.setLoginError("");
    if (this.dom.loginCard) {
      this.dom.loginCard.hidden = true;
    }
    if (this.dom.main) {
      this.dom.main.hidden = false;
    }
  }

  setLoadingMessage(message) {
    if (this.dom.loadingText) {
      this.dom.loadingText.textContent = message || "";
    }
  }

  clearError() {
    if (this.dom.alert) {
      this.dom.alert.hidden = true;
      this.dom.alert.textContent = "";
    }
    if (!this.currentUser) {
      this.setLoginError(this.pendingLoginError);
    }
  }

  setLoginError(message = "") {
    const normalized = ensureString(message);
    this.pendingLoginError = normalized;
    if (!this.dom.loginError) {
      return;
    }
    if (normalized) {
      this.dom.loginError.hidden = false;
      this.dom.loginError.textContent = normalized;
    } else {
      this.dom.loginError.hidden = true;
      this.dom.loginError.textContent = "";
    }
  }

  async handleAuthState(user) {
    this.currentUser = user;
    if (!user) {
      this.clearError();
      this.showLoggedOutState();
      return;
    }

    this.showLoggedInState();
    this.clearError();

    try {
      this.setLoadingMessage("権限を確認しています…");
      this.toggleLoading(true);
      await this.ensureAdminAccess();
      this.setLoadingMessage("日程情報を読み込んでいます…");
      await this.loadData();
    } catch (error) {
      console.error("Schedule hub initialization failed:", error);
      if (this.isPermissionError(error)) {
        const message =
          (error instanceof Error && error.message) ||
          "アクセス権限がありません。管理者に確認してください。";
        this.showError(message);
        this.setLoginError(message);
        await this.safeSignOut();
        return;
      }
      const fallback = "日程情報の読み込みに失敗しました。時間をおいて再度お試しください。";
      const message = error instanceof Error && error.message ? error.message : fallback;
      this.showError(message || fallback);
    } finally {
      this.toggleLoading(false);
    }
  }

  async ensureAdminAccess() {
    if (!this.api) {
      return;
    }
    try {
      await this.api.apiPost({ action: "ensureAdmin" });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error || "");
      let message = "権限の確認に失敗しました。時間をおいて再度お試しください。";
      if (/not in users sheet/i.test(rawMessage)) {
        message = "あなたのアカウントにはこのページへのアクセス権限がありません。管理者に確認してください。";
      }
      const err = new Error(message);
      err.code = "HUB_ACCESS_DENIED";
      err.cause = error;
      throw err;
    }
  }

  async safeSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Failed to sign out after permission error:", error);
    }
  }

  isPermissionError(error) {
    if (!error) return false;
    if (error.code === "HUB_ACCESS_DENIED") return true;
    const code = typeof error.code === "string" ? error.code : "";
    if (code.includes("PERMISSION")) return true;
    const message = error instanceof Error ? error.message : String(error || "");
    return /permission/i.test(message) || message.includes("権限");
  }

  toggleLoading(isLoading) {
    if (this.dom.loading) {
      this.dom.loading.hidden = !isLoading;
    }
  }

  renderSummaryFromContext() {
    const { eventName, scheduleLabel, startAt, endAt, participantCount } = this.context;

    if (this.dom.eventName && eventName) {
      this.dom.eventName.textContent = eventName;
    }

    if (this.dom.scheduleLabel && scheduleLabel) {
      this.dom.scheduleLabel.textContent = scheduleLabel;
    }

    if (this.dom.scheduleRange) {
      const rangeText = formatScheduleRange(startAt, endAt);
      if (rangeText) {
        this.dom.scheduleRange.textContent = rangeText;
        this.dom.scheduleRange.hidden = false;
      } else if (startAt || endAt) {
        this.dom.scheduleRange.textContent = "";
        this.dom.scheduleRange.hidden = true;
      }
    }

    if (this.dom.participantCount) {
      if (participantCount !== "") {
        this.dom.participantCount.textContent = formatParticipantCount(participantCount);
      } else {
        this.dom.participantCount.textContent = "—";
      }
    }

    if (this.dom.summary && (eventName || scheduleLabel || participantCount)) {
      this.dom.summary.hidden = false;
    }

    this.updateDocumentTitle();
    this.updateMetaNote();
  }

  updateDocumentTitle() {
    if (typeof document === "undefined") {
      return;
    }
    const eventLabel = ensureString(this.eventData?.name) || this.context.eventName;
    const scheduleLabel = ensureString(this.scheduleData?.label) || this.context.scheduleLabel;

    if (eventLabel || scheduleLabel) {
      if (eventLabel && scheduleLabel) {
        document.title = `${scheduleLabel} / ${eventLabel} - 日程コントロールハブ`;
      } else {
        const label = scheduleLabel || eventLabel;
        document.title = `${label} - 日程コントロールハブ`;
      }
    }
  }

  updateMetaNote() {
    if (!this.dom.metaNote) return;
    const { eventId, scheduleId } = this.context;
    if (eventId || scheduleId) {
      const scheduleKey = this.resolveScheduleKey();
      this.dom.metaNote.hidden = false;
      this.dom.metaNote.textContent = `イベントID: ${eventId || "?"} / 日程ID: ${scheduleId || "?"}` +
        (scheduleKey ? ` / Key: ${scheduleKey}` : "");
    } else {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
    }
  }

  async loadData() {
    const { eventId, scheduleId } = this.context;

    if (!eventId || !scheduleId) {
      const error = new Error("イベントIDまたは日程IDが指定されていません。URL を確認してください。");
      error.code = "HUB_CONTEXT_MISSING";
      throw error;
    }

    const [eventSnapshot, scheduleSnapshot] = await Promise.all([
      get(ref(database, `questionIntake/events/${eventId}`)),
      get(ref(database, `questionIntake/schedules/${eventId}/${scheduleId}`))
    ]);

    if (!eventSnapshot.exists()) {
      const error = new Error(`イベント「${eventId}」が見つかりません。`);
      error.code = "HUB_EVENT_NOT_FOUND";
      throw error;
    }

    if (!scheduleSnapshot.exists()) {
      const error = new Error(`日程「${scheduleId}」が見つかりません。`);
      error.code = "HUB_SCHEDULE_NOT_FOUND";
      throw error;
    }

    this.eventData = eventSnapshot.val();
    this.scheduleData = scheduleSnapshot.val();

    this.applyFetchedData();
    this.updateActionLinks();
  }

  applyFetchedData() {
    const eventName = ensureString(this.eventData?.name);
    const scheduleLabel = ensureString(this.scheduleData?.label);
    const startAt = ensureString(this.scheduleData?.startAt || this.context.startAt);
    const endAt = ensureString(this.scheduleData?.endAt || this.context.endAt);
    const participantCount = this.scheduleData?.participantCount ?? this.context.participantCount;

    if (eventName) {
      this.context.eventName = eventName;
    }
    if (this.dom.eventName && eventName) {
      this.dom.eventName.textContent = eventName;
    }

    if (scheduleLabel) {
      this.context.scheduleLabel = scheduleLabel;
    }
    if (this.dom.scheduleLabel && scheduleLabel) {
      this.dom.scheduleLabel.textContent = scheduleLabel;
    }

    if (startAt) {
      this.context.startAt = startAt;
    }
    if (endAt) {
      this.context.endAt = endAt;
    }

    if (this.dom.scheduleRange) {
      const rangeText = formatScheduleRange(startAt, endAt);
      if (rangeText) {
        this.dom.scheduleRange.textContent = rangeText;
        this.dom.scheduleRange.hidden = false;
      } else {
        this.dom.scheduleRange.textContent = "—";
        this.dom.scheduleRange.hidden = false;
      }
    }

    if (this.dom.participantCount) {
      const normalizedCount = participantCount ?? "";
      this.context.participantCount = normalizedCount === "" ? "" : String(normalizedCount);
      this.dom.participantCount.textContent = formatParticipantCount(normalizedCount);
    }

    if (this.dom.summary) {
      this.dom.summary.hidden = false;
    }

    this.updateDocumentTitle();
    this.updateMetaNote();
  }

  showError(message) {
    if (this.dom.alert) {
      this.dom.alert.textContent = message;
      this.dom.alert.hidden = false;
    }

    if (this.dom.summary) {
      this.dom.summary.hidden = true;
    }

    if (this.dom.actions) {
      this.dom.actions.hidden = true;
    }
  }

  resolveScheduleKey() {
    if (this.context.scheduleKey) {
      return this.context.scheduleKey;
    }
    if (this.context.eventId && this.context.scheduleId) {
      return `${this.context.eventId}::${this.context.scheduleId}`;
    }
    return "";
  }

  updateBackLink() {
    if (!this.dom.backLink || typeof window === "undefined") return;
    const hasEvent = Boolean(this.context.eventId);
    const basePath = hasEvent ? "event-hub.html" : "question-admin.html";
    const url = new URL(basePath, window.location.href);
    if (hasEvent) {
      url.searchParams.set("eventId", this.context.eventId);
      const eventName = ensureString(this.context.eventName || this.eventData?.name);
      if (eventName) {
        url.searchParams.set("eventName", eventName);
      }
    }
    this.dom.backLink.href = url.toString();
    const label = hasEvent ? "イベントハブに戻る" : "管理画面に戻る";
    this.dom.backLink.textContent = label;
    this.dom.backLink.setAttribute("aria-label", label);
    this.dom.backLink.setAttribute("title", label);
  }

  updateActionLinks() {
    if (typeof window === "undefined") return;
    const { eventId, scheduleId } = this.context;
    if (!eventId || !scheduleId) {
      if (this.dom.actions) {
        this.dom.actions.hidden = true;
      }
      return;
    }

    const scheduleLabel = ensureString(this.scheduleData?.label) || this.context.scheduleLabel;
    const eventName = ensureString(this.eventData?.name) || this.context.eventName;
    const startAt = ensureString(this.scheduleData?.startAt || this.context.startAt);
    const endAt = ensureString(this.scheduleData?.endAt || this.context.endAt);
    const scheduleKey = this.resolveScheduleKey();

    if (this.dom.operatorLink) {
      const operatorUrl = new URL("operator.html", window.location.href);
      operatorUrl.searchParams.set("eventId", eventId);
      operatorUrl.searchParams.set("scheduleId", scheduleId);
      operatorUrl.searchParams.set("scheduleKey", scheduleKey);
      if (eventName) operatorUrl.searchParams.set("eventName", eventName);
      if (scheduleLabel) operatorUrl.searchParams.set("scheduleLabel", scheduleLabel);
      if (startAt) operatorUrl.searchParams.set("startAt", startAt);
      if (endAt) operatorUrl.searchParams.set("endAt", endAt);
      this.dom.operatorLink.href = operatorUrl.toString();
    }

    if (this.dom.participantsLink) {
      const adminUrl = new URL("question-admin.html", window.location.href);
      adminUrl.searchParams.set("eventId", eventId);
      adminUrl.searchParams.set("scheduleId", scheduleId);
      adminUrl.searchParams.set("focus", "participants");
      if (scheduleLabel) adminUrl.searchParams.set("scheduleLabel", scheduleLabel);
      if (eventName) adminUrl.searchParams.set("eventName", eventName);
      this.dom.participantsLink.href = adminUrl.toString();
    }

    if (this.dom.actions) {
      this.dom.actions.hidden = false;
    }
  }
}

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

const toMillis = (value) => {
  if (value == null || value === "") {
    return 0;
  }
  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
};

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

export class EventHubApp {
  constructor() {
    this.dom = queryDom();
    this.context = this.parseContext();
    this.eventData = null;
    this.schedules = [];
    this.api = createApiClient(auth, onAuthStateChanged);
    this.authUnsubscribe = null;
    this.currentUser = null;
    this.pendingLoginError = "";
  }

  parseContext() {
    const base = {
      eventId: "",
      eventName: ""
    };

    if (typeof window === "undefined") {
      return base;
    }

    try {
      const params = new URLSearchParams(window.location.search || "");
      base.eventId = ensureString(params.get("eventId") ?? params.get("event"));
      base.eventName = ensureString(params.get("eventName") ?? params.get("eventLabel"));
    } catch (error) {
      console.debug("failed to parse event hub context", error);
    }

    return base;
  }

  init() {
    this.bindEvents();
    this.showLoggedOutState();
    this.renderSummaryFromContext();
    this.updateBackLink();
    this.updateManageLink();
    this.observeAuthState();

    if (!this.context.eventId) {
      const message = "イベントIDが指定されていません。URL を確認してください。";
      this.showError(message);
      this.setLoginError(message);
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
        console.error("Failed to handle event hub auth state:", error);
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
      console.error("Event hub login failed:", error);
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
      this.schedules = [];
      this.renderSchedules();
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
      this.setLoadingMessage("イベント情報を読み込んでいます…");
      await this.loadData();
    } catch (error) {
      console.error("Event hub initialization failed:", error);
      if (this.isPermissionError(error)) {
        const message =
          (error instanceof Error && error.message) ||
          "アクセス権限がありません。管理者に確認してください。";
        this.showError(message);
        this.setLoginError(message);
        await this.safeSignOut();
        return;
      }
      const fallback = "イベント情報の読み込みに失敗しました。時間をおいて再度お試しください。";
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
      err.code = "EVENT_HUB_ACCESS_DENIED";
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
    if (error.code === "EVENT_HUB_ACCESS_DENIED") return true;
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

  async loadData() {
    const { eventId } = this.context;
    if (!eventId) {
      const error = new Error("イベントIDが指定されていません。URL を確認してください。");
      error.code = "EVENT_HUB_CONTEXT_MISSING";
      throw error;
    }

    const [eventSnapshot, scheduleSnapshot] = await Promise.all([
      get(ref(database, `questionIntake/events/${eventId}`)),
      get(ref(database, `questionIntake/schedules/${eventId}`))
    ]);

    if (!eventSnapshot.exists()) {
      const error = new Error(`イベント「${eventId}」が見つかりません。`);
      error.code = "EVENT_HUB_EVENT_NOT_FOUND";
      throw error;
    }

    const eventValue = eventSnapshot.val();
    const scheduleValue = scheduleSnapshot.exists() ? scheduleSnapshot.val() : {};

    this.eventData = eventValue;

    const schedules = Object.entries(scheduleValue || {}).map(([scheduleId, scheduleMeta]) => ({
      id: ensureString(scheduleId),
      label: ensureString(scheduleMeta?.label || scheduleId),
      startAt: ensureString(scheduleMeta?.startAt || scheduleMeta?.date),
      endAt: ensureString(scheduleMeta?.endAt || ""),
      participantCount: Number(scheduleMeta?.participantCount || 0),
      createdAt: scheduleMeta?.createdAt || 0,
      updatedAt: scheduleMeta?.updatedAt || 0
    }));

    schedules.sort((a, b) => {
      const startDiff = toMillis(a.startAt || a.createdAt) - toMillis(b.startAt || b.createdAt);
      if (startDiff !== 0) return startDiff;
      return a.label.localeCompare(b.label, "ja", { numeric: true });
    });

    this.schedules = schedules;
    this.applyFetchedData();
    this.renderSchedules();
  }

  applyFetchedData() {
    const eventName = ensureString(this.eventData?.name) || this.context.eventName;
    if (eventName) {
      this.context.eventName = eventName;
    }

    if (this.dom.eventName && eventName) {
      this.dom.eventName.textContent = eventName;
    }

    const scheduleCount = this.schedules.length;
    const totalParticipants = this.schedules.reduce((acc, schedule) => acc + (schedule.participantCount || 0), 0);

    if (this.dom.scheduleCount) {
      this.dom.scheduleCount.textContent = `${scheduleCount}件`;
    }
    if (this.dom.totalParticipants) {
      this.dom.totalParticipants.textContent = formatParticipantCount(totalParticipants);
    }

    if (this.dom.summary && (eventName || scheduleCount > 0)) {
      this.dom.summary.hidden = false;
    }

    this.updateDocumentTitle();
    this.updateMetaNote();
    this.updateManageLink();
  }

  renderSummaryFromContext() {
    const { eventName } = this.context;
    if (this.dom.eventName && eventName) {
      this.dom.eventName.textContent = eventName;
    }
  }

  renderSchedules() {
    const list = this.dom.scheduleList;
    if (!list) return;

    list.innerHTML = "";

    if (!this.schedules.length) {
      list.hidden = true;
      if (this.dom.empty) this.dom.empty.hidden = false;
      return;
    }

    if (this.dom.empty) this.dom.empty.hidden = true;
    list.hidden = false;

    this.schedules.forEach((schedule) => {
      const card = document.createElement("article");
      card.className = "schedule-card";

      const title = document.createElement("h2");
      title.className = "schedule-card__title";
      title.textContent = schedule.label || schedule.id;
      card.appendChild(title);

      const meta = document.createElement("p");
      meta.className = "schedule-card__meta";
      const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
      const parts = [];
      if (rangeText) parts.push(rangeText);
      parts.push(`参加者 ${formatParticipantCount(schedule.participantCount)}`);
      meta.textContent = parts.join(" / ");
      card.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "schedule-card__actions";

      const hubLink = document.createElement("a");
      hubLink.className = "btn btn-primary btn-sm";
      hubLink.href = this.buildScheduleHubUrl(schedule);
      hubLink.textContent = "日程コントロールハブ";
      actions.appendChild(hubLink);

      const participantsLink = document.createElement("a");
      participantsLink.className = "btn btn-ghost btn-sm";
      participantsLink.href = this.buildParticipantAdminUrl(schedule);
      participantsLink.target = "_blank";
      participantsLink.rel = "noreferrer noopener";
      participantsLink.textContent = "参加者管理";
      actions.appendChild(participantsLink);

      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  buildScheduleHubUrl(schedule) {
    if (typeof window === "undefined") return "#";
    const url = new URL("schedule-hub.html", window.location.href);
    const { eventId } = this.context;
    if (eventId) url.searchParams.set("eventId", eventId);
    if (schedule?.id) url.searchParams.set("scheduleId", schedule.id);
    const scheduleKey = eventId && schedule?.id ? `${eventId}::${schedule.id}` : "";
    if (scheduleKey) url.searchParams.set("scheduleKey", scheduleKey);
    const eventName = ensureString(this.context.eventName || this.eventData?.name);
    if (eventName) url.searchParams.set("eventName", eventName);
    if (schedule?.label) url.searchParams.set("scheduleLabel", schedule.label);
    if (schedule?.startAt) url.searchParams.set("startAt", schedule.startAt);
    if (schedule?.endAt) url.searchParams.set("endAt", schedule.endAt);
    if (Number.isFinite(schedule?.participantCount)) {
      url.searchParams.set("participantCount", String(schedule.participantCount));
    }
    return url.toString();
  }

  buildParticipantAdminUrl(schedule) {
    if (typeof window === "undefined") return "question-admin.html";
    const url = new URL("question-admin.html", window.location.href);
    const { eventId } = this.context;
    if (eventId) url.searchParams.set("eventId", eventId);
    if (schedule?.id) url.searchParams.set("scheduleId", schedule.id);
    if (schedule?.label) url.searchParams.set("scheduleLabel", schedule.label);
    const eventName = ensureString(this.context.eventName || this.eventData?.name);
    if (eventName) url.searchParams.set("eventName", eventName);
    url.searchParams.set("focus", "participants");
    return url.toString();
  }

  updateBackLink() {
    if (!this.dom.backLink || typeof window === "undefined") return;
    const url = new URL("events.html", window.location.href);
    if (this.context.eventId) {
      url.searchParams.set("eventId", this.context.eventId);
      if (this.context.eventName) {
        url.searchParams.set("eventName", this.context.eventName);
      }
    }
    this.dom.backLink.href = url.toString();
  }

  updateManageLink() {
    if (!this.dom.manageLink || typeof window === "undefined") return;
    const url = new URL("question-admin.html", window.location.href);
    if (this.context.eventId) {
      url.searchParams.set("eventId", this.context.eventId);
    }
    if (this.context.eventName || this.eventData?.name) {
      url.searchParams.set("eventName", this.context.eventName || ensureString(this.eventData?.name));
    }
    url.searchParams.set("focus", "schedules");
    this.dom.manageLink.href = url.toString();
  }

  updateDocumentTitle() {
    if (typeof document === "undefined") {
      return;
    }
    const eventName = ensureString(this.context.eventName || this.eventData?.name);
    if (eventName) {
      document.title = `${eventName} - イベントハブ`;
    } else {
      document.title = "イベントハブ";
    }
  }

  updateMetaNote() {
    if (!this.dom.metaNote) return;
    const { eventId } = this.context;
    if (eventId) {
      this.dom.metaNote.hidden = false;
      this.dom.metaNote.textContent = `イベントID: ${eventId}`;
    } else {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
    }
  }

  showError(message) {
    if (this.dom.alert) {
      this.dom.alert.hidden = false;
      this.dom.alert.textContent = message;
    }
    if (this.dom.summary) {
      this.dom.summary.hidden = true;
    }
    if (this.dom.scheduleList) {
      this.dom.scheduleList.hidden = true;
      this.dom.scheduleList.innerHTML = "";
    }
    if (this.dom.empty) {
      this.dom.empty.hidden = true;
    }
  }
}

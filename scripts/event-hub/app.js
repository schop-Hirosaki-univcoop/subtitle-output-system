import { queryDom } from "./dom.js";
import {
  database,
  ref,
  get,
  set,
  update,
  auth,
  provider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "../operator/firebase.js";
import { createApiClient } from "../operator/api-client.js";
import { formatScheduleRange } from "../operator/utils.js";
import { generateShortId, normalizeKey } from "../question-admin/utils.js";

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

function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
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
    this.activeDialog = null;
    this.lastFocused = null;
    this.confirmResolver = null;
    this.redirectingToIndex = false;
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
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

    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.addEventListener("click", () => this.openScheduleDialog({ mode: "create" }));
    }

    if (this.dom.scheduleRefreshButton) {
      this.dom.scheduleRefreshButton.addEventListener("click", () => {
        this.loadData().catch((error) => {
          console.error("Failed to refresh schedules:", error);
          this.showError(error.message || "日程情報の再読み込みに失敗しました。");
        });
      });
    }

    if (this.dom.scheduleForm) {
      this.dom.scheduleForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleScheduleFormSubmit().catch((error) => {
          console.error("Schedule form submit failed:", error);
          this.setFormError(this.dom.scheduleError, error.message || "日程の保存に失敗しました。");
        });
      });
    }

    this.bindDialogDismiss(this.dom.scheduleDialog);
    this.bindDialogDismiss(this.dom.confirmDialog);

    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.addEventListener("click", () => {
        this.resolveConfirm(true);
      });
    }

    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.addEventListener("click", () => {
        this.resolveConfirm(false);
      });
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
        this.showError(error.message || "初期化に失敗しました。時間をおいて再度お試しください。");
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
    if (this.redirectingToIndex) {
      return;
    }
    this.toggleLoading(false);
    this.updateControlsForAuth(false);
    if (typeof window !== "undefined") {
      this.redirectingToIndex = true;
      window.location.replace("index.html");
    }
  }

  showLoggedInState() {
    this.redirectingToIndex = false;
    this.setLoginError("");
    if (this.dom.main) {
      this.dom.main.hidden = false;
    }
    this.updateControlsForAuth(true);
  }

  updateControlsForAuth(signedIn) {
    if (this.dom.addScheduleButton) {
      this.dom.addScheduleButton.disabled = !signedIn;
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
      this.renderScheduleAdminList();
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
      date: ensureString(scheduleMeta?.date || ""),
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
    this.renderScheduleAdminList();
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
    const list = this.dom.scheduleCards;
    if (!list) return;

    list.innerHTML = "";

    if (!this.schedules.length) {
      list.hidden = true;
      if (this.dom.cardsEmpty) this.dom.cardsEmpty.hidden = false;
      return;
    }

    if (this.dom.cardsEmpty) this.dom.cardsEmpty.hidden = true;
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

  renderScheduleAdminList() {
    const list = this.dom.scheduleAdminList;
    if (!list) return;

    list.innerHTML = "";

    if (!this.schedules.length) {
      list.hidden = true;
      if (this.dom.scheduleAdminEmpty) this.dom.scheduleAdminEmpty.hidden = false;
      return;
    }

    list.hidden = false;
    if (this.dom.scheduleAdminEmpty) this.dom.scheduleAdminEmpty.hidden = true;

    const fragment = document.createDocumentFragment();
    this.schedules.forEach((schedule) => {
      const item = document.createElement("li");
      item.className = "entity-item";

      const label = document.createElement("div");
      label.className = "entity-label";

      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = schedule.label || schedule.id;

      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      const rangeText = formatScheduleRange(schedule.startAt, schedule.endAt);
      const metaParts = [];
      if (rangeText) metaParts.push(rangeText);
      metaParts.push(`参加者 ${formatParticipantCount(schedule.participantCount)}`);
      metaEl.textContent = metaParts.join(" / ");

      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";

      const hubLink = document.createElement("a");
      hubLink.className = "btn btn-primary btn-sm";
      hubLink.href = this.buildScheduleHubUrl(schedule);
      hubLink.textContent = "日程ハブ";
      actions.appendChild(hubLink);

      const participantsLink = document.createElement("a");
      participantsLink.className = "btn btn-ghost btn-sm";
      participantsLink.href = this.buildParticipantAdminUrl(schedule);
      participantsLink.target = "_blank";
      participantsLink.rel = "noreferrer noopener";
      participantsLink.textContent = "参加者管理";
      actions.appendChild(participantsLink);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-icon";
      editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
      editBtn.title = "日程を編集";
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openScheduleDialog({ mode: "edit", schedule });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-icon";
      deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
      deleteBtn.title = "日程を削除";
      deleteBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.deleteSchedule(schedule).catch((error) => {
          console.error("Failed to delete schedule:", error);
          this.showError(error.message || "日程の削除に失敗しました。");
        });
      });
      actions.appendChild(deleteBtn);

      item.append(label, actions);
      fragment.appendChild(item);
    });

    list.appendChild(fragment);
  }

  buildScheduleHubUrl(schedule) {
    if (typeof window === "undefined") return "#";
    const url = new URL("schedule-hub.html", window.location.href);
    const { eventId } = this.context;
    if (eventId) url.searchParams.set("eventId", eventId);
    if (schedule?.id) url.searchParams.set("scheduleId", schedule.id);
    const scheduleKey = eventId && schedule?.id ? `${eventId}::${schedule.id}` : "";
    if (scheduleKey) url.searchParams.set("scheduleKey", scheduleKey);
    url.searchParams.set("source", "event-hub");
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
    if (this.dom.scheduleCards) {
      this.dom.scheduleCards.hidden = true;
      this.dom.scheduleCards.innerHTML = "";
    }
    if (this.dom.cardsEmpty) {
      this.dom.cardsEmpty.hidden = true;
    }
    if (this.dom.scheduleAdminList) {
      this.dom.scheduleAdminList.hidden = true;
      this.dom.scheduleAdminList.innerHTML = "";
    }
    if (this.dom.scheduleAdminEmpty) {
      this.dom.scheduleAdminEmpty.hidden = true;
    }
  }

  openScheduleDialog({ mode = "create", schedule = null } = {}) {
    if (!this.dom.scheduleDialog || !this.dom.scheduleForm) return;
    this.dom.scheduleForm.reset();
    this.dom.scheduleForm.dataset.mode = mode;
    this.dom.scheduleForm.dataset.scheduleId = schedule?.id || "";
    this.setFormError(this.dom.scheduleError, "");
    if (this.dom.scheduleDialogTitle) {
      this.dom.scheduleDialogTitle.textContent = mode === "edit" ? "日程を編集" : "日程を追加";
    }
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }
    if (mode === "edit" && schedule) {
      if (this.dom.scheduleLabelInput) this.dom.scheduleLabelInput.value = schedule.label || "";
      if (this.dom.scheduleDateInput) this.dom.scheduleDateInput.value = schedule.date || (schedule.startAt ? String(schedule.startAt).slice(0, 10) : "");
      if (this.dom.scheduleStartInput) this.dom.scheduleStartInput.value = schedule.startAt ? String(schedule.startAt).slice(11, 16) : "";
      if (this.dom.scheduleEndInput) this.dom.scheduleEndInput.value = schedule.endAt ? String(schedule.endAt).slice(11, 16) : "";
    }
    this.openDialog(this.dom.scheduleDialog);
  }

  async handleScheduleFormSubmit() {
    if (!this.dom.scheduleForm) return;
    const submitButton = this.dom.scheduleForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    this.setFormError(this.dom.scheduleError, "");

    try {
      const mode = this.dom.scheduleForm.dataset.mode || "create";
      const scheduleId = this.dom.scheduleForm.dataset.scheduleId || "";
      const payload = {
        label: this.dom.scheduleLabelInput?.value,
        date: this.dom.scheduleDateInput?.value,
        start: this.dom.scheduleStartInput?.value,
        end: this.dom.scheduleEndInput?.value
      };
      if (mode === "edit") {
        await this.updateSchedule(scheduleId, payload);
        this.clearError();
      } else {
        await this.createSchedule(payload);
        this.clearError();
      }
      this.dom.scheduleForm.reset();
      this.closeDialog(this.dom.scheduleDialog);
    } catch (error) {
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  resolveScheduleFormValues({ label, date, start, end }) {
    const trimmedLabel = normalizeKey(label || "");
    if (!trimmedLabel) {
      throw new Error("日程の表示名を入力してください。");
    }

    const normalizedDate = ensureString(date);
    if (!normalizedDate) {
      throw new Error("日付を入力してください。");
    }

    const startTime = ensureString(start);
    const endTime = ensureString(end);
    if (!startTime || !endTime) {
      throw new Error("開始と終了の時刻を入力してください。");
    }

    const startDate = new Date(`${normalizedDate}T${startTime}`);
    const endDate = new Date(`${normalizedDate}T${endTime}`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new Error("開始・終了時刻の形式が正しくありません。");
    }

    if (endDate.getTime() <= startDate.getTime()) {
      endDate.setTime(endDate.getTime() + 24 * 60 * 60 * 1000);
    }

    const startValue = formatDateTimeLocal(startDate);
    const endValue = formatDateTimeLocal(endDate);

    return {
      label: trimmedLabel,
      date: normalizedDate,
      startValue,
      endValue
    };
  }

  async createSchedule(payload) {
    const { eventId } = this.context;
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }

    const { label, date, startValue, endValue } = this.resolveScheduleFormValues(payload);
    let scheduleId = generateShortId("sch_");
    const existingIds = new Set(this.schedules.map((schedule) => schedule.id));
    while (existingIds.has(scheduleId)) {
      scheduleId = generateShortId("sch_");
    }

    const now = Date.now();
    await set(ref(database, `questionIntake/schedules/${eventId}/${scheduleId}`), {
      label,
      date,
      startAt: startValue,
      endAt: endValue,
      participantCount: 0,
      createdAt: now,
      updatedAt: now
    });

    await update(ref(database), {
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });

    await this.loadData();
    await this.requestSheetSync();
  }

  async updateSchedule(scheduleId, payload) {
    const { eventId } = this.context;
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }

    const { label, date, startValue, endValue } = this.resolveScheduleFormValues(payload);
    const now = Date.now();
    await update(ref(database), {
      [`questionIntake/schedules/${eventId}/${scheduleId}/label`]: label,
      [`questionIntake/schedules/${eventId}/${scheduleId}/date`]: date,
      [`questionIntake/schedules/${eventId}/${scheduleId}/startAt`]: startValue,
      [`questionIntake/schedules/${eventId}/${scheduleId}/endAt`]: endValue,
      [`questionIntake/schedules/${eventId}/${scheduleId}/updatedAt`]: now,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });

    await this.loadData();
    await this.requestSheetSync();
  }

  async deleteSchedule(schedule) {
    const { eventId } = this.context;
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }
    const scheduleId = schedule?.id;
    if (!scheduleId) {
      throw new Error("日程IDが不明です。");
    }
    const label = schedule?.label || scheduleId;

    const confirmed = await this.confirm({
      title: "日程の削除",
      description: `日程「${label}」と、紐づく参加者・専用リンクをすべて削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });

    if (!confirmed) {
      return;
    }

    try {
      const participantSnapshot = await get(ref(database, `questionIntake/participants/${eventId}/${scheduleId}`));
      const participantBranch = participantSnapshot.exists() ? participantSnapshot.val() : {};
      const tokens = new Set();
      if (participantBranch && typeof participantBranch === "object") {
        Object.values(participantBranch).forEach((entry) => {
          const token = entry?.token;
          if (token) tokens.add(String(token));
        });
      }

      const now = Date.now();
      const updates = {
        [`questionIntake/schedules/${eventId}/${scheduleId}`]: null,
        [`questionIntake/participants/${eventId}/${scheduleId}`]: null,
        [`questionIntake/events/${eventId}/updatedAt`]: now
      };
      tokens.forEach((token) => {
        updates[`questionIntake/tokens/${token}`] = null;
      });

      await update(ref(database), updates);
      await this.loadData();
      await this.requestSheetSync();
    } catch (error) {
      throw new Error(error?.message || "日程の削除に失敗しました。");
    }
  }

  async requestSheetSync() {
    if (!this.api) {
      return;
    }
    try {
      await this.api.apiPost({ action: "syncQuestionIntakeToSheet" });
    } catch (error) {
      console.warn("Failed to request sheet sync:", error);
    }
  }

  bindDialogDismiss(element) {
    if (!element) return;
    element.addEventListener("click", (event) => {
      if (event.target instanceof HTMLElement && event.target.dataset.dialogDismiss) {
        event.preventDefault();
        if (element === this.dom.confirmDialog) {
          this.resolveConfirm(false);
        } else {
          this.closeDialog(element);
        }
      }
    });
  }

  openDialog(element) {
    if (!element) return;
    if (this.activeDialog && this.activeDialog !== element) {
      this.closeDialog(this.activeDialog);
    }
    this.activeDialog = element;
    this.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.removeAttribute("hidden");
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", this.handleGlobalKeydown, true);
    const focusTarget = element.querySelector("[data-autofocus]") || element.querySelector("input, button, select, textarea");
    if (focusTarget instanceof HTMLElement) {
      requestAnimationFrame(() => focusTarget.focus());
    }
  }

  closeDialog(element) {
    if (!element) return;
    if (!element.hasAttribute("hidden")) {
      element.setAttribute("hidden", "");
    }
    if (this.activeDialog === element) {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", this.handleGlobalKeydown, true);
      const toFocus = this.lastFocused;
      this.activeDialog = null;
      this.lastFocused = null;
      if (toFocus && typeof toFocus.focus === "function") {
        toFocus.focus();
      }
    }
    if (element === this.dom.scheduleDialog && this.dom.scheduleForm) {
      this.dom.scheduleForm.reset();
      this.setFormError(this.dom.scheduleError, "");
    }
  }

  handleGlobalKeydown(event) {
    if (event.key === "Escape" && this.activeDialog) {
      event.preventDefault();
      if (this.activeDialog === this.dom.confirmDialog) {
        this.resolveConfirm(false);
      } else {
        this.closeDialog(this.activeDialog);
      }
    }
  }

  async confirm({
    title = "確認",
    description = "",
    confirmLabel = "実行する",
    cancelLabel = "キャンセル",
    tone = "danger"
  } = {}) {
    if (!this.dom.confirmDialog) {
      return window.confirm(description || title);
    }

    if (this.confirmResolver) {
      this.resolveConfirm(false);
    }

    if (this.dom.confirmDialogTitle) {
      this.dom.confirmDialogTitle.textContent = title || "確認";
    }
    if (this.dom.confirmDialogMessage) {
      this.dom.confirmDialogMessage.textContent = description || "";
    }
    if (this.dom.confirmAcceptButton) {
      this.dom.confirmAcceptButton.textContent = confirmLabel || "実行する";
      this.dom.confirmAcceptButton.classList.remove("btn-danger", "btn-primary");
      this.dom.confirmAcceptButton.classList.add(tone === "danger" ? "btn-danger" : "btn-primary");
    }
    if (this.dom.confirmCancelButton) {
      this.dom.confirmCancelButton.textContent = cancelLabel || "キャンセル";
    }

    this.openDialog(this.dom.confirmDialog);

    return await new Promise((resolve) => {
      this.confirmResolver = resolve;
    });
  }

  resolveConfirm(result) {
    const resolver = this.confirmResolver;
    this.confirmResolver = null;
    if (this.dom.confirmDialog) {
      this.closeDialog(this.dom.confirmDialog);
    }
    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  setFormError(element, message = "") {
    if (!element) return;
    if (message) {
      element.hidden = false;
      element.textContent = message;
    } else {
      element.hidden = true;
      element.textContent = "";
    }
  }
}

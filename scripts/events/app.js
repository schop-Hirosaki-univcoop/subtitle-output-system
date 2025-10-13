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

export class EventIndexApp {
  constructor() {
    this.dom = queryDom();
    this.api = createApiClient(auth, onAuthStateChanged);
    this.authUnsubscribe = null;
    this.currentUser = null;
    this.pendingLoginError = "";
    this.events = [];
  }

  init() {
    this.bindEvents();
    this.showLoggedOutState();
    this.observeAuthState();
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
        console.error("Failed to handle event index auth state:", error);
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
      console.error("Event index login failed:", error);
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
      this.events = [];
      this.renderEvents();
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
      await this.loadEvents();
    } catch (error) {
      console.error("Event index initialization failed:", error);
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
      err.code = "EVENT_INDEX_ACCESS_DENIED";
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
    if (error.code === "EVENT_INDEX_ACCESS_DENIED") return true;
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

  async loadEvents() {
    const [eventsSnapshot, schedulesSnapshot] = await Promise.all([
      get(ref(database, "questionIntake/events")),
      get(ref(database, "questionIntake/schedules"))
    ]);

    const eventsValue = eventsSnapshot.exists() ? eventsSnapshot.val() : {};
    const schedulesTree = schedulesSnapshot.exists() ? schedulesSnapshot.val() : {};

    const normalized = Object.entries(eventsValue).map(([eventId, eventValue]) => {
      const scheduleBranch = schedulesTree?.[eventId] && typeof schedulesTree[eventId] === "object"
        ? schedulesTree[eventId]
        : {};
      const schedules = Object.entries(scheduleBranch).map(([scheduleId, scheduleValue]) => ({
        id: ensureString(scheduleId),
        label: ensureString(scheduleValue?.label),
        startAt: ensureString(scheduleValue?.startAt || scheduleValue?.date),
        endAt: ensureString(scheduleValue?.endAt || ""),
        participantCount: Number(scheduleValue?.participantCount || 0),
        createdAt: scheduleValue?.createdAt || 0
      }));

      schedules.sort((a, b) => {
        const startDiff = toMillis(a.startAt || a.createdAt) - toMillis(b.startAt || b.createdAt);
        if (startDiff !== 0) return startDiff;
        return a.id.localeCompare(b.id, "ja", { numeric: true });
      });

      const totalParticipants = schedules.reduce((acc, item) => acc + (item.participantCount || 0), 0);

      return {
        id: ensureString(eventId),
        name: ensureString(eventValue?.name) || ensureString(eventId),
        schedules,
        totalParticipants,
        scheduleCount: schedules.length,
        createdAt: eventValue?.createdAt || 0
      };
    });

    normalized.sort((a, b) => {
      const createdDiff = toMillis(a.createdAt) - toMillis(b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });

    this.events = normalized;
    this.renderEvents();
    this.updateMetaNote();
    this.updateDocumentTitle();
  }

  renderEvents() {
    const list = this.dom.list;
    if (!list) return;

    list.innerHTML = "";
    if (!this.events.length) {
      list.hidden = true;
      if (this.dom.empty) this.dom.empty.hidden = false;
      return;
    }

    if (this.dom.empty) this.dom.empty.hidden = true;
    list.hidden = false;

    this.events.forEach((event) => {
      const item = document.createElement("li");
      item.className = "event-card";

      const heading = document.createElement("h2");
      heading.className = "event-card__title";
      heading.textContent = event.name || event.id;
      item.appendChild(heading);

      const meta = document.createElement("p");
      meta.className = "event-card__meta";
      meta.textContent = `日程 ${event.scheduleCount} 件 / 参加者 ${formatParticipantCount(event.totalParticipants)}`;
      item.appendChild(meta);

      if (event.schedules.length) {
        const nextSchedule = event.schedules[0];
        if (nextSchedule?.startAt) {
          const preview = document.createElement("p");
          preview.className = "event-card__preview";
          preview.textContent = `最初の日程: ${nextSchedule.label || nextSchedule.id}`;
          item.appendChild(preview);
        }
      }

      const actions = document.createElement("div");
      actions.className = "event-card__actions";

      const openHubLink = document.createElement("a");
      openHubLink.className = "btn btn-primary btn-sm";
      openHubLink.href = this.buildEventHubUrl(event);
      openHubLink.textContent = "日程一覧を開く";
      actions.appendChild(openHubLink);

      const manageLink = document.createElement("a");
      manageLink.className = "btn btn-ghost btn-sm";
      manageLink.href = this.buildAdminUrl(event);
      manageLink.target = "_blank";
      manageLink.rel = "noreferrer noopener";
      manageLink.textContent = "管理画面で開く";
      actions.appendChild(manageLink);

      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  buildEventHubUrl(event) {
    if (typeof window === "undefined") return "#";
    const url = new URL("event-hub.html", window.location.href);
    if (event?.id) {
      url.searchParams.set("eventId", event.id);
    }
    if (event?.name) {
      url.searchParams.set("eventName", event.name);
    }
    return url.toString();
  }

  buildAdminUrl(event) {
    if (typeof window === "undefined") return "question-admin.html";
    const url = new URL("question-admin.html", window.location.href);
    if (event?.id) {
      url.searchParams.set("eventId", event.id);
      url.searchParams.set("focus", "events");
    }
    if (event?.name) {
      url.searchParams.set("eventName", event.name);
    }
    return url.toString();
  }

  updateMetaNote() {
    if (!this.dom.metaNote) return;
    const count = this.events.length;
    if (count > 0) {
      this.dom.metaNote.hidden = false;
      this.dom.metaNote.textContent = `登録イベント数: ${count} 件`;
    } else {
      this.dom.metaNote.hidden = true;
      this.dom.metaNote.textContent = "";
    }
  }

  updateDocumentTitle() {
    if (typeof document === "undefined") {
      return;
    }
    const count = this.events.length;
    if (count > 0) {
      document.title = `イベントコントロールセンター (${count}件)`;
    } else {
      document.title = "イベントコントロールセンター";
    }
  }

  showError(message) {
    if (this.dom.alert) {
      this.dom.alert.hidden = false;
      this.dom.alert.textContent = message;
    }
    if (this.dom.list) {
      this.dom.list.hidden = true;
    }
    if (this.dom.empty) {
      this.dom.empty.hidden = true;
    }
  }
}

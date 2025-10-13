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
import { generateShortId, normalizeKey, toMillis } from "../question-admin/utils.js";

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

function collectParticipantTokens(branch) {
  const tokens = new Set();
  if (!branch || typeof branch !== "object") {
    return tokens;
  }

  Object.values(branch).forEach((scheduleBranch) => {
    if (!scheduleBranch || typeof scheduleBranch !== "object") return;
    Object.values(scheduleBranch).forEach((participant) => {
      const token = participant?.token;
      if (token) {
        tokens.add(String(token));
      }
    });
  });
  return tokens;
}

export class EventAdminApp {
  constructor() {
    this.dom = queryDom();
    this.api = createApiClient(auth, onAuthStateChanged);
    this.authUnsubscribe = null;
    this.currentUser = null;
    this.pendingLoginError = "";
    this.events = [];
    this.activeDialog = null;
    this.lastFocused = null;
    this.confirmResolver = null;
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this);
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

    if (this.dom.addEventButton) {
      this.dom.addEventButton.addEventListener("click", () => this.openEventDialog({ mode: "create" }));
    }

    if (this.dom.refreshButton) {
      this.dom.refreshButton.addEventListener("click", () => {
        this.loadEvents().catch((error) => {
          console.error("Failed to refresh events:", error);
          this.showAlert(error.message || "イベントの再読み込みに失敗しました。");
        });
      });
    }

    if (this.dom.logoutButton) {
      this.dom.logoutButton.addEventListener("click", () => signOut(auth));
    }

    if (this.dom.eventForm) {
      this.dom.eventForm.addEventListener("submit", (event) => {
        event.preventDefault();
        this.handleEventFormSubmit().catch((error) => {
          console.error("Event form submit failed:", error);
          this.setFormError(this.dom.eventError, error.message || "イベントの保存に失敗しました。");
        });
      });
    }

    this.bindDialogDismiss(this.dom.eventDialog);
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
        console.error("Failed to handle event admin auth state:", error);
        this.showAlert(error.message || "初期化に失敗しました。時間をおいて再度お試しください。");
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
      console.error("Event admin login failed:", error);
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
    this.updateControlsForAuth(false);
  }

  showLoggedInState() {
    this.setLoginError("");
    if (this.dom.loginCard) {
      this.dom.loginCard.hidden = true;
    }
    if (this.dom.main) {
      this.dom.main.hidden = false;
    }
    this.updateControlsForAuth(true);
  }

  updateControlsForAuth(signedIn) {
    if (this.dom.addEventButton) {
      this.dom.addEventButton.disabled = !signedIn;
    }
    if (this.dom.logoutButton) {
      this.dom.logoutButton.hidden = !signedIn;
    }
  }

  setLoadingMessage(message) {
    if (this.dom.loadingText) {
      this.dom.loadingText.textContent = message || "";
    }
  }

  toggleLoading(isLoading) {
    if (this.dom.loading) {
      this.dom.loading.hidden = !isLoading;
    }
  }

  clearAlert() {
    if (this.dom.alert) {
      this.dom.alert.hidden = true;
      this.dom.alert.textContent = "";
    }
  }

  showAlert(message) {
    if (this.dom.alert) {
      this.dom.alert.hidden = false;
      this.dom.alert.textContent = message;
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
      this.clearAlert();
      this.showLoggedOutState();
      return;
    }

    this.showLoggedInState();
    this.clearAlert();

    try {
      this.setLoadingMessage("権限を確認しています…");
      this.toggleLoading(true);
      await this.ensureAdminAccess();
      this.setLoadingMessage("イベント情報を読み込んでいます…");
      await this.loadEvents();
    } catch (error) {
      console.error("Event admin initialization failed:", error);
      if (this.isPermissionError(error)) {
        const message =
          (error instanceof Error && error.message) ||
          "アクセス権限がありません。管理者に確認してください。";
        this.showAlert(message);
        this.setLoginError(message);
        await this.safeSignOut();
        return;
      }
      const fallback = "イベント情報の読み込みに失敗しました。時間をおいて再度お試しください。";
      const message = error instanceof Error && error.message ? error.message : fallback;
      this.showAlert(message || fallback);
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
        createdAt: eventValue?.createdAt || 0,
        updatedAt: eventValue?.updatedAt || 0
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
    const list = this.dom.eventList;
    if (!list) return;

    list.innerHTML = "";
    if (!this.events.length) {
      list.hidden = true;
      if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = false;
      return;
    }

    list.hidden = false;
    if (this.dom.eventEmpty) this.dom.eventEmpty.hidden = true;

    const fragment = document.createDocumentFragment();
    this.events.forEach((event) => {
      const item = document.createElement("li");
      item.className = "entity-item";

      const label = document.createElement("div");
      label.className = "entity-label";

      const nameEl = document.createElement("span");
      nameEl.className = "entity-name";
      nameEl.textContent = event.name || event.id;

      const metaEl = document.createElement("span");
      metaEl.className = "entity-meta";
      metaEl.textContent = `日程 ${event.scheduleCount} 件 / 参加者 ${formatParticipantCount(event.totalParticipants)}`;

      label.append(nameEl, metaEl);

      const actions = document.createElement("div");
      actions.className = "entity-actions";

      const hubLink = document.createElement("a");
      hubLink.className = "btn btn-primary btn-sm";
      hubLink.href = this.buildEventHubUrl(event);
      hubLink.textContent = "日程ハブ";
      actions.appendChild(hubLink);

      const participantsLink = document.createElement("a");
      participantsLink.className = "btn btn-ghost btn-sm";
      participantsLink.href = this.buildParticipantAdminUrl(event);
      participantsLink.target = "_blank";
      participantsLink.rel = "noreferrer noopener";
      participantsLink.textContent = "参加者管理";
      actions.appendChild(participantsLink);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-icon";
      editBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path d=\"M12.146 2.146a.5.5 0 0 1 .708 0l1 1a.5.5 0 0 1 0 .708l-7.25 7.25a.5.5 0 0 1-.168.11l-3 1a.5.5 0 0 1-.65-.65l1-3a.5.5 0 0 1 .11-.168l7.25-7.25Zm.708 1.414L12.5 3.207 5.415 10.293l-.646 1.94 1.94-.646 7.085-7.085ZM3 13.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 0-1h-9a.5.5 0 0 0-.5.5Z\" fill=\"currentColor\"/></svg>";
      editBtn.title = "イベントを編集";
      editBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.openEventDialog({ mode: "edit", event });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-icon";
      deleteBtn.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 16 16\"><path fill=\"currentColor\" d=\"M6.5 1a1 1 0 0 0-.894.553L5.382 2H2.5a.5.5 0 0 0 0 1H3v9c0 .825.675 1.5 1.5 1.5h7c.825 0 1.5-.675 1.5-1.5V3h.5a.5.5 0 0 0 0-1h-2.882l-.224-.447A1 1 0 0 0 9.5 1h-3ZM5 3h6v9c0 .277-.223.5-.5.5h-5c-.277 0-.5-.223-.5-.5V3Z\"/></svg>";
      deleteBtn.title = "イベントを削除";
      deleteBtn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.deleteEvent(event).catch((error) => {
          console.error("Failed to delete event:", error);
          this.showAlert(error.message || "イベントの削除に失敗しました。");
        });
      });
      actions.appendChild(deleteBtn);

      item.append(label, actions);
      fragment.appendChild(item);
    });

    list.appendChild(fragment);
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

  buildEventHubUrl(event) {
    if (typeof window === "undefined") return "event-hub.html";
    const url = new URL("event-hub.html", window.location.href);
    if (event?.id) {
      url.searchParams.set("eventId", event.id);
    }
    if (event?.name) {
      url.searchParams.set("eventName", event.name);
    }
    return url.toString();
  }

  buildParticipantAdminUrl(event) {
    if (typeof window === "undefined") return "question-admin.html";
    const url = new URL("question-admin.html", window.location.href);
    if (event?.id) {
      url.searchParams.set("eventId", event.id);
      url.searchParams.set("focus", "participants");
    }
    if (event?.name) {
      url.searchParams.set("eventName", event.name);
    }
    return url.toString();
  }

  openEventDialog({ mode = "create", event = null } = {}) {
    if (!this.dom.eventDialog || !this.dom.eventForm) return;
    this.dom.eventForm.reset();
    this.dom.eventForm.dataset.mode = mode;
    this.dom.eventForm.dataset.eventId = event?.id || "";
    this.setFormError(this.dom.eventError, "");
    if (this.dom.eventDialogTitle) {
      this.dom.eventDialogTitle.textContent = mode === "edit" ? "イベントを編集" : "イベントを追加";
    }
    if (this.dom.eventNameInput) {
      this.dom.eventNameInput.value = mode === "edit" ? String(event?.name || "") : "";
    }
    const submitButton = this.dom.eventForm.querySelector("button[type='submit']");
    if (submitButton) {
      submitButton.textContent = mode === "edit" ? "保存" : "追加";
    }
    this.openDialog(this.dom.eventDialog);
  }

  closeEventDialog() {
    if (this.dom.eventDialog) {
      this.closeDialog(this.dom.eventDialog);
    }
  }

  async handleEventFormSubmit() {
    if (!this.dom.eventForm || !this.dom.eventNameInput) return;
    const submitButton = this.dom.eventForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    this.setFormError(this.dom.eventError, "");

    try {
      const mode = this.dom.eventForm.dataset.mode || "create";
      const eventId = this.dom.eventForm.dataset.eventId || "";
      const name = this.dom.eventNameInput.value;
      if (mode === "edit") {
        await this.updateEvent(eventId, name);
        this.showAlert(`イベント「${name}」を更新しました。`);
      } else {
        await this.createEvent(name);
        this.showAlert(`イベント「${name}」を追加しました。`);
      }
      this.dom.eventForm.reset();
      this.closeEventDialog();
    } catch (error) {
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async createEvent(name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }

    const existingIds = new Set(this.events.map((event) => event.id));
    let eventId = generateShortId("evt_");
    while (existingIds.has(eventId)) {
      eventId = generateShortId("evt_");
    }

    const now = Date.now();
    await set(ref(database, `questionIntake/events/${eventId}`), {
      name: trimmed,
      createdAt: now,
      updatedAt: now
    });
    await this.loadEvents();
    await this.requestSheetSync();
  }

  async updateEvent(eventId, name) {
    const trimmed = normalizeKey(name || "");
    if (!trimmed) {
      throw new Error("イベント名を入力してください。");
    }
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }

    const now = Date.now();
    await update(ref(database), {
      [`questionIntake/events/${eventId}/name`]: trimmed,
      [`questionIntake/events/${eventId}/updatedAt`]: now
    });
    await this.loadEvents();
    await this.requestSheetSync();
  }

  async deleteEvent(event) {
    const eventId = event?.id;
    if (!eventId) {
      throw new Error("イベントIDが不明です。");
    }
    const label = event?.name || eventId;
    const confirmed = await this.confirm({
      title: "イベントの削除",
      description: `イベント「${label}」と、その日程・参加者・発行済みリンクをすべて削除します。よろしいですか？`,
      confirmLabel: "削除する",
      cancelLabel: "キャンセル",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }

    try {
      const participantSnapshot = await get(ref(database, `questionIntake/participants/${eventId}`));
      const participantBranch = participantSnapshot.exists() ? participantSnapshot.val() : {};
      const tokensToRemove = collectParticipantTokens(participantBranch);

      const updates = {
        [`questionIntake/events/${eventId}`]: null,
        [`questionIntake/schedules/${eventId}`]: null,
        [`questionIntake/participants/${eventId}`]: null
      };
      tokensToRemove.forEach((token) => {
        updates[`questionIntake/tokens/${token}`] = null;
      });

      await update(ref(database), updates);
      await this.loadEvents();
      await this.requestSheetSync();
      this.showAlert(`イベント「${label}」を削除しました。`);
    } catch (error) {
      throw new Error(error?.message || "イベントの削除に失敗しました。");
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
    if (element === this.dom.eventDialog && this.dom.eventForm) {
      this.dom.eventForm.reset();
      this.setFormError(this.dom.eventError, "");
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
      this.finalizeConfirm(false);
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

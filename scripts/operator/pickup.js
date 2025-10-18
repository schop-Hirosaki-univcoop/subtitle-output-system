import { GENRE_OPTIONS } from "./constants.js";
import { pickupQuestionsRef, database, ref, update, onValue } from "./firebase.js";
import { escapeHtml, resolveGenreLabel, formatRelative } from "./utils.js";

const ALL_FILTER_VALUE = "all";

const PICKUP_DEFAULT_FIELDS = {
  name: "Pick Up Question",
  pickup: true,
  type: "pickup",
  schedule: "",
  scheduleStart: "",
  scheduleEnd: "",
  scheduleDate: "",
  participantId: "",
  participantName: "",
  guidance: "",
  eventId: "",
  eventName: "",
  scheduleId: ""
};

function normalizeGenreValue(value) {
  const label = resolveGenreLabel(value);
  return label || "その他";
}

function normalizeFilterValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return ALL_FILTER_VALUE;
  }
  if (raw.toLowerCase() === ALL_FILTER_VALUE) {
    return ALL_FILTER_VALUE;
  }
  return normalizeGenreValue(raw);
}

function getFilterOptions() {
  return [{ value: ALL_FILTER_VALUE, label: "すべて" }].concat(
    GENRE_OPTIONS.map((label) => ({ value: label, label }))
  );
}

function getPickupFilterButtons(app) {
  const container = app?.dom?.pickupTabs;
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll("button[data-genre]"))
    .filter((button) => button instanceof HTMLButtonElement);
}

function renderPickupFilterTabs(app) {
  const container = app?.dom?.pickupTabs;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  container.setAttribute("role", "tablist");
  getFilterOptions().forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pickup-tab";
    button.dataset.genre = option.value;
    button.textContent = option.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.tabIndex = index === 0 ? 0 : -1;
    container.appendChild(button);
  });
}

function updatePickupFilterUi(app) {
  const buttons = getPickupFilterButtons(app);
  if (!buttons.length) {
    return false;
  }
  const active = normalizeFilterValue(app?.pickupActiveFilter);
  let matched = false;
  buttons.forEach((button) => {
    const value = normalizeFilterValue(button.dataset.genre);
    const isActive = !matched && value === active;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive) {
      matched = true;
    }
  });
  if (!matched) {
    const [first] = buttons;
    if (first) {
      first.classList.add("is-active");
      first.setAttribute("aria-selected", "true");
      first.tabIndex = 0;
      const previous = normalizeFilterValue(app.pickupActiveFilter);
      app.pickupActiveFilter = ALL_FILTER_VALUE;
      return previous !== ALL_FILTER_VALUE;
    }
  }
  return false;
}

function getFilteredPickupEntries(app) {
  const entries = Array.isArray(app?.pickupEntries) ? app.pickupEntries : [];
  const active = normalizeFilterValue(app?.pickupActiveFilter);
  if (active === ALL_FILTER_VALUE) {
    return entries;
  }
  return entries.filter((entry) => normalizeGenreValue(entry.genre) === active);
}

function createPickupRecord(uid, question, genre, existingRecord = null, timestamp = Date.now()) {
  const base = existingRecord && typeof existingRecord === "object" ? { ...existingRecord } : {};
  const defaults = { ...PICKUP_DEFAULT_FIELDS };
  const record = { ...defaults, ...base };
  record.uid = uid;
  record.question = question;
  record.genre = genre;
  record.pickup = true;
  record.type = "pickup";
  record.name = String(record.name || defaults.name);
  if (!record.ts) {
    record.ts = timestamp;
  }
  record.updatedAt = timestamp;
  return record;
}

function scheduleSheetSync(app) {
  if (!app?.api?.apiPost) {
    return;
  }
  try {
    const promise = app.api.apiPost({ action: "syncQuestionIntakeToSheet" });
    if (promise && typeof promise.catch === "function") {
      promise.catch((error) => {
        console.debug("pickup sheet sync skipped", error);
      });
    }
  } catch (error) {
    console.debug("pickup sheet sync not scheduled", error);
  }
}

function ensureGenreOptions(select) {
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  const existingValues = new Set(Array.from(select.options).map((option) => option.value));
  GENRE_OPTIONS.forEach((label) => {
    if (existingValues.has(label)) {
      return;
    }
    const option = document.createElement("option");
    option.value = label;
    option.textContent = label;
    select.appendChild(option);
  });
}

function ensureSelectValue(select, value) {
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  const normalized = String(value || "");
  if (!normalized) {
    return;
  }
  const exists = Array.from(select.options).some((option) => option.value === normalized);
  if (!exists) {
    const option = document.createElement("option");
    option.value = normalized;
    option.textContent = normalized;
    select.appendChild(option);
  }
}

function hidePickupAlert(app) {
  if (app.dom.pickupAlert) {
    app.dom.pickupAlert.hidden = true;
    app.dom.pickupAlert.textContent = "";
  }
}

function showPickupAlert(app, message) {
  if (app.dom.pickupAlert) {
    app.dom.pickupAlert.textContent = message;
    app.dom.pickupAlert.hidden = !message;
  } else if (message) {
    console.warn("pickup alert:", message);
  }
}

function normalizePickupEntry(uid, record) {
  const entry = record && typeof record === "object" ? record : {};
  const normalizedUid = String(uid || entry.uid || "").trim();
  const question = String(entry.question || "").trim();
  if (!normalizedUid || !question) {
    return null;
  }
  const genreLabel = resolveGenreLabel(entry.genre);
  const updatedAt = Number(entry.updatedAt || entry.ts || 0) || 0;
  return {
    uid: normalizedUid,
    question,
    genre: genreLabel,
    updatedAt,
    raw: { ...entry, uid: normalizedUid }
  };
}

function applyPickupSnapshot(app, value) {
  const list = [];
  if (Array.isArray(value)) {
    value.forEach((item) => {
      const entry = normalizePickupEntry(item?.uid, item);
      if (entry) {
        list.push(entry);
      }
    });
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([uid, record]) => {
      const entry = normalizePickupEntry(uid, record);
      if (entry) {
        list.push(entry);
      }
    });
  }
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  app.pickupEntries = list;
  renderPickupList(app);
  const filterChanged = updatePickupFilterUi(app);
  if (filterChanged) {
    renderPickupList(app);
  }
  app.pickupLoaded = true;
}

function renderEmptyState(app, isEmpty) {
  if (app.dom.pickupEmpty) {
    app.dom.pickupEmpty.hidden = !isEmpty;
  }
}

function createMetaHtml(entry) {
  const relative = entry.updatedAt ? formatRelative(entry.updatedAt) : "";
  const timeLabel = relative ? `最終更新: ${relative}` : "";
  return `
    <div class="pickup-card__meta">
      <span class="pickup-card__genre">${escapeHtml(entry.genre || "その他")}</span>
      ${timeLabel ? `<span class="pickup-card__time">${escapeHtml(timeLabel)}</span>` : ""}
    </div>
  `;
}

export function renderPickupList(app) {
  const container = app.dom.pickupList;
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const allEntries = Array.isArray(app.pickupEntries) ? app.pickupEntries : [];
  const entries = getFilteredPickupEntries(app);
  if (!entries.length) {
    renderEmptyState(app, true);
    if (app.dom.pickupEmpty && app.dom.pickupEmpty.dataset) {
      app.dom.pickupEmpty.dataset.state = allEntries.length ? "filtered" : "empty";
    }
    return;
  }
  renderEmptyState(app, false);
  if (app.dom.pickupEmpty && app.dom.pickupEmpty.dataset) {
    delete app.dom.pickupEmpty.dataset.state;
  }
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "pickup-card";
    item.dataset.uid = entry.uid;
    const escapedQuestion = escapeHtml(entry.question).replace(/\n/g, "<br>");
    item.innerHTML = `
      <div class="pickup-card__body">
        <p class="pickup-card__question">${escapedQuestion}</p>
        ${createMetaHtml(entry)}
      </div>
      <div class="pickup-card__actions">
        <button type="button" class="btn btn-ghost btn-sm" data-action="edit">編集</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete">削除</button>
      </div>
    `;
    const editButton = item.querySelector('[data-action="edit"]');
    if (editButton instanceof HTMLButtonElement) {
      editButton.addEventListener("click", () => openPickupEditDialog(app, entry, editButton));
    }
    const deleteButton = item.querySelector('[data-action="delete"]');
    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.addEventListener("click", () => confirmPickupDelete(app, entry, deleteButton));
    }
    container.appendChild(item);
  });
}

function ensurePickupStates(app) {
  if (!app.pickupEditState) {
    app.pickupEditState = { uid: "", submitting: false, lastFocused: null };
  }
  if (!app.pickupConfirmState) {
    app.pickupConfirmState = { uid: "", submitting: false, lastFocused: null, question: "" };
  }
}

function setupPickupEditDialog(app) {
  if (app.pickupEditDialogSetup) {
    return;
  }
  const dialog = app.dom.pickupEditDialog;
  if (!dialog) {
    return;
  }
  dialog.querySelectorAll("[data-dialog-dismiss]").forEach((element) => {
    element.addEventListener("click", () => closePickupEditDialog(app));
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePickupEditDialog(app);
    }
  });
  app.pickupEditDialogSetup = true;
}

function setupPickupConfirmDialog(app) {
  if (app.pickupConfirmDialogSetup) {
    return;
  }
  const dialog = app.dom.pickupConfirmDialog;
  if (!dialog) {
    return;
  }
  dialog.querySelectorAll("[data-dialog-dismiss]").forEach((element) => {
    element.addEventListener("click", () => closePickupConfirmDialog(app));
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePickupConfirmDialog(app);
    }
  });
  app.pickupConfirmDialogSetup = true;
}

export function applyInitialPickupState(app) {
  ensurePickupStates(app);
  ensureGenreOptions(app.dom.pickupGenreSelect);
  ensureGenreOptions(app.dom.pickupEditGenre);
  if (app.dom.pickupGenreSelect instanceof HTMLSelectElement && !app.dom.pickupGenreSelect.value) {
    const first = app.dom.pickupGenreSelect.options[0];
    if (first) {
      app.dom.pickupGenreSelect.value = first.value;
    }
  }
  renderPickupFilterTabs(app);
  if (!app.pickupActiveFilter) {
    app.pickupActiveFilter = ALL_FILTER_VALUE;
  }
  app.pickupActiveFilter = normalizeFilterValue(app.pickupActiveFilter);
  updatePickupFilterUi(app);
  hidePickupAlert(app);
  renderPickupList(app);
}

export function startPickupListener(app) {
  if (app.pickupUnsubscribe) {
    app.pickupUnsubscribe();
    app.pickupUnsubscribe = null;
  }
  setupPickupEditDialog(app);
  setupPickupConfirmDialog(app);
  app.pickupUnsubscribe = onValue(
    pickupQuestionsRef,
    (snapshot) => {
      applyPickupSnapshot(app, snapshot.val() || {});
    },
    (error) => {
      console.error("Failed to subscribe pickup questions", error);
      showPickupAlert(app, "Pick Up Question の取得に失敗しました。");
    }
  );
}

export function stopPickupListener(app) {
  if (app.pickupUnsubscribe) {
    app.pickupUnsubscribe();
    app.pickupUnsubscribe = null;
  }
}

function setBusy(target, busy) {
  if (!target) {
    return;
  }
  if (busy) {
    target.setAttribute("disabled", "true");
  } else {
    target.removeAttribute("disabled");
  }
}

export async function fetchPickupQuestions(app) {
  const button = app.dom.pickupRefreshButton;
  setBusy(button, true);
  try {
    const result = await app.api.apiPost({ action: "mirrorSheet" });
    if (!result?.success) {
      throw new Error(result?.error || "Pick Up Question の再読み込みに失敗しました。");
    }
    app.toast("最新の質問を読み込みました。", "success");
  } catch (error) {
    console.error("Failed to refresh pickup questions", error);
    app.toast("Pick Up Question の再読み込みに失敗しました。", "error");
  } finally {
    setBusy(button, false);
  }
}

function setPickupFilter(app, value) {
  const next = normalizeFilterValue(value);
  const current = normalizeFilterValue(app?.pickupActiveFilter);
  app.pickupActiveFilter = next;
  const changedByUi = updatePickupFilterUi(app);
  if (changedByUi || next !== current) {
    renderPickupList(app);
  }
}

export function handlePickupFilterClick(app, event) {
  if (!event) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }
  const button = target.closest("button[data-genre]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const value = button.dataset.genre || ALL_FILTER_VALUE;
  setPickupFilter(app, value);
  button.focus();
}

export function handlePickupFilterKeydown(app, event) {
  if (!event) {
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.genre) {
    return;
  }
  const buttons = getPickupFilterButtons(app);
  if (!buttons.length) {
    return;
  }
  const currentIndex = buttons.indexOf(target);
  if (currentIndex === -1) {
    return;
  }
  let handled = false;
  let nextIndex = currentIndex;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      nextIndex = (currentIndex + 1) % buttons.length;
      handled = true;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      handled = true;
      break;
    case "Home":
      nextIndex = 0;
      handled = true;
      break;
    case "End":
      nextIndex = buttons.length - 1;
      handled = true;
      break;
    case " ":
    case "Space":
    case "Spacebar":
    case "Enter":
      event.preventDefault();
      setPickupFilter(app, target.dataset.genre || ALL_FILTER_VALUE);
      return;
    default:
      break;
  }
  if (!handled) {
    return;
  }
  event.preventDefault();
  const nextButton = buttons[nextIndex];
  if (nextButton) {
    nextButton.focus();
    setPickupFilter(app, nextButton.dataset.genre || ALL_FILTER_VALUE);
  }
}

export async function handlePickupFormSubmit(app, event) {
  event.preventDefault();
  ensurePickupStates(app);
  hidePickupAlert(app);
  const questionInput = app.dom.pickupQuestionInput;
  const genreSelect = app.dom.pickupGenreSelect;
  const submitButton = event.submitter instanceof HTMLButtonElement ? event.submitter : null;
  const question = questionInput ? questionInput.value.trim() : "";
  if (!question) {
    showPickupAlert(app, "質問内容を入力してください。");
    if (questionInput) {
      questionInput.focus();
    }
    return;
  }
  const genre = genreSelect ? normalizeGenreValue(genreSelect.value) : "その他";
  setBusy(submitButton, true);
  try {
    const now = Date.now();
    const uid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(16).slice(2, 10)}`;
    const record = createPickupRecord(uid, question, genre, null, now);
    const updates = {
      [`questions/pickup/${uid}`]: record,
      [`questionStatus/${uid}`]: { answered: false, selecting: false, pickup: true, updatedAt: now }
    };
    await update(ref(database), updates);
    if (questionInput) {
      questionInput.value = "";
      questionInput.focus();
    }
    app.toast("Pick Up Question を追加しました。", "success");
    scheduleSheetSync(app);
  } catch (error) {
    console.error("Failed to add pickup question", error);
    app.toast("Pick Up Question の追加に失敗しました。", "error");
    showPickupAlert(app, "Pick Up Question の追加に失敗しました。もう一度お試しください。");
  } finally {
    setBusy(submitButton, false);
  }
}

export function openPickupEditDialog(app, entry, triggerButton) {
  ensurePickupStates(app);
  setupPickupEditDialog(app);
  const dialog = app.dom.pickupEditDialog;
  if (!dialog) {
    return;
  }
  const state = app.pickupEditState;
  state.uid = entry.uid;
  state.submitting = false;
  state.lastFocused = triggerButton || document.activeElement;
  if (app.dom.pickupEditQuestion) {
    app.dom.pickupEditQuestion.value = entry.question;
  }
  if (app.dom.pickupEditGenre) {
    ensureGenreOptions(app.dom.pickupEditGenre);
    ensureSelectValue(app.dom.pickupEditGenre, entry.genre);
    app.dom.pickupEditGenre.value = entry.genre;
  }
  dialog.hidden = false;
  const focusTarget = app.dom.pickupEditQuestion || dialog.querySelector("textarea, input");
  if (focusTarget instanceof HTMLElement) {
    focusTarget.focus();
  }
}

export function closePickupEditDialog(app) {
  const dialog = app.dom.pickupEditDialog;
  if (!dialog) {
    return;
  }
  dialog.hidden = true;
  if (app.dom.pickupEditSaveButton) {
    setBusy(app.dom.pickupEditSaveButton, false);
  }
  if (app.dom.pickupEditCancelButton) {
    app.dom.pickupEditCancelButton.removeAttribute("disabled");
  }
  if (app.pickupEditState?.lastFocused instanceof HTMLElement) {
    app.pickupEditState.lastFocused.focus();
  }
  if (app.pickupEditState) {
    app.pickupEditState.uid = "";
    app.pickupEditState.submitting = false;
    app.pickupEditState.lastFocused = null;
  }
}

export async function handlePickupEditSubmit(app, event) {
  event.preventDefault();
  ensurePickupStates(app);
  const state = app.pickupEditState;
  if (!state?.uid) {
    closePickupEditDialog(app);
    return;
  }
  const questionInput = app.dom.pickupEditQuestion;
  const genreSelect = app.dom.pickupEditGenre;
  const saveButton = app.dom.pickupEditSaveButton;
  const cancelButton = app.dom.pickupEditCancelButton;
  const question = questionInput ? questionInput.value.trim() : "";
  if (!question) {
    showPickupAlert(app, "質問内容を入力してください。");
    if (questionInput) {
      questionInput.focus();
    }
    return;
  }
  const genre = genreSelect ? normalizeGenreValue(genreSelect.value) : "その他";
  state.submitting = true;
  setBusy(saveButton, true);
  if (cancelButton) {
    cancelButton.setAttribute("disabled", "true");
  }
  try {
    const now = Date.now();
    const existing = Array.isArray(app.pickupEntries)
      ? app.pickupEntries.find((entry) => entry.uid === state.uid)
      : null;
    const record = createPickupRecord(state.uid, question, genre, existing?.raw || null, now);
    const updates = {
      [`questions/pickup/${state.uid}`]: record
    };
    const statusMap = app.state?.questionStatusByUid;
    const statusEntry = statusMap instanceof Map ? statusMap.get(state.uid) : null;
    if (statusEntry) {
      updates[`questionStatus/${state.uid}/updatedAt`] = now;
      updates[`questionStatus/${state.uid}/pickup`] = true;
    } else {
      updates[`questionStatus/${state.uid}`] = {
        answered: false,
        selecting: false,
        pickup: true,
        updatedAt: now
      };
    }
    await update(ref(database), updates);
    app.toast("Pick Up Question を更新しました。", "success");
    closePickupEditDialog(app);
    scheduleSheetSync(app);
  } catch (error) {
    console.error("Failed to update pickup question", error);
    app.toast("Pick Up Question の更新に失敗しました。", "error");
    setBusy(saveButton, false);
    if (cancelButton) {
      cancelButton.removeAttribute("disabled");
    }
    state.submitting = false;
  }
}

export function confirmPickupDelete(app, entry, triggerButton) {
  ensurePickupStates(app);
  setupPickupConfirmDialog(app);
  const dialog = app.dom.pickupConfirmDialog;
  if (!dialog) {
    return;
  }
  const message = app.dom.pickupConfirmMessage;
  const state = app.pickupConfirmState;
  state.uid = entry.uid;
  state.question = entry.question;
  state.lastFocused = triggerButton || document.activeElement;
  state.submitting = false;
  if (message) {
    const snippet = entry.question.length > 40 ? `${entry.question.slice(0, 40)}…` : entry.question;
    message.textContent = `「${snippet}」を削除しますか？`;
  }
  dialog.hidden = false;
  const acceptButton = app.dom.pickupConfirmAcceptButton;
  if (acceptButton) {
    acceptButton.removeAttribute("disabled");
    acceptButton.focus();
  }
  if (app.dom.pickupConfirmCancelButton) {
    app.dom.pickupConfirmCancelButton.removeAttribute("disabled");
  }
}

export function closePickupConfirmDialog(app) {
  const dialog = app.dom.pickupConfirmDialog;
  if (!dialog) {
    return;
  }
  dialog.hidden = true;
  if (app.dom.pickupConfirmAcceptButton) {
    setBusy(app.dom.pickupConfirmAcceptButton, false);
  }
  if (app.dom.pickupConfirmCancelButton) {
    app.dom.pickupConfirmCancelButton.removeAttribute("disabled");
  }
  const state = app.pickupConfirmState;
  if (state?.lastFocused instanceof HTMLElement) {
    state.lastFocused.focus();
  }
  if (state) {
    state.uid = "";
    state.question = "";
    state.lastFocused = null;
    state.submitting = false;
  }
}

export async function handlePickupDelete(app) {
  ensurePickupStates(app);
  const state = app.pickupConfirmState;
  if (!state?.uid) {
    closePickupConfirmDialog(app);
    return;
  }
  const acceptButton = app.dom.pickupConfirmAcceptButton;
  const cancelButton = app.dom.pickupConfirmCancelButton;
  state.submitting = true;
  setBusy(acceptButton, true);
  if (cancelButton) {
    cancelButton.setAttribute("disabled", "true");
  }
  try {
    const updates = {
      [`questions/pickup/${state.uid}`]: null,
      [`questionStatus/${state.uid}`]: null
    };
    await update(ref(database), updates);
    app.toast("Pick Up Question を削除しました。", "success");
    closePickupConfirmDialog(app);
    scheduleSheetSync(app);
  } catch (error) {
    console.error("Failed to delete pickup question", error);
    app.toast("Pick Up Question の削除に失敗しました。", "error");
    setBusy(acceptButton, false);
    if (cancelButton) {
      cancelButton.removeAttribute("disabled");
    }
    state.submitting = false;
  }
}

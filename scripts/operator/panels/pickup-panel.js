// pickup-panel.js: Pick Up Question 管理パネルの実装です。 Pick Up Question機能の抽選・管理ロジックをまとめています。
import { GENRE_OPTIONS, GENRE_ALL_VALUE } from "../constants.js";
import { pickupQuestionsRef, database, ref, update, onValue, get, getQuestionStatusRef } from "../firebase.js";
import { escapeHtml, resolveGenreLabel, formatRelative } from "../utils.js";
import { normalizeEventId } from "../../shared/channel-paths.js";

const ALL_FILTER_VALUE = GENRE_ALL_VALUE;

const PICKUP_LOADER_STEPS = [
  { label: "初期化", message: "Pick Upパネルを初期化しています…" },
  { label: "取得", message: "Pick Up一覧を取得しています…" },
  { label: "表示更新", message: "表示を更新しています…" },
  { label: "監視開始", message: "リアルタイム監視を開始しています…" },
  { label: "完了", message: "準備が整いました！" }
];

function ensurePickupLoader(app) {
  if (!app) {
    return;
  }
  if (typeof app.pickupLoaderCurrentStep !== "number") {
    app.pickupLoaderCurrentStep = 0;
  }
  if (!app.pickupLoaderSetup && app.dom.pickupLoaderSteps) {
    app.dom.pickupLoaderSteps.innerHTML = PICKUP_LOADER_STEPS.map(
      ({ label }, index) => `<li data-step="${index}">${escapeHtml(label)}</li>`
    ).join("");
    app.pickupLoaderSetup = true;
  }
}

function isPickupPanelVisible(app) {
  const panel = app?.dom?.pickupPanel;
  return !!(panel && !panel.hasAttribute("hidden"));
}

function showPickupLoader(app) {
  if (app?.dom?.pickupLoadingOverlay) {
    app.dom.pickupLoadingOverlay.removeAttribute("hidden");
  }
}

function hidePickupLoader(app) {
  if (app?.dom?.pickupLoadingOverlay) {
    app.dom.pickupLoadingOverlay.setAttribute("hidden", "");
  }
}

function maybeShowPickupLoader(app) {
  if (!app || app.pickupLoaderCompleted) {
    return;
  }
  if (isPickupPanelVisible(app)) {
    showPickupLoader(app);
  }
}

function setPickupLoaderStep(app, stepIndex, { force = false } = {}) {
  if (!app) {
    return;
  }
  ensurePickupLoader(app);
  const steps = PICKUP_LOADER_STEPS;
  const normalized = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const current = typeof app.pickupLoaderCurrentStep === "number" ? app.pickupLoaderCurrentStep : 0;
  if (!force && normalized < current) {
    return;
  }
  app.pickupLoaderCurrentStep = normalized;
  const { message } = steps[normalized] || steps[0];
  if (app.dom.pickupLoadingText) {
    app.dom.pickupLoadingText.textContent = message;
  }
  const list = app.dom.pickupLoaderSteps;
  if (list) {
    list.querySelectorAll("li").forEach((item, index) => {
      item.classList.toggle("current", index === normalized);
      item.classList.toggle("done", index < normalized);
    });
  }
  app.pickupLoaderCompleted = normalized >= steps.length - 1;
  if (!app.pickupLoaderCompleted) {
    maybeShowPickupLoader(app);
  }
}

function completePickupLoader(app) {
  if (!app) {
    return;
  }
  setPickupLoaderStep(app, PICKUP_LOADER_STEPS.length - 1, { force: true });
  app.pickupLoaderCompleted = true;
  hidePickupLoader(app);
}

export function resetPickupLoader(app) {
  if (!app) {
    return;
  }
  ensurePickupLoader(app);
  app.pickupLoaderCompleted = false;
  setPickupLoaderStep(app, 0, { force: true });
  hidePickupLoader(app);
}

const PICKUP_DEFAULT_FIELDS = {
  name: "Pick Up Question",
  pickup: true,
  type: "pickup"
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
  // 許可されているフィールドのみを保持（正規化により不要なフィールドを除外）
  const ALLOWED_FIELDS = new Set(['uid', 'name', 'question', 'genre', 'pickup', 'type', 'ts', 'updatedAt']);
  const base = existingRecord && typeof existingRecord === "object" ? { ...existingRecord } : {};
  // 既存レコードから許可されているフィールドのみを抽出
  const filteredBase = {};
  Object.keys(base).forEach((key) => {
    if (ALLOWED_FIELDS.has(key)) {
      filteredBase[key] = base[key];
    }
  });
  const defaults = { ...PICKUP_DEFAULT_FIELDS };
  const record = { ...defaults, ...filteredBase };
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

function buildPickupLogDetails(uid, question, genre) {
  const normalizedUid = String(uid || "");
  const normalizedGenre = normalizeGenreValue(genre);
  const snippet = String(question || "")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = snippet.length > 40 ? `${snippet.slice(0, 40)}…` : snippet || "—";
  return `UID: ${normalizedUid}, Genre: ${normalizedGenre}, Q: ${truncated}`;
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
  const wasLoaded = !!app.pickupLoaded;
  if (!wasLoaded) {
    setPickupLoaderStep(app, 2);
  }
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
  syncPickupSelectionFromEntries(app);
  renderPickupList(app);
  const filterChanged = updatePickupFilterUi(app);
  if (filterChanged) {
    renderPickupList(app);
  }
  app.pickupLoaded = true;
  if (!wasLoaded) {
    setPickupLoaderStep(app, 3);
    completePickupLoader(app);
  }
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

function ensurePickupSelectionState(app) {
  if (typeof app.pickupSelectedId !== "string") {
    app.pickupSelectedId = "";
  }
  if (!app.pickupSelectedEntry || typeof app.pickupSelectedEntry !== "object") {
    app.pickupSelectedEntry = null;
  }
}

function syncPickupSelectionFromEntries(app) {
  ensurePickupSelectionState(app);
  const entries = Array.isArray(app.pickupEntries) ? app.pickupEntries : [];
  const selectedId = app.pickupSelectedId;
  if (!selectedId) {
    app.pickupSelectedEntry = null;
    return;
  }
  const match = entries.find((entry) => entry.uid === selectedId);
  if (match) {
    app.pickupSelectedEntry = match;
  } else {
    app.pickupSelectedId = "";
    app.pickupSelectedEntry = null;
  }
}

function summarizeQuestion(question, limit = 42) {
  const normalized = String(question || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function isPickupEntryVisible(app, uid) {
  if (!uid) {
    return false;
  }
  const container = app.dom.pickupList;
  if (!container) {
    return false;
  }
  const items = container.querySelectorAll(".pickup-card");
  return Array.from(items).some((element) => element instanceof HTMLElement && element.dataset.uid === uid);
}

function updatePickupActionPanel(app) {
  const panel = app.dom.pickupActionPanel;
  if (!panel) {
    return;
  }
  ensurePickupSelectionState(app);
  const selected = app.pickupSelectedEntry && app.pickupSelectedEntry.uid === app.pickupSelectedId
    ? app.pickupSelectedEntry
    : null;
  const hasSelection = Boolean(selected);
  panel.classList.toggle("is-idle", !hasSelection);
  const info = app.dom.pickupSelectedInfo;
  if (info) {
    if (hasSelection) {
      const snippet = summarizeQuestion(selected.question);
      const visible = isPickupEntryVisible(app, selected.uid);
      info.textContent = visible ? `選択中: ${snippet}` : `選択中 (表示外): ${snippet}`;
    } else {
      info.textContent = "質問を選択してください";
    }
  }
  if (app.dom.pickupEditButton instanceof HTMLButtonElement) {
    app.dom.pickupEditButton.disabled = !hasSelection;
  }
  if (app.dom.pickupDeleteButton instanceof HTMLButtonElement) {
    app.dom.pickupDeleteButton.disabled = !hasSelection;
  }
}

function syncPickupSelectionUi(app) {
  const container = app.dom.pickupList;
  if (container) {
    const selectedId = typeof app.pickupSelectedId === "string" ? app.pickupSelectedId : "";
    container.querySelectorAll(".pickup-card").forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const isSelected = element.dataset.uid === selectedId;
      element.classList.toggle("is-selected", isSelected);
      element.setAttribute("aria-pressed", String(isSelected));
    });
  }
  updatePickupActionPanel(app);
}

function togglePickupSelection(app, entry) {
  ensurePickupSelectionState(app);
  if (!entry || !entry.uid) {
    return;
  }
  if (app.pickupSelectedId === entry.uid) {
    app.pickupSelectedId = "";
    app.pickupSelectedEntry = null;
  } else {
    app.pickupSelectedId = entry.uid;
    app.pickupSelectedEntry = entry;
  }
  syncPickupSelectionUi(app);
}

export function renderPickupList(app) {
  const container = app.dom.pickupList;
  if (!container) {
    return;
  }
  ensurePickupSelectionState(app);
  container.innerHTML = "";
  const allEntries = Array.isArray(app.pickupEntries) ? app.pickupEntries : [];
  const entries = getFilteredPickupEntries(app);
  if (!entries.length) {
    renderEmptyState(app, true);
    if (app.dom.pickupEmpty && app.dom.pickupEmpty.dataset) {
      app.dom.pickupEmpty.dataset.state = allEntries.length ? "filtered" : "empty";
    }
    syncPickupSelectionUi(app);
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
    const isSelected = app.pickupSelectedId === entry.uid;
    if (isSelected) {
      item.classList.add("is-selected");
    }
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-pressed", String(isSelected));
    const escapedQuestion = escapeHtml(entry.question).replace(/\n/g, "<br>");
    item.innerHTML = `
      <div class="pickup-card__body">
        <p class="pickup-card__question">${escapedQuestion}</p>
        ${createMetaHtml(entry)}
      </div>
    `;
    item.addEventListener("click", () => togglePickupSelection(app, entry));
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        togglePickupSelection(app, entry);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        confirmPickupDelete(app, entry, item);
      }
    });
    item.addEventListener("dblclick", () => openPickupEditDialog(app, entry, item));
    container.appendChild(item);
  });
  syncPickupSelectionUi(app);
}

function ensurePickupStates(app) {
  ensurePickupSelectionState(app);
  if (!app.pickupAddState) {
    app.pickupAddState = { submitting: false, lastFocused: null };
  }
  if (!app.pickupEditState) {
    app.pickupEditState = { uid: "", submitting: false, lastFocused: null };
  }
  if (!app.pickupConfirmState) {
    app.pickupConfirmState = { uid: "", submitting: false, lastFocused: null, question: "", genre: "" };
  }
}

function setupPickupAddDialog(app) {
  if (app.pickupAddDialogSetup) {
    return;
  }
  const dialog = app.dom.pickupAddDialog;
  if (!dialog) {
    return;
  }
  dialog.addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || !target.dataset.dialogDismiss) {
      return;
    }
    event.preventDefault();
    if (app.pickupAddState?.submitting) {
      return;
    }
    closePickupAddDialog(app);
  });
  dialog.addEventListener("keydown", (event) => {
    // 入力欄に入力中はESC以外の単キーボードショートカット（修飾キーを使わないもの、Shiftを使うもの）は反応しないようにする
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (
      activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable
    );
    
    // ESCキーは常に有効（フルスクリーン解除などで使用されるため）
    if (event.key === "Escape") {
      event.preventDefault();
      if (app.pickupAddState?.submitting) {
        return;
      }
      closePickupAddDialog(app);
      return;
    }
    
    // 入力欄にフォーカスがある場合は、単キーボードショートカットを無効化
    if (isInputFocused && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return;
    }
    
    // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
    if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      if (app.pickupAddState?.submitting) {
        return;
      }
      closePickupAddDialog(app);
    }
  });
  app.pickupAddDialogSetup = true;
}

export function openPickupAddDialog(app, event) {
  ensurePickupStates(app);
  setupPickupAddDialog(app);
  const dialog = app.dom.pickupAddDialog;
  if (!dialog) {
    return;
  }
  const state = app.pickupAddState;
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
  state.lastFocused = trigger instanceof HTMLElement ? trigger : null;
  state.submitting = false;
  ensureGenreOptions(app.dom.pickupGenreSelect);
  if (app.dom.pickupGenreSelect instanceof HTMLSelectElement && !app.dom.pickupGenreSelect.value) {
    const first = app.dom.pickupGenreSelect.options[0];
    if (first) {
      app.dom.pickupGenreSelect.value = first.value;
    }
  }
  dialog.hidden = false;
  const focusTarget = app.dom.pickupQuestionInput || dialog.querySelector("textarea, input");
  if (focusTarget instanceof HTMLElement) {
    focusTarget.focus();
  }
}

export function closePickupAddDialog(app) {
  const dialog = app.dom.pickupAddDialog;
  if (!dialog) {
    return;
  }
  dialog.hidden = true;
  if (app.dom.pickupAddCancelButton instanceof HTMLButtonElement) {
    app.dom.pickupAddCancelButton.removeAttribute("disabled");
  }
  const state = app.pickupAddState;
  if (state?.lastFocused instanceof HTMLElement) {
    state.lastFocused.focus();
  }
  if (state) {
    state.submitting = false;
    state.lastFocused = null;
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
    // 入力欄に入力中はESC以外の単キーボードショートカット（修飾キーを使わないもの、Shiftを使うもの）は反応しないようにする
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (
      activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable
    );
    
    // ESCキーは常に有効（フルスクリーン解除などで使用されるため）
    if (event.key === "Escape") {
      event.preventDefault();
      closePickupEditDialog(app);
      return;
    }
    
    // 入力欄にフォーカスがある場合は、単キーボードショートカットを無効化
    if (isInputFocused && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return;
    }
    
    // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
    if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
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
    // 入力欄に入力中はESC以外の単キーボードショートカット（修飾キーを使わないもの、Shiftを使うもの）は反応しないようにする
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (
      activeElement.tagName === "INPUT" ||
      activeElement.tagName === "TEXTAREA" ||
      activeElement.isContentEditable
    );
    
    // ESCキーは常に有効（フルスクリーン解除などで使用されるため）
    if (event.key === "Escape") {
      event.preventDefault();
      closePickupConfirmDialog(app);
      return;
    }
    
    // 入力欄にフォーカスがある場合は、単キーボードショートカットを無効化
    if (isInputFocused && !event.ctrlKey && !event.metaKey && !event.altKey) {
      return;
    }
    
    // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
    if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
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
  updatePickupActionPanel(app);
}

export function startPickupListener(app) {
  if (app.pickupUnsubscribe) {
    app.pickupUnsubscribe();
    app.pickupUnsubscribe = null;
  }
  setPickupLoaderStep(app, 1);
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
      hidePickupLoader(app);
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
    const snapshot = await get(pickupQuestionsRef);
    const value = snapshot?.exists?.() && snapshot.exists() ? snapshot.val() || {} : {};
    applyPickupSnapshot(app, value);
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
  const cancelButton = app.dom.pickupAddCancelButton instanceof HTMLButtonElement ? app.dom.pickupAddCancelButton : null;
  const addState = app.pickupAddState || null;
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
  if (cancelButton) {
    cancelButton.setAttribute("disabled", "true");
  }
  if (addState) {
    addState.submitting = true;
  }
  try {
    const now = Date.now();
    const uid =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(16).slice(2, 10)}`;
    const record = createPickupRecord(uid, question, genre, null, now);
    const eventIdRaw = app.state?.activeEventId;
    const eventId = eventIdRaw ? String(eventIdRaw).trim() : "";
    const { scheduleId = "" } = app.getActiveChannel?.() || {};
    // questionStatusへの書き込みはeventIdとscheduleIdが存在する場合のみ
    // eventIdが空文字列やnull/undefinedの場合はスキップ
    // pickupquestionの場合はscheduleIdが必須
    if (eventId && eventId.length > 0) {
      if (!scheduleId || scheduleId.length === 0) {
        app.toast("日程が選択されていないため、Pick Up Questionを作成できません。", "error");
        return;
      }
      const statusRef = getQuestionStatusRef(eventId, true, scheduleId);
      const updates = {
        [`questions/pickup/${uid}`]: record,
        [`${statusRef.key}/${uid}`]: { answered: false, selecting: false, pickup: true, updatedAt: now }
      };
      await update(ref(database), updates);
    } else {
      const updates = {
        [`questions/pickup/${uid}`]: record
      };
      await update(ref(database), updates);
    }
    app.api?.logAction?.("PICKUP_ADD", buildPickupLogDetails(uid, question, genre));
    if (questionInput) {
      questionInput.value = "";
    }
    app.pickupSelectedId = uid;
    app.pickupSelectedEntry = {
      uid,
      question,
      genre,
      updatedAt: now,
      raw: { ...record }
    };
    syncPickupSelectionUi(app);
    app.toast("Pick Up Question を追加しました。", "success");
    closePickupAddDialog(app);
  } catch (error) {
    console.error("Failed to add pickup question", error);
    app.toast("Pick Up Question の追加に失敗しました。", "error");
    showPickupAlert(app, "Pick Up Question の追加に失敗しました。もう一度お試しください。");
  } finally {
    setBusy(submitButton, false);
    if (cancelButton) {
      cancelButton.removeAttribute("disabled");
    }
    if (addState) {
      addState.submitting = false;
    }
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
    const eventIdRaw = app.state?.activeEventId;
    const eventId = eventIdRaw ? String(eventIdRaw).trim() : "";
    const { scheduleId = "" } = app.getActiveChannel?.() || {};
    const updates = {
      [`questions/pickup/${state.uid}`]: record
    };
    // questionStatusへの書き込みはeventIdとscheduleIdが存在する場合のみ
    // eventIdが空文字列やnull/undefinedの場合はスキップ
    // pickupquestionの更新時は現在のscheduleIdに対応するquestionStatusのみを更新
    if (eventId && eventId.length > 0 && scheduleId && scheduleId.length > 0) {
      const statusRef = getQuestionStatusRef(eventId, true, scheduleId);
      const statusMap = app.state?.questionStatusByUid;
      const statusEntry = statusMap instanceof Map ? statusMap.get(state.uid) : null;
      if (statusEntry) {
        updates[`${statusRef.key}/${state.uid}/updatedAt`] = now;
        updates[`${statusRef.key}/${state.uid}/pickup`] = true;
      } else {
        updates[`${statusRef.key}/${state.uid}`] = {
          answered: false,
          selecting: false,
          pickup: true,
          updatedAt: now
        };
      }
    }
    await update(ref(database), updates);
    app.api?.logAction?.("PICKUP_UPDATE", buildPickupLogDetails(state.uid, question, genre));
    app.toast("Pick Up Question を更新しました。", "success");
    closePickupEditDialog(app);
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

export function handlePickupActionEdit(app, event) {
  ensurePickupSelectionState(app);
  const entry = app.pickupSelectedEntry && app.pickupSelectedEntry.uid === app.pickupSelectedId
    ? app.pickupSelectedEntry
    : null;
  if (!entry) {
    return;
  }
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  openPickupEditDialog(app, entry, trigger);
}

export function handlePickupActionDelete(app, event) {
  ensurePickupSelectionState(app);
  const entry = app.pickupSelectedEntry && app.pickupSelectedEntry.uid === app.pickupSelectedId
    ? app.pickupSelectedEntry
    : null;
  if (!entry) {
    return;
  }
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  confirmPickupDelete(app, entry, trigger);
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
  state.genre = entry.genre;
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
    state.genre = "";
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
    const eventIdRaw = app.state?.activeEventId;
    const eventId = eventIdRaw ? String(eventIdRaw).trim() : "";
    // uidが空文字列でないことを確認（空文字列だとルートパスへの更新となり権限エラーになる）
    const trimmedUid = String(state.uid || "").trim();
    if (!trimmedUid) {
      throw new Error("UIDが不明です。");
    }
    const updates = {
      [`questions/pickup/${trimmedUid}`]: null
    };
    // questionStatusへの削除はeventIdが存在する場合のみ
    // eventIdが空文字列やnull/undefinedの場合はスキップ
    // pickupquestionの削除時は、全日程のquestionStatus/${eventId}/${scheduleId}/${uid}から削除する
    if (eventId && eventId.length > 0) {
      const eventKey = normalizeEventId(eventId);
      const eventStatusRef = ref(database, `questionStatus/${eventKey}`);
      try {
        const eventStatusSnapshot = await get(eventStatusRef);
        const eventStatusData = eventStatusSnapshot.val() || {};
        // questionStatus/${eventId}配下のすべてのキーを走査
        // keyがscheduleIdノードの場合（通常質問のUIDではない場合）、その配下のuidを削除
        Object.keys(eventStatusData).forEach((key) => {
          const value = eventStatusData[key];
          // scheduleIdノードの場合は、その配下にuidが含まれる構造になっている
          // 通常質問のUIDノードの場合は、直接statusが含まれる構造（answered, selectingなど）
          const isScheduleIdNode = value && typeof value === "object" &&
            !(value.answered !== undefined || value.selecting !== undefined) &&
            Object.keys(value).some(k => value[k] && typeof value[k] === "object" && (value[k].answered !== undefined || value[k].selecting !== undefined));
          if (isScheduleIdNode && value[trimmedUid]) {
            // このscheduleIdノードの配下からuidを削除
            updates[`questionStatus/${eventKey}/${key}/${trimmedUid}`] = null;
          }
        });
      } catch (error) {
        console.warn("[confirmPickupDelete] Failed to fetch eventStatus for deletion:", error);
        // エラーが発生しても、questions/pickupからの削除は続行
      }
    }
    await update(ref(database), updates);
    app.api?.logAction?.("PICKUP_DELETE", buildPickupLogDetails(state.uid, state.question, state.genre));
    app.toast("Pick Up Question を削除しました。", "success");
    if (app.pickupSelectedId === state.uid) {
      app.pickupSelectedId = "";
      app.pickupSelectedEntry = null;
    }
    closePickupConfirmDialog(app);
    syncPickupSelectionUi(app);
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
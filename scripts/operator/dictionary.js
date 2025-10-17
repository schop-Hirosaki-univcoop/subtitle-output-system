import { database, dictionaryRef, onValue, ref, set, update } from "./firebase.js";
import { DICTIONARY_STATE_KEY } from "./constants.js";

function ensureDictionaryConfirm(app) {
  if (!app || app.dictionaryConfirmSetup) {
    return;
  }
  const dialog = app.dom.dictionaryConfirmDialog;
  if (!dialog) {
    return;
  }
  const cancelTargets = new Set();
  if (app.dom.dictionaryConfirmCancelButton) {
    cancelTargets.add(app.dom.dictionaryConfirmCancelButton);
  }
  dialog.querySelectorAll("[data-dialog-dismiss]").forEach((element) => {
    if (element instanceof HTMLElement) {
      cancelTargets.add(element);
    }
  });
  const handleCancel = (event) => {
    event.preventDefault();
    finishDictionaryConfirm(app, false);
  };
  cancelTargets.forEach((element) => {
    element.addEventListener("click", handleCancel);
  });
  if (app.dom.dictionaryConfirmAcceptButton) {
    app.dom.dictionaryConfirmAcceptButton.addEventListener("click", (event) => {
      event.preventDefault();
      finishDictionaryConfirm(app, true);
    });
  }
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finishDictionaryConfirm(app, false);
    }
  });
  app.dictionaryConfirmSetup = true;
}

function openDictionaryConfirm(app) {
  const dialog = app.dom.dictionaryConfirmDialog;
  if (!dialog) {
    return;
  }
  const state = app.dictionaryConfirmState || (app.dictionaryConfirmState = { resolver: null, lastFocused: null });
  state.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.removeAttribute("hidden");
  const focusTarget = app.dom.dictionaryConfirmAcceptButton || dialog.querySelector("button");
  if (focusTarget instanceof HTMLElement) {
    requestAnimationFrame(() => focusTarget.focus());
  }
}

function finishDictionaryConfirm(app, result) {
  const dialog = app.dom.dictionaryConfirmDialog;
  if (!dialog) {
    return;
  }
  if (!dialog.hasAttribute("hidden")) {
    dialog.setAttribute("hidden", "");
  }
  const state = app.dictionaryConfirmState || (app.dictionaryConfirmState = { resolver: null, lastFocused: null });
  const resolver = state.resolver;
  state.resolver = null;
  const toFocus = state.lastFocused;
  state.lastFocused = null;
  if (toFocus && typeof toFocus.focus === "function") {
    requestAnimationFrame(() => toFocus.focus());
  }
  if (typeof resolver === "function") {
    resolver(result);
  }
}

async function confirmDictionaryAction(app, { title = "確認", description = "", confirmLabel = "削除する", cancelLabel = "キャンセル" } = {}) {
  ensureDictionaryConfirm(app);
  const dialog = app.dom.dictionaryConfirmDialog;
  if (!dialog) {
    if (typeof app.confirmAction === "function") {
      return await app.confirmAction({ title, description, confirmLabel, cancelLabel, tone: "danger" });
    }
    return false;
  }
  const state = app.dictionaryConfirmState || (app.dictionaryConfirmState = { resolver: null, lastFocused: null });
  if (state.resolver) {
    finishDictionaryConfirm(app, false);
  }
  if (app.dom.dictionaryConfirmTitle) {
    app.dom.dictionaryConfirmTitle.textContent = title || "確認";
  }
  if (app.dom.dictionaryConfirmMessage) {
    app.dom.dictionaryConfirmMessage.textContent = description || "";
  }
  if (app.dom.dictionaryConfirmAcceptButton) {
    app.dom.dictionaryConfirmAcceptButton.textContent = confirmLabel || "削除する";
  }
  if (app.dom.dictionaryConfirmCancelButton) {
    app.dom.dictionaryConfirmCancelButton.textContent = cancelLabel || "キャンセル";
  }
  openDictionaryConfirm(app);
  return await new Promise((resolve) => {
    state.resolver = resolve;
  });
}

function getDictionaryEditState(app) {
  if (!app.dictionaryEditState) {
    app.dictionaryEditState = { uid: "", originalTerm: "", originalRuby: "", submitting: false, lastFocused: null };
  }
  return app.dictionaryEditState;
}

function ensureDictionaryEditDialog(app) {
  if (!app || app.dictionaryEditSetup) {
    return;
  }
  const dialog = app.dom.dictionaryEditDialog;
  if (!dialog) {
    return;
  }
  dialog.querySelectorAll("[data-dialog-dismiss]").forEach((element) => {
    if (element instanceof HTMLElement) {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        closeDictionaryEditDialog(app);
      });
    }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDictionaryEditDialog(app);
    }
  });
  app.dictionaryEditSetup = true;
}

export function closeDictionaryEditDialog(app, eventOrOptions) {
  let restoreFocus = true;
  if (eventOrOptions instanceof Event) {
    eventOrOptions.preventDefault?.();
  } else if (eventOrOptions && typeof eventOrOptions === "object") {
    if (eventOrOptions.restoreFocus === false) {
      restoreFocus = false;
    }
  }
  const dialog = app.dom.dictionaryEditDialog;
  if (!dialog) {
    return;
  }
  if (!dialog.hasAttribute("hidden")) {
    dialog.setAttribute("hidden", "");
  }
  const state = getDictionaryEditState(app);
  state.uid = "";
  state.originalTerm = "";
  state.originalRuby = "";
  state.submitting = false;
  const form = app.dom.dictionaryEditForm;
  if (form instanceof HTMLFormElement) {
    form.reset();
  } else {
    if (app.dom.dictionaryEditTermInput) {
      app.dom.dictionaryEditTermInput.value = "";
    }
    if (app.dom.dictionaryEditRubyInput) {
      app.dom.dictionaryEditRubyInput.value = "";
    }
  }
  if (app.dom.dictionaryEditSaveButton) {
    app.dom.dictionaryEditSaveButton.disabled = false;
  }
  if (app.dom.dictionaryEditCancelButton) {
    app.dom.dictionaryEditCancelButton.disabled = false;
  }
  const toFocus = restoreFocus ? state.lastFocused : null;
  state.lastFocused = null;
  if (toFocus && typeof toFocus.focus === "function") {
    requestAnimationFrame(() => toFocus.focus());
  }
}

export function handleDictionaryEdit(app) {
  const entry = app.dictionarySelectedEntry;
  if (!entry) {
    return;
  }
  ensureDictionaryEditDialog(app);
  const dialog = app.dom.dictionaryEditDialog;
  const termInput = app.dom.dictionaryEditTermInput;
  const rubyInput = app.dom.dictionaryEditRubyInput;
  if (!dialog || !(termInput instanceof HTMLInputElement) || !(rubyInput instanceof HTMLInputElement)) {
    return;
  }
  const state = getDictionaryEditState(app);
  state.uid = entry.uid;
  state.originalTerm = entry.term;
  state.originalRuby = entry.ruby;
  state.submitting = false;
  state.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  termInput.value = entry.term;
  rubyInput.value = entry.ruby;
  if (app.dom.dictionaryEditSaveButton) {
    app.dom.dictionaryEditSaveButton.disabled = false;
  }
  if (app.dom.dictionaryEditCancelButton) {
    app.dom.dictionaryEditCancelButton.disabled = false;
  }
  dialog.removeAttribute("hidden");
  requestAnimationFrame(() => termInput.focus());
}

export async function handleDictionaryEditSubmit(app, event) {
  event?.preventDefault?.();
  ensureDictionaryEditDialog(app);
  const state = getDictionaryEditState(app);
  if (!state.uid) {
    closeDictionaryEditDialog(app);
    return;
  }
  const termInput = app.dom.dictionaryEditTermInput;
  const rubyInput = app.dom.dictionaryEditRubyInput;
  if (!(termInput instanceof HTMLInputElement) || !(rubyInput instanceof HTMLInputElement)) {
    closeDictionaryEditDialog(app);
    return;
  }
  const saveButton = app.dom.dictionaryEditSaveButton;
  const cancelButton = app.dom.dictionaryEditCancelButton;
  const term = termInput.value.trim();
  const ruby = rubyInput.value.trim();
  if (!term) {
    app.toast("単語を入力してください。", "error");
    termInput.focus();
    return;
  }
  if (!ruby) {
    app.toast("ルビを入力してください。", "error");
    rubyInput.focus();
    return;
  }
  if (term === state.originalTerm && ruby === state.originalRuby) {
    closeDictionaryEditDialog(app);
    return;
  }
  if (state.submitting) {
    return;
  }
  state.submitting = true;
  if (saveButton) {
    saveButton.disabled = true;
  }
  if (cancelButton) {
    cancelButton.disabled = true;
  }
  let previousEntries = null;
  let appliedRealtime = false;
  const targetUid = state.uid;
  try {
    if (!Array.isArray(app.dictionaryData) || !app.dictionaryData.length) {
      throw new Error("辞書データが読み込まれていません。");
    }
    app.dictionarySelectedId = targetUid;
    previousEntries = app.dictionaryData.map((entry) => ({ ...entry }));
    const hasTarget = previousEntries.some((entry) => entry.uid === targetUid);
    if (!hasTarget) {
      throw new Error("対象の単語が見つかりませんでした。");
    }
    const updatedEntries = previousEntries.map((entry) =>
      entry.uid === targetUid ? { ...entry, term, ruby, enabled: true } : entry
    );
    const normalizedEntries = applyDictionarySnapshot(app, updatedEntries);
    appliedRealtime = true;
    const timestamp = Date.now();
    const updates = normalizedEntries.reduce((acc, { uid, term: nextTerm, ruby: nextRuby, enabled }) => {
      if (!uid) {
        return acc;
      }
      acc[`dictionary/${uid}`] = {
        uid,
        term: nextTerm,
        ruby: nextRuby,
        enabled,
        updatedAt: timestamp
      };
      return acc;
    }, {});
    if (Object.keys(updates).length === 0) {
      await set(dictionaryRef, {});
    } else {
      await update(ref(database), updates);
    }
    closeDictionaryEditDialog(app);
    app.api
      .apiPost({ action: "updateTerm", uid: targetUid, term, ruby })
      .then((result) => {
        if (!result?.success) {
          throw new Error(result?.error || "更新に失敗しました。");
        }
      })
      .catch((error) => {
        console.error("辞書シートへの同期に失敗しました", error);
        app.toast("シートへの同期に失敗しました: " + error.message, "warning");
      });
  } catch (error) {
    if (appliedRealtime && previousEntries) {
      applyDictionarySnapshot(app, previousEntries);
    }
    console.error("辞書のリアルタイム更新に失敗しました", error);
    app.toast("更新失敗: " + error.message, "error");
  } finally {
    state.submitting = false;
    if (saveButton) {
      saveButton.disabled = false;
    }
    if (cancelButton) {
      cancelButton.disabled = false;
    }
  }
}

function normalizeDictionaryEntries(data) {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? Object.values(data)
      : [];
  const seenUids = new Set();
  const entriesByTerm = new Map();
  list.forEach((item) => {
    const term = String(item?.term ?? "").trim();
    const ruby = String(item?.ruby ?? "").trim();
    if (!term || !ruby) {
      return;
    }
    const rawUid = item?.uid ?? item?.UID ?? item?.id ?? item?.Id ?? item?.ID;
    let uid = String(rawUid ?? "").trim();
    if (!uid) {
      uid = `${term}::${ruby}`;
    }
    if (seenUids.has(uid)) {
      return;
    }
    seenUids.add(uid);
    const enabledValue = item?.enabled;
    let enabled = true;
    if (typeof enabledValue === "boolean") {
      enabled = enabledValue;
    } else if (typeof enabledValue === "string") {
      enabled = enabledValue.trim().toLowerCase() !== "false";
    } else if (typeof enabledValue === "number") {
      enabled = enabledValue !== 0;
    }
    const entry = { uid, term, ruby, enabled };
    const existing = entriesByTerm.get(term);
    if (!existing) {
      entriesByTerm.set(term, entry);
      return;
    }
    const preferNew = (!existing.enabled && enabled) || existing.enabled === enabled;
    if (preferNew) {
      entriesByTerm.set(term, entry);
    }
  });
  return Array.from(entriesByTerm.values());
}

function sortDictionaryEntries(entries) {
  return [...entries].sort((a, b) => {
    const lenDiff = b.term.length - a.term.length;
    if (lenDiff !== 0) {
      return lenDiff;
    }
    const rubyDiff = b.ruby.length - a.ruby.length;
    if (rubyDiff !== 0) {
      return rubyDiff;
    }
    return a.term.localeCompare(b.term, "ja");
  });
}

function ensureDictionaryBatchSet(app) {
  if (!(app.dictionaryBatchSelection instanceof Set)) {
    app.dictionaryBatchSelection = new Set();
  }
  return app.dictionaryBatchSelection;
}

function getDictionaryEntriesByIds(app, ids) {
  const list = Array.isArray(app.dictionaryData) ? app.dictionaryData : [];
  const idSet = new Set(ids || []);
  if (!idSet.size) return [];
  return list.filter((entry) => idSet.has(entry.uid));
}

function refreshDictionaryCheckboxes(app) {
  const container = app.dom.dictionaryCardsContainer;
  if (!container) {
    return;
  }
  const batch = ensureDictionaryBatchSet(app);
  container.querySelectorAll(".dictionary-checkbox").forEach((element) => {
    if (element instanceof HTMLInputElement) {
      const uid = element.dataset.uid || "";
      element.checked = batch.has(uid);
    }
  });
}

function updateDictionaryCount(app) {
  const label = app.dom.dictionaryCount;
  if (!label) return;
  const allEntries = Array.isArray(app.dictionaryData) ? app.dictionaryData : [];
  const enabledEntries = Array.isArray(app.dictionaryEntries) ? app.dictionaryEntries : [];
  if (!allEntries.length) {
    label.textContent = "登録なし";
    return;
  }
  label.textContent = `全${allEntries.length}語（有効${enabledEntries.length}語）`;
}

function syncDictionarySelectAllState(app) {
  const checkbox = app.dom.dictionarySelectAllCheckbox;
  if (!(checkbox instanceof HTMLInputElement)) {
    return;
  }
  const entries = Array.isArray(app.dictionaryData) ? app.dictionaryData : [];
  const batch = ensureDictionaryBatchSet(app);
  const total = entries.length;
  const selectedCount = batch.size;
  checkbox.disabled = total === 0;
  checkbox.checked = total > 0 && selectedCount === total;
  checkbox.indeterminate = total > 0 && selectedCount > 0 && selectedCount < total;
}

function updateDictionarySelectionState(app) {
  const selection = app.dictionarySelectedEntry || null;
  const batch = ensureDictionaryBatchSet(app);
  const batchEntries = batch.size ? getDictionaryEntriesByIds(app, batch) : [];
  const hasBatch = batchEntries.length > 0;
  const panel = app.dom.dictionaryActionPanel;
  if (panel) {
    panel.hidden = false;
    panel.classList.toggle("is-idle", !selection && !hasBatch);
  }
  const enableButton = app.dom.dictionaryEnableButton;
  const disableButton = app.dom.dictionaryDisableButton;
  const editButton = app.dom.dictionaryEditButton;
  const deleteButton = app.dom.dictionaryDeleteButton;
  if (enableButton) {
    enableButton.disabled = !selection || selection.enabled;
  }
  if (disableButton) {
    disableButton.disabled = !selection || !selection.enabled;
  }
  if (editButton) {
    editButton.disabled = !selection;
  }
  if (deleteButton) {
    deleteButton.disabled = !selection;
  }
  const batchEnableButton = app.dom.dictionaryBatchEnableButton;
  const batchDisableButton = app.dom.dictionaryBatchDisableButton;
  const batchDeleteButton = app.dom.dictionaryBatchDeleteButton;
  const batchHasEnabled = batchEntries.some((entry) => entry.enabled);
  const batchHasDisabled = batchEntries.some((entry) => !entry.enabled);
  if (batchEnableButton) {
    batchEnableButton.hidden = !hasBatch;
    batchEnableButton.disabled = !hasBatch || !batchHasDisabled;
  }
  if (batchDisableButton) {
    batchDisableButton.hidden = !hasBatch;
    batchDisableButton.disabled = !hasBatch || !batchHasEnabled;
  }
  if (batchDeleteButton) {
    batchDeleteButton.hidden = !hasBatch;
    batchDeleteButton.disabled = !hasBatch;
  }
  const info = app.dom.dictionarySelectedInfo;
  if (info) {
    if (selection) {
      info.textContent = selection.enabled
        ? `選択中: ${selection.term}`
        : `選択中: ${selection.term}（無効）`;
    } else if (hasBatch) {
      info.textContent = `バッチ選択: ${batchEntries.length}件`;
    } else {
      info.textContent = "単語を選択してください";
    }
  }
  syncDictionarySelectAllState(app);
  refreshDictionaryCheckboxes(app);
}

async function setDictionaryEntriesEnabled(app, uids, enabled) {
  if (!Array.isArray(uids) || !uids.length) {
    return;
  }
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (!unique.length) {
    return;
  }
  try {
    const action = unique.length > 1 ? "batchToggleTerms" : "toggleTerm";
    const payload = unique.length > 1 ? { action: "batchToggleTerms", uids: unique, enabled } : { action: "toggleTerm", uid: unique[0], enabled };
    await app.api.apiPost(payload);
    await fetchDictionary(app);
  } catch (error) {
    app.toast("状態の更新失敗: " + error.message, "error");
  }
}

async function deleteDictionaryEntries(app, uids) {
  if (!Array.isArray(uids) || !uids.length) {
    return;
  }
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (!unique.length) {
    return;
  }
  try {
    const action = unique.length > 1 ? "batchDeleteTerms" : "deleteTerm";
    const payload = unique.length > 1 ? { action: "batchDeleteTerms", uids: unique } : { action: "deleteTerm", uid: unique[0] };
    await app.api.apiPost(payload);
    await fetchDictionary(app);
  } catch (error) {
    app.toast("削除失敗: " + error.message, "error");
  }
}

function renderDictionaryCards(app, entries) {
  const container = app.dom.dictionaryCardsContainer;
  if (!container) {
    return;
  }
  const batch = ensureDictionaryBatchSet(app);
  const selectedId = app.dictionarySelectedId || "";
  container.innerHTML = "";
  entries.forEach((item) => {
    const card = document.createElement("article");
    card.className = "dictionary-card";
    card.dataset.uid = item.uid;
    if (!item.enabled) {
      card.classList.add("is-disabled");
    }
    if (item.uid === selectedId) {
      card.classList.add("is-selected");
    }
    const header = document.createElement("div");
    header.className = "dictionary-card__header";
    const term = document.createElement("span");
    term.className = "dictionary-card__term";
    term.textContent = item.term;
    const status = document.createElement("span");
    status.className = "dictionary-card__status";
    status.textContent = item.enabled ? "有効" : "無効";
    header.append(term, status);

    const ruby = document.createElement("div");
    ruby.className = "dictionary-card__ruby";
    ruby.textContent = item.ruby;

    const footer = document.createElement("div");
    footer.className = "dictionary-card__footer";
    const uidLabel = document.createElement("span");
    uidLabel.textContent = `UID: ${item.uid}`;
    footer.append(uidLabel);

    const checkLabel = document.createElement("label");
    checkLabel.className = "dictionary-card__check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "dictionary-checkbox";
    checkbox.dataset.uid = item.uid;
    checkbox.checked = batch.has(item.uid);
    const hiddenLabel = document.createElement("span");
    hiddenLabel.className = "visually-hidden";
    hiddenLabel.textContent = "バッチ選択";
    checkLabel.append(checkbox, hiddenLabel);

    checkbox.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement) {
        if (target.checked) {
          batch.add(item.uid);
        } else {
          batch.delete(item.uid);
        }
        updateDictionarySelectionState(app);
      }
      event.stopPropagation();
    });

    card.append(checkLabel, header, ruby, footer);
    card.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".dictionary-card__check")) {
        return;
      }
      if (app.dictionarySelectedId === item.uid) {
        app.dictionarySelectedId = "";
        app.dictionarySelectedEntry = null;
        card.classList.remove("is-selected");
      } else {
        app.dictionarySelectedId = item.uid;
        app.dictionarySelectedEntry = item;
        container.querySelectorAll(".dictionary-card").forEach((el) => {
          el.classList.toggle("is-selected", el === card);
        });
      }
      updateDictionarySelectionState(app);
    });
    container.appendChild(card);
  });
  updateDictionaryCount(app);
  syncDictionarySelectAllState(app);
}

function applyDictionarySnapshot(app, rawEntries, { render = true } = {}) {
  const normalized = normalizeDictionaryEntries(rawEntries);
  const sorted = sortDictionaryEntries(normalized);
  const availableIds = new Set(sorted.map((entry) => entry.uid));
  const batch = ensureDictionaryBatchSet(app);
  Array.from(batch).forEach((uid) => {
    if (!availableIds.has(uid)) {
      batch.delete(uid);
    }
  });
  if (!availableIds.has(app.dictionarySelectedId)) {
    app.dictionarySelectedId = "";
    app.dictionarySelectedEntry = null;
  }
  if (app.dictionarySelectedId) {
    const current = sorted.find((entry) => entry.uid === app.dictionarySelectedId);
    app.dictionarySelectedEntry = current || null;
    if (!current) {
      app.dictionarySelectedId = "";
    }
  }
  app.dictionaryData = sorted;
  app.dictionaryEntries = sorted.filter((entry) => entry.enabled);
  if (render) {
    renderDictionaryCards(app, sorted);
  }
  updateDictionaryCount(app);
  updateDictionarySelectionState(app);
  app.dictionaryLoaded = true;
  if (typeof app.refreshRenderSummary === "function") {
    app.refreshRenderSummary();
  }
  return sorted;
}

export async function fetchDictionary(app) {
  try {
    const result = await app.api.apiPost({ action: "fetchSheet", sheet: "dictionary" });
    if (!result.success) return;
    const normalized = applyDictionarySnapshot(app, result.data || []);
    const timestamp = Date.now();
    const payload = normalized.reduce((acc, { uid, term, ruby, enabled }) => {
      if (!uid) {
        return acc;
      }
      acc[uid] = { uid, term, ruby, enabled, updatedAt: timestamp };
      return acc;
    }, {});
    await set(dictionaryRef, payload);
  } catch (error) {
    app.toast("辞書の取得に失敗: " + error.message, "error");
  }
}

export function startDictionaryListener(app) {
  if (app.dictionaryUnsubscribe) {
    app.dictionaryUnsubscribe();
    app.dictionaryUnsubscribe = null;
  }
  app.dictionaryUnsubscribe = onValue(
    dictionaryRef,
    (snapshot) => {
      applyDictionarySnapshot(app, snapshot.val() || {});
    },
    (error) => {
      console.error("辞書データの購読に失敗しました", error);
    }
  );
}

export function stopDictionaryListener(app) {
  if (app.dictionaryUnsubscribe) {
    app.dictionaryUnsubscribe();
    app.dictionaryUnsubscribe = null;
  }
}

export function applyInitialDictionaryState(app) {
  let saved = "0";
  try {
    saved = localStorage.getItem(DICTIONARY_STATE_KEY) || "0";
  } catch (error) {
    saved = "0";
  }
  app.preferredDictionaryOpen = saved === "1";
  toggleDictionaryDrawer(app, false, false);
}

export function toggleDictionaryDrawer(app, force, persist = true) {
  const body = document.body;
  if (!body) return;
  const currentOpen = body.classList.contains("dictionary-open");
  const nextOpen = typeof force === "boolean" ? force : !currentOpen;
  body.classList.toggle("dictionary-open", nextOpen);
  body.classList.toggle("dictionary-collapsed", !nextOpen);
  if (app.dom.dictionaryPanel) {
    if (nextOpen) {
      app.dom.dictionaryPanel.removeAttribute("hidden");
    } else {
      app.dom.dictionaryPanel.setAttribute("hidden", "");
    }
  }
  if (app.dom.dictionaryToggle) {
    app.dom.dictionaryToggle.setAttribute("aria-expanded", String(nextOpen));
    app.dom.dictionaryToggle.setAttribute(
      "aria-label",
      nextOpen ? "ルビ辞書管理を閉じる" : "ルビ辞書管理を開く"
    );
  }
  if (persist) {
    try {
      localStorage.setItem(DICTIONARY_STATE_KEY, nextOpen ? "1" : "0");
    } catch (error) {
      console.debug("dictionary toggle state not persisted", error);
    }
    app.preferredDictionaryOpen = nextOpen;
  }
  if (nextOpen && app.isAuthorized && !app.dictionaryLoaded) {
    fetchDictionary(app).catch((error) => console.error("辞書の読み込みに失敗しました", error));
  }
}

export async function addTerm(app, event) {
  event.preventDefault();
  const term = app.dom.newTermInput?.value.trim();
  const ruby = app.dom.newRubyInput?.value.trim();
  if (!term || !ruby) return;
  try {
    const result = await app.api.apiPost({ action: "addTerm", term, ruby });
    if (result.success) {
      if (app.dom.newTermInput) app.dom.newTermInput.value = "";
      if (app.dom.newRubyInput) app.dom.newRubyInput.value = "";
      await fetchDictionary(app);
    } else {
      app.toast("追加失敗: " + result.error, "error");
    }
  } catch (error) {
    app.toast("通信エラー: " + error.message, "error");
  }
}

export function handleDictionarySelectAll(app, event) {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const entries = Array.isArray(app.dictionaryData) ? app.dictionaryData : [];
  const batch = ensureDictionaryBatchSet(app);
  batch.clear();
  if (target.checked) {
    entries.forEach((entry) => batch.add(entry.uid));
  }
  refreshDictionaryCheckboxes(app);
  updateDictionarySelectionState(app);
}

export async function handleDictionaryEnable(app) {
  const entry = app.dictionarySelectedEntry;
  if (!entry || entry.enabled) {
    return;
  }
  await setDictionaryEntriesEnabled(app, [entry.uid], true);
}

export async function handleDictionaryDisable(app) {
  const entry = app.dictionarySelectedEntry;
  if (!entry || !entry.enabled) {
    return;
  }
  await setDictionaryEntriesEnabled(app, [entry.uid], false);
}

export async function handleDictionaryDelete(app) {
  const entry = app.dictionarySelectedEntry;
  if (!entry) {
    return;
  }
  const confirmed = await confirmDictionaryAction(app, {
    title: "辞書から削除",
    description: `「${entry.term}」を辞書から削除します。よろしいですか？`,
    confirmLabel: "削除する",
    cancelLabel: "キャンセル"
  });
  if (!confirmed) {
    return;
  }
  const batch = ensureDictionaryBatchSet(app);
  batch.delete(entry.uid);
  app.dictionarySelectedId = entry.uid;
  app.dictionarySelectedEntry = null;
  updateDictionarySelectionState(app);
  await deleteDictionaryEntries(app, [entry.uid]);
}

export async function handleDictionaryBatchEnable(app) {
  const batch = ensureDictionaryBatchSet(app);
  const ids = Array.from(batch);
  if (!ids.length) {
    return;
  }
  await setDictionaryEntriesEnabled(app, ids, true);
}

export async function handleDictionaryBatchDisable(app) {
  const batch = ensureDictionaryBatchSet(app);
  const ids = Array.from(batch);
  if (!ids.length) {
    return;
  }
  await setDictionaryEntriesEnabled(app, ids, false);
}

export async function handleDictionaryBatchDelete(app) {
  const batch = ensureDictionaryBatchSet(app);
  const ids = Array.from(batch);
  if (!ids.length) {
    return;
  }
  const entries = getDictionaryEntriesByIds(app, ids);
  const confirmed = await confirmDictionaryAction(app, {
    title: "選択した語句を削除",
    description: `${entries.length}件の語句を辞書から削除します。よろしいですか？`,
    confirmLabel: "削除する",
    cancelLabel: "キャンセル"
  });
  if (!confirmed) {
    return;
  }
  const selectedId = app.dictionarySelectedId;
  batch.clear();
  if (selectedId && ids.includes(selectedId)) {
    app.dictionarySelectedEntry = null;
  }
  updateDictionarySelectionState(app);
  await deleteDictionaryEntries(app, ids);
}

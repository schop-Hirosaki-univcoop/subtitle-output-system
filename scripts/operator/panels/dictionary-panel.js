// dictionary-panel.js: ルビ辞書管理パネルのロードと検索、編集操作をまとめたモジュールです。
import { database, dictionaryRef, onValue, ref, set, update, get } from "../firebase.js";
import { DICTIONARY_STATE_KEY } from "../constants.js";
import { escapeHtml } from "../utils.js";

const DICTIONARY_LOADER_STEPS = [
  { label: "初期化", message: "辞書パネルを初期化しています…" },
  { label: "データ取得", message: "辞書データを取得しています…" },
  { label: "更新待機", message: "リアルタイム更新を待機しています…" },
  { label: "描画", message: "辞書一覧を描画しています…" },
  { label: "完了", message: "準備が整いました！" }
];

function ensureDictionaryLoader(app) {
  if (!app) {
    return;
  }
  if (typeof app.dictionaryLoaderCurrentStep !== "number") {
    app.dictionaryLoaderCurrentStep = 0;
  }
  if (!app.dictionaryLoaderSetup && app.dom.dictionaryLoaderSteps) {
    app.dom.dictionaryLoaderSteps.innerHTML = DICTIONARY_LOADER_STEPS.map(
      ({ label }, index) => `<li data-step="${index}">${escapeHtml(label)}</li>`
    ).join("");
    app.dictionaryLoaderSetup = true;
  }
}

function isDictionaryPanelVisible(app) {
  const panel = app?.dom?.dictionaryPanel;
  return !!(panel && !panel.hasAttribute("hidden"));
}

function showDictionaryLoader(app) {
  if (app?.dom?.dictionaryLoadingOverlay) {
    app.dom.dictionaryLoadingOverlay.removeAttribute("hidden");
  }
}

function hideDictionaryLoader(app) {
  if (app?.dom?.dictionaryLoadingOverlay) {
    app.dom.dictionaryLoadingOverlay.setAttribute("hidden", "");
  }
}

function maybeShowDictionaryLoader(app) {
  if (!app || app.dictionaryLoaderCompleted) {
    return;
  }
  if (isDictionaryPanelVisible(app)) {
    showDictionaryLoader(app);
  }
}

function setDictionaryLoaderStep(app, stepIndex, { force = false } = {}) {
  if (!app) {
    return;
  }
  ensureDictionaryLoader(app);
  const steps = DICTIONARY_LOADER_STEPS;
  const normalized = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const current = typeof app.dictionaryLoaderCurrentStep === "number" ? app.dictionaryLoaderCurrentStep : 0;
  if (!force && normalized < current) {
    return;
  }
  app.dictionaryLoaderCurrentStep = normalized;
  const { message } = steps[normalized] || steps[0];
  if (app.dom.dictionaryLoadingText) {
    app.dom.dictionaryLoadingText.textContent = message;
  }
  const list = app.dom.dictionaryLoaderSteps;
  if (list) {
    const items = list.querySelectorAll("li");
    items.forEach((item, index) => {
      item.classList.toggle("current", index === normalized);
      item.classList.toggle("done", index < normalized);
    });
  }
  app.dictionaryLoaderCompleted = normalized >= steps.length - 1;
  if (!app.dictionaryLoaderCompleted) {
    maybeShowDictionaryLoader(app);
  }
}

function completeDictionaryLoader(app) {
  if (!app) {
    return;
  }
  setDictionaryLoaderStep(app, DICTIONARY_LOADER_STEPS.length - 1, { force: true });
  app.dictionaryLoaderCompleted = true;
  hideDictionaryLoader(app);
}

export function resetDictionaryLoader(app) {
  if (!app) {
    return;
  }
  app.dictionaryLoaderSetup = app.dictionaryLoaderSetup && !!app.dom.dictionaryLoaderSteps;
  app.dictionaryLoaderCompleted = false;
  ensureDictionaryLoader(app);
  setDictionaryLoaderStep(app, 0, { force: true });
  hideDictionaryLoader(app);
}

function generateDictionaryUid() {
  const cryptoObj = globalThis.crypto || globalThis.msCrypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  const chars = "abcdef0123456789";
  let seed = "";
  for (let i = 0; i < 32; i += 1) {
    seed += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `dic_${seed}`;
}

function snapshotDictionaryEntries(app) {
  return Array.isArray(app.dictionaryData)
    ? app.dictionaryData.map((entry) => ({ ...entry }))
    : [];
}

function buildDictionaryPayload(entries, timestamp = Date.now()) {
  if (!Array.isArray(entries) || !entries.length) {
    return {};
  }
  return entries.reduce((acc, entry) => {
    if (!entry || !entry.uid) {
      return acc;
    }
    acc[entry.uid] = {
      uid: entry.uid,
      term: entry.term,
      ruby: entry.ruby,
      enabled: !!entry.enabled,
      updatedAt: timestamp
    };
    return acc;
  }, {});
}

async function revertDictionarySnapshot(app, previousEntries) {
  const normalized = Array.isArray(previousEntries)
    ? previousEntries.map((entry) => ({ ...entry }))
    : [];
  applyDictionarySnapshot(app, normalized);
  const payload = buildDictionaryPayload(normalized);
  if (Object.keys(payload).length) {
    await set(dictionaryRef, payload);
  } else {
    await set(dictionaryRef, {});
  }
}

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
    // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
    if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
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
    // N でダイアログを閉じる（ESCはフルスクリーン解除で使用されるため、Chromeのショートカットと競合しないようにNを使用）
    if ((event.key === "n" || event.key === "N") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
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
    previousEntries = snapshotDictionaryEntries(app);
    const hasTarget = previousEntries.some((entry) => entry.uid === targetUid);
    if (!hasTarget) {
      throw new Error("対象の単語が見つかりませんでした。");
    }
    const updatedEntries = previousEntries.map((entry) =>
      entry.uid === targetUid ? { ...entry, term, ruby, enabled: true } : entry
    );
    applyDictionarySnapshot(app, updatedEntries);
    appliedRealtime = true;
    await update(ref(database), {
      [`dictionary/${targetUid}`]: {
        uid: targetUid,
        term,
        ruby,
        enabled: true,
        updatedAt: Date.now()
      }
    });
    const result = await app.api.apiPost({ action: "updateTerm", uid: targetUid, term, ruby });
    if (!result?.success) {
      throw new Error(result?.error || "更新に失敗しました。");
    }
    closeDictionaryEditDialog(app);
  } catch (error) {
    if (appliedRealtime && previousEntries) {
      try {
        await revertDictionarySnapshot(app, previousEntries);
      } catch (revertError) {
        console.error("辞書の状態復元に失敗しました", revertError);
      }
    }
    console.error("辞書のリアルタイム更新に失敗しました", error);
    app.toast("更新失敗: " + (error?.message || "不明なエラー"), "error");
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
  const entries = Array.isArray(app.dictionaryData) ? app.dictionaryData : [];
  const entryMap = new Map(entries.map((entry) => [entry.uid, entry]));
  const targets = unique
    .map((uid) => entryMap.get(uid))
    .filter((entry) => !!entry);
  if (!targets.length) {
    app.toast("対象の語句が見つかりません。", "error");
    return;
  }

  const previousEntries = snapshotDictionaryEntries(app);
  const now = Date.now();
  const updatePaths = {};
  const uniqueSet = new Set(unique);
  const nextEntries = entries.map((entry) => {
    if (!uniqueSet.has(entry.uid)) {
      return entry;
    }
    const next = { ...entry, enabled: !!enabled };
    updatePaths[`dictionary/${entry.uid}`] = {
      uid: entry.uid,
      term: entry.term,
      ruby: entry.ruby,
      enabled: !!enabled,
      updatedAt: now
    };
    return next;
  });

  let appliedRealtime = false;
  try {
    applyDictionarySnapshot(app, nextEntries);
    appliedRealtime = true;
    await update(ref(database), updatePaths);
    const action = unique.length > 1 ? "batchToggleTerms" : "toggleTerm";
    const payload = unique.length > 1
      ? { action: "batchToggleTerms", uids: unique, enabled }
      : { action: "toggleTerm", uid: unique[0], enabled };
    const result = await app.api.apiPost(payload);
    if (!result?.success) {
      throw new Error(result?.error || "辞書の更新に失敗しました。");
    }
  } catch (error) {
    console.error("辞書の状態更新に失敗しました", error);
    app.toast("状態の更新失敗: " + (error?.message || "不明なエラー"), "error");
    if (appliedRealtime) {
      try {
        await revertDictionarySnapshot(app, previousEntries);
      } catch (revertError) {
        console.error("辞書の状態復元に失敗しました", revertError);
      }
    }
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
  const entries = Array.isArray(app.dictionaryData) ? app.dictionaryData : [];
  const uniqueSet = new Set(unique);
  const targets = entries.filter((entry) => uniqueSet.has(entry.uid));
  if (!targets.length) {
    app.toast("削除対象の語句が見つかりません。", "error");
    return;
  }

  const previousEntries = snapshotDictionaryEntries(app);
  const updates = unique.reduce((acc, uid) => {
    const normalized = uid ? String(uid) : "";
    if (normalized) {
      acc[`dictionary/${normalized}`] = null;
    }
    return acc;
  }, {});

  const nextEntries = entries.filter((entry) => !uniqueSet.has(entry.uid));
  let appliedRealtime = false;

  try {
    applyDictionarySnapshot(app, nextEntries);
    appliedRealtime = true;
    await update(ref(database), updates);
    const action = unique.length > 1 ? "batchDeleteTerms" : "deleteTerm";
    const payload = unique.length > 1
      ? { action: "batchDeleteTerms", uids: unique }
      : { action: "deleteTerm", uid: unique[0] };
    const result = await app.api.apiPost(payload);
    if (!result?.success) {
      throw new Error(result?.error || "辞書の削除に失敗しました。");
    }
  } catch (error) {
    console.error("辞書の削除に失敗しました", error);
    app.toast("削除失敗: " + (error?.message || "不明なエラー"), "error");
    if (appliedRealtime) {
      try {
        await revertDictionarySnapshot(app, previousEntries);
      } catch (revertError) {
        console.error("辞書の状態復元に失敗しました", revertError);
      }
    }
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
  const wasLoaded = !!app.dictionaryLoaded;
  if (!wasLoaded) {
    setDictionaryLoaderStep(app, 3);
  }
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
  if (!wasLoaded) {
    completeDictionaryLoader(app);
  }
  return sorted;
}

export async function fetchDictionary(app) {
  setDictionaryLoaderStep(app, 1);
  try {
    const snapshot = await get(dictionaryRef);
    const exists = snapshot && typeof snapshot.exists === 'function' ? snapshot.exists() : false;
    const payload = exists ? snapshot.val() : {};
    applyDictionarySnapshot(app, payload);
  } catch (error) {
    console.error('辞書の取得に失敗しました', error);
    app.toast('辞書の取得に失敗: ' + (error?.message || '不明なエラー'), 'error');
  }
}

export function startDictionaryListener(app) {
  if (app.dictionaryUnsubscribe) {
    app.dictionaryUnsubscribe();
    app.dictionaryUnsubscribe = null;
  }
  setDictionaryLoaderStep(app, 2);
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
  if (!nextOpen) {
    hideDictionaryLoader(app);
  } else if (!app.dictionaryLoaded) {
    maybeShowDictionaryLoader(app);
  } else {
    hideDictionaryLoader(app);
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

  const entries = Array.isArray(app.dictionaryData) ? app.dictionaryData : [];
  const previousEntries = snapshotDictionaryEntries(app);
  const existing = entries.find((entry) => entry.term === term);
  const uid = existing?.uid || generateDictionaryUid();
  const now = Date.now();
  const nextEntry = { uid, term, ruby, enabled: true };
  let appliedRealtime = false;

  try {
    const nextEntries = existing
      ? entries.map((entry) => (entry.uid === uid ? { ...nextEntry } : entry))
      : entries.concat(nextEntry);
    applyDictionarySnapshot(app, nextEntries);
    appliedRealtime = true;
    await update(ref(database), {
      [`dictionary/${uid}`]: { ...nextEntry, updatedAt: now }
    });
    if (app.dom.newTermInput) app.dom.newTermInput.value = "";
    if (app.dom.newRubyInput) app.dom.newRubyInput.value = "";
    const result = await app.api.apiPost({ action: "addTerm", term, ruby, uid });
    if (!result?.success) {
      throw new Error(result?.error || "辞書の更新に失敗しました。");
    }
  } catch (error) {
    console.error("辞書の追加に失敗しました", error);
    app.toast("追加失敗: " + (error?.message || "不明なエラー"), "error");
    if (appliedRealtime) {
      try {
        await revertDictionarySnapshot(app, previousEntries);
      } catch (revertError) {
        console.error("辞書の状態復元に失敗しました", revertError);
      }
    }
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

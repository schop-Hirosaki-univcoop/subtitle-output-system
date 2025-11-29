// side-telop.js: 右サイドテロップのプリセット管理と送出更新を扱います。
import { get, onValue, serverTimestamp, update } from "./firebase.js";
import { getSideTelopsRef } from "./firebase.js";
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { resolveNowShowingReference } from "./questions.js";
import { info as logDisplayLinkInfo, warn as logDisplayLinkWarn } from "../shared/display-link-logger.js";
import { openDialog, closeDialog } from "./dialog.js";

const DEFAULT_SIDE_TELOP_ITEMS = [
  "まずは自己紹介です…",
  "質問や不安・悩みをどんどん送ってみよう！",
  "沢山の質問ありがとうございました！"
];
const DEFAULT_SIDE_TELOP = DEFAULT_SIDE_TELOP_ITEMS[0];

function ensureString(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function resolveSideTelopChannel(app) {
  const hasChannelAccessor = app && typeof app.getActiveChannel === "function";
  const { eventId = "", scheduleId = "" } = hasChannelAccessor ? app.getActiveChannel() || {} : {};
  const normalizedEventId = ensureString(eventId);
  const normalizedScheduleId = normalizeScheduleId(scheduleId || "");
  if (!normalizedEventId || !normalizedScheduleId) {
    return { ref: null, eventId: "", scheduleId: "" };
  }
  return { ref: getSideTelopsRef(normalizedEventId, normalizedScheduleId), eventId: normalizedEventId, scheduleId: normalizedScheduleId };
}

function normalizeItems(items) {
  const base = Array.isArray(items) ? items : [];
  const normalized = base.map((item) => ensureString(item)).filter((text) => text.length > 0);
  return normalized.length ? normalized : [...DEFAULT_SIDE_TELOP_ITEMS];
}

function clampActiveIndex(activeIndex, items) {
  if (!Array.isArray(items) || !items.length) return 0;
  const normalized = Number.isInteger(activeIndex) ? activeIndex : 0;
  return Math.min(Math.max(normalized, 0), items.length - 1);
}

function clampSelectedIndex(selectedIndex, items, fallbackIndex = null) {
  if (!Array.isArray(items) || !items.length) return null;
  if (Number.isInteger(selectedIndex)) {
    const normalized = Math.min(Math.max(selectedIndex, 0), items.length - 1);
    return normalized;
  }
  if (Number.isInteger(fallbackIndex)) {
    return clampActiveIndex(fallbackIndex, items);
  }
  return null;
}

function renderSideTelopEmptyState(app, visible) {
  if (app.dom.sideTelopEmpty) {
    app.dom.sideTelopEmpty.hidden = !visible;
  }
  if (app.dom.sideTelopList) {
    app.dom.sideTelopList.hidden = visible;
  }
}

function renderSideTelopControls(app, enabled) {
  const disabled = !enabled;
  [
    app.dom.sideTelopAddButton,
    app.dom.sideTelopEditButton,
    app.dom.sideTelopDeleteButton
  ].forEach((el) => {
    if (el) el.disabled = disabled;
  });
  if (app.dom.sideTelopList) {
    app.dom.sideTelopList.querySelectorAll("button").forEach((el) => {
      el.disabled = disabled;
    });
  }
}

function getActiveSideTelopText(app) {
  const items = Array.isArray(app.state?.sideTelopEntries) ? app.state.sideTelopEntries : [];
  const activeIndex = clampActiveIndex(app.state?.sideTelopActiveIndex ?? 0, items);
  return ensureString(items[activeIndex] || DEFAULT_SIDE_TELOP) || DEFAULT_SIDE_TELOP;
}

async function pushActiveSideTelopToDisplay(app, expectedChannelKey = null) {
  if (!app || typeof app.isDisplayOnline !== "function") return;
  const renderOnline = app.state?.renderChannelOnline !== false;
  const displayOnline = app.isDisplayOnline();
  if (!renderOnline || !displayOnline) return;

  // チャンネルが変更されていないか確認
  if (expectedChannelKey !== null) {
    const currentChannel = resolveSideTelopChannel(app);
    const currentChannelKey = currentChannel.eventId && currentChannel.scheduleId
      ? `${currentChannel.eventId}::${currentChannel.scheduleId}`
      : "";
    if (currentChannelKey !== expectedChannelKey) {
      // チャンネルが変更された場合は処理を中断
      return;
    }
  }

  const activeText = getActiveSideTelopText(app);
  const { ref: nowShowingRef, eventId, scheduleId } = resolveNowShowingReference(app);
  if (!eventId || !scheduleId || !nowShowingRef) {
    return;
  }
  try {
    await update(nowShowingRef, { sideTelopRight: activeText });
    logDisplayLinkInfo("Updated side telop (right) for display", { eventId, scheduleId });
  } catch (error) {
    logDisplayLinkWarn("Failed to update side telop text", error);
  }
}

async function persistSideTelops(app, items, activeIndex = 0) {
  const { ref: sideTelopRef, eventId, scheduleId } = resolveSideTelopChannel(app);
  if (!sideTelopRef || !eventId || !scheduleId) {
    app.toast("日程が未選択のため右サイドテロップを保存できません。", "error");
    return;
  }
  const channelKey = `${eventId}::${scheduleId}`;
  const normalizedItems = normalizeItems(items);
  const normalizedActiveIndex = clampActiveIndex(activeIndex, normalizedItems);
  try {
    await update(sideTelopRef, {
      right: {
        items: normalizedItems,
        activeIndex: normalizedActiveIndex,
        updatedAt: serverTimestamp()
      }
    });
    // 保存後にチャンネルが変更されていないか確認
    const currentChannel = resolveSideTelopChannel(app);
    const currentChannelKey = currentChannel.eventId && currentChannel.scheduleId
      ? `${currentChannel.eventId}::${currentChannel.scheduleId}`
      : "";
    if (currentChannelKey !== channelKey) {
      // チャンネルが変更された場合は状態を更新しない
      return;
    }
    app.state.sideTelopEntries = normalizedItems;
    app.state.sideTelopActiveIndex = normalizedActiveIndex;
    await pushActiveSideTelopToDisplay(app, channelKey);
    // 再度チャンネルを確認
    const finalChannel = resolveSideTelopChannel(app);
    const finalChannelKey = finalChannel.eventId && finalChannel.scheduleId
      ? `${finalChannel.eventId}::${finalChannel.scheduleId}`
      : "";
    if (finalChannelKey === channelKey) {
      app.state.sideTelopLastPushedText = getActiveSideTelopText(app);
    }
  } catch (error) {
    app.toast("サイドテロップの保存に失敗しました。", "error");
    logDisplayLinkWarn("Failed to persist side telops", error);
  }
}

export async function startSideTelopListener(app) {
  if (!app) return;
  if (app.sideTelopUnsubscribe) {
    app.sideTelopUnsubscribe();
    app.sideTelopUnsubscribe = null;
  }
  const { ref: sideTelopRef, eventId, scheduleId } = resolveSideTelopChannel(app);
  if (!sideTelopRef || !eventId || !scheduleId) {
    renderSideTelopControls(app, false);
    app.state.sideTelopEntries = [];
    app.state.sideTelopActiveIndex = 0;
    app.state.sideTelopEditingIndex = null;
    app.state.sideTelopSelectedIndex = null;
    app.state.sideTelopChannelKey = "";
    app.state.sideTelopLastPushedText = "";
    renderSideTelopList(app);
    return;
  }
  const channelKey = `${eventId}::${scheduleId}`;
  const channelChangedBeforeSubscribe = app.state.sideTelopChannelKey !== channelKey;
  if (channelChangedBeforeSubscribe) {
    renderSideTelopControls(app, false);
    app.state.sideTelopEntries = [];
    app.state.sideTelopActiveIndex = 0;
    app.state.sideTelopEditingIndex = null;
    app.state.sideTelopSelectedIndex = null;
    app.state.sideTelopLastPushedText = "";
    renderSideTelopList(app);
  } else {
    renderSideTelopControls(app, true);
  }
  let initialized = false;
  app.sideTelopUnsubscribe = onValue(
    sideTelopRef,
    async (snapshot) => {
      // チャンネルが変更されていないか再確認
      const currentChannel = resolveSideTelopChannel(app);
      const currentChannelKey = currentChannel.eventId && currentChannel.scheduleId
        ? `${currentChannel.eventId}::${currentChannel.scheduleId}`
        : "";
      if (currentChannelKey !== channelKey) {
        // チャンネルが変更された場合は処理を中断
        return;
      }
      const channelChanged = app.state.sideTelopChannelKey !== channelKey;
      const data = snapshot?.exists?.() ? snapshot.val() || {} : {};
      const items = normalizeItems(data?.right?.items || []);
      const activeIndex = clampActiveIndex(data?.right?.activeIndex, items);
      if (!initialized) {
        initialized = true;
        renderSideTelopControls(app, true);
      }
      app.state.sideTelopEntries = items;
      app.state.sideTelopActiveIndex = activeIndex;
      if (!Number.isInteger(app.state.sideTelopEditingIndex) || app.state.sideTelopEditingIndex >= items.length) {
        app.state.sideTelopEditingIndex = null;
      }
      if (!Number.isInteger(app.state.sideTelopSelectedIndex) || app.state.sideTelopSelectedIndex >= items.length) {
        app.state.sideTelopSelectedIndex = clampSelectedIndex(null, items, activeIndex);
      }
      app.state.sideTelopChannelKey = channelKey;
      renderSideTelopList(app);
      const nextText = getActiveSideTelopText(app);
      if (channelChanged || app.state.sideTelopLastPushedText !== nextText) {
        try {
          await pushActiveSideTelopToDisplay(app, channelKey);
          // チャンネルが変更されていないか再確認
          const finalChannel = resolveSideTelopChannel(app);
          const finalChannelKey = finalChannel.eventId && finalChannel.scheduleId
            ? `${finalChannel.eventId}::${finalChannel.scheduleId}`
            : "";
          if (finalChannelKey === channelKey) {
            app.state.sideTelopLastPushedText = nextText;
          }
        } catch (error) {
          logDisplayLinkWarn("Failed to push side telop to display in listener", error);
        }
      }
    },
    (error) => {
      logDisplayLinkWarn("Side telop listener error", error);
      renderSideTelopControls(app, false);
    }
  );

  // 初期データが無ければ作成
  try {
    const initialSnap = await get(sideTelopRef);
    if (!initialSnap?.exists?.()) {
      await persistSideTelops(app, DEFAULT_SIDE_TELOP_ITEMS, 0);
    }
  } catch (error) {
    logDisplayLinkWarn("Failed to seed side telops", error);
  }
}

export function stopSideTelopListener(app) {
  if (app?.sideTelopUnsubscribe) {
    app.sideTelopUnsubscribe();
    app.sideTelopUnsubscribe = null;
  }
}

export function renderSideTelopList(app) {
  const listEl = app.dom?.sideTelopList;
  const emptyEl = app.dom?.sideTelopEmpty;
  const entries = Array.isArray(app.state?.sideTelopEntries) ? app.state.sideTelopEntries : [];
  const activeIndex = clampActiveIndex(app.state?.sideTelopActiveIndex ?? 0, entries);
  const selectedIndex = clampSelectedIndex(app.state?.sideTelopSelectedIndex, entries, activeIndex);
  app.state.sideTelopSelectedIndex = selectedIndex;
  if (!listEl) return;
  listEl.innerHTML = "";
  const hasEntries = entries.length > 0;
  renderSideTelopEmptyState(app, !hasEntries);
  if (!hasEntries) {
    updateSideTelopSelectionUI(app, entries);
    return;
  }

  entries.forEach((text, index) => {
    const li = document.createElement("li");
    li.className = "side-telop-item";
    const isActive = index === activeIndex;
    if (isActive) {
      li.classList.add("is-active");
    }
    if (selectedIndex === index) {
      li.classList.add("is-selected");
    }
    li.dataset.index = String(index);
    li.tabIndex = 0;

    const header = document.createElement("div");
    header.className = "side-telop-item__header";
    const number = document.createElement("span");
    number.className = "side-telop-item__number";
    number.textContent = `#${index + 1}`;
    const activate = document.createElement("button");
    activate.type = "button";
    activate.className = "side-telop-item__activate";
    activate.dataset.action = "activate";
    activate.setAttribute("aria-label", `#${index + 1} を右サイドに表示する`);
    activate.innerHTML = `<span aria-hidden="true">⏵</span>${isActive ? "表示中" : "この文言を表示"}`;
    activate.disabled = isActive;
    activate.title = isActive ? "現在表示中" : "右サイドテロップを切り替え";

    header.append(number, activate);

    const body = document.createElement("p");
    body.className = "side-telop-item__text";
    body.textContent = ensureString(text) || "（未設定）";
    li.append(header, body);
    listEl.appendChild(li);
  });
  if (emptyEl) emptyEl.hidden = hasEntries;
  updateSideTelopSelectionUI(app, entries);
}

function setSideTelopDialogError(app, message) {
  const errorEl = app.dom?.sideTelopDialogError;
  if (!errorEl) return;
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  } else {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }
}

function setupSideTelopDialog(app) {
  if (app.sideTelopDialogSetup) {
    return;
  }
  const dialog = app.dom?.sideTelopDialog;
  if (!dialog) {
    return;
  }
  dialog.querySelectorAll("[data-dialog-dismiss]").forEach((element) => {
    if (element instanceof HTMLElement) {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        closeSideTelopDialog(app);
      });
    }
  });
  app.sideTelopDialogSetup = true;
}

function openSideTelopDialog(app, mode = "create", editingIndex = null) {
  setupSideTelopDialog(app);
  const dialog = app.dom?.sideTelopDialog;
  const form = app.dom?.sideTelopDialogForm;
  const title = app.dom?.sideTelopDialogTitle;
  const textarea = app.dom?.sideTelopDialogText;
  const submitButton = app.dom?.sideTelopDialogSubmit;
  if (!dialog || !form || !textarea) return;

  form.reset();
  setSideTelopDialogError(app, "");
  app.state.sideTelopEditingIndex = editingIndex;

  const entries = Array.isArray(app.state?.sideTelopEntries) ? app.state.sideTelopEntries : [];
  const isEditing = mode === "edit" && Number.isInteger(editingIndex) && editingIndex >= 0 && editingIndex < entries.length;

  if (title) {
    title.textContent = isEditing ? "右サイドテロップを編集" : "右サイドテロップを追加";
  }
  if (textarea) {
    textarea.value = isEditing ? ensureString(entries[editingIndex] || "") : "";
  }
  if (submitButton) {
    submitButton.textContent = isEditing ? "更新" : "追加";
  }

  openDialog(app, dialog, textarea);
}

function updateSideTelopSelectionUI(app, entriesOverride = null) {
  const entries = Array.isArray(entriesOverride)
    ? entriesOverride
    : Array.isArray(app.state?.sideTelopEntries)
    ? app.state.sideTelopEntries
    : [];
  const selectedIndex = clampSelectedIndex(app.state?.sideTelopSelectedIndex, entries, app.state?.sideTelopActiveIndex);
  const hasSelection = Number.isInteger(selectedIndex);
  const selectionLabel = app.dom?.sideTelopSelectionLabel;
  const editBtn = app.dom?.sideTelopEditButton;
  const deleteBtn = app.dom?.sideTelopDeleteButton;

  if (app.dom?.sideTelopList) {
    app.dom.sideTelopList.querySelectorAll(".side-telop-item").forEach((itemEl) => {
      const index = Number(itemEl.dataset.index || "-1");
      itemEl.classList.toggle("is-selected", index === selectedIndex);
    });
  }

  if (selectionLabel) {
    selectionLabel.textContent = hasSelection
      ? `#${(selectedIndex || 0) + 1} を選択中`
      : "テロップを選択してください";
  }

  if (editBtn) {
    editBtn.disabled = !hasSelection;
  }

  if (deleteBtn) {
    deleteBtn.disabled = !hasSelection || entries.length <= 1;
    deleteBtn.title = deleteBtn.disabled && entries.length <= 1 ? "少なくとも1件は残してください" : "";
  }
}

function setSideTelopSelection(app, nextIndex, entriesOverride = null) {
  const entries = Array.isArray(entriesOverride)
    ? entriesOverride
    : Array.isArray(app.state?.sideTelopEntries)
    ? app.state.sideTelopEntries
    : [];
  const selection = clampSelectedIndex(nextIndex, entries, app.state?.sideTelopActiveIndex);
  app.state.sideTelopSelectedIndex = selection;
  updateSideTelopSelectionUI(app, entries);
  return selection;
}

export function handleSideTelopListKeydown(app, event) {
  if (!(event?.target instanceof HTMLElement)) return;
  const itemEl = event.target.closest(".side-telop-item");
  if (!itemEl) return;
  const index = Number(itemEl.dataset.index || "-1");
  if (!Number.isInteger(index) || index < 0) return;
  if (event.key === "Enter" || event.key === " ") {
    setSideTelopSelection(app, index);
  }
}

export function handleSideTelopAddRequest(app) {
  openSideTelopDialog(app, "create", null);
}

export function handleSideTelopEditRequest(app) {
  const entries = Array.isArray(app.state?.sideTelopEntries) ? app.state.sideTelopEntries : [];
  const selectedIndex = clampSelectedIndex(app.state?.sideTelopSelectedIndex, entries, app.state?.sideTelopActiveIndex);
  if (!Number.isInteger(selectedIndex)) {
    app.toast("テロップを選択してください。", "error");
    return;
  }
  openSideTelopDialog(app, "edit", selectedIndex);
}

export function handleSideTelopDeleteRequest(app) {
  const entries = Array.isArray(app.state?.sideTelopEntries) ? [...app.state.sideTelopEntries] : [];
  const selectedIndex = clampSelectedIndex(app.state?.sideTelopSelectedIndex, entries, app.state?.sideTelopActiveIndex);
  if (!Number.isInteger(selectedIndex)) {
    app.toast("テロップを選択してください。", "error");
    return;
  }
  if (entries.length <= 1) {
    app.toast("少なくとも1件は残してください。", "error");
    return;
  }
  entries.splice(selectedIndex, 1);
  const activeIndex = clampActiveIndex(app.state?.sideTelopActiveIndex ?? 0, entries);
  app.state.sideTelopEditingIndex = null;
  app.state.sideTelopSelectedIndex = clampSelectedIndex(selectedIndex, entries, activeIndex);
  updateSideTelopSelectionUI(app, entries);
  persistSideTelops(app, entries, activeIndex);
}

export function handleSideTelopDialogSubmit(app, event) {
  event.preventDefault();
  const textarea = app.dom?.sideTelopDialogText;
  if (!textarea) return;
  const text = ensureString(textarea.value);
  if (!text) {
    setSideTelopDialogError(app, "テロップの文言を入力してください。");
    textarea.focus();
    return;
  }
  const entries = Array.isArray(app.state?.sideTelopEntries) ? [...app.state.sideTelopEntries] : [];
  const editingIndex = Number.isInteger(app.state?.sideTelopEditingIndex) ? app.state.sideTelopEditingIndex : -1;
  if (editingIndex >= 0 && editingIndex < entries.length) {
    entries[editingIndex] = text;
  } else {
    entries.push(text);
  }
  const activeIndex = clampActiveIndex(app.state?.sideTelopActiveIndex ?? 0, entries);
  const nextSelection = clampSelectedIndex(editingIndex >= 0 ? editingIndex : entries.length - 1, entries, activeIndex);
  app.state.sideTelopEditingIndex = null;
  app.state.sideTelopSelectedIndex = nextSelection;
  updateSideTelopSelectionUI(app, entries);
  persistSideTelops(app, entries, activeIndex);
  closeSideTelopDialog(app);
}

export function closeSideTelopDialog(app) {
  const dialog = app.dom?.sideTelopDialog;
  if (!dialog) return;
  app.state.sideTelopEditingIndex = null;
  setSideTelopDialogError(app, "");
  closeDialog(app, dialog);
}

// 後方互換性のため残す（非表示フォーム用）
export function handleSideTelopFormSubmit(app, event) {
  handleSideTelopDialogSubmit(app, event);
}

export function handleSideTelopCancel(app) {
  closeSideTelopDialog(app);
}

export function handleSideTelopListClick(app, event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const itemEl = target.closest(".side-telop-item");
  if (!itemEl) return;
  const index = Number(itemEl.dataset.index || "-1");
  if (!Number.isInteger(index) || index < 0) return;

  const entries = Array.isArray(app.state?.sideTelopEntries) ? [...app.state.sideTelopEntries] : [];
  setSideTelopSelection(app, index, entries);
  if (action === "activate") {
    const activeIndex = clampActiveIndex(index, entries);
    persistSideTelops(app, entries, activeIndex);
  }
}

export function syncSideTelopToChannel(app) {
  startSideTelopListener(app);
}

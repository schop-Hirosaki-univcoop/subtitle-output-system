// side-telop.js: 右サイドテロップのプリセット管理と送出更新を扱います。
import { get, onValue, serverTimestamp, update } from "./firebase.js";
import { getSideTelopsRef } from "./firebase.js";
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { resolveNowShowingReference } from "./questions.js";
import { info as logDisplayLinkInfo, warn as logDisplayLinkWarn } from "../shared/display-link-logger.js";

const DEFAULT_SIDE_TELOP_ITEMS = [
  "まずは自己紹介です・・・",
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
  [app.dom.sideTelopFormSubmit, app.dom.sideTelopFormCancel, app.dom.sideTelopText].forEach((el) => {
    if (el) el.disabled = disabled;
  });
  if (app.dom.sideTelopList) {
    app.dom.sideTelopList.querySelectorAll("button, input[type='radio']").forEach((el) => {
      el.disabled = disabled;
    });
  }
}

function getActiveSideTelopText(app) {
  const items = Array.isArray(app.state?.sideTelopEntries) ? app.state.sideTelopEntries : [];
  const activeIndex = clampActiveIndex(app.state?.sideTelopActiveIndex ?? 0, items);
  return ensureString(items[activeIndex] || DEFAULT_SIDE_TELOP) || DEFAULT_SIDE_TELOP;
}

async function pushActiveSideTelopToDisplay(app) {
  if (!app || typeof app.isDisplayOnline !== "function") return;
  const renderOnline = app.state?.renderChannelOnline !== false;
  const displayOnline = app.isDisplayOnline();
  if (!renderOnline || !displayOnline) return;

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
    app.state.sideTelopEntries = normalizedItems;
    app.state.sideTelopActiveIndex = normalizedActiveIndex;
    await pushActiveSideTelopToDisplay(app);
    app.state.sideTelopLastPushedText = getActiveSideTelopText(app);
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
    app.state.sideTelopLastPushedText = "";
    renderSideTelopList(app);
  } else {
    renderSideTelopControls(app, true);
  }
  let initialized = false;
  app.sideTelopUnsubscribe = onValue(sideTelopRef, async (snapshot) => {
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
    app.state.sideTelopChannelKey = channelKey;
    renderSideTelopList(app);
    const nextText = getActiveSideTelopText(app);
    if (channelChanged || app.state.sideTelopLastPushedText !== nextText) {
      await pushActiveSideTelopToDisplay(app);
      app.state.sideTelopLastPushedText = nextText;
    }
  });

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
  if (!listEl) return;
  listEl.innerHTML = "";
  const hasEntries = entries.length > 0;
  renderSideTelopEmptyState(app, !hasEntries);
  if (!hasEntries) return;

  entries.forEach((text, index) => {
    const li = document.createElement("li");
    li.className = "side-telop-item";
    li.dataset.index = String(index);

    const header = document.createElement("div");
    header.className = "side-telop-item__header";
    const number = document.createElement("span");
    number.className = "side-telop-item__number";
    number.textContent = `#${index + 1}`;
    const radioLabel = document.createElement("label");
    radioLabel.className = "side-telop-item__radio chk";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "side-telop-active";
    radio.value = String(index);
    radio.checked = index === activeIndex;
    radio.dataset.action = "activate";
    radioLabel.appendChild(radio);
    radioLabel.appendChild(document.createTextNode(" 表示中"));
    header.appendChild(number);
    header.appendChild(radioLabel);

    const body = document.createElement("p");
    body.className = "side-telop-item__text";
    body.textContent = ensureString(text) || "（未設定）";

    const actions = document.createElement("div");
    actions.className = "side-telop-item__actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-ghost btn-sm";
    editBtn.dataset.action = "edit";
    editBtn.textContent = "編集";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-ghost btn-sm";
    deleteBtn.dataset.action = "delete";
    deleteBtn.textContent = "削除";
    if (entries.length <= 1) {
      deleteBtn.disabled = true;
      deleteBtn.title = "少なくとも1件は残してください";
    }
    actions.append(editBtn, deleteBtn);

    li.append(header, body, actions);
    listEl.appendChild(li);
  });
  if (emptyEl) emptyEl.hidden = hasEntries;
  if (app.dom.sideTelopText && app.state.sideTelopEditingIndex == null) {
    app.dom.sideTelopText.value = "";
  }
  updateSideTelopFormLabels(app, entries, app.state.sideTelopEditingIndex);
}

function updateSideTelopFormLabels(app, entriesOverride = null, editingIndexOverride = undefined) {
  const entries = Array.isArray(entriesOverride)
    ? entriesOverride
    : Array.isArray(app.state?.sideTelopEntries)
    ? app.state.sideTelopEntries
    : [];
  const isEditing = Number.isInteger(editingIndexOverride)
    ? editingIndexOverride >= 0
    : Number.isInteger(app.state?.sideTelopEditingIndex) && app.state.sideTelopEditingIndex >= 0;
  const entryCount = entries.length;
  const textarea = app.dom?.sideTelopText;
  if (textarea) {
    if (isEditing) {
      textarea.placeholder = "編集するテロップの内容を入力";
    } else {
      const nextNumber = Math.max(1, entryCount + 1);
      textarea.placeholder = `右サイドテロップ${nextNumber}`;
    }
  }
  if (app.dom.sideTelopFormSubmit) {
    app.dom.sideTelopFormSubmit.textContent = isEditing ? "更新" : "追加";
  }
  if (app.dom.sideTelopFormCancel) {
    app.dom.sideTelopFormCancel.hidden = !isEditing;
  }
}

export function handleSideTelopFormSubmit(app, event) {
  event.preventDefault();
  const textarea = app.dom?.sideTelopText;
  if (!textarea) return;
  const text = ensureString(textarea.value);
  if (!text) {
    app.toast("テロップの文言を入力してください。", "error");
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
  app.state.sideTelopEditingIndex = null;
  textarea.value = "";
  updateSideTelopFormLabels(app, entries, null);
  persistSideTelops(app, entries, activeIndex);
}

export function handleSideTelopCancel(app) {
  app.state.sideTelopEditingIndex = null;
  if (app.dom.sideTelopText) {
    app.dom.sideTelopText.value = "";
  }
  updateSideTelopFormLabels(app, app.state?.sideTelopEntries || [], null);
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
  if (action === "edit") {
    app.state.sideTelopEditingIndex = index;
    if (app.dom.sideTelopText) {
      app.dom.sideTelopText.value = ensureString(entries[index] || "");
      app.dom.sideTelopText.focus();
    }
    updateSideTelopFormLabels(app);
    return;
  }
  if (action === "delete") {
    if (entries.length <= 1) {
      app.toast("少なくとも1件は残してください。", "error");
      return;
    }
    entries.splice(index, 1);
    const activeIndex = clampActiveIndex(app.state?.sideTelopActiveIndex ?? 0, entries);
    app.state.sideTelopEditingIndex = null;
    updateSideTelopFormLabels(app, entries, null);
    persistSideTelops(app, entries, activeIndex);
    return;
  }
  if (action === "activate") {
    const activeIndex = clampActiveIndex(index, entries);
    persistSideTelops(app, entries, activeIndex);
  }
}

export function syncSideTelopToChannel(app) {
  startSideTelopListener(app);
}

import { QUESTIONS_SUBTAB_KEY, GENRE_ALL_VALUE } from "./constants.js";
import { database, ref, update, set, remove, get, getNowShowingRef, serverTimestamp } from "./firebase.js";
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { escapeHtml, formatOperatorName, resolveGenreLabel, formatScheduleRange } from "./utils.js";

const SUB_TAB_OPTIONS = new Set(["all", "normal", "puq"]);

function normalizeSubTab(value) {
  const candidate = String(value || "").trim();
  return SUB_TAB_OPTIONS.has(candidate) ? candidate : "all";
}

function resolveTelopRef(app) {
  const hasChannelAccessor = app && typeof app.getActiveChannel === "function";
  const { eventId = "", scheduleId = "" } = hasChannelAccessor ? app.getActiveChannel() || {} : {};
  const normalizedSchedule = scheduleId ? normalizeScheduleId(scheduleId) : "";
  const refInstance = getNowShowingRef(eventId, scheduleId);
  return { ref: refInstance, eventId: eventId || "", scheduleId: normalizedSchedule };
}

function ensureChannelAligned(app) {
  if (typeof app.hasChannelMismatch === "function" && app.hasChannelMismatch()) {
    const summary = typeof app.describeChannelAssignment === "function" ? app.describeChannelAssignment() : "";
    const message = summary
      ? `ディスプレイは${summary}に固定されています。日程を合わせてから操作してください。`
      : "ディスプレイのチャンネルが未設定です。先に日程を固定してください。";
    app.toast(message, "error");
    return false;
  }
  return true;
}

export function loadPreferredSubTab() {
  let stored = "";
  try {
    stored = localStorage.getItem(QUESTIONS_SUBTAB_KEY) || "";
  } catch (error) {
    stored = "";
  }
  return normalizeSubTab(stored);
}

function persistSubTabPreference(tabName) {
  const normalized = normalizeSubTab(tabName);
  try {
    localStorage.setItem(QUESTIONS_SUBTAB_KEY, normalized);
  } catch (error) {
    console.debug("sub-tab preference not persisted", error);
  }
}

export function renderQuestions(app) {
  if (!app.dom.cardsContainer) return;
  const currentTab = app.state.currentSubTab;
  const viewingPuqTab = currentTab === "puq";
  const viewingNormalTab = currentTab === "normal";
  const selectedGenre = typeof app.state.currentGenre === "string" ? app.state.currentGenre.trim() : "";
  const viewingAllGenres = !selectedGenre || selectedGenre.toLowerCase() === GENRE_ALL_VALUE;
  const selectedSchedule = viewingNormalTab ? app.state.currentSchedule || "" : "";
  let list = app.state.allQuestions.filter((item) => {
    const isPuq = item["ピックアップ"] === true || item["ラジオネーム"] === "Pick Up Question";
    if (viewingPuqTab && !isPuq) {
      return false;
    }
    if (viewingNormalTab && isPuq) {
      return false;
    }
    const itemGenre = String(item["ジャンル"] ?? "").trim() || "その他";
    if (!viewingAllGenres && itemGenre !== selectedGenre) return false;
    const itemSchedule = String(item.__scheduleKey ?? item["日程"] ?? "").trim();
    if (viewingNormalTab && selectedSchedule && itemSchedule !== selectedSchedule) return false;
    return true;
  });
  const currentTabCompareKey = viewingPuqTab ? "__ts" : "__ts";
  list = [...list].sort((a, b) => {
    const aTs = Number(a[currentTabCompareKey] || 0);
    const bTs = Number(b[currentTabCompareKey] || 0);
    return bTs - aTs;
  });

  const live = app.state.renderState?.nowShowing || app.state.displaySession?.nowShowing || null;
  const liveUid = live && typeof live.uid !== "undefined" ? String(live.uid || "") : "";
  const liveParticipantId = String(live?.participantId || "").trim();
  const liveQuestion = live?.question ?? "";
  const liveName = live?.name ?? "";
  const selectedUid = app.state.selectedRowData ? String(app.state.selectedRowData.uid || "") : "";
  let nextSelection = null;

  app.dom.cardsContainer.innerHTML = "";
  list.forEach((item) => {
    const card = document.createElement("article");
    card.className = "q-card";
    const isAnswered = !!item["回答済"];
    const isSelecting = !!item["選択中"];
    const statusText = isSelecting ? "送出準備中" : isAnswered ? "送出済" : "未送出";
    if (isAnswered) card.classList.add("is-answered");
    if (isSelecting) card.classList.add("is-selecting");
    const isPuq = item["ピックアップ"] === true || item["ラジオネーム"] === "Pick Up Question";
    if (isPuq) {
      card.classList.add("is-puq");
    }
    const uid = String(item.UID);
    card.dataset.uid = uid;
    const participantId = String(item["参加者ID"] ?? "").trim();
    const rawGenre = String(item["ジャンル"] ?? "").trim();
    const normalizedGenre = rawGenre || "その他";
    const resolvedGenre = resolveGenreLabel(normalizedGenre);
    const genreBadge = viewingAllGenres
      ? `<span class="q-genre" aria-label="ジャンル ${escapeHtml(resolvedGenre)}">${escapeHtml(resolvedGenre)}</span>`
      : "";
    const isLiveMatch = liveUid
      ? liveUid === uid
      : (liveParticipantId && participantId && liveParticipantId === participantId && liveQuestion === item["質問・お悩み"]) ||
        (liveName === item["ラジオネーム"] && liveQuestion === item["質問・お悩み"]);
    if (isLiveMatch) {
      card.classList.add("is-live", "now-displaying");
      if (app.state.lastDisplayedUid === item.UID) {
        card.classList.add("flash");
        card.addEventListener(
          "animationend",
          () => card.classList.remove("flash"),
          { once: true }
        );
        app.state.lastDisplayedUid = null;
      }
    }
    if (uid === selectedUid) {
      card.classList.add("is-selected");
      nextSelection = {
        uid,
        name: item["ラジオネーム"],
        question: item["質問・お悩み"],
        isAnswered,
        participantId,
        genre: normalizedGenre,
        isPickup: isPuq
      };
    }
    const rawName = item["ラジオネーム"];
    const displayName = formatOperatorName(rawName) || "—";
    const groupLabel = String(item["班番号"] ?? "").trim();
    const groupBadge = groupLabel
      ? `<span class="q-group" role="text" aria-label="班番号 ${escapeHtml(groupLabel)}">${escapeHtml(groupLabel)}</span>`
      : "";
    card.innerHTML = `
      <span class="status-text visually-hidden">${statusText}</span>
      <div class="q-corner">
        ${groupBadge}
        <label class="q-check" aria-label="${statusText}の質問をバッチ選択">
          <input type="checkbox" class="row-checkbox" data-uid="${escapeHtml(uid)}">
          <span class="visually-hidden">選択</span>
        </label>
      </div>
      <header class="q-head">
        <div class="q-title">
          <span class="q-name">${escapeHtml(displayName)}</span>
          ${genreBadge}
        </div>
      </header>
      <div class="q-text">${escapeHtml(item["質問・お悩み"])}</div>
    `;
    card.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".q-check")) return;
      app.dom.cardsContainer?.querySelectorAll(".q-card").forEach((el) => el.classList.remove("is-selected"));
      card.classList.add("is-selected");
      app.state.selectedRowData = {
        uid,
        name: item["ラジオネーム"],
        question: item["質問・お悩み"],
        isAnswered,
        participantId,
        genre: normalizedGenre,
        isPickup: isPuq
      };
      updateActionAvailability(app);
    });
    app.dom.cardsContainer.appendChild(card);
  });

  if (selectedUid && nextSelection) {
    app.state.selectedRowData = nextSelection;
    updateActionAvailability(app);
  } else if (!list.some((item) => String(item.UID) === selectedUid)) {
    app.state.selectedRowData = null;
    updateActionAvailability(app);
  }
  syncSelectAllState(app);
  updateBatchButtonVisibility(app);
}

export function updateScheduleContext(app) {
  const rangeEl = app.dom.scheduleTimeRange;
  const eventLabelEl = app.dom.scheduleEventName;
  const scheduleLabelEl = app.dom.scheduleLabel;
  const metadataMap = app.state.scheduleMetadata instanceof Map ? app.state.scheduleMetadata : null;
  const eventsMap = app.state.eventsById instanceof Map ? app.state.eventsById : null;
  const context = app.pageContext || {};

  const ensure = (value) => String(value ?? "").trim();
  let eventId = ensure(context.eventId);
  let scheduleId = ensure(context.scheduleId);
  let scheduleKey = ensure(app.state.currentSchedule);

  if (!scheduleKey && eventId && scheduleId) {
    scheduleKey = `${eventId}::${scheduleId}`;
  }

  let meta = null;
  if (scheduleKey && metadataMap) {
    meta = metadataMap.get(scheduleKey) || null;
  }
  if (!meta && metadataMap && eventId && scheduleId) {
    meta = metadataMap.get(`${eventId}::${scheduleId}`) || null;
  }

  if (meta) {
    eventId = ensure(meta.eventId) || eventId;
    scheduleId = ensure(meta.scheduleId) || scheduleId;
  }

  if (scheduleKey && (!eventId || !scheduleId)) {
    const [eventPart, schedulePart] = scheduleKey.split("::");
    if (!eventId && eventPart) eventId = ensure(eventPart);
    if (!scheduleId && schedulePart) scheduleId = ensure(schedulePart);
  }

  let eventName = ensure(context.eventName);
  if (meta?.eventName) {
    eventName = ensure(meta.eventName);
  } else if (!eventName && eventId && eventsMap) {
    eventName = ensure(eventsMap.get(eventId)?.name);
  }

  let scheduleLabel = ensure(context.scheduleLabel);
  if (meta?.label) {
    scheduleLabel = ensure(meta.label);
  }

  const startValue = meta?.startAt || context.startAt || context.scheduleStart || "";
  const endValue = meta?.endAt || context.endAt || context.scheduleEnd || "";
  const startText = ensure(startValue);
  const endText = ensure(endValue);

  if (scheduleKey) {
    app.state.currentSchedule = scheduleKey;
    app.state.lastNormalSchedule = scheduleKey;
  }

  app.state.activeEventId = eventId;
  app.state.activeScheduleId = scheduleId;
  app.state.activeEventName = eventName;
  app.state.activeScheduleLabel = scheduleLabel;

  if (eventLabelEl) {
    eventLabelEl.textContent = eventName || "イベント未選択";
  }
  if (scheduleLabelEl) {
    scheduleLabelEl.textContent = scheduleLabel || "—";
  }
  if (rangeEl) {
    const rangeText = formatScheduleRange(startText, endText);
    if (rangeText) {
      rangeEl.textContent = rangeText;
      rangeEl.hidden = false;
    } else {
      rangeEl.textContent = "";
      rangeEl.hidden = true;
    }
  }

  app.pageContext = {
    ...context,
    eventId,
    scheduleId,
    eventName,
    scheduleLabel,
    startAt: startText,
    endAt: endText,
    scheduleKey: scheduleKey || ""
  };

  if (typeof app.refreshOperatorPresenceSubscription === "function") {
    app.refreshOperatorPresenceSubscription();
  }
  if (typeof app.syncOperatorPresence === "function") {
    app.syncOperatorPresence();
  }
  if (typeof app.refreshChannelSubscriptions === "function") {
    app.refreshChannelSubscriptions();
  }
}

export function switchSubTab(app, tabName) {
  if (!tabName) return;
  const previous = app.state.currentSubTab;
  if (tabName === previous) {
    return;
  }
  app.state.currentSubTab = tabName;
  document.querySelectorAll(".sub-tab-button").forEach((button) => {
    const isActive = button.dataset.subTab === tabName;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  if (previous === "normal" && tabName !== "normal") {
    app.state.lastNormalSchedule = app.state.currentSchedule || "";
  }
  if (tabName === "normal") {
    app.state.currentSchedule = app.state.lastNormalSchedule || "";
  } else {
    app.state.currentSchedule = "";
  }
  updateScheduleContext(app);
  if (typeof app.refreshChannelSubscriptions === "function") {
    app.refreshChannelSubscriptions();
  }
  renderQuestions(app);
  persistSubTabPreference(tabName);
}

export function switchGenre(app, genreKey) {
  const rawValue = typeof genreKey === "string" ? genreKey : String(genreKey ?? "");
  const trimmedValue = rawValue.trim();
  const isAll = !trimmedValue || trimmedValue.toLowerCase() === GENRE_ALL_VALUE;
  const nextGenre = isAll ? "" : resolveGenreLabel(trimmedValue);
  const current = typeof app.state.currentGenre === "string" ? app.state.currentGenre : "";
  if (nextGenre === current) {
    return;
  }
  app.state.currentGenre = nextGenre;
  document.querySelectorAll(".genre-tab-button").forEach((button) => {
    const value = String(button.dataset.genre ?? "").trim();
    const buttonIsAll = !value || value.toLowerCase() === GENRE_ALL_VALUE;
    const isActive = buttonIsAll ? nextGenre === "" : nextGenre !== "" && resolveGenreLabel(value) === nextGenre;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  if (app.state.currentSubTab === "normal" && app.state.lastNormalSchedule) {
    app.state.currentSchedule = app.state.lastNormalSchedule;
  }
  updateScheduleContext(app);
  if (typeof app.refreshChannelSubscriptions === "function") {
    app.refreshChannelSubscriptions();
  }
  renderQuestions(app);
}

export async function handleDisplay(app) {
  if (!app.state.displaySessionActive) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!ensureChannelAligned(app)) {
    return;
  }
  if (!app.state.selectedRowData || app.state.selectedRowData.isAnswered) return;
  const { ref: telopRef, eventId, scheduleId } = resolveTelopRef(app);
  if (!eventId || !scheduleId) {
    app.toast("イベントまたは日程が割り当てられていないため送出できません。", "error");
    return;
  }
  const snapshot = await get(telopRef);
  const previousTelop = snapshot.val();
  const previousUid = previousTelop && typeof previousTelop.uid !== "undefined" ? String(previousTelop.uid || "") : "";
  try {
    const updates = {};
    if (previousUid) {
      updates[`questionStatus/${previousUid}/selecting`] = false;
      updates[`questionStatus/${previousUid}/answered`] = true;
      updates[`questionStatus/${previousUid}/updatedAt`] = serverTimestamp();
    } else if (previousTelop) {
      const prev = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
      );
      if (prev) {
        updates[`questionStatus/${prev.UID}/selecting`] = false;
        updates[`questionStatus/${prev.UID}/answered`] = true;
        updates[`questionStatus/${prev.UID}/updatedAt`] = serverTimestamp();
      }
    }
    updates[`questionStatus/${app.state.selectedRowData.uid}/selecting`] = true;
    updates[`questionStatus/${app.state.selectedRowData.uid}/answered`] = false;
    updates[`questionStatus/${app.state.selectedRowData.uid}/updatedAt`] = serverTimestamp();
    await update(ref(database), updates);
    const genre = String(app.state.selectedRowData.genre ?? "").trim();
    await set(telopRef, {
      uid: app.state.selectedRowData.uid,
      participantId: app.state.selectedRowData.participantId || "",
      name: app.state.selectedRowData.name,
      question: app.state.selectedRowData.question,
      genre,
      pickup: app.state.selectedRowData.isPickup === true
    });
    app.api.fireAndForgetApi({ action: "updateSelectingStatus", uid: app.state.selectedRowData.uid });
    if (previousUid) {
      app.api.fireAndForgetApi({ action: "updateStatus", uid: previousUid, status: true });
    } else if (previousTelop) {
      const prev = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
      );
      if (prev) {
        app.api.fireAndForgetApi({ action: "updateStatus", uid: prev.UID, status: true });
      }
    }
    app.state.lastDisplayedUid = app.state.selectedRowData.uid;
    app.api.logAction("DISPLAY", `RN: ${app.state.selectedRowData.name}`);
    const displayLabel = formatOperatorName(app.state.selectedRowData.name) || app.state.selectedRowData.name;
    app.toast(`「${displayLabel}」の質問を送出しました。`, "success");
  } catch (error) {
    app.toast("送出処理中にエラーが発生しました: " + error.message, "error");
  }
}

export async function handleUnanswer(app) {
  if (!app.state.displaySessionActive) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!ensureChannelAligned(app)) {
    return;
  }
  if (!app.state.selectedRowData || !app.state.selectedRowData.isAnswered) return;
  const displayLabel = formatOperatorName(app.state.selectedRowData.name) || app.state.selectedRowData.name;
  const confirmed = await app.confirmAction({
    title: "質問を未回答へ戻す",
    description: `「${displayLabel}」の質問を「未回答」に戻します。よろしいですか？`,
    confirmLabel: "未回答に戻す",
    cancelLabel: "キャンセル",
    tone: "danger"
  });
  if (!confirmed) return;
  const uid = app.state.selectedRowData.uid;
  update(ref(database, `questionStatus/${uid}`), { answered: false, updatedAt: serverTimestamp() });
  app.api.fireAndForgetApi({ action: "updateStatus", uid: app.state.selectedRowData.uid, status: false });
}

export function handleSelectAll(app, event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  const isChecked = event.target.checked;
  app.dom.cardsContainer
    ?.querySelectorAll(".row-checkbox")
    .forEach((checkbox) => {
      checkbox.checked = isChecked;
    });
  syncSelectAllState(app);
  updateBatchButtonVisibility(app);
}

export async function handleBatchUnanswer(app) {
  if (!app.state.displaySessionActive) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!ensureChannelAligned(app)) {
    return;
  }
  const checkedBoxes = Array.from(app.dom.cardsContainer?.querySelectorAll(".row-checkbox:checked") || []);
  if (checkedBoxes.length === 0) return;
  const confirmed = await app.confirmAction({
    title: "一括で未回答に戻す",
    description: `${checkedBoxes.length}件の質問を「未回答」に戻します。よろしいですか？`,
    confirmLabel: "未回答に戻す",
    cancelLabel: "キャンセル",
    tone: "danger"
  });
  if (!confirmed) return;
  const uidsToUpdate = checkedBoxes.map((checkbox) => checkbox.dataset.uid);
  const updates = {};
  for (const uid of uidsToUpdate) {
    updates[`questionStatus/${uid}/answered`] = false;
    updates[`questionStatus/${uid}/updatedAt`] = serverTimestamp();
  }
  try {
    await update(ref(database), updates);
    app.api.fireAndForgetApi({ action: "batchUpdateStatus", uids: uidsToUpdate, status: false });
    checkedBoxes.forEach((checkbox) => {
      checkbox.checked = false;
    });
    if (app.dom.selectAllCheckbox) {
      app.dom.selectAllCheckbox.checked = false;
      app.dom.selectAllCheckbox.indeterminate = false;
    }
    syncSelectAllState(app);
    updateBatchButtonVisibility(app);
  } catch (error) {
    console.error("Failed to batch unanswer", error);
    app.toast("未回答への戻し中にエラーが発生しました。", "error");
  }
}

export async function clearTelop(app) {
  if (!app.state.displaySessionActive) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!ensureChannelAligned(app)) {
    return;
  }
  const { ref: telopRef, eventId, scheduleId } = resolveTelopRef(app);
  if (!eventId || !scheduleId) {
    app.toast("イベントまたは日程が割り当てられていないため送出をクリアできません。", "error");
    return;
  }
  const snapshot = await get(telopRef);
  const previousTelop = snapshot.val();
  try {
    const updates = {};
    const selectingItems = app.state.allQuestions.filter((item) => item["選択中"] === true);
    selectingItems.forEach((item) => {
      updates[`questionStatus/${item.UID}/selecting`] = false;
      updates[`questionStatus/${item.UID}/updatedAt`] = serverTimestamp();
    });
    if (previousTelop) {
      const prevItem = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
      );
      if (prevItem) {
        updates[`questionStatus/${prevItem.UID}/answered`] = true;
        updates[`questionStatus/${prevItem.UID}/updatedAt`] = serverTimestamp();
        app.api.fireAndForgetApi({ action: "updateStatus", uid: prevItem.UID, status: true });
      }
    }
    if (Object.keys(updates).length > 0) {
      await update(ref(database), updates);
    }
    await remove(telopRef);
    app.api.fireAndForgetApi({ action: "clearSelectingStatus" });
    app.api.logAction("CLEAR");
    app.toast("送出をクリアしました。", "success");
  } catch (error) {
    app.toast("送出クリア中にエラーが発生しました: " + error.message, "error");
  }
}

function getBatchSelectionCount(app) {
  const container = app.dom.cardsContainer;
  if (!container) {
    return 0;
  }
  return container.querySelectorAll(".row-checkbox:checked").length || 0;
}

function setActionPanelMode(app, mode) {
  if (!app.dom.actionPanel) return;
  const normalized = mode || "idle";
  app.dom.actionPanel.dataset.selection = normalized;
}

export function updateActionAvailability(app) {
  const active = !!app.state.displaySessionActive;
  const selection = app.state.selectedRowData;
  const checkedCount = getBatchSelectionCount(app);
  const hasBatchSelection = active && checkedCount > 0;
  const channelAligned = typeof app.hasChannelMismatch === "function" ? !app.hasChannelMismatch() : true;
  const mode = !active ? "inactive" : hasBatchSelection ? "multi" : selection ? "single" : "idle";

  setActionPanelMode(app, mode);

  app.dom.actionButtons.forEach((button) => {
    if (button) button.disabled = true;
  });
  if (app.dom.clearButton) app.dom.clearButton.disabled = !active;
  if (!app.dom.selectedInfo) {
    updateBatchButtonVisibility(app, checkedCount);
    return;
  }
  if (!active) {
    app.dom.selectedInfo.textContent = "送出端末が接続されていません";
    updateBatchButtonVisibility(app, checkedCount);
    return;
  }
  if (!channelAligned) {
    const summary = typeof app.describeChannelAssignment === "function" ? app.describeChannelAssignment() : "";
    app.dom.selectedInfo.textContent = summary
      ? `ディスプレイは${summary}に固定されています。`
      : "ディスプレイの日程が未確定です";
    updateBatchButtonVisibility(app, 0);
    return;
  }
  if (hasBatchSelection) {
    app.dom.selectedInfo.textContent = `${checkedCount}件の質問を選択中`;
    updateBatchButtonVisibility(app, checkedCount);
    return;
  }
  if (!selection) {
    app.dom.selectedInfo.textContent = "行を選択してください";
    updateBatchButtonVisibility(app, checkedCount);
    return;
  }

  app.dom.actionButtons.forEach((button) => {
    if (button) button.disabled = false;
  });
  if (app.dom.actionButtons[0]) app.dom.actionButtons[0].disabled = !!selection.isAnswered;
  if (app.dom.actionButtons[1]) app.dom.actionButtons[1].disabled = !selection.isAnswered;
  const safeName = formatOperatorName(selection.name) || "—";
  app.dom.selectedInfo.textContent = `選択中: ${safeName}`;
  updateBatchButtonVisibility(app, checkedCount);
}

export function updateBatchButtonVisibility(app, providedCount) {
  if (!app.dom.batchUnanswerBtn) return;
  const active = !!app.state.displaySessionActive;
  const checkedCount = active ? providedCount ?? getBatchSelectionCount(app) : 0;
  app.dom.batchUnanswerBtn.disabled = !active || checkedCount === 0;
}

export function syncSelectAllState(app) {
  if (!app.dom.selectAllCheckbox) return;
  const checkboxes = Array.from(app.dom.cardsContainer?.querySelectorAll(".row-checkbox") || []);
  const total = checkboxes.length;
  if (total === 0) {
    app.dom.selectAllCheckbox.checked = false;
    app.dom.selectAllCheckbox.indeterminate = false;
    return;
  }
  let checked = 0;
  checkboxes.forEach((checkbox) => {
    if (checkbox instanceof HTMLInputElement && checkbox.checked) checked += 1;
  });
  app.dom.selectAllCheckbox.checked = checked === total;
  app.dom.selectAllCheckbox.indeterminate = checked > 0 && checked < total;
}

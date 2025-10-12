import { GENRE_OPTIONS, QUESTIONS_SUBTAB_KEY } from "./constants.js";
import { database, ref, update, set, remove, get, telopRef } from "./firebase.js";
import { escapeHtml, formatOperatorName, resolveGenreLabel, formatScheduleRange } from "./utils.js";

const SUB_TAB_OPTIONS = new Set(["all", "normal", "puq"]);

function normalizeSubTab(value) {
  const candidate = String(value || "").trim();
  return SUB_TAB_OPTIONS.has(candidate) ? candidate : "all";
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

function parseScheduleTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return Number.NaN;
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;
  const sanitized = raw
    .replace(/年|\//g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/時/g, ":")
    .replace(/分/g, "")
    .replace(/秒/g, "")
    .replace(/[^0-9:\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = sanitized.replace(/\s/, "T");
  const normalizedParse = Date.parse(normalized);
  if (!Number.isNaN(normalizedParse)) return normalizedParse;
  const match = sanitized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/
  );
  if (!match) return Number.NaN;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const parsedDate = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return parsedDate.getTime();
}

function findNearestFutureSchedule(scheduleEntries, metadataMap) {
  if (!Array.isArray(scheduleEntries) || scheduleEntries.length === 0) {
    return "";
  }
  const now = Date.now();
  let futureCandidate = null;
  let pastCandidate = null;
  const fallbackValue = scheduleEntries[0][0];
  scheduleEntries.forEach(([value, details]) => {
    const meta = metadataMap && metadataMap instanceof Map ? metadataMap.get(value) : null;
    const candidates = [
      details?.start,
      meta?.startAt,
      meta?.date,
      details?.end,
      meta?.endAt,
      details?.label,
      meta?.label
    ];
    let ts = Number.NaN;
    for (const candidate of candidates) {
      ts = parseScheduleTimestamp(candidate);
      if (!Number.isNaN(ts)) break;
    }
    if (Number.isNaN(ts)) return;
    if (ts >= now) {
      if (!futureCandidate || ts < futureCandidate.ts) {
        futureCandidate = { value, ts };
      }
    } else if (!pastCandidate || ts > pastCandidate.ts) {
      pastCandidate = { value, ts };
    }
  });
  if (futureCandidate) return futureCandidate.value;
  if (pastCandidate) return pastCandidate.value;
  return fallbackValue;
}

export function renderQuestions(app) {
  if (!app.dom.cardsContainer) return;
  const currentTab = app.state.currentSubTab;
  const viewingPuqTab = currentTab === "puq";
  const viewingNormalTab = currentTab === "normal";
  const selectedGenre = app.state.currentGenre || GENRE_OPTIONS[0];
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
    if (selectedGenre && itemGenre !== selectedGenre) return false;
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

export function updateScheduleOptions(app) {
  const select = app.dom.scheduleFilter;
  if (!select) return;
  const rangeEl = app.dom.scheduleTimeRange;
  const isNormalTab = app.state.currentSubTab === "normal";
  const selectedGenre = app.state.currentGenre || GENRE_OPTIONS[0];
  const scheduleMap = new Map();
  const metadataMap = app.state.scheduleMetadata instanceof Map ? app.state.scheduleMetadata : null;
  const ensureString = (value) => String(value ?? "").trim();
  if (isNormalTab) {
    for (const item of app.state.allQuestions) {
      const isPuq = item["ピックアップ"] === true || item["ラジオネーム"] === "Pick Up Question";
      if (isPuq) continue;
      const itemGenre = ensureString(item["ジャンル"]) || "その他";
      if (selectedGenre && itemGenre !== selectedGenre) continue;
      const key = ensureString(item.__scheduleKey ?? item["日程"]);
      if (!key) continue;
      const meta = metadataMap ? metadataMap.get(key) : null;
      const fallbackLabel = ensureString(item["日程表示"] ?? item["日程"]);
      const label = ensureString(meta?.label) || fallbackLabel || ensureString(item["日程ID"]) || key;
      const fallbackStart = ensureString(item.__scheduleStart ?? item["開始日時"]);
      const fallbackEnd = ensureString(item.__scheduleEnd ?? item["終了日時"]);
      const startValue = ensureString(meta?.startAt) || fallbackStart;
      const endValue = ensureString(meta?.endAt) || fallbackEnd;
      const eventId = ensureString(item["イベントID"]) || ensureString(meta?.eventId);
      const scheduleId = ensureString(item["日程ID"]) || ensureString(meta?.scheduleId);
      const eventName = ensureString(meta?.eventName) || ensureString(item["イベント名"]);
      if (!label && !startValue && !endValue) continue;
      const existing = scheduleMap.get(key);
      if (existing) {
        if (!existing.label && label) existing.label = label;
        if (!existing.start && startValue) existing.start = startValue;
        if (!existing.end && endValue) existing.end = endValue;
        if (!existing.eventId && eventId) existing.eventId = eventId;
        if (!existing.scheduleId && scheduleId) existing.scheduleId = scheduleId;
        if (!existing.eventName && eventName) existing.eventName = eventName;
      } else {
        scheduleMap.set(key, {
          label,
          start: startValue,
          end: endValue,
          eventId,
          scheduleId,
          eventName
        });
      }
    }
  }
  const scheduleEntries = Array.from(scheduleMap.entries()).sort((a, b) => {
    const labelA = String(a[1]?.label || a[0] || "");
    const labelB = String(b[1]?.label || b[0] || "");
    return labelA.localeCompare(labelB, "ja", { numeric: true, sensitivity: "base" });
  });
  const scheduleDetails = new Map(scheduleEntries);
  select.innerHTML = "";
  scheduleEntries.forEach(([value, details]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = details?.label || value;
    select.appendChild(opt);
  });
  app.state.availableSchedules = scheduleEntries.map(([value]) => value);
  app.state.scheduleDetails = scheduleDetails;
  let nextValue = "";
  if (isNormalTab && scheduleEntries.length > 0) {
    const { currentSchedule, lastNormalSchedule } = app.state;
    if (currentSchedule && scheduleDetails.has(currentSchedule)) {
      nextValue = currentSchedule;
    } else if (lastNormalSchedule && scheduleDetails.has(lastNormalSchedule)) {
      nextValue = lastNormalSchedule;
    } else {
      nextValue = findNearestFutureSchedule(scheduleEntries, metadataMap);
    }
  }
  select.value = nextValue;
  app.state.currentSchedule = nextValue;
  if (isNormalTab) {
    app.state.lastNormalSchedule = nextValue;
  }
  const shouldDisable = !isNormalTab || scheduleEntries.length === 0;
  select.disabled = shouldDisable;
  const wrapper = select.closest(".schedule-filter");
  if (wrapper) {
    wrapper.classList.toggle("is-disabled", shouldDisable);
  }
  if (rangeEl) {
    if (shouldDisable) {
      rangeEl.textContent = "";
      rangeEl.hidden = true;
    } else {
      updateScheduleRangeDisplay(app);
    }
  }
}

function updateScheduleRangeDisplay(app) {
  const select = app.dom.scheduleFilter;
  const rangeEl = app.dom.scheduleTimeRange;
  if (!select || !rangeEl) return;
  const isNormalTab = app.state.currentSubTab === "normal";
  const detailsMap = app.state.scheduleDetails instanceof Map ? app.state.scheduleDetails : null;
  const value = select.value || "";
  const details = isNormalTab && detailsMap ? detailsMap.get(value) : null;
  const rangeText = details ? formatScheduleRange(details.start, details.end) : "";
  if (rangeText) {
    rangeEl.textContent = rangeText;
    rangeEl.hidden = false;
  } else {
    rangeEl.textContent = "";
    rangeEl.hidden = true;
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
  updateScheduleOptions(app);
  renderQuestions(app);
  persistSubTabPreference(tabName);
}

export function switchGenre(app, genreKey) {
  if (!genreKey) return;
  const current = app.state.currentGenre || GENRE_OPTIONS[0];
  const nextGenre = resolveGenreLabel(genreKey);
  if (nextGenre === current) return;
  app.state.currentGenre = nextGenre;
  document.querySelectorAll(".genre-tab-button").forEach((button) => {
    const isActive = button.dataset.genre === nextGenre;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  if (app.state.currentSubTab === "normal") {
    app.state.lastNormalSchedule = "";
    app.state.currentSchedule = "";
    if (app.dom.scheduleFilter) {
      app.dom.scheduleFilter.value = "";
    }
  }
  updateScheduleOptions(app);
  renderQuestions(app);
}

export function handleScheduleChange(app, event) {
  const select = event?.target;
  if (!(select instanceof HTMLSelectElement)) return;
  const value = select.value || "";
  app.state.currentSchedule = value;
  if (app.state.currentSubTab === "normal") {
    app.state.lastNormalSchedule = value;
  }
  updateScheduleRangeDisplay(app);
  renderQuestions(app);
}

export async function handleDisplay(app) {
  if (!app.state.displaySessionActive) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!app.state.selectedRowData || app.state.selectedRowData.isAnswered) return;
  const snapshot = await get(telopRef);
  const previousTelop = snapshot.val();
  const previousUid = previousTelop && typeof previousTelop.uid !== "undefined" ? String(previousTelop.uid || "") : "";
  try {
    const updates = {};
    if (previousUid) {
      updates[`questions/${previousUid}/selecting`] = false;
      updates[`questions/${previousUid}/answered`] = true;
    } else if (previousTelop) {
      const prev = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
      );
      if (prev) {
        updates[`questions/${prev.UID}/selecting`] = false;
        updates[`questions/${prev.UID}/answered`] = true;
      }
    }
    updates[`questions/${app.state.selectedRowData.uid}/selecting`] = true;
    updates[`questions/${app.state.selectedRowData.uid}/answered`] = false;
    await update(ref(database), updates);
    await set(telopRef, {
      uid: app.state.selectedRowData.uid,
      participantId: app.state.selectedRowData.participantId || "",
      name: app.state.selectedRowData.name,
      question: app.state.selectedRowData.question,
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
  update(ref(database, `questions/${app.state.selectedRowData.uid}`), { answered: false });
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
    updates[`questions/${uid}/answered`] = false;
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
  const snapshot = await get(telopRef);
  const previousTelop = snapshot.val();
  try {
    const updates = {};
    const selectingItems = app.state.allQuestions.filter((item) => item["選択中"] === true);
    selectingItems.forEach((item) => {
      updates[`questions/${item.UID}/selecting`] = false;
    });
    if (previousTelop) {
      const prevItem = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousTelop.name && q["質問・お悩み"] === previousTelop.question
      );
      if (prevItem) {
        updates[`questions/${prevItem.UID}/answered`] = true;
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

export function updateActionAvailability(app) {
  const active = !!app.state.displaySessionActive;
  const selection = app.state.selectedRowData;
  app.dom.actionButtons.forEach((button) => {
    if (button) button.disabled = true;
  });
  if (app.dom.clearButton) app.dom.clearButton.disabled = !active;
  if (!app.dom.selectedInfo) {
    updateBatchButtonVisibility(app);
    return;
  }
  if (!active) {
    app.dom.selectedInfo.textContent = "送出端末が接続されていません";
    updateBatchButtonVisibility(app);
    return;
  }
  if (!selection) {
    app.dom.selectedInfo.textContent = "行を選択してください";
    updateBatchButtonVisibility(app);
    return;
  }
  app.dom.actionButtons.forEach((button) => {
    if (button) button.disabled = false;
  });
  if (app.dom.actionButtons[0]) app.dom.actionButtons[0].disabled = !!selection.isAnswered;
  if (app.dom.actionButtons[1]) app.dom.actionButtons[1].disabled = !selection.isAnswered;
  const safeName = formatOperatorName(selection.name) || "—";
  app.dom.selectedInfo.textContent = `選択中: ${safeName}`;
  updateBatchButtonVisibility(app);
}

export function updateBatchButtonVisibility(app) {
  if (!app.dom.batchUnanswerBtn) return;
  const active = !!app.state.displaySessionActive;
  const checkedCount = active ? app.dom.cardsContainer?.querySelectorAll(".row-checkbox:checked").length || 0 : 0;
  app.dom.batchUnanswerBtn.style.display = active && checkedCount > 0 ? "inline-block" : "none";
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

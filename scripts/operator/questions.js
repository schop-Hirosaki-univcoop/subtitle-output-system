import { GENRE_OPTIONS } from "./constants.js";
import { database, ref, update, set, remove, get, telopRef } from "./firebase.js";
import { escapeHtml, formatOperatorName, resolveGenreLabel } from "./utils.js";

export function renderQuestions(app) {
  if (!app.dom.cardsContainer) return;
  const currentTab = app.state.currentSubTab;
  const viewingPuqTab = currentTab === "puq";
  const viewingNormalTab = currentTab === "normal";
  const selectedGenre = app.state.currentGenre || GENRE_OPTIONS[0];
  const selectedSchedule = viewingNormalTab ? app.state.currentSchedule || "" : "";
  let list = app.state.allQuestions.filter((item) => {
    const isPuq = item["ラジオネーム"] === "Pick Up Question";
    if (viewingPuqTab && !isPuq) {
      return false;
    }
    if (viewingNormalTab && isPuq) {
      return false;
    }
    const itemGenre = String(item["ジャンル"] ?? "").trim() || "その他";
    if (selectedGenre && itemGenre !== selectedGenre) return false;
    const itemSchedule = String(item["日程"] ?? "").trim();
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
    const isPuq = item["ラジオネーム"] === "Pick Up Question";
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
        participantId
      };
    }
    const rawName = item["ラジオネーム"];
    const displayName = formatOperatorName(rawName) || "—";
    const groupLabel = String(item["班番号"] ?? "").trim();
    const participantBadge = participantId
      ? `<span class="q-participant" role="text" aria-label="参加者ID ${escapeHtml(participantId)}">${escapeHtml(participantId)}</span>`
      : "";
    card.innerHTML = `
      <span class="status-text visually-hidden">${statusText}</span>
      <div class="q-corner">
        ${participantBadge}
        ${
          groupLabel
            ? `<span class="q-group" role="text" aria-label="班番号 ${escapeHtml(groupLabel)}">${escapeHtml(groupLabel)}</span>`
            : ""
        }
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
        participantId
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
  const isNormalTab = app.state.currentSubTab === "normal";
  const selectedGenre = app.state.currentGenre || GENRE_OPTIONS[0];
  const scheduleSet = new Set();
  if (isNormalTab) {
    for (const item of app.state.allQuestions) {
      const isPuq = item["ラジオネーム"] === "Pick Up Question";
      if (isPuq) continue;
      const itemGenre = String(item["ジャンル"] ?? "").trim() || "その他";
      if (selectedGenre && itemGenre !== selectedGenre) continue;
      const scheduleLabel = String(item["日程"] ?? "").trim();
      if (!scheduleLabel) continue;
      scheduleSet.add(scheduleLabel);
    }
  }
  const nextList = Array.from(scheduleSet).sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }));
  const prevList = app.state.availableSchedules || [];
  const changed = nextList.length !== prevList.length || nextList.some((value, index) => value !== prevList[index]);
  if (changed) {
    select.innerHTML = "";
    nextList.forEach((value) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
  }
  app.state.availableSchedules = nextList;
  let nextValue = "";
  if (isNormalTab && nextList.length > 0) {
    const { currentSchedule, lastNormalSchedule } = app.state;
    if (currentSchedule && nextList.includes(currentSchedule)) {
      nextValue = currentSchedule;
    } else if (lastNormalSchedule && nextList.includes(lastNormalSchedule)) {
      nextValue = lastNormalSchedule;
    } else {
      nextValue = nextList[0];
    }
  }
  select.value = nextValue;
  app.state.currentSchedule = nextValue;
  if (isNormalTab) {
    app.state.lastNormalSchedule = nextValue;
  }
  const shouldDisable = !isNormalTab || nextList.length === 0;
  select.disabled = shouldDisable;
  const wrapper = select.closest(".schedule-filter");
  if (wrapper) {
    wrapper.classList.toggle("is-disabled", shouldDisable);
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
      question: app.state.selectedRowData.question
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

export function handleUnanswer(app) {
  if (!app.state.displaySessionActive) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!app.state.selectedRowData || !app.state.selectedRowData.isAnswered) return;
  const displayLabel = formatOperatorName(app.state.selectedRowData.name) || app.state.selectedRowData.name;
  if (!confirm(`「${displayLabel}」の質問を「未回答」に戻しますか？`)) return;
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
  if (!confirm(`${checkedBoxes.length}件の質問を「未回答」に戻しますか？`)) return;
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

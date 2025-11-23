// questions.js: 質問キューの操作と選択ロジックを管理します。
import { QUESTIONS_SUBTAB_KEY, GENRE_ALL_VALUE } from "./constants.js";
import { database, ref, set, update, get, getNowShowingRef, serverTimestamp } from "./firebase.js";
import { info as logDisplayLinkInfo, warn as logDisplayLinkWarn, error as logDisplayLinkError } from "../shared/display-link-logger.js";
import { normalizeScheduleId } from "../shared/channel-paths.js";
import { escapeHtml, formatOperatorName, resolveGenreLabel, formatScheduleRange } from "./utils.js";

const SUB_TAB_OPTIONS = new Set(["all", "normal", "puq"]);
const PICK_UP_NAME_CANONICAL = "pick up question";
const DEFAULT_SIDE_TELOP = "まずは自己紹介です…";

function isPickUpQuestion(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  if (record["ピックアップ"] === true) {
    return true;
  }
  const radioName = String(record["ラジオネーム"] ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return radioName === PICK_UP_NAME_CANONICAL;
}

function getActiveSideTelopRight(app) {
  const entries = Array.isArray(app?.state?.sideTelopEntries) ? app.state.sideTelopEntries : [];
  const activeIndexRaw = Number.isInteger(app?.state?.sideTelopActiveIndex) ? app.state.sideTelopActiveIndex : 0;
  const boundedIndex = Math.min(Math.max(activeIndexRaw, 0), entries.length ? entries.length - 1 : 0);
  const active = entries[boundedIndex];
  const text = typeof active === "string" ? active.trim() : "";
  return text || DEFAULT_SIDE_TELOP;
}

function normalizeSubTab(value) {
  const candidate = String(value || "").trim();
  return SUB_TAB_OPTIONS.has(candidate) ? candidate : "all";
}

export function resolveNowShowingReference(app) {
  const hasChannelAccessor = app && typeof app.getActiveChannel === "function";
  const { eventId = "", scheduleId = "" } = hasChannelAccessor ? app.getActiveChannel() || {} : {};
  const normalizedSchedule = scheduleId ? normalizeScheduleId(scheduleId) : "";
  const refInstance = getNowShowingRef(eventId, scheduleId);
  return { ref: refInstance, eventId: eventId || "", scheduleId: normalizedSchedule };
}

async function ensureChannelAligned(app) {
  if (app.state.displayAssetChecked && app.state.displayAssetAvailable === false) {
    app.toast("表示端末ページ（display.html）が見つからないため送出できません。", "error");
    return false;
  }
  const hasMismatch = typeof app.hasChannelMismatch === "function" ? app.hasChannelMismatch() : false;
  if (!hasMismatch) {
    return true;
  }

  const showMismatchToast = () => {
    const summary = typeof app.describeChannelAssignment === "function" ? app.describeChannelAssignment() : "";
    const message = summary
      ? `ディスプレイは${summary}に固定されています。日程を合わせてから操作してください。`
      : "ディスプレイのチャンネルが未設定です。先に日程を固定してください。";
    app.toast(message, "error");
  };

  const hasChannelAccess =
    app && typeof app.getActiveChannel === "function" && typeof app.lockDisplayToSchedule === "function";
  if (!hasChannelAccess) {
    showMismatchToast();
    return false;
  }

  const { eventId, scheduleId } = app.getActiveChannel();
  const normalizedEvent = String(eventId || "").trim();
  const normalizedSchedule = normalizeScheduleId(scheduleId || "");
  if (!normalizedEvent || !normalizedSchedule) {
    showMismatchToast();
    return false;
  }

  const session = app?.state?.displaySession || null;
  const sessionAssignment = session && typeof session.assignment === "object" ? session.assignment : null;
  const sessionEvent = String(session?.eventId || sessionAssignment?.eventId || "").trim();
  const sessionSchedule = normalizeScheduleId(
    session?.scheduleId || sessionAssignment?.scheduleId || ""
  );
  if (sessionEvent && sessionSchedule && sessionEvent === normalizedEvent && sessionSchedule === normalizedSchedule) {
    const assignment =
      sessionAssignment || {
        eventId: sessionEvent,
        scheduleId: sessionSchedule,
        scheduleLabel: String(session?.scheduleLabel || "").trim(),
        scheduleKey: `${sessionEvent}::${sessionSchedule}`,
        canonicalScheduleKey: `${sessionEvent}::${sessionSchedule}`,
        canonicalScheduleId: sessionSchedule
      };
    if (typeof app.applyAssignmentLocally === "function") {
      app.applyAssignmentLocally(assignment);
    } else if (app?.state) {
      app.state.channelAssignment = assignment;
    }
    return true;
  }

  const scheduleKey = `${normalizedEvent}::${normalizedSchedule}`;
  let scheduleLabel = normalizedSchedule;
  if (typeof app.resolveScheduleLabel === "function") {
    scheduleLabel =
      app.resolveScheduleLabel(scheduleKey, app?.state?.activeScheduleLabel, normalizedSchedule) || scheduleLabel;
  } else if (typeof app?.state?.activeScheduleLabel === "string") {
    const candidate = app.state.activeScheduleLabel.trim();
    if (candidate) {
      scheduleLabel = candidate;
    }
  }

  try {
    const appliedAssignment = await app.lockDisplayToSchedule(normalizedEvent, normalizedSchedule, scheduleLabel, {
      silent: true
    });
    let resolved = typeof app.hasChannelMismatch === "function" ? !app.hasChannelMismatch() : true;
    if (!resolved && appliedAssignment && appliedAssignment.eventId) {
      resolved = true;
    }
    if (resolved) {
      return true;
    }
  } catch (error) {
    logDisplayLinkWarn("Failed to auto-align display schedule", error);
  }

  showMismatchToast();
  return false;
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
    // Ignore preference persistence issues.
  }
}

export function renderQuestions(app) {
  if (!app.dom.cardsContainer) return;
  const currentTab = app.state.currentSubTab;
  const viewingPuqTab = currentTab === "puq";
  const viewingNormalTab = currentTab === "normal";
  const selectedGenre = typeof app.state.currentGenre === "string" ? app.state.currentGenre.trim() : "";
  const viewingAllGenres = !selectedGenre || selectedGenre.toLowerCase() === GENRE_ALL_VALUE;
  let selectedSchedule = "";
  const context = app.pageContext || {};
  const scheduleCandidates = [
    app.state.currentSchedule,
    app.state.committedScheduleKey,
    app.state.conflictSelection,
    app.state.lastNormalSchedule,
    context.selectionConfirmed ? context.scheduleKey : ""
  ];
  for (const candidate of scheduleCandidates) {
    const trimmed = String(candidate || "").trim();
    if (trimmed) {
      selectedSchedule = trimmed;
      break;
    }
  }
  if (!selectedSchedule && typeof app.getCurrentScheduleKey === "function") {
    selectedSchedule = String(app.getCurrentScheduleKey() || "").trim();
  }
  if (viewingNormalTab) {
    console.info("[schedule-debug] logging enabled for normal tab", {
      currentTab,
      selectedSchedule,
      hasCardsContainer: Boolean(app?.dom?.cardsContainer)
    });
    const displaySession = app?.state?.displaySession || {};
    const assignment = displaySession && typeof displaySession === "object" ? displaySession.assignment : null;
    const displayEventId = String(displaySession?.eventId || assignment?.eventId || "").trim();
    const displayScheduleId = normalizeScheduleId(displaySession?.scheduleId || assignment?.scheduleId || "");
    const derivedDisplayKey = displayEventId && displayScheduleId ? `${displayEventId}::${displayScheduleId}` : "";
    const displayScheduleKey = String(assignment?.scheduleKey || derivedDisplayKey || "").trim();
    const displayScheduleLabel = String(
      assignment?.scheduleLabel || displaySession?.scheduleLabel || displaySession?.schedule || ""
    ).trim();

    const normalQuestions = app.state.allQuestions.filter((item) => !isPickUpQuestion(item));
    console.info("[schedule-debug] display schedule", {
      eventId: displayEventId,
      scheduleId: displayScheduleId,
      scheduleKey: displayScheduleKey,
      scheduleLabel: displayScheduleLabel
    });
    normalQuestions.forEach((item) => {
      const questionScheduleKey = String(item.__scheduleKey ?? item["日程"] ?? "").trim();
      const questionEventId = String(item["イベントID"] ?? "").trim();
      const questionScheduleId = String(item["日程ID"] ?? "").trim();
      const questionLabel = String(item.__scheduleLabel ?? item["日程示"] ?? "").trim();
      console.info("[schedule-debug] normal question", {
        uid: item.UID,
        eventId: questionEventId,
        scheduleId: questionScheduleId,
        scheduleKey: questionScheduleKey,
        scheduleLabel: questionLabel
      });
    });
  } else {
    console.info("[schedule-debug] logging skipped (not on normal tab)", {
      currentTab,
      hasCardsContainer: Boolean(app?.dom?.cardsContainer)
    });
  }
  // Pick Upタブではピックアップ質問のみを表示し、normalタブでは通常質問のみを表示する。
  // 「すべて」タブは両方を並べるが、normal質問には選択中の日程フィルターが適用される。
  let list = app.state.allQuestions.filter((item) => {
    const isPuq = isPickUpQuestion(item);
    if (viewingPuqTab && !isPuq) {
      return false;
    }
    if (viewingNormalTab && isPuq) {
      return false;
    }
    const itemGenre = String(item["ジャンル"] ?? "").trim() || "その他";
    if (!viewingAllGenres && itemGenre !== selectedGenre) return false;
    const itemSchedule = String(item.__scheduleKey ?? item["日程"] ?? "").trim();
    if (!isPuq && selectedSchedule && itemSchedule !== selectedSchedule) return false;
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
    const isPuq = isPickUpQuestion(item);
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

export function updateScheduleContext(app, options = {}) {
  const rangeEl = app.dom.scheduleTimeRange;
  const eventLabelEl = app.dom.scheduleEventName;
  const scheduleLabelEl = app.dom.scheduleLabel;
  const metadataMap = app.state.scheduleMetadata instanceof Map ? app.state.scheduleMetadata : null;
  const eventsMap = app.state.eventsById instanceof Map ? app.state.eventsById : null;
  const context = app.pageContext || {};
  const {
    syncPresence = true,
    presenceReason = "context-sync",
    presenceOptions = undefined,
    trackIntent = syncPresence,
    selectionConfirmed: selectionConfirmedOption
  } = typeof options === "object" && options !== null ? options : {};

  const ensure = (value) => String(value ?? "").trim();
  const contextSelectionConfirmed =
    typeof selectionConfirmedOption === "boolean"
      ? selectionConfirmedOption
      : context.selectionConfirmed === true;
  const contextEventId = contextSelectionConfirmed ? ensure(context.eventId) : "";
  const contextScheduleId = contextSelectionConfirmed ? ensure(context.scheduleId) : "";
  const contextScheduleKey = contextSelectionConfirmed ? ensure(context.scheduleKey) : "";
  let eventId = contextEventId;
  let scheduleId = contextScheduleId;
  let scheduleKey = contextSelectionConfirmed ? ensure(app.state.currentSchedule) : "";
  if (!scheduleKey && contextSelectionConfirmed) {
    scheduleKey = contextScheduleKey;
  }
  let assignmentLabel = "";
  const hadEventBeforeAssignment = Boolean(eventId);
  const hadScheduleBeforeAssignment = Boolean(scheduleId);
  const hadKeyBeforeAssignment = Boolean(scheduleKey);
  const contextProvidedExplicitSelection = Boolean(
    contextEventId || contextScheduleId || contextScheduleKey
  );
  let assignmentDerivedSelection = false;

  if (!scheduleKey && eventId && scheduleId) {
    scheduleKey = `${eventId}::${normalizeScheduleId(scheduleId)}`;
  }

  if (!eventId || !scheduleId || !scheduleKey) {
    const assignment =
      app?.state?.channelAssignment || (typeof app.getDisplayAssignment === "function" ? app.getDisplayAssignment() : null);
    const assignmentEvent = ensure(assignment?.eventId);
    const assignmentSchedule = ensure(assignment?.scheduleId);
    if (!eventId && assignmentEvent) {
      eventId = assignmentEvent;
    }
    if (!scheduleId && assignmentSchedule) {
      scheduleId = assignmentSchedule;
    }
    if (!scheduleKey && assignmentEvent && assignmentSchedule) {
      scheduleKey = `${assignmentEvent}::${normalizeScheduleId(assignmentSchedule)}`;
    }
    assignmentLabel = ensure(assignment?.scheduleLabel);
    assignmentDerivedSelection =
      Boolean(assignmentEvent && assignmentSchedule) &&
      !contextProvidedExplicitSelection &&
      !hadEventBeforeAssignment &&
      !hadScheduleBeforeAssignment &&
      !hadKeyBeforeAssignment;
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

  let eventName = contextSelectionConfirmed ? ensure(context.eventName) : "";
  if (meta?.eventName) {
    eventName = ensure(meta.eventName);
  } else if (!eventName && eventId && eventsMap) {
    eventName = ensure(eventsMap.get(eventId)?.name);
  }

  let scheduleLabel = contextSelectionConfirmed ? ensure(context.scheduleLabel) : "";
  if (!scheduleLabel && assignmentLabel) {
    scheduleLabel = assignmentLabel;
  }
  if (meta?.label) {
    scheduleLabel = ensure(meta.label);
  }

  const startValue =
    meta?.startAt ||
    (contextSelectionConfirmed ? context.startAt || context.scheduleStart : "") ||
    "";
  const endValue =
    meta?.endAt ||
    (contextSelectionConfirmed ? context.endAt || context.scheduleEnd : "") ||
    "";
  let startText = ensure(startValue);
  let endText = ensure(endValue);

  const applySelection = Boolean(scheduleKey) || !assignmentDerivedSelection;

  if (!applySelection) {
    scheduleKey = "";
    eventId = "";
    scheduleId = "";
    eventName = "";
    scheduleLabel = "";
    startText = "";
    endText = "";
  }

  if (scheduleKey) {
    app.state.currentSchedule = scheduleKey;
    app.state.lastNormalSchedule = scheduleKey;
  } else if (!applySelection) {
    app.state.currentSchedule = "";
    app.state.lastNormalSchedule = "";
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

  const nextSelectionConfirmed =
    applySelection && eventId && scheduleId
      ? typeof selectionConfirmedOption === "boolean"
        ? selectionConfirmedOption
        : contextSelectionConfirmed && !assignmentDerivedSelection
      : false;

  app.pageContext = {
    ...context,
    eventId,
    scheduleId,
    eventName,
    scheduleLabel,
    startAt: startText,
    endAt: endText,
    scheduleKey: scheduleKey || "",
    selectionConfirmed: nextSelectionConfirmed
  };

  if (app.state) {
    app.state.selectionConfirmed = nextSelectionConfirmed;
  }

  if (trackIntent && typeof app?.markOperatorPresenceIntent === "function") {
    if (eventId && scheduleId) {
      app.markOperatorPresenceIntent(eventId, scheduleId, scheduleLabel);
    } else if (typeof app?.clearOperatorPresenceIntent === "function") {
      app.clearOperatorPresenceIntent();
    }
  }

  if (typeof app.refreshOperatorPresenceSubscription === "function") {
    app.refreshOperatorPresenceSubscription();
  }
  if (syncPresence && typeof app.syncOperatorPresence === "function") {
    app.syncOperatorPresence(presenceReason, presenceOptions);
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
  updateScheduleContext(app, { syncPresence: false });
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
  updateScheduleContext(app, { syncPresence: false });
  if (typeof app.refreshChannelSubscriptions === "function") {
    app.refreshChannelSubscriptions();
  }
  renderQuestions(app);
}

export async function handleDisplay(app) {
  const renderOnline = app.state.renderChannelOnline !== false;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.displaySessionActive;
  if (!renderOnline) {
    app.toast("送出端末の表示画面が切断されています。", "error");
    return;
  }
  if (!displayOnline) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!(await ensureChannelAligned(app))) {
    return;
  }
  if (!app.state.selectedRowData || app.state.selectedRowData.isAnswered) return;
  const { ref: nowShowingRef, eventId, scheduleId } = resolveNowShowingReference(app);
  if (!eventId || !scheduleId) {
    app.toast("イベントまたは日程が割り当てられていないため送出できません。", "error");
    return;
  }
  const snapshot = await get(nowShowingRef);
  const previousNowShowing = snapshot.val();
  const previousUid =
    previousNowShowing && typeof previousNowShowing.uid !== "undefined" ? String(previousNowShowing.uid || "") : "";
  try {
    const updates = {};
    if (previousUid) {
      updates[`questionStatus/${previousUid}/selecting`] = false;
      updates[`questionStatus/${previousUid}/answered`] = true;
      updates[`questionStatus/${previousUid}/updatedAt`] = serverTimestamp();
    } else if (previousNowShowing) {
      const prev = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousNowShowing.name && q["質問・お悩み"] === previousNowShowing.question
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
    logDisplayLinkInfo("Sending nowShowing payload", {
      eventId,
      scheduleId,
      uid: app.state.selectedRowData.uid,
      participantId: app.state.selectedRowData.participantId || "",
      name: app.state.selectedRowData.name
    });
    await update(nowShowingRef, {
      uid: app.state.selectedRowData.uid,
      participantId: app.state.selectedRowData.participantId || "",
      name: app.state.selectedRowData.name,
      question: app.state.selectedRowData.question,
      genre,
      pickup: app.state.selectedRowData.isPickup === true,
      sideTelopRight: getActiveSideTelopRight(app)
    });
    logDisplayLinkInfo("Display nowShowing updated", {
      eventId,
      scheduleId,
      uid: app.state.selectedRowData.uid
    });
    app.api.fireAndForgetApi({ action: "updateSelectingStatus", uid: app.state.selectedRowData.uid });
    if (previousUid) {
      app.api.fireAndForgetApi({ action: "updateStatus", uid: previousUid, status: true });
    } else if (previousNowShowing) {
      const prev = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousNowShowing.name && q["質問・お悩み"] === previousNowShowing.question
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
    logDisplayLinkError("Failed to send nowShowing payload", error);
    app.toast("送出処理中にエラーが発生しました: " + error.message, "error");
  }
}

export async function handleUnanswer(app) {
  const renderOnline = app.state.renderChannelOnline !== false;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.displaySessionActive;
  if (!renderOnline) {
    app.toast("送出端末の表示画面が切断されています。", "error");
    return;
  }
  if (!displayOnline) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!(await ensureChannelAligned(app))) {
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
  try {
    await update(ref(database, `questionStatus/${uid}`), { answered: false, updatedAt: serverTimestamp() });
    app.api.fireAndForgetApi({ action: "updateStatus", uid: app.state.selectedRowData.uid, status: false });
    app.api.logAction("UNANSWER", `UID: ${uid}, RN: ${displayLabel}`);
  } catch (error) {
    console.error("Failed to revert question to unanswered", error);
    app.toast("未回答への戻し中にエラーが発生しました。", "error");
  }
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
  updateActionAvailability(app);
}

export async function handleBatchUnanswer(app) {
  const renderOnline = app.state.renderChannelOnline !== false;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.displaySessionActive;
  if (!renderOnline) {
    app.toast("送出端末の表示画面が切断されています。", "error");
    return;
  }
  if (!displayOnline) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!(await ensureChannelAligned(app))) {
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
    if (uidsToUpdate.length) {
      app.api.logAction("BATCH_UNANSWER", `Count: ${uidsToUpdate.length}`);
    }
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
    app.toast("未回答への戻し中にエラーが発生しました。", "error");
  }
}

export async function clearNowShowing(app) {
  const renderOnline = app.state.renderChannelOnline !== false;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.displaySessionActive;
  if (!renderOnline) {
    app.toast("送出端末の表示画面が切断されています。", "error");
    return;
  }
  if (!displayOnline) {
    app.toast("送出端末が接続されていません。", "error");
    return;
  }
  if (!(await ensureChannelAligned(app))) {
    return;
  }
  const { ref: nowShowingRef, eventId, scheduleId } = resolveNowShowingReference(app);
  if (!eventId || !scheduleId) {
    app.toast("イベントまたは日程が割り当てられていないため送出をクリアできません。", "error");
    return;
  }
  const snapshot = await get(nowShowingRef);
  const previousNowShowing = snapshot.val();
  try {
    logDisplayLinkInfo("Clearing nowShowing payload", { eventId, scheduleId });
    const updates = {};
    const selectingItems = app.state.allQuestions.filter((item) => item["選択中"] === true);
    selectingItems.forEach((item) => {
      updates[`questionStatus/${item.UID}/selecting`] = false;
      updates[`questionStatus/${item.UID}/updatedAt`] = serverTimestamp();
    });
    if (previousNowShowing) {
      const prevItem = app.state.allQuestions.find(
        (q) => q["ラジオネーム"] === previousNowShowing.name && q["質問・お悩み"] === previousNowShowing.question
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
    const sideTelopRight = getActiveSideTelopRight(app);
    await set(nowShowingRef, {
      uid: "",
      participantId: "",
      name: "",
      question: "",
      genre: "",
      pickup: false,
      ...(sideTelopRight ? { sideTelopRight } : {})
    });
    logDisplayLinkInfo("Display nowShowing cleared", { eventId, scheduleId, sideTelopRight });
    app.api.fireAndForgetApi({ action: "clearSelectingStatus" });
    app.api.logAction("CLEAR");
    app.toast("送出をクリアしました。", "success");
  } catch (error) {
    logDisplayLinkError("Failed to clear nowShowing payload", error);
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

function readActionButtonState(button) {
  if (!button) {
    return null;
  }
  const text = typeof button.textContent === "string" ? button.textContent.trim() : "";
  return {
    id: button.id || "",
    text,
    disabled: button.disabled === true,
    mode: button.dataset?.mode || "",
    hidden: Boolean(button.hidden)
  };
}

function readButtonSummary(state) {
  if (!state) {
    return "";
  }
  const parts = [];
  const name = state.id || state.text || "(unnamed)";
  parts.push(name);
  parts.push(state.disabled ? "disabled" : "enabled");
  if (state.hidden) {
    parts.push("hidden");
  }
  if (state.mode) {
    parts.push(`mode=${state.mode}`);
  }
  return parts.join(" ");
}

function buildActionPanelDebug(app, base = {}) {
  const getText = (node) => (node && typeof node.textContent === "string" ? node.textContent.trim() : "");
  const actionButtons = Array.isArray(app.dom.actionButtons)
    ? app.dom.actionButtons.map((button) => readActionButtonState(button)).filter(Boolean)
    : [];
  const clearButton = readActionButtonState(app.dom.clearButton);
  const batchButton = readActionButtonState(app.dom.batchUnanswerBtn);
  return {
    ...base,
    panelMode: app.dom.actionPanel ? String(app.dom.actionPanel.dataset.selection || "").trim() : "",
    selectedInfoText: getText(app.dom.selectedInfo),
    selectedInfoPresent: Boolean(app.dom.selectedInfo),
    actionButtons,
    clearButton,
    batchUnanswerButton: batchButton
  };
}

function summarizeActionPanelDebug(debug) {
  const reason = debug.reason || "";
  const mode = debug.mode || debug.panelMode || "";
  const summaryParts = [];
  if (reason) summaryParts.push(`reason=${reason}`);
  if (mode) summaryParts.push(`mode=${mode}`);
  summaryParts.push(`displayOnline=${debug.displayOnline}`);
  summaryParts.push(`sessionActive=${debug.sessionActive}`);
  summaryParts.push(`channelAligned=${debug.channelAligned}`);
  summaryParts.push(`telopEnabled=${debug.telopEnabled}`);
  summaryParts.push(`assetAvailable=${debug.assetAvailable}`);
  summaryParts.push(`selection=${debug.selectionUid || "(none)"}`);
  summaryParts.push(`checked=${debug.checkedCount || 0}`);
  const buttonSummaries = Array.isArray(debug.actionButtons)
    ? debug.actionButtons.map((button) => readButtonSummary(button)).join(", ")
    : "";
  if (buttonSummaries) {
    summaryParts.push(`buttons=[${buttonSummaries}]`);
  }
  const clearSummary = readButtonSummary(debug.clearButton);
  if (clearSummary) {
    summaryParts.push(`clear=${clearSummary}`);
  }
  const batchSummary = readButtonSummary(debug.batchUnanswerButton);
  if (batchSummary) {
    summaryParts.push(`batch=${batchSummary}`);
  }
  return {
    message: summaryParts.join(" "),
    details: {
      selectedInfoText: debug.selectedInfoText,
      actionButtons: debug.actionButtons,
      clearButton: debug.clearButton,
      batchUnanswerButton: debug.batchUnanswerButton
    }
  };
}

export function updateActionAvailability(app) {
  const renderOnline = app.state.renderChannelOnline !== false;
  const sessionActive = !!app.state.displaySessionActive;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : sessionActive;
  const assetChecked = app.state.displayAssetChecked === true;
  const assetAvailable = app.state.displayAssetAvailable !== false;
  const selection = app.state.selectedRowData;
  const checkedCount = getBatchSelectionCount(app);
  const hasBatchSelection = displayOnline && checkedCount > 0;
  const channelAligned = typeof app.hasChannelMismatch === "function" ? !app.hasChannelMismatch() : true;
  const telopEnabled = typeof app.isTelopEnabled === "function" ? app.isTelopEnabled() : true;
  const mode =
    !assetAvailable && assetChecked
      ? "inactive"
      : !displayOnline || !telopEnabled
        ? "inactive"
        : hasBatchSelection
          ? "multi"
          : selection
            ? "single"
            : "idle";

  setActionPanelMode(app, mode);

  const debugBase = {
    renderOnline,
    sessionActive,
    displayOnline,
    assetChecked,
    assetAvailable,
    channelAligned,
    telopEnabled,
    hasSelection: Boolean(selection),
    hasBatchSelection,
    checkedCount,
    mode,
    selectionUid: selection ? String(selection.uid || "").trim() : "",
    selectionIsAnswered: Boolean(selection?.isAnswered),
    selectionConfirmed: app.state?.selectionConfirmed === true
  };
  const logAvailability = (reason, extra = {}) => {
    const payload = { ...debugBase, reason, ...extra };
    const panelDebug = buildActionPanelDebug(app, payload);
    if (typeof app.logScheduleDebug === "function") {
      app.logScheduleDebug("updateActionAvailability", panelDebug);
    }
    if (typeof console !== "undefined" && typeof console.log === "function") {
      const { message, details } = summarizeActionPanelDebug(panelDebug);
      console.log(`[Operator] action-availability ${message}`, details);
    }
  };

  app.dom.actionButtons.forEach((button) => {
    if (button) button.disabled = true;
  });
  if (app.dom.clearButton) {
    const canClear = assetAvailable && telopEnabled && displayOnline;
    app.dom.clearButton.disabled = !canClear;
  }
  if (!app.dom.selectedInfo) {
    updateBatchButtonVisibility(app, checkedCount);
    logAvailability("missing-selected-info");
    return;
  }
  if (assetChecked && !assetAvailable) {
    app.dom.selectedInfo.textContent = "表示端末ページ（display.html）が見つかりません";
    updateBatchButtonVisibility(app, 0);
    logAvailability("asset-unavailable", { effectiveCheckedCount: 0 });
    return;
  }
  if (!telopEnabled) {
    app.dom.selectedInfo.textContent = "テロップ操作なしモードです";
    updateBatchButtonVisibility(app, 0);
    logAvailability("telop-disabled", { effectiveCheckedCount: 0 });
    return;
  }
  if (!renderOnline) {
    app.dom.selectedInfo.textContent = "送出端末の表示画面が切断されています";
    updateBatchButtonVisibility(app, 0);
    logAvailability("render-offline", { effectiveCheckedCount: 0 });
    return;
  }
  if (!sessionActive) {
    app.dom.selectedInfo.textContent = "送出端末が接続されていません";
    updateBatchButtonVisibility(app, checkedCount);
    logAvailability("display-session-inactive");
    return;
  }
  if (!channelAligned) {
    const summary = typeof app.describeChannelAssignment === "function" ? app.describeChannelAssignment() : "";
    app.dom.selectedInfo.textContent = summary
      ? `ディスプレイは${summary}に固定されています。`
      : "ディスプレイの日程が未確定です";
    updateBatchButtonVisibility(app, 0);
    logAvailability("channel-mismatch", { assignmentSummary: summary, effectiveCheckedCount: 0 });
    return;
  }
  if (hasBatchSelection) {
    app.dom.selectedInfo.textContent = `${checkedCount}件の質問を選択中`;
    updateBatchButtonVisibility(app, checkedCount);
    logAvailability("batch-selection", { effectiveCheckedCount: checkedCount });
    return;
  }
  if (!selection) {
    app.dom.selectedInfo.textContent = "行を選択してください";
    updateBatchButtonVisibility(app, checkedCount);
    logAvailability("no-selection");
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
  logAvailability("ready-single-selection", { effectiveCheckedCount: checkedCount });
}

export function updateBatchButtonVisibility(app, providedCount) {
  if (!app.dom.batchUnanswerBtn) return;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.displaySessionActive;
  const telopEnabled = typeof app.isTelopEnabled === "function" ? app.isTelopEnabled() : true;
  const assetAvailable = app.state.displayAssetAvailable !== false;
  const assetChecked = app.state.displayAssetChecked === true;
  const checkedCount = displayOnline ? providedCount ?? getBatchSelectionCount(app) : 0;
  const disabled = assetChecked && !assetAvailable;
  app.dom.batchUnanswerBtn.disabled = disabled || !displayOnline || !telopEnabled || checkedCount === 0;
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

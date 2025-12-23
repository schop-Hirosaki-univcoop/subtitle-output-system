// questions.js: 質問キューの操作と選択ロジックを管理します。
import { QUESTIONS_SUBTAB_KEY, GENRE_ALL_VALUE } from "./constants.js";
import { database, ref, update, get, getNowShowingRef, serverTimestamp, getQuestionStatusRef } from "./firebase.js";
import { info as logDisplayLinkInfo, warn as logDisplayLinkWarn, error as logDisplayLinkError } from "../shared/display-link-logger.js";
import { normalizeScheduleId, getQuestionStatusPath } from "../shared/channel-paths.js";
import { escapeHtml, formatOperatorName, resolveGenreLabel, formatScheduleRange } from "./utils.js";

const SUB_TAB_OPTIONS = new Set(["all", "normal", "puq"]);
const PICK_UP_NAME_CANONICAL = "pick up question";
const DEFAULT_SIDE_TELOP = "まずは自己紹介です…";

// ローディング中のUIDを追跡するSet
const loadingUids = new Set();
// ローディング開始時の状態を記録（更新前の状態を保持）
const loadingUidStates = new Map();

// Vueコンポーネントからアクセスできるようにエクスポート
export { loadingUids, loadingUidStates };

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
  if (app.state.isDisplayAssetChecked && app.state.displayAssetAvailable === false) {
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
  let scheduleKey;
  if (sessionEvent && sessionSchedule && sessionEvent === normalizedEvent && sessionSchedule === normalizedSchedule) {
    // 完全正規化: scheduleLabelは参照先から取得
    scheduleKey = `${sessionEvent}::${sessionSchedule}`;
    const scheduleLabel = typeof app.resolveScheduleLabel === "function"
      ? app.resolveScheduleLabel(scheduleKey, session?.scheduleLabel, sessionSchedule) || sessionSchedule
      : String(session?.scheduleLabel || sessionSchedule || "").trim();
    const assignment =
      sessionAssignment || {
        eventId: sessionEvent,
        scheduleId: sessionSchedule,
        scheduleLabel,
        scheduleKey,
        canonicalScheduleKey: scheduleKey,
        canonicalScheduleId: sessionSchedule
      };
    if (typeof app.applyAssignmentLocally === "function") {
      app.applyAssignmentLocally(assignment);
    } else if (app?.state) {
      app.state.channelAssignment = assignment;
    }
    return true;
  }

  scheduleKey = `${normalizedEvent}::${normalizedSchedule}`;
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

export function resolveNormalScheduleKey(app) {
  if (!app || typeof app !== "object") return "";
  let selectedSchedule = "";
  const context = app.pageContext || {};
  const scheduleCandidates = [
    app?.state?.currentSchedule,
    app?.state?.committedScheduleKey,
    app?.state?.conflictSelection,
    app?.state?.lastNormalSchedule,
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
  return selectedSchedule;
}

export function renderQuestions(app) {
  if (!app.dom.cardsContainer) return;
  const currentTab = app.state.currentSubTab;
  const viewingPuqTab = currentTab === "puq";
  const viewingNormalTab = currentTab === "normal";
  const selectedGenre = typeof app.state.currentGenre === "string" ? app.state.currentGenre.trim() : "";
  const viewingAllGenres = !selectedGenre || selectedGenre.toLowerCase() === GENRE_ALL_VALUE;
  let selectedSchedule = resolveNormalScheduleKey(app);
  
  // テロップ操作パネルの日程情報を取得（通常タブと「すべて」タブの両方で使用）
  const displaySession = app?.state?.displaySession || {};
  const assignment = displaySession && typeof displaySession === "object" ? displaySession.assignment : null;
  const displayEventId = String(displaySession?.eventId || assignment?.eventId || "").trim();
  const displayScheduleId = normalizeScheduleId(displaySession?.scheduleId || assignment?.scheduleId || "");
  const derivedDisplayKey = displayEventId && displayScheduleId ? `${displayEventId}::${displayScheduleId}` : "";
  const displayScheduleKey = String(assignment?.scheduleKey || derivedDisplayKey || "").trim();
  // テロップ操作パネルの日程情報を優先的に使用
  if (displayScheduleKey) {
    selectedSchedule = displayScheduleKey;
  }
  
  if (viewingNormalTab) {
    /* console.info("[schedule-debug] logging enabled for normal tab", {
      currentTab,
      selectedSchedule,
      hasCardsContainer: Boolean(app?.dom?.cardsContainer)
    }); */
    // 完全正規化: scheduleLabelは参照先から取得（既存データとの互換性のため、assignment/sessionから直接取得をフォールバックとして使用）
    const fallbackScheduleLabel = String(
      assignment?.scheduleLabel || displaySession?.scheduleLabel || displaySession?.schedule || ""
    ).trim();
    const displayScheduleLabel = displayScheduleKey && typeof app.resolveScheduleLabel === "function"
      ? app.resolveScheduleLabel(displayScheduleKey, fallbackScheduleLabel, displayScheduleId) || fallbackScheduleLabel || displayScheduleId
      : fallbackScheduleLabel || displayScheduleId;

    const normalQuestions = app.state.allQuestions.filter((item) => !isPickUpQuestion(item));
    /* console.info("[schedule-debug] display schedule", {
      eventId: displayEventId,
      scheduleId: displayScheduleId,
      scheduleKey: displayScheduleKey,
      scheduleLabel: displayScheduleLabel
    }); */
    normalQuestions.forEach((item) => {
      const questionScheduleKey = String(item.__scheduleKey ?? item["日程"] ?? "").trim();
      const questionEventId = String(item["イベントID"] ?? "").trim();
      const questionScheduleId = String(item["日程ID"] ?? "").trim();
      const questionLabel = String(item.__scheduleLabel ?? item["日程示"] ?? "").trim();
      /* console.info("[schedule-debug] normal question", {
        uid: item.UID,
        eventId: questionEventId,
        scheduleId: questionScheduleId,
        scheduleKey: questionScheduleKey,
        scheduleLabel: questionLabel
      }); */
    });
  } else {
    /* console.info("[schedule-debug] logging skipped (not on normal tab)", {
      currentTab,
      hasCardsContainer: Boolean(app?.dom?.cardsContainer)
    }); */
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

  // ローディング中のUIDについて、更新が反映されたか確認
  // （Firebaseリスナーが新しいデータを拾った時にローディング状態を解除）
  loadingUids.forEach((uid) => {
    const question = list.find((q) => String(q.UID) === uid);
    const loadingState = loadingUidStates.get(uid);
    if (question && loadingState) {
      // 更新が反映されたか確認
      // 未回答に戻す場合は、previousAnsweredがtrueで、現在answeredがfalseになっていることを確認
      if (loadingState.expectedAnswered === false && 
          loadingState.previousAnswered === true && 
          !question["回答済"]) {
        // 更新が反映された
        loadingUids.delete(uid);
        loadingUidStates.delete(uid);
      }
    }
  });

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
    // ローディング状態を適用
    if (loadingUids.has(uid)) {
      const loadingState = loadingUidStates.get(uid);
      // ローディング開始時の状態を確認
      // 未回答に戻す場合は、answeredがtrueからfalseに変わることを期待
      // 古いデータ（answeredがまだtrue）が来た場合は、ローディング状態を維持
      if (loadingState && loadingState.expectedAnswered === false) {
        // 更新が反映されたか確認（answeredがfalseになった）
        if (!item["回答済"]) {
          // 更新が反映されたので、次回のrenderQuestionsでローディング状態を解除
          // ここではまだ解除せず、ローディング状態を維持
        } else {
          // まだ古いデータなので、ローディング状態を維持
        }
      }
      card.classList.add("is-loading");
      const existingSpinner = card.querySelector(".q-loading-spinner");
      if (!existingSpinner) {
        const spinner = document.createElement("div");
        spinner.className = "q-loading-spinner";
        spinner.setAttribute("aria-label", "更新中");
        card.appendChild(spinner);
      }
    }
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
  const context = app.pageContext || {};
  const rangeEl = app.dom.scheduleTimeRange;
  const eventLabelEl = app.dom.scheduleEventName;
  const scheduleLabelEl = app.dom.scheduleLabel;
  const metadataMap = app.state.scheduleMetadata instanceof Map ? app.state.scheduleMetadata : null;
  const eventsMap = app.state.eventsById instanceof Map ? app.state.eventsById : null;
  const {
    syncPresence = true,
    presenceReason = "context-sync",
    presenceOptions = undefined,
    trackIntent = syncPresence,
    selectionConfirmed: selectionConfirmedOption,
    force = false
  } = typeof options === "object" && options !== null ? options : {};

  const ensureString = (value) => String(value ?? "").trim();
  const contextSelectionConfirmed =
    typeof selectionConfirmedOption === "boolean"
      ? selectionConfirmedOption
      : context.selectionConfirmed === true;
  // contextSelectionConfirmedがfalseでも、pageContextにeventIdやscheduleIdがある場合は使用する
  // （lockDisplayToScheduleでpageContextを更新した後に、別の処理でupdateScheduleContextが呼ばれる場合に対応）
  const contextEventId = ensureString(context.eventId);
  const contextScheduleId = ensureString(context.scheduleId);
  const contextScheduleKey = ensureString(context.scheduleKey);
  
  // デバッグログ: contextの値を確認
  if (typeof console !== "undefined" && typeof console.log === "function") {
    console.log("[updateScheduleContext] Context values", {
      contextEventId: contextEventId || "(empty)",
      contextScheduleId: contextScheduleId || "(empty)",
      contextScheduleKey: contextScheduleKey || "(empty)",
      contextSelectionConfirmed,
      selectionConfirmedOption
    });
  }
  
  let eventId = contextEventId;
  let scheduleId = contextScheduleId;
  let scheduleKey = contextSelectionConfirmed ? ensureString(app.state.currentSchedule) : "";
  if (!scheduleKey && contextSelectionConfirmed) {
    scheduleKey = contextScheduleKey;
  }
  // contextSelectionConfirmedがfalseでも、contextScheduleKeyがある場合は使用
  if (!scheduleKey && contextScheduleKey) {
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
    // activeEventIdが空の場合は、getDisplayAssignment()を呼ばずにnullにする
    // これにより、イベントを選んでいない状態で古いassignmentが評価されることを防ぐ
    const activeEventId = String(app?.state?.activeEventId || "").trim();
    const assignment = activeEventId
      ? (app?.state?.channelAssignment || (typeof app.getDisplayAssignment === "function" ? app.getDisplayAssignment() : null))
      : null;
    const assignmentEvent = ensureString(assignment?.eventId);
    const assignmentSchedule = ensureString(assignment?.scheduleId);
    if (!eventId && assignmentEvent) {
      eventId = assignmentEvent;
    }
    if (!scheduleId && assignmentSchedule) {
      scheduleId = assignmentSchedule;
    }
    if (!scheduleKey && assignmentEvent && assignmentSchedule) {
      scheduleKey = `${assignmentEvent}::${normalizeScheduleId(assignmentSchedule)}`;
    }
    // 完全正規化: scheduleLabelは参照先から取得（既存データとの互換性のため、assignmentから直接取得をフォールバックとして使用）
    const fallbackAssignmentLabel = ensureString(assignment?.scheduleLabel);
    assignmentLabel = scheduleKey && typeof app.resolveScheduleLabel === "function"
      ? app.resolveScheduleLabel(scheduleKey, fallbackAssignmentLabel, assignmentSchedule) || fallbackAssignmentLabel || assignmentSchedule
      : fallbackAssignmentLabel || assignmentSchedule;
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
    eventId = ensureString(meta.eventId) || eventId;
    scheduleId = ensureString(meta.scheduleId) || scheduleId;
  }

  if (scheduleKey && (!eventId || !scheduleId)) {
    const [eventPart, schedulePart] = scheduleKey.split("::");
    if (!eventId && eventPart) eventId = ensureString(eventPart);
    if (!scheduleId && schedulePart) scheduleId = ensureString(schedulePart);
  }

  let eventName = contextSelectionConfirmed ? ensureString(context.eventName) : "";
  if (meta?.eventName) {
    eventName = ensureString(meta.eventName);
  } else if (!eventName && eventId && eventsMap) {
    eventName = ensureString(eventsMap.get(eventId)?.name);
  }

  let scheduleLabel = contextSelectionConfirmed ? ensureString(context.scheduleLabel) : "";
  if (!scheduleLabel && assignmentLabel) {
    scheduleLabel = assignmentLabel;
  }
  if (meta?.label) {
    scheduleLabel = ensureString(meta.label);
  }

  const startValue =
    meta?.startAt ||
    (contextSelectionConfirmed ? context.startAt || context.scheduleStart : "") ||
    "";
  const endValue =
    meta?.endAt ||
    (contextSelectionConfirmed ? context.endAt || context.scheduleEnd : "") ||
    "";
  let startText = ensureString(startValue);
  let endText = ensureString(endValue);

  // selectionConfirmedがfalseの場合、assignmentDerivedSelectionによる自動選択を適用しない
  // これにより、初期状態で何も選択されていない状態を維持できる
  const shouldApplyAssignmentSelection = assignmentDerivedSelection && contextSelectionConfirmed;
  const applySelection = Boolean(scheduleKey) || !shouldApplyAssignmentSelection;

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
  
  // デバッグログ: activeEventIdの設定を確認
  if (typeof console !== "undefined" && typeof console.log === "function") {
    console.log("[Operator] updateScheduleContext: Setting activeEventId", {
      eventId: eventId || "(empty)",
      scheduleId: scheduleId || "(empty)",
      activeEventId: app.state.activeEventId || "(empty)",
      activeScheduleId: app.state.activeScheduleId || "(empty)"
    });
  }

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

  // 選択確定状態: applySelectionがtrueでeventIdとscheduleIdが存在し、
  // selectionConfirmedOptionが明示的に指定されている場合はそれを使用、
  // そうでない場合はcontextSelectionConfirmedまたはeventId/scheduleIdが存在することで判定
  const nextSelectionConfirmed =
    applySelection && eventId && scheduleId
      ? typeof selectionConfirmedOption === "boolean"
        ? selectionConfirmedOption
        : contextSelectionConfirmed || (!assignmentDerivedSelection && Boolean(contextEventId || contextScheduleId))
      : false;
  
  // デバッグログ: 選択状態を確認
  if (typeof console !== "undefined" && typeof console.log === "function") {
    console.log("[updateScheduleContext] Selection state", {
      nextSelectionConfirmed,
      eventId: eventId || "(empty)",
      scheduleId: scheduleId || "(empty)",
      applySelection,
      contextSelectionConfirmed,
      assignmentDerivedSelection,
      selectionConfirmedOption
    });
  }

  // コンテキストが実際に変更されるかどうかをチェック（forceオプションが指定されている場合はスキップ）
  let shouldSkipUpdate = false;
  if (!force) {
    const currentEventId = ensureString(context.eventId);
    const currentScheduleId = ensureString(context.scheduleId);
    const currentScheduleKey = ensureString(context.scheduleKey);
    const currentEventName = ensureString(context.eventName);
    const currentScheduleLabel = ensureString(context.scheduleLabel);
    const currentStartAt = ensureString(context.startAt);
    const currentEndAt = ensureString(context.endAt);
    const currentSelectionConfirmed = context.selectionConfirmed === true;

    const eventIdChanged = currentEventId !== eventId;
    const scheduleIdChanged = currentScheduleId !== scheduleId;
    const scheduleKeyChanged = currentScheduleKey !== scheduleKey;
    const eventNameChanged = currentEventName !== eventName;
    const scheduleLabelChanged = currentScheduleLabel !== scheduleLabel;
    const startAtChanged = currentStartAt !== startText;
    const endAtChanged = currentEndAt !== endText;
    const selectionConfirmedChanged = currentSelectionConfirmed !== nextSelectionConfirmed;

    const hasChanges = eventIdChanged || scheduleIdChanged || scheduleKeyChanged ||
      eventNameChanged || scheduleLabelChanged || startAtChanged || endAtChanged || selectionConfirmedChanged;

    // コンテキストに変更がなく、かつ明示的なオプション（syncPresence、trackIntent、selectionConfirmedOption）が指定されていない場合、更新をスキップ
    // ただし、syncPresenceやtrackIntentが明示的にtrueの場合は、それらの処理は実行する必要があるため、スキップしない
    shouldSkipUpdate = !hasChanges && 
      syncPresence === false && 
      trackIntent === false && 
      typeof selectionConfirmedOption === "undefined";
  }

  // 更新をスキップする場合、早期リターン
  if (shouldSkipUpdate) {
    return;
  }

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

  // イベント・日程が選択確定されたときに、自動的にディスプレイのassignmentを設定
  // ただし、assignmentDerivedSelectionがtrueの場合は既にassignmentから取得した情報なので、自動設定をスキップ
  if (nextSelectionConfirmed && eventId && scheduleId && !assignmentDerivedSelection) {
    const currentAssignment = app?.state?.channelAssignment || (typeof app.getDisplayAssignment === "function" ? app.getDisplayAssignment() : null);
    const assignmentEventId = String(currentAssignment?.eventId || "").trim();
    const assignmentScheduleId = String(currentAssignment?.scheduleId || "").trim();
    const normalizedScheduleId = normalizeScheduleId(scheduleId);
    
    // 現在のassignmentと一致しない場合、またはassignmentが存在しない場合に自動設定
    if (!currentAssignment || assignmentEventId !== eventId || assignmentScheduleId !== normalizedScheduleId) {
      // ディスプレイが接続されている場合のみ自動設定
      const displayActive = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : false;
      if (displayActive && typeof app.lockDisplayToSchedule === "function") {
        // デバッグ用ログ
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[DisplaySchedule] Auto-locking display schedule", {
            eventId,
            scheduleId: normalizedScheduleId,
            scheduleLabel: scheduleLabel || scheduleId,
            displayActive,
            currentAssignment: currentAssignment ? { eventId: assignmentEventId, scheduleId: assignmentScheduleId } : null
          });
        }
        // エラーが発生してもログに残すだけで、UI更新を阻害しない
        app.lockDisplayToSchedule(eventId, scheduleId, scheduleLabel || scheduleId, { silent: true }).then((result) => {
          if (typeof console !== "undefined" && typeof console.log === "function") {
            console.log("[DisplaySchedule] Auto-lock completed", result);
          }
        }).catch((err) => {
          if (typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn("[DisplaySchedule] Failed to auto-lock display schedule:", err);
          }
        });
      } else {
        // デバッグ用ログ：なぜ実行されなかったか
        if (typeof console !== "undefined" && typeof console.log === "function") {
          console.log("[DisplaySchedule] Auto-lock skipped", {
            eventId,
            scheduleId: normalizedScheduleId,
            displayActive,
            hasLockDisplayToSchedule: typeof app.lockDisplayToSchedule === "function"
          });
        }
      }
    } else {
      // デバッグ用ログ：既に一致している場合
      if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log("[DisplaySchedule] Assignment already matches", {
          eventId,
          scheduleId: normalizedScheduleId,
          assignmentEventId,
          assignmentScheduleId
        });
      }
    }
  } else {
    // デバッグ用ログ：条件を満たしていない場合
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log("[DisplaySchedule] Auto-lock conditions not met", {
        nextSelectionConfirmed,
        eventId: eventId || "(empty)",
        scheduleId: scheduleId || "(empty)",
        assignmentDerivedSelection
      });
    }
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
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.isDisplaySessionActive;
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
  const channelKey = `${eventId}::${scheduleId}`;
  const snapshot = await get(nowShowingRef);
  // 非同期処理の後にチャンネルが変更されていないか確認
  const currentChannel = resolveNowShowingReference(app);
  const currentChannelKey = currentChannel.eventId && currentChannel.scheduleId
    ? `${currentChannel.eventId}::${currentChannel.scheduleId}`
    : "";
  if (currentChannelKey !== channelKey) {
    app.toast("チャンネルが変更されたため送出を中断しました。", "warning");
    return;
  }
  const previousNowShowing = snapshot.val();
  const previousUid =
    previousNowShowing && typeof previousNowShowing.uid !== "undefined" ? String(previousNowShowing.uid || "") : "";
  const isPickup = app.state.selectedRowData.isPickup === true;
  try {
    // 選択中の質問のquestionStatus参照を取得
    const currentStatusRef = getQuestionStatusRef(eventId, isPickup, scheduleId);
    
    // 前回表示中の質問と現在の質問のステータスを更新
    // pickupquestionの場合はscheduleIdを含むパスを使用するため、通常質問とpickupquestionを分けて処理
    const normalUpdates = {};
    const pickupUpdates = {};
    
    // previousUidが存在する場合、それがpickupquestionかどうかを判定
    let previousUidIsPickup = false;
    let previousUidItem = null;
    if (previousUid) {
      previousUidItem = app.state.allQuestions.find((q) => String(q.UID || "") === previousUid);
      if (previousUidItem) {
        previousUidIsPickup = previousUidItem.ピックアップ === true;
      }
    }
    
    // previousNowShowingからprevを取得
    let prev = null;
    let prevIsPickup = false;
    if (!previousUid && previousNowShowing) {
      // 完全正規化: uidから取得（既存データとの互換性のため、name/questionをフォールバックとして使用）
      const prevUid = typeof previousNowShowing.uid !== "undefined" ? String(previousNowShowing.uid || "").trim() : "";
      if (prevUid) {
        prev = app.state.allQuestions.find((q) => String(q.UID || "") === prevUid);
      }
      if (!prev && previousNowShowing.name && previousNowShowing.question) {
        // 既存データとの互換性: name/questionから検索
        prev = app.state.allQuestions.find(
          (q) => q["ラジオネーム"] === previousNowShowing.name && q["質問・お悩み"] === previousNowShowing.question
        );
      }
      if (prev) {
        prevIsPickup = prev.ピックアップ === true;
      }
    }
    
    // 通常質問とpickupquestionをイベントID/スケジュールIDごとにグループ化
    const normalUpdatesByPath = new Map();
    const pickupUpdatesByPath = new Map();
    
    // previousUidまたはprevのステータスを更新
    if (previousUid && previousUidItem) {
      if (previousUidIsPickup) {
        // PUQの場合は現在のチャンネルのeventIdとscheduleIdを使用
        const pathKey = getQuestionStatusPath(eventId, true, scheduleId);
        if (!pickupUpdatesByPath.has(pathKey)) {
          pickupUpdatesByPath.set(pathKey, { ref: currentStatusRef, updates: {} });
        }
        pickupUpdatesByPath.get(pathKey).updates[`${previousUid}/selecting`] = false;
        pickupUpdatesByPath.get(pathKey).updates[`${previousUid}/answered`] = true;
        pickupUpdatesByPath.get(pathKey).updates[`${previousUid}/updatedAt`] = serverTimestamp();
      } else {
        // 通常質問の場合は、その質問のイベントIDとスケジュールIDを使用
        const questionEventId = String(previousUidItem["イベントID"] ?? "").trim() || eventId;
        const questionScheduleId = String(previousUidItem["日程ID"] ?? "").trim() || scheduleId;
        const pathKey = getQuestionStatusPath(questionEventId, false, questionScheduleId);
        if (!normalUpdatesByPath.has(pathKey)) {
          normalUpdatesByPath.set(pathKey, { ref: getQuestionStatusRef(questionEventId, false, questionScheduleId), updates: {} });
        }
        normalUpdatesByPath.get(pathKey).updates[`${previousUid}/selecting`] = false;
        normalUpdatesByPath.get(pathKey).updates[`${previousUid}/answered`] = true;
        normalUpdatesByPath.get(pathKey).updates[`${previousUid}/updatedAt`] = serverTimestamp();
      }
    } else if (prev) {
      if (prevIsPickup) {
        // PUQの場合は現在のチャンネルのeventIdとscheduleIdを使用
        const pathKey = getQuestionStatusPath(eventId, true, scheduleId);
        if (!pickupUpdatesByPath.has(pathKey)) {
          pickupUpdatesByPath.set(pathKey, { ref: currentStatusRef, updates: {} });
        }
        pickupUpdatesByPath.get(pathKey).updates[`${prev.UID}/selecting`] = false;
        pickupUpdatesByPath.get(pathKey).updates[`${prev.UID}/answered`] = true;
        pickupUpdatesByPath.get(pathKey).updates[`${prev.UID}/updatedAt`] = serverTimestamp();
      } else {
        // 通常質問の場合は、その質問のイベントIDとスケジュールIDを使用
        const questionEventId = String(prev["イベントID"] ?? "").trim() || eventId;
        const questionScheduleId = String(prev["日程ID"] ?? "").trim() || scheduleId;
        const pathKey = getQuestionStatusPath(questionEventId, false, questionScheduleId);
        if (!normalUpdatesByPath.has(pathKey)) {
          normalUpdatesByPath.set(pathKey, { ref: getQuestionStatusRef(questionEventId, false, questionScheduleId), updates: {} });
        }
        normalUpdatesByPath.get(pathKey).updates[`${prev.UID}/selecting`] = false;
        normalUpdatesByPath.get(pathKey).updates[`${prev.UID}/answered`] = true;
        normalUpdatesByPath.get(pathKey).updates[`${prev.UID}/updatedAt`] = serverTimestamp();
      }
    }
    
    // 現在の質問のステータスを更新
    if (isPickup) {
      // PUQの場合は現在のチャンネルのeventIdとscheduleIdを使用
      const pathKey = getQuestionStatusPath(eventId, true, scheduleId);
      if (!pickupUpdatesByPath.has(pathKey)) {
        pickupUpdatesByPath.set(pathKey, { ref: currentStatusRef, updates: {} });
      }
      pickupUpdatesByPath.get(pathKey).updates[`${app.state.selectedRowData.uid}/selecting`] = true;
      pickupUpdatesByPath.get(pathKey).updates[`${app.state.selectedRowData.uid}/answered`] = false;
      pickupUpdatesByPath.get(pathKey).updates[`${app.state.selectedRowData.uid}/updatedAt`] = serverTimestamp();
    } else {
      // 通常質問の場合は、その質問のイベントIDとスケジュールIDを使用
      const currentItem = app.state.allQuestions.find((q) => String(q.UID) === app.state.selectedRowData.uid);
      const questionEventId = currentItem ? String(currentItem["イベントID"] ?? "").trim() || eventId : eventId;
      const questionScheduleId = currentItem ? String(currentItem["日程ID"] ?? "").trim() || scheduleId : scheduleId;
      const pathKey = getQuestionStatusPath(questionEventId, false, questionScheduleId);
      if (!normalUpdatesByPath.has(pathKey)) {
        normalUpdatesByPath.set(pathKey, { ref: getQuestionStatusRef(questionEventId, false, questionScheduleId), updates: {} });
      }
      normalUpdatesByPath.get(pathKey).updates[`${app.state.selectedRowData.uid}/selecting`] = true;
      normalUpdatesByPath.get(pathKey).updates[`${app.state.selectedRowData.uid}/answered`] = false;
      normalUpdatesByPath.get(pathKey).updates[`${app.state.selectedRowData.uid}/updatedAt`] = serverTimestamp();
    }
    
    // 通常質問とpickupquestionをそれぞれ適切なstatusRefに更新
    for (const [pathKey, { ref: statusRef, updates }] of normalUpdatesByPath) {
      if (Object.keys(updates).length > 0) {
        console.log("[送出] 通常質問のquestionStatus更新用JSON:", JSON.stringify({ [pathKey]: updates }, null, 2));
        await update(statusRef, updates);
      }
    }
    for (const [pathKey, { ref: statusRef, updates }] of pickupUpdatesByPath) {
      if (Object.keys(updates).length > 0) {
        console.log("[送出] Pick Up QuestionのquestionStatus更新用JSON:", JSON.stringify({ [pathKey]: updates }, null, 2));
        await update(statusRef, updates);
      }
    }
    if (Object.keys(pickupUpdates).length > 0) {
      console.log("[送出] Pick Up QuestionのquestionStatus更新用JSON:", JSON.stringify(pickupUpdates, null, 2));
      await update(currentStatusRef, pickupUpdates);
    }
    // 更新前に再度チャンネルを確認
    const finalChannel = resolveNowShowingReference(app);
    const finalChannelKey = finalChannel.eventId && finalChannel.scheduleId
      ? `${finalChannel.eventId}::${finalChannel.scheduleId}`
      : "";
    if (finalChannelKey !== channelKey) {
      app.toast("チャンネルが変更されたため送出を中断しました。", "warning");
      return;
    }
    // 完全正規化: name, question, participantId, genre, pickup, sideTelopRightは削除（uidから取得可能）
    // sideTelopRightはrender/events/{eventId}/{scheduleId}/sideTelops/rightから取得
    logDisplayLinkInfo("Sending nowShowing payload", {
      eventId,
      scheduleId,
      uid: app.state.selectedRowData.uid
    });
    const nowShowingPayload = {
      uid: app.state.selectedRowData.uid
    };
    console.log("[送出] nowShowing更新用JSON:", JSON.stringify(nowShowingPayload, null, 2));
    await update(nowShowingRef, nowShowingPayload);
    logDisplayLinkInfo("Display nowShowing updated", {
      eventId,
      scheduleId,
      uid: app.state.selectedRowData.uid
    });
    // updateSelectingStatusはtokenが必要なため、tokenがある場合のみ呼び出す
    const currentQuestionRecord = app.state.questionsByUid instanceof Map
      ? app.state.questionsByUid.get(app.state.selectedRowData.uid)
      : null;
    const hasToken = currentQuestionRecord && typeof currentQuestionRecord.token === "string" && currentQuestionRecord.token.trim();
    if (hasToken) {
      app.api.fireAndForgetApi({ 
        action: "updateSelectingStatus", 
        uid: app.state.selectedRowData.uid,
        scheduleId: isPickup ? scheduleId : undefined
      });
    } else {
      // tokenがない場合でも、同じイベント内の他の質問のselecting状態をクリアする
      // updateSelectingStatusの代替処理として、同じイベント内の他の質問をselecting: falseにする
      const sameEventQuestions = app.state.allQuestions.filter((q) => {
        const qEventId = String(q["イベントID"] ?? "").trim();
        return qEventId === eventId && String(q.UID) !== app.state.selectedRowData.uid;
      });
      if (sameEventQuestions.length > 0) {
        // 通常質問とpickupquestionを分けて処理
        const normalClearingUpdates = {};
        const pickupClearingUpdates = {};
        sameEventQuestions.forEach((q) => {
          const qUid = String(q.UID);
          const qIsPickup = q.ピックアップ === true;
          if (qIsPickup) {
            pickupClearingUpdates[`${qUid}/selecting`] = false;
            pickupClearingUpdates[`${qUid}/updatedAt`] = serverTimestamp();
          } else {
            normalClearingUpdates[`${qUid}/selecting`] = false;
            normalClearingUpdates[`${qUid}/updatedAt`] = serverTimestamp();
          }
        });
        if (Object.keys(normalClearingUpdates).length > 0) {
          await update(normalStatusRef, normalClearingUpdates);
        }
        if (Object.keys(pickupClearingUpdates).length > 0) {
          await update(currentStatusRef, pickupClearingUpdates);
        }
      }
    }
    // previousUidまたはprevのupdateStatus API呼び出し
    if (previousUid && previousUidItem) {
      app.api.fireAndForgetApi({ 
        action: "updateStatus", 
        uid: previousUid, 
        status: true, 
        eventId,
        scheduleId: previousUidIsPickup ? scheduleId : undefined
      });
    } else if (prev) {
      app.api.fireAndForgetApi({ 
        action: "updateStatus", 
        uid: prev.UID, 
        status: true, 
        eventId,
        scheduleId: prevIsPickup ? scheduleId : undefined
      });
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
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.isDisplaySessionActive;
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
  
  // ローディング状態を開始（更新前の状態を記録）
  const currentItem = app.state.allQuestions.find((q) => String(q.UID) === uid);
  const currentAnswered = currentItem ? !!currentItem["回答済"] : false;
  const isPickup = app.state.selectedRowData.isPickup === true;
  // 通常質問の場合は、その質問のイベントIDとスケジュールIDを使用
  // PUQの場合は現在のチャンネルのイベントIDとスケジュールIDを使用
  let eventId = String(app.state.activeEventId || "").trim();
  let scheduleId = "";
  if (isPickup) {
    const { scheduleId: channelScheduleId } = resolveNowShowingReference(app);
    scheduleId = channelScheduleId;
  } else {
    // 通常質問の場合は、その質問のイベントIDとスケジュールIDを使用
    const questionEventId = currentItem ? String(currentItem["イベントID"] ?? "").trim() : "";
    const questionScheduleId = currentItem ? String(currentItem["日程ID"] ?? "").trim() : "";
    if (questionEventId) {
      eventId = questionEventId;
    }
    if (questionScheduleId) {
      scheduleId = questionScheduleId;
    } else {
      const { scheduleId: channelScheduleId } = resolveNowShowingReference(app);
      scheduleId = channelScheduleId;
    }
  }
  loadingUids.add(uid);
  loadingUidStates.set(uid, {
    expectedAnswered: false, // 未回答に戻すので、最終的にfalseになることを期待
    previousAnswered: currentAnswered // 更新前の状態
  });
  
  const card = app.dom.cardsContainer?.querySelector(`.q-card[data-uid="${uid}"]`);
  if (card) {
    card.classList.add("is-loading");
    const existingSpinner = card.querySelector(".q-loading-spinner");
    if (!existingSpinner) {
      const spinner = document.createElement("div");
      spinner.className = "q-loading-spinner";
      spinner.setAttribute("aria-label", "更新中");
      card.appendChild(spinner);
    }
  }
  
  // 即座に再描画してローディング状態を表示
  renderQuestions(app);
  
  try {
    const statusRef = getQuestionStatusRef(eventId, isPickup, scheduleId);
    const unanswerPayload = { answered: false, updatedAt: serverTimestamp() };
    const statusPath = getQuestionStatusPath(eventId, isPickup, scheduleId);
    console.log("[未回答にする] questionStatus更新用JSON:", JSON.stringify({ [`${statusPath}/${uid}`]: unanswerPayload }, null, 2));
    await update(statusRef, { [`${uid}`]: unanswerPayload });
    app.api.fireAndForgetApi({
      action: "updateStatus",
      uid: app.state.selectedRowData.uid,
      status: false,
      eventId,
      scheduleId: isPickup ? scheduleId : undefined
    });
    app.api.logAction("UNANSWER", `UID: ${uid}, RN: ${displayLabel}`);
    
    // Firebaseの更新が反映されるまで少し待つ（最大5秒）
    const maxWaitTime = 5000;
    const checkInterval = 150;
    const startTime = Date.now();
    const checkLoading = () => {
      const question = app.state.allQuestions.find((q) => String(q.UID) === uid);
      const loadingState = loadingUidStates.get(uid);
      // 更新が反映されたか確認（answeredがfalseになった）
      if (question && !question["回答済"] && loadingState && loadingState.previousAnswered === true) {
        // 更新が反映された
        loadingUids.delete(uid);
        loadingUidStates.delete(uid);
        // 再描画してローディング状態を解除
        renderQuestions(app);
        return;
      }
      // タイムアウトチェック
      if (Date.now() - startTime < maxWaitTime) {
        setTimeout(checkLoading, checkInterval);
      } else {
        // タイムアウト時もローディング状態を解除
        loadingUids.delete(uid);
        loadingUidStates.delete(uid);
        renderQuestions(app);
      }
    };
    setTimeout(checkLoading, checkInterval);
  } catch (error) {
    // エラー時はローディング状態を解除
    loadingUids.delete(uid);
    loadingUidStates.delete(uid);
    renderQuestions(app);
//    console.error("Failed to revert question to unanswered", error);
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

export function handleRowCheckboxChange(app, event) {
  const target = event?.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!target.classList.contains("row-checkbox")) return;

  syncSelectAllState(app);
  updateBatchButtonVisibility(app);
  updateActionAvailability(app);
}

export async function handleBatchUnanswer(app) {
  const renderOnline = app.state.renderChannelOnline !== false;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.isDisplaySessionActive;
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
  
  // ローディング状態を開始（更新前の状態を記録）
  uidsToUpdate.forEach((uid) => {
    const currentItem = app.state.allQuestions.find((q) => String(q.UID) === uid);
    const currentAnswered = currentItem ? !!currentItem["回答済"] : false;
    loadingUids.add(uid);
    loadingUidStates.set(uid, {
      expectedAnswered: false, // 未回答に戻すので、最終的にfalseになることを期待
      previousAnswered: currentAnswered // 更新前の状態
    });
    const card = app.dom.cardsContainer?.querySelector(`.q-card[data-uid="${uid}"]`);
    if (card) {
      card.classList.add("is-loading");
      const existingSpinner = card.querySelector(".q-loading-spinner");
      if (!existingSpinner) {
        const spinner = document.createElement("div");
        spinner.className = "q-loading-spinner";
        spinner.setAttribute("aria-label", "更新中");
        card.appendChild(spinner);
      }
    }
  });
  
  // 即座に再描画してローディング状態を表示
  renderQuestions(app);
  
  const { eventId, scheduleId } = resolveNowShowingReference(app);
  
  // イベント/Pick Up Question/scheduleIdごとにグループ化
  const updatesByPath = new Map();
  for (const uid of uidsToUpdate) {
    const item = app.state.allQuestions.find((q) => String(q.UID) === uid);
    if (!item) {
      console.warn(`[handleBatchUnanswer] Question not found for UID: ${uid}`);
      continue;
    }
    const isPickup = item.ピックアップ === true;
    // 各質問のイベントIDを取得
    // PUQの場合はtokenがないため、現在アクティブなeventIdを使用
    let questionEventId = String(item["イベントID"] ?? "").trim();
    if (!questionEventId && isPickup) {
      // PUQの場合は現在アクティブなeventIdを使用
      const { eventId } = resolveNowShowingReference(app);
      questionEventId = String(eventId || "").trim();
    }
    if (!questionEventId) {
      console.warn(`[handleBatchUnanswer] EventId not found for UID: ${uid}`);
      continue;
    }
    // 通常質問もPick Up Questionも、スケジュールの中に作成する
    // 通常質問の場合は、その質問のスケジュールIDを使用
    // PUQの場合は現在のチャンネルのscheduleIdを使用
    let questionScheduleId = scheduleId;
    if (!isPickup) {
      const itemScheduleId = String(item["日程ID"] ?? "").trim();
      if (itemScheduleId) {
        questionScheduleId = itemScheduleId;
      }
    }
    const statusRef = getQuestionStatusRef(questionEventId, isPickup, questionScheduleId);
    const pathKey = getQuestionStatusPath(questionEventId, isPickup, questionScheduleId);
    if (!updatesByPath.has(pathKey)) {
      updatesByPath.set(pathKey, { ref: statusRef, updates: {} });
    }
    const group = updatesByPath.get(pathKey);
    group.updates[`${uid}/answered`] = false;
    group.updates[`${uid}/updatedAt`] = serverTimestamp();
  }
  
  if (updatesByPath.size === 0) {
    // 更新対象がない場合はエラーを表示
    app.toast("更新対象の質問が見つかりませんでした。", "error");
    // ローディング状態を解除
    uidsToUpdate.forEach((uid) => {
      loadingUids.delete(uid);
      loadingUidStates.delete(uid);
    });
    renderQuestions(app);
    return;
  }
  
  try {
    // 各パスごとに更新を実行
    for (const [pathKey, { ref: statusRef, updates }] of updatesByPath) {
      console.log("[チェックしたものをまとめて未回答にする] questionStatus更新用JSON:", JSON.stringify({ [pathKey]: updates }, null, 2));
      await update(statusRef, updates);
    }
    app.api.fireAndForgetApi({ 
      action: "batchUpdateStatus", 
      uids: uidsToUpdate, 
      status: false,
      eventId: eventId,
      scheduleId: scheduleId
    });
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
    
    // Firebaseの更新が反映されるまで少し待つ（最大5秒）
    const maxWaitTime = 5000;
    const checkInterval = 150;
    const startTime = Date.now();
    const checkLoading = () => {
      const remainingUids = uidsToUpdate.filter((uid) => {
        const question = app.state.allQuestions.find((q) => String(q.UID) === uid);
        const loadingState = loadingUidStates.get(uid);
        // 更新が反映されたか確認（answeredがfalseになった）
        if (question && !question["回答済"] && loadingState && loadingState.previousAnswered === true) {
          // 更新が反映された
          loadingUids.delete(uid);
          loadingUidStates.delete(uid);
          return false;
        }
        return true;
      });
      
      // タイムアウトチェック
      if (remainingUids.length > 0 && Date.now() - startTime < maxWaitTime) {
        setTimeout(checkLoading, checkInterval);
      } else {
        // 残っているローディング状態をすべて解除
        remainingUids.forEach((uid) => {
          loadingUids.delete(uid);
          loadingUidStates.delete(uid);
        });
        // 再描画してローディング状態を解除
        renderQuestions(app);
      }
    };
    setTimeout(checkLoading, checkInterval);
  } catch (error) {
    // エラー時はローディング状態を解除
    uidsToUpdate.forEach((uid) => {
      loadingUids.delete(uid);
      loadingUidStates.delete(uid);
    });
    renderQuestions(app);
    app.toast("未回答への戻し中にエラーが発生しました。", "error");
  }
}

export async function clearNowShowing(app) {
  const renderOnline = app.state.renderChannelOnline !== false;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.isDisplaySessionActive;
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
  const channelKey = `${eventId}::${scheduleId}`;
  const snapshot = await get(nowShowingRef);
  // 非同期処理の後にチャンネルが変更されていないか確認
  const currentChannel = resolveNowShowingReference(app);
  const currentChannelKey = currentChannel.eventId && currentChannel.scheduleId
    ? `${currentChannel.eventId}::${currentChannel.scheduleId}`
    : "";
  if (currentChannelKey !== channelKey) {
    app.toast("チャンネルが変更されたため送出クリアを中断しました。", "warning");
    return;
  }
  const previousNowShowing = snapshot.val();
  try {
    logDisplayLinkInfo("Clearing nowShowing payload", { eventId, scheduleId });
    // イベント/Pick Up Question/scheduleIdごとにグループ化
    const updatesByPath = new Map();
    const selectingItems = app.state.allQuestions.filter((item) => item["選択中"] === true);
    selectingItems.forEach((item) => {
      const isPickup = item.ピックアップ === true;
      // 通常質問もPick Up Questionも、スケジュールの中に作成する
      // 通常質問の場合は、その質問のイベントIDとスケジュールIDを使用
      // PUQの場合は現在のチャンネルのeventIdとscheduleIdを使用
      let itemEventId = eventId;
      let itemScheduleId = scheduleId;
      if (!isPickup) {
        const questionEventId = String(item["イベントID"] ?? "").trim();
        const questionScheduleId = String(item["日程ID"] ?? "").trim();
        if (questionEventId) {
          itemEventId = questionEventId;
        }
        if (questionScheduleId) {
          itemScheduleId = questionScheduleId;
        }
      }
      const statusRef = getQuestionStatusRef(itemEventId, isPickup, itemScheduleId);
      const pathKey = getQuestionStatusPath(itemEventId, isPickup, itemScheduleId);
      if (!updatesByPath.has(pathKey)) {
        updatesByPath.set(pathKey, { ref: statusRef, updates: {} });
      }
      const group = updatesByPath.get(pathKey);
      group.updates[`${item.UID}/selecting`] = false;
      group.updates[`${item.UID}/updatedAt`] = serverTimestamp();
    });
    if (previousNowShowing) {
      let prevUid = typeof previousNowShowing.uid !== "undefined" ? String(previousNowShowing.uid || "") : "";
      let prevItem = null;
      // まずpreviousNowShowing.pickupを確認
      let isPickup = previousNowShowing.pickup === true;
      
      if (!prevUid) {
        // uidがない場合はname/questionから検索
        prevItem = app.state.allQuestions.find(
          (q) => q["ラジオネーム"] === previousNowShowing.name && q["質問・お悩み"] === previousNowShowing.question
        );
        if (prevItem) {
          prevUid = prevItem.UID;
          isPickup = prevItem.ピックアップ === true;
        }
      } else {
        // uidがある場合はuidから検索
        prevItem = app.state.allQuestions.find((q) => String(q.UID || "") === prevUid) || null;
        if (prevItem) {
          // prevItemが見つかった場合は、prevItemのピックアップフラグを優先
          isPickup = prevItem.ピックアップ === true;
        } else {
          // prevItemが見つからない場合、Firebaseから直接確認してpickup questionかどうかを判定
          // バックエンド側と同じ方法で判定するため、questions/pickup/{uid}の存在を確認
          try {
            const pickupQuestionRef = ref(database, `questions/pickup/${prevUid}`);
            const pickupQuestionSnap = await get(pickupQuestionRef);
            if (pickupQuestionSnap.exists()) {
              isPickup = true;
            } else {
              // previousNowShowing.pickupがtrueならisPickupをtrueのまま維持
              // バックエンド側でpickup questionと判定される可能性があるため
            }
          } catch (error) {
            // エラーが発生した場合は、previousNowShowing.pickupを信頼する
            console.warn(`[clearNowShowing] Failed to check pickup question for UID: ${prevUid}`, error);
          }
        }
      }

      if (prevUid) {
        // pickupquestionの場合は、prevItemからscheduleIdを取得するか、現在のscheduleIdを使用
        // prevItemが見つかった場合は、そのscheduleIdを優先
        let pickupScheduleId = scheduleId ? String(scheduleId).trim() : "";
        if (isPickup && prevItem) {
          const itemScheduleId = String(prevItem["日程ID"] || "").trim();
          if (itemScheduleId) {
            pickupScheduleId = itemScheduleId;
          }
        }
        // previousNowShowingからもscheduleIdを取得を試みる
        if (isPickup && !pickupScheduleId) {
          const prevScheduleId = String(previousNowShowing.scheduleId || "").trim();
          if (prevScheduleId) {
            pickupScheduleId = prevScheduleId;
          }
        }
        // prevItemが見つからなくても、isPickupがtrueの場合はpickup questionとして扱う
        // この場合、現在のチャンネルのscheduleIdを使用（PUQを送出する際に使用したscheduleIdである可能性が高い）
        if (isPickup && !pickupScheduleId) {
          // 現在のチャンネルのscheduleIdをフォールバックとして使用
          pickupScheduleId = scheduleId ? String(scheduleId).trim() : "";
        }
        
        // Firebaseのパス計算にはnormalizeScheduleIdを使用（空の場合は__default_schedule__になる）
        // 通常質問もPick Up Questionも、スケジュールの中に作成する
        // 通常質問の場合は、その質問のイベントIDとスケジュールIDを使用
        // PUQの場合は現在のチャンネルのeventIdとscheduleIdを使用
        let finalEventId = eventId;
        let finalScheduleId = isPickup ? pickupScheduleId : scheduleId;
        if (!isPickup && prevItem) {
          const questionEventId = String(prevItem["イベントID"] ?? "").trim();
          const questionScheduleId = String(prevItem["日程ID"] ?? "").trim();
          if (questionEventId) {
            finalEventId = questionEventId;
          }
          if (questionScheduleId) {
            finalScheduleId = questionScheduleId;
          }
        }
        const statusRef = getQuestionStatusRef(finalEventId, isPickup, finalScheduleId);
        const pathKey = getQuestionStatusPath(finalEventId, isPickup, finalScheduleId);
        if (!updatesByPath.has(pathKey)) {
          updatesByPath.set(pathKey, { ref: statusRef, updates: {} });
        }
        const group = updatesByPath.get(pathKey);
        group.updates[`${prevUid}/answered`] = true;
        group.updates[`${prevUid}/updatedAt`] = serverTimestamp();

        const apiScheduleId = String(
          pickupScheduleId ||
          scheduleId ||
          previousNowShowing.scheduleId ||
          ""
        ).trim();
        // PUQの場合はscheduleIdが必須
        // バックエンド側でpickup questionと判定される可能性があるため、
        // previousNowShowing.pickupがtrueの場合は常にscheduleIdを送る
        // prevItemが見つからない場合でも、バックエンド側でpickup questionと判定される可能性があるため
        if (isPickup) {
          // scheduleIdが空の場合はAPI呼び出しをスキップ
          // normalizeScheduleIdは空の場合__default_schedule__を返すため、直接チェックする
          const normalizedScheduleId = apiScheduleId;
          if (!normalizedScheduleId) {
            console.warn(`[clearNowShowing] scheduleId is required for pickup question UID: ${prevUid}, but scheduleId is empty or invalid. Skipping API call.`);
            // API呼び出しをスキップ（ただし、Firebaseのansweredフラグは既に設定済み）
          } else {
            app.api.fireAndForgetApi({ 
              action: "updateStatus", 
              uid: prevUid, 
              status: true, 
              eventId,
              scheduleId: normalizedScheduleId
            });
          }
        } else {
          // 通常質問として扱う場合でも、実際にはpickup questionである可能性に備えてscheduleIdを付与
          // scheduleIdが空の場合は従来通りスキップ
          if (!apiScheduleId) {
            console.warn(`[clearNowShowing] scheduleId is required for potential pickup question UID: ${prevUid}, but scheduleId is empty. Skipping API call.`);
          } else {
            app.api.fireAndForgetApi({ 
              action: "updateStatus", 
              uid: prevUid, 
              status: true, 
              eventId,
              scheduleId: apiScheduleId
            });
          }
        }
      }
    }
    // 各パスごとに更新を実行
    for (const [pathKey, { ref: statusRef, updates }] of updatesByPath) {
      if (Object.keys(updates).length > 0) {
        console.log("[送出クリア] questionStatus更新用JSON:", JSON.stringify({ [pathKey]: updates }, null, 2));
        await update(statusRef, updates);
      }
    }
    // 更新前に再度チャンネルを確認
    const finalChannel = resolveNowShowingReference(app);
    const finalChannelKey = finalChannel.eventId && finalChannel.scheduleId
      ? `${finalChannel.eventId}::${finalChannel.scheduleId}`
      : "";
    if (finalChannelKey !== channelKey) {
      app.toast("チャンネルが変更されたため送出クリアを中断しました。", "warning");
      return;
    }
    // 完全正規化: クリア時はuidを空文字にする
    const clearedNowShowing = {
      uid: ""
    };
    console.log("[送出クリア] nowShowing更新用JSON:", JSON.stringify(clearedNowShowing, null, 2));
    await update(nowShowingRef, clearedNowShowing);
    logDisplayLinkInfo("Display nowShowing cleared", { eventId, scheduleId });
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
  const sessionActive = !!app.state.isDisplaySessionActive;
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : sessionActive;
  const assetChecked = app.state.isDisplayAssetChecked === true;
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
//      console.log(`[Operator] action-availability ${message}`, details);
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
  const displayOnline = typeof app.isDisplayOnline === "function" ? app.isDisplayOnline() : !!app.state.isDisplaySessionActive;
  const telopEnabled = typeof app.isTelopEnabled === "function" ? app.isTelopEnabled() : true;
  const assetAvailable = app.state.displayAssetAvailable !== false;
  const assetChecked = app.state.isDisplayAssetChecked === true;
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

function encodeCsvValue(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function createCsvContent(rows) {
  return rows.map((row) => row.map(encodeCsvValue).join(",")).join("\r\n");
}

function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const content = createCsvContent(rows);
  const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf]);
  let blob;

  if (typeof TextEncoder !== "undefined") {
    const encoder = new TextEncoder();
    const body = encoder.encode(content);
    blob = new Blob([bomBytes, body], { type: "text/csv;charset=utf-8;" });
  } else {
    blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildNormalQuestionCsvRows(records) {
  const header = [
    "UID",
    "参加者ID",
    "ラジオネーム",
    "質問・お悩み",
    "ジャンル",
    "班番号",
    "イベントID",
    "イベント名",
    "日程ID",
    "日程表示",
    "開始日時",
    "終了日時",
    "回答状況"
  ];
  const rows = [header];
  records.forEach((item) => {
    rows.push([
      item.UID,
      item["参加者ID"],
      item["ラジオネーム"],
      item["質問・お悩み"],
      item["ジャンル"],
      item["班番号"],
      item["イベントID"],
      item["イベント名"],
      item["日程ID"],
      item["日程表示"],
      item["開始日時"],
      item["終了日時"],
      item["回答済"] ? "回答済" : "未回答"
    ]);
  });
  return rows;
}

function resolveScheduleContext(app, scheduleKey) {
  const key = String(scheduleKey || "").trim();
  const metaMap = app?.state?.scheduleMetadata;
  const meta = key && metaMap instanceof Map ? metaMap.get(key) : null;
  if (meta) {
    const normalizedSchedule = normalizeScheduleId(meta.scheduleId || "");
    return {
      eventId: String(meta.eventId || "").trim(),
      scheduleId: String(normalizedSchedule || meta.scheduleId || "").trim(),
      label: String(meta.label || "").trim()
    };
  }
  const [eventPart = "", schedulePart = ""] = key.includes("::") ? key.split("::") : ["", key];
  const normalizedSchedule = normalizeScheduleId(schedulePart || "");
  return {
    eventId: String(eventPart || "").trim(),
    scheduleId: String(normalizedSchedule || schedulePart || "").trim(),
    label: key
  };
}

function buildNormalQuestionFilename({ scope, answered, eventId, scheduleId }) {
  const status = answered ? "answered" : "unanswered";
  const safeEvent = String(eventId || "event").trim() || "event";
  if (scope === "event") {
    return `${safeEvent}_normal_questions_${status}_all_schedules.csv`;
  }
  const safeSchedule = String(scheduleId || "schedule").trim() || "schedule";
  return `${safeEvent}_${safeSchedule}_normal_questions_${status}.csv`;
}

function exportNormalQuestionsCsv(app, { answered }) {
  const scope = app?.dom?.exportScopeSelect?.value === "event" ? "event" : "schedule";
  const allQuestions = Array.isArray(app?.state?.allQuestions) ? app.state.allQuestions : [];
  const normalQuestions = allQuestions.filter((item) => !isPickUpQuestion(item));
  const selectedSchedule = resolveNormalScheduleKey(app);
  const scheduleContext = resolveScheduleContext(app, selectedSchedule);
  const activeEventId = String(app?.state?.activeEventId || "").trim();
  const fallbackEventId = scheduleContext.eventId;
  const eventId = activeEventId || fallbackEventId;
  let filtered = [];

  if (scope === "event") {
    if (!eventId) {
      app.toast("イベントが選択されていないため出力できません。", "error");
      return;
    }
    filtered = normalQuestions.filter((item) => String(item["イベントID"] || "").trim() === eventId);
  } else {
    if (!selectedSchedule) {
      app.toast("日程が選択されていないため出力できません。", "error");
      return;
    }
    filtered = normalQuestions.filter(
      (item) => String(item.__scheduleKey ?? item["日程"] ?? "").trim() === selectedSchedule
    );
  }

  filtered = filtered
    .filter((item) => Boolean(item["回答済"]) === answered)
    .sort((a, b) => Number(b.__ts || 0) - Number(a.__ts || 0));

  if (filtered.length === 0) {
    app.toast("出力対象の通常質問がありません。", "info");
    return;
  }

  const filename = buildNormalQuestionFilename({
    scope,
    answered,
    eventId: scope === "event" ? eventId : scheduleContext.eventId || eventId,
    scheduleId: scope === "event" ? "all" : scheduleContext.scheduleId || selectedSchedule
  });

  const rows = buildNormalQuestionCsvRows(filtered);
  downloadCsv(filename, rows);
}

export function exportUnansweredCsv(app) {
  exportNormalQuestionsCsv(app, { answered: false });
}

export function exportAnsweredCsv(app) {
  exportNormalQuestionsCsv(app, { answered: true });
}

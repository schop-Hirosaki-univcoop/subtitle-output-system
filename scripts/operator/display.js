// display.js: テロップ表示画面への状態配信やレンダリング制御を担います。
import { info as logDisplayLinkInfo } from "../shared/display-link-logger.js";
import { escapeHtml, formatOperatorName, formatRelative, normalizeUpdatedAt, renderRubyHtml } from "./utils.js";

export function handleRenderUpdate(app, snapshot) {
  const rawValue = typeof snapshot?.val === "function" ? snapshot.val() : null;
  const exists = typeof snapshot?.exists === "function" ? snapshot.exists() : rawValue != null;
  const hadState = app?.state?.renderState != null;
  const sessionActive = app?.state?.displaySessionActive === true;
  const snapshotActive = app?.displaySessionStatusFromSnapshot === true;
  if (typeof app.updateRenderAvailability === "function") {
    const status = exists ? true : hadState && !(sessionActive || snapshotActive) ? false : null;
    app.updateRenderAvailability(status);
  }
  const value = rawValue || {};
  setLamp(app, value.phase);
  const phase = value.phase || "";
  // phase が hidden でも nowShowing 自体は最新値を参照し、送出クリア（nowShowing: null）を
  // 受け取ったタイミングだけでカード強調やステータスをリセットする。
  const now = value.nowShowing || null;
  renderNowShowingSummary(app, now, phase);

  const updatedAt = normalizeUpdatedAt(value.updatedAt) || 0;
  const previous = app.lastUpdatedAt || 0;
  app.lastUpdatedAt = updatedAt;
  redrawUpdatedAt(app);
  if (updatedAt > previous) {
    app.dom.render.summary?.classList.add("is-updated");
    app.dom.render.indicator?.classList.add("is-updated");
    setTimeout(() => {
      app.dom.render.summary?.classList.remove("is-updated");
      app.dom.render.indicator?.classList.remove("is-updated");
    }, 800);
  }
  if (!app.renderTicker) {
    app.renderTicker = setInterval(() => {
      redrawUpdatedAt(app);
      refreshStaleness(app);
    }, 1000);
  }
  refreshStaleness(app);

  const previousNow = app.state.renderState?.nowShowing || null;
  const normalizedNow = normalizeNowShowing(now, app);
  logDisplayLinkInfo("Render state updated", {
    phase,
    nowShowing: normalizedNow,
    updatedAt: updatedAt || null
  });
  if (exists) {
    app.state.renderState = { ...value, nowShowing: normalizedNow };
  } else {
    app.state.renderState = null;
  }
  if (!areNowShowingEqual(previousNow, normalizedNow) && typeof app.renderQuestions === "function") {
    app.renderQuestions();
  }
}

function normalizeNowShowing(now, app = null) {
  if (!now) return null;
  const uid = String(now.uid || "").trim();
  if (!uid) {
    // 既存データとの互換性: uidがない場合は従来の形式として扱う
    const normalized = {
      name: typeof now.name === "string" ? now.name : String(now.name || ""),
      question: typeof now.question === "string" ? now.question : String(now.question || "")
    };
    if (Object.prototype.hasOwnProperty.call(now, "uid")) {
      normalized.uid = String(now.uid || "");
    }
    if (Object.prototype.hasOwnProperty.call(now, "participantId")) {
      normalized.participantId = String(now.participantId || "");
    }
    if (Object.prototype.hasOwnProperty.call(now, "pickup")) {
      normalized.pickup = Boolean(now.pickup);
    }
    if (Object.prototype.hasOwnProperty.call(now, "sideTelopLeft")) {
      normalized.sideTelopLeft = String(now.sideTelopLeft || "");
    } else if (Object.prototype.hasOwnProperty.call(now, "sideLeft")) {
      normalized.sideTelopLeft = String(now.sideLeft || "");
    }
    if (Object.prototype.hasOwnProperty.call(now, "sideTelopRight")) {
      normalized.sideTelopRight = String(now.sideTelopRight || "");
    } else if (Object.prototype.hasOwnProperty.call(now, "sideRight")) {
      normalized.sideTelopRight = String(now.sideRight || "");
    }
    return normalized;
  }

  // 完全正規化: uidから情報を取得
  const questionsByUid = app?.state?.questionsByUid instanceof Map ? app.state.questionsByUid : new Map();
  const questionRecord = questionsByUid.get(uid);
  
  const normalized = {
    uid
  };
  
  if (questionRecord) {
    normalized.name = String(questionRecord.name || "").trim();
    normalized.question = String(questionRecord.question || "").trim();
    if (Object.prototype.hasOwnProperty.call(questionRecord, "participantId")) {
      normalized.participantId = String(questionRecord.participantId || "");
    }
    if (Object.prototype.hasOwnProperty.call(questionRecord, "genre")) {
      normalized.genre = String(questionRecord.genre || "");
    }
    // pickupはquestions/normalには存在しないため、questions/pickupの存在確認が必要
    // ただし、通常はallQuestionsから取得可能
    const allQuestions = Array.isArray(app?.state?.allQuestions) ? app.state.allQuestions : [];
    const fullQuestion = allQuestions.find((q) => String(q.UID || "") === uid);
    if (fullQuestion) {
      normalized.pickup = Boolean(fullQuestion["ピックアップ"]);
    }
  } else {
    // 既存データとの互換性: キャッシュにない場合は従来の形式をフォールバック
    normalized.name = typeof now.name === "string" ? now.name : String(now.name || "");
    normalized.question = typeof now.question === "string" ? now.question : String(now.question || "");
    if (Object.prototype.hasOwnProperty.call(now, "participantId")) {
      normalized.participantId = String(now.participantId || "");
    }
    if (Object.prototype.hasOwnProperty.call(now, "pickup")) {
      normalized.pickup = Boolean(now.pickup);
    }
  }

  // sideTelopRightはrender/events/{eventId}/{scheduleId}/sideTelops/rightから取得
  // ただし、既存データとの互換性のため、nowShowingに含まれている場合はそれを使用
  if (Object.prototype.hasOwnProperty.call(now, "sideTelopRight")) {
    normalized.sideTelopRight = String(now.sideTelopRight || "");
  } else if (Object.prototype.hasOwnProperty.call(now, "sideRight")) {
    normalized.sideTelopRight = String(now.sideRight || "");
  }

  return normalized;
}

function areNowShowingEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.uid || "") === (b.uid || "") &&
    (a.participantId || "") === (b.participantId || "") &&
    (a.question || "") === (b.question || "") &&
    (a.name || "") === (b.name || "") &&
    Boolean(a.pickup) === Boolean(b.pickup) &&
    (a.sideTelopLeft || "") === (b.sideTelopLeft || "") &&
    (a.sideTelopRight || "") === (b.sideTelopRight || "")
  );
}

export function setLamp(app, phase) {
  if (!app.dom.render.lamp) return;
  app.dom.render.lamp.className = "lamp";
  switch (phase) {
    case "visible":
      app.dom.render.lamp.classList.add("is-visible");
      break;
    case "showing":
    case "hiding":
      app.dom.render.lamp.classList.add("is-showing");
      break;
    case "hidden":
      app.dom.render.lamp.classList.add("is-hidden");
      break;
    case "error":
      app.dom.render.lamp.classList.add("is-error");
      break;
    default:
      app.dom.render.lamp.classList.add("is-hidden");
      break;
  }
  if (app.dom.render.phase) {
    app.dom.render.phase.textContent = phase || "-";
  }
}

export function redrawUpdatedAt(app) {
  if (!app.dom.render.updated) return;
  if (!app.lastUpdatedAt) {
    app.dom.render.updated.textContent = "—";
    return;
  }
  const timeText = new Date(app.lastUpdatedAt).toLocaleTimeString("ja-JP", { hour12: false });
  app.dom.render.updated.textContent = `${timeText}（${formatRelative(app.lastUpdatedAt)}）`;
}

export function refreshStaleness(app) {
  if (!app.dom.render.indicator) return;
  if (!app.lastUpdatedAt) {
    app.dom.render.indicator.classList.remove("is-stale");
    return;
  }
  const age = Date.now() - app.lastUpdatedAt;
  if (Number.isFinite(age) && age >= 30000) {
    app.dom.render.indicator.classList.add("is-stale");
  } else {
    app.dom.render.indicator.classList.remove("is-stale");
  }
}

export function refreshRenderSummary(app) {
  const phase = app.state.renderState?.phase || "";
  const storedNow = app.state.renderState?.nowShowing || null;
  renderNowShowingSummary(app, storedNow, phase);
}

function renderNowShowingSummary(app, now, phase = "") {
  const dictionaryEntries = Array.isArray(app.dictionaryEntries) ? app.dictionaryEntries : [];
  const activeNow = now ? now : null;

  if (!activeNow) {
    if (app.dom.render.title) {
      app.dom.render.title.textContent = "（送出なし）";
    }
    if (app.dom.render.question) {
      app.dom.render.question.textContent = "";
    }
    return;
  }

  const rawName = String(activeNow.name || "");
  const formattedName = formatOperatorName(rawName);
  const baseName = formattedName || rawName;
  const normalizedPickup = baseName.trim().toLowerCase().replace(/\s+/g, "");
  const isPickup = activeNow.pickup === true || normalizedPickup === "pickupquestion";

  if (app.dom.render.title) {
    if (!baseName) {
      app.dom.render.title.textContent = "—";
    } else if (isPickup) {
      const pickupDisplay = formattedName || baseName || "—";
      const pickupHtml = renderRubyHtml(pickupDisplay, dictionaryEntries);
      if (pickupHtml) {
        app.dom.render.title.innerHTML = pickupHtml;
      } else {
        app.dom.render.title.textContent = pickupDisplay;
      }
    } else {
      const nameHtml = renderRubyHtml(baseName, dictionaryEntries);
      const safeName = nameHtml || escapeHtml(baseName);
      app.dom.render.title.innerHTML = `ラジオネーム：${safeName}`;
    }
  }

  if (app.dom.render.question) {
    const questionText = String(activeNow.question || "");
    const questionHtml = renderRubyHtml(questionText, dictionaryEntries);
    if (questionHtml) {
      app.dom.render.question.innerHTML = questionHtml;
    } else {
      app.dom.render.question.textContent = questionText;
    }
  }
}

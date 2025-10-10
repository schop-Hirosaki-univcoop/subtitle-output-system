import { formatOperatorName, formatRelative, normalizeUpdatedAt } from "./utils.js";

export function handleRenderUpdate(app, snapshot) {
  const value = snapshot.val() || {};
  setLamp(app, value.phase);
  const isHidden = value.phase === "hidden";
  const now = isHidden ? null : value.nowShowing || null;
  if (!now) {
    if (app.dom.render.title) app.dom.render.title.textContent = "（送出なし）";
    if (app.dom.render.question) app.dom.render.question.textContent = "";
  } else {
    const name = (now.name || "").trim();
    if (app.dom.render.title) {
      const formattedName = formatOperatorName(name);
      if (!name) {
        app.dom.render.title.textContent = "—";
      } else if (name === "Pick Up Question") {
        app.dom.render.title.textContent = formattedName || "—";
      } else {
        app.dom.render.title.textContent = `ラジオネーム：${formattedName || name}`;
      }
    }
    if (app.dom.render.question) {
      app.dom.render.question.textContent = String(now.question || "").replace(/\s+/g, " ").trim();
    }
  }

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
  const normalizedNow = normalizeNowShowing(now);
  app.state.renderState = { ...value, nowShowing: normalizedNow };
  if (!areNowShowingEqual(previousNow, normalizedNow) && typeof app.renderQuestions === "function") {
    app.renderQuestions();
  }
}

function normalizeNowShowing(now) {
  if (!now) return null;
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
  return normalized;
}

function areNowShowingEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    (a.uid || "") === (b.uid || "") &&
    (a.participantId || "") === (b.participantId || "") &&
    (a.question || "") === (b.question || "") &&
    (a.name || "") === (b.name || "")
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

// logs.js: 操作ログの取得・整形・表示を司るモジュールです。
import { LOGS_STATE_KEY } from "./constants.js";
import { escapeHtml, getLogLevel, parseLogTimestamp } from "./utils.js";
import { updateTriggerRef, onValue } from "./firebase.js";

export async function fetchLogs(app) {
  try {
    const result = await app.api.apiPost({ action: "fetchSheet", sheet: "logs" });
    if (result.success) {
      app.state.allLogs = result.data || [];
      renderLogs(app);
    }
  } catch (error) {
    console.error("ログの取得に失敗:", error);
  }
}

export function renderLogs(app) {
  const rows = applyLogFilters(app, app.state.allLogs || []);
  renderLogsStream(app, rows);
}

export function applyLogFilters(app, logs) {
  const query = (app.dom.logSearch?.value || "").trim().toLowerCase();
  if (!query) return logs;
  return logs.filter((row) => {
    const rawTs = row.Timestamp ?? row.timestamp ?? row["時刻"] ?? row["タイムスタンプ"] ?? "";
    const tsText = (
      parseLogTimestamp(rawTs)?.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) || String(rawTs)
    ).toLowerCase();
    const user = String(row.User ?? row.user ?? row["ユーザー"] ?? "").toLowerCase();
    const action = String(row.Action ?? row.action ?? row["アクション"] ?? "").toLowerCase();
    const details = String(row.Details ?? row.details ?? row["詳細"] ?? "").toLowerCase();
    const level = getLogLevel(row).toLowerCase();
    return tsText.includes(query) || user.includes(query) || action.includes(query) || details.includes(query) || level.includes(query);
  });
}

export function renderLogsStream(app, rows) {
  if (!app.dom.logStream) return;
  const max = 500;
  const viewRows = rows.slice(-max);
  app.dom.logStream.innerHTML = "";
  for (const log of viewRows) {
    const rawTs = log.Timestamp ?? log.timestamp ?? log["時刻"] ?? log["タイムスタンプ"] ?? "";
    const d = parseLogTimestamp(rawTs);
    const tsText = d ? d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : String(rawTs || "");
    const user = String(log.User ?? "");
    const action = String(log.Action ?? "");
    const details = String(log.Details ?? "");
    const level = getLogLevel(log);
    const line = document.createElement("div");
    line.className = `log-line lvl-${level}`;
    line.innerHTML =
      `<span class="ts">[${escapeHtml(tsText)}]</span> ` +
      `<span class="badge level ${escapeHtml(level)}">${escapeHtml(level.toUpperCase())}</span> ` +
      `<span class="badge user">@${escapeHtml(user)}</span> ` +
      `<span class="badge action">${escapeHtml(action.toUpperCase())}</span> ` +
      `<span class="details">${escapeHtml(details)}</span>`;
    app.dom.logStream.appendChild(line);
  }
  if (app.state.autoScrollLogs) {
    app.dom.logStream.scrollTop = app.dom.logStream.scrollHeight;
  }
}

export function applyInitialLogsState(app) {
  let saved = "0";
  try {
    saved = localStorage.getItem(LOGS_STATE_KEY) || "0";
  } catch (error) {
    saved = "0";
  }
  const shouldOpen = saved === "1";
  app.preferredLogsOpen = shouldOpen;
  toggleLogsDrawer(app, shouldOpen, false);
}

export function toggleLogsDrawer(app, force, persist = true) {
  const body = document.body;
  if (!body) return;
  const currentOpen = body.classList.contains("logs-open");
  const nextOpen = typeof force === "boolean" ? force : !currentOpen;
  body.classList.toggle("logs-open", nextOpen);
  body.classList.toggle("logs-collapsed", !nextOpen);
  if (app.dom.logsPanel) {
    if (nextOpen) {
      app.dom.logsPanel.removeAttribute("hidden");
    } else {
      app.dom.logsPanel.setAttribute("hidden", "");
    }
  }
  if (app.dom.logsToggle) {
    app.dom.logsToggle.setAttribute("aria-expanded", String(nextOpen));
    app.dom.logsToggle.setAttribute("aria-label", nextOpen ? "操作ログを閉じる" : "操作ログを開く");
    app.dom.logsToggle.setAttribute("title", nextOpen ? "操作ログを閉じる" : "操作ログを開く");
  }
  if (persist) {
    try {
      localStorage.setItem(LOGS_STATE_KEY, nextOpen ? "1" : "0");
    } catch (error) {
      console.debug("logs toggle state not persisted", error);
    }
    app.preferredLogsOpen = nextOpen;
  }
  if (nextOpen && (!Array.isArray(app.state.allLogs) || app.state.allLogs.length === 0)) {
    fetchLogs(app).catch((error) => console.error("ログの読み込みに失敗しました", error));
  }
}

export function startLogsUpdateMonitor(app) {
  if (app.updateTriggerUnsubscribe) app.updateTriggerUnsubscribe();
  app.updateTriggerUnsubscribe = onValue(updateTriggerRef, (snapshot) => {
    if (!snapshot.exists()) return;
    if (app.logsUpdateTimer) clearTimeout(app.logsUpdateTimer);
    app.logsUpdateTimer = setTimeout(() => fetchLogs(app), 150);
  });
}

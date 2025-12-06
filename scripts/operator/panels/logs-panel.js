// logs.js: 操作ログの取得・整形・表示を司るモジュールです。
import { LOGS_STATE_KEY } from "./constants.js";
import { escapeHtml, getLogLevel, parseLogTimestamp } from "./utils.js";
import { database, updateTriggerRef, onValue, ref, get, query, orderByChild, limitToLast } from "./firebase.js";

const LOGS_LOADER_STEPS = [
  { label: "初期化", message: "操作ログパネルを初期化しています…" },
  { label: "取得", message: "操作ログを取得しています…" },
  { label: "検索適用", message: "検索条件を適用しています…" },
  { label: "描画", message: "ログ一覧を描画しています…" },
  { label: "監視開始", message: "更新通知を監視しています…" },
  { label: "完了", message: "準備が整いました！" }
];
const LOGS_FETCH_LIMIT = 2000;


function ensureLogsLoader(app) {
  if (!app) {
    return;
  }
  if (typeof app.logsLoaderCurrentStep !== "number") {
    app.logsLoaderCurrentStep = 0;
  }
  if (!app.logsLoaderSetup && app.dom.logsLoaderSteps) {
    app.dom.logsLoaderSteps.innerHTML = LOGS_LOADER_STEPS.map(
      ({ label }, index) => `<li data-step="${index}">${escapeHtml(label)}</li>`
    ).join("");
    app.logsLoaderSetup = true;
  }
}

function isLogsPanelVisible(app) {
  const panel = app?.dom?.logsPanel;
  return !!(panel && !panel.hasAttribute("hidden"));
}

function showLogsLoader(app) {
  if (app?.dom?.logsLoadingOverlay) {
    app.dom.logsLoadingOverlay.removeAttribute("hidden");
  }
}

function hideLogsLoader(app) {
  if (app?.dom?.logsLoadingOverlay) {
    app.dom.logsLoadingOverlay.setAttribute("hidden", "");
  }
}

function maybeShowLogsLoader(app) {
  if (!app || app.logsLoaderCompleted) {
    return;
  }
  if (isLogsPanelVisible(app)) {
    showLogsLoader(app);
  }
}

function setLogsLoaderStep(app, stepIndex, { force = false } = {}) {
  if (!app) {
    return;
  }
  ensureLogsLoader(app);
  const steps = LOGS_LOADER_STEPS;
  const normalized = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const current = typeof app.logsLoaderCurrentStep === "number" ? app.logsLoaderCurrentStep : 0;
  if (!force && normalized < current) {
    return;
  }
  app.logsLoaderCurrentStep = normalized;
  const { message } = steps[normalized] || steps[0];
  if (app.dom.logsLoadingText) {
    app.dom.logsLoadingText.textContent = message;
  }
  const list = app.dom.logsLoaderSteps;
  if (list) {
    list.querySelectorAll("li").forEach((item, index) => {
      item.classList.toggle("current", index === normalized);
      item.classList.toggle("done", index < normalized);
    });
  }
  app.logsLoaderCompleted = normalized >= steps.length - 1;
  if (!app.logsLoaderCompleted) {
    maybeShowLogsLoader(app);
  }
}

function completeLogsLoader(app) {
  if (!app) {
    return;
  }
  setLogsLoaderStep(app, LOGS_LOADER_STEPS.length - 1, { force: true });
  app.logsLoaderCompleted = true;
  app.logsLoaded = true;
  hideLogsLoader(app);
}

function completeLogsLoaderIfReady(app) {
  if (!app) {
    return;
  }
  if (app.logsLoaderCompleted) {
    return;
  }
  if (app.logsLoaderHasData && app.logsLoaderMonitorReady) {
    completeLogsLoader(app);
  }
}

export function resetLogsLoader(app) {
  if (!app) {
    return;
  }
  ensureLogsLoader(app);
  app.logsLoaded = false;
  app.logsLoaderHasData = false;
  app.logsLoaderMonitorReady = false;
  app.logsLoaderCompleted = false;
  setLogsLoaderStep(app, 0, { force: true });
  hideLogsLoader(app);
}

export async function fetchLogs(app) {
  setLogsLoaderStep(app, 1);
  try {
    const logsQuery = query(ref(database, 'logs/history'), orderByChild('timestamp'), limitToLast(LOGS_FETCH_LIMIT));
    const snapshot = await get(logsQuery);
    const exists = snapshot && typeof snapshot.exists === 'function' ? snapshot.exists() : false;
    const branch = exists ? snapshot.val() : {};
    const rows = branch && typeof branch === 'object'
      ? Object.entries(branch).map(([id, entry]) => ({
          id,
          Timestamp: entry?.Timestamp ?? entry?.timestamp ?? '',
          timestamp: typeof entry?.timestamp === 'number' ? entry.timestamp : parseLogTimestamp(entry?.Timestamp)?.getTime() || 0,
          User: entry?.User ?? entry?.user ?? '',
          Action: entry?.Action ?? entry?.action ?? '',
          Details: entry?.Details ?? entry?.details ?? '',
          Level: entry?.Level ?? entry?.level ?? '',
          raw: entry || {}
        }))
      : [];
    rows.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    app.state.allLogs = rows;
    renderLogs(app);
  } catch (error) {
    console.error('ログの取得に失敗しました', error);
    hideLogsLoader(app);
    app.toast?.('ログの取得に失敗: ' + (error?.message || '不明なエラー'), 'error');
  }
}

export function renderLogs(app) {
  if (!app.logsLoaderHasData) {
    setLogsLoaderStep(app, 3);
  }
  const rows = applyLogFilters(app, app.state.allLogs || []);
  renderLogsStream(app, rows);
  app.logsLoaderHasData = true;
  completeLogsLoaderIfReady(app);
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
  if (!nextOpen) {
    hideLogsLoader(app);
  } else if (!app.logsLoaded) {
    maybeShowLogsLoader(app);
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
  app.logsLoaderMonitorReady = true;
  setLogsLoaderStep(app, 4);
  completeLogsLoaderIfReady(app);
}

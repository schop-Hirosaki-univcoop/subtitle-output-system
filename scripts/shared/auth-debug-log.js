// auth-debug-log.js: 認証フローまわりのデバッグログを永続化しつつコンソールへ出力するユーティリティ。
const LOG_STORAGE_KEY = "sos:authDebugLog";
const MAX_LOG_ENTRIES = 200;

function safeGetStorage() {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch (error) {
    console.warn("Session storage unavailable for auth debug log", error);
  }
  return null;
}

function normalizeDetail(value, seen = new Set()) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: value.code
    };
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => normalizeDetail(item, seen));
  }
  const entries = Object.entries(value).slice(0, 20);
  const normalized = {};
  for (const [key, val] of entries) {
    normalized[key] = normalizeDetail(val, seen);
  }
  return normalized;
}

function readLog(storage) {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(LOG_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to read auth debug log", error);
    return [];
  }
}

function writeLog(storage, entries) {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn("Failed to persist auth debug log", error);
  }
}

function consoleForLevel(level = "info") {
  const method = typeof level === "string" ? level.toLowerCase() : "log";
  return console[method] ? console[method].bind(console) : console.log.bind(console);
}

export function appendAuthDebugLog(event, detail = undefined, { level = "info" } = {}) {
  const storage = safeGetStorage();
  const entries = readLog(storage);
  const entry = {
    event: String(event || "unknown"),
    detail: normalizeDetail(detail),
    level: level || "info",
    timestamp: Date.now()
  };
  entries.push(entry);
  while (entries.length > MAX_LOG_ENTRIES) {
    entries.shift();
  }
  writeLog(storage, entries);

  const logFn = consoleForLevel(entry.level);
  if (detail !== undefined) {
//    logFn(`[auth-debug] ${entry.event}`, detail);
  } else {
//    logFn(`[auth-debug] ${entry.event}`);
  }
  return entry;
}

export function replayAuthDebugLog({ label = "[auth-debug] Persistent log", level = "groupCollapsed", clear = false } = {}) {
  const storage = safeGetStorage();
  const entries = readLog(storage);
  if (!entries.length) {
    return entries;
  }

  const consoleGroup = typeof console[level] === "function" ? console[level].bind(console) : console.groupCollapsed.bind(console);
  consoleGroup(label, { count: entries.length });
  try {
    entries.forEach((entry) => {
      const logFn = consoleForLevel(entry.level);
      if (entry.detail !== undefined) {
        logFn(`↳ ${new Date(entry.timestamp).toISOString()} :: ${entry.event}`, entry.detail);
      } else {
        logFn(`↳ ${new Date(entry.timestamp).toISOString()} :: ${entry.event}`);
      }
    });
  } finally {
    if (typeof console.groupEnd === "function") {
      console.groupEnd();
    }
  }

  if (clear) {
    writeLog(storage, []);
  }
  return entries;
}

export function clearAuthDebugLog() {
  const storage = safeGetStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(LOG_STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear auth debug log", error);
  }
}

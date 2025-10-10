import { GENRE_OPTIONS } from "./constants.js";

export function escapeHtml(value) {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function normalizeUpdatedAt(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

export function formatRelative(ms) {
  if (!ms) return "—";
  const diff = Math.max(0, Date.now() - ms);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

export function formatOperatorName(name) {
  return String(name ?? "").trim();
}

export function normKey(key) {
  return String(key || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const GENRE_LOOKUP = new Map(GENRE_OPTIONS.map((label) => [normKey(label), label]));

export function resolveGenreLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "その他";
  const mapped = GENRE_LOOKUP.get(normKey(raw));
  return mapped || raw;
}

export function parseLogTimestamp(ts) {
  if (ts == null) return null;
  if (ts instanceof Date && !isNaN(ts)) return ts;
  if (typeof ts === "number") {
    if (ts > 1e12) return new Date(ts);
    if (ts > 1e10) return new Date(ts * 1000);
    const ms = (ts - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof ts === "string") {
    let s = ts.trim();
    if (!s) return null;
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
      const [dPart, tPart = "00:00:00"] = s.split(" ");
      const [y, m, d] = dPart.split("/").map(Number);
      const [hh = 0, mm = 0, ss = 0] = tPart.split(":").map(Number);
      return new Date(y, m - 1, d, hh, mm, ss);
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
      s = s.replace(" ", "T");
    }
    const date = new Date(s);
    if (!isNaN(date)) return date;
  }
  return null;
}

export function getLogLevel(log) {
  const action = String(log.Action || "").toLowerCase();
  const details = String(log.Details || "").toLowerCase();
  if (/(error|failed|exception|timeout|unauthorized|forbidden|denied)/.test(action + details)) return "error";
  if (/\b5\d{2}\b|\b4\d{2}\b/.test(details)) return "error";
  if (/(delete|clear|remove|reset|unanswer)/.test(action)) return "warn";
  if (/(display|send|answer|set_answered|batch_set_answered|edit|add|toggle|update)/.test(action)) return "success";
  if (/(fetch|read|log|whoami)/.test(action)) return "info";
  return "info";
}

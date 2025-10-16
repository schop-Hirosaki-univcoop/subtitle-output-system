import { GENRE_OPTIONS } from "./constants.js";

const HAS_INTL = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
const SCHEDULE_DATE_FORMATTER = HAS_INTL
  ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
  : null;
const SCHEDULE_TIME_FORMATTER = HAS_INTL
  ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false })
  : null;

export function escapeHtml(value) {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderRubyHtml(text, dictionaryEntries = []) {
  const source = String(text ?? "");
  const normalized = source.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (typeof document === "undefined") {
    return escapeHtml(normalized);
  }

  const container = document.createElement("div");
  container.textContent = normalized;

  const entries = Array.isArray(dictionaryEntries)
    ? dictionaryEntries
        .map((entry) => ({
          term: String(entry?.term ?? "").trim(),
          ruby: String(entry?.ruby ?? "").trim()
        }))
        .filter((entry) => entry.term && entry.ruby)
    : [];

  if (!entries.length) {
    return container.innerHTML;
  }

  applyRubyToContainer(container, entries);
  return container.innerHTML;
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

function parseDateTimeValue(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed)) {
    const delimiter = trimmed.includes("/") ? "/" : "-";
    const [year, month, day] = trimmed.split(delimiter).map(Number);
    if ([year, month, day].some(Number.isNaN)) return null;
    return new Date(year, month - 1, day);
  }
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    const normalized = trimmed.replace(" ", "T");
    const [datePart, timePart] = normalized.split("T");
    const dateSegments = datePart.split(/[/-]/).map(Number);
    const timeSegments = timePart.split(":").map(Number);
    if ([...dateSegments, ...timeSegments].some(Number.isNaN)) return null;
    const [year, month, day] = dateSegments;
    const [hour, minute, second = 0] = timeSegments;
    return new Date(year, month - 1, day, hour, minute, second);
  }
  const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
  const fallback = normalized.includes("/") ? normalized.replace(/\//g, "-") : normalized;
  const parsed = new Date(fallback);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (SCHEDULE_DATE_FORMATTER) return SCHEDULE_DATE_FORMATTER.format(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function formatTimeDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (SCHEDULE_TIME_FORMATTER) return SCHEDULE_TIME_FORMATTER.format(date);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function formatScheduleRange(startValue, endValue) {
  const start = parseDateTimeValue(startValue);
  const end = parseDateTimeValue(endValue);
  if (!start && !end) return "";
  if (start && end) {
    const startDateText = formatDateDisplay(start);
    const startTimeText = formatTimeDisplay(start);
    const endTimeText = formatTimeDisplay(end);
    if (startDateText && startTimeText && endTimeText) {
      const sameDay = start.toDateString() === end.toDateString();
      const endDateText = sameDay ? "" : formatDateDisplay(end);
      const endPart = endDateText ? `${endDateText} ${endTimeText}` : endTimeText;
      return `${startDateText} ${startTimeText}〜${endPart}`;
    }
    if (startDateText && startTimeText) {
      return `${startDateText} ${startTimeText}〜`;
    }
    if (startDateText) {
      return startDateText;
    }
  }
  if (start) {
    const startDateText = formatDateDisplay(start);
    const startTimeText = formatTimeDisplay(start);
    if (startDateText && startTimeText) {
      return `${startDateText} ${startTimeText}〜`;
    }
    return startDateText;
  }
  if (end) {
    const endDateText = formatDateDisplay(end);
    const endTimeText = formatTimeDisplay(end);
    if (endDateText && endTimeText) {
      return `${endDateText} 〜${endTimeText}`;
    }
    return endDateText;
  }
  return "";
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

function applyRubyToContainer(container, entries) {
  const sorted = [...entries].sort((a, b) => b.term.length - a.term.length);
  const entryMap = new Map();
  sorted.forEach((entry) => {
    if (!entryMap.has(entry.term)) {
      entryMap.set(entry.term, entry.ruby);
    }
  });
  if (!entryMap.size) {
    return;
  }
  const patternSource = Array.from(entryMap.keys())
    .map((term) => escapeRegExp(term))
    .join("|");
  if (!patternSource) {
    return;
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => {
    const value = node.nodeValue;
    if (!value) return;
    const regex = new RegExp(patternSource, "g");
    let match;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    while ((match = regex.exec(value)) !== null) {
      const index = match.index;
      if (index > lastIndex) {
        fragment.appendChild(document.createTextNode(value.slice(lastIndex, index)));
      }
      const term = match[0];
      const rubyText = entryMap.get(term);
      if (rubyText) {
        const rubyEl = document.createElement("ruby");
        rubyEl.appendChild(document.createTextNode(term));
        const rtEl = document.createElement("rt");
        rtEl.textContent = rubyText;
        rubyEl.appendChild(rtEl);
        fragment.appendChild(rubyEl);
      } else {
        fragment.appendChild(document.createTextNode(term));
      }
      lastIndex = index + term.length;
    }
    if (lastIndex === 0) {
      return;
    }
    if (lastIndex < value.length) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
    node.replaceWith(fragment);
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

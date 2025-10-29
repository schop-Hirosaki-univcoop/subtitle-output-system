// utils.js: 日付フォーマットや補助的なユーティリティ関数を提供します。
import { GENRE_OPTIONS } from "./constants.js";

const HAS_INTL = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
const SCHEDULE_DATE_FORMATTER = HAS_INTL
  ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })
  : null;
const SCHEDULE_TIME_FORMATTER = HAS_INTL
  ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false })
  : null;

/**
 * HTML特殊文字をエスケープしてXSSを防止します。
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 辞書エントリを参照してrubyタグ付きHTML文字列を生成します。
 * DOM APIがない環境では純粋なテキストエスケープのみ行います。
 * @param {unknown} text
 * @param {Array<{ term?: string, ruby?: string }>} [dictionaryEntries]
 * @returns {string}
 */
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

/**
 * 更新日時フィールドをミリ秒に正規化します。
 * Firestore TimestampやRTDBの数値を考慮します。
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeUpdatedAt(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.seconds) return value.seconds * 1000;
  return 0;
}

/**
 * 現在時刻からの相対時間を日本語表記で返します。
 * @param {number} ms - Unixミリ秒
 * @returns {string}
 */
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

/**
 * オペレーター名をトリムし、未設定時は空文字を返します。
 * @param {unknown} name
 * @returns {string}
 */
export function formatOperatorName(name) {
  return String(name ?? "").trim();
}

/**
 * ジャンル検索用のキーを正規化します。
 * NFKC正規化・ゼロ幅スペース除去・小文字化を実施します。
 * @param {unknown} key
 * @returns {string}
 */
export function normKey(key) {
  return String(key || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

const GENRE_LOOKUP = new Map(GENRE_OPTIONS.map((label) => [normKey(label), label]));

/**
 * ジャンル選択値を既知の候補ラベルに変換します。
 * 未知の値はそのまま返し、空の場合は「その他」を返します。
 * @param {unknown} value
 * @returns {string}
 */
export function resolveGenreLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "その他";
  const mapped = GENRE_LOOKUP.get(normKey(raw));
  return mapped || raw;
}

/**
 * 各種日付表現をDateに変換します。
 * 文字列・数値いずれにも対応し、不正な値はnullを返します。
 * @param {unknown} value
 * @returns {Date|null}
 */
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

/**
 * Dateを日付表示用(YYYY/MM/DD)の文字列に変換します。
 * Intlが利用できない環境も考慮します。
 * @param {Date} date
 * @returns {string}
 */
function formatDateDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (SCHEDULE_DATE_FORMATTER) return SCHEDULE_DATE_FORMATTER.format(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

/**
 * Dateから時刻部分(HH:mm)の文字列を生成します。
 * @param {Date} date
 * @returns {string}
 */
function formatTimeDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (SCHEDULE_TIME_FORMATTER) return SCHEDULE_TIME_FORMATTER.format(date);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * 開始・終了日時から日本語の表示レンジ文字列を生成します。
 * 片方のみ指定された場合も破綻しないようにフォールバックします。
 * @param {unknown} startValue
 * @param {unknown} endValue
 * @returns {string}
 */
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

/**
 * 各種タイムスタンプ形式をDateに変換します。
 * Excel系列値やUnix秒/ミリ秒を考慮します。
 * @param {unknown} ts
 * @returns {Date|null}
 */
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

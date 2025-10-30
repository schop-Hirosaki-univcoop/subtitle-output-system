// schedule-format.js: 日程情報をユーザー向けに整形するフォーマッター群を提供します。
import { ensureTrimmedString } from "./value-utils.js";

// Intl.DateTimeFormat を利用可能か判定し、日付フォーマットに使用します。
const hasIntlDateTime = typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function";
const DATE_FORMATTER = hasIntlDateTime
  ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
  : null;
const TIME_FORMATTER = hasIntlDateTime
  ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false })
  : null;

/**
 * 文字列化された日時表現をDateオブジェクトに変換します。
 * 日付のみ/日時/ISO形式など複数のフォーマットに対応します。
 * @param {unknown} value
 * @returns {Date|null}
 */
export function parseDateTimeValue(value) {
  const trimmed = ensureTrimmedString(value);
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    if ([year, month, day].some(Number.isNaN)) return null;
    return new Date(year, month - 1, day);
  }
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) {
    const normalized = trimmed.replace(" ", "T");
    const [datePart, timePart] = normalized.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const timeParts = timePart.split(":").map(Number);
    if ([year, month, day, ...timeParts].some(Number.isNaN)) return null;
    const [hour, minute, second = 0] = timeParts;
    return new Date(year, month - 1, day, hour, minute, second);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Dateオブジェクトをユーザー向けの年月日表示へ整形します。
 * Intlが利用できない環境ではISOフォーマットを簡易利用します。
 * @param {Date} date
 * @returns {string}
 */
export function formatDateDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (DATE_FORMATTER) return DATE_FORMATTER.format(date);
  return date.toISOString().split("T")[0];
}

/**
 * Dateオブジェクトから時刻部分を抽出し、24時間表記で返します。
 * @param {Date} date
 * @returns {string}
 */
export function formatTimeDisplay(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  if (TIME_FORMATTER) return TIME_FORMATTER.format(date);
  return date.toTimeString().slice(0, 5);
}

/**
 * 質問フォームに表示する日程概要テキストを組み立てます。
 * ラベルや開始/終了時刻を柔軟に扱い、可能な限り情報を含めます。
 * @param {{ label?: string, date?: string, start?: string, end?: string }} [options]
 * @returns {string}
 */
export function formatScheduleSummary({ label = "", date = "", start = "", end = "" } = {}) {
  const trimmedLabel = ensureTrimmedString(label);
  const trimmedDate = ensureTrimmedString(date);
  const startDate = parseDateTimeValue(start);
  const endDate = parseDateTimeValue(end);
  const baseDate = startDate || parseDateTimeValue(trimmedDate);
  const fallback = trimmedLabel || trimmedDate;

  if (!baseDate && !fallback) {
    return "未設定";
  }

  const dateText = baseDate ? formatDateDisplay(baseDate) : "";
  if (!dateText) {
    return fallback || "未設定";
  }

  let timeText = "";
  if (startDate) {
    const startTime = formatTimeDisplay(startDate);
    if (startTime) {
      if (endDate && !Number.isNaN(endDate.getTime())) {
        const endTime = formatTimeDisplay(endDate);
        if (endTime) {
          if (startDate.toDateString() === endDate.toDateString()) {
            timeText = `${startTime}〜${endTime}`;
          } else {
            const endDateText = formatDateDisplay(endDate);
            timeText = endDateText ? `${startTime}〜${endDateText} ${endTime}` : `${startTime}〜${endTime}`;
          }
        }
      } else {
        timeText = `${startTime}〜`;
      }
    }
  }

  const rangeText = timeText ? `${dateText} ${timeText}` : dateText;
  if (!rangeText) {
    return fallback || "未設定";
  }

  const labelSuffix = trimmedLabel && trimmedLabel !== dateText ? `（${trimmedLabel}）` : "";
  return `${rangeText}${labelSuffix}`;
}

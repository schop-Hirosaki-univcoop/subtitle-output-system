import { test } from 'node:test';
import assert from 'node:assert/strict';

// question-admin/calendar.js は DOM 依存があるため、純粋関数のロジックを再現してテスト
// formatDatePart, formatTimePart, parseDateOnly, normalizeDateInputValue, combineDateAndTime, startOfDay, startOfMonth, isSameDay, formatMonthTitle, MS_PER_DAY をテスト

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// formatDatePart のロジックを再現
function formatDatePart(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// formatTimePart のロジックを再現
function formatTimePart(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// parseDateOnly のロジックを再現
function parseDateOnly(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.length <= 10 ? `${trimmed}T00:00` : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

// normalizeDateInputValue のロジックを再現
function normalizeDateInputValue(value) {
  const parsed = parseDateOnly(value || "");
  return parsed ? formatDatePart(parsed) : "";
}

// formatDateTimeLocal のロジックを再現
function formatDateTimeLocal(date) {
  return `${formatDatePart(date)}T${formatTimePart(date)}`;
}

// combineDateAndTime のロジックを再現
function combineDateAndTime(dateValue, timeValue) {
  const datePart = normalizeDateInputValue(dateValue);
  const timePart = String(timeValue || "").trim();
  if (!datePart || !timePart) return "";
  return `${datePart}T${timePart}`;
}

// startOfDay のロジックを再現
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// startOfMonth のロジックを再現
function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// isSameDay のロジックを再現
function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// formatMonthTitle のロジックを再現（Intl.DateTimeFormat を使用）
function formatMonthTitle(date) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long"
  });
  return formatter.format(date);
}

test('MS_PER_DAY constant is defined', () => {
  assert.equal(MS_PER_DAY, 24 * 60 * 60 * 1000);
  assert.equal(MS_PER_DAY, 86400000);
});

test('formatDatePart formats date as YYYY-MM-DD', () => {
  const date = new Date(2025, 4, 10); // May 10, 2025
  assert.equal(formatDatePart(date), '2025-05-10');
});

test('formatDatePart pads month and day with zeros', () => {
  const date = new Date(2025, 0, 5); // January 5, 2025
  assert.equal(formatDatePart(date), '2025-01-05');
});

test('formatTimePart formats time as HH:MM', () => {
  const date = new Date(2025, 4, 10, 14, 30); // 14:30
  assert.equal(formatTimePart(date), '14:30');
});

test('formatTimePart pads hours and minutes with zeros', () => {
  const date = new Date(2025, 4, 10, 9, 5); // 09:05
  assert.equal(formatTimePart(date), '09:05');
});

test('parseDateOnly parses date-only strings', () => {
  const date = parseDateOnly('2025-05-10');
  assert(date instanceof Date);
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 10);
});

test('parseDateOnly parses datetime strings', () => {
  const date = parseDateOnly('2025-05-10T14:30:00');
  assert(date instanceof Date);
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 10);
});

test('parseDateOnly returns null for invalid input', () => {
  assert.equal(parseDateOnly(null), null);
  assert.equal(parseDateOnly(undefined), null);
  assert.equal(parseDateOnly(''), null);
  assert.equal(parseDateOnly('invalid'), null);
});

test('normalizeDateInputValue normalizes date input to YYYY-MM-DD', () => {
  assert.equal(normalizeDateInputValue('2025-05-10'), '2025-05-10');
  assert.equal(normalizeDateInputValue('2025-05-10T14:30:00'), '2025-05-10');
});

test('normalizeDateInputValue returns empty string for invalid input', () => {
  assert.equal(normalizeDateInputValue(null), '');
  assert.equal(normalizeDateInputValue(undefined), '');
  assert.equal(normalizeDateInputValue(''), '');
  assert.equal(normalizeDateInputValue('invalid'), '');
});

test('formatDateTimeLocal formats date and time', () => {
  const date = new Date(2025, 4, 10, 14, 30);
  assert.equal(formatDateTimeLocal(date), '2025-05-10T14:30');
});

test('combineDateAndTime combines date and time values', () => {
  assert.equal(combineDateAndTime('2025-05-10', '14:30'), '2025-05-10T14:30');
  assert.equal(combineDateAndTime('2025-05-10T00:00', '14:30'), '2025-05-10T14:30');
});

test('combineDateAndTime returns empty string when date or time is missing', () => {
  assert.equal(combineDateAndTime('', '14:30'), '');
  assert.equal(combineDateAndTime('2025-05-10', ''), '');
  assert.equal(combineDateAndTime(null, '14:30'), '');
  assert.equal(combineDateAndTime('2025-05-10', null), '');
});

test('combineDateAndTime trims time value', () => {
  assert.equal(combineDateAndTime('2025-05-10', '  14:30  '), '2025-05-10T14:30');
});

test('startOfDay sets time to 00:00:00.000', () => {
  const date = new Date(2025, 4, 10, 14, 30, 45, 123);
  const start = startOfDay(date);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(start.getMilliseconds(), 0);
  assert.equal(start.getDate(), 10);
});

test('startOfMonth sets date to first day and time to 00:00:00.000', () => {
  const date = new Date(2025, 4, 10, 14, 30);
  const start = startOfMonth(date);
  assert.equal(start.getDate(), 1);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getMonth(), 4);
  assert.equal(start.getFullYear(), 2025);
});

test('isSameDay returns true for same day', () => {
  const date1 = new Date(2025, 4, 10, 10, 0);
  const date2 = new Date(2025, 4, 10, 20, 0);
  assert.equal(isSameDay(date1, date2), true);
});

test('isSameDay returns false for different days', () => {
  const date1 = new Date(2025, 4, 10);
  const date2 = new Date(2025, 4, 11);
  assert.equal(isSameDay(date1, date2), false);
});

test('isSameDay returns false for different months', () => {
  const date1 = new Date(2025, 4, 10);
  const date2 = new Date(2025, 5, 10);
  assert.equal(isSameDay(date1, date2), false);
});

test('isSameDay returns false for different years', () => {
  const date1 = new Date(2025, 4, 10);
  const date2 = new Date(2024, 4, 10);
  assert.equal(isSameDay(date1, date2), false);
});

test('formatMonthTitle formats month title in Japanese', () => {
  const date = new Date(2025, 4, 10); // May
  const formatted = formatMonthTitle(date);
  assert(typeof formatted === 'string');
  assert(formatted.length > 0);
  // Intl が利用可能な場合、日本語形式でフォーマットされる
  assert(formatted.includes('2025') || formatted.includes('5'));
});

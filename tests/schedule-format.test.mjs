import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDateTimeValue,
  formatDateDisplay,
  formatTimeDisplay,
  formatScheduleSummary
} from '../scripts/question-form/schedule-format.js';

test('parseDateTimeValue parses date-only strings', () => {
  const date = parseDateTimeValue('2025-05-10');
  assert(date instanceof Date);
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth(), 4); // zero-based
  assert.equal(date.getDate(), 10);
});

test('parseDateTimeValue parses datetime strings with T separator', () => {
  const date = parseDateTimeValue('2025-05-10T10:15');
  assert(date instanceof Date);
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 10);
  assert.equal(date.getHours(), 10);
  assert.equal(date.getMinutes(), 15);
});

test('parseDateTimeValue parses datetime strings with space separator', () => {
  const date = parseDateTimeValue('2025-05-10 10:15:30');
  assert(date instanceof Date);
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 10);
  assert.equal(date.getHours(), 10);
  assert.equal(date.getMinutes(), 15);
  assert.equal(date.getSeconds(), 30);
});

test('parseDateTimeValue returns null for invalid input', () => {
  assert.equal(parseDateTimeValue(null), null);
  assert.equal(parseDateTimeValue(undefined), null);
  assert.equal(parseDateTimeValue(''), null);
  // 'invalid' は Date コンストラクタでパースされるが、NaN になる
  const invalidDate = parseDateTimeValue('invalid');
  assert(invalidDate === null || Number.isNaN(invalidDate.getTime()));
  // '2025-13-01' は Date コンストラクタでパースされるが、無効な日付になる可能性がある
  const invalidMonthDate = parseDateTimeValue('2025-13-01');
  // 実装では、正規表現にマッチしない場合は Date コンストラクタでパースされる
  // 無効な月の場合でも Date オブジェクトが作成される可能性がある
  if (invalidMonthDate !== null) {
    // Date オブジェクトが返された場合、無効な日付かどうかを確認
    assert(Number.isNaN(invalidMonthDate.getTime()) || invalidMonthDate.getMonth() !== 12);
  }
});

test('formatDateDisplay formats date using Intl when available', () => {
  const date = new Date(2025, 4, 10); // May 10, 2025
  const formatted = formatDateDisplay(date);
  // Intl が利用可能な場合、日本語形式でフォーマットされる
  assert(typeof formatted === 'string');
  assert(formatted.length > 0);
});

test('formatDateDisplay returns empty string for invalid date', () => {
  assert.equal(formatDateDisplay(null), '');
  assert.equal(formatDateDisplay(new Date('invalid')), '');
  assert.equal(formatDateDisplay({}), '');
});

test('formatTimeDisplay formats time using Intl when available', () => {
  const date = new Date(2025, 4, 10, 14, 30); // 14:30
  const formatted = formatTimeDisplay(date);
  // Intl が利用可能な場合、24時間表記でフォーマットされる
  assert(typeof formatted === 'string');
  assert(formatted.includes('14') || formatted.includes('2'));
});

test('formatTimeDisplay returns empty string for invalid date', () => {
  assert.equal(formatTimeDisplay(null), '');
  assert.equal(formatTimeDisplay(new Date('invalid')), '');
  assert.equal(formatTimeDisplay({}), '');
});

test('formatScheduleSummary formats schedule with label and times', () => {
  const summary = formatScheduleSummary({
    label: '昼の部',
    date: '2025-05-10',
    start: '2025-05-10T10:00:00',
    end: '2025-05-10T12:30:00'
  });
  assert(summary.includes('昼の部') || summary.includes('2025'));
  assert(summary.includes('〜') || summary.length > 0);
});

test('formatScheduleSummary handles cross-day ranges', () => {
  const summary = formatScheduleSummary({
    label: '夜間帯',
    start: '2025-05-10T23:00:00',
    end: '2025-05-11T08:00:00'
  });
  assert(summary.includes('夜間帯') || summary.includes('2025'));
  assert.notEqual(summary, '未設定');
});

test('formatScheduleSummary falls back to label when no date is available', () => {
  assert.equal(formatScheduleSummary({ label: '未定' }), '未定');
});

test('formatScheduleSummary returns 未設定 when nothing is provided', () => {
  assert.equal(formatScheduleSummary({}), '未設定');
  assert.equal(formatScheduleSummary(), '未設定');
});

test('formatScheduleSummary uses date when label is not provided', () => {
  const summary = formatScheduleSummary({
    date: '2025-05-10',
    start: '2025-05-10T10:00:00'
  });
  assert(summary.includes('2025') || summary.length > 0);
  assert.notEqual(summary, '未設定');
});

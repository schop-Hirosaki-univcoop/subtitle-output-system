import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_OPTION_VALUE,
  ensureString,
  parseTimestamp,
  formatPeriod,
  createUnitTreeFromArray,
  parseUnitOption,
  parseUnitLevel,
  formatScheduleRange,
  formatScheduleOption,
  parseFaculties,
  parseSchedules
} from '../scripts/gl-form/gl-form-utils.js';

test('CUSTOM_OPTION_VALUE is defined', () => {
  assert.equal(CUSTOM_OPTION_VALUE, '__custom');
});

test('ensureString normalizes values to trimmed strings', () => {
  assert.equal(ensureString(null), '');
  assert.equal(ensureString(undefined), '');
  assert.equal(ensureString('  value  '), 'value');
  assert.equal(ensureString(123), '123');
  assert.equal(ensureString(''), '');
});

test('parseTimestamp parses numeric timestamps', () => {
  assert.equal(parseTimestamp(1234567890000), 1234567890000);
  assert.equal(parseTimestamp('1234567890000'), 1234567890000);
  assert.equal(parseTimestamp(0), 0);
});

test('parseTimestamp parses date strings', () => {
  const timestamp = parseTimestamp('2025-01-15T10:30:00Z');
  assert(Number.isFinite(timestamp));
  assert(timestamp > 0);
});

test('parseTimestamp returns 0 for invalid values', () => {
  assert.equal(parseTimestamp(null), 0);
  assert.equal(parseTimestamp(undefined), 0);
  assert.equal(parseTimestamp(''), 0);
  assert.equal(parseTimestamp('invalid'), 0);
  assert.equal(parseTimestamp(NaN), 0);
});

test('formatPeriod formats period with start and end', () => {
  const startAt = new Date('2025-01-15T10:00:00+09:00').getTime();
  const endAt = new Date('2025-01-15T12:30:00+09:00').getTime();
  const result = formatPeriod(startAt, endAt);
  assert(result.includes('1/15'));
  assert(result.includes('〜'));
  assert(result.includes('10:00'));
  assert(result.includes('12:30'));
});

test('formatPeriod formats period with only start', () => {
  const startAt = new Date('2025-01-15T10:00:00+09:00').getTime();
  const result = formatPeriod(startAt, null);
  assert(result.includes('1/15'));
  assert(result.includes('10:00'));
  assert(result.includes('から募集開始'));
});

test('formatPeriod formats period with only end', () => {
  const endAt = new Date('2025-01-15T12:30:00+09:00').getTime();
  const result = formatPeriod(null, endAt);
  assert(result.includes('1/15'));
  assert(result.includes('12:30'));
  assert(result.includes('まで募集'));
});

test('formatPeriod returns empty string when both are null', () => {
  assert.equal(formatPeriod(null, null), '');
  assert.equal(formatPeriod(undefined, undefined), '');
});

test('createUnitTreeFromArray creates unit tree from array', () => {
  const result = createUnitTreeFromArray(['学科1', '学科2', '学科3'], '学科');
  assert.equal(result.label, '学科');
  assert.equal(result.placeholder, '学科を選択してください');
  assert.equal(result.allowCustom, true);
  assert.equal(result.options.length, 3);
  assert.equal(result.options[0].value, '学科1');
  assert.equal(result.options[0].label, '学科1');
});

test('createUnitTreeFromArray returns null for empty array', () => {
  assert.equal(createUnitTreeFromArray([], '学科'), null);
  assert.equal(createUnitTreeFromArray(['', '  ', '\t'], '学科'), null);
});

test('createUnitTreeFromArray returns null for non-array', () => {
  assert.equal(createUnitTreeFromArray(null, '学科'), null);
  assert.equal(createUnitTreeFromArray({}, '学科'), null);
});

test('parseUnitOption parses string value', () => {
  const result = parseUnitOption('学科名', 'fallback');
  assert.equal(result.value, '学科名');
  assert.equal(result.label, '学科名');
  assert.equal(result.children, null);
});

test('parseUnitOption parses number value', () => {
  const result = parseUnitOption(123, 'fallback');
  assert.equal(result.value, '123');
  assert.equal(result.label, '123');
});

test('parseUnitOption parses object with value and label', () => {
  const result = parseUnitOption({ value: 'val1', label: 'Label1' }, 'fallback');
  assert.equal(result.value, 'val1');
  assert.equal(result.label, 'Label1');
});

test('parseUnitOption uses fallback value when needed', () => {
  const result = parseUnitOption({ label: 'Label Only' }, 'fallback-value');
  assert.equal(result.value, 'fallback-value');
  assert.equal(result.label, 'Label Only');
});

test('parseUnitOption returns null for empty values', () => {
  assert.equal(parseUnitOption('', 'fallback'), null);
  assert.equal(parseUnitOption(null, 'fallback'), null);
  // 空のオブジェクトでも fallbackValue が提供されていれば、それを使用してオブジェクトを返す
  const result = parseUnitOption({}, 'fallback');
  assert.notEqual(result, null);
  assert.equal(result.value, 'fallback');
  assert.equal(result.label, 'fallback');
});

test('parseUnitLevel parses array of options', () => {
  const result = parseUnitLevel(['学科1', '学科2'], '学科');
  assert.equal(result.label, '学科');
  assert.equal(result.placeholder, '学科を選択してください');
  assert.equal(result.allowCustom, true);
  assert.equal(result.options.length, 2);
});

test('parseUnitLevel parses object with options', () => {
  const result = parseUnitLevel({
    label: '所属',
    placeholder: '選択してください',
    allowCustom: false,
    options: ['A', 'B']
  }, 'fallback');
  assert.equal(result.label, '所属');
  assert.equal(result.placeholder, '選択してください');
  assert.equal(result.allowCustom, false);
  assert.equal(result.options.length, 2);
});

test('parseUnitLevel returns null for invalid input', () => {
  assert.equal(parseUnitLevel(null, 'fallback'), null);
  assert.equal(parseUnitLevel('', 'fallback'), null);
  assert.equal(parseUnitLevel([], 'fallback'), null);
});

test('formatScheduleRange formats range with start and end on same day', () => {
  const startAt = new Date('2025-01-15T10:00:00+09:00').getTime();
  const endAt = new Date('2025-01-15T12:30:00+09:00').getTime();
  const result = formatScheduleRange(startAt, endAt, null);
  assert(result.includes('1/15'));
  assert(result.includes('10:00'));
  assert(result.includes('12:30'));
  assert(result.includes('〜'));
});

test('formatScheduleRange formats range across different days', () => {
  const startAt = new Date('2025-01-15T23:00:00+09:00').getTime();
  const endAt = new Date('2025-01-16T08:00:00+09:00').getTime();
  const result = formatScheduleRange(startAt, endAt, null);
  assert(result.includes('1/15'));
  assert(result.includes('1/16'));
});

test('formatScheduleRange uses fallback date when times are missing', () => {
  const result = formatScheduleRange(null, null, '2025-01-15');
  assert(result.includes('1/15'));
});

test('formatScheduleRange returns empty string when all inputs are missing', () => {
  assert.equal(formatScheduleRange(null, null, ''), '');
  assert.equal(formatScheduleRange(null, null, null), '');
});

test('formatScheduleOption formats schedule with range and label', () => {
  const schedule = {
    id: 'sch1',
    label: '昼の部',
    date: '2025-01-15',
    startAt: new Date('2025-01-15T10:00:00+09:00').getTime(),
    endAt: new Date('2025-01-15T12:30:00+09:00').getTime()
  };
  const result = formatScheduleOption(schedule);
  assert(result.includes('昼の部'));
  assert(result.includes('1/15'));
});

test('formatScheduleOption falls back to label when range is missing', () => {
  const schedule = {
    id: 'sch1',
    label: '未定',
    date: null,
    startAt: null,
    endAt: null
  };
  const result = formatScheduleOption(schedule);
  assert.equal(result, '未定');
});

test('formatScheduleOption falls back to id when label and range are missing', () => {
  const schedule = {
    id: 'sch1',
    label: '',
    date: null,
    startAt: null,
    endAt: null
  };
  const result = formatScheduleOption(schedule);
  assert.equal(result, 'sch1');
});

test('parseFaculties parses array of faculty strings', () => {
  const result = parseFaculties(['学部1', '学部2']);
  assert.equal(result.length, 2);
  assert.equal(result[0].faculty, '学部1');
  assert.equal(result[1].faculty, '学部2');
});

test('parseFaculties parses array of faculty objects', () => {
  const result = parseFaculties([
    { faculty: '学部1', units: ['学科1', '学科2'] },
    { faculty: '学部2', departments: ['学科3'] }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].faculty, '学部1');
  assert.equal(result[1].faculty, '学部2');
});

test('parseFaculties parses object with faculty entries', () => {
  const result = parseFaculties({
    f1: '学部1',
    f2: { faculty: '学部2', units: ['学科1'] }
  });
  assert(result.length >= 1);
});

test('parseFaculties filters out invalid entries', () => {
  const result = parseFaculties(['', null, '  ', 'valid']);
  assert.equal(result.length, 1);
  assert.equal(result[0].faculty, 'valid');
});

test('parseFaculties returns empty array for invalid input', () => {
  assert.deepEqual(parseFaculties(null), []);
  assert.deepEqual(parseFaculties(''), []);
  assert.deepEqual(parseFaculties([]), []);
});

test('parseSchedules parses array of schedules', () => {
  const result = parseSchedules([
    { id: 'sch1', label: '昼の部', date: '2025-01-15', startAt: 1234567890000, endAt: 1234567890000 },
    { id: 'sch2', label: '夜の部' }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'sch1');
  assert.equal(result[0].label, '昼の部');
  assert.equal(result[1].id, 'sch2');
});

test('parseSchedules parses object with schedule entries', () => {
  const result = parseSchedules({
    sch1: { id: 'sch1', label: '昼の部', startAt: 1234567890000 },
    sch2: { label: '夜の部' }
  });
  assert(result.length >= 1);
  assert.equal(result[0].id, 'sch1');
});

test('parseSchedules filters out entries without id', () => {
  const result = parseSchedules([
    { label: 'No ID' },
    { id: 'sch1', label: 'Valid' }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'sch1');
});

test('parseSchedules returns empty array for invalid input', () => {
  assert.deepEqual(parseSchedules(null), []);
  assert.deepEqual(parseSchedules(''), []);
  assert.deepEqual(parseSchedules([]), []);
});

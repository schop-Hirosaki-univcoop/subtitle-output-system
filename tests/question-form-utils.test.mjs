import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ensureTrimmedString, coalesceTrimmed } from '../scripts/question-form/value-utils.js';
import {
  formatScheduleSummary,
  parseDateTimeValue
} from '../scripts/question-form/schedule-format.js';
import {
  buildContextDescription,
  DEFAULT_CONTEXT_DESCRIPTION,
  CONTEXT_DESCRIPTION_SUFFIX
} from '../scripts/question-form/context-copy.js';
import {
  sanitizeSubmissionPayload,
  collectClientMetadata,
  generateQuestionUid,
  buildQuestionRecord
} from '../scripts/question-form/submission-utils.js';

test('ensureTrimmedString normalizes arbitrary values', () => {
  assert.equal(ensureTrimmedString(null), '');
  assert.equal(ensureTrimmedString(undefined), '');
  assert.equal(ensureTrimmedString('  value  '), 'value');
  assert.equal(ensureTrimmedString(123), '123');
});

test('coalesceTrimmed returns the first non-empty trimmed value', () => {
  assert.equal(coalesceTrimmed('   ', '\t', 'fallback'), 'fallback');
  assert.equal(coalesceTrimmed('', 0, 'later'), '0');
  assert.equal(coalesceTrimmed(null, undefined, ' result '), 'result');
});

test('parseDateTimeValue accepts date strings with space separators', () => {
  const parsed = parseDateTimeValue('2025-05-10 10:15');
  assert(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2025);
  assert.equal(parsed.getMonth(), 4); // zero-based
  assert.equal(parsed.getDate(), 10);
  assert.equal(parsed.getHours(), 10);
  assert.equal(parsed.getMinutes(), 15);
});

test('formatScheduleSummary formats detailed schedules with label and times', () => {
  const summary = formatScheduleSummary({
    label: '昼の部',
    date: '2025-05-10',
    start: '2025-05-10T10:00:00+09:00',
    end: '2025-05-10T12:30:00+09:00'
  });
  assert(summary.includes('昼の部'));
  assert(summary.includes('〜'));
  assert(summary.includes('2025'));
});

test('formatScheduleSummary handles cross-day ranges gracefully', () => {
  const summary = formatScheduleSummary({
    label: '夜間帯',
    start: '2025-05-10 23:00',
    end: '2025-05-11T08:00:00+09:00'
  });
  assert(summary.includes('夜間帯'));
  assert(summary.includes('〜'));
  assert(summary.includes('2025'));
  assert.notEqual(summary, '未設定');
});

test('formatScheduleSummary falls back to label when no date is available', () => {
  assert.equal(formatScheduleSummary({ label: '未定' }), '未定');
});

test('formatScheduleSummary returns 未設定 when nothing is provided', () => {
  assert.equal(formatScheduleSummary({}), '未設定');
});

test('buildContextDescription uses default copy for blank event names', () => {
  assert.equal(buildContextDescription(''), DEFAULT_CONTEXT_DESCRIPTION);
});

test('buildContextDescription injects the event name and suffix', () => {
  const description = buildContextDescription('春フェス2025');
  assert(description.includes('春フェス2025'));
  assert(description.endsWith(`。${CONTEXT_DESCRIPTION_SUFFIX}`));
});

test('sanitizeSubmissionPayload trims strings and strips zero-width characters', () => {
  const payload = sanitizeSubmissionPayload({
    radioName: '  テスター\u200B ',
    empty: '',
    number: 42,
    truthy: true,
    nan: Number.NaN,
    skip: null
  });
  assert.deepEqual(payload, {
    radioName: 'テスター',
    empty: '',
    number: 42,
    truthy: true,
    nan: ''
  });
});

test('collectClientMetadata sanitizes navigator and location sources', () => {
  const metadata = collectClientMetadata({
    navigator: {
      languages: [' ja-JP ', '', ''],
      language: ' en-US ',
      userAgent: '  CustomAgent/1.0  '
    },
    document: { referrer: ' https://example.com/page ' },
    location: { origin: '', protocol: 'https:', host: 'example.org' },
    now: () => 123456789
  });
  assert.equal(metadata.language, 'ja-JP');
  assert.equal(metadata.userAgent, 'CustomAgent/1.0');
  assert.equal(metadata.referrer, 'https://example.com/page');
  assert.equal(metadata.origin, 'https://example.org');
  assert.equal(metadata.timestamp, 123456789);
});

test('collectClientMetadata falls back to Date.now when now() is invalid', () => {
  const metadata = collectClientMetadata({ now: () => Number.NaN });
  assert(Number.isFinite(metadata.timestamp));
});

test('generateQuestionUid prefers crypto.randomUUID when available', () => {
  const uid = generateQuestionUid({
    crypto: {
      randomUUID: () => '12345678-1234-1234-1234-123456789abc'
    }
  });
  assert.equal(uid, 'q_12345678-1234-1234-1234-123456789abc');
});

test('generateQuestionUid falls back to pseudo-random values', () => {
  const uid = generateQuestionUid({ crypto: {}, random: () => 0.5, now: () => 987654321 });
  const timestampPart = Number(987654321).toString(36);
  assert(uid.startsWith(`q_${timestampPart}_`));
  assert(uid.length > `q_${timestampPart}_`.length);
});

test('buildQuestionRecord merges submission data with context defaults', () => {
  const record = buildQuestionRecord({
    uid: 'q_test',
    token: ' token-value ',
    submission: {
      radioName: '  テスター ',
      question: '  質問 ',
      groupNumber: '',
      genre: '活動',
      scheduleLabel: '',
      scheduleDate: '',
      scheduleStart: '',
      scheduleEnd: '',
      eventId: '',
      eventName: '',
      scheduleId: '',
      participantId: '',
      participantName: '',
      guidance: '',
      questionLength: 12
    },
    context: {
      groupNumber: 'A-1',
      scheduleLabel: '昼の部',
      scheduleDate: '2025-05-10',
      scheduleStart: '2025-05-10T10:00',
      scheduleEnd: '2025-05-10T12:00',
      participantId: 'P-001',
      participantName: ' 参加者 ',
      guidance: '  ご案内 ',
      eventId: 'EVT-1',
      eventName: 'イベント',
      scheduleId: 'SCH-1'
    },
    timestamp: 1700000000000
  });

  assert.equal(record.uid, 'q_test');
  assert.equal(record.token, 'token-value');
  assert.equal(record.name, 'テスター');
  assert.equal(record.question, '質問');
  assert.equal(record.group, 'A-1');
  assert.equal(record.schedule, '昼の部');
  assert.equal(record.scheduleStart, '2025-05-10T10:00');
  assert.equal(record.scheduleEnd, '2025-05-10T12:00');
  assert.equal(record.scheduleDate, '2025-05-10');
  assert.equal(record.participantId, 'P-001');
  assert.equal(record.participantName, '参加者');
  assert.equal(record.guidance, 'ご案内');
  assert.equal(record.eventId, 'EVT-1');
  assert.equal(record.eventName, 'イベント');
  assert.equal(record.scheduleId, 'SCH-1');
  assert.equal(record.questionLength, 12);
  assert.equal(record.type, 'normal');
});

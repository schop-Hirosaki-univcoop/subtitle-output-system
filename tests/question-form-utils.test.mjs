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
import {
  buildSubmissionPayload,
  createSubmissionController,
  ensureControllerActive,
  isSubmissionAbortError
} from '../scripts/question-form/submission-service.js';

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
    infinite: Number.POSITIVE_INFINITY,
    skip: null
  });
  assert.deepEqual(payload, {
    radioName: 'テスター',
    empty: '',
    number: 42,
    truthy: true,
    nan: '',
    infinite: ''
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

test('generateQuestionUid recovers from invalid random values with deterministic suffixes', () => {
  const timestamp = 777777777;
  const uid1 = generateQuestionUid({ crypto: {}, random: () => Number.NaN, now: () => timestamp });
  const uid2 = generateQuestionUid({ crypto: {}, random: () => Number.POSITIVE_INFINITY, now: () => timestamp });
  const prefix = `q_${Number(timestamp).toString(36)}`;
  assert(uid1.startsWith(prefix));
  assert(uid2.startsWith(prefix));
  assert.notEqual(uid1, uid2);
});

test('generateQuestionUid disambiguates repeated random outputs at the same timestamp', () => {
  const now = () => 135791113;
  const options = { crypto: {}, random: () => 0.5, now };
  const uid1 = generateQuestionUid(options);
  const uid2 = generateQuestionUid(options);
  assert.notEqual(uid1, uid2);
  assert(uid2.startsWith(`${uid1}_`));
  assert(uid2.length > uid1.length);
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

test('buildSubmissionPayload merges snapshot values and trims metadata', () => {
  const { submission, token } = buildSubmissionPayload({
    token: ' tok123 ',
    formData: {
      radioName: '  Listener  ',
      question: '  How are you?  ',
      questionLength: 6,
      genre: '活動'
    },
    snapshot: {
      groupNumber: ' G1 ',
      teamNumber: ' T1 ',
      scheduleLabel: ' 午前 ',
      scheduleDate: '2025-01-01',
      scheduleStart: '2025-01-01T09:00',
      scheduleEnd: '2025-01-01T10:00',
      eventId: ' event-1 ',
      eventName: ' 朝会 ',
      scheduleId: ' schedule-1 ',
      participantId: ' participant-1 ',
      participantName: ' 参加者 ',
      guidance: ' ご自由に '
    },
    metadataCollector: () => ({
      language: ' ja-JP ',
      userAgent: ' CustomAgent/1.0 ',
      referrer: ' https://ref.example/path ',
      origin: ' https://origin.example ',
      timestamp: 321654987
    }),
    formVersion: 'test@1'
  });

  assert.equal(token, 'tok123');
  assert.equal(submission.radioName, 'Listener');
  assert.equal(submission.question, 'How are you?');
  assert.equal(submission.genre, '活動');
  assert.equal(submission.groupNumber, 'G1');
  assert.equal(submission.scheduleLabel, '午前');
  assert.equal(submission.eventName, '朝会');
  assert.equal(submission.formVersion, 'test@1');
  assert.equal(submission.language, 'ja-JP');
  assert.equal(submission.userAgent, 'CustomAgent/1.0');
  assert.equal(submission.referrer, 'https://ref.example/path');
  assert.equal(submission.origin, 'https://origin.example');
  assert.equal(submission.clientTimestamp, 321654987);
  assert.equal(submission.status, 'pending');
});

test('buildSubmissionPayload throws when token is missing', () => {
  assert.throws(
    () =>
      buildSubmissionPayload({
        token: '',
        formData: { radioName: 'A', question: 'B', questionLength: 2, genre: '学び' },
        snapshot: {},
        metadataCollector: () => ({})
      }),
    /アクセス情報が無効です/
  );
});

test('createSubmissionController exposes abort semantics', () => {
  const controller = createSubmissionController();
  assert.equal(controller.signal.aborted, false);
  controller.abort();
  assert.equal(controller.signal.aborted, true);
});

test('ensureControllerActive throws AbortError for aborted controller', () => {
  const controller = createSubmissionController();
  controller.abort();
  assert.throws(() => ensureControllerActive(controller), (error) => {
    assert(isSubmissionAbortError(error));
    return true;
  });
});

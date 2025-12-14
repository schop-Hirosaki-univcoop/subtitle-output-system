import { test } from 'node:test';
import assert from 'node:assert/strict';

import { derivePresenceScheduleKey } from '../scripts/shared/presence-keys.js';

test('derivePresenceScheduleKey returns scheduleKey when provided', () => {
  const result = derivePresenceScheduleKey('event-1', { scheduleKey: 'custom-key' });
  assert.equal(result, 'custom-key');
});

test('derivePresenceScheduleKey builds key from eventId and scheduleId', () => {
  const result = derivePresenceScheduleKey('event-1', { scheduleId: 'schedule-1' });
  assert.equal(result, 'event-1::schedule-1');
});

test('derivePresenceScheduleKey uses normalizeScheduleId for scheduleId', () => {
  // scheduleId が null の場合、normalizeString で空文字列になり、条件が false になるため eventId のみが返される
  const result = derivePresenceScheduleKey('event-1', { scheduleId: null });
  assert.equal(result, 'event-1');
});

test('derivePresenceScheduleKey returns normalized scheduleId when eventId is empty', () => {
  // eventId が空の場合、scheduleId がそのまま normalizeScheduleId で正規化される
  const result = derivePresenceScheduleKey('', { scheduleId: 'schedule-1' });
  assert.equal(result, 'schedule-1');
});

test('derivePresenceScheduleKey builds key from scheduleLabel', () => {
  const result = derivePresenceScheduleKey('event-1', { scheduleLabel: '昼の部' });
  assert.equal(result, 'event-1::label::昼の部');
});

test('derivePresenceScheduleKey sanitizes scheduleLabel', () => {
  const result = derivePresenceScheduleKey('event-1', { scheduleLabel: '昼 の 部' });
  assert.equal(result, 'event-1::label::昼 の 部');
  
  const result2 = derivePresenceScheduleKey('event-1', { scheduleLabel: '昼::の::部' });
  assert.equal(result2, 'event-1::label::昼／の／部');
});

test('derivePresenceScheduleKey returns label-only key when eventId is empty', () => {
  const result = derivePresenceScheduleKey('', { scheduleLabel: '昼の部' });
  assert.equal(result, 'label::昼の部');
});

test('derivePresenceScheduleKey builds session key from eventId and entryId', () => {
  const result = derivePresenceScheduleKey('event-1', {}, 'entry-1');
  assert.equal(result, 'event-1::session::entry-1');
});

test('derivePresenceScheduleKey returns entryId when only entryId is provided', () => {
  const result = derivePresenceScheduleKey('', {}, 'entry-1');
  assert.equal(result, 'entry-1');
});

test('derivePresenceScheduleKey returns eventId when only eventId is provided', () => {
  const result = derivePresenceScheduleKey('event-1', {});
  assert.equal(result, 'event-1');
});

test('derivePresenceScheduleKey returns empty string when nothing is provided', () => {
  const result = derivePresenceScheduleKey('', {});
  assert.equal(result, '');
});

test('derivePresenceScheduleKey handles null and undefined values', () => {
  assert.equal(derivePresenceScheduleKey(null, null, null), '');
  assert.equal(derivePresenceScheduleKey(undefined, undefined, undefined), '');
  assert.equal(derivePresenceScheduleKey('event-1', null, null), 'event-1');
  assert.equal(derivePresenceScheduleKey('event-1', undefined, undefined), 'event-1');
});

test('derivePresenceScheduleKey prioritizes scheduleKey over scheduleId', () => {
  const result = derivePresenceScheduleKey('event-1', {
    scheduleKey: 'custom-key',
    scheduleId: 'schedule-1'
  });
  assert.equal(result, 'custom-key');
});

test('derivePresenceScheduleKey prioritizes scheduleId over scheduleLabel', () => {
  const result = derivePresenceScheduleKey('event-1', {
    scheduleId: 'schedule-1',
    scheduleLabel: '昼の部'
  });
  assert.equal(result, 'event-1::schedule-1');
});

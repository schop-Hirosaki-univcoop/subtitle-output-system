import { test } from 'node:test';
import assert from 'node:assert/strict';

// operator/channel-manager.js は Firebase 依存があるため、純粋関数のロジックを再現してテスト
// sanitizePresenceLabel, extractScheduleKeyParts をテスト

// sanitizePresenceLabel のロジックを再現
function sanitizePresenceLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\s+/g, " ").replace(/::/g, "／");
}

// extractScheduleKeyParts のロジックを再現
function extractScheduleKeyParts(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { eventId: "", scheduleId: "", label: "" };
  }
  const segments = raw.split("::");
  if (segments.length <= 1) {
    return { eventId: "", scheduleId: raw, label: "" };
  }
  const [first = "", second = "", ...rest] = segments;
  const eventId = String(first || "").trim();
  const marker = String(second || "").trim();
  if (!marker) {
    return { eventId, scheduleId: "", label: "" };
  }
  if (marker === "label") {
    return { eventId, scheduleId: "", label: rest.join("::").trim() };
  }
  if (marker === "session") {
    return { eventId, scheduleId: "", label: "" };
  }
  return { eventId, scheduleId: marker, label: "" };
}

test('sanitizePresenceLabel trims and normalizes strings', () => {
  assert.equal(sanitizePresenceLabel('  hello  '), 'hello');
  assert.equal(sanitizePresenceLabel('hello   world'), 'hello world');
});

test('sanitizePresenceLabel replaces double colons with full-width slash', () => {
  assert.equal(sanitizePresenceLabel('event1::schedule1'), 'event1／schedule1');
  assert.equal(sanitizePresenceLabel('event1::schedule1::label1'), 'event1／schedule1／label1');
});

test('sanitizePresenceLabel converts non-string input to string', () => {
  assert.equal(sanitizePresenceLabel(null), '');
  assert.equal(sanitizePresenceLabel(undefined), '');
  assert.equal(sanitizePresenceLabel(123), '123');
  assert.equal(sanitizePresenceLabel({}), '[object Object]');
  assert.equal(sanitizePresenceLabel([]), '');
});

test('sanitizePresenceLabel handles empty strings', () => {
  assert.equal(sanitizePresenceLabel(''), '');
  assert.equal(sanitizePresenceLabel('   '), '');
});

test('extractScheduleKeyParts extracts eventId and scheduleId from double-colon-separated string', () => {
  const result = extractScheduleKeyParts('event1::schedule1');
  assert.equal(result.eventId, 'event1');
  assert.equal(result.scheduleId, 'schedule1');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts handles label marker', () => {
  const result = extractScheduleKeyParts('event1::label::ラベル名');
  assert.equal(result.eventId, 'event1');
  assert.equal(result.scheduleId, '');
  assert.equal(result.label, 'ラベル名');
});

test('extractScheduleKeyParts handles session marker', () => {
  const result = extractScheduleKeyParts('event1::session');
  assert.equal(result.eventId, 'event1');
  assert.equal(result.scheduleId, '');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts returns scheduleId only when no double colon', () => {
  const result = extractScheduleKeyParts('schedule1');
  assert.equal(result.eventId, '');
  assert.equal(result.scheduleId, 'schedule1');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts handles empty string', () => {
  const result = extractScheduleKeyParts('');
  assert.equal(result.eventId, '');
  assert.equal(result.scheduleId, '');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts handles whitespace-only string', () => {
  const result = extractScheduleKeyParts('   ');
  assert.equal(result.eventId, '');
  assert.equal(result.scheduleId, '');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts trims input', () => {
  const result = extractScheduleKeyParts('  event1::schedule1  ');
  assert.equal(result.eventId, 'event1');
  assert.equal(result.scheduleId, 'schedule1');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts converts non-string input to string', () => {
  const result1 = extractScheduleKeyParts(null);
  assert.equal(result1.eventId, '');
  assert.equal(result1.scheduleId, '');
  assert.equal(result1.label, '');
  
  const result2 = extractScheduleKeyParts(undefined);
  assert.equal(result2.eventId, '');
  assert.equal(result2.scheduleId, '');
  assert.equal(result2.label, '');
  
  const result3 = extractScheduleKeyParts(123);
  assert.equal(result3.eventId, '');
  assert.equal(result3.scheduleId, '123');
  assert.equal(result3.label, '');
});

test('extractScheduleKeyParts handles empty eventId', () => {
  const result = extractScheduleKeyParts('::schedule1');
  assert.equal(result.eventId, '');
  assert.equal(result.scheduleId, 'schedule1');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts handles empty marker', () => {
  const result = extractScheduleKeyParts('event1::');
  assert.equal(result.eventId, 'event1');
  assert.equal(result.scheduleId, '');
  assert.equal(result.label, '');
});

test('extractScheduleKeyParts handles multiple segments in label', () => {
  const result = extractScheduleKeyParts('event1::label::ラベル1::ラベル2');
  assert.equal(result.eventId, 'event1');
  assert.equal(result.scheduleId, '');
  assert.equal(result.label, 'ラベル1::ラベル2');
});

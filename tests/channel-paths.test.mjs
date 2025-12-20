import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEventId,
  normalizeScheduleId,
  getRenderStatePath,
  getNowShowingPath,
  getSideTelopPath,
  describeChannel,
  parseChannelParams,
  isLegacyChannel,
  getQuestionStatusPath
} from '../scripts/shared/channel-paths.js';

test('normalizeEventId normalizes event IDs', () => {
  assert.equal(normalizeEventId('event-1'), 'event-1');
  assert.equal(normalizeEventId('  event-1  '), 'event-1');
  assert.equal(normalizeEventId(null), '');
  assert.equal(normalizeEventId(undefined), '');
  assert.equal(normalizeEventId(123), '123');
});

test('normalizeScheduleId normalizes schedule IDs', () => {
  assert.equal(normalizeScheduleId('schedule-1'), 'schedule-1');
  assert.equal(normalizeScheduleId('  schedule-1  '), 'schedule-1');
  assert.equal(normalizeScheduleId(null), '__default_schedule__');
  assert.equal(normalizeScheduleId(undefined), '__default_schedule__');
  assert.equal(normalizeScheduleId(''), '__default_schedule__');
});

test('getRenderStatePath builds render state paths', () => {
  assert.equal(getRenderStatePath('event-1', 'schedule-1'), 'render/events/event-1/schedule-1/state');
  assert.equal(getRenderStatePath('event-1', null), 'render/events/event-1/__default_schedule__/state');
  assert.throws(() => getRenderStatePath(null, 'schedule-1'), /eventId is required/);
  assert.throws(() => getRenderStatePath('', 'schedule-1'), /eventId is required/);
});

test('getNowShowingPath builds now showing paths', () => {
  assert.equal(getNowShowingPath('event-1', 'schedule-1'), 'render/events/event-1/schedule-1/nowShowing');
  assert.equal(getNowShowingPath('event-1', null), 'render/events/event-1/__default_schedule__/nowShowing');
  assert.throws(() => getNowShowingPath(null, 'schedule-1'), /eventId is required/);
  assert.throws(() => getNowShowingPath('', 'schedule-1'), /eventId is required/);
});

test('getSideTelopPath builds side telop paths', () => {
  assert.equal(getSideTelopPath('event-1', 'schedule-1'), 'render/events/event-1/schedule-1/sideTelops');
  assert.equal(getSideTelopPath('event-1', null), 'render/events/event-1/__default_schedule__/sideTelops');
  assert.throws(() => getSideTelopPath(null, 'schedule-1'), /eventId is required/);
  assert.throws(() => getSideTelopPath('', 'schedule-1'), /eventId is required/);
});

test('describeChannel describes channel information', () => {
  const channel = describeChannel('event-1', 'schedule-1');
  assert.equal(channel.isLegacy, false);
  assert.equal(channel.eventId, 'event-1');
  assert.equal(channel.scheduleId, 'schedule-1');
  assert.equal(channel.basePath, 'render/events/event-1/schedule-1');
  assert.equal(channel.renderStatePath, 'render/events/event-1/schedule-1/state');
  assert.equal(channel.nowShowingPath, 'render/events/event-1/schedule-1/nowShowing');
  
  const defaultChannel = describeChannel('event-1', null);
  assert.equal(defaultChannel.scheduleId, '__default_schedule__');
  
  assert.throws(() => describeChannel(null, 'schedule-1'), /eventId is required/);
  assert.throws(() => describeChannel('', 'schedule-1'), /eventId is required/);
});

test('parseChannelParams parses URL search params', () => {
  const params1 = new URLSearchParams('evt=event-1&sch=schedule-1');
  const result1 = parseChannelParams(params1);
  assert.equal(result1.eventId, 'event-1');
  assert.equal(result1.scheduleId, 'schedule-1');
  
  const params2 = new URLSearchParams('event=event-2&schedule=schedule-2');
  const result2 = parseChannelParams(params2);
  assert.equal(result2.eventId, 'event-2');
  assert.equal(result2.scheduleId, 'schedule-2');
  
  const params3 = new URLSearchParams('eventId=event-3&scheduleId=schedule-3');
  const result3 = parseChannelParams(params3);
  assert.equal(result3.eventId, 'event-3');
  assert.equal(result3.scheduleId, 'schedule-3');
  
  const params4 = new URLSearchParams('event_id=event-4&schedule_id=schedule-4');
  const result4 = parseChannelParams(params4);
  assert.equal(result4.eventId, 'event-4');
  assert.equal(result4.scheduleId, 'schedule-4');
  
  const params5 = new URLSearchParams();
  const result5 = parseChannelParams(params5);
  assert.equal(result5.eventId, '');
  assert.equal(result5.scheduleId, '');
  
  const result6 = parseChannelParams(null);
  assert.equal(result6.eventId, '');
  assert.equal(result6.scheduleId, '');
  
  const result7 = parseChannelParams({});
  assert.equal(result7.eventId, '');
  assert.equal(result7.scheduleId, '');
});

test('isLegacyChannel always returns false', () => {
  assert.equal(isLegacyChannel('event-1', 'schedule-1'), false);
  assert.equal(isLegacyChannel(null, null), false);
  assert.equal(isLegacyChannel('', ''), false);
});

test('getQuestionStatusPath builds question status paths', () => {
  // 通常質問（isPickup = false）
  assert.equal(getQuestionStatusPath('event-1'), 'questionStatus/event-1');
  assert.equal(getQuestionStatusPath('event-1', false), 'questionStatus/event-1');
  assert.equal(getQuestionStatusPath('event-1', false, 'schedule-1'), 'questionStatus/event-1');
  
  // Pick Up Question（isPickup = true）
  assert.equal(getQuestionStatusPath('event-1', true, 'schedule-1'), 'questionStatus/event-1/schedule-1');
  assert.equal(getQuestionStatusPath('event-1', true, ''), 'questionStatus/event-1/__default_schedule__');
  assert.equal(getQuestionStatusPath('event-1', true, null), 'questionStatus/event-1/__default_schedule__');
  
  // エラーケース
  assert.throws(() => getQuestionStatusPath(null), /eventId is required/);
  assert.throws(() => getQuestionStatusPath(''), /eventId is required/);
  assert.throws(() => getQuestionStatusPath(null, true, 'schedule-1'), /eventId is required/);
});

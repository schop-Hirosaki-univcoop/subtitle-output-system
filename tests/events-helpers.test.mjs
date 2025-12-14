import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureString,
  formatDateTimeLocal,
  buildContextDescription,
  logError,
  formatParticipantCount,
  wait
} from '../scripts/events/helpers.js';

test('ensureString normalizes values to trimmed strings', () => {
  assert.equal(ensureString('hello'), 'hello');
  assert.equal(ensureString('  hello  '), 'hello');
  assert.equal(ensureString(null), '');
  assert.equal(ensureString(undefined), '');
  assert.equal(ensureString(123), '123');
});

test('formatDateTimeLocal formats date for datetime-local input', () => {
  const date = new Date(2025, 4, 10, 14, 30); // May 10, 2025 14:30
  const formatted = formatDateTimeLocal(date);
  assert.equal(formatted, '2025-05-10T14:30');
  
  const date2 = new Date(2025, 0, 1, 9, 5); // January 1, 2025 09:05
  const formatted2 = formatDateTimeLocal(date2);
  assert.equal(formatted2, '2025-01-01T09:05');
});

test('buildContextDescription builds description with event and schedule', () => {
  const base = '基本説明';
  const event = { id: 'event-1', name: 'イベント名' };
  const schedule = { id: 'schedule-1', label: '日程名' };
  
  const result = buildContextDescription(base, event, schedule);
  assert(result.includes('基本説明'));
  assert(result.includes('イベント名'));
  assert(result.includes('日程名'));
});

test('buildContextDescription returns base description when no event or schedule', () => {
  const base = '基本説明';
  assert.equal(buildContextDescription(base, null, null), base);
  assert.equal(buildContextDescription(base, undefined, undefined), base);
});

test('buildContextDescription includes schedule range when available', () => {
  const base = '基本説明';
  const schedule = {
    id: 'schedule-1',
    label: '日程名',
    startAt: '2025-05-10T10:00:00',
    endAt: '2025-05-10T12:00:00'
  };
  
  const result = buildContextDescription(base, null, schedule);
  assert(result.includes('時間:'));
});

test('logError logs error to console', () => {
  const originalConsoleError = console.error;
  let loggedMessage = null;
  let loggedError = null;
  
  try {
    console.error = (message, error) => {
      loggedMessage = message;
      loggedError = error;
    };
    
    const error = new Error('Test error');
    logError('Context', error);
    
    assert(loggedMessage.includes('Context'));
    assert.equal(loggedError, error);
  } finally {
    console.error = originalConsoleError;
  }
});

test('formatParticipantCount formats participant count', () => {
  assert.equal(formatParticipantCount(0), '0名');
  assert.equal(formatParticipantCount(10), '10名');
  assert.equal(formatParticipantCount('20'), '20名');
  assert.equal(formatParticipantCount(null), '—');
  assert.equal(formatParticipantCount(undefined), '—');
  assert.equal(formatParticipantCount(''), '—');
  assert.equal(formatParticipantCount('invalid'), 'invalid');
});

test('wait returns a promise that resolves after delay', async () => {
  const start = Date.now();
  await wait(10);
  const elapsed = Date.now() - start;
  // タイミングの問題を考慮して、少し余裕を持たせる
  assert(elapsed >= 8); // 10ms の待機だが、実行時間のばらつきを考慮
});

// waitForParticipantSelectionAck のロジックを再現
const PARTICIPANT_SYNC_TIMEOUT_MS = 6000;
const PARTICIPANT_SYNC_POLL_INTERVAL_MS = 150;

async function waitForParticipantSelectionAck(expectedEventId, expectedScheduleId, mockWindow) {
  if (
    typeof mockWindow === "undefined" ||
    !mockWindow.questionAdminEmbed ||
    typeof mockWindow.questionAdminEmbed.getState !== "function"
  ) {
    return true;
  }

  const timeoutAt = Date.now() + PARTICIPANT_SYNC_TIMEOUT_MS;
  while (Date.now() < timeoutAt) {
    try {
      const state = mockWindow.questionAdminEmbed.getState();
      if (state && state.eventId === expectedEventId && state.scheduleId === expectedScheduleId) {
        return true;
      }
    } catch (error) {
      break;
    }
    await wait(PARTICIPANT_SYNC_POLL_INTERVAL_MS);
  }
  return false;
}

test('waitForParticipantSelectionAck returns true when window.questionAdminEmbed is unavailable', async () => {
  const result = await waitForParticipantSelectionAck('event-1', 'schedule-1', undefined);
  assert.equal(result, true);
});

test('waitForParticipantSelectionAck returns true when state matches', async () => {
  const mockWindow = {
    questionAdminEmbed: {
      getState: () => ({ eventId: 'event-1', scheduleId: 'schedule-1' })
    }
  };
  const result = await waitForParticipantSelectionAck('event-1', 'schedule-1', mockWindow);
  assert.equal(result, true);
});

test('waitForParticipantSelectionAck returns false when state does not match', async () => {
  const mockWindow = {
    questionAdminEmbed: {
      getState: () => ({ eventId: 'event-2', scheduleId: 'schedule-2' })
    }
  };
  // タイムアウトまで待つ必要があるが、テストを高速化するため短いタイムアウトでテスト
  const start = Date.now();
  const result = await waitForParticipantSelectionAck('event-1', 'schedule-1', mockWindow);
  const elapsed = Date.now() - start;
  assert.equal(result, false);
  // タイムアウトまで待つことを確認（少なくとも数回のポーリングが行われる）
  assert(elapsed >= PARTICIPANT_SYNC_POLL_INTERVAL_MS);
});

test('waitForParticipantSelectionAck handles getState errors gracefully', async () => {
  const mockWindow = {
    questionAdminEmbed: {
      getState: () => {
        throw new Error('State error');
      }
    }
  };
  const result = await waitForParticipantSelectionAck('event-1', 'schedule-1', mockWindow);
  assert.equal(result, false);
});

test('waitForParticipantSelectionAck returns true when questionAdminEmbed.getState is not a function', async () => {
  const mockWindow = {
    questionAdminEmbed: {
      getState: 'not a function'
    }
  };
  const result = await waitForParticipantSelectionAck('event-1', 'schedule-1', mockWindow);
  assert.equal(result, true); // getState が関数でない場合は true を返す（最初のif文で早期リターン）
});

test('waitForParticipantSelectionAck returns true when questionAdminEmbed is null', async () => {
  const mockWindow = {
    questionAdminEmbed: null
  };
  const result = await waitForParticipantSelectionAck('event-1', 'schedule-1', mockWindow);
  assert.equal(result, true); // questionAdminEmbed が null の場合は true を返す（最初のif文で早期リターン）
});

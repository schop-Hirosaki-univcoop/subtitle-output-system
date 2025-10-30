import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectParticipantTokens } from '../scripts/shared/participant-tokens.js';

test('collectParticipantTokens gathers unique tokens across schedules', () => {
  const branch = {
    scheduleA: { alice: { token: 'abc' }, bob: { token: 'def' } },
    scheduleB: { charlie: { token: 'abc' }, delta: { token: 'ghi' } }
  };

  const tokens = collectParticipantTokens(branch);
  assert.deepEqual([...tokens].sort(), ['abc', 'def', 'ghi']);
});

test('collectParticipantTokens tolerates malformed structures', () => {
  const branch = {
    scheduleA: 'invalid',
    scheduleB: { nested: { token: 'mno' } },
    scheduleC: { alpha: { token: 'jkl' }, beta: null }
  };

  const tokens = collectParticipantTokens(branch);
  assert.deepEqual([...tokens].sort(), ['jkl', 'mno']);
});

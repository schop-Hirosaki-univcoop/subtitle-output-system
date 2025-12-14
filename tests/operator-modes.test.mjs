import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OPERATOR_MODE_TELOP,
  OPERATOR_MODE_SUPPORT,
  normalizeOperatorMode,
  isTelopMode
} from '../scripts/shared/operator-modes.js';

test('OPERATOR_MODE_TELOP and OPERATOR_MODE_SUPPORT are defined', () => {
  assert.equal(OPERATOR_MODE_TELOP, 'telop');
  assert.equal(OPERATOR_MODE_SUPPORT, 'support');
});

test('normalizeOperatorMode normalizes to support mode', () => {
  assert.equal(normalizeOperatorMode('support'), OPERATOR_MODE_SUPPORT);
  assert.equal(normalizeOperatorMode('Support'), OPERATOR_MODE_SUPPORT);
  assert.equal(normalizeOperatorMode('SUPPORT'), OPERATOR_MODE_SUPPORT);
  assert.equal(normalizeOperatorMode('  support  '), OPERATOR_MODE_SUPPORT);
});

test('normalizeOperatorMode defaults to telop mode', () => {
  assert.equal(normalizeOperatorMode('telop'), OPERATOR_MODE_TELOP);
  assert.equal(normalizeOperatorMode('Telop'), OPERATOR_MODE_TELOP);
  assert.equal(normalizeOperatorMode('TELOP'), OPERATOR_MODE_TELOP);
  assert.equal(normalizeOperatorMode(''), OPERATOR_MODE_TELOP);
  assert.equal(normalizeOperatorMode('unknown'), OPERATOR_MODE_TELOP);
  assert.equal(normalizeOperatorMode(null), OPERATOR_MODE_TELOP);
  assert.equal(normalizeOperatorMode(undefined), OPERATOR_MODE_TELOP);
  assert.equal(normalizeOperatorMode(123), OPERATOR_MODE_TELOP);
});

test('isTelopMode returns true for telop mode', () => {
  assert.equal(isTelopMode('telop'), true);
  assert.equal(isTelopMode('Telop'), true);
  assert.equal(isTelopMode('TELOP'), true);
  assert.equal(isTelopMode(''), true);
  assert.equal(isTelopMode('unknown'), true);
});

test('isTelopMode returns false for support mode', () => {
  assert.equal(isTelopMode('support'), false);
  assert.equal(isTelopMode('Support'), false);
  assert.equal(isTelopMode('SUPPORT'), false);
  assert.equal(isTelopMode('  support  '), false);
});

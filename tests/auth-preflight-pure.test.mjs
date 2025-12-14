import { test } from 'node:test';
import assert from 'node:assert/strict';

// auth-preflight.js は Firebase 依存があるため、純粋関数のロジックを再現してテスト
// isAuthPreflightContextFresh, preflightContextMatchesUser, AuthPreflightError をテスト

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

// isAuthPreflightContextFresh のロジックを再現
function isAuthPreflightContextFresh(context, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!context || typeof context !== "object") return false;
  const checkedAt = Number(context.checkedAt);
  if (!Number.isFinite(checkedAt)) return false;
  return now - checkedAt <= maxAgeMs;
}

// preflightContextMatchesUser のロジックを再現
function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function preflightContextMatchesUser(context, user) {
  if (!context || !user) return false;
  if (context.uid && user.uid && context.uid !== user.uid) {
    return false;
  }
  const normalizedContextEmail = normalizeEmail(context.email);
  const normalizedUserEmail = normalizeEmail(user.email);
  if (normalizedContextEmail && normalizedUserEmail && normalizedContextEmail !== normalizedUserEmail) {
    return false;
  }
  return true;
}

// AuthPreflightError のロジックを再現
class AuthPreflightError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = "AuthPreflightError";
    this.code = code || "UNKNOWN_PREFLIGHT_ERROR";
    if (cause) {
      this.cause = cause;
    }
  }
}

test('isAuthPreflightContextFresh returns true for fresh context', () => {
  const now = Date.now();
  const context = {
    version: 1,
    checkedAt: now - 1000, // 1秒前
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = isAuthPreflightContextFresh(context, { now, maxAgeMs: 5000 });
  assert.equal(result, true);
});

test('isAuthPreflightContextFresh returns false for expired context', () => {
  const now = Date.now();
  const context = {
    version: 1,
    checkedAt: now - 10000, // 10秒前
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = isAuthPreflightContextFresh(context, { now, maxAgeMs: 5000 });
  assert.equal(result, false);
});

test('isAuthPreflightContextFresh returns false for invalid context', () => {
  assert.equal(isAuthPreflightContextFresh(null, { maxAgeMs: 5000 }), false);
  assert.equal(isAuthPreflightContextFresh(undefined, { maxAgeMs: 5000 }), false);
  assert.equal(isAuthPreflightContextFresh({}, { maxAgeMs: 5000 }), false);
});

test('isAuthPreflightContextFresh returns false for context without checkedAt', () => {
  const context = {
    version: 1,
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = isAuthPreflightContextFresh(context, { maxAgeMs: 5000 });
  assert.equal(result, false);
});

test('isAuthPreflightContextFresh returns false for context with invalid checkedAt', () => {
  const context = {
    version: 1,
    checkedAt: NaN,
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = isAuthPreflightContextFresh(context, { maxAgeMs: 5000 });
  assert.equal(result, false);
});

test('isAuthPreflightContextFresh uses default maxAgeMs when not provided', () => {
  const now = Date.now();
  const context = {
    version: 1,
    checkedAt: now - 1000,
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = isAuthPreflightContextFresh(context, { now });
  assert.equal(result, true);
});

test('preflightContextMatchesUser returns true when uid matches', () => {
  const context = {
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const user = {
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = preflightContextMatchesUser(context, user);
  assert.equal(result, true);
});

test('preflightContextMatchesUser returns true when email matches', () => {
  const context = {
    uid: '',
    email: 'test@example.com'
  };
  const user = {
    uid: '',
    email: 'test@example.com'
  };
  const result = preflightContextMatchesUser(context, user);
  assert.equal(result, true);
});

test('preflightContextMatchesUser returns false when uid does not match', () => {
  const context = {
    uid: 'test-uid-1',
    email: 'test@example.com'
  };
  const user = {
    uid: 'test-uid-2',
    email: 'test@example.com'
  };
  const result = preflightContextMatchesUser(context, user);
  assert.equal(result, false);
});

test('preflightContextMatchesUser returns false when email does not match', () => {
  const context = {
    uid: 'test-uid',
    email: 'test1@example.com'
  };
  const user = {
    uid: 'test-uid',
    email: 'test2@example.com'
  };
  const result = preflightContextMatchesUser(context, user);
  assert.equal(result, false);
});

test('preflightContextMatchesUser normalizes email case', () => {
  const context = {
    uid: '',
    email: 'Test@Example.COM'
  };
  const user = {
    uid: '',
    email: 'test@example.com'
  };
  const result = preflightContextMatchesUser(context, user);
  assert.equal(result, true);
});

test('preflightContextMatchesUser returns false for null context', () => {
  const user = {
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = preflightContextMatchesUser(null, user);
  assert.equal(result, false);
});

test('preflightContextMatchesUser returns false for null user', () => {
  const context = {
    uid: 'test-uid',
    email: 'test@example.com'
  };
  const result = preflightContextMatchesUser(context, null);
  assert.equal(result, false);
});

test('preflightContextMatchesUser returns true when both uid and email are empty', () => {
  const context = {
    uid: '',
    email: ''
  };
  const user = {
    uid: '',
    email: ''
  };
  const result = preflightContextMatchesUser(context, user);
  assert.equal(result, true);
});

test('AuthPreflightError creates error with message and code', () => {
  const error = new AuthPreflightError('Test error', 'TEST_CODE');
  assert.equal(error.message, 'Test error');
  assert.equal(error.code, 'TEST_CODE');
  assert.equal(error.name, 'AuthPreflightError');
  assert(error instanceof Error);
});

test('AuthPreflightError uses default code when not provided', () => {
  const error = new AuthPreflightError('Test error');
  assert.equal(error.message, 'Test error');
  assert.equal(error.code, 'UNKNOWN_PREFLIGHT_ERROR');
});

test('AuthPreflightError includes cause when provided', () => {
  const cause = new Error('Original error');
  const error = new AuthPreflightError('Test error', 'TEST_CODE', cause);
  assert.equal(error.cause, cause);
});

test('AuthPreflightError works without cause', () => {
  const error = new AuthPreflightError('Test error', 'TEST_CODE');
  assert.equal(error.cause, undefined);
});

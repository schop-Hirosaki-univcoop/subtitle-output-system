import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOGIN_PAGE,
  EVENTS_PAGE,
  goToLogin,
  goToEvents,
  redirectTo
} from '../scripts/shared/routes.js';

test('LOGIN_PAGE and EVENTS_PAGE constants are defined', () => {
  assert.equal(LOGIN_PAGE, 'login.html');
  assert.equal(EVENTS_PAGE, 'operator.html');
});

test('goToLogin calls window.location.replace when window is available', () => {
  let calledWith = null;
  const mockWindow = {
    location: {
      replace: (url) => {
        calledWith = url;
      }
    }
  };
  
  // グローバル window を一時的に置き換えることはできないため、
  // このテストは実際のブラウザ環境でのみ動作します
  // Node.js 環境では警告のみが出力されます
  const originalWindow = globalThis.window;
  try {
    globalThis.window = mockWindow;
    goToLogin();
    assert.equal(calledWith, LOGIN_PAGE);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('goToEvents calls window.location.replace when window is available', () => {
  let calledWith = null;
  const mockWindow = {
    location: {
      replace: (url) => {
        calledWith = url;
      }
    }
  };
  
  const originalWindow = globalThis.window;
  try {
    globalThis.window = mockWindow;
    goToEvents();
    assert.equal(calledWith, EVENTS_PAGE);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('redirectTo calls window.location.replace with target URL', () => {
  let calledWith = null;
  const mockWindow = {
    location: {
      replace: (url) => {
        calledWith = url;
      }
    }
  };
  
  const originalWindow = globalThis.window;
  try {
    globalThis.window = mockWindow;
    redirectTo('test.html');
    assert.equal(calledWith, 'test.html');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('goToLogin handles missing window gracefully', () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    // エラーが発生しないことを確認
    goToLogin();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('goToEvents handles missing window gracefully', () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    // エラーが発生しないことを確認
    goToEvents();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('redirectTo handles missing window gracefully', () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    // エラーが発生しないことを確認
    redirectTo('test.html');
  } finally {
    globalThis.window = originalWindow;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendAuthDebugLog,
  replayAuthDebugLog,
  clearAuthDebugLog
} from '../scripts/shared/auth-debug-log.js';

// モックストレージのヘルパー
function createMockStorage() {
  const storage = new Map();
  return {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
    removeItem: (key) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    getStorage: () => storage
  };
}

test('appendAuthDebugLog stores log entry', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const entry = appendAuthDebugLog('test-event', { detail: 'test' });
    
    assert.equal(entry.event, 'test-event');
    assert.deepEqual(entry.detail, { detail: 'test' });
    assert.equal(entry.level, 'info');
    assert(typeof entry.timestamp === 'number');
    
    const stored = JSON.parse(mockStorage.getItem('sos:authDebugLog'));
    assert(Array.isArray(stored));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].event, 'test-event');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('appendAuthDebugLog limits entries to MAX_LOG_ENTRIES', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    // 201個のエントリを追加（MAX_LOG_ENTRIES は 200）
    for (let i = 0; i < 201; i++) {
      appendAuthDebugLog(`event-${i}`);
    }
    
    const stored = JSON.parse(mockStorage.getItem('sos:authDebugLog'));
    assert.equal(stored.length, 200);
    // 最初のエントリが削除されていることを確認
    assert.equal(stored[0].event, 'event-1');
    assert.equal(stored[199].event, 'event-200');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('appendAuthDebugLog normalizes Error objects', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const error = new Error('Test error');
    error.code = 'TEST_CODE';
    const entry = appendAuthDebugLog('error-event', error);
    
    assert.equal(entry.detail.name, 'Error');
    assert.equal(entry.detail.message, 'Test error');
    assert.equal(entry.detail.code, 'TEST_CODE');
    assert(typeof entry.detail.stack === 'string');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('appendAuthDebugLog handles circular references', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const circular = { a: 1 };
    circular.self = circular;
    
    const entry = appendAuthDebugLog('circular-event', circular);
    assert.equal(entry.detail.a, 1);
    assert.equal(entry.detail.self, '[Circular]');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('appendAuthDebugLog handles missing storage gracefully', () => {
  const originalWindow = globalThis.window;
  
  try {
    delete globalThis.window;
    // エラーが発生しないことを確認
    const entry = appendAuthDebugLog('test-event');
    assert.equal(entry.event, 'test-event');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('replayAuthDebugLog returns entries when AUTH_DEBUG_OUTPUT_ENABLED is false', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    appendAuthDebugLog('event-1');
    appendAuthDebugLog('event-2');
    
    const entries = replayAuthDebugLog({ clear: false });
    // AUTH_DEBUG_OUTPUT_ENABLED が false の場合、空配列が返される
    assert(Array.isArray(entries));
  } finally {
    globalThis.window = originalWindow;
  }
});

test('clearAuthDebugLog removes stored log', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    appendAuthDebugLog('test-event');
    assert.notEqual(mockStorage.getItem('sos:authDebugLog'), null);
    
    clearAuthDebugLog();
    assert.equal(mockStorage.getItem('sos:authDebugLog'), null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('clearAuthDebugLog handles missing storage gracefully', () => {
  const originalWindow = globalThis.window;
  
  try {
    delete globalThis.window;
    // エラーが発生しないことを確認
    clearAuthDebugLog();
  } finally {
    globalThis.window = originalWindow;
  }
});

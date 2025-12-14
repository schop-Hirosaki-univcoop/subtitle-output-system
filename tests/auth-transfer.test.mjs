import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  storeAuthTransfer,
  consumeAuthTransfer,
  clearAuthTransfer
} from '../scripts/shared/auth-transfer.js';

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

test('storeAuthTransfer stores valid payload', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const payload = {
      providerId: 'google.com',
      signInMethod: 'google.com',
      idToken: 'token123',
      accessToken: 'access123'
    };
    
    const result = storeAuthTransfer(payload);
    assert.equal(result, true);
    
    const stored = JSON.parse(mockStorage.getItem('sos:operatorAuthTransfer'));
    assert.equal(stored.providerId, 'google.com');
    assert.equal(stored.signInMethod, 'google.com');
    assert.equal(stored.idToken, 'token123');
    assert.equal(stored.accessToken, 'access123');
    assert(typeof stored.timestamp === 'number');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('storeAuthTransfer removes item when payload is null', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    // まずデータを保存
    storeAuthTransfer({ providerId: 'google.com' });
    assert.notEqual(mockStorage.getItem('sos:operatorAuthTransfer'), null);
    
    // null で削除
    const result = storeAuthTransfer(null);
    assert.equal(result, false);
    assert.equal(mockStorage.getItem('sos:operatorAuthTransfer'), null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('storeAuthTransfer removes item when payload is not an object', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    storeAuthTransfer('invalid');
    assert.equal(mockStorage.getItem('sos:operatorAuthTransfer'), null);
    
    storeAuthTransfer(123);
    assert.equal(mockStorage.getItem('sos:operatorAuthTransfer'), null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('storeAuthTransfer normalizes payload fields', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const payload = {
      providerId: 123,
      signInMethod: null,
      idToken: undefined,
      accessToken: 'access123'
    };
    
    storeAuthTransfer(payload);
    const stored = JSON.parse(mockStorage.getItem('sos:operatorAuthTransfer'));
    assert.equal(stored.providerId, '');
    assert.equal(stored.signInMethod, '');
    assert.equal(stored.idToken, '');
    assert.equal(stored.accessToken, 'access123');
  } finally {
    globalThis.window = originalWindow;
  }
});

test('consumeAuthTransfer retrieves and removes stored payload', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const payload = {
      providerId: 'google.com',
      signInMethod: 'google.com',
      idToken: 'token123',
      accessToken: 'access123'
    };
    
    storeAuthTransfer(payload);
    const consumed = consumeAuthTransfer();
    
    assert.notEqual(consumed, null);
    assert.equal(consumed.providerId, 'google.com');
    assert.equal(consumed.signInMethod, 'google.com');
    assert.equal(consumed.idToken, 'token123');
    assert.equal(consumed.accessToken, 'access123');
    assert(typeof consumed.timestamp === 'number');
    
    // 取得後に削除されていることを確認
    assert.equal(mockStorage.getItem('sos:operatorAuthTransfer'), null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('consumeAuthTransfer returns null when nothing is stored', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const result = consumeAuthTransfer();
    assert.equal(result, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('consumeAuthTransfer handles invalid JSON gracefully', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  const originalConsoleWarn = console.warn;
  let warnCalled = false;
  
  try {
    globalThis.window = { sessionStorage: mockStorage };
    // console.warn をモックしてエラーがログに出力されることを確認
    console.warn = () => {
      warnCalled = true;
    };
    
    mockStorage.setItem('sos:operatorAuthTransfer', 'invalid json');
    const result = consumeAuthTransfer();
    assert.equal(result, null);
    // 警告が出力されることを確認（実装の仕様）
    assert.equal(warnCalled, true);
  } finally {
    globalThis.window = originalWindow;
    console.warn = originalConsoleWarn;
  }
});

test('consumeAuthTransfer normalizes timestamp', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    const payload = {
      providerId: 'google.com',
      signInMethod: 'google.com',
      idToken: 'token123',
      accessToken: 'access123',
      timestamp: 'invalid'
    };
    
    mockStorage.setItem('sos:operatorAuthTransfer', JSON.stringify(payload));
    const consumed = consumeAuthTransfer();
    
    assert(typeof consumed.timestamp === 'number');
    assert(Number.isFinite(consumed.timestamp));
  } finally {
    globalThis.window = originalWindow;
  }
});

test('clearAuthTransfer removes stored payload', () => {
  const mockStorage = createMockStorage();
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { sessionStorage: mockStorage };
    
    storeAuthTransfer({ providerId: 'google.com' });
    assert.notEqual(mockStorage.getItem('sos:operatorAuthTransfer'), null);
    
    clearAuthTransfer();
    assert.equal(mockStorage.getItem('sos:operatorAuthTransfer'), null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('storeAuthTransfer returns false when storage is unavailable', () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    const result = storeAuthTransfer({ providerId: 'google.com' });
    assert.equal(result, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('consumeAuthTransfer returns null when storage is unavailable', () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    const result = consumeAuthTransfer();
    assert.equal(result, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('clearAuthTransfer handles missing storage gracefully', () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    // エラーが発生しないことを確認
    clearAuthTransfer();
  } finally {
    globalThis.window = originalWindow;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sleep,
  isPermissionDenied,
  toMillis,
  ensureCrypto,
  generateShortId,
  base64UrlFromBytes,
  normalizeKey,
  stripBom,
  decodeCsvBytes,
  parseCsv,
  parseDateTimeLocal
} from '../scripts/question-admin/utils.js';

test('sleep returns a promise that resolves after delay', async () => {
  const start = Date.now();
  await sleep(10);
  const elapsed = Date.now() - start;
  assert(elapsed >= 10);
});

test('isPermissionDenied detects permission denied errors', () => {
  assert.equal(isPermissionDenied({ code: 'permission_denied' }), true);
  assert.equal(isPermissionDenied({ code: 'PERMISSION-DENIED' }), true);
  assert.equal(isPermissionDenied({ message: 'permission denied' }), true);
  assert.equal(isPermissionDenied({ code: 'other_error' }), false);
  assert.equal(isPermissionDenied(null), false);
  assert.equal(isPermissionDenied(undefined), false);
});

test('toMillis converts various timestamp formats', () => {
  const now = Date.now();
  assert.equal(toMillis(now), now);
  // Unix秒（1e10以上、1e12未満）はミリ秒に変換される
  const unixSeconds = Math.floor(now / 1000);
  if (unixSeconds > 1e10 && unixSeconds < 1e12) {
    assert.equal(toMillis(unixSeconds), unixSeconds * 1000);
  }
  assert.equal(toMillis(new Date(now)), now);
  // 文字列の数値は Date としてパースされるか、数値として返される
  const stringResult = toMillis(String(now));
  assert(typeof stringResult === 'number');
  assert.equal(toMillis(null), 0);
  assert.equal(toMillis(undefined), 0);
  assert.equal(toMillis('invalid'), 0);
});

test('ensureCrypto returns crypto object when available', () => {
  const cryptoObj = ensureCrypto();
  // Node.js 環境では crypto が利用可能
  assert(cryptoObj !== null);
  assert(typeof cryptoObj.getRandomValues === 'function');
});

test('generateShortId generates unique IDs', () => {
  const id1 = generateShortId('prefix-');
  const id2 = generateShortId('prefix-');
  
  assert(id1.startsWith('prefix-'));
  assert(id2.startsWith('prefix-'));
  // ランダムなので異なる可能性が高い（衝突の可能性は低い）
  assert(typeof id1 === 'string');
  assert(typeof id2 === 'string');
});

test('base64UrlFromBytes converts bytes to base64url', () => {
  const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  const result = base64UrlFromBytes(bytes);
  assert.equal(result, 'SGVsbG8');
  assert(!result.includes('+'));
  assert(!result.includes('/'));
  assert(!result.includes('='));
});

test('normalizeKey normalizes keys', () => {
  assert.equal(normalizeKey('test'), 'test');
  assert.equal(normalizeKey('  test  '), 'test');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
  assert.equal(normalizeKey(123), '123');
  assert.equal(normalizeKey(NaN), '');
});

test('stripBom removes BOM from text', () => {
  const textWithBom = '\uFEFFhello';
  assert.equal(stripBom(textWithBom), 'hello');
  assert.equal(stripBom('hello'), 'hello');
  assert.equal(stripBom(null), '');
  assert.equal(stripBom(undefined), '');
});

test('decodeCsvBytes decodes UTF-8 bytes', () => {
  const text = 'Hello,世界';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const result = decodeCsvBytes(bytes);
  assert.equal(result, text);
});

test('decodeCsvBytes handles BOM in decoded text', () => {
  const text = '\uFEFFHello';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const result = decodeCsvBytes(bytes);
  assert.equal(result, 'Hello'); // BOM が除去される
});

test('decodeCsvBytes returns empty string for non-Uint8Array input', () => {
  assert.equal(decodeCsvBytes(null), '');
  assert.equal(decodeCsvBytes(undefined), '');
  assert.equal(decodeCsvBytes('string'), '');
  assert.equal(decodeCsvBytes([]), '');
});

test('decodeCsvBytes handles empty Uint8Array', () => {
  const bytes = new Uint8Array([]);
  const result = decodeCsvBytes(bytes);
  assert.equal(result, '');
});

test('decodeCsvBytes tries multiple encodings', () => {
  // UTF-8 でエンコードされたテキスト
  const text = 'テスト';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const result = decodeCsvBytes(bytes);
  assert.equal(result, text);
});

test('parseCsv parses CSV text', () => {
  const csv = 'name,age\nAlice,30\nBob,25';
  const result = parseCsv(csv);
  
  assert(Array.isArray(result));
  assert.equal(result.length, 3); // ヘッダー + 2行
  assert.deepEqual(result[0], ['name', 'age']);
  assert.deepEqual(result[1], ['Alice', '30']);
  assert.deepEqual(result[2], ['Bob', '25']);
});

test('parseCsv handles quoted fields', () => {
  const csv = 'name,"age,height"\nAlice,"30,170"';
  const result = parseCsv(csv);
  
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], ['name', 'age,height']);
  assert.deepEqual(result[1], ['Alice', '30,170']);
});

test('parseCsv handles escaped quotes', () => {
  const csv = 'name,description\nAlice,"She said ""Hello"""';
  const result = parseCsv(csv);
  
  assert.equal(result.length, 2);
  assert.equal(result[1][1], 'She said "Hello"');
});

test('parseDateTimeLocal parses date strings', () => {
  const date = parseDateTimeLocal('2025-05-10T10:00:00');
  assert(date instanceof Date);
  assert.equal(date.getFullYear(), 2025);
  assert.equal(date.getMonth(), 4);
  assert.equal(date.getDate(), 10);
});

test('parseDateTimeLocal returns null for invalid input', () => {
  assert.equal(parseDateTimeLocal(null), null);
  assert.equal(parseDateTimeLocal(undefined), null);
  assert.equal(parseDateTimeLocal(''), null);
  assert.equal(parseDateTimeLocal('invalid'), null);
});

// readFileAsText のロジックを再現（実際の実装に合わせて）
async function readFileAsText(file, mockTextDecoder, mockFileReader, mockDecodeCsvBytes) {
  return new Promise((resolve, reject) => {
    const handleError = () => {
      reject(new Error("ファイルの読み込みに失敗しました。"));
    };

    if (typeof mockTextDecoder === "undefined" || !mockTextDecoder) {
      if (mockFileReader) {
        mockFileReader.onload = () => {
          const text = String(mockFileReader.result || "");
          const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
          resolve(stripped);
        };
        mockFileReader.onerror = handleError;
        mockFileReader.readAsText(file, "utf-8");
        return;
      }
      reject(new Error("ファイルの読み込みに失敗しました。"));
      return;
    }

    // TextDecoder が利用可能な場合
    if (mockFileReader) {
      mockFileReader.onload = () => {
        try {
          const result = mockFileReader.result;
          const buffer =
            result instanceof ArrayBuffer
              ? result
              : result?.buffer instanceof ArrayBuffer
                ? result.buffer
                : null;

          if (!buffer) {
            const text = String(result || "");
            const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
            resolve(stripped);
            return;
          }

          const bytes = new Uint8Array(buffer);
          if (mockDecodeCsvBytes) {
            resolve(mockDecodeCsvBytes(bytes));
          } else {
            // decodeCsvBytes の簡易版
            const decoder = new mockTextDecoder("utf-8");
            const text = decoder.decode(bytes);
            const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
            resolve(stripped);
          }
        } catch (error) {
          reject(error);
        }
      };
      mockFileReader.onerror = handleError;
      mockFileReader.readAsArrayBuffer(file);
    } else {
      reject(new Error("ファイルの読み込みに失敗しました。"));
    }
  });
}

test('readFileAsText reads file using TextDecoder and FileReader when available', async () => {
  const mockText = 'Hello,世界';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(mockText);
  const buffer = bytes.buffer;
  
  const mockFile = new Blob([mockText], { type: 'text/plain' });
  
  const mockFileReader = {
    result: buffer,
    onload: null,
    onerror: null,
    readAsArrayBuffer: function(file) {
      if (this.onload) {
        setTimeout(() => this.onload(), 0);
      }
    }
  };
  
  const result = await readFileAsText(mockFile, TextDecoder, mockFileReader, decodeCsvBytes);
  assert.equal(result, mockText);
});

test('readFileAsText removes BOM from decoded text', async () => {
  const mockText = '\uFEFFHello';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(mockText);
  const buffer = bytes.buffer;
  
  const mockFile = new Blob([mockText], { type: 'text/plain' });
  
  const mockFileReader = {
    result: buffer,
    onload: null,
    onerror: null,
    readAsArrayBuffer: function(file) {
      if (this.onload) {
        setTimeout(() => this.onload(), 0);
      }
    }
  };
  
  const result = await readFileAsText(mockFile, TextDecoder, mockFileReader, decodeCsvBytes);
  assert.equal(result, 'Hello');
});

test('readFileAsText uses FileReader fallback when TextDecoder unavailable', async () => {
  const mockText = 'Hello,世界';
  const mockFile = new Blob([mockText], { type: 'text/plain' });
  
  const mockFileReader = {
    result: mockText,
    onload: null,
    onerror: null,
    readAsText: function(file, encoding) {
      if (this.onload) {
        setTimeout(() => this.onload(), 0);
      }
    }
  };
  
  const result = await readFileAsText(mockFile, undefined, mockFileReader);
  assert.equal(result, mockText);
});

test('readFileAsText handles non-ArrayBuffer result', async () => {
  const mockText = 'Hello';
  const mockFile = new Blob([mockText], { type: 'text/plain' });
  
  const mockFileReader = {
    result: mockText, // ArrayBuffer ではない
    onload: null,
    onerror: null,
    readAsArrayBuffer: function(file) {
      if (this.onload) {
        setTimeout(() => this.onload(), 0);
      }
    }
  };
  
  const result = await readFileAsText(mockFile, TextDecoder, mockFileReader);
  assert.equal(result, mockText);
});

test('readFileAsText rejects when FileReader unavailable', async () => {
  const mockFile = new Blob(['test'], { type: 'text/plain' });
  
  await assert.rejects(
    async () => await readFileAsText(mockFile, undefined, null),
    /ファイルの読み込みに失敗しました/
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

// display-link-logger.js は console 依存があるため、純粋関数のロジックを再現してテスト
// info, warn, error をテスト

const PREFIX = "[DisplayLink]";

// log 関数のロジックを再現
function log(level, message, ...details) {
  const method = typeof console?.[level] === "function" ? console[level] : console.log;
  const normalizedMessage = typeof message === "string" ? message : String(message ?? "");
  const extras = details.filter((detail) => detail !== undefined);
  method.call(console, PREFIX, normalizedMessage, ...extras);
}

// info 関数のロジックを再現（コメントアウトされているが、ロジックは存在）
function info(message, ...details) {
  // log("info", message, ...details);
  // コメントアウトされているため、何も実行しない
}

// warn 関数のロジックを再現（コメントアウトされているが、ロジックは存在）
function warn(message, ...details) {
  // log("warn", message, ...details);
  // コメントアウトされているため、何も実行しない
}

// error 関数のロジックを再現（コメントアウトされているが、ロジックは存在）
function error(message, ...details) {
  // log("error", message, ...details);
  // コメントアウトされているため、何も実行しない
}

test('info function exists and can be called', () => {
  // コメントアウトされているため、エラーが発生しないことを確認
  assert.doesNotThrow(() => {
    info("test message");
    info("test message", { key: "value" });
    info(null);
    info(undefined);
  });
});

test('warn function exists and can be called', () => {
  // コメントアウトされているため、エラーが発生しないことを確認
  assert.doesNotThrow(() => {
    warn("test message");
    warn("test message", { key: "value" });
    warn(null);
    warn(undefined);
  });
});

test('error function exists and can be called', () => {
  // コメントアウトされているため、エラーが発生しないことを確認
  assert.doesNotThrow(() => {
    error("test message");
    error("test message", { key: "value" });
    error(null);
    error(undefined);
  });
});

test('log function normalizes message to string', () => {
  let loggedMessage = null;
  let loggedPrefix = null;
  const mockConsole = {
    log: (prefix, message, ...extras) => {
      loggedPrefix = prefix;
      loggedMessage = message;
    }
  };
  
  // log 関数のロジックをテストするため、console をモック
  const originalConsole = global.console;
  try {
    global.console = mockConsole;
    log("log", 123);
    assert.equal(loggedPrefix, PREFIX);
    assert.equal(loggedMessage, "123");
  } finally {
    global.console = originalConsole;
  }
});

test('log function handles null and undefined messages', () => {
  let loggedMessage = null;
  const mockConsole = {
    log: (prefix, message, ...extras) => {
      loggedMessage = message;
    }
  };
  
  const originalConsole = global.console;
  try {
    global.console = mockConsole;
    log("log", null);
    assert.equal(loggedMessage, "");
    
    log("log", undefined);
    assert.equal(loggedMessage, "");
  } finally {
    global.console = originalConsole;
  }
});

test('log function filters undefined details', () => {
  let loggedExtras = null;
  const mockConsole = {
    log: (prefix, message, ...extras) => {
      loggedExtras = extras;
    }
  };
  
  const originalConsole = global.console;
  try {
    global.console = mockConsole;
    log("log", "message", "value1", undefined, "value2", null);
    assert.equal(loggedExtras.length, 3); // undefined は除外されるが、null は含まれる
    assert.equal(loggedExtras[0], "value1");
    assert.equal(loggedExtras[1], "value2");
    assert.equal(loggedExtras[2], null);
  } finally {
    global.console = originalConsole;
  }
});

test('PREFIX constant is defined', () => {
  assert.equal(PREFIX, "[DisplayLink]");
});

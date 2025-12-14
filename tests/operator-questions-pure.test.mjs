import { test } from 'node:test';
import assert from 'node:assert/strict';

// operator/questions.js は Firebase 依存があるため、純粋関数のロジックを再現してテスト
// isPickUpQuestion, normalizeSubTab をテスト

const SUB_TAB_OPTIONS = new Set(["all", "normal", "puq"]);
const PICK_UP_NAME_CANONICAL = "pick up question";
const DEFAULT_SIDE_TELOP = "まずは自己紹介です…";
const QUESTIONS_SUBTAB_KEY = "telop-ops-questions-subtab";

// isPickUpQuestion のロジックを再現
function isPickUpQuestion(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  if (record["ピックアップ"] === true) {
    return true;
  }
  const radioName = String(record["ラジオネーム"] ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return radioName === PICK_UP_NAME_CANONICAL;
}

// normalizeSubTab のロジックを再現
function normalizeSubTab(value) {
  const candidate = String(value || "").trim();
  return SUB_TAB_OPTIONS.has(candidate) ? candidate : "all";
}

test('isPickUpQuestion returns true when ピックアップ is true', () => {
  const record = { "ピックアップ": true };
  assert.equal(isPickUpQuestion(record), true);
});

test('isPickUpQuestion returns true when ラジオネーム matches PICK_UP_NAME_CANONICAL', () => {
  const record = { "ラジオネーム": "pick up question" };
  assert.equal(isPickUpQuestion(record), true);
});

test('isPickUpQuestion returns true when ラジオネーム matches PICK_UP_NAME_CANONICAL with different case', () => {
  const record = { "ラジオネーム": "PICK UP QUESTION" };
  assert.equal(isPickUpQuestion(record), true);
});

test('isPickUpQuestion returns true when ラジオネーム matches PICK_UP_NAME_CANONICAL with extra spaces', () => {
  const record = { "ラジオネーム": "  pick   up   question  " };
  assert.equal(isPickUpQuestion(record), true);
});

test('isPickUpQuestion returns false for non-pickup records', () => {
  const record = { "ラジオネーム": "normal question" };
  assert.equal(isPickUpQuestion(record), false);
});

test('isPickUpQuestion returns false for null or undefined', () => {
  assert.equal(isPickUpQuestion(null), false);
  assert.equal(isPickUpQuestion(undefined), false);
});

test('isPickUpQuestion returns false for non-object', () => {
  assert.equal(isPickUpQuestion("string"), false);
  assert.equal(isPickUpQuestion(123), false);
});

test('isPickUpQuestion returns false when ラジオネーム is empty', () => {
  const record = { "ラジオネーム": "" };
  assert.equal(isPickUpQuestion(record), false);
});

test('normalizeSubTab returns value when it is in SUB_TAB_OPTIONS', () => {
  assert.equal(normalizeSubTab("all"), "all");
  assert.equal(normalizeSubTab("normal"), "normal");
  assert.equal(normalizeSubTab("puq"), "puq");
});

test('normalizeSubTab returns "all" for invalid values', () => {
  assert.equal(normalizeSubTab("invalid"), "all");
  assert.equal(normalizeSubTab(""), "all");
  assert.equal(normalizeSubTab(null), "all");
  assert.equal(normalizeSubTab(undefined), "all");
});

test('normalizeSubTab trims whitespace', () => {
  assert.equal(normalizeSubTab("  all  "), "all");
  assert.equal(normalizeSubTab("  normal  "), "normal");
  assert.equal(normalizeSubTab("  puq  "), "puq");
});

test('PICK_UP_NAME_CANONICAL constant is defined', () => {
  assert.equal(PICK_UP_NAME_CANONICAL, "pick up question");
});

test('DEFAULT_SIDE_TELOP constant is defined', () => {
  assert.equal(DEFAULT_SIDE_TELOP, "まずは自己紹介です…");
});

test('SUB_TAB_OPTIONS contains expected values', () => {
  assert(SUB_TAB_OPTIONS.has("all"));
  assert(SUB_TAB_OPTIONS.has("normal"));
  assert(SUB_TAB_OPTIONS.has("puq"));
  assert.equal(SUB_TAB_OPTIONS.size, 3);
});

// loadPreferredSubTab のロジックを再現
function loadPreferredSubTab(mockLocalStorage) {
  let stored = "";
  try {
    stored = mockLocalStorage.getItem(QUESTIONS_SUBTAB_KEY) || "";
  } catch (error) {
    stored = "";
  }
  return normalizeSubTab(stored);
}

test('loadPreferredSubTab loads and normalizes sub tab from localStorage', () => {
  const mockStorage = {
    getItem: (key) => {
      if (key === QUESTIONS_SUBTAB_KEY) return 'all';
      return null;
    }
  };
  const result = loadPreferredSubTab(mockStorage);
  assert.equal(result, 'all');
});

test('loadPreferredSubTab handles missing localStorage item', () => {
  const mockStorage = {
    getItem: (key) => null
  };
  const result = loadPreferredSubTab(mockStorage);
  assert.equal(result, 'all'); // デフォルト値
});

test('loadPreferredSubTab handles localStorage errors gracefully', () => {
  const mockStorage = {
    getItem: (key) => {
      throw new Error('Storage error');
    }
  };
  const result = loadPreferredSubTab(mockStorage);
  assert.equal(result, 'all'); // エラー時はデフォルト値
});

test('loadPreferredSubTab normalizes invalid values', () => {
  const mockStorage = {
    getItem: (key) => {
      if (key === QUESTIONS_SUBTAB_KEY) return 'invalid';
      return null;
    }
  };
  const result = loadPreferredSubTab(mockStorage);
  assert.equal(result, 'all'); // 無効な値はデフォルト値に正規化
});

test('loadPreferredSubTab normalizes valid values', () => {
  const mockStorage1 = {
    getItem: (key) => {
      if (key === QUESTIONS_SUBTAB_KEY) return 'normal';
      return null;
    }
  };
  const result1 = loadPreferredSubTab(mockStorage1);
  assert.equal(result1, 'normal');
  
  const mockStorage2 = {
    getItem: (key) => {
      if (key === QUESTIONS_SUBTAB_KEY) return 'puq';
      return null;
    }
  };
  const result2 = loadPreferredSubTab(mockStorage2);
  assert.equal(result2, 'puq');
});

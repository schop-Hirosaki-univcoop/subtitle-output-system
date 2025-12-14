import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  countGraphemes,
  truncateGraphemes,
  normalizeKey,
  normalizeMultiline,
  sanitizeRadioName
} from '../scripts/question-form/string-utils.js';

test('countGraphemes counts basic characters correctly', () => {
  assert.equal(countGraphemes('hello'), 5);
  assert.equal(countGraphemes('こんにちは'), 5);
  assert.equal(countGraphemes(''), 0);
  assert.equal(countGraphemes(null), 0);
  assert.equal(countGraphemes(undefined), 0);
});

test('countGraphemes handles emoji and complex graphemes', () => {
  // 絵文字は1つのgraphemeとしてカウントされるべき
  assert.equal(countGraphemes('👋'), 1);
  assert.equal(countGraphemes('👋👋'), 2);
  assert.equal(countGraphemes('hello👋'), 6);
  // 結合文字（濁点など）
  assert.equal(countGraphemes('が'), 1);
  assert.equal(countGraphemes('がっき'), 3);
});

test('truncateGraphemes truncates strings at grapheme boundaries', () => {
  assert.equal(truncateGraphemes('hello', 3), 'hel');
  assert.equal(truncateGraphemes('こんにちは', 3), 'こんに');
  assert.equal(truncateGraphemes('hello👋', 6), 'hello👋');
  assert.equal(truncateGraphemes('hello👋', 5), 'hello');
  assert.equal(truncateGraphemes('', 5), '');
  assert.equal(truncateGraphemes(null, 5), '');
  assert.equal(truncateGraphemes('hello', 0), 'hello');
  assert.equal(truncateGraphemes('hello', -1), 'hello');
});

test('truncateGraphemes handles edge cases', () => {
  assert.equal(truncateGraphemes('hello', 10), 'hello');
  assert.equal(truncateGraphemes('hello', null), 'hello');
  assert.equal(truncateGraphemes('hello', undefined), 'hello');
});

test('normalizeKey normalizes strings for Firebase keys', () => {
  assert.equal(normalizeKey('  hello  '), 'hello');
  assert.equal(normalizeKey('hello\u0000world'), 'helloworld');
  assert.equal(normalizeKey('hello\u0001world'), 'helloworld');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
  assert.equal(normalizeKey(123), '123');
});

test('normalizeKey applies NFKC normalization', () => {
  // 全角数字を半角に変換
  assert.equal(normalizeKey('１２３'), '123');
  // 全角英字を半角に変換
  assert.equal(normalizeKey('ＨＥＬＬＯ'), 'HELLO');
});

test('normalizeMultiline normalizes multiline text', () => {
  assert.equal(normalizeMultiline('hello\nworld'), 'hello\nworld');
  assert.equal(normalizeMultiline('hello\r\nworld'), 'hello\nworld');
  assert.equal(normalizeMultiline('hello\rworld'), 'hello\nworld');
  assert.equal(normalizeMultiline('hello\tworld'), 'hello world');
  assert.equal(normalizeMultiline('hello\n\n\nworld'), 'hello\n\nworld');
  assert.equal(normalizeMultiline('  hello  \n  world  '), '  hello  \n  world');
  assert.equal(normalizeMultiline(null), '');
  assert.equal(normalizeMultiline(undefined), '');
});

test('normalizeMultiline removes control characters except line breaks', () => {
  assert.equal(normalizeMultiline('hello\u0000world'), 'helloworld');
  assert.equal(normalizeMultiline('hello\u0001world'), 'helloworld');
  assert.equal(normalizeMultiline('hello\nworld'), 'hello\nworld');
  assert.equal(normalizeMultiline('hello\u0000\nworld'), 'hello\nworld');
});

test('sanitizeRadioName sanitizes radio button names', () => {
  assert.equal(sanitizeRadioName('hello'), 'hello');
  assert.equal(sanitizeRadioName('  hello  '), 'hello');
  assert.equal(sanitizeRadioName('hello world'), 'hello world');
  assert.equal(sanitizeRadioName('hello\u3000world'), 'hello world');
  assert.equal(sanitizeRadioName('hello-world'), 'hello-world');
  // アンダースコアはUnicodeプロパティに含まれないため削除される
  assert.equal(sanitizeRadioName('hello_world'), 'helloworld');
  assert.equal(sanitizeRadioName('hello・world'), 'hello・world');
  assert.equal(sanitizeRadioName('hello@world'), 'helloworld');
  assert.equal(sanitizeRadioName('hello#world'), 'helloworld');
  assert.equal(sanitizeRadioName(null), '');
  assert.equal(sanitizeRadioName(undefined), '');
});

test('sanitizeRadioName applies length limit', () => {
  assert.equal(sanitizeRadioName('hello', 3), 'hel');
  assert.equal(sanitizeRadioName('こんにちは', 3), 'こんに');
  // 絵文字はUnicodeプロパティに含まれないため削除される
  assert.equal(sanitizeRadioName('hello👋', 6), 'hello');
  assert.equal(sanitizeRadioName('hello👋', 5), 'hello');
  assert.equal(sanitizeRadioName('hello', 10), 'hello');
  assert.equal(sanitizeRadioName('hello', 0), 'hello');
  assert.equal(sanitizeRadioName('hello', -1), 'hello');
});

test('sanitizeRadioName handles Japanese characters', () => {
  assert.equal(sanitizeRadioName('こんにちは'), 'こんにちは');
  assert.equal(sanitizeRadioName('がっき'), 'がっき');
  assert.equal(sanitizeRadioName('漢字'), '漢字');
});

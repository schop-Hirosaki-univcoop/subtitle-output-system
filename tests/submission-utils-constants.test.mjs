import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ZERO_WIDTH_SPACE_PATTERN } from '../scripts/question-form/submission-utils.js';

test('ZERO_WIDTH_SPACE_PATTERN matches zero-width characters', () => {
  assert(ZERO_WIDTH_SPACE_PATTERN instanceof RegExp);
  // test() は lastIndex を更新するため、exec() を使用
  assert(ZERO_WIDTH_SPACE_PATTERN.exec('\u200B')); // Zero Width Space
  ZERO_WIDTH_SPACE_PATTERN.lastIndex = 0;
  assert(ZERO_WIDTH_SPACE_PATTERN.exec('\u200C')); // Zero Width Non-Joiner
  ZERO_WIDTH_SPACE_PATTERN.lastIndex = 0;
  assert(ZERO_WIDTH_SPACE_PATTERN.exec('\u200D')); // Zero Width Joiner
  ZERO_WIDTH_SPACE_PATTERN.lastIndex = 0;
  assert(ZERO_WIDTH_SPACE_PATTERN.exec('\u200E')); // Left-to-Right Mark
  ZERO_WIDTH_SPACE_PATTERN.lastIndex = 0;
  assert(ZERO_WIDTH_SPACE_PATTERN.exec('\u200F')); // Right-to-Left Mark
  ZERO_WIDTH_SPACE_PATTERN.lastIndex = 0;
  assert(ZERO_WIDTH_SPACE_PATTERN.exec('\uFEFF')); // Zero Width No-Break Space
  ZERO_WIDTH_SPACE_PATTERN.lastIndex = 0;
  assert.equal(ZERO_WIDTH_SPACE_PATTERN.exec('normal text'), null);
});

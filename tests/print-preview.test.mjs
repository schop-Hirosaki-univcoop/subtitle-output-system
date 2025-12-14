import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PREVIEW_NOTE,
  DEFAULT_LOAD_TIMEOUT_MS
} from '../scripts/shared/print-preview.js';

test('DEFAULT_PREVIEW_NOTE is defined', () => {
  assert.equal(DEFAULT_PREVIEW_NOTE, '印刷設定を選ぶとここに最新のプレビューが表示されます。');
});

test('DEFAULT_LOAD_TIMEOUT_MS is defined', () => {
  assert.equal(DEFAULT_LOAD_TIMEOUT_MS, 4000);
});

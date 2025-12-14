import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACULTY_LEVEL_SUGGESTIONS } from '../scripts/events/tools/gl-faculty-builder.js';

test('FACULTY_LEVEL_SUGGESTIONS is defined', () => {
  assert.deepEqual(FACULTY_LEVEL_SUGGESTIONS, [
    '学科',
    '課程',
    '専攻',
    'コース',
    'プログラム',
    '領域'
  ]);
});

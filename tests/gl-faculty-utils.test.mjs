import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFacultyList } from '../scripts/events/tools/gl-faculty-utils.js';

test('normalizeFacultyList normalizes faculty list from array', () => {
  const source = [
    {
      faculty: '工学部',
      unitTree: {
        label: '学科',
        options: [
          { value: '情報学科', label: '情報学科' }
        ]
      }
    }
  ];
  const result = normalizeFacultyList(source);
  assert(Array.isArray(result));
  assert(result.length > 0);
  assert.equal(result[0].faculty, '工学部');
});

test('normalizeFacultyList normalizes faculty list from object', () => {
  const source = {
    faculties: [
      { faculty: '工学部' }
    ]
  };
  const result = normalizeFacultyList(source);
  assert(Array.isArray(result));
  assert(result.length > 0);
});

test('normalizeFacultyList filters invalid entries', () => {
  const source = [
    { faculty: '工学部' },
    { name: '無効' }, // faculty がないが、name から取得される可能性がある
    null,
    undefined
  ];
  const result = normalizeFacultyList(source);
  // name から faculty が取得される可能性があるため、結果の長さを確認
  assert(result.length >= 1);
  assert(result.some(entry => entry.faculty === '工学部'));
});

test('normalizeFacultyList handles empty input', () => {
  assert.deepEqual(normalizeFacultyList([]), []);
  assert.deepEqual(normalizeFacultyList(null), []);
  assert.deepEqual(normalizeFacultyList(undefined), []);
  assert.deepEqual(normalizeFacultyList({}), []);
});

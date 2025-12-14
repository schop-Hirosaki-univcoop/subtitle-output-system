import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GAS_API_URL,
  STEP_LABELS,
  GENRE_ALL_VALUE,
  GENRE_OPTIONS,
  DICTIONARY_STATE_KEY,
  LOGS_STATE_KEY,
  QUESTIONS_SUBTAB_KEY
} from '../scripts/operator/constants.js';

test('GAS_API_URL is defined', () => {
  assert(typeof GAS_API_URL === 'string');
  assert(GAS_API_URL.startsWith('https://'));
  assert(!GAS_API_URL.includes(' ')); // 空白が除去されている
});

test('STEP_LABELS is defined', () => {
  assert.deepEqual(STEP_LABELS, [
    '認証',
    '在籍チェック',
    '管理者付与',
    '初期ミラー',
    '購読開始',
    '準備完了'
  ]);
});

test('GENRE_ALL_VALUE is defined', () => {
  assert.equal(GENRE_ALL_VALUE, 'all');
});

test('GENRE_OPTIONS is defined', () => {
  assert.deepEqual(GENRE_OPTIONS, ['学び', '活動', '暮らし', '食・スポット', '移動・季節', 'その他']);
});

test('DICTIONARY_STATE_KEY is defined', () => {
  assert.equal(DICTIONARY_STATE_KEY, 'telop-ops-dictionary-open');
});

test('LOGS_STATE_KEY is defined', () => {
  assert.equal(LOGS_STATE_KEY, 'telop-ops-logs-open');
});

test('QUESTIONS_SUBTAB_KEY is defined', () => {
  assert.equal(QUESTIONS_SUBTAB_KEY, 'telop-ops-questions-subtab');
});

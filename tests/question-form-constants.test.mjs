import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GENRE_OPTIONS,
  TOKEN_PARAM_KEYS,
  MAX_RADIO_NAME_LENGTH,
  MAX_QUESTION_LENGTH,
  FORM_VERSION
} from '../scripts/question-form/constants.js';

test('GENRE_OPTIONS is defined', () => {
  assert.deepEqual(GENRE_OPTIONS, ['学び', '活動', '暮らし', '食・スポット', '移動・季節', 'その他']);
});

test('TOKEN_PARAM_KEYS is defined', () => {
  assert.deepEqual(TOKEN_PARAM_KEYS, ['token', 't', 'key']);
});

test('MAX_RADIO_NAME_LENGTH is defined', () => {
  assert.equal(MAX_RADIO_NAME_LENGTH, 20);
});

test('MAX_QUESTION_LENGTH is defined', () => {
  assert.equal(MAX_QUESTION_LENGTH, 60);
});

test('FORM_VERSION is defined', () => {
  assert.equal(FORM_VERSION, 'question-form@2024.11');
});

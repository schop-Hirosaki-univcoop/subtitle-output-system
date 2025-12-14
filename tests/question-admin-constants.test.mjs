import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GAS_API_URL,
  FORM_PAGE_PATH,
  STEP_LABELS,
  PARTICIPANT_TEMPLATE_HEADERS,
  TEAM_TEMPLATE_HEADERS
} from '../scripts/question-admin/constants.js';

test('GAS_API_URL is defined', () => {
  assert(typeof GAS_API_URL === 'string');
  assert(GAS_API_URL.startsWith('https://'));
});

test('FORM_PAGE_PATH is defined', () => {
  assert.equal(FORM_PAGE_PATH, 'question-form.html');
});

test('STEP_LABELS is defined', () => {
  assert.deepEqual(STEP_LABELS, [
    '認証',
    '在籍チェック',
    '管理者付与',
    '初期データ取得',
    '仕上げ',
    '準備完了'
  ]);
});

test('PARTICIPANT_TEMPLATE_HEADERS is defined', () => {
  assert.deepEqual(PARTICIPANT_TEMPLATE_HEADERS, [
    '名前',
    'フリガナ',
    '性別',
    '学部学科',
    '携帯電話',
    'メールアドレス'
  ]);
});

test('TEAM_TEMPLATE_HEADERS is defined', () => {
  assert.deepEqual(TEAM_TEMPLATE_HEADERS, [
    '学部学科',
    '性別',
    '名前',
    '班番号',
    'uid'
  ]);
});

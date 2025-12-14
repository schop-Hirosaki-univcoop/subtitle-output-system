import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTEXT_DESCRIPTION_SUFFIX,
  DEFAULT_CONTEXT_DESCRIPTION,
  buildContextDescription
} from '../scripts/question-form/context-copy.js';

test('CONTEXT_DESCRIPTION_SUFFIX is defined', () => {
  assert.equal(CONTEXT_DESCRIPTION_SUFFIX, '気になることや相談したいことをお気軽にお寄せください。');
});

test('DEFAULT_CONTEXT_DESCRIPTION is defined', () => {
  assert(DEFAULT_CONTEXT_DESCRIPTION.includes('なんでも相談ラジオ'));
  assert(DEFAULT_CONTEXT_DESCRIPTION.includes(CONTEXT_DESCRIPTION_SUFFIX));
});

test('buildContextDescription uses default copy for blank event names', () => {
  assert.equal(buildContextDescription(''), DEFAULT_CONTEXT_DESCRIPTION);
  assert.equal(buildContextDescription(null), DEFAULT_CONTEXT_DESCRIPTION);
  assert.equal(buildContextDescription(undefined), DEFAULT_CONTEXT_DESCRIPTION);
  assert.equal(buildContextDescription('   '), DEFAULT_CONTEXT_DESCRIPTION);
});

test('buildContextDescription injects the event name and suffix', () => {
  const description = buildContextDescription('春フェス2025');
  assert(description.includes('春フェス2025'));
  assert(description.includes('なんでも相談ラジオ'));
  assert(description.endsWith(`。${CONTEXT_DESCRIPTION_SUFFIX}`));
});

test('buildContextDescription trims whitespace from event name', () => {
  const description1 = buildContextDescription('  春フェス2025  ');
  const description2 = buildContextDescription('春フェス2025');
  assert.equal(description1, description2);
});

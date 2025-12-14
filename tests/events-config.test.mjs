import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGE_SEQUENCE,
  STAGE_INFO,
  PANEL_CONFIG,
  SHORTCUT_KEY_TO_PANEL,
  PANEL_STAGE_INFO,
  FOCUSABLE_SELECTOR
} from '../scripts/events/config.js';

test('STAGE_SEQUENCE is defined', () => {
  assert.deepEqual(STAGE_SEQUENCE, ['events', 'schedules', 'tabs']);
});

test('STAGE_INFO contains events and schedules', () => {
  assert('events' in STAGE_INFO);
  assert('schedules' in STAGE_INFO);
  assert.equal(STAGE_INFO.events.title, 'イベントの管理');
  assert.equal(STAGE_INFO.schedules.title, '日程の管理');
});

test('PANEL_CONFIG contains all panel configurations', () => {
  assert('events' in PANEL_CONFIG);
  assert('schedules' in PANEL_CONFIG);
  assert('participants' in PANEL_CONFIG);
  assert('gl' in PANEL_CONFIG);
  assert('gl-faculties' in PANEL_CONFIG);
  assert('operator' in PANEL_CONFIG);
  assert('dictionary' in PANEL_CONFIG);
  assert('pickup' in PANEL_CONFIG);
  assert('logs' in PANEL_CONFIG);
});

test('SHORTCUT_KEY_TO_PANEL maps keys 1-9 to panels', () => {
  assert.equal(SHORTCUT_KEY_TO_PANEL[1], 'events');
  assert.equal(SHORTCUT_KEY_TO_PANEL[2], 'schedules');
  assert.equal(SHORTCUT_KEY_TO_PANEL[3], 'participants');
  assert.equal(SHORTCUT_KEY_TO_PANEL[4], 'gl');
  assert.equal(SHORTCUT_KEY_TO_PANEL[5], 'gl-faculties');
  assert.equal(SHORTCUT_KEY_TO_PANEL[6], 'operator');
  assert.equal(SHORTCUT_KEY_TO_PANEL[7], 'dictionary');
  assert.equal(SHORTCUT_KEY_TO_PANEL[8], 'pickup');
  assert.equal(SHORTCUT_KEY_TO_PANEL[9], 'logs');
});

test('PANEL_STAGE_INFO contains all panel stage info', () => {
  assert('events' in PANEL_STAGE_INFO);
  assert('schedules' in PANEL_STAGE_INFO);
  assert('participants' in PANEL_STAGE_INFO);
  assert('gl' in PANEL_STAGE_INFO);
  assert('gl-faculties' in PANEL_STAGE_INFO);
  assert('operator' in PANEL_STAGE_INFO);
  assert('dictionary' in PANEL_STAGE_INFO);
  assert('pickup' in PANEL_STAGE_INFO);
  assert('logs' in PANEL_STAGE_INFO);
});

test('FOCUSABLE_SELECTOR is defined', () => {
  assert(typeof FOCUSABLE_SELECTOR === 'string');
  assert(FOCUSABLE_SELECTOR.includes('a[href]'));
  assert(FOCUSABLE_SELECTOR.includes('button'));
  assert(FOCUSABLE_SELECTOR.includes('input'));
});

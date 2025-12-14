import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LoadingTracker } from '../scripts/events/loading-tracker.js';

test('LoadingTracker initializes with default state', () => {
  const tracker = new LoadingTracker();
  assert.equal(tracker.depth, 0);
  assert.equal(tracker.message, '');
  assert.equal(tracker.isActive(), false);
  assert.deepEqual(tracker.getState(), { active: false, message: '' });
});

test('LoadingTracker begin increments depth', () => {
  const tracker = new LoadingTracker();
  tracker.begin('Loading...');
  assert.equal(tracker.depth, 1);
  assert.equal(tracker.message, 'Loading...');
  assert.equal(tracker.isActive(), true);
  assert.deepEqual(tracker.getState(), { active: true, message: 'Loading...' });
});

test('LoadingTracker end decrements depth', () => {
  const tracker = new LoadingTracker();
  tracker.begin('Loading...');
  tracker.end();
  assert.equal(tracker.depth, 0);
  assert.equal(tracker.message, '');
  assert.equal(tracker.isActive(), false);
});

test('LoadingTracker handles multiple begin/end', () => {
  const tracker = new LoadingTracker();
  tracker.begin('Step 1');
  tracker.begin('Step 2');
  assert.equal(tracker.depth, 2);
  assert.equal(tracker.isActive(), true);
  
  tracker.end();
  assert.equal(tracker.depth, 1);
  assert.equal(tracker.isActive(), true);
  assert.equal(tracker.message, 'Step 2');
  
  tracker.end();
  assert.equal(tracker.depth, 0);
  assert.equal(tracker.isActive(), false);
  assert.equal(tracker.message, '');
});

test('LoadingTracker updateMessage updates message when active', () => {
  const tracker = new LoadingTracker();
  tracker.begin('Initial');
  tracker.updateMessage('Updated');
  assert.equal(tracker.message, 'Updated');
  assert.equal(tracker.isActive(), true);
});

test('LoadingTracker updateMessage clears message when inactive', () => {
  const tracker = new LoadingTracker();
  tracker.updateMessage('Test');
  assert.equal(tracker.message, '');
  assert.equal(tracker.isActive(), false);
});

test('LoadingTracker reset clears state', () => {
  const tracker = new LoadingTracker();
  tracker.begin('Loading...');
  tracker.begin('Step 2');
  tracker.reset();
  assert.equal(tracker.depth, 0);
  assert.equal(tracker.message, '');
  assert.equal(tracker.isActive(), false);
});

test('LoadingTracker onChange callback is called', () => {
  let callCount = 0;
  let lastState = null;
  const tracker = new LoadingTracker({
    onChange: (state) => {
      callCount++;
      lastState = state;
    }
  });
  
  tracker.begin('Loading...');
  assert.equal(callCount, 1);
  assert.deepEqual(lastState, { active: true, message: 'Loading...' });
  
  tracker.end();
  assert.equal(callCount, 2);
  assert.deepEqual(lastState, { active: false, message: '' });
});

test('LoadingTracker end does not go below zero', () => {
  const tracker = new LoadingTracker();
  tracker.end();
  tracker.end();
  assert.equal(tracker.depth, 0);
  assert.equal(tracker.isActive(), false);
});

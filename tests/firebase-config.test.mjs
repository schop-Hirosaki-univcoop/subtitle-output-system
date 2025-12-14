import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIREBASE_CONFIG } from '../scripts/shared/firebase-config.js';

test('FIREBASE_CONFIG is defined and frozen', () => {
  assert(typeof FIREBASE_CONFIG === 'object');
  assert.notEqual(FIREBASE_CONFIG, null);
  assert.equal(FIREBASE_CONFIG.apiKey, 'AIzaSyBh54ZKsM6uNph61QrP-Ypu7bzU_PHbNcY');
  assert.equal(FIREBASE_CONFIG.authDomain, 'subtitle-output-system-9bc14.firebaseapp.com');
  assert.equal(FIREBASE_CONFIG.projectId, 'subtitle-output-system-9bc14');
  assert(Object.isFrozen(FIREBASE_CONFIG));
});

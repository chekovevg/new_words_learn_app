import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuthTransition } from '../src/lib/auth-transition.js';

function session(userId) {
  return { user: { id: userId } };
}

test('clears user data when there is no active session', () => {
  assert.equal(resolveAuthTransition('user-1', null), 'clear');
});

test('reuses data already loaded for the current user', () => {
  assert.equal(resolveAuthTransition('user-1', session('user-1')), 'reuse');
});

test('loads a newly signed-up user whose data is not loaded', () => {
  assert.equal(resolveAuthTransition(null, session('user-1')), 'load');
});

test('loads data when the authenticated user changes', () => {
  assert.equal(resolveAuthTransition('user-1', session('user-2')), 'load');
});

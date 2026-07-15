import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const supabaseSource = fs.readFileSync(path.join(root, 'src/lib/supabase.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('does not await database work inside the Supabase auth callback', () => {
  assert.doesNotMatch(mainSource, /onAuthStateChange\(async/);
  assert.match(mainSource, /setTimeout\(\(\) => handleAuthStateChange\(nextSession\)/);
});

test('does not mark a sign-up user loaded before loadUserData succeeds', () => {
  assert.doesNotMatch(mainSource, /loadedUserId\s*=\s*data\.session\.user\.id/);
});

test('lets the database assign the default role on fallback profile creation', () => {
  const fallbackInsert = mainSource.match(/from\('profiles'\)\.insert\(\{[\s\S]*?\}\);/)?.[0] || '';
  assert.ok(fallbackInsert, 'expected a fallback profile insert');
  assert.doesNotMatch(fallbackInsert, /role\s*:/);
});

test('clears persisted add-word state after a successful save', () => {
  assert.match(mainSource, /state\.forms\.addWord\s*=\s*createDefaultAddWordForm\(\)/);
});

test('builds the confirmation redirect from the deployed base URL', () => {
  assert.match(mainSource, /new URL\(import\.meta\.env\.BASE_URL, window\.location\.href\)/);
});

test('does not ship a project-specific Supabase fallback', () => {
  assert.doesNotMatch(supabaseSource, /\.supabase\.co/);
  assert.doesNotMatch(supabaseSource, /sb_publishable_/);
});

test('does not import the legacy seed eagerly', () => {
  assert.doesNotMatch(mainSource, /^import seedWords from/m);
  assert.match(mainSource, /import\('\.\/data\/words\.js'\)/);
});

test('does not preserve an obsolete browser import map', () => {
  assert.doesNotMatch(indexSource, /type=["']importmap["']/);
});

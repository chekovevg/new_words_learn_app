import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainSource = readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

test('sends the current Supabase access token to the enrichment endpoint', () => {
  assert.match(mainSource, /Authorization:\s*`Bearer \$\{state\.session\.access_token\}`/);
});

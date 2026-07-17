import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const initPath = path.join(root, 'supabase', 'migrations', '20260526_init.sql');
const hardeningPath = path.join(root, 'supabase', 'migrations', '20260715_release_hardening.sql');
const russianTranslationOnlyPath = path.join(root, 'supabase', 'migrations', '20260718_russian_translation_only.sql');
const initSql = readFileSync(initPath, 'utf8');
const hardeningSql = existsSync(hardeningPath) ? readFileSync(hardeningPath, 'utf8') : '';
const russianTranslationOnlySql = existsSync(russianTranslationOnlyPath)
  ? readFileSync(russianTranslationOnlyPath, 'utf8')
  : '';

test('does not grant authenticated users table-wide profile writes', () => {
  assert.doesNotMatch(
    initSql,
    /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+public\.profiles\s+to\s+authenticated/i
  );
  assert.match(initSql, /grant\s+insert\s*\(id,\s*email,\s*name\)/i);
  assert.match(initSql, /grant\s+update\s*\(name,\s*legacy_html_seed_imported_at\)/i);
});

test('creates privileged functions before granting execute', () => {
  const functionIndex = initSql.indexOf('create or replace function public.admin_delete_user');
  const grantIndex = initSql.indexOf('grant execute on function public.admin_delete_user');

  assert.ok(functionIndex >= 0, 'admin_delete_user must exist');
  assert.ok(grantIndex > functionIndex, 'function grant must follow its definition');
});

test('ships an upgrade migration that removes existing unsafe profile grants', () => {
  assert.ok(existsSync(hardeningPath), 'release hardening migration must exist');
  assert.match(hardeningSql, /revoke\s+insert,\s*update,\s*delete\s+on\s+table\s+public\.profiles/i);
  assert.match(hardeningSql, /grant\s+update\s*\(name,\s*legacy_html_seed_imported_at\)/i);
});

test('adds an authenticated and atomic daily AI quota', () => {
  assert.match(hardeningSql, /create\s+table\s+if\s+not\s+exists\s+public\.ai_enrichment_usage/i);
  assert.match(hardeningSql, /create\s+or\s+replace\s+function\s+public\.consume_ai_enrichment_quota/i);
  assert.match(hardeningSql, /auth\.uid\(\)/i);
  assert.match(hardeningSql, /on\s+conflict\s*\(user_id,\s*usage_date\)/i);
});

test('protects the final administrator from deletion or demotion', () => {
  assert.match(hardeningSql, /Cannot delete the final admin/);
  assert.match(hardeningSql, /Cannot demote the final admin/);
});

test('prevents Russian from being stored as a card language', () => {
  assert.ok(existsSync(russianTranslationOnlyPath), 'Russian translation-only migration must exist');
  assert.match(russianTranslationOnlySql, /add\s+constraint\s+words_language_not_russian_check/i);
  assert.match(russianTranslationOnlySql, /<>\s*'russian'/i);
});

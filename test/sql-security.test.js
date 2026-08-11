import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const initPath = path.join(root, 'supabase', 'migrations', '20260526_init.sql');
const hardeningPath = path.join(root, 'supabase', 'migrations', '20260715_release_hardening.sql');
const russianTranslationOnlyPath = path.join(root, 'supabase', 'migrations', '20260718_russian_translation_only.sql');
const russianTranslationsRequiredPath = path.join(root, 'supabase', 'migrations', '20260718_russian_translations_required.sql');
const initSql = readFileSync(initPath, 'utf8');
const hardeningSql = existsSync(hardeningPath) ? readFileSync(hardeningPath, 'utf8') : '';
const russianTranslationOnlySql = existsSync(russianTranslationOnlyPath)
  ? readFileSync(russianTranslationOnlyPath, 'utf8')
  : '';
const russianTranslationsRequiredSql = existsSync(russianTranslationsRequiredPath)
  ? readFileSync(russianTranslationsRequiredPath, 'utf8')
  : '';
const securityHardeningPath = readdirSync(path.join(root, 'supabase', 'migrations'))
  .find((file) => /_security_hardening\.sql$/i.test(file));
const securityHardeningSql = securityHardeningPath
  ? readFileSync(path.join(root, 'supabase', 'migrations', securityHardeningPath), 'utf8')
  : '';

const databaseRoles = ['public', 'anon', 'authenticated'];
const tablePrivileges = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain'];

function sqlStatements(sql) {
  return sql
    .replace(/--.*$/gm, ' ')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function splitSqlList(value) {
  const values = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (value[index] === ',' && depth === 0) {
      values.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  values.push(value.slice(start).trim());
  return values.filter(Boolean);
}

function normalizeRoles(value) {
  return splitSqlList(value).map((role) => role.toLowerCase());
}

function createTablePrivilegeModel() {
  const state = new Map();
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['profiles', 'words', 'ai_enrichment_usage']) {
      for (const privilege of tablePrivileges) {
        state.set(`${role}:${table}:${privilege}:table`, true);
      }
    }
  }
  return state;
}

function evaluateTablePrivileges(sql) {
  const state = createTablePrivilegeModel();

  for (const statement of sqlStatements(sql)) {
    const match = statement.match(
      /^(grant|revoke)\s+(.+?)\s+on\s+(?:table\s+)?public\.(profiles|words|ai_enrichment_usage)\s+(to|from)\s+(.+)$/i
    );
    if (!match) continue;

    const [, action, privilegeList, table, , roleList] = match;
    const roles = normalizeRoles(roleList);
    const parsedPrivileges = /^all(?:\s+privileges)?$/i.test(privilegeList)
      ? tablePrivileges.map((privilege) => [privilege, null])
      : splitSqlList(privilegeList).map((entry) => {
          const privilege = entry.match(/^(select|insert|update|delete|truncate|references|trigger|maintain)(?:\s*\(([^)]*)\))?$/i);
          assert.ok(privilege, `unparsed table privilege: ${entry}`);
          return [privilege[1].toLowerCase(), privilege[2]?.split(',').map((column) => column.trim().toLowerCase()) || null];
        });

    for (const role of roles) {
      for (const [privilege, columns] of parsedPrivileges) {
        if (!columns) {
          state.set(`${role}:${table.toLowerCase()}:${privilege}:table`, action.toLowerCase() === 'grant');
          continue;
        }
        for (const column of columns) {
          state.set(`${role}:${table.toLowerCase()}:${privilege}:${column}`, action.toLowerCase() === 'grant');
        }
      }
    }
  }

  return state;
}

function hasTablePrivilege(state, role, table, privilege, column = 'table') {
  return Boolean(
    state.get(`${role}:${table}:${privilege}:table`) ||
    state.get(`public:${table}:${privilege}:table`) ||
    (column !== 'table' && (
      state.get(`${role}:${table}:${privilege}:${column}`) ||
      state.get(`public:${table}:${privilege}:${column}`)
    ))
  );
}

function evaluateFunctionExecute(sql, signatures) {
  const state = new Map();
  for (const signature of signatures) {
    for (const role of databaseRoles) {
      state.set(`${signature}:${role}`, true);
    }
  }

  const statements = sql.replace(/--.*$/gm, ' ');
  const privilegePattern = /\b(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+function\s+(public\.[a-z_][a-z0-9_]*\s*\([^)]*\))\s+(?:to|from)\s+((?:public|anon|authenticated)(?:\s*,\s*(?:public|anon|authenticated))*)/gi;
  for (const match of statements.matchAll(privilegePattern)) {
    const [, action, rawSignature, roleList] = match;
    const signature = rawSignature
      .toLowerCase()
      .replace(/\s*\(\s*/g, '(')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s*\)/g, ')');
    if (!signatures.includes(signature)) continue;
    for (const role of normalizeRoles(roleList)) {
      state.set(`${signature}:${role}`, action.toLowerCase() === 'grant');
    }
  }

  return {
    canExecute(signature, role) {
      return Boolean(state.get(`${signature}:${role}`) || state.get(`${signature}:public`));
    }
  };
}

function evaluateSequencePrivileges(sql) {
  const state = new Map([
    ['anon', true],
    ['authenticated', true]
  ]);
  for (const statement of sqlStatements(sql)) {
    const match = statement.match(/^(grant|revoke)\s+all(?:\s+privileges)?\s+on\s+all\s+sequences\s+in\s+schema\s+public\s+(to|from)\s+(.+)$/i);
    if (!match) continue;
    for (const role of normalizeRoles(match[3])) {
      state.set(role, match[1].toLowerCase() === 'grant');
    }
  }
  return state;
}

function evaluatePostgresDefaultPrivileges(sql) {
  const state = new Map([
    ['tables:anon', true],
    ['tables:authenticated', true],
    ['sequences:anon', true],
    ['sequences:authenticated', true],
    ['functions:public', true],
    ['functions:anon', true],
    ['functions:authenticated', true]
  ]);
  for (const statement of sqlStatements(sql)) {
    const match = statement.match(
      /^alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public\s+(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+(tables|sequences|functions)\s+(to|from)\s+(.+)$/i
    );
    if (!match) continue;
    for (const role of normalizeRoles(match[4])) {
      state.set(`${match[2].toLowerCase()}:${role}`, match[1].toLowerCase() === 'grant');
    }
  }
  return state;
}

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

test('ships a security hardening migration that limits profile writes to safe columns', () => {
  assert.ok(securityHardeningPath, 'security_hardening migration must exist');
  const state = evaluateTablePrivileges(securityHardeningSql);

  for (const table of ['profiles', 'words', 'ai_enrichment_usage']) {
    for (const privilege of tablePrivileges) {
      assert.equal(hasTablePrivilege(state, 'anon', table, privilege), false, `anon must not have ${privilege} on ${table}`);
    }
  }

  assert.equal(hasTablePrivilege(state, 'authenticated', 'profiles', 'select'), true);
  for (const privilege of tablePrivileges.filter((privilege) => privilege !== 'select')) {
    assert.equal(
      hasTablePrivilege(state, 'authenticated', 'profiles', privilege),
      false,
      `authenticated must not have table-level ${privilege} on profiles`
    );
  }
  for (const column of ['id', 'email', 'name']) {
    assert.equal(hasTablePrivilege(state, 'authenticated', 'profiles', 'insert', column), true);
  }
  for (const column of ['role', 'legacy_html_seed_imported_at', 'created_at', 'updated_at']) {
    assert.equal(hasTablePrivilege(state, 'authenticated', 'profiles', 'insert', column), false);
  }
  for (const column of ['name', 'legacy_html_seed_imported_at']) {
    assert.equal(hasTablePrivilege(state, 'authenticated', 'profiles', 'update', column), true);
  }
  for (const column of ['id', 'email', 'role', 'created_at', 'updated_at']) {
    assert.equal(hasTablePrivilege(state, 'authenticated', 'profiles', 'update', column), false);
  }

  for (const privilege of ['select', 'insert', 'update', 'delete']) {
    assert.equal(hasTablePrivilege(state, 'authenticated', 'words', privilege), true);
  }
  for (const privilege of ['truncate', 'references', 'trigger', 'maintain']) {
    assert.equal(hasTablePrivilege(state, 'authenticated', 'words', privilege), false);
  }
  for (const privilege of tablePrivileges) {
    assert.equal(hasTablePrivilege(state, 'authenticated', 'ai_enrichment_usage', privilege), false);
  }

  const assertRoleColumnDenied = (sql) => {
    const finalState = evaluateTablePrivileges(sql);
    assert.equal(
      hasTablePrivilege(finalState, 'authenticated', 'profiles', 'update', 'role'),
      false,
      'authenticated must not be able to update profiles.role'
    );
  };
  assertRoleColumnDenied(securityHardeningSql);
  assert.throws(
    () => assertRoleColumnDenied(`${securityHardeningSql}\ngrant update on table public.profiles to public;`),
    /profiles\.role/
  );
});

test('security hardening removes anonymous and PUBLIC function execution', () => {
  assert.ok(securityHardeningPath, 'security_hardening migration must exist');
  const internalFunctions = [
    'set_updated_at()',
    'handle_new_user()',
    'rls_auto_enable()'
  ];
  const guardedFunctions = [
    'admin_delete_user(uuid)',
    'admin_set_role(uuid, text)',
    'is_admin()',
    'is_self_or_admin(uuid)',
    'consume_ai_enrichment_quota(integer)'
  ];
  const signatures = [...internalFunctions, ...guardedFunctions].map((signature) => `public.${signature}`);
  const state = evaluateFunctionExecute(securityHardeningSql, signatures);

  assert.match(
    securityHardeningSql,
    /do\s+\$\$[\s\S]*?if\s+to_regprocedure\('public\.rls_auto_enable\(\)'\)\s+is\s+not\s+null\s+then[\s\S]*?execute\s+'revoke\s+all\s+on\s+function\s+public\.rls_auto_enable\(\)\s+from\s+public,\s*anon,\s*authenticated'[\s\S]*?end\s+if[\s\S]*?\$\$/i
  );

  for (const signature of signatures) {
    assert.equal(state.canExecute(signature, 'anon'), false, `anon must not execute ${signature}`);
  }
  for (const functionName of internalFunctions) {
    assert.equal(state.canExecute(`public.${functionName}`, 'authenticated'), false);
  }
  for (const functionName of guardedFunctions) {
    assert.equal(state.canExecute(`public.${functionName}`, 'authenticated'), true);
  }

  const assertRlsAutoEnableDenied = (sql) => {
    const finalState = evaluateFunctionExecute(sql, signatures);
    assert.equal(
      finalState.canExecute('public.rls_auto_enable()', 'authenticated'),
      false,
      'authenticated must not execute public.rls_auto_enable()'
    );
  };
  assertRlsAutoEnableDenied(securityHardeningSql);
  assert.throws(
    () => assertRlsAutoEnableDenied(
      `${securityHardeningSql}\ngrant execute on function public.rls_auto_enable() to public;`
    ),
    /rls_auto_enable/
  );
  assert.doesNotMatch(securityHardeningSql, /alter\s+function\s+public\.rls_auto_enable\(\)\s+set\s+search_path/i);
});

test('security hardening fixes current and future sequence/table/function defaults', () => {
  const sequences = evaluateSequencePrivileges(securityHardeningSql);
  assert.equal(sequences.get('anon'), false);
  assert.equal(sequences.get('authenticated'), false);

  const defaults = evaluatePostgresDefaultPrivileges(securityHardeningSql);
  for (const key of [
    'tables:anon',
    'tables:authenticated',
    'sequences:anon',
    'sequences:authenticated',
    'functions:public',
    'functions:anon',
    'functions:authenticated'
  ]) {
    assert.equal(defaults.get(key), false, `postgres default privilege must be revoked for ${key}`);
  }
  assert.doesNotMatch(securityHardeningSql, /alter\s+default\s+privileges\s+for\s+role\s+supabase_admin/i);

  const statements = sqlStatements(securityHardeningSql);
  const defaultFunctionRevokeIndex = statements.findIndex((statement) =>
    /^alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public\s+revoke\s+execute\s+on\s+functions/i.test(statement)
  );
  const explicitFunctionGrantIndexes = statements
    .map((statement, index) => (/^grant\s+execute\s+on\s+function/i.test(statement) ? index : -1))
    .filter((index) => index >= 0);
  assert.ok(defaultFunctionRevokeIndex >= 0, 'function default revoke must exist');
  assert.ok(explicitFunctionGrantIndexes.length > 0, 'guarded function grants must exist');
  assert.ok(
    explicitFunctionGrantIndexes.every((index) => index > defaultFunctionRevokeIndex),
    'guarded function grants must follow the default EXECUTE cleanup'
  );

  const widenedDefaults = evaluatePostgresDefaultPrivileges(
    `${securityHardeningSql}\nalter default privileges for role postgres in schema public grant execute on functions to public;`
  );
  assert.equal(widenedDefaults.get('functions:public'), true);
});

test('security hardening locks privileged functions and policies to explicit principals', () => {
  assert.ok(securityHardeningPath, 'security_hardening migration must exist');
  for (const functionName of [
    'set_updated_at()',
    'handle_new_user()',
    'admin_delete_user(uuid)',
    'admin_set_role(uuid, text)',
    'is_admin()',
    'is_self_or_admin(uuid)',
    'consume_ai_enrichment_quota(integer)'
  ]) {
    const escaped = escapeRegExp(functionName).replaceAll(' ', '\\s+');
    assert.match(securityHardeningSql, new RegExp(`alter\\s+function\\s+public\\.${escaped}\\s+set\\s+search_path\\s+to\\s+''`, 'i'));
  }

  const policies = [
    ['profiles_select_self_or_admin', 'profiles', 'select'],
    ['profiles_update_self_or_admin', 'profiles', 'update'],
    ['profiles_insert_self_or_admin', 'profiles', 'insert'],
    ['words_select_self_or_admin', 'words', 'select'],
    ['words_insert_self_or_admin', 'words', 'insert'],
    ['words_update_self_or_admin', 'words', 'update'],
    ['words_delete_self_or_admin', 'words', 'delete']
  ];
  for (const [policyName, tableName, operation] of policies) {
    assert.match(securityHardeningSql, new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${policyName}`, 'i'));
    assert.match(
      securityHardeningSql,
      new RegExp(`create\\s+policy\\s+${policyName}\\s+on\\s+public\\.${tableName}\\s+for\\s+${operation}\\s+to\\s+authenticated`, 'i')
    );
  }
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

test('requires translations to contain Russian text', () => {
  assert.ok(existsSync(russianTranslationsRequiredPath), 'Russian translations-required migration must exist');
  assert.match(russianTranslationsRequiredSql, /add\s+constraint\s+words_translation_contains_russian_check/i);
  assert.match(russianTranslationsRequiredSql, /translation\s*~\s*'\[А-Яа-яЁё\]'/i);
});

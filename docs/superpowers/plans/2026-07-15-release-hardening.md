# Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the release-blocking authorization, AI abuse, import, auth-state, dependency, and deployment defects found in the 2026-07-15 review.

**Architecture:** Keep the current Vite, vanilla JavaScript, Supabase, and Vercel architecture. Add Node's built-in test runner, isolate request validation and auth-transition decisions into small testable modules, harden both fresh and already-deployed Supabase schemas, and retain the existing UI behavior except where it is demonstrably broken.

**Tech Stack:** Node.js 24, `node:test`, Vite 8.1.x, Supabase JS 2.x, Vercel Functions, SheetJS CE 0.20.3.

## Global Constraints

- Work only in `D:/Codex/english_learn_app/release_hardening_worktree`; do not modify the dirty `dashboard-modals` worktree.
- Do not introduce React, TypeScript, a new state framework, or a new external service.
- Do not create commits; leave the complete diff for user review.
- Preserve Russian UI copy and current Supabase data.
- Verify every behavior change with a failing test before production code.
- Keep AI enrichment limited to four vocabulary items per request.

---

### Task 1: Add the test harness and repair file imports

**Files:**
- Modify: `package.json`
- Modify: `src/lib/import-parser.js`
- Create: `test/import-parser.test.js`

**Interfaces:**
- Consumes: browser-compatible `File` objects accepted by `parseImportedRows(file)`.
- Produces: deterministic rows for CSV and XLSX files with or without headers; rejects files larger than 10 MiB.

- [x] **Step 1: Add failing import regression tests**

```js
test('parses text/csv through the spreadsheet parser', async () => {
  const file = new File(['word,translation\napple,яблоко'], 'words.csv', { type: 'text/csv' });
  assert.deepEqual(await parseImportedRows(file), [expectedApple]);
});

test('keeps the first row of a headerless workbook', async () => {
  const file = createWorkbookFile([['apple', 'яблоко'], ['book', 'книга']]);
  assert.equal((await parseImportedRows(file))[0].word, 'apple');
});

test('rejects an import larger than ten MiB', async () => {
  const file = { name: 'large.txt', type: 'text/plain', size: 10 * 1024 * 1024 + 1 };
  await assert.rejects(() => parseImportedRows(file), /10 MB/);
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test test/import-parser.test.js`

Expected: the CSV/headerless assertions fail with the current malformed rows, and the size test fails because no limit exists.

- [x] **Step 3: Implement the minimal parser fix**

```js
const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

export async function parseImportedRows(file) {
  if (Number(file?.size) > MAX_IMPORT_FILE_SIZE) {
    throw new Error('Файл слишком большой. Максимальный размер — 10 MB.');
  }
  // existing dispatch
}
```

Check `.csv` before generic `text/*`, and parse all cell rows when structured headers are absent.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/import-parser.test.js`

Expected: all import tests pass.

---

### Task 2: Harden Supabase roles, function grants, and AI quota

**Files:**
- Modify: `supabase/migrations/20260526_init.sql`
- Create: `supabase/migrations/20260715_release_hardening.sql`
- Create: `test/sql-security.test.js`

**Interfaces:**
- Consumes: authenticated Supabase user identity via `auth.uid()`.
- Produces: `public.consume_ai_enrichment_quota(requested_items integer) returns boolean` with a 500-item daily limit.

- [x] **Step 1: Add failing SQL invariant tests**

```js
test('does not grant authenticated users table-wide profile updates', () => {
  assert.doesNotMatch(sql, /grant select, insert, update, delete on table public\.profiles/i);
  assert.match(sql, /grant update \(name, legacy_html_seed_imported_at\)/i);
});

test('creates functions before granting execute', () => {
  assert.ok(sql.indexOf('create or replace function public.admin_delete_user') < sql.indexOf('grant execute on function public.admin_delete_user'));
});
```

- [x] **Step 2: Run the SQL test and verify RED**

Run: `node --test test/sql-security.test.js`

Expected: table-wide profile privilege and grant-order assertions fail.

- [x] **Step 3: Repair the fresh migration and add an upgrade migration**

```sql
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, email, name) on table public.profiles to authenticated;
grant update (name, legacy_html_seed_imported_at) on table public.profiles to authenticated;
```

Move function grants below definitions, revoke default `PUBLIC` execution, prevent deletion/demotion of the final admin, and add a quota table plus atomic quota RPC.

- [x] **Step 4: Run the SQL test and verify GREEN**

Run: `node --test test/sql-security.test.js`

Expected: all SQL invariants pass.

---

### Task 3: Authenticate and constrain the AI endpoint

**Files:**
- Create: `api/lib/enrichment-request.js`
- Modify: `api/enrich-words.js`
- Modify: `src/main.js`
- Create: `test/enrichment-request.test.js`
- Create: `test/enrich-handler.test.js`

**Interfaces:**
- Consumes: `Authorization: Bearer <Supabase access token>` and `{ items: VocabularyItem[] }`.
- Produces: sanitized batches of at most four items; HTTP 401, 400, 429, 502, or 200 responses.

- [x] **Step 1: Add failing request-validation and handler tests**

```js
test('rejects a missing bearer token', async () => {
  const response = await invokeHandler({ headers: {}, body: { items: [validItem] } });
  assert.equal(response.statusCode, 401);
});

test('rejects more than four items', () => {
  assert.throws(() => validateEnrichmentItems(Array(5).fill(validItem)), /at most 4/);
});

test('returns 429 when the daily quota is exhausted', async () => {
  const response = await invokeHandler({ quotaAllowed: false });
  assert.equal(response.statusCode, 429);
});
```

- [x] **Step 2: Run focused API tests and verify RED**

Run: `node --test test/enrichment-request.test.js test/enrich-handler.test.js`

Expected: imports or assertions fail because the validation module and injected handler do not exist.

- [x] **Step 3: Implement validation, Supabase token verification, and quota consumption**

```js
export function createEnrichmentHandler({ verifyToken, consumeQuota, enrich }) {
  return async function handler(req, res) {
    // method -> bearer token -> validation -> verified user -> quota -> Gemini
  };
}
```

The browser sends `state.session.access_token`; the server verifies it with `supabase.auth.getUser(token)` and calls `consume_ai_enrichment_quota` with the same authenticated client.

- [x] **Step 4: Run focused API tests and verify GREEN**

Run: `node --test test/enrichment-request.test.js test/enrich-handler.test.js`

Expected: all endpoint tests pass without network calls.

---

### Task 4: Repair auth transitions, form state, and deployment URLs

**Files:**
- Create: `src/lib/auth-transition.js`
- Modify: `src/main.js`
- Modify: `README.md`
- Modify: `.env.example`
- Create: `test/auth-transition.test.js`
- Create: `test/source-invariants.test.js`

**Interfaces:**
- Consumes: current loaded user id and a Supabase session.
- Produces: one of `load`, `reuse`, or `clear`; URL construction based on `import.meta.env.BASE_URL`.

- [x] **Step 1: Add failing auth and source-invariant tests**

```js
test('loads a newly signed-up user whose data is not loaded', () => {
  assert.equal(resolveAuthTransition(null, session('user-1')), 'load');
});

test('does not mark a sign-up user loaded before loadUserData succeeds', () => {
  assert.doesNotMatch(mainSource, /loadedUserId = data\.session\.user\.id/);
});

test('clears persisted add-word state after a successful save', () => {
  assert.match(mainSource, /state\.forms\.addWord = createDefaultAddWordForm\(\)/);
});
```

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test test/auth-transition.test.js test/source-invariants.test.js`

Expected: the transition module is missing and the source invariants fail.

- [x] **Step 3: Implement deterministic auth and form transitions**

Move `getSession()` into error handling, make `onAuthStateChange` callback synchronous and schedule the database load outside it, set `loadedUserId` only after `loadUserData`, reset add-word state after success, use a base-aware email redirect, and document Vercel as the AI-enabled deployment target.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/auth-transition.test.js test/source-invariants.test.js`

Expected: all auth and source invariants pass.

---

### Task 5: Upgrade dependencies and reduce the initial bundle

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: legacy seed data only when a legacy migration is requested.
- Produces: an initial bundle that excludes `src/data/words.js`; SheetJS CE 0.20.3 loaded from the official package artifact.

- [x] **Step 1: Add a failing bundle/source invariant**

```js
test('does not import the legacy seed eagerly', () => {
  assert.doesNotMatch(mainSource, /^import seedWords from/m);
});

test('does not preserve obsolete browser import maps', () => {
  assert.doesNotMatch(indexSource, /type="importmap"/);
});
```

- [x] **Step 2: Run the invariant and verify RED**

Run: `node --test test/source-invariants.test.js`

Expected: eager seed and import-map assertions fail.

- [x] **Step 3: Upgrade and lazy-load**

Run:

```powershell
npm.cmd install --save "xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
npm.cmd install --save-dev vite@^8.1.4
```

Replace the eager seed import with a cached dynamic import helper and remove the obsolete import map.

- [x] **Step 4: Run all verification**

Run:

```powershell
npm.cmd test
npm.cmd audit
npm.cmd run build
git diff --check
git status --short
```

Expected: tests pass, audit has no known high-severity Vite/SheetJS findings, build passes, the initial bundle is materially smaller than 932.84 kB, and only intended files are modified.

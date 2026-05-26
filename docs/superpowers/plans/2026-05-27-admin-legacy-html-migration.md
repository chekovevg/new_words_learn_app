# Admin Legacy HTML Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-time admin-only migration that imports the old HTML English vocabulary, examples, and levels into the admin profile while preserving existing non-English words and current learned state.

**Architecture:** Keep the current Supabase schema and app flow. Add a small admin-only migration flag on `profiles`, surface a dedicated action in the admin panel, and reuse the existing word upsert path with a filtered English-only legacy payload. The migration is one-way and idempotent so it can be safely retried without duplicating rows.

**Tech Stack:** Vanilla JS, Supabase Postgres, Vite, local `seedWords` dataset.

---

### Task 1: Add a persistent admin migration flag

**Files:**
- Modify: `supabase/migrations/20260526_init.sql`
- Modify: `src/main.js`

- [ ] **Step 1: Add the `legacy_html_seed_imported_at` column to `profiles`**

```sql
alter table public.profiles
add column if not exists legacy_html_seed_imported_at timestamptz;
```

- [ ] **Step 2: Read the flag in the profile payload and render a one-time admin action**

```js
if (state.profile?.role === 'admin' && !state.profile.legacy_html_seed_imported_at) {
  // show admin-only migration action
}
```

### Task 2: Implement English-only legacy seed import for admin

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Filter the legacy seed to the old HTML English rows**

```js
const legacyRows = seedWords
  .filter((item) => item.language === 'English' && (item.level || item.example))
  .map((item, index) => ({ /* merge payload */ }));
```

- [ ] **Step 2: Merge by `word + language`, preserve learned state, and append new rows after existing data**

```js
const existing = existingByKey.get(key);
return {
  word: item.word,
  translation: item.translation,
  language: item.language,
  level: item.level || null,
  example: item.example || null,
  learned: existing ? existing.learned : learned.has(item.id),
  sort_order: existing ? existing.sort_order : state.words.length + index
};
```

- [ ] **Step 3: Mark the profile as imported after success**

```js
await supabase.from('profiles').update({
  legacy_html_seed_imported_at: new Date().toISOString()
}).eq('id', state.session.user.id);
```

### Task 3: Verify build and behavior

**Files:**
- Test: `npm run build`

- [ ] **Step 1: Build the app**

```bash
npm run build
```

- [ ] **Step 2: Confirm the admin action is hidden after the flag is set**

Expected: imported admin profile no longer shows the legacy HTML migration action, and non-admin profiles never see it.

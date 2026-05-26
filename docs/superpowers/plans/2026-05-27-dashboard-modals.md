# Dashboard Modals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the profile, add-word, and import flows out of the main dashboard cards into compact header actions that open modal dialogs, while keeping all existing Supabase behavior intact.

**Architecture:** The main dashboard becomes a lighter shell: header, filters, stats, and table only. The three existing forms are preserved logically but rendered inside a single modal host driven by a new `modal` state. Profile opens from the profile chip, add-word and import open from header buttons, and modal actions reuse the current submit handlers and data-loading code.

**Tech Stack:** Vanilla HTML/CSS/JS, Vite, Supabase, existing table/filter rendering.

---

### Task 1: Add modal state and header actions

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Define the modal state and header buttons**

```js
const state = {
  // ...
  modal: null
};

// modal values:
// null | 'profile' | 'addWord' | 'import'
```

```html
<button class="ghost" type="button" data-action="open-profile">Профиль</button>
<button class="ghost" type="button" data-action="open-add-word">Добавить слово</button>
<button class="ghost" type="button" data-action="open-import">Импорт</button>
```

- [ ] **Step 2: Run the app and verify the header buttons exist**

Run: `npm.cmd run dev`
Expected: the logged-in header shows the new actions and the page still renders the table.

- [ ] **Step 3: Implement modal open/close behavior**

```js
function openModal(name) {
  state.modal = name;
  render();
}

function closeModal() {
  state.modal = null;
  render();
}
```

Add click handling for:
- `data-action="open-profile"`
- `data-action="open-add-word"`
- `data-action="open-import"`
- overlay click and close button
- Escape key closes the modal

- [ ] **Step 4: Run the app and verify modal toggling**

Expected: clicking a header action opens a centered dialog and closing it returns to the table without a full page reload.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/styles.css
git commit -m "feat: add dashboard modal shell"
```

### Task 2: Move profile form into a modal

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Remove the profile card from the main dashboard layout**

```js
// delete the profile panel from appTemplate()
// keep the profile data in the header chip and modal only
```

- [ ] **Step 2: Render the profile form inside the modal host**

```html
<div class="modal-card">
  <h2>Профиль</h2>
  <p>Имя видно только в вашем аккаунте.</p>
  <form id="profileForm" class="panel modal-form">
    <!-- existing name field and save button -->
  </form>
</div>
```

- [ ] **Step 3: Verify profile save still works**

Run: `npm.cmd run dev`
Expected: opening profile modal, editing the name, and saving still updates Supabase and the header chip.

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/styles.css
git commit -m "feat: move profile into modal"
```

### Task 3: Move add-word and import forms into modals

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Remove the add-word and import cards from the main dashboard**

```js
// delete the add-word and import panels from management-grid
// keep the existing submit handlers and helper functions unchanged
```

- [ ] **Step 2: Render each form in its matching modal**

```html
<div class="modal-card">
  <h2>Добавить слово</h2>
  <form id="addWordForm" class="panel modal-form">
    <!-- existing inputs -->
  </form>
</div>
```

```html
<div class="modal-card">
  <h2>Импорт</h2>
  <form id="importForm" class="panel modal-form">
    <!-- existing file input and merge checkbox -->
  </form>
</div>
```

- [ ] **Step 3: Verify both flows still persist data**

Run: `npm.cmd run dev`
Expected: add-word inserts into the signed-in user’s `words` table; import still merge-upserts and preserves learned state.

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/styles.css
git commit -m "feat: move word actions into modals"
```

### Task 4: Polish dashboard layout and verify admin access

**Files:**
- Modify: `src/main.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Tighten the main dashboard layout**

```css
/* keep only header, filters, stats, and table visible by default */
/* ensure modal overlay centers on desktop and mobile */
```

- [ ] **Step 2: Make the profile chip open the profile modal**

```js
if (action === 'open-profile-chip') {
  openModal('profile');
  return;
}
```

- [ ] **Step 3: Verify admin section still appears for admin users**

Run: `npm.cmd run dev`
Expected: after setting the user role to `admin`, the admin panel still renders below the table.

- [ ] **Step 4: Run production build**

Run: `npm.cmd run build`
Expected: build succeeds and the modal UI is included in the production bundle.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/styles.css
git commit -m "feat: polish dashboard modals"
```

### Task 5: Manual regression checklist

**Files:**
- No code changes

- [ ] **Step 1: Check login flow**

Expected: reopening the app restores the same authenticated user without getting stuck on the loading screen.

- [ ] **Step 2: Check the dashboard flows**

Expected: profile, add-word, and import each open in a modal and close cleanly.

- [ ] **Step 3: Check data integrity**

Expected: adding a word and importing Excel keep the user’s personal word list and learned flags.

- [ ] **Step 4: Check admin access**

Expected: an admin user still sees the admin section and can manage users.


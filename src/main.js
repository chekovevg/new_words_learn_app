import * as XLSX from 'xlsx';
import seedWords from './data/words.js';
import { hasSupabaseConfig, supabase } from './lib/supabase.js';
import {
  clampString,
  escapeHTML,
  makeWordKey,
  normalizeText,
  uniqueSorted
} from './lib/word-utils.js';

const app = document.querySelector('#app');

const LEVELS = ['B1', 'B2', 'C1', 'C2'];
const STATUS_LABELS = {
  all: 'Все',
  learned: 'Выученные',
  unknown: 'Не выученные'
};
const DEFAULT_LANGUAGES = ['English', 'German', 'Georgian'];
const LEGACY_PROGRESS_KEY = 'new-words-learn-progress-v2';
const MIGRATION_FLAG_PREFIX = 'new-words-migrated';

const state = {
  loading: true,
  authView: 'signin',
  session: null,
  profile: null,
  words: [],
  adminProfiles: [],
  adminWords: [],
  query: '',
  tab: 'all',
  level: 'all',
  language: 'all',
  message: '',
  error: '',
  migrationEligible: false,
  migrationInProgress: false,
  adminLoading: false,
  forms: {
    signInEmail: '',
    signInPassword: '',
    signUpName: '',
    signUpEmail: '',
    signUpPassword: '',
    profileName: '',
    addWord: {
      word: '',
      translation: '',
      language: 'English',
      level: '',
      example: ''
    }
  }
};

const els = {};

init();

app.addEventListener('input', handleInput);
app.addEventListener('change', handleChange);
app.addEventListener('click', handleClick);
app.addEventListener('submit', handleSubmit);

async function init() {
  if (!hasSupabaseConfig || !supabase) {
    state.loading = false;
    state.error =
      'Не найдены переменные Supabase. Добавь `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY` в `.env.local`.';
    render();
    return;
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();

  state.session = session;
  try {
    if (session) {
      await loadUserData(session.user.id);
    }
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }

  supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    state.session = nextSession;
    state.error = '';
    state.message = '';
    state.migrationEligible = false;
    state.migrationInProgress = false;

    if (nextSession) {
      state.loading = true;
      render();
      await loadUserData(nextSession.user.id);
      state.loading = false;
    } else {
      state.profile = null;
      state.words = [];
      state.adminProfiles = [];
      state.adminWords = [];
      state.loading = false;
    }

    render();
  });
}

function render() {
  if (state.loading) {
    app.innerHTML = loadingTemplate();
    return;
  }

  if (!state.session) {
    app.innerHTML = authTemplate();
    cacheElements();
    return;
  }

  app.innerHTML = appTemplate();
  cacheElements();
  syncFormState();
  renderWords();
}

function loadingTemplate() {
  return `
    <div class="bootstrap-screen">
      <div class="bootstrap-card">
        <div class="kicker">Saved translations tracker</div>
        <h1>Загружаем ваш словарь</h1>
        <p>Подключаем Supabase, профиль и личные слова.</p>
      </div>
    </div>
  `;
}

function authTemplate() {
  const active = state.authView;
  return `
    <div class="shell shell-auth">
      <header class="page-header compact">
        <div class="title-block">
          <div class="kicker">Saved translations tracker</div>
          <h1>Личный словарь</h1>
          <p class="subtitle">
            Аккаунт, личный список слов, импорт из Excel и прогресс на всех устройствах.
          </p>
        </div>
        <div class="summary">
          <span class="pill"><strong>Supabase</strong> подключен</span>
        </div>
      </header>

      <section class="auth-card">
        <div class="auth-tabs">
          <button class="tab ${active === 'signin' ? 'active' : ''}" type="button" data-auth-view="signin">Вход</button>
          <button class="tab ${active === 'signup' ? 'active' : ''}" type="button" data-auth-view="signup">Регистрация</button>
        </div>

        ${state.error ? `<div class="banner banner-error">${escapeHTML(state.error)}</div>` : ''}
        ${state.message ? `<div class="banner">${escapeHTML(state.message)}</div>` : ''}

        ${
          active === 'signin'
            ? `
          <form id="signInForm" class="auth-form">
            <label>
              <span>Email</span>
              <input name="email" type="email" autocomplete="email" required value="${escapeHTML(state.forms.signInEmail)}" />
            </label>
            <label>
              <span>Пароль</span>
              <input name="password" type="password" autocomplete="current-password" required value="${escapeHTML(state.forms.signInPassword)}" />
            </label>
            <button class="primary" type="submit">Войти</button>
          </form>
          `
            : `
          <form id="signUpForm" class="auth-form">
            <label>
              <span>Имя</span>
              <input name="name" type="text" autocomplete="name" required value="${escapeHTML(state.forms.signUpName)}" />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" autocomplete="email" required value="${escapeHTML(state.forms.signUpEmail)}" />
            </label>
            <label>
              <span>Пароль</span>
              <input name="password" type="password" autocomplete="new-password" minlength="6" required value="${escapeHTML(state.forms.signUpPassword)}" />
            </label>
            <button class="primary" type="submit">Создать аккаунт</button>
          </form>
          `
        }

        <div class="auth-note">
          <strong>Важно:</strong> текущие слова можно импортировать в свой аккаунт после первого входа.
        </div>
      </section>
    </div>
  `;
}

function appTemplate() {
  const learnedCount = state.words.filter((item) => item.learned).length;
  const totalCount = state.words.length;
  const visibleLanguages = uniqueSorted(
    state.words.map((item) => item.language).filter(Boolean),
    DEFAULT_LANGUAGES
  );
  const profileName = escapeHTML(state.profile?.name || state.session?.user?.email || 'Пользователь');
  const profileEmail = escapeHTML(state.profile?.email || state.session?.user?.email || '');
  const role = state.profile?.role || 'user';

  return `
    <div class="shell">
      <header class="page-header">
        <div class="title-block">
          <div class="kicker">Saved translations tracker</div>
          <h1>Простая таблица слов</h1>
          <p class="subtitle">
            Личный словарь с отдельным аккаунтом, импортом Excel, ручным добавлением и синхронизацией между устройствами.
          </p>
        </div>

        <div class="header-actions">
          <div class="summary" aria-label="Summary">
            <span class="pill"><strong id="totalCount">${totalCount}</strong> всего</span>
            <span class="pill"><strong id="learnedCount">${learnedCount}</strong> выучено</span>
          </div>

          <div class="profile-chip">
            <div class="profile-meta">
              <strong>${profileName}</strong>
              <span>${profileEmail}</span>
            </div>
            <span class="role-badge ${role === 'admin' ? 'role-admin' : ''}">${role}</span>
            <button class="ghost" type="button" data-action="logout">Выйти</button>
          </div>
        </div>
      </header>

      ${state.error ? `<div class="banner banner-error">${escapeHTML(state.error)}</div>` : ''}
      ${state.message ? `<div class="banner">${escapeHTML(state.message)}</div>` : ''}

      ${
        state.migrationEligible
          ? `
        <section class="banner migration-banner">
          <div>
            <strong>Найдены старые локальные слова в этом браузере.</strong>
            <div>Можно перенести их в ваш аккаунт Supabase, чтобы сохранить текущий прогресс.</div>
          </div>
          <button class="primary" type="button" data-action="import-legacy" ${state.migrationInProgress ? 'disabled' : ''}>
            ${state.migrationInProgress ? 'Импортируем…' : 'Импортировать текущие слова'}
          </button>
        </section>
        `
          : ''
      }

      <section class="toolbar" aria-label="Filters">
        <div class="tabs" role="tablist" aria-label="Vocabulary status">
          <button class="tab ${state.tab === 'all' ? 'active' : ''}" data-tab="all" type="button">Все</button>
          <button class="tab ${state.tab === 'learned' ? 'active' : ''}" data-tab="learned" type="button">Выученные</button>
          <button class="tab ${state.tab === 'unknown' ? 'active' : ''}" data-tab="unknown" type="button">Не выученные</button>
        </div>
        <input id="search" class="search" type="search" placeholder="Поиск по слову или переводу…" value="${escapeHTML(state.query)}" />
        <label class="select-wrap" aria-label="Language filter">
          <span class="select-label">Язык</span>
          <select id="language" class="select">
            <option value="all">Все</option>
            ${visibleLanguages.map((language) => `<option value="${escapeHTML(language)}"${state.language === language ? ' selected' : ''}>${escapeHTML(language)}</option>`).join('')}
          </select>
        </label>
        <div class="level-filters" aria-label="Level filters">
          ${LEVELS.map((level) => `<button class="level-filter ${state.level === level ? 'active' : ''}" data-level="${level}" type="button">${level}</button>`).join('')}
        </div>
      </section>

      <section class="management-grid">
        <form id="profileForm" class="panel">
          <div class="panel-head">
            <div>
              <h2>Профиль</h2>
              <p>Имя видно только в вашем аккаунте.</p>
            </div>
          </div>
          <label>
            <span>Имя</span>
            <input name="profileName" type="text" value="${escapeHTML(state.forms.profileName)}" placeholder="Как вас показывать" />
          </label>
          <button class="primary" type="submit">Сохранить профиль</button>
        </form>

        <form id="addWordForm" class="panel">
          <div class="panel-head">
            <div>
              <h2>Добавить слово</h2>
              <p>Слова принадлежат только вашему аккаунту.</p>
            </div>
          </div>
          <div class="form-grid">
            <label><span>Слово</span><input name="word" type="text" required value="${escapeHTML(state.forms.addWord.word)}" /></label>
            <label><span>Перевод</span><input name="translation" type="text" required value="${escapeHTML(state.forms.addWord.translation)}" /></label>
            <label><span>Язык</span><input name="language" type="text" value="${escapeHTML(state.forms.addWord.language)}" /></label>
            <label>
              <span>Уровень</span>
              <select name="level">
                <option value="">Без уровня</option>
                ${LEVELS.map((level) => `<option value="${level}"${state.forms.addWord.level === level ? ' selected' : ''}>${level}</option>`).join('')}
              </select>
            </label>
          </div>
          <label>
            <span>Пример</span>
            <textarea name="example" rows="3" placeholder="Пример использования">${escapeHTML(state.forms.addWord.example)}</textarea>
          </label>
          <button class="primary" type="submit">Сохранить слово</button>
        </form>

        <form id="importForm" class="panel">
          <div class="panel-head">
            <div>
              <h2>Импорт</h2>
              <p>Excel или CSV с merge-импортом, без удаления текущих слов.</p>
            </div>
          </div>
          <label>
            <span>Файл</span>
            <input id="importFile" name="file" type="file" accept=".xlsx,.xls,.csv" required />
          </label>
          <label class="checkbox-line">
            <input type="checkbox" name="mergeOnly" checked />
            <span>Добавлять в список и обновлять совпадающие слова</span>
          </label>
          <button class="primary" type="submit">Импортировать файл</button>
        </form>
      </section>

      <main class="table-card">
        <div class="table-head">
          <div>
            <strong id="currentTabTitle">${STATUS_LABELS[state.tab]}</strong>
            <span class="muted" id="tableMeta"></span>
          </div>
          <div class="small">Чекбокс слева переносит слово между «Не выученные» и «Выученные».</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th aria-label="Learned">✓</th>
                <th>Level</th>
                <th>Word / phrase item</th>
                <th>Translation</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody id="tbody"></tbody>
          </table>
          <div id="empty" class="empty hidden">Ничего не найдено.</div>
        </div>
      </main>

      ${renderAdminSection()}
    </div>
  `;
}

function renderAdminSection() {
  if (state.profile?.role !== 'admin') {
    return '';
  }

  const rows = state.adminProfiles
    .map((profile) => {
      const stats = state.adminWords.filter((word) => word.user_id === profile.id);
      const learnedCount = stats.filter((word) => word.learned).length;
      return `
        <tr>
          <td>
            <strong>${escapeHTML(profile.name)}</strong>
            <div class="muted">${escapeHTML(profile.email)}</div>
          </td>
          <td>${escapeHTML(profile.role)}</td>
          <td>${stats.length}</td>
          <td>${learnedCount}</td>
          <td class="admin-actions">
            <button type="button" class="ghost" data-admin-role="${profile.id}" data-role="${profile.role === 'admin' ? 'user' : 'admin'}">
              ${profile.role === 'admin' ? 'Снять admin' : 'Сделать admin'}
            </button>
            <button type="button" class="danger" data-admin-delete="${profile.id}">Удалить</button>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <section class="panel admin-panel">
      <div class="panel-head">
        <div>
          <h2>Админка</h2>
          <p>Пользователи, роли и объём словаря.</p>
        </div>
        <button class="ghost" type="button" data-action="refresh-admin">Обновить</button>
      </div>
      <div class="table-wrap admin-table">
        <table>
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Роль</th>
              <th>Слова</th>
              <th>Выучено</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5" class="empty-cell">Пока нет пользователей.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function cacheElements() {
  els.tbody = document.getElementById('tbody');
  els.empty = document.getElementById('empty');
  els.search = document.getElementById('search');
  els.currentTabTitle = document.getElementById('currentTabTitle');
  els.tableMeta = document.getElementById('tableMeta');
  els.language = document.getElementById('language');
  els.totalCount = document.getElementById('totalCount');
  els.learnedCount = document.getElementById('learnedCount');
}

function syncFormState() {
  if (!els.search) return;
  els.search.value = state.query;
  if (els.language) {
    els.language.value = state.language;
  }
}

function handleInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('#search')) {
    state.query = target.value;
    renderWords();
    return;
  }

  if (target.matches('#signInForm [name="email"]')) {
    state.forms.signInEmail = target.value;
    return;
  }

  if (target.matches('#signInForm [name="password"]')) {
    state.forms.signInPassword = target.value;
    return;
  }

  if (target.matches('#signUpForm [name="name"]')) {
    state.forms.signUpName = target.value;
    return;
  }

  if (target.matches('#signUpForm [name="email"]')) {
    state.forms.signUpEmail = target.value;
    return;
  }

  if (target.matches('#signUpForm [name="password"]')) {
    state.forms.signUpPassword = target.value;
    return;
  }

  if (target.matches('#profileForm [name="profileName"]')) {
    state.forms.profileName = target.value;
    return;
  }

  if (target.matches('#addWordForm [name="word"]')) {
    state.forms.addWord.word = target.value;
    return;
  }

  if (target.matches('#addWordForm [name="translation"]')) {
    state.forms.addWord.translation = target.value;
    return;
  }

  if (target.matches('#addWordForm [name="language"]')) {
    state.forms.addWord.language = target.value;
    return;
  }

  if (target.matches('#addWordForm [name="level"]')) {
    state.forms.addWord.level = target.value;
    return;
  }

  if (target.matches('#addWordForm [name="example"]')) {
    state.forms.addWord.example = target.value;
  }
}

function handleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('#language')) {
    state.language = target.value;
    renderWords();
    return;
  }

  if (target.matches('input[data-learned-id]')) {
    updateLearnedState(target).catch((error) => setError(error.message));
  }
}

function handleClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const authViewButton = target.closest('[data-auth-view]');
  if (authViewButton) {
    state.authView = authViewButton.dataset.authView;
    state.error = '';
    state.message = '';
    render();
    return;
  }

  const tabButton = target.closest('[data-tab]');
  if (tabButton) {
    state.tab = tabButton.dataset.tab;
    renderWords();
    return;
  }

  const levelButton = target.closest('[data-level]');
  if (levelButton) {
    const level = levelButton.dataset.level;
    state.level = state.level === level ? 'all' : level;
    render();
    return;
  }

  const actionButton = target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'logout') {
      supabase.auth.signOut();
      return;
    }
    if (action === 'import-legacy') {
      importLegacyWords().catch((error) => setError(error.message));
      return;
    }
    if (action === 'refresh-admin') {
      refreshAdminData().catch((error) => setError(error.message));
    }
  }

  const adminRoleButton = target.closest('[data-admin-role]');
  if (adminRoleButton) {
    updateAdminRole(adminRoleButton.dataset.adminRole, adminRoleButton.dataset.role).catch((error) =>
      setError(error.message)
    );
    return;
  }

  const adminDeleteButton = target.closest('[data-admin-delete]');
  if (adminDeleteButton) {
    deleteUser(adminDeleteButton.dataset.adminDelete).catch((error) => setError(error.message));
  }
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  if (form.id === 'signInForm') {
    await signIn(form);
    return;
  }

  if (form.id === 'signUpForm') {
    await signUp(form);
    return;
  }

  if (form.id === 'profileForm') {
    await saveProfile(form);
    return;
  }

  if (form.id === 'addWordForm') {
    await addWord(form);
    return;
  }

  if (form.id === 'importForm') {
    await importWords(form);
  }
}

async function signIn(form) {
  setBusy(true);
  clearStatus();
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setError(error.message);
  } else {
    state.message = 'Вход выполнен.';
  }
  setBusy(false);
  render();
}

async function signUp(form) {
  setBusy(true);
  clearStatus();
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name }
    }
  });

  if (error) {
    setError(error.message);
  } else if (!data.session) {
    state.message = 'Аккаунт создан. Проверьте почту для подтверждения входа.';
    state.authView = 'signin';
  } else {
    state.message = 'Аккаунт создан и вы вошли в систему.';
  }

  setBusy(false);
  render();
}

async function loadUserData(userId) {
  const [{ data: profile, error: profileError }, { data: words, error: wordsError }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('words').select('*').eq('user_id', userId).order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  ]);

  if (profileError) {
    throw new Error(profileError.message);
  }
  if (wordsError) {
    throw new Error(wordsError.message);
  }

  if (!profile) {
    const user = state.session?.user;
    const fallbackName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Пользователь';
    const { error: insertError } = await supabase.from('profiles').insert({
      id: userId,
      email: user?.email || '',
      name: fallbackName,
      role: 'user'
    });
    if (insertError) {
      throw new Error(insertError.message);
    }
    state.profile = {
      id: userId,
      email: user?.email || '',
      name: fallbackName,
      role: 'user'
    };
  } else {
    state.profile = profile;
  }

  state.forms.profileName = state.profile.name || '';
  state.words = (words || []).map(normalizeRemoteWord);
  state.migrationEligible = hasLegacySeed() && state.words.length === 0;

  if (state.profile.role === 'admin') {
    await refreshAdminData(false);
  } else {
    state.adminProfiles = [];
    state.adminWords = [];
  }
}

function normalizeRemoteWord(word) {
  return {
    ...word,
    language: clampString(word.language, 'English'),
    word_key: clampString(word.word_key, makeWordKey(word.word, word.language)),
    language_key: clampString(word.language_key, normalizeText(word.language || 'English'))
  };
}

function hasLegacySeed() {
  return Boolean(localStorage.getItem(LEGACY_PROGRESS_KEY));
}

function loadLegacyProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_PROGRESS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set();
  }
}

function migrationFlagKey(userId) {
  return `${MIGRATION_FLAG_PREFIX}:${userId}`;
}

function hasMigrated(userId) {
  return localStorage.getItem(migrationFlagKey(userId)) === '1';
}

function markMigrated(userId) {
  localStorage.setItem(migrationFlagKey(userId), '1');
}

async function importLegacyWords() {
  if (!state.session?.user?.id) return;
  if (hasMigrated(state.session.user.id)) {
    state.migrationEligible = false;
    render();
    return;
  }

  state.migrationInProgress = true;
  render();

  const learned = loadLegacyProgress();
  const rows = seedWords.map((item, index) => ({
    user_id: state.session.user.id,
    word: item.word,
    translation: item.translation,
    language: item.language || 'English',
    level: item.level || null,
    example: item.example || null,
    learned: learned.has(item.id),
    word_key: makeWordKey(item.word, item.language),
    language_key: normalizeText(item.language || 'English'),
    sort_order: index
  }));

  await upsertWordRows(rows);
  state.migrationInProgress = false;

  markMigrated(state.session.user.id);
  state.message = `Импортировано ${rows.length} слов в ваш аккаунт.`;
  await loadUserData(state.session.user.id);
  render();
}

async function refreshAdminData(showMessage = true) {
  if (state.profile?.role !== 'admin') return;

  state.adminLoading = true;
  const [{ data: profiles, error: profilesError }, { data: words, error: wordsError }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
    supabase.from('words').select('id, user_id, learned')
  ]);

  state.adminLoading = false;

  if (profilesError) throw new Error(profilesError.message);
  if (wordsError) throw new Error(wordsError.message);

  state.adminProfiles = profiles || [];
  state.adminWords = words || [];

  if (showMessage) {
    state.message = 'Админ-список обновлён.';
  }
  render();
}

async function saveProfile(form) {
  if (!state.session?.user?.id) return;
  const name = form.elements.profileName.value.trim();
  if (!name) {
    setError('Введите имя профиля.');
    return;
  }

  setBusy(true);
  clearStatus();

  const { error } = await supabase
    .from('profiles')
    .update({ name })
    .eq('id', state.session.user.id);

  if (error) {
    setError(error.message);
  } else {
    state.profile.name = name;
    state.forms.profileName = name;
    state.message = 'Профиль сохранён.';
  }

  setBusy(false);
  render();
}

async function addWord(form) {
  if (!state.session?.user?.id) return;

  const word = form.elements.word.value.trim();
  const translation = form.elements.translation.value.trim();
  const language = clampString(form.elements.language.value, 'English');
  const level = clampString(form.elements.level.value, null);
  const example = clampString(form.elements.example.value, null);

  if (!word || !translation) {
    setError('Заполните слово и перевод.');
    return;
  }

  const existing = findWordByKey(word, language);
  const payload = {
    user_id: state.session.user.id,
    word,
    translation,
    language,
    level,
    example,
    learned: existing ? existing.learned : false,
    word_key: makeWordKey(word, language),
    language_key: normalizeText(language),
    sort_order: existing ? existing.sort_order : state.words.length
  };

  setBusy(true);
  clearStatus();

  const { error } = await supabase.from('words').upsert(payload, {
    onConflict: 'user_id,word_key,language_key'
  });

  if (error) {
    setError(error.message);
  } else {
    state.message = existing ? 'Слово обновлено.' : 'Слово добавлено.';
    form.reset();
    form.elements.language.value = 'English';
    form.elements.level.value = '';
    await loadUserData(state.session.user.id);
  }

  setBusy(false);
  render();
}

async function importWords(form) {
  if (!state.session?.user?.id) return;

  const file = form.elements.file.files?.[0];
  if (!file) {
    setError('Выберите файл для импорта.');
    return;
  }

  setBusy(true);
  clearStatus();

  try {
    const rows = await readWordRows(file);
    if (!rows.length) {
      throw new Error('В файле не найдено подходящих строк.');
    }

    const normalizedRows = rows.map((row, index) => {
      const word = clampString(row.word);
      const translation = clampString(row.translation);
      const language = clampString(row.language, 'English');
      const existing = findWordByKey(word, language);
      return {
        user_id: state.session.user.id,
        word,
        translation,
        language,
        level: clampString(row.level, null),
        example: clampString(row.example, null),
        learned: existing ? existing.learned || parseLearned(row.learned) : parseLearned(row.learned),
        word_key: makeWordKey(word, language),
        language_key: normalizeText(language),
        sort_order: existing ? existing.sort_order : state.words.length + index
      };
    });

    await upsertWordRows(normalizedRows);

    state.message = `Импортировано ${normalizedRows.length} строк.`;
    await loadUserData(state.session.user.id);
  } catch (error) {
    setError(error.message);
  }

  setBusy(false);
  render();
}

async function updateLearnedState(target) {
  if (!state.session?.user?.id) return;
  const id = target.dataset.learnedId;
  const learned = target.checked;
  const currentIndex = state.words.findIndex((item) => item.id === id);
  if (currentIndex === -1) return;

  const previous = state.words[currentIndex].learned;
  state.words[currentIndex].learned = learned;
  renderWords();

  const { error } = await supabase.from('words').update({ learned }).eq('id', id);
  if (error) {
    state.words[currentIndex].learned = previous;
    renderWords();
    throw new Error(error.message);
  }
}

async function upsertWordRows(rows, batchSize = 250) {
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from('words').upsert(batch, {
      onConflict: 'user_id,word_key,language_key'
    });
    if (error) {
      throw new Error(error.message);
    }
  }
}

async function updateAdminRole(userId, role) {
  if (!userId || !role) return;
  const { error } = await supabase.rpc('admin_set_role', {
    target_user_id: userId,
    new_role: role
  });
  if (error) throw new Error(error.message);
  state.message = 'Роль пользователя обновлена.';
  await refreshAdminData(false);
}

async function deleteUser(userId) {
  if (!userId) return;
  const confirmed = window.confirm('Удалить пользователя и все его слова?');
  if (!confirmed) return;
  const { error } = await supabase.rpc('admin_delete_user', {
    target_user_id: userId
  });
  if (error) throw new Error(error.message);
  state.message = 'Пользователь удалён.';
  await refreshAdminData(false);
}

function findWordByKey(word, language) {
  const key = makeWordKey(word, language);
  return state.words.find((item) => makeWordKey(item.word, item.language) === key);
}

function renderWords() {
  if (!els.tbody || !els.empty) return;

  const filtered = state.words.filter((item) => isVisibleWord(item));
  const learnedCount = state.words.filter((item) => item.learned).length;

  if (els.totalCount) {
    els.totalCount.textContent = String(state.words.length);
  }
  if (els.learnedCount) {
    els.learnedCount.textContent = String(learnedCount);
  }
  if (els.currentTabTitle) {
    els.currentTabTitle.textContent = STATUS_LABELS[state.tab] || STATUS_LABELS.all;
  }
  if (els.tableMeta) {
    const parts = [];
    if (state.level !== 'all') parts.push(state.level);
    if (state.language !== 'all') parts.push(state.language);
    els.tableMeta.textContent = parts.length ? ` · ${parts.join(' · ')}` : '';
  }

  els.empty.classList.toggle('hidden', filtered.length !== 0);
  els.tbody.innerHTML = filtered
    .map((item) => {
      const learned = Boolean(item.learned);
      return `
        <tr class="${learned ? 'learned-row' : ''}" data-id="${escapeHTML(item.id)}">
          <td>
            <input
              class="check"
              type="checkbox"
              data-learned-id="${escapeHTML(item.id)}"
              ${learned ? 'checked' : ''}
              aria-label="Отметить как выученное"
            />
          </td>
          <td><span class="level ${escapeHTML(item.level || '')}">${escapeHTML(item.level || '—')}</span></td>
          <td><div class="word">${escapeHTML(item.word)}</div></td>
          <td><div class="translation">${escapeHTML(item.translation)}</div></td>
          <td><div class="example">${escapeHTML(item.example || '')}</div></td>
        </tr>
      `;
    })
    .join('');

  syncFormState();
}

function isVisibleWord(item) {
  const learned = Boolean(item.learned);
  if (state.tab === 'learned' && !learned) return false;
  if (state.tab === 'unknown' && learned) return false;
  if (state.level !== 'all' && item.level !== state.level) return false;
  if (state.language !== 'all' && item.language !== state.language) return false;

  const query = normalizeText(state.query);
  if (!query) return true;

  const haystack = [item.word, item.translation, item.example, item.language, item.level]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

function setBusy(isBusy) {
  const buttons = app.querySelectorAll('button');
  buttons.forEach((button) => {
    if (button.dataset.action === 'logout') return;
    button.disabled = isBusy;
  });
}

function clearStatus() {
  state.error = '';
  state.message = '';
}

function setError(message) {
  state.error = message;
  state.message = '';
  render();
}

function parseLearned(value) {
  if (typeof value === 'boolean') return value;
  const text = normalizeText(value);
  return ['true', '1', 'yes', 'да', 'y'].includes(text);
}

async function readWordRows(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows.map((row) => ({
    word: pickField(row, ['word', 'слово', 'phrase', 'term', 'entry']),
    translation: pickField(row, ['translation', 'перевод', 'meaning', 'definition']),
    language: pickField(row, ['language', 'язык', 'lang', 'source language', 'source_language']),
    level: pickField(row, ['level', 'уровень']),
    example: pickField(row, ['example', 'пример', 'sentence']),
    learned: pickField(row, ['learned', 'выучено', 'status'])
  })).filter((row) => row.word && row.translation);
}

function pickField(row, names) {
  const entries = Object.entries(row);
  for (const name of names) {
    const found = entries.find(([key]) => normalizeText(key) === normalizeText(name));
    if (found && String(found[1]).trim()) {
      return String(found[1]).trim();
    }
  }
  return '';
}

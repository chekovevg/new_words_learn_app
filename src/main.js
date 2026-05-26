import words from './data/words.js';

const STORAGE_KEY = 'new-words-learn-progress-v2';
const LEVELS = ['B1', 'B2', 'C1', 'C2'];
const STATUS_LABELS = {
  unknown: 'Не выучены',
  learned: 'Выучены',
  all: 'Все'
};

const app = document.querySelector('#app');

const state = {
  tab: 'unknown',
  level: 'all',
  language: 'all',
  query: ''
};

const learned = loadProgress();
const allLanguages = uniqueSorted(words.map((item) => item.language), ['English', 'German', 'Georgian']);

app.innerHTML = `
  <div class="app">
    <header>
      <div class="title-block">
        <div class="kicker">Saved translations tracker</div>
        <h1>Простая таблица слов</h1>
        <p class="subtitle">Уровень, слово или фраза, перевод и один пример на английском. Чекбокс слева переносит слово между «Не выучены» и «Выучены».</p>
      </div>
      <div class="summary" aria-label="Summary">
        <span class="pill"><strong id="totalCount">0</strong> всего</span>
        <span class="pill"><strong id="unknownCount">0</strong> не выучены</span>
        <span class="pill"><strong id="learnedCount">0</strong> выучены</span>
        <span class="pill"><strong id="visibleCount">0</strong> показано</span>
      </div>
    </header>

    <section class="toolbar" aria-label="Filters">
      <div class="tabs" role="tablist" aria-label="Vocabulary status">
        <button class="tab active" data-tab="unknown" type="button">Не выучены</button>
        <button class="tab" data-tab="learned" type="button">Выучены</button>
        <button class="tab" data-tab="all" type="button">Все</button>
      </div>
      <input id="search" class="search" type="search" placeholder="Поиск по слову или переводу…" />
      <label class="select-wrap" aria-label="Language filter">
        <span class="select-label">Язык</span>
        <select id="language" class="select">
          <option value="all">Все</option>
          ${allLanguages.map((language) => `<option value="${escapeHTML(language)}">${escapeHTML(language)}</option>`).join('')}
        </select>
      </label>
      <div class="level-filters" aria-label="Level filters">
        ${LEVELS.map((level) => `<button class="level-filter" data-level="${level}" type="button">${level}</button>`).join('')}
      </div>
    </section>

    <main class="table-card">
      <div class="table-head">
        <div><strong id="currentTabTitle">Не выучены</strong> <span class="muted" id="tableMeta"></span></div>
        <div class="small">Активный уровень можно снять повторным кликом по нему</div>
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
  </div>
`;

const els = {
  tbody: document.getElementById('tbody'),
  empty: document.getElementById('empty'),
  search: document.getElementById('search'),
  totalCount: document.getElementById('totalCount'),
  unknownCount: document.getElementById('unknownCount'),
  learnedCount: document.getElementById('learnedCount'),
  visibleCount: document.getElementById('visibleCount'),
  tableMeta: document.getElementById('tableMeta'),
  currentTabTitle: document.getElementById('currentTabTitle'),
  language: document.getElementById('language'),
  tabs: [...document.querySelectorAll('.tab')],
  levelFilters: [...document.querySelectorAll('.level-filter')]
};

syncControls();
render();

app.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === 'search') {
    state.query = target.value;
    render();
  }
});

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'language') {
    state.language = target.value;
    render();
  }
});

app.addEventListener('click', (event) => {
  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    state.tab = tabButton.dataset.tab;
    syncControls();
    render();
    return;
  }

  const levelButton = event.target.closest('[data-level]');
  if (levelButton) {
    const level = levelButton.dataset.level;
    state.level = state.level === level ? 'all' : level;
    syncControls();
    render();
    return;
  }

  const checkbox = event.target.closest('[data-check-id]');
  if (checkbox) {
    const id = Number(checkbox.dataset.checkId);
    if (checkbox.checked) {
      learned.add(id);
    } else {
      learned.delete(id);
    }
    saveProgress();
    render();
  }
});

function loadProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set();
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...learned]));
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
}

function normalize(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniqueSorted(values, preferredOrder = []) {
  const items = [...new Set(values.filter(Boolean))];
  return items.sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      if (ai !== bi) return ai - bi;
    }
    return a.localeCompare(b, 'en', { sensitivity: 'base' });
  });
}

function isVisibleWord(item) {
  const isLearned = learned.has(item.id);
  if (state.tab === 'unknown' && isLearned) return false;
  if (state.tab === 'learned' && !isLearned) return false;
  if (state.level !== 'all' && item.level !== state.level) return false;
  if (state.language !== 'all' && item.language !== state.language) return false;

  const query = normalize(state.query);
  if (!query) return true;

  const haystack = [
    item.word,
    item.translation,
    item.example,
    item.language,
    item.targetLanguage,
    item.level
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

function getFilteredWords() {
  return words.filter(isVisibleWord);
}

function render() {
  const list = getFilteredWords();
  const learnedCount = words.reduce((count, item) => count + (learned.has(item.id) ? 1 : 0), 0);
  const unknownCount = words.length - learnedCount;

  els.totalCount.textContent = String(words.length);
  els.unknownCount.textContent = String(unknownCount);
  els.learnedCount.textContent = String(learnedCount);
  els.visibleCount.textContent = String(list.length);
  els.currentTabTitle.textContent = STATUS_LABELS[state.tab] || STATUS_LABELS.all;
  els.tableMeta.textContent = state.level === 'all' ? '' : `· ${state.level}`;

  els.empty.classList.toggle('hidden', list.length !== 0);
  els.tbody.innerHTML = list.map((item) => {
    const known = learned.has(item.id);
    const title = item.language ? `${item.language}${item.targetLanguage ? ` → ${item.targetLanguage}` : ''}` : '';
    return `
      <tr class="${known ? 'learned-row' : ''}" data-id="${item.id}" title="${escapeHTML(title)}">
        <td><input class="check" type="checkbox" data-check-id="${item.id}" ${known ? 'checked' : ''} aria-label="Mark as learned" /></td>
        <td><span class="level ${escapeHTML(item.level || '')}">${escapeHTML(item.level || '—')}</span></td>
        <td><div class="word">${escapeHTML(item.word)}</div></td>
        <td><div class="translation">${escapeHTML(item.translation)}</div></td>
        <td><div class="example">${escapeHTML(item.example || '')}</div></td>
      </tr>
    `;
  }).join('');

  syncControls();
}

function syncControls() {
  els.search.value = state.query;
  els.language.value = state.language;
  els.tabs.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.tab);
  });
  els.levelFilters.forEach((button) => {
    button.classList.toggle('active', button.dataset.level === state.level);
  });
}

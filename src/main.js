import words from './data/words.json';
import './styles.css';

const STORAGE_KEY = 'new-words-learn-progress-v1';
const LEVEL_ORDER = new Map([
  ['A1', 0],
  ['A2', 1],
  ['B1', 2],
  ['B2', 3],
  ['C1', 4],
  ['C2', 5]
]);
const PREFERRED_LANGUAGES = ['English', 'German', 'Georgian'];
const STATUS_OPTIONS = [
  ['all', 'Все'],
  ['unlearned', 'Невыученные'],
  ['learned', 'Выученные']
];

const app = document.querySelector('#app');

const state = {
  query: '',
  status: 'all',
  language: 'all',
  level: 'all'
};

const learned = loadProgress();
const languages = uniqueSorted(words.map((item) => item.language), PREFERRED_LANGUAGES);
const levels = uniqueSorted(words.map((item) => item.level).filter(Boolean), ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

app.innerHTML = `
  <div class="shell">
    <header class="hero">
      <div class="hero__copy">
        <p class="eyebrow">Personal vocabulary tracker</p>
        <h1>Личный словарь из Google Translate</h1>
        <p class="lead">
          Быстрый список слов с поиском, фильтрами, отметкой “выучено” и сохранением прогресса в браузере.
        </p>
      </div>
      <div class="hero__stats" aria-label="Сводка">
        <article class="stat">
          <span>Всего слов</span>
          <strong id="stat-total">0</strong>
        </article>
        <article class="stat">
          <span>Выучено</span>
          <strong id="stat-learned">0</strong>
        </article>
        <article class="stat">
          <span>Осталось</span>
          <strong id="stat-remaining">0</strong>
        </article>
      </div>
    </header>

    <section class="panel filters" aria-label="Фильтры">
      <label class="field field--search">
        <span>Поиск</span>
        <input id="search" type="search" value="" placeholder="Слово, перевод, пример..." />
      </label>

      <div class="segmented" role="tablist" aria-label="Статус">
        ${STATUS_OPTIONS.map(([value, label]) => `<button class="segment ${state.status === value ? 'is-active' : ''}" data-status="${value}" type="button">${label}</button>`).join('')}
      </div>

      <label class="field">
        <span>Язык</span>
        <select id="language">
          <option value="all">Все</option>
          ${languages.map((language) => `<option value="${escapeHTML(language)}">${escapeHTML(language)}</option>`).join('')}
        </select>
      </label>

      <label class="field">
        <span>Уровень</span>
        <select id="level">
          <option value="all">Все</option>
          ${levels.map((level) => `<option value="${escapeHTML(level)}">${escapeHTML(level)}</option>`).join('')}
        </select>
      </label>

      <button class="ghost-button" id="clear-filters" type="button">Сбросить фильтры</button>
      <button class="ghost-button" id="reset-progress" type="button">Сбросить прогресс</button>
    </section>

    <section class="panel results">
      <div class="results__header">
        <div>
          <h2>Слова</h2>
          <p id="results-meta">0 из 0</p>
        </div>
        <div class="progress">
          <div class="progress__track" aria-hidden="true">
            <div id="progress-bar" class="progress__bar" style="width:0%"></div>
          </div>
          <span id="progress-label">0%</span>
        </div>
      </div>

      <div id="cards" class="cards"></div>
    </section>
  </div>
`;

const elements = {
  search: document.querySelector('#search'),
  language: document.querySelector('#language'),
  level: document.querySelector('#level'),
  cards: document.querySelector('#cards'),
  resultsMeta: document.querySelector('#results-meta'),
  progressBar: document.querySelector('#progress-bar'),
  progressLabel: document.querySelector('#progress-label'),
  statTotal: document.querySelector('#stat-total'),
  statLearned: document.querySelector('#stat-learned'),
  statRemaining: document.querySelector('#stat-remaining'),
  statusButtons: [...document.querySelectorAll('[data-status]')]
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
  if (target instanceof HTMLSelectElement && target.id === 'level') {
    state.level = target.value;
    render();
  }
});

app.addEventListener('click', (event) => {
  const statusButton = event.target.closest('[data-status]');
  if (statusButton) {
    state.status = statusButton.dataset.status;
    syncControls();
    render();
    return;
  }

  const toggleButton = event.target.closest('[data-learn-id]');
  if (toggleButton) {
    const id = Number(toggleButton.dataset.learnId);
    if (learned.has(id)) {
      learned.delete(id);
    } else {
      learned.add(id);
    }
    saveProgress();
    render();
    return;
  }

  if (event.target.id === 'clear-filters') {
    state.query = '';
    state.status = 'all';
    state.language = 'all';
    state.level = 'all';
    syncControls();
    render();
    return;
  }

  if (event.target.id === 'reset-progress') {
    learned.clear();
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

function uniqueSorted(values, order = []) {
  const set = new Set(values.filter(Boolean));
  return [...set].sort((a, b) => {
    const aIndex = order.indexOf(a);
    const bIndex = order.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      if (aIndex !== bIndex) return aIndex - bIndex;
    }
    return a.localeCompare(b, 'en', { sensitivity: 'base' });
  });
}

function matchesQuery(item, query) {
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
  const query = normalize(state.query);

  return words.filter((item) => {
    const isLearned = learned.has(item.id);
    if (state.status === 'learned' && !isLearned) return false;
    if (state.status === 'unlearned' && isLearned) return false;
    if (state.language !== 'all' && item.language !== state.language) return false;
    if (state.level !== 'all' && (item.level || 'unknown') !== state.level) return false;
    return matchesQuery(item, query);
  });
}

function render() {
  const filtered = getFilteredWords();
  const total = words.length;
  const learnedCount = learned.size;
  const remaining = total - learnedCount;
  const progress = total ? Math.round((learnedCount / total) * 100) : 0;

  elements.statTotal.textContent = String(total);
  elements.statLearned.textContent = String(learnedCount);
  elements.statRemaining.textContent = String(remaining);
  elements.resultsMeta.textContent = `${filtered.length} из ${total}`;
  elements.progressLabel.textContent = `${progress}%`;
  elements.progressBar.style.width = `${progress}%`;

  elements.search.value = state.query;
  elements.language.value = state.language;
  elements.level.value = state.level;
  elements.statusButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.status === state.status);
  });

  elements.cards.innerHTML = filtered.length
    ? filtered
        .map((item) => {
          const isLearned = learned.has(item.id);
          return `
            <article class="card ${isLearned ? 'is-learned' : ''}">
              <div class="card__top">
                <div class="card__title">
                  <p class="card__word">${escapeHTML(item.word)}</p>
                  <div class="badges">
                    <span class="badge badge--language">${escapeHTML(item.language)}</span>
                    ${item.targetLanguage ? `<span class="badge badge--soft">${escapeHTML(item.targetLanguage)}</span>` : ''}
                    ${item.level ? `<span class="badge badge--level">${escapeHTML(item.level)}</span>` : ''}
                  </div>
                </div>
                <button
                  class="learn-toggle ${isLearned ? 'is-active' : ''}"
                  type="button"
                  data-learn-id="${item.id}"
                  aria-pressed="${isLearned ? 'true' : 'false'}"
                >
                  <span class="learn-toggle__dot" aria-hidden="true"></span>
                  ${isLearned ? 'Выучено' : 'Не выучено'}
                </button>
              </div>

              <p class="translation">${escapeHTML(item.translation)}</p>
              ${item.example ? `<p class="example">${escapeHTML(item.example)}</p>` : ''}
            </article>
          `;
        })
        .join('')
    : `<div class="empty-state">Ничего не найдено. Попробуй другой запрос или сбрось фильтры.</div>`;
}

function syncControls() {
  elements.search.value = state.query;
  elements.language.value = state.language;
  elements.level.value = state.level;
  elements.statusButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.status === state.status);
  });
}

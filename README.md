# New Words Learn App

Лёгкое статическое веб-приложение для личного словаря на базе слов из Google Translate.

## Что умеет

- список слов в карточках;
- поиск по слову, переводу, примеру, языку и уровню;
- фильтр по статусу: все, выученные, невыученные;
- фильтр по языку;
- фильтр по уровню;
- отметка слова как выученного;
- сохранение прогресса в `localStorage`;
- сборка и публикация через GitHub Pages.

## Запуск локально

```bash
npm install
npm run data:build
npm run dev
```

Открой адрес, который покажет Vite, обычно `http://localhost:5173`.

## Как обновлять список слов

1. Обнови исходные файлы в `data/source/`:
   - `data/source/Saved translations.xlsx`
   - `data/source/saved_translations_light_tracker.html`
2. Пересобери JSON:

```bash
npm run data:build
```

3. Если всё ок, собери проект:

```bash
npm run build
```

### Структура данных

Сгенерированные записи лежат в `src/data/words.json` и имеют формат:

```json
{
  "id": 1,
  "word": "example",
  "translation": "пример",
  "language": "English",
  "targetLanguage": "Russian",
  "level": "B1",
  "example": "Optional example",
  "learned": false
}
```

Если у записи нет уровня, поле `level` остаётся `null`.

## Где менять настройки

- `vite.config.js` - базовый путь для GitHub Pages;
- `src/main.js` - логика фильтров, localStorage и отображения;
- `src/styles.css` - внешний вид;
- `scripts/build-data.mjs` - импорт и нормализация исходных данных;
- `data/source/` - оригинальные файлы со словами.

## Публикация

Проект настроен на GitHub Pages через workflow в `.github/workflows/deploy.yml`.

После push в `main` GitHub Actions:

1. устанавливает зависимости;
2. собирает проект;
3. публикует `dist` на GitHub Pages.

Если Pages ещё не включены в настройках репозитория, выбери источник публикации `GitHub Actions`.

## Что проверить вручную

- открывается ли список слов;
- работает ли поиск;
- переключаются ли фильтры по статусу, языку и уровню;
- сохраняется ли отметка выученного слова после перезагрузки;
- комфортно ли пользоваться на телефоне;
- проходит ли `npm run build`;
- открывается ли опубликованная страница по адресу GitHub Pages.

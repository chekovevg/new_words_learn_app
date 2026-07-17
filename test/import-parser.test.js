import assert from 'node:assert/strict';
import test from 'node:test';
import xlsx from 'xlsx';
import { parseImportedRows } from '../src/lib/import-parser.js';

const expectedApple = {
  word: 'apple',
  translation: 'яблоко',
  language: 'English',
  level: null,
  example: null,
  learned: null
};

function createWorkbookFile(rows) {
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, sheet, 'Words');
  const bytes = xlsx.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([bytes], 'words.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

test('parses text/csv through the spreadsheet parser', async () => {
  const file = new File(['word,translation\napple,яблоко'], 'words.csv', {
    type: 'text/csv'
  });

  assert.deepEqual(await parseImportedRows(file), [expectedApple]);
});

test('keeps the first row of a headerless workbook', async () => {
  const file = createWorkbookFile([
    ['apple', 'яблоко'],
    ['book', 'книга']
  ]);

  const rows = await parseImportedRows(file);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], expectedApple);
});

test('parses a single-row headerless workbook', async () => {
  const file = createWorkbookFile([['apple', 'яблоко']]);
  assert.deepEqual(await parseImportedRows(file), [expectedApple]);
});

test('does not import a header-only workbook as vocabulary', async () => {
  const file = createWorkbookFile([['word', 'translation']]);
  assert.deepEqual(await parseImportedRows(file), []);
});

test('reverses Russian source rows so Russian remains the translation language', async () => {
  const russian = '\u043f\u043e\u0434\u0432\u043e\u0434\u043d\u044b\u0435 \u043a\u0430\u043c\u043d\u0438';
  const file = createWorkbookFile([['Russian', 'English', russian, 'pitfalls']]);

  assert.deepEqual(await parseImportedRows(file), [{
    word: 'pitfalls',
    translation: russian,
    language: 'English',
    level: null,
    example: null,
    learned: null
  }]);
});

test('rejects imports whose translation language is not Russian', async () => {
  const file = createWorkbookFile([['German', 'English', 'zum Beispiel', 'for example']]);
  await assert.rejects(() => parseImportedRows(file), /translation language must be Russian/i);
});

test('rejects an import larger than ten MiB', async () => {
  const file = {
    name: 'large.txt',
    type: 'text/plain',
    size: 10 * 1024 * 1024 + 1
  };

  await assert.rejects(() => parseImportedRows(file), /10 MB/);
});

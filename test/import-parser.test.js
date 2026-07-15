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

test('rejects an import larger than ten MiB', async () => {
  const file = {
    name: 'large.txt',
    type: 'text/plain',
    size: 10 * 1024 * 1024 + 1
  };

  await assert.rejects(() => parseImportedRows(file), /10 MB/);
});

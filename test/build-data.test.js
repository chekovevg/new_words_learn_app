import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('builds vocabulary data with the installed SheetJS ESM package', () => {
  const result = spawnSync(process.execPath, ['scripts/build-data.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Wrote \d+ words/);

  const rows = JSON.parse(fs.readFileSync(path.join(root, 'src/data/words.json'), 'utf8'));
  assert.deepEqual(
    rows.filter((row) => row.language === 'Russian'),
    [],
    'Russian must only be used as the translation language'
  );
  const auditedEnglishWords = new Set([
    'bailing',
    'bandwith',
    'bothersome',
    'breakers',
    'counterpart',
    'don’t pull punches',
    'eyesight',
    'fetch',
    'fuss',
    'hiatus',
    'obnoxious',
    'pastry',
    'scurry up',
    'sorcerer',
    'to be on welfare',
    'wannabe-bigtime',
    'whatcha doin'
  ]);
  const mislabeledRows = rows.filter(
    (row) => auditedEnglishWords.has(String(row.word).trim().toLowerCase()) && row.language !== 'English'
  );

  assert.deepEqual(mislabeledRows, []);
  assert.deepEqual(
    rows.filter(
      (row) => row.language === 'English' && (/[А-Яа-яЁё]/u.test(row.word) || /[ა-ჿ]/u.test(row.word))
    ),
    []
  );
  assert.deepEqual(
    rows.filter((row) => row.language === 'Russian' && !/[А-Яа-яЁё]/u.test(row.word)),
    []
  );
  assert.deepEqual(
    rows.filter((row) => row.language === 'Georgian' && !/[ა-ჿ]/u.test(row.word)),
    []
  );
});

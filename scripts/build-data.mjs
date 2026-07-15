import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';

xlsx.set_fs(fs);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'data', 'source');
const outputJsonPath = path.join(root, 'src', 'data', 'words.json');
const outputJsPath = path.join(root, 'src', 'data', 'words.js');

const htmlPath = path.join(sourceDir, 'saved_translations_light_tracker.html');
const xlsxPath = path.join(sourceDir, 'Saved translations.xlsx');

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');
const normalizeText = (value) =>
  String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const normalizeLanguage = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Unknown';
  return text
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((part) => {
      if (/^[\s-]+$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
};

const extractHtmlWords = (htmlSource) => {
  const match = htmlSource.match(/const WORDS = (\[[\s\S]*?\]);/);
  if (!match) {
    throw new Error('Could not find WORDS array in saved_translations_light_tracker.html');
  }
  const parsed = JSON.parse(match[1]);
  return parsed.map((item) => ({
    word: String(item.word ?? '').trim(),
    translation: String(item.translation ?? '').trim(),
    level: item.level ? String(item.level).trim() : null,
    example: item.example ? String(item.example).trim() : null
  }));
};

const htmlWords = extractHtmlWords(readText(htmlPath));
const htmlByWord = new Map();
for (const item of htmlWords) {
  const key = normalizeText(item.word);
  if (!htmlByWord.has(key)) htmlByWord.set(key, []);
  htmlByWord.get(key).push(item);
}

const workbook = xlsx.readFile(xlsxPath, { cellText: true, cellDates: false });
const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

const levelOrder = new Map([
  ['A1', 0],
  ['A2', 1],
  ['B1', 2],
  ['B2', 3],
  ['C1', 4],
  ['C2', 5]
]);

const records = [];
for (const row of rows) {
  const [sourceLanguage, targetLanguage, word, translation] = row.map((cell) => String(cell ?? '').trim());
  if (!sourceLanguage || !targetLanguage || !word || !translation) continue;

  const language = normalizeLanguage(sourceLanguage);
  const wordText = word.replace(/\s+/g, ' ').trim();
  const translationText = translation.replace(/\s+/g, ' ').trim();
  let matched = null;

  if (language === 'English') {
    const candidates = htmlByWord.get(normalizeText(wordText)) || [];
    matched =
      candidates.find((item) => normalizeText(item.translation) === normalizeText(translationText)) ||
      candidates[0] ||
      null;
  }

  records.push({
    id: records.length + 1,
    language,
    targetLanguage: normalizeLanguage(targetLanguage),
    word: wordText,
    translation: translationText,
    level: matched?.level ?? null,
    example: matched?.example ?? null,
    learned: false
  });
}

records.sort((a, b) => {
  const languageDiff = a.language.localeCompare(b.language, 'en');
  if (languageDiff !== 0) return languageDiff;

  const aLevel = a.level ? levelOrder.get(String(a.level).toUpperCase()) ?? 99 : 99;
  const bLevel = b.level ? levelOrder.get(String(b.level).toUpperCase()) ?? 99 : 99;
  if (aLevel !== bLevel) return aLevel - bLevel;

  return a.word.localeCompare(b.word, 'en', { sensitivity: 'base' });
});

const finalRecords = records.map((item, index) => ({
  ...item,
  id: index + 1
}));

fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
fs.writeFileSync(outputJsonPath, `${JSON.stringify(finalRecords, null, 2)}\n`, 'utf8');
fs.writeFileSync(outputJsPath, `const words = ${JSON.stringify(finalRecords, null, 2)};\n\nexport default words;\n`, 'utf8');

console.log(`Wrote ${finalRecords.length} words to ${path.relative(root, outputJsonPath)} and ${path.relative(root, outputJsPath)}`);

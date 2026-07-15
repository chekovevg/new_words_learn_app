import { clampString, normalizeText } from './word-utils.js';

const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

const KNOWN_LANGUAGES = new Set([
  'english',
  'german',
  'georgian',
  'russian',
  'french',
  'spanish',
  'italian',
  'latin',
  'indonesian'
]);

const LINE_SEPARATORS = [
  /\t+/,
  /\s{2,}/,
  /\s[—–-]\s/,
  /\s[:：]\s/,
  /\s[|]\s/,
  /\s[=>→]\s/
];

export async function parseImportedRows(file) {
  if (Number(file?.size) > MAX_IMPORT_FILE_SIZE) {
    throw new Error('Файл слишком большой. Максимальный размер — 10 MB.');
  }

  const format = detectFormat(file);

  if (format === 'spreadsheet') {
    return parseSpreadsheetRows(file);
  } else if (format === 'pdf') {
    const text = await extractPdfText(file);
    return parseTextRows(text);
  } else if (format === 'docx') {
    const text = await extractDocxText(file);
    return parseTextRows(text);
  } else if (format === 'text') {
    const text = await file.text();
    return parseTextRows(text);
  }

  try {
    const rows = await parseSpreadsheetRows(file);
    if (rows.length) return rows;
  } catch {
    // fall through to text parsing
  }

  const rawText = await safeReadText(file);
  return parseTextRows(rawText);
}

function detectFormat(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();

  if (name.endsWith('.pdf') || type.includes('pdf')) return 'pdf';
  if (name.endsWith('.docx') || type.includes('word')) return 'docx';
  if (name.endsWith('.csv') || name.endsWith('.xls') || name.endsWith('.xlsx') || type.includes('sheet')) {
    return 'spreadsheet';
  }
  if (name.endsWith('.txt') || type.startsWith('text/')) return 'text';

  return 'unknown';
}

async function parseSpreadsheetRows(file) {
  const XLSX = await getXlsx();
  const isCsv = String(file?.name || '').toLowerCase().endsWith('.csv');
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const structuredRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      .map((row) => normalizeStructuredRow(row))
      .filter((row) => row.word && row.translation);

    if (structuredRows.length) {
      rows.push(...structuredRows);
      continue;
    }

    const tableRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    rows.push(...parseCellTableRows(tableRows));
  }

  return dedupeRows(rows);
}

function normalizeStructuredRow(row) {
  if (!row || typeof row !== 'object') return emptyRow();

  const word = pickField(row, ['word', 'слово', 'phrase', 'term', 'entry']);
  const translation = pickField(row, ['translation', 'перевод', 'meaning', 'definition']);
  const language = pickField(row, ['language', 'язык', 'lang', 'source language', 'source_language']);
  const level = pickField(row, ['level', 'уровень']);
  const example = pickField(row, ['example', 'пример', 'sentence']);
  const learned = pickField(row, ['learned', 'выучено', 'status']);

  if (word && translation) {
    return normalizeRow({ word, translation, language, level, example, learned });
  }

  return emptyRow();
}

function parseCellTableRows(tableRows) {
  if (!Array.isArray(tableRows) || tableRows.length === 0) return [];

  const rows = [];
  const dataRows = isHeaderRow(tableRows[0]) ? tableRows.slice(1) : tableRows;
  for (const cells of dataRows) {
    const normalizedCells = Array.isArray(cells)
      ? cells.map((cell) => String(cell ?? '').trim()).filter(Boolean)
      : [];
    const row = normalizeCellsRow(normalizedCells);
    if (row.word && row.translation) {
      rows.push(row);
    }
  }
  return rows;
}

function isHeaderRow(cells) {
  if (!Array.isArray(cells)) return false;
  const names = cells.map((cell) => normalizeText(cell));
  const hasWord = names.some((name) => ['word', 'слово', 'phrase', 'term', 'entry'].includes(name));
  const hasTranslation = names.some((name) =>
    ['translation', 'перевод', 'meaning', 'definition'].includes(name)
  );
  return hasWord && hasTranslation;
}

function normalizeCellsRow(cells) {
  if (cells.length >= 4 && isLikelyLanguage(cells[0]) && isLikelyLanguage(cells[1])) {
    return normalizeRow({
      language: cells[0],
      word: cells[2],
      translation: cells[3]
    });
  }

  if (cells.length >= 3 && isLikelyLanguage(cells[0])) {
    return normalizeRow({
      language: cells[0],
      word: cells[1],
      translation: cells[2]
    });
  }

  if (cells.length >= 2) {
    return normalizeRow({
      word: cells[0],
      translation: cells[1],
      language: 'English'
    });
  }

  return emptyRow();
}

function parseTextRows(text) {
  const normalizedText = String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '\n');

  const lines = normalizedText
    .split('\n')
    .map((line) => cleanLine(line))
    .filter(Boolean);

  const rows = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed.word && parsed.translation) {
      rows.push(parsed);
    }
  }

  if (rows.length) {
    return dedupeRows(rows);
  }

  const pairedRows = parsePairedLines(lines);
  return dedupeRows(pairedRows);
}

function parseLine(line) {
  const cells = splitLine(line);
  if (!cells.length) return emptyRow();

  if (cells.length === 1) {
    const parsed = parseSeparatedPair(cells[0]);
    if (parsed.word && parsed.translation) return parsed;
    return emptyRow();
  }

  return normalizeCellsRow(cells);
}

function parsePairedLines(lines) {
  const rows = [];
  for (let index = 0; index < lines.length - 1; index += 2) {
    const first = lines[index];
    const second = lines[index + 1];
    if (!first || !second) continue;

    rows.push(
      normalizeRow({
        word: first,
        translation: second,
        language: 'English'
      })
    );
  }
  return rows;
}

function splitLine(line) {
  for (const separator of LINE_SEPARATORS) {
    if (separator.test(line)) {
      const parts = line
        .split(separator)
        .map((part) => cleanLine(part))
        .filter(Boolean);
      if (parts.length >= 2) {
        return parts;
      }
    }
  }
  return [cleanLine(line)].filter(Boolean);
}

function parseSeparatedPair(line) {
  const separators = [' → ', ' => ', ' — ', ' – ', ' - ', ' : ', ' | ', '\t'];
  for (const separator of separators) {
    const index = line.indexOf(separator);
    if (index > 0) {
      const left = cleanLine(line.slice(0, index));
      const right = cleanLine(line.slice(index + separator.length));
      if (left && right) {
        return normalizeRow({
          word: left,
          translation: right,
          language: 'English'
        });
      }
    }
  }
  return emptyRow();
}

async function extractPdfText(file) {
  const { getDocument, GlobalWorkerOptions, pdfWorkerUrl } = await getPdfJs();
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const buffer = await file.arrayBuffer();
  const document = await getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const parts = [];

    for (const item of content.items) {
      parts.push(item.str);
      if (item.hasEOL) {
        parts.push('\n');
      } else {
        parts.push(' ');
      }
    }

    pages.push(parts.join(' '));
  }

  return pages.join('\n');
}

async function extractDocxText(file) {
  const mammoth = await getMammoth();
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value || '';
}

async function safeReadText(file) {
  try {
    return await file.text();
  } catch {
    return '';
  }
}

function normalizeRow(row) {
  const word = clampString(row.word);
  const translation = clampString(row.translation);
  const language = clampString(row.language, 'English');

  return {
    word,
    translation,
    language,
    level: clampString(row.level, null),
    example: clampString(row.example, null),
    learned: clampString(row.learned, null)
  };
}

function cleanLine(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/^\s*[\-\*\u2022]\s*/, '')
    .replace(/^\s*\d+[\).\:-]?\s*/, '')
    .trim();
}

function isLikelyLanguage(value) {
  const text = normalizeText(value);
  if (!text) return false;
  if (KNOWN_LANGUAGES.has(text)) return true;
  return false;
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

function emptyRow() {
  return {
    word: '',
    translation: '',
    language: 'English',
    level: null,
    example: null,
    learned: null
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  const result = [];

  for (const row of rows) {
    if (!row.word || !row.translation) continue;
    const key = `${normalizeText(row.language)}|${normalizeText(row.word)}|${normalizeText(row.translation)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalizeRow(row));
  }

  return result;
}

let xlsxModulePromise;
async function getXlsx() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx');
  }
  return xlsxModulePromise;
}

let mammothModulePromise;
async function getMammoth() {
  if (!mammothModulePromise) {
    mammothModulePromise = import('mammoth/mammoth.browser.js');
  }
  return mammothModulePromise;
}

let pdfJsModulePromise;
async function getPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    ]).then(([pdfjsModule, workerModule]) => ({
      ...pdfjsModule,
      pdfWorkerUrl: workerModule.default
    }));
  }
  return pdfJsModulePromise;
}

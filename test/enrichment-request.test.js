import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractBearerToken,
  validateEnrichmentItems
} from '../api/lib/enrichment-request.js';

const validItem = {
  id: 'word-1',
  word: ' apple ',
  translation: ' яблоко ',
  language: ' English ',
  level: null,
  example: null
};

test('extracts only a valid bearer token', () => {
  assert.equal(extractBearerToken({ authorization: 'Bearer token-123' }), 'token-123');
  assert.equal(extractBearerToken({ Authorization: 'Bearer token-456' }), 'token-456');
  assert.equal(extractBearerToken({ authorization: 'Basic token-123' }), null);
  assert.equal(extractBearerToken({}), null);
});

test('rejects more than four enrichment items', () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ ...validItem, id: `word-${index}` }));
  assert.throws(() => validateEnrichmentItems(items), /at most 4/);
});

test('rejects duplicate ids and oversized fields', () => {
  assert.throws(() => validateEnrichmentItems([validItem, validItem]), /unique/);
  assert.throws(
    () => validateEnrichmentItems([{ ...validItem, word: 'x'.repeat(201) }]),
    /word must be between 1 and 200/
  );
});

test('returns trimmed and bounded enrichment items', () => {
  assert.deepEqual(validateEnrichmentItems([validItem]), [
    {
      id: 'word-1',
      word: 'apple',
      translation: 'яблоко',
      language: 'English',
      level: null,
      example: null
    }
  ]);
});

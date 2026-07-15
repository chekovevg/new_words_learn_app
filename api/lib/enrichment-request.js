const MAX_ITEMS = 4;
const ALLOWED_LEVELS = new Set(['B1', 'B2', 'C1', 'C2']);

export class RequestValidationError extends Error {}

export function extractBearerToken(headers = {}) {
  const authorization = headers.authorization ?? headers.Authorization;
  if (typeof authorization !== 'string') return null;

  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] || null;
}

export function validateEnrichmentItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RequestValidationError('items must be a non-empty array');
  }
  if (items.length > MAX_ITEMS) {
    throw new RequestValidationError(`items must contain at most ${MAX_ITEMS} entries`);
  }

  const ids = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new RequestValidationError(`items[${index}] must be an object`);
    }

    const id = readRequiredString(item.id, 'id', 128);
    if (ids.has(id)) {
      throw new RequestValidationError('item ids must be unique');
    }
    ids.add(id);

    return {
      id,
      word: readRequiredString(item.word, 'word', 200),
      translation: readRequiredString(item.translation, 'translation', 500),
      language: readRequiredString(item.language ?? 'English', 'language', 64),
      level: readOptionalLevel(item.level),
      example: readOptionalString(item.example, 'example', 500)
    };
  });
}

function readRequiredString(value, field, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) {
    throw new RequestValidationError(`${field} must be between 1 and ${maxLength} characters`);
  }
  return text;
}

function readOptionalString(value, field, maxLength) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new RequestValidationError(`${field} must be a string or null`);
  }

  const text = value.trim();
  if (!text) return null;
  if (text.length > maxLength) {
    throw new RequestValidationError(`${field} must be at most ${maxLength} characters`);
  }
  return text;
}

function readOptionalLevel(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new RequestValidationError('level must be B1, B2, C1, C2, or null');
  }

  const level = value.trim().toUpperCase();
  if (!ALLOWED_LEVELS.has(level)) {
    throw new RequestValidationError('level must be B1, B2, C1, C2, or null');
  }
  return level;
}

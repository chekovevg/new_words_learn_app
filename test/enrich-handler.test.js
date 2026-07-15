import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnrichmentHandler } from '../api/enrich-words.js';

const validItem = {
  id: 'word-1',
  word: 'apple',
  translation: 'яблоко',
  language: 'English',
  level: null,
  example: null
};

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function invokeHandler({
  method = 'POST',
  headers = { authorization: 'Bearer valid-token' },
  body = { items: [validItem] },
  authContext = { user: { id: 'user-1' }, client: {} },
  quotaAllowed = true,
  enrichResult = [{ id: 'word-1', level: 'B1', example: 'I ate an apple.', confidence: 0.9 }],
  enrichError = null
} = {}) {
  const calls = { verify: 0, quota: 0, enrich: 0 };
  const handler = createEnrichmentHandler({
    verifyToken: async () => {
      calls.verify += 1;
      return authContext;
    },
    consumeQuota: async () => {
      calls.quota += 1;
      return quotaAllowed;
    },
    enrichItems: async () => {
      calls.enrich += 1;
      if (enrichError) throw enrichError;
      return enrichResult;
    },
    logger: { error() {} }
  });
  const response = createResponse();
  await handler({ method, headers, body }, response);
  return { response, calls };
}

test('rejects a missing bearer token before auth lookup', async () => {
  const { response, calls } = await invokeHandler({ headers: {} });
  assert.equal(response.statusCode, 401);
  assert.equal(calls.verify, 0);
});

test('rejects an invalid token', async () => {
  const { response, calls } = await invokeHandler({ authContext: null });
  assert.equal(response.statusCode, 401);
  assert.equal(calls.quota, 0);
});

test('rejects an oversized batch before calling auth or Gemini', async () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ ...validItem, id: `word-${index}` }));
  const { response, calls } = await invokeHandler({ body: { items } });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(calls, { verify: 0, quota: 0, enrich: 0 });
});

test('returns 429 when the daily quota is exhausted', async () => {
  const { response, calls } = await invokeHandler({ quotaAllowed: false });
  assert.equal(response.statusCode, 429);
  assert.equal(calls.enrich, 0);
});

test('returns Gemini results for an authenticated request within quota', async () => {
  const { response, calls } = await invokeHandler();
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.results[0].level, 'B1');
  assert.deepEqual(calls, { verify: 1, quota: 1, enrich: 1 });
});

test('does not expose an upstream error message', async () => {
  const { response } = await invokeHandler({ enrichError: new Error('provider secret detail') });
  assert.equal(response.statusCode, 502);
  assert.equal(response.payload.error, 'AI enrichment service failed');
  assert.doesNotMatch(JSON.stringify(response.payload), /provider secret detail/);
});

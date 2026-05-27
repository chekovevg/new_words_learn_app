const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export const config = {
  maxDuration: 30
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Missing GEMINI_API_KEY environment variable'
    });
    return;
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    res.status(400).json({ error: 'items must be a non-empty array' });
    return;
  }

  try {
    const results = await enrichBatchWithGemini({
      apiKey,
      model: DEFAULT_MODEL,
      items
    });

    res.status(200).json({ results });
  } catch (error) {
    const message = error?.message || 'Gemini enrichment failed';
    res.status(500).json({ error: message });
  }
}

async function enrichBatchWithGemini({ apiKey, model, items }) {
  const prompt = buildPrompt(items);
  const schema = buildResponseSchema(items);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseJsonSchema: schema
        }
      })
    }
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(extractGeminiError(raw, response.status));
  }

  const data = safeParseJson(raw);
  const text = extractCandidateText(data);
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  const parsed = safeParseJson(text);
  const results = normalizeResults(parsed, items);
  if (!results.length) {
    const promptFeedback = data?.promptFeedback ? ` Prompt feedback: ${JSON.stringify(data.promptFeedback).slice(0, 200)}` : '';
    throw new Error(`Gemini returned no results. Raw text: ${text.slice(0, 300)}.${promptFeedback}`);
  }

  return results.map((row) => ({
    id: String(row.id ?? ''),
    level: clampLevel(row.level),
    example: clampText(row.example),
    confidence: clampConfidence(row.confidence),
    source: 'gemini'
  }));
}

function buildResponseSchema(items) {
  const ids = items.map((item) => String(item.id));
  return {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              enum: ids
            },
            level: {
              type: 'string',
              enum: ['B1', 'B2', 'C1', 'C2']
            },
            example: {
              type: 'string'
            },
            confidence: {
              type: 'number'
            }
          },
          required: ['id', 'level', 'example', 'confidence'],
          additionalProperties: false
        }
      }
    },
    required: ['results'],
    additionalProperties: false
  };
}

function buildPrompt(items) {
  const payload = items.map((item) => ({
    id: String(item.id),
    word: String(item.word ?? '').trim(),
    translation: String(item.translation ?? '').trim(),
    language: String(item.language ?? 'English').trim(),
    currentLevel: item.level ?? null,
    currentExample: item.example ?? null
  }));

  return `
You are enriching vocabulary cards for a personal language learning app.

Return only valid JSON with this exact shape:
{
  "results": [
    {
      "id": "same id from input",
      "level": "B1 | B2 | C1 | C2 | null",
      "example": "short natural English example sentence | null",
      "confidence": 0.0
    }
  ]
}

Rules:
- Return one result for every input item.
- Use CEFR levels only: B1, B2, C1, C2. If unsure, use null.
- Write the example in natural English.
- Keep examples concise and useful for a learner.
- If the input already has a level or example, you may improve the missing field only.
- Do not include markdown or extra commentary.
- Keep confidence between 0 and 1.

Input items:
${JSON.stringify(payload, null, 2)}
`.trim();
}

function extractCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

function normalizeResults(parsed, items) {
  const directResults = Array.isArray(parsed?.results) ? parsed.results : null;
  if (directResults?.length) return directResults;

  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed);
    if (values.length === items.length && values.every((value) => value && typeof value === 'object')) {
      return values;
    }
  }

  return [];
}

function extractGeminiError(raw, status) {
  const parsed = safeParseJson(raw);
  const message =
    parsed?.error?.message ||
    parsed?.message ||
    parsed?.error ||
    raw?.slice?.(0, 500) ||
    `Gemini request failed with status ${status}`;
  return String(message);
}

function safeParseJson(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function clampLevel(value) {
  const level = String(value ?? '').trim().toUpperCase();
  return ['B1', 'B2', 'C1', 'C2'].includes(level) ? level : null;
}

function clampText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return Math.round(numeric * 100) / 100;
}

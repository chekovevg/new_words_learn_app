export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[char]);
}

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function uniqueSorted(values, preferredOrder = []) {
  const items = [...new Set(values.filter(Boolean))];
  return items.sort((a, b) => {
    const ai = preferredOrder.indexOf(a);
    const bi = preferredOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      if (ai !== bi) return ai - bi;
    }
    return a.localeCompare(b, 'en', { sensitivity: 'base' });
  });
}

export function makeWordKey(word, language) {
  return `${normalizeText(word)}|${normalizeText(language || 'English')}`;
}

export function clampString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

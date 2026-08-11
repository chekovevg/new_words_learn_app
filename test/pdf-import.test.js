import assert from 'node:assert/strict';
import test from 'node:test';

function createSinglePagePdf(text) {
  const stream = `BT\n/F1 18 Tf\n36 100 Td\n(${text}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

test('pdf import dependency loads the legacy entrypoint and extracts page text', async () => {
  // import-parser loads its worker with Vite's `?url` transform. Node imports
  // that specifier as the worker module instead of returning an asset URL, so
  // this test covers PDF.js extraction while the production worker path is
  // exercised by the Vite build.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({ data: createSinglePagePdf('apple') });
  const document = await loadingTask.promise;

  try {
    const page = await document.getPage(1);
    const text = await page.getTextContent();
    assert.equal(document.numPages, 1);
    assert.match(text.items.map((item) => item.str).join(' '), /apple/);
  } finally {
    await loadingTask.destroy();
  }
});

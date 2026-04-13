/**
 * Extract plain text from a PDF buffer (best effort; scanned PDFs need OCR elsewhere).
 */
export async function extractPdfText(buffer) {
  const mod = await import('pdf-parse');
  const pdfParse = mod.default;
  const data = await pdfParse(buffer);
  return {
    text: String(data?.text || ''),
    numpages: data?.numpages || 0
  };
}

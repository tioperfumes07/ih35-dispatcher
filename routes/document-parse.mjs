import { Router } from 'express';
import multer from 'multer';
import { extractPdfText } from '../lib/pdf-text.mjs';
import { parseRateConfirmationText, parseExpenseInvoiceText } from '../lib/parse-document-text.mjs';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const router = Router();

router.post('/parse-rate-confirmation', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: 'Upload a PDF (form field name: pdf)' });
    }
    const { text, numpages } = await extractPdfText(req.file.buffer);
    const parsed = parseRateConfirmationText(text);
    const debug = String(req.query?.debug || '') === '1';
    res.json({
      ok: true,
      numpages,
      parsed,
      ...(debug ? { textPreview: text.slice(0, 2000) } : { textPreviewLength: text.length })
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

router.post('/parse-expense-invoice', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: 'Upload a PDF (form field name: pdf)' });
    }
    const { text, numpages } = await extractPdfText(req.file.buffer);
    const parsed = parseExpenseInvoiceText(text);
    const debug = String(req.query?.debug || '') === '1';
    res.json({
      ok: true,
      numpages,
      parsed,
      ...(debug ? { textPreview: text.slice(0, 2000) } : { textPreviewLength: text.length })
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

export default router;

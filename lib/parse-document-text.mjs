function parseMoney(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Pull likely US address lines (city, ST ZIP). */
function extractAddressLines(text, max = 4) {
  const lines = String(text)
    .split(/\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const zipRe = /\b([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\b/;
  const out = [];
  for (const line of lines) {
    if (zipRe.test(line) && line.length > 12 && line.length < 220) {
      out.push(line.replace(/\s+/g, ' '));
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Heuristic extraction from rate confirmation / load tender PDF text.
 * Scanned PDFs without a text layer will return mostly empty — use OCR upstream if needed.
 */
export function parseRateConfirmationText(raw) {
  const text = String(raw || '');
  const single = text.replace(/\s+/g, ' ');
  const hints = [];

  let loadNumber = null;
  const loadPatterns = [
    /\b(?:Load|Order|Shipment|Pro|Reference|Ref)\s*#?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,})\b/i,
    /\b(?:BOL|PO)\s*#?\s*:?\s*([A-Z0-9][A-Z0-9\-]{3,})\b/i
  ];
  for (const re of loadPatterns) {
    const m = single.match(re);
    if (m) {
      loadNumber = m[1].trim();
      hints.push('load_number_pattern');
      break;
    }
  }

  let revenue = null;
  const moneyPatterns = [
    /(?:Total\s*(?:rate|pay|amount)|Line\s*haul|Carrier\s*pay|Rate)\s*:?\s*\$?\s*([\d,]+\.\d{2})\b/i,
    /\$\s*([\d,]+\.\d{2})\s*(?:total|USD)?/i,
    /\b(?:\$|USD)\s*([\d,]+\.\d{2})\b/
  ];
  for (const re of moneyPatterns) {
    const m = single.match(re);
    if (m) {
      revenue = parseMoney(m[1]);
      if (revenue != null) {
        hints.push('revenue_pattern');
        break;
      }
    }
  }

  let milesLoaded = null;
  let milesEmpty = null;
  const ml = single.match(
    /\b([\d,]+)\s*(?:loaded|load)\s*miles?\b/i
  );
  if (ml) {
    milesLoaded = parseMoney(ml[1]);
    hints.push('miles_loaded');
  }
  const me = single.match(/\b([\d,]+)\s*(?:empty|deadhead|dh)\s*miles?\b/i);
  if (me) {
    milesEmpty = parseMoney(me[1]);
    hints.push('miles_empty');
  }
  const totalM = single.match(/\b([\d,]{2,4})\s*total\s*miles?\b/i);
  if (totalM && milesLoaded == null) {
    milesLoaded = parseMoney(totalM[1]);
    hints.push('miles_total');
  }

  const isoDate = single.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  let startDate = null;
  let endDate = null;
  if (isoDate) {
    startDate = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
    hints.push('iso_date');
  }
  const mdY = single.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (mdY && !startDate) {
    const mm = mdY[1].padStart(2, '0');
    const dd = mdY[2].padStart(2, '0');
    startDate = `${mdY[3]}-${mm}-${dd}`;
    hints.push('mdy_date');
  }

  const addrs = extractAddressLines(text, 4);
  const pickupAddress = addrs[0] || null;
  const deliveryAddress = addrs[1] || addrs[2] || null;

  let brokerOrCustomer = null;
  const bro = single.match(
    /(?:Broker|Shipper|Customer|Bill\s*to)\s*:?\s*([A-Za-z0-9 &\.\-]{4,80})/i
  );
  if (bro) {
    brokerOrCustomer = bro[1].trim();
    hints.push('broker_line');
  }

  return {
    loadNumber,
    revenue,
    milesLoaded,
    milesEmpty,
    pickupAddress,
    deliveryAddress,
    brokerOrCustomer,
    startDate,
    endDate,
    hints,
    textLength: text.length
  };
}

/**
 * Heuristic extraction from vendor repair / expense invoice PDF text.
 */
export function parseExpenseInvoiceText(raw) {
  const text = String(raw || '');
  const single = text.replace(/\s+/g, ' ');
  const hints = [];

  let invoiceNumber = null;
  const inv = single.match(/\b(?:Invoice|Inv\.?|Document)\s*#?\s*:?\s*([A-Z0-9\-]{4,})\b/i);
  if (inv) {
    invoiceNumber = inv[1];
    hints.push('invoice_no');
  }

  let txnDate = null;
  const d1 = single.match(/\b(?:Invoice\s*date|Date)\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]20\d{2})\b/i);
  if (d1) {
    const p = d1[1].split(/[\/\-]/);
    if (p.length === 3) {
      txnDate = `${p[2]}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`;
      hints.push('date_mdy');
    }
  }
  const iso = single.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && !txnDate) {
    txnDate = iso[1];
    hints.push('date_iso');
  }

  let amount = null;
  const bal = single.match(
    /\b(?:Balance\s*due|Total\s*due|Amount\s*due|Grand\s*total|Total)\s*:?\s*\$?\s*([\d,]+\.\d{2})\b/i
  );
  if (bal) {
    amount = parseMoney(bal[1]);
    hints.push('amount_total');
  }

  let vendorGuess = null;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length) {
    vendorGuess = lines[0].slice(0, 120);
    hints.push('vendor_line1');
  }

  let unitGuess = null;
  const unit = single.match(/\b(?:Truck|Unit|Tractor|Equipment)\s*#?\s*:?\s*((?:T|TR|U)[\dA-Za-z\-]{2,})\b/i);
  if (unit) {
    unitGuess = unit[1];
    hints.push('unit_pattern');
  }

  return {
    invoiceNumber,
    txnDate,
    amount,
    vendorGuess,
    unitGuess,
    hints,
    textLength: text.length
  };
}

/**
 * QuickBooks vendor/customer duplicate detection (rules 1–8, confidence HIGH/MEDIUM).
 */

const PUNCT_RE = /[.,'"\-_&/]/g;

const ABBREV_MAP = new Map(
  Object.entries({
    incorporated: 'inc',
    incorporation: 'inc',
    'l.l.c.': 'llc',
    'limited liability company': 'llc',
    'limited liability': 'llc',
    corporation: 'corp',
    corp: 'corp',
    company: 'co',
    brothers: 'bros',
    international: 'intl',
    manufacturing: 'mfg',
    distributor: 'dist',
    distribution: 'dist',
    service: 'svc',
    services: 'svc',
    management: 'mgmt',
    associates: 'assoc',
    association: 'assoc',
    department: 'dept',
    national: 'natl'
  })
);

function normWs(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function stripPunctuation(s) {
  return normWs(String(s || '').replace(PUNCT_RE, ' ')).replace(/\s+/g, ' ');
}

function tokenizeAbbrev(s) {
  let t = stripPunctuation(s);
  for (const [phrase, rep] of ABBREV_MAP) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    t = t.replace(re, ` ${rep} `);
  }
  return normWs(t.replace(/\s+/g, ' '));
}

export function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const v0 = new Array(t.length + 1);
  const v1 = new Array(t.length + 1);
  for (let i = 0; i <= t.length; i++) v0[i] = i;
  for (let i = 0; i < s.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < t.length; j++) {
      const cost = s[i] === t[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= t.length; j++) v0[j] = v1[j];
  }
  return v0[t.length];
}

function nameSimilarityRatio(a, b) {
  const A = stripPunctuation(a);
  const B = stripPunctuation(b);
  if (!A.length && !B.length) return 1;
  const mx = Math.max(A.length, B.length, 1);
  const d = levenshtein(A, B);
  return 1 - d / mx;
}

function digitsPhone(s) {
  return String(s || '').replace(/\D/g, '');
}

function emailDomain(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.indexOf('@');
  if (at < 1) return '';
  return e.slice(at + 1).trim();
}

function streetKey(addr) {
  if (!addr || typeof addr !== 'object') return '';
  const line1 = String(addr.Line1 || addr.line1 || '').trim().toLowerCase();
  const city = String(addr.City || addr.city || '').trim().toLowerCase();
  const zip = String(addr.PostalCode || addr.postalCode || '').trim().toLowerCase();
  if (!line1) return '';
  return `${line1}|${city}|${zip}`;
}

/** Map raw QBO Vendor / Customer to a lean record used by UI + detection. */
export function mapQboVendorRow(v) {
  const addr = v.BillAddr || {};
  return {
    qboId: String(v.Id || ''),
    name: String(v.DisplayName || '').trim(),
    companyName: String(v.CompanyName || '').trim(),
    phone: String(v.PrimaryPhone?.FreeFormNumber || '').trim(),
    email: String(v.PrimaryEmailAddr?.Address || '').trim(),
    balance: Number(v.Balance) || 0,
    active: v.Active !== false,
    created: v.MetaData?.CreateTime || '',
    updated: v.MetaData?.LastUpdatedTime || '',
    billAddr: addr,
    streetKey: streetKey(addr),
    terms: v.TermRef?.name || '',
    web: v.WebAddr?.URI || ''
  };
}

export function mapQboCustomerRow(c) {
  const addr = c.BillAddr || c.ShipAddr || {};
  return {
    qboId: String(c.Id || ''),
    name: String(c.DisplayName || '').trim(),
    companyName: String(c.CompanyName || '').trim(),
    phone: String(c.PrimaryPhone?.FreeFormNumber || '').trim(),
    email: String(c.PrimaryEmailAddr?.Address || '').trim(),
    balance: Number(c.Balance) || 0,
    active: c.Active !== false,
    created: c.MetaData?.CreateTime || '',
    updated: c.MetaData?.LastUpdatedTime || '',
    billAddr: addr,
    streetKey: streetKey(addr),
    terms: c.SalesTermRef?.name || '',
    web: c.WebAddr?.URI || ''
  };
}

function displayNameForMatch(r) {
  const n = normWs(r.name);
  const c = normWs(r.companyName);
  if (n && c && n !== c) return `${n} ${c}`;
  return n || c || '';
}

/**
 * Evaluate best matching rule between two records.
 * @returns {{ confidence: 'HIGH'|'MEDIUM', matchedBy: string, score: number } | null}
 */
export function matchPair(recordType, a, b) {
  const na = displayNameForMatch(a);
  const nb = displayNameForMatch(b);
  if (!na || !nb) return null;

  const candidates = [];

  if (na === nb) {
    candidates.push({ confidence: 'HIGH', matchedBy: 'Exact name match (case insensitive)', score: 95 });
  }

  const sa = stripPunctuation(na);
  const sb = stripPunctuation(nb);
  if (sa && sb && sa === sb) {
    candidates.push({
      confidence: 'HIGH',
      matchedBy: 'Same name after removing punctuation',
      score: 90
    });
  }

  const aa = tokenizeAbbrev(na);
  const ab = tokenizeAbbrev(nb);
  if (aa && ab && aa === ab) {
    candidates.push({
      confidence: 'HIGH',
      matchedBy: 'Name match after normalizing common abbreviations',
      score: 85
    });
  }

  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length >= 5 && long.includes(short)) {
    candidates.push({
      confidence: 'MEDIUM',
      matchedBy: `One name contains the other (“${short}” in longer name)`,
      score: 70
    });
  }

  if (Math.abs(na.length - nb.length) <= 8) {
    const d = levenshtein(na, nb);
    if (d <= 2) {
      candidates.push({
        confidence: 'HIGH',
        matchedBy: `Similar name (edit distance ${d})`,
        score: d <= 1 ? 92 : 88
      });
    } else if (d <= 4) {
      candidates.push({
        confidence: 'MEDIUM',
        matchedBy: `Similar name (edit distance ${d})`,
        score: 72
      });
    }
  }

  const pa = digitsPhone(a.phone);
  const pb = digitsPhone(b.phone);
  if (pa.length >= 10 && pa === pb) {
    candidates.push({ confidence: 'HIGH', matchedBy: 'Same phone number', score: 90 });
  }

  const da = emailDomain(a.email);
  const db = emailDomain(b.email);
  if (da && db && da === db) {
    const sim = nameSimilarityRatio(na, nb);
    if (sim > 0.5) {
      candidates.push({
        confidence: 'MEDIUM',
        matchedBy: `Same email domain (@${da}) with similar names (${Math.round(sim * 100)}% match)`,
        score: 65
      });
    }
  }

  const sta = a.streetKey || '';
  const stb = b.streetKey || '';
  if (sta && stb && sta === stb) {
    candidates.push({ confidence: 'HIGH', matchedBy: 'Same billing street address', score: 85 });
  }

  if (!candidates.length) return null;
  candidates.sort((x, y) => y.score - x.score);
  const best = candidates[0];
  if (best.confidence === 'MEDIUM' && best.score < 50) return null;
  if (best.confidence === 'HIGH' && best.score < 75) return null;
  return best;
}

function groupSignature(ids) {
  return [...new Set(ids.map(String))].sort().join('|');
}

/**
 * Union-find for clustering duplicate pairs.
 */
class UnionFind {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i) {
    if (this.p[i] === i) return i;
    this.p[i] = this.find(this.p[i]);
    return this.p[i];
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[rb] = ra;
  }
}

/**
 * @param {Array<object>} records — mapped vendor/customer rows
 * @param {'vendor'|'customer'} recordType
 * @param {Set<string>} skippedSignatures — canonical group keys to exclude
 */
export function buildDuplicateGroups(records, recordType, skippedSignatures = new Set()) {
  const list = (records || []).filter(r => r && r.qboId && r.active !== false);
  const n = list.length;
  const uf = new UnionFind(n);
  const pairBest = new Map();

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const m = matchPair(recordType, list[i], list[j]);
      if (!m) continue;
      const key = `${i}:${j}`;
      pairBest.set(key, m);
      uf.union(i, j);
    }
  }

  const clusters = new Map();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r).push(i);
  }

  const duplicateGroups = [];
  for (const idxs of clusters.values()) {
    if (idxs.length < 2) continue;
    const ids = idxs.map(i => list[i].qboId);
    const sig = groupSignature(ids);
    if (skippedSignatures.has(sig)) continue;

    let bestConf = 'MEDIUM';
    let bestScore = 0;
    let bestRule = '';
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const i = idxs[a];
        const j = idxs[b];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        const m = pairBest.get(key);
        if (!m) continue;
        if (m.score > bestScore) {
          bestScore = m.score;
          bestRule = m.matchedBy;
          bestConf = m.confidence;
        }
      }
    }
    if (!bestRule) continue;
    const recordsOut = idxs.map(i => list[i]).sort((a, b) => a.name.localeCompare(b.name));
    duplicateGroups.push({
      confidence: bestConf,
      matchedBy: bestRule,
      score: bestScore,
      groupSignature: sig,
      records: recordsOut
    });
  }

  duplicateGroups.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === 'HIGH' ? -1 : 1;
    return b.score - a.score;
  });

  const highConfidenceCount = duplicateGroups.filter(g => g.confidence === 'HIGH').length;
  const mediumConfidenceCount = duplicateGroups.filter(g => g.confidence === 'MEDIUM').length;

  return { duplicateGroups, highConfidenceCount, mediumConfidenceCount };
}

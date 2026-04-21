const ABBREV = /\b(inc|llc|l\.l\.c|corp|corporation|ltd|co\.|company|lp|llp|pllc|pc)\b\.?/gi;

export function stripPunctuation(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAbbreviations(s) {
  let t = stripPunctuation(s);
  t = t.replace(ABBREV, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

export function normalizePhone(s) {
  return (s || '').replace(/\D/g, '');
}

export function emailDomain(email) {
  const e = (email || '').trim().toLowerCase();
  const i = e.indexOf('@');
  if (i < 0) return '';
  return e.slice(i + 1);
}

export function normalizeAddress(s) {
  return stripPunctuation(s);
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * @typedef {{ id: string; name: string; phone?: string; email?: string; address?: string }} Party
 * @returns {{ confidencePct: number, band: 'HIGH'|'MEDIUM'|'LOW', rules: string[] }}
 */
export function scoreDuplicatePair(a, b) {
  const rules = [];
  let score = 0;

  const n1 = (a.name || '').trim();
  const n2 = (b.name || '').trim();
  const low1 = n1.toLowerCase();
  const low2 = n2.toLowerCase();

  if (low1 && low1 === low2) {
    rules.push('exact_name');
    score = Math.max(score, 42);
  }

  const p1 = stripPunctuation(n1);
  const p2 = stripPunctuation(n2);
  if (p1 && p1 === p2 && !rules.includes('exact_name')) {
    rules.push('punctuation_stripped');
    score = Math.max(score, 38);
  }

  const a1 = normalizeAbbreviations(n1);
  const a2 = normalizeAbbreviations(n2);
  if (a1 && a1 === a2) {
    if (!rules.includes('exact_name') && !rules.includes('punctuation_stripped')) {
      rules.push('abbreviations_normalized');
    }
    score = Math.max(score, 36);
  }

  const L1 = low1.length ? low1 : p1;
  const L2 = low2.length ? low2 : p2;
  let contains = false;
  if (L1 && L2 && (L1.includes(L2) || L2.includes(L1)) && L1 !== L2) contains = true;
  if (!contains) {
    const shorter = p1.length <= p2.length ? p1 : p2;
    const longer = p1.length <= p2.length ? p2 : p1;
    if (shorter.length >= 4 && longer.includes(shorter) && shorter !== longer) contains = true;
  }
  if (contains) {
    rules.push('contains_match');
    score += 22;
  }

  const dist = levenshtein(a1 || p1, a2 || p2);
  if (dist <= 4 && (a1 || p1).length > 0) {
    rules.push('edit_distance_le_4');
    score += Math.max(18, 26 - dist * 2);
  }

  const ph1 = normalizePhone(a.phone);
  const ph2 = normalizePhone(b.phone);
  if (ph1.length >= 10 && ph1 === ph2) {
    rules.push('same_phone');
    score += 28;
  }

  const d1 = emailDomain(a.email);
  const d2 = emailDomain(b.email);
  if (d1 && d2 && d1 === d2) {
    rules.push('same_email_domain');
    score += 16;
  }

  const addr1 = normalizeAddress(a.address);
  const addr2 = normalizeAddress(b.address);
  if (addr1.length > 12 && addr2.length > 12 && addr1 === addr2) {
    rules.push('same_address');
    score += 26;
  }

  const confidencePct = Math.min(100, Math.round(score));
  let band = 'LOW';
  if (confidencePct >= 75) band = 'HIGH';
  else if (confidencePct >= 50) band = 'MEDIUM';

  return { confidencePct, band, rules: [...new Set(rules)] };
}

export function pairKey(idA, idB) {
  return [idA, idB].sort().join('::');
}

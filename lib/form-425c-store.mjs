/**
 * Persistent profiles for Official Form 425C (two debtors, QBO bank account mapping).
 * File: data/form-425c-profiles.json (created on first save if missing).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'form-425c-profiles.json');

export const FORM_425C_DEFAULT_PROFILES = {
  version: 1,
  companies: [
    {
      id: 'ih35-transportation',
      displayName: 'IH 35 Transportation LLC',
      debtorName: 'IH 35 Transportation LLC',
      caseNumber: '',
      courtDistrict: '',
      courtDivision: '',
      naicsCode: '',
      lineOfBusiness: 'General freight trucking, long-distance',
      responsiblePartyName: '',
      /** QBO Account Ids (Chart of Accounts → Bank) for Wells Fargo DIP / operating accounts */
      bankAccountQboIds: [],
      bankAccountLabels: [],
      /** When true, deposit lines without a LinkedTxn are included in Exhibit C (review manually). */
      includeUnclassifiedDepositLines: false,
      /** When false, deposit lines linked to JournalEntry are excluded (common for internal entries). */
      includeJournalEntryDepositLines: false
    },
    {
      id: 'ih35-trucking',
      displayName: 'IH 35 Trucking LLC',
      debtorName: 'IH 35 Trucking LLC',
      caseNumber: '',
      courtDistrict: '',
      courtDivision: '',
      naicsCode: '',
      lineOfBusiness: 'General freight trucking, long-distance',
      responsiblePartyName: '',
      bankAccountQboIds: [],
      bankAccountLabels: [],
      includeUnclassifiedDepositLines: false,
      includeJournalEntryDepositLines: false
    }
  ]
};

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

export function readForm425cProfiles() {
  ensureDir();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.companies)) throw new Error('invalid shape');
    return data;
  } catch {
    return JSON.parse(JSON.stringify(FORM_425C_DEFAULT_PROFILES));
  }
}

export function writeForm425cProfiles(body) {
  ensureDir();
  if (!body || typeof body !== 'object' || !Array.isArray(body.companies)) {
    throw new Error('Body must be an object with companies[]');
  }
  const merged = {
    version: Number(body.version) || 1,
    companies: body.companies.map((c) => ({
      id: String(c.id || '').trim() || `company-${Math.random().toString(36).slice(2, 9)}`,
      displayName: String(c.displayName || '').trim(),
      debtorName: String(c.debtorName || '').trim(),
      caseNumber: String(c.caseNumber || '').trim(),
      courtDistrict: String(c.courtDistrict || '').trim(),
      courtDivision: String(c.courtDivision || '').trim(),
      naicsCode: String(c.naicsCode || '').trim(),
      lineOfBusiness: String(c.lineOfBusiness || '').trim(),
      responsiblePartyName: String(c.responsiblePartyName || '').trim(),
      bankAccountQboIds: Array.isArray(c.bankAccountQboIds) ? c.bankAccountQboIds.map((x) => String(x).trim()).filter(Boolean) : [],
      bankAccountLabels: Array.isArray(c.bankAccountLabels) ? c.bankAccountLabels.map((x) => String(x)) : [],
      includeUnclassifiedDepositLines: !!c.includeUnclassifiedDepositLines,
      includeJournalEntryDepositLines: !!c.includeJournalEntryDepositLines
    }))
  };
  fs.writeFileSync(STORE_PATH, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

export function getCompanyProfile(profiles, companyId) {
  const id = String(companyId || '').trim();
  return (profiles.companies || []).find((c) => c.id === id) || null;
}

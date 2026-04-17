#!/usr/bin/env node
/**
 * Builds a Word-openable RTF progress report from docs/ERP_MASTER_REDESIGN_STATUS.md
 * Run on a schedule (e.g. hourly): 0 * * * * cd /path/to/repo && node scripts/generate-erp-progress-report.mjs
 * Output: docs/reports/ERP_MASTER_REDESIGN_PROGRESS_latest.rtf
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const statusPath = path.join(root, 'docs', 'ERP_MASTER_REDESIGN_STATUS.md');
const outDir = path.join(root, 'docs', 'reports');
const outPath = path.join(outDir, 'ERP_MASTER_REDESIGN_PROGRESS_latest.rtf');

function rtfEscape(s) {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\par ');
}

function main() {
  const raw = fs.readFileSync(statusPath, 'utf8');
  const lines = raw.split('\n');

  const headline =
    lines.find(l => l.includes('**Overall completion:') && l.includes('%')) || 'Overall completion: (see STATUS.md)';
  const rolling =
    lines.find(l => l.includes('**Rolling average') && l.includes('fractions')) || '';

  const changelog = [];
  for (const line of lines) {
    if (/^\d{1,3}\.\s+\*\*/.test(line.trim())) changelog.push(line.trim());
  }
  const tail = changelog.slice(-12);

  const policy =
    'Autonomous redesign policy (this repo): Loads & dispatch board (dispatch.html) is LOWEST PRIORITY until other checklist work is further along; skip dispatch-only UI passes unless explicitly doing end-of-list cleanup. Progress % and changelog are sourced from ERP_MASTER_REDESIGN_STATUS.md.';

  const now = new Date().toISOString();

  const body = [
    `IH35 ERP — Master redesign progress report`,
    `Generated (UTC): ${now}`,
    '',
    '--- Summary ---',
    headline.replace(/\*\*/g, ''),
    rolling.replace(/\*\*/g, ''),
    '',
    '--- Policy ---',
    policy,
    '',
    '--- Recent changelog (last up to 12 numbered entries) ---',
    ...tail.map(s => s.replace(/\*\*/g, '')),
    '',
    '--- Files ---',
    `Source: docs/ERP_MASTER_REDESIGN_STATUS.md`,
    `Consolidated report: docs/ERP_MASTER_REDESIGN_FINAL_REPORT.md`,
    '',
    'Open this .rtf in Microsoft Word. To keep .docx, use File → Save As → Word Document (.docx).',
  ]
    .map(rtfEscape)
    .join('\\par ');

  const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Calibri;}{\\f1\\fnil Courier New;}}\\f0\\fs22 ${body}\\par}`;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, rtf, 'utf8');
  console.log('Wrote', path.relative(root, outPath));
}

main();

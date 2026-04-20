/**
 * Agent B Rule 0 — forbidden substrings in `app-theme.css`, `maint-accounting-ui-2026.css`, `maintenance.html`.
 * Imported by `system-smoke.mjs` (HTTP guard) and `rule-zero-agent-b-check.mjs` (offline read).
 * At load time, `RULE0_FORBIDDEN_SUBSTRINGS` is validated (non-empty strings, no duplicates).
 */
export const RULE0_FORBIDDEN_SUBSTRINGS = [
  'var(--color-border, var(--line))',
  'var(--color-border,var(--line))',
  'var(--color-bg-card, var(--panel))',
  'var(--color-bg-card,var(--panel))',
  'var(--color-bg-card, var(--bg-elevated))',
  'var(--color-bg-card,var(--bg-elevated))',
  'var(--color-bg-page, var(--bg))',
  'var(--color-bg-page,var(--bg))',
  'var(--color-text-label, var(--muted))',
  'var(--color-text-label,var(--muted))',
  'var(--color-text-body, var(--text))',
  'var(--color-text-body,var(--text))',
  'var(--color-text-primary, var(--text))',
  'var(--color-text-primary,var(--text))',
  'var(--color-text-body, var(--text-secondary))',
  'var(--color-text-body,var(--text-secondary))',
  'var(--color-border-focus, var(--accent))',
  'var(--color-border-focus,var(--accent))',
  'var(--color-app-frame-border, var(--app-frame-border))',
  'var(--color-app-frame-border,var(--app-frame-border))',
  'var(--color-nav-bg, var(--sidebar-bg))',
  'var(--color-nav-bg,var(--sidebar-bg))',
  'var(--color-nav-bg, #',
  'var(--color-nav-bg,#',
  'var(--color-bg-header, #',
  'var(--color-bg-header,#',
  'var(--color-bg-hover, #',
  'var(--color-bg-hover,#',
  'var(--color-modal-backdrop, rgba',
  'var(--color-modal-backdrop,rgba',
  'var(--color-semantic-success, #',
  'var(--color-semantic-success,#',
  'var(--color-semantic-error, #',
  'var(--color-semantic-error,#',
  'var(--color-semantic-warning, #',
  'var(--color-semantic-warning,#',
  'var(--color-semantic-warn-accent, #',
  'var(--color-semantic-warn-accent,#',
  'var(--color-success-border-soft, #',
  'var(--color-success-border-soft,#',
  'var(--color-warning-border-soft, #',
  'var(--color-warning-border-soft,#',
  'var(--color-hub-accent, #',
  'var(--color-hub-accent,#',
  'var(--color-hub-bg-deep, #',
  'var(--color-hub-bg-deep,#',
  'var(--color-hub-text, #',
  'var(--color-hub-text,#',
  'var(--color-hub-card, #',
  'var(--color-hub-card,#',
  'var(--color-bg-page, #',
  'var(--color-bg-page,#',
  'var(--color-bg-card, #',
  'var(--color-bg-card,#',
  'var(--color-text-primary, #',
  'var(--color-text-primary,#',
  'var(--color-text-body, #',
  'var(--color-text-body,#',
  'var(--color-text-label, #',
  'var(--color-text-label,#'
];

(function assertRule0ListIntegrity() {
  const seen = new Map();
  for (let i = 0; i < RULE0_FORBIDDEN_SUBSTRINGS.length; i++) {
    const s = RULE0_FORBIDDEN_SUBSTRINGS[i];
    if (typeof s !== 'string' || s.length === 0) {
      throw new Error(`rule-zero-agent-b.mjs: RULE0_FORBIDDEN_SUBSTRINGS[${i}] must be a non-empty string`);
    }
    if (seen.has(s)) {
      throw new Error(
        `rule-zero-agent-b.mjs: duplicate RULE0_FORBIDDEN_SUBSTRINGS at index ${i}: ${JSON.stringify(s)}`
      );
    }
    seen.set(s, i);
  }
})();

export function ruleZeroForbiddenHits(text) {
  return RULE0_FORBIDDEN_SUBSTRINGS.filter(s => text.includes(s));
}

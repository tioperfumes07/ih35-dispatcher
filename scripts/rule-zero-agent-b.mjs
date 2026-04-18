/**
 * Agent B Rule 0 — forbidden substrings in `app-theme.css`, `maint-accounting-ui-2026.css`, `maintenance.html`.
 * Imported by `system-smoke.mjs` (HTTP guard) and `rule-zero-agent-b-check.mjs` (offline read).
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
  'var(--color-bg-header, #',
  'var(--color-bg-hover, #',
  'var(--color-modal-backdrop, rgba'
];

export function ruleZeroForbiddenHits(text) {
  return RULE0_FORBIDDEN_SUBSTRINGS.filter(s => text.includes(s));
}

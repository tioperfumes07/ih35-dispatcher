// IH35 TMS — Design Tokens (TypeScript)
// Locked design system — do NOT modify token values without spec approval.
// Mirror of public/src/design-tokens.css for use in React components.
// Generated 2026-05-01 per IH35_HANDOFF_SPEC.md §1

export const ihTokens = {
  // === COLORS ===
  colors: {
    navy: '#1a1f36',
    navyActive: '#2a3050',
    navyBorder: '#2a2f46',
    green: '#1a7a3c',
    blue: '#1557a0',
    red: '#c5221f',
    gold: '#b07d00',

    pillActiveBg: '#c0dd97',
    pillActiveText: '#173404',
    pillWarnBg: '#fef8e0',
    pillWarnText: '#b07d00',
    pillErrorBg: '#f7c1c1',
    pillErrorText: '#501313',
    pillInfoBg: '#cfe2f3',
    pillInfoText: '#1557a0',

    readonlyComputedBg: '#eaf3de',
    readonlyComputedBorder: '#97c459',
    readonlyPulledBg: '#f0f7ff',
    readonlyPulledBorder: '#cfdcef',

    sectionABg: '#f5e8c8',
    sectionAText: '#6b4f00',
    sectionABorder: '#b07d00',
    sectionATableBorder: '#d4c89a',
    sectionARowBg: '#faf3df',

    sectionBBg: '#d8e8d8',
    sectionBText: '#173404',
    sectionBBorder: '#1a7a3c',
    sectionBTableBorder: '#97c459',
    sectionBRowBg: '#f0f7e8',

    partsPanelBg: '#fffcf0',
    partsPanelBorder: '#d4c89a',
    partsPanelHeaderText: '#b07d00',
    partsPanelTableHeadBg: '#f0e8d0',

    rowSelectedBg: '#e6f1fb',
    rowSelectedBorder: '#1557a0',

    bgSurface: '#f5f5f0',
    bgCard: '#ffffff',
    bgSectionHeader: '#f0f0e8',
    bgInputFaded: '#fafafa',
    textPrimary: '#1a1f36',
    textSecondary: '#555555',
    textMuted: '#888888',
    textLabel: '#666666',
    borderLight: '#d0d0c8',
    borderDivider: '#e0e0d8',
  },

  // === FONT SIZES ===
  font: {
    content: '9px',
    label: '8px',
    pill: '7px',
    kpi: '13px',
    title: '10px',
    button: '9px',
  },

  // === HEIGHTS ===
  height: {
    field: '17px',
    button: '22px',
    topbar: '22px',
    banner: '22px',
    savebar: '28px',
    sidebarWidth: '72px',
    sidebarStrip: '2px',
    sidebarIcon: '12px',
  },

  // === SPACING ===
  spacing: {
    paddingCell: '4px 6px',
    gapGrid: '6px',
    gapFormRow: '4px',
    radius: '2px',
    radiusPill: '8px',
    borderWidth: '0.5px',
  },

  // === LETTER SPACING ===
  letter: {
    label: '0.4px',
    pill: '0.3px',
  },

  // === DRIVER APP (mobile, dark theme) ===
  driver: {
    bg: '#0f1219',
    card: '#1a1f2c',
    text: '#e6e6e6',
    textMuted: '#888888',
    tapMin: '44px',
    width: '360px',
  },

  // === ANIMATION ===
  anim: {
    sidebar: '150ms',
    modal: '200ms',
  },
} as const;

export type IhTokens = typeof ihTokens;

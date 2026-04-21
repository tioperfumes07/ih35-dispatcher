/**
 * Shared modal chrome: Maximize, browser Full screen, and layout “full viewport”
 * (CSS fixed 100vw×100vh, no DOM teardown — preserves form state and scroll).
 * Delegated clicks: [data-erp-modal-max-btn], [data-erp-modal-fs-btn], [data-erp-modal-expand-btn].
 */
(function () {
  'use strict';

  const LAYOUT_FULLSCREEN_CLASS = 'erp-modal-chrome--layout-fullscreen';
  const CHROME_SHELL_SELECTOR = '.modal, .nm-modal, .vbp-modal, .erp-dedupe-modal__card';

  /** Shells that support layout expand (most specific first for closest()). */
  const EXPAND_SHELL_SELECTORS = [
    '.maint-workorder-fullmodal__shell',
    '.erp-dedicated-form-modal__shell',
    '.erp-mb-modal__dialog',
    '.maint-modal.erp-qb-dialog',
    '.erp-drawer',
    '.erp-dedupe-modal__card',
    '.vbp-modal',
    '.nm-modal',
    '.modal'
  ];

  function resolveShell(from) {
    if (!from || typeof from.closest !== 'function') return null;
    return from.closest(CHROME_SHELL_SELECTOR);
  }

  function resolveExpandShell(from) {
    if (!from || typeof from.closest !== 'function') return null;
    for (let i = 0; i < EXPAND_SHELL_SELECTORS.length; i++) {
      const el = from.closest(EXPAND_SHELL_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function syncFsBtn(btn, on) {
    if (!btn) return;
    btn.textContent = on ? 'Exit full screen' : 'Full screen';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function syncMaxBtn(btn, on) {
    if (!btn) return;
    btn.textContent = on ? 'Restore' : 'Maximize';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** Layout fullscreen on = “compress” (⊡); off = expand (⛶). */
  function syncExpandBtn(btn, layoutOn) {
    if (!btn) return;
    btn.textContent = layoutOn ? '\u22a1' : '\u26f6';
    btn.setAttribute('aria-pressed', layoutOn ? 'true' : 'false');
    btn.title = layoutOn ? 'Restore default window size' : 'Expand to full viewport (layout)';
  }

  function syncExpandBtnsInShell(shell) {
    if (!shell || !shell.querySelectorAll) return;
    const on = shell.classList.contains(LAYOUT_FULLSCREEN_CLASS);
    shell.querySelectorAll('[data-erp-modal-expand-btn]').forEach(b => syncExpandBtn(b, on));
  }

  function isShellFullscreen(shell) {
    if (!shell) return false;
    const cur = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
    return cur === shell;
  }

  function resetLayoutFullscreen(shell) {
    if (!shell) return;
    shell.classList.remove(LAYOUT_FULLSCREEN_CLASS);
    syncExpandBtnsInShell(shell);
  }

  function toggleFs(btn) {
    const shell = resolveShell(btn);
    if (!shell) return;
    const doc = document;
    const cur = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement;
    const efs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen;
    const rfs = shell.requestFullscreen || shell.webkitRequestFullscreen || shell.mozRequestFullScreen;
    if (cur === shell) {
      if (efs) void efs.call(doc);
      syncFsBtn(btn, false);
      return;
    }
    resetLayoutFullscreen(shell);
    if (rfs) {
      const p = rfs.call(shell);
      if (p && typeof p.then === 'function') {
        p.then(() => syncFsBtn(btn, true)).catch(() => {});
      } else {
        syncFsBtn(btn, true);
      }
    }
  }

  function toggleMax(btn) {
    const shell = resolveShell(btn);
    if (!shell) return;
    const willMax = !shell.classList.contains('erp-modal-chrome--viewport-max');
    if (willMax) resetLayoutFullscreen(shell);
    const on = shell.classList.toggle('erp-modal-chrome--viewport-max');
    syncMaxBtn(btn, on);
  }

  function syncAllChromeBtns() {
    document.querySelectorAll('[data-erp-modal-fs-btn]').forEach(btn => {
      const shell = resolveShell(btn);
      syncFsBtn(btn, isShellFullscreen(shell));
    });
    document.querySelectorAll('[data-erp-modal-max-btn]').forEach(btn => {
      const shell = resolveShell(btn);
      if (!shell) return;
      syncMaxBtn(btn, shell.classList.contains('erp-modal-chrome--viewport-max'));
    });
    document.querySelectorAll('[data-erp-modal-expand-btn]').forEach(btn => {
      const shell = resolveExpandShell(btn);
      if (!shell) return;
      syncExpandBtn(btn, shell.classList.contains(LAYOUT_FULLSCREEN_CLASS));
    });
  }

  document.addEventListener('click', function (ev) {
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    const ex = t.closest('[data-erp-modal-expand-btn]');
    if (ex) {
      ev.preventDefault();
      const shell = resolveExpandShell(ex);
      if (!shell) return;
      shell.classList.toggle(LAYOUT_FULLSCREEN_CLASS);
      syncExpandBtnsInShell(shell);
      return;
    }
    const fs = t.closest('[data-erp-modal-fs-btn]');
    if (fs) {
      ev.preventDefault();
      toggleFs(fs);
      return;
    }
    const mx = t.closest('[data-erp-modal-max-btn]');
    if (mx) {
      ev.preventDefault();
      toggleMax(mx);
    }
  });

  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'].forEach(evName => {
    document.addEventListener(evName, syncAllChromeBtns);
  });

  function expandButtonHtml() {
    return (
      '<button type="button" class="btn secondary erp-modal-chrome__btn erp-modal-expand-btn" data-erp-modal-expand-btn ' +
      'title="Expand to full viewport (layout)" aria-pressed="false">\u26f6</button>'
    );
  }

  function toolbarHtml() {
    return (
      '<div class="erp-modal-chrome" data-erp-no-drag="1" role="toolbar" aria-label="Window size">' +
      '<button type="button" class="btn secondary erp-modal-chrome__btn" data-erp-modal-max-btn title="Use ~90% of the viewport">Maximize</button>' +
      '<button type="button" class="btn secondary erp-modal-chrome__btn" data-erp-modal-fs-btn title="Fill entire display (Esc to exit)">Full screen</button>' +
      expandButtonHtml() +
      '</div>'
    );
  }

  /** Pass a backdrop (e.g. `#modalBg`) or the shell element itself. */
  function resetModalShell(backdropOrShell) {
    if (!backdropOrShell) return;
    let shell = null;
    if (backdropOrShell.matches && backdropOrShell.matches(CHROME_SHELL_SELECTOR)) {
      shell = backdropOrShell;
    } else if (backdropOrShell.querySelector) {
      shell = backdropOrShell.querySelector(CHROME_SHELL_SELECTOR);
    }
    if (!shell) return;
    resetLayoutFullscreen(shell);
    shell.classList.remove('erp-modal-chrome--viewport-max');
    const doc = document;
    const cur = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement;
    if (cur === shell) {
      const efs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen;
      if (efs) void efs.call(doc);
    }
    shell.querySelectorAll('[data-erp-modal-max-btn]').forEach(b => syncMaxBtn(b, false));
    shell.querySelectorAll('[data-erp-modal-fs-btn]').forEach(b => syncFsBtn(b, false));
  }

  window.erpModalChromeToolbarHtml = toolbarHtml;
  window.erpModalChromeExpandButtonHtml = expandButtonHtml;
  window.erpModalChromeResetModalShell = resetModalShell;
  window.erpModalChromeResetLayoutFullscreen = resetLayoutFullscreen;
})();

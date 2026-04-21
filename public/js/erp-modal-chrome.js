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

  function erpModalChromeFindModalHeader(shell) {
    if (!shell || !shell.querySelector) return null;
    return shell.querySelector(
      '.modal-header,.maint-modal__header,.maint-modal__topbar,.erp-qb-dialog__head,' +
        '.maint-workorder-fullmodal__head,.erp-dedicated-form-modal__bar,.erp-mb-modal__head,' +
        '.nm-modal__head,.vbp-modal__head,.erp-drawer__head'
    );
  }

  function erpModalChromeFindCloseControl(header) {
    if (!header || !header.querySelector) return null;
    let btn = header.querySelector(
      '.close,[aria-label="Close"],.erp-mb-modal__x,.erp-dedicated-form-modal__x'
    );
    if (btn) return btn;
    const xs = header.querySelectorAll('button[type="button"]');
    for (let i = xs.length - 1; i >= 0; i--) {
      const b = xs[i];
      const lab = String(b.getAttribute('aria-label') || '').toLowerCase();
      const t = String(b.textContent || '').trim();
      if (lab === 'close' || t === '\u00d7' || t === '\u2715' || t === '×') return b;
    }
    return null;
  }

  /**
   * Injects a compact ⛶/⊡ control (same behavior as `[data-erp-modal-expand-btn]`) when the shell
   * has no expand button yet — preserves DOM and form state (class-based layout fullscreen).
   * @param {Element} modalEl Shell element or any descendant inside a supported chrome shell.
   */
  function addFullscreenToggle(modalEl) {
    if (!modalEl || !(modalEl instanceof Element)) return;
    const shell = resolveExpandShell(modalEl) || resolveShell(modalEl);
    if (!shell) return;
    if (shell.querySelector('[data-erp-modal-expand-btn]')) return;
    if (shell.querySelector('[data-erp-modal-fs-injected="1"]')) return;

    const header = erpModalChromeFindModalHeader(shell);
    if (!header) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-erp-modal-expand-btn', '');
    btn.setAttribute('data-erp-modal-fs-injected', '1');
    btn.setAttribute('aria-label', 'Toggle full screen');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('title', 'Expand to full viewport (layout)');
    btn.className = 'erp-modal-fs-injected';
    btn.style.cssText =
      'width:18px;height:18px;' +
      'border:0.5px solid var(--border-color,#d0d7de);' +
      'border-radius:3px;' +
      'background:transparent;' +
      'cursor:pointer;margin-right:4px;' +
      'display:inline-flex;' +
      'align-items:center;' +
      'justify-content:center;font-size:10px;padding:0;flex-shrink:0';
    btn.textContent = '\u26f6';

    const closeBtn = erpModalChromeFindCloseControl(header);
    if (closeBtn && closeBtn.parentNode) {
      closeBtn.parentNode.insertBefore(btn, closeBtn);
    } else {
      header.appendChild(btn);
    }
    syncExpandBtn(btn, shell.classList.contains(LAYOUT_FULLSCREEN_CLASS));
  }

  function erpModalChromeAttachMissingFullscreenToggles(root) {
    const r = root && root.querySelectorAll ? root : document;
    if (!r.querySelectorAll) return;
    EXPAND_SHELL_SELECTORS.forEach(sel => {
      r.querySelectorAll(sel).forEach(el => {
        try {
          addFullscreenToggle(el);
        } catch (_) {}
      });
    });
  }

  let __erpFsAttachTimer = null;
  function erpModalChromeScheduleAttachMissingToggles() {
    if (__erpFsAttachTimer) window.clearTimeout(__erpFsAttachTimer);
    __erpFsAttachTimer = window.setTimeout(() => {
      __erpFsAttachTimer = null;
      erpModalChromeAttachMissingFullscreenToggles(document);
    }, 80);
  }

  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    const mo = new MutationObserver(() => erpModalChromeScheduleAttachMissingToggles());
    mo.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden']
    });
  }
  erpModalChromeScheduleAttachMissingToggles();

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
  window.erpModalChromeAddFullscreenToggle = addFullscreenToggle;
  window.erpModalChromeAttachMissingFullscreenToggles = erpModalChromeAttachMissingFullscreenToggles;
})();

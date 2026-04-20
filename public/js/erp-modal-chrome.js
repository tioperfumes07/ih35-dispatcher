/**
 * Shared Maximize + Full screen for lightweight modal shells (dispatch, JS-built overlays).
 * Uses delegated clicks on [data-erp-modal-max-btn] and [data-erp-modal-fs-btn].
 * Maintenance QuickBooks-style dialogs keep their existing erpMaintDialogToggle* wiring.
 */
(function () {
  'use strict';

  const SHELL_SELECTOR = '.modal, .nm-modal, .vbp-modal, .erp-dedupe-modal__card';

  function resolveShell(from) {
    if (!from || typeof from.closest !== 'function') return null;
    return from.closest(SHELL_SELECTOR);
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

  function isShellFullscreen(shell) {
    if (!shell) return false;
    const cur = document.fullscreenElement || document.webkitFullscreenElement;
    return cur === shell;
  }

  function toggleFs(btn) {
    const shell = resolveShell(btn);
    if (!shell) return;
    const doc = document;
    const cur = doc.fullscreenElement || doc.webkitFullscreenElement;
    const efs = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen;
    const rfs = shell.requestFullscreen || shell.webkitRequestFullscreen || shell.mozRequestFullScreen;
    if (cur === shell) {
      if (efs) void efs.call(doc);
      syncFsBtn(btn, false);
      return;
    }
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
  }

  document.addEventListener('click', function (ev) {
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
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

  ['fullscreenchange', 'webkitfullscreenchange'].forEach(evName => {
    document.addEventListener(evName, syncAllChromeBtns);
  });

  function toolbarHtml() {
    return (
      '<div class="erp-modal-chrome" data-erp-no-drag="1" role="toolbar" aria-label="Window size">' +
      '<button type="button" class="btn secondary erp-modal-chrome__btn" data-erp-modal-max-btn title="Use ~90% of the viewport">Maximize</button>' +
      '<button type="button" class="btn secondary erp-modal-chrome__btn" data-erp-modal-fs-btn title="Fill entire display (Esc to exit)">Full screen</button>' +
      '</div>'
    );
  }

  window.erpModalChromeToolbarHtml = toolbarHtml;
})();

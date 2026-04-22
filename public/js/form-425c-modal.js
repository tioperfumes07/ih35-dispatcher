/**
 * Form 425C — modal host (plain script). Opens the same React app as /form-425c.html
 * using project erp-dedicated-form-modal markup/CSS (erp-master-spec-2026.css).
 */
(function () {
  'use strict';

  var REACT_SRC = 'https://unpkg.com/react@18/umd/react.development.js';
  var REACT_DOM_SRC = 'https://unpkg.com/react-dom@18/umd/react-dom.development.js';
  var APP_SRC = '/js/form-425c-app.js';
  var CSS_HREF = '/css/form-425c.css';

  var st = {
    host: null,
    root: null,
    escHandler: null,
    docClickHandler: null,
    appLoading: null
  };

  function ensureForm425cCss() {
    if (document.querySelector('link[href="' + CSS_HREF + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('Failed to load script: ' + src));
      };
      document.head.appendChild(s);
    });
  }

  function ensureReact() {
    if (window.React && window.ReactDOM) return Promise.resolve();
    return loadScript(REACT_SRC).then(function () {
      return loadScript(REACT_DOM_SRC);
    });
  }

  /** Hidden mount target so /js/form-425c-app.js can run its standalone createRoot line on pages without #root. */
  function ensurePhantomPageRoot() {
    var el = document.getElementById('root');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'root';
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;clip:rect(0,0,0,0);visibility:hidden;pointer-events:none';
    document.body.appendChild(el);
    return el;
  }

  function ensureForm425CAppLoaded() {
    if (window.Form425CApp) return Promise.resolve();
    if (st.appLoading) return st.appLoading;
    ensurePhantomPageRoot();
    st.appLoading = ensureReact()
      .then(function () {
        return loadScript(APP_SRC);
      })
      .then(function () {
        st.appLoading = null;
        if (!window.Form425CApp) throw new Error('Form425CApp did not load');
      })
      .catch(function (e) {
        st.appLoading = null;
        throw e;
      });
    return st.appLoading;
  }

  function buildModal() {
    var wrap = document.createElement('div');
    wrap.id = 'form425cModalHost';
    wrap.className = 'erp-dedicated-form-modal';

    var bd = document.createElement('div');
    bd.className = 'erp-dedicated-form-modal__backdrop';
    bd.setAttribute('data-f425c-close', '1');

    var shell = document.createElement('div');
    shell.className = 'erp-dedicated-form-modal__shell';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-labelledby', 'f425cModalTitle');

    var inner = document.createElement('div');
    inner.className = 'erp-dedicated-form-modal__inner';

    var bar = document.createElement('div');
    bar.className = 'erp-dedicated-form-modal__bar';

    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'erp-dedicated-form-modal__x';
    x.setAttribute('data-f425c-close', '1');
    x.title = 'Close';
    x.appendChild(document.createTextNode('\u00d7'));

    var barCenter = document.createElement('div');
    barCenter.className = 'erp-dedicated-form-modal__bar-center';
    barCenter.setAttribute('aria-live', 'polite');

    var titleCol = document.createElement('div');
    titleCol.style.cssText =
      'display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;flex:1;max-width:100%';

    var title = document.createElement('div');
    title.id = 'f425cModalTitle';
    title.className = 'erp-dedicated-form-modal__title';
    title.style.whiteSpace = 'normal';
    title.style.maxWidth = '100%';
    title.appendChild(document.createTextNode('Form 425C \u2014 Monthly Operating Report'));

    var sub = document.createElement('div');
    sub.style.cssText =
      'font-size:12px;font-weight:500;color:var(--color-text-label);line-height:1.35;max-width:100%;overflow-wrap:anywhere';

    sub.appendChild(document.createTextNode('IH 35 Trucking LLC \u00b7 IH 35 Transportation LLC'));

    titleCol.appendChild(title);
    titleCol.appendChild(sub);
    barCenter.appendChild(titleCol);

    var barActions = document.createElement('div');
    barActions.className = 'erp-dedicated-form-modal__bar-actions';

    bar.appendChild(x);
    bar.appendChild(barCenter);
    bar.appendChild(barActions);

    var body = document.createElement('div');
    body.className = 'erp-dedicated-form-modal__body';

    var mount = document.createElement('div');
    mount.id = 'form-425c-modal-root';

    body.appendChild(mount);
    inner.appendChild(bar);
    inner.appendChild(body);
    shell.appendChild(inner);
    wrap.appendChild(bd);
    wrap.appendChild(shell);
    return wrap;
  }

  function bindModalUi(host) {
    if (st.docClickHandler) return;
    st.docClickHandler = function (ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('[data-f425c-close]')) window.closeForm425C();
    };
    host.addEventListener('click', st.docClickHandler);
  }

  function bindEsc() {
    if (st.escHandler) return;
    st.escHandler = function (ev) {
      if (ev.key !== 'Escape') return;
      window.closeForm425C();
    };
    document.addEventListener('keydown', st.escHandler, true);
  }

  function unbindEsc() {
    if (!st.escHandler) return;
    document.removeEventListener('keydown', st.escHandler, true);
    st.escHandler = null;
  }

  window.closeForm425C = function () {
    unbindEsc();
    if (st.host && st.docClickHandler) {
      st.host.removeEventListener('click', st.docClickHandler);
      st.docClickHandler = null;
    }
    if (st.root) {
      try {
        st.root.unmount();
      } catch (e) {
        /* ignore */
      }
      st.root = null;
    }
    if (st.host && st.host.parentNode) st.host.parentNode.removeChild(st.host);
    st.host = null;
  };

  window.openForm425C = function () {
    ensureForm425cCss();
    if (st.host) return;

    ensureForm425CAppLoaded()
      .then(function () {
        if (st.host) return;
        var host = buildModal();
        document.body.appendChild(host);
        st.host = host;
        bindModalUi(host);
        bindEsc();

        var mount = document.getElementById('form-425c-modal-root');
        if (!mount) throw new Error('Missing #form-425c-modal-root');
        if (window.ReactDOM && typeof window.ReactDOM.createRoot === 'function') {
          st.root = window.ReactDOM.createRoot(mount);
          st.root.render(window.React.createElement(window.Form425CApp, null));
          return;
        }
        if (window.ReactDOM && typeof window.ReactDOM.render === 'function') {
          window.ReactDOM.render(window.React.createElement(window.Form425CApp, null), mount);
          st.root = {
            unmount: function () {
              try {
                window.ReactDOM.unmountComponentAtNode(mount);
              } catch (_) {
                /* ignore */
              }
            }
          };
          return;
        }
        throw new Error('Form 425C modal: ReactDOM mount API unavailable');
      })
      .catch(function (err) {
        console.error(err);
        if (window.showToast) window.showToast(err.message || String(err), 'error');
        else if (typeof window.erpNotify === 'function') window.erpNotify(err.message || String(err));
        window.closeForm425C();
      });
  };
})();

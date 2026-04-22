/**
 * Proxies fleet hub SQLite registry routes from the main IH35 server so ERP
 * (`maintenance.html`) can call `/api/assets`, `/api/drivers`, etc. on the same
 * origin while the fleet API process listens on INTEGRITY_API_PORT (8787).
 *
 * Set `IH35_FLEET_API_ORIGIN` to override the upstream base (no trailing slash).
 */
let fleetProxyConnWarned = false;

export function mountFleetRegistryProxy(app, { logError = console.error } = {}) {
  const origin = (
    process.env.IH35_FLEET_API_ORIGIN ||
    `http://127.0.0.1:${process.env.INTEGRITY_API_PORT || 8787}`
  ).replace(/\/+$/, '');

  function isFleetRegistryPath(pathOnly) {
    if (pathOnly.startsWith('/api/drivers')) return true;
    if (pathOnly.startsWith('/api/vendors-local')) return true;
    if (pathOnly === '/api/vendors/sync-qbo') return true;
    if (pathOnly.startsWith('/api/assets')) return true;
    return false;
  }

  app.use(async (req, res, next) => {
    const pathOnly = req.path.split('?')[0];
    if (!isFleetRegistryPath(pathOnly)) return next();

    const target = `${origin}${req.originalUrl || req.url}`;
    try {
      const headers = { Accept: 'application/json' };
      const ct = req.get('content-type');
      if (ct) headers['Content-Type'] = ct;
      const method = req.method || 'GET';
      const hasBody = !['GET', 'HEAD'].includes(method);
      const body = hasBody && req.body != null && typeof req.body === 'object' ? JSON.stringify(req.body) : undefined;
      const r = await fetch(target, { method, headers, body });
      const outCt = r.headers.get('content-type');
      if (outCt) res.setHeader('Content-Type', outCt);
      const text = await r.text();
      res.status(r.status).send(text);
    } catch (e) {
      const msg = String(e?.message || e);
      const refused =
        msg.includes('ECONNREFUSED') ||
        String(e?.cause?.code || e?.code || '') === 'ECONNREFUSED';
      const isProd = process.env.NODE_ENV === 'production';
      if (refused && !isProd) {
        if (!fleetProxyConnWarned) {
          fleetProxyConnWarned = true;
          console.warn(
            `[fleet-registry-proxy] No listener at ${origin} — Drivers/Assets API routes return 502 until the fleet API runs (use npm run dev, or npm run dev:fleet:api).`,
          );
        }
      } else {
        logError('fleet-registry-proxy', msg);
      }
      res.status(502).json({
        error: 'Fleet registry API unreachable',
        upstream: origin,
        detail: msg,
      });
    }
  });
}

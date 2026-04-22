import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './lib/ensure-app-database-objects.mjs';
import { getPool } from './lib/db.mjs';
import { readFullErpJson } from './lib/read-erp.mjs';
import { mountErpCoreApi } from './routes/erp-core-api.mjs';
import pdfRouter from './routes/pdf.mjs';
import tmsRoutes from './routes/tms.mjs';
import integrationsRoutes from './routes/integrations.mjs';
import { mountReportsRestApi } from './routes/reports-rest-api.mjs';
import { mountScheduledReports, startReportScheduleRunner } from './routes/scheduled-reports.mjs';
import { createForm425cRouter } from './routes/form-425c-api.mjs';
import { mountFleetRegistryProxy } from './routes/fleet-registry-proxy.mjs';
import { mountDedupeRoutes } from './routes/dedupe.mjs';
import { mountNameManagementRoutes } from './routes/name-management.mjs';
import { createMaintIntegrationDeps } from './lib/maint-server-deps.mjs';
import { initializeDatabase as initializeFleetRegistryDb } from './apps/fleet-reports-hub/server/lib/accounting-db.mjs';
import { registerCatalogRoutes as registerFleetCatalogRoutes } from './apps/fleet-reports-hub/server/lib/catalog-http.mjs';
import { registerAccountingRoutes as registerFleetAccountingRoutes } from './apps/fleet-reports-hub/server/lib/accounting-http.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_ROOT = path.join(__dirname, 'public');
const SRC_ROOT = path.join(__dirname, 'src');
const PUBLIC_CSS_PREFIX = path.join(PUBLIC_ROOT, 'css') + path.sep;
const PUBLIC_JS_PREFIX = path.join(PUBLIC_ROOT, 'js') + path.sep;

const FLEET_REPORTS_INDEX = path.join(__dirname, 'public', 'fleet-reports', 'index.html');
const BUILD_VERSION = String(
  process.env.RENDER_GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.IH35_BUILD_STAMP ||
    Date.now(),
).trim();

/** Legacy shells are static HTML files; serve with versioned local JS/CSS URLs so stale assets are busted on deploy. */
function injectBuildVersionIntoHtml(rawHtml) {
  const htmlWithVersionAttr = /<html\b[^>]*data-build-version=/i.test(rawHtml)
    ? rawHtml
    : rawHtml.replace(/<html(\b[^>]*)>/i, `<html$1 data-build-version="${BUILD_VERSION}">`);
  return htmlWithVersionAttr.replace(
    /((?:src|href)=["'])(\/[^"']+\.(?:js|css))(?:\?[^"']*)?(["'])/gi,
    `$1$2?v=${encodeURIComponent(BUILD_VERSION)}$3`,
  );
}

function setNoCacheHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

function sendVersionedPublicHtml(res, absPath) {
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    setNoCacheHeaders(res);
    res.setHeader('Surrogate-Control', 'no-store');
    res.type('html').send(injectBuildVersionIntoHtml(raw));
  } catch {
    setNoCacheHeaders(res);
    res.sendFile(absPath);
  }
}

/** Browsers often keep stale ERP shells and unhashed CSS/JS; force revalidation after deploys. */
function applyPublicStaticCacheHeaders(res, absFilePath) {
  if (typeof absFilePath !== 'string') return;
  if (absFilePath.endsWith('.html')) {
    setNoCacheHeaders(res);
    res.setHeader('Surrogate-Control', 'no-store');
    return;
  }
  if (absFilePath.startsWith(PUBLIC_CSS_PREFIX) || absFilePath.startsWith(PUBLIC_JS_PREFIX)) {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }
}

/** Avoid stale Fleet hub UI: browsers often cache `index.html` and keep old hashed `assets/*` URLs. */
function setFleetHubEntryNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function sendFleetReportsSpa(res) {
  if (fs.existsSync(FLEET_REPORTS_INDEX)) {
    setFleetHubEntryNoCache(res);
    res.sendFile(FLEET_REPORTS_INDEX, {
      etag: false,
      lastModified: false,
      cacheControl: false,
    });
    return;
  }
  res
    .status(503)
    .type('html')
    .send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Fleet hub unavailable</title></head><body style="font-family:system-ui;padding:24px">' +
        '<h1>Fleet Reports Hub is not built</h1>' +
        '<p>This deploy is missing <code>public/fleet-reports/index.html</code>. On the host, run:</p>' +
        '<pre style="background:#f4f4f5;padding:12px;border-radius:8px">npm run build:fleet</pre>' +
        '<p>Using <code>npm start</code> runs that step automatically via <code>prestart</code>.</p>' +
        '</body></html>',
    );
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (err?.code === 'EADDRINUSE') {
    console.error('Port already in use. Exiting.');
    process.exit(1);
  }
});

/**
 * Must mirror GET paths in scripts/system-smoke.mjs `CRITICAL` except `/api/health`.
 * scripts/smoke-gate-paths-sync.mjs parses this Set — keep entries in sync.
 */
const SMOKE_GATE_API_PATHS = new Set([
  '/api/qbo/status',
  '/api/qbo/sync-alerts',
  '/api/maintenance/dashboard',
  '/api/maintenance/records',
  '/api/board',
  '/api/maintenance/service-types',
  '/api/integrity/dashboard',
  '/api/integrity/counts',
  '/api/integrity/thresholds',
]);

void SMOKE_GATE_API_PATHS;

async function start() {
  await initializeDatabase();
  try {
    initializeFleetRegistryDb();
  } catch (e) {
    console.error('[fleet-registry] SQLite init failed:', e?.message || e);
  }

  const pool = getPool();
  const app = express();
  app.set('trust proxy', 1);
  app.locals.db = pool;
  app.locals.buildVersion = BUILD_VERSION;

  /** Optional split-origin hub; default '' = same origin as this Express app (typical single Render Web Service). */
  function normalizedFleetHubBaseUrl() {
    const raw = String(process.env.IH35_FLEET_HUB_BASE_URL || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const path = u.pathname.replace(/\/+$/, '');
      return path ? `${u.origin}${path}` : u.origin;
    } catch {
      return '';
    }
  }

  const dbQueryBound = (text, params) => {
    if (!pool) return Promise.reject(new Error('DATABASE_URL is not set'));
    return pool.query(text, params);
  };

  app.use(cors());
  app.use(express.json({ limit: '4mb' }));
  app.use((req, res, next) => {
    const pathOnly = req.path.split('?')[0];
    if (pathOnly.startsWith('/api/')) {
      setNoCacheHeaders(res);
      return next();
    }
    if (pathOnly === '/' || pathOnly.endsWith('.html') || !pathOnly.includes('.')) {
      setNoCacheHeaders(res);
      res.setHeader('Surrogate-Control', 'no-store');
    } else if (pathOnly.endsWith('.js') || pathOnly.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
    next();
  });

  /*
   * Smoke / auth contract (scripts/smoke-gate-paths-sync.mjs):
   *   pathOnly === '/api/health'
   *   pathOnly.startsWith('/api/health/')
   *   pathOnly === '/api/__smoke_not_found__'
   *   pathOnly === '/api/pdf/__smoke__'
   */
  app.use((req, res, next) => {
    const pathOnly = req.path.split('?')[0];
    if (pathOnly === '/api/health' || pathOnly.startsWith('/api/health/')) return next();
    if (pathOnly === '/api/__smoke_not_found__' || pathOnly === '/api/pdf/__smoke__') return next();
    if (process.env.IH35_SMOKE_GATE === '1' && req.method === 'GET' && SMOKE_GATE_API_PATHS.has(pathOnly)) {
      req._ih35SmokeGate = true;
    }
    next();
  });

  app.get('/api/__smoke_not_found__', (_req, res) => {
    res.status(404).json({ error: 'Not found', path: '/api/__smoke_not_found__' });
  });

  mountErpCoreApi(app, { logError: console.error });

  const maintIntegrationDeps = createMaintIntegrationDeps();
  mountDedupeRoutes(app, maintIntegrationDeps);
  mountNameManagementRoutes(app, maintIntegrationDeps);

  mountFleetRegistryProxy(app, { logError: console.error });
  registerFleetCatalogRoutes(app);
  registerFleetAccountingRoutes(app);

  app.use('/api/form-425c', createForm425cRouter({ logError: console.error }));

  app.get('/api/live', (_req, res) => {
    res.type('text/plain; charset=utf-8').send('ok');
  });

  app.use(pdfRouter);

  app.get('/', (_req, res) => {
    const p = path.join(PUBLIC_ROOT, 'index.html');
    sendVersionedPublicHtml(res, p);
  });

  app.get('/form-425c', (_req, res) => {
    const p = path.join(PUBLIC_ROOT, 'form-425c.html');
    sendVersionedPublicHtml(res, p);
  });

  const ERP_HTML_PAGES = [
    'maintenance.html',
    'form-425c.html',
    'form-425c-demo.html',
    'banking.html',
    'dispatch.html',
    'fuel.html',
    'safety.html',
    'settings.html',
    'tracking.html',
  ];
  for (const htmlFile of ERP_HTML_PAGES) {
    app.get(`/${htmlFile}`, (_req, res) => {
      const p = path.join(PUBLIC_ROOT, htmlFile);
      sendVersionedPublicHtml(res, p);
    });
  }

  app.get('/health', (_req, res) => {
    setNoCacheHeaders(res);
    res.json({
      status: 'ok',
      ok: true,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: BUILD_VERSION,
    });
  });

  app.get('/db-test', async (_req, res) => {
    if (!pool) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is not set' });
    }
    try {
      const result = await pool.query('SELECT NOW() AS now');
      res.json({ success: true, time: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  const deployRef = BUILD_VERSION;

  app.get('/ih35-runtime.js', (_req, res) => {
    const base = normalizedFleetHubBaseUrl();
    setFleetHubEntryNoCache(res);
    res.type('application/javascript; charset=utf-8').send(
      `window.__IH35_FLEET_HUB_BASE=${JSON.stringify(base)};window.__IH35_DEPLOY_REF=${JSON.stringify(deployRef)};`,
    );
  });

  app.use('/api/tms', tmsRoutes);
  app.use('/api/integrations', integrationsRoutes);

  mountReportsRestApi(app, {
    readErp: readFullErpJson,
    dbQuery: dbQueryBound,
    fetchTrackedFleetSnapshot: async () => ({ enrichedVehicles: [] }),
    fetchAllSamsaraHosClocks: async () => [],
    qboConfigured: () => false,
    qboGet: async () => ({}),
    readQbo: () => ({}),
    logError: console.error,
    hasSamsaraReadToken: () => false,
  });

  mountScheduledReports(app, {
    dbQuery: dbQueryBound,
    requireErpWriteOrAdmin: () => true,
    logError: console.error,
  });

  startReportScheduleRunner({
    dbQuery: dbQueryBound,
    logError: console.error,
  });

  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found', path: req.path });
    }
    next();
  });

  /** Fleet hub SPA (same process as ERP); assets live under `/fleet-reports/assets/`. */
  app.get(['/fleet-reports', '/fleet-reports/'], (_req, res) => {
    sendFleetReportsSpa(res);
  });
  app.get('/fleet-reports/index.html', (_req, res) => {
    sendFleetReportsSpa(res);
  });

  /** Hashed Vite chunks under `/fleet-reports/assets/` — short revalidate so new builds win over disk cache. */
  app.use(
    '/fleet-reports/assets',
    express.static(path.join(__dirname, 'public', 'fleet-reports', 'assets'), {
      maxAge: 0,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      },
    }),
  );

  app.use(
    express.static(PUBLIC_ROOT, {
      etag: true,
      lastModified: true,
      setHeaders(res, absPath) {
        applyPublicStaticCacheHeaders(res, absPath);
      },
    }),
  );
  app.use(
    '/src',
    express.static(SRC_ROOT, {
      etag: true,
      lastModified: true,
      setHeaders(res, absPath) {
        if (typeof absPath === 'string' && absPath.startsWith(SRC_ROOT + path.sep)) {
          res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        }
      },
    }),
  );

  app.use((err, req, res, next) => {
    console.error('Express error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({
      error: 'Internal server error',
      message: String(err?.message || err),
      path: req.path,
    });
  });

  const PORT = Number(process.env.PORT) || 3100;
  /** Browsers cannot open http://0.0.0.0; Safari often fails with https:// on a plain HTTP dev server. */
  const isProduction = process.env.NODE_ENV === 'production';
  const HOST = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');
  const browserBase = `http://127.0.0.1:${PORT}`;
  app.listen(PORT, HOST, () => {
    console.log(`IH35 TMS listening host=${HOST} port=${PORT}`);
    console.log(`Open in Safari: ${browserBase}/fleet-reports/  |  ${browserBase}/maintenance.html`);
    console.log('Use http (not https). Do not use 0.0.0.0 in the address bar. From another device: HOST=0.0.0.0 npm run dev');
  });
}

start().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

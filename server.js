import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { initializeDatabase } from "./lib/ensure-app-database-objects.mjs";
import { getPool } from "./lib/db.mjs";
import { authRequired, verifySessionToken } from "./lib/auth-users.mjs";
import { mountErpCoreApi } from "./routes/erp-core-api.mjs";
import { initializeDatabase as initializeFleetAccountingDb } from "./apps/fleet-reports-hub/server/lib/accounting-db.mjs";
import { registerAccountingRoutes } from "./apps/fleet-reports-hub/server/lib/accounting-http.mjs";
import { registerCatalogRoutes } from "./apps/fleet-reports-hub/server/lib/catalog-http.mjs";

import tmsRoutes from "./routes/tms.mjs";
import integrationsRoutes from "./routes/integrations.mjs";
import { mountReportsRestApi } from "./routes/reports-rest-api.mjs";
import { mountScheduledReports, startReportScheduleRunner } from "./routes/scheduled-reports.mjs";
import pdfRouter from "./routes/pdf.mjs";
import { createForm425cRouter } from "./routes/form-425c-api.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GET paths that must succeed without a browser session when `IH35_SMOKE_GATE=1`
 * (see `scripts/smoke-gate-paths-sync.mjs` vs `scripts/system-smoke.mjs` `CRITICAL`).
 * `/api/health` is never listed here — it is always exempt before session auth.
 */
const SMOKE_GATE_API_PATHS = new Set([
  "/api/qbo/status",
  "/api/qbo/sync-alerts",
  "/api/accounting/qbo-items",
  "/api/catalog/parts",
  "/api/catalog/service-types",
  "/api/form-425c/profiles",
  "/api/maintenance/dashboard",
  "/api/maintenance/records",
  "/api/board",
  "/api/maintenance/service-types",
  "/api/integrity/dashboard",
  "/api/integrity/counts",
  "/api/integrity/thresholds"
]);

function readSessionTokenFromReq(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf("=");
    if (i < 1) continue;
    const k = s.slice(0, i).trim();
    if (k === "ih35_erp_session" || k === "erp_session") {
      return decodeURIComponent(s.slice(i + 1).trim());
    }
  }
  return "";
}

function smokeApiSessionGate(req, res, next) {
  if (!req.path.startsWith("/api/")) return next();
  const pathOnly = String(req.path || "").split("?")[0];
  if (pathOnly === "/api/health" || pathOnly.startsWith("/api/health/")) return next();
  if (pathOnly === "/api/__smoke_not_found__") return next();
  if (pathOnly === "/api/pdf/__smoke__") return next();
  const smokeGate = String(process.env.IH35_SMOKE_GATE || "").trim() === "1";
  if (smokeGate && req.method === "GET" && SMOKE_GATE_API_PATHS.has(pathOnly)) return next();
  if (!authRequired()) return next();
  const tok = readSessionTokenFromReq(req);
  const v = tok && verifySessionToken(tok);
  if (!v) return res.status(401).json({ error: "Unauthorized" });
  next();
}

async function start() {
  const deployRef =
    String(process.env.IH35_DEPLOY_REF || process.env.RENDER_GIT_COMMIT || Date.now()).trim() || String(Date.now());
  const ensureFleetDist = spawnSync(process.execPath, [path.join(__dirname, "scripts", "ensure-fleet-reports-dist.mjs")], {
    cwd: __dirname,
    stdio: "inherit",
    env: process.env
  });
  if (ensureFleetDist.status !== 0) {
    throw new Error(`ensure-fleet-reports-dist failed with status ${ensureFleetDist.status ?? 1}`);
  }

  await initializeDatabase();
  initializeFleetAccountingDb();

  const pool = getPool();
  const app = express();

  app.locals.db = pool;

  app.use(cors());
  app.use(express.json());
  app.use((_, res, next) => {
    res.setHeader("X-IH35-Deploy-Ref", deployRef);
    next();
  });

  const publicDir = path.join(__dirname, "public");
  const fleetReportsDir = path.join(publicDir, "fleet-reports");

  app.use(
    "/fleet-reports/assets",
    express.static(path.join(fleetReportsDir, "assets"), {
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    })
  );

  app.use(
    "/fleet-reports",
    express.static(fleetReportsDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      }
    })
  );

  app.use('/driver', express.static(path.join(__dirname, 'public', 'driver')));
  app.get('/driver', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'driver', 'index.html')));
  app.get('/driver/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'driver', 'index.html')));

  app.use(
    express.static(publicDir, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      }
    })
  );

  app.use(smokeApiSessionGate);

  // Mount real ERP/Fleet API surfaces first (prevents stale/stub response regressions).
  mountErpCoreApi(app, { logError: console.error });
  registerAccountingRoutes(app);
  registerCatalogRoutes(app);
  app.use("/api/form-425c", createForm425cRouter({ logError: console.error }));

  app.get("/api/live", (_req, res) => {
    res.type("text/plain; charset=utf-8").send("IH35 TMS FULL SYSTEM LIVE 🚛");
  });

  app.get("/db-test", async (_req, res) => {
    if (!pool) {
      return res.status(503).json({ success: false, error: "DATABASE_URL is not set" });
    }
    try {
      const result = await pool.query("SELECT NOW() AS now");
      res.json({ success: true, time: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      version: deployRef,
      serverTime: new Date().toISOString()
    });
  });

  // Keep legacy smoke-gate surface for maintenance records while canonical routes are expanded.
  app.get("/api/maintenance/records", (_req, res) => {
    res.json({ ok: true, records: [] });
  });

  app.get("/ih35-runtime.js", (_req, res) => {
    res.type("application/javascript").send(
      [
        "window.__IH35_FLEET_HUB_BASE = '/fleet-reports/';",
        `window.__IH35_DEPLOY_REF = ${JSON.stringify(deployRef)};`
      ].join("\n")
    );
  });

  app.get("/src/utils/printDocuments.js", (_req, res) => {
    res.sendFile(path.join(__dirname, "src", "utils", "printDocuments.js"));
  });

  app.use(pdfRouter);

  app.use("/api/tms", tmsRoutes);
  app.use("/api/integrations", integrationsRoutes);

  mountReportsRestApi(app, {
    readErp: () => ({}),
    dbQuery: (q, p) => pool.query(q, p),
    fetchTrackedFleetSnapshot: async () => ({ enrichedVehicles: [] }),
    fetchAllSamsaraHosClocks: async () => [],
    qboConfigured: () => false,
    qboGet: async () => ({}),
    readQbo: () => ({}),
    logError: console.error,
    hasSamsaraReadToken: () => false
  });

  mountScheduledReports(app, {
    dbQuery: (q, p) => pool.query(q, p),
    requireErpWriteOrAdmin: () => true,
    logError: console.error
  });

  startReportScheduleRunner({
    dbQuery: (q, p) => pool.query(q, p),
    logError: console.error
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) return next();
    if (res.headersSent) return next();
    return res.status(404).type("application/json").json({ error: "Not found", path: req.path });
  });

  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => {
    console.log(`IH35 TMS running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});

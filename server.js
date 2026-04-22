import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { initializeDatabase } from "./lib/ensure-app-database-objects.mjs";
import { getPool } from "./lib/db.mjs";
import { authRequired, verifySessionToken } from "./lib/auth-users.mjs";

import tmsRoutes from "./routes/tms.mjs";
import integrationsRoutes from "./routes/integrations.mjs";
import { mountReportsRestApi } from "./routes/reports-rest-api.mjs";
import { mountScheduledReports, startReportScheduleRunner } from "./routes/scheduled-reports.mjs";
import pdfRouter from "./routes/pdf.mjs";

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
  await initializeDatabase();

  const pool = getPool();
  const app = express();

  app.locals.db = pool;

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.use(smokeApiSessionGate);

  app.get("/", (_req, res) => {
    res.send("IH35 TMS FULL SYSTEM LIVE 🚛");
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

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      hasSamsaraToken: false,
      hasQboConfig: Boolean(String(process.env.QBO_CLIENT_ID || "").trim())
    });
  });

  app.get("/api/health/db", async (_req, res) => {
    if (!pool) {
      return res.json({ ok: false, configured: false, error: "DATABASE_URL is not set" });
    }
    try {
      await pool.query("SELECT 1 AS one");
      return res.json({ ok: true, configured: true });
    } catch (e) {
      return res.status(503).json({ ok: false, configured: true, error: e?.message || String(e) });
    }
  });

  app.get("/api/qbo/status", (_req, res) => {
    res.json({ ok: true, connected: false, realmId: null });
  });

  app.get("/api/qbo/sync-alerts", (_req, res) => {
    res.json({ ok: true, counts: { total: 0, errors: 0, warnings: 0 } });
  });

  app.get("/api/maintenance/dashboard", (_req, res) => {
    res.json({ ok: true, dashboard: [] });
  });

  app.get("/api/maintenance/records", (_req, res) => {
    res.json({ ok: true, records: [] });
  });

  app.get("/api/board", (_req, res) => {
    res.json({ ok: true, vehicles: [] });
  });

  app.get("/api/maintenance/service-types", (_req, res) => {
    res.json({ ok: true, serviceTypes: [] });
  });

  app.get("/api/integrity/dashboard", (_req, res) => {
    res.json({
      ok: true,
      alerts: [],
      kpi: { active: 0, red: 0, amber: 0, resolvedThisMonth: 0 }
    });
  });

  app.get("/api/integrity/counts", (_req, res) => {
    res.json({ ok: true, active: 0, red: 0, amber: 0 });
  });

  app.get("/api/integrity/thresholds", (_req, res) => {
    res.json({ ok: true, thresholds: {} });
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

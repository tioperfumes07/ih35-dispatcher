import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { initializeDatabase } from "./lib/ensure-app-database-objects.mjs";
import { getPool } from "./lib/db.mjs";
import { readFullErpJson } from "./lib/read-erp.mjs";
import { mountErpCoreApi } from "./routes/erp-core-api.mjs";
import pdfRouter from "./routes/pdf.mjs";
import tmsRoutes from "./routes/tms.mjs";
import integrationsRoutes from "./routes/integrations.mjs";
import { mountReportsRestApi } from "./routes/reports-rest-api.mjs";
import { mountScheduledReports, startReportScheduleRunner } from "./routes/scheduled-reports.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Must mirror GET paths in scripts/system-smoke.mjs `CRITICAL` except `/api/health`.
 * scripts/smoke-gate-paths-sync.mjs parses this Set — keep entries in sync.
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

void SMOKE_GATE_API_PATHS;

async function start() {
  await initializeDatabase();

  const pool = getPool();
  const app = express();
  app.locals.db = pool;

  const dbQueryBound = (text, params) => {
    if (!pool) return Promise.reject(new Error("DATABASE_URL is not set"));
    return pool.query(text, params);
  };

  app.use(cors());
  app.use(express.json());

  /*
   * Smoke / auth contract (scripts/smoke-gate-paths-sync.mjs):
   *   pathOnly === '/api/health'
   *   pathOnly.startsWith('/api/health/')
   *   pathOnly === '/api/__smoke_not_found__'
   *   pathOnly === '/api/pdf/__smoke__'
   */
  app.use((req, res, next) => {
    const pathOnly = req.path.split("?")[0];
    if (pathOnly === "/api/health" || pathOnly.startsWith("/api/health/")) return next();
    if (pathOnly === "/api/__smoke_not_found__" || pathOnly === "/api/pdf/__smoke__") return next();
    if (process.env.IH35_SMOKE_GATE === "1" && req.method === "GET" && SMOKE_GATE_API_PATHS.has(pathOnly)) {
      req._ih35SmokeGate = true;
    }
    next();
  });

  app.get("/api/__smoke_not_found__", (_req, res) => {
    res.status(404).json({ error: "Not found", path: "/api/__smoke_not_found__" });
  });

  mountErpCoreApi(app, { logError: console.error });

  app.use(pdfRouter);

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

  app.use("/api/tms", tmsRoutes);
  app.use("/api/integrations", integrationsRoutes);

  mountReportsRestApi(app, {
    readErp: readFullErpJson,
    dbQuery: dbQueryBound,
    fetchTrackedFleetSnapshot: async () => ({ enrichedVehicles: [] }),
    fetchAllSamsaraHosClocks: async () => [],
    qboConfigured: () => false,
    qboGet: async () => ({}),
    readQbo: () => ({}),
    logError: console.error,
    hasSamsaraReadToken: () => false
  });

  mountScheduledReports(app, {
    dbQuery: dbQueryBound,
    requireErpWriteOrAdmin: () => true,
    logError: console.error
  });

  startReportScheduleRunner({
    dbQuery: dbQueryBound,
    logError: console.error
  });

  app.use((req, res, next) => {
    if (req.method === "GET" && req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Not found", path: req.path });
    }
    next();
  });

  app.use(express.static(path.join(__dirname, "public")));
  app.use("/src", express.static(path.join(__dirname, "src")));

  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => {
    console.log(`IH35 TMS running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});

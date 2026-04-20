import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

// ROUTES
import tmsRoutes from "./routes/tms.mjs";
import integrationsRoutes from "./routes/integrations.mjs";

// SPECIAL MODULES (not routers)
import { mountReportsRestApi } from "./routes/reports-rest-api.mjs";
import { mountScheduledReports, startReportScheduleRunner } from "./routes/scheduled-reports.mjs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// =======================
// DATABASE
// =======================
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.locals.db = pool;

// =======================
// MIDDLEWARE
// =======================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =======================
// BASIC ROUTES
// =======================
app.get("/", (_req, res) => {
  res.send("IH35 TMS FULL SYSTEM LIVE 🚛");
});

app.get("/db-test", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({ success: true, time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =======================
// CORE ROUTERS
// =======================
app.use("/api/tms", tmsRoutes);
app.use("/api/integrations", integrationsRoutes);

// =======================
// REPORT SYSTEM (special mount)
// =======================
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

// =======================
// SCHEDULED REPORTS
// =======================
mountScheduledReports(app, {
  dbQuery: (q, p) => pool.query(q, p),
  requireErpWriteOrAdmin: () => true,
  logError: console.error
});

startReportScheduleRunner({
  dbQuery: (q, p) => pool.query(q, p),
  logError: console.error
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 3100;

app.listen(PORT, () => {
  console.log(`IH35 TMS running on port ${PORT}`);
});

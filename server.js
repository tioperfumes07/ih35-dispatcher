import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.locals.db = pool;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.send("IH35 TMS LIVE 🚛");
});

app.get("/db-test", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({
      success: true,
      time: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

function pickRouter(mod) {
  if (!mod) return null;

  const candidates = [
    mod.default,
    mod.router,
    mod.routes,
    mod.tmsRouter,
    mod.reportsRouter,
    mod.integrationsRouter,
    mod.scheduledReportsRouter,
    ...Object.values(mod),
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "function" &&
      typeof candidate.use === "function" &&
      typeof candidate.handle === "function"
    ) {
      return candidate;
    }
  }

  return null;
}

async function mountRoute(urlBase, modulePath, label) {
  try {
    const mod = await import(modulePath);
    const router = pickRouter(mod);

    if (!router) {
      console.warn(`[routes] Skipped ${label}: no Express router export found`);
      return;
    }

    app.use(urlBase, router);
    console.log(`[routes] Mounted ${label} at ${urlBase}`);
  } catch (err) {
    console.error(`[routes] Failed to load ${label}: ${err.message}`);
  }
}

async function bootstrap() {
  await mountRoute("/api/tms", "./routes/tms.mjs", "tms");
  await mountRoute("/api/reports", "./routes/reports-rest-api.mjs", "reports-rest-api");
  await mountRoute("/api/scheduled", "./routes/scheduled-reports.mjs", "scheduled-reports");
  await mountRoute("/api/integrations", "./routes/integrations.mjs", "integrations");

  const PORT = process.env.PORT || 3100;

  app.listen(PORT, () => {
    console.log(`IH35 TMS running on port ${PORT}`);

    setTimeout(async () => {
      try {
        await pool.query("SELECT 1");
        console.log("[db] Database ready.");
      } catch (e) {
        console.error("[db] Startup error:", e.message);
      }
    }, 1000);
  });
}

bootstrap().catch((err) => {
  console.error("Fatal bootstrap error:", err);
  process.exit(1);
});

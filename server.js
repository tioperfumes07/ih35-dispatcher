import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

// ROUTES
import tmsRoutes from "./routes/tms.mjs";
import reportsRoutes from "./routes/reports-rest-api.mjs";
import scheduledReports from "./routes/scheduled-reports.mjs";
import integrations from "./routes/integrations.mjs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// =======================
// DATABASE (NEON)
// =======================
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Make DB accessible everywhere
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
app.get("/", (req, res) => {
  res.send("IH35 TMS LIVE 🚛");
});

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({
      success: true,
      time: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =======================
// TMS ROUTES
// =======================
app.use("/api/tms", tmsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/scheduled", scheduledReports);
app.use("/api/integrations", integrations);

// =======================
// START SERVER FIRST
// =======================
const PORT = process.env.PORT || 3100;

app.listen(PORT, () => {
  console.log(`IH35 TMS running on port ${PORT}`);

  // Run any heavy startup AFTER server starts
  setTimeout(async () => {
    try {
      console.log("Running background initialization...");
      await pool.query("SELECT 1");
      console.log("Database ready.");
    } catch (e) {
      console.error("Startup error:", e.message);
    }
  }, 1000);
});

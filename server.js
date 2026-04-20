import express from "express";
import pg from "pg";

const app = express();
app.use(express.json());

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

app.get("/", (req, res) => {
  res.send("IH35 TEST SERVER LIVE");
});

app.get("/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({
      success: true,
      marker: "IH35 TEST DB OK",
      time: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      marker: "IH35 TEST DB FAIL",
      error: err.message,
    });
  }
});

const PORT = process.env.PORT || 3100;

app.listen(PORT, () => {
  console.log(`IH35 TEST SERVER listening on port ${PORT}`);
});

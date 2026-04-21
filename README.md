
- `GET /` — Serves **`public/index.html`** (IH35 ERP company home and workspace links). For a **plain-text** process liveness line (e.g. load balancers), use **`GET /api/live`** instead.
- `GET /api/live` — Short UTF-8 plain-text response confirming the Node process is up.
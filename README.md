# IH35 dispatch / ERP (Node)

Folder layout (static ERP shell vs React fleet hub): **[docs/PROJECT_LAYOUT.md](docs/PROJECT_LAYOUT.md)**.  
**New to Git / Render?** Read **[docs/HOW_CODE_GETS_ONLINE.md](docs/HOW_CODE_GETS_ONLINE.md)** (saving ≠ deployed; commit → push → Render).

- `GET /` — Serves **`public/index.html`** (IH35 ERP company home and workspace links). For a **plain-text** process liveness line (e.g. load balancers), use **`GET /api/live`** instead.
- `GET /api/live` — Short UTF-8 plain-text response confirming the Node process is up.
- `GET /fleet-reports/` — Fleet reports **React** app after **`npm run build:fleet`** (output under `public/fleet-reports/`, gitignored until built).
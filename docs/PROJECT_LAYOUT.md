# IH35 project layout (Node migration)

This repository is the **single source of truth** for the IH35 dispatch / ERP stack after moving off “local HTML only” workflows.

## Top-level folders

| Path | Role |
|------|------|
| **`server.js`** | Minimal Express entry: static files from `public/`, company home at `/`, health at `/health`. Extend here or split routers as the app grows. |
| **`public/`** | Static assets served by Node: **`index.html`** (hub), **`maintenance.html`** (main ERP shell), `dispatch.html`, `banking.html`, CSS, JS, images. This is the former “local file” UI, now delivered through Express. |
| **`routes/`**, **`lib/`** | Server-side modules (APIs, ERP helpers, reports, PDFs, etc.) when wired into a fuller `server.js` or a separate process. |
| **`apps/fleet-reports-hub/`** | **Vite + React** “Fleet reports hub” (TypeScript). It is **not** a loose folder on the Desktop; it lives under `apps/` with its own `package.json`. |
| **`data/`**, **`database/`** | JSON seeds, SQL migrations, local DB artifacts. |

## Fleet reports hub (`apps/fleet-reports-hub`)

- **Dev (Vite + hot reload):** from repo root: `npm run dev:fleet`  
  Proxies `/api` → `http://localhost:8787` (run `npm run dev:fleet:api` in another terminal for the hub’s API process).
- **Embed in IH35 static site:** from repo root: `npm run build:fleet`  
  Builds with `VITE_BASE=/fleet-reports/` and copies output to **`public/fleet-reports/`**, so the main server serves it at **`/fleet-reports/`** (no extra route required).

The hub home page links to **`/fleet-reports/`** after a successful `build:fleet`.

## Why `public/` and `apps/` both exist

- **`public/`** — classic server-rendered / large HTML + JS bundles (your migrated “main file” experience under Node).
- **`apps/fleet-reports-hub/`** — modern SPA toolchain (Vite/React) that compiles **into** `public/fleet-reports/` for one-origin deployment.

If you later merge more UIs into Vite, add more entries under `apps/` using the same pattern.

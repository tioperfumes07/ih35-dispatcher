# IH35 Dispatch V3 Starter

Operations hub for **dispatch / TMS**, **fuel & route planning**, **maintenance & accounting**, and **Samsara**-backed fleet data. The app is one **Express** server (`server.js`) with static UI under `public/` and APIs for loads, ERP JSON, QuickBooks, PDFs, and integrations.

**Architecture overview:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — includes **ERP shell verification (master redesign)** (how **`rule0:check`**, **`npm run smoke`**, **`npm run qa:automated`** (**`smoke-gate-paths-sync`** then **`rule0:check`** + smoke when a server is already up), and **`npm run qa:isolated`** (**`smoke-gate-paths-sync`** then ephemeral **`server.js`** + **`rule0:check`** + smoke) line up with the post-release checklist and **CI**).

## What is included

- **TMS** — PostgreSQL loads/stops, customers, drivers, trucks, trailers; full-screen `dispatch.html` and ERP embed.
- **Fleet** — Samsara vehicles for the dispatch fleet tab and truck datalist; vehicle stats, HOS, assignments via existing `/api/board` and related routes.
- **Routing / miles** — Geocode + OSRM-style routing; optional **PC*Miler** practical miles when `PCMILER_API_KEY` is set.
- **QuickBooks Online** — OAuth, catalog sync (including background refresh), invoices from loads, maintenance posting.
- **PDFs** — Printable load sheets, maintenance records, work orders, AP rows (`/api/pdf/...`).
- **ERP file** — `data/maintenance.json` for maintenance, work orders, and AP until you promote more into Postgres.

## Assumptions (fuel planner defaults)

- Default tank size: 120 gallons; unit 169 tank: 80 gallons
- Target shift miles: 750; personal conveyance buffer: 45 miles default
- Truck MPG can come from Samsara or a control table later

## Setup

**Runtime:** **Node.js 18+** (ES modules; native `fetch`). Declared in **`package.json`** `engines`. Optional **`.nvmrc`** pins **Node 20** for **nvm** / **fnm** (same as [`.github/workflows/rule0-check.yml`](.github/workflows/rule0-check.yml)). **[`.editorconfig`](.editorconfig)** sets LF and **2-space** indents for JS/CSS/HTML/JSON (use an [EditorConfig](https://editorconfig.org/)–aware editor).

1. Copy `.env.example` to `.env`
2. Set `SAMSARA_API_TOKEN`, `DATABASE_URL` (for TMS), and optional `GEOAPIFY_API_KEY`, QBO, and `PCMILER_API_KEY`
3. **`npm install`** or **`npm ci`** (reproducible from **`package-lock.json`**, same as **GitHub Actions**) then **`npm run db:migrate`** if using Postgres
4. `npm start` (or `npm run dev` for watch mode)
5. Open `http://localhost:<PORT>` (default in code is `3400`; `.env.example` uses `3100`)

### Dependency audit

Run **`npm audit`** when updating dependencies. Server-side spreadsheet parsing uses **`@e965/xlsx`**; PDFs use **`pdfkit`** (**`routes/pdf.mjs`**). Bump either in a dedicated change and re-run **`npm run qa:isolated`**; after **`pdfkit`** upgrades, spot-check a maintenance or trip PDF in the browser.

## Verification (automated)

Use these before a release or when validating the ERP shell (see `docs/ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md` for full manual QA).

1. **`npm run rule0:check`** — Agent B Rule 0 guard on `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, and `public/maintenance.html`. By default it logs per-file OK lines; with **`CI=true`** or **`RULE0_QUIET=1`** it logs one **`rule0:check OK (N files)`** summary instead. Outside CI, it also prints a reminder to run smoke unless **`RULE0_QUIET=1`**. **`npm run qa:automated`** runs **`smoke:gate-sync`**, then the same check with **`--skip-release-tip`** so the release tip is not duplicated before **`smoke`**.
2. **Start the server** — `npm start` or `npm run dev`. Listen port is **`process.env.PORT` or `3400`** unless your `.env` sets otherwise. The listener uses **`0.0.0.0`** so **`http://localhost:<PORT>`** / **`http://127.0.0.1:<PORT>`** work with **`npm run smoke`** (some Node versions otherwise bind IPv6-only and loopback would not connect).
3. **`npm run smoke`** — `scripts/system-smoke.mjs` hits health APIs, static ERP HTML shells, shared CSS/JS (including `erp-master-redesign.css` and `erp-master-spec-2026.css` with the other token and shell styles) with stable substring checks, **`GET /api/__smoke_not_found__`** (auth-exempt) to assert unknown API paths return **404** with **`Content-Type`** including **`application/json`** and body (`error`, `path`) instead of HTML, and **`GET /api/pdf/__smoke__`** (auth-exempt) to assert PDF output (**`application/pdf`**, body starts with **`%PDF`**, **`pdfkit`**) when login is optional or required. Rule 0 body scans reuse cached GET bodies. Default target is **`http://localhost:<PORT>`** (same port as the server). **`npm run qa:automated`** runs **`smoke:gate-sync`**, step **1**, then step **3** in one command.

**No server running yet / avoid port conflicts:** **`npm run qa:isolated`** runs **`scripts/smoke-gate-paths-sync.mjs`** ( **`CRITICAL`** vs **`SMOKE_GATE_API_PATHS`** ), then **`rule0:check`** + **`smoke`** against a **fresh** `server.js` child on a random free port (see `scripts/qa-with-server.mjs`). Run **`npm run smoke:gate-sync`** alone after editing either list. The child sets **`IH35_SMOKE_GATE=1`** so the JSON API GETs used by **`system-smoke.mjs`** succeed without a browser session even when ERP login is required. Use this when **`localhost:3400`** is occupied or you suspect a stale `server.js` that does not match current `server.js` (smoke requires JSON **404** for unknown `/api/*` paths). **Ctrl+C** (**SIGINT**) or **SIGTERM** terminates the child server, any in-flight **`rule0:check`** / **`smoke`** subprocess, and the parent process (exit **130** / **143**).

If the server is not on **3400** or smoke must use another host, set **`SMOKE_BASE`** (e.g. `SMOKE_BASE=http://127.0.0.1:3100 npm run smoke`). Set **`SMOKE_QUIET=1`** to hide the extra “Smoke target” line at the end of a successful smoke run. Set **`SMOKE_TIMEOUT_MS`** (per-fetch milliseconds in **`system-smoke.mjs`**, default **8000**, clamped **2000–30000**) if smoke times out on slow hosts or remote **`SMOKE_BASE`** targets.

**CI:** [`.github/workflows/rule0-check.yml`](.github/workflows/rule0-check.yml) runs **`npm run qa:isolated`** on push and pull requests (**`smoke-gate-paths-sync`**, Rule 0 offline check, HTTP smoke on a child `server.js`). Actions sets **`CI=true`**; **`rule0:check`** prints one summary line instead of three per-file OK lines, and `scripts/qa-with-server.mjs` passes **`SMOKE_QUIET=1`** into smoke so the success footer line is omitted. Locally you can use the same command, or **`npm run qa:automated`** (**`smoke-gate-paths-sync`** + **`rule0:check`** + **`smoke`**) / **`npm run smoke`** when a server is already listening. Set **`RULE0_QUIET=1`** to get the same compact **`rule0:check`** output without **`CI`**. The workflow uses **`permissions: contents: read`**, **concurrency** (newer runs cancel superseded jobs on the same ref), a **15-minute** job timeout, and **`SMOKE_TIMEOUT_MS=12000`** (per-request timeout in **`system-smoke.mjs`**, default **8000** locally) for slightly more headroom on shared runners.

**Parallel agents:** See [docs/AGENT_COORDINATION.md](docs/AGENT_COORDINATION.md) for who owns which paths (e.g. ERP master redesign vs maintenance behavior vs server) so PRs do not overlap.

## Useful endpoints

- `GET /api/health` — Samsara probe + flags (`hasDatabaseUrl`, `hasPcmilerKey`, QBO config, …)
- `GET /api/health/db` — Postgres check
- `GET /api/tms/*` — TMS REST (loads, fleet, leg miles)
- `GET /api/pdf/*` — PDF documents
- `GET /api/geocode`, `/api/autocomplete`, `/api/route` — location and routing helpers

## Git → GitHub → Render (why deploys may not match pushes)

This clone’s **`origin`** is **`https://github.com/tioperfumes07/ih35-dispatcher.git`** (see `git remote -v`). Pushes from this folder only update **that** GitHub repository’s default branch you push to (usually **`main`**).

### If Render never shows new deploys

1. **Same repo on Render** — In the [Render Dashboard](https://dashboard.render.com) open your **Web Service** → **Settings** → **Build & Deploy** → **Repository**. It must be **`tioperfumes07/ih35-dispatcher`** (same owner + name as `origin`). If Render points at another repo, fork, or org, your pushes here will not affect that service.
2. **Same branch** — **Branch** should be **`main`** (or whatever branch you actually push to). A `production` branch on Render while you only push `main` will look “stuck.”
3. **Automatic deploys** — Under **Build & Deploy**, confirm deploys are triggered **on push** to that branch, not **manual deploy only**.
4. **GitHub access** — Render’s GitHub App must have access to **`tioperfumes07/ih35-dispatcher`** (install/update the app for that org/repo if the service was created under a different GitHub user).

### “I want to see every single commit”

- **Full commit history** lives on **GitHub**, not as a duplicate git log inside Render’s service page. Open: **`https://github.com/tioperfumes07/ih35-dispatcher/commits/main`**
- **Render** shows **Deploy / Event** history (builds). Each successful Git-triggered deploy is tied to a commit SHA; that is normal “one row per deploy,” not one row per historical commit.

### Quick local checks before blaming Render

```bash
git remote -v
git branch --show-current
git log -1 --oneline
```

Compare the printed **remote URL** and **branch** to what Render shows in **Build & Deploy**. If they differ, update Render or change `git remote set-url origin …` so local and Render agree.

## Next build steps (product)

1. Hardening: authentication, non-wildcard CORS, rate limits for public deploys
2. Align TMS list views with your dispatch board mockups (columns, filters, statuses)
3. Deeper QBO sync (e.g. bills/invoices reconciliation) as your chart of accounts requires
4. Optional: migrate more ERP entities from JSON to Postgres for unified reporting
5. Driver compliance UI + IFTA: Postgres columns in `011_fleet_driver_compliance.sql` (`drivers`, `trucks`, `trailers`); wire Samsara IDs, then miles-by-state + fuel import + quarterly export

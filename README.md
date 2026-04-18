# IH35 Dispatch V3 Starter

Operations hub for **dispatch / TMS**, **fuel & route planning**, **maintenance & accounting**, and **Samsara**-backed fleet data. The app is one **Express** server (`server.js`) with static UI under `public/` and APIs for loads, ERP JSON, QuickBooks, PDFs, and integrations.

**Architecture overview:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

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

1. Copy `.env.example` to `.env`
2. Set `SAMSARA_API_TOKEN`, `DATABASE_URL` (for TMS), and optional `GEOAPIFY_API_KEY`, QBO, and `PCMILER_API_KEY`
3. `npm install` then `npm run db:migrate` if using Postgres
4. `npm start` (or `npm run dev` for watch mode)
5. Open `http://localhost:<PORT>` (default in code is `3400`; `.env.example` uses `3100`)

## Verification (automated)

Use these before a release or when validating the ERP shell (see `docs/ERP_MASTER_REDESIGN_POST_RELEASE_CHECKLIST.md` for full manual QA).

1. **`npm run rule0:check`** — Agent B Rule 0 guard on `public/css/app-theme.css`, `public/css/maint-accounting-ui-2026.css`, and `public/maintenance.html`.
2. **Start the server** — `npm start` or `npm run dev`. Listen port is **`process.env.PORT` or `3400`** unless your `.env` sets otherwise.
3. **`npm run smoke`** — `scripts/system-smoke.mjs` hits health APIs and static ERP pages (expects `127.0.0.1` on the same port). **`npm run qa:automated`** runs steps **1** then **3** in one command.

If the server is not on **3400**, set **`SMOKE_BASE`** for smoke (e.g. `SMOKE_BASE=http://127.0.0.1:3100 npm run smoke`).

## Useful endpoints

- `GET /api/health` — Samsara probe + flags (`hasDatabaseUrl`, `hasPcmilerKey`, QBO config, …)
- `GET /api/health/db` — Postgres check
- `GET /api/tms/*` — TMS REST (loads, fleet, leg miles)
- `GET /api/pdf/*` — PDF documents
- `GET /api/geocode`, `/api/autocomplete`, `/api/route` — location and routing helpers

## Next build steps (product)

1. Hardening: authentication, non-wildcard CORS, rate limits for public deploys
2. Align TMS list views with your dispatch board mockups (columns, filters, statuses)
3. Deeper QBO sync (e.g. bills/invoices reconciliation) as your chart of accounts requires
4. Optional: migrate more ERP entities from JSON to Postgres for unified reporting
5. Driver compliance UI + IFTA: Postgres columns in `011_fleet_driver_compliance.sql` (`drivers`, `trucks`, `trailers`); wire Samsara IDs, then miles-by-state + fuel import + quarterly export

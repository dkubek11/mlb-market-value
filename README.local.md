# MLB Market Value — Local Development Setup

This guide covers the **zero-infrastructure local development path**. No Postgres server installation or Docker is required — the app uses a local SQLite database by default.

> If you want a production-like Postgres stack, see [README.md](README.md) (Docker Compose).

## Quick Start

```bash
cd backend
python -m venv venv
source venv/bin/activate      # macOS/Linux
# venv\Scripts\activate       # Windows
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

That's it. The database file `mlb_market_value.db` is created automatically in `backend/`.

Then in a second terminal:

```bash
cd frontend
npm install          # first time only
npm run dev          # Vite dev server on :5173
```

Open **http://localhost:5173/** for the dashboard (proxies `/api` to the backend at `:8000`).

## What's Different

| | Local dev (this file) | Docker (README.md) |
|---|---|---|
| Database | SQLite file (`mlb_market_value.db`) | Postgres container |
| Setup steps | 4 commands | `docker compose up -d --build` |
| `.env` needed | No — SQLite via `DATABASE_URL` override | Yes — `DATABASE_URL` required |
| Migrations | `alembic upgrade head` | Automatic on container boot |
| Data ingest | Manual (`python -m app.pipeline.run_ingest`) | Automatic on container boot |
| Frontend dev | `npm run dev` on `:5173` | Build + serve by API container |
| Production parity | Lower (SQLite dialect) | Exact (Postgres 16) |

## Setup in Detail

### 1. Python environment

```bash
cd backend
python -m venv venv
source venv/bin/activate      # macOS/Linux
# venv\Scripts\activate       # Windows
pip install -r requirements.txt
```

### 2. Environment config

> **Note:** the checked-in `backend/.env.example` points at **Postgres**
> (`postgresql+psycopg2://postgres:postgres@localhost:5432/mlb_market_value`),
> as does the default in `backend/app/db.py`. For SQLite local dev, either
> overwrite your `.env` with `DATABASE_URL=sqlite:///mlb_market_value.db` or
> set the override on every command (as in every example below):

```
DATABASE_URL=sqlite:///mlb_market_value.db
```

If you copied an old `.env` that points to Postgres, either delete it (the app
will fall back to the Postgres default) or overwrite it with the SQLite URL.

### 3. Database schema

```bash
cd backend
DATABASE_URL="sqlite:///./mlb_market_value.db" alembic upgrade head
```

This creates `mlb_market_value.db` and applies all migrations. The file is gitignored and safe to delete — migrations are idempotent and will recreate it.

### 4. Ingest data

```bash
# Ingest the current season (stats + salaries):
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_ingest --season 2026

# Compute player values and payroll summaries:
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_compute_value --season 2026
```

For a past season (salary data is not available from RosterResource for historical seasons):

```bash
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_ingest --season 2023 --skip-salary
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_compute_value --season 2023
```

### 5. Start the API

```bash
DATABASE_URL="sqlite:///./mlb_market_value.db" uvicorn app.main:app --reload
```

The dashboard is served at `http://localhost:8000/`. API docs are at `http://localhost:8000/docs`.

### 6. Frontend development (optional)

The dashboard is a single-file React build (`frontend/dist/index.html`)
served by the API at `/`. For live editing with hot reload:

```bash
cd frontend
npm install          # first time only
npm run dev          # Vite on :5173, proxies /api to :8000
```

`npm run build` produces `dist/index.html` (with self-contained asset checks via
`scripts/verify-build.mjs`). You only need to run it to pick up React source
changes on the API server's `/` route.

### 7. Validate the API contract (optional)

`backend/scripts/validate_api_schema.py` validates the `/api/dashboard` payload
against Pydantic models that mirror the frontend TypeScript types. See
[TESTING.md](TESTING.md) §10 for the full parity procedure.

```bash
cd backend
DATABASE_URL="sqlite:///./mlb_market_value.db" .venv/bin/python -m scripts.validate_api_schema --season 2026
```

## Database Notes

### SQLite vs Postgres

The local SQLite database is fully functional for development and single-season analysis. Use Docker Compose (Postgres) when you need:

- Multi-season backfill with projection history
- Exact production parity
- To expose the DB to external tools (`psql` on host port 5433)

Switching back to Postgres later is seamless — just set `DATABASE_URL` in `.env` and re-run `alembic upgrade head`.

### SQLite Caveats

- Foreign-key constraints are not enforced by default. The application enforces referential integrity at the query level, so this does not affect correctness for local dev.
- `Numeric` precision/scale is stored but not strictly enforced by SQLite. Rounding behavior is identical for MLB stat ranges.
- Migration `downgrade` steps that use `DROP COLUMN` may fail on very old SQLite versions. Python 3.13 ships with SQLite 3.45+, which supports this. In practice, downgrades are never run in normal development.
- `DateTime(timezone=True)` is stored as ISO8601 text. No data loss; timezone conversion behavior matches Postgres for naive datetimes.

### Switching databases

To move from SQLite to Postgres (or vice versa):

```bash
# Backup if needed, then just delete the local file:
rm mlb_market_value.db

# Update DATABASE_URL in .env, then re-run migrations:
alembic upgrade head
```

## Running the Pipeline (local dev)

```bash
# Full ingest for a season:
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_ingest --season 2026

# Compute values:
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_compute_value --season 2026

# Backfill a historical season (no salary data available):
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_ingest --season 2023 --skip-salary
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m app.pipeline.run_compute_value --season 2023
```

## Dashboard: Live Data vs. Offline Snapshot

**Live (default).** The dashboard is `frontend/dist/index.html`, a
single-file React build served at `/`. At page load the browser fetches data
live from `GET /api/dashboard?season=2026`, so data is always fresh from the DB.

**Offline snapshot (optional).** Build a self-contained bundle with an embedded
snapshot using `VITE_EMBED_SNAPSHOT=1`:

```bash
cd frontend
VITE_EMBED_SNAPSHOT=1 npm run build
```

The React app then falls back to `window.__DASHBOARD_DATA__` (the embedded
snapshot) when the live API is unreachable — no separate build scripts or
server needed.

## Containerized Stack (Docker Compose)

For a production-like Postgres environment with automatic data ingestion on boot:

```bash
docker compose up -d --build
```

- **http://localhost:8000/** → dashboard
- **http://localhost:8000/docs** → API docs
- Postgres on host port **5433** (`psql -p 5433 -U postgres -d mlb_market_value`, password `postgres`)
- DB persists in named volume `mlb_mv_pgdata`; survives `docker compose down`
- Wipe everything: `docker compose down -v`

See [README.md](README.md) for full Docker documentation, environment variables, and manual override commands.

## Scheduling

`scripts/nightly_refresh.ps1` runs the full pipeline (ingest → compute value → frontend tests → rebuild dashboard) and logs to `scripts/logs/`. Register it as a Windows Task Scheduler job:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-ExecutionPolicy Bypass -File "<repo path>\scripts\nightly_refresh.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "MLBMarketValueNightlyRefresh" -Action $action -Trigger $trigger -Settings $settings -Description "Nightly refresh of mlb-market-value DB + dashboard data" -Force
```

The task only runs while the machine is on; if asleep/off at 3am, `-StartWhenAvailable` runs it on next wake.

## Methodology Notes

- **Score** = performance percentile − (pay weight × salary percentile), computed within position group each season. Performance percentile comes from a weighted composite of ~12-13 stats (expected stats, contact quality, plate discipline, fielding for batters), each scored as a z-score against the position average. All weights (including the pay weight) are live-adjustable in the dashboard's Weights tab.
- **Projections**: Marcel-style multi-year regression (weighted 3-year history of expected stats, regressed to league mean by sample size, age-adjusted) blended 50/50 with a nearest-neighbor "comparable player" projection (finds historically similar players at the same age/performance level and uses what they actually did the following season).
- **Pre-arbitration players** are excluded from the pay comparison (their salary is fixed near the league minimum by CBA rule, not market-determined) and instead get a projected market salary based on comparable market-priced peers. A season ingested with no salary data at all (e.g. `--skip-salary`) treats every player as pre-arb so scores stay pure-performance.
- Full historical performance data (no salary) is backfilled 2015-2025; 2026 has both stats and salary.

## Troubleshooting

**`alembic upgrade head` fails with "no module named alembic"**
Make sure the venv is activated and you ran `pip install -r requirements.txt`.

**Dashboard shows an error instead of the page**
You're running the API from the repo root or wrong directory, or the React
bundle hasn't been built. The API serves `frontend/dist/index.html`
relative to the backend (`main.py`). Run `uvicorn` from `backend/` (or set
`PYTHONPATH=backend`) and run `npm run build` in `frontend/` first.

**Dashboard shows "No qualified players found for the YYYY season yet"**
The season hasn't been ingested (or players don't meet the 150 PA / 50 IP
qualification bar). Run the pipeline for that season and reload.

**`npm run dev` can't reach the API**
Make sure `uvicorn app.main:app --reload` is running on port 8000 with the
SQLite `DATABASE_URL` override. The Vite dev server proxies `/api` to
`http://localhost:8000`.

**Port 8000 or 5173 already in use**
Kill the conflicting process, or run uvicorn on a different port:
```bash
uvicorn app.main:app --reload --port 8001
```
Then update the proxy in `frontend/vite.config.ts` accordingly.

**Database is locked / "database is busy"**
SQLite allows one writer at a time. Stop any other process accessing `mlb_market_value.db` (IDE database tools, other terminal tabs, etc.).

**Ingest fails with "SQLite Date type only accepts Python date objects"**
Fixed in the pipeline — bios are parsed to `date` objects at ingest
(`backend/app/pipeline/ingest.py`). If you see this, you're on a stale checkout.

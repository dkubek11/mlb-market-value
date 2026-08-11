# MLB Market Value

Correlates MLB player salaries with on-field performance. Pulls stats from the MLB Stats API, Statcast, and FanGraphs; computes a weighted, position-relative performance score; compares it to actual pay; and projects what a player's performance says they should be earning (including multi-year, comparable-player-based projections for regression/trend analysis).

The live dashboard is a self-contained HTML build (`frontend/dashboard/`) generated from the database — no separate frontend server to run. The single file is produced by a **React + Vite** app in `frontend/react/` (see [Dashboard: live data vs. offline snapshot](#dashboard-live-data-vs-offline-snapshot) for the build/dev workflow).

## Project layout

```
backend/
  app/
    models.py              SQLAlchemy models
    pipeline/               data ingestion + computation
      mlb_stats_api.py       traditional stats (MLB Stats API)
      statcast_metrics.py     expected stats, exit velo (pybaseball/Statcast)
      statcast_extension.py   pitcher release extension (full-season pitch-level pull)
      fangraphs_batting.py    batter plate discipline (chase%, whiff%)
      fangraphs_pitching.py   pitcher plate discipline, Stuff+/Location+
      fangraphs_salary.py     contract/salary data (RosterResource)
      fielding_metrics.py     OAA/FRV (Statcast) + DRS (FanGraphs)
      ingest.py               orchestrates the season ingest
      compute_value.py        performance-vs-pay percentile computation
      projections.py          Marcel-style multi-year regression projections
      comp_projections.py     nearest-neighbor comparable-player projections
  alembic/                 DB migrations
frontend/
  dashboard/
    dashboard_template.html  the dashboard (single self-contained HTML, React build output)
    dashboard_template.html.bak  pre-migration legacy template (rollback artifact; never served)
    team_colors.json          static team brand colors (consumed by the API payload; must stay put)
    build_dashboard.py       (legacy) queries the DB fresh -> dashboard_data.json (offline snapshot path)
    splice_dashboard.py      (legacy) bakes data + fonts into dashboard_final.html (offline snapshot path)
  react/
    src/                     React + TypeScript source (views, components, scoring engine port)
    scripts/deploy-build.mjs  copies dist/index.html onto dashboard_template.html (atomic + .bak backup)
    vite.config.ts            singlefile build config
  ```

## Setup

1. **Postgres**: create a database (e.g. `mlb_market_value`) on a local or hosted Postgres instance.
2. **Python env**:
   ```
   cd backend
   python -m venv venv
   venv\Scripts\activate      (Windows)  /  source venv/bin/activate  (macOS/Linux)
   pip install -r requirements.txt
   ```
3. **Config**: copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` to your Postgres connection string.
4. **Migrate**:
   ```
   cd backend
   alembic upgrade head
   ```

## Containerized stack (docker compose)

The whole app — Postgres, API, and dashboard — runs as two containers with **no terminal juggling**:

```bash
docker compose up -d --build
```

- **http://localhost:8000/**  → the dashboard (served by FastAPI from the image)
- **http://localhost:8000/docs**  → API docs (Swagger UI)
- Postgres is exposed on **host port 5433** (`psql -p 5433 -U postgres -d mlb_market_value`, password `postgres`) so it doesn't clash with a system Postgres on 5432.
- The DB persists in the named volume `mlb_mv_pgdata`; data survives `docker compose down`. To wipe everything: `docker compose down -v`.

### Populating data inside the container

The image ships with a **fresh, empty schema**. On startup, the API container runs [`app.pipeline.run_all`](backend/app/pipeline/run_all.py) automatically — no manual pipeline steps:

1. **Migrations** — `alembic upgrade head` (idempotent)
2. **Ingest** the current season (stats + advanced metrics + salaries)
3. **Backfill** the previous `HISTORY_SEASONS` seasons (stats only, no salaries) for projection history
4. **Compute** player values + team payroll summaries
5. **Boot** the API

The dashboard is a **React single-file build**: the container serves [`dashboard_template.html`](frontend/dashboard/dashboard_template.html), which fetches its data live from `GET /api/dashboard?season=YYYY` at page load (exactly the request the legacy template made). To rebuild it after editing React source:

Every step is idempotent — a season already in the DB is skipped, so container restarts are fast (no re-fetching from the network). The whole flow is one command:

```bash
docker compose up -d --build
```

To control what gets ingested, set env vars before `up` (defaults: current calendar year, 3 history seasons):

```bash
SEASON=2026 HISTORY_SEASONS=3 docker compose up -d --build
```

Manual overrides inside a running container:

```bash
# re-run everything (idempotent; only missing seasons are ingested)
docker compose exec api python -m app.pipeline.run_all --season 2026 --history-seasons 3

# schema-only job (migrations then exit)
docker compose exec api python -m app.pipeline.run_all --migrate-only
```

> **Historical backfill** (a season that's already over) is fetched with `--skip-salary` automatically, since RosterResource only exposes *current* rosters — re-running the salary scrape against a past season would just mislabel today's contracts under the wrong year.

> **Backfill memory**: backfilling prior seasons pulls the pitch-by-pitch Statcast extension data, which is memory-hungry and can OOM-kill the api container (`exit code -9`) on hosts with limited RAM. The compose default is `HISTORY_SEASONS=0` (current season only) for this reason. To backfill on a machine with headroom, set `HISTORY_SEASONS=3` before `docker compose up` (and/or raise `mem_limit`). The current season's projections are computed from the stats already present, so a 0-history single-season dashboard is fully functional.

## Running the pipeline (local dev)

From `backend/`, with the venv active:

```
py -m app.pipeline.run_ingest --season 2026
py -m app.pipeline.run_compute_value --season 2026
```

`run_ingest` fetches everything for that season (stats, advanced metrics, salaries) and upserts it into Postgres. The pitch-by-pitch extension pull is the slowest step (~2-3 min for a full season). For a **historical backfill** (a season that's already over), add `--skip-salary` — RosterResource only exposes *current* rosters, so re-running the salary scrape against a past season would just relabel today's contracts under the wrong year, not recover what players actually earned then:

```
py -m app.pipeline.run_ingest --season 2023 --skip-salary
```

## Dashboard: live data vs. offline snapshot

**Live (default).** The dashboard is [`dashboard_template.html`](frontend/dashboard/dashboard_template.html), a single-file React build served at `/`. At page load the browser fetches the full payload from `GET /api/dashboard?season=2026` (built by [`app.dashboard_data.build_dashboard_payload`](backend/app/dashboard_data.py)) and renders — so data is always fresh from the DB. The container bind-mounts `./frontend/dashboard`, so a rebuilt template is live on refresh (bind-mount caveat: a **rename** in `deploy-build.mjs` pins the mount to the old inode, so after `npm run build` restart the api container: `docker restart mlb-mv-api`).

### React build / dev (from `frontend/react/`)

```bash
npm install          # first time
npm run dev          # Vite dev server on :5173, proxies /api to the backend (no CORS)
npm run build        # vite build -> dist/index.html -> deploy-build.mjs -> ../dashboard/dashboard_template.html
npm test             # vitest: data-layer + scoring parity gate (13 tests)
```

`npm run build` is the only step that writes the served file; `deploy-build.mjs` writes atomically (temp file + rename), refuses to deploy a bundle with non-inlined assets or leaked internal paths, and creates `dashboard_template.html.bak` on first deploy for one-command rollback. `npm run dev` is for local development only — it never touches `frontend/dashboard/`.

**Offline snapshot (optional, legacy path).** To produce a single self-contained `dashboard_final.html` (fonts + data embedded) that works with no server — useful for emailing or opening from disk — run the two build scripts. They call the *same* [`build_dashboard_payload`](backend/app/dashboard_data.py) the API uses, so a snapshot and the live API can never diverge:

```bash
# local dev, from frontend/dashboard/ with the backend venv active
py build_dashboard.py 2026   # queries the DB, writes dashboard_data.json
py splice_dashboard.py       # bakes it into dashboard_final.html
```

`dashboard_final.html` is gitignored — it's a generated artifact. **Edit `frontend/react/src/` and run `npm run build`; never hand-edit `dashboard_template.html` or the final.** In the container, `splice_dashboard.py`'s `__DATA_JSON__` replacement is escaped for the `JSON.parse('...')` context so apostrophes in player names survive.

### Rollback

```bash
# restore the pre-migration legacy template (one command, zero backend involvement)
cp frontend/dashboard/dashboard_template.html.bak frontend/dashboard/dashboard_template.html
# then, because deploy-build.mjs renames files (inode change), restart the api container:
docker restart mlb-mv-api
# or, if git-tracked:
git checkout -- frontend/dashboard/dashboard_template.html
```

The `.bak` file is bind-mounted too but is never served (the backend serves only the exact filename `dashboard_template.html`), so it is safe to keep beside the template.

## Methodology notes

- **Score** = performance percentile − (pay weight × salary percentile), computed within position group each season. Performance percentile comes from a weighted composite of ~12-13 stats (expected stats, contact quality, plate discipline, fielding for batters), each scored as a z-score against the position average. All weights (including the pay weight) are live-adjustable in the dashboard's Weights tab.
- **Projections**: Marcel-style multi-year regression (weighted 3-year history of expected stats, regressed to league mean by sample size, age-adjusted) blended 50/50 with a nearest-neighbor "comparable player" projection (finds historically similar players at the same age/performance level and uses what they actually did the following season).
- **Pre-arbitration players** are excluded from the pay comparison (their salary is fixed near the league minimum by CBA rule, not market-determined) and instead get a projected market salary based on comparable market-priced peers.
- Full historical performance data (no salary) is backfilled 2015-2025; 2026 has both stats and salary.

## Scheduling

`scripts/nightly_refresh.ps1` runs the full pipeline (ingest → compute value → rebuild dashboard data + HTML) and logs to `scripts/logs/`. The last two steps call the legacy `build_dashboard.py` + `splice_dashboard.py` to regenerate the offline `dashboard_final.html` snapshot — they do **not** rebuild the React single-file that the container serves at `/`. The served `dashboard_template.html` is rebuilt only by `npm run build` (React), or by re-deploying the image. It's registered as a **Windows Task Scheduler** job (`MLBMarketValueNightlyRefresh`, daily at 3am, catch-up-if-missed enabled) rather than anything app-dependent — it runs whether or not Claude Code, or any other app, happens to be open. To register it on a new machine:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-ExecutionPolicy Bypass -File "<repo path>\scripts\nightly_refresh.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "MLBMarketValueNightlyRefresh" -Action $action -Trigger $trigger -Settings $settings -Description "Nightly refresh of mlb-market-value DB + dashboard data" -Force
```

Note this only refreshes the database and the local `dashboard_final.html` — it does not (and can't) update a published Claude Artifact link, since that requires the Artifact tool from an interactive Claude session. Ask Claude to republish when you want a shared link to reflect fresh data.

The task only runs while the machine is on; if it's asleep or off at 3am, `-StartWhenAvailable` runs it as soon as the machine is next active, rather than skipping straight to the next day.

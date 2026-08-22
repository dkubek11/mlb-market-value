# MLB Market Value

Correlates MLB player salaries with on-field performance. Pulls stats from the MLB Stats API, Statcast, and FanGraphs; computes a weighted, position-relative performance score; compares it to actual pay; and projects what a player's performance says they should be earning (including multi-year, comparable-player-based projections for regression/trend analysis).

The dashboard is a self-contained HTML build generated from the database by Python scripts — no separate frontend server, build toolchain, or runtime dependencies. [`build_dashboard.py`](frontend/dashboard/build_dashboard.py) queries the DB and [`splice_dashboard.py`](frontend/dashboard/splice_dashboard.py) bakes the payload (and fonts) into a single offline `dashboard_final.html`. See [Dashboard](#dashboard-live-data-vs-offline-snapshot) for the rebuild workflow.

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
    dashboard_template.html  the dashboard source (HTML/JS/CSS; data inlined by splice)
    team_colors.json          static team brand colors (consumed by the API payload; must stay put)
    build_dashboard.py        queries the DB fresh -> dashboard_data.json (offline snapshot path)
    splice_dashboard.py       bakes data + fonts into dashboard_final.html (offline snapshot path)
    headshots.py              fetches player headshot images from MLB's CDN
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

The dashboard is a single self-contained HTML file: the container serves [`dashboard_final.html`](frontend/dashboard/dashboard_final.html) at `/` when it exists (falling back to the raw `dashboard_template.html`), and it can equally be opened from disk or emailed. To rebuild it after editing `dashboard_template.html`:

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

The dashboard is built from the live DB by two Python scripts in `frontend/dashboard/`:

1. [`build_dashboard.py`](frontend/dashboard/build_dashboard.py) queries the DB and writes `dashboard_data.json`.
2. [`splice_dashboard.py`](frontend/dashboard/splice_dashboard.py) inlines that JSON plus the Rye/Courier fonts into `dashboard_final.html`.

The result is a fully self-contained offline HTML file that opens from disk, can be emailed, and is served at `/` by the container when present:

```bash
# from frontend/dashboard/, with the backend venv active
py build_dashboard.py 2026   # queries the DB, writes dashboard_data.json
py splice_dashboard.py       # bakes it into dashboard_final.html
```

> **Linux/SQLite dev:** `build_dashboard.py` resolves the backend relative to the
> repo (no hardcoded path), so just use the venv python and point `DATABASE_URL`
> at the local file, e.g. `DATABASE_URL="sqlite:///../../backend/mlb_market_value.db" python build_dashboard.py`
> from `frontend/dashboard/`. Windows/Postgres and the container need no override.

`dashboard_final.html` is gitignored — it's a generated artifact. **Edit `dashboard_template.html` (the CSS/JS source) and re-run the splice; never hand-edit `dashboard_final.html`.** The `__DATA_JSON__` replacement is escaped for the `JSON.parse('...')` context so apostrophes in player names survive.

The same payload is also available live at `GET /api/dashboard?season=YYYY` (built by [`app.dashboard_data.build_dashboard_payload`](backend/app/dashboard_data.py)) for any client that wants it without a splice.

### Rollback

`dashboard_template.html` is the source of truth and is git-tracked, so restoring the previous template is a single command:

```bash
git checkout -- frontend/dashboard/dashboard_template.html
```

No `.bak` copy is involved and no container restart is needed (the `/` route reads `dashboard_final.html` from disk per request, and regenerating it with `splice_dashboard.py` overwrites it in place).

## Methodology notes

- **Score** = performance percentile − (pay weight × salary percentile), computed within position group each season. Performance percentile comes from a weighted composite of ~12-13 stats (expected stats, contact quality, plate discipline, fielding for batters), each scored as a z-score against the position average. All weights (including the pay weight) are live-adjustable in the dashboard's Weights tab.
- **Projections**: Marcel-style multi-year regression (weighted 3-year history of expected stats, regressed to league mean by sample size, age-adjusted) blended 50/50 with a nearest-neighbor "comparable player" projection (finds historically similar players at the same age/performance level and uses what they actually did the following season).
- **Pre-arbitration players** are excluded from the pay comparison (their salary is fixed near the league minimum by CBA rule, not market-determined) and instead get a projected market salary based on comparable market-priced peers.
- Full historical performance data (no salary) is backfilled 2015-2025; 2026 has both stats and salary.

## Scheduling

`scripts/nightly_refresh.ps1` runs the full pipeline (ingest → compute value → rebuild dashboard data + HTML) and logs to `scripts/logs/`. The last two steps call `build_dashboard.py` + `splice_dashboard.py` to regenerate the offline `dashboard_final.html` snapshot, which is also what the container serves at `/`. It's registered as a **Windows Task Scheduler** job (`MLBMarketValueNightlyRefresh`, daily at 3am, catch-up-if-missed enabled) rather than anything app-dependent — it runs whether or not Claude Code, or any other app, happens to be open. To register it on a new machine:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-ExecutionPolicy Bypass -File "<repo path>\scripts\nightly_refresh.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "MLBMarketValueNightlyRefresh" -Action $action -Trigger $trigger -Settings $settings -Description "Nightly refresh of mlb-market-value DB + dashboard data" -Force
```

Note this only refreshes the database and the local `dashboard_final.html` — it does not (and can't) update a published Claude Artifact link, since that requires the Artifact tool from an interactive Claude session. Ask Claude to republish when you want a shared link to reflect fresh data.

The task only runs while the machine is on; if it's asleep or off at 3am, `-StartWhenAvailable` runs it as soon as the machine is next active, rather than skipping straight to the next day.

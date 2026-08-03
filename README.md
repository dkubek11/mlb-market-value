# MLB Market Value

Correlates MLB player salaries with on-field performance. Pulls stats from the MLB Stats API, Statcast, and FanGraphs; computes a weighted, position-relative performance score; compares it to actual pay; and projects what a player's performance says they should be earning (including multi-year, comparable-player-based projections for regression/trend analysis).

The live dashboard is a self-contained HTML build (`frontend/dashboard/`) generated from the database — no separate frontend server to run.

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
    dashboard_template.html  the dashboard (HTML/CSS/JS, single file)
    build_dashboard.py       queries the DB fresh -> dashboard_data.json
    splice_dashboard.py      bakes data + fonts into dashboard_final.html
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

## Running the pipeline

From `backend/`, with the venv active:

```
py -m app.pipeline.run_ingest --season 2026
py -m app.pipeline.run_compute_value --season 2026
```

`run_ingest` fetches everything for that season (stats, advanced metrics, salaries) and upserts it into Postgres. The pitch-by-pitch extension pull is the slowest step (~2-3 min for a full season). For a **historical backfill** (a season that's already over), add `--skip-salary` — RosterResource only exposes *current* rosters, so re-running the salary scrape against a past season would just relabel today's contracts under the wrong year, not recover what players actually earned then:

```
py -m app.pipeline.run_ingest --season 2023 --skip-salary
```

## Building the dashboard

From `frontend/dashboard/`, after the DB is populated:

```
py build_dashboard.py 2026   # queries the DB, writes dashboard_data.json
py splice_dashboard.py       # bakes it into dashboard_final.html
```

`dashboard_final.html` is a single self-contained file (fonts and data embedded) — open it directly in a browser, or serve it (`py -m http.server`) for local testing. It's regenerated from scratch each time, so it's gitignored; only the template and build scripts are tracked.

## Methodology notes

- **Score** = performance percentile − (pay weight × salary percentile), computed within position group each season. Performance percentile comes from a weighted composite of ~12-13 stats (expected stats, contact quality, plate discipline, fielding for batters), each scored as a z-score against the position average. All weights (including the pay weight) are live-adjustable in the dashboard's Weights tab.
- **Projections**: Marcel-style multi-year regression (weighted 3-year history of expected stats, regressed to league mean by sample size, age-adjusted) blended 50/50 with a nearest-neighbor "comparable player" projection (finds historically similar players at the same age/performance level and uses what they actually did the following season).
- **Pre-arbitration players** are excluded from the pay comparison (their salary is fixed near the league minimum by CBA rule, not market-determined) and instead get a projected market salary based on comparable market-priced peers.
- Full historical performance data (no salary) is backfilled 2015-2025; 2026 has both stats and salary.

## Scheduling

`scripts/nightly_refresh.ps1` runs the full pipeline (ingest → compute value → rebuild dashboard data + HTML) and logs to `scripts/logs/`. It's registered as a **Windows Task Scheduler** job (`MLBMarketValueNightlyRefresh`, daily at 3am, catch-up-if-missed enabled) rather than anything app-dependent — it runs whether or not Claude Code, or any other app, happens to be open. To register it on a new machine:

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-ExecutionPolicy Bypass -File "<repo path>\scripts\nightly_refresh.ps1"'
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "MLBMarketValueNightlyRefresh" -Action $action -Trigger $trigger -Settings $settings -Description "Nightly refresh of mlb-market-value DB + dashboard data" -Force
```

Note this only refreshes the database and the local `dashboard_final.html` — it does not (and can't) update a published Claude Artifact link, since that requires the Artifact tool from an interactive Claude session. Ask Claude to republish when you want a shared link to reflect fresh data.

The task only runs while the machine is on; if it's asleep or off at 3am, `-StartWhenAvailable` runs it as soon as the machine is next active, rather than skipping straight to the next day.

# MLB Market Value - Pay vs. Performance

## Project Overview / Rationale

MLB Market Value explores the relationship between player salaries and on-field performance. It pulls stats from the **MLB Stats API**, **Statcast**, and **FanGraphs**, scores each player against their peers at the same position, compares that score to what the player is actually paid, and projects what their performance says they should earn.

### Core logic

- **Performance score** — a weighted blend of ~12–13 advanced stats (expected hitting, contact quality, plate discipline, fielding), measured against the league average at the player's position.
- **Value score** — the gap between a player's performance percentile and their salary percentile. A positive score means they're likely underpaid; a negative score means overpaid.
- **Adjustable weights** — the importance of every stat, including pay, can be tuned live in the dashboard's Weights tab.
- **Projections** — multi-year salary estimates built from a player's recent performance, refined by how comparable players performed in the seasons that followed.
- **Pre-arbitration players** — excluded from the direct pay comparison because the CBA fixes their salary near the league minimum; they instead receive a projected market salary based on similar, market-priced players.

## Setup and Installation

### Quick start (SQLite)

The fastest way to run the project locally is `scripts/dev.sh` — it sets up the database and starts the server on `:8000`:

```bash
python -m venv backend/.venv                                   # first time only
backend/.venv/bin/pip install -r backend/requirements.txt      # first time only
scripts/dev.sh
```

Open **http://localhost:8000/** for the dashboard and **http://localhost:8000/docs** for the API docs. No Postgres or `.env` file is needed — a local SQLite database is created automatically. The script doesn't download stats on its own; use Docker for a fully automatic setup, or run the ingest/compute steps under [Local development](#local-development-postgres-no-docker) once and then re-run `scripts/dev.sh` to refresh the dashboard. `scripts/prod.sh` is the same flow without auto-reload.

### Docker (recommended)

The whole app — Postgres, API, and dashboard — runs as two containers:

```bash
docker compose up -d --build
```

- **http://localhost:8000/** → the dashboard
- **http://localhost:8000/docs** → API docs (Swagger UI)
- Postgres is exposed on host port **5433** (`psql -p 5433 -U postgres -d mlb_market_value`, password `postgres`) so it won't clash with a system Postgres on 5432.
- The database lives in the named volume `mlb_mv_pgdata` and survives `docker compose down`; use `docker compose down -v` to wipe everything.

On startup the container runs migrations, downloads the current season's data, computes values, builds the dashboard, and boots the API. Every step is idempotent, so restarts are fast. By default it ingests the current season (2026) only; set `HISTORY_SEASONS=3` before `docker compose up` to also backfill prior seasons for projection history:

```bash
SEASON=2026 HISTORY_SEASONS=3 docker compose up -d --build
```

> Backfilling prior seasons downloads a large amount of pitch-level data and can run out of memory on machines with limited RAM. If the API container crashes (exit code -9), stick with the default `HISTORY_SEASONS=0` — a single-season dashboard is fully functional.

### Local development (Postgres, no Docker)

1. Create a Postgres database (e.g. `mlb_market_value`).
2. Set up the Python environment:

   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate        # macOS/Linux (Windows: .venv\Scripts\activate)
   pip install -r requirements.txt
   ```

3. Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL` to your Postgres connection string.
4. Apply migrations and run the pipeline:

   ```bash
   cd backend
   alembic upgrade head
   python -m app.pipeline.run_ingest --season 2026
   python -m app.pipeline.run_compute_value --season 2026
   ```

   For a past season (e.g. 2023), add `--skip-salary` — salary data isn't available for historical seasons.

### Automated nightly refresh (Windows)

`scripts/nightly_refresh.ps1` runs the full pipeline (download data → compute values) and logs to `scripts/logs/`. It's registered as a Windows Task Scheduler job (`MLBMarketValueNightlyRefresh`, daily at 3am, with catch-up-if-missed enabled) and runs whether or not any app is open. The dashboard reads the refreshed data on the next page load (its snapshot cache expires after 30 minutes). See [README.local.md](README.local.md) for registration details.

## Architecture

### Repository layout

- `backend/` — the Python pipeline (stat downloads, scoring, projections), the FastAPI service, and database migrations.
- `frontend/dashboard/` — the dashboard template and the build scripts that turn database data into a single HTML file.
- `scripts/` — local run, validation, and scheduling helpers.
- `docs/` — planning, testing, and migration notes.

### Backend and frontend

The backend is a **Python/FastAPI** service backed by Postgres (SQLAlchemy + Alembic migrations). The dashboard is assembled from source parts (`frontend/dashboard/parts/`: `head/topbar/views.html` plus one JS module per feature) into a single HTML document that the API renders live: the `/` route concatenates the parts and inlines the current data snapshot and fonts at request time, so there's no separate frontend server, build toolchain, or offline build step. Edits under `frontend/dashboard/parts/` take effect on the next page load.

### Data sources

| Source | Data |
| --- | --- |
| MLB Stats API | Traditional batting/pitching stats |
| Statcast (pybaseball) | Expected stats (xBA/xSLG/xwOBA), exit velocity |
| Statcast (pitch-level) | Full-season pitch-by-pitch data for pitcher release extension |
| FanGraphs | Batter/pitcher plate discipline (chase%, whiff%), Stuff+/Location+ for pitchers, DRS fielding |
| RosterResource (via FanGraphs) | Contracts and salary data |
| MLB CDN | Player headshots and team logos (dashboard assets only) |

**Coverage:**

- The current season (2026) includes full stats, advanced metrics, and salaries.
- Seasons 2015–2025 are backfilled with performance data only — RosterResource exposes only *current* rosters, so historical salary data isn't available.

## Collaboration Credits

- Dylan Kubek, dkubek11
- Nathaniel Martinez, natemartinez

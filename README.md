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

Open **http://localhost:8000/** for the dashboard and **http://localhost:8000/docs** for the API docs. No Postgres or `.env` file is needed — a local SQLite database is created automatically by `scripts/dev.sh`. The script doesn't download stats on its own; use Docker for a fully automatic setup, or ingest data locally via SQLite (see [README.local.md §4](README.local.md#4-ingest-data)) and refresh the page (the dashboard's snapshot cache reloads fresh with `?refresh=1`). `scripts/prod.sh` is the same flow without auto-reload.

### Docker (recommended)

The whole app — Postgres, API, and dashboard — runs as two containers:

```bash
docker compose up -d --build
```

- **http://localhost:8000/** → the dashboard
- **http://localhost:8000/docs** → API docs (Swagger UI)
- Postgres is exposed on host port **5433** (`psql -p 5433 -U postgres -d mlb_market_value`, password `postgres`) so it won't clash with a system Postgres on 5432.
- The database lives in the named volume `mlb_mv_pgdata` and survives `docker compose down`; use `docker compose down -v` to wipe everything.

On startup the container runs migrations, downloads the current season's data, computes values, and boots the API (which serves the dashboard live at `/`). Every step is idempotent, so restarts are fast. By default it ingests the current season (2026) only; set `HISTORY_SEASONS=3` before `docker compose up` to also backfill prior seasons for projection history:

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

### Automated nightly refresh

The refresh scripts run the pipeline (download current stats → compute player and team values) and log to `scripts/logs/`:
- **Windows**: `scripts/nightly_refresh.ps1` (registered via Windows Task Scheduler, runs daily at 3am, with catch-up-if-missed enabled). See [README.local.md](README.local.md#scheduling) for registration details.
- **macOS / Linux**: `scripts/nightly_refresh.sh` (can be run via crontab):
  ```bash
  # Run daily at 3:00 AM
  0 3 * * * /path/to/mlb-market-value/scripts/nightly_refresh.sh
  ```
The dashboard reads the refreshed data on the next page load (its snapshot cache expires after 30 minutes, or pass `?refresh=1` to force immediate reload).

## Architecture

### Repository layout

- `backend/` — the Python pipeline (stat downloads, scoring, projections), the FastAPI service, database migrations, and validation/backtest tools (`backend/scripts/`).
- `frontend/dashboard/` — the dashboard template (`dashboard_template.html`), embedded assets (fonts/textures), and `build_dashboard.py` which computes the live data snapshot for FastAPI.
- `scripts/` — local dev (`dev.sh`, `prod.sh`), automation, and scheduling helpers.
- `docs/` — planning, testing, and migration notes.

### Backend and frontend

The backend is a **Python/FastAPI** service backed by Postgres (SQLAlchemy + Alembic migrations). The dashboard is a single HTML file (`dashboard_template.html`) that the API renders live: the `/` route inlines the current data snapshot and fonts at request time, so there's no separate frontend server, build toolchain, or offline build step. Edits to `frontend/dashboard/dashboard_template.html` take effect on the next page load (pass `?refresh=1` to immediately bypass the snapshot and template cache).

### API Endpoints

FastAPI serves both the live web dashboard and REST API endpoints (interactive Swagger UI at `/docs`):

| Endpoint | Method | Key Parameters | Description |
| --- | --- | --- | --- |
| `/` | `GET` | `season` (int), `refresh` (bool) | Serves the interactive dashboard HTML with inlined fonts and data snapshot |
| `/health` | `GET` | — | Health check, returns `{"status": "ok"}` |
| `/api/dashboard` | `GET` | `season` (int), `fetch_live_contracts` (bool) | Full dashboard data payload (players, teams, rosters, contracts) as JSON |
| `/players/value` | `GET` | `season` (int), `position` (str), `sort` (str), `order` (asc/desc), `limit` (int) | Market-priced players ranked by value score |
| `/players/projected` | `GET` | `season` (int), `position` (str), `sort` (str), `order` (asc/desc), `limit` (int) | Pre-arbitration & MiLB players with projected market salaries & surplus value |
| `/teams/payroll` | `GET` | `season` (int), `sort` (str), `order` (asc/desc) | Team payroll totals and average value scores |

### Environment Variables

| Variable | Default | Scope | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg2://postgres:postgres@localhost:5432/mlb_market_value` | All | SQLAlchemy connection string. Set to `sqlite:///mlb_market_value.db` for local SQLite. |
| `SEASON` | Current year (e.g. `2026`) | Pipeline / Docker | Primary season year to ingest and compute with salaries. |
| `HISTORY_SEASONS` | `0` (Compose), `3` (Dockerfile) | Pipeline / Docker | Number of prior seasons to backfill (`--skip-salary`) for multi-year projections. |
| `SKIP_LIVE_CONTRACTS` | — | Backend / API | If set (e.g. `SKIP_LIVE_CONTRACTS=1`), skips the live FanGraphs contract scrape for sub-second responses. |
| `PYTHONPATH` | — | Local CLI | Must include `backend` when running module commands from repo root. |

### Data sources

| Source | Data |
| --- | --- |
| MLB Stats API | Traditional batting/pitching stats, player bios, and major awards (MVP, Cy Young, ROY, All-Star, Silver Slugger, Gold Glove) |
| Statcast (pybaseball) | Expected stats (xBA/xSLG/xwOBA), contact quality, exit velocity, and Outs Above Average (OAA) / Fielder Run Value (FRV) |
| Statcast (pitch-level) | Full-season pitch-by-pitch data for pitcher release extension |
| FanGraphs | Batter/pitcher plate discipline (chase%, whiff%), Stuff+/Location+ for pitchers, DRS fielding, and fWAR / wRC+ |
| RosterResource (via FanGraphs) | Current contracts and salary data |
| MLB Trade Rumors (MLBTR) | Official arbitration service time (years.days) and historical arbitration settlements |
| MLB CDN | Player headshots and team logos (dashboard assets only) |

**Coverage:**

- The current season (2026) includes full stats, advanced metrics, and salaries.
- Seasons 2015–2025 are backfilled with performance data only — RosterResource exposes only *current* rosters, so historical salary data isn't available.

## Collaboration Credits

- Dylan Kubek, dkubek11
- Nathaniel Martinez, natemartinez

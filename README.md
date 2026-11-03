# MLB Market Value - Pay vs. Performance

## Project Overview / Rationale

MLB Market Value explores the relationship between player salaries and on-field performance. It pulls stats from the **MLB Stats API**, **Statcast**, and **FanGraphs**, scores each player against their peers at the same position, compares that score to what the player is actually paid, and projects what their performance says they should earn.

## Core logic

- **Performance score** — a weighted blend of ~12–13 advanced stats (expected hitting, contact quality, plate discipline, fielding), measured against the league average at the player's position.
- **Value score** — the gap between a player's performance percentile and their salary percentile. A positive score means they're likely underpaid; a negative score means overpaid.
- **Adjustable weights** — the importance of every stat, including pay, can be tuned live in the dashboard's Weights tab.
- **Projections** — multi-year salary estimates built from a player's recent performance, refined by how comparable players performed in the seasons that followed.
- **Pre-arbitration players** — excluded from the direct pay comparison because the CBA fixes their salary near the league minimum; they instead receive a projected market salary based on similar, market-priced players.

## Setup and Installation

### Quick start (SQLite)

```bash
python -m venv backend/.venv                                   # first time only
backend/.venv/bin/pip install -r backend/requirements.txt      # first time only
scripts/dev.sh
```
The fastest way to run the project locally is `scripts/dev.sh` — it sets up the database and starts the server on `:8000`



### Docker (recommended)

```bash
docker compose up -d --build
```
The whole app — Postgres, API, and dashboard — runs as two containers:

## Architecture - Repository Layout

- `backend/` — the Python pipeline (stat downloads, scoring, projections), the FastAPI service, database migrations, and validation/backtest tools (`backend/scripts/`).

- `frontend/dashboard/` — the live-rendered dashboard source (`parts/`: `head/topbar/views.html` plus one JS module per feature), embedded assets (fonts/textures), and `build_dashboard.py` which computes the live data snapshot for FastAPI.

- `scripts/` — local dev (`dev.sh`, `prod.sh`), automation, and scheduling helpers.

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

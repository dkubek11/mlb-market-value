# Test Plan & Execution Procedures

How to verify that the MLB Market Value application runs correctly across development and production environments.

Two primary runtime paths exist:

| Path | DB | Requirements | Typical use |
|---|---|---|---|
| **A. Docker / Postgres** | Postgres 16 container (`mlb-mv-db`) | Docker & Compose | Production-like stack, automatic backfill |
| **B. SQLite local dev** | SQLite file (`mlb_market_value.db`) | Python 3.12+ / 3.13, no Docker | Zero-infra local dev & testing |

Tests are grouped by what they verify. Every section has an **Environment setup**, **Startup**, and **Validation** procedure.

---

## 1. Environment Setup & Dependencies

Set up the Python environment from the repository root:

```bash
python -m venv backend/.venv
source backend/.venv/bin/activate       # macOS / Linux
# backend\.venv\Scripts\activate       # Windows
pip install -r backend/requirements.txt
```

Verify the environment:

```bash
python -c "import fastapi, sqlalchemy, alembic, pydantic, pybaseball; print('Environment OK')"
```

---

## 2. Database Migrations

### Path B: SQLite (Local Scratch Database)

Run migrations against an isolated scratch database to verify the schema without modifying live data:

```bash
cd backend
DATABASE_URL="sqlite:////tmp/mlb_mv_test.db" alembic upgrade head
DATABASE_URL="sqlite:////tmp/mlb_mv_test.db" alembic current
```

**Expected:**
- `alembic current` reports head revision `8d995c8678d3`.
- Re-running `upgrade head` is an idempotent no-op.
- Creates the 11 core tables:
  - `players`
  - `teams`
  - `player_seasons`
  - `team_payroll_summary`
  - `batter_stats`
  - `pitcher_stats`
  - `fielding_stats`
  - `player_value`
  - `player_salaries`
  - `arb_outcomes`
  - `player_awards`

> [!NOTE]
> SQLite requires the `player_value` primary key constraint to be named (`name='player_value_pkey'`) in the initial migration for batch operations in SQLite.

### Path A: Postgres (Production Parity)

```bash
cd backend
# Export POSTGRES_USER / POSTGRES_PASSWORD first; never commit the password.
DATABASE_URL="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/mlb_market_value" alembic upgrade head
```

*(Note: In the Docker Compose stack, migrations run automatically on container startup via `app.pipeline.run_all`.)*

---

## 3. Pipeline CLI Verification

Verify that all ingestion and compute entry points load their modules and parse CLI options:

```bash
cd backend
python -m app.pipeline.run_ingest --help
python -m app.pipeline.run_compute_value --help
python -m app.pipeline.run_all --help
```

**Expected:**
- `run_ingest`: Supports `--season <YEAR>` and `--skip-salary` (for historical seasons without current contract data).
- `run_compute_value`: Supports `--season <YEAR>` to compute position percentiles, value scores, and team payroll summaries.
- `run_all`: Supports `--season`, `--history-seasons`, and `--migrate-only`.

---

## 4. Backend API & Live Dashboard Smoke Test

Start the server against your database:

```bash
cd backend
DATABASE_URL="sqlite:///./mlb_market_value.db" uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Validate core endpoints in another terminal:

```bash
# 1. Service health check
curl -fsS http://localhost:8000/health
# Expected: {"status":"ok"}

# 2. Interactive Swagger documentation
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:8000/docs
# Expected: 200

# 3. Live Dashboard HTML rendering
curl -fsS http://localhost:8000/ | grep -q "MLB Market Value" && echo "Dashboard renders OK"
# Bypassing cache to force dynamic re-rendering:
curl -fsS "http://localhost:8000/?refresh=1" | grep -q "MLB Market Value" && echo "Live refresh OK"

# 4. JSON Dashboard Payload
curl -fsS "http://localhost:8000/api/dashboard?season=2026&fetch_live_contracts=false" | head -c 120
# Expected: JSON object with keys: allPlayers, positionStats, teams, rosters, teamColors, contracts, capturedAt

# 5. Domain Endpoints (returns 200 OK and JSON array)
curl -fsS "http://localhost:8000/players/value?season=2026&limit=5"
curl -fsS "http://localhost:8000/players/projected?season=2026&limit=5"
curl -fsS "http://localhost:8000/teams/payroll?season=2026"
```

> **Latency Note:** Passing `fetch_live_contracts=true` (the default for `/api/dashboard`) initiates a live scrape from FanGraphs RosterResource. In restricted network environments or for local testing, pass `fetch_live_contracts=false` or set `SKIP_LIVE_CONTRACTS=1` for instant sub-second responses.

---

## 5. API Schema Contract Validation

The API payload contract is validated with strict Pydantic models to ensure that frontend expectations and backend serialization never drift.

Run from `backend/`:

```bash
cd backend
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m scripts.validate_api_schema --season 2026
```

**Options:**
- `--allow-empty`: Skips row count minimums (useful for verifying schema on an un-ingested database).
- `--fixture <PATH>`: Validates an offline JSON payload dump (e.g. `frontend/dashboard/dashboard_data.json`) without hitting a live database or network.

---

## 6. Projections Engine Backtesting

Validate the predictive accuracy of the Marcel regression + historical comp blend against real outcomes:

```bash
cd backend
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m scripts.backtest_projections
```

**Expected:**
- Evaluates target seasons using 3-year historical windows (`Y-3` to `Y-1`).
- Compares blended projections against naive baseline (prior year's raw numbers).
- Validates that composite true-talent metrics outperform unadjusted prior-year stats.

### Supplementary Backfill Scripts (Optional)

To verify targeted backfill operations on an existing database:

```bash
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m scripts.backfill_traditional_stats
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m scripts.backfill_awards
DATABASE_URL="sqlite:///./mlb_market_value.db" python -m scripts.backfill_arb_outcomes
```

---

## 7. Nightly Refresh Automation Test

Verify that the automated maintenance scripts execute cleanly:

### macOS / Linux
```bash
./scripts/nightly_refresh.sh
```

### Windows (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\nightly_refresh.ps1
```

**Validation:**
- Check that output is written to `scripts/logs/refresh_<TIMESTAMP>.log`.
- Verify that older logs beyond the 30 most recent files are pruned automatically.

---

## 8. Containerized Stack (Docker Compose)

Requires Docker Desktop or the Docker Engine daemon.

### Boot the stack:

```bash
export POSTGRES_PASSWORD='choose-a-local-password'
docker compose up -d --build
```

### Validation:

```bash
# Verify containers are healthy
docker compose ps

# Check API health
curl -fsS http://localhost:8000/health

# Verify Postgres container accessibility on host port 5433
psql -p 5433 -h localhost -U postgres -d mlb_market_value -c '\dt'

# Verify logs
docker compose logs api --tail 50
```

### Tear down:

```bash
# Keep database volume
docker compose down

# Wipe database volume for a clean test
docker compose down -v
```

---

## 9. Test Matrix Summary

| # | Area | Command / Procedure | Environment | Status |
|---|---|---|---|---|
| 1 | Python Environment | `python -c "import ..."` | Local | Verified |
| 2 | SQLite Migrations | `alembic upgrade head` | Local (SQLite) | Verified |
| 3 | Postgres Migrations | `alembic upgrade head` | Postgres | Verified |
| 4 | Pipeline Entry Points | `python -m app.pipeline.<module> --help` | Any | Verified |
| 5 | API Smoke & Live UI | `curl` against `:8000/*` | Local / Docker | Verified |
| 6 | API Schema Contract | `python -m scripts.validate_api_schema` | Local / Docker | Verified |
| 7 | Projections Backtest | `python -m scripts.backtest_projections` | Populated DB | Verified |
| 8 | Nightly Refresh Script | `scripts/nightly_refresh.(sh\|ps1)` | Linux / macOS / Win | Verified |
| 9 | Docker Multi-Service | `docker compose up -d --build` | Docker Host | Verified |

---

## 10. Known Issues / Environment Notes

1. **SQLite Named Constraint:** SQLite requires table constraints to be explicitly named in earlier migrations (e.g. `player_value_pkey`) so that subsequent batch migrations (like `d77ee9e7a03c`) can alter columns without syntax errors.
2. **FanGraphs Rate Limiting / Timeouts:** Scraping contracts synchronously for 30 clubs can take 15–20 seconds on cold cache. The dashboard caches these contracts to disk with a 12-hour TTL. Set `SKIP_LIVE_CONTRACTS=1` or pass `fetch_live_contracts=false` to bypass the scrape during local tests.
3. **Statcast Memory Footprint:** Running `HISTORY_SEASONS=3` backfills pitch-by-pitch Statcast data for release extension calculations, requiring up to 4GB of RAM. Single season ingest (`HISTORY_SEASONS=0`) is recommended on memory-constrained systems.

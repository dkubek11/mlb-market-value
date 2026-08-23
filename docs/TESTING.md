# Test Plan & Execution Procedures

How to verify the MLB Market Value application runs correctly in a given
environment, plus the results of executing it in the environment this document
was written in.

Two runtime paths exist:

| Path | DB | Requirements | Typical use |
|---|---|---|---|
| **A. Docker/Postgres** | Postgres 16 container | Docker + Compose, network egress for ingest | Production-like stack |
| **B. SQLite local dev** | SQLite file (`mlb_market_value.db`) | Python 3.12+/3.13, no Docker | Zero-infra local dev |

Tests are grouped by what they verify. Every section has an **Environment
setup**, **Startup**, and **Validation** procedure, and a **Result** noting
whether it was executed in the authoring environment.

---

## 0. Environment summary (authoring environment)

| Capability | Status |
|---|---|
| Python | 3.13.12 (`backend/.venv`) |
| Node | v20.19.5 (via nvm) |
| Docker / Compose | **absent** |
| Postgres server | **absent** |
| SQLite (stdlib) | available |
| Outbound network | available (ingest sources reachable) |

Because Docker and Postgres are unavailable, only **Path B (SQLite)** is fully
executable here. Path A is documented with commands and marked **manual**.

> Environment quirk observed: `uvicorn --host 127.0.0.1` binds IPv4 only, while
> the Vite dev server resolves `localhost` to `::1` (IPv6). For end-to-end
> proxy testing bind uvicorn dual-stack with `--host ::`, or use `localhost`
> consistently on both sides.

---

## 1. Frontend tests (React + Vitest)

**Env setup**

```bash
export PATH="$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"   # if node not on PATH
cd frontend
npm ci            # first time / after lockfile changes
```

**Run**

```bash
npm test
```

**Expected**

```
Test Files  4 passed (4)
     Tests  24 passed (24)
```

Covers the data-layer client (`api/`), the league-value grid, the
**contract parity gate** (TypeScript validator accepts the shared fixture in
§10), and the **scoring parity gate** (golden-file comparison of the ported
scoring engine against the legacy engine's output — the guard against silent
number drift).

**Result in authoring environment:** ✅ PASSED — 24/24 tests.

---

## 2. Frontend production build (single-file bundle)

**Run**

```bash
cd frontend
npm run build
```

The build chain is `prebuild-guard.mjs` → `vite build` → `verify-build.mjs`.

**Expected**

- `dist/index.html` is produced (~280 KB).
- `prebuild-guard.mjs` passes (or "first build" message on a clean checkout).
- `verify-build.mjs` prints:
  `verify-build: .../dist/index.html is self-contained (… bytes)`
  and exits 0. It fails the build if the bundle contains non-inlined
  `src=`/`href=` (would 404), `/assets/` references (inlining failed), or
  leaked internal paths (`/app/`, `frontend`, `backend/`, `home/<user>`).

**Result:** ✅ PASSED — `dist/index.html` (280,107 bytes), verify-build passed.

---

## 3. Database migrations (Path B — SQLite)

**Env setup**

```bash
cd backend
python -m venv venv && source venv/bin/activate   # first time
pip install -r requirements.txt
```

**Run** (against a scratch DB so nothing real is touched)

```bash
DATABASE_URL="sqlite:////tmp/mlb_mv_testplan.db" alembic upgrade head
DATABASE_URL="sqlite:////tmp/mlb_mv_testplan.db" alembic current
```

**Expected**

- `alembic current` reports the head revision (currently `8d995c8678d3`).
- Re-running `upgrade head` is a **no-op** (idempotency).
- The SQLite file contains the 11 app tables: `players`, `teams`,
  `player_seasons`, `team_payroll_summary`, `batter_stats`, `pitcher_stats`,
  `fielding_stats`, `player_value`, `player_salaries`, `arb_outcomes`,
  `player_awards`.

**Important constraint:** the batch PK migration `d77ee9e7a03c` requires the
`player_value` primary key to be **named** (`name='player_value_pkey'`) in the
initial migration `88cd165faed0`. Without that name, the SQLite chain fails
with `ValueError: No such constraint: 'player_value_pkey'`. This naming also
matches Postgres's own default PK constraint name, so it is safe on both
dialects.

**Result:** ✅ PASSED (after applying the PK-name fix) — head reached,
idempotent, 11 tables created.

---

## 4. Database migrations (Path A — Postgres, manual)

Requires a reachable Postgres and `DATABASE_URL` set accordingly.

```bash
cd backend
DATABASE_URL="postgresql+psycopg2://postgres:postgres@localhost:5432/mlb_market_value" alembic upgrade head
```

Or, in the Docker stack (see §8), migrations run automatically on container
boot via `app.pipeline.run_all`.

**Result:** not executed (no Postgres/Docker in authoring environment).

---

## 5. Backend API smoke test

**Startup** (Path B)

```bash
cd backend
DATABASE_URL="sqlite:////tmp/mlb_mv_testplan.db" uvicorn app.main:app --host :: --port 8000
```

(Use `--host ::` for dual-stack, or `--host 127.0.0.1` if you only need IPv4.)

**Validation**

```bash
curl -s -w "[%{http_code}]\n" http://localhost:8000/health                        # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/docs               # 200 (Swagger UI)
curl -s http://localhost:8000/ | grep -c '__DATA_JSON__'                          # 0 (React build, not legacy splice)
curl -s http://localhost:8000/ | grep -o '<div id="root"></div>'                  # present (React mount)
curl -s -w "[%{http_code}]\n" "http://localhost:8000/api/dashboard?season=2026&fetch_live_contracts=false"
curl -s -w "[%{http_code}]\n" "http://localhost:8000/players/value?season=2026"
curl -s -w "[%{http_code}]\n" "http://localhost:8000/players/projected?season=2026"
curl -s -w "[%{http_code}]\n" "http://localhost:8000/teams/payroll?season=2026"
```

**Expected**

- `/health` → 200 `{"status":"ok"}`.
- `/` → the React single-file app (280,227 bytes, `content-type: text/html`),
  no `__DATA_JSON__`, `<div id="root">` present. `_DASHBOARD_TEMPLATE` resolves
  to `frontend/dist/index.html`.
- `/api/dashboard` → payload with the 7 top-level keys (`allPlayers`,
  `positionStats`, `teams`, `rosters`, `teamColors`, `contracts`,
  `capturedAt`). `teamColors` must contain 30 teams — this proves
  `frontend/team_colors.json` resolves from its new location.
- `/players/value`, `/players/projected`, `/teams/payroll` → 200 with `[]` on
  an empty DB, or rows after ingest.

> Latency note: `/api/dashboard` with the default `fetch_live_contracts=true`
> performs a live FanGraphs contract fetch and can take ~20 s (or longer) when
> egress is restricted. `fetch_live_contracts=false` returns in milliseconds.
> This is external-network behavior, not a defect.

**Result:** ✅ PASSED — all endpoints 200 with correct shapes; `teamColors`
has 30 teams; `/` serves the React bundle.

---

## 6. Frontend dev server + API proxy (Path B)

**Startup** (two terminals)

```bash
# Terminal 1 — backend (must be on :8000; Vite proxies /api there)
cd backend
DATABASE_URL="sqlite:////tmp/mlb_mv_testplan.db" uvicorn app.main:app --host :: --port 8000

# Terminal 2 — Vite dev server
cd frontend
npm run dev        # prints Local: http://localhost:5174/ (or 5173 if free)
```

**Validation**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5174/src/main.tsx      # 200 (TSX transforms)
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5174/api/dashboard?season=2026&fetch_live_contracts=false"
```

**Expected**

- Vite serves `index.html` and transforms `/src/main.tsx` (200, `text/javascript`).
- `GET /api/dashboard` **through the Vite proxy** returns 200 and a payload
  byte-identical to hitting the backend directly (proxy config:
  `server.proxy['/api'] → http://localhost:8000` in `vite.config.ts`). The
  browser never makes a cross-origin request (backend has no CORS headers).

**Result:** ✅ PASSED — proxy returns the same payload as the direct backend
call (verified with `cmp`); ~20 s latency only when `fetch_live_contracts=true`.

---

## 7. Pipeline entry points (ingest / compute)

**Run**

```bash
cd backend
DATABASE_URL="sqlite:////tmp/mlb_mv_testplan.db" python -m app.pipeline.run_ingest --help
DATABASE_URL="sqlite:////tmp/mlb_mv_testplan.db" python -m app.pipeline.run_compute_value --help
DATABASE_URL="sqlite:////tmp/mlb_mv_testplan.db" python -m app.pipeline.run_all --help
```

**Expected**

- `run_ingest --season 2026` (current season: stats + salaries) and
  `--skip-salary` (historical backfill) flags documented in `--help`.
- `run_compute_value --season 2026` computes `player_value` +
  `team_payroll_summary`.
- `run_all` is the container entrypoint (migrations → ingest → compute → boot).

**Full ingest is not run in this test** because it pulls live data from MLB
Stats API / Statcast / FanGraphs / RosterResource and the pitch-by-pitch
backfill is memory-hungry. It requires network egress and is documented in
README.md ("Running the pipeline").

**Result:** ✅ PASSED (CLI verification only) — all three entry points
import and expose their argument parsers.

---

## 8. Containerized stack (Path A — manual)

Requires Docker + Compose. **Not executable in the authoring environment.**

```bash
cd /path/to/mlb-market-value
cd frontend && npm ci && npm run build   # dist/ must exist for the image COPY
cd ../..
docker compose up -d --build
```

**Validation**

```bash
curl -s http://localhost:8000/health                          # {"status":"ok"}
curl -s http://localhost:8000/ | grep -c '__DATA_JSON__'      # 0
curl -s "http://localhost:8000/api/dashboard?season=2026&fetch_live_contracts=false" | head -c 200
psql -p 5433 -U postgres -d mlb_market_value -c '\dt'         # 11 tables after boot
docker compose ps                                            # db healthy, api healthy
```

**Expected**

- The api container runs `run_all` on boot: migrations → conditional ingest →
  compute → uvicorn.
- The image `COPY`s `frontend/dist` and `frontend/team_colors.json`
  (Dockerfile), and compose bind-mounts both for live edits. Rebuilt bundles
  are served on refresh without an image rebuild.
- DB persists in the named volume `mlb_mv_pgdata`.

---

## 9. Consolidated frontend — post-migration assertions

These verify the directory consolidation landed correctly (branch
`swa/frontend-consolidation`):

1. **One frontend directory**: `frontend/` contains only `react/`.
   ```bash
   ls frontend/            # react  (dashboard/ removed)
   ```
2. **No legacy references in code/config** (historical `plans/`/`logs/` docs
   and the legitimate `build_dashboard_payload` function name excepted):
   ```bash
   grep -rn "dashboard_template\|build_dashboard\.py\|splice_dashboard\.py\|frontend/dashboard" \
     --include="*.py" --include="*.ts" --include="*.tsx" --include="*.mjs" \
     --include="*.json" --include="*.ps1" --include="*.yml" --include="Dockerfile" . \
     | grep -v node_modules | grep -v '/\.git/' | grep -vE '^(\./)?(plans/|\.kilo/plans/|logs/)' \
     | grep -v build_dashboard_payload || echo CLEAN
   ```
3. **Backend paths point at `frontend/`**:
   - `_DASHBOARD_TEMPLATE` → `frontend/dist/index.html`
     (`backend/app/main.py`).
   - `_TEAM_COLORS_PATH` → `frontend/team_colors.json`
     (`backend/app/dashboard_data.py`).
4. **Docker/compose reference the new locations** (Dockerfile COPY, compose
   bind mounts).
5. **Nightly refresh** (`scripts/nightly_refresh.ps1`) runs ingest → compute →
   `npm test` → `npm run build`; the legacy `build_dashboard.py`/`splice`/`validate` steps are gone.

**Result:** ✅ PASSED — stale-reference sweep returned `CLEAN`; all paths and
scripts updated.

---

## 10. API contract validator (Pydantic) + parity gate

Validates the `GET /api/dashboard` payload against Pydantic models that mirror
`frontend/src/api/types.ts` exactly. Catches backend-side contract drift
before the browser ever renders.

**Live mode** (builds the payload from the DB via `build_dashboard_payload`):
```bash
cd backend
DATABASE_URL="sqlite:///./mlb_market_value.db" .venv/bin/python -m scripts.validate_api_schema --season 2026
```
- Requires a populated season (fails on empty `allPlayers` / missing `teamColors`).
- `--allow-empty` skips the data-presence thresholds for a schema-only check.
- `fetch_live_contracts=False` is hardcoded — no FanGraphs scrape runs.

**Fixture mode** (offline, no DB/network — validates the shared contract corpus):
```bash
cd backend
.venv/bin/python -m scripts.validate_api_schema \
  --fixture ../frontend/src/__tests__/fixtures/dashboard-payload.json
```

**Parity gate** — both runtimes must accept the same fixture:
```bash
cd frontend && npm test -- contract.parity        # TS validator accepts fixture
cd backend && .venv/bin/python -m scripts.validate_api_schema \
  --fixture ../frontend/src/__tests__/fixtures/dashboard-payload.json
```
If the backend adds/renames a payload key, both validators must be updated
together — either side failing the fixture is the drift signal.

**Result:** ✅ PASS — live mode validates the ingested 2026 season (763 players,
30 teams, 30 rosters, 30 teamColors); fixture mode validates the 624-player
corpus; parity tests green.

---

## 11. Test matrix summary

| # | Area | Procedure | Env | Status |
|---|---|---|---|---|
| 1 | Frontend unit/parity tests | §1 | B | ✅ PASS (24/24) |
| 2 | Frontend build + integrity | §2 | B | ✅ PASS |
| 3 | SQLite migrations | §3 | B | ✅ PASS (after PK-name fix) |
| 4 | Postgres migrations | §4 | A | ⏸ manual |
| 5 | Backend API smoke | §5 | B | ✅ PASS |
| 6 | Vite dev server + proxy | §6 | B | ✅ PASS |
| 7 | Pipeline entry points | §7 | B | ✅ PASS (CLI only) |
| 8 | Docker stack | §8 | A | ⏸ manual |
| 9 | Post-consolidation assertions | §9 | any | ✅ PASS |
| 10 | API contract validator + parity | §10 | B | ✅ PASS (763 players, fixture + parity green) |

Legend: **B** = SQLite local dev (executable here); **A** = Docker/Postgres
(manual); ⏸ = not executed in the authoring environment.

---

## 11. Known issues / environment notes

1. **SQLite migration gate requires the named PK fix.** The committed batch
   migration `d77ee9e7a03c` needs `player_value`'s PK named in `88cd165faed0`.
   The fix (`name='player_value_pkey'`) was applied during this test session and
   must be kept if the SQLite path is to work. Postgres is unaffected (it
   auto-names that constraint identically).
2. **IPv4/IPv6 mismatch.** uvicorn on `127.0.0.1` is unreachable from Vite's
   proxy when `localhost` resolves to `::1`. Use `--host ::` for the backend
   when testing the dev proxy.
3. **Live FanGraphs contract fetch** can make `/api/dashboard` slow (~20 s)
   under restricted egress; `fetch_live_contracts=false` skips it.
4. **Docker/Postgres path not verified here** — no Docker or Postgres server
   is installed in the authoring environment. See §4/§8 for manual procedures.
5. **`README.local.md` / `DEPLOYMENT.md` path references** need the same
   `frontend/dashboard` → `frontend` updates when those files land
   (they were untracked on a stashed branch during this consolidation).

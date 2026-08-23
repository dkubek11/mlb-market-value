# Session Summary — MLB Market Value: API Contract Hardening, Schema Validation & Reliability Fixes

**Session date:** 2026-08-12 → 2026-08-13
**Branch:** `swa/frontend-consolidation` (working tree had pre-existing staged changes; nothing was committed this session)
**Environment:** Linux, SQLite local-dev path (no Docker/Postgres), Python 3.13.12 venv at `backend/.venv`, Node v20.19.5, React 18 + Vite 5 + Vitest

---

## 1. Overview

The session executed an accepted 7-task plan (`.kilo/plans/1786572105918-api-contract-validator-plan.md`) to make the `/api/dashboard` payload contract robust and verifiable. The dashboard is a built React SPA served at `GET /` by FastAPI; it fetches its data live from `GET /api/dashboard?season=2026` at page load. The work focused on:

1. **Contract decision:** the shipped contract is **7 top-level keys** — `allPlayers, positionStats, teams, rosters, teamColors, contracts, capturedAt`. Arbitration-feature keys (`serviceTime`, `arbGrade`, `awards`, `salaryHistory`, `positionStatsHistory`, `historicalArbOutcomes`) are DB tables/columns only and are explicitly **out of scope** as an un-shipped feature.
2. **Three confirmed bugs fixed** (empty-DB dead-code, salary inner-JOIN, `teamColors` 500).
3. **A new Pydantic contract validator** mirroring the TS types, plus a TS/Python parity gate.
4. **Two pre-existing bugs discovered during implementation** (SQLite date binding, `NaN` in payload) and fixed.
5. **A dashboard time-out bug** (unbounded live contract scrape) fixed with caching + time bounding.
6. **Documentation cleanup** (README.md, README.local.md, TESTING.md).

---

## 2. Technical Breakdown of Changes

### 2.1 Frontend — empty-DB state fix (`frontend/react/src/api/client.ts`, `data-layer.test.ts`)

**Problem:** `validateDashboardPayload` rejected empty `allPlayers`/`teams` arrays with "not a non-empty array". This made the `empty` state in `useDashboardData.ts` dead code: an empty DB (pre-ingest) surfaced as an ErrorBanner instead of the intended EmptyState.

**Change:**
- Removed the non-empty-array requirement for `allPlayers` and `teams` in `validateDashboardPayload` — structural validation only (`Array.isArray` + spot-check of up to 3 records).
- Empty data is now a caller decision: `useDashboardData` returns `empty` when `allPlayers.length === 0`, `success` otherwise (the hook needed **no change** — its existing `length === 0 → empty` branch became reachable).
- Updated tests: `'rejects an empty allPlayers array'` → `'accepts an empty allPlayers array'`; added empty-`teams` acceptance test.

### 2.2 Backend — salary LEFT JOIN + null-safe serialization (`backend/app/dashboard_data.py`)

**Problem:** `_BATTER_Q`/`_PITCHER_Q` used inner `JOIN player_salaries`, so a `--skip-salary` season or failed salary scrape produced **zero** player rows on the dashboard.

**Changes:**
- Both queries switched to `LEFT JOIN player_salaries` (mirroring `compute_value.py`).
- `_to_record` made null-safe: `salary`/`aav` fall back to `0` when `pd.notna` is false.
- New `_clean_str()` maps SQL NULL surfaced as `float('nan')` (pandas 3.x pyarrow dtypes) to JSON-safe `None`; `contractType` now routed through it.
- **Whole-frame pre-arb fallback (decision D1):** when a season has zero salary rows, every player is marked `isPreArb=True` so the React score engine computes pure-performance scores (`score = compPct`) instead of ranking an all-`$0` pool into noise. Mirrors `compute_value.py:143-151`.

### 2.3 Backend — `teamColors` fallback (`backend/app/dashboard_data.py`)

**Problem:** `build_dashboard_payload` opened `frontend/react/team_colors.json` with no guard — a missing/unreadable file caused `FileNotFoundError` → HTTP 500 on the whole endpoint.

**Change (decision D2):** the file read is wrapped in `try/except (OSError, ValueError)`; on failure it logs a warning and falls back to `{}`. React already tolerates missing entries (`PlayerCard.tsx` falls back to a default green pair), so the dashboard renders without brand colors instead of 500ing.

### 2.4 Backend — Pydantic schema validator (new: `backend/scripts/validate_api_schema.py` + `__init__.py`)

**Purpose:** validate the live `/api/dashboard` payload (and a fixture file) against Pydantic v2 models that mirror `frontend/react/src/api/types.ts` exactly — the Python half of the contract gate.

- Models: `PlayerRecord`, `TeamRecord`, `PositionStatSummary`, `RosterEntry`, `ContractYear`, `ContractEntry`, and `DashboardPayload` with `extra="forbid"` on the top-level model so an added/renamed key fails loudly.
- **Live mode:** `build_dashboard_payload(season, fetch_live_contracts=False)` — no web server, no FanGraphs scrape, exercises the exact SQL + serialization the HTTP endpoint uses.
- **Fixture mode:** `--fixture <path>` validates a JSON file offline (no DB/network) — the shared parity corpus.
- **Flags:** `--season`, `--allow-empty` (skips data-presence thresholds: empty `allPlayers`, zero `teams`, `teamColors != 30`).
- Exit 0 on pass, exit 1 on validation/data failure.
- Run: `DATABASE_URL="sqlite:///./mlb_market_value.db" .venv/bin/python -m scripts.validate_api_schema --season 2026`

### 2.5 Frontend — parity gate (new: `frontend/react/src/__tests__/contract.parity.test.ts`)

Three vitest cases asserting the TS validator (`validateDashboardPayload`) accepts the shared fixture (`__tests__/fixtures/dashboard-payload.json`), that the fixture has exactly the 7 contract keys, and that it is a non-empty corpus. Both runtimes must accept the same fixture file — either side failing is the drift signal (documented as a two-command gate in TESTING.md §10).

### 2.6 Backend — SQLite date binding fix (pre-existing bug; `backend/app/pipeline/ingest.py`)

**Problem discovered:** the MLB Stats API returns bio dates as ISO strings; psycopg2 (Postgres) coerces them into `Date` columns, but the SQLite driver raises `TypeError: SQLite Date type only accepts Python date objects as input` — aborting SQLite ingest on the first player write.

**Fix:** new `_parse_date()` helper converts `birthdate`/`debut_date` to `datetime.date` objects at the ingest boundary; dialect-neutral and safe for Postgres too.

### 2.7 Backend — dashboard time-out fix: contract scrape cache + bounding (`backend/app/dashboard_data.py`, `fangraphs_salary.py`)

**Problem discovered:** the browser requests `fetch_live_contracts=true` (hardcoded in `dashboardUrl`), and every page load triggered a **synchronous 30-team FanGraphs scrape**. Verified ~17s normally and unbounded when FanGraphs was flaky/unreachable (RosterResource was already returning `000`), blowing past the client's 30s fetch timeout → dashboard showed "Data unavailable — Request timed out".

**Fix:**
- **Disk cache:** scrape result cached to `backend/.cache/contracts_{season}.json` with a 12-hour TTL. Runs at most once per 12h per season; every other load serves the cache.
- **Bounded scrape:** `CONTRACTS_MAX_SCRAPE_SECONDS = 12` wall-clock budget + `CONTRACTS_PER_TEAM_TIMEOUT_SECONDS = 10`, chosen so worst-case (budget + one in-flight timeout) stays well under the 30s client timeout.
- **Per-team resilience:** a failing team page is logged and skipped rather than aborting the whole scrape.
- `fetch_team_contracts(slug, timeout=...)` accepts a configurable timeout.
- `.gitignore` entry added for `backend/.cache/`.

### 2.8 Documentation

- **`README.md`:** added "API contract & schema validation" section documenting the 7-key contract, the validator usage, and a note that arbitration-specific fields are an un-shipped future feature; added `scripts/validate_api_schema.py` to the layout.
- **`README.local.md`:** this file was **untracked and vanished from disk during the session**; recreated from an earlier read with corrections — the SQLite `DATABASE_URL` override is now documented on every command (the checked-in `.env.example` actually points at Postgres, contradicting the old file's claims).
- **`TESTING.md`:** added §10 "API contract validator (Pydantic) + parity gate" with live/fixture commands and the parity procedure; updated §1 expected counts (4 test files / 24 tests) and the matrix (row 1 → 24/24, new row 10 → PASS).

---

## 3. Debugging Challenges Encountered

| # | Challenge | Root cause | How it was diagnosed |
|---|---|---|---|
| 1 | Empty DB rendered ErrorBanner, not EmptyState | `validateDashboardPayload` rejected empty arrays, so `useDashboardData`'s `empty` branch was unreachable | Code trace of `useDashboardData.ts:65` vs `client.ts:121-133`; existing unit test `data-layer.test.ts:58` locked in the rejection |
| 2 | A `--skip-salary` season would show zero players | Inner `JOIN player_salaries` in the payload queries (unlike `compute_value.py`'s LEFT JOIN) | SQL read of `_BATTER_Q`/`_PITCHER_Q` |
| 3 | Missing `team_colors.json` → HTTP 500 | Unguarded `open()` in `build_dashboard_payload` | Live smoke test: `mv team_colors.json /tmp` then curl → `500`; restored |
| 4 | SQLite ingest aborted: "SQLite Date type only accepts Python date objects" | psycopg2 coerces ISO strings into `Date`, SQLite driver does not | Full ingest run against SQLite failed at the first `INSERT INTO players`; stack trace showed `birthdate: '1997-05-01'` strings |
| 5 | Validator failed with hundreds of `contractType` errors on populated DB | pandas 3.x surfaces SQL NULL as `float('nan')`; `_to_record` passed raw `NaN` into the JSON payload (invalid JSON for the browser too) | Live validator run `--season 2026` printed `"input": NaN` for `allPlayers[*].contractType` |
| 6 | "Data unavailable — Request timed out" in the dashboard | Every page load synchronously scraped 30 FanGraphs pages (~17s nominal, unbounded when flaky) exceeding the 30s browser fetch timeout | Timed `curl` with `fetch_live_contracts=true` (17.4s) vs `=false` (0.085s); network preflight showed RosterResource `000` |
| 7 | npm error `ENOENT` for `/frontend/package.json` | The npm project lives in `frontend/react/`; a stray empty `frontend/package-lock.json` made it look like `frontend/` was a project | `ls frontend/` showed only the stray lockfile + `react/`; removed the stray file, verified `npm test` from `frontend/react/` |

---

## 4. Troubleshooting Steps Taken

- **Reproduced every failure before fixing:** empty-DB payload via `curl`, teamColors 500 via file move + curl, ingest crash via full pipeline run, validator failures via both live and fixture modes, timeout via timed curl comparisons, npm ENOENT via directory inspection.
- **Confirmed the contract empirically:** compared `dashboard_data.py` output keys against `types.ts` and the fixture; checked `grep` for the arbitration keys (absent) to document the drift explicitly.
- **Preflighted external dependencies:** curl status checks against MLB Stats API (200), FanGraphs (200), RosterResource (000), MLBTR (200) before running the ingest, and treated the salary scrape as best-effort per the code's design.
- **Restarted the API after each backend change** — the first `teamColors`-missing test still returned 500 because uvicorn held the pre-fix module; restarting confirmed the fix (200).
- **Verified with both runtimes:** Python validator (live + fixture) and vitest parity test must both accept the shared fixture.
- **Regression-checked after every change:** `npm test` (24/24), `npm run build` (prebuild guard + verify-build self-contained checks), validator live (763 players / 30 teams / 30 rosters / 30 teamColors), cross-table consistency script, and browser-exact curl timings.

---

## 5. Final Solutions Applied (summary)

| Area | Final solution |
|---|---|
| Empty-DB state | Validator accepts empty arrays; `useDashboardData` owns the `empty` vs `success` decision; tests updated |
| Salary-less seasons | `LEFT JOIN player_salaries`; `salary`/`aav` → 0 fallback; `contractType` → `None` via `_clean_str`; whole-frame `isPreArb=True` when season has no salaries |
| `teamColors` | `try/except` → `{}` fallback with warning; no more 500 |
| SQLite ingest | `_parse_date()` in `ingest.py` for bio `birthdate`/`debut_date` |
| JSON safety | `_clean_str()` strips pandas `NaN` from `contractType` |
| Contract gate | `backend/scripts/validate_api_schema.py` (Pydantic mirror, live + fixture modes, `--allow-empty`, `extra="forbid"`); `contract.parity.test.ts` (TS side); documented two-command parity |
| Dashboard timeout | 12h disk cache + 12s scrape budget + per-team 10s timeout + per-team skip; `backend/.cache/` gitignored |
| npm confusion | Removed stray empty `frontend/package-lock.json` |

---

## 6. Verification Results (all green)

- **Frontend tests:** 4 files / **24 tests passed** (incl. 3 new parity tests).
- **Production build:** `npm run build` passes `prebuild-guard.mjs` and `verify-build.mjs` (self-contained bundle, no external asset refs, no leaked paths); `dist/index.html` regenerated.
- **Live validator (populated DB):** **763 player records, 30 teams, 30 rosters, 30 teamColors** — PASS.
- **Fixture validator:** 624-player corpus — PASS.
- **Cross-table consistency (live API):** `teams[].abbr == teamColors keys == rosters keys`; all salaries non-negative; `contractType` JSON-safe (string or null).
- **Error paths:** missing `team_colors.json` → **200** (was 500); empty-DB → EmptyState (unit-tested).
- **End-to-end ingest:** 2026 season ingested against SQLite (610 batters, 798 pitchers, 1351 fielders, **873 salaries**, 77 awards) → `run_compute_value` (763 players, 30 teams) → API verified.
- **Dashboard timeout fix:** cold cache **12.5s** (bounded), warm cache **0.106s**, dashboard HTML **1.6ms**; contracts payload (687 entries) validates through the Pydantic `ContractEntry` model.
- **Server state:** uvicorn running on `:8000` against `backend/mlb_market_value.db`; `/`, `/health`, `/api/dashboard` all 200.

---

## 7. Notes & Follow-ups

- **Nothing was committed.** The working tree retains the branch's pre-existing staged changes plus this session's modifications.
- The contract cache (`backend/.cache/`) is runtime state; the first load after a 12h gap (or after clearing it) takes ~12s once, then is instant.
- The parity gate is a documented two-command check, not a CI hook (no new toolchain introduced).
- **Future/out of scope:** wiring `arb_outcomes`, `player_awards`, and `player_salaries.service_time` into the payload + TS types (the feature-target contract); Docker/Postgres stack verification (absent in this environment); restoring headless-browser UI testing (deleted `scripts/validate/`).

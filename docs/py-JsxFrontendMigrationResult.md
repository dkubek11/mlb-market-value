# React Frontend Migration — Complete ✅

All 17 steps of [`plans/react-frontend-migration.md`](plans/react-frontend-migration.md:239) are done, with steps 12–17 finished in this session.

---

## Components & views added

| File | What it does |
|---|---|
| [`DiamondField.tsx`](frontend/react/src/components/DiamondField.tsx:51) | Pure-SVG port of the legacy `renderDiamondSvg`/`posMarker`: 640×620 field, positional markers colored by value score (`--good`/`--bad`) or pre-arb projected surplus (`--accent`), clickable markers that open the player card. |
| [`TeamsView.tsx`](frontend/react/src/views/TeamsView.tsx:38) | Sortable/searchable payroll table with expandable rows rendering each team's diamond panel; ScoreBar scaled to max \|avgScore\| across all teams (legacy behavior). |
| [`PlayerCard.tsx`](frontend/react/src/components/PlayerCard.tsx:157) | Modal baseball card: team-gradient head, initials avatar, grade badge, regression line, contract block that degrades gracefully when `contracts` is `{}`, value box with centered score bar, and the stat-vs-position-average grid with signed deltas. |
| [`WeightPanel.tsx`](frontend/react/src/components/WeightPanel.tsx:1) | Pay/Batting/Pitching sliders bound directly to ScoringProvider state so every input recomputes scores live (matching the legacy `recomputeAll()` + `renderAll()` on input), plus reset buttons. |
| [`CustomScoreView.tsx`](frontend/react/src/views/CustomScoreView.tsx:1) | Intro copy, weight panels, position chips, the 6-column sortable table (`# / Player / Pos / Score / Percentile / Grade`), and expandable detail rows showing the full z-score breakdown, pay row, and Score formula. Two-way players use `id:position` row keys exactly like the legacy `customRowKey`. |

---

## Wiring

- [`AppShell.tsx`](frontend/react/src/components/AppShell.tsx:31) — Teams and Custom tabs now render the real views; the PlayerCard modal is mounted once over the shell with `cardPlayer` state; `rosters` / `contracts` / `teamColors` / `positionStats` flow from the payload into TeamsView and the card.
- [`PlayersView.tsx`](frontend/react/src/views/PlayersView.tsx:39) and [`RookiesView.tsx`](frontend/react/src/views/RookiesView.tsx:34) — accept `onOpenPlayer`; row clicks open the player card, matching the legacy click handlers.
- [`DataTable.tsx`](frontend/react/src/components/DataTable.tsx:44) — generic inline expanded rows (`Fragment` + `diamond-row detail-row`) reused by TeamsView and CustomScoreView.

---

## Docs & verification

- [`README.md`](README.md:116) — documents `npm run dev` / `npm run build` / `npm test`, the live-fetch vs. optional offline-snapshot story, the bind-mount/rename restart caveat (`docker restart mlb-mv-api`), and the one-command rollback. The legacy `build_dashboard.py` / `splice_dashboard.py` were deliberately **kept** because [`nightly_refresh.ps1`](scripts/nightly_refresh.ps1:43) still invokes them — deleting them would break the nightly job, so this deviates from the plan's literal "delete" wording for safety.
- `npm run build` → single-file React build deployed to [`dashboard_template.html`](frontend/dashboard/dashboard_template.html) (283,756 bytes) via the atomic `deploy-build.mjs`; verified **zero** non-data asset refs, **zero** `/assets/`, **zero** internal-path leaks, **zero** `dangerouslySetInnerHTML` usage.
- `npm test` → **13/13 green** (9 data-layer + 4 scoring-parity against the golden legacy fixtures).
- **Rollback round-trip verified:** `cp .bak` restores the pristine 87,864-byte legacy template, `npm run build` redeploys cleanly, and the `.bak` is never overwritten.
- **No changes** to `backend/`, `docker-compose.yml`, or `Dockerfile`; `team_colors.json` untouched at its required path; the served template still fetches `GET /api/dashboard?season=YYYY` exactly as before.
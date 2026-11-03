  // --- Home (v2): dual league carousels + Explore + contract locks ---
  const teamAbbrToLeague = Object.fromEntries(teams.map(t => [t.abbr, t.league]));
  const marketPlayers = allPlayers.filter(p => !p.isPreArb);
  const carouselState = { nl: 0, al: 0 };
  let homeRowsCurrent = [];
  // Which teams' rows are expanded in Best/Worst Rotations, by abbr.
  // Module-level (not reset per-render) so it survives the renderHome()
  // re-render every other click in that panel already triggers.
  const expandedRotationTeams = new Set();
  const unknownLeagueWarned = new Set();

  function kMinusBbPct(rec) {
    const k = rec.stats && rec.stats.k_rate, bb = rec.stats && rec.stats.bb_rate;
    return (k != null && bb != null) ? (k - bb) * 100 : null;
  }
  function surplusM(rec) {
    return rec.paySurplus != null ? fmtSigned(rec.paySurplus / 1e6) + 'M' : '—';
  }
  function warVal(rec) {
    return rec.stats && rec.stats.bwar != null ? rec.stats.bwar.toFixed(1) : '—';
  }
  function leagueOf(p) {
    const lg = teamAbbrToLeague[p.team];
    if (!lg && !unknownLeagueWarned.has(p.team)) {
      unknownLeagueWarned.add(p.team);
      console.warn(`home: no league mapping for team ${p.team}`);
    }
    return lg || null;
  }
  // Registers a player in the home click-index and returns its position,
  // so any dynamically rendered home row can open the player card.
  function pushHomeRow(p) {
    const idx = homeRowsCurrent.length;
    homeRowsCurrent.push(p);
    return idx;
  }

  function renderCarousel(league) {
    const idx = carouselState[league];
    const leagueUpper = league.toUpperCase();
    const inLeague = marketPlayers.filter(p => leagueOf(p) === leagueUpper);
    const batters = inLeague.filter(p => p.isBatter);
    const pitchers = inLeague.filter(p => !p.isBatter);
    const slideHtml = (s) => {
      const dir = s === 0 ? 'desc' : 'asc';
      const sortFn = (a, b) => dir === 'desc' ? b.score - a.score : a.score - b.score;
      const bat = [...batters].sort(sortFn).slice(0, 8);
      const pit = [...pitchers].sort(sortFn).slice(0, 8);
      const half = (records, label) => {
        const rows = records.length
          ? records.map(p => `<button class="carousel-row" data-pidx="${pushHomeRow(p)}">
              <span class="carousel-row-name">${p.name} <span class="carousel-row-tag">${teamLogoImg(p.team, 13)}${p.team} · ${p.position}</span></span>
              <span class="carousel-row-val ${p.score >= 0 ? 'good' : 'bad'}" data-count="${p.score}" data-count-fmt="signed">${fmtSigned(p.score)}</span>
            </button>`).join('')
          : `<div class="empty">No qualifying players in the ${leagueUpper}.</div>`;
        return `<div class="carousel-half">
          <div class="carousel-half-head">${label} <span class="count">${records.length}</span></div>
          ${rows}
        </div>`;
      };
      return `<div class="carousel-slide${s === idx ? ' active' : ''}" data-slide="${s}">${half(bat, 'Position Players')}${half(pit, 'Pitchers')}</div>`;
    };
    document.getElementById('slides-' + league).innerHTML = [0, 1].map(slideHtml).join('');
    const badge = document.getElementById('badge-' + league);
    badge.textContent = idx === 0 ? 'UNDER VALUED' : 'OVER VALUED';
    badge.classList.toggle('under', idx === 0);
    badge.classList.toggle('over', idx !== 0);
    document.getElementById('dots-' + league).innerHTML = [0, 1].map(s =>
      `<button class="carousel-dot${s === idx ? ' active' : ''}" data-carousel="${league}" data-slide="${s}" aria-label="Slide ${s + 1}"></button>`
    ).join('');
  }

  // Hot vs Cold is a real streak signal: how a player's last 30 real days
  // compares to their OWN season, not to a modeled projection -- a
  // different concept from the season-to-date over/underperforming tag
  // shown elsewhere on cards/lists (regressionSignal/regressionArrow above,
  // which compares season-to-date actual against Marcel + comp projected
  // true talent, and stays that way there on purpose). "projected" in the
  // returned shape holds the player's season AVG/ERA here, not a
  // projection -- named to match regressionSignal's shape so the
  // shared row renderer below (sig.projected used as the % delta divisor)
  // works unchanged. Threshold is wider than the season-long
  // regression signal's (0.035 AVG / 0.75 ERA vs 0.02 / 0.4) since a
  // ~25-game window is naturally noisier than a full season at the same
  // underlying skill level.
  const LAST30_THRESHOLD = { ba: 0.035, era: 0.75 };
  function last30Signal(record) {
    if (record.last30 == null) return null;
    const seasonStat = record.isBatter ? record.stats.ba : record.stats.era;
    if (seasonStat == null) return null;
    return record.isBatter
      ? { actual: record.last30, projected: seasonStat, gap: record.last30 - seasonStat, label: 'AVG (L30 vs season)', type: 'avg3', threshold: LAST30_THRESHOLD.ba }
      : { actual: record.last30, projected: seasonStat, gap: seasonStat - record.last30, label: 'ERA (L30 vs season)', type: 'rate2', threshold: LAST30_THRESHOLD.era };
  }
  function last30Arrow(record) {
    const sig = last30Signal(record);
    if (!sig || Math.abs(sig.gap) < sig.threshold) return null;
    return sig.gap > 0
      ? { symbol: '▲', cls: 'good', sig }
      : { symbol: '▼', cls: 'bad', sig };
  }

  function renderHotCold() {
    const hot = [], cold = [];
    marketPlayers.forEach(p => {
      const arrow = last30Arrow(p);
      if (!arrow) return;
      if (arrow.cls === 'good') hot.push({ p, sig: arrow.sig });
      else cold.push({ p, sig: arrow.sig });
    });
    hot.sort((a, b) => b.sig.gap - a.sig.gap);
    cold.sort((a, b) => a.sig.gap - b.sig.gap);
    const row = ({ p, sig }) => {
      const dPct = sig.projected ? (sig.gap / sig.projected) * 100 : null;
      const delta = dPct != null ? (dPct >= 0 ? '+' : '') + dPct.toFixed(1) + '%' : '';
      const over = sig.gap > 0;
      return `<button class="pick-row" data-pidx="${pushHomeRow(p)}">
        <span class="preview-row-name">${p.name} <span class="preview-row-tag">${teamLogoImg(p.team, 13)}${p.team} · ${p.position}</span></span>
        <span class="preview-row-val ${over ? 'good' : 'bad'}">${delta} <span class="regression-tag ${over ? 'good' : 'bad'}">${over ? '▲' : '▼'}</span></span>
      </button>`;
    };
    const hotRows = hot.length ? hot.slice(0, 10).map(row).join('') : '<div class="empty">No players past the noise threshold in this build.</div>';
    const coldRows = cold.length ? cold.slice(0, 10).map(row).join('') : '<div class="empty">No players past the noise threshold in this build.</div>';
    document.getElementById('explore-hot-cold').innerHTML = `
      <div class="preview-head">
        <h3>Hot vs Cold <span class="preview-sub">last 30 real days vs. this season</span></h3>
      </div>
      <div class="hot-cold-cols">
        <div>
          <div class="explore-subhead hot">Hot — outperforming over the last 30 days</div>
          ${hotRows}
        </div>
        <div>
          <div class="explore-subhead cold">Cold — underperforming over the last 30 days</div>
          ${coldRows}
        </div>
      </div>`;
  }

  function renderBullpenOverview() {
    const rps = marketPlayers.filter(p => p.position === 'RP');
    const hasSaves = p => (p.stats.saves || 0) > 0;
    const highLev = rps.filter(hasSaves).slice(0, 5);
    const rest = rps.filter(p => !hasSaves(p));
    const setup = [...rest]
      .sort((a, b) => (kMinusBbPct(b) ?? -Infinity) - (kMinusBbPct(a) ?? -Infinity))
      .slice(0, 5);
    const middle = rest
      .filter(p => !setup.includes(p))
      .sort((a, b) => (b.stats.ip || 0) - (a.stats.ip || 0))
      .slice(0, 5);
    const tierHtml = (title, players) => {
      const rows = players.length ? players.map(p => {
        const kbb = kMinusBbPct(p);
        const surCls = p.paySurplus != null ? (p.paySurplus >= 0 ? ' good' : ' bad') : '';
        return `<tr data-pidx="${pushHomeRow(p)}">
              <td>${playerNameCellHtml(p)}</td>
          <td class="num">${p.stats.era != null ? p.stats.era.toFixed(2) : '—'}</td>
          <td class="num">${kbb != null ? kbb.toFixed(1) + '%' : '—'}</td>
          <td class="num">${warVal(p)}</td>
          <td class="num${surCls}">${surplusM(p)}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="5" class="num">No RPs in this tier.</td></tr>';
      return `<div class="tier-block">
        <div class="tier-head">${title}</div>
        <table class="mini-table">
          <thead><tr><th>Player</th><th class="num">ERA</th><th class="num">K-BB%</th><th class="num">bWAR</th><th class="num">Surplus</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    };
    document.getElementById('explore-bullpen').innerHTML = `
      <div class="preview-head">
        <h3>Bullpen overview <span class="preview-sub">approximate tiers — no leverage-index data yet</span></h3>
      </div>
      ${tierHtml('High Leverage — RP with saves', highLev)}
      ${tierHtml('Setup — top K-BB%', setup)}
      ${tierHtml('Middle / Long — by IP', middle)}
      <div class="card-actions"><button class="preview-link show-more" data-tab="bullpen">Show More Bullpen Players →</button></div>`;
  }

  function renderRotations() {
    const aggs = teams.map(t => {
      const sps = t.rotation;
      if (!sps || sps.length < 2) return null;
      const fips = sps.map(p => p.stats.fip).filter(v => v != null);
      return {
        name: t.name, abbr: t.abbr,
        sps,
        avgScore: t.rotationScore,
        avgFip: fips.length ? fips.reduce((a, v) => a + v, 0) / fips.length : null,
        totalIp: sps.reduce((a, p) => a + (p.stats.ip || 0), 0),
        payroll: sps.reduce((a, p) => a + (p.aav || 0), 0),
      };
    }).filter(Boolean);
    const best = [...aggs].sort((a, b) => b.avgScore - a.avgScore).slice(0, 5);
    const worst = [...aggs].sort((a, b) => a.avgScore - b.avgScore).slice(0, 5);
    const row = t => {
      const expanded = expandedRotationTeams.has(t.abbr);
      const playersHtml = expanded
        ? `<table class="mini-table rotation-players">
            <thead><tr><th>Player</th><th class="num">IP</th><th class="num" title="Share of a full 180-IP starter workload; scales this pitcher's pull on the rotation score">Weight</th><th class="num">Score</th></tr></thead>
            <tbody>${t.sps.map(p => `<tr data-pidx="${pushHomeRow(p)}">
          <td>${playerNameCellHtml(p)}</td>
              <td class="num">${Math.round(p.stats.ip || 0)}</td>
              <td class="num">${p.teamWeight.toFixed(2)}</td>
              <td class="num ${p.teamScore >= 0 ? 'good' : 'bad'}">${fmtSigned(p.teamScore)}</td>
            </tr>`).join('')}</tbody>
          </table>`
        : '';
      return `
      <div class="pick-row rotation-team-row" data-team-toggle="${t.abbr}">
        <span class="preview-row-name">${expanded ? '▾' : '▸'} ${teamLogoImg(t.abbr, 15)}${t.name} <span class="preview-row-tag">${t.abbr} · avg FIP ${t.avgFip != null ? t.avgFip.toFixed(2) : '—'} · ${Math.round(t.totalIp)} IP · ${fmtMoney(t.payroll)} payroll</span></span>
        <span class="preview-row-val ${t.avgScore >= 0 ? 'good' : 'bad'}">${fmtSigned(t.avgScore)}</span>
      </div>
      ${playersHtml}`;
    };
    const bestRows = best.length ? best.map(row).join('') : '<div class="empty">No rotations with 2+ starters in this build.</div>';
    const worstRows = worst.length ? worst.map(row).join('') : '<div class="empty">No rotations with 2+ starters in this build.</div>';
    document.getElementById('explore-rotations').innerHTML = `
      <div class="preview-head">
        <h3>Best / Worst Rotations <span class="preview-sub">each team's top 5 SP by IP — innings-weighted avg value score</span></h3>
      </div>
      <div class="explore-subhead good">Best — highest avg score</div>
      ${bestRows}
      <div class="explore-subhead bad">Worst — lowest avg score</div>
      ${worstRows}`;
  }

  // Long-Term Contract Value Locks: real per-year projected talent (2027-
  // 2029, from projectedFutureYears -- see compute_batter/pitcher_
  // projections_future_years in projections.py) weighed against real
  // guaranteed contract pay in that same year, not this year's AAV
  // multiplied out. Uses the exact same live, adjustable composite weights
  // (BATTER_STAT_CONFIG/PITCHER_STAT_CONFIG) as the rest of the site, just
  // applied to future-year projected stats instead of this season's real
  // ones -- reacts to the Weights tab the same way everything else does.
  // Missing composite inputs (no multi-year projection exists yet for
  // fielding or wRC+) simply drop out of that year's weighted sum rather
  // than blocking it, the same graceful-partial-data handling recomputeAll()
  // already uses everywhere else.
  function futureCompositePct(p, targetSeason) {
    const future = p.projectedFutureYears && p.projectedFutureYears[String(targetSeason)];
    if (!future) return null;
    const enriched = { ...future };
    if (p.isBatter && enriched.k_rate != null && enriched.bb_rate != null) {
      enriched.k_minus_bb = enriched.k_rate - enriched.bb_rate;
    }
    const cfg = p.isBatter ? BATTER_STAT_CONFIG : PITCHER_STAT_CONFIG;
    const w = p.isBatter ? battingWeights : pitchingWeights;
    const posStats = positionStats[p.position] || {};
    let total = 0, weightSqSum = 0, any = false;
    cfg.forEach(s => {
      const val = enriched[s.key];
      const ps = posStats[s.key];
      if (val != null && ps && ps.std > 0) {
        const rawZ = (val - ps.mean) / ps.std;
        const z = s.higherBetter ? rawZ : -rawZ;
        total += z * w[s.key];
        weightSqSum += w[s.key] * w[s.key];
        any = true;
      }
    });
    return any && weightSqSum > 0 ? normalCdf(total / Math.sqrt(weightSqSum)) * 100 : null;
  }

  // Same true-market comp pool the main Recommended Pay figure uses
  // (non-pre-arb, non-arbitration-eligible), rebuilt fresh each render so it
  // always reflects the live compPct values recomputeAll() just set.
  function trueMarketPools() {
    return {
      batter: marketPlayers.filter(p => p.isBatter && !isArbEligible(p)),
      SP: marketPlayers.filter(p => p.position === 'SP' && !isArbEligible(p)),
      RP: marketPlayers.filter(p => p.position === 'RP' && !isArbEligible(p)),
    };
  }

  // Real 3-year lock value: only players with a REAL, GUARANTEED (not
  // arbitration, not an option year, not a placeholder) contract salary in
  // all 3 of the next seasons qualify -- "contract only, no arbitration" per
  // the feature's own name. Each year's projected performance is converted
  // to a real dollar figure via the same adaptiveCompMedian the rest of the
  // site uses, then compared against that year's real guaranteed salary.
  function threeYearLockValue(p, pools) {
    if (!p.projectedFutureYears) return null;
    const c = contracts[p.id];
    if (!c || !c.years) return null;
    const pool = pools[p.isBatter ? 'batter' : p.position];
    if (!pool || pool.length === 0) return null;

    const perYear = [];
    let totalSurplus = 0, totalValue = 0, totalPay = 0;
    for (let offset = 1; offset <= 3; offset++) {
      const yr = CURRENT_SEASON + offset;
      const contractYear = c.years.find(y => y.season === yr && y.type === 'GUARANTEED' && y.salary != null);
      if (!contractYear) return null;
      const pct = futureCompositePct(p, yr);
      if (pct == null) return null;
      const value = adaptiveCompMedian(pool, pct, 'aav', 'compPct');
      if (value == null) return null;
      const surplus = value - contractYear.salary;
      perYear.push({ season: yr, pct, value, pay: contractYear.salary, surplus });
      totalSurplus += surplus;
      totalValue += value;
      totalPay += contractYear.salary;
    }
    return { perYear, totalSurplus, avgValue: totalValue / 3, avgPay: totalPay / 3 };
  }

  // Every player (batter or pitcher) with a REAL, GUARANTEED contract salary in
  // all 3 of the next seasons, sorted by 3-year surplus. Shared by the home
  // Locks card preview and the Long-Term Locks sub-page so both always show
  // exactly the same pool.
  function lockCandidates() {
    const pools = trueMarketPools();
    return marketPlayers
      .map(p => ({ p, lock: threeYearLockValue(p, pools) }))
      .filter(x => x.lock != null)
      .sort((a, b) => b.lock.totalSurplus - a.lock.totalSurplus);
  }

  function lockRowCells(p, lock) {
    const firstYear = lock.perYear[0];
    const keyStat = p.projectedFutureYears[String(firstYear.season)][p.isBatter ? 'xwoba' : 'xera'];
    const keyType = p.isBatter ? 'avg3' : 'rate2';
    return `
      <td>${playerNameCellHtml(p)}</td>
      <td class="num">${fmtMoney(lock.avgPay)}</td>
      <td class="num">${fmtStatValue(keyType, keyStat)}</td>
      <td class="num">${fmtMoney(lock.avgValue)}</td>
      <td class="num ${lock.totalSurplus >= 0 ? 'good' : 'bad'}" data-count="${lock.totalSurplus}" data-count-fmt="signedM">${fmtSigned(lock.totalSurplus / 1e6)}M</td>`;
  }

  const LOCK_EMPTY_ROW = '<tr><td colspan="5"><div class="empty">No players with 3 full guaranteed contract years remaining (2027-2029) in this build.</div></td></tr>';

  function renderLocks() {
    const candidates = lockCandidates().slice(0, 10);
    const rows = candidates.length ? candidates.map(({ p, lock }) =>
      `<tr class="row-toggle" data-pidx="${pushHomeRow(p)}">${lockRowCells(p, lock)}</tr>`
    ).join('') : LOCK_EMPTY_ROW;
    document.getElementById('locks-card').innerHTML = `
      <div class="preview-head">
        <h3>Long-Term Contract Value Locks <span class="preview-sub">real 3-year projections (2027-2029) vs. real guaranteed pay — contract years only, no arbitration</span></h3>
      </div>
      <div class="table-scroll">
        <table class="locks-table">
          <thead>
            <tr>
              <th>Player</th>
              <th class="num">Avg Annual Pay</th>
              <th class="num">${CURRENT_SEASON + 1} xwOBA / xERA</th>
              <th class="num">Avg Annual Value</th>
              <th class="num">3-Yr Surplus</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card-actions"><button class="preview-link show-more" data-tab="locks">Show More Locks →</button></div>`;
  }

  // --- Long-Term Locks sub-page: the full lock pool (all batters + pitchers),
  // separate from league-filtering. Shares lockCandidates()/lockRowCells()
  // with the home Locks card preview. ---
  let locksSort = { key: 'surplus', dir: 'desc' };
  let locksRowsCurrent = [];

  function renderLocksSubpage() {
    document.getElementById('locks-key-head').textContent = `${CURRENT_SEASON + 1} xwOBA / xERA`;
    const q = document.getElementById('locks-search').value.trim().toLowerCase();
    let rows = lockCandidates().filter(({ p }) => q === '' || matchesTeamQuery(p, q));
    rows.sort((a, b) => {
      const k = locksSort.key;
      const lk = k === 'surplus' ? 'totalSurplus' : k;
      const va = k === 'name' ? a.p.name : a.lock[lk];
      const vb = k === 'name' ? b.p.name : b.lock[lk];
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return locksSort.dir === 'asc' ? cmp : -cmp;
    });
    document.getElementById('locks-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    document.getElementById('locks-rows').innerHTML = rows.length ? rows.map(({ p, lock }, i) =>
      `<tr class="row-toggle" data-idx="${i}"><span class="chevron">▸</span>${lockRowCells(p, lock)}</tr>`
    ).join('') : LOCK_EMPTY_ROW;
    locksRowsCurrent = rows;
  }

  document.getElementById('locks-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    openPlayerCard(locksRowsCurrent[Number(row.dataset.idx)].p);
  });
  document.getElementById('locks-search').addEventListener('input', renderLocksSubpage);
  document.querySelectorAll('#locks-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      locksSort.dir = locksSort.key === key && locksSort.dir === 'desc' ? 'asc' : 'desc';
      locksSort.key = key;
      renderLocksSubpage();
    });
  });

  function renderHome() {
    homeRowsCurrent = [];
    renderCarousel('nl');
    renderCarousel('al');
    renderHotCold();
    renderBullpenOverview();
    renderRotations();
    renderLocks();
  }


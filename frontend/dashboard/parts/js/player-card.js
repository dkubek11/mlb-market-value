  // --- Baseball card ---
  const BATTER_STATS = [
    { key: 'war', label: 'fWAR', type: 'velo1', higherBetter: true },
    { key: 'ba', label: 'AVG', type: 'avg3', higherBetter: true },
    { key: 'obp', label: 'OBP', type: 'avg3', higherBetter: true },
    { key: 'slg', label: 'SLG', type: 'avg3', higherBetter: true },
    { key: 'xwoba', label: 'xwOBA', type: 'avg3', higherBetter: true },
    { key: 'hr', label: 'HR', type: 'int', higherBetter: true },
    { key: 'rbi', label: 'RBI', type: 'int', higherBetter: true },
    { key: 'sb', label: 'SB', type: 'int', higherBetter: true },
    { key: 'barrel_rate', label: 'Barrel%', type: 'pct1', higherBetter: true },
    { key: 'hard_hit_rate', label: 'Hard-Hit%', type: 'pct1', higherBetter: true },
    { key: 'sprint_speed', label: 'Sprint Spd', type: 'velo1', higherBetter: true },
  ];
  const PITCHER_STATS = [
    { key: 'war', label: 'fWAR', type: 'velo1', higherBetter: true },
    { key: 'era', label: 'ERA', type: 'rate2', higherBetter: false },
    { key: 'whip', label: 'WHIP', type: 'rate2', higherBetter: false },
    { key: 'fip', label: 'FIP', type: 'rate2', higherBetter: false },
    { key: 'xera', label: 'xERA', type: 'rate2', higherBetter: false },
    { key: 'k_9', label: 'K/9', type: 'rate2', higherBetter: true },
    { key: 'bb_9', label: 'BB/9', type: 'rate2', higherBetter: false },
    { key: 'hard_hit_rate_against', label: 'Hard-Hit% Allowed', type: 'pct1', higherBetter: false },
    { key: 'barrel_rate_against', label: 'Barrel% Allowed', type: 'pct1', higherBetter: false },
  ];
  const FIELDING_STATS = [
    { key: 'oaa', label: 'OAA', type: 'int', higherBetter: true },
    { key: 'frv', label: 'FRV', type: 'int', higherBetter: true },
    { key: 'drs', label: 'DRS', type: 'int', higherBetter: true },
  ];

  function fmtStatValue(type, v) {
    if (v == null) return '—';
    if (type === 'avg3') return (v < 0 ? '-' : '') + Math.abs(v).toFixed(3).replace(/^0\./, '.');
    if (type === 'rate2') return v.toFixed(2);
    if (type === 'pct1') return v.toFixed(1) + '%';
    if (type === 'velo1') return v.toFixed(1);
    if (type === 'int') return Math.round(v).toString();
    return String(v);
  }
  function gradeFor(pct) {
    if (pct >= 99) return 'S';
    if (pct >= 90) return 'A+';
    if (pct >= 80) return 'A';
    if (pct >= 70) return 'B+';
    if (pct >= 60) return 'B';
    if (pct >= 50) return 'C+';
    if (pct >= 40) return 'C';
    if (pct >= 30) return 'D';
    return 'F';
  }

  // Regression signal: actual outcome stat (AVG/ERA, luck included) vs. a
  // Marcel-style multi-year projected true-talent level (weighted 3-year
  // history of expected stats, regressed to league mean by sample size, age-
  // adjusted). A gap past the noise threshold means the player is running
  // ahead of or behind their real talent level and due to regress toward it.
  const REGRESSION_THRESHOLD = { ba: 0.02, era: 0.4 };

  function regressionSignal(record) {
    if (record.isBatter) {
      const actual = record.stats.ba;
      const projected = record.projected && record.projected.xba;
      if (actual == null || projected == null) return null;
      return { actual, projected, gap: actual - projected, label: 'AVG', type: 'avg3', threshold: REGRESSION_THRESHOLD.ba };
    }
    const actual = record.stats.era;
    const projected = record.projected && record.projected.xera;
    if (actual == null || projected == null) return null;
    return { actual, projected, gap: projected - actual, label: 'ERA', type: 'rate2', threshold: REGRESSION_THRESHOLD.era };
  }

  // gap > 0: current output is better than true talent suggests -- hot,
  // green, up (due to regress toward worse). gap < 0: current output lags
  // true talent -- cold, red, down (due to regress toward better).
  // "Hot/cold" framing: green/up = overperforming right now (hot), red/down =
  // underperforming right now (cold) -- describes current form, not a
  // prediction of which way regression is headed (that would be the
  // opposite color/direction, since an overperforming "hot" player is the
  // one due to cool off).
  function regressionArrow(record) {
    const sig = regressionSignal(record);
    if (!sig || Math.abs(sig.gap) < sig.threshold) return null;
    return sig.gap > 0
      ? { symbol: '▲', cls: 'good', sig }
      : { symbol: '▼', cls: 'bad', sig };
  }

  function regressionTagHtml(record) {
    const arrow = regressionArrow(record);
    if (!arrow) return '';
    const title = arrow.cls === 'good'
      ? `${fmtStatValue(arrow.sig.type, arrow.sig.actual)} vs ${fmtStatValue(arrow.sig.type, arrow.sig.projected)} projected — overperforming, regression likely`
      : `${fmtStatValue(arrow.sig.type, arrow.sig.actual)} vs ${fmtStatValue(arrow.sig.type, arrow.sig.projected)} projected — underperforming, positive regression likely`;
    return `<span class="regression-tag ${arrow.cls}" title="${title}">${arrow.symbol}</span>`;
  }

  // Statcast-style percentile bars: same position-relative z-score every
  // other composite on the site uses (positionStats mean/std), turned into a
  // 1-99 percentile via the normal-CDF approximation already used elsewhere
  // for historical grading (normalCdf, defined below) -- not a fresh rank
  // pass per stat, just a different lens on the same underlying z.
  function statPercentile(record, key, higherBetter) {
    const val = record.stats[key];
    const ps = (positionStats[record.position] || {})[key];
    if (val == null || !ps || !(ps.std > 0)) return null;
    const rawZ = (val - ps.mean) / ps.std;
    const z = higherBetter ? rawZ : -rawZ;
    return Math.max(1, Math.min(99, Math.round(normalCdf(z) * 100)));
  }

  // Blue (poor) -> light gray (average) -> red (great), matching Baseball
  // Savant's percentile-ranking convention -- deliberately not the site's
  // own --good/--bad green/red pair, since this widget mirrors that specific
  // reference visual rather than the site's usual under/overpaid coloring.
  const PCTL_COLOR_STOPS = [[0, [91, 132, 196]], [50, [172, 172, 164]], [100, [201, 74, 61]]];
  function percentileColor(pct) {
    const [lo, hi] = pct <= 50 ? [PCTL_COLOR_STOPS[0], PCTL_COLOR_STOPS[1]] : [PCTL_COLOR_STOPS[1], PCTL_COLOR_STOPS[2]];
    const t = (pct - lo[0]) / (hi[0] - lo[0]);
    const rgb = lo[1].map((c, i) => Math.round(c + (hi[1][i] - c) * t));
    return `rgb(${rgb.join(',')})`;
  }

  function percentileRow(label, pct, valueText) {
    if (pct == null) return '';
    const color = percentileColor(pct);
    return `<div class="pctl-row">
      <span class="pctl-label">${label}</span>
      <div class="pctl-track">
        <div class="pctl-fill" style="width:${pct}%; background:${color};"></div>
        <div class="pctl-badge" style="left:${pct}%; background:${color};">${pct}</div>
      </div>
      <span class="pctl-value">${valueText}</span>
    </div>`;
  }

  function percentileSection(title, statList, record) {
    const rows = statList.map(s => {
      const pct = statPercentile(record, s.key, s.higherBetter);
      if (pct == null) return '';
      return percentileRow(s.label, pct, fmtStatValue(s.type, record.stats[s.key]));
    }).join('');
    if (!rows) return '';
    return `<div class="card-section-title pctl-section-title">${title}</div>
      <div class="pctl-legend"><span>&larr; Poor</span><span>Average</span><span>Great &rarr;</span></div>
      ${rows}`;
  }

  const CURRENT_SEASON = 2026;

  // Still team-controlled (pre-arb/arb-eligible) players reach free agency
  // for the first time at 6.000 years of service -- serviceYears may be the
  // (less precise) debut-year proxy for anyone MLBTR's tracker doesn't
  // cover (it only lists the current year's arbitration class), same
  // caveat as arbYearLabel above. Once a player HAS already reached free
  // agency and signed a new deal, service time stops meaning anything for
  // "when's their next free agency" -- only that contract's own end year
  // does, which is why this branches on contract/control status rather
  // than checking service time for every player uniformly (a 16-year
  // veteran mid-contract isn't "nearing free agency" just because their
  // service time is deep past 6.000).
  function isNearingFreeAgency(p) {
    if (p.isPreArb || isArbEligible(p)) {
      return p.serviceYears != null && p.serviceYears + 1 >= 6.0;
    }
    const contract = contracts[p.id];
    return !!(contract && contract.endSeasonAll === CURRENT_SEASON);
  }

  function contractYearRow(y) {
    const isCurrent = y.season === CURRENT_SEASON;
    const salaryText = y.salary != null ? fmtMoney(y.salary) : (y.type ? y.type.replace(/_/g, ' ').toLowerCase() : '—');
    return `<div class="contract-year-row${isCurrent ? ' current' : ''}" ${isCurrent ? 'data-current="1"' : ''}>
      <span class="contract-year">${y.season}</span>
      <span class="contract-year-salary">${salaryText}</span>
    </div>`;
  }

  function renderContractSection(record) {
    const contract = contracts[record.id];
    const badge = `<span class="card-contract-type">${(contract && contract.contractType) || record.contractType || 'Unknown'}</span>`;

    const realYears = contract ? contract.years.filter(y => y.salary != null) : [];
    if (!contract || realYears.length <= 1) {
      return `<div class="card-contract-line">${badge}<span class="card-contract-total">${fmtMoney(record.salary)} in ${CURRENT_SEASON}</span></div>`;
    }

    const totalLine = contract.totalGuaranteed
      ? `${fmtMoney(contract.totalGuaranteed)} guaranteed · ${contract.startSeason}–${contract.endSeasonAll}`
      : `${realYears.length}-year deal`;
    const rows = contract.years.map(contractYearRow).join('');

    return `<div class="card-contract-box">
      <div class="card-contract-head">${badge}<span class="card-contract-total">${totalLine}</span></div>
      <div class="card-contract-years" id="contract-years-scroll">${rows}</div>
    </div>`;
  }

  // Standard normal CDF approximation (Zelen & Severo formula, error <
  // 7.5e-8). Used to turn a historical season's weighted z-score composite
  // into a percentile without loading every other qualifying player's
  // historical stats client-side (which would roughly double the page's
  // data payload just to rank against). The composite is a weighted sum of
  // ~12 roughly-independent z-scored stats, so it's reasonably close to
  // normally distributed within a position group -- not exact (stats do
  // correlate with each other somewhat), but close enough for a "how good
  // was this season" estimate, and unlike a precomputed number it still
  // responds live to weight changes like everything else on the site.
  function normalCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // Grades one historical season the same way recomputeAll() grades the
  // current one: z-score each stat against that season's position peers
  // (positionStatsHistory), weight by the live (adjustable) weights, sum.
  // The sum's own spread is estimated as sqrt(sum of squared weights used) --
  // each input z-score has mean 0/std 1 by construction, and treating them
  // as roughly independent makes the weighted sum's variance ~= sum(w^2) --
  // then normalCdf() converts that standardized composite to a percentile.
  function computeHistoricalGrade(entry, isBatter) {
    const cfg = isBatter ? BATTER_STAT_CONFIG : PITCHER_STAT_CONFIG;
    const w = isBatter ? battingWeights : pitchingWeights;
    const seasonStats = (positionStatsHistory[entry.season] || {})[entry.position];
    if (!seasonStats) return null;
    let total = 0, weightSqSum = 0, any = false;
    cfg.forEach(s => {
      const val = entry.stats[s.key];
      const ps = seasonStats[s.key];
      if (val != null && ps && ps.std > 0) {
        const rawZ = (val - ps.mean) / ps.std;
        const z = s.higherBetter ? rawZ : -rawZ;
        total += z * w[s.key];
        weightSqSum += w[s.key] * w[s.key];
        any = true;
      }
    });
    if (!any || weightSqSum === 0) return null;
    const pct = normalCdf(total / Math.sqrt(weightSqSum)) * 100;
    return { rawScore: total, pct, grade: gradeFor(pct) };
  }

  // Same as computeHistoricalGrade, but on the traditional-stat composite
  // (BATTER_ARB_CONFIG/PITCHER_ARB_CONFIG, defined further below) -- used to
  // build arb-eligible/pre-arb players' multi-year track record out of their
  // own past qualifying seasons, the same real-arbitration-relevant stats as
  // their current-season arbCompPct, not the advanced-metric ones.
  function computeHistoricalArbGrade(entry, isBatter) {
    const cfg = isBatter ? BATTER_ARB_CONFIG : PITCHER_ARB_CONFIG;
    const seasonStats = (positionStatsHistory[entry.season] || {})[entry.position];
    if (!seasonStats) return null;
    let total = 0, weightSqSum = 0, any = false;
    cfg.forEach(s => {
      const val = entry.stats[s.key];
      const ps = seasonStats[s.key];
      if (val != null && ps && ps.std > 0) {
        const rawZ = (val - ps.mean) / ps.std;
        const z = s.higherBetter ? rawZ : -rawZ;
        total += z * s.defaultWeight;
        weightSqSum += s.defaultWeight * s.defaultWeight;
        any = true;
      }
    });
    if (!any || weightSqSum === 0) return null;
    return normalCdf(total / Math.sqrt(weightSqSum)) * 100;
  }

  const HISTORY_BATTER_COLS = BATTER_STATS.filter(s => ['ba', 'hr', 'xwoba'].includes(s.key));
  const HISTORY_PITCHER_COLS = PITCHER_STATS.filter(s => ['era', 'xera', 'k_9'].includes(s.key));

  function historySectionHtml(record) {
    if (!record.history || !record.history.length) return '';
    const cols = record.isBatter ? HISTORY_BATTER_COLS : HISTORY_PITCHER_COLS;
    const headCells = cols.map(c => `<th class="num">${c.label}</th>`).join('');
    const rows = record.history.map(entry => {
      const grade = computeHistoricalGrade(entry, record.isBatter);
      const statCells = cols.map(c => `<td class="num">${fmtStatValue(c.type, entry.stats[c.key])}</td>`).join('');
      const pctCell = grade != null ? `${grade.pct.toFixed(1)}` : '—';
      const gradeCell = grade != null ? grade.grade : '—';
      return `<tr>
        <td>${entry.season}</td>
        <td><span class="pos-pill">${entry.position}</span></td>
        ${statCells}
        <td class="num">${pctCell}</td>
        <td class="num">${gradeCell}</td>
      </tr>`;
    }).join('');
    return `
      <div class="card-section-title">5-Year History</div>
      <div class="history-table-wrap">
        <table class="history-table">
          <thead><tr><th>Yr</th><th>Pos</th>${headCells}<th class="num">Perf%</th><th class="num">Grd</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="history-note">Performance vs. that season's position peers only (est. percentile) — no salary history exists for past seasons, so there's no historical Score.</div>
    `;
  }

  function openPlayerCard(record) {
    if (!record) return;
    const colors = teamColors[record.team] || ['#3a4a42', '#1a231e'];
    const grade = gradeFor(record.compPct);
    // sprint_speed splits out into its own "Running" section (Statcast-style
    // layout) rather than sitting inside the main Batting percentile list.
    const statSet = record.isBatter ? BATTER_STATS.filter(s => s.key !== 'sprint_speed') : PITCHER_STATS;
    const runningStats = record.isBatter ? BATTER_STATS.filter(s => s.key === 'sprint_speed') : [];

    const fieldingHtml = record.isBatter ? percentileSection('Fielding', FIELDING_STATS, record) : '';
    const runningHtml = percentileSection('Running', runningStats, record);

    let regressionHtml = '';
    const arrow = regressionArrow(record);
    if (arrow) {
      const word = arrow.cls === 'good' ? 'overperforming, regression likely' : 'underperforming, positive regression likely';
      const compsNote = record.nComps ? ` · ${record.nComps} historical comps` : '';
      regressionHtml = `<div class="regression-line ${arrow.cls}"><span class="regression-arrow">${arrow.symbol}</span> ${fmtStatValue(arrow.sig.type, arrow.sig.actual)} ${arrow.sig.label} vs. ${fmtStatValue(arrow.sig.type, arrow.sig.projected)} projected (${word})${compsNote}</div>`;
    }

    // Computed here (not just below, where it already existed) because the
    // Score box's "Recommended pay" line needs it too: recommendedSalary
    // blends heavily toward projectedPct for arb-eligible players
    // (ARB_PROJECTION_BLEND=0.65), so for someone actually reaching free
    // agency soon it's really a forward-looking number wearing a
    // present-tense label -- misleading when it sits right above a
    // percentile-performance line showing them well below where they're
    // paid (that combination reads as "underpaid" when blended so heavily
    // toward next year's projection, it isn't saying that at all). The
    // Outlook section below already shows that same forward-looking
    // concept under its correct label (Projected Free Agent Value), so
    // this just avoids showing a second, confusingly-similar number under
    // a label that implies "pay them this right now."
    const pendingFA = isNearingFreeAgency(record);
    let valueHtml = '';
    if (!record.isPreArb) {
      const recPayNote = (record.recommendedSalary != null && !pendingFA)
        ? `<div class="card-value-note">Recommended pay: <strong>${fmtMoney(record.recommendedSalary)}</strong> vs. actual ${fmtMoney(record.aav)} AAV (${fmtSigned(record.paySurplus / 1e6)}M)</div>`
        : '';
      const arbFloorNote = record.expectedArbFloored
        ? ` This is the CBA's max-cut floor (can't fall below 80% of last year's real pay, or 70% of two years ago), not a pure comp -- the stat-based case alone would have landed lower.`
        : '';
      const arbNote = (isArbEligible(record) && record.expectedArbSalary != null)
        ? `<div class="card-value-note">Arbitration-eligible — ${arbYearLabel(record)}. Comped against real arb-eligible peers on traditional stats (AVG/HR/RBI/wins/saves/etc.), tier-adjusted to ~${Math.round(arbServicePercent(record) * 100)}%: expected <strong>${fmtMoney(record.expectedArbSalary)}</strong> vs. actual ${fmtMoney(record.aav)} AAV (${fmtSigned(record.arbSurplus / 1e6)}M).${accomplishmentsNote(record)}${arbFloorNote}</div>`
        : '';
      valueHtml = `<div class="card-value-box">
        <div class="card-stat-label">Score</div>
        ${valueBar(record.score, 100)}
        <div class="card-value-note">${record.compPct.toFixed(1)}th percentile performance, paid at the ${record.salPct.toFixed(1)}th percentile for ${record.position}</div>
        ${recPayNote}
        ${arbNote}
      </div>`;
    } else if (record.projectedSalary != null) {
      valueHtml = `<div class="card-value-box">
        <div class="card-stat-label">Projected Arbitration Value</div>
        <div class="card-projected">${fmtMoney(record.projectedSalary)}</div>
        <div class="card-value-note">Comped against real Arb-1-tier peers on traditional stats (AVG/HR/RBI/wins/saves/etc.) — the stats an arbitration panel actually looks at, not advanced metrics. Assumes the standard track (~40%); Super Two eligibility (a 4th, earlier arb year) can't be predicted before a player actually reaches the tracker.${accomplishmentsNote(record)}</div>
      </div>`;
    }

    let outlookHtml = '';
    const teamControlled = record.isPreArb || isArbEligible(record);
    // A rookie with, say, 0.128 years of service isn't one tier away from
    // arbitration next season -- they're still years away (Super Two's
    // earliest real cutoff is ~2.0 years; standard arb needs 3.0). Showing
    // an "arbitration value" for a season the player legally can't be in
    // arbitration for is actively misleading, not just imprecise -- the
    // existing "Projected Arbitration Value" box above already covers
    // "whenever they eventually reach Arb-1" for every pre-arb player, so
    // there's nothing new to say here until that's plausibly close.
    const arbPlausibleNextSeason = isArbEligible(record) || (record.serviceYears || 0) + 1 >= 2.0;
    if (teamControlled && !pendingFA && arbPlausibleNextSeason) {
      // Still team-controlled and not reaching free agency next season --
      // show what arbitration/pre-arb pay actually looks like one tier out,
      // not an open-market figure this player can't legally be paid yet.
      if (record.projectedArbSalary != null) {
        const tierNote = !record.serviceYearsExact
          ? ` This estimate's arbitration tier is based on an estimated (not confirmed) service-time figure.`
          : '';
        const floorNote = record.projectedArbFloored
          ? (record.projectedArbFloorIsEmpirical
              ? ` This reflects a real-world floor, not the comp above — returning arb players almost never see a cut (only ~3% of real year-over-year settlements do, and even the worst 10% still got at least a ${(ARB_RAISE_FLOOR_PCT * 100).toFixed(0)}% raise); the comp alone would have landed lower.`
              : ` This is the CBA's max-cut floor (can't fall below 80% of this year's real pay, or 70% of last year's), not the comp above -- the comp alone would have landed lower.`)
          : '';
        const baseNote = record.projectedArbRaisePct != null
          ? `Still under team control next season — projects a <strong>${fmtSigned(record.projectedArbRaisePct * 100)}%</strong> change off this year's actual pay, matched against real arb-to-arb raises other players got at a similar performance level (2016-2025, excl. 2020), not a cross-year dollar comp.`
          : `Still under team control next season — comped against real arb-eligible peers on traditional stats (AVG/HR/RBI/wins/saves/etc.), tier-advanced to next year's expected arbitration tier. Based on this season's performance and track record, the same basis a real arbitration panel uses.`;
        outlookHtml = `
          <div class="card-section-title">Next-Season Outlook</div>
          <div class="card-value-box">
            <div class="card-stat-label">Projected Next-Season Arbitration Value</div>
            <div class="card-projected">${fmtMoney(record.projectedArbSalary)}</div>
            <div class="card-value-note">${baseNote}${accomplishmentsNote(record)}${floorNote}${tierNote}</div>
          </div>`;
      }
    } else if ((!teamControlled || pendingFA) && record.projectedPct != null && record.projectedMarketValue != null) {
      // Only reachable for players not under arb-relevant team control (or
      // actually reaching free agency) -- a rookie who's merely too far
      // from arbitration to plausibly project (arbPlausibleNextSeason
      // false above) falls through to no Outlook section at all, not this
      // open-market branch; they can't legally be paid a market rate yet.
      // The service-time branch of isNearingFreeAgency (team-controlled
      // players) can be wrong when serviceYears is the debut-year proxy
      // rather than a real accrued figure -- surface that the same way the
      // arb-tier label already does, so a bad FA call isn't silently trusted.
      const faBasisNote = pendingFA && teamControlled && !record.serviceYearsExact
        ? ` Free-agency timing here is based on an estimated (not confirmed) service-time figure.`
        : '';
      outlookHtml = `
        <div class="card-section-title">${pendingFA ? 'Pending Free Agent' : 'Next-Season Outlook'}</div>
        <div class="card-value-box">
          <div class="card-stat-label">${pendingFA ? 'Projected Free Agent Value' : 'Projected Next-Season Value'}</div>
          <div class="card-projected">${fmtMoney(record.projectedMarketValue)}</div>
          <div class="card-value-note">${record.projectedPct.toFixed(1)}th percentile projected performance for ${record.position} (Marcel + comparable-player blend) — ${pendingFA ? 'reaches free agency by next season, so this reflects' : 'not yet on the open market; this is'} projected future performance, not this season's stats.${faBasisNote}</div>
        </div>`;
    }

    const contractHtml = renderContractSection(record);
    const historyHtml = historySectionHtml(record);

    document.getElementById('card-root').innerHTML = `
      <div class="baseball-card" style="--team-1:${colors[0]}; --team-2:${colors[1]};">
        <button class="card-close" id="card-close-btn" aria-label="Close">✕</button>
        <div class="card-head">
          <div class="card-head-top"><span>${record.team}</span><span>2026</span></div>
          <div class="card-avatar-wrap">
            <div class="card-avatar">${record.headshot ? `<img src="${record.headshot}" alt="" onload="this.classList.add('img-loaded')" onerror="this.parentElement.textContent='${initials(record.name)}'">` : initials(record.name)}</div>
            <div class="card-grade-badge">${grade}</div>
          </div>
        </div>
        <div class="card-body">
          <h2 class="card-name">${record.name}</h2>
          <div class="card-subline">${record.position} · ${teamLogoImg(record.team, 15)}${teamNameByAbbr[record.team] || record.team}</div>
          ${regressionHtml}
          ${contractHtml}
          ${valueHtml}
          ${outlookHtml}
          ${percentileSection(record.isBatter ? 'Batting' : 'Pitching', statSet, record)}
          ${fieldingHtml}
          ${runningHtml}
          ${historyHtml}
        </div>
      </div>
    `;
    const overlay = document.getElementById('card-overlay');
    overlay.classList.remove('closing');
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    animateBarsIn(document.getElementById('card-root'));
    const currentRow = document.querySelector('#contract-years-scroll [data-current="1"]');
    if (currentRow) currentRow.scrollIntoView({ block: 'center' });
  }
  function closeCard() {
    const overlay = document.getElementById('card-overlay');
    overlay.classList.add('closing');
    setTimeout(() => {
      overlay.classList.remove('closing');
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    }, 160);
  }
  document.getElementById('card-overlay-bg').addEventListener('click', closeCard);
  document.getElementById('card-root').addEventListener('click', e => {
    if (e.target.id === 'card-close-btn') closeCard();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCard(); });


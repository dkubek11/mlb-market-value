  // --- Baseball card ---
  const BATTER_STATS = [
    { key: 'bwar', label: 'bWAR', type: 'velo1', higherBetter: true },
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
    { key: 'bwar', label: 'bWAR', type: 'velo1', higherBetter: true },
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
    if (type === 'fracPct1') return (v * 100).toFixed(1) + '%';
    if (type === 'velo1') return v.toFixed(1);
    if (type === 'int') return Math.round(v).toString();
    return String(v);
  }
  function gradeFor(pct) {
    if (pct >= 95) return 'A+';
    if (pct >= 90) return 'A';
    if (pct >= 85) return 'A-';
    if (pct >= 80) return 'B+';
    if (pct >= 75) return 'B';
    if (pct >= 70) return 'B-';
    if (pct >= 65) return 'C+';
    if (pct >= 55) return 'C';
    if (pct >= 40) return 'D';
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

  // Modern High-Contrast Palette: Electric Blue (#3b82f6) -> Clean Slate (#94a3b8) -> Vibrant Crimson Red (#ef4444),
  // matching Baseball Savant / Statcast percentile-ranking convention.
  const PCTL_COLOR_STOPS = [[0, [59, 130, 246]], [50, [148, 163, 184]], [100, [239, 68, 68]]];
  function percentileColor(pct) {
    const clamped = Math.max(0, Math.min(100, pct));
    const [lo, hi] = clamped <= 50 ? [PCTL_COLOR_STOPS[0], PCTL_COLOR_STOPS[1]] : [PCTL_COLOR_STOPS[1], PCTL_COLOR_STOPS[2]];
    const t = (clamped - lo[0]) / (hi[0] - lo[0]);
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
      if (val != null && ps && ps.std > 0 && w[s.key] > 0) {
        const rawZ = (val - ps.mean) / ps.std;
        const z = s.higherBetter ? rawZ : -rawZ;
        total += z * w[s.key];
        weightSqSum += w[s.key] * w[s.key];
        any = true;
      }
    });
    if (any && weightSqSum > 0) {
      const pct = normalCdf(total / Math.sqrt(weightSqSum)) * 100;
      return { rawScore: total, pct, grade: gradeFor(pct) };
    }
    // Fall back to arbitration / traditional composite which always has valid weights
    const arbPct = computeHistoricalArbGrade(entry, isBatter);
    if (arbPct != null) {
      return { rawScore: 0, pct: arbPct, grade: gradeFor(arbPct) };
    }
    return null;
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

  function gradeBadgeHtml(grade) {
    if (!grade || grade === '—') return '—';
    let cls = 'grd-c';
    if (grade === 'S' || grade === 'A+' || grade === 'A') cls = 'grd-a';
    else if (grade === 'A-') cls = 'grd-a-minus';
    else if (grade === 'B+' || grade === 'B') cls = 'grd-b';
    else if (grade === 'B-') cls = 'grd-b-minus';
    else if (grade === 'C+' || grade === 'C') cls = 'grd-c';
    else cls = 'grd-d';
    return `<span class="history-grade-pill ${cls}">${grade}</span>`;
  }

  function renderScoreCard(record, surplus, fairMarket, contractAav) {
    const scoreVal = record.score != null ? record.score : (record.surplus ? (record.surplus / 1e6) : 0);
    const isPos = scoreVal >= 0;
    const scoreDisplay = (isPos ? '+' : '') + scoreVal.toFixed(1);
    const scoreCls = isPos ? 'score-green' : 'score-red';
    
    // Center-origin bar
    const pctFromCenter = Math.min(50, Math.max(3, (Math.abs(scoreVal) / 40) * 50));
    const barStyle = isPos
      ? `left: 50%; width: ${pctFromCenter}%; background: #00e676;`
      : `right: 50%; width: ${pctFromCenter}%; background: #ef4444;`;

    const prodPctl = record.compPct != null ? Math.round(record.compPct) : 50;
    const payPctl = record.salPct != null ? Math.round(record.salPct) : 50;

    return `
      <div class="player-card-box">
        <div class="box-head-row">
          <span class="box-title">SCORE</span>
        </div>
        <div class="score-bar-row">
          <div class="score-bar-track">
            <div class="score-center-line"></div>
            <div class="score-bar-fill" style="${barStyle}"></div>
          </div>
          <span class="score-track-val mono ${scoreCls}">${scoreDisplay}</span>
        </div>
        <div class="score-metrics-list">
          <div class="score-metric-row">
            <span class="score-metric-label">On-Field Production</span>
            <span class="score-metric-val mono">${prodPctl}th Percentile</span>
          </div>
          <div class="score-metric-row">
            <span class="score-metric-label">Positional Pay</span>
            <span class="score-metric-val mono">${payPctl}th Percentile</span>
          </div>
          <div class="score-metric-row">
            <span class="score-metric-label">Fair Market Value</span>
            <span class="score-metric-val mono">${fmtMoney(fairMarket)}</span>
          </div>
          <div class="score-metric-row">
            <span class="score-metric-label">Contract AAV</span>
            <span class="score-metric-val mono">${fmtMoney(contractAav)}</span>
          </div>
          <div class="score-divider"></div>
          <div class="score-metric-row net-surplus-row">
            <span class="score-metric-label">Net Surplus</span>
            <span class="score-metric-val mono ${surplus >= 0 ? 'surplus-green' : 'surplus-red'}">
              ${surplus >= 0 ? '+' : '-'}${fmtMoney(Math.abs(surplus))}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  function renderContractStatusCard(record) {
    const startYr = CURRENT_SEASON;
    const endYr = startYr + 4;
    const c = contracts[record.id];
    const rows = [];
    const svc = record.serviceYears || (record.isPreArb ? 1.0 : 6.0);

    for (let i = 0; i < 5; i++) {
      const yr = startYr + i;
      const yEntry = c && c.years ? c.years.find(y => Number(y.season) === yr) : null;
      let status = 'Free Agent';
      let aav = '—';

      if (yEntry && yEntry.salary != null && yEntry.salary > 0) {
        status = yEntry.type && yEntry.type.includes('OPTION') ? 'Club Option' : 'Under Contract';
        aav = fmtMoney(yEntry.aav || yEntry.salary);
      } else if (yr === CURRENT_SEASON && record.salary) {
        status = 'Under Contract';
        aav = fmtMoney(record.salary);
      } else if (record.contractType === 'Extension' && i === 1 && record.salary) {
        status = 'Under Contract';
        aav = fmtMoney(record.salary);
      } else if (record.isPreArb || (svc + i) < 6.0) {
        const projSvc = svc + i;
        if (projSvc < 3.0) status = 'Pre-Arb';
        else if (projSvc < 4.0) status = 'Arb 1';
        else if (projSvc < 5.0) status = 'Arb 2';
        else status = 'Arb 3';
        aav = '—';
      } else {
        status = 'Free Agent';
        aav = '—';
      }
      const isCurrent = yr === CURRENT_SEASON;
      rows.push(`
        <tr class="contract-status-row ${isCurrent ? 'current-active-row' : ''}">
          <td class="mono font-bold">${yr}</td>
          <td>${status}</td>
          <td class="mono font-bold text-right">${aav}</td>
        </tr>
      `);
    }

    return `
      <div class="player-card-box">
        <div class="box-head-row">
          <span class="box-title">CONTRACT STATUS</span>
        </div>
        <div class="box-subtitle">Next 5 years · ${startYr}–${endYr}</div>
        <table class="card-status-table">
          <thead>
            <tr>
              <th>YEAR</th>
              <th>STATUS</th>
              <th class="text-right">AAV</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPerformanceGaugesCard(record) {
    const isBat = record.isBatter;
    const title = isBat ? 'BATTING' : 'PITCHING';

    const statDefs = isBat ? [
      { key: 'bwar', label: 'BWAR', higherBetter: true, type: 'velo1' },
      { key: 'ba', label: 'AVG', higherBetter: true, type: 'avg3' },
      { key: 'obp', label: 'OBP', higherBetter: true, type: 'avg3' },
      { key: 'slg', label: 'SLG', higherBetter: true, type: 'avg3' },
      { key: 'xwoba', altKey: 'wrc_plus', label: 'XWOBA', higherBetter: true, type: 'avg3', altType: 'int' },
      { key: 'hr', label: 'HR', higherBetter: true, type: 'int' },
      { key: 'sb', label: 'SB', higherBetter: true, type: 'int' },
    ] : [
      { key: 'bwar', label: 'FWAR', higherBetter: true, type: 'velo1' },
      { key: 'era', label: 'ERA', higherBetter: false, type: 'rate2' },
      { key: 'fip', label: 'FIP', higherBetter: false, type: 'rate2' },
      { key: 'whip', label: 'WHIP', higherBetter: false, type: 'rate2' },
      { key: 'k_rate', altKey: 'k_9', label: 'K%', higherBetter: true, type: 'fracPct1', altType: 'rate2' },
      { key: 'bb_rate', altKey: 'bb_9', label: 'BB%', higherBetter: false, type: 'fracPct1', altType: 'rate2' },
      { key: 'ip', label: 'IP', higherBetter: true, type: 'int' },
    ];

    const gaugeRows = statDefs.map(s => {
      let rawVal = record.stats[s.key];
      let type = s.type;
      let pctl = statPercentile(record, s.key, s.higherBetter);
      if (rawVal == null && s.altKey) {
        rawVal = record.stats[s.altKey];
        type = s.altType;
        pctl = statPercentile(record, s.altKey, s.higherBetter);
      }
      if (pctl == null) pctl = Math.round(record.compPct || 50);
      const valText = fmtStatValue(type, rawVal);
      const barColor = percentileColor(pctl);

      return `
        <div class="gauge-slider-row">
          <span class="gauge-label">${s.label}</span>
          <div class="gauge-track">
            <div class="gauge-fill" style="width: ${pctl}%; background: ${barColor};">
              <span class="gauge-bubble" style="background: ${barColor};">${pctl}</span>
            </div>
          </div>
          <span class="gauge-val mono">${valText}</span>
        </div>
      `;
    }).join('');

    // Regression Callout
    const arrow = regressionArrow(record);
    let regressionBox = '';
    if (arrow) {
      const isOutperforming = arrow.cls === 'good';
      const sym = isOutperforming ? '▼' : '▲';
      const symCls = isOutperforming ? 'reg-red' : 'reg-green';
      const statName = arrow.sig.label;
      const actualStr = fmtStatValue(arrow.sig.type, arrow.sig.actual);
      const projStr = fmtStatValue(arrow.sig.type, arrow.sig.projected);
      const desc = isOutperforming
        ? 'Outperforming his peripherals, regression likely.'
        : 'Underperforming his peripherals, positive regression likely.';

      regressionBox = `
        <div class="regression-callout-box">
          <div class="regression-left">
            <div class="regression-headline ${symCls}">
              <span class="regression-arrow-sym">${sym}</span> ${actualStr} ${statName}
            </div>
            <div class="regression-subline mono">vs. ${projStr} projected</div>
          </div>
          <div class="regression-right">${desc}</div>
        </div>
      `;
    }

    return `
      <div class="player-card-box">
        <div class="box-head-row">
          <span class="box-title">${title}</span>
        </div>
        <div class="gauge-legend-row">
          <span class="legend-poor">POOR</span>
          <span class="legend-avg">AVERAGE</span>
          <span class="legend-great">GREAT</span>
        </div>
        <div class="gauge-sliders-wrap">
          ${gaugeRows}
        </div>
        ${regressionBox}
      </div>
    `;
  }

  function renderSalaryPeersCard(record, surplus) {
    const targetSal = record.salary || record.aav || 0;
    const isPre = !!record.isPreArb;
    const posLabel = record.position;

    let pool = allPlayers.filter(p => {
      if (p.isBatter !== record.isBatter) return false;
      if (record.position === 'SP' || record.position === 'RP') {
        return p.position === record.position;
      }
      return p.position === record.position;
    });

    let tol = isPre ? 350000 : 2500000;
    let peers = pool.filter(p => Math.abs((p.salary || 0) - targetSal) <= tol);
    if (peers.length < 5) {
      tol = isPre ? 600000 : 4500000;
      peers = pool.filter(p => Math.abs((p.salary || 0) - targetSal) <= tol);
    }
    if (!peers.some(p => p.id === record.id)) peers.push(record);
    peers.sort((a, b) => (b.compPct || 0) - (a.compPct || 0));

    const totalPeers = peers.length;
    const rank = peers.findIndex(p => p.id === record.id) + 1;

    let startIdx = 0;
    if (totalPeers > 6) {
      startIdx = Math.max(0, Math.min(totalPeers - 6, rank - 3));
    }
    const displayPeers = peers.slice(startIdx, startIdx + 6);

    const peerRows = displayPeers.map((p, idx) => {
      const peerRank = startIdx + idx + 1;
      const isActive = p.id === record.id;
      const peerSurplus = playerSurplus(p);
      const pctl = Math.round(p.compPct || 0);

      return `
        <tr class="peer-row ${isActive ? 'active-peer-row' : ''}">
          <td class="mono font-bold peer-rank-col">${peerRank}</td>
          <td class="peer-team-col ${isActive ? 'team-active-gold' : ''}">${p.team}</td>
          <td class="peer-name-col ${isActive ? 'name-active-bold' : ''}">${p.name}</td>
          <td class="mono font-bold">${fmtMoney(p.salary || p.aav)}</td>
          <td class="mono font-bold ${isActive ? 'perf-active-gold' : ''}">${pctl}th</td>
          <td class="mono font-bold ${peerSurplus >= 0 ? 'surplus-green' : 'surplus-red'}">
            ${peerSurplus >= 0 ? '+' : '-'}${fmtMoney(Math.abs(peerSurplus))}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="player-card-box">
        <div class="box-head-row salary-peers-head">
          <span class="box-title">POSITION RANK AMONG SALARY PEERS - ${posLabel}</span>
          <div class="peer-rank-badge">
            <span class="rank-num">#${rank}</span>
            <span class="rank-total">of ${totalPeers}</span>
          </div>
        </div>
        <table class="card-peers-table">
          <thead>
            <tr>
              <th>#</th>
              <th>TEAM</th>
              <th>PLAYER</th>
              <th>AAV</th>
              <th>PERF</th>
              <th>SURPLUS</th>
            </tr>
          </thead>
          <tbody>
            ${peerRows}
          </tbody>
        </table>
        <div class="card-box-footer-note">
          Benchmarked against salary peers within ±$${(tol / 1e6).toFixed(1)}M of ${fmtMoney(targetSal)} AAV, ranked by on-field production.
        </div>
      </div>
    `;
  }

  function renderFiveYearHistoryCard(record) {
    const history = record.history || [];
    if (!history.length) return '';

    const isBat = record.isBatter;
    const colHeaders = isBat ? `
      <th>YR</th>
      <th>POS</th>
      <th>HR</th>
      <th>BA</th>
      <th>RBI</th>
      <th>PERF%</th>
      <th>GRD</th>
    ` : `
      <th>YR</th>
      <th>POS</th>
      <th>W</th>
      <th>ERA</th>
      <th>K</th>
      <th>PERF%</th>
      <th>GRD</th>
    `;

    const rows = history.slice(0, 5).map(entry => {
      const grade = computeHistoricalGrade(entry, isBat);
      const yr = entry.season;
      const pos = entry.position || record.position;
      const pctStr = grade != null ? grade.pct.toFixed(1) : '—';
      const grdBadge = grade != null ? gradeBadgeHtml(grade.grade) : '—';

      let statCols = '';
      if (isBat) {
        const hr = entry.stats.hr != null ? Math.round(entry.stats.hr) : '—';
        const ba = entry.stats.ba != null ? fmtStatValue('avg3', entry.stats.ba) : '—';
        const rbi = entry.stats.rbi != null ? Math.round(entry.stats.rbi) : '—';
        statCols = `
          <td class="mono font-bold">${hr}</td>
          <td class="mono font-bold">${ba}</td>
          <td class="mono font-bold">${rbi}</td>
        `;
      } else {
        const w = entry.stats.wins != null ? Math.round(entry.stats.wins) : (entry.stats.w != null ? entry.stats.w : '—');
        const era = entry.stats.era != null ? entry.stats.era.toFixed(2) : '—';
        let k = '—';
        if (entry.stats.strikeouts != null) k = Math.round(entry.stats.strikeouts);
        else if (entry.stats.k != null) k = Math.round(entry.stats.k);
        else if (entry.stats.so != null) k = Math.round(entry.stats.so);
        else if (entry.stats.k_9 && entry.stats.ip) k = Math.round(entry.stats.k_9 * entry.stats.ip / 9);
        statCols = `
          <td class="mono font-bold">${w}</td>
          <td class="mono font-bold">${era}</td>
          <td class="mono font-bold">${k}</td>
        `;
      }

      return `
        <tr class="history-data-row">
          <td class="mono font-bold">${yr}</td>
          <td class="mono font-bold">${pos}</td>
          ${statCols}
          <td class="mono font-bold">${pctStr}</td>
          <td>${grdBadge}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="player-card-box">
        <div class="box-head-row">
          <span class="box-title">5-YEAR HISTORY</span>
        </div>
        <table class="card-history-table">
          <thead>
            <tr>
              ${colHeaders}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div class="card-box-footer-note">
          Performance vs. that season's position peers only (estimated percentile). Past seasons have no salary history, so there's no historical Score.
        </div>
      </div>
    `;
  }

  function openPlayerCard(record) {
    if (!record) return;
    const colors = teamColors[record.team] || ['#3a4a42', '#1a231e'];
    const tier = tierForPlayer(record);
    const contract = contractLabel(record);
    const surplus = playerSurplus(record);
    const fairMarket = playerMarketValue(record);
    const contractAav = record.aav || record.salary || 0;
    const teamFullName = (teamNameByAbbr[record.team] || record.team).toUpperCase();

    const tierLabelMap = {
      a: 'Tier A/Great',
      b: 'Tier B/Good',
      c: 'Tier C/Avg',
      d: 'Tier D/Below Avg',
      f: 'Tier F/Poor',
      great: 'Tier A/Great',
      good: 'Tier B/Good',
      avg: 'Tier C/Avg',
      below: 'Tier D/Below Avg',
      poor: 'Tier F/Poor'
    };
    const tierBadgeText = tierLabelMap[tier.cls] || `Tier ${tier.label}`;

    // Hero Banner
    const heroHtml = `
      <div class="card-hero-banner" style="background: linear-gradient(135deg, ${colors[0]}, ${colors[1]});">
        <button class="card-close" id="card-close-btn" aria-label="Close">✕</button>
        <div class="card-hero-content">
          <div class="card-hero-avatar">
            ${headshotHtml(record, 'card-hero-img')}
          </div>
          <div class="card-hero-info">
            <div class="card-hero-title-row">
              <h2 class="card-hero-name">${record.name}</h2>
              <span class="card-tier-pill tier-${tier.cls}">${tierBadgeText}</span>
            </div>
            <div class="card-hero-meta">${record.position} · ${teamFullName}</div>
            <div class="card-hero-tag-row">
              <span class="card-contract-badge">${contract.label}</span>
              <span class="card-salary-mono">${fmtMoney(record.salary)} in ${CURRENT_SEASON}</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const scoreHtml = renderScoreCard(record, surplus, fairMarket, contractAav);
    const contractStatusHtml = renderContractStatusCard(record);
    const gaugesHtml = renderPerformanceGaugesCard(record);
    const salaryPeersHtml = renderSalaryPeersCard(record, surplus);
    const historyHtml = renderFiveYearHistoryCard(record);

    document.getElementById('card-root').innerHTML = `
      <div class="baseball-card modern-player-card">
        ${heroHtml}
        <div class="card-content-stack">
          ${scoreHtml}
          ${contractStatusHtml}
          ${gaugesHtml}
          ${salaryPeersHtml}
          ${historyHtml}
        </div>
      </div>
    `;

    const overlay = document.getElementById('card-overlay');
    overlay.classList.remove('closing');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.style.display = 'flex';
    document.body.classList.add('pc-locked');
  }

  function closeCard() {
    const overlay = document.getElementById('card-overlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    overlay.classList.add('closing');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      overlay.classList.remove('closing');
      overlay.style.display = 'none';
      document.body.classList.remove('pc-locked');
    }, 160);
  }
  document.getElementById('card-overlay-bg').addEventListener('click', closeCard);
  document.getElementById('card-root').addEventListener('click', e => {
    if (e.target.id === 'card-close-btn') closeCard();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCard(); });


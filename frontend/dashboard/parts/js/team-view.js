  // Team-page renderer: derives every module from the same live records the
  // global tables use, so weight changes update the team page too.
  const TEAM_UNITS = [
    { key: 'rotation', name: 'Starting Rotation', positions: ['SP'] },
    { key: 'bullpen', name: 'Relief Corps', positions: ['RP'] },
    { key: 'infield', name: 'Infield & Catching', positions: ['C', '1B', '2B', '3B', 'SS'] },
    { key: 'outfield', name: 'Outfield & DH', positions: ['LF', 'CF', 'RF', 'DH'] },
  ];
  const RUNWAY_YEARS = 4;

  function teamBySlug(slug) {
    const q = String(slug || '').toLowerCase();
    return teams.find(t => {
      const abbr = t.abbr.toLowerCase();
      return abbr === q || teamSlug(t) === q || q.startsWith(abbr + '-');
    });
  }
  function teamUnitStats(team) {
    const players = allPlayers.filter(p => p.team === team.abbr);
    return TEAM_UNITS.map(unit => {
      const pool = players.filter(p => unit.positions.includes(p.position));
      const spend = pool.reduce((a, p) => a + (p.salary || 0), 0);
      const value = pool.reduce((a, p) => a + playerMarketValue(p), 0);
      return { ...unit, pool, spend, value, net: value - spend };
    });
  }
  function unitRank(team, unitKey) {
    const rows = teams.map(t => {
      const u = teamUnitStats(t).find(x => x.key === unitKey);
      return { abbr: t.abbr, net: u ? u.net : 0 };
    }).sort((a, b) => b.net - a.net);
    return rows.findIndex(r => r.abbr === team.abbr) + 1;
  }
  function teamMetrics(team) {
    const players = allPlayers.filter(p => p.team === team.abbr);
    const qualifiedPayroll = players.reduce((a, p) => a + (p.salary || 0), 0);
    const unqualifiedPayroll = Math.max(0, (team.payroll || 0) - qualifiedPayroll);
    const qualifiedMarket = players.reduce((a, p) => a + playerMarketValue(p), 0);
    const projectedValue = qualifiedMarket + unqualifiedPayroll;
    const surplus = projectedValue - (team.payroll || 0);
    const ranked = [...teams].sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));
    const overall = ranked.findIndex(t => t.abbr === team.abbr) + 1;
    const leagueRows = ranked.filter(t => t.league === team.league);
    const league = leagueRows.findIndex(t => t.abbr === team.abbr) + 1;
    return { players, projectedValue, surplus, overall, league, leagueSize: leagueRows.length };
  }
  function teamOutlook(team, metrics) {
    const players = metrics.players;
    const current = CURRENT_SEASON;
    const next = current + 1;
    const expiring = players.filter(p => {
      const c = contracts[p.id];
      if (!c) return false;
      const hasNext = (c.years || []).some(y => Number(y.season) === next && y.salary);
      const hasAfter = (c.years || []).some(y => Number(y.season) === next + 1 && y.salary);
      return hasNext && !hasAfter;
    });
    const expiringMoney = expiring.reduce((a, p) => {
      const y = (contracts[p.id].years || []).find(y => Number(y.season) === next);
      return a + (y && y.salary ? y.salary : 0);
    }, 0);
    const veterans = players.filter(p => p.age != null && p.age >= 31);
    const veteranMoney = veterans.reduce((a, p) => a + (p.salary || 0), 0);
    const arb = players.filter(p => !p.isPreArb && typeof isArbEligible === 'function' && isArbEligible(p));
    const names = list => list.slice(0, 4).map(p => p.name).join(', ');
    return [
      {
        dot: 'dot-green',
        label: `Clearing Money (after ${next})`,
        value: expiringMoney ? `-${fmtMoney(expiringMoney)}` : '—',
        valueClass: 'surplus-pos',
        tag: expiringMoney > (team.payroll || 0) * 0.2 ? 'High Flexibility' : 'Moderate',
        tagClass: 'tag-green',
        detail: expiring.length
          ? `The expiring deals of <strong>${names(expiring)}</strong> clear <strong>${fmtMoney(expiringMoney)}</strong> (${team.payroll ? Math.round(expiringMoney / team.payroll * 100) : 0}% of payroll) after ${next}.`
          : `No material commitments expire immediately after ${next}; the current core stays on the books.`,
      },
      {
        dot: 'dot-gold',
        label: 'Core Veterans (Age 31+)',
        value: fmtMoney(veteranMoney),
        valueClass: '',
        tag: `${team.payroll ? Math.round(veteranMoney / team.payroll * 100) : 0}% of Payroll`,
        tagClass: 'tag-gold',
        detail: veterans.length
          ? `Guarantees for <strong>${names(veterans)}</strong> carry the veteran money on the books. Aging curves point to regression risk.`
          : 'The roster is young — no age-31+ salaries are currently committed.',
      },
      {
        dot: 'dot-blue',
        label: 'Arbitration Escalation',
        value: `${arb.length} Key Contributors`,
        valueClass: '',
        tag: arb.length ? 'Escalating' : 'Stable',
        tagClass: 'tag-blue',
        detail: arb.length
          ? `<strong>${names(arb)}</strong> are arb-eligible and will see salary awards ramp up, narrowing cost-controlled surplus margins.`
          : 'No arbitration-eligible contributors are due for a significant raise in this build.',
      },
    ];
  }
  function runwayForTeam(team) {
    const players = allPlayers.filter(p => p.team === team.abbr);
    return Array.from({ length: RUNWAY_YEARS }, (_, i) => {
      const season = CURRENT_SEASON + i;
      const rows = [];
      players.forEach(p => {
        const c = contracts[p.id];
        const y = c && (c.years || []).find(y => Number(y.season) === season);
        const amount = y && y.salary ? y.salary : (season === CURRENT_SEASON ? p.salary : 0);
        if (amount) rows.push({ p, amount });
      });
      rows.sort((a, b) => b.amount - a.amount);
      return { season, total: rows.reduce((a, r) => a + r.amount, 0), rows: rows.slice(0, 8) };
    });
  }
  function setTeamTheme(team) {
    const pair = teamColors[team.abbr] || ['#6aa9e9', '#1b3a5c'];
    document.documentElement.style.setProperty('--color-primary', pair[0]);
    document.documentElement.style.setProperty('--color-secondary', pair[1]);
  }
  function resetTeamTheme() {
    document.documentElement.style.removeProperty('--color-primary');
    document.documentElement.style.removeProperty('--color-secondary');
  }

  function teamSpotlightHtml(team, metrics) {
    const rows = [...metrics.players]
      .map(p => ({ p, surplus: p.isPreArb ? (p.surplus || 0) : (p.paySurplus || 0) }))
      .sort((a, b) => b.surplus - a.surplus)
      .slice(0, 8);
    return rows.map(({ p, surplus }) => {
      const tier = tierForPlayer(p);
      return `<article class="player-card-vertical" data-team-pid="${p.id}" data-team-pos="${p.position}">
        <div class="avatar-wrapper">${headshotHtml(p, 'player-img ring-tier-' + (tier.cls === 'a' ? 'elite' : tier.cls === 'b' ? 'good' : 'poor'))}</div>
        <h3 class="player-info-name">${p.name}</h3>
        <div class="player-info-meta">${p.position}</div>
        <div class="player-value-row">
          <span class="surplus-tag ${surplus >= 0 ? 'tag-surplus-positive' : 'tag-surplus-gold'}">${fmtSignedMoney(surplus)}</span>
          <span class="value-sep">/</span>
          <span class="status-badge ${tier.status}">${tier.label}</span>
        </div>
        <div class="player-stats-bar">
          <div class="stat-metric-item"><span class="stat-metric-label">AAV</span><span class="stat-metric-value">${fmtMoney(p.aav)}</span></div>
          <div class="stat-metric-item"><span class="stat-metric-label">Perf. Score</span><span class="stat-metric-value" style="color:${tier.cls === 'a' ? '#00e676' : tier.cls === 'b' ? '#8bc34a' : '#ff5252'}">${Math.round(p.compPct)}th</span></div>
          <div class="stat-metric-item"><span class="stat-metric-label">Primary Driver</span><span class="stat-metric-value">${primaryDriver(p)}</span></div>
        </div>
      </article>`;
    }).join('');
  }

  function teamUnitHtml(team) {
    const units = teamUnitStats(team);
    const maxAbs = Math.max(...units.map(u => Math.abs(u.net)), 1);
    return units.map(u => {
      const rank = unitRank(team, u.key);
      const rankCls = rank <= 10 ? 'rank-good' : rank <= 20 ? 'rank-mid' : 'rank-poor';
      return `<article class="matrix-card">
        <div class="matrix-card-header"><span class="unit-name">${u.name}</span><span class="unit-rank ${rankCls}">#${rank} in MLB</span></div>
        <div class="matrix-stat-row"><span class="matrix-label">Total Spend</span><span class="matrix-value">${fmtMoney(u.spend)}</span></div>
        <div class="matrix-stat-row"><span class="matrix-label">Projected Value</span><span class="matrix-value">${fmtMoney(u.value)}</span></div>
        <div class="matrix-stat-row total-highlight"><span class="matrix-label">Net Surplus</span><span class="matrix-value ${u.net >= 0 ? 'surplus-pos' : 'surplus-neg'}">${fmtSignedMoney(u.net)}</span></div>
        <div class="unit-breakdown-bar"><div class="bar-fill" style="width:${Math.round(Math.abs(u.net) / maxAbs * 100)}%;background:${u.net >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};"></div></div>
      </article>`;
    }).join('');
  }

  function teamRosterHtml(team) {
    const rows = [...allPlayers.filter(p => p.team === team.abbr)]
      .sort((a, b) => ((b.paySurplus != null ? b.paySurplus : b.surplus) || 0) - ((a.paySurplus != null ? a.paySurplus : a.surplus) || 0));
    return rows.map((p, i) => {
      const tier = tierForPlayer(p);
      const contract = contractLabel(p);
      const surplus = p.isPreArb ? (p.surplus || 0) : (p.paySurplus || 0);
      const value = playerMarketValue(p);
      return `<tr class="team-roster-row" data-roster-idx="${i}" data-search="${(p.name + ' ' + p.position).toLowerCase()}">
        <td class="player-cell">${headshotHtml(p, 'table-avatar')}<span class="player-name-text">${p.name}</span></td>
        <td><span class="pos-badge">${p.position}</span></td>
        <td><span class="badge-tier ${tier.cls}">${tier.label}</span></td>
        <td><span class="contract-tag ${contract.cls}">${contract.label}</span></td>
        <td class="mono">$${(p.salary || 0).toLocaleString()}</td>
        <td class="mono font-bold ${perfPercentileCls(Math.round(p.compPct))}">${formatOrdinal(Math.round(p.compPct))}</td>
        <td class="mono">$${Math.round(value).toLocaleString()}</td>
        <td class="mono font-bold ${surplus >= 0 ? 'surplus-pos' : 'surplus-neg'}">${surplus >= 0 ? '+' : '-'}$${Math.abs(Math.round(surplus)).toLocaleString()}</td>
        <td class="mono">${primaryDriver(p)}</td>
      </tr>`;
    }).join('');
  }

  function teamRunwayHtml(team) {
    const years = runwayForTeam(team);
    const max = Math.max(...years.map(y => y.total), 1);
    return years.map(y => `<div class="year-slide">
      <div class="year-column">
        <div class="year-figure">
          <div class="year-label">${y.season}</div>
          <div class="year-bar-stack"><div class="bar-segment payroll-bar" style="height:${Math.max(6, Math.round(y.total / max * 180))}px;" title="Committed: ${fmtMoney(y.total)}"></div></div>
          <div class="year-stat mono">${fmtMoney(y.total)}</div>
        </div>
        <div class="year-perf-tag tier-a">${y.rows.length} deals</div>
      </div>
      <ul class="year-player-list">${y.rows.map(r => `<li><span class="player-name-wrapper">${headshotHtml(r.p, 'table-avatar mini-avatar')}<span class="player-name-text">${r.p.name}</span></span><span class="player-pos">${r.p.position}</span><span class="player-amount">${fmtMoney(r.amount)}</span></li>`).join('') || '<li class="empty">No committed salary</li>'}</ul>
    </div>`).join('');
  }

  function teamOutlookHtml(team, metrics) {
    const items = teamOutlook(team, metrics);
    return items.map(item => `<div class="outlook-item">
      <div class="outlook-top-row">
        <span class="outlook-label"><span class="outlook-dot ${item.dot}"></span>${item.label}</span>
        <div class="outlook-badges"><span class="outlook-value mono ${item.valueClass}">${item.value}</span><span class="outlook-tag ${item.tagClass}">${item.tag}</span></div>
      </div>
      <p class="outlook-detail">${item.detail}</p>
    </div>`).join('');
  }

  let activeTeamAbbr = null;
  function renderTeamPage(slug) {
    const team = teamBySlug(slug);
    if (!team) { resetTeamTheme(); return false; }
    activeTeamAbbr = team.abbr;
    setTeamTheme(team);
    const metrics = teamMetrics(team);
    const root = document.getElementById('team-view');
    root.innerHTML = `
      <header class="team-hero-header">
        <div class="team-hero-title-row">
          ${teamLogoImg(team.abbr, 104).replace('class="team-logo"', 'class="team-hero-logo"')}
          <div class="team-hero-text-group">
            <h1 class="team-hero-heading">${team.name}</h1>
            <p class="team-hero-subtext">${team.division}</p>
          </div>
          <div class="macro-metric-grid">
            <div class="macro-metric-card"><span class="macro-metric-label">${CURRENT_SEASON} Active Payroll</span><span class="macro-metric-value">${fmtMoney(team.payroll)}</span></div>
            <div class="macro-metric-card"><span class="macro-metric-label">Projected Market Value</span><span class="macro-metric-value">${fmtMoney(metrics.projectedValue)}</span></div>
            <div class="macro-metric-card"><span class="macro-metric-label">Net Surplus / Deficit</span><span class="macro-metric-value ${metrics.surplus >= 0 ? 'macro-value-positive' : 'macro-value-negative'}">${metrics.surplus >= 0 ? '+' : '-'}${fmtMoney(Math.abs(metrics.surplus))}</span></div>
            <div class="macro-metric-card"><span class="macro-metric-label">Efficiency Rank</span><span class="unit-rank ${metrics.overall <= 10 ? 'rank-good' : metrics.overall <= 20 ? 'rank-mid' : 'rank-poor'}">#${metrics.overall} MLB / #${metrics.league} ${team.league}</span></div>
          </div>
        </div>
      </header>
      <section class="carousel-section">
        <div class="carousel-header"><div class="carousel-title-group"><h2 class="section-title">Key Players Spotlight</h2><p class="carousel-subtitle">Key players ranked by surplus dollar value and standardized performance scores</p></div></div>
        <div class="carousel-track">${teamSpotlightHtml(team, metrics)}</div>
      </section>
      <section class="section-block">
        <div class="section-header"><div><h2 class="section-title">Positional Efficiency & Cost Control</h2><p class="section-subtitle">Payroll allocation and net surplus generation grouped by unit and contract cohort</p></div></div>
        <div class="pos-matrix-grid">${teamUnitHtml(team)}</div>
      </section>
      <section class="section-block">
        <div class="section-header"><div><h2 class="section-title">Roster Value</h2><p class="section-subtitle">Comprehensive position-adjusted percentiles, compensation, and primary stat drivers</p></div><div class="table-toolbar"><input type="text" id="roster-search-input" class="table-search-input" placeholder="Filter by player or position..." /></div></div>
        <div class="table-container"><table class="roster-table" id="team-roster-table"><thead><tr><th>Player</th><th>Pos</th><th>Value Tier</th><th>Contract</th><th>${CURRENT_SEASON} Salary</th><th>Perf %</th><th>Projected Market</th><th>Net Surplus / Deficit</th><th>Key Stat Driver</th></tr></thead><tbody id="team-roster-body">${teamRosterHtml(team)}</tbody></table></div>
      </section>
      <section class="section-block">
        <div class="section-header"><div><h2 class="section-title">Projected Future</h2><p class="section-subtitle">Future guaranteed payroll commitments and expiring money</p></div></div>
        <div class="runway-flex">
          <div class="runway-card"><h3 class="card-subtitle">Committed Payroll</h3><div class="runway-carousel"><button type="button" class="runway-nav runway-nav-prev" aria-label="Previous year">&#8249;</button><div class="runway-track" id="runway-track">${teamRunwayHtml(team)}</div><button type="button" class="runway-nav runway-nav-next" aria-label="Next year">&#8250;</button></div></div>
          <div class="runway-summary-card"><div class="outlook-header"><h3 class="card-subtitle">Payroll Outlook</h3><span class="outlook-window-badge">${CURRENT_SEASON}–${CURRENT_SEASON + 2} Horizon</span></div><div class="outlook-metric-list">${teamOutlookHtml(team, metrics)}</div></div>
        </div>
      </section>`;
    root.style.display = 'block';

    const search = document.getElementById('roster-search-input');
    if (search) search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      root.querySelectorAll('.team-roster-row').forEach(row => {
        row.style.display = !q || row.dataset.search.includes(q) ? '' : 'none';
      });
    });
    const track = document.getElementById('runway-track');
    root.querySelectorAll('.runway-nav').forEach(btn => btn.addEventListener('click', () => {
      if (track) track.scrollBy({ left: btn.classList.contains('runway-nav-next') ? 360 : -360, behavior: 'smooth' });
    }));
    root.querySelectorAll('[data-team-pid]').forEach(card => card.addEventListener('click', () => {
      const p = findPlayerRecord(Number(card.dataset.teamPid), card.dataset.teamPos);
      if (p) openPlayerCard(p);
    }));
    root.querySelectorAll('.team-roster-row').forEach(row => row.addEventListener('click', () => {
      const p = allPlayers.filter(x => x.team === team.abbr)
        .sort((a, b) => ((b.paySurplus != null ? b.paySurplus : b.surplus) || 0) - ((a.paySurplus != null ? a.paySurplus : a.surplus) || 0))[Number(row.dataset.rosterIdx)];
      if (p) openPlayerCard(p);
    }));
    return true;
  }

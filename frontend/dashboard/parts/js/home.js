  // --- Home (v2): dual league carousels + Explore ---
  const teamAbbrToLeague = Object.fromEntries(teams.map(t => [t.abbr, t.league]));
  const marketPlayers = allPlayers.filter(p => !p.isPreArb);
  const carouselState = {
    'nl-bat': 0,
    'nl-pit': 0,
    'al-bat': 0,
    'al-pit': 0,
  };
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

  function homePlayerTheadHtml(extraThs = '') {
    return `<thead>
      <tr>
        <th>Player</th>
        <th>Pos</th>
        <th>Value Tier</th>
        <th>Contract</th>
        <th class="mono">${CURRENT_SEASON} Salary</th>
        <th class="mono">Perf %</th>
        <th class="mono">Projected Market</th>
        <th class="mono">Net Surplus / Deficit</th>
        <th class="mono">Key Stat Driver</th>${extraThs}
      </tr>
    </thead>`;
  }

  function homePlayerRowHtml(p, extraTds = '') {
    const tier = tierForPlayer(p);
    const contract = contractLabel(p);
    const surplus = playerSurplus(p);
    const market = playerMarketValue(p);
    const pctl = p.compPct != null ? Math.round(p.compPct) : null;
    const pidx = pushHomeRow(p);
    return `<tr class="player-roster-row" data-pidx="${pidx}" tabindex="0">
      <td class="player-cell">${headshotHtml(p, 'table-avatar')}<div class="name-meta"><span class="player-name-text">${p.name}</span><span class="team-tag">${teamLogoImg(p.team, 13)}${p.team}</span></div></td>
      <td><span class="pos-badge">${p.position}</span></td>
      <td><span class="badge-tier ${tier.cls}">${tier.label}</span></td>
      <td><span class="contract-tag ${contract.cls}">${contract.label}</span></td>
      <td class="mono">$${(p.salary || 0).toLocaleString()}</td>
      <td class="mono font-bold ${perfPercentileCls(pctl)}">${formatOrdinal(pctl)}</td>
      <td class="mono">$${Math.round(market).toLocaleString()}</td>
      <td class="mono font-bold ${surplus >= 0 ? 'surplus-pos' : 'surplus-neg'}">${surplus >= 0 ? '+' : '-'}$${Math.abs(Math.round(surplus)).toLocaleString()}</td>
      <td class="mono">${primaryDriver(p)}</td>${extraTds}
    </tr>`;
  }

  function renderCarousel(carouselId) {
    if (carouselId === 'nl' || carouselId === 'al') {
      renderCarousel(carouselId + '-bat');
      renderCarousel(carouselId + '-pit');
      return;
    }
    const idx = carouselState[carouselId] || 0;
    const parts = carouselId.split('-');
    const league = parts[0] || 'nl';
    const group = parts[1] || 'bat';
    const leagueUpper = league.toUpperCase();
    const isBatter = group === 'bat';
    const label = isBatter ? 'Position Players' : 'Pitchers';
    const inLeague = marketPlayers.filter(p => leagueOf(p) === leagueUpper);
    const players = inLeague.filter(p => isBatter ? p.isBatter : !p.isBatter);

    const slideHtml = (s) => {
      const dir = s === 0 ? 'desc' : 'asc';
      const sortFn = (a, b) => dir === 'desc' ? b.score - a.score : a.score - b.score;
      const records = [...players].sort(sortFn).slice(0, 8);
      const rows = records.length
        ? `<div class="table-container table-scroll">
            <table class="roster-table">
              ${homePlayerTheadHtml('<th class="mono">Score</th>')}
              <tbody>
                ${records.map(p => homePlayerRowHtml(p, `<td class="mono font-bold ${p.score >= 0 ? 'surplus-pos' : 'surplus-neg'}">${fmtSigned(p.score)}</td>`)).join('')}
              </tbody>
            </table>
          </div>`
        : `<div class="empty">No qualifying ${label.toLowerCase()} in the ${leagueUpper}.</div>`;
      return `<div class="carousel-slide${s === idx ? ' active' : ''}" data-slide="${s}">
        ${rows}
      </div>`;
    };

    const slidesEl = document.getElementById('slides-' + carouselId);
    if (slidesEl) slidesEl.innerHTML = [0, 1].map(slideHtml).join('');
    const badge = document.getElementById('badge-' + carouselId);
    if (badge) {
      badge.textContent = idx === 0 ? 'UNDER VALUED' : 'OVER VALUED';
      badge.classList.toggle('under', idx === 0);
      badge.classList.toggle('over', idx !== 0);
    }
    const dotsEl = document.getElementById('dots-' + carouselId);
    if (dotsEl) {
      dotsEl.innerHTML = [0, 1].map(s =>
        `<button class="carousel-dot${s === idx ? ' active' : ''}" data-carousel="${carouselId}" data-slide="${s}" aria-label="Slide ${s + 1}"></button>`
      ).join('');
    }
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
    const hotBat = [], hotPit = [];
    const coldBat = [], coldPit = [];
    allPlayers.forEach(p => {
      const arrow = last30Arrow(p);
      if (!arrow) return;
      const target = arrow.cls === 'good'
        ? (p.isBatter ? hotBat : hotPit)
        : (p.isBatter ? coldBat : coldPit);
      target.push({ p, sig: arrow.sig });
    });
    hotBat.sort((a, b) => b.sig.gap - a.sig.gap);
    hotPit.sort((a, b) => b.sig.gap - a.sig.gap);
    coldBat.sort((a, b) => a.sig.gap - b.sig.gap);
    coldPit.sort((a, b) => a.sig.gap - b.sig.gap);

    function pickTop10(batList, pitList) {
      const bCount = Math.min(5, batList.length);
      const pCount = Math.min(5, pitList.length);
      const extraB = Math.min(batList.length - bCount, Math.max(0, 10 - bCount - pCount));
      const extraP = Math.min(pitList.length - pCount, Math.max(0, 10 - bCount - pCount - extraB));
      const combined = [
        ...batList.slice(0, bCount + extraB),
        ...pitList.slice(0, pCount + extraP),
      ];
      combined.sort((a, b) => {
        const aPct = a.sig.projected ? Math.abs(a.sig.gap / a.sig.projected) : 0;
        const bPct = b.sig.projected ? Math.abs(b.sig.gap / b.sig.projected) : 0;
        return bPct - aPct;
      });
      return combined;
    }

    const hot = pickTop10(hotBat, hotPit);
    const cold = pickTop10(coldBat, coldPit);

    const formatDeltaTd = ({ p, sig }) => {
      const dPct = sig.projected ? (sig.gap / sig.projected) * 100 : null;
      const delta = dPct != null ? (dPct >= 0 ? '+' : '') + dPct.toFixed(1) + '%' : '';
      const over = sig.gap > 0;
      return `<td class="mono font-bold ${over ? 'surplus-pos' : 'surplus-neg'}">${delta} <span class="regression-tag ${over ? 'good' : 'bad'}">${over ? '▲' : '▼'}</span></td>`;
    };

    const hasLast30Data = allPlayers.some(p => p.last30 != null);
    const emptyMsg = hasLast30Data
      ? 'No players past the noise threshold in this build.'
      : 'No trailing 30-day regular season data available for this season window.';

    const hotTable = hot.length
      ? `<div class="table-container table-scroll">
          <table class="roster-table">
            ${homePlayerTheadHtml('<th class="mono">Streak Delta</th>')}
            <tbody>
              ${hot.map(item => homePlayerRowHtml(item.p, formatDeltaTd(item))).join('')}
            </tbody>
          </table>
        </div>`
      : `<div class="empty">${emptyMsg}</div>`;

    const coldTable = cold.length
      ? `<div class="table-container table-scroll">
          <table class="roster-table">
            ${homePlayerTheadHtml('<th class="mono">Streak Delta</th>')}
            <tbody>
              ${cold.map(item => homePlayerRowHtml(item.p, formatDeltaTd(item))).join('')}
            </tbody>
          </table>
        </div>`
      : `<div class="empty">${emptyMsg}</div>`;

    document.getElementById('explore-hot-cold').innerHTML = `
      <div class="preview-head">
        <h3>Hot vs Cold <span class="preview-sub">last 30 real days vs. this season</span></h3>
      </div>
      <div class="hot-cold-cols">
        <div>
          <div class="explore-subhead hot">Hot — outperforming over the last 30 days</div>
          ${hotTable}
        </div>
        <div>
          <div class="explore-subhead cold">Cold — underperforming over the last 30 days</div>
          ${coldTable}
        </div>
      </div>`;
  }

  function renderBullpenOverview() {
    const rps = marketPlayers.filter(p => p.position === 'RP');
    const hasSaves = p => (p.stats && p.stats.saves || 0) > 0;
    const highLev = rps.filter(hasSaves).slice(0, 5);
    const rest = rps.filter(p => !hasSaves(p));
    const setup = [...rest]
      .sort((a, b) => (kMinusBbPct(b) ?? -Infinity) - (kMinusBbPct(a) ?? -Infinity))
      .slice(0, 5);
    const middle = rest
      .filter(p => !setup.includes(p))
      .sort((a, b) => (b.stats && b.stats.ip || 0) - (a.stats && a.stats.ip || 0))
      .slice(0, 5);

    const tierHtml = (title, players) => {
      const tableContent = players.length
        ? `<div class="table-container table-scroll">
            <table class="roster-table">
              ${homePlayerTheadHtml('<th class="mono">ERA</th><th class="mono">K-BB%</th>')}
              <tbody>
                ${players.map(p => {
                  const kbb = kMinusBbPct(p);
                  return homePlayerRowHtml(p, `
                    <td class="mono">${p.stats && p.stats.era != null ? p.stats.era.toFixed(2) : '—'}</td>
                    <td class="mono">${kbb != null ? kbb.toFixed(1) + '%' : '—'}</td>
                  `);
                }).join('')}
              </tbody>
            </table>
          </div>`
        : `<div class="empty">No RPs in this tier.</div>`;

      return `<div class="tier-block">
        <div class="tier-head">${title}</div>
        ${tableContent}
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
      const fips = sps.map(p => p.stats && p.stats.fip).filter(v => v != null);
      return {
        name: t.name, abbr: t.abbr, division: t.division, league: t.league,
        sps,
        avgScore: t.rotationScore,
        avgFip: fips.length ? fips.reduce((a, v) => a + v, 0) / fips.length : null,
        totalIp: sps.reduce((a, p) => a + (p.stats && p.stats.ip || 0), 0),
        payroll: sps.reduce((a, p) => a + (p.aav || 0), 0),
      };
    }).filter(Boolean);
    const aggsSorted = [...aggs].sort((a, b) => b.avgScore - a.avgScore);
    aggs.forEach(t => {
      t.mlbRank = aggsSorted.findIndex(x => x.abbr === t.abbr) + 1;
      const leagueSorted = aggsSorted.filter(x => x.league === t.league);
      t.leagueRank = leagueSorted.findIndex(x => x.abbr === t.abbr) + 1;
    });
    const best = [...aggs].sort((a, b) => b.avgScore - a.avgScore).slice(0, 5);
    const worst = [...aggs].sort((a, b) => a.avgScore - b.avgScore).slice(0, 5);

    const row = t => {
      const expanded = expandedRotationTeams.has(t.abbr);
      const pair = teamColors[t.abbr] || (t.abbr === 'OAK' ? teamColors.ATH : null) || ['#6aa9e9', '#1b3a5c'];
      const primaryColor = pair[0] || 'var(--accent-light-blue)';
      const teamObj = teams.find(x => x.abbr === t.abbr) || t;
      const slug = teamSlug(teamObj);

      const playersHtml = expanded
        ? `<div class="rotation-players-wrapper">
            <div class="table-container table-scroll">
              <table class="roster-table">
                ${homePlayerTheadHtml('<th class="mono">IP</th><th class="mono">Weight</th><th class="mono">Score</th>')}
                <tbody>
                  ${t.sps.map(p => homePlayerRowHtml(p, `
                    <td class="mono">${Math.round(p.stats && p.stats.ip || 0)}</td>
                    <td class="mono">${p.teamWeight != null ? p.teamWeight.toFixed(2) : '—'}</td>
                    <td class="mono font-bold ${p.teamScore >= 0 ? 'surplus-pos' : 'surplus-neg'}">${p.teamScore != null ? fmtSigned(p.teamScore) : '—'}</td>
                  `)).join('')}
                </tbody>
              </table>
            </div>
          </div>`
        : '';

      return `
      <div class="rotation-team-card${expanded ? ' expanded' : ''}" style="border-left: 4px solid ${primaryColor};">
        <div class="rotation-team-header" data-team-toggle="${t.abbr}" tabindex="0" role="button" aria-expanded="${expanded}">
          <div class="team-hero-title-row rotation-hero-row">
            <span class="rotation-toggle-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
            ${teamLogoImg(t.abbr, 51).replace('class="team-logo"', 'class="team-hero-logo rotation-team-logo"')}
            <div class="team-hero-text-group">
              <h3 class="team-hero-heading rotation-team-title">${t.name}</h3>
              <div class="rotation-team-subgroup">
                <span class="team-hero-subtext">${t.division || (t.league + ' ' + t.abbr)}</span>
                <a href="#/team/${slug}" class="rotation-team-link" onclick="event.stopPropagation()">Team page →</a>
              </div>
            </div>
            <div class="macro-metric-grid rotation-metric-grid">
              <div class="macro-metric-card">
                <span class="macro-metric-label">Rotation Score</span>
                <span class="macro-metric-value ${t.avgScore >= 0 ? 'macro-value-positive' : 'macro-value-negative'}">${fmtSigned(t.avgScore)} <span class="rotation-rank-tag">-[#${t.leagueRank} in ${t.league} / #${t.mlbRank} in MLB]</span></span>
              </div>
              <div class="macro-metric-card">
                <span class="macro-metric-label">Rotation Payroll</span>
                <span class="macro-metric-value">${fmtMoney(t.payroll)}</span>
              </div>
              <div class="macro-metric-card">
                <span class="macro-metric-label">Avg FIP</span>
                <span class="macro-metric-value">${t.avgFip != null ? t.avgFip.toFixed(2) : '—'}</span>
              </div>
              <div class="macro-metric-card">
                <span class="macro-metric-label">Total IP</span>
                <span class="macro-metric-value">${Math.round(t.totalIp)} IP</span>
              </div>
            </div>
          </div>
        </div>
        ${playersHtml}
      </div>`;
    };

    const bestRows = best.length ? best.map(row).join('') : '<div class="empty">No rotations with 2+ starters in this build.</div>';
    const worstRows = worst.length ? worst.map(row).join('') : '<div class="empty">No rotations with 2+ starters in this build.</div>';

    document.getElementById('explore-rotations').innerHTML = `
      <div class="preview-head">
        <h3>Best / Worst Rotations <span class="preview-sub">each team's top 5 SP by IP — innings-weighted avg value score</span></h3>
      </div>
      <div class="explore-subhead good">Best — highest avg score</div>
      <div class="rotation-team-list">
        ${bestRows}
      </div>
      <div class="explore-subhead bad" style="margin-top: 1.5rem;">Worst — lowest avg score</div>
      <div class="rotation-team-list">
        ${worstRows}
      </div>`;
  }

  function renderHome() {
    homeRowsCurrent = [];
    renderCarousel('nl-bat');
    renderCarousel('nl-pit');
    renderCarousel('al-bat');
    renderCarousel('al-pit');
    renderHotCold();
    renderBullpenOverview();
    renderRotations();
  }


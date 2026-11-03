  // --- Players tab (v2: position players only; pitchers live in Rotation/Bullpen) ---
  const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];
  const BATTING_POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
  let activePos = 'All';
  let playerSort = { key: 'score', dir: 'desc' };

  document.getElementById('pos-chips').innerHTML = BATTING_POSITIONS.map(p =>
    `<button class="chip${p === 'All' ? ' active' : ''}" data-pos="${p}">${p}</button>`
  ).join('');

  function renderPlayers() {
    const q = document.getElementById('player-search').value.trim().toLowerCase();
    let rows = allPlayers.filter(p =>
      !p.isPreArb && p.isBatter &&
      (activePos === 'All' || p.position === activePos) &&
      (q === '' || matchesTeamQuery(p, q))
    );
    rows.sort((a, b) => {
      const k = playerSort.key;
      const va = a[k], vb = b[k];
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return playerSort.dir === 'asc' ? cmp : -cmp;
    });
    document.getElementById('player-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    const maxAbs = 100;
    document.getElementById('player-rows').innerHTML = rows.length ? rows.slice(0, 300).map((p, i) => `
      <tr class="row-toggle" data-idx="${i}">
        <td><span class="chevron">▸</span>${playerNameCellHtml(p)}</td>
        <td class="num" data-count="${p.salary}" data-count-fmt="money">${fmtMoney(p.salary)}</td>
        <td class="num" data-count="${p.compPct}" data-count-fmt="pct1">${p.compPct.toFixed(1)}</td>
        <td class="num" data-count="${p.salPct}" data-count-fmt="pct1">${p.salPct.toFixed(1)}</td>
        <td class="num" data-count="${p.recommendedSalary}" data-count-fmt="money">${fmtMoney(p.recommendedSalary)}</td>
        <td class="num">${valueBar(p.score, maxAbs)}</td>
        <td class="num">${valueBar(p.score, maxAbs)}</td>
      </tr>`
    ).join('') : `<tr><td colspan="6"><div class="empty">No players match that search.</div></td></tr>`;
    playerRowsCurrent = rows;
  }
  let playerRowsCurrent = [];

  document.getElementById('player-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    openPlayerCard(playerRowsCurrent[Number(row.dataset.idx)]);
  });

  document.getElementById('player-search').addEventListener('input', renderPlayers);
  document.getElementById('pos-chips').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activePos = btn.dataset.pos;
    document.querySelectorAll('#pos-chips .chip').forEach(c => c.classList.toggle('active', c === btn));
    renderPlayers();
  });

  // --- Rookies tab (pre-arb / MiLB, projected salary instead of value score) ---
  let activeRookiePos = 'All';
  let rookieSort = { key: 'surplus', dir: 'desc' };

  document.getElementById('rookie-pos-chips').innerHTML = POSITIONS.map(p =>
    `<button class="chip${p === 'All' ? ' active' : ''}" data-pos="${p}">${p}</button>`
  ).join('');

  function surplusBar(surplus, max) {
    const pct = Math.min(surplus / max, 1) * 100;
    return `<div class="bar-cell">
      <div class="bar-track"><div class="bar-fill anim good" data-w="${pct}%" style="left:0; width:${pct}%;"></div></div>
      <span class="value-num good" data-count="${surplus}" data-count-fmt="money">${fmtMoney(surplus)}</span>
    </div>`;
  }

  function renderRookies() {
    const q = document.getElementById('rookie-search').value.trim().toLowerCase();
    let rows = allPlayers.filter(p =>
      p.isPreArb &&
      (activeRookiePos === 'All' || p.position === activeRookiePos) &&
      (q === '' || matchesTeamQuery(p, q))
    );
    rows.sort((a, b) => {
      const k = rookieSort.key;
      const va = a[k], vb = b[k];
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return rookieSort.dir === 'asc' ? cmp : -cmp;
    });
    document.getElementById('rookie-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    const allSurplus = allPlayers.filter(p => p.isPreArb && p.surplus != null).map(p => p.surplus);
    const maxSurplus = Math.max(...allSurplus, 1);
    document.getElementById('rookie-rows').innerHTML = rows.length ? rows.slice(0, 300).map((p, i) => `
      <tr class="row-toggle" data-idx="${i}">
        <td><span class="chevron">▸</span>${playerNameCellHtml(p)}</td>
        <td class="num" data-count="${p.salary}" data-count-fmt="money">${fmtMoney(p.salary)}</td>
        <td class="num" data-count="${p.compPct}" data-count-fmt="pct1">${p.compPct.toFixed(1)}</td>
        <td class="num" data-count="${p.projectedSalary}" data-count-fmt="money">${fmtMoney(p.projectedSalary)}</td>
        <td class="num">${surplusBar(p.surplus, maxSurplus)}</td>
        <td class="num">${surplusBar(p.surplus, maxSurplus)}</td>
      </tr>`
    ).join('') : `<tr><td colspan="5"><div class="empty">No prospects match that search.</div></td></tr>`;
    rookieRowsCurrent = rows;
  }
  let rookieRowsCurrent = [];

  document.getElementById('rookie-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    openPlayerCard(rookieRowsCurrent[Number(row.dataset.idx)]);
  });

  document.getElementById('rookie-search').addEventListener('input', renderRookies);
  document.getElementById('rookie-pos-chips').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activeRookiePos = btn.dataset.pos;
    document.querySelectorAll('#rookie-pos-chips .chip').forEach(c => c.classList.toggle('active', c === btn));
    renderRookies();
  });

  document.querySelectorAll('#rookies-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      rookieSort.dir = rookieSort.key === key && rookieSort.dir === 'desc' ? 'asc' : 'desc';
      rookieSort.key = key;
      renderRookies();
    });
  });

  // --- Arbitration tab: currently arb-eligible players, sortable by arb
  // year (tier) and position -- separate from the Pre-Arbitration tab
  // (players who haven't reached arbitration yet at all).
  let activeArbPos = 'All';
  let activeArbYear = 'All';
  let arbSort = { key: 'projectedArbSurplus', dir: 'desc' };

  document.getElementById('arb-pos-chips').innerHTML = POSITIONS.map(p =>
    `<button class="chip${p === 'All' ? ' active' : ''}" data-pos="${p}">${p}</button>`
  ).join('');
  const ARB_YEAR_CHIPS = ['All', '1', '2', '3'];
  document.getElementById('arb-year-chips').innerHTML = ARB_YEAR_CHIPS.map(y =>
    `<button class="chip${y === 'All' ? ' active' : ''}" data-year="${y}">${y === 'All' ? 'All Arb' : 'Arb ' + y}</button>`
  ).join('');

  function renderArbitration() {
    const q = document.getElementById('arb-search').value.trim().toLowerCase();
    let rows = allPlayers.filter(p =>
      isArbEligible(p) &&
      (activeArbPos === 'All' || p.position === activeArbPos) &&
      (q === '' || matchesTeamQuery(p, q))
    );
    rows.forEach(p => {
      p.arbYearNum = arbYearNumber(p);
      // A player one tier away from 6.000 years of service reaches free
      // agency next season, not another arb year -- there's no real arb
      // process left to project (isNearingFreeAgency is the same real
      // service-time check the player card's Next-Season Outlook already
      // uses for this exact branch). For them, "projected 2027" has to mean
      // real open-market value (projectedMarketValue), not the arb-tier
      // comp (projectedArbSalary), which would otherwise just clamp at the
      // 80% Arb-3 tier as if they were still under control.
      p.arbTabPendingFA = isNearingFreeAgency(p);
      p.arbTabProjectedValue = p.arbTabPendingFA ? p.projectedMarketValue : p.projectedArbSalary;
      // Distinct from the shared p.arbSurplus (this year's expected-vs-actual,
      // still used on the player card) -- this is the projected year-over-
      // year change: next year's projected value (arb comp, or open-market
      // if reaching free agency) minus this year's real AAV.
      p.projectedArbSurplus = p.arbTabProjectedValue != null ? p.arbTabProjectedValue - p.aav : null;
    });
    if (activeArbYear !== 'All') rows = rows.filter(p => p.arbYearNum === Number(activeArbYear));
    rows.sort((a, b) => {
      const k = arbSort.key;
      const va = a[k], vb = b[k];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return arbSort.dir === 'asc' ? cmp : -cmp;
    });
    document.getElementById('arb-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    // Header reflects what's actually being shown: if every visible row is
    // pending free agency (typically the Arb 3 / final-year filter), the
    // "projected" column is real open-market value, not an arb comp.
    const allPendingFA = rows.length > 0 && rows.every(p => p.arbTabPendingFA);
    document.querySelector('#arbitration-view thead th[data-sort="arbTabProjectedValue"]').textContent =
      allPendingFA ? 'Projected Free Agent Value' : 'Projected 2027';
    document.getElementById('arb-rows').innerHTML = rows.length ? rows.slice(0, 300).map((p, i) => `
      <tr class="row-toggle" data-idx="${i}">
        <td><span class="chevron">▸</span>${playerNameCellHtml(p)}</td>
        <td>${arbYearShortLabel(p)}${p.arbTabPendingFA ? ' <span class="pos-pill" title="Reaches free agency next season">FA</span>' : ''}</td>
        <td class="num" data-count="${p.aav}" data-count-fmt="money">${fmtMoney(p.aav)}</td>
        <td class="num" data-count="${p.arbTabProjectedValue ?? ''}" data-count-fmt="money">${p.arbTabProjectedValue != null ? fmtMoney(p.arbTabProjectedValue) : '—'}</td>
        <td class="num ${p.projectedArbSurplus != null && p.projectedArbSurplus >= 0 ? 'good' : 'bad'}"${p.projectedArbSurplus != null ? ` data-count="${p.projectedArbSurplus}" data-count-fmt="signedM"` : ''}>${p.projectedArbSurplus != null ? fmtSigned(p.projectedArbSurplus / 1e6) + 'M' : '—'}</td>
      </tr>`
    ).join('') : `<tr><td colspan="5"><div class="empty">No arbitration-eligible players match that search.</div></td></tr>`;
    arbRowsCurrent = rows;
  }
  let arbRowsCurrent = [];

  document.getElementById('arb-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    openPlayerCard(arbRowsCurrent[Number(row.dataset.idx)]);
  });

  document.getElementById('arb-search').addEventListener('input', renderArbitration);
  document.getElementById('arb-pos-chips').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activeArbPos = btn.dataset.pos;
    document.querySelectorAll('#arb-pos-chips .chip').forEach(c => c.classList.toggle('active', c === btn));
    renderArbitration();
  });
  document.getElementById('arb-year-chips').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activeArbYear = btn.dataset.year;
    document.querySelectorAll('#arb-year-chips .chip').forEach(c => c.classList.toggle('active', c === btn));
    renderArbitration();
  });

  document.querySelectorAll('#arbitration-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      arbSort.dir = arbSort.key === key && arbSort.dir === 'desc' ? 'asc' : 'desc';
      arbSort.key = key;
      renderArbitration();
    });
  });

  // --- Rotation tab (v2: market-priced starters) ---
  let rotationSort = { key: 'fip', dir: 'asc' };
  function rotationVal(p, key) {
    if (key === 'k_minus_bb') return kMinusBbPct(p);
    return p.stats[key] != null ? p.stats[key] : null;
  }
  function renderRotation() {
    const q = document.getElementById('rotation-search').value.trim().toLowerCase();
    const rows = allPlayers.filter(p =>
      p.position === 'SP' && !p.isPreArb &&
      (q === '' || matchesTeamQuery(p, q))
    );
    rows.sort((a, b) => {
      const k = rotationSort.key;
      if (k === 'name') return rotationSort.dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      const va = rotationVal(a, k), vb = rotationVal(b, k);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return rotationSort.dir === 'asc' ? va - vb : vb - va;
    });
    document.getElementById('rotation-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    document.getElementById('rotation-rows').innerHTML = rows.length ? rows.slice(0, 300).map((p, i) => {
      const ip = p.stats.ip, fip = p.stats.fip, xera = p.stats.xera, stuff = p.stats.stuff_plus;
      const kbb = kMinusBbPct(p);
      return `<tr class="row-toggle" data-idx="${i}">
        <td><span class="chevron">▸</span>${playerNameCellHtml(p)}</td>
        <td class="num"${ip != null ? ` data-count="${ip}" data-count-fmt="dec1"` : ''}>${ip != null ? ip.toFixed(1) : '—'}</td>
        <td class="num"${fip != null ? ` data-count="${fip}" data-count-fmt="dec2"` : ''}>${fip != null ? fip.toFixed(2) : '—'}</td>
        <td class="num"${xera != null ? ` data-count="${xera}" data-count-fmt="dec2"` : ''}>${xera != null ? xera.toFixed(2) : '—'}</td>
        <td class="num"${stuff != null ? ` data-count="${stuff}" data-count-fmt="dec1"` : ''}>${stuff != null ? stuff.toFixed(1) : '—'}</td>
        <td class="num"${kbb != null ? ` data-count="${kbb}" data-count-fmt="pct1s"` : ''}>${kbb != null ? kbb.toFixed(1) + '%' : '—'}</td>
        <td class="num" data-count="${p.salary}" data-count-fmt="money">${fmtMoney(p.salary)}</td>
        <td class="num">${valueBar(p.score, 100)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="8"><div class="empty">No starters match that search.</div></td></tr>`;
    rotationRowsCurrent = rows;
  }
  let rotationRowsCurrent = [];

  document.getElementById('rotation-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    openPlayerCard(rotationRowsCurrent[Number(row.dataset.idx)]);
  });

  document.getElementById('rotation-search').addEventListener('input', renderRotation);
  document.querySelectorAll('#rotation-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      rotationSort.dir = rotationSort.key === key && rotationSort.dir === 'desc' ? 'asc' : 'desc';
      rotationSort.key = key;
      renderRotation();
    });
  });

  // --- Bullpen tab (v2: market-priced relievers) ---
  let bullpenSort = { key: 'paySurplus', dir: 'desc' };
  function bullpenVal(p, key) {
    if (key === 'paySurplus') return p.paySurplus;
    if (key === 'k_minus_bb') return kMinusBbPct(p);
    if (key === 'war') return p.stats.war;
    return p.stats[key] != null ? p.stats[key] : null;
  }
  function renderBullpen() {
    const q = document.getElementById('bullpen-search').value.trim().toLowerCase();
    const rows = allPlayers.filter(p =>
      p.position === 'RP' && !p.isPreArb &&
      (q === '' || matchesTeamQuery(p, q))
    );
    rows.sort((a, b) => {
      const k = bullpenSort.key;
      if (k === 'name') return bullpenSort.dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      const va = bullpenVal(a, k), vb = bullpenVal(b, k);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return bullpenSort.dir === 'asc' ? va - vb : vb - va;
    });
    document.getElementById('bullpen-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    document.getElementById('bullpen-rows').innerHTML = rows.length ? rows.slice(0, 300).map((p, i) => {
      const ip = p.stats.ip, era = p.stats.era, war = p.stats.war;
      const kbb = kMinusBbPct(p);
      return `<tr class="row-toggle" data-idx="${i}">
        <td><span class="chevron">▸</span>${playerNameCellHtml(p)}</td>
        <td class="num"${ip != null ? ` data-count="${ip}" data-count-fmt="dec1"` : ''}>${ip != null ? ip.toFixed(1) : '—'}</td>
        <td class="num"${era != null ? ` data-count="${era}" data-count-fmt="dec2"` : ''}>${era != null ? era.toFixed(2) : '—'}</td>
        <td class="num"${kbb != null ? ` data-count="${kbb}" data-count-fmt="pct1s"` : ''}>${kbb != null ? kbb.toFixed(1) + '%' : '—'}</td>
        <td class="num"${war != null ? ` data-count="${war}" data-count-fmt="dec1"` : ''}>${war != null ? war.toFixed(1) : '—'}</td>
        <td class="num ${p.paySurplus != null && p.paySurplus >= 0 ? 'good' : 'bad'}"${p.paySurplus != null ? ` data-count="${p.paySurplus}" data-count-fmt="signedM"` : ''}>${surplusM(p)}</td>
        <td class="num">${valueBar(p.score, 100)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7"><div class="empty">No relievers match that search.</div></td></tr>`;
    bullpenRowsCurrent = rows;
  }
  let bullpenRowsCurrent = [];

  document.getElementById('bullpen-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    openPlayerCard(bullpenRowsCurrent[Number(row.dataset.idx)]);
  });

  document.getElementById('bullpen-search').addEventListener('input', renderBullpen);
  document.querySelectorAll('#bullpen-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      bullpenSort.dir = bullpenSort.key === key && bullpenSort.dir === 'desc' ? 'asc' : 'desc';
      bullpenSort.key = key;
      renderBullpen();
    });
  });


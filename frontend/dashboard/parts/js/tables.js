  // --- Players tab: modern unified Roster Value table for all players ---
  const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP'];
  const INFIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS'];
  const OUTFIELD_POSITIONS = ['LF', 'CF', 'RF', 'DH'];
  const PLAYER_GROUPS = {
    all: { label: 'All Players', positions: POSITIONS.slice(1) },
    infield: { label: 'Infielders', positions: INFIELD_POSITIONS },
    outfield: { label: 'Outfielders', positions: OUTFIELD_POSITIONS },
    rotation: { label: 'Rotation', positions: ['SP'] },
    bullpen: { label: 'Bullpen', positions: ['RP'] },
  };
  const PLAYER_GROUP_ORDER = ['all', 'infield', 'outfield', 'rotation', 'bullpen'];
  const PLAYER_COLUMNS = [
    { key: 'name', label: 'Player' },
    { key: 'position', label: 'Pos' },
    { key: 'tier', label: 'Value Tier' },
    { key: 'contract', label: 'Contract' },
    { key: 'salary', label: `${CURRENT_SEASON} Salary`, mono: true },
    { key: 'compPct', label: 'Perf %', mono: true },
    { key: 'market', label: 'Projected Market', mono: true },
    { key: 'surplus', label: 'Net Surplus / Deficit', mono: true },
    { key: 'driver', label: 'Key Stat Driver', mono: true },
  ];

  let activePlayerGroup = 'all';
  let activePos = 'All';
  let playerSort = { key: 'surplus', dir: 'desc' };
  let playerRowsCurrent = [];
  let visiblePlayerCount = 100;

  function renderPlayerGroupTabs() {
    const tabsEl = document.getElementById('player-group-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = PLAYER_GROUP_ORDER.map(group =>
      `<button type="button" role="tab" class="player-group-tab${group === activePlayerGroup ? ' active' : ''}" data-group="${group}" aria-selected="${group === activePlayerGroup}">${PLAYER_GROUPS[group].label}</button>`
    ).join('');
  }

  function renderPlayerPosChips() {
    const chipsEl = document.getElementById('player-pos-chips');
    if (!chipsEl) return;
    const group = PLAYER_GROUPS[activePlayerGroup] || PLAYER_GROUPS.all;
    const positions = (activePlayerGroup === 'rotation' || activePlayerGroup === 'bullpen')
      ? ['All']
      : ['All', ...group.positions];
    chipsEl.innerHTML = positions.map(p =>
      `<button type="button" class="chip${p === activePos ? ' active' : ''}" data-pos="${p}">${p === 'All' ? 'All' : p}</button>`
    ).join('');
  }

  function playerHeadHtml() {
    return '<tr>' + PLAYER_COLUMNS.map(col => {
      const isSorted = playerSort.key === col.key;
      const arrow = isSorted ? (playerSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      const cls = (col.mono ? 'mono ' : '') + (isSorted ? 'sorted' : '');
      return `<th class="${cls.trim()}" data-sort="${col.key}">${col.label}${arrow}</th>`;
    }).join('') + '</tr>';
  }

  function playerSortValue(p, key) {
    if (key === 'name') return (p.name || '').toLowerCase();
    if (key === 'position') return p.position || '';
    if (key === 'tier') return p.compPct != null ? p.compPct : 0;
    if (key === 'contract') return contractLabel(p).label;
    if (key === 'salary') return p.salary || 0;
    if (key === 'compPct') return p.compPct != null ? p.compPct : 0;
    if (key === 'market') return playerMarketValue(p);
    if (key === 'surplus') return playerSurplus(p);
    if (key === 'driver') return primaryDriver(p);
    return p[key];
  }

  function matchesPlayerOrPosQuery(p, q) {
    const query = q.toLowerCase();
    const pos = (p.position || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    const team = (p.team || '').toLowerCase();
    const fullTeam = (teamNameByAbbr[p.team] || '').toLowerCase();
    const contract = contractLabel(p).label.toLowerCase();
    const tier = tierForPlayer(p).label.toLowerCase();
    return name.includes(query) ||
           pos === query ||
           pos.includes(query) ||
           team === query ||
           fullTeam.includes(query) ||
           contract.includes(query) ||
           tier.includes(query);
  }

  function playerRowHtml(p, i) {
    const tier = tierForPlayer(p);
    const contract = contractLabel(p);
    const surplus = playerSurplus(p);
    const market = playerMarketValue(p);
    const pctl = p.compPct != null ? Math.round(p.compPct) : 0;
    return `<tr class="player-roster-row" data-row-idx="${i}" tabindex="0">
      <td class="player-cell">${headshotHtml(p, 'table-avatar')}<span class="player-name-text">${p.name}</span></td>
      <td><span class="pos-badge">${p.position}</span></td>
      <td><span class="badge-tier ${tier.cls}">${tier.label}</span></td>
      <td><span class="contract-tag ${contract.cls}">${contract.label}</span></td>
      <td class="mono">$${(p.salary || 0).toLocaleString()}</td>
      <td class="mono font-bold ${perfPercentileCls(pctl)}">${formatOrdinal(pctl)}</td>
      <td class="mono">$${Math.round(market).toLocaleString()}</td>
      <td class="mono font-bold ${surplus >= 0 ? 'surplus-pos' : 'surplus-neg'}">${surplus >= 0 ? '+' : '-'}$${Math.abs(Math.round(surplus)).toLocaleString()}</td>
      <td class="mono">${primaryDriver(p)}</td>
    </tr>`;
  }

  function renderPlayers() {
    const group = PLAYER_GROUPS[activePlayerGroup] || PLAYER_GROUPS.all;
    const searchEl = document.getElementById('player-search');
    const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
    let rows = allPlayers.filter(p =>
      group.positions.includes(p.position) &&
      (activePos === 'All' || p.position === activePos) &&
      (q === '' || matchesPlayerOrPosQuery(p, q))
    );
    rows.sort((a, b) => {
      const va = playerSortValue(a, playerSort.key);
      const vb = playerSortValue(b, playerSort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return playerSort.dir === 'asc' ? cmp : -cmp;
    });
    playerRowsCurrent = rows;

    const theadEl = document.getElementById('player-thead');
    if (theadEl) theadEl.innerHTML = playerHeadHtml();

    const countEl = document.getElementById('player-count');
    if (countEl) {
      countEl.textContent = `${rows.length} player${rows.length === 1 ? '' : 's'} shown` +
        (rows.length ? ' · click any row for detailed player card' : '');
    }

    const tbodyEl = document.getElementById('player-rows');
    if (tbodyEl) {
      if (!rows.length) {
        tbodyEl.innerHTML = `<tr><td colspan="${PLAYER_COLUMNS.length}"><div class="empty">No players match "${q || activePos}".</div></td></tr>`;
      } else {
        const displayed = rows.slice(0, visiblePlayerCount);
        tbodyEl.innerHTML = displayed.map((p, idx) => playerRowHtml(p, idx)).join('');
      }
    }

    const pagEl = document.getElementById('player-pagination');
    if (pagEl) {
      if (rows.length > visiblePlayerCount) {
        const remaining = rows.length - visiblePlayerCount;
        pagEl.innerHTML = `<button type="button" class="show-more-btn" id="player-show-more">Show More (${remaining} remaining)</button>`;
        const btn = document.getElementById('player-show-more');
        if (btn) {
          btn.addEventListener('click', () => {
            visiblePlayerCount += 100;
            renderPlayers();
          });
        }
      } else {
        pagEl.innerHTML = '';
      }
    }
  }

  function setPlayerGroup(group, opts) {
    const next = PLAYER_GROUPS[group] ? group : 'all';
    activePlayerGroup = next;
    activePos = 'All';
    visiblePlayerCount = 100;
    renderPlayerGroupTabs();
    renderPlayerPosChips();
    if (opts && opts.render) renderPlayers();
  }

  renderPlayerGroupTabs();
  renderPlayerPosChips();

  const playerRowsEl = document.getElementById('player-rows');
  if (playerRowsEl) {
    playerRowsEl.addEventListener('click', e => {
      const row = e.target.closest('.player-roster-row');
      if (!row) return;
      const idx = Number(row.dataset.rowIdx);
      const p = playerRowsCurrent[idx];
      if (p) openPlayerCard(p);
    });
    playerRowsEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const row = e.target.closest('.player-roster-row');
        if (!row) return;
        e.preventDefault();
        const idx = Number(row.dataset.rowIdx);
        const p = playerRowsCurrent[idx];
        if (p) openPlayerCard(p);
      }
    });
  }

  const playerSearchEl = document.getElementById('player-search');
  if (playerSearchEl) {
    playerSearchEl.addEventListener('input', () => {
      visiblePlayerCount = 100;
      renderPlayers();
    });
  }

  const playerGroupTabsEl = document.getElementById('player-group-tabs');
  if (playerGroupTabsEl) {
    playerGroupTabsEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-group]');
      if (!btn) return;
      navigateTo('#/players/' + btn.dataset.group);
    });
  }

  const playerPosChipsEl = document.getElementById('player-pos-chips');
  if (playerPosChipsEl) {
    playerPosChipsEl.addEventListener('click', e => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      activePos = btn.dataset.pos;
      document.querySelectorAll('#player-pos-chips .chip').forEach(c => c.classList.toggle('active', c === btn));
      visiblePlayerCount = 100;
      renderPlayers();
    });
  }

  const playerTheadEl = document.getElementById('player-thead');
  if (playerTheadEl) {
    playerTheadEl.addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      playerSort.dir = playerSort.key === key && playerSort.dir === 'desc' ? 'asc' : 'desc';
      playerSort.key = key;
      renderPlayers();
    });
  }

  // --- Pre-Arbitration tab (pre-arb / MiLB, projected salary instead of value score) ---
  let activePreArbPos = 'All';
  let preArbSort = { key: 'surplus', dir: 'desc' };

  document.getElementById('prearb-pos-chips').innerHTML = POSITIONS.map(p =>
    `<button class="chip${p === 'All' ? ' active' : ''}" data-pos="${p}">${p}</button>`
  ).join('');

  function surplusBar(surplus, max) {
    const pct = Math.min(surplus / max, 1) * 100;
    return `<div class="bar-cell">
      <div class="bar-track"><div class="bar-fill anim good" data-w="${pct}%" style="left:0; width:${pct}%;"></div></div>
      <span class="value-num good" data-count="${surplus}" data-count-fmt="money">${fmtMoney(surplus)}</span>
    </div>`;
  }

  function renderPreArb() {
    const q = document.getElementById('prearb-search').value.trim().toLowerCase();
    let rows = allPlayers.filter(p =>
      p.isPreArb &&
      (activePreArbPos === 'All' || p.position === activePreArbPos) &&
      (q === '' || matchesTeamQuery(p, q))
    );
    rows.sort((a, b) => {
      const k = preArbSort.key;
      const va = a[k], vb = b[k];
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return preArbSort.dir === 'asc' ? cmp : -cmp;
    });
    document.getElementById('prearb-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    const allSurplus = allPlayers.filter(p => p.isPreArb && p.surplus != null).map(p => p.surplus);
    const maxSurplus = Math.max(...allSurplus, 1);
    document.getElementById('prearb-rows').innerHTML = rows.length ? rows.slice(0, 300).map((p, i) => `
      <tr class="row-toggle" data-idx="${i}">
        <td><span class="chevron">▸</span>${playerNameCellHtml(p)}</td>
        <td class="num" data-count="${p.salary}" data-count-fmt="money">${fmtMoney(p.salary)}</td>
        <td class="num" data-count="${p.compPct}" data-count-fmt="pct1">${p.compPct.toFixed(1)}</td>
        <td class="num" data-count="${p.projectedSalary}" data-count-fmt="money">${fmtMoney(p.projectedSalary)}</td>
        <td class="num">${surplusBar(p.surplus, maxSurplus)}</td>
      </tr>`
    ).join('') : `<tr><td colspan="5"><div class="empty">No prospects match that search.</div></td></tr>`;
    preArbRowsCurrent = rows;
  }
  let preArbRowsCurrent = [];

  document.getElementById('prearb-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    openPlayerCard(preArbRowsCurrent[Number(row.dataset.idx)]);
  });

  document.getElementById('prearb-search').addEventListener('input', renderPreArb);
  document.getElementById('prearb-pos-chips').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activePreArbPos = btn.dataset.pos;
    document.querySelectorAll('#prearb-pos-chips .chip').forEach(c => c.classList.toggle('active', c === btn));
    renderPreArb();
  });

  document.querySelectorAll('#prearb-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      preArbSort.dir = preArbSort.key === key && preArbSort.dir === 'desc' ? 'asc' : 'desc';
      preArbSort.key = key;
      renderPreArb();
    });
  });

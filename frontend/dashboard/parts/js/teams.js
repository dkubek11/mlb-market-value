  // --- Teams tab: flat team list filtered by a League > Division > Team
  // cascade dropdown (the hierarchy lives only in the dropdown, not on the
  // page body). ---
  const DIVISIONS = ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West'];
  const LEAGUES = ['NL', 'AL'];
  const LEAGUE_LABELS = { NL: 'National League', AL: 'American League' };
  let teamsFilter = { league: 'All', division: 'All', team: 'All' };
  let cascadeOpen = false;
  let cascadeLeague = null;   // league whose division submenu is shown
  let cascadeDivision = null; // division whose team submenu is shown

  function teamsFilterCrumb() {
    if (teamsFilter.team !== 'All') return (teamNameByAbbr[teamsFilter.team] || teamsFilter.team);
    if (teamsFilter.division !== 'All') return `${LEAGUE_LABELS[teamsFilter.league]} ▸ ${teamsFilter.division}`;
    if (teamsFilter.league !== 'All') return LEAGUE_LABELS[teamsFilter.league];
    return 'All Teams';
  }

  function teamsMenuHtml() {
    const divisionBlock = div => {
      const divTeams = teams.filter(t => t.division === div);
      const teamSub = cascadeDivision === div
        ? `<div class="cascade-sub">${divTeams.map(t =>
            `<button class="cascade-row" data-team="${t.abbr}">${teamLogoImg(t.abbr, 13)}${t.name}</button>`
          ).join('')}</div>`
        : '';
      return `
      <div class="cascade-block">
        <button class="cascade-row" data-division="${div}">${div}<span class="caret">▸</span></button>
        ${teamSub}
      </div>`;
    };
    const leagueBlock = lg => {
      const divisionSub = cascadeLeague === lg
        ? `<div class="cascade-sub">${DIVISIONS.filter(d => d.startsWith(lg)).map(divisionBlock).join('')}</div>`
        : '';
      return `
      <div class="cascade-block">
        <button class="cascade-row" data-league="${lg}">${LEAGUE_LABELS[lg]}<span class="caret">▸</span></button>
        ${divisionSub}
      </div>`;
    };
    return `
      <button class="cascade-row" data-filter-all="1">All Teams</button>
      ${leagueBlock('NL')}
      ${leagueBlock('AL')}`;
  }

  function renderTeams() {
    const maxAbs = Math.max(...teams.map(t => Math.abs(t.avgScore)), 1);
    document.getElementById('teams-cascade').innerHTML = `
      <button class="cascade-trigger" type="button" aria-haspopup="true" aria-expanded="${cascadeOpen}">${teamsFilterCrumb()} <span class="caret">▾</span></button>
      ${cascadeOpen ? `<div class="cascade-menu">${teamsMenuHtml()}</div>` : ''}`;

    const q = document.getElementById('team-search').value.trim().toLowerCase();
    const rows = teams.filter(t =>
      (teamsFilter.league === 'All' || t.league === teamsFilter.league) &&
      (teamsFilter.division === 'All' || t.division === teamsFilter.division) &&
      (teamsFilter.team === 'All' || t.abbr === teamsFilter.team) &&
      (q === '' || t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q))
    );
    document.getElementById('team-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a team to see the roster' : '');
    document.getElementById('team-rows').innerHTML = rows.length ? rows.map(t => {
      const open = expandedTeam === t.abbr;
      const row = `
      <tr class="row-toggle" data-abbr="${t.abbr}">
        <td><span class="chevron${open ? ' open' : ''}">▸</span><div class="name-cell" style="display:inline-flex"><span>${teamLogoImg(t.abbr, 18)}${t.name}</span><span class="team-tag">${t.abbr}</span></div></td>
        <td class="num" data-count="${t.payroll}" data-count-fmt="money">${fmtMoney(t.payroll)}</td>
        <td class="num">${valueBar(t.avgScore, maxAbs)}</td>
      </tr>`;
      return row + (open ? renderDiamondPanel(t, open && !pendingTeamOpen) : '');
    }).join('') : '<tr><td colspan="3"><div class="empty">No teams match that filter.</div></td></tr>';
  }

  // Carousel "Show More National League / American League Teams" jump: set the
  // dropdown filter to that league and open the Teams tab.
  function openTeamsLeague(lg) {
    teamsFilter = { league: lg, division: 'All', team: 'All' };
    cascadeOpen = false;
    renderTeams();
    switchTab('teams');
    try { history.replaceState(null, '', '#teams:' + lg); } catch (e) { /* ignore */ }
  }

  // The topbar "Teams" dropdown mirrors the same League > Division > Team
  // hierarchy: leagues expand to divisions, divisions expand to their 5
  // teams, and clicking a team jumps to the Teams tab filtered to that team.
  function renderNavTeamsMenu() {
    document.getElementById('nav-teams-menu').innerHTML = LEAGUES.map(lg => `
      <div class="nav-drop">
        <button class="nav-drop-item nav-sub-toggle" type="button" aria-expanded="false">${LEAGUE_LABELS[lg]} <span class="caret">▸</span></button>
        <div class="nav-drop-menu">
          ${DIVISIONS.filter(d => d.startsWith(lg)).map(div => `
            <div class="nav-drop">
              <button class="nav-drop-item nav-sub-toggle" type="button" aria-expanded="false">${div} <span class="caret">▸</span></button>
              <div class="nav-drop-menu">
                ${teams.filter(t => t.division === div).map(t => `<button class="nav-drop-item nav-team-link" data-team="${t.abbr}">${t.name}</button>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('');
  }
  renderNavTeamsMenu();
  document.getElementById('nav-teams-menu').addEventListener('click', e => {
    const toggle = e.target.closest('.nav-sub-toggle');
    if (toggle) {
      // Expand/collapse this league or division without closing ancestor menus.
      e.stopPropagation();
      const drop = toggle.parentElement;
      const open = drop.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      return;
    }
    const teamBtn = e.target.closest('[data-team]');
    if (teamBtn) {
      const t = teams.find(x => x.abbr === teamBtn.dataset.team);
      if (t) teamsFilter = { league: t.league, division: t.division, team: t.abbr };
      cascadeOpen = false;
      document.querySelectorAll('.nav-drop').forEach(d => d.classList.remove('open'));
      renderTeams();
      switchTab('teams');
    }
  });

  document.getElementById('teams-cascade').addEventListener('click', e => {
    // Re-rendering replaces the container's nodes, which would detach the
    // clicked element before the document-level click-outside handler runs;
    // stop propagation so in-menu clicks never register as outside clicks.
    e.stopPropagation();
    const trigger = e.target.closest('.cascade-trigger');
    if (trigger) {
      cascadeOpen = !cascadeOpen;
      renderTeams();
      return;
    }
    const all = e.target.closest('[data-filter-all]');
    if (all) {
      teamsFilter = { league: 'All', division: 'All', team: 'All' };
      cascadeOpen = false;
      renderTeams();
      return;
    }
    const lgBtn = e.target.closest('[data-league]');
    if (lgBtn) {
      const lg = lgBtn.dataset.league;
      teamsFilter = { league: lg, division: 'All', team: 'All' };
      cascadeLeague = lg;
      cascadeDivision = null;
      renderTeams();
      return;
    }
    const divBtn = e.target.closest('[data-division]');
    if (divBtn) {
      const div = divBtn.dataset.division;
      teamsFilter = { league: div.slice(0, 2), division: div, team: 'All' };
      cascadeLeague = div.slice(0, 2);
      cascadeDivision = div;
      renderTeams();
      return;
    }
    const teamBtn = e.target.closest('[data-team]');
    if (teamBtn) {
      const t = teams.find(x => x.abbr === teamBtn.dataset.team);
      if (t) teamsFilter = { league: t.league, division: t.division, team: t.abbr };
      cascadeOpen = false;
      cascadeLeague = null;
      cascadeDivision = null;
      renderTeams();
    }
  });
  document.addEventListener('click', e => {
    if (cascadeOpen && !e.target.closest('#teams-cascade')) {
      cascadeOpen = false;
      renderTeams();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && cascadeOpen) {
      cascadeOpen = false;
      renderTeams();
    }
  });

  document.getElementById('team-search').addEventListener('input', renderTeams);
  document.getElementById('team-rows').addEventListener('click', e => {
    const marker = e.target.closest('.pos-marker');
    if (marker && marker.dataset.pid) {
      const record = findPlayerRecord(Number(marker.dataset.pid), marker.dataset.pos);
      if (record) openPlayerCard(record);
      return;
    }
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    const abbr = row.dataset.abbr;
    const wasOpen = expandedTeam === abbr;
    if (wasOpen) {
      if (pendingTeamClose) return;
      const acc = document.querySelector(`.diamond-row[data-abbr="${abbr}"] .diamond-accordion`);
      if (acc) acc.classList.remove('expanded');
      pendingTeamClose = true;
      setTimeout(() => {
        pendingTeamClose = false;
        if (expandedTeam === abbr) { expandedTeam = null; renderTeams(); }
      }, 230);
    } else {
      if (pendingTeamOpen) return;
      expandedTeam = abbr;
      pendingTeamOpen = true;
      renderTeams();
      requestAnimationFrame(() => {
        const acc = document.querySelector(`.diamond-row[data-abbr="${abbr}"] .diamond-accordion`);
        if (acc) acc.classList.add('expanded');
      });
      setTimeout(() => { pendingTeamOpen = false; }, 300);
    }
  });
  // Roughly true-to-position layout on a 0 0 640 620 field, home plate at bottom.
  const POSITION_COORDS = {
    C:  { x: 320, y: 522 }, SP: { x: 320, y: 430 }, '1B': { x: 445, y: 428 },
    // 2B's realistic fielding spot is shallow right of the bag, not standing
    // on it -- mirrors SS's offset (which sits shallow left of the bag,
    // toward 3B) onto the 1B side instead of using the bag's own coordinate,
    // which used to leave 2B floating alone at the top of the diamond,
    // detached from the rest of the infield cluster.
    '2B': { x: 382, y: 372 }, '3B': { x: 195, y: 428 }, SS: { x: 258, y: 372 },
    LF: { x: 140, y: 208 }, CF: { x: 320, y: 128 }, RF: { x: 500, y: 208 },
    DH: { x: 566, y: 556 }, RP: { x: 74, y: 556 },
  };
  const ON_FIELD = new Set(['C', 'SP', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);

  function initials(name) {
    const parts = name.replace(/[^\w\s.]/g, '').split(' ').filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function scoreLabel(record) {
    if (!record) return { text: '—', cls: 'empty' };
    if (record.isPreArb) return { text: '+' + fmtMoney(record.surplus) + ' proj', cls: 'proj' };
    return { text: fmtSigned(record.score), cls: record.score >= 0 ? 'good' : 'bad' };
  }

  function posMarker(pos, rosterEntry) {
    const c = POSITION_COORDS[pos];
    const r = 26;
    const markerDelay = Object.keys(POSITION_COORDS).indexOf(pos) * 45;
    if (!rosterEntry) {
      return `<g class="pos-marker" style="animation-delay:${markerDelay}ms">
        <circle cx="${c.x}" cy="${c.y}" r="${r}" fill="none" stroke="var(--border)" stroke-width="2" stroke-dasharray="4 4" />
        <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" class="pos-tag" font-size="11">${pos}</text>
        <text x="${c.x}" y="${c.y + r + 16}" text-anchor="middle" class="pos-score empty">no rostered player</text>
      </g>`;
    }
    // rosterEntry is whoever logged the most playing time at this position,
    // regardless of whether they clear the scoring-qualification bar (see
    // ROSTER_BATTER_Q/ROSTER_PITCHER_Q in build_dashboard.py) -- always show
    // that player. record is their full scored entry from allPlayers, which
    // only exists if they also cleared the PA/IP + salary bar; when it
    // doesn't, still render their name/photo but with a neutral ring and a
    // "not qualified" label instead of a score.
    const record = findPlayerRecord(rosterEntry.id, pos);
    const score = scoreLabel(record);
    const fillHue = !record ? 'var(--border)' : record.isPreArb ? 'var(--accent)' : (record.score >= 0 ? 'var(--good)' : 'var(--bad)');
    const nameShort = rosterEntry.name.length > 16 ? rosterEntry.name.split(' ').pop() : rosterEntry.name;
    // The colored ring still shows the same at-a-glance score signal it
    // always did; a real headshot (clipped to a slightly smaller circle, so
    // the ring reads as a border) replaces the initials inside it when one
    // is available.
    const photoR = r - 3;
    const clipId = `avatar-clip-${rosterEntry.id}`;
    const avatarInner = rosterEntry.headshot
      ? `<clipPath id="${clipId}"><circle cx="${c.x}" cy="${c.y}" r="${photoR}" /></clipPath>
         <image href="${rosterEntry.headshot}" x="${c.x - photoR}" y="${c.y - photoR}" width="${photoR * 2}" height="${photoR * 2}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" />`
      : `<text x="${c.x}" y="${c.y + 5}" text-anchor="middle" class="pos-initials">${initials(rosterEntry.name)}</text>`;
    const pidAttr = record ? ` data-pid="${record.id}"` : '';
    return `<g class="pos-marker"${pidAttr} data-pos="${pos}" style="animation-delay:${markerDelay}ms">
      <circle class="pos-avatar-ring" cx="${c.x}" cy="${c.y}" r="${r}" fill="${fillHue}" fill-opacity="0.9" />
      ${avatarInner}
      <text x="${c.x}" y="${c.y - r - 8}" text-anchor="middle" class="pos-tag">${pos}</text>
      <text x="${c.x}" y="${c.y + r + 16}" text-anchor="middle" class="pos-name">${nameShort}</text>
      <text x="${c.x}" y="${c.y + r + 30}" text-anchor="middle" class="pos-score ${record ? score.cls : 'empty'}">${record ? score.text : 'not qualified'}</text>
    </g>`;
  }

  function renderDiamondSvg(teamAbbr) {
    const roster = rosters[teamAbbr] || {};
    const markers = Object.keys(POSITION_COORDS).map(pos => posMarker(pos, roster[pos])).join('');
    return `<svg viewBox="0 0 640 620" class="diamond-svg" role="img" aria-label="${teamAbbr} field diagram">
      <rect x="0" y="0" width="640" height="620" fill="var(--field-grass)" />
      <polygon class="field-pulse" points="320,60 560,430 320,600 80,430" fill="var(--field-infield)" />
      <line x1="320" y1="560" x2="60" y2="200" stroke="var(--field-line)" stroke-width="2" />
      <line x1="320" y1="560" x2="580" y2="200" stroke="var(--field-line)" stroke-width="2" />
      <polygon points="320,560 445,428 320,328 195,428" fill="none" stroke="var(--field-dirt)" stroke-width="34" stroke-linejoin="round" />
      <circle cx="320" cy="430" r="16" fill="var(--field-dirt)" />
      <rect x="308" y="548" width="24" height="24" fill="var(--field-base)" transform="rotate(45 320 560)" />
      <rect x="433" y="416" width="20" height="20" fill="var(--field-base)" transform="rotate(45 445 428)" />
      <rect x="308" y="316" width="20" height="20" fill="var(--field-base)" transform="rotate(45 320 328)" />
      <rect x="183" y="416" width="20" height="20" fill="var(--field-base)" transform="rotate(45 195 428)" />
      ${markers}
    </svg>`;
  }

  let expandedTeam = null;
  let pendingTeamOpen = false;
  let pendingTeamClose = false;

  function renderDiamondPanel(team, expanded) {
    return `<tr class="diamond-row" data-abbr="${team.abbr}"><td colspan="3"><div class="diamond-accordion${expanded ? ' expanded' : ''}"><div class="diamond-accordion-inner">
      <div class="diamond-panel">
        <div class="diamond-head">
          <h3>${teamLogoImg(team.abbr, 24)}${team.name} — 2026 roster by position</h3>
          <span class="diamond-sub">Top player by playing time at each spot — "not qualified" means below the scoring minimum (150 PA / 50 IP)</span>
        </div>
        <div class="diamond-wrap">${renderDiamondSvg(team.abbr)}</div>
        <div class="diamond-legend">
          <span><span class="legend-dot" style="background:var(--good)"></span>Underpaid (value score)</span>
          <span><span class="legend-dot" style="background:var(--bad)"></span>Overpaid (value score)</span>
          <span><span class="legend-dot" style="background:var(--accent)"></span>Pre-arb — projected surplus</span>
        </div>
      </div>
    </div></div></td></tr>`;
  }


  // --- Router ---------------------------------------------------------------
  // Hash routes keep every view deep-linkable without adding server routes:
  //   #/home #/players #/players/<group> #/pre-arbitration #/teams
  //   #/team/<slug> #/weights
  // Players groups: all, infield, outfield, rotation, bullpen. Legacy
  // #/rotation and #/bullpen now land on the matching Players group, and
  // legacy #/rookies lands on Pre-Arbitration.
  const TAB_VIEWS = ['home', 'players', 'prearb', 'teams', 'custom'];
  const ROUTE_TO_VIEW = {
    home: 'home', players: 'players',
    'pre-arbitration': 'prearb', prearb: 'prearb', rookies: 'prearb',
    teams: 'teams', weights: 'custom', team: 'team',
  };
  const LEGACY_PLAYER_GROUPS = { rotation: 'rotation', bullpen: 'bullpen' };
  let currentRoute = 'home';
  let routeToken = 0;

  function pathToRoute() {
    let raw = location.hash.replace(/^#\/?/, '');
    if (!raw) {
      const q = new URLSearchParams(location.search).get('team');
      if (q) raw = 'team/' + q;
      else return { view: 'home', team: null };
    }
    // Legacy #teams:NL
    if (raw.startsWith('teams:')) {
      const lg = raw.split(':')[1];
      if (lg === 'NL' || lg === 'AL') {
        teamsFilter = { league: lg, division: 'All', team: 'All' };
        cascadeOpen = false;
      }
      return { view: 'teams', team: null };
    }
    if (raw.startsWith('team/')) return { view: 'team', team: raw.slice(5) };
    if (raw.startsWith('players/')) {
      const group = raw.slice(8);
      return { view: 'players', group: PLAYER_GROUPS[group] ? group : 'all', team: null };
    }
    if (raw === 'rotation' || raw === 'bullpen') {
      return { view: 'players', group: LEGACY_PLAYER_GROUPS[raw], team: null };
    }
    if (raw === 'custom') return { view: 'custom', team: null };
    if (ROUTE_TO_VIEW[raw]) return { view: ROUTE_TO_VIEW[raw], team: null };
    return { view: 'home', team: null };
  }

  function setActiveNav(view, name) {
    const routeName = view === 'custom' ? 'weights' : (view === 'team' ? 'teams' : view);
    document.querySelectorAll('.nav-link[data-route]').forEach(el => {
      el.classList.toggle('active', el.dataset.route === routeName);
    });
  }

  function hideAllViews() {
    TAB_VIEWS.forEach(v => {
      const el = document.getElementById(v + '-view');
      if (el) el.style.display = 'none';
    });
    const teamEl = document.getElementById('team-view');
    if (teamEl) teamEl.style.display = 'none';
  }

  function showView(view) {
    hideAllViews();
    const el = document.getElementById(view + '-view');
    if (!el) return;
    el.style.display = '';
    el.classList.remove('view-anim');
    void el.offsetWidth;
    el.classList.add('view-anim');
    currentTab = view;
    const area = document.querySelector('.content-area');
    if (area) area.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function navigateTo(hash) {
    if (location.hash === hash) { renderRoute(); return; }
    location.hash = hash;
  }

  function switchTab(name) {
    if (name === 'rotation' || name === 'bullpen') {
      navigateTo('#/players/' + name);
      return;
    }
    navigateTo('#/' + (name === 'custom' ? 'weights' : name));
  }

  function renderRoute() {
    const parsed = pathToRoute();
    currentRoute = parsed.view;
    setActiveNav(parsed.view, parsed.team);
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
    if (parsed.view === 'team') {
      showView('team');
      if (!renderTeamPage(parsed.team)) {
        const msg = document.getElementById('team-view');
        if (msg) msg.innerHTML = `<div class="section-block"><h2 class="section-title">Team not found</h2><p class="section-subtitle">Pick a team from the Teams menu or the Teams table.</p><p><a class="nav-link" href="#/teams">Back to Teams</a></p></div>`;
      }
    } else {
      resetTeamTheme();
      if (parsed.view === 'teams') renderTeams();
      if (parsed.view === 'players') {
        setPlayerGroup(parsed.group || 'all');
        renderPlayers();
      }
      showView(parsed.view);
    }
  }

  // Nav clicks are real links; only the preview "show more" buttons need JS.
  document.querySelectorAll('.preview-link[data-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // Dropdowns: click toggles, click-outside closes, Escape closes.
  document.querySelectorAll('.nav-dropdown-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const drop = btn.closest('.nav-dropdown');
      const wasOpen = drop.classList.contains('open');
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
      if (!wasOpen) drop.classList.add('open');
      btn.setAttribute('aria-expanded', String(!wasOpen));
    });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-dropdown')) {
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
    }
  });

  // Home rows (carousel slides and Explore lists) are rendered
  // dynamically and open the player card via the shared homeRowsCurrent index.
  const homeViewEl = document.getElementById('home-view');
  if (homeViewEl) {
    homeViewEl.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const showMore = e.target.closest('.show-more');
      if (showMore) {
        if (showMore.dataset.tab) switchTab(showMore.dataset.tab);
        return;
      }
      const dot = e.target.closest('.carousel-dot');
      if (dot) {
        carouselState[dot.dataset.carousel] = Number(dot.dataset.slide);
        renderHome();
        return;
      }
      const arrow = e.target.closest('.carousel-arrow');
      if (arrow) {
        const lg = arrow.dataset.carousel;
        const dir = Number(arrow.dataset.dir);
        carouselState[lg] = ((carouselState[lg] || 0) + dir + 2) % 2;
        renderHome();
        return;
      }
      const teamToggle = e.target.closest('[data-team-toggle]');
      if (teamToggle) {
        const abbr = teamToggle.dataset.teamToggle;
        if (expandedRotationTeams.has(abbr)) expandedRotationTeams.delete(abbr);
        else expandedRotationTeams.add(abbr);
        renderHome();
        return;
      }
      const row = e.target.closest('[data-pidx]');
      if (!row) return;
      openPlayerCard(homeRowsCurrent[Number(row.dataset.pidx)]);
    });

    homeViewEl.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('a')) return;
        const teamToggle = e.target.closest('[data-team-toggle]');
        if (teamToggle) {
          e.preventDefault();
          const abbr = teamToggle.dataset.teamToggle;
          if (expandedRotationTeams.has(abbr)) expandedRotationTeams.delete(abbr);
          else expandedRotationTeams.add(abbr);
          renderHome();
          return;
        }
        const row = e.target.closest('[data-pidx]');
        if (row) {
          e.preventDefault();
          openPlayerCard(homeRowsCurrent[Number(row.dataset.pidx)]);
        }
      }
    });
  }

  function renderAll() {
    renderHome();
    renderPlayers();
    renderPreArb();
    renderTeams();
    renderCustomScore();
    if (currentTab === 'team' && activeTeamAbbr) renderTeamPage(activeTeamAbbr);
  }

  recomputeAll();
  renderAll();
  animGeneration++;
  animateCounters();
  window.addEventListener('hashchange', () => {
    routeToken++;
    renderRoute();
  });
  renderRoute();

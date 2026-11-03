  // --- Sorting (shared header click handling) ---
  document.querySelectorAll('#players-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      playerSort.dir = playerSort.key === key && playerSort.dir === 'desc' ? 'asc' : 'desc';
      playerSort.key = key;
      renderPlayers();
    });
  });
  // The Teams tab's nested grouped layout replaced its old sortable flat table.

  // --- Topbar nav ---
  const TAB_VIEWS = ['home', 'players', 'rotation', 'bullpen', 'locks', 'arbitration', 'rookies', 'teams', 'custom'];
  function switchTab(name) {
    currentTab = name;
    document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.nav-drop').forEach(d => d.classList.remove('open'));
    TAB_VIEWS.forEach(v => {
      const el = document.getElementById(v + '-view');
      el.style.display = v === name ? '' : 'none';
      if (v === name) {
        el.classList.remove('view-anim');
        void el.offsetWidth; // force reflow so the fade replays on repeat visits
        el.classList.add('view-anim');
      }
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Hash deep-link so sub-pages are bookmarkable/shareable; home clears it.
    try {
      const url = name === 'home' ? window.location.pathname + window.location.search : '#' + name;
      history.replaceState(null, '', url);
    } catch (e) { /* ignore */ }
  }
  document.querySelectorAll('.nav-item').forEach(tab => {
    tab.addEventListener('click', () => { if (tab.dataset.tab) switchTab(tab.dataset.tab); });
  });
  document.querySelector('.brand').addEventListener('click', () => switchTab('home'));
  // Dropdown items that navigate to a view.
  document.querySelectorAll('.nav-drop-item[data-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });
  document.querySelectorAll('.preview-link').forEach(el => {
    el.addEventListener('click', () => { if (el.dataset.tab) switchTab(el.dataset.tab); });
  });

  // Dropdowns: click toggles, click-outside closes, Escape closes.
  document.querySelectorAll('.nav-drop-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const drop = btn.parentElement;
      const wasOpen = drop.classList.contains('open');
      document.querySelectorAll('.nav-drop').forEach(d => d.classList.remove('open'));
      if (!wasOpen) drop.classList.add('open');
      btn.setAttribute('aria-expanded', String(!wasOpen));
    });
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-drop')) {
      document.querySelectorAll('.nav-drop').forEach(d => d.classList.remove('open'));
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.nav-drop').forEach(d => d.classList.remove('open'));
    }
  });
  // The topbar "Teams" dropdown is rendered from the teams data with nested
  // League > Division > Team levels (see renderNavTeamsMenu in the Teams tab
  // section); team clicks filter the Teams tab to that team.

  // Home rows (carousel slides, Explore lists, contract locks) are rendered
  // dynamically and open the player card via the shared homeRowsCurrent index.
  document.getElementById('home-view').addEventListener('click', e => {
    const showMore = e.target.closest('.show-more');
    if (showMore) {
      if (showMore.dataset.teamsLeague) openTeamsLeague(showMore.dataset.teamsLeague);
      else if (showMore.dataset.tab) switchTab(showMore.dataset.tab);
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
      carouselState[lg] = (carouselState[lg] + dir + 2) % 2;
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

  function renderAll() {
    renderHome();
    renderPlayers();
    renderRotation();
    renderBullpen();
    renderLocksSubpage();
    renderArbitration();
    renderRookies();
    renderTeams();
    renderCustomScore();
  }

  // Crossfade the theme when the OS color-scheme flips (only transition the
  // surfaces that use theme vars; the class is dropped after the fade so
  // hover transitions aren't polluted).
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener) {
    const schemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const themeCrossfade = () => {
      document.documentElement.classList.add('theme-anim');
      setTimeout(() => document.documentElement.classList.remove('theme-anim'), 350);
    };
    schemeQuery.addEventListener('change', themeCrossfade);
  }

  recomputeAll();
  renderAll();
  animGeneration++;
  animateCounters();

  // Restore a deep-linked sub-page from the URL hash (#locks, #teams:NL, ...).
  // Runs after renderAll() so every view is already populated.
  (function initFromHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return;
    const [view, lg] = h.split(':');
    if (view === 'teams' && (lg === 'NL' || lg === 'AL')) openTeamsLeague(lg);
    else if (view === 'locks') switchTab('locks');
    else if (TAB_VIEWS.includes(view)) switchTab(view);
  })();

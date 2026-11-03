  const DATA = __DATA_JSON__;
  const allPlayers = DATA.allPlayers;
  const positionStats = DATA.positionStats || {};
  const positionStatsHistory = DATA.positionStatsHistory || {};
  const historicalArbOutcomes = DATA.historicalArbOutcomes || [];
  const teams = DATA.teams;
  const rosters = DATA.rosters || {};
  const teamColors = DATA.teamColors || {};
  const contracts = DATA.contracts || {};
  // Empirical 10th-percentile year-over-year raise from real consecutive-
  // season arb settlements (see build_dashboard.py) -- most returning arb
  // players get a real raise, not just legal-floor protection from a cut.
  const ARB_RAISE_FLOOR_PCT = DATA.arbRaiseFloorPct || 0;
  const teamNameByAbbr = Object.fromEntries(teams.map(t => [t.abbr, t.name]));
  const teamLogoByAbbr = Object.fromEntries(teams.map(t => [t.abbr, t.logo]));
  function teamLogoImg(abbr, sizePx) {
    const logo = teamLogoByAbbr[abbr];
    return logo ? `<img class="team-logo" src="${logo}" alt="" width="${sizePx}" height="${sizePx}" />` : '';
  }
  // Standard player identity cell (name + regression tag, then team logo +
  // team abbreviation + position pill) used consistently across every table.
  function playerNameCellHtml(p) {
    return `<div class="name-cell"><span>${p.name}${regressionTagHtml(p)}</span><span class="team-tag">${teamLogoImg(p.team, 13)}${p.team} · <span class="pos-pill">${p.position}</span></span></div>`;
  }
  const marketCount = allPlayers.filter(p => !p.isPreArb).length;
  const preArbCount = allPlayers.filter(p => p.isPreArb).length;
  function matchesTeamQuery(p, q) {
    return p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q) ||
      (teamNameByAbbr[p.team] || '').toLowerCase().includes(q);
  }
  // Two-way players (Ohtani) have the same id for both a batting and a
  // pitching record, so lookups must always disambiguate by position too.
  function findPlayerRecord(id, position) {
    return allPlayers.find(p => p.id === id && p.position === position);
  }

  // Surfaces a silently-broken nightly refresh (the actual failure mode
  // this caught in practice: the Windows Task Scheduler job missed several
  // nights in a row with no visible symptom other than an old timestamp)
  // right on the page, instead of only being discoverable by checking logs.
  // 36h rather than 24h so one legitimately-missed night (e.g. a single
  // unplugged evening) doesn't cry wolf -- two in a row should.
  const STALE_THRESHOLD_HOURS = 36;
  const capturedDate = new Date(DATA.capturedAt.replace(' UTC', 'Z').replace(' ', 'T'));
  const hoursOld = (Date.now() - capturedDate.getTime()) / 3600000;
  const isStale = Number.isFinite(hoursOld) && hoursOld > STALE_THRESHOLD_HOURS;
  const snapshotNoteEl = document.getElementById('snapshot-note');
  snapshotNoteEl.textContent =
    `Snapshot of 2026 season data · ${marketCount} market-priced players + ${preArbCount} pre-arb/MiLB prospects (min. 150 PA / 50 IP) across ${teams.length} teams · captured ${DATA.capturedAt}` +
    (isStale ? ` ⚠ DATA IS ${Math.round(hoursOld)}H OLD -- nightly refresh may have failed` : '');
  snapshotNoteEl.classList.toggle('stale', isStale);

  // --- Motion helpers (counters, value bars, tab transitions) ---
  let currentTab = 'home';
  let animGeneration = 0;
  let lastAnimatedGeneration = -1;
  function prefersReducedMotion() {
    if (!window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function formatCount(el, v) {
    const f = el.dataset.countFmt;
    if (f === 'money') return fmtMoney(v);
    if (f === 'plusmoney') return '+' + fmtMoney(v);
    if (f === 'signed') return fmtSigned(v);
    if (f === 'pct1') return v.toFixed(1);
    if (f === 'dec1') return v.toFixed(1);
    if (f === 'dec2') return v.toFixed(2);
    if (f === 'pct1s') return v.toFixed(1) + '%';
    if (f === 'signedM') return fmtSigned(v / 1e6) + 'M';
    return Math.round(v).toString();
  }
  // Animate numeric cells + value bars in the currently-visible view. Only
  // runs when animGeneration changed (initial load / weight changes), so
  // sort/filter re-renders rebuild cells instantly at their final values.
  function animateCounters() {
    if (animGeneration === lastAnimatedGeneration) return;
    lastAnimatedGeneration = animGeneration;
    const root = document.getElementById(currentTab + '-view');
    if (!root || prefersReducedMotion()) return;
    const nums = [...root.querySelectorAll('[data-count]')]
      .filter(el => el.dataset.count !== '' && Number.isFinite(Number(el.dataset.count)));
    const bars = root.querySelectorAll('.bar-fill[data-w]');
    if (!nums.length && !bars.length) return;
    nums.forEach(el => { el.textContent = formatCount(el, 0); });
    bars.forEach(b => { b.style.transition = 'none'; b.style.width = '0'; });
    const start = performance.now();
    const dur = 450;
    const step = now => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      nums.forEach(el => { el.textContent = formatCount(el, Number(el.dataset.count) * e); });
      bars.forEach(b => { b.style.width = b.dataset.w; });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // Grow value bars inside an arbitrary root (e.g. the player card modal),
  // independent of the view-based pass above.
  function animateBarsIn(root) {
    if (!root || prefersReducedMotion()) return;
    const bars = root.querySelectorAll('.bar-fill[data-w]');
    if (!bars.length) return;
    bars.forEach(b => { b.style.transition = 'none'; b.style.width = '0'; });
    requestAnimationFrame(() => {
      bars.forEach(b => {
        b.style.transition = 'width 0.45s cubic-bezier(.2,.9,.3,1.15)';
        b.style.width = b.dataset.w;
      });
    });
  }

  function fmtMoney(n) {
    if (n == null) return '—';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    return '$' + Math.round(n / 1000) + 'K';
  }
  function fmtSigned(n) {
    if (n == null) return '—';
    const s = n >= 0 ? '+' : '';
    return s + n.toFixed(1);
  }

  function valueBar(value, max) {
    const pct = Math.min(Math.abs(value) / max, 1) * 50;
    const cls = value >= 0 ? 'good' : 'bad';
    const style = value >= 0
      ? `left:50%; width:${pct}%;`
      : `right:50%; width:${pct}%;`;
    return `<div class="bar-cell">
      <div class="bar-track"><div class="bar-mid"></div><div class="bar-fill anim ${cls}" data-w="${pct}%" style="${style}"></div></div>
      <span class="value-num ${cls}" data-count="${value}" data-count-fmt="signed">${fmtSigned(value)}</span>
    </div>`;
  }


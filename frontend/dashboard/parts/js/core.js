  const DATA = __DATA_JSON__;
  const CURRENT_SEASON = DATA.season || 2026;
  const allPlayers = DATA.allPlayers;
  const positionStats = DATA.positionStats || {};
  const positionStatsHistory = DATA.positionStatsHistory || {};
  const historicalArbOutcomes = DATA.historicalArbOutcomes || [];
  const teams = DATA.teams;
  const rosters = DATA.rosters || {};
  const teamColors = DATA.teamColors || {};
  if (teamColors.ATH && !teamColors.OAK) teamColors.OAK = teamColors.ATH;
  const contracts = DATA.contracts || {};
  // Empirical 10th-percentile year-over-year raise from real consecutive-
  // season arb settlements (see build_dashboard.py) -- most returning arb
  // players get a real raise, not just legal-floor protection from a cut.
  const ARB_RAISE_FLOOR_PCT = DATA.arbRaiseFloorPct || 0;
  const teamNameByAbbr = Object.fromEntries(teams.map(t => [t.abbr, t.name]));
  const teamLogoByAbbr = Object.fromEntries(teams.map(t => [t.abbr, t.logo]));
  function teamSlug(team) {
    return String((team && team.name) || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  function teamLogoImg(abbr, sizePx) {
    const logo = teamLogoByAbbr[abbr];
    return logo ? `<img class="team-logo" src="${logo}" alt="" width="${sizePx}" height="${sizePx}" />` : '';
  }
  // Standard player identity cell (headshot snapshot + name + regression tag, then team logo +
  // team abbreviation + position pill) used consistently across every table.
  function playerNameCellHtml(p) {
    const secPill = p.secondaryPosition
      ? ` <span class="pos-pill sec-pos-pill" title="Secondary position: ${p.secondaryPosition}">${p.secondaryPosition}</span>`
      : '';
    return `<div class="name-cell">${headshotHtml(p, 'table-avatar')}<div class="name-meta"><span class="player-name-text">${p.name}${regressionTagHtml(p)}</span><span class="team-tag">${teamLogoImg(p.team, 13)}${p.team} · <span class="pos-pill">${p.position}</span>${secPill}</span></div></div>`;
  }
  function nameCellHtml(p) { return playerNameCellHtml(p); }
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
    `Snapshot of ${DATA.season || 2026} season data · ${marketCount} market-priced players + ${preArbCount} pre-arb/MiLB prospects (min. 150 PA / 50 IP) across ${teams.length} teams · captured ${DATA.capturedAt}` +
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

  // --- Shared Player Value, Roster Formatting & Driver Helpers ---
  function isArbEligible(p) {
    if (!p || p.isPreArb) return false;
    const contract = contracts[p.id];
    if (contract && (contract.contractType === 'Extension' || contract.endSeasonAll > CURRENT_SEASON)) {
      return false;
    }
    const ct = p.contractType || '';
    if (ct.includes('Guaranteed Sect')) return false;
    return /^Arbitration/.test(ct) || ct === 'Free Agent/Arb';
  }

  function playerMarketValue(p) {
    if (!p) return 0;
    if (p.recommendedSalary != null) return p.recommendedSalary;
    if (p.projectedSalary != null) return p.projectedSalary;
    return p.aav != null ? p.aav : (p.salary || 0);
  }

  function playerSurplus(p) {
    if (!p) return 0;
    if (p.paySurplus != null) return p.paySurplus;
    if (p.surplus != null) return p.surplus;
    return playerMarketValue(p) - (p.salary || 0);
  }

  function tierForPlayer(p) {
    const pct = p && p.compPct != null ? p.compPct : 0;
    const surplus = playerSurplus(p);

    let baseTier;
    if (pct >= 90) baseTier = { label: 'Great', cls: 'a', status: 'status-great' };
    else if (pct >= 75) baseTier = { label: 'Good', cls: 'b', status: 'status-good' };
    else if (pct >= 50) baseTier = { label: 'Avg', cls: 'c', status: 'status-avg' };
    else if (pct >= 30) baseTier = { label: 'Below Avg', cls: 'd', status: 'status-below' };
    else baseTier = { label: 'Poor', cls: 'f', status: 'status-poor' };

    // Rule: There should be no players ever with any kind of positive net surplus and considered a 'Poor'.
    if (surplus > 0) {
      if (baseTier.cls === 'f') {
        return surplus >= 1700000
          ? { label: 'Avg', cls: 'c', status: 'status-avg' }
          : { label: 'Below Avg', cls: 'd', status: 'status-below' };
      }
      if (surplus >= 4000000 && baseTier.cls === 'd') {
        return { label: 'Avg', cls: 'c', status: 'status-avg' };
      }
    }
    return baseTier;
  }

  function contractLabel(p) {
    if (!p) return { label: '—', cls: '' };
    if (p.isPreArb) return { label: 'Pre-Arb', cls: 'pre-arb' };
    const contract = contracts[p.id];
    if (contract && contract.contractType === 'Extension') {
      return { label: 'Extension', cls: '' };
    }
    if (p.contractType && p.contractType.includes('Guaranteed Sect')) {
      return { label: 'Extension', cls: '' };
    }
    if (isArbEligible(p)) return { label: 'Arb', cls: 'highlight' };
    return { label: p.contractType || 'Veteran', cls: '' };
  }

  function formatOrdinal(n) {
    if (n == null || isNaN(n)) return '—';
    const num = Math.round(n);
    const s = ['th', 'st', 'nd', 'rd'];
    const v = num % 100;
    return num + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function perfPercentileCls(pct) {
    if (pct == null || isNaN(pct)) return '';
    if (pct >= 90) return 'perf-great';
    if (pct >= 70) return 'perf-good';
    if (pct >= 50) return 'perf-avg';
    return 'perf-poor';
  }

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

  function fmtStatValueExt(type, v) {
    return fmtStatValue(type, v);
  }

  function fmtSignedMoney(n) {
    if (n == null) return '—';
    return (n < 0 ? '-' : '+') + fmtMoney(Math.abs(n));
  }

  function headshotHtml(p, cls) {
    if (!p) return '';
    if (p.headshot) return `<img src="${p.headshot}" alt="" class="${cls}" loading="lazy" />`;
    const initials = (p.name || '').split(/\s+/).map(w => w[0]).slice(0, 2).join('');
    return `<span class="${cls} avatar-initials">${initials}</span>`;
  }

  function primaryDriver(p) {
    if (!p) return '—';
    const ps = positionStats[p.position] || {};
    let candidates = [];
    if (p.isBatter) {
      candidates = [
        { key: 'xwoba', label: 'xwOBA', higherBetter: true, type: 'avg3' },
        { key: 'obp', label: 'OBP', higherBetter: true, type: 'avg3' },
        { key: 'hr', label: 'HR', higherBetter: true, type: 'int' },
        { key: 'sb', label: 'SB', higherBetter: true, type: 'int' },
        { key: 'slg', label: 'SLG', higherBetter: true, type: 'avg3' },
        { key: 'ba', label: 'BA', higherBetter: true, type: 'avg3' },
        { key: 'barrel_rate', label: 'Barrel%', higherBetter: true, type: 'pct1' },
        { key: 'wrc_plus', label: 'wRC+', higherBetter: true, type: 'int' },
        { key: 'oaa', label: 'OAA', higherBetter: true, type: 'int' },
      ];
    } else {
      candidates = [
        { key: 'fip', label: 'FIP', higherBetter: false, type: 'rate2' },
        { key: 'whip', label: 'WHIP', higherBetter: false, type: 'rate2' },
        { key: 'era', label: 'ERA', higherBetter: false, type: 'rate2' },
        { key: 'xera', label: 'xERA', higherBetter: false, type: 'rate2' },
        { key: 'stuff_plus', label: 'Stuff+', higherBetter: true, type: 'int' },
        { key: 'k_9', label: 'K/9', higherBetter: true, type: 'rate2' },
      ];
    }
    let best = null;
    candidates.forEach(s => {
      const v = p.stats ? p.stats[s.key] : null;
      const st = ps[s.key];
      if (v == null || !st || !(st.std > 0)) return;
      const z = s.higherBetter ? (v - st.mean) / st.std : -(v - st.mean) / st.std;
      if (z > 0 && (!best || z > best.z)) {
        best = { ...s, z, value: v };
      }
    });
    if (best) return `${fmtStatValue(best.type, best.value)} ${best.label}`;
    const rows = (p.breakdown || []).filter(s => s.z != null && s.contribution > 0);
    if (rows.length) {
      const b = rows.sort((a, b) => b.contribution - a.contribution)[0];
      return `${fmtStatValue(b.type, b.value)} ${b.label}`;
    }
    return '—';
  }



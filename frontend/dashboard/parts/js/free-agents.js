  // --- Free Agents view ------------------------------------------------------
  // This offseason's class: everyone isNearingFreeAgency flags, with the fWAR
  // model's projected years / AAV / total from war_projection.py.
  const FA_AGE_HEADER = document.querySelector('#freeagents-view th[data-sort="age"]');
  if (FA_AGE_HEADER) FA_AGE_HEADER.textContent = `Age (${CURRENT_SEASON + 1})`;

  let activeFaPos = 'All';
  let faSort = { key: 'total', dir: 'desc' };
  let faRowsCurrent = [];

  const faChipsEl = document.getElementById('fa-pos-chips');
  if (faChipsEl) {
    faChipsEl.innerHTML = POSITIONS.map(p =>
      `<button type="button" class="chip${p === activeFaPos ? ' active' : ''}" data-pos="${p}">${p}</button>`
    ).join('');
  }

  function renderFreeAgents() {
    const searchEl = document.getElementById('fa-search');
    if (!searchEl) return;
    const q = searchEl.value.trim().toLowerCase();

    const rows = allPlayers
      .filter(p => p.warOutlook && Array.isArray(p.warOutlook.war) && isNearingFreeAgency(p))
      .filter(p => activeFaPos === 'All' || p.position === activeFaPos)
      .filter(p => q === '' || matchesTeamQuery(p, q))
      .map(p => ({
        p,
        age: p.age != null ? Math.floor(p.age) + 1 : null,
        war1: p.warOutlook.war[0] || 0,
        war5: p.warOutlook.war5,
        years: p.warOutlook.years,
        aav: p.warOutlook.aav,
        total: p.warOutlook.total,
      }));

    rows.sort((a, b) => {
      if (faSort.key === 'name') {
        return faSort.dir === 'asc'
          ? a.p.name.localeCompare(b.p.name)
          : b.p.name.localeCompare(a.p.name);
      }
      const av = a[faSort.key] ?? 0;
      const bv = b[faSort.key] ?? 0;
      return faSort.dir === 'asc' ? av - bv : bv - av;
    });

    const countEl = document.getElementById('fa-count');
    if (countEl) {
      countEl.textContent = `${rows.length} shown` + (rows.length ? ' · click a player for their card' : '');
    }

    const body = document.getElementById('fa-rows');
    if (body) {
      body.innerHTML = rows.length ? rows.slice(0, 300).map((row, i) => `
        <tr class="row-toggle" data-idx="${i}">
          <td><span class="chevron">▸</span>${playerNameCellHtml(row.p)}</td>
          <td class="num">${row.age != null ? row.age : '—'}</td>
          <td class="num">${row.war1.toFixed(1)}</td>
          <td class="num">${row.war5.toFixed(1)}</td>
          <td class="num">${row.years > 0 ? row.years : '—'}</td>
          <td class="num">${row.years > 0 ? fmtMoney(row.aav) : '—'}</td>
          <td class="num">${row.years > 0 ? fmtMoney(row.total) : '—'}</td>
        </tr>`
      ).join('') : `<tr><td colspan="7"><div class="empty">No free agents match that search.</div></td></tr>`;
    }

    const noteEl = document.getElementById('fa-note');
    if (noteEl) {
      noteEl.textContent = 'Contract estimates come from an fWAR projection (Marcel-style: last three seasons weighted 5-4-3 by playing time, regressed toward league average, aged forward) priced at $11.23M per WAR rising 4% a year. A year is guaranteed only while projected WAR stays at or above 1.2 (0.6 for relievers), never past age 38, and never beyond the 5-year projection window (so long deals for young stars are understated). These are model outputs, not predictions of what a team will sign; qualifying offers, injuries, and market competition are not modeled. Free-agent timing for team-controlled players uses an estimated service-time figure when MLB\'s is not available.';
    }

    faRowsCurrent = rows;
  }

  const faRowsEl = document.getElementById('fa-rows');
  if (faRowsEl) {
    faRowsEl.addEventListener('click', e => {
      const row = e.target.closest('.row-toggle');
      if (!row) return;
      const selected = faRowsCurrent[Number(row.dataset.idx)];
      if (selected) openPlayerCard(selected.p);
    });
  }

  const faSearchEl = document.getElementById('fa-search');
  if (faSearchEl) faSearchEl.addEventListener('input', renderFreeAgents);

  if (faChipsEl) {
    faChipsEl.addEventListener('click', e => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      activeFaPos = btn.dataset.pos;
      faChipsEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === btn));
      renderFreeAgents();
    });
  }

  document.querySelectorAll('#freeagents-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      faSort.dir = faSort.key === key && faSort.dir === 'desc' ? 'asc' : 'desc';
      faSort.key = key;
      renderFreeAgents();
    });
  });

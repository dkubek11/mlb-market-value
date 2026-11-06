  let activeCustomPos = 'All';
  let customSort = { key: 'score', dir: 'desc' };
  const expandedCustomIds = new Set();
  let pendingCustomOpen = null;
  let pendingCustomClose = null;
  document.getElementById('custom-pos-chips').innerHTML = POSITIONS.map(p =>
    `<button class="chip${p === 'All' ? ' active' : ''}" data-pos="${p}">${p}</button>`
  ).join('');

  // Two-way players share an id across their batting/pitching rows, so the
  // expand/collapse state needs the position folded into the key too.
  function customRowKey(p) { return p.id + ':' + p.position; }

  function customDetailRow(p, expanded) {
    const w = p.isBatter ? battingWeights : pitchingWeights;
    const poolLabel = p.isBatter ? 'all hitters' : (p.position === 'SP' ? 'starters' : 'relievers');
    const fmtWar = v => (v >= 0 ? '+' : '') + v.toFixed(2);
    const baseRow = `<div class="preview-row">
        <span class="preview-row-name">Baseline (${p.isBatter ? p.position : p.position === 'RP' ? 'reliever' : 'starter'} avg talent × playing time)</span>
        <span class="preview-row-tag">${p.volume.toFixed(2)} × ${(p.baseWar / p.volume).toFixed(2)}</span>
        <span class="preview-row-val ${p.baseWar >= 0 ? 'good' : 'bad'}">${fmtWar(p.baseWar)}</span>
      </div>`;
    const rows = p.breakdown.map(s => {
      const cls = s.z == null ? '' : (s.contribution >= 0 ? 'good' : 'bad');
      return `<div class="preview-row">
        <span class="preview-row-name">${s.label}</span>
        <span class="preview-row-tag">${fmtStatValueExt(s.type, s.value)} · z=${s.z == null ? '—' : s.z.toFixed(2)} · ×${w[s.key].toFixed(2)}</span>
        <span class="preview-row-val ${cls}">${s.z == null ? '—' : fmtWar(s.contribution)}</span>
      </div>`;
    }).join('');
    const payRow = p.isPreArb
      ? `<div class="preview-row">
          <span class="preview-row-name">Pay</span>
          <span class="preview-row-tag">pre-arbitration — paid near league minimum by rule, no pay adjustment applied</span>
          <span class="preview-row-val">—</span>
        </div>`
      : `<div class="preview-row">
          <span class="preview-row-name">Pay</span>
          <span class="preview-row-tag">${fmtMoney(p.aav)} AAV · ${p.salPct.toFixed(1)}th percentile at ${p.position} · ×${payWeight.toFixed(1)}</span>
          <span class="preview-row-val bad">−${(payWeight * p.salPct).toFixed(1)}</span>
        </div>`;
    const bwarNow = p.stats.bwar != null ? p.stats.bwar : 0;
    const scoreFormula = p.isPreArb
      ? `Score = bWAR percentile = <span class="${p.score >= 0 ? 'good' : 'bad'}">${fmtSigned(p.score)}</span>`
      : `Score = ${p.compPct.toFixed(1)} − (${payWeight.toFixed(1)} × ${p.salPct.toFixed(1)}) = <span class="${p.score >= 0 ? 'good' : 'bad'}">${fmtSigned(p.score)}</span>`;
    const predFormula = p.isPreArb
      ? `Predicted Score = expected-bWAR percentile = <span class="${p.predictedScore >= 0 ? 'good' : 'bad'}">${fmtSigned(p.predictedScore)}</span>`
      : `Predicted Score = ${p.expectedPct.toFixed(1)} − (${payWeight.toFixed(1)} × ${p.salPct.toFixed(1)}) = <span class="${p.predictedScore >= 0 ? 'good' : 'bad'}">${fmtSigned(p.predictedScore)}</span>`;
    return `<tr class="detail-row" data-key="${customRowKey(p)}"><td colspan="8"><div class="detail-accordion${expanded ? ' expanded' : ''}"><div class="detail-accordion-inner"><div class="detail-inner">${baseRow}${rows}
      <div class="detail-formula">Expected bWAR = ${fmtWar(p.expectedWar)} → <span class="${p.expectedPct >= 50 ? 'good' : 'bad'}">${p.expectedPct.toFixed(1)}th</span> percentile among ${poolLabel} · actual ${bwarNow.toFixed(1)} bWAR (<span class="${p.compPct >= 50 ? 'good' : 'bad'}">${p.compPct.toFixed(1)}th</span>) · ${fmtWar(p.warGap)} vs. expected</div>
      ${payRow}
      <div class="detail-formula">${scoreFormula}</div>
      <div class="detail-formula">${predFormula}</div>
    </div></div></div></td></tr>`;
  }

  function renderCustomScore() {
    let rows = allPlayers.filter(p => activeCustomPos === 'All' || p.position === activeCustomPos);
    rows.sort((a, b) => {
      const k = customSort.key === 'percentile' ? 'compPct' : customSort.key;
      const pick = x => k === 'name' ? x.name : (k === 'bwar' ? (x.stats.bwar != null ? x.stats.bwar : 0) : x[k]);
      const va = pick(a);
      const vb = pick(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return customSort.dir === 'asc' ? cmp : -cmp;
    });

    document.getElementById('custom-count').textContent = `${rows.length} shown` + (rows.length ? ' · click a player for the breakdown' : '');
    document.getElementById('custom-rows').innerHTML = rows.length ? rows.map((p, i) => {
      const key = customRowKey(p);
      const open = expandedCustomIds.has(key);
      const row = `
      <tr class="row-toggle" data-idx="${i}">
        <td class="num">${i + 1}</td>
        <td><span class="chevron${open ? ' open' : ''}">▸</span>${playerNameCellHtml(p)}</td>
        <td class="num ${p.score >= 0 ? 'good' : 'bad'}" data-count="${p.score}" data-count-fmt="signed">${fmtSigned(p.score)}</td>
        <td class="num ${p.predictedScore >= 0 ? 'good' : 'bad'}">${fmtSigned(p.predictedScore)}</td>
        <td class="num">${(p.stats.bwar != null ? p.stats.bwar : 0).toFixed(1)}</td>
        <td class="num">${p.expectedWar.toFixed(1)}</td>
        <td class="num" data-count="${p.compPct}" data-count-fmt="pct1">${p.compPct.toFixed(1)}</td>
        <td>${p.grade}</td>
      </tr>`;
      return row + (open ? customDetailRow(p, open && key !== pendingCustomOpen && key !== pendingCustomClose) : '');
    }).join('') : `<tr><td colspan="8"><div class="empty">No players at this position.</div></td></tr>`;
    customRowsCurrent = rows;
  }
  let customRowsCurrent = [];

  document.getElementById('custom-rows').addEventListener('click', e => {
    const row = e.target.closest('.row-toggle');
    if (!row) return;
    const p = customRowsCurrent[Number(row.dataset.idx)];
    const key = customRowKey(p);
    const wasOpen = expandedCustomIds.has(key);
    if (wasOpen) {
      if (pendingCustomClose === key) return;
      const acc = document.querySelector(`#custom-view .detail-row[data-key="${CSS.escape(key)}"] .detail-accordion`);
      if (acc) acc.classList.remove('expanded');
      pendingCustomClose = key;
      setTimeout(() => {
        pendingCustomClose = null;
        if (expandedCustomIds.has(key)) { expandedCustomIds.delete(key); renderCustomScore(); }
      }, 230);
    } else {
      if (pendingCustomOpen === key) return;
      expandedCustomIds.add(key);
      pendingCustomOpen = key;
      renderCustomScore();
      requestAnimationFrame(() => {
        const acc = document.querySelector(`#custom-view .detail-row[data-key="${CSS.escape(key)}"] .detail-accordion`);
        if (acc) acc.classList.add('expanded');
      });
      setTimeout(() => { pendingCustomOpen = null; }, 300);
    }
  });
  document.getElementById('custom-pos-chips').addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    activeCustomPos = btn.dataset.pos;
    document.querySelectorAll('#custom-pos-chips .chip').forEach(c => c.classList.toggle('active', c === btn));
    renderCustomScore();
  });
  document.querySelectorAll('#custom-view thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      customSort.dir = customSort.key === key && customSort.dir === 'desc' ? 'asc' : 'desc';
      customSort.key = key;
      renderCustomScore();
    });
  });

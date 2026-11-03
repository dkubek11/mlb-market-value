  function buildWeightPanel(containerId, statConfig, weightsObj) {
    document.getElementById(containerId).innerHTML = statConfig.map(s => `
      <div class="weight-row">
        <span class="weight-label">${s.label}<span class="direction">${s.higherBetter ? 'higher is better' : 'lower is better'}</span></span>
        <input type="range" min="0" max="3" step="0.01" value="${weightsObj[s.key]}" data-stat="${s.key}" />
        <span class="weight-value" id="weight-val-${containerId}-${s.key}">${weightsObj[s.key].toFixed(2)}</span>
      </div>
    `).join('');
  }
  buildWeightPanel('weight-panel-bat', BATTER_STAT_CONFIG, battingWeights);
  buildWeightPanel('weight-panel-pit', PITCHER_STAT_CONFIG, pitchingWeights);
  document.getElementById('ew-r2-bat').textContent = Math.round(EW_MODEL.batter.cvR2 * 100) + '%';
  document.getElementById('ew-r2-pit').textContent = Math.round(EW_MODEL.pitcher.cvR2 * 100) + '%';

  function wireWeightPanel(containerId, statConfig, weightsObj) {
    document.getElementById(containerId).addEventListener('input', e => {
      const input = e.target.closest('input[type="range"]');
      if (!input) return;
      const key = input.dataset.stat;
      weightsObj[key] = parseFloat(input.value);
      document.getElementById('weight-val-' + containerId + '-' + key).textContent = weightsObj[key].toFixed(2);
      saveWeights();
      recomputeAll();
      renderAll();
      animGeneration++;
      animateCounters();
    });
  }
  wireWeightPanel('weight-panel-bat', BATTER_STAT_CONFIG, battingWeights);
  wireWeightPanel('weight-panel-pit', PITCHER_STAT_CONFIG, pitchingWeights);

  document.getElementById('reset-bat-weights').addEventListener('click', () => {
    BATTER_STAT_CONFIG.forEach(s => { battingWeights[s.key] = s.defaultWeight; });
    buildWeightPanel('weight-panel-bat', BATTER_STAT_CONFIG, battingWeights);
    saveWeights();
    recomputeAll();
    renderAll();
    animGeneration++;
    animateCounters();
  });
  document.getElementById('reset-pit-weights').addEventListener('click', () => {
    PITCHER_STAT_CONFIG.forEach(s => { pitchingWeights[s.key] = s.defaultWeight; });
    buildWeightPanel('weight-panel-pit', PITCHER_STAT_CONFIG, pitchingWeights);
    saveWeights();
    recomputeAll();
    renderAll();
    animGeneration++;
    animateCounters();
  });

  // Pay is the one non-stat lever: how hard salary pulls a market player's
  // final Score down from their pure performance percentile. It's a single
  // shared slider (not split by batting/pitching) since it's applied the
  // same way -- compPct - payWeight * salPct -- to every market player.
  function buildPayPanel() {
    document.getElementById('weight-panel-pay').innerHTML = `
      <div class="weight-row">
        <span class="weight-label">Pay<span class="direction">higher = salary pulls score down harder</span></span>
        <input type="range" min="0" max="3" step="0.1" value="${payWeight}" data-stat="pay" />
        <span class="weight-value" id="weight-val-pay">${payWeight.toFixed(1)}</span>
      </div>`;
  }
  buildPayPanel();
  document.getElementById('weight-panel-pay').addEventListener('input', e => {
    const input = e.target.closest('input[type="range"]');
    if (!input) return;
    payWeight = parseFloat(input.value);
    document.getElementById('weight-val-pay').textContent = payWeight.toFixed(1);
    saveWeights();
    recomputeAll();
    renderAll();
    animGeneration++;
    animateCounters();
  });
  document.getElementById('reset-pay-weight').addEventListener('click', () => {
    payWeight = DEFAULT_PAY_WEIGHT;
    buildPayPanel();
    saveWeights();
    recomputeAll();
    renderAll();
    animGeneration++;
    animateCounters();
  });


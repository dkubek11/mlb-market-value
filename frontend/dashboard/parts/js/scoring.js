  // --- Weighted composite scoring engine (this is the site's single source
  // of truth: every score/grade/value/projected-salary everywhere reads back
  // off the player objects that recomputeAll() below writes into) ---
  // PREDICTED SCORE model. The Score everywhere on the site ranks what a
  // player actually produced (bWAR); these weights drive the other half --
  // "expected bWAR", what the player's repeatable process stats say their
  // bWAR should have been given the playing time and position they had (see
  // expected_war.py). Each weight is bWAR per full season (600 PA / 100 IP)
  // for a one-standard-deviation-better stat, fit by non-negative least
  // squares on 2015-2025, so the defaults are data-derived rather than
  // hand-picked; the sliders let you override them.
  const EW_MODEL = DATA.expectedWarModel || {
    batter: { weights: {}, offsets: {}, intercept: 0, cvR2: 0, nTrain: 0 },
    pitcher: { weights: {}, offsets: {}, intercept: 0, cvR2: 0, nTrain: 0 },
  };
  // A single-season database (fresh local SQLite install) has no completed
  // seasons to fit the expected-bWAR model on. In that case fall back to
  // actual bWAR so the site still renders; the Predicted Score then mirrors
  // Score until historical seasons are ingested.
  const EW_AVAILABLE = !!(EW_MODEL && EW_MODEL.batter && EW_MODEL.batter.nTrain > 0
    && EW_MODEL.pitcher && EW_MODEL.pitcher.nTrain > 0);
  const BATTER_STAT_CONFIG = [
    { key: 'xwoba', label: 'xwOBA', higherBetter: true, type: 'avg3' },
    { key: 'xslg', label: 'xSLG', higherBetter: true, type: 'avg3' },
    { key: 'xba', label: 'xBA', higherBetter: true, type: 'avg3' },
    { key: 'barrel_rate', label: 'Barrel%', higherBetter: true, type: 'pct1' },
    { key: 'hard_hit_rate', label: 'Hard-Hit%', higherBetter: true, type: 'pct1' },
    { key: 'k_rate', label: 'K%', higherBetter: false, type: 'fracPct1' },
    { key: 'bb_rate', label: 'BB%', higherBetter: true, type: 'fracPct1' },
    { key: 'chase_rate', label: 'Chase%', higherBetter: false, type: 'fracPct1' },
    { key: 'whiff_rate', label: 'Whiff%', higherBetter: false, type: 'fracPct1' },
    { key: 'sprint_speed', label: 'Sprint Speed', higherBetter: true, type: 'velo1' },
    { key: 'sb', label: 'SB', higherBetter: true, type: 'int' },
    { key: 'oaa', label: 'OAA', higherBetter: true, type: 'int' },
    { key: 'frv', label: 'FRV', higherBetter: true, type: 'int' },
    { key: 'drs', label: 'DRS', higherBetter: true, type: 'int' },
  ].map(c => ({ ...c, defaultWeight: EW_MODEL.batter.weights[c.key] || 0 }));
  const PITCHER_STAT_CONFIG = [
    { key: 'xera', label: 'xERA', higherBetter: false, type: 'rate2' },
    { key: 'xba_against', label: 'xBA Allowed', higherBetter: false, type: 'avg3' },
    { key: 'avg_exit_velo_against', label: 'Avg Exit Velo Allowed', higherBetter: false, type: 'velo1' },
    { key: 'hard_hit_rate_against', label: 'Hard-Hit% Allowed', higherBetter: false, type: 'pct1' },
    { key: 'barrel_rate_against', label: 'Barrel% Allowed', higherBetter: false, type: 'pct1' },
    { key: 'k_rate', label: 'K%', higherBetter: true, type: 'fracPct1' },
    { key: 'bb_rate', label: 'BB%', higherBetter: false, type: 'fracPct1' },
    { key: 'chase_rate', label: 'Chase% Induced', higherBetter: true, type: 'fracPct1' },
    { key: 'whiff_rate', label: 'Whiff% Induced', higherBetter: true, type: 'fracPct1' },
    { key: 'z_swing_rate', label: 'Z-Swing% Induced', higherBetter: false, type: 'fracPct1' },
    { key: 'extension', label: 'Extension', higherBetter: true, type: 'velo1' },
    { key: 'stuff_plus', label: 'Stuff+', higherBetter: true, type: 'int' },
    { key: 'location_plus', label: 'Location+', higherBetter: true, type: 'int' },
  ].map(c => ({ ...c, defaultWeight: EW_MODEL.pitcher.weights[c.key] || 0 }));
  const battingWeights = {};
  BATTER_STAT_CONFIG.forEach(s => { battingWeights[s.key] = s.defaultWeight; });
  const pitchingWeights = {};
  PITCHER_STAT_CONFIG.forEach(s => { pitchingWeights[s.key] = s.defaultWeight; });
  const DEFAULT_PAY_WEIGHT = 1.0;
  let payWeight = DEFAULT_PAY_WEIGHT;

  // Custom weights persist in this browser across visits (localStorage, not
  // the server) -- each slider change re-saves the full set. v2: weights are
  // now bWAR-per-SD, not the old arbitrary composite scale.
  const WEIGHTS_STORAGE_KEY = 'mlbMarketValue.customWeights.v2';
  function saveWeights() {
    try {
      localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify({ battingWeights, pitchingWeights, payWeight }));
    } catch { /* private browsing / storage disabled -- weights just won't persist */ }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(WEIGHTS_STORAGE_KEY) || 'null');
    if (saved) {
      Object.assign(battingWeights, saved.battingWeights);
      Object.assign(pitchingWeights, saved.pitchingWeights);
      if (typeof saved.payWeight === 'number') payWeight = saved.payWeight;
    }
  } catch { /* corrupt/old saved shape -- fall back to defaults already set above */ }

  // Separate composite used ONLY to match pre-arb/arb-eligible players
  // against each other in directArbCompSalary -- real arbitration hearings
  // are decided on traditional counting/rate stats and playing time, not
  // Statcast-era advanced metrics (BATTER_STAT_CONFIG/PITCHER_STAT_CONFIG
  // above, which stays the basis for Score/grade/open-market value
  // everywhere else on the site, unchanged). Confirmed by two independent
  // signals: real-world research on how arbitration panels actually build
  // comp cases, and this site's own spot-checks finding elite closers
  // undervalued specifically because saves aren't part of compPct at all.
  const BATTER_ARB_CONFIG = [
    { key: 'ba', label: 'AVG', higherBetter: true, defaultWeight: 1.5, type: 'avg3' },
    { key: 'obp', label: 'OBP', higherBetter: true, defaultWeight: 1.0, type: 'avg3' },
    { key: 'slg', label: 'SLG', higherBetter: true, defaultWeight: 1.0, type: 'avg3' },
    { key: 'hr', label: 'HR', higherBetter: true, defaultWeight: 1.5, type: 'int' },
    { key: 'rbi', label: 'RBI', higherBetter: true, defaultWeight: 1.5, type: 'int' },
    { key: 'sb', label: 'SB', higherBetter: true, defaultWeight: 0.5, type: 'int' },
    { key: 'hits', label: 'Hits', higherBetter: true, defaultWeight: 1.0, type: 'int' },
    { key: 'games', label: 'Games', higherBetter: true, defaultWeight: 0.5, type: 'int' },
  ];
  const PITCHER_ARB_CONFIG = [
    { key: 'era', label: 'ERA', higherBetter: false, defaultWeight: 2.0, type: 'rate2' },
    { key: 'whip', label: 'WHIP', higherBetter: false, defaultWeight: 1.0, type: 'rate2' },
    { key: 'k_9', label: 'K/9', higherBetter: true, defaultWeight: 1.0, type: 'rate2' },
    { key: 'wins', label: 'Wins', higherBetter: true, defaultWeight: 1.5, type: 'int' },
    { key: 'saves', label: 'Saves', higherBetter: true, defaultWeight: 1.5, type: 'int' },
    { key: 'ip', label: 'IP', higherBetter: true, defaultWeight: 1.0, type: 'rate2' },
    { key: 'games_started', label: 'GS', higherBetter: true, defaultWeight: 0.3, type: 'int' },
  ];

  // Arbitration-eligible players (contract_type "Arbitration"/"Free Agent/Arb")
  // and pre-arb players both have CBA-suppressed pay that doesn't reflect open-
  // market value -- real arbitration/extension numbers are calculated as a
  // percentage of open-market value, not the market value itself (see
  // arbServicePercent below). RosterResource's contract_type doesn't split out
  // Arb1/Arb2/Arb3 or Super Two, so which year a player is in is approximated
  // from years since MLB debut (serviceYears) -- not the same as true accrued
  // service time (call-up timing, options days, etc. aren't captured).
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
  // Real CBA rule: free agency hits at 6.000 years of service. Players who
  // reach 3.000 first get 3 arbitration-eligible years (40/60/80% of open-
  // market value). Players who qualify for "Super Two" status (top ~22% of
  // the 2.000-3.000-YOS group by a cutoff set fresh each year, e.g. 2.140 for
  // 2026) get a 4th, earlier year instead (25/40/60/80%). Any player showing
  // real service time under 3.000 here is arbitration-eligible *because*
  // they cleared that year's cutoff -- Super Two status doesn't need to be
  // looked up separately, it falls straight out of the service-time number.
  function tierFromServiceYears(svc) {
    if (svc == null) svc = 3;
    if (svc < 3.0) {
      const yearNum = Math.max(1, Math.min(4, Math.floor(svc) - 1));
      return [0.25, 0.40, 0.60, 0.80][yearNum - 1];
    }
    const yearNum = Math.max(1, Math.min(3, Math.floor(svc) - 2));
    return [0.40, 0.60, 0.80][yearNum - 1];
  }
  function arbServicePercent(p) {
    return tierFromServiceYears(p.serviceYears);
  }
  // Shared by arbYearLabel (full sentence, used on the player card) and the
  // Arbitration tab (short label + sortable numeric year).
  function arbYearParts(p) {
    const svc = p.serviceYears != null ? p.serviceYears : 3;
    const isSuperTwo = svc < 3.0;
    const yearNum = isSuperTwo
      ? Math.max(1, Math.min(4, Math.floor(svc) - 1))
      : Math.max(1, Math.min(3, Math.floor(svc) - 2));
    return { yearNum, totalYears: isSuperTwo ? 4 : 3, isSuperTwo };
  }
  function arbYearLabel(p) {
    const { yearNum, totalYears, isSuperTwo } = arbYearParts(p);
    const basis = p.serviceYearsExact ? 'actual service time' : 'estimated service time';
    return `${isSuperTwo ? 'Super Two, ' : ''}year ${yearNum} of ${totalYears} (${basis})`;
  }
  // Sortable numeric year (1-4) plus a compact table label ("Arb 2" /
  // "Super Two 3"). Sorting by this groups players by tier the way "what
  // year of arbitration are they in" is normally meant, rather than by raw
  // continuous service time.
  function arbYearNumber(p) {
    return arbYearParts(p).yearNum;
  }
  function arbYearShortLabel(p) {
    const { yearNum, isSuperTwo } = arbYearParts(p);
    return isSuperTwo ? `Super Two ${yearNum}` : `Arb ${yearNum}`;
  }

  function fmtStatValueExt(type, v) {
    if (v == null) return '—';
    if (type === 'fracPct1') return (v * 100).toFixed(1) + '%';
    return fmtStatValue(type, v);
  }

  // How much weight the Marcel-style multi-year projection gets when anchoring
  // a player's salary comps, vs. their compPct from this season alone.
  const PROJECTION_BLEND = 0.3;
  // Pre-arb/arb-eligible players get a much heavier multi-year weighting in
  // directArbCompSalary (arbCompPct/arbHistoryPct, not compPct/projectedPct
  // -- see BATTER_ARB_CONFIG above): real arbitration panels credit
  // sustained track record (and, informally, awards/All-Star recognition
  // this site has no data for), not just the platform season --
  // spot-checking this model against real, documented hearing decisions
  // (e.g. Skubal's 2026 Arb3 win, Guerrero Jr.'s 2024 Arb win) found the
  // single-season anchor undervalued proven, multi-year-elite players by
  // roughly 30-35%.
  const ARB_PROJECTION_BLEND = 0.65;

  // Percentile-point decay scale for comp weighting below: weight =
  // e^(-distance / PROXIMITY_SCALE). Exponential rather than inverse (1/d) --
  // MLB pay is bimodal (lots of cost-controlled arms, a separate cluster of
  // paid aces, not much between), so a slowly-decaying tail lets the much
  // more numerous cheap comps quietly outvote a thin cluster of expensive
  // ones even at long range. Exponential decay keeps the "no hard cutoff"
  // benefit but drops distant comps' influence fast enough that they stop
  // mattering well before that happens.
  const PROXIMITY_SCALE = 8;

  // A player at the extreme edge of a position's performance distribution
  // (e.g. dead last) can have almost no market-priced peers nearby -- the
  // closest "comp" might be 10+ percentile points away. At the default
  // scale, that one comp can end up carrying most of the weight, so the
  // "recommended pay" becomes whatever that single closest player happens to
  // earn, not a real market consensus. MIN_EFFECTIVE_COMPS guards against
  // that: if too few comps are meaningfully contributing, the scale widens
  // until enough real signal is pulled in, capped at PROXIMITY_SCALE_MAX.
  const MIN_EFFECTIVE_COMPS = 5;
  const PROXIMITY_SCALE_GROWTH = 1.4;
  const PROXIMITY_SCALE_MAX = 40;

  // Kish's effective sample size: (sum w)^2 / sum(w^2). Equals the plain
  // count when every weight is equal, and collapses toward 1 when one weight
  // dominates the rest -- a direct measure of "how many comps are actually
  // doing the work," not just how many are technically nonzero.
  function effectiveSampleSize(weights) {
    const sum = weights.reduce((a, w) => a + w, 0);
    const sumSq = weights.reduce((a, w) => a + w * w, 0);
    return sumSq > 0 ? (sum * sum) / sumSq : 0;
  }

  // Weighted median: sort by value, walk the cumulative weight, return the
  // value where it crosses half the total weight. Distance-weighting an
  // average is easy but lets one huge outlier drag the whole result; a
  // weighted median keeps that same outlier-resistance a plain median has,
  // just letting nearby comps count more than far ones instead of counting
  // everyone inside a window equally and everyone outside it not at all.
  function weightedMedian(items, valueKey, weightKey) {
    if (!items.length) return null;
    // NaN weights/values (e.g. from an undefined percentile feeding the
    // exp() distance calc upstream) make every cumulative-weight comparison
    // below false, which used to fall through to "return the max value in
    // the pool" silently -- the same wrong answer for every caller with a
    // broken input, which is exactly the kind of bug that's easy to miss.
    // Fail loud instead.
    if (Number.isNaN(totalOf(items, weightKey))) {
      throw new Error('weightedMedian: NaN weight in input -- check upstream percentile fields');
    }
    const sorted = [...items].sort((a, b) => a[valueKey] - b[valueKey]);
    const totalWeight = sorted.reduce((s, it) => s + it[weightKey], 0);
    let cumulative = 0;
    for (const it of sorted) {
      cumulative += it[weightKey];
      if (cumulative >= totalWeight / 2) return it[valueKey];
    }
    return sorted[sorted.length - 1][valueKey];
  }
  function totalOf(items, key) {
    return items.reduce((s, it) => s + it[key], 0);
  }

  function median(arr) {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Proximity-weighted median with an adaptively widening scale: starts at
  // PROXIMITY_SCALE (tightened near the extreme top/bottom of the
  // distribution -- see edgeFactor below) and widens (by
  // PROXIMITY_SCALE_GROWTH each step) until the effective sample size
  // clears MIN_EFFECTIVE_COMPS or the scale hits PROXIMITY_SCALE_MAX,
  // whichever comes first.
  //
  // A fixed scale=8 treats "90th percentile" and "100th percentile" as
  // near-neighbors, which is fine in the dense middle of a distribution but
  // dilutes a genuine outlier at the edge: real peers get rarer the closer
  // you get to 0 or 100, but the pool of "somewhat close" comps (10-15
  // points off) usually gets bigger, not smaller, and at a gentle decay
  // those numerous not-quite-peers can numerically outvote the handful of
  // true peers. edgeFactor tightens the starting scale as anchorPct
  // approaches either edge (down to half-width right at 0/100) so an
  // outlier's median leans on its closest real comps first; the widening
  // loop below still kicks in exactly as before if that tighter kernel
  // doesn't find enough of them, so a genuinely thin edge still gets
  // rescued rather than starved.
  function adaptiveCompMedian(pool, anchorPct, valueKey, pctKey = 'compPct') {
    const edgeDistance = Math.min(anchorPct, 100 - anchorPct);
    const edgeFactor = 0.5 + 0.5 * Math.min(1, edgeDistance / 50);
    let scale = PROXIMITY_SCALE * edgeFactor;
    let weights;
    while (true) {
      weights = pool.map(m => Math.exp(-Math.abs(m[pctKey] - anchorPct) / scale));
      if (effectiveSampleSize(weights) >= MIN_EFFECTIVE_COMPS || scale >= PROXIMITY_SCALE_MAX) break;
      scale *= PROXIMITY_SCALE_GROWTH;
    }
    const items = pool.map((m, i) => ({ value: m[valueKey], weight: weights[i] }));
    return weightedMedian(items, 'value', 'weight');
  }

  // Same proximity-weighted machinery as adaptiveCompMedian, but for the
  // extreme tail (top/bottom EXTREME_TAIL_EDGE% of the distribution) swaps
  // the weighted median for a weighted mean of just the half of the
  // weighted distribution on the anchor's side of the median crossing. A
  // weighted median is the right call everywhere else -- it keeps one
  // outlier comp from dragging a typical player's number around -- but at
  // the very top (or bottom) of the pool that same outlier-resistance
  // becomes the problem: a real ace whose price is stale (an extension
  // signed years before a late-career leap, a legacy deal from a different
  // market) sits closer in raw percentile than anyone else once you're this
  // far out on the tail, so it can pull the single largest weight in the
  // whole pool -- and because it's also priced at the bottom of the range,
  // it can single-handedly set the median before the calculation ever
  // reaches the genuinely comparable elite comps priced above it. Past this
  // point the handful of real peers on the correct side of the anchor are
  // the only informative signal left, so lean on them directly instead of
  // letting one stale outlier veto them. Identical to adaptiveCompMedian
  // for every anchor outside the tail.
  const EXTREME_TAIL_EDGE = 3;
  function adaptiveCompExtremeMean(pool, anchorPct, valueKey, pctKey = 'compPct') {
    const edgeDistance = Math.min(anchorPct, 100 - anchorPct);
    const edgeFactor = 0.5 + 0.5 * Math.min(1, edgeDistance / 50);
    let scale = PROXIMITY_SCALE * edgeFactor;
    let weights;
    while (true) {
      weights = pool.map(m => Math.exp(-Math.abs(m[pctKey] - anchorPct) / scale));
      if (effectiveSampleSize(weights) >= MIN_EFFECTIVE_COMPS || scale >= PROXIMITY_SCALE_MAX) break;
      scale *= PROXIMITY_SCALE_GROWTH;
    }
    const items = pool.map((m, i) => ({ value: m[valueKey], weight: weights[i] }));
    if (edgeDistance > EXTREME_TAIL_EDGE) {
      return weightedMedian(items, 'value', 'weight');
    }
    const sorted = [...items].sort((a, b) => a.value - b.value);
    const totalWeight = totalOf(sorted, 'weight');
    let cumulative = 0;
    let crossingIndex = sorted.length - 1;
    for (let i = 0; i < sorted.length; i++) {
      cumulative += sorted[i].weight;
      if (cumulative >= totalWeight / 2) { crossingIndex = i; break; }
    }
    const side = anchorPct >= 50 ? sorted.slice(crossingIndex) : sorted.slice(0, crossingIndex + 1);
    const sideWeight = totalOf(side, 'weight');
    return side.reduce((s, it) => s + it.weight * it.value, 0) / sideWeight;
  }

  // Direct peer-comp system for pre-arb/arb-eligible pay, replacing the
  // earlier "open-market value x 40/60/80%" approach. That approach inferred
  // a real dollar figure from the free-agent market, which is a structurally
  // different, selection-biased population (teams only sign real contracts
  // for players they've already decided are worth it) -- at nearly the same
  // average performance percentile, free-agent/extension players earn ~3.6x
  // what arb-eligible players do in this dataset, a gap the CBA discount
  // alone doesn't explain. This instead comps a player directly against
  // OTHER real arb-eligible players' actual settled pay (from the MLBTR
  // scrape), which is the right population by construction. Comps at a
  // different tier get their AAV rescaled by the ratio of CBA percentage
  // bands (targetTier / compTier) before the median -- e.g. a 40%-tier
  // comp's pay, viewed from an 80%-tier target, is doubled, since both are
  // meant to derive from the same underlying open-market baseline by the
  // CBA's own design. Performance matching still happens on compPct/
  // projectedPct exactly as elsewhere, so this only changes which real
  // dollars get pulled in and how they're scaled, not how "similar
  // performance" is judged.
  // Real arbitration panels weigh "special accomplishments" -- MVP/Cy Young/
  // Rookie of the Year/All-Star/Silver Slugger/Gold Glove -- as an explicit
  // CBA criterion on top of the stat line, not something a pure stat-line
  // comp can ever capture. awards (from mlb_awards.py, real MLB Stats API
  // data) is recency-weighted (a 3-year-old ROY still counts, just less than
  // a fresh one) and capped at 15 percentile points so awards alone can't
  // swing a case the way real performance does -- this only nudges a
  // comp built on real stats, it doesn't replace it.
  const AWARD_WEIGHTS = {
    ALMVP: 5, NLMVP: 5,
    ALCY: 5, NLCY: 5,
    ALROY: 3, NLROY: 3,
    ALSS: 2, NLSS: 2,
    ALGG: 1.5, NLGG: 1.5,
    ALAS: 1.5, NLAS: 1.5,
  };
  const ACCOMPLISHMENTS_CAP = 15;
  function accomplishmentsCredit(p) {
    const credit = (p.awards || []).reduce((sum, a) => {
      const weight = AWARD_WEIGHTS[a.awardId] || 0;
      const yearsAgo = Math.max(0, CURRENT_SEASON - a.season);
      return sum + weight * Math.pow(0.75, yearsAgo);
    }, 0);
    return Math.min(ACCOMPLISHMENTS_CAP, credit * 3);
  }
  const AWARD_LABELS = {
    ALMVP: 'AL MVP', NLMVP: 'NL MVP',
    ALCY: 'AL Cy Young', NLCY: 'NL Cy Young',
    ALROY: 'AL Rookie of the Year', NLROY: 'NL Rookie of the Year',
    ALSS: 'AL Silver Slugger', NLSS: 'NL Silver Slugger',
    ALGG: 'AL Gold Glove', NLGG: 'NL Gold Glove',
    ALAS: 'AL All-Star', NLAS: 'NL All-Star',
  };
  function accomplishmentsNote(p) {
    const credit = accomplishmentsCredit(p);
    if (credit <= 0) return '';
    const list = (p.awards || [])
      .slice().sort((a, b) => b.season - a.season)
      .map(a => `${a.season} ${AWARD_LABELS[a.awardId] || a.awardId}`)
      .join(', ');
    return ` Includes a +${credit.toFixed(1)}-percentile accomplishments credit (${list}).`;
  }

  // Real CBA rule: a team's offer to an arb-eligible player can't be cut
  // more than 20% below what they made the season before, or more than 30%
  // below what they made two seasons before that -- a hard salary floor,
  // not a comp-based estimate. actualSalaryPaidIn/arbCutFloor only use real
  // paid figures (this season's aav, or a resolved arb_outcomes settlement
  // from arbSalaryHistory) and return null rather than guess when a prior
  // season's real pay isn't known.
  function actualSalaryPaidIn(p, yr) {
    if (yr === CURRENT_SEASON) return p.aav;
    return p.arbSalaryHistory ? p.arbSalaryHistory[String(yr)] : undefined;
  }
  function arbCutFloor(p, forSeason) {
    const prevSalary = actualSalaryPaidIn(p, forSeason - 1);
    const prevPrevSalary = actualSalaryPaidIn(p, forSeason - 2);
    const floors = [];
    if (prevSalary != null) floors.push(0.80 * prevSalary);
    if (prevPrevSalary != null) floors.push(0.70 * prevPrevSalary);
    return floors.length > 0 ? Math.max(...floors) : null;
  }

  function directArbCompSalary(target, pool, targetTier, anchorPctOverride) {
    const blend = ARB_PROJECTION_BLEND;
    // Arb-eligible players' "track record" component is the 2 seasons
    // before their real platform season (arbTrackPct); pre-arb players
    // (no decided salary yet, no platform season) fall back to the
    // in-progress-season-anchored arbHistoryPct. See arbMatchPct/
    // arbPlatformPct above for why these diverge. anchorPctOverride skips
    // all of this -- used for next-season projections, where the anchor
    // needs to be this in-progress season (soon to be the real platform
    // year), not the already-decided platform season this logic assumes.
    let anchorPct = anchorPctOverride;
    if (anchorPct == null) {
      const trackPct = isArbEligible(target) ? target.arbTrackPct : target.arbHistoryPct;
      anchorPct = trackPct != null
        ? (1 - blend) * target.arbMatchPct + blend * trackPct
        : target.arbMatchPct;
    }
    anchorPct = Math.min(100, anchorPct + accomplishmentsCredit(target));
    const compPool = pool
      .filter(m => m !== target && m.aav != null)
      .map(m => ({ ...m, tierNormAav: m.aav * (targetTier / arbServicePercent(m)) }));
    if (compPool.length === 0) return null;
    return adaptiveCompMedian(compPool, anchorPct, 'tierNormAav', 'arbMatchPct');
  }

  function recomputeAll() {
    allPlayers.forEach(p => {
      const cfg = p.isBatter ? BATTER_STAT_CONFIG : PITCHER_STAT_CONFIG;
      const w = p.isBatter ? battingWeights : pitchingWeights;
      const posStats = positionStats[p.position] || {};
      // Expected bWAR (the Predicted Score's performance half): volume x
      // (intercept + position/role baseline + sum of weight x oriented z).
      // predZ is standardized server-side against the same population the
      // model was trained on (expected_war.py); a stat the player is missing
      // simply contributes 0 = league average, as in training.
      let baseWar = 0;
      let expected = 0;
      let breakdown;
      if (EW_AVAILABLE) {
        const m = p.isBatter ? EW_MODEL.batter : EW_MODEL.pitcher;
        const offset = p.isBatter ? (m.offsets[p.position] || 0) : (p.position === 'RP' ? (m.offsets.RP || 0) : 0);
        baseWar = (m.intercept + offset) * p.volume;
        expected = baseWar;
        breakdown = cfg.map(s => {
          const z = p.predZ[s.key] != null ? p.predZ[s.key] : null;
          const contribution = z != null ? z * w[s.key] * p.volume : 0;
          expected += contribution;
          return { ...s, value: p.stats[s.key], z, contribution };
        });
      } else {
        expected = p.stats.bwar != null ? p.stats.bwar : 0;
        breakdown = cfg.map(s => ({ ...s, value: p.stats[s.key], z: null, contribution: 0 }));
      }
      p.expectedWar = expected;
      p.baseWar = baseWar;
      p.breakdown = breakdown;

      // Traditional-stat composite (see BATTER_ARB_CONFIG/PITCHER_ARB_CONFIG
      // above), ranked into arbCompPct below. Computed for every player, not
      // just arb-eligible ones, so arb-eligible players have real peers (at
      // any pay status) to compute a percentile against.
      const arbCfg = p.isBatter ? BATTER_ARB_CONFIG : PITCHER_ARB_CONFIG;
      let arbTotal = 0;
      arbCfg.forEach(s => {
        const val = p.stats[s.key];
        const ps = posStats[s.key];
        if (val != null && ps && ps.std > 0) {
          const rawZ = (val - ps.mean) / ps.std;
          const z = s.higherBetter ? rawZ : -rawZ;
          arbTotal += z * s.defaultWeight;
        }
      });
      p.rawArbScore = arbTotal;

      // Multi-year track record on the same traditional stats, from the
      // player's own last 3 qualifying seasons (most recent first, per
      // build_dashboard.py), weighted 3/2/1 -- mirrors Marcel's recency
      // weighting without needing a whole separate projection system, and
      // keeps the "sustained performance" signal on the same real-
      // arbitration-relevant stats as arbCompPct instead of switching back
      // to advanced metrics for the multi-year half.
      const arbHistEntries = (p.history || []).slice(0, 3);
      const arbHistWeights = [3, 2, 1];
      let arbHistTotal = 0, arbHistWeightSum = 0;
      arbHistEntries.forEach((entry, i) => {
        const grade = computeHistoricalArbGrade(entry, p.isBatter);
        if (grade != null) {
          arbHistTotal += grade * arbHistWeights[i];
          arbHistWeightSum += arbHistWeights[i];
        }
      });
      p.arbHistoryPct = arbHistWeightSum > 0 ? arbHistTotal / arbHistWeightSum : null;

      // Currently arb-eligible players already have a real, settled salary
      // -- one that was decided *before* this season started, off the prior
      // completed ("platform") season, not off whatever they're doing right
      // now. Anchoring their expected-value comp on in-progress current-
      // season stats compares a real decision to a season that had nothing
      // to do with making it (a player hurt or off to a slow start this
      // year still got paid for a strong prior year). history[0] is their
      // most recent completed qualifying season -- the real platform season
      // -- with history[1]/[2] as the track record leading into it. Pre-arb
      // players don't have a decided salary yet: they're projecting an
      // *upcoming* case, so their in-progress current season (arbCompPct/
      // arbHistoryPct above) is the right, forward-looking anchor.
      if (isArbEligible(p) && p.history && p.history[0]) {
        p.arbPlatformPct = computeHistoricalArbGrade(p.history[0], p.isBatter);
        const trackEntries = p.history.slice(1, 3);
        const trackWeights = [2, 1];
        let trackTotal = 0, trackWeightSum = 0;
        trackEntries.forEach((entry, i) => {
          const grade = computeHistoricalArbGrade(entry, p.isBatter);
          if (grade != null) {
            trackTotal += grade * trackWeights[i];
            trackWeightSum += trackWeights[i];
          }
        });
        p.arbTrackPct = trackWeightSum > 0 ? trackTotal / trackWeightSum : null;
      } else {
        p.arbPlatformPct = null;
        p.arbTrackPct = null;
      }
    });

    const byPos = {};
    allPlayers.forEach(p => { (byPos[p.position] = byPos[p.position] || []).push(p); });

    // Performance (bWAR) is ranked in three pools -- all hitters together, SP,
    // RP -- NOT within each position: bWAR already carries its own position
    // adjustment, and no playing-time floor beyond the dashboard's own
    // qualifying bar (a player who missed time simply produced less).
    // Ties share their average rank. The same pools rank expected bWAR so the
    // two percentiles are directly comparable. Salary percentile (salPct,
    // below) deliberately stays within exact position.
    const poolFor = p => (p.isBatter ? 'batter' : p.position);
    const perfPools = {};
    allPlayers.forEach(p => { (perfPools[poolFor(p)] = perfPools[poolFor(p)] || []).push(p); });
    function rankInto(group, valueOf, key) {
      const sorted = [...group].sort((a, b) => valueOf(a) - valueOf(b));
      let i = 0;
      while (i < sorted.length) {
        let j = i;
        while (j + 1 < sorted.length && valueOf(sorted[j + 1]) === valueOf(sorted[i])) j++;
        const pct = sorted.length > 1 ? (((i + j) / 2) / (sorted.length - 1)) * 100 : 100;
        for (let k = i; k <= j; k++) sorted[k][key] = pct;
        i = j + 1;
      }
    }
    Object.values(perfPools).forEach(group => {
      rankInto(group, p => (p.stats.bwar != null ? p.stats.bwar : 0), 'compPct');
      rankInto(group, p => p.expectedWar, 'expectedPct');
      group.forEach(p => {
        p.grade = gradeFor(p.compPct);
        p.warGap = (p.stats.bwar != null ? p.stats.bwar : 0) - p.expectedWar;
      });
    });

    Object.values(byPos).forEach(group => {
      const byArbRaw = [...group].sort((a, b) => a.rawArbScore - b.rawArbScore);
      byArbRaw.forEach((p, i) => {
        p.arbCompPct = byArbRaw.length > 1 ? (i / (byArbRaw.length - 1)) * 100 : 100;
        // What arb-comp matching (both the anchor and the pool-matching key)
        // should actually use: the platform-season percentile when one
        // exists for an arb-eligible player, current-season otherwise. Must
        // run after arbCompPct (just above) is actually set -- this used to
        // live in the earlier per-player loop, before arbCompPct existed
        // yet, silently leaving every pre-arb player's arbMatchPct
        // undefined. That NaN'd every weight in adaptiveCompMedian, which
        // made weightedMedian's cumulative-weight comparison always false
        // and fall through to returning the single richest comp in the
        // whole pool -- identically, for every affected player, regardless
        // of their own anchor.
        p.arbMatchPct = p.arbPlatformPct != null ? p.arbPlatformPct : p.arbCompPct;
      });
    });

    // League-wide (cross-position) pools of *actually* market-priced players
    // (Free Agent / Extension only -- arb-eligible/pre-arb pay is CBA-
    // suppressed, so letting it feed the comp pool would circularly drag
    // "open market value" down for everyone) used below for dollar-comp
    // matching. Splitting this strictly by position starved thin positions
    // (as few as 8 true comps at some spots) of real market data, which let
    // the adaptive widening below reach for a handful of expensive outliers
    // and badly overshoot low-percentile players there. compPct above is now
    // ranked in the hitter/SP/RP performance pools and drives Score/grade --
    // this only widens which players are eligible to be pulled in as a dollar
    // comp. Tradeoff worth flagging: this assumes comparable pay scales
    // across positions at the same percentile rank, which isn't strictly
    // true in the real market (a 90th-percentile-for-position closer isn't
    // paid like a 90th-percentile starter) -- treat recommendedSalary as
    // directional, not exact, especially when comparing very different
    // position groups.
    // Pitchers split SP/RP rather than pooled as one "pitcher" bucket --
    // unlike the modest pay gaps between batting positions, starters and
    // relievers are genuinely different pay markets (an elite closer's
    // small-sample rate stats can rank alongside an elite ace's on compPct
    // while paying a fraction as much), so merging them let elite-percentile
    // relievers drag down comp values for elite starters and vice versa.
    const leagueTrueMarket = {
      batter: allPlayers.filter(p => p.isBatter && !p.isPreArb && !isArbEligible(p)),
      SP: allPlayers.filter(p => p.position === 'SP' && !p.isPreArb && !isArbEligible(p)),
      RP: allPlayers.filter(p => p.position === 'RP' && !p.isPreArb && !isArbEligible(p)),
    };
    // Real arb-eligible peers (same batter/SP/RP split), used by
    // directArbCompSalary for both pre-arb and arb-eligible pay -- see that
    // function for why this replaced deriving off the free-agent curve.
    const arbEligiblePool = {
      batter: allPlayers.filter(p => p.isBatter && isArbEligible(p)),
      SP: allPlayers.filter(p => p.position === 'SP' && isArbEligible(p)),
      RP: allPlayers.filter(p => p.position === 'RP' && isArbEligible(p)),
    };

    // Fold in real historical arb settlements (see backfill_arb_outcomes.py --
    // 552 real outcomes across platform seasons 2022-2025, on top of the
    // ~150-player current season) so the comp pool isn't limited to one
    // season. Inflation is derived empirically from this same data rather
    // than an external salary index: tier-normalize every record (current
    // and historical) to the 80% band, take the median per season, and
    // scale each historical season to 2026's median. Historical members are
    // shaped to look like regular pool players (aav, serviceYears) so they
    // flow through directArbCompSalary/adaptiveCompMedian unchanged.
    const TIER_REF = 0.80;
    const currentTier80 = allPlayers
      .filter(p => isArbEligible(p) && p.aav != null)
      .map(p => p.aav * (TIER_REF / arbServicePercent(p)));
    const current80Median = median(currentTier80);
    const bySeasonTier80 = {};
    historicalArbOutcomes.forEach(r => {
      if (r.actualSalary == null || r.serviceTime == null) return;
      const norm = r.actualSalary * (TIER_REF / tierFromServiceYears(r.serviceTime));
      (bySeasonTier80[r.season] = bySeasonTier80[r.season] || []).push(norm);
    });
    const inflationFactor = {};
    Object.keys(bySeasonTier80).forEach(season => {
      const seasonMedian = median(bySeasonTier80[season]);
      inflationFactor[season] = (current80Median && seasonMedian) ? current80Median / seasonMedian : 1.0;
    });

    historicalArbOutcomes.forEach(r => {
      if (r.actualSalary == null || r.serviceTime == null) return;
      const arbPct = computeHistoricalArbGrade(r, r.isBatter);
      if (arbPct == null) return;
      const bucket = r.isBatter ? 'batter' : r.position;
      if (!arbEligiblePool[bucket]) return;
      arbEligiblePool[bucket].push({
        arbMatchPct: arbPct,
        serviceYears: r.serviceTime,
        aav: r.actualSalary * (inflationFactor[r.season] || 1.0),
      });
    });

    // Real year-over-year raise %, matched by performance -- built by pairing
    // the same historicalArbOutcomes records across consecutive platform
    // seasons for the same player (2016-2025 excl. 2020; see
    // backfill_arb_outcomes.py). projectedArbSalary applies this directly to
    // a player's own actual current pay instead of comping dollar figures
    // across years: "a similar player got X% more" sidesteps guessing at
    // cross-year inflation entirely, since both sides of that fraction are
    // already in that specific player's own real dollars.
    const outcomesByPlayer = {};
    historicalArbOutcomes.forEach(r => {
      if (r.actualSalary == null) return;
      (outcomesByPlayer[r.playerId] = outcomesByPlayer[r.playerId] || []).push(r);
    });
    const raisePairsByBucket = { batter: [], SP: [], RP: [] };
    Object.values(outcomesByPlayer).forEach(records => {
      const bySeasonNum = {};
      records.forEach(r => { bySeasonNum[r.season] = r; });
      records.forEach(r => {
        const next = bySeasonNum[r.season + 1];
        if (!next) return;
        const arbPct = computeHistoricalArbGrade(r, r.isBatter);
        if (arbPct == null) return;
        const bucket = r.isBatter ? 'batter' : r.position;
        if (!raisePairsByBucket[bucket]) return;
        raisePairsByBucket[bucket].push({
          arbMatchPct: arbPct,
          raisePct: (next.actualSalary - r.actualSalary) / r.actualSalary,
        });
      });
    });

    Object.values(byPos).forEach(group => {
      const marketGroup = group.filter(p => !p.isPreArb);
      const bySalary = [...marketGroup].sort((a, b) => a.aav - b.aav);
      bySalary.forEach((p, i) => {
        p.salPct = bySalary.length > 1 ? (i / (bySalary.length - 1)) * 100 : 100;
        p.score = p.compPct - payWeight * p.salPct;
        p.predictedScore = p.expectedPct - payWeight * p.salPct;
        p.teamScore = p.score;
      });

      // Rank players by their blended (Marcel + comparable-player) projected
      // true-talent value (xwoba for batters, xera for pitchers) wherever a
      // projection exists, so the pre-arb salary anchor below can lean on
      // multi-year, sample-size-, age-, and peer-outcome-adjusted history
      // instead of only this season's small sample.
      const isBatterGroup = group[0] && group[0].isBatter;
      const projKey = isBatterGroup ? 'xwoba' : 'xera';
      const higherBetterProj = isBatterGroup;
      const withProj = group.filter(p => p.projected && p.projected[projKey] != null);
      const byProj = [...withProj].sort((a, b) => higherBetterProj
        ? a.projected[projKey] - b.projected[projKey]
        : b.projected[projKey] - a.projected[projKey]);
      byProj.forEach((p, i) => {
        p.projectedPct = byProj.length > 1 ? (i / (byProj.length - 1)) * 100 : 100;
      });

      // Pre-arbitration players are paid at/near the league minimum by CBA
      // rule, not by the market, so there's no meaningful salary percentile
      // to blend in -- their score is just their performance percentile.
      group.filter(p => p.isPreArb).forEach(p => {
        p.salPct = null;
        p.score = p.compPct;
        p.predictedScore = p.expectedPct;
        // Team/rotation/bullpen scores include pre-arb players too (they hit
        // and pitch), but their displayed Score skips the pay adjustment and
        // would sit on a different scale. teamScore applies the SAME formula
        // using where their near-minimum salary would slot among market
        // salaries at the position. For market players teamScore === score.
        const cheaper = bySalary.filter(m => m.aav < p.aav).length;
        const same = bySalary.filter(m => m.aav === p.aav).length;
        const impliedSalPct = bySalary.length ? ((cheaper + same / 2) / bySalary.length) * 100 : 0;
        p.teamScore = p.compPct - payWeight * impliedSalPct;
      });

      // Recommended pay: what a player's performance level says they're
      // worth, in dollars -- the median AAV of market-priced peers performing
      // at a similar level. Computed for every player (market and pre-arb
      // alike), not just rookies, so it doubles as a plain-dollar complement
      // to Score for market players too ("performs like $30M, paid $8M").
      group.forEach(p => {
        const pool = leagueTrueMarket[poolFor(p)];
        if (pool.length === 0) { p.recommendedSalary = null; p.paySurplus = null; return; }
        // Blend in the multi-year projection (when available) so the number
        // isn't purely a bet on one season's small sample. Pre-arb/arb-
        // eligible players lean on it much more heavily -- see ARB_PROJECTION_BLEND.
        const blend = (p.isPreArb || isArbEligible(p)) ? ARB_PROJECTION_BLEND : PROJECTION_BLEND;
        const anchorPct = p.projectedPct != null
          ? (1 - blend) * p.compPct + blend * p.projectedPct
          : p.compPct;
        const compPool = pool.filter(m => m !== p);
        if (compPool.length === 0) { p.recommendedSalary = null; p.paySurplus = null; return; }
        const median = adaptiveCompMedian(compPool, anchorPct, 'aav');
        p.recommendedSalary = median;
        p.paySurplus = median - p.aav;

        // Forward-looking market value: what this player's future
        // performance says they'd be worth on the open market. Used to
        // anchor entirely on projectedPct with zero weight on this season's
        // real output -- which meant a player having a genuinely bad
        // platform year (the exact season real free-agent-market teams
        // would weigh most heavily) still got valued purely off a 3-year
        // trailing projection that predates the season and has no idea
        // it's happening. PROJECTED_MARKET_VALUE_BLEND keeps this mostly
        // forward-looking (more so than recommendedSalary's PROJECTION_BLEND/
        // ARB_PROJECTION_BLEND above, which anchor a "what should they be
        // paid right now" number, not a future one) while still letting a
        // real current-season swing move it, instead of ignoring it outright.
        const PROJECTED_MARKET_VALUE_BLEND = 0.7;
        p.projectedMarketValue = p.projectedPct != null
          ? adaptiveCompExtremeMean(
              compPool,
              (1 - PROJECTED_MARKET_VALUE_BLEND) * p.compPct + PROJECTED_MARKET_VALUE_BLEND * p.projectedPct,
              'aav'
            )
          : null;
      });

      // Pre-arb and arb-eligible players' pay is compped directly against
      // real arb-eligible peers' actual settled pay (see
      // directArbCompSalary) -- not derived from the open-market
      // recommendedSalary above, which comes from a structurally different,
      // higher-paid population. Pre-arb players are projected to their
      // eventual Arb-1 number (tier-normalized to 40%); currently arb-
      // eligible players get an expected-value figure at their own real
      // tier to compare against what they're actually being paid.
      group.filter(p => p.isPreArb).forEach(p => {
        const pool = arbEligiblePool[poolFor(p)];
        p.projectedSalary = directArbCompSalary(p, pool, 0.40);
        p.surplus = p.projectedSalary != null ? p.projectedSalary - p.aav : null;
      });
      group.filter(isArbEligible).forEach(p => {
        const pool = arbEligiblePool[poolFor(p)];
        const compBased = directArbCompSalary(p, pool, arbServicePercent(p));
        const floor = arbCutFloor(p, CURRENT_SEASON);
        p.expectedArbSalary = (floor != null && (compBased == null || floor > compBased)) ? floor : compBased;
        p.expectedArbFloored = floor != null && (compBased == null || floor > compBased);
        p.arbSurplus = p.expectedArbSalary != null ? p.expectedArbSalary - p.aav : null;
      });

      // Next season's arbitration-process estimate for anyone still under
      // team control: same real arb-eligible comp pool as expectedArbSalary/
      // projectedSalary above, just tier-advanced one service year. This is
      // what the "Next-Season Outlook" card section shows for team-controlled
      // players -- the open-market projectedMarketValue below is what a
      // player isn't actually eligible to be paid yet, and real arbitration
      // panels look at demonstrated performance/track record, not a
      // projected future stat line.
      //
      // Crucially, this can't reuse expectedArbSalary's arbMatchPct/
      // arbTrackPct anchor: that anchor is deliberately pinned to the
      // *already-decided* platform season (last year), since that's what a
      // real panel actually used to set this year's pay. But THIS season is
      // what becomes next year's real platform season -- so a hot in-progress
      // year needs to show up here even though it can't move expectedArbSalary.
      // arbCompPct (this season's traditional-stat percentile, computed for
      // every player) blended with arbHistoryPct (recent track record) is
      // exactly that forward-looking anchor -- the same one pre-arb players'
      // projectedSalary already uses, just applied here regardless of current
      // arb-eligibility status.
      group.filter(p => p.isPreArb || isArbEligible(p)).forEach(p => {
        const pool = arbEligiblePool[poolFor(p)];
        const nextTier = tierFromServiceYears((p.serviceYears != null ? p.serviceYears : 0) + 1);
        const blend = ARB_PROJECTION_BLEND;
        const forwardAnchor = p.arbHistoryPct != null
          ? (1 - blend) * p.arbCompPct + blend * p.arbHistoryPct
          : p.arbCompPct;
        const dollarCompBased = directArbCompSalary(p, pool, nextTier, forwardAnchor);

        // For anyone already on a real arb salary, prefer a performance-
        // matched raise % (from raisePairsByBucket above) applied to their
        // OWN actual pay, over comping dollar figures across tiers/years:
        // both sides of a raise fraction are already in this specific
        // player's own real dollars, so it sidesteps guessing at cross-year
        // inflation the way the dollar comp has to. Pre-arb players have no
        // real prior arb salary to apply a raise to, so they stay on the
        // dollar comp. Falls back to the dollar comp if the bucket's raise
        // pool is somehow empty.
        let compBased = dollarCompBased;
        let raisePctUsed = null;
        if (isArbEligible(p)) {
          const raisePool = raisePairsByBucket[poolFor(p)];
          raisePctUsed = raisePool.length > 0
            ? adaptiveCompMedian(raisePool, forwardAnchor, 'raisePct', 'arbMatchPct')
            : null;
          if (raisePctUsed != null) compBased = p.aav * (1 + raisePctUsed);
        }
        p.projectedArbRaisePct = raisePctUsed;

        // Two floors against NEXT season: the legal one (80% of this year's
        // real aav, 70% of last year's real settlement), and the empirical
        // one (ARB_RAISE_FLOOR_PCT -- what a real returning arb player
        // almost always gets at minimum, well above the bare legal cut
        // limit). Only the empirical floor applies to currently arb-eligible
        // players specifically -- it was measured on real arb-to-arb
        // transitions, not pre-arb-to-Arb1 ones. Track which floor actually
        // won so the card note is accurate about why.
        const legalFloor = arbCutFloor(p, CURRENT_SEASON + 1);
        const empiricalFloor = isArbEligible(p) ? p.aav * (1 + ARB_RAISE_FLOOR_PCT) : null;
        const floorCandidates = [legalFloor, empiricalFloor].filter(f => f != null);
        const floor = floorCandidates.length > 0 ? Math.max(...floorCandidates) : null;
        p.projectedArbSalary = (floor != null && (compBased == null || floor > compBased)) ? floor : compBased;
        p.projectedArbFloored = floor != null && (compBased == null || floor > compBased);
        p.projectedArbFloorIsEmpirical = p.projectedArbFloored
          && empiricalFloor != null && empiricalFloor >= (legalFloor == null ? -Infinity : legalFloor);
      });
    });

    // Team scores use the people who actually played, not just market-priced
    // regulars: every hitter in the scoring pool, the 5 SP with the most IP,
    // and the 13 RP with the most IP -- an 18-arm staff. Pre-arb players
    // count (see teamScore above).
    //
    // Within each group, a player's pull on the average is proportional to
    // the playing time they actually gave: weight = min(workload / full-season
    // workload, 1) -- PA for hitters, IP for pitchers. Capped at 1 so a
    // 700-PA season doesn't count 40% more than a 500-PA one. Groups are
    // combined at 55% lineup / 28% rotation / 17% bullpen, roughly where
    // positive bWAR comes from, instead of by headcount.
    const TEAM_SP_SLOTS = 5, TEAM_RP_SLOTS = 13;
    const FULL_SEASON = { PA: 600, SP: 180, RP: 65 };
    const TEAM_GROUP_WEIGHTS = { lineup: 0.55, rotation: 0.28, bullpen: 0.17 };
    function teamWeight(p) {
      const full = p.isBatter ? FULL_SEASON.PA : FULL_SEASON[p.position];
      const work = p.isBatter ? p.volume * FULL_SEASON.PA : (p.stats.ip || 0);
      return Math.min(work / full, 1);
    }
    allPlayers.forEach(p => { p.teamWeight = teamWeight(p); });
    const weightedTeamScore = arr => {
      const w = arr.reduce((a, p) => a + p.teamWeight, 0);
      return w > 0 ? arr.reduce((a, p) => a + p.teamWeight * p.teamScore, 0) / w : null;
    };
    teams.forEach(t => {
      const onTeam = allPlayers.filter(p => p.team === t.abbr);
      const byIp = pos => onTeam.filter(p => p.position === pos).sort((a, b) => (b.stats.ip || 0) - (a.stats.ip || 0));
      t.lineup = onTeam.filter(p => p.isBatter);
      t.rotation = byIp('SP').slice(0, TEAM_SP_SLOTS);
      t.bullpen = byIp('RP').slice(0, TEAM_RP_SLOTS);
      t.lineupScore = weightedTeamScore(t.lineup);
      t.rotationScore = weightedTeamScore(t.rotation);
      t.bullpenScore = weightedTeamScore(t.bullpen);
      const parts = [['lineup', t.lineupScore], ['rotation', t.rotationScore], ['bullpen', t.bullpenScore]]
        .filter(([, v]) => v != null);
      const wSum = parts.reduce((a, [k]) => a + TEAM_GROUP_WEIGHTS[k], 0);
      t.avgScore = wSum > 0 ? parts.reduce((a, [k, v]) => a + TEAM_GROUP_WEIGHTS[k] * v, 0) / wSum : 0;
      t.lineupScore = t.lineupScore == null ? 0 : t.lineupScore;
      t.rotationScore = t.rotationScore == null ? 0 : t.rotationScore;
      t.bullpenScore = t.bullpenScore == null ? 0 : t.bullpenScore;
    });
  }


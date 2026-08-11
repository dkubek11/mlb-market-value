// Headless-browser validation of the built dashboard. Loads the real,
// spliced dashboard_final.html in Chromium (exercising the exact same
// client-side computation the live site runs -- recomputeAll, the arb comp
// system, card rendering) and checks for the failure modes that actually
// happened during this project's development: a broken loop order silently
// NaN-ing every weight and collapsing every player onto the richest comp
// pool member, a comp pool sparse enough to produce a projection below the
// legal floor, a card that throws when a field is missing, etc. Every check
// here corresponds to something that was previously only caught by manually
// opening a browser and inspecting allPlayers by hand.
//
// Usage: node validate_dashboard.js [path/to/dashboard_final.html]
// Exits non-zero if any check fails.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const dashboardPath = path.resolve(
  process.argv[2] || path.join(__dirname, '../../frontend/dashboard/dashboard_final.html')
);

if (!fs.existsSync(dashboardPath)) {
  console.error(`Dashboard file not found: ${dashboardPath}`);
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const fileUrl = 'file:///' + dashboardPath.replace(/\\/g, '/');
  await page.goto(fileUrl);

  const checks = await page.evaluate(() => {
    const out = [];
    const check = (name, pass, detail) => out.push({ name, pass, detail });

    const moneyFields = [
      'recommendedSalary', 'projectedMarketValue', 'expectedArbSalary',
      'projectedArbSalary', 'projectedSalary',
    ];
    moneyFields.forEach((field) => {
      const vals = allPlayers.map((p) => p[field]).filter((v) => v != null);
      const nanCount = vals.filter((v) => Number.isNaN(v)).length;
      check(`no NaN in ${field}`, nanCount === 0, `${nanCount} NaN of ${vals.length} values`);
    });

    const arbEligibleNotFA = allPlayers.filter(
      (p) => isArbEligible(p) && !isNearingFreeAgency(p) && p.projectedArbSalary != null
    );
    const cuts = arbEligibleNotFA.filter((p) => p.projectedArbSalary < p.aav);
    check(
      'no projected pay cuts for returning arb players',
      cuts.length === 0,
      `${cuts.length} of ${arbEligibleNotFA.length}` +
        (cuts.length ? `: ${cuts.slice(0, 5).map((p) => p.name).join(', ')}` : '')
    );

    const totalPlayers = allPlayers.length;
    const withRecPay = allPlayers.filter((p) => p.recommendedSalary != null).length;
    check(
      'recommendedSalary coverage >= 90%',
      totalPlayers > 0 && withRecPay / totalPlayers >= 0.9,
      `${withRecPay}/${totalPlayers}`
    );

    const preArb = allPlayers.filter((p) => p.isPreArb && p.projectedSalary != null);
    const byValue = {};
    preArb.forEach((p) => {
      const key = p.projectedSalary.toFixed(2);
      (byValue[key] = byValue[key] || []).push(p.name);
    });
    const biggestCluster = Math.max(0, ...Object.values(byValue).map((v) => v.length));
    check(
      'no runaway duplicate-value cluster among pre-arb players',
      biggestCluster <= 20,
      `biggest cluster: ${biggestCluster} players sharing one value`
    );

    const withServiceTime = allPlayers.filter((p) => p.serviceYearsExact).length;
    check(
      'real (non-estimated) service-time coverage >= 80%',
      totalPlayers > 0 && withServiceTime / totalPlayers >= 0.8,
      `${withServiceTime}/${totalPlayers}`
    );

    let cardCrashes = 0;
    const crashNames = [];
    allPlayers.forEach((p) => {
      try {
        openPlayerCard(p);
      } catch (e) {
        cardCrashes++;
        crashNames.push(`${p.name} (${e.message})`);
      }
    });
    check(
      'every player card renders without throwing',
      cardCrashes === 0,
      cardCrashes === 0 ? `${totalPlayers} cards OK` : `${cardCrashes} crashed: ${crashNames.slice(0, 5).join(', ')}`
    );

    const capturedDate = new Date(DATA.capturedAt.replace(' UTC', 'Z').replace(' ', 'T'));
    const hoursOld = (Date.now() - capturedDate.getTime()) / 3600000;
    check(
      'data snapshot is fresh (<36h old)',
      Number.isFinite(hoursOld) && hoursOld <= 36,
      `${hoursOld.toFixed(1)}h old (captured ${DATA.capturedAt})`
    );

    return out;
  });

  await browser.close();

  checks.push({
    name: 'no browser console errors on load',
    pass: consoleErrors.length === 0,
    detail: consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'clean',
  });

  console.log('='.repeat(70));
  console.log('DASHBOARD VALIDATION');
  console.log(`file: ${dashboardPath}`);
  console.log('='.repeat(70));
  let failCount = 0;
  for (const c of checks) {
    console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.name} -- ${c.detail}`);
    if (!c.pass) failCount++;
  }
  console.log('='.repeat(70));
  console.log(`${checks.length - failCount}/${checks.length} checks passed`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Validation script crashed:', err);
  process.exit(1);
});

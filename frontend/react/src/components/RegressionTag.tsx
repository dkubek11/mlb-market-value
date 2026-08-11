/**
 * RegressionTag — the ▲/▼ arrow next to player names (legacy
 * regressionTagHtml, dashboard_template.html.bak:805-812). Rendered as a real
 * React element (no dangerouslySetInnerHTML) with the same title text.
 */
import { regressionArrow, fmtStatValue } from '../lib/format';
import type { EnrichedPlayer } from '../lib/scoring';

export function RegressionTag({ record }: { record: EnrichedPlayer }) {
  const arrow = regressionArrow(record);
  if (!arrow) return null;
  const title =
    arrow.cls === 'bad'
      ? `${fmtStatValue(arrow.sig.type, arrow.sig.actual)} vs ${fmtStatValue(arrow.sig.type, arrow.sig.projected)} projected — overperforming, regression likely`
      : `${fmtStatValue(arrow.sig.type, arrow.sig.actual)} vs ${fmtStatValue(arrow.sig.type, arrow.sig.projected)} projected — underperforming, positive regression likely`;
  return (
    <span className={`regression-tag ${arrow.cls}`} title={title}>
      {arrow.symbol}
    </span>
  );
}

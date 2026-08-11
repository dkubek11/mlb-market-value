/**
 * WeightPanel — React port of the legacy weight panels
 * (dashboard_template.html.bak:1476-1541, buildWeightPanel / buildPayPanel).
 *
 * The sliders are bound straight to ScoringProvider's weight state, so every
 * input change recomputes all scores live — exactly what the legacy input
 * listeners did by calling recomputeAll() + renderAll(). The reset buttons
 * restore the default weights. Markup matches the legacy .weight-row rows
 * (label + direction hint, range input 0–3 step 0.1, live .weight-value).
 */
import { BATTER_STAT_CONFIG, PITCHER_STAT_CONFIG, type ScoringStatConfig } from '../lib/scoring';
import { useScoring } from '../context/ScoringProvider';

interface SliderRowProps {
  label: string;
  direction: string;
  value: number;
  onChange: (value: number) => void;
}

function SliderRow({ label, direction, value, onChange }: SliderRowProps) {
  return (
    <div className="weight-row">
      <span className="weight-label">
        {label}
        <span className="direction">{direction}</span>
      </span>
      <input
        type="range"
        min="0"
        max="3"
        step="0.1"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        aria-label={label}
      />
      <span className="weight-value">{value.toFixed(1)}</span>
    </div>
  );
}

interface WeightGroupProps {
  title: string;
  config: ScoringStatConfig[];
  weights: Record<string, number>;
  onWeightChange: (key: string, value: number) => void;
  onReset: () => void;
  resetLabel: string;
}

function WeightGroup({ title, config, weights, onWeightChange, onReset, resetLabel }: WeightGroupProps) {
  return (
    <div className="weight-group">
      <h3 className="weight-group-title">{title}</h3>
      <div className="weight-panel">
        {config.map(s => (
          <SliderRow
            key={s.key}
            label={s.label}
            direction={s.higherBetter ? 'higher is better' : 'lower is better'}
            value={weights[s.key]}
            onChange={v => onWeightChange(s.key, v)}
          />
        ))}
      </div>
      <div className="weight-actions">
        <button className="preview-link" type="button" onClick={onReset}>
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

export function WeightPanel() {
  const {
    battingWeights,
    pitchingWeights,
    payWeight,
    setBattingWeight,
    setPitchingWeight,
    setPayWeight,
    resetBattingWeights,
    resetPitchingWeights,
    resetPayWeight,
  } = useScoring();

  return (
    <>
      <div className="weight-group">
        <h3 className="weight-group-title">Pay</h3>
        <div className="weight-panel">
          <SliderRow
            label="Pay"
            direction="higher = salary pulls score down harder"
            value={payWeight}
            onChange={setPayWeight}
          />
        </div>
        <div className="weight-actions">
          <button className="preview-link" type="button" onClick={resetPayWeight}>
            Reset to default weight
          </button>
        </div>
      </div>
      <WeightGroup
        title="Batting"
        config={BATTER_STAT_CONFIG}
        weights={battingWeights}
        onWeightChange={setBattingWeight}
        onReset={resetBattingWeights}
        resetLabel="Reset to default weights"
      />
      <WeightGroup
        title="Pitching"
        config={PITCHER_STAT_CONFIG}
        weights={pitchingWeights}
        onWeightChange={setPitchingWeight}
        onReset={resetPitchingWeights}
        resetLabel="Reset to default weights"
      />
    </>
  );
}

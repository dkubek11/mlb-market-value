/**
 * ScoringProvider — React home for the scoring engine's mutable weights.
 *
 * Legacy behavior: the template owns module-level `battingWeights`,
 * `pitchingWeights` and `payWeight`, and runs the DOM-mutating
 * `recomputeAll()` on every slider input. React equivalent: weights live in
 * useState here, and a useMemo keyed on (weights, payload) produces the
 * enriched player/team arrays. recomputeAll mutates shallow clones of the
 * payload records, so the fetched payload object is never touched.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  BATTER_STAT_CONFIG,
  PITCHER_STAT_CONFIG,
  DEFAULT_PAY_WEIGHT,
  recomputeAll,
  type EnrichedPlayer,
  type EnrichedTeam,
  type ScoringStatConfig,
} from '../lib/scoring';
import type { DashboardPayload } from '../api/types';

function defaultWeights(config: ScoringStatConfig[]): Record<string, number> {
  const w: Record<string, number> = {};
  config.forEach(s => { w[s.key] = s.defaultWeight; });
  return w;
}

export interface ScoringContextValue {
  /** Enriched players (scored), recomputed whenever weights or payload change. */
  players: EnrichedPlayer[];
  /** Teams with avgScore written, same recompute trigger. */
  teams: EnrichedTeam[];
  battingWeights: Record<string, number>;
  pitchingWeights: Record<string, number>;
  payWeight: number;
  setBattingWeight: (key: string, value: number) => void;
  setPitchingWeight: (key: string, value: number) => void;
  setPayWeight: (value: number) => void;
  resetBattingWeights: () => void;
  resetPitchingWeights: () => void;
  resetPayWeight: () => void;
}

const ScoringContext = createContext<ScoringContextValue | null>(null);

export function ScoringProvider({ payload, children }: { payload: DashboardPayload; children: ReactNode }) {
  const [battingWeights, setBattingWeights] = useState(() => defaultWeights(BATTER_STAT_CONFIG));
  const [pitchingWeights, setPitchingWeights] = useState(() => defaultWeights(PITCHER_STAT_CONFIG));
  const [payWeight, setPayWeightState] = useState(DEFAULT_PAY_WEIGHT);

  const setBattingWeight = useCallback((key: string, value: number) => {
    setBattingWeights(prev => ({ ...prev, [key]: value }));
  }, []);
  const setPitchingWeight = useCallback((key: string, value: number) => {
    setPitchingWeights(prev => ({ ...prev, [key]: value }));
  }, []);
  const setPayWeight = useCallback((value: number) => setPayWeightState(value), []);
  const resetBattingWeights = useCallback(() => setBattingWeights(defaultWeights(BATTER_STAT_CONFIG)), []);
  const resetPitchingWeights = useCallback(() => setPitchingWeights(defaultWeights(PITCHER_STAT_CONFIG)), []);
  const resetPayWeight = useCallback(() => setPayWeightState(DEFAULT_PAY_WEIGHT), []);

  const { players, teams } = useMemo(() => {
    const players = payload.allPlayers.map(p => ({ ...p }) as EnrichedPlayer);
    const teams = payload.teams.map(t => ({ ...t }) as EnrichedTeam);
    recomputeAll(players, payload.positionStats, teams, {
      batting: battingWeights,
      pitching: pitchingWeights,
      pay: payWeight,
    });
    return { players, teams };
  }, [payload, battingWeights, pitchingWeights, payWeight]);

  const value = useMemo<ScoringContextValue>(
    () => ({
      players,
      teams,
      battingWeights,
      pitchingWeights,
      payWeight,
      setBattingWeight,
      setPitchingWeight,
      setPayWeight,
      resetBattingWeights,
      resetPitchingWeights,
      resetPayWeight,
    }),
    [
      players,
      teams,
      battingWeights,
      pitchingWeights,
      payWeight,
      setBattingWeight,
      setPitchingWeight,
      setPayWeight,
      resetBattingWeights,
      resetPitchingWeights,
      resetPayWeight,
    ],
  );

  return <ScoringContext.Provider value={value}>{children}</ScoringContext.Provider>;
}

export function useScoring(): ScoringContextValue {
  const ctx = useContext(ScoringContext);
  if (!ctx) throw new Error('useScoring must be used within <ScoringProvider>');
  return ctx;
}

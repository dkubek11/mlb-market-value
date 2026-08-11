/**
 * AppShell — owns the active-tab state and the page shell (sidebar + main
 * content), mirroring the legacy `TAB_VIEWS`/`switchTab` display:none behavior
 * with React state. No router, no URL params — parity with the current app.
 *
 * Home / Players / Rookies render real views (Stage 3); Teams / Custom stay
 * placeholders until Stages 4-5.
 */
import { useState } from 'react';
import type { DashboardPayload } from '../api/types';
import type { EnrichedPlayer } from '../lib/scoring';
import { useScoring } from '../context/ScoringProvider';
import { Sidebar, type TabKey } from './Sidebar';
import { HomeView } from '../views/HomeView';
import { PlayersView } from '../views/PlayersView';
import { RookiesView } from '../views/RookiesView';
import { TeamsView } from '../views/TeamsView';
import { CustomScoreView } from '../views/CustomScoreView';
import { PlayerCard } from './PlayerCard';

interface AppShellProps {
  data: DashboardPayload;
  season: number;
  fromSnapshot: boolean;
}

export function AppShell({ data, season, fromSnapshot }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [cardPlayer, setCardPlayer] = useState<EnrichedPlayer | null>(null);
  const { players, teams } = useScoring();

  const openPlayer = (p: EnrichedPlayer) => setCardPlayer(p);
  const closeCard = () => setCardPlayer(null);

  return (
    <div className="page-shell">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} data={data} season={season} fromSnapshot={fromSnapshot} />
      <main className="main-content">
        <div className="wrap">
          {activeTab === 'home' && <HomeView players={players} teams={teams} season={season} onNavigate={setActiveTab} />}
          {activeTab === 'players' && <PlayersView players={players} teams={teams} onOpenPlayer={openPlayer} />}
          {activeTab === 'rookies' && <RookiesView players={players} teams={teams} onOpenPlayer={openPlayer} />}
          {activeTab === 'teams' && <TeamsView players={players} teams={teams} rosters={data.rosters} onOpenPlayer={openPlayer} />}
          {activeTab === 'custom' && <CustomScoreView players={players} />}
        </div>
      </main>
      {cardPlayer ? (
        <PlayerCard
          record={cardPlayer}
          teams={teams}
          contracts={data.contracts}
          teamColors={data.teamColors}
          positionStats={data.positionStats}
          season={season}
          onClose={closeCard}
        />
      ) : null}
    </div>
  );
}

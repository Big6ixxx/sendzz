'use client';

import { ExploreFilters } from './components/ExploreFilters';
import { StatsHero } from './components/StatsHero';
import { SystemStatusPill } from './components/SystemStatusPill';
import { TotalsBar } from './components/TotalsBar';
import { TransactionsFeed } from './components/TransactionsFeed';
import { TxDetailModal } from './TxDetailModal';
import { useExploreState } from './useExploreState';
import { useTimeDisplay } from './useTimeDisplay';

/**
 * Orchestrator for the public `/explore` dashboard. Data + filter state live in
 * `useExploreState`; timezone/relative-time display lives in `useTimeDisplay`. This component
 * only wires those hooks to the presentational sections under `./components`.
 */
export function ExploreClient() {
  const state = useExploreState();
  const time = useTimeDisplay();

  return (
    <div className="space-y-10">
      <SystemStatusPill
        stats={state.stats}
        loading={state.statsLoading}
        timeZone={time.timeZone}
        timeMode={time.mode}
      />

      <StatsHero stats={state.stats} loading={state.statsLoading} />

      <ExploreFilters
        type={state.type}
        setType={state.setType}
        chain={state.chain}
        setChain={state.setChain}
        range={state.range}
        setRange={state.setRange}
        sortCol={state.sortCol}
        sortDir={state.sortDir}
        toggleSort={state.toggleSort}
        searchInput={state.searchInput}
        setSearchInput={state.setSearchInput}
        timeDisplay={time}
      />

      <TotalsBar totals={state.totals} />

      <TransactionsFeed
        rows={state.rows}
        loading={state.feedLoading}
        fetching={state.feedFetching}
        total={state.total}
        page={state.page}
        totalPages={state.totalPages}
        setPage={state.setPage}
        timeZone={time.timeZone}
        timeMode={time.mode}
        abbrev={time.abbrev}
        onOpenTx={state.openTx}
      />

      <TxDetailModal
        row={state.selectedRow}
        open={!!state.selectedId}
        loading={state.selectedLoading}
        timeZone={time.timeZone}
        timeMode={time.mode}
        onClose={state.closeTx}
      />
    </div>
  );
}

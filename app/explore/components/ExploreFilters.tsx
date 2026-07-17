'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { chainName, SUPPORTED_CHAINS } from '@/lib/chains';
import { cn } from '@/lib/utils';
import type { SortColumn, SortDir, TimeRange, TxType } from '@/types/public';
import { ArrowDownUp, Search } from 'lucide-react';
import { RANGE_FILTERS, TYPE_FILTERS } from '../constants';
import type { TimeDisplay } from '../useTimeDisplay';
import { TimeDisplaySelect } from './TimeDisplaySelect';

function SortButton({
  active,
  dir,
  label,
  onClick,
}: {
  active: boolean;
  dir: SortDir;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 px-4 h-10 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap',
        active
          ? 'bg-accent/15 border-accent/40 text-accent'
          : 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20',
      )}
    >
      {label}
      {active && (
        <ArrowDownUp className={cn('w-3.5 h-3.5 transition-transform', dir === 'asc' && 'rotate-180')} />
      )}
    </button>
  );
}

interface ExploreFiltersProps {
  type: TxType | null;
  setType: (t: TxType | null) => void;
  chain: string | null;
  setChain: (c: string | null) => void;
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  sortCol: SortColumn;
  sortDir: SortDir;
  toggleSort: (col: SortColumn) => void;
  searchInput: string;
  setSearchInput: (v: string) => void;
  timeDisplay: TimeDisplay;
}

export function ExploreFilters({
  type,
  setType,
  chain,
  setChain,
  range,
  setRange,
  sortCol,
  sortDir,
  toggleSort,
  searchInput,
  setSearchInput,
  timeDisplay,
}: ExploreFiltersProps) {
  return (
    <section aria-labelledby="filters-heading" className="space-y-4">
      <h2 id="filters-heading" className="sr-only">
        Filter transactions
      </h2>

      {/* Type chips */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Transaction type">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => setType(t.value)}
            aria-pressed={type === t.value}
            className={cn(
              'px-5 h-11 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap',
              type === t.value
                ? 'bg-accent/15 border-accent/40 text-accent'
                : 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:border-white/20',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + chain + time display */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 min-w-0 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-focus-within:text-accent transition-colors" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by transaction hash…"
            aria-label="Search by transaction hash"
            className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-accent/50 transition-all"
          />
        </div>

        <Select value={chain ?? 'all'} onValueChange={(v) => setChain(v === 'all' ? null : v)}>
          <SelectTrigger
            aria-label="Filter by chain"
            className="lg:w-44 rounded-xl border-white/10 bg-white/5 text-white/70"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All chains</SelectItem>
            {SUPPORTED_CHAINS.map((c) => (
              <SelectItem key={c} value={c}>
                {chainName(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TimeDisplaySelect
          value={timeDisplay.value}
          onValueChange={timeDisplay.setValue}
          localTimeZone={timeDisplay.localTimeZone}
          abbrev={timeDisplay.abbrev}
        />
      </div>

      {/* Range + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Time range">
          {RANGE_FILTERS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={cn(
                'px-4 h-10 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap',
                range === r.value
                  ? 'bg-white/10 border-white/25 text-white'
                  : 'bg-white/3 border-white/8 text-white/40 hover:text-white/70 hover:border-white/20',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Sort</span>
          <SortButton active={sortCol === 'created_at'} dir={sortDir} label="Date" onClick={() => toggleSort('created_at')} />
          <SortButton active={sortCol === 'amount'} dir={sortDir} label="Amount" onClick={() => toggleSort('amount')} />
        </div>
      </div>
    </section>
  );
}

'use client';

import { FilterPills, SearchField } from '@/components/dashboard/ListControls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { chainName, SUPPORTED_CHAINS } from '@/lib/chains';
import { cn } from '@/lib/utils';
import type { SortColumn, SortDir, TimeRange, TxType } from '@/types/public';
import { ArrowDown } from 'lucide-react';
import { RANGE_FILTERS, TYPE_FILTERS } from '../constants';
import type { TimeDisplay } from '../useTimeDisplay';
import { TimeDisplaySelect } from './TimeDisplaySelect';

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

const SORTS: { col: SortColumn; label: string }[] = [
  { col: 'created_at', label: 'Date' },
  { col: 'amount', label: 'Amount' },
];

/** The same search box and pills as the dashboard's lists, plus chain, time and sort. */
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
    <section aria-labelledby="filters-heading" className="space-y-3">
      <h2 id="filters-heading" className="sr-only">
        Filter transactions
      </h2>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search by transaction hash" label="Search by transaction hash" />
        <Select value={chain ?? 'all'} onValueChange={(v) => setChain(v === 'all' ? null : v)}>
          <SelectTrigger aria-label="Filter by chain" className="lg:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All networks</SelectItem>
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

      <FilterPills
        label="Transaction type"
        value={type ?? 'all'}
        onChange={(v) => setType(v === 'all' ? null : (v as TxType))}
        options={TYPE_FILTERS.map((t) => ({ value: t.value ?? 'all', label: t.label }))}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterPills label="Time range" value={range} onChange={setRange} options={RANGE_FILTERS} />
        {/* Sort: the active column is filled, and its arrow says which way and flips on a second tap. */}
        <div role="group" aria-label="Sort" className="flex rounded-full bg-white p-1 shadow-[0_0_0_1px_rgb(17_26_19/0.08)]">
          {SORTS.map((s) => {
            const on = sortCol === s.col;
            return (
              <button
                key={s.col}
                type="button"
                onClick={() => toggleSort(s.col)}
                aria-pressed={on}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors duration-150',
                  on ? 'bg-[var(--lp-ink)] text-[var(--lp-cream)]' : 'text-[var(--lp-muted)] hover:text-[var(--lp-ink)]',
                )}
              >
                {s.label}
                {on && <ArrowDown className={cn('size-3.5 transition-transform', sortDir === 'asc' && 'rotate-180')} aria-label={sortDir === 'asc' ? 'ascending' : 'descending'} />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

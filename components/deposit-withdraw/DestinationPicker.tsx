"use client";

/**
 * The country the money is going to, as a full list on its own screen.
 *
 * Rows are COUNTRIES from `getPayoutCountries`, not currencies: several countries share XOF or
 * XAF, and a currency-level list could not tell them apart. The currency is shown underneath as
 * the consequence of the choice. Search appears only once the list is long enough to need it.
 */

import * as React from "react";
import { ChevronRight, Search } from "lucide-react";
import { usePayoutCountries } from "@/lib/hooks/usePayoutCountries";
import { getCountryFlag } from "@/lib/currency-config";
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';

/** Below this, scanning the list beats typing into a box above it. */
const SEARCH_THRESHOLD = 8;

export function DestinationPicker({
  onSelect,
}: {
  onSelect: (country: { code: string; currency: string }) => void;
}) {
  const { data: countries, isLoading } = usePayoutCountries();
  const [search, setSearch] = React.useState("");

  const options = countries ?? [];
  const query = search.trim().toLowerCase();
  const filtered = query
    ? options.filter(
        (o) =>
          o.name.toLowerCase().includes(query) ||
          o.code.toLowerCase().includes(query) ||
          o.currency.toLowerCase().includes(query),
      )
    : options;

  if (isLoading && options.length === 0) {
    return (
      <SkeletonGroup label="Loading countries" className="lp-card w-full space-y-4 rounded-[22px] p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-1">
            <Skeleton className="size-7 rounded-[8px]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </SkeletonGroup>
    );
  }

  return (
    <div className="w-full space-y-3">
      {options.length > SEARCH_THRESHOLD && (
        <label className="flex h-12 items-center gap-3 rounded-full bg-[var(--lp-surface)] px-4 shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)]">
          <Search className="size-4 shrink-0 text-[var(--lp-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country or currency"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--lp-placeholder)] md:text-[15px]"
            aria-label="Search destinations"
          />
        </label>
      )}

      {/* Scrolls in its own panel so the dialog never grows a second scrollbar. */}
      <div
        aria-label="Destination"
        className="lp-card max-h-[340px] w-full overflow-y-auto rounded-[22px] p-1.5"
      >
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[15px] text-[var(--lp-muted)]">Nothing matches “{search}”.</p>
        ) : (
          filtered.map((option) => (
            <button
              key={`${option.code}-${option.currency}`}
              type="button"
              onClick={() => onSelect({ code: option.code, currency: option.currency })}
              className="flex w-full items-center gap-3 rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-[var(--lp-cream)]"
            >
              <span className="text-[24px] leading-none shrink-0" aria-hidden>
                {getCountryFlag(option.code, option.currency)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{option.name}</span>
                <span className="block text-[13px] text-[var(--lp-muted)]">Pays out in {option.currency}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-[var(--lp-muted)]" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

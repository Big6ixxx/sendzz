"use client";

/**
 * The country the money is going to, as a full list on its own screen.
 *
 * Rows are COUNTRIES from `getPayoutCountries`, not currencies: several countries share XOF or
 * XAF, and a currency-level list could not tell them apart. The currency is shown underneath as
 * the consequence of the choice. Search appears only once the list is long enough to need it.
 */

import * as React from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { usePayoutCountries } from "@/lib/hooks/usePayoutCountries";
import { getCurrencyFlag } from "@/lib/currency-config";

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
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading destinations…
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      {options.length > SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country or currency"
            className="input-elegant w-full pl-9"
            aria-label="Search destinations"
          />
        </div>
      )}

      {/* Scrolls in its own box so the dialog itself never grows a second scrollbar. */}
      <div
        aria-label="Destination"
        className="w-full max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.07] divide-y divide-white/[0.05]"
      >
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing matches “{search}”.
          </p>
        ) : (
          filtered.map((option) => (
              <button
                key={`${option.code}-${option.currency}`}
                type="button"
                onClick={() => onSelect({ code: option.code, currency: option.currency })}
                className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
              >
                <span className="text-xl leading-none shrink-0" aria-hidden>
                  {getCurrencyFlag(option.currency)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{option.name}</span>
                  <span className="block text-[11.5px] font-medium text-muted-foreground">
                    Pays out in {option.currency}
                  </span>
                </span>

                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
              </button>
            ))
        )}
      </div>
    </div>
  );
}

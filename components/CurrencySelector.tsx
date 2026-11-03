'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  type FiatCurrencyCode,
  getCurrencyFlag,
} from '@/lib/currency-config';
import { useCurrencies, type CurrencyScope } from '@/lib/hooks/useCurrencies';
import { ChevronDown, Search } from 'lucide-react';
import * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

// When includeUsd is true, onChange can receive 'USD' | FiatCurrencyCode
// When includeUsd is false, onChange only receives FiatCurrencyCode
type CurrencySelectorPropsWithUsd = {
  selected: 'USD' | FiatCurrencyCode;
  onChange: (currency: 'USD' | FiatCurrencyCode) => void;
  includeUsd?: true;
  size?: 'sm' | 'md';
  /** `'onramp'` narrows the list to corridors a deposit can actually be fulfilled in. */
  scope?: CurrencyScope;
};

type CurrencySelectorPropsWithoutUsd = {
  selected: FiatCurrencyCode;
  onChange: (currency: FiatCurrencyCode) => void;
  includeUsd: false;
  size?: 'sm' | 'md';
  /** `'onramp'` narrows the list to corridors a deposit can actually be fulfilled in. */
  scope?: CurrencyScope;
};

type CurrencySelectorProps =
  | CurrencySelectorPropsWithUsd
  | CurrencySelectorPropsWithoutUsd;

export function CurrencySelector({
  selected,
  onChange,
  includeUsd = true,
  size = 'sm',
  scope = 'all',
}: CurrencySelectorProps) {
  const { data: currencies, isLoading } = useCurrencies(scope);
  const [search, setSearch] = React.useState('');

  const allOptions = [
    ...(includeUsd ? [{ code: 'USD', name: 'United States Dollar', flag: '🇺🇸' }] : []),
    ...(currencies ?? []),
  ];

  const filteredOptions = allOptions.filter(
    (opt) =>
      opt.code.toLowerCase().includes(search.toLowerCase()) ||
      opt.name.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedOption = allOptions.find((opt) => opt.code === selected);
  const flag = selectedOption?.flag ?? getCurrencyFlag(selected);

  const isSmall = size === 'sm';

  if (isLoading && !currencies) {
    return (
      <Skeleton role="status" aria-label="Loading currencies" aria-hidden={false} className={isSmall ? 'h-8 w-16' : 'h-10 w-20'} />
    );
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Select currency (currently ${selected})`}
          className={cn(
            'flex items-center gap-2 rounded-full bg-[var(--lp-cream)] font-semibold text-[var(--lp-ink)] outline-none transition-[scale,background-color] duration-150 hover:bg-[#ece6da] active:scale-95',
            isSmall ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-[15px]',
          )}
        >
          <span className="text-[1.15em] leading-none">{flag}</span>
          <span>{selected}</span>
          <ChevronDown className="size-4 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 space-y-1 p-2">
        <label className="mb-1 flex h-10 items-center gap-2 rounded-full bg-[var(--lp-cream)] px-3">
          <Search className="size-3.5 shrink-0 text-[var(--lp-muted)]" />
          <input
            autoFocus
            placeholder="Search currencies"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--lp-muted)] md:text-[14px]"
          />
        </label>

        <div className="custom-scrollbar max-h-[260px] space-y-0.5 overflow-y-auto pr-1">
          {filteredOptions.length === 0 ? (
            <p className="py-5 text-center text-[14px] text-[var(--lp-muted)]">No currency matches that.</p>
          ) : (
            filteredOptions.map((opt) => (
              <DropdownMenuItem
                key={opt.code}
                onClick={() => {
                  if (includeUsd) {
                    (onChange as (c: 'USD' | FiatCurrencyCode) => void)(opt.code);
                  } else {
                    (onChange as (c: FiatCurrencyCode) => void)(opt.code as FiatCurrencyCode);
                  }
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-3 rounded-[14px] px-3 py-2.5 transition-colors',
                  selected === opt.code ? 'bg-[var(--lp-cream)]' : 'hover:bg-[var(--lp-cream)]',
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="text-[20px] leading-none">{opt.flag}</span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold leading-tight">{opt.code}</span>
                    <span className="block truncate text-[12px] text-[var(--lp-muted)]">{opt.name}</span>
                  </span>
                </span>
                {selected === opt.code && <span className="size-2 shrink-0 rounded-full bg-[#00a857]" />}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

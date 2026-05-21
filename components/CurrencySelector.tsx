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
import { useCurrencies } from '@/lib/hooks/useCurrencies';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import * as React from 'react';

// When includeUsd is true, onChange can receive 'USD' | FiatCurrencyCode
// When includeUsd is false, onChange only receives FiatCurrencyCode
type CurrencySelectorPropsWithUsd = {
  selected: 'USD' | FiatCurrencyCode;
  onChange: (currency: 'USD' | FiatCurrencyCode) => void;
  includeUsd?: true;
  size?: 'sm' | 'md';
};

type CurrencySelectorPropsWithoutUsd = {
  selected: FiatCurrencyCode;
  onChange: (currency: FiatCurrencyCode) => void;
  includeUsd: false;
  size?: 'sm' | 'md';
};

type CurrencySelectorProps =
  | CurrencySelectorPropsWithUsd
  | CurrencySelectorPropsWithoutUsd;

export function CurrencySelector({
  selected,
  onChange,
  includeUsd = true,
  size = 'sm',
}: CurrencySelectorProps) {
  const { data: currencies, isLoading } = useCurrencies();
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
      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: isSmall ? 60 : 70,
          height: isSmall ? 24 : 28,
          background: 'var(--muted)',
          border: '1px solid var(--border)',
        }}
      >
        <Loader2 className="w-3 h-3 animate-spin opacity-40" />
      </div>
    );
  }

  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Select currency (currently ${selected})`}
          className="flex items-center gap-1.5 rounded-full font-bold transition-all hover:opacity-80 active:scale-95 outline-none"
          style={{
            padding: isSmall ? '4px 10px 4px 8px' : '5px 12px 5px 10px',
            fontSize: isSmall ? '11px' : '12px',
            background: 'var(--muted)',
            border: '1px solid var(--border)',
            color: 'var(--foreground)',
            lineHeight: 1,
          }}
        >
          <span>{flag}</span>
          <span className="uppercase tracking-wider">{selected}</span>
          <ChevronDown
            style={{
              width: isSmall ? 12 : 14,
              height: isSmall ? 12 : 14,
              opacity: 0.4,
            }}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 p-2 rounded-2xl bg-popover border-border shadow-2xl space-y-1"
      >
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            autoFocus
            placeholder="Search currencies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-8 pr-3 bg-white/5 border border-white/5 rounded-xl text-[11px] font-bold uppercase tracking-wider outline-none focus:border-white/10 transition-all"
          />
        </div>

        <div className="max-h-[240px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
          {filteredOptions.length === 0 ? (
            <p className="text-[10px] text-center py-4 font-bold uppercase tracking-widest opacity-30">
              No results
            </p>
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
                  'flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all',
                  selected === opt.code
                    ? 'bg-accent/10 text-accent'
                    : 'hover:bg-white/5',
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{opt.flag}</span>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black uppercase tracking-wider leading-none">
                      {opt.code}
                    </span>
                    <span className="text-[9px] font-bold opacity-40 uppercase tracking-widest mt-1">
                      {opt.name}
                    </span>
                  </div>
                </div>
                {selected === opt.code && (
                  <div className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(0,232,122,0.5)]" />
                )}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

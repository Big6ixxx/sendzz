'use client';

import {
  SUPPORTED_FIAT_CURRENCIES,
  type FiatCurrencyCode,
} from '@/lib/currency-config';
import { ChevronRight } from 'lucide-react';

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
  const allOptions: Array<'USD' | FiatCurrencyCode> = [
    ...(includeUsd ? (['USD'] as const) : []),
    ...SUPPORTED_FIAT_CURRENCIES.map((c) => c.code),
  ];

  const currentIndex = allOptions.indexOf(selected);

  const cycleNext = () => {
    const nextIndex = (currentIndex + 1) % allOptions.length;
    const next = allOptions[nextIndex];
    // Type-safe dispatch
    if (includeUsd) {
      (onChange as (c: 'USD' | FiatCurrencyCode) => void)(next);
    } else {
      (onChange as (c: FiatCurrencyCode) => void)(next as FiatCurrencyCode);
    }
  };

  const flag =
    selected === 'USD'
      ? '🇺🇸'
      : (SUPPORTED_FIAT_CURRENCIES.find((c) => c.code === selected)?.flag ??
        '');

  const isSmall = size === 'sm';

  return (
    <button
      type="button"
      onClick={cycleNext}
      title={`Switch currency (currently ${selected})`}
      className="flex items-center gap-1.5 rounded-full font-bold transition-all hover:opacity-80 active:scale-95"
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
      <ChevronRight
        style={{
          width: isSmall ? 12 : 14,
          height: isSmall ? 12 : 14,
          opacity: 0.4,
        }}
      />
    </button>
  );
}

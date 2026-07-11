'use client';

import { useState } from 'react';
import { Check, ChevronDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChainLogo } from './ChainLogo';
import { CHAIN_NAMES, type SupportedChain } from '@/lib/circle/gateway';

/** Per-chain trade-offs surfaced to advanced users choosing an on-ramp landing chain. */
const CHAIN_TRADEOFFS: Record<string, { pro: string; con?: string }> = {
  base: { pro: 'Lowest fees, fast settlement' },
  polygon: { pro: 'Very low fees, widely used', con: 'Slightly thinner liquidity than Ethereum' },
  ethereum: { pro: 'Most widely supported, deepest liquidity', con: 'Higher network fees' },
  arbitrum: { pro: 'Fast, low-fee L2', con: 'Fewer off-ramp routes' },
  optimism: { pro: 'Fast, low-fee L2', con: 'Fewer off-ramp routes' },
  avalanche: { pro: 'High-speed network' },
};

interface DepositNetworkAccordionProps {
  /** Chains the on-ramp provider can deliver USDC to. */
  networks: string[];
  value: string;
  onChange: (chain: string) => void;
  /** The default/recommended chain (gets a badge). */
  recommended?: string;
}

/**
 * Fiat deposits default to Base. This collapsed accordion lets advanced users pick a
 * different on-ramp-supported chain, each annotated with a pro (and a con where relevant).
 */
export function DepositNetworkAccordion({
  networks,
  value,
  onChange,
  recommended = 'base',
}: DepositNetworkAccordionProps) {
  const [open, setOpen] = useState(false);
  const name = (c: string) => CHAIN_NAMES[c as SupportedChain] ?? c;
  const selectedPro = CHAIN_TRADEOFFS[value.toLowerCase()]?.pro;

  return (
    <div className="rounded-2xl bg-white/3 border border-white/8 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChainLogo chain={value} size={22} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/35">
              Receiving on
            </p>
            <p className="text-sm font-semibold text-brand-secondary truncate">
              {name(value)}
              {selectedPro && (
                <span className="text-brand-secondary/40 font-normal"> · {selectedPro}</span>
              )}
            </p>
          </div>
        </div>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-brand-secondary/40 transition-transform shrink-0',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-white/6 pt-2">
          {networks.map((c) => {
            const t = CHAIN_TRADEOFFS[c.toLowerCase()] ?? { pro: 'Supported network' };
            const selected = c.toLowerCase() === value.toLowerCase();
            return (
              <button
                type="button"
                key={c}
                onClick={() => onChange(c)}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                  selected
                    ? 'bg-accent/10 border border-accent/25'
                    : 'border border-transparent hover:bg-white/5',
                )}
              >
                <ChainLogo chain={c} size={20} />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-brand-secondary flex items-center gap-2">
                    {name(c)}
                    {c.toLowerCase() === recommended.toLowerCase() && (
                      <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/25">
                        Recommended
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-brand-secondary/55 flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-accent shrink-0" /> {t.pro}
                  </p>
                  {t.con && (
                    <p className="text-[11px] text-brand-secondary/35 flex items-center gap-1.5">
                      <Minus className="w-3 h-3 text-amber-400/70 shrink-0" /> {t.con}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    'w-4 h-4 mt-0.5 rounded-full border flex items-center justify-center shrink-0',
                    selected ? 'border-accent' : 'border-white/20',
                  )}
                >
                  {selected && <span className="w-2 h-2 rounded-full bg-accent" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

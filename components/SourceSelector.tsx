'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Layers, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ChainLogo } from '@/components/deposit-withdraw/ChainLogo';
import { CHAIN_NAMES, type SupportedChain } from '@/lib/circle/gateway';
import {
  type ChainBalances,
  type SourceChainKey,
  type SourcePreference,
} from '@/lib/web3/routing';

interface SourceSelectorProps {
  /** Per-chain EVM balances (USDC). */
  balances: ChainBalances;
  /** Optional Solana balance (USDC) — offered for consolidation only. */
  solanaBalance?: number;
  /** Optional Stellar balance (USDC) — offered for consolidation only. */
  stellarBalance?: number;
  /** Amount the movement needs (USDC). */
  requiredAmount: number;
  /**
   * When set, only these chains may be picked as a single direct source (e.g. ramp-
   * supported chains for withdrawals). Consolidation can still pull from any chain.
   */
  singleSourceChains?: SupportedChain[];
  /** Whether the "combine networks" (consolidate) option is offered. Off for p2p. */
  allowConsolidate?: boolean;
  /** Label for where consolidated funds land, e.g. "Base". */
  consolidationTarget?: string;
  value: SourcePreference;
  onChange: (next: SourcePreference) => void;
}

const NAME = (c: SourceChainKey) => {
  if (c === 'solana') return 'Solana';
  if (c === 'stellar') return 'Stellar';
  return CHAIN_NAMES[c as SupportedChain] ?? c;
};

/**
 * Progressive-disclosure source picker. Collapsed by default ("Change source ▾"); when
 * expanded, lets a user override the smart auto-route — either pay from one chosen chain,
 * or combine specific chains (consolidate) before the movement. Honours the app's
 * "money, not chains" default: novices never open it.
 */
export function SourceSelector({
  balances,
  solanaBalance = 0,
  stellarBalance = 0,
  requiredAmount,
  singleSourceChains,
  allowConsolidate = false,
  consolidationTarget = 'Base',
  value,
  onChange,
}: SourceSelectorProps) {
  const [open, setOpen] = useState(false);

  // Funded chains (EVM with >0), in a stable order.
  const fundedChains = useMemo(
    () =>
      (Object.keys(balances) as SupportedChain[])
        .filter((c) => (balances[c] ?? 0) > 0)
        .sort((a, b) => (balances[b] ?? 0) - (balances[a] ?? 0)),
    [balances],
  );

  const allConsolidatable: SourceChainKey[] = useMemo(
    () => [
      ...fundedChains,
      ...(solanaBalance > 0 ? (['solana'] as const) : []),
      ...(stellarBalance > 0 ? (['stellar'] as const) : [])
    ],
    [fundedChains, solanaBalance, stellarBalance],
  );

  const hasEnough = (c: SupportedChain) => (balances[c] ?? 0) + 1e-9 >= requiredAmount;
  const isDirectSupported = (c: SupportedChain) =>
    !singleSourceChains || singleSourceChains.includes(c);
  const canSingle = (c: SupportedChain) => hasEnough(c) && isDirectSupported(c);

  // Current consolidate selection (defaults to everything funded).
  const consolidateFrom =
    value.mode === 'consolidate' ? value.from : allConsolidatable;

  const balOf = (c: SourceChainKey) => {
    if (c === 'solana') return solanaBalance;
    if (c === 'stellar') return stellarBalance;
    return balances[c as SupportedChain] ?? 0;
  };

  const selectedSum = consolidateFrom.reduce((s, c) => s + balOf(c), 0);

  const summary =
    value.mode === 'auto'
      ? 'Automatic (smart)'
      : value.mode === 'single'
        ? `From ${NAME(value.chain)}`
        : `Combine ${value.from.length} network${value.from.length === 1 ? '' : 's'} → ${consolidationTarget}`;

  const toggleConsolidateChain = (c: SourceChainKey) => {
    const set = new Set(consolidateFrom);
    if (set.has(c)) set.delete(c);
    else set.add(c);
    onChange({ mode: 'consolidate', from: Array.from(set) });
  };

  return (
    <div className="rounded-2xl bg-white/3 border border-white/8 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/35">
            Source
          </p>
          <p className="text-sm font-semibold text-brand-secondary truncate">{summary}</p>
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
          {/* Auto */}
          <OptionRow
            selected={value.mode === 'auto'}
            onClick={() => onChange({ mode: 'auto' })}
            icon={<Sparkles className="w-4 h-4 text-accent" />}
            title="Automatic"
            subtitle="Let Sendzz choose the best route"
          />

          {/* Single-chain sources */}
          {fundedChains.map((c) => {
            const eligible = canSingle(c);
            const bal = `$${(balances[c] ?? 0).toFixed(2)}`;
            // Distinguish "has funds but not a direct payout chain" from "not enough funds".
            const subtitle = eligible
              ? `${bal} available`
              : !isDirectSupported(c)
                ? `${bal} — not a direct withdrawal network, use Combine`
                : `${bal} — not enough on its own`;
            return (
              <OptionRow
                key={c}
                selected={value.mode === 'single' && value.chain === c}
                disabled={!eligible}
                onClick={() => eligible && onChange({ mode: 'single', chain: c })}
                icon={<ChainLogo chain={c} size={18} />}
                title={`Pay from ${NAME(c)}`}
                subtitle={subtitle}
              />
            );
          })}

          {/* Consolidate */}
          {allowConsolidate && allConsolidatable.length > 1 && (
            <div
              className={cn(
                'rounded-xl border transition-colors',
                value.mode === 'consolidate'
                  ? 'border-accent/30 bg-accent/5'
                  : 'border-white/8',
              )}
            >
              <OptionRow
                selected={value.mode === 'consolidate'}
                onClick={() =>
                  onChange({ mode: 'consolidate', from: allConsolidatable })
                }
                icon={<Layers className="w-4 h-4 text-brand-secondary/60" />}
                title={`Combine networks → ${consolidationTarget}`}
                subtitle="Gather funds from the networks you pick"
                flush
              />

              {value.mode === 'consolidate' && (
                <div className="px-3 pb-3 pt-1 space-y-1">
                  {allConsolidatable.map((c) => {
                    const checked = consolidateFrom.includes(c);
                    return (
                      <button
                        type="button"
                        key={c}
                        onClick={() => toggleConsolidateChain(c)}
                        className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        <span
                          className={cn(
                            'w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0',
                            checked
                              ? 'bg-accent border-accent'
                              : 'border-white/20',
                          )}
                        >
                          {checked && <Check className="w-3 h-3 text-background" />}
                        </span>
                        <ChainLogo chain={c} size={16} />
                        <span className="text-xs font-semibold text-brand-secondary flex-1 text-left">
                          {NAME(c)}
                        </span>
                        <span className="text-[11px] tabular-nums text-brand-secondary/40">
                          ${balOf(c).toFixed(2)}
                        </span>
                      </button>
                    );
                  })}
                  <p
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-widest pt-1 px-2',
                      selectedSum + 1e-9 >= requiredAmount
                        ? 'text-accent/70'
                        : 'text-amber-400/80',
                    )}
                  >
                    Selected: ${selectedSum.toFixed(2)}
                    {selectedSum + 1e-9 < requiredAmount &&
                      ` — need $${requiredAmount.toFixed(2)}`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OptionRow({
  selected,
  disabled,
  onClick,
  icon,
  title,
  subtitle,
  flush,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  flush?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
        !flush && (selected ? 'bg-accent/10 border border-accent/25' : 'border border-transparent hover:bg-white/5'),
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-brand-secondary truncate">{title}</p>
        <p className="text-[11px] text-brand-secondary/40 truncate">{subtitle}</p>
      </div>
      <span
        className={cn(
          'w-4 h-4 rounded-full border flex items-center justify-center shrink-0',
          selected ? 'border-accent' : 'border-white/20',
        )}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-accent" />}
      </span>
    </button>
  );
}

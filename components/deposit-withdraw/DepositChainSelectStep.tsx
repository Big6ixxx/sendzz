'use client';

import { ALL_CHAINS, CHAIN_META, ChainBadge, type FlowChain } from './deposit-shared';

interface DepositChainSelectStepProps {
  onSelect: (chain: FlowChain) => void;
}

export function DepositChainSelectStep({ onSelect }: DepositChainSelectStepProps) {
  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400">
      <div>
        <p className="text-sm font-semibold text-white/60 mb-1">
          Where are your funds coming from?
        </p>
        <p className="text-xs text-white/30">
          Select the network you&apos;re sending USDC from.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {ALL_CHAINS.map((c) => {
          const m = CHAIN_META[c];
          return (
            <button
              key={c}
              onClick={() => onSelect(c)}
              className="group relative p-4 rounded-2xl text-left transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: m.bg, border: `1.5px solid ${m.border}` }}
            >
              {m.isDirect && (
                <span
                  className="absolute top-2 right-2 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
                  style={{ background: m.bg, color: m.color, border: `1px solid ${m.border}` }}
                >
                  Direct
                </span>
              )}
              <ChainBadge chain={c} size={36} />
              <p className="text-sm font-bold mt-2.5" style={{ color: '#f8f8f6' }}>{m.name}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(248,248,246,0.35)' }}>
                {m.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

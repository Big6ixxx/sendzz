'use client';

import { truncateAddress } from '@/lib/utils';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ChainBadge, type ChainMeta, type FlowChain } from './deposit-shared';

interface DepositWaitingStepProps {
  chain: FlowChain;
  meta: ChainMeta;
  depositAddress: string;
  amount: string;
  pollSecs: number;
  onBack: () => void;
}

export function DepositWaitingStep({
  chain,
  meta,
  depositAddress,
  amount,
  pollSecs,
  onBack,
}: DepositWaitingStepProps) {
  const mins = Math.floor(pollSecs / 60);
  const secs = pollSecs % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="flex flex-col items-center py-8 space-y-6 animate-in fade-in duration-400">
      <div className="relative">
        <div
          className="w-24 h-24 rounded-full animate-ping absolute inset-0"
          style={{ background: meta.bg, opacity: 0.5 }}
        />
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center relative"
          style={{ background: meta.bg, border: `2px solid ${meta.border}` }}
        >
          <ChainBadge chain={chain} size={40} />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h3 className="text-xl font-display font-bold text-white">Watching for your USDC</h3>
        <p className="text-sm" style={{ color: 'rgba(248,248,246,0.4)' }}>
          We&apos;re monitoring the {meta.name} network for your deposit
        </p>
      </div>

      <div
        className="w-full p-4 rounded-2xl space-y-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2" style={{ color: 'rgba(248,248,246,0.4)' }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: meta.color }} />
            <span>Scanning {meta.name} every 5s</span>
          </div>
          <span className="font-mono font-bold tabular-nums" style={{ color: meta.color }}>{timeStr}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'rgba(248,248,246,0.3)' }}>Watching address</span>
          <span className="font-mono" style={{ color: 'rgba(248,248,246,0.5)' }}>
            {truncateAddress(depositAddress, 6, 4)}
          </span>
        </div>
        {amount && (
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'rgba(248,248,246,0.3)' }}>Expected</span>
            <span className="font-bold" style={{ color: '#f8f8f6' }}>
              ${parseFloat(amount).toLocaleString()} USDC
            </span>
          </div>
        )}
      </div>

      <p className="text-[11px] text-center leading-relaxed" style={{ color: 'rgba(248,248,246,0.2)' }}>
        You can close this and come back — click &ldquo;I&apos;ve sent it&rdquo; again once you&apos;ve transferred.
      </p>

      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-colors"
        style={{ color: 'rgba(248,248,246,0.3)' }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to address
      </button>
    </div>
  );
}

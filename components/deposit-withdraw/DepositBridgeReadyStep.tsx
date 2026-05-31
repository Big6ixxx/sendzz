'use client';

import { CheckCircle2, Loader2, RefreshCw, Wallet, Zap } from 'lucide-react';
import { BRIDGE_MIN_USDC, type ChainMeta, type FlowChain } from './deposit-shared';

interface DepositBridgeReadyStepProps {
  chain: FlowChain;
  meta: ChainMeta;
  detectedBalance: number;
  bridgeAmt: string;
  setBridgeAmt: (v: string) => void;
  canBridge: boolean;
  isExecuting: boolean;
  error: string;
  onBridge: () => void;
  onReconnect: () => void;
  onRecheck: () => void;
}

export function DepositBridgeReadyStep({
  chain,
  meta,
  detectedBalance,
  bridgeAmt,
  setBridgeAmt,
  canBridge,
  isExecuting,
  error,
  onBridge,
  onReconnect,
  onRecheck,
}: DepositBridgeReadyStepProps) {
  const min = BRIDGE_MIN_USDC[chain] ?? 1;

  return (
    <div className="space-y-5 animate-in fade-in zoom-in-95 duration-400">
      {/* Funds detected banner */}
      <div
        className="p-4 rounded-2xl flex items-center gap-4"
        style={{ background: 'rgba(0,232,122,0.07)', border: '1px solid rgba(0,232,122,0.2)' }}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(0,232,122,0.15)' }}
        >
          <CheckCircle2 className="w-5 h-5" style={{ color: '#00e87a' }} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: '#00e87a' }}>Funds detected!</p>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(248,248,246,0.5)' }}>
            {detectedBalance.toFixed(2)} USDC on {meta.name}
          </p>
        </div>
      </div>

      {/* Amount to bridge */}
      <div>
        <label className="text-xs font-semibold block mb-2" style={{ color: 'rgba(248,248,246,0.4)' }}>
          Amount to bridge to Base
        </label>
        <div className="relative">
          <span
            className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold pointer-events-none"
            style={{ color: 'rgba(248,248,246,0.25)' }}
          >
            $
          </span>
          <input
            type="number"
            step="0.01"
            min={min}
            max={detectedBalance}
            value={bridgeAmt}
            onChange={(e) => setBridgeAmt(e.target.value)}
            className="input-elegant pl-8 text-2xl font-bold w-full"
          />
        </div>
        <div className="flex gap-2 mt-2">
          {[20, 50, 75, 100].map((pct) => {
            const calculated = ((detectedBalance * pct) / 100).toFixed(2);
            return (
              <button
                key={pct}
                type="button"
                onClick={() => setBridgeAmt(calculated)}
                className="flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 hover:text-white"
              >
                {pct}%
              </button>
            );
          })}
        </div>
      </div>

      {/* Fee info */}
      {bridgeAmt && parseFloat(bridgeAmt) > 0 && (
        <div
          className="p-3 rounded-xl flex justify-between items-center text-xs"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex items-center gap-2" style={{ color: 'rgba(248,248,246,0.4)' }}>
            <Zap className="w-3.5 h-3.5" style={{ color: '#00e87a' }} />
            Circle CCTP V2 Fast Transfer
          </div>
          <span className="font-bold text-white/60">~20 min</span>
        </div>
      )}

      {/* Chain-specific gas warnings */}
      {chain === 'stellar' && (
        <p className="text-[10px] text-white/25 leading-relaxed">
          Requires ~0.1 XLM in your Stellar wallet for network fees.
        </p>
      )}
      {chain === 'solana' && (
        <p className="text-[10px] text-white/25 leading-relaxed">
          Requires ~0.001 SOL in your Solana wallet for network fees.
        </p>
      )}

      {/* Error */}
      {error && (
        <div
          className="p-3 rounded-xl text-xs font-semibold leading-relaxed wrap-break-word"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', overflowWrap: 'break-word', wordBreak: 'break-word' }}
        >
          {error}
        </div>
      )}

      {canBridge ? (
        <button
          onClick={onBridge}
          disabled={isExecuting || !bridgeAmt || parseFloat(bridgeAmt) < min}
          className="w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: meta.color, color: '#fff' }}
        >
          {isExecuting ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Bridging…</>
          ) : (
            <>Bridge {bridgeAmt || '—'} USDC to Base →</>
          )}
        </button>
      ) : (
        <button
          onClick={onReconnect}
          className="w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: meta.color, color: '#fff' }}
        >
          <Wallet className="w-4 h-4" />
          Reconnect Wallet
        </button>
      )}

      <button
        onClick={onRecheck}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold uppercase tracking-widest"
        style={{ color: 'rgba(248,248,246,0.25)' }}
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Re-check balance
      </button>
    </div>
  );
}

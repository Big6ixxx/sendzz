'use client';

import type { UseStellarDepositResult } from './useStellarDeposit';
import { AlertTriangle, ArrowRight, LogOut, Loader2, Wallet } from 'lucide-react';
import { BRIDGE_MIN_USDC, BackHeader, type ChainMeta, type FlowChain, type WalletConfig } from './deposit-shared';

interface DepositAmountStepProps {
  chain: FlowChain;
  meta: ChainMeta;
  walletConfig: WalletConfig | null;
  stellar: UseStellarDepositResult;
  solWalletAddr: string | null;
  amount: string;
  setAmount: (v: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onDisconnect?: () => void;
  error?: string;
}

// Stellar and Solana bridge directly from the user's connected wallet.
// EVM chains use a "deposit to address then bridge" flow instead.
const DIRECT_BRIDGE_CHAINS: FlowChain[] = ['stellar', 'solana'];

export function DepositAmountStep({
  chain,
  meta,
  walletConfig,
  stellar,
  solWalletAddr,
  amount,
  setAmount,
  onContinue,
  onBack,
  onDisconnect,
  error,
}: DepositAmountStepProps) {
  const min = BRIDGE_MIN_USDC[chain] ?? 1;
  const isDirectBridge = DIRECT_BRIDGE_CHAINS.includes(chain);

  // Balance available for direct-bridge chains (for validation and display).
  const availableBalance =
    chain === 'stellar' ? (stellar.balance ?? null) : null;

  const parsedAmount = parseFloat(amount || '0');
  const exceedsBalance = availableBalance !== null && parsedAmount > availableBalance;
  const belowMinimum = parsedAmount < min;
  const isDisabled = !amount || belowMinimum || exceedsBalance;

  const buttonLabel = isDirectBridge
    ? parsedAmount >= min && !exceedsBalance && amount
      ? `Bridge ${parsedAmount.toFixed(2)} USDC to Base`
      : 'Bridge to Base'
    : 'Show Deposit Address';

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400">
      <BackHeader
        chain={chain}
        onBack={onBack}
        subtitle={
          isDirectBridge ? 'Bridge to Base' :
          meta.isDirect ? 'No bridge needed' :
          undefined
        }
      />

      {walletConfig ? (
        /* ── Wallet connect gate ─────────────────────────────────────────── */
        <div className="space-y-4">
          {walletConfig.warning && (
            <div
              className="p-3 rounded-xl flex items-start gap-2"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
              <div className="space-y-1">
                <p className="text-[11px] font-bold" style={{ color: '#fbbf24' }}>
                  {walletConfig.warning.text}
                </p>
                {walletConfig.warning.link && (
                  <a
                    href={walletConfig.warning.link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] underline"
                    style={{ color: 'rgba(251,191,36,0.6)' }}
                  >
                    {walletConfig.warning.link.label}
                  </a>
                )}
              </div>
            </div>
          )}
          <div
            className="p-5 rounded-2xl text-center space-y-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <Wallet className="w-8 h-8 mx-auto" style={{ color: meta.color }} />
            <p className="text-sm font-semibold text-white/70">{walletConfig.description}</p>
          </div>
          <button
            onClick={walletConfig.onConnect}
            disabled={walletConfig.isConnecting}
            className="w-full py-3.5 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: meta.color, color: '#fff' }}
          >
            {walletConfig.isConnecting ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Connecting…</>
            ) : (
              <><Wallet className="w-4 h-4" />{walletConfig.label}</>
            )}
          </button>
          {walletConfig.error && (
            <p className="text-xs font-bold text-red-400 text-center">{walletConfig.error}</p>
          )}
        </div>
      ) : (
        /* ── Amount input ────────────────────────────────────────────────── */
        <div className="space-y-4">

          {/* Stellar wallet + balance */}
          {chain === 'stellar' && stellar.address && (
            <div
              className="p-3.5 rounded-xl flex items-center justify-between"
              style={{ background: meta.bg, border: `1px solid ${meta.border}` }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.35)' }}>
                  Freighter Wallet
                </p>
                <p className="text-xs font-mono mt-0.5" style={{ color: 'rgba(248,248,246,0.6)' }}>
                  {stellar.address.slice(0, 10)}…{stellar.address.slice(-6)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.35)' }}>
                    Available
                  </p>
                  {stellar.balanceLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5 ml-auto" style={{ color: meta.color }} />
                  ) : (
                    <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: '#00e87a' }}>
                      {(stellar.balance ?? 0).toFixed(2)} USDC
                    </p>
                  )}
                </div>
                {onDisconnect && (
                  <button
                    onClick={onDisconnect}
                    title="Disconnect wallet"
                    className="p-1.5 rounded-lg transition-all hover:bg-white/10"
                    style={{ color: 'rgba(248,248,246,0.3)' }}
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Solana wallet address */}
          {chain === 'solana' && solWalletAddr && (
            <div
              className="p-3.5 rounded-xl flex items-center justify-between"
              style={{ background: meta.bg, border: `1px solid ${meta.border}` }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.35)' }}>
                  Connected Wallet
                </p>
                <p className="text-xs font-mono mt-0.5" style={{ color: 'rgba(248,248,246,0.6)' }}>
                  {solWalletAddr.slice(0, 10)}…{solWalletAddr.slice(-6)}
                </p>
              </div>
              {onDisconnect && (
                <button
                  onClick={onDisconnect}
                  title="Disconnect wallet"
                  className="p-1.5 rounded-lg transition-all hover:bg-white/10"
                  style={{ color: 'rgba(248,248,246,0.3)' }}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Amount input */}
          <div>
            <label className="text-xs font-semibold block mb-2" style={{ color: 'rgba(248,248,246,0.4)' }}>
              {isDirectBridge ? 'How much USDC do you want to bridge?' : 'How much USDC are you depositing?'}
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
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="input-elegant pl-8 text-2xl font-bold w-full"
                autoFocus
              />
            </div>

            {/* Hints row */}
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px]" style={{ color: 'rgba(248,248,246,0.25)' }}>
                Minimum: ${min} USDC
              </p>
            </div>

            {/* Percentage presets */}
            {availableBalance !== null && availableBalance > 0 && (
              <div className="flex gap-2 mt-2 animate-in fade-in duration-300">
                {[20, 50, 75, 100].map((pct) => {
                  const calculated = ((availableBalance * pct) / 100).toFixed(2);
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setAmount(calculated)}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all bg-white/5 border border-white/10 hover:bg-white/10 text-white/60 hover:text-white"
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            )}

            {/* Over-balance error */}
            {exceedsBalance && availableBalance !== null && (
              <p className="text-[11px] mt-1 font-bold" style={{ color: '#ef4444' }}>
                Exceeds your balance of {availableBalance.toFixed(2)} USDC
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              className="p-3 rounded-xl text-xs font-semibold leading-relaxed wrap-break-word animate-in fade-in duration-300"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', overflowWrap: 'break-word', wordBreak: 'break-word' }}
            >
              {error}
            </div>
          )}

          <button
            onClick={onContinue}
            disabled={isDisabled}
            className="w-full py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: meta.color, color: '#fff' }}
          >
            {buttonLabel}
            {isDirectBridge && !isDisabled && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

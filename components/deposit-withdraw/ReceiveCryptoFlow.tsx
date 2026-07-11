'use client';

/**
 * ReceiveCryptoFlow — multichain "send USDC on any network" receive screen.
 *
 * Phase 1 of the multichain plan. Replaces the old bridge-to-Base deposit flow in
 * the deposit dialog. Because the Circle smart-account address is identical on every
 * EVM chain, ONE address + QR works for all supported EVM networks; whatever the user
 * sends — on any chain — is auto-counted by the portfolio scanner and shows up in the
 * unified balance. No bridging required.
 *
 * Power users who want to consolidate funds onto one chain can still do so via the
 * dedicated /dashboard/bridge page (linked at the bottom).
 */

import { truncateAddress } from '@/lib/utils';
import { ArrowRight, Copy, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ChainLogo } from './ChainLogo';

type Rail = 'evm' | 'solana' | 'stellar';

// EVM networks the single smart-account address can receive on (shared CREATE2 address).
const EVM_NETWORKS: { key: string; name: string }[] = [
  { key: 'base', name: 'Base' },
  { key: 'ethereum', name: 'Ethereum' },
  { key: 'polygon', name: 'Polygon' },
  { key: 'arbitrum', name: 'Arbitrum' },
  { key: 'optimism', name: 'Optimism' },
  { key: 'avalanche', name: 'Avalanche' },
];

interface ReceiveCryptoFlowProps {
  evmAddress: string;
  solanaAddress?: string;
  stellarAddress?: string;
  stellarTrustlineReady?: boolean;
  userId?: string;
  userEmail?: string;
}

export function ReceiveCryptoFlow({
  evmAddress,
  solanaAddress,
  stellarAddress,
  stellarTrustlineReady,
  userId,
  userEmail,
}: ReceiveCryptoFlowProps) {
  const [rail, setRail] = useState<Rail>('evm');
  const [localTrustlineReady, setLocalTrustlineReady] = useState<boolean | undefined>(undefined);
  const [isRetrying, setIsRetrying] = useState(false);

  const isTrustlineReady = localTrustlineReady !== undefined ? localTrustlineReady : stellarTrustlineReady;

  const address = rail === 'evm' ? evmAddress : rail === 'solana' ? solanaAddress ?? '' : stellarAddress ?? '';

  const handleRetry = async () => {
    if (!userId || !userEmail) return;
    setIsRetrying(true);
    try {
      const res = await fetch('/api/stellar/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId: userId, email: userEmail }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.trustlineReady) {
          setLocalTrustlineReady(true);
          toast.success("USDC trustline configured successfully!");
        } else {
          toast.error("Trustline setup is still pending on-chain. Please try again in a few seconds.");
        }
      } else {
        toast.error("Retrying setup failed. Please contact support.");
      }
    } catch (err) {
      console.error(err);
      toast.error("An unexpected error occurred.");
    } finally {
      setIsRetrying(false);
    }
  };

  const copy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    toast.success('Address copied');
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400">
      {/* Rail switcher */}
      <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5">
        <button
          onClick={() => setRail('evm')}
          className={
            'flex-1 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all ' +
            (rail === 'evm'
              ? 'bg-white/10 text-brand-secondary'
              : 'text-brand-secondary/40 hover:text-brand-secondary/60')
          }
        >
          EVM Networks
        </button>
        <button
          onClick={() => setRail('solana')}
          className={
            'flex-1 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all ' +
            (rail === 'solana'
              ? 'bg-white/10 text-brand-secondary'
              : 'text-brand-secondary/40 hover:text-brand-secondary/60')
          }
        >
          Solana
        </button>
        <button
          onClick={() => setRail('stellar')}
          className={
            'flex-1 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all ' +
            (rail === 'stellar'
              ? 'bg-white/10 text-brand-secondary'
              : 'text-brand-secondary/40 hover:text-brand-secondary/60')
          }
        >
          Stellar
        </button>
      </div>

      {/* Instruction banner */}
      <div
        className="px-4 py-3 rounded-2xl text-center"
        style={{ background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.2)' }}
      >
        <p className="text-sm font-bold" style={{ color: '#00e87a' }}>
          {rail === 'evm'
            ? 'Send USDC on any of these networks'
            : rail === 'solana'
            ? 'Send USDC on Solana'
            : 'Send USDC on Stellar'}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'rgba(248,248,246,0.4)' }}>
          It appears in your balance automatically — no bridging needed.
        </p>
      </div>

      {rail === 'solana' && !solanaAddress ? (
        <div
          className="p-6 rounded-3xl text-center text-sm"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(248,248,246,0.5)' }}
        >
          Your Solana wallet is still being set up. Please try again in a moment.
        </div>
      ) : rail === 'stellar' && !stellarAddress ? (
        <div
          className="p-6 rounded-3xl text-center text-sm"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(248,248,246,0.5)' }}
        >
          Your Stellar wallet is still being set up. Please try again in a moment.
        </div>
      ) : rail === 'stellar' && !isTrustlineReady ? (
        <div
          className="p-6 rounded-3xl text-center text-sm space-y-4"
          style={{ background: 'rgba(239,68,68,0.03)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
        >
          <p className="font-bold text-base">⚠️ Stellar USDC Deposits Disabled</p>
          <p className="text-xs leading-relaxed text-red-300">
            Your Stellar wallet's USDC trustline setup is currently pending on-chain. To protect your assets, deposits have been temporarily disabled.
          </p>
          
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="flex items-center gap-1.5 mx-auto text-xs font-bold uppercase tracking-widest py-2.5 px-5 rounded-xl transition-all disabled:opacity-50 hover:bg-red-500/10"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            {isRetrying ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Retrying Setup...
              </>
            ) : (
              'Retry Trustline Setup'
            )}
          </button>
          
          <p className="text-[11px]" style={{ color: 'rgba(248,248,246,0.4)' }}>
            If retrying fails, please contact support to resolve this issue.
          </p>
        </div>
      ) : (
        <>
          {/* QR + Address */}
          <div
            className="p-5 rounded-3xl flex flex-col items-center space-y-4"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="p-3 bg-white rounded-2xl shadow-lg">
              <QRCodeSVG value={address} size={160} level="M" fgColor="#07070a" bgColor="#ffffff" />
            </div>
            <div className="w-full text-center space-y-2">
              <p className="text-sm font-mono font-medium break-all leading-relaxed" style={{ color: '#f8f8f6' }}>
                {truncateAddress(address, 12, 8)}
              </p>
              <button
                onClick={copy}
                className="flex items-center gap-1.5 mx-auto text-xs font-bold uppercase tracking-widest py-2 px-4 rounded-xl transition-all hover:opacity-80"
                style={{ background: 'rgba(0,232,122,0.1)', color: '#00e87a', border: '1px solid rgba(0,232,122,0.2)' }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Full Address
              </button>
            </div>
          </div>

          {/* Supported networks */}
          {rail === 'evm' && (
            <div className="space-y-2">
              <p
                className="text-[10px] font-bold uppercase tracking-[0.2em] px-1"
                style={{ color: 'rgba(248,248,246,0.3)' }}
              >
                Works on these networks
              </p>
              <div className="grid grid-cols-3 gap-2">
                {EVM_NETWORKS.map((n) => (
                  <div
                    key={n.key}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <ChainLogo chain={n.key} size={18} />
                    <span className="text-xs font-medium" style={{ color: 'rgba(248,248,246,0.7)' }}>
                      {n.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Network warning */}
          <div
            className="flex items-start gap-2.5 p-3 rounded-xl"
            style={{ background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.15)' }}
          >
            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: '#fb923c' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(251,146,60,0.9)' }}>
              <strong>Only send USDC</strong>
              {rail === 'evm'
                ? ' on one of the networks above. '
                : rail === 'solana'
                ? ' on the Solana network. '
                : ' on the Stellar network. '}
              Sending other tokens or using an unsupported network may result in permanent loss.
            </p>
          </div>
        </>
      )}

      {/* Power-user consolidation path */}
      <Link
        href="/dashboard/bridge"
        className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-widest py-2 transition-colors"
        style={{ color: 'rgba(248,248,246,0.35)' }}
      >
        Have funds in another wallet? Move them
        <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

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
import { isStellarReady, useActivateStellar } from '@/hooks/useStellarWallet';
import { SOLANA_RECEIVE_ENABLED } from '@/lib/circle/gateway';

type Rail = 'evm' | 'solana' | 'stellar';

/**
 * The rails a user can be given an address on.
 *
 * Solana is behind SOLANA_RECEIVE_ENABLED (lib/circle/gateway) while it is being finished.
 * Listed rather than hard-coded as three buttons so turning it back on is one flag, and so
 * the tab, the address, the QR and the warning copy can never disagree about what is offered.
 */
const RAILS: { key: Rail; label: string }[] = [
  { key: 'evm', label: 'EVM Networks' },
  ...(SOLANA_RECEIVE_ENABLED ? [{ key: 'solana' as Rail, label: 'Solana' }] : []),
  { key: 'stellar', label: 'Stellar' },
];

// EVM networks the single smart-account address can receive on (shared CREATE2 address).
// Ethereum L1 commented out — see BRIDGE_DISABLED_CHAINS in lib/circle/gateway. Deposits
// there would be tracked nowhere and movable by nothing, so we don't advertise the
// network even though the address itself can still technically receive on it.
const EVM_NETWORKS: { key: string; name: string }[] = [
  { key: 'base', name: 'Base' },
  // { key: 'ethereum', name: 'Ethereum' },
  { key: 'polygon', name: 'Polygon' },
  { key: 'arbitrum', name: 'Arbitrum' },
  { key: 'optimism', name: 'Optimism' },
  { key: 'avalanche', name: 'Avalanche' },
  { key: 'arc', name: 'Arc' },
];

interface ReceiveCryptoFlowProps {
  evmAddress: string;
  solanaAddress?: string;
  stellarAddress?: string;
  stellarTrustlineReady?: boolean;
}

export function ReceiveCryptoFlow({
  evmAddress,
  solanaAddress,
  stellarAddress,
  stellarTrustlineReady,
}: ReceiveCryptoFlowProps) {
  const [rail, setRail] = useState<Rail>('evm');
  const [activating, setActivating] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const activateStellar = useActivateStellar();

  const stellarReady = !!stellarAddress && !!stellarTrustlineReady;
  const address = rail === 'evm' ? evmAddress : rail === 'solana' ? solanaAddress ?? '' : stellarAddress ?? '';

  // Stellar is opt-in: nothing is created or activated until the user presses this.
  const handleActivate = async () => {
    setActivating(true);
    setActivationFailed(false);
    try {
      const wallet = await activateStellar();
      if (isStellarReady(wallet)) toast.success('Your Stellar address is ready to receive USDC.');
      else setActivationFailed(true);
    } catch (err) {
      console.error('[Receive] Stellar activation failed:', err);
      setActivationFailed(true);
    } finally {
      setActivating(false);
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
        {RAILS.map((r) => (
          <button
            key={r.key}
            onClick={() => setRail(r.key)}
            className={
              'flex-1 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all ' +
              (rail === r.key
                ? 'bg-white/10 text-brand-secondary'
                : 'text-brand-secondary/40 hover:text-brand-secondary/60')
            }
          >
            {r.label}
          </button>
        ))}
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
      ) : rail === 'stellar' && !stellarReady ? (
        <div
          className="p-6 rounded-3xl text-center space-y-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <ChainLogo chain="stellar" size={40} />
          <div className="space-y-1.5">
            <p className="font-bold text-base text-brand-secondary">Activate your Stellar address</p>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(248,248,246,0.5)' }}>
              Only needed if you want to receive USDC on Stellar. It&apos;s free and takes a few
              seconds. Your other networks work without it.
            </p>
          </div>
          <button
            onClick={handleActivate}
            disabled={activating}
            className="btn-accent mx-auto inline-flex h-11 items-center gap-2 rounded-xl px-5 text-xs font-bold uppercase tracking-widest disabled:opacity-60"
          >
            {activating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Activating…
              </>
            ) : activationFailed ? (
              'Try again'
            ) : (
              'Activate Stellar address'
            )}
          </button>
          {activationFailed && (
            <p className="text-[11px] leading-relaxed" style={{ color: '#f87171' }}>
              Activation didn&apos;t finish. Please try again, or contact support if it keeps
              happening. Don&apos;t send anything to Stellar until your address shows here.
            </p>
          )}
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

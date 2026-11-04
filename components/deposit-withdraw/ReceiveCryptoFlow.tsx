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

import { cn, truncateAddress } from '@/lib/utils';
import { ArrowRight, Copy } from 'lucide-react';
import { FlowButton, FlowFrame, FlowLabel, Notice } from '@/components/flow/ui';
import { QRCodeSVG } from 'qrcode.react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ChainLogo } from './ChainLogo';
import { isStellarReady, useActivateStellar } from '@/hooks/useStellarWallet';
import { useEnsureSolanaWallet } from '@/hooks/useEnsureSolanaWallet';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';

type Rail = 'evm' | 'solana' | 'stellar';

/**
 * The rails a user can be given an address on.
 *
 * Listed rather than hard-coded as three buttons so the tab, the address, the QR and the
 * warning copy can never disagree about what is offered.
 */
const RAILS: { value: Rail; label: string }[] = [
  { value: 'evm', label: 'EVM' },
  { value: 'solana', label: 'Solana' },
  { value: 'stellar', label: 'Stellar' },
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
  solanaAddress: solanaAddressProp,
  stellarAddress,
  stellarTrustlineReady,
}: ReceiveCryptoFlowProps) {
  const [rail, setRail] = useState<Rail>('evm');
  const [activating, setActivating] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const activateStellar = useActivateStellar();
  // Creates the embedded Solana wallet for users who signed in before it was handed out at
  // login — without it this screen said "still being set up" forever. See the hook.
  const solanaWallet = useEnsureSolanaWallet();
  const solanaAddress = solanaAddressProp || solanaWallet.address;

  const stellarReady = !!stellarAddress && !!stellarTrustlineReady;
  const address = rail === 'evm' ? evmAddress : rail === 'solana' ? (solanaAddress ?? '') : (stellarAddress ?? '');

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

  const networkName = rail === 'evm' ? 'EVM networks' : rail === 'solana' ? 'Solana' : 'Stellar';
  const panel = 'lp-card rounded-[24px] p-5';

  const settingUp = (rail === 'solana' && !solanaAddress) || (rail === 'stellar' && !stellarReady);

  return (
    <FlowFrame
      main={
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400">
          {/* Chips with each network's mark, so this reads as a second, smaller choice under the
          bank-or-wallet tabs rather than a repeat of them. */}
          <div>
            <FlowLabel>Network</FlowLabel>
            <div className="mt-2 flex gap-1.5" role="tablist" aria-label="Network">
              {RAILS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="tab"
                  aria-selected={rail === r.value}
                  onClick={() => setRail(r.value)}
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-1 pr-3 text-[13px] font-semibold transition-colors duration-150 sm:gap-2 sm:py-1.5 sm:pl-1.5 sm:pr-4 sm:text-[14px]',
                    rail === r.value
                      ? 'bg-[var(--lp-ink)] text-[var(--lp-cream)]'
                      : 'bg-[var(--lp-surface)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)]',
                  )}
                >
                  {r.value === 'evm' ? (
                    // Several networks share the one EVM address, so the chip shows a few of their marks.
                    <span className="flex -space-x-2">
                      {['base', 'polygon', 'arbitrum'].map((c) => (
                        <span key={c} className="rounded-full ring-2 ring-white">
                          <ChainLogo chain={c} size={18} />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <ChainLogo chain={r.value} size={22} />
                  )}
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {settingUp ? (
            rail === 'solana' && !solanaAddress ? (
              <div className={`${panel} space-y-4 text-center`}>
                {solanaWallet.status === 'failed' ? (
                  <>
                    <p className="text-[15px] leading-[1.5] text-[var(--lp-body)]">
                      We couldn&apos;t set up your Solana wallet. Don&apos;t send anything to Solana until your address shows here.
                    </p>
                    <FlowButton onClick={solanaWallet.retry}>Try again</FlowButton>
                  </>
                ) : (
                  <SkeletonGroup label="Setting up your Solana wallet" className="flex flex-col items-center gap-4 py-2">
                    <Skeleton className="size-[176px] rounded-[16px]" />
                    <Skeleton className="h-3.5 w-56" />
                    <p className="text-[14px] text-[var(--lp-muted)]">Setting up your Solana wallet</p>
                  </SkeletonGroup>
                )}
              </div>
            ) : rail === 'stellar' && !stellarReady ? (
              <div className={`${panel} space-y-4 text-center`}>
                <div className="flex justify-center">
                  <ChainLogo chain="stellar" size={44} />
                </div>
                <div>
                  <p className="lp-display text-[24px] font-semibold tracking-[-0.02em]">
                    Activate <span className="lp-serif font-normal">Stellar.</span>
                  </p>
                  <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-[1.5] text-[var(--lp-body)]">
                    Only needed to receive USDC on Stellar. It&apos;s free and takes a few seconds. Your other networks work without it.
                  </p>
                </div>
                <FlowButton tone="accent" onClick={handleActivate} loading={activating}>
                  {activationFailed ? 'Try again' : 'Activate my Stellar address'}
                </FlowButton>
                {activationFailed && (
                  <p className="text-[13px] leading-[1.5] text-[var(--lp-danger)]">
                    Activation didn&apos;t finish. Please try again, or contact support if it keeps happening. Don&apos;t send anything to
                    Stellar until your address shows here.
                  </p>
                )}
              </div>
            ) : null
          ) : (
            <>
              {rail === 'evm' && (
                <div>
                  <FlowLabel>Works on these networks</FlowLabel>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {EVM_NETWORKS.map((n) => (
                      <span
                        key={n.key}
                        className="lp-card flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5"
                      >
                        <ChainLogo chain={n.key} size={22} />
                        <span className="text-[14px] font-medium">{n.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <Notice tone="warning" title="Only send USDC">
                {rail === 'evm'
                  ? 'On one of the networks above.'
                  : rail === 'solana'
                    ? 'On the Solana network.'
                    : 'On the Stellar network.'}{' '}
                Other tokens, or an unsupported network, can be lost for good.
              </Notice>
            </>
          )}

        </div>
      }
      aside={
        settingUp ? undefined : (
          <div className="text-center">
            <p className="lp-mono text-[12px] uppercase text-[var(--lp-green)]">Your address</p>
            <p className="lp-display mt-2 text-[clamp(26px,6vw,32px)] leading-[1] tracking-[-0.03em]">
              Send USDC <span className="lp-serif tracking-[-0.01em] text-[#cfe0d6]">on {networkName}</span>
            </p>
            {/* Pinned light in both modes: a scanner needs dark modules on a light ground. */}
            <div className="lp-fixed mx-auto mt-6 w-fit rounded-[24px] bg-[var(--lp-cream)] p-4">
              <div className="rounded-[16px] bg-[var(--lp-surface)] p-3">
                <QRCodeSVG value={address} size={176} level="M" fgColor="#111a13" bgColor="#ffffff" />
              </div>
            </div>
            <p className="lp-mono mt-5 break-all text-[14px] leading-relaxed text-[#cfe0d6]">{truncateAddress(address, 12, 8)}</p>
            <p className="mt-2 text-[13px] text-[#a9c2b5]">It lands in your balance by itself. No bridging needed.</p>
          </div>
        )
      }
      action={
        <div className="space-y-3">
          {!settingUp && (
            <FlowButton tone="accent" onClick={copy}>
              <Copy className="size-5" /> Copy address
            </FlowButton>
          )}
          {/* At the foot of the dialog, the last thing read: the way to move funds already held
              elsewhere. It takes the colour of where it sits, the forest panel or the cream bar. */}
          <Link
            href="/dashboard/bridge"
            className="flex items-center justify-center gap-1.5 text-[14px] font-semibold opacity-80 transition-opacity hover:opacity-100"
          >
            Have funds in another wallet? Move them <ArrowRight className="size-4" />
          </Link>
        </div>
      }
    />
  );
}

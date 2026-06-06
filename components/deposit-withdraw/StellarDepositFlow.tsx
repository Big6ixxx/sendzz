'use client';

/**
 * StellarDepositFlow
 *
 * Fully self-contained Stellar CCTP V2 bridge flow.
 * Bridge path: Stellar USDC → (Freighter signs) → Circle attestation → Base USDC
 *
 * Steps: amount → bridging → success
 *
 * ⚠️  This component is intentionally isolated from EVM and Solana flows.
 *     Do NOT import anything from EvmDepositFlow or SolanaDepositFlow here.
 */

import {
  recordBridgeTransaction,
  updateBridgeStatus,
} from '@/lib/supabase/transactions';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DepositAmountStep } from './DepositAmountStep';
import {
  BridgeSuccess,
  BridgingMonitor,
  CHAIN_META,
  type FlowChain,
  type WalletConfig,
} from './deposit-shared';
import { useStellarDeposit } from './useStellarDeposit';

// ─── Types ────────────────────────────────────────────────────────────────────

type StellarStep = 'amount' | 'bridging' | 'success';

// ─── Component ────────────────────────────────────────────────────────────────

interface StellarDepositFlowProps {
  userAddress: string;
  handleClose: () => void;
  onBack: () => void;
}

export function StellarDepositFlow({
  userAddress,
  handleClose,
  onBack,
}: StellarDepositFlowProps) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const stellar = useStellarDeposit();
  const queryClient = useQueryClient();

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');

  const [step, setStep] = useState<StellarStep>('amount');
  const [amount, setAmount] = useState('');
  const [bridgeAmt, setBridgeAmt] = useState('');
  const [burnTxHash, setBurnTxHash] = useState('');
  const [mintTxHash, setMintTxHash] = useState('');
  const [monitorMsg, setMonitorMsg] = useState('');
  const [error, setError] = useState('');

  const chain: FlowChain = 'stellar';
  const meta = CHAIN_META[chain];

  // Clear error on amount change
  useEffect(() => { setError(''); }, [amount]);

  // ─── Attestation polling ────────────────────────────────────────────────────

  const pollAttestation = useCallback(async (hash: string) => {
    let attempts = 0;
    const poll = async (): Promise<void> => {
      attempts++;
      if (attempts > 360) {
        setMonitorMsg(
          'Taking longer than expected — your USDC will arrive automatically. You can close this window.',
        );
        return;
      }
      try {
        const res = await fetch(
          `/api/bridge/status?txHash=${hash}&sourceChain=stellar`,
        );
        const data = await res.json();
        if (data.status === 'complete') {
          let mHash = data.mintTxHash ?? '';

          // Stellar has no auto-relayer — we gaslessly submit receiveMessage on Base
          if (!mHash && data.attestation && data.messageBytes) {
            if (!embeddedWallet) {
              throw new Error(
                'EVM wallet not connected. Please connect to finalise the bridge on Base.',
              );
            }
            setMonitorMsg('Finalizing transfer on Base (gasless)...');
            const { executeReceiveMessage } = await import(
              '@/lib/web3/bridge-actions'
            );
            mHash = await executeReceiveMessage(
              embeddedWallet,
              data.messageBytes,
              data.attestation,
            );
          }

          setMintTxHash(mHash);
          await updateBridgeStatus(hash, 'complete', mHash);
          queryClient.invalidateQueries({ queryKey: ['history'] });
          queryClient.invalidateQueries({ queryKey: ['balance'] });
          toast.success('USDC bridged to Base!');
          setStep('success');
          return;
        }
        setMonitorMsg(
          `Waiting for Circle attestation... (${attempts * 5}s elapsed)`,
        );
        setTimeout(poll, 5000);
      } catch (err) {
        console.error('[StellarDepositFlow] pollAttestation error:', err);
        setTimeout(poll, 10000);
      }
    };
    await poll();
  }, [queryClient, embeddedWallet]);

  // ─── Bridge execution ───────────────────────────────────────────────────────

  const getFriendlyError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rejected|cancelled|cancel/i.test(msg)) return 'Transaction cancelled.';
    if (/insufficient|balance/i.test(msg))
      return 'Insufficient USDC or XLM for fees.';
    if (/account not found/i.test(msg))
      return 'Stellar account not found. Your Freighter wallet needs at least 1 XLM as a minimum reserve.';
    if (/no trustline|no trust|trustline/i.test(msg))
      return 'Your Stellar account has no USDC trustline. Add the Circle USDC asset in Freighter first.';
    if (/network|fetch|timeout|ECONNREFUSED/i.test(msg))
      return 'Network error. Check your connection and try again.';
    return 'Bridge failed. Please try again.';
  };

  const handleBridge = async (amountOverride?: string) => {
    const amountToUse = amountOverride ?? bridgeAmt;
    setBridgeAmt(amountToUse);
    setStep('bridging');

    let capturedHash = '';
    try {
      await stellar.executeBridge({
        amount: amountToUse,
        userAddress,
        onStatusUpdate: setMonitorMsg,
        onBurnTxHash: async (hash) => {
          capturedHash = hash;
          setBurnTxHash(hash);
          await recordBridgeTransaction({
            userEmail: user?.email?.address ?? '',
            sourceChain: 'stellar' as never,
            destChain: 'base',
            amountUsdc: parseFloat(amountToUse) || 0,
            burnTxHash: hash,
          });
          queryClient.invalidateQueries({ queryKey: ['history'] });
          setMonitorMsg('Waiting for Circle attestation...');
        },
      });
      await pollAttestation(capturedHash);
    } catch (err) {
      console.error('[StellarDepositFlow] bridge error:', err);
      setError(getFriendlyError(err));
      setStep('amount');
    }
  };

  // ─── Wallet gate ────────────────────────────────────────────────────────────

  const walletConfig: WalletConfig | null = !stellar.address
    ? {
        label: 'Connect Freighter Wallet',
        description:
          'Connect Freighter to get your Stellar deposit address.',
        onConnect: stellar.connect,
        isConnecting: stellar.isConnecting,
        warning: stellar.freighterMissing
          ? {
              text: 'Freighter not detected.',
              link: {
                href: 'https://www.freighter.app/',
                label: 'Install Freighter →',
              },
            }
          : null,
        error: stellar.error,
      }
    : null;

  // ─── Step rendering ─────────────────────────────────────────────────────────

  if (step === 'amount') {
    return (
      <DepositAmountStep
        chain={chain}
        meta={meta}
        walletConfig={walletConfig}
        stellar={stellar}
        solWalletAddr={null}
        amount={amount}
        setAmount={setAmount}
        onContinue={() => void handleBridge(amount)}
        onBack={() => { setError(''); onBack(); }}
        onDisconnect={() => { setError(''); stellar.disconnect(); }}
        error={error}
      />
    );
  }

  if (step === 'bridging') {
    return (
      <BridgingMonitor
        chain={chain}
        monitorMsg={monitorMsg}
        burnTxHash={burnTxHash}
      />
    );
  }

  if (step === 'success') {
    return (
      <BridgeSuccess
        bridgeAmt={bridgeAmt}
        mintTxHash={mintTxHash}
        isDirect={false}
        onClose={handleClose}
      />
    );
  }

  return null;
}

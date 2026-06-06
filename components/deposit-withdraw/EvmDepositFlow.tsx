'use client';

/**
 * EvmDepositFlow
 *
 * Fully self-contained EVM CCTP V2 bridge flow.
 * Handles all EVM source chains: arbitrum, ethereum, optimism, polygon, avalanche, base-direct.
 *
 * Bridge path (non-direct chains):
 *   User sends USDC to their smart address on source chain
 *   → We poll for balance
 *   → User clicks "Bridge" → Privy signs via Circle smart account (AA)
 *   → Circle attestation → Base USDC
 *
 * Base-direct: no bridge needed — address shown, success immediately.
 *
 * Steps: amount → address → waiting → bridge-ready → bridging → success
 *
 * ⚠️  This component is intentionally isolated from Stellar and Solana flows.
 *     Do NOT import anything from StellarDepositFlow or SolanaDepositFlow here.
 */

import {
  USDC_ADDRESSES,
  type SupportedChain,
} from '@/lib/circle/gateway';
import {
  recordBridgeTransaction,
  updateBridgeStatus,
} from '@/lib/supabase/transactions';
import { VIEM_CHAINS } from '@/lib/web3/multichain';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createPublicClient, http, parseAbi } from 'viem';
import { DepositAddressStep } from './DepositAddressStep';
import { DepositAmountStep } from './DepositAmountStep';
import { DepositBridgeReadyStep } from './DepositBridgeReadyStep';
import { DepositWaitingStep } from './DepositWaitingStep';
import {
  BridgeSuccess,
  BridgingMonitor,
  CHAIN_META,
  type FlowChain,
} from './deposit-shared';

// ─── Types ────────────────────────────────────────────────────────────────────

type EvmStep =
  | 'amount'
  | 'address'
  | 'waiting'
  | 'bridge-ready'
  | 'bridging'
  | 'success';

// ─── Component ────────────────────────────────────────────────────────────────

interface EvmDepositFlowProps {
  chain: FlowChain;
  userAddress: string;
  handleClose: () => void;
  onBack: () => void;
}

export function EvmDepositFlow({
  chain,
  userAddress,
  handleClose,
  onBack,
}: EvmDepositFlowProps) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');

  const meta = CHAIN_META[chain];
  const evmChain = (chain === 'base-direct' ? 'base' : chain) as SupportedChain;

  const [step, setStep] = useState<EvmStep>(meta?.isDirect ? 'address' : 'amount');
  const [amount, setAmount] = useState('');
  const [detectedBalance, setDetectedBalance] = useState(0);
  const [bridgeAmt, setBridgeAmt] = useState('');
  const [pollSecs, setPollSecs] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [burnTxHash, setBurnTxHash] = useState('');
  const [mintTxHash, setMintTxHash] = useState('');
  const [monitorMsg, setMonitorMsg] = useState('');
  const [error, setError] = useState('');


  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // Clear error on amount or chain change
  useEffect(() => { setError(''); }, [amount, chain]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  // ─── Balance checker ─────────────────────────────────────────────────────────

  const checkBalance = useCallback(async (): Promise<number> => {
    const client = createPublicClient({
      chain: VIEM_CHAINS[evmChain],
      transport: http(),
    });
    const raw = await client.readContract({
      address: USDC_ADDRESSES[evmChain] as `0x${string}`,
      abi: parseAbi(['function balanceOf(address) returns (uint256)']),
      functionName: 'balanceOf',
      args: [userAddress as `0x${string}`],
    });
    return Number(raw) / 1e6;
  }, [evmChain, userAddress]);

  // ─── Balance polling ──────────────────────────────────────────────────────────

  const startPolling = useCallback(() => {
    setStep('waiting');
    setPollSecs(0);
    setDetectedBalance(0);
    setError('');
    if (pollingRef.current) clearTimeout(pollingRef.current);

    let elapsed = 0;
    const MAX_SEC = 900;

    const tick = async () => {
      elapsed += 5;
      setPollSecs(elapsed);
      try {
        const bal = await checkBalance();
        if (bal >= 0.01) {
          setDetectedBalance(bal);
          setBridgeAmt(bal.toFixed(2));
          setStep('bridge-ready');
          return;
        }
      } catch {
        /* continue on transient errors */
      }
      if (elapsed < MAX_SEC) pollingRef.current = setTimeout(tick, 5000);
    };
    pollingRef.current = setTimeout(tick, 5000);
  }, [checkBalance]);

  // ─── Attestation polling ──────────────────────────────────────────────────────

  const pollAttestation = useCallback(
    async (hash: string) => {
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
            `/api/bridge/status?txHash=${hash}&sourceChain=${chain}`,
          );
          const data = await res.json();
          if (data.status === 'complete') {
            const mHash = data.mintTxHash ?? '';
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
          console.error('[EvmDepositFlow] pollAttestation error:', err);
          setTimeout(poll, 10000);
        }
      };
      await poll();
    },
    [queryClient, chain],
  );

  // ─── Bridge execution ─────────────────────────────────────────────────────────

  const getFriendlyError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rejected|cancelled|cancel/i.test(msg)) return 'Transaction cancelled.';
    if (/insufficient|balance/i.test(msg))
      return `Insufficient USDC or ${meta?.name ?? 'chain'} gas token for fees.`;
    if (/network|fetch|timeout|ECONNREFUSED/i.test(msg))
      return 'Network error. Check your connection and try again.';
    return 'Bridge failed. Please try again.';
  };

  const handleBridge = async () => {
    if (!embeddedWallet) return;
    setIsExecuting(true);
    setStep('bridging');
    setMonitorMsg('Preparing gasless bridge...');
    try {
      const { executeSmartBridge } = await import('@/lib/web3/bridge-actions');
      const { txHashPromise } = await executeSmartBridge(
        embeddedWallet,
        evmChain,
        bridgeAmt,
        userAddress,
      );
      
      setMonitorMsg('Broadcasting gasless transaction on-chain...');
      const burnTxHash = await txHashPromise;
      
      setBurnTxHash(burnTxHash);

      await recordBridgeTransaction({
        userEmail: user?.email?.address ?? '',
        sourceChain: evmChain,
        destChain: 'base',
        amountUsdc: parseFloat(bridgeAmt) || 0,
        burnTxHash: burnTxHash,
      });
      queryClient.invalidateQueries({ queryKey: ['history'] });

      setMonitorMsg('Transaction submitted. Waiting for Circle attestation...');
      await pollAttestation(burnTxHash);
    } catch (err) {
      setError(getFriendlyError(err));
      setStep('bridge-ready');
    } finally {
      setIsExecuting(false);
    }
  };

  // ─── Step rendering ───────────────────────────────────────────────────────────

  if (!meta) return null;

  if (step === 'amount') {
    return (
      <DepositAmountStep
        chain={chain}
        meta={meta}
        walletConfig={null}
        stellar={
          // Provide a no-op stellar object — EVM flow never renders stellar UI
          {
            address: '',
            balance: null,
            balanceLoading: false,
            isConnecting: false,
            freighterMissing: false,
            error: '',
            connect: async () => {},
            disconnect: () => {},
            refreshBalance: async () => {},
            checkBalance: async () => 0,
            executeBridge: async () => {},
          }
        }
        solWalletAddr={null}
        amount={amount}
        setAmount={setAmount}
        onContinue={
          meta.isDirect ? () => setStep('success') : () => setStep('address')
        }
        onBack={() => { setError(''); onBack(); }}
        error={error}
      />
    );
  }

  if (step === 'address') {
    return (
      <DepositAddressStep
        chain={chain}
        meta={meta}
        depositAddress={userAddress}
        amount={amount}
        onSentIt={meta.isDirect ? () => setStep('success') : startPolling}
        onBack={() => meta.isDirect ? onBack() : setStep('amount')}
        onCopy={() => copyToClipboard(userAddress, 'Address')}
      />
    );
  }

  if (step === 'waiting') {
    return (
      <DepositWaitingStep
        chain={chain}
        meta={meta}
        depositAddress={userAddress}
        amount={amount}
        pollSecs={pollSecs}
        onBack={() => setStep('address')}
      />
    );
  }

  if (step === 'bridge-ready') {
    return (
      <DepositBridgeReadyStep
        chain={chain}
        meta={meta}
        detectedBalance={detectedBalance}
        bridgeAmt={bridgeAmt}
        setBridgeAmt={setBridgeAmt}
        canBridge={!!embeddedWallet}
        isExecuting={isExecuting}
        error={error}
        onBridge={() => void handleBridge()}
        onReconnect={() => {}}
        onRecheck={() => {
          setDetectedBalance(0);
          startPolling();
        }}
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
        isDirect={!!meta.isDirect}
        onClose={handleClose}
      />
    );
  }

  return null;
}

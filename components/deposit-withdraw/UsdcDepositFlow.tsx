'use client';

/**
 * UsdcDepositFlow
 *
 * Multi-step USDC deposit flow supporting all Circle CCTP V2 chains:
 *   EVM (Arbitrum, Ethereum, Optimism, Polygon, Avalanche)
 *   Solana  — Circle CCTP V2, domain 5
 *   Stellar — Circle CCTP V2, domain 27
 *   Base    — Direct deposit (no bridge required)
 *
 * Steps: chain-select → amount → address → waiting → bridge-ready → bridging → success
 *
 * This file owns all state and async logic. Rendering is delegated to step
 * components in the same directory.
 */

import {
  USDC_ADDRESSES,
  fetchCctpFees,
  type SupportedChain,
} from '@/lib/circle/gateway';
import {
  buildDepositForBurnTx,
  getSolanaUsdcBalance,
  SOLANA_CCTP_DOMAIN,
} from '@/lib/circle/solana-gateway';
import {
  recordBridgeTransaction,
  updateBridgeStatus,
} from '@/lib/supabase/transactions';
import { VIEM_CHAINS } from '@/lib/web3/multichain';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  useSignAndSendTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana';
import { useQueryClient } from '@tanstack/react-query';
import { Connection, PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createPublicClient, http, parseAbi } from 'viem';
import { DepositAddressStep } from './DepositAddressStep';
import { DepositAmountStep } from './DepositAmountStep';
import { DepositBridgeReadyStep } from './DepositBridgeReadyStep';
import { DepositChainSelectStep } from './DepositChainSelectStep';
import { DepositWaitingStep } from './DepositWaitingStep';
import {
  BRIDGE_MIN_USDC,
  CHAIN_META,
  BridgeSuccess,
  BridgingMonitor,
  type FlowChain,
  type WalletConfig,
} from './deposit-shared';
import { useStellarDeposit } from './useStellarDeposit';

export { BRIDGE_MIN_USDC };

// ─── Types ────────────────────────────────────────────────────────────────────

type DepositStep =
  | 'chain-select'
  | 'amount'
  | 'address'
  | 'waiting'
  | 'bridge-ready'
  | 'bridging'
  | 'success';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

function toBase58(bytes: Uint8Array): string {
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let carry: number;
  const digits: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHA[digits[i]];
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface UsdcDepositFlowProps {
  userAddress: string;
  handleClose: () => void;
}

export function UsdcDepositFlow({ userAddress, handleClose }: UsdcDepositFlowProps) {
  const { user, connectWallet } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const stellar = useStellarDeposit();
  const queryClient = useQueryClient();

  const solConn = useRef(new Connection(SOLANA_RPC, 'confirmed'));
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [step, setStep] = useState<DepositStep>('chain-select');
  const [chain, setChain] = useState<FlowChain | null>(null);
  const [amount, setAmount] = useState('');
  const [detectedBalance, setDetectedBalance] = useState(0);
  const [bridgeAmt, setBridgeAmt] = useState('');
  const [pollSecs, setPollSecs] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [burnTxHash, setBurnTxHash] = useState('');
  const [mintTxHash, setMintTxHash] = useState('');
  const [monitorMsg, setMonitorMsg] = useState('');
  const [error, setError] = useState('');
  const [solanaFeeSubunits, setSolanaFeeSubunits] = useState<bigint>(0n);

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
  const solWallet = (solanaWallets[0] ?? null) as ConnectedStandardSolanaWallet | null;

  const meta = chain ? CHAIN_META[chain] : null;

  const depositAddress =
    chain === 'solana' ? (solWallet?.address ?? '') :
    chain === 'stellar' ? stellar.address :
    userAddress;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  // ─── Wallet gate ──────────────────────────────────────────────────────────

  const needsWallet =
    (chain === 'solana' && !solWallet) ||
    (chain === 'stellar' && !stellar.address);

  const walletConfig: WalletConfig | null = needsWallet
    ? chain === 'stellar'
      ? {
          label: 'Connect Freighter Wallet',
          description: 'Connect Freighter to get your Stellar deposit address.',
          onConnect: stellar.connect,
          isConnecting: stellar.isConnecting,
          warning: stellar.freighterMissing
            ? { text: 'Freighter not detected.', link: { href: 'https://www.freighter.app/', label: 'Install Freighter →' } }
            : null,
          error: stellar.error,
        }
      : {
          label: 'Connect Solana Wallet',
          description: 'Connect Phantom, Backpack, or Solflare to get your Solana deposit address.',
          onConnect: connectWallet,
          isConnecting: false,
          warning: null,
          error: '',
        }
    : null;

  // ─── Solana fee pre-calculation ───────────────────────────────────────────

  useEffect(() => {
    if (chain !== 'solana' || !amount || parseFloat(amount) <= 0) return;
    const [whole, frac = ''] = amount.split('.');
    const frac6 = (frac + '000000').slice(0, 6);
    const amtSubunits = BigInt(whole + frac6);
    fetchCctpFees(SOLANA_CCTP_DOMAIN, 6)
      .then((fees) => {
        const fast = fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
        const fee = (amtSubunits * BigInt(Math.round(fast.minimumFee * 100))) / 1_000_000n;
        setSolanaFeeSubunits((fee * 120n) / 100n);
      })
      .catch(() => {});
  }, [chain, amount]);

  useEffect(() => {
    return () => { if (pollingRef.current) clearTimeout(pollingRef.current); };
  }, []);

  // Clear any bridge execution error when amount or chain changes
  useEffect(() => {
    setError('');
  }, [amount, chain]);

  // ─── Unified balance checker ──────────────────────────────────────────────

  const checkBalance = useCallback(async (): Promise<number> => {
    if (!chain) return 0;

    if (chain === 'solana') {
      if (!solWallet) return 0;
      return getSolanaUsdcBalance(solConn.current, new PublicKey(solWallet.address));
    }

    if (chain === 'stellar') return stellar.checkBalance();

    const evmChain = (chain === 'base-direct' ? 'base' : chain) as SupportedChain;
    const client = createPublicClient({ chain: VIEM_CHAINS[evmChain], transport: http() });
    const raw = await client.readContract({
      address: USDC_ADDRESSES[evmChain] as `0x${string}`,
      abi: parseAbi(['function balanceOf(address) returns (uint256)']),
      functionName: 'balanceOf',
      args: [userAddress as `0x${string}`],
    });
    return Number(raw) / 1e6;
  }, [chain, solWallet, stellar, userAddress]);

  // ─── Balance polling ──────────────────────────────────────────────────────

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
      } catch { /* continue on transient errors */ }
      if (elapsed < MAX_SEC) pollingRef.current = setTimeout(tick, 5000);
    };
    pollingRef.current = setTimeout(tick, 5000);
  }, [checkBalance]);

  // ─── Attestation polling ──────────────────────────────────────────────────

  const pollAttestation = useCallback(async (hash: string, sourceChain: string) => {
    let attempts = 0;
    const poll = async (): Promise<void> => {
      attempts++;
      if (attempts > 360) {
        setMonitorMsg('Taking longer than expected — your USDC will arrive automatically. You can close this window.');
        return;
      }
      try {
        const res = await fetch(`/api/bridge/status?txHash=${hash}&sourceChain=${sourceChain}`);
        const data = await res.json();
        if (data.status === 'complete') {
          let mHash = data.mintTxHash ?? '';

          // If there is no auto-relayer on the source chain (Stellar or Solana),
          // we gaslessly submit a receiveMessage transaction on Base using their Privy smart wallet.
          if (!mHash && (sourceChain === 'stellar' || sourceChain === 'solana') && data.attestation && data.messageBytes) {
            if (!embeddedWallet) {
              throw new Error('EVM wallet not connected. Please connect your wallet to claim bridged USDC on Base.');
            }
            setMonitorMsg('Finalizing transfer on Base (gasless)...');
            const { executeReceiveMessage } = await import('@/lib/web3/bridge-actions');
            mHash = await executeReceiveMessage(embeddedWallet, data.messageBytes, data.attestation);
          }

          setMintTxHash(mHash);
          await updateBridgeStatus(hash, 'complete', mHash);
          queryClient.invalidateQueries({ queryKey: ['history'] });
          queryClient.invalidateQueries({ queryKey: ['balance'] });
          toast.success('USDC bridged to Base!');
          setStep('success');
          return;
        }
        setMonitorMsg(`Waiting for Circle attestation... (${attempts * 5}s elapsed)`);
        setTimeout(poll, 5000);
      } catch (err) {
        console.error('[UsdcDepositFlow] pollAttestation error:', err);
        setTimeout(poll, 10000);
      }
    };
    await poll();
  }, [queryClient, embeddedWallet]);

  // ─── Bridge helpers ───────────────────────────────────────────────────────

  const recordBridge = useCallback(async (sourceChain: string, hash: string, amt: string) => {
    await recordBridgeTransaction({
      userEmail: user?.email?.address ?? '',
      sourceChain: sourceChain as never,
      destChain: 'base',
      amountUsdc: parseFloat(amt) || 0,
      burnTxHash: hash,
    });
    queryClient.invalidateQueries({ queryKey: ['history'] });
  }, [user, queryClient]);

  const getFriendlyBridgeError = (err: unknown, chainName: string): string => {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rejected|cancelled|cancel/i.test(msg)) return 'Transaction cancelled.';
    if (/insufficient|balance/i.test(msg)) return `Insufficient USDC or ${chainName} gas token for fees.`;
    if (/account not found/i.test(msg))
      return chainName === 'XLM'
        ? 'Stellar account not found on the network. Your Freighter wallet needs at least 1 XLM as a minimum reserve to be active on the Stellar network.'
        : 'Account not found. Please try again.';
    if (/no trustline|no trust|trustline/i.test(msg))
      return 'Your Stellar account has no USDC trustline. Add the Circle USDC asset in Freighter first.';
    if (/network|fetch|timeout|ECONNREFUSED/i.test(msg))
      return 'Network error. Check your connection and try again.';
    return 'Bridge failed. Please try again.';
  };

  const handleEvmBridge = async () => {
    if (!embeddedWallet || !chain) return;
    setIsExecuting(true);
    setStep('bridging');
    setMonitorMsg('Preparing gasless bridge...');
    try {
      const { executeSmartBridge } = await import('@/lib/web3/bridge-actions');
      const { userOpHash, txHashPromise } = await executeSmartBridge(
        embeddedWallet,
        chain as SupportedChain,
        bridgeAmt,
        userAddress,
      );
      setBurnTxHash(userOpHash);
      await recordBridge(chain, userOpHash, bridgeAmt);
      setMonitorMsg('Transaction submitted. Waiting for Circle attestation...');
      await pollAttestation(userOpHash, chain);
      txHashPromise.catch(() => {});
    } catch (err) {
      setError(getFriendlyBridgeError(err, meta?.name ?? 'EVM'));
      setStep('bridge-ready');
    } finally {
      setIsExecuting(false);
    }
  };

  // Solana and Stellar accept an optional amountOverride so they can be called
  // directly from the amount step (skipping address/waiting/bridge-ready).
  const handleSolanaBridge = async (amountOverride?: string) => {
    if (!solWallet) return;
    const amountToUse = amountOverride ?? bridgeAmt;
    const errorFallbackStep = step; // remember where we came from
    // Populate bridge-ready state upfront so the error fallback always shows
    // the correct amount and balance (not 0/empty as if polling had never run).
    setBridgeAmt(amountToUse);
    setDetectedBalance(parseFloat(amountToUse) || 0);
    setIsExecuting(true);
    setStep('bridging');
    setMonitorMsg('Building Solana transaction...');
    try {
      const walletPubkey = new PublicKey(solWallet.address);
      const { transaction } = await buildDepositForBurnTx(
        solConn.current,
        walletPubkey,
        amountToUse,
        userAddress,
        solanaFeeSubunits,
      );
      setMonitorMsg('Requesting wallet signature...');
      const serialized = transaction.serialize({ requireAllSignatures: false });
      const { signature: rawSig } = await signAndSendTransaction({ transaction: serialized, wallet: solWallet });
      const signature = toBase58(rawSig);
      setBurnTxHash(signature);
      await recordBridge('solana', signature, amountToUse);
      setMonitorMsg('Waiting for Circle attestation...');
      await pollAttestation(signature, 'solana');
    } catch (err) {
      setError(getFriendlyBridgeError(err, 'SOL'));
      setStep(errorFallbackStep);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleStellarBridge = async (amountOverride?: string) => {
    const amountToUse = amountOverride ?? bridgeAmt;
    const errorFallbackStep = step; // remember where we came from
    setBridgeAmt(amountToUse);
    // Use the actual Freighter wallet balance for "Funds detected", not the bridge amount.
    setDetectedBalance(stellar.balance ?? (parseFloat(amountToUse) || 0));
    setIsExecuting(true);
    setStep('bridging');
    try {
      let capturedHash = '';
      await stellar.executeBridge({
        amount: amountToUse,
        userAddress,
        onStatusUpdate: setMonitorMsg,
        onBurnTxHash: async (hash) => {
          capturedHash = hash;
          setBurnTxHash(hash);
          await recordBridge('stellar', hash, amountToUse);
          setMonitorMsg('Waiting for Circle attestation...');
        },
      });
      await pollAttestation(capturedHash, 'stellar');
    } catch (err) {
      console.error('[UsdcDepositFlow] Stellar bridge error (full):', err);
      setError(getFriendlyBridgeError(err, 'XLM'));
      setStep(errorFallbackStep);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleBridge = () => {
    if (!chain) return;
    if (chain === 'solana') return void handleSolanaBridge();
    if (chain === 'stellar') return void handleStellarBridge();
    return void handleEvmBridge();
  };

  // ─── Step dispatcher ──────────────────────────────────────────────────────

  if (step === 'chain-select') {
    return (
      <DepositChainSelectStep
        onSelect={(c) => { setChain(c); setStep('amount'); }}
      />
    );
  }

  if (!chain || !meta) return null;

  if (step === 'amount') {
    // Stellar and Solana bridge directly from the amount step — user already holds
    // USDC in their connected wallet, so there's no "send to address" step needed.
    const onContinue =
      chain === 'stellar' ? () => void handleStellarBridge(amount) :
      chain === 'solana'  ? () => void handleSolanaBridge(amount) :
      () => setStep('address');

    const onDisconnect =
      chain === 'stellar' ? () => { setError(''); stellar.disconnect(); } :
      chain === 'solana'  ? () => { setError(''); setChain(null); setStep('chain-select'); } :
      undefined;

    return (
      <DepositAmountStep
        chain={chain}
        meta={meta}
        walletConfig={walletConfig}
        stellar={stellar}
        solWalletAddr={solWallet?.address ?? null}
        amount={amount}
        setAmount={setAmount}
        onContinue={onContinue}
        onBack={() => { setError(''); setStep('chain-select'); }}
        onDisconnect={onDisconnect}
        error={error}
      />
    );
  }

  if (step === 'address') {
    return (
      <DepositAddressStep
        chain={chain}
        meta={meta}
        depositAddress={depositAddress}
        amount={amount}
        onSentIt={meta.isDirect ? () => setStep('success') : startPolling}
        onBack={() => setStep('amount')}
        onCopy={() => copyToClipboard(depositAddress, 'Address')}
      />
    );
  }

  if (step === 'waiting') {
    return (
      <DepositWaitingStep
        chain={chain}
        meta={meta}
        depositAddress={depositAddress}
        amount={amount}
        pollSecs={pollSecs}
        onBack={() => setStep('address')}
      />
    );
  }

  if (step === 'bridge-ready') {
    const canBridge =
      chain === 'stellar' ? !!stellar.address :
      chain === 'solana' ? !!solWallet :
      !!embeddedWallet;

    return (
      <DepositBridgeReadyStep
        chain={chain}
        meta={meta}
        detectedBalance={detectedBalance}
        bridgeAmt={bridgeAmt}
        setBridgeAmt={setBridgeAmt}
        canBridge={canBridge}
        isExecuting={isExecuting}
        error={error}
        onBridge={handleBridge}
        onReconnect={chain === 'stellar' ? stellar.connect : connectWallet}
        onRecheck={() => { setDetectedBalance(0); startPolling(); }}
      />
    );
  }

  if (step === 'bridging') {
    return <BridgingMonitor chain={chain} monitorMsg={monitorMsg} burnTxHash={burnTxHash} />;
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


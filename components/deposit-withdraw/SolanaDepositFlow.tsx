'use client';

/**
 * SolanaDepositFlow
 *
 * Fully self-contained Solana CCTP V2 bridge flow.
 * Bridge path: Privy Solana embedded wallet USDC → Circle CCTP V2 → Base USDC
 *
 * No external wallet required. The user's embedded Privy Solana wallet is used
 * automatically (walletClientType === 'privy'), exactly like the EVM side.
 *
 * Signing flow:
 *   1. buildDepositForBurnTx builds the tx and pre-signs with messageSentEventData keypair
 *   2. We serialize to Uint8Array (requireAllSignatures: false — user sig still missing)
 *   3. useSignTransaction (Privy) adds the embedded wallet's signature
 *   4. We broadcast the fully-signed tx bytes ourselves via Connection
 *   5. Poll Circle Iris API for attestation, then finalize on Base
 *
 * Steps: amount → address → waiting → bridge-ready → bridging → success
 *
 * ⚠️  Intentionally isolated from EVM and Stellar flows.
 *     Do NOT import anything from EvmDepositFlow or StellarDepositFlow here.
 */

import {
  buildDepositForBurnTx,
  SOLANA_CCTP_DOMAIN,
  getSolanaUsdcBalance,
} from '@/lib/circle/solana-gateway';
import { fetchCctpFees } from '@/lib/circle/gateway';
import {
  recordBridgeTransaction,
  updateBridgeStatus,
} from '@/lib/supabase/transactions';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import { useQueryClient } from '@tanstack/react-query';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DepositAmountStep } from './DepositAmountStep';
import { DepositAddressStep } from './DepositAddressStep';
import { DepositWaitingStep } from './DepositWaitingStep';
import { DepositBridgeReadyStep } from './DepositBridgeReadyStep';
import {
  BridgeSuccess,
  BridgingMonitor,
  CHAIN_META,
  type FlowChain,
} from './deposit-shared';
import { Buffer } from 'buffer';

// Ensure the latest Buffer polyfill is available globally for @solana/web3.js
// so that methods like writeBigUInt64LE work properly during serialization.
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
  if (!window.Buffer.prototype.writeBigUInt64LE) {
    window.Buffer = Buffer;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

// ─── Types ────────────────────────────────────────────────────────────────────

type SolanaStep =
  | 'amount'
  | 'address'
  | 'waiting'
  | 'bridge-ready'
  | 'bridging'
  | 'success';

// ─── Component ────────────────────────────────────────────────────────────────

interface SolanaDepositFlowProps {
  userAddress: string;
  handleClose: () => void;
  onBack: () => void;
}

export function SolanaDepositFlow({
  userAddress,
  handleClose,
  onBack,
}: SolanaDepositFlowProps) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const queryClient = useQueryClient();

  const solConn = useRef(new Connection(SOLANA_RPC, 'confirmed'));
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Embedded EVM wallet (for finalizing receiveMessage on Base)
  const embeddedEvmWallet = wallets.find((w) => w.walletClientType === 'privy');
  
  // Embedded Privy Solana wallet — auto-created on login
  const privySolAccount = user?.linkedAccounts.find(
    (a) => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'solana'
  );
  const privySolanaAddress = privySolAccount && 'address' in privySolAccount ? (privySolAccount as { address: string }).address : undefined;
  const embeddedSolWallet = solanaWallets.find((w) => w.address === privySolanaAddress) ?? null;

  const [step, setStep] = useState<SolanaStep>('amount');
  const [amount, setAmount] = useState('');
  const [bridgeAmt, setBridgeAmt] = useState('');
  const [detectedBalance, setDetectedBalance] = useState(0);
  const [pollSecs, setPollSecs] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [burnTxHash, setBurnTxHash] = useState('');
  const [mintTxHash, setMintTxHash] = useState('');
  const [monitorMsg, setMonitorMsg] = useState('');
  const [error, setError] = useState('');
  const [solanaFeeSubunits, setSolanaFeeSubunits] = useState<bigint>(0n);

  const chain: FlowChain = 'solana';
  const meta = CHAIN_META[chain];

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  // Clear error on amount change
  useEffect(() => { setError(''); }, [amount]);

  // Pre-calculate CCTP fee when amount changes
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) return;
    const [whole, frac = ''] = amount.split('.');
    const frac6 = (frac + '000000').slice(0, 6);
    const amtSubunits = BigInt(whole + frac6);
    fetchCctpFees(SOLANA_CCTP_DOMAIN, 6)
      .then((fees) => {
        const fast = fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
        const fee = (amtSubunits * BigInt(Math.round(fast.minimumFee * 100))) / 1_000_000n;
        setSolanaFeeSubunits((fee * 120n) / 100n); // 20% buffer
      })
      .catch(() => {}); // Non-fatal: fallback to 0 fee
  }, [amount]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  // ─── Balance checker ─────────────────────────────────────────────────────────

  const checkBalance = useCallback(async (): Promise<number> => {
    if (!privySolanaAddress) return 0;
    try {
      const bal = await getSolanaUsdcBalance(solConn.current, new PublicKey(privySolanaAddress));
      return bal;
    } catch (err) {
      console.error('Error checking solana balance:', err);
      return 0;
    }
  }, [privySolanaAddress]);

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

  // ─── Attestation polling ───────────────────────────────────────────────────

  const pollAttestation = useCallback(async (signature: string) => {
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
          `/api/bridge/status?txHash=${signature}&sourceChain=solana`,
        );
        const data = await res.json();
        if (data.status === 'complete') {
          let mHash = data.mintTxHash ?? '';

          // Solana has no CCTP auto-relayer on Base — gaslessly submit receiveMessage
          if (!mHash && data.attestation && data.messageBytes) {
            if (!embeddedEvmWallet) {
              throw new Error(
                'EVM wallet not ready. Please wait a moment and try again.',
              );
            }
            setMonitorMsg('Finalizing transfer on Base (gasless)...');
            const { executeReceiveMessage } = await import(
              '@/lib/web3/bridge-actions'
            );
            mHash = await executeReceiveMessage(
              embeddedEvmWallet,
              data.messageBytes,
              data.attestation,
            );
          }

          setMintTxHash(mHash);
          await updateBridgeStatus(signature, 'complete', mHash);
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
        console.error('[SolanaDepositFlow] pollAttestation error:', err);
        setTimeout(poll, 10000);
      }
    };
    await poll();
  }, [queryClient, embeddedEvmWallet]);

  // ─── Bridge execution ──────────────────────────────────────────────────────

  const getFriendlyError = (err: unknown): string => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SolanaDepositFlow] raw error:', msg);
    if (/rejected|cancelled|cancel/i.test(msg)) return 'Transaction cancelled.';
    if (/insufficient.*lamport|insufficient.*sol|not enough.*sol/i.test(msg))
      return 'Insufficient SOL for network fees.';
    if (/insufficient.*balance|not enough.*usdc/i.test(msg))
      return 'Insufficient USDC balance.';
    if (/network|fetch|timeout|ECONNREFUSED/i.test(msg))
      return 'Network error. Check your connection and try again.';
    if (/gas station|sponsor/i.test(msg))
      return 'Gas sponsorship failed. Please try again in a moment.';
    return `Solana bridge failed: ${msg.slice(0, 120)}`;
  };

  const handleBridge = async () => {
    if (!embeddedSolWallet) {
      setError('Solana wallet not ready. Please wait a moment and try again.');
      return;
    }
    setStep('bridging');
    setMonitorMsg('Building Solana transaction...');
    setIsExecuting(true);
    setError('');

    try {
      const walletPubkey = new PublicKey(embeddedSolWallet.address);

      // Build the transaction.
      const { transaction, messageSentEventData } = await buildDepositForBurnTx(
        solConn.current,
        walletPubkey,
        bridgeAmt,
        userAddress,
        solanaFeeSubunits,
      );

      setMonitorMsg('Sponsoring gas fees via Circle Gas Station...');

      // Serialize to base64 and send to our backend to get Circle fee-payer signature.
      // This means the user does not need any SOL in their embedded wallet.
      const txBase64 = transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64');

      const sponsorRes = await fetch('/api/bridge/solana-sponsor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: txBase64 }),
      });

      if (!sponsorRes.ok) {
        const errData = await sponsorRes.json().catch(() => ({})) as { error?: string };
        throw new Error(`Gas station error: ${errData.error ?? sponsorRes.statusText}`);
      }

      const { sponsoredTransaction: sponsoredBase64 } = await sponsorRes.json() as {
        sponsoredTransaction: string;
      };

      // Convert the sponsored tx (base64) back to a Transaction object
      const binaryString = atob(sponsoredBase64);
      const sponsoredBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        sponsoredBytes[i] = binaryString.charCodeAt(i);
      }
      const sponsoredTx = Transaction.from(sponsoredBytes);
      
      // Circle Gas Station replaces the feePayer and adds its signature, which might
      // strip our existing messageSentEventData signature. So we re-apply it here.
      sponsoredTx.partialSign(messageSentEventData);

      setMonitorMsg('Requesting wallet signature...');

      // Privy signs the already-fee-sponsored transaction with the embedded Solana wallet
      const { signedTransaction: signedBytes } = await signTransaction({
        transaction: sponsoredTx.serialize({ requireAllSignatures: false }),
        wallet: embeddedSolWallet,
      });

      // signedBytes now has both signatures (messageSentEventData + embedded wallet).
      // Broadcast ourselves so we control the RPC and get back the signature string.
      setMonitorMsg('Broadcasting transaction...');
      const signature = await solConn.current.sendRawTransaction(signedBytes, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      const latestBlockhash = await solConn.current.getLatestBlockhash();
      
      // Poll getSignatureStatus to avoid WebSocket 'signatureSubscribe' errors on HTTP RPCs
      let isConfirmed = false;
      while (!isConfirmed) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await solConn.current.getSignatureStatus(signature, { searchTransactionHistory: true });
        const confStatus = status.value?.confirmationStatus;
        if (confStatus === 'confirmed' || confStatus === 'finalized') {
          if (status.value?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
          }
          isConfirmed = true;
        } else {
          const currentHeight = await solConn.current.getBlockHeight();
          if (currentHeight > latestBlockhash.lastValidBlockHeight) {
            throw new Error(`Signature ${signature} has expired: block height exceeded.`);
          }
        }
      }

      setBurnTxHash(signature);
      await recordBridgeTransaction({
        userEmail: user?.email?.address ?? '',
        sourceChain: 'solana' as never,
        destChain: 'base',
        amountUsdc: parseFloat(bridgeAmt) || 0,
        burnTxHash: signature,
      });
      queryClient.invalidateQueries({ queryKey: ['history'] });

      setMonitorMsg('Transaction submitted. Waiting for Circle attestation...');
      await pollAttestation(signature);
    } catch (err) {
      console.error('[SolanaDepositFlow] bridge error:', err);
      setError(getFriendlyError(err));
      setStep('bridge-ready');
    } finally {
      setIsExecuting(false);
    }
  };

  // ─── Step rendering ────────────────────────────────────────────────────────

  if (step === 'amount') {
    return (
      <DepositAmountStep
        chain={chain}
        meta={meta}
        // No wallet gate needed — embedded wallet exists automatically
        walletConfig={null}
        stellar={
          // No-op stellar object — Solana flow never renders stellar UI sections
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
        amount={amount}
        setAmount={setAmount}
        onContinue={() => setStep('address')}
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
        depositAddress={privySolanaAddress ?? ''}
        amount={amount}
        onSentIt={startPolling}
        onBack={() => setStep('amount')}
        onCopy={() => copyToClipboard(privySolanaAddress ?? '', 'Address')}
      />
    );
  }

  if (step === 'waiting') {
    return (
      <DepositWaitingStep
        chain={chain}
        meta={meta}
        depositAddress={privySolanaAddress ?? ''}
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
        canBridge={!!embeddedSolWallet}
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
        isDirect={false}
        onClose={handleClose}
      />
    );
  }

  return null;
}

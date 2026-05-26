'use client';

/**
 * StellarCctpForm
 *
 * Bridges USDC from Stellar to Base via Circle CCTP V2 (Stellar domain 27 → Base domain 6).
 * Uses @stellar/freighter-api for wallet connection and transaction signing.
 *
 * Key notes:
 * - USDC on Stellar classic has 7 decimal precision; CCTP messages use 6-decimal subunits.
 * - mintRecipient = CctpForwarder contract (if configured) OR user's Base EVM address.
 * - Requires NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT to be set.
 */

import {
  buildStellarDepositForBurnTx,
  calculateStellarMaxFee,
  getStellarUsdcBalance,
  STELLAR_CCTP_DOMAIN,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
  STELLAR_TOKEN_MESSENGER_CONTRACT,
} from '@/lib/circle/stellar-gateway';
import { recordBridgeTransaction, updateBridgeStatus } from '@/lib/supabase/transactions';
import { usePrivy } from '@privy-io/react-auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Wallet,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchCctpFees } from '@/lib/circle/gateway';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

// Freighter API — dynamically imported client-side only
let freighter: typeof import('@stellar/freighter-api') | null = null;
async function getFreighter() {
  if (!freighter) {
    freighter = await import('@stellar/freighter-api');
  }
  return freighter;
}

interface StellarCctpFormProps {
  /** The user's Base smart account address — the destination for bridged USDC */
  userAddress: string;
  handleClose: () => void;
}

type BridgeStep = 'configure' | 'monitoring' | 'success';

export function StellarCctpForm({ userAddress, handleClose }: StellarCctpFormProps) {
  const { user } = usePrivy();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<BridgeStep>('configure');
  const [stellarAddress, setStellarAddress] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState<{ bps: number; usdc: string } | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [burnTxHash, setBurnTxHash] = useState('');
  const [mintTxHash, setMintTxHash] = useState('');
  const [monitorStatus, setMonitorStatus] = useState('Waiting for Circle attestation...');
  const [error, setError] = useState('');
  const [freighterMissing, setFreighterMissing] = useState(false);

  const isContractConfigured = !!STELLAR_TOKEN_MESSENGER_CONTRACT;

  // Check if Freighter is already connected on mount
  useEffect(() => {
    async function checkFreighter() {
      try {
        const fw = await getFreighter();
        const { isConnected } = await fw.isConnected();
        if (isConnected) {
          const { address, error: addrErr } = await fw.getAddress();
          if (!addrErr && address) {
            setStellarAddress(address);
          }
        }
      } catch {
        // Freighter not installed
      }
    }
    checkFreighter();
  }, []);

  // Load USDC balance when stellar address is available
  useEffect(() => {
    if (!stellarAddress) return;
    setBalanceLoading(true);
    getStellarUsdcBalance(stellarAddress)
      .then(setUsdcBalance)
      .catch(() => setUsdcBalance(null))
      .finally(() => setBalanceLoading(false));
  }, [stellarAddress]);

  // Live fee estimate
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) {
      setFee(null);
      return;
    }
    const t = setTimeout(async () => {
      setFeeLoading(true);
      try {
        const fees = await fetchCctpFees(STELLAR_CCTP_DOMAIN, 6);
        const fast = fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
        const bps = fast.minimumFee;
        const feeUsdc = ((parseFloat(amount) * bps) / 10000).toFixed(4);
        setFee({ bps, usdc: feeUsdc });
      } catch {
        setFee(null);
      } finally {
        setFeeLoading(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [amount]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setError('');
    try {
      const fw = await getFreighter();
      // Check if extension is installed
      const { isConnected } = await fw.isConnected();
      if (!isConnected) {
        setFreighterMissing(true);
        setIsConnecting(false);
        return;
      }
      const { address, error: reqErr } = await fw.requestAccess();
      if (reqErr) throw new Error(reqErr);
      if (!address) throw new Error('No address returned');
      setStellarAddress(address);
    } catch (err) {
      console.error('[StellarBridge] Connect error:', err);
      setError('Could not connect Freighter. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBridge = async () => {
    if (!stellarAddress) return;
    if (!amount || parseFloat(amount) < 1) {
      setError('Minimum bridge amount is 1 USDC');
      return;
    }
    if (usdcBalance !== null && parseFloat(amount) > usdcBalance) {
      setError('Insufficient USDC balance');
      return;
    }

    setIsExecuting(true);
    setError('');
    setStep('monitoring');
    setMonitorStatus('Calculating fees…');

    try {
      const fw = await getFreighter();

      // 1. Calculate maxFee
      const maxFeeSubunits = await calculateStellarMaxFee(amount);

      // 2. Build Soroban transaction
      setMonitorStatus('Building Soroban transaction…');
      const { xdr } = await buildStellarDepositForBurnTx(
        stellarAddress,
        userAddress,
        amount,
        maxFeeSubunits,
      );

      // 3. Sign via Freighter
      setMonitorStatus('Requesting wallet signature…');
      const { signedTxXdr, error: signErr } = await fw.signTransaction(xdr, {
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      });
      if (signErr) throw new Error(signErr);
      if (!signedTxXdr) throw new Error('Signing produced no XDR');

      // 4. Submit via Soroban RPC
      setMonitorStatus('Submitting transaction…');
      const server = new SorobanRpc.Server(STELLAR_RPC_URL);
      const { TransactionBuilder } = await import('@stellar/stellar-sdk');
      // TransactionBuilder.fromXDR handles both Transaction and FeeBumpTransaction
      const parsed = TransactionBuilder.fromXDR(signedTxXdr, STELLAR_NETWORK_PASSPHRASE);
      const sendResult = await server.sendTransaction(parsed as Parameters<typeof server.sendTransaction>[0]);

      if (sendResult.status === 'ERROR') {
        throw new Error(`Stellar transaction failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown'}`);
      }

      const txHash = sendResult.hash;
      setBurnTxHash(txHash);

      // 5. Record in DB
      const email = user?.email?.address ?? '';
      await recordBridgeTransaction({
        userEmail: email,
        sourceChain: 'stellar' as never,
        destChain: 'base',
        amountUsdc: parseFloat(amount),
        burnTxHash: txHash,
      });
      queryClient.invalidateQueries({ queryKey: ['history'] });

      // 6. Poll attestation
      setMonitorStatus('Waiting for Circle attestation…');
      await pollAttestation(txHash);
    } catch (err) {
      console.error('[StellarBridge] Error:', err);
      setError(getFriendlyError(err));
      setStep('configure');
    } finally {
      setIsExecuting(false);
    }
  };

  const pollAttestation = async (hash: string) => {
    let attempts = 0;
    const MAX = 360;

    const poll = async (): Promise<void> => {
      attempts++;
      if (attempts > MAX) {
        setMonitorStatus(
          'Attestation is taking longer than usual. Circle will complete it — you can close this page.',
        );
        return;
      }
      try {
        const res = await fetch(`/api/bridge/status?txHash=${hash}&sourceChain=stellar`);
        const data = await res.json();
        if (data.status === 'complete') {
          const mTxHash = data.mintTxHash ?? '';
          setMintTxHash(mTxHash);
          setStep('success');
          await updateBridgeStatus(hash, 'complete', mTxHash);
          queryClient.invalidateQueries({ queryKey: ['history'] });
          queryClient.invalidateQueries({ queryKey: ['balance'] });
          toast.success('USDC bridged from Stellar to Base! 🎉');
          return;
        }
        setMonitorStatus(`Waiting for Circle attestation… (${attempts * 5}s elapsed)`);
        setTimeout(poll, 5000);
      } catch {
        setTimeout(poll, 10000);
      }
    };
    await poll();
  };

  const getFriendlyError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('reject') || msg.includes('cancel')) return 'Transaction cancelled in Freighter';
    if (msg.includes('insufficient') || msg.includes('balance'))
      return 'Insufficient USDC balance';
    if (msg.includes('not configured'))
      return 'Stellar CCTP is not yet live on this network';
    return 'Transaction failed. Please try again.';
  };

  // ── Not configured ──────────────────────────────────────────────────────────
  if (!isContractConfigured) {
    return (
      <div className="py-6 space-y-4">
        <div
          className="p-4 rounded-2xl flex items-start gap-3"
          style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
          <div className="space-y-1">
            <p className="text-xs font-bold" style={{ color: '#fbbf24' }}>
              Coming Soon
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(251,191,36,0.7)' }}>
              Stellar CCTP V2 bridging will be available once the network contract addresses are
              configured. Please check back soon.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Configure step ──────────────────────────────────────────────────────────
  if (step === 'configure') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <p className="text-xs text-white/40 leading-relaxed">
          Bridge USDC from your Stellar wallet to your Base balance using Circle&apos;s CCTP V2.
          Requires the Freighter browser extension.
        </p>

        {/* Freighter not installed banner */}
        {freighterMissing && (
          <div
            className="p-3 rounded-xl flex items-start gap-2"
            style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
            <div className="space-y-1">
              <p className="text-[11px] font-bold" style={{ color: '#fbbf24' }}>
                Freighter not detected
              </p>
              <a
                href="https://www.freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] underline"
                style={{ color: 'rgba(251,191,36,0.6)' }}
              >
                Install Freighter →
              </a>
            </div>
          </div>
        )}

        {!stellarAddress ? (
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn-accent w-full gap-2"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Wallet className="w-4 h-4" />
                Connect Freighter Wallet
              </>
            )}
          </button>
        ) : (
          <div className="space-y-4">
            {/* Connected wallet */}
            <div
              className="p-4 rounded-2xl flex items-center justify-between"
              style={{ background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.15)' }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                  Stellar Wallet
                </p>
                <p className="text-sm font-mono font-semibold text-white/80 mt-0.5">
                  {stellarAddress.slice(0, 8)}…{stellarAddress.slice(-6)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                  USDC Balance
                </p>
                <p className="text-sm font-bold tabular-nums" style={{ color: '#00e87a' }}>
                  {balanceLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                  ) : usdcBalance !== null ? (
                    `$${usdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  ) : (
                    '—'
                  )}
                </p>
              </div>
            </div>

            {/* Amount input */}
            <div>
              <label
                className="text-xs font-semibold mb-1.5 block"
                style={{ color: 'rgba(248,248,246,0.4)' }}
              >
                Amount (USDC)
              </label>
              <div className="relative">
                <span
                  className="absolute left-4 top-1/2 -translate-y-1/2 font-bold"
                  style={{ color: 'rgba(248,248,246,0.3)' }}
                >
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input-elegant pl-8 text-xl font-bold"
                  placeholder="10.00"
                />
              </div>
              {usdcBalance !== null && usdcBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmount(usdcBalance.toFixed(2))}
                  className="text-[10px] font-bold uppercase tracking-widest mt-1"
                  style={{ color: '#00e87a' }}
                >
                  Use max ({usdcBalance.toFixed(2)})
                </button>
              )}
            </div>

            {/* Live fee */}
            {amount && parseFloat(amount) > 0 && (
              <div
                className="p-3 rounded-xl flex justify-between items-center text-xs"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex items-center gap-2" style={{ color: 'rgba(248,248,246,0.4)' }}>
                  <Zap className="w-3.5 h-3.5" style={{ color: '#00e87a' }} />
                  Fast Transfer Fee (Circle CCTP)
                </div>
                <span className="font-bold" style={{ color: '#f8f8f6' }}>
                  {feeLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                  ) : fee ? (
                    `~$${fee.usdc} USDC`
                  ) : (
                    'Unavailable'
                  )}
                </span>
              </div>
            )}

            {/* XLM fee notice */}
            <p className="text-[10px] text-white/25 leading-relaxed">
              Requires a small amount of XLM in your Stellar wallet for network fees (~0.1 XLM).
            </p>

            {error && (
              <p className="text-xs font-bold text-red-400 uppercase tracking-widest">
                {error}
              </p>
            )}

            <button
              onClick={handleBridge}
              disabled={
                !amount ||
                parseFloat(amount) < 1 ||
                feeLoading ||
                isExecuting ||
                (usdcBalance !== null && parseFloat(amount) > usdcBalance)
              }
              className="btn-accent w-full gap-2"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Bridging…
                </>
              ) : (
                <>
                  Bridge USDC from Stellar
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Monitoring step ─────────────────────────────────────────────────────────
  if (step === 'monitoring') {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center space-y-6 animate-in fade-in duration-500">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: '#00e87a' }} />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold" style={{ color: '#f8f8f6' }}>
            Bridging from Stellar
          </h2>
          <p className="text-sm max-w-xs" style={{ color: 'rgba(248,248,246,0.4)' }}>
            Circle&apos;s relayer is processing your transfer. You can safely close this page —
            USDC will arrive in your Base wallet automatically.
          </p>
        </div>
        <div
          className="p-3 rounded-xl w-full"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'rgba(248,248,246,0.35)' }}
          >
            {monitorStatus}
          </p>
        </div>
        {burnTxHash && (
          <a
            href={`https://stellar.expert/explorer/public/tx/${burnTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5"
            style={{ color: 'rgba(248,248,246,0.25)' }}
          >
            <ExternalLink className="w-3 h-3" />
            View on Stellar Explorer
          </a>
        )}
        <p className="text-[10px]" style={{ color: 'rgba(248,248,246,0.2)' }}>
          Fast Transfers: ~20 minutes · Standard: up to 2 hours
        </p>
      </div>
    );
  }

  // ── Success step ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center space-y-6 animate-in zoom-in duration-500">
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg"
        style={{ background: '#00e87a', color: '#07070a', boxShadow: '0 12px 40px rgba(0,232,122,0.3)' }}
      >
        <CheckCircle2 className="w-10 h-10" />
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-3xl font-bold" style={{ color: '#f8f8f6' }}>
          Bridge Complete!
        </h2>
        <p style={{ color: 'rgba(248,248,246,0.5)', fontSize: '0.9rem' }}>
          {amount} USDC has arrived in your Base wallet.
        </p>
      </div>
      {mintTxHash && (
        <a
          href={`https://basescan.org/tx/${mintTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary h-12 px-6 text-xs gap-2"
        >
          <ExternalLink className="w-4 h-4" />
          View on BaseScan
        </a>
      )}
      <button onClick={handleClose} className="btn-accent px-10">
        View Dashboard
      </button>
    </div>
  );
}

'use client';

/**
 * Stellar Playground
 *
 * Users open this page and their Stellar wallet is ready automatically:
 *   - Privy TEE creates the keypair (permanent address)
 *   - Sponsor activates the account with 2 XLM
 *   - USDC trustline is set (sponsor fee-bumps the tx)
 *   - All sends are fee-bumped — users never touch XLM
 *
 * Persistence: wallet state is cached in localStorage per Privy user ID.
 * On reload the address shows instantly. Trustline re-check runs in background.
 */

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { usePrivy, useSigners } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Shield,
  Star,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StellarWalletState {
  walletId: string;
  address: string;
  trustlineReady: boolean;
  signerGranted: boolean;
}

type ProvisionStep =
  | 'idle'
  | 'creating_wallet'
  | 'granting_signer'
  | 'activating_account'
  | 'setting_trustline'
  | 'done'
  | 'error';

// ── localStorage helpers ──────────────────────────────────────────────────────

const storageKey = (id: string) => `sendzz:stellar:v2:${id}`;

function loadWallet(userId: string): StellarWalletState | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as StellarWalletState) : null;
  } catch { return null; }
}

function saveWallet(userId: string, wallet: StellarWalletState) {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(wallet)); } catch { /* ignore */ }
}

function clearWallet(userId: string) {
  try { localStorage.removeItem(storageKey(userId)); } catch { /* ignore */ }
}

// ── Step label map ────────────────────────────────────────────────────────────

const STEP_LABELS: Record<ProvisionStep, string> = {
  idle: 'Preparing...',
  creating_wallet: 'Creating Stellar keypair in Privy TEE...',
  granting_signer: 'Authorising server signing access...',
  activating_account: 'Sponsor sending 2 XLM to activate account...',
  setting_trustline: 'Setting up USDC trustline (fee-bumped)...',
  done: 'Wallet ready',
  error: 'Setup failed — tap Retry',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function StellarPlayground() {
  const { user, ready, authenticated } = usePrivy();
  const { addSigners } = useSigners();
  const privyUserId = user?.id;

  const [wallet, setWallet] = useState<StellarWalletState | null>(null);
  const [step, setStep] = useState<ProvisionStep>('idle');
  const [isProvisioning, setIsProvisioning] = useState(false);
  const provisioningRef = useRef(false); // prevents duplicate concurrent calls

  // Send form
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  // ── Balance query ─────────────────────────────────────────────────────────
  const { data: balances, isLoading: balanceLoading, refetch: refetchBalance } = useQuery({
    queryKey: ['stellar-balance', wallet?.address],
    queryFn: async () => {
      if (!wallet?.address) return null;
      const res = await fetch(`/api/stellar/balance?address=${wallet.address}`);
      return res.ok ? (res.json() as Promise<{ usdc: string; xlm: string }>) : null;
    },
    enabled: !!wallet?.address,
    refetchInterval: 15_000,
  });

  // ── Grant signer + full provision ─────────────────────────────────────────
  const provision = useCallback(async (userId: string, skipSignerGrant = false): Promise<void> => {
    setIsProvisioning(true);
    setStep('creating_wallet');

    try {
      // 1. Get signer ID
      const signerRes = await fetch('/api/stellar/signer-id');
      if (!signerRes.ok) {
        const err = (await signerRes.json()) as { error?: string };
        throw new Error(err.error || 'Could not get signer ID — is PRIVY_KEY_QUORUM_ID set?');
      }
      const { keyQuorumId } = (await signerRes.json()) as { keyQuorumId: string };

      // 2. First provision call — creates the wallet if it doesn't exist.
      //    We need the address before we can call addSigners.
      setStep('creating_wallet');
      const firstRes = await fetch('/api/stellar/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId: userId }),
      });
      const firstData = (await firstRes.json()) as {
        walletId?: string; address?: string; trustlineReady?: boolean; error?: string;
      };
      if (!firstRes.ok) throw new Error(firstData.error || 'Provision failed');

      const walletAddress = firstData.address!;
      const walletId = firstData.walletId!;

      // If trustline is already ready (returning user), no need for a second call
      if (firstData.trustlineReady) {
        setStep('done');
        const w: StellarWalletState = {
          walletId, address: walletAddress,
          trustlineReady: true, signerGranted: true,
        };
        setWallet(w);
        saveWallet(userId, w);
        console.log('[StellarPlayground] ✓ Wallet fully operational (returning user):', walletAddress);
        return;
      }

      // 3. Grant signer access (runs in user browser session — one-time)
      if (!skipSignerGrant) {
        setStep('granting_signer');
        console.log('[StellarPlayground] Granting server signer access...');
        try {
          await addSigners({ address: walletAddress, signers: [{ signerId: keyQuorumId }] });
          console.log('[StellarPlayground] ✓ Signer access granted.');
        } catch (err) {
          const msg = (err as Error).message ?? '';
          if (msg.toLowerCase().includes('duplicate')) {
            console.log('[StellarPlayground] Signer already granted — continuing.');
          } else {
            throw err;
          }
        }
      }

      // 4. Second provision call — now server can sign, activation + trustline happen
      setStep('activating_account');
      const fullRes = await fetch('/api/stellar/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId: userId }),
      });
      const fullData = (await fullRes.json()) as {
        walletId?: string; address?: string; trustlineReady?: boolean;
        trustlineError?: string; error?: string;
      };
      if (!fullRes.ok) throw new Error(fullData.error || 'Full provision failed');

      setStep('done');
      const newWallet: StellarWalletState = {
        walletId: fullData.walletId ?? walletId,
        address: fullData.address ?? walletAddress,
        trustlineReady: fullData.trustlineReady ?? false,
        signerGranted: true,
      };
      setWallet(newWallet);
      saveWallet(userId, newWallet);

      if (newWallet.trustlineReady) {
        console.log('[StellarPlayground] ✓ Wallet fully operational:', newWallet.address);
      } else {
        console.warn('[StellarPlayground] ⚠ Trustline pending:', fullData.trustlineError);
      }
    } catch (err) {
      setStep('error');
      console.error('[StellarPlayground] Provision failed:', (err as Error).message);
      throw err;
    } finally {
      setIsProvisioning(false);
    }
  }, [addSigners]);

  // ── Auto-provision on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !authenticated || !privyUserId || wallet || provisioningRef.current) return;

    const cached = loadWallet(privyUserId);
    if (cached) {
      setWallet(cached);
      setStep('done');
      if (!cached.trustlineReady || !cached.signerGranted) {
        provisioningRef.current = true;
        provision(privyUserId, cached.signerGranted)
          .catch(() => {/* silent */})
          .finally(() => { provisioningRef.current = false; });
      }
      return;
    }

    provisioningRef.current = true;
    provision(privyUserId)
      .catch(() => {/* error shown in UI via step */})
      .finally(() => { provisioningRef.current = false; });
  }, [ready, authenticated, privyUserId, wallet, provision]);

  // ── Send USDC ─────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!wallet || !recipient || !amount) return;
    setIsSending(true);
    try {
      const res = await fetch('/api/stellar/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletId: wallet.walletId,
          senderAddress: wallet.address,
          recipientAddress: recipient,
          amount,
          memo: memo || undefined,
        }),
      });
      const data = (await res.json()) as { txHash?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setLastTxHash(data.txHash!);
      toast.success(`Sent ${amount} USDC on Stellar`);
      setAmount('');
      setRecipient('');
      setMemo('');
      refetchBalance();
    } catch (err) {
      toast.error((err as Error).message || 'Send failed');
    } finally {
      setIsSending(false);
    }
  };

  // ── Retry ─────────────────────────────────────────────────────────────────
  const handleRetry = async () => {
    if (!privyUserId) return;
    clearWallet(privyUserId);
    setWallet(null);
    setStep('idle');
    try {
      await provision(privyUserId, wallet?.signerGranted ?? false);
      toast.success('Wallet setup complete');
      refetchBalance();
    } catch (err) {
      toast.error((err as Error).message || 'Retry failed — check server logs');
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!ready || !authenticated) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8" style={{ color: 'rgba(248,248,246,0.2)' }} />
      </div>
    );
  }

  const isFullyReady = wallet?.trustlineReady && wallet?.signerGranted;

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <DashboardPageHeader
        title="Stellar Wallet"
        subtitle="Send and receive USDC on Stellar. Fees are sponsored — you never need XLM."
      />

      {/* Status badge */}
      <div
        className="flex items-center gap-3 px-5 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest"
        style={{
          background: isFullyReady ? 'rgba(0,232,122,0.06)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isFullyReady ? 'rgba(0,232,122,0.15)' : 'rgba(255,255,255,0.08)'}`,
          color: isFullyReady ? 'rgba(0,232,122,0.7)' : 'rgba(248,248,246,0.35)',
        }}
      >
        <Star className="w-3.5 h-3.5 shrink-0" />
        {isFullyReady
          ? 'Wallet active · Keys in Privy TEE · All fees sponsored'
          : isProvisioning
            ? STEP_LABELS[step]
            : 'Setting up wallet...'}
      </div>

      {/* Provisioning spinner */}
      {isProvisioning && (
        <div className="card-glass p-8 rounded-3xl space-y-5">
          <div className="flex items-center gap-4">
            <Loader2 className="w-6 h-6 animate-spin shrink-0" style={{ color: '#00e87a' }} />
            <div>
              <p className="text-sm font-bold" style={{ color: '#f8f8f6' }}>
                {STEP_LABELS[step]}
              </p>
              <p className="text-xs mt-1" style={{ color: 'rgba(248,248,246,0.35)' }}>
                This only happens once — future logins are instant
              </p>
            </div>
          </div>
          {/* Step progress */}
          <div className="space-y-2">
            {[
              { key: 'creating_wallet', label: 'Create Stellar keypair (Privy TEE)' },
              { key: 'granting_signer', label: 'Authorise server signing' },
              { key: 'activating_account', label: 'Sponsor activates account (2 XLM)' },
              { key: 'setting_trustline', label: 'Set USDC trustline (sponsor pays fee)' },
            ].map(({ key, label }) => {
              const steps: ProvisionStep[] = ['creating_wallet', 'granting_signer', 'activating_account', 'setting_trustline', 'done'];
              const currentIdx = steps.indexOf(step);
              const thisIdx = steps.indexOf(key as ProvisionStep);
              const isDone = currentIdx > thisIdx;
              const isActive = currentIdx === thisIdx;
              return (
                <div key={key} className="flex items-center gap-3">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      background: isDone ? 'rgba(0,232,122,0.2)' : isActive ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${isDone ? 'rgba(0,232,122,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    }}
                  >
                    {isDone
                      ? <CheckCircle2 className="w-3 h-3 text-green-400" />
                      : isActive
                        ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#f8f8f6' }} />
                        : null}
                  </div>
                  <p
                    className="text-xs"
                    style={{ color: isDone ? 'rgba(0,232,122,0.7)' : isActive ? '#f8f8f6' : 'rgba(248,248,246,0.25)' }}
                  >
                    {label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error state */}
      {!isProvisioning && step === 'error' && !wallet && (
        <div className="card-glass p-8 rounded-3xl space-y-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <p className="text-sm font-bold text-red-400">Wallet setup failed</p>
          </div>
          <p className="text-xs" style={{ color: 'rgba(248,248,246,0.4)' }}>
            Check server logs for the full error. Common causes: sponsor account not funded,
            missing env vars, or Privy API issue.
          </p>
          <button
            onClick={handleRetry}
            className="w-full h-12 rounded-2xl font-bold uppercase tracking-widest text-sm"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#f8f8f6' }}
          >
            Retry Setup
          </button>
        </div>
      )}

      {/* Wallet card */}
      {wallet && !isProvisioning && (
        <>
          <div className="card-glass p-8 rounded-3xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.35)' }}>
                Stellar Wallet · Privy TEE
              </h3>
              <div className="flex items-center gap-2">
                {isFullyReady ? (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                    style={{ background: 'rgba(0,232,122,0.1)', color: '#00e87a', border: '1px solid rgba(0,232,122,0.2)' }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-beacon" />
                    USDC Ready
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                    style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
                  >
                    <AlertCircle className="w-3 h-3" />
                    Pending
                  </div>
                )}
              </div>
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.25)' }}>
                Your Stellar Address
              </p>
              <button
                className="w-full flex items-center justify-between p-4 rounded-xl group transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                onClick={() => { navigator.clipboard.writeText(wallet.address); toast.success('Address copied'); }}
              >
                <span className="font-mono text-xs break-all text-left" style={{ color: 'rgba(248,248,246,0.7)' }}>
                  {wallet.address}
                </span>
                <Copy className="w-4 h-4 shrink-0 ml-3 opacity-30 group-hover:opacity-70 transition-opacity" style={{ color: '#f8f8f6' }} />
              </button>
            </div>

            {/* Balances */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'USDC Balance', value: balances?.usdc ?? '0', decimals: 2, highlight: true },
                { label: 'XLM (sponsored)', value: balances?.xlm ?? '0', decimals: 4, highlight: false },
              ].map(({ label, value, decimals, highlight }) => (
                <div
                  key={label}
                  className="p-4 rounded-xl space-y-1"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.25)' }}>
                      {label}
                    </p>
                    {highlight && (
                      <button onClick={() => refetchBalance()} className="opacity-30 hover:opacity-70 transition-opacity">
                        <RefreshCw className={`w-3 h-3 ${balanceLoading ? 'animate-spin' : ''}`} style={{ color: '#f8f8f6' }} />
                      </button>
                    )}
                  </div>
                  <p className="text-2xl font-bold font-display" style={{ color: '#f8f8f6' }}>
                    {balanceLoading ? '—' : parseFloat(value).toFixed(decimals)}
                  </p>
                </div>
              ))}
            </div>

            {/* Fee sponsor notice */}
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'rgba(0,232,122,0.05)', border: '1px solid rgba(0,232,122,0.1)', color: 'rgba(0,232,122,0.6)' }}
            >
              <Zap className="w-3.5 h-3.5 shrink-0" />
              All Stellar fees are paid by the platform sponsor — you never need XLM
            </div>

            {/* Security note */}
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(248,248,246,0.3)' }}
            >
              <Shield className="w-3.5 h-3.5 shrink-0" />
              Private key secured in Privy TEE (Amazon Nitro Enclave) — Sendzz never sees it
            </div>

            {/* Trustline not ready — retry option */}
            {!wallet.trustlineReady && (
              <div
                className="flex items-center justify-between p-4 rounded-xl gap-3"
                style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)' }}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-yellow-400" />
                  <div>
                    <p className="text-xs font-bold text-yellow-400">USDC trustline pending</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'rgba(251,191,36,0.6)' }}>
                      Account is being activated by sponsor. Retry in a moment.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest shrink-0 transition-all"
                  style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}
                >
                  Retry
                </button>
              </div>
            )}

            <a
              href={`https://stellar.expert/explorer/public/account/${wallet.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs w-fit transition-colors"
              style={{ color: 'rgba(248,248,246,0.25)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(0,232,122,0.7)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(248,248,246,0.25)')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on Stellar Expert
            </a>
          </div>

          {/* Send USDC */}
          {isFullyReady && (
            <div className="card-glass p-8 rounded-3xl space-y-6">
              <div className="flex items-center gap-3">
                <Send className="w-4 h-4" style={{ color: '#00e87a' }} />
                <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.7)' }}>
                  Send USDC on Stellar
                </h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.3)' }}>
                    Recipient Stellar Address (G...)
                  </label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="GABCDE..."
                    className="w-full px-4 py-3.5 rounded-xl font-mono text-sm focus:outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#f8f8f6' }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.3)' }}>
                      Amount (USDC)
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="10.00"
                      min="0.0000001"
                      step="0.01"
                      className="w-full px-4 py-3.5 rounded-xl text-sm focus:outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#f8f8f6' }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.3)' }}>
                      Memo (optional)
                    </label>
                    <input
                      type="text"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="Payment for..."
                      maxLength={28}
                      className="w-full px-4 py-3.5 rounded-xl text-sm focus:outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#f8f8f6' }}
                    />
                  </div>
                </div>

                <button
                  onClick={handleSend}
                  disabled={isSending || !recipient || !amount}
                  className="w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-bold uppercase tracking-widest text-sm transition-all disabled:opacity-40"
                  style={{ background: '#00e87a', color: '#07070a' }}
                >
                  {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  {isSending ? 'Signing & Sending...' : 'Send USDC'}
                </button>
              </div>

              {lastTxHash && (
                <a
                  href={`https://stellar.expert/explorer/public/tx/${lastTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-4 rounded-xl text-xs"
                  style={{ background: 'rgba(0,232,122,0.06)', border: '1px solid rgba(0,232,122,0.15)', color: 'rgba(0,232,122,0.7)' }}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Last tx: {lastTxHash.slice(0, 12)}...{lastTxHash.slice(-8)}</span>
                  <ExternalLink className="w-3.5 h-3.5 ml-auto shrink-0" />
                </a>
              )}
            </div>
          )}

          {/* Wallet ID (debug) */}
          <div
            className="p-4 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'rgba(248,248,246,0.12)' }}>
              Privy Wallet ID
            </p>
            <p className="font-mono text-[10px]" style={{ color: 'rgba(248,248,246,0.18)' }}>{wallet.walletId}</p>
          </div>
        </>
      )}
    </div>
  );
}

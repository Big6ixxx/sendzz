'use client';

import { usePrivy } from '@privy-io/react-auth';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

type ClaimState =
  | 'idle'
  | 'authenticating'
  | 'previewing'
  | 'claiming'
  | 'success'
  | 'error';

interface PreviewData {
  amount: number;
  senderEmail: string;
  note: string | null;
  expiresAt: string | null;
}

function ClaimContent() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<ClaimState>('idle');
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [claimedAmount, setClaimedAmount] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasAttemptedPreview = useRef(false);
  const hasAttemptedClaim = useRef(false);

  // Once authenticated, fetch transfer preview (never auto-claim directly)
  useEffect(() => {
    if (!ready) return;
    if (!token) {
      setErrorMessage('Invalid link — no claim token found.');
      setState('error');
      return;
    }

    if (!authenticated) {
      setState('authenticating');
      return;
    }

    if (hasAttemptedPreview.current) return;
    hasAttemptedPreview.current = true;

    async function fetchPreview() {
      try {
        const res = await fetch(
          `/api/transfer/preview?token=${encodeURIComponent(token!)}`,
        );
        const data = await res.json();

        if (!res.ok) {
          setErrorMessage(data.error || 'Failed to load transfer details.');
          setState('error');
          return;
        }

        setPreviewData(data);
        setState('previewing');
      } catch {
        setErrorMessage('Something went wrong. Please try again.');
        setState('error');
      }
    }

    fetchPreview();
  }, [ready, authenticated, token]);

  async function handleConfirm() {
    if (hasAttemptedClaim.current) return;
    hasAttemptedClaim.current = true;

    setState('claiming');
    try {
      const res = await fetch('/api/transfer/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'Failed to claim funds.');
        setState('error');
        return;
      }

      setClaimedAmount(
        data.amount
          ? Number(data.amount).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : null,
      );
      setState('success');
    } catch {
      setErrorMessage('Something went wrong. Please try again.');
      setState('error');
    }
  }

  // ── Not ready yet ──
  if (!ready || state === 'idle') {
    return (
      <div className="flex items-center justify-center gap-3 text-brand-secondary/40">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm font-bold uppercase tracking-widest">Loading…</span>
      </div>
    );
  }

  // ── Needs to log in ──
  if (state === 'authenticating') {
    return (
      <div className="space-y-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: 'rgba(0,232,122,0.1)', border: '1px solid rgba(0,232,122,0.2)' }}
        >
          <Lock className="w-7 h-7" style={{ color: '#00e87a' }} />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight text-brand-secondary">
            Funds waiting for you
          </h1>
          <p className="text-sm text-brand-secondary/50 leading-relaxed max-w-xs mx-auto">
            Sign in to your Sendzz account to collect your USDC.
          </p>
        </div>
        <button
          onClick={login}
          className="btn-accent w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-bold text-sm uppercase tracking-widest"
        >
          Sign In to Claim
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ── Preview / confirmation step ──
  if (state === 'previewing' && previewData) {
    const formattedAmount = Number(previewData.amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    return (
      <div className="space-y-8">
        {/* Transfer summary */}
        <div className="text-center space-y-2">
          <p
            className="text-xs font-bold uppercase tracking-[0.25em]"
            style={{ color: 'rgba(0,232,122,0.7)' }}
          >
            Incoming Transfer
          </p>
          <p className="font-display text-5xl font-bold tracking-tighter text-brand-secondary">
            ${formattedAmount}{' '}
            <span className="text-xl opacity-30 font-bold">USDC</span>
          </p>
          <p className="text-sm text-brand-secondary/50">
            from{' '}
            <span className="text-brand-secondary/80 font-semibold">
              {previewData.senderEmail}
            </span>
          </p>
        </div>

        {/* Note */}
        {previewData.note && (
          <div
            className="px-4 py-3 rounded-2xl text-sm text-brand-secondary/60 text-center leading-relaxed"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            &ldquo;{previewData.note}&rdquo;
          </div>
        )}

        {/* Expiry */}
        {previewData.expiresAt && (
          <div className="flex items-center justify-center gap-2 text-xs text-brand-secondary/30">
            <Clock className="w-3.5 h-3.5" />
            <span>
              Expires{' '}
              {new Date(previewData.expiresAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
        )}

        <button
          onClick={handleConfirm}
          className="btn-accent w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-bold text-sm uppercase tracking-widest"
        >
          Confirm &amp; Accept Funds
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ── Claiming in progress ──
  if (state === 'claiming') {
    return (
      <div className="space-y-4 text-center">
        <div className="flex items-center justify-center gap-3 text-brand-secondary/40">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00e87a' }} />
        </div>
        <p className="text-sm font-bold uppercase tracking-widest text-brand-secondary/40">
          Crediting your balance…
        </p>
      </div>
    );
  }

  // ── Success ──
  if (state === 'success') {
    return (
      <div className="space-y-8 text-center">
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
          style={{ background: 'rgba(0,232,122,0.12)', border: '1px solid rgba(0,232,122,0.25)' }}
        >
          <CheckCircle2 className="w-10 h-10" style={{ color: '#00e87a' }} />
        </div>

        <div className="space-y-3">
          <p
            className="text-xs font-bold uppercase tracking-[0.25em]"
            style={{ color: 'rgba(0,232,122,0.7)' }}
          >
            Funds Received
          </p>
          {claimedAmount && (
            <p className="font-display text-5xl font-bold tracking-tighter text-brand-secondary">
              ${claimedAmount}{' '}
              <span className="text-xl opacity-30 font-bold">USDC</span>
            </p>
          )}
          <p className="text-sm text-brand-secondary/50 leading-relaxed">
            Your funds are now in your Sendzz balance.
          </p>
        </div>

        <button
          onClick={() => router.push('/dashboard')}
          className="btn-accent w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-bold text-sm uppercase tracking-widest"
        >
          Go to Dashboard
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // ── Error ──
  return (
    <div className="space-y-8 text-center">
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
        style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)' }}
      >
        <XCircle className="w-10 h-10" style={{ color: '#f87171' }} />
      </div>

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: '#f87171' }}>
          Claim Failed
        </p>
        <p className="text-base font-semibold text-brand-secondary">
          {errorMessage || 'Something went wrong.'}
        </p>
        <p className="text-sm text-brand-secondary/40 leading-relaxed max-w-xs mx-auto">
          If you believe this is a mistake, contact support or ask the sender to resend.
        </p>
      </div>

      <Link
        href="/"
        className="block w-full h-14 rounded-2xl flex items-center justify-center gap-3 font-bold text-sm uppercase tracking-widest transition-all"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'rgba(248,248,246,0.6)',
        }}
      >
        Back to Home
      </Link>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div
        className="w-full max-w-sm card-glass p-8 rounded-3xl space-y-2"
        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Logo / brand mark */}
        <div className="text-center pb-4">
          <span className="font-display text-2xl font-bold tracking-tighter text-brand-secondary">
            Sendzz
          </span>
        </div>

        <Suspense
          fallback={
            <div className="flex items-center justify-center gap-3 text-brand-secondary/30 py-8">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          }
        >
          <ClaimContent />
        </Suspense>
      </div>
    </div>
  );
}

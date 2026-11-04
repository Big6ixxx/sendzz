'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useSignIn } from '@/components/auth/SignIn';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { DetailRows, FlowButton, FlowDialogHeading, FlowSuccess, Notice, FlowLabel } from '@/components/flow/ui';
import { BareBrandPage, statusAction } from '@/components/landing/StatusScreen';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { formatUsd } from '@/lib/format-usdc';

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
  const { ready, authenticated } = usePrivy();
  const { signIn } = useSignIn();
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
      setTimeout(() => {
        setErrorMessage('This link is incomplete. It has no claim code in it.');
        setState('error');
      }, 0);
      return;
    }

    if (!authenticated) {
      setTimeout(() => setState('authenticating'), 0);
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
  if (!ready || state === 'idle') return <ClaimLoading />;

  // ── Needs to log in ──
  if (state === 'authenticating') {
    return (
      <div className="space-y-8">
        <FlowDialogHeading Title="h1" eyebrow="Payment for you" title="Money is" italic="waiting." />
        <p className="text-[17px] leading-[1.6] text-[var(--lp-body)]">
          Someone sent you USDC through Sendzz. Sign in with the email address the link came to, and you will see who sent it
          and how much before you accept.
        </p>
        <FlowButton tone="accent" onClick={() => signIn()}>
          Sign in to claim <ArrowRight className="size-4" />
        </FlowButton>
      </div>
    );
  }

  // ── Preview / confirmation step, and the claim while it runs ──
  if ((state === 'previewing' || state === 'claiming') && previewData) {
    const claiming = state === 'claiming';
    return (
      <div className="space-y-6">
        <FlowDialogHeading Title="h1" eyebrow="Payment for you" title="Check it," italic="then accept." />

        <section aria-label="Payment" className="lp-card rounded-[28px] p-6 sm:p-7">
          <FlowLabel>You receive</FlowLabel>
          <p className="lp-display mt-3 break-words text-[clamp(44px,12vw,64px)] leading-none tracking-[-0.05em] tabular-nums">
            {formatUsd(previewData.amount)}
            <span className="lp-mono ml-2 align-middle text-[14px] tracking-normal text-[var(--lp-muted)]">USDC</span>
          </p>
          {previewData.note && (
            <p className="lp-serif mt-5 text-[22px] leading-[1.3] text-[var(--lp-ink)]">&ldquo;{previewData.note}&rdquo;</p>
          )}
          <DetailRows
            className="mt-6 border-b-0"
            rows={[
              { label: 'From', value: <span className="block truncate">{previewData.senderEmail}</span> },
              !!previewData.expiresAt && {
                label: 'Claim by',
                value: (
                  <span className="lp-mono text-[14px]">
                    {new Date(previewData.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                ),
              },
            ]}
          />
        </section>

        <FlowButton tone="accent" onClick={handleConfirm} loading={claiming} aria-label={claiming ? 'Adding to your balance' : undefined}>
          Accept {formatUsd(previewData.amount)} <ArrowRight className="size-4" />
        </FlowButton>
        {claiming && <p className="lp-mono text-center text-[12px] uppercase text-[var(--lp-muted)]">Adding it to your balance</p>}
      </div>
    );
  }

  // ── Claiming, if the preview was never shown ──
  if (state === 'claiming') return <ClaimLoading label="Adding it to your balance" />;

  // ── Success ──
  if (state === 'success') {
    return (
      <FlowSuccess
        title={claimedAmount ? `$${claimedAmount}` : 'Money'}
        italic="received."
        body="It is in your Sendzz balance now, ready to send on or withdraw."
      >
        <FlowButton onClick={() => router.push('/dashboard')}>
          Open my balance <ArrowRight className="size-4" />
        </FlowButton>
      </FlowSuccess>
    );
  }

  // ── Error ──
  return (
    <div className="space-y-6">
      <FlowDialogHeading Title="h1" eyebrow="Payment for you" title="We couldn't" italic="claim it." />
      <Notice tone="danger" title={errorMessage || 'Something went wrong.'}>
        If you think this is a mistake, ask the sender to send it again, or message us on Telegram.
      </Notice>
      <Link href="/" className={`${statusAction.secondary} w-full`}>
        Go to the home page
      </Link>
    </div>
  );
}

/** The payment slip before its details are in. */
function ClaimLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <SkeletonGroup label={label} className="space-y-6">
      <div className="space-y-3">
        <Skeleton tone="page" className="h-3 w-32" />
        <Skeleton tone="page" className="h-10 w-64 rounded-[14px]" />
      </div>
      <div className="lp-card space-y-5 rounded-[28px] p-6 sm:p-7">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-14 w-48 rounded-[16px]" />
        <div className="space-y-4 border-t border-[var(--lp-rule)] pt-5">
          <div className="flex justify-between gap-4">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="flex justify-between gap-4">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        </div>
      </div>
      <Skeleton tone="page" className="h-14 w-full" />
    </SkeletonGroup>
  );
}

export default function ClaimPage() {
  return (
    <BareBrandPage>
      <div className="mx-auto w-full max-w-[480px] md:pt-6">
        <Suspense fallback={<ClaimLoading />}>
          <ClaimContent />
        </Suspense>
      </div>
    </BareBrandPage>
  );
}

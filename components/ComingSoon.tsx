'use client';

/**
 * What a route shows while its feature is switched off.
 *
 * Standing in for the page rather than redirecting away from it. Someone who typed the URL,
 * followed an old link or bookmarked the page gets an answer to what they came for — a
 * redirect answers a different question, and being bounced to the dashboard with no
 * explanation reads as something broken.
 *
 * It is rendered instead of, not on top of, the real page: the components behind it fetch
 * balances and earnings, and a feature that is not open should not be doing that work or
 * making those calls.
 */
import { ArrowLeft, Clock } from 'lucide-react';
import Link from 'next/link';

export function ComingSoon({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <section className="lp-card w-full max-w-[480px] rounded-[32px] p-7 text-center sm:p-10">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--lp-sand)] text-[var(--lp-ink)]">
          <Clock className="size-7" />
        </span>
        <p className="lp-mono mt-6 text-[12px] uppercase text-[var(--lp-muted)]">Coming soon</p>
        <h1 className="lp-display mt-2 text-[clamp(32px,7vw,44px)] leading-[0.95] tracking-[-0.045em]">{title}</h1>
        <p className="mx-auto mt-4 max-w-[360px] text-[15px] leading-[1.55] text-[var(--lp-body)]">{body}</p>
        <Link
          href="/dashboard"
          className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-6 text-[15px] font-semibold text-[var(--lp-cream)]"
        >
          <ArrowLeft className="size-4" /> Back to overview
        </Link>
      </section>
    </div>
  );
}

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
import { Clock } from 'lucide-react';
import Link from 'next/link';

export function ComingSoon({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="card-glass border border-white/10 rounded-2xl max-w-md w-full p-8 text-center space-y-5">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Clock className="w-6 h-6 text-accent/70" />
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent/60">
            Coming soon
          </p>
          <h1 className="text-2xl font-black tracking-tight text-brand-secondary">{title}</h1>
        </div>

        <p className="text-sm text-brand-secondary/55 leading-relaxed">{body}</p>

        <Link href="/dashboard" className="btn-secondary inline-flex h-11 px-6 items-center">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

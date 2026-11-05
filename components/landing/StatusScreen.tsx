/**
 * The cream screens for when a page is not the page: a missing address, a failed render, a
 * route still loading. The message sits beside a forest slip that records what happened, in
 * the same form as a payment slip, so even a dead end reads like the rest of Sendzz.
 */

import Link from "next/link";
import { cn } from "@/lib/utils";
import "@/components/landing/landing.css";
import { FlowLabel } from "@/components/flow/ui";
import { Wordmark } from "@/components/brand/Wordmark";

const pill =
  "inline-flex h-[50px] items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold outline-none transition-[scale,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-[#04c96a] focus-visible:ring-offset-2 active:scale-[0.97]";

/** The two buttons a status screen offers: ink for the way out, white for the alternative. */
export const statusAction = {
  primary: cn(pill, "bg-[var(--lp-ink)] text-[var(--lp-cream)]"),
  secondary: cn(pill, "border border-[rgb(var(--lp-hair)/0.15)] bg-[var(--lp-surface)] text-[var(--lp-ink)] hover:border-[var(--lp-ink)]"),
};

export type SlipRow = { label: string; value: React.ReactNode };

export function StatusScreen({
  eyebrow,
  title,
  italic,
  body,
  actions,
  slip,
}: {
  eyebrow: string;
  title: string;
  italic: string;
  body: React.ReactNode;
  actions: React.ReactNode;
  slip: { heading: string; code: string; rows: SlipRow[]; stamp: string };
}) {
  return (
    <section className="grid min-h-[min(640px,70dvh)] grid-cols-[minmax(0,1fr)] items-center gap-12 py-6 md:grid-cols-[minmax(0,1fr)_380px] md:gap-16">
      <div className="max-w-[600px]">
        <p className="lp-mono text-[13px] uppercase">{eyebrow}</p>
        <h1 className="lp-display mt-5 text-[clamp(48px,8vw,88px)] leading-[0.92] tracking-[-0.05em] [text-wrap:balance]">
          {title} <span className="lp-serif tracking-[-0.02em]">{italic}</span>
        </h1>
        <p className="mt-6 max-w-[520px] text-[clamp(17px,2vw,19px)] leading-[1.6] text-[var(--lp-body)]">{body}</p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">{actions}</div>
      </div>

      <aside
        aria-label={slip.heading}
        className="lp-on-forest relative w-full max-w-[380px] justify-self-center rounded-[28px] p-7 text-[var(--lp-cream)] md:justify-self-end"
      >
        <p className="lp-mono text-[12px] uppercase text-[var(--lp-green)]">{slip.heading}</p>
        <p className="lp-display mt-6 text-[clamp(64px,10vw,96px)] leading-none tracking-[-0.06em]">{slip.code}</p>
        <dl className="mt-7 border-t border-dashed border-[rgba(246,242,233,0.25)] pt-5">
          {slip.rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-[14px] text-[#9fb8aa]">{r.label}</dt>
              <dd className="lp-mono min-w-0 truncate text-right text-[13px]">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="lp-mono mt-6 inline-flex rounded-full border border-[rgba(246,242,233,0.3)] px-3 py-1 text-[11px] uppercase tracking-[0.08em]">
          {slip.stamp}
        </p>
      </aside>
    </section>
  );
}

/** A plain cream page with only the logo above, for screens that must not depend on sign-in. */
export function BareBrandPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-root min-h-dvh">
      <header className="mx-auto flex h-[72px] w-full max-w-[1360px] items-center px-4 md:h-[82.5px] md:px-7">
        <Link href="/" aria-label="Sendzz home">
          <Wordmark width={101.4} height={30} />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[1360px] px-4 pb-24 pt-6 md:px-7 md:pt-10">{children}</main>
    </div>
  );
}

/** The wait between pages: the logo breathing on cream, and one line saying what is coming. */
export function BrandLoading({ label, background }: { label: string; background?: React.ReactNode }) {
  return (
    <div
      className="lp-root relative flex min-h-dvh w-full items-center justify-center overflow-hidden"
      role="status"
      aria-live="polite"
    >
      {background}
      <div className="relative z-10 flex flex-col items-center gap-6">
        <Wordmark width={132} height={40} className="animate-pulse" />
        <FlowLabel>{label}</FlowLabel>
      </div>
    </div>
  );
}

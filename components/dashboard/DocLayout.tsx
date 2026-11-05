"use client";

/**
 * The long-document layout from the legal pages (Figma: Privacy policy, Terms of service), used
 * wherever a page is read top to bottom: a large two-part heading, an "On this page" list that
 * follows you down the page, and numbered sections ruled apart.
 *
 * Movement is kept to what helps you keep your place: the marker in the list slides to the
 * section you are reading, a click scrolls there smoothly, and each section slides into place
 * once as it arrives, without ever being hidden. All of it stands still for anyone who has asked for reduced motion.
 */

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EASE } from "@/components/landing/motion";
import { cn } from "@/lib/utils";

export type DocItem = { id: string; label: string };

/** The opening: mono eyebrow, the two-part heading, a lead, and a small mono line under it. */
export function DocHeader({
  eyebrow,
  title,
  italic,
  lead,
  meta,
}: {
  eyebrow: string;
  title: string;
  italic: string;
  lead?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  const still = useReducedMotion();
  return (
    <motion.header
      initial={still ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
      className="max-w-[720px]"
    >
      <p className="lp-mono text-[13px] uppercase">{eyebrow}</p>
      <h1 className="lp-display mt-5 text-[clamp(52px,9vw,96px)] leading-[0.9] tracking-[-0.05em]">
        {title} <span className="lp-serif tracking-[-0.02em]">{italic}</span>
      </h1>
      {lead && <p className="mt-7 max-w-[625px] text-[clamp(17px,2vw,19px)] leading-[1.6] text-[var(--lp-body)]">{lead}</p>}
      {meta && <p className="lp-mono mt-6 text-[13px] text-[var(--lp-muted)]">{meta}</p>}
    </motion.header>
  );
}

/** Which section is being read: the last one whose top has passed the upper fifth of the screen. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => visible.get(id));
        if (first) setActive(first);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);
  return [active, setActive] as const;
}

function scrollToSection(id: string, still: boolean | null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

/**
 * "On this page". A ruled column with the current section marked in green on a wide screen; a
 * sideways row of chips, pinned under the header, on a phone.
 */
export function DocToc({ items }: { items: DocItem[] }) {
  const still = useReducedMotion();
  const [active, setActive] = useActiveSection(items.map((i) => i.id));
  const go = (id: string) => {
    setActive(id);
    scrollToSection(id, still);
  };

  return (
    <>
      <nav aria-label="On this page" className="sticky top-8 hidden self-start lg:block">
        <p className="lp-mono text-[13px] uppercase">On this page</p>
        <ol className="mt-4 border-l border-[var(--lp-line)]">
          {items.map((item) => {
            const on = item.id === active;
            return (
              <li key={item.id} className="relative">
                {on && (
                  <motion.span
                    layoutId="doc-toc-marker"
                    transition={still ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
                    className="absolute -left-px inset-y-0 w-0.5 bg-[var(--lp-link)]"
                    aria-hidden
                  />
                )}
                <a
                  href={`#${item.id}`}
                  aria-current={on ? "location" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.id);
                  }}
                  className={cn(
                    "block py-1.5 pl-4 text-[15px] leading-[1.375] transition-colors duration-200",
                    on ? "font-medium text-[var(--lp-ink)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-ink)]",
                  )}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      <nav
        aria-label="On this page"
        className="sticky top-0 z-20 -mx-4 overflow-x-auto bg-[var(--lp-cream)]/90 px-4 py-3 backdrop-blur-sm [scrollbar-width:none] lg:hidden"
      >
        <ol className="flex gap-2">
          {items.map((item) => {
            const on = item.id === active;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.id);
                  }}
                  className={cn(
                    "block whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors duration-200",
                    on ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]" : "bg-[var(--lp-surface)] text-[var(--lp-muted)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)]",
                  )}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}

/** The page body: the list on the left and a 720px article beside it, as on the legal pages. */
export function DocBody({ items, children }: { items: DocItem[]; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[240px_minmax(0,720px)] lg:gap-24">
      <DocToc items={items} />
      <article className="min-w-0">{children}</article>
    </div>
  );
}

/** One numbered section, ruled off from the one before it. */
export function DocSection({
  id,
  number,
  title,
  description,
  action,
  children,
}: {
  id: string;
  number: number;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const still = useReducedMotion();
  return (
    <motion.section
      id={id}
      // Slides into place but is never hidden: the text must be readable before any script runs
      // (search engines, a slow phone, a failed load), which a fade from nothing would not allow.
      initial={still ? false : { y: 24 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 0.7, ease: EASE }}
      className="scroll-mt-24 border-t border-[var(--lp-rule)] pb-10 pt-10 first:border-t-0 first:pt-0 lg:scroll-mt-10"
    >
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="lp-mono text-[13px] text-[var(--lp-muted)]">{String(number).padStart(2, "0")}</p>
          <h2 className="lp-display mt-2 text-[clamp(28px,4vw,34px)] font-bold leading-[1.05] tracking-[-0.03em]">{title}</h2>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {description && <p className="mt-4 text-[17px] leading-[1.65] text-[var(--lp-body)]">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </motion.section>
  );
}

/** The forest card that ends a document and points to the next one. */
export function DocReadNext({ title, body, href, cta = "Read it" }: { title: string; body: string; href: string; cta?: string }) {
  return (
    <aside className="lp-on-forest mt-6 flex flex-col gap-5 rounded-[30px] p-8 text-[var(--lp-cream)] sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="lp-mono text-[13px] uppercase text-[var(--lp-green)]">Read next</p>
        <p className="lp-display mt-4 text-[36px] leading-none tracking-[-0.04em]">{title}</p>
        <p className="mt-3 max-w-[380px] text-[16px] leading-[1.55] text-[#cfe0d6]">{body}</p>
      </div>
      <Link
        href={href}
        className="lp-on-green inline-flex h-[46px] shrink-0 items-center gap-2 self-start rounded-full px-[22px] text-[15px] font-semibold text-[var(--lp-ink)] transition-transform duration-150 hover:-translate-y-px sm:self-auto"
      >
        {cta} <ArrowRight className="size-4" />
      </Link>
    </aside>
  );
}

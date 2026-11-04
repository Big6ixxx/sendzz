"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useSignIn } from "@/components/auth/SignIn";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { useRouter } from "next/navigation";
import { TELEGRAM_URL, X_URL } from "@/lib/social";
import { Wordmark } from "@/components/brand/Wordmark";

// The landing page's own sections, so the links only appear there.
const NAV = [
  { label: "Stories", href: "#stories" },
  { label: "How it works", href: "#how" },
  { label: "FAQ", href: "#faq" },
  { label: "Safety", href: "#safety" },
];

export function LandingHeader({ onGetStarted, showNav = false }: { onGetStarted: () => void; showNav?: boolean }) {
  return (
    <header className="sticky top-0 z-40 bg-[var(--lp-cream)]/90 backdrop-blur-[6px]">
      <div
        className={`mx-auto grid h-[72px] w-full max-w-[1360px] grid-cols-[1fr_auto] items-center px-4 md:h-[82.5px] md:px-7 ${showNav ? "md:grid-cols-[1fr_auto_1fr]" : ""}`}
      >
        <Link href="/" aria-label="Sendzz home" className="justify-self-start">
          <Wordmark width={101.4} height={30} priority />
        </Link>

        {showNav && (
          <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="text-[15px] font-medium leading-[22.5px] transition-colors duration-150 hover:text-[var(--lp-link)]"
              >
                {n.label}
              </a>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2 justify-self-end">
          <ThemeToggle />
          <button
            type="button"
            onClick={onGetStarted}
            className="lp-fixed h-[46.5px] rounded-full bg-[var(--lp-green)] px-[22px] text-[15px] font-semibold leading-[22.5px] text-[var(--lp-ink)] transition-[scale] duration-150 active:scale-[0.97]"
          >
            Get started
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * The header for every other public page (Explore, Privacy, Terms, 404), without the section
 * links: "Get started"
 * opens the dashboard when signed in and sign-in otherwise. The landing page wires its own,
 * richer flow.
 */
export function PublicHeader() {
  const { authenticated } = usePrivy();
  const { signIn } = useSignIn();
  const router = useRouter();
  return <LandingHeader onGetStarted={() => (authenticated ? router.push("/dashboard") : signIn())} />;
}

const FOOTER_LINKS = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
];

// lucide ships neither mark, so the paths are inlined.
const SOCIAL = [
  {
    label: "Sendzz on X",
    href: X_URL,
    size: 15,
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  {
    label: "Sendzz on Telegram",
    href: TELEGRAM_URL,
    size: 17,
    path: "M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.95.46l.34-4.8 8.74-7.9c.38-.34-.08-.53-.59-.19l-10.8 6.8-4.65-1.45c-1.01-.32-1.03-1.01.21-1.5l18.17-7c.84-.31 1.58.2 1.3 1.47z",
  },
];

// A 44px tap area on touch screens; text-height on desktop, where a pointer is precise.
const linkTone = "inline-flex items-center transition-colors duration-150 hover:text-[var(--lp-link)] max-md:min-h-11";

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--lp-rule)]">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col items-center gap-6 px-4 pb-28 pt-10 md:grid md:min-h-[107px] md:grid-cols-[1fr_auto_1fr] md:gap-0 md:px-7 md:py-0">
        <Wordmark width={87.88} height={26} className="md:justify-self-start" />
        <nav
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-0 text-[14px] leading-5 text-[var(--lp-body)] md:gap-y-2"
          aria-label="Footer"
        >
          {FOOTER_LINKS.map((l) => (
            <Link key={l.label} href={l.href} className={linkTone}>
              {l.label}
            </Link>
          ))}
          <span className="flex items-center gap-4">
            {SOCIAL.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} className={linkTone}>
                <svg viewBox="0 0 24 24" width={s.size} height={s.size} fill="currentColor" aria-hidden="true">
                  <path d={s.path} />
                </svg>
              </a>
            ))}
          </span>
        </nav>
        <p className="text-[14px] leading-5 text-[var(--lp-body)] md:justify-self-end">
          Copyright © {new Date().getFullYear()} Stallions Lab Global Limited
        </p>
      </div>
    </footer>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { TELEGRAM_URL, X_URL } from "@/lib/social";

const NAV = [
  { label: "Stories", href: "#stories" },
  { label: "How it works", href: "#how" },
  { label: "FAQ", href: "#faq" },
  { label: "Safety", href: "#safety" },
];

export function LandingHeader({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <header className="sticky top-0 z-40 bg-[rgba(246,242,233,0.9)] backdrop-blur-[6px]">
      <div className="mx-auto grid h-[72px] w-full max-w-[1360px] grid-cols-[1fr_auto] items-center px-4 md:h-[82.5px] md:grid-cols-[1fr_auto_1fr] md:px-7">
        <Link href="/" aria-label="Sendzz home" className="justify-self-start">
          <Image src="/landing/logo.svg" alt="Sendzz" width={101.4} height={30} priority />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-[15px] font-medium leading-[22.5px] transition-colors duration-150 hover:text-[#00a857]"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <button
          type="button"
          onClick={onGetStarted}
          className="h-[46.5px] justify-self-end rounded-full bg-[var(--lp-green)] px-[22px] text-[15px] font-semibold leading-[22.5px] transition-[scale] duration-150 active:scale-[0.97]"
        >
          Get started
        </button>
      </div>
    </header>
  );
}

const FOOTER_LINKS = [
  { label: "Security", href: "/security" },
  { label: "Terms", href: "/privacy" },
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
const linkTone = "inline-flex items-center transition-colors duration-150 hover:text-[#00a857] max-md:min-h-11";

export function LandingFooter() {
  return (
    <footer className="border-t border-[#ddd6c7]">
      <div className="mx-auto flex w-full max-w-[1360px] flex-col items-center gap-6 px-4 pb-28 pt-10 md:grid md:min-h-[107px] md:grid-cols-[1fr_auto_1fr] md:gap-0 md:px-7 md:py-0">
        <Image
          src="/landing/logo.svg"
          alt="Sendzz"
          width={87.88}
          height={26}
          className="md:justify-self-start"
        />
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
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={linkTone}>
            Support
          </a>
        </nav>
        <p className="text-[14px] leading-5 text-[var(--lp-body)] md:justify-self-end">
          Copyright © {new Date().getFullYear()} Stallions Lab Global Limited
        </p>
      </div>
    </footer>
  );
}

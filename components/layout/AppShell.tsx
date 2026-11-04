"use client";

/**
 * The signed-in shell, shared by the dashboard and the admin: a cream sidebar (logo, nav, account,
 * sign out) that collapses to icons on a wide screen and slides in on a phone, a phone header, and
 * the scrolling content area. Each layout passes only what is its own: its nav, an optional badge,
 * and anything extra beside the logo or above the content. The logo always goes to the home page.
 */

import { ChevronLeft, ChevronRight, LogOut, Menu, Moon, Sun, User, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { brandFontVars } from "@/components/landing/fonts";
import "@/components/landing/landing.css";
import { MEDIA, useMedia } from "@/components/landing/motion";
import { SwitchKnob } from "@/components/brand/ThemeToggle";
import { useTheme } from "@/lib/theme";
import { Wordmark } from "@/components/brand/Wordmark";

export type AppNavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shown but inert, with a "Soon" tag: the feature is not open yet. */
  soon?: boolean;
};

/** A section is current on its own page and, past the home page, on the pages beneath it. */
export const isNavCurrent = (pathname: string, href: string, home: string) =>
  href === home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

const subscribeStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
};

/** The wordmark, or the mark alone when the sidebar is collapsed. Both are transparent SVGs. */
function Logo({ collapsed, badge }: { collapsed?: boolean; badge?: string }) {
  if (collapsed) return <Image src="/landing/mark.svg" alt="Sendzz" width={24} height={30} priority />;
  return (
    <span className="flex items-center gap-2.5">
      <Wordmark width={100} height={30} priority />
      {badge && (
        <span className="lp-mono rounded-full bg-[var(--lp-ink)] px-2 py-0.5 text-[10px] uppercase text-[var(--lp-green)]">{badge}</span>
      )}
    </span>
  );
}

function AppSidebar({
  nav,
  pathname,
  home,
  badge,
  storageKey,
  navLabel,
  sectionLabel,
  accountLabel,
  userEmail,
  onLogout,
  besideLogo,
  isOpen,
  onClose,
}: {
  nav: AppNavItem[];
  pathname: string;
  home: string;
  badge?: string;
  storageKey: string;
  navLabel: string;
  sectionLabel?: string;
  accountLabel: string;
  userEmail?: string;
  onLogout: () => void;
  besideLogo?: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
}) {
  // The saved choice, read through useSyncExternalStore so the server render (always open) and the
  // browser's agree; a click then overrides it for this visit and saves it for the next.
  const stored = useSyncExternalStore(subscribeStorage, () => readFlag(storageKey), () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? stored;
  const toggle = () => {
    const next = !collapsed;
    setOverride(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // A preference that cannot be saved is not worth an error.
    }
  };

  const [theme, setTheme] = useTheme();
  const row = cn("relative flex items-center gap-3 rounded-full px-3 py-2.5 text-sm font-medium transition-colors", collapsed && "lg:justify-center lg:px-0");
  const label = cn(collapsed ? "lg:hidden" : "inline");

  return (
    <>
      {isOpen && <div className="fixed inset-0 z-40 bg-[rgba(17,26,19,0.35)] backdrop-blur-[4px] lg:hidden" onClick={onClose} />}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 border-r border-[var(--lp-rule)] bg-[var(--lp-raised)] transition-all duration-300 ease-in-out lg:relative lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "w-64 lg:w-20" : "w-64",
        )}
      >
        <div className={cn("flex h-full flex-col overflow-y-auto transition-all duration-300", collapsed ? "p-3 lg:px-4" : "p-5")}>
          <div className={cn("mb-8 flex shrink-0 items-center justify-between", collapsed ? "lg:flex-col lg:items-center lg:gap-4" : "px-2")}>
            <Link href="/" aria-label="Sendzz home" className="flex shrink-0 items-center">
              <span className="hidden lg:block">
                <Logo collapsed={collapsed} badge={badge} />
              </span>
              <span className="lg:hidden">
                <Logo badge={badge} />
              </span>
            </Link>

            {besideLogo && <div className={cn("flex items-center", collapsed && "justify-center")}>{besideLogo}</div>}

            <button
              type="button"
              onClick={toggle}
              className="hidden rounded-lg p-1.5 text-[var(--lp-muted)] outline-none transition-colors hover:bg-[var(--lp-cream)] hover:text-[var(--lp-ink)] lg:flex"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight className="size-4.5" /> : <ChevronLeft className="size-4.5" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="rounded-lg p-1.5 text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-cream)] lg:hidden"
            >
              <X className="size-5" />
            </button>
          </div>

          <nav className="flex-1 space-y-1" aria-label={navLabel}>
            {sectionLabel && !collapsed && <p className="lp-mono px-3 pb-2 text-[11px] uppercase text-[var(--lp-muted)]">{sectionLabel}</p>}
            {nav.map((item) => {
              if (item.soon) {
                // Shown, labelled, and inert: nothing to click, open in a new tab, or focus.
                return (
                  <div
                    key={item.href}
                    title={collapsed ? `${item.name} (coming soon)` : undefined}
                    aria-disabled="true"
                    className={cn(row, "cursor-default select-none text-[rgba(17,26,19,0.32)]")}
                  >
                    <item.icon className="size-4.5 shrink-0" />
                    <span className={label}>{item.name}</span>
                    <span className={cn("lp-fixed absolute right-2 top-1 rounded-full bg-[var(--lp-green)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--lp-ink)]", collapsed && "lg:hidden")}>
                      Soon
                    </span>
                  </div>
                );
              }
              const active = isNavCurrent(pathname, item.href, home);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  title={collapsed ? item.name : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(row, active ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]" : "text-[var(--lp-body)] hover:bg-[var(--lp-soft-2)] hover:text-[var(--lp-ink)]")}
                >
                  <item.icon className={cn("size-4.5 shrink-0", active && "text-[var(--lp-green)]")} />
                  <span className={label}>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto space-y-2 border-t border-[var(--lp-rule)] pt-5">
            <div className={cn("px-3 py-3 transition-all", collapsed ? "lg:px-0 lg:py-1" : "rounded-[18px] bg-[var(--lp-cream)]")}>
              <div className={cn("flex items-center gap-2.5", collapsed && "lg:justify-center")}>
                <span
                  className="lp-fixed grid size-7 shrink-0 place-items-center rounded-full bg-[var(--lp-green)] text-[var(--lp-ink)]"
                  title={collapsed ? userEmail : undefined}
                >
                  <User className="size-3.5" />
                </span>
                <div className={cn("min-w-0 flex-1", collapsed ? "lg:hidden" : "block")}>
                  <p className="truncate text-xs font-semibold text-[var(--lp-ink)]">{userEmail || "Signed in"}</p>
                  <p className="lp-mono text-[10px] uppercase text-[var(--lp-muted)]">{accountLabel}</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={collapsed ? (theme === "dark" ? "Light mode" : "Dark mode") : undefined}
              className={cn(row, "w-full text-[var(--lp-body)] hover:bg-[var(--lp-soft-2)] hover:text-[var(--lp-ink)]")}
            >
              {theme === "dark" ? <Sun className="size-4 shrink-0" /> : <Moon className="size-4 shrink-0" />}
              <span className={cn(label, "flex-1 text-left")}>Dark mode</span>
              <span className={cn(collapsed && "lg:hidden")}>
                <SwitchKnob on={theme === "dark"} />
              </span>
            </button>

            <button
              type="button"
              onClick={onLogout}
              title={collapsed ? "Sign out" : undefined}
              className={cn(row, "w-full text-[var(--lp-muted)] hover:bg-[#a1462c]/[0.08] hover:text-[var(--lp-danger)]")}
            >
              <LogOut className="size-4 shrink-0" />
              <span className={label}>Sign out</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * The whole frame. `background` sits behind everything (the dashboard's dot field); `banner`
 * spans the top of the scrolling area; `headerExtra` sits beside the menu button on a phone.
 */
export function AppShell({
  nav,
  pathname,
  home,
  badge,
  storageKey,
  navLabel,
  sectionLabel,
  accountLabel,
  userEmail,
  onLogout,
  besideLogo,
  headerExtra,
  background,
  banner,
  contentClassName,
  children,
}: {
  nav: AppNavItem[];
  pathname: string;
  home: string;
  badge?: string;
  storageKey: string;
  navLabel: string;
  sectionLabel?: string;
  accountLabel: string;
  userEmail?: string;
  onLogout: () => void;
  besideLogo?: React.ReactNode;
  headerExtra?: React.ReactNode;
  background?: React.ReactNode;
  banner?: React.ReactNode;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wide = useMedia(MEDIA.wide);

  return (
    <div className={`lp-root ${brandFontVars} flex h-dvh overflow-hidden`}>
      {background}

      <AppSidebar
        nav={nav}
        pathname={pathname}
        home={home}
        badge={badge}
        storageKey={storageKey}
        navLabel={navLabel}
        sectionLabel={sectionLabel}
        accountLabel={accountLabel}
        userEmail={userEmail}
        onLogout={onLogout}
        // Mounted only where it shows: the sidebar slot on a wide screen, the header slot below it,
        // so something live in both (the notification bell, which polls) runs once.
        besideLogo={wide ? besideLogo : undefined}
        isOpen={open}
        onClose={() => setOpen(false)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Phone and tablet header; the sidebar takes its place on a wide screen. */}
        <header className="sticky top-0 z-30 flex shrink-0 items-center justify-between border-b border-[var(--lp-rule)] bg-[var(--lp-cream)]/90 px-4 py-3 backdrop-blur-[6px] md:px-6 lg:hidden">
          <Link href="/" aria-label="Sendzz home" className="flex items-center">
            <Logo badge={badge} />
          </Link>
          <div className="flex items-center gap-3">
            {!wide && headerExtra}
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="grid size-11 place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-cream)]"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {banner}
          <div className={contentClassName ?? "p-4 md:p-6 lg:p-8"}>{children}</div>
        </div>
      </main>
    </div>
  );
}

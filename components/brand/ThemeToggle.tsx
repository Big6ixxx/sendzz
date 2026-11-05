"use client";

/**
 * The controls for light and dark mode. What they show (sun or moon, the switch on or off) is
 * styled from the page's own `data-theme` with `dark:` utilities, so it is right from the first
 * frame; reading the mode in React would only catch up after hydration, and a switch saved "on"
 * would visibly slide over on every load. The mode is only read in JS for screen readers.
 */

import { Moon, Sun } from "lucide-react";
import { toggleTheme, useTheme } from "@/lib/theme";
import { Switch } from "@/components/dashboard/SettingsKit";
import { cn } from "@/lib/utils";

/** A round button that flips between light and dark, for the public headers. */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useTheme() === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "lp-card grid size-11 shrink-0 place-items-center rounded-full text-[var(--lp-ink)] outline-none transition-[scale] duration-150 focus-visible:ring-2 focus-visible:ring-[#04c96a] active:scale-[0.94]",
        className,
      )}
    >
      <ThemeIcon className="size-[18px]" />
    </button>
  );
}

/** A moon in light mode (go dark), a sun in dark mode (go light). */
export function ThemeIcon({ className }: { className?: string }) {
  return (
    <>
      <Moon className={cn("dark:hidden", className)} aria-hidden />
      <Sun className={cn("hidden dark:block", className)} aria-hidden />
    </>
  );
}

/** The sidebar's switch knob, drawn (the row around it is the button), on in dark mode. */
export function ThemeKnob() {
  return (
    <span
      aria-hidden
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-[var(--lp-rule)] transition-colors duration-200 dark:bg-[var(--lp-ink)]"
    >
      <span className="absolute left-0.5 size-4 rounded-full bg-[var(--lp-surface)] shadow-[0_1px_3px_rgb(17_26_19/0.25)] transition-transform duration-200 dark:translate-x-4" />
    </span>
  );
}

/** The dark mode switch for a settings row: the settings Switch, drawn from the page's mode. */
export function ThemeSwitch() {
  return <Switch label="Dark mode" checked={useTheme() === "dark"} onChange={toggleTheme} followsTheme />;
}

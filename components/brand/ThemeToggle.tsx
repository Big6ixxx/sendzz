"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** A round button that flips between light and dark, for the public headers. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn(
        "lp-card grid size-11 shrink-0 place-items-center rounded-full text-[var(--lp-ink)] outline-none transition-[scale] duration-150 focus-visible:ring-2 focus-visible:ring-[#04c96a] active:scale-[0.94]",
        className,
      )}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

/** The switch's knob and track, drawn (not a control), for rows that are themselves the button. */
export function SwitchKnob({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
        on ? "bg-[var(--lp-ink)]" : "bg-[var(--lp-rule)]",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 size-4 rounded-full bg-[var(--lp-surface)] shadow-[0_1px_2px_rgb(17_26_19/0.25)] transition-transform duration-200",
          on && "translate-x-4",
        )}
      />
    </span>
  );
}

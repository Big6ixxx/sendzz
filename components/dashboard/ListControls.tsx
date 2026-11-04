"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The pill shape shared by filter chips, toggles and list actions on the cream pages. */
export const listPill =
  "h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--lp-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lp-cream)]";

/** A pill search box with a clear button, for filtering a list on the page. */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="flex h-12 w-full min-w-0 items-center gap-3 rounded-full bg-[var(--lp-surface)] px-4 shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)] sm:flex-1">
      <Search className="size-4 shrink-0 text-[var(--lp-muted)]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--lp-placeholder)] md:text-[15px]"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="grid size-7 place-items-center rounded-full text-[var(--lp-muted)] hover:bg-[var(--lp-cream)]"
        >
          <X className="size-4" />
        </button>
      )}
    </label>
  );
}

/** One-of-many chips. They scroll sideways on a phone instead of wrapping into a ragged block. */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            listPill,
            "inline-flex items-center gap-2",
            value === o.value
              ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]"
              : "bg-[var(--lp-surface)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)]",
          )}
        >
          {o.label}
          {!!o.count && (
            <span
              className={cn(
                "rounded-full px-1.5 text-[12px] tabular-nums",
                value === o.value ? "bg-[rgba(246,242,233,0.18)]" : "bg-[var(--lp-cream)] text-[var(--lp-muted)]",
              )}
            >
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

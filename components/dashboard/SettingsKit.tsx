"use client";

import { ArrowLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Settings rows in the cream brand, laid out by DocLayout: what the setting is, one line on what
 * it does, and its control on the right. No icon per row; the words carry it.
 */
/** A ruled list of rows, straight on the page as in the long-document layout. */
export function DocRows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-[var(--lp-rule)] border-t border-[var(--lp-rule)]">{children}</div>;
}

/** One setting. Give it `href` to make the whole row a link, or `control` for what sits at its end. */
export function SettingsRow({
  title,
  description,
  control,
  href,
  onClick,
  muted,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /** Dimmed when it depends on another setting that is off. */
  muted?: boolean;
}) {
  const body = (
    <>
      <span className={cn("min-w-0 flex-1", muted && "opacity-50")}>
        <span className="block text-[17px] font-semibold leading-snug">{title}</span>
        {description && <span className="mt-1 block text-[15px] leading-[1.55] text-[var(--lp-body)]">{description}</span>}
      </span>
      {href ? (
        <ArrowUpRight className="size-4 shrink-0 text-[var(--lp-muted)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      ) : (
        control && <span className="flex shrink-0 items-center gap-2">{control}</span>
      )}
    </>
  );
  const row = "group flex w-full items-center justify-between gap-4 py-4 text-left";
  if (href) {
    return (
      <Link href={href} className={row}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={row}>
        {body}
      </button>
    );
  }
  return <div className={row}>{body}</div>;
}

/** An on/off switch: ink track when on, a sand one when off. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[#04c96a] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[var(--lp-ink)]" : "bg-[var(--lp-rule)]",
      )}
    >
      <span
        className={cn(
          "size-5 rounded-full shadow-[0_1px_3px_rgb(17_26_19/0.25)] transition-transform duration-200",
          checked ? "lp-fixed translate-x-6 bg-[var(--lp-green)]" : "translate-x-1 bg-[var(--lp-surface)]",
        )}
      />
    </button>
  );
}

/** A small text action at the end of a row: "Set up", "Change", "Remove". */
export function RowAction({
  children,
  onClick,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-full px-4 text-[14px] font-semibold transition-colors",
        tone === "primary" && "bg-[var(--lp-ink)] text-[var(--lp-cream)]",
        tone === "default" && "bg-[var(--lp-cream)] hover:bg-[var(--lp-sand)]",
        tone === "danger" && "text-[var(--lp-danger)] hover:bg-[var(--lp-danger-soft)]",
      )}
    >
      {children}
    </button>
  );
}

/** The way back from a settings sub-page. */
export function SettingsBack() {
  return (
    <Link
      href="/dashboard/settings"
      className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--lp-surface)] pl-3 pr-4 text-[14px] font-semibold shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)]"
    >
      <ArrowLeft className="size-4" /> Settings
    </Link>
  );
}

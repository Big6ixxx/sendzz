"use client";

/**
 * The PIN as a keypad: four dots and a number pad, the way a phone unlocks or a banking app
 * approves a payment.
 *
 * On a phone the pad IS the keyboard, so there is no system keypad sliding up over the thing
 * being approved. On a computer the physical keys work too: digits, Backspace and Enter are
 * read from the window while the pad is mounted (and not from another field that has focus).
 *
 * Every PIN and every 6-digit code in the app is entered here, so they all look and behave the
 * same. Digits only, capped at the length, in one place.
 */

import { Delete } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

// Pads listen to the whole window, so when two are mounted at once (a PIN setup gate under an
// approval sheet, a dialog still closing) only the newest may take the keyboard. Each pad holds
// a place in this stack while mounted.
const padStack: number[] = [];
let padSeq = 0;

export function PinPad({
  value,
  onChange,
  onComplete,
  onEnter,
  error,
  disabled,
  label,
  length = 4,
  masked = length === 4,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired once the last digit lands, after it has been painted. */
  onComplete?: () => void;
  onEnter?: () => void;
  error?: string | null;
  disabled?: boolean;
  label: string;
  /** 4 for a PIN, 6 for a code from an email or an authenticator app. */
  length?: 4 | 6;
  /** Dots instead of digits. On by default for a PIN; a code is shown so it can be checked. */
  masked?: boolean;
}) {
  const press = (digit: string) => {
    if (disabled || value.length >= length) return;
    onChange(value + digit);
  };
  // A pasted code fills the pad: codes arrive by email and are usually copied, not retyped.
  const paste = (text: string) => {
    if (disabled) return;
    const digits = text.replace(/\D/g, "").slice(0, length);
    if (digits) onChange(digits);
  };
  const back = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  // Whether onComplete has run for the entry now in the pad, and whether to hold it back because
  // the pad opened already full (stepping back to a code entered before): that waits for an edit
  // or for Enter, instead of submitting the old entry the moment it reappears.
  const fired = useRef(false);
  const holdAuto = useRef(value.length === length);

  // Enter on a full pad submits it, unless it has already submitted itself: sending the same
  // entry twice would spend a PIN attempt or a code.
  const enter = () => {
    if (onComplete && value.length === length) {
      if (fired.current || disabled) return;
      fired.current = true;
      onComplete();
      return;
    }
    onEnter?.();
  };

  // The keyboard, for anyone at a computer. Kept in a ref so the listener is added once and
  // always sees the latest value.
  const latest = useRef({ press, back, paste, enter });
  useEffect(() => {
    latest.current = { press, back, paste, enter };
  });
  useEffect(() => {
    const id = ++padSeq;
    padStack.push(id);
    const isTop = () => padStack[padStack.length - 1] === id;
    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      // Shortcuts stay the browser's: Cmd+1 switches tabs, it does not type a 1 into the PIN.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        latest.current.press(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        latest.current.back();
      } else if (e.key === "Enter") {
        // A focused button or link handles its own Enter; running onEnter too would act twice.
        if (target?.closest("button, a, [role='button']")) return;
        latest.current.enter();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!isTop()) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (!text) return;
      e.preventDefault();
      latest.current.paste(text);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      padStack.splice(padStack.indexOf(id), 1);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  // Fired from an effect rather than inside the key handler so the last slot is painted before
  // the request starts, otherwise it reads as though the digit was dropped.
  useEffect(() => {
    if (value.length < length) {
      fired.current = false;
      holdAuto.current = false;
      return;
    }
    if (!fired.current && !holdAuto.current && !disabled) {
      fired.current = true;
      onComplete?.();
    }
  }, [value, disabled, onComplete, length]);

  // A key clicked with the mouse does not take focus, so a later Enter or Space submits instead of
  // pressing that digit again. Keys reached with Tab still take focus and work as usual.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  // Always drawn for the forest panel: cream keys, green dots. See PinPanel for use on cream screens.
  const key =
    "grid h-12 place-items-center rounded-full bg-[rgba(246,242,233,0.08)] text-[22px] font-medium tabular-nums text-[var(--lp-cream)] outline-none transition-[background-color,scale] duration-100 hover:bg-[rgba(246,242,233,0.14)] focus-visible:ring-2 focus-visible:ring-[var(--lp-green)] active:scale-[0.94] disabled:opacity-40 sm:h-14 sm:text-[24px] md:h-[60px]";

  return (
    <div className="space-y-3 sm:space-y-5" role="group" aria-label={label}>
      {/* The dots. Re-keyed on each new error so the shake replays for every rejection. */}
      <div className="relative space-y-3">
        {!masked && (
          // A real field over the digits, for codes only. A phone can long-press it to paste and
          // offer the code from the email above its keyboard; a computer can type into it as well.
          // It is invisible: the digits underneath stay what is seen.
          <input
            aria-label={label}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={length}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, length);
              if (digits !== value) onChange(digits);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                enter();
              }
            }}
            className="absolute inset-x-0 top-0 z-10 h-8 w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
          />
        )}
        <div
          key={error ?? "ok"}
          className={cn("flex h-8 items-center justify-center", masked ? "gap-4" : "gap-3", error && "lp-shake")}
          aria-hidden
        >
          {Array.from({ length }, (_, i) =>
            masked || !value[i] ? (
              <span
                key={i}
                className={cn(
                  "size-4 rounded-full transition-[background-color,transform,box-shadow] duration-150",
                  error
                    ? "bg-[#e07a5f]"
                    : value[i]
                      ? "scale-110 bg-[var(--lp-green)]"
                      : "shadow-[inset_0_0_0_2px_rgba(246,242,233,0.35)]",
                )}
              />
            ) : (
              // A typed code digit takes the dot's place, same rhythm, so it can be checked.
              <span
                key={i}
                className={cn(
                  "lp-display w-4 text-center text-[26px] leading-none tabular-nums animate-in zoom-in-50 duration-150",
                  error ? "text-[#e07a5f]" : "text-[var(--lp-green)]",
                )}
              >
                {value[i]}
              </span>
            ),
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {value.length} of {length} digits entered
        </p>
        <p
          role={error ? "alert" : undefined}
          className={cn(
            "min-h-5 text-center text-[14px] font-medium",
            error ? "text-[#f4a68f]" : "text-transparent",
          )}
        >
          {error ?? " "}
        </p>
      </div>

      <div className="mx-auto grid max-w-[300px] grid-cols-3 gap-2 sm:gap-2.5">
        {KEYS.map((d) => (
          <button key={d} type="button" onMouseDown={keepFocus} onClick={() => press(d)} disabled={disabled} className={key}>
            {d}
          </button>
        ))}
        <span aria-hidden />
        <button type="button" onMouseDown={keepFocus} onClick={() => press("0")} disabled={disabled} className={key}>
          0
        </button>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={back}
          disabled={disabled || value.length === 0}
          aria-label="Delete last digit"
          className={cn(key, "bg-transparent text-[#cfe0d6] hover:bg-transparent")}
        >
          <Delete className="size-6" />
        </button>
      </div>
    </div>
  );
}

/**
 * The keypad on its forest panel, as the payment approval shows it. Used wherever a PIN or a code
 * is typed on a cream screen, so every entry looks like the one people see most.
 *
 * It bleeds to the edges of the dialog it ends (the dialogs pad 24px, 32px from sm) and forms the
 * dialog's foot, so it must be the last thing in it; the dialog's own rounded corners clip it.
 * Actions that finish the step go in `footer`, on the green, as in the approval sheet.
 */
export function PinPanel({
  label,
  action,
  above,
  footer,
  ...pad
}: React.ComponentProps<typeof PinPad> & {
  /** What to type, shown over the dots. */
  label: string;
  /** A small link on the right of the label: "Send another", "Back". */
  action?: React.ReactNode;
  /** Anything that belongs on the panel above the label, such as a progress bar. */
  above?: React.ReactNode;
  /** The step's actions, under the keypad. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="lp-on-forest -mx-6 -mb-6 space-y-4 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 text-[var(--lp-cream)] sm:-mx-8 sm:-mb-8 sm:px-8 sm:pb-8 sm:pt-7">
      {above}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-semibold">{label}</p>
        {action && <span className="shrink-0 text-[13px] text-[#a9c2b5]">{action}</span>}
      </div>
      <PinPad {...pad} label={label} />
      {footer && <div className="mx-auto max-w-[300px] space-y-3 pt-1">{footer}</div>}
    </div>
  );
}

/** A link on the forest panel, in its quieter cream. */
export function PinPanelAction({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-semibold text-[#a9c2b5] underline-offset-2 transition-colors hover:text-[var(--lp-cream)] hover:underline disabled:no-underline disabled:opacity-60"
    >
      {children}
    </button>
  );
}

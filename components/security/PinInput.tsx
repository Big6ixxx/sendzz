"use client";

/**
 * The 4-digit PIN field, wherever one is asked for.
 *
 * Styled to match the 2FA code boxes in TwoFactorModal — same size, same `border-2`, same accent
 * focus ring, same red for a rejection — so entering a PIN and entering an emailed code feel
 * like the same product rather than two designs that grew separately.
 *
 * It is built differently underneath, and deliberately. The 2FA field is six real inputs with
 * focus hopping between them; this is ONE input sitting invisible behind four painted boxes. A
 * grid of separate inputs breaks paste, fights autofill, and loses the mobile numeric keypad as
 * focus jumps. Here the browser only ever sees a single numeric field, and the boxes are
 * decoration that cannot get out of step with it.
 *
 * Digits only and capped at four in one place, so no caller can accidentally accept a fifth
 * character or a letter and send something the server will only reject after a round trip.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SLOTS = [0, 1, 2, 3];

export function PinInput({
  value,
  onChange,
  onEnter,
  onComplete,
  error,
  label = "Transaction PIN",
  srOnlyLabel,
  autoFocus,
  disabled,
  autoComplete = "off",
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  /**
   * Fired once the fourth digit lands, so a payment can submit without a separate tap.
   *
   * Opt-in: the setup wizard has a second screen to move to and must not submit on its own.
   */
  onComplete?: () => void;
  error?: string | null;
  label?: string;
  /** Hide the label visually when the surrounding copy already says what to type. */
  srOnlyLabel?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);

  // Fired from an effect rather than inside onChange so the fourth box is painted before the
  // request starts. Submitting mid-keystroke leaves the last box visibly empty while the button
  // says "Confirming…", which reads as though the digit was dropped.
  const completed = useRef(false);
  useEffect(() => {
    if (value.length === 4 && !completed.current && !disabled) {
      completed.current = true;
      onComplete?.();
    }
    if (value.length < 4) completed.current = false;
  }, [value, disabled, onComplete]);

  // The box the next digit will land in. Shown only while focused, so an idle field is not
  // pretending to be ready for input.
  const active = focused && !disabled ? value.length : -1;

  return (
    <div className="space-y-3">
      <label className="block">
        <span
          className={cn(
            srOnlyLabel
              ? "sr-only"
              : "block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30",
          )}
        >
          {label}
        </span>

        <div className="relative">
          <input
            autoFocus={autoFocus}
            disabled={disabled}
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onEnter) onEnter();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            inputMode="numeric"
            type="password"
            autoComplete={autoComplete}
            aria-label={label}
            aria-invalid={!!error}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
          />

          <div aria-hidden className="flex gap-2 justify-center pointer-events-none">
            {SLOTS.map((i) => (
              <div
                key={i}
                className={cn(
                  "w-12 h-14 rounded-xl border-2 bg-white/5",
                  "flex items-center justify-center text-2xl font-bold text-white",
                  "transition-all",
                  disabled && "opacity-50",
                  error
                    ? "border-red-500/50 ring-2 ring-red-500/20"
                    : active === i
                      ? "border-accent ring-2 ring-accent/20"
                      : "border-white/10",
                )}
              >
                {/* Masked, unlike the emailed code: a PIN authorises payments and is worth
                    keeping off the screen. The bullet sits at the same size and weight a digit
                    would, so the box reads identically. */}
                {value[i] ? "•" : ""}
              </div>
            ))}
          </div>
        </div>
      </label>

      {error && (
        <p className="text-xs font-bold text-red-400 uppercase tracking-widest text-center">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The 4-digit PIN field, wherever one is asked for.
 *
 * This file used to also hold `PinGate`, the dialog that confirmed security changes with the
 * PIN. That is gone: weakening a protection now costs a SECOND FACTOR rather than the secret
 * that authorises payments — see components/security/SecurityStepUp.tsx. What remains is the
 * input itself, still used by the payment prompt, the PIN setup wizard and the reset flow.
 */

import { cn } from "@/lib/utils";

/**
 * The 4-digit PIN field, wherever one is asked for.
 *
 * One real input sitting invisible behind four painted boxes. A grid of four separate inputs
 * is the obvious way to build this and the wrong one: it breaks paste, fights autofill, and
 * loses the mobile numeric keypad as focus jumps between fields. Here the browser only ever
 * sees a single numeric field.
 *
 * Digits only and capped at four in one place, so no caller can accidentally accept a fifth
 * character or a letter and send something the server will only reject after a round trip.
 */
export function PinInput({
  value,
  onChange,
  onEnter,
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
  error?: string | null;
  label?: string;
  /** Hide the label visually when the surrounding copy already says what to type. */
  srOnlyLabel?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-3">
      <label className="block relative">
        <span
          className={cn(
            srOnlyLabel
              ? "sr-only"
              : "block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30",
          )}
        >
          {label}
        </span>

        <input
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
          inputMode="numeric"
          type="password"
          autoComplete={autoComplete}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <span className="flex gap-2.5 justify-center pointer-events-none">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                "h-14 rounded-xl flex items-center justify-center border",
                "text-2xl font-bold text-brand-secondary transition-colors",
                error
                  ? "border-orange-400/40 bg-orange-500/5"
                  : value.length === i && !disabled
                    ? "border-accent/60 bg-accent/5"
                    : "border-white/10 bg-white/[0.03]",
              )}
              style={{ width: 52 }}
            >
              {value[i] ? "\u2022" : ""}
            </span>
          ))}
        </span>
      </label>

      {error && <p className="text-[12.5px] text-orange-400 text-center">{error}</p>}
    </div>
  );
}

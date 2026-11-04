"use client";

/**
 * The confirmation sheet: what is about to happen, and the PIN that approves it.
 *
 * This is the screen that replaced Privy's wallet pop-ups. Those pop-ups were accurate and
 * unreadable — they described a user operation to people who came here to send money to a
 * friend, and they appeared once per signature with no warning that a second one was coming.
 * `showWalletUIs: false` in components/providers.tsx turns them off; this is what stands in
 * their place, and it is shown ONCE per transaction no matter how many signatures the
 * transaction needs.
 *
 * Every outgoing action goes through `authorize()`. It shows the user what they are about to
 * do, takes the PIN, and returns a single-use token bound to that exact operation — which the
 * server then requires. See lib/security/transaction-auth.ts for why a token rather than a
 * yes/no answer.
 *
 * It is a provider rather than a hook-with-its-own-dialog because the payment hooks that need
 * it (`useTransfer`, `useDepositWithdraw`, and the rest) are not components and cannot render
 * anything. They await a promise; one dialog, mounted once at the top of the dashboard,
 * resolves it.
 *
 * --- What this is, and is not ------------------------------------------------
 *
 * For withdrawals and the Stellar rails, the server refuses the operation without the token,
 * so this is a real gate. For EVM sends the browser signs against Circle's bundler directly
 * and no server sits in that path; there the token is spent as an audit record and the PIN is
 * a control on the person at the keyboard, not on the signature. Both are worth having and
 * they are not the same thing — see the module header of transaction-auth.ts.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AlertTriangle } from "lucide-react";
import { FlowButton, FlowLabel } from "@/components/flow/ui";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ForgotPinDialog } from "@/components/security/ForgotPinDialog";
import { PinPad } from "@/components/security/PinPad";
import { PinSetup } from "@/components/PasskeySetupWizard";
import {
  durationEstimate,
  signatureCount,
  type SigningPlan,
} from "@/lib/signing/plan";

/** The operations a PIN can authorise. Mirrors AuthorizationPurpose on the server. */
export type AuthorizationPurpose =
  | "transfer"
  | "crypto_transfer"
  | "withdrawal"
  | "bridge"
  | "batch_send";

/**
 * The fields the token is bound to.
 *
 * These are hashed on the server and compared again when the operation runs, so they must be
 * the values the transaction will actually use — not a friendlier approximation of them.
 */
export interface AuthorizationPayload {
  destination: string;
  amount: number | string;
  chain?: string | null;
}

/** One line of the "here is what you are approving" summary. */
export interface AuthorizationDetail {
  label: string;
  value: string;
}

export interface AuthorizationRequest {
  purpose: AuthorizationPurpose;
  payload: AuthorizationPayload;
  /**
   * The two facts someone is actually deciding on: how much leaves, and where it goes.
   *
   * Rendered as the headline. They used to be a `title` sentence AND the first rows of the
   * breakdown — "Send $5.00 to ada@example.com" sitting directly above `Amount $5.00` and
   * `To ada@example.com`. Saying it twice made the dialog taller without making it clearer,
   * and pushed the thing being asked for below the fold.
   */
  amount: string;
  destination: string;
  /**
   * What cannot be taken back, in one short clause.
   *
   * Kept separate from the step list because it is the one line that should survive however
   * little of this anyone reads.
   */
  warning?: string;
  /**
   * Anything the headline does not already say — a fee, a bank, a note.
   *
   * Do NOT repeat the amount or the destination here. A row that restates the headline is
   * what made this dialog overflow in the first place.
   */
  details?: AuthorizationDetail[];
  /**
   * What the transaction will ask of them, step by step.
   *
   * Supplied wherever the flow takes more than one confirmation. This is the part that stops
   * a second prompt reading as a failure of the first — see lib/signing/plan.ts.
   */
  plan?: SigningPlan;
  confirmLabel?: string;
}

interface PinAuthorizationContextValue {
  /**
   * Show the prompt and resolve with a token, or with null if the user backed out.
   *
   * Never rejects. A cancelled PIN is an ordinary outcome on a payment screen, and a caller
   * that had to wrap this in a try/catch to handle "they changed their mind" would eventually
   * treat a real failure as a cancellation.
   */
  authorize: (request: AuthorizationRequest) => Promise<string | null>;
}

const PinAuthorizationContext = createContext<PinAuthorizationContextValue | null>(null);

/**
 * The small grey line above the amount.
 *
 * Derived from the purpose rather than passed in, so five call sites cannot drift into five
 * different ways of saying the same thing. It is a label, not a sentence — the amount below it
 * is what people actually read.
 */
function purposeHeading(purpose?: AuthorizationPurpose): string {
  switch (purpose) {
    case "transfer":
      return "Confirm transfer";
    case "crypto_transfer":
      return "Confirm send";
    case "withdrawal":
      return "Confirm withdrawal";
    case "bridge":
      return "Confirm network move";
    case "batch_send":
      return "Confirm batch payment";
    default:
      return "Confirm payment";
  }
}

/**
 * The one line of the plan that stays visible whether the steps are open or shut.
 *
 * The step list is education — it matters the first time somebody bridges and is furniture by
 * the third. These two facts are different: that another confirmation is coming, and roughly
 * how long the whole thing takes, are the things that change what someone does next. Folding
 * them into the summary means collapsing the detail costs nothing operationally.
 */
function planSummary(plan: SigningPlan): string {
  const count = signatureCount(plan);
  const duration = durationEstimate(plan);
  if (count <= 1) return `Takes ${duration}`;
  const word = count === 2 ? "Two confirmations" : `${count} confirmations`;
  return `${word} · takes ${duration}`;
}

/**
 * The PIN prompt for the payment paths.
 *
 * Throws when used outside the provider rather than returning a no-op. A silently missing
 * provider would mean every transaction proceeding without a PIN, which is the exact failure
 * this whole mechanism exists to prevent — it must be impossible to miss.
 */
export function usePinAuthorization(): PinAuthorizationContextValue {
  const ctx = useContext(PinAuthorizationContext);
  if (!ctx) {
    throw new Error(
      "usePinAuthorization must be used inside <PinAuthorizationProvider>. Without it, " +
        "transactions would run with no PIN check at all.",
    );
  }
  return ctx;
}

export function PinAuthorizationProvider({ children }: { children: React.ReactNode }) {
  const { user } = usePrivy();
  const [request, setRequest] = useState<AuthorizationRequest | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // The promise the caller is awaiting. Held in a ref because resolving it must not depend on
  // a re-render having happened — the dialog closes and the payment continues in the same tick.
  const resolverRef = useRef<((token: string | null) => void) | null>(null);

  const settle = useCallback((token: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    setPin("");
    setError(null);
    setNeedsSetup(false);
    setBusy(false);
    resolve?.(token);
  }, []);

  const authorize = useCallback(
    (next: AuthorizationRequest) =>
      new Promise<string | null>((resolve) => {
        // A second prompt while one is open would strand the first caller's promise forever,
        // and an awaited promise that never settles is a payment screen frozen with no error.
        // The newcomer is refused instead; the open prompt keeps its turn.
        if (resolverRef.current) {
          resolve(null);
          return;
        }
        resolverRef.current = resolve;
        setPin("");
        setError(null);
        setNeedsSetup(false);

        setRequest(next);
      }),
    [],
  );

  const confirm = useCallback(async () => {
    if (!request || pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/2fa/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "authorize",
          pin,
          purpose: request.purpose,
          payload: request.payload,
        }),
      });
      const data = await res.json();

      // No PIN exists yet. Every other rejection here means "you typed the wrong one", and
      // showing this one the same way leaves somebody retyping a PIN that was never set —
      // which is exactly what happens when the setup gate on the dashboard has not run, for
      // whatever reason. The payment is not abandoned: the request stays pending, they set a
      // PIN here, and then approve with it.
      if (data.code === "no_pin") {
        setNeedsSetup(true);
        setPin("");
        setError(null);
        setBusy(false);
        return;
      }

      if (!res.ok || !data.authorization) {
        // The server's wording carries the attempts left, or how long a lockout has to run.
        // The prompt stays open so a mistyped PIN costs a retry rather than the whole flow.
        setError(data.error ?? "That PIN was not accepted.");
        setPin("");
        setBusy(false);
        return;
      }

      settle(data.authorization as string);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }, [request, pin, busy, settle]);

  const value = useMemo(() => ({ authorize }), [authorize]);

  return (
    <PinAuthorizationContext.Provider value={value}>
      {children}

      <Dialog open={!!request} onOpenChange={(open) => !open && settle(null)}>
        <DialogContent
          showCloseButton={false}
          // Focus goes to the sheet itself, not the "1" key (which would read as pressed), and
          // never stays on the button that opened it: Enter there would press that button again
          // instead of confirming. The keypad listens to the whole window, so typing works at once.
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
          }}
          className="grid max-h-[calc(100dvh-2rem)] max-w-[820px] grid-cols-[minmax(0,1fr)] sm:max-w-[820px] gap-0 overflow-hidden p-0 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)] max-md:inset-0 max-md:h-dvh max-md:max-h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:grid-rows-[minmax(0,1fr)_auto] max-md:rounded-none"
        >
          {/* ── The slip: what you are approving ─────────────────────────────── */}
          {/* Laid out like a payment slip because that is what it is: the amount as the figure,
              the payee on its own line, and the rest as leader rows to check against. The only
              part of the sheet allowed to scroll — the keypad never leaves the screen. */}
          <div className="min-h-0 overflow-y-auto px-4 pb-6 pt-5 sm:px-6 sm:pt-6 md:flex md:items-center md:py-8">
            <div className="mx-auto w-full max-w-[420px]">
              <div className="lp-card relative rounded-t-[24px] px-6 pb-7 pt-6">
                <div className="flex items-center justify-between gap-3">
                  <DialogTitle className="lp-mono text-[12px] font-normal uppercase text-[var(--lp-muted)]">
                    {purposeHeading(request?.purpose)}
                  </DialogTitle>
                  <FlowLabel as="span">
                    {new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </FlowLabel>
                </div>

                <p className="lp-display mt-6 break-words text-[clamp(44px,12vw,60px)] leading-[0.9] tracking-[-0.05em] tabular-nums">
                  {request?.amount}
                </p>

                {/* The whole destination, never cut: this screen's job is confirming where the
                    money goes, and a shortened address is exactly what gets skimmed. */}
                {request?.destination && (
                  <div className="mt-6">
                    <p className="text-[13px] text-[var(--lp-muted)]">Pay to</p>
                    <p className="mt-1 break-all border-b-2 border-dashed border-[var(--lp-line)] pb-2 text-[16px] font-semibold leading-snug">
                      {request.destination}
                    </p>
                  </div>
                )}

                {request?.details && request.details.length > 0 && (
                  <dl className="mt-5 space-y-2.5">
                    {request.details.map((detail) => (
                      <div key={detail.label} className="flex items-baseline gap-2 text-[14px]">
                        <dt className="shrink-0 text-[var(--lp-muted)]">{detail.label}</dt>
                        <span aria-hidden className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-[rgb(var(--lp-hair)/0.25)]" />
                        <dd className="max-w-[60%] break-all text-right font-semibold tabular-nums">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {request?.warning && (
                  <p className="mt-5 flex items-start gap-2 text-[13px] leading-[1.5] text-[var(--lp-warn)]">
                    <AlertTriangle className="mt-[2px] size-4 shrink-0 text-[var(--lp-warn)]" />
                    <span>{request.warning}</span>
                  </p>
                )}

                {/* Always shown: the summary says a second confirmation is coming and roughly how
                    long it takes, and the steps say what each one is. */}
                {request?.plan && request.plan.steps.length > 1 && (
                  <div className="mt-5 rounded-[16px] bg-[var(--lp-cream)] px-3.5 py-3">
                    <p className="text-[13px] font-semibold leading-snug">{planSummary(request.plan)}</p>
                    <ol className="mt-2.5 space-y-2.5">
                      {request.plan.steps.map((step, index) => (
                        <li key={`${step.kind}-${index}`} className="flex gap-2.5 text-[13px] leading-[1.5]">
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--lp-surface)] text-[11px] font-semibold">
                            {index + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="font-semibold">{step.title}</span>
                            {step.detail && <span className="block text-[var(--lp-muted)]">{step.detail}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
              {/* The torn edge: a row of half-circles cut out of the slip's foot. */}
              <div
                aria-hidden
                className="h-3 drop-shadow-[0_1px_0_rgb(17_26_19/0.06)]"
                style={{
                  background: "radial-gradient(circle at 8px 12px, transparent 6px, var(--lp-surface) 6.5px) 0 0 / 16px 12px repeat-x",
                }}
              />
            </div>
          </div>

          {/* ── The keypad: what we are asking for ───────────────────────────── */}
          <div className="lp-on-forest flex flex-col px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-[var(--lp-cream)] md:justify-center md:py-8">
            {needsSetup ? (
              /* No PIN exists, and we only found out at the moment of paying. Rather than
                 reject and drop them back to the form, the pending authorisation is held open
                 and setup happens right here — then they approve with the PIN they just chose. */
              <div className="space-y-4">
                <p className="text-center text-[14px] leading-[1.5] text-[#cfe0d6]">
                  You haven&apos;t set a transaction PIN yet. Choose one now and this payment carries on
                  straight after.
                </p>
                <PinSetup tone="forest" onDone={() => setNeedsSetup(false)} />
                <button
                  type="button"
                  onClick={() => settle(null)}
                  className="w-full text-center text-[14px] font-semibold text-[#a9c2b5] hover:text-[var(--lp-cream)]"
                >
                  Cancel this payment
                </button>
              </div>
            ) : (
              <div className="space-y-3 md:space-y-5">
                <p className="text-center text-[15px] font-semibold">Enter your PIN to approve</p>
                {/* Submits itself on the fourth digit. A 4-digit PIN has nothing to review and no
                    reason to need a second tap — every phone unlock works this way. */}
                <PinPad
                  value={pin}
                  onChange={(next) => {
                    setError(null);
                    setPin(next);
                  }}
                  onEnter={confirm}
                  onComplete={confirm}
                  error={error}
                  disabled={busy}
                  label="Transaction PIN"
                />
                <div className="mx-auto max-w-[300px] space-y-3">
                  <FlowButton tone="accent" onClick={confirm} loading={busy} disabled={pin.length < 4}>
                    {request?.confirmLabel ?? "Confirm"}
                  </FlowButton>
                  <div className="flex items-center justify-between text-[14px] font-semibold">
                    <button
                      type="button"
                      onClick={() => settle(null)}
                      disabled={busy}
                      className="text-[#a9c2b5] transition-colors hover:text-[var(--lp-cream)] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    {/* Offered here, where the problem is actually discovered. Someone staring at a
                        prompt they cannot answer will not go looking through Settings for it. */}
                    <button
                      type="button"
                      onClick={() => {
                        setForgotOpen(true);
                        settle(null);
                      }}
                      className="text-[#a9c2b5] transition-colors hover:text-[var(--lp-cream)]"
                    >
                      Forgot PIN?
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ForgotPinDialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        email={user?.email?.address ?? ""}
        onReset={() => setForgotOpen(false)}
      />
    </PinAuthorizationContext.Provider>
  );
}

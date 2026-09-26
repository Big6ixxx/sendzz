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
import { AlertTriangle, ChevronRight, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ForgotPinDialog } from "@/components/security/ForgotPinDialog";
import { PinInput } from "@/components/security/PinInput";
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
 * Whether this person has already been through a flow of this shape.
 *
 * The steps open themselves the first time and stay shut afterwards. Someone bridging for the
 * first time gets the explanation without asking; someone on their tenth bridge gets a compact
 * dialog. Per-purpose, because a first withdrawal is a first withdrawal even for a practised
 * bridger.
 *
 * localStorage can throw in a private window or with site data blocked, and it can come back
 * empty for a returning user. Both failure modes land on "show the explanation", which is the
 * side to be wrong on.
 */
const PLAN_SEEN_KEY = "sendzz.signing.plan-seen";

function hasSeenPlan(purpose: AuthorizationPurpose): boolean {
  try {
    const raw = window.localStorage.getItem(PLAN_SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]).includes(purpose) : false;
  } catch {
    return false;
  }
}

function rememberPlanSeen(purpose: AuthorizationPurpose): void {
  try {
    const raw = window.localStorage.getItem(PLAN_SEEN_KEY);
    const seen = raw ? (JSON.parse(raw) as string[]) : [];
    if (!seen.includes(purpose)) {
      window.localStorage.setItem(PLAN_SEEN_KEY, JSON.stringify([...seen, purpose]));
    }
  } catch {
    // A preference that cannot be saved is not worth failing a payment over.
  }
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
  const [planOpen, setPlanOpen] = useState(false);
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

        // Decided once, here, as the prompt opens — not in an effect reacting to it. Flipping
        // the disclosure under somebody who has started reading would be worse than either
        // default, and an effect would do exactly that on re-render.
        const multiStep = (next.plan?.steps.length ?? 0) > 1;
        setPlanOpen(multiStep && !hasSeenPlan(next.purpose));
        if (multiStep) rememberPlanSeen(next.purpose);

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
          className="card-glass border-white/10 max-w-md p-0 gap-0 overflow-hidden flex flex-col"
          showCloseButton={false}
        >
          {/* Three zones, fixed on purpose. The headline says what is being approved and the
              footer holds the PIN and the buttons; only the middle scrolls. However much
              explanation a flow carries, the thing being asked for is never pushed off-screen —
              which is precisely what used to happen on a bridge. */}

          {/* ── What you are approving ─────────────────────────────────────── */}
          <DialogHeader className="shrink-0 px-6 pt-5 pb-4 space-y-2.5 text-left border-b border-white/[0.06]">
            <DialogTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-secondary/35">
              {purposeHeading(request?.purpose)}
            </DialogTitle>
            <div className="space-y-1">
              <p className="text-[26px] leading-none font-black tracking-tight text-brand-secondary">
                {request?.amount}
              </p>
              <p className="text-[13px] text-brand-secondary/55 break-all leading-snug">
                {request?.destination}
              </p>
            </div>
          </DialogHeader>

          {needsSetup ? (
            /* No PIN exists, and we only found out at the moment of paying. Rather than
               reject and drop them back to the form, the pending authorisation is held open
               and setup happens right here — then they approve with the PIN they just chose.
               The alternative is a dead end: an error under four empty boxes, and no way from
               there to the screen that would fix it. */
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
              <p className="text-[13px] text-brand-secondary/60 leading-relaxed">
                You have not set a transaction PIN yet. Choose one now — it takes a moment, and
                this payment carries on straight after.
              </p>
              <PinSetup onDone={() => setNeedsSetup(false)} />
              <button
                type="button"
                onClick={() => settle(null)}
                className="w-full text-[12.5px] text-brand-secondary/45 hover:text-brand-secondary/80 transition-colors"
              >
                Cancel this payment
              </button>
            </div>
          ) : (
            <>
          {/* ── The detail, which is the only part allowed to scroll ────────── */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
            {request?.warning && (
              <p className="flex items-start gap-2 text-[12.5px] text-amber-200/70 leading-relaxed">
                <AlertTriangle className="w-3.5 h-3.5 mt-[3px] shrink-0 text-amber-300/60" />
                <span>{request.warning}</span>
              </p>
            )}

            {request?.details && request.details.length > 0 && (
              <dl className="rounded-xl border border-white/[0.07] bg-white/[0.02] divide-y divide-white/[0.05]">
                {request.details.map((detail) => (
                  <div
                    key={detail.label}
                    className="flex items-baseline justify-between gap-4 px-3.5 py-2.5"
                  >
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-secondary/35 shrink-0">
                      {detail.label}
                    </dt>
                    <dd className="text-[12.5px] font-semibold text-brand-secondary text-right break-all">
                      {detail.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {/* The step list is education: essential the first time somebody bridges, furniture
                by the third. The two facts that actually change what they do — that a second
                confirmation is coming, and roughly how long it takes — stay on the summary line
                whether it is open or shut. It opens itself until they have been through the
                flow once; see hasSeenPlan. */}
            {request?.plan && request.plan.steps.length > 1 && (
              <details
                open={planOpen}
                onToggle={(e) => setPlanOpen((e.currentTarget as HTMLDetailsElement).open)}
                className="group rounded-xl border border-white/[0.07] bg-white/[0.02]"
              >
                <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-brand-secondary/35 transition-transform group-open:rotate-90" />
                  <span className="text-[12px] text-brand-secondary/65 leading-snug">
                    {planSummary(request.plan)}
                  </span>
                </summary>

                <ol className="px-3.5 pb-3.5 pt-0.5 space-y-2 border-t border-white/[0.05] mt-0.5">
                  {request.plan.steps.map((step, index) => (
                    <li key={`${step.kind}-${index}`} className="flex gap-2.5 pt-2">
                      <span className="mt-[1px] w-4 h-4 shrink-0 rounded-full border border-white/12 flex items-center justify-center text-[9px] font-bold text-brand-secondary/35">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium text-brand-secondary/80">
                          {step.title}
                        </span>
                        {step.detail && (
                          <span className="block text-[11.5px] text-brand-secondary/40 leading-relaxed mt-0.5">
                            {step.detail}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>

          {/* ── What we are asking for ──────────────────────────────────────── */}
          <div className="shrink-0 px-6 pt-4 pb-5 space-y-2.5 border-t border-white/[0.06] bg-white/[0.015]">
            {/* The label and the way out share one row. They were two rows plus a sentence
                explaining that the PIN approves only this payment — true, and worth saying
                once during PIN setup, but restating it on every single payment cost a line
                on a dialog that was already overflowing. The shield keeps the connotation. */}
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
                <ShieldCheck className="w-3 h-3 shrink-0 text-accent/40" />
                Enter your transaction PIN
              </span>
              {/* Offered here, where the problem is actually discovered. Someone staring at a
                  prompt they cannot answer will not go looking through Settings for the way
                  out — they will give up, or write in. */}
              <button
                type="button"
                onClick={() => {
                  setForgotOpen(true);
                  settle(null);
                }}
                className="text-[11.5px] text-brand-secondary/40 hover:text-brand-secondary/80 transition-colors shrink-0"
              >
                Forgot your PIN?
              </button>
            </div>

            <PinInput
              value={pin}
              onChange={(next) => {
                setError(null);
                setPin(next);
              }}
              onEnter={confirm}
              error={error}
              label="Enter your transaction PIN"
              srOnlyLabel
              disabled={busy}
              autoFocus
            />

            <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-0.5">
              <button
                type="button"
                onClick={() => settle(null)}
                disabled={busy}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || pin.length < 4}
                className="btn-primary flex-1"
              >
                {busy ? "Confirming…" : (request?.confirmLabel ?? "Confirm")}
              </button>
            </div>
          </div>
            </>
          )}
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

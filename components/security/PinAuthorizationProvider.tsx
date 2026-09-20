"use client";

/**
 * Asking for the transaction PIN before money moves, and carrying the answer to the server.
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
import { ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ForgotPinDialog } from "@/components/security/ForgotPinDialog";
import { PinInput } from "@/components/security/PinGate";

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
  /** Plain-language heading, e.g. "Send $40.00 to ada@example.com". */
  title: string;
  /** One sentence on what happens when they confirm. */
  description?: string;
  /** The breakdown: amount, fee, destination, network. */
  details?: AuthorizationDetail[];
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

  // The promise the caller is awaiting. Held in a ref because resolving it must not depend on
  // a re-render having happened — the dialog closes and the payment continues in the same tick.
  const resolverRef = useRef<((token: string | null) => void) | null>(null);

  const settle = useCallback((token: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    setPin("");
    setError(null);
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
        <DialogContent className="card-glass border-white/10 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl text-brand-secondary">
              {request?.title ?? "Confirm with your PIN"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {request?.description && (
              <p className="text-sm text-brand-secondary/70 leading-relaxed">
                {request.description}
              </p>
            )}

            {/* The breakdown, before the PIN field rather than after it. A summary below the
                thing it describes is read after the decision has already been made. */}
            {request?.details && request.details.length > 0 && (
              <dl className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
                {request.details.map((detail) => (
                  <div
                    key={detail.label}
                    className="flex items-baseline justify-between gap-4 px-4 py-3"
                  >
                    <dt className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary/35">
                      {detail.label}
                    </dt>
                    <dd className="text-[13px] font-semibold text-brand-secondary text-right break-all">
                      {detail.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <PinInput
              value={pin}
              onChange={(next) => {
                setError(null);
                setPin(next);
              }}
              onEnter={confirm}
              error={error}
              label="Enter your transaction PIN"
              disabled={busy}
              autoFocus
            />

            <p className="flex items-start gap-2 text-[12px] text-brand-secondary/45 leading-relaxed">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent/60" />
              <span>
                Your PIN approves this one payment only. Nobody at Sendzz can see it or
                enter it for you.
              </span>
            </p>

            {/* Offered here, where the problem is actually discovered. Someone staring at a
                prompt they cannot answer will not go looking through Settings for the way
                out — they will give up, or write in. */}
            <button
              type="button"
              onClick={() => {
                setForgotOpen(true);
                settle(null);
              }}
              className="w-full text-[12.5px] text-brand-secondary/45 hover:text-brand-secondary/80 transition-colors"
            >
              Forgot your PIN?
            </button>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
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

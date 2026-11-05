"use client";

/**
 * The one-time explanation of why a transaction PIN exists, and the screen that sets it.
 *
 * Shown once, blocking, the first time someone reaches the dashboard without a PIN. It blocks
 * because the PIN is now required for every outgoing transaction: letting it be dismissed
 * would only move the interruption to the moment someone is mid-payment, which is the worst
 * possible time to be asked to invent and memorise four digits.
 *
 * --- On the wording ----------------------------------------------------------
 *
 * The copy below avoids "2FA", "second factor", "authentication" and every other word that
 * means something precise to us and nothing to the person reading it. What it says instead is
 * what is actually true and actually matters to them: this runs in a browser tab, a tab can be
 * reached by someone who is not you, and this is the thing that stops that person spending
 * your money. Someone who understands that will choose a PIN they can remember and will not
 * resent being asked for it later.
 *
 * It is also honest about the trade they are making. It says plainly that we cannot recover
 * the PIN, and it points at the way back in BEFORE they need it, because the moment they need
 * it is the moment they cannot get in to read about it.
 */

import { useEffect, useState } from "react";
import { FlowButton, FlowDialog } from "@/components/flow/ui";

import { PinSetup } from "@/components/PasskeySetupWizard";

/** Whether this account has a PIN. Null while we do not yet know. */
export function usePinStatus(enabled: boolean) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    // Retried, because giving up once is giving up for the whole session.
    //
    // A failed check leaves `hasPin` null, and null keeps the gate SHUT — the right call on
    // its own terms, since guessing "no PIN" would throw an undismissable setup screen at
    // somebody who already has one. But it also means a single bad response, at the one
    // moment this runs, silently costs that user the setup prompt entirely. They then meet
    // the PIN at the till instead, asked for something nobody told them to create.
    //
    // The window is real: this fires the instant Privy reports ready, which is also when the
    // session cookie is newest and the account row may still be being written.
    // A 401 here is the expected shape of the race this retry exists for: Privy reports ready a
    // moment before the token it issues will verify, so the first ask can arrive unauthenticated
    // on a perfectly good session. It is retried like any other failure, and `hasPin` stays null
    // until a real answer arrives — which keeps the setup prompt shut rather than throwing it at
    // somebody who has had a PIN for months.
    //
    // More attempts than before, because giving up is not neutral: it costs that user the setup
    // prompt for the whole session, and they meet the PIN at the till instead.
    let attempt = 0;
    const check = () => {
      fetch("/api/2fa/pin")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data) => {
          if (cancelled) return;
          setHasPin(!!data.enabled);
        })
        .catch(() => {
          if (cancelled || attempt >= 5) return;
          attempt += 1;
          // 1s, 2s, 4s, 8s, 16s — long enough to outlast a token refresh or a cold start.
          setTimeout(check, 1000 * 2 ** (attempt - 1));
        });
    };
    check();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { hasPin, setHasPin };
}

export function PinRequiredGate({
  open,
  onComplete,
}: {
  open: boolean;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<"why" | "choose">("why");

  return (
    // No close and no dismiss: there is nothing behind this the user can safely do yet.
    <FlowDialog
      open={open}
      onClose={() => {}}
      dismissable={false}
      eyebrow={step === "why" ? "One more lock" : "Step 2 of 2"}
      title={step === "why" ? "Set your" : "Choose"}
      italic={step === "why" ? "PIN." : "four digits."}
    >
        {step === "why" ? (
          <div className="space-y-5">
            <p className="text-[15px] leading-[1.6] text-[var(--lp-body)]">
              Sendzz runs in a browser tab, like your email. Anyone who reaches this tab while you are
              signed in could send your money. A 4-digit PIN closes that gap: nothing leaves your
              account until it is typed in.
            </p>

            <ul className="divide-y divide-[var(--lp-line)] border-y border-[var(--lp-line)]">
              {POINTS.map((p) => (
                <li key={p.title} className="py-3.5">
                  <p className="text-[15px] font-semibold">{p.title}</p>
                  <p className="mt-0.5 text-[14px] leading-[1.5] text-[var(--lp-body)]">{p.body}</p>
                </li>
              ))}
            </ul>

            <p className="text-[13px] leading-[1.5] text-[var(--lp-muted)]">
              Pick four digits you will remember but nobody could guess from knowing you. Not your
              birth year, and not the PIN on your bank card.
            </p>

            <FlowButton onClick={() => setStep("choose")}>Choose my PIN</FlowButton>
          </div>
        ) : (
          <PinSetup onDone={onComplete} />
        )}
    </FlowDialog>
  );
}

const POINTS = [
  {
    title: "Signing in and sending are different things",
    body: "Your email code gets you into Sendzz. Your PIN approves money leaving it. Getting past one is not getting past both.",
  },
  {
    title: "Only you ever know it",
    body: "We scramble your PIN before storing it, in a way that cannot be undone. Nobody at Sendzz can look it up, and nobody will ever ask you for it.",
  },
  {
    title: "You'll be asked when money goes out",
    body: "Sending, withdrawing and moving between networks ask for it. Receiving money and checking your balance never do.",
  },
  {
    title: "If you forget it, you're not locked out",
    body: "We email you a code that lets you set a new one, any time, from Security in Settings.",
  },
];

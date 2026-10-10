"use client";

import { MotionConfig } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { InstallAppPrompt } from "@/components/pwa/InstallAppPrompt";
import { type CorridorFee, useCorridorFee } from "@/lib/hooks/useCorridorFee";
import { redactEmail } from "@/lib/log";
import { captureReferralFromUrl } from "@/lib/referrals/client";
import { LandingFooter, LandingHeader } from "./Chrome";
import { DotField } from "./DotField";
import { LandingSupport } from "./LandingSupport";
import { Hero } from "./Hero";
import { Compare, Cta, Faq, HowItWorks, Safety } from "./Interactive";
import { CurrencyStrip, Features, Stories } from "./Sections";
import "./landing.css";

/** "0.5%", or "0.5% plus 0.30 USDC" when the corridor also carries a flat provider fee. */
function describeFee({ percent, flat }: CorridorFee) {
  const pct = `${Number(percent.toFixed(2))}%`;
  return flat > 0 ? `${pct} of the amount plus a flat ${flat.toFixed(2)} USDC` : `${pct} of the amount`;
}

// The fee quoted is the NGN corridor's, the main one; others are priced separately.
const faqs = (ngnFee: CorridorFee | null) => [
  {
    q: "Is Sendzz really non-custodial?",
    a: "Yes. When you sign in, a multi-chain smart account is created for you using MPC and WebAuthn passkeys. Sendzz never stores your private keys, cannot freeze your account and cannot move funds without your authorization.",
  },
  {
    q: "What are the verification limits?",
    a: "You can start without verification. Sending, receiving and depositing are unlimited. Cashing out to a bank is capped at $100 in total until you complete a quick identity check. It takes about two minutes and removes the limit.",
  },
  {
    q: "Are there any fees?",
    a: `Sending money between Sendzz accounts is free, and we cover the network gas on every chain we support. Withdrawing to a local bank account costs ${
      ngnFee ? describeFee(ngnFee) : "a small fee"
    }. The fee can vary in some countries, and you always see the exact amount before you confirm.`,
  },
  {
    q: "What if my recipient doesn’t have Sendzz?",
    a: "Send to any email address. The funds are held safely on chain and your recipient gets a claim link by email. One sign-in creates their account and the money is theirs.",
  },
  {
    q: "How do bank deposits and withdrawals work?",
    a: "Deposit local currency such as NGN from your bank to receive USDC, or withdraw USDC straight to a local bank or mobile money account. Payouts usually land within two minutes.",
  },
];

// Where to go once a sign-in started from this page completes. Session-scoped, and only ever
// a dashboard path, since nothing else writes it.
const AFTER_SIGN_IN = "sendzz:after-sign-in";

function takeAfterSignIn(): string | null {
  try {
    const next = sessionStorage.getItem(AFTER_SIGN_IN);
    sessionStorage.removeItem(AFTER_SIGN_IN);
    return next?.startsWith("/dashboard") ? next : null;
  } catch {
    return null;
  }
}

function setAfterSignIn(path: string | null) {
  try {
    if (path) sessionStorage.setItem(AFTER_SIGN_IN, path);
    else sessionStorage.removeItem(AFTER_SIGN_IN);
  } catch {
    /* storage blocked: sign-in still lands on the dashboard */
  }
}

export function LandingPage() {
  const ngnFee = useCorridorFee("NGN");
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  // Grab `?ref=` before anything else can navigate away from it — see lib/referrals/client.ts.
  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  // Signing in from this page lands on the dashboard, or on the transfer it was started for.
  const wasAuthenticated = useRef(authenticated);
  useEffect(() => {
    if (authenticated && !wasAuthenticated.current) router.push(takeAfterSignIn() ?? "/dashboard");
    wasAuthenticated.current = authenticated;
  }, [authenticated, router]);

  // `?email=` opens sign-in pre-filled — once, so closing the modal does not reopen it.
  const autoLoginTried = useRef(false);
  useEffect(() => {
    if (!ready || autoLoginTried.current) return;
    const email = new URLSearchParams(window.location.search).get("email");
    if (!email) return;
    autoLoginTried.current = true;
    setAfterSignIn(null);
    if (authenticated) {
      router.push("/dashboard");
    } else {
      console.log(`[Auto-Login] Pre-filling email in Privy: ${redactEmail(email)}`);
      login({ prefill: { type: "email", value: email } });
    }
  }, [ready, authenticated, login, router]);

  const handleAction = () => {
    if (authenticated) return router.push("/dashboard");
    setAfterSignIn(null);
    login();
  };

  // "Who will you send to first?": straight to a transfer to that email, signing up first if needed.
  const sendTo = (email: string | null) => {
    if (!email) return handleAction();
    const target = `/dashboard/transfer?to=${encodeURIComponent(email)}`;
    if (authenticated) return router.push(target);
    setAfterSignIn(target);
    login();
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="lp-root relative min-h-screen overflow-x-clip">
        <DotField />

        <div className="relative">
          <LandingHeader onGetStarted={handleAction} />
          <main>
            <Hero onAction={handleAction} />
            <CurrencyStrip />
            <Features />
            <Stories />
            <Compare />
            <HowItWorks />
            <Safety />
            <Cta signedIn={authenticated} onSend={sendTo} />
            <Faq items={faqs(ngnFee)} />
          </main>
          <LandingFooter />
        </div>

        <InstallAppPrompt />
        <LandingSupport />
      </div>
    </MotionConfig>
  );
}

"use client";

/**
 * Sign-in in the Sendzz brand. The sign-in provider's own pop-up is never shown: its headless
 * email hooks send the code and check it, and every screen around them is ours.
 *
 * A split card. On the right, two steps: the email, then the six-digit code on the green keypad
 * used for the PIN and the authenticator code. On the left, a payment slip addressed to whatever
 * is being typed, because that is the idea to get across: your email is your account, and
 * anyone can pay it. On a phone the slip shrinks to a band above the form.
 *
 * Anything that needs sign-in calls `useSignIn().signIn()`. Where the person goes afterwards
 * stays with the caller, which watches `authenticated` as before.
 */

import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { ArrowRight, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import Image from "next/image";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DetailRows, FlowButton, FlowDialogHeading, FlowInput } from "@/components/flow/ui";
import { EASE } from "@/components/landing/motion";
import { cn } from "@/lib/utils";
import { PinPanel, PinPanelAction } from "@/components/security/PinPad";

type SignInContext = { signIn: (opts?: { email?: string }) => void };

const Ctx = createContext<SignInContext | null>(null);

export function useSignIn(): SignInContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSignIn must be used inside <SignInProvider>");
  return ctx;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

export function SignInProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  // A fresh dialog each time it opens, so an old code or error never carries over.
  const [session, setSession] = useState(0);

  const signIn = useCallback((opts?: { email?: string }) => {
    setPrefill(opts?.email ?? "");
    setSession((n) => n + 1);
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ signIn }), [signIn]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <SignInDialog
        key={session}
        open={open}
        onClose={() => setOpen(false)}
        prefill={prefill}
      />
    </Ctx.Provider>
  );
}

function SignInDialog({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill: string }) {
  const { authenticated } = usePrivy();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(prefill);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const sending = state.status === "sending-code";
  const checking = state.status === "submitting-code";
  const address = email.trim().toLowerCase();

  // Signed in: the caller takes it from here.
  useEffect(() => {
    if (open && authenticated) onClose();
  }, [open, authenticated, onClose]);

  const send = async (again = false) => {
    if (!EMAIL.test(address)) {
      setError("Enter a full email address, like name@example.com.");
      return;
    }
    setError(null);
    try {
      await sendCode({ email: address });
      setCode("");
      setStep("code");
      setResent(again);
    } catch {
      setError("We couldn't send a code to that address. Check it and try again.");
    }
  };

  // The provider's state flips to "submitting" a render late, so a second press in between
  // (Continue right after the last digit auto-submitted) is stopped here instead.
  const submitting = useRef(false);
  const submit = async () => {
    if (code.length < CODE_LENGTH || checking || submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      await loginWithCode({ code });
    } catch {
      setCode("");
      setError("That code didn't work. Check the latest email and try again, or send a new code.");
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "gap-0 overflow-hidden p-0 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] sm:max-w-[880px]",
          // Phones: a sheet from the bottom, the keypad within reach of a thumb.
          "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none",
        )}
      >
        <MotionConfig reducedMotion="user">
          <SlipPanel address={address} typing={typing && step === "email"} sent={step === "code"} />

          {/* Over the forest band on a phone, over cream from md up: the colour follows. */}
          <DialogClose
            aria-label="Close"
            className="absolute right-4 top-4 z-10 grid size-9 place-items-center rounded-full text-[rgba(246,242,233,0.75)] transition-colors hover:bg-[rgba(246,242,233,0.12)] hover:text-[var(--lp-cream)] md:text-[var(--lp-muted)] md:hover:bg-[rgb(var(--lp-hair)/0.06)] md:hover:text-[var(--lp-ink)]"
          >
            <X className="size-4" />
          </DialogClose>

          {/* Padding matches the keypad's bleed (PinPanel), so it reaches the card's edges. */}
          <div className="flex min-h-0 flex-col p-6 sm:p-8 md:min-h-[540px] md:pt-10">
            <AnimatePresence mode="wait" initial={false}>
              {step === "email" ? (
                <motion.form
                  key="email"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex flex-1 flex-col"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <FlowDialogHeading eyebrow="Sign in or sign up" title="Start with" italic="your email." Title={DialogTitle} />
                  <DialogDescription className="mt-3 text-[16px] leading-[1.55] text-[var(--lp-body)]">
                    We&apos;ll email you a six digit code. There&apos;s no password to remember.
                  </DialogDescription>

                  <div className="mt-8 space-y-3">
                    <FlowInput
                      label="Email address"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      placeholder="name@example.com"
                      value={email}
                      onFocus={() => setTyping(true)}
                      onBlur={() => setTyping(false)}
                      onChange={(e) => {
                        setError(null);
                        setEmail(e.target.value);
                      }}
                      aria-invalid={!!error}
                    />
                    {error && (
                      <p role="alert" className="text-[14px] text-[var(--lp-danger)]">
                        {error}
                      </p>
                    )}
                  </div>

                  <DetailRows
                    className="mt-8 hidden text-[14px] md:block"
                    rows={[
                      { label: 'Already have an account', value: 'The code signs you in' },
                      { label: 'New to Sendzz', value: 'The code opens your account' },
                    ]}
                  />

                  <div className="mt-6 space-y-4 md:mt-auto md:pt-8">
                    <FlowButton type="submit" tone="accent" loading={sending} disabled={!address}>
                      Email me a code <ArrowRight className="size-4" />
                    </FlowButton>
                    <p className="text-center text-[13px] leading-[1.5] text-[var(--lp-muted)]">
                      By continuing you agree to our{" "}
                      <a href="/terms" className="font-semibold text-[var(--lp-ink)] underline underline-offset-2">
                        terms
                      </a>{" "}
                      and{" "}
                      <a href="/privacy" className="font-semibold text-[var(--lp-ink)] underline underline-offset-2">
                        privacy policy
                      </a>
                      .
                    </p>
                  </div>
                </motion.form>
              ) : (
                <motion.div
                  key="code"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex flex-1 flex-col"
                >
                  <FlowDialogHeading eyebrow="Sign in or sign up" title="Check your" italic="inbox." Title={DialogTitle} />
                  <DialogDescription className="mt-3 text-[16px] leading-[1.55] text-[var(--lp-body)]">
                    {resent ? "A new code is on its way to " : "We sent a code to "}
                    <span className="break-all font-semibold text-[var(--lp-ink)]">{address}</span>. It can take a minute, so check spam
                    too.
                  </DialogDescription>

                  {/* The keypad runs to the card's edges, so it sits last and pushed to the bottom. */}
                  <div className="mt-8 md:mt-auto">
                    <PinPanel
                      length={CODE_LENGTH}
                      label="Code from the email"
                      action={
                        <PinPanelAction onClick={() => void send(true)} disabled={sending || checking}>
                          {sending ? "Sending" : "Send a new code"}
                        </PinPanelAction>
                      }
                      value={code}
                      onChange={(digits) => {
                        setError(null);
                        setCode(digits);
                      }}
                      onComplete={() => void submit()}
                      onEnter={() => void submit()}
                      disabled={checking}
                      error={error}
                      footer={
                        <>
                          <FlowButton tone="accent" onClick={() => void submit()} loading={checking} disabled={code.length < CODE_LENGTH}>
                            Continue
                          </FlowButton>
                          <p className="text-center text-[14px]">
                            <PinPanelAction
                              onClick={() => {
                                setError(null);
                                setStep("email");
                              }}
                              disabled={checking}
                            >
                              Use a different email
                            </PinPanelAction>
                          </p>
                        </>
                      }
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </MotionConfig>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The forest side: a payment slip made out to the address being typed. Once the code is sent
 * it is stamped, so the left side keeps step with the right.
 */
function SlipPanel({ address, typing, sent }: { address: string; typing: boolean; sent: boolean }) {
  const to = address || "you@example.com";
  return (
    <div className="lp-fixed relative overflow-hidden bg-[var(--lp-forest)] px-6 pb-6 pt-14 text-[var(--lp-cream)] sm:px-8 md:flex md:flex-col md:justify-between md:p-10">
      <div className="hidden md:block">
        {/* The full wordmark, lettered in cream: this panel is forest in light and dark mode alike. */}
        <Image src="/landing/logo-dark.svg" alt="Sendzz" width={101.4} height={30} />
        <p className="lp-display mt-10 text-[40px] leading-[0.95] tracking-[-0.045em]">
          Your email is <span className="lp-serif tracking-[-0.02em]">your account.</span>
        </p>
        <p className="mt-4 max-w-[300px] text-[15px] leading-[1.55] text-[#cfe0d6]">
          Anyone can pay you with just this address, and only you can open it.
        </p>
      </div>

      {/* The slip. Cream paper, a torn edge, the details a real payment shows. */}
      <motion.div
        initial={{ y: 12, rotate: -1.5 }}
        animate={{ y: 0, rotate: -1.5 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative mx-auto w-full max-w-[340px] md:mx-0 md:mt-10"
      >
        <div className="rounded-t-[20px] bg-[var(--lp-cream)] px-5 pb-5 pt-4 text-[var(--lp-ink)] shadow-[0_24px_48px_-24px_rgb(0_0_0/0.6)]">
          <div className="flex items-center justify-between">
            <p className="lp-mono text-[11px] uppercase text-[var(--lp-muted)]">Sendzz payment</p>
            <p className="lp-mono text-[11px] uppercase text-[var(--lp-muted)]">Example</p>
          </div>
          <p className="mt-4 text-[12px] text-[var(--lp-muted)]">To</p>
          <p
            className={cn("mt-0.5 flex min-w-0 items-center text-[17px] font-semibold", !address && "text-[#9aa29b]")}
            aria-hidden
          >
            <span className="truncate">{to}</span>
            {typing && <span className="lp-caret ml-0.5 inline-block h-[1.1em] w-[2px] shrink-0 bg-[var(--lp-ink)]" />}
          </p>
          <dl className="mt-4 hidden grid-cols-3 gap-3 border-t border-dashed border-[var(--lp-line)] pt-4 text-[13px] sm:grid">
            <div>
              <dt className="text-[var(--lp-muted)]">Amount</dt>
              <dd className="lp-mono mt-0.5 text-[14px]">$50.00</dd>
            </div>
            <div>
              <dt className="text-[var(--lp-muted)]">Fee</dt>
              <dd className="lp-mono mt-0.5 text-[14px] text-[var(--lp-good)]">Free</dd>
            </div>
            <div>
              <dt className="text-[var(--lp-muted)]">Arrives</dt>
              <dd className="lp-mono mt-0.5 text-[14px]">Seconds</dd>
            </div>
          </dl>
        </div>
        {/* Perforation: a row of punched holes in the forest colour. */}
        <div
          aria-hidden
          className="h-3 rounded-b-[6px] bg-[var(--lp-cream)] [background:radial-gradient(circle_at_8px_12px,var(--lp-forest)_5px,var(--lp-cream)_5.5px)_0_0/16px_12px_repeat-x]"
        />

        <AnimatePresence>
          {sent && (
            <motion.span
              initial={{ opacity: 0, scale: 1.4, rotate: 8 }}
              animate={{ opacity: 1, scale: 1, rotate: 8 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="lp-mono absolute right-3 top-9 rounded-[8px] border-2 border-[var(--lp-good)] px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--lp-good)]"
            >
              Code sent
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

"use client";

import {
  animate,
  motion,
  useAnimate,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatedNumber, EASE, Label, MEDIA, Magnetic, Reveal, useMedia, useTilt } from "./motion";

const container = "mx-auto w-full max-w-[1360px] px-4 md:px-7";
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/* ── Send $100, they get $100 ───────────────────────────────────────────── */

const MIN = 50;
const MAX = 5000;

// Illustrative, as the footnote says: a typical flat fee plus exchange margin.
const ROUTES = [
  { name: "Sendzz", eta: "About 2 seconds · by email", flat: 0, margin: 0, ours: true },
  { name: "Bank wire", eta: "1–5 business days", flat: 35, margin: 0.03, ours: false },
  { name: "Cash agent", eta: "Same day · pick-up in person", flat: 10, margin: 0.05, ours: false },
];

/** Slides in from the left on first sight, then tracks the slider. */
function Bar({ share, ours, index, seen }: { share: number; ours: boolean; index: number; seen: boolean }) {
  const [settled, setSettled] = useState(false);
  return (
    <div className="mt-3 h-[14px] overflow-hidden rounded-full bg-[#efe9dd]">
      <motion.div
        className={`h-full rounded-full ${ours ? "bg-[#04c96a]" : "bg-[#b1afa4]"}`}
        initial={{ x: "-100%" }}
        animate={{ x: seen ? `${(share - 1) * 100}%` : "-100%" }}
        transition={settled ? { duration: 0.35, ease: EASE } : { duration: 1.1, ease: EASE, delay: index * 0.14 }}
        onAnimationComplete={() => seen && setSettled(true)}
      />
    </div>
  );
}

export function Compare() {
  const [amount, setAmount] = useState(100);
  const list = useRef<HTMLUListElement>(null);
  const seen = useInView(list, { once: true, margin: "0px 0px -15% 0px" });
  const fill = ((amount - MIN) / (MAX - MIN)) * 100;

  return (
    <section className={`${container} pb-[clamp(64px,9vw,120px)]`}>
      <Reveal className="grid grid-cols-1 items-start gap-x-[72px] gap-y-12 rounded-[28px] bg-white p-[clamp(24px,5vw,64px)] md:rounded-[36px] lg:grid-cols-2">
        <div>
          <h2 className="lp-h2 lp-display">
            <span className="block">Send $100.</span>
            <span className="lp-serif block pb-[0.08em]">They get $100.</span>
          </h2>
          <p className="mt-5 max-w-[440px] text-[17px] leading-normal text-[var(--lp-body)] md:text-[18px]">
            Drag the amount and watch what actually reaches the other side, and how long it takes
            to get there.
          </p>

          <div className="mt-7 rounded-[24px] bg-[var(--lp-cream)] p-6">
            <label htmlFor="lp-compare" className="flex items-baseline justify-between gap-4">
              <span className="text-[14px] text-[var(--lp-muted)]">You send</span>
              <span className="lp-display text-[44px] leading-none tracking-[-0.04em] tabular-nums">
                ${amount.toLocaleString("en-US")}
              </span>
            </label>
            <input
              id="lp-compare"
              type="range"
              min={MIN}
              max={MAX}
              step={50}
              value={amount}
              aria-valuetext={`$${amount.toLocaleString("en-US")}`}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="lp-range mt-[22px]"
              style={{ ["--fill" as string]: `${fill}%` }}
            />
            <div className="lp-mono mt-1.5 flex justify-between text-[12px] text-[var(--lp-muted)]">
              <span>$50</span>
              <span>$5,000</span>
            </div>
          </div>
        </div>

        <div>
          <div className="lp-mono flex justify-between gap-4 border-b border-[#e3dcce] pb-3 text-[12px] uppercase text-[var(--lp-muted)]">
            <span>How it arrives</span>
            <span>They receive</span>
          </div>
          <ul ref={list}>
            {ROUTES.map((r, i) => {
              const arrives = Math.max(0, amount - r.flat - amount * r.margin);
              return (
                <li key={r.name} className="border-b border-[#e3dcce] pb-[22px] pt-6 last:pb-10">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[18px] font-semibold leading-6">{r.name}</p>
                      <p className="text-[13px] leading-normal text-[var(--lp-muted)]">{r.eta}</p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className={`lp-display leading-none tracking-[-0.03em] ${r.ours ? "text-[30px]" : "text-[24px]"}`}>
                        <AnimatedNumber value={arrives} format={usd} duration={350} />
                      </p>
                      <p className={`mt-0.5 text-[13px] font-semibold leading-normal ${r.ours ? "text-[#0e7a45]" : "text-[#a1462c]"}`}>
                        {r.ours ? "Nothing lost" : <>−<AnimatedNumber value={amount - arrives} format={usd} duration={350} /></>}
                      </p>
                    </div>
                  </div>
                  <Bar share={arrives / amount} ours={r.ours} index={i} seen={seen} />
                </li>
              );
            })}
          </ul>
          <p className="pt-[18px] text-[13px] leading-normal text-[var(--lp-muted)]">
            Bank wire and cash agent figures are illustrative, based on a typical flat fee plus
            exchange margin. Your provider’s actual costs may differ.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ── How it works ───────────────────────────────────────────────────────── */

const EMAIL = "mum@gmail.com";
const SEND = 200;
const NGN_RATE = 1331.28;
const PIN_DISTANCE = 1500; // scroll distance the section stays pinned for

function Step({
  n,
  title,
  body,
  children,
  stepRef,
  pinned,
  delay = 0,
  opacity,
}: {
  n: number;
  title: React.ReactNode;
  body: string;
  children: React.ReactNode;
  stepRef: React.Ref<HTMLLIElement>;
  pinned: boolean;
  delay?: number;
  opacity?: MotionValue<number>;
}) {
  return (
    <motion.li
      ref={stepRef}
      // Pinned, the scroll drives these; otherwise each lifts in as it is reached.
      style={pinned && opacity ? { opacity } : undefined}
      initial={pinned ? false : { opacity: 0, y: 40 }}
      // The page first renders unpinned, so a step may still be waiting to lift in when the
      // layout switches to pinned; settle it in place (its opacity is the scroll's, if it has one).
      animate={pinned ? (opacity ? { y: 0 } : { y: 0, opacity: 1 }) : undefined}
      whileInView={pinned ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -15% 0px" }}
      transition={{ duration: 0.9, ease: EASE, delay }}
      className="flex flex-col gap-6 rounded-[30px] bg-[var(--lp-cream)] p-7"
    >
      <span className="lp-display text-[64px] leading-[0.8] tracking-[-0.05em]">{n}</span>
      {children}
      <div>
        <h3 className="lp-display mb-2 text-[26px] font-semibold leading-tight tracking-[-0.03em] md:text-[28px]">{title}</h3>
        <p className="text-[16px] leading-normal text-[var(--lp-body)]">{body}</p>
      </div>
    </motion.li>
  );
}

/**
 * Three steps that play out as you scroll. On a roomy screen the green card pins in the middle
 * of the viewport and the scroll drives it: a progress bar fills per step while the email types,
 * the amount counts up and the claim note arrives. Smaller screens play each step as it appears.
 */
export function HowItWorks() {
  const roomy = useMedia(MEDIA.roomy);
  const reduce = useMedia(MEDIA.reduce);
  const wide = useMedia("(min-width: 768px)");
  const pinned = roomy && !reduce;

  const wrap = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ height: 0, stickyTop: 0, start: 0 });
  const start = useRef(0);
  start.current = box.start;

  useLayoutEffect(() => {
    if (!pinned) return;
    const measure = () => {
      if (!wrap.current || !card.current) return;
      const height = card.current.offsetHeight;
      const stickyTop = Math.max(0, (window.innerHeight - height) / 2);
      const top = wrap.current.getBoundingClientRect().top + window.scrollY;
      setBox({ height, stickyTop, start: top - stickyTop });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card.current!);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [pinned]);

  // Scroll-driven timeline, in the same units as the steps: 0–1 step one, 1–2 two, 2–3 three.
  const { scrollY } = useScroll();
  const raw = useTransform(scrollY, (y) => clamp01((y - start.current) / PIN_DISTANCE) * 3.4);
  const t = useSpring(raw, { stiffness: 120, damping: 30, restDelta: 0.0005 });

  // Free-running values for the unpinned layout, played as each step comes into view.
  const typedFree = useMotionValue(EMAIL.length);
  const countFree = useMotionValue(1);
  const noteFree = useMotionValue(1);

  // Pinned, the scroll position decides; otherwise the free-running values do. Both sets are
  // derived and one is chosen at render, so switching layouts never leaves a stale subscription.
  const sent = (v: number) => SEND * (1 - Math.pow(1 - v, 2));
  const typedOf = (v: number) => EMAIL.slice(0, Math.floor(v));
  const usdOf = (v: number) => usd(sent(v));
  const ngnOf = (v: number) => `→ ₦${Math.round(sent(v) * NGN_RATE).toLocaleString("en-US")}`;

  const pinnedTyped = useTransform(t, (v) => typedOf(clamp01((v - 0.1) / 0.8) * EMAIL.length));
  const pinnedUsd = useTransform(t, (v) => usdOf(clamp01((v - 1.1) / 0.8)));
  const pinnedNgn = useTransform(t, (v) => ngnOf(clamp01((v - 1.1) / 0.8)));
  const pinnedNote = useTransform(t, (v) => clamp01((v - 2.15) / 0.4));
  const freeTyped = useTransform(typedFree, typedOf);
  const freeUsd = useTransform(countFree, usdOf);
  const freeNgn = useTransform(countFree, ngnOf);

  const typedText = pinned ? pinnedTyped : freeTyped;
  const usdText = pinned ? pinnedUsd : freeUsd;
  const ngnText = pinned ? pinnedNgn : freeNgn;
  const note = pinned ? pinnedNote : noteFree;
  const noteYPinned = useTransform(pinnedNote, [0, 1], [12, 0]);
  const noteYFree = useTransform(noteFree, [0, 1], [12, 0]);
  const noteScalePinned = useTransform(pinnedNote, [0, 1], [0.95, 1]);
  const noteScaleFree = useTransform(noteFree, [0, 1], [0.95, 1]);
  const noteY = pinned ? noteYPinned : noteYFree;
  const noteScale = pinned ? noteScalePinned : noteScaleFree;

  const bars = [
    useTransform(t, [0, 1], [0, 1], { clamp: true }),
    useTransform(t, [1, 2], [0, 1], { clamp: true }),
    useTransform(t, [2, 3], [0, 1], { clamp: true }),
  ];
  const step2 = useTransform(t, [1, 1.2], [0.45, 1], { clamp: true });
  const step3 = useTransform(t, [2, 2.2], [0.45, 1], { clamp: true });

  const stepRefs = [useRef<HTMLLIElement>(null), useRef<HTMLLIElement>(null), useRef<HTMLLIElement>(null)];
  const seen = [
    useInView(stepRefs[0], { once: true, margin: "0px 0px -30% 0px" }),
    useInView(stepRefs[1], { once: true, margin: "0px 0px -30% 0px" }),
    useInView(stepRefs[2], { once: true, margin: "0px 0px -30% 0px" }),
  ];

  useEffect(() => {
    if (pinned || reduce) return;
    typedFree.set(0);
    countFree.set(0);
    noteFree.set(0);
  }, [pinned, reduce, typedFree, countFree, noteFree]);

  useEffect(() => {
    if (pinned || reduce) return;
    // Side by side, the three play in sequence; stacked, each plays as it is reached.
    const delay = (i: number) => (wide ? i * 0.9 : 0);
    if (seen[0]) animate(typedFree, EMAIL.length, { duration: 1, ease: "linear", delay: delay(0) });
    if (seen[1]) animate(countFree, 1, { duration: 1, ease: "easeOut", delay: delay(1) });
    if (seen[2]) animate(noteFree, 1, { duration: 0.5, ease: EASE, delay: delay(2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen[0], seen[1], seen[2], pinned, reduce, wide]);

  return (
    <section id="how" className="scroll-mt-24 px-2 md:px-4">
      <div ref={wrap} style={pinned && box.height ? { height: box.height + PIN_DISTANCE } : undefined}>
        <div
          ref={card}
          style={pinned ? { position: "sticky", top: box.stickyTop } : undefined}
          className="rounded-[32px] bg-[var(--lp-green)] px-[clamp(20px,4vw,64px)] py-[clamp(40px,5.6vw,78px)] md:rounded-[44px]"
        >
          <div className="mx-auto max-w-[1280px]">
            <Reveal>
              <h2 className="lp-h2 lp-display mb-10 max-w-[900px]">
                <span className="block">If you can send an</span>
                <span className="block">
                  email, <span className="lp-serif">you can use sendzz.</span>
                </span>
              </h2>
            </Reveal>

            {pinned && (
              <div aria-hidden className="mb-5 grid grid-cols-3 gap-4">
                {bars.map((b, i) => (
                  <span key={i} className="h-1.5 overflow-hidden rounded-full bg-[rgba(17,26,19,0.15)]">
                    <motion.span className="block h-full origin-left rounded-full bg-[var(--lp-ink)]" style={{ scaleX: b }} />
                  </span>
                ))}
              </div>
            )}

            <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Step stepRef={stepRefs[0]} pinned={pinned} n={1} title="Type their email" body="No account numbers, no wallet addresses, no SWIFT codes. Just the email they already use.">
                <div className="flex min-h-[50.5px] gap-2.5 rounded-2xl bg-white px-4 py-3.5 text-[15px]">
                  <span className="text-[var(--lp-muted)]">To</span>
                  <motion.span className="lp-mono">{typedText}</motion.span>
                  <span className="lp-caret w-0.5 bg-[var(--lp-ink)]" />
                </div>
              </Step>
              <Step stepRef={stepRefs[1]} pinned={pinned} delay={0.08} opacity={step2} n={2} title="Pick an amount" body="See exactly what they'll get before you send. The fee line always reads zero.">
                <div className="flex min-h-[50.5px] flex-wrap justify-between gap-x-2.5 rounded-2xl bg-white px-4 py-3.5 text-[15px] tabular-nums">
                  <motion.span className="font-semibold">{usdText}</motion.span>
                  <motion.span className="lp-mono text-[var(--lp-muted)]">{ngnText}</motion.span>
                </div>
              </Step>
              <Step
                stepRef={stepRefs[2]}
                pinned={pinned}
                delay={0.16}
                opacity={step3}
                n={3}
                title={
                  <>
                    They get a note, not
                    <br />
                    homework
                  </>
                }
                body="New to Sendzz? They get a claim link. One sign-in and the money is theirs."
              >
                <div className="min-h-[50.5px]">
                  <motion.div style={{ opacity: note, y: noteY, scale: noteScale }} className="rounded-2xl bg-white px-4 py-3.5 text-[15px]">
                    <p className="font-semibold">You&apos;ve got $200 from Chidi</p>
                    <p className="text-[14px] text-[var(--lp-muted)]">Tap to claim. It&apos;s already yours.</p>
                  </motion.div>
                </div>
              </Step>
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Safety ─────────────────────────────────────────────────────────────── */

const pill =
  "cursor-pointer whitespace-nowrap rounded-full border border-[rgba(246,242,233,0.3)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--lp-cream)] transition-[scale,border-color] duration-150 hover:border-[rgba(246,242,233,0.6)] active:scale-[0.97]";

function SafetyCard({
  title,
  body,
  stage,
  children,
  delay,
  shakeRef,
}: {
  title: React.ReactNode;
  body: string;
  stage: React.ReactNode;
  children: React.ReactNode;
  delay: number;
  shakeRef?: React.Ref<HTMLDivElement>;
}) {
  const { ref: tiltRef, style: tiltStyle } = useTilt<HTMLElement>(4);
  return (
    <Reveal delay={delay} className="h-full">
      <div ref={shakeRef} className="h-full">
        <motion.article
          ref={tiltRef}
          style={tiltStyle}
          className="flex h-full min-h-[280px] flex-col gap-4 rounded-[30px] bg-[var(--lp-forest)] p-8 text-[var(--lp-cream)] md:min-h-[348px]"
        >
          <h3 className="lp-display text-[32px] leading-none tracking-[-0.04em] md:text-[36px]">{title}</h3>
          <p className="text-[16px] leading-[1.55] text-[#cfe0d6]">{body}</p>
          <div className="mt-auto flex flex-col items-start gap-3 pt-3">
            <div className="relative flex min-h-10 w-full items-center text-[14px] text-[var(--lp-green)]">{stage}</div>
            {children}
          </div>
        </motion.article>
      </div>
    </Reveal>
  );
}

function FreezeCard() {
  const [refused, setRefused] = useState(false);
  const [scope, run] = useAnimate<HTMLDivElement>();
  const reduce = useMedia(MEDIA.reduce);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  return (
    <SafetyCard
      delay={0}
      shakeRef={scope}
      title="We can't freeze it."
      body="Sendzz is self-custodial. Your account is yours alone, and no one can lock you out of your own money."
      stage={<span role="status">{refused && <Label text="Refused. Only you can do that." />}</span>}
    >
      <button
        type="button"
        className={pill}
        onClick={() => {
          setRefused(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setRefused(false), 2600);
          if (!reduce) run(scope.current, { x: [0, -10, 9, -7, 5, -3, 0] }, { duration: 0.5, ease: "easeOut" });
        }}
      >
        Freeze account
      </button>
    </SafetyCard>
  );
}

const HOLD_MS = 1200;
const CLIP = {
  idle: "[clip-path:inset(0_100%_0_0)] transition-[clip-path] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
  holding: "[clip-path:inset(0)] transition-[clip-path] duration-[1200ms] ease-linear",
  approved: "[clip-path:inset(0)]",
};

function HoldCard() {
  const [state, setState] = useState<keyof typeof CLIP>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const press = () => {
    if (state !== "idle") return;
    setState("holding");
    timer.current = setTimeout(() => {
      setState("approved");
      timer.current = setTimeout(() => setState("idle"), 2600);
    }, HOLD_MS);
  };
  const release = () => {
    if (state !== "holding") return;
    clearTimeout(timer.current);
    setState("idle");
  };
  const isKey = (e: React.KeyboardEvent) => e.key === " " || e.key === "Enter";
  const label = state === "approved" ? "Approved" : "Hold to approve";

  return (
    <SafetyCard
      delay={0.08}
      title="We can't move it."
      body="Every payment needs your say-so, signed with your face or fingerprint through a passkey."
      stage={<span role="status">{state === "approved" && <Label text="Approved by you, and only you." />}</span>}
    >
      <button
        type="button"
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onBlur={release}
        onKeyDown={(e) => {
          if (!isKey(e)) return;
          e.preventDefault();
          if (!e.repeat) press();
        }}
        onKeyUp={(e) => isKey(e) && release()}
        onContextMenu={(e) => e.preventDefault()}
        className={`${pill} relative touch-none select-none overflow-hidden [-webkit-touch-callout:none]`}
      >
        {label}
        <span aria-hidden className={`absolute inset-0 grid place-items-center bg-[var(--lp-green)] text-[var(--lp-ink)] ${CLIP[state]}`}>
          {label}
        </span>
      </button>
    </SafetyCard>
  );
}

function KeyIcon() {
  return <Image src="/landing/key.svg" alt="" width={14} height={14} className="flex-none" />;
}

function SplitCard() {
  const [split, setSplit] = useState(false);
  const reduce = useMedia(MEDIA.reduce);
  const d = reduce ? 0 : 0.5;

  return (
    <SafetyCard
      delay={0.16}
      title={
        <>
          We never see
          <br />
          your keys.
        </>
      }
      body="Your key is split into pieces with multi-party computation, so no one, Sendzz included, ever holds the whole thing."
      stage={
        <span aria-hidden className="relative block h-10 w-full">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              initial={false}
              animate={split ? { x: i * 62, y: Math.abs(i - 1) * 5, rotate: (i - 1) * 9 } : { x: i * 4, y: 0, rotate: 0 }}
              transition={{ duration: d, ease: EASE, delay: split ? i * 0.05 : 0 }}
              className="absolute left-0 top-0 flex h-10 w-[58px] items-center justify-center gap-1 rounded-full bg-[var(--lp-cream)] text-[13px] font-semibold text-[var(--lp-ink)] shadow-[0_8px_16px_-8px_rgb(0_0_0/0.5)]"
            >
              <KeyIcon />
              {i + 1}/3
            </motion.span>
          ))}
          <motion.span
            initial={false}
            animate={split ? { opacity: 0, scale: 0.95 } : { opacity: 1, scale: 1 }}
            transition={{ duration: split ? 0.15 : 0.3, delay: split ? 0 : d * 0.6, ease: EASE }}
            className="absolute left-0 top-0 flex h-10 origin-left items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--lp-green)] px-3.5 text-[13px] font-semibold text-[var(--lp-ink)]"
          >
            <KeyIcon />
            Your key
          </motion.span>
        </span>
      }
    >
      <button type="button" aria-pressed={split} onClick={() => setSplit((s) => !s)} className={pill}>
        <Label text={split ? "Put it back" : "Split the key"} />
      </button>
    </SafetyCard>
  );
}

export function Safety() {
  return (
    <section id="safety" className={`${container} scroll-mt-24 py-[clamp(72px,10vw,128px)]`}>
      <Reveal>
        <h2 className="lp-h2 lp-display mb-14">
          <span className="block">Your money</span>
          <span className="block">
            answers <span className="lp-serif">to you.</span>
          </span>
        </h2>
      </Reveal>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FreezeCard />
        <HoldCard />
        <SplitCard />
      </div>
    </section>
  );
}

/* ── Call to action ─────────────────────────────────────────────────────── */

const FACES = [
  { src: "/landing/face-1.png", bg: "#cdf5de", dim: true },
  { src: "/landing/face-2.png", bg: "#f3d3b8" },
  { src: "/landing/face-3.png", bg: "#e7dfcf" },
  { src: "/landing/face-4.png", bg: "#cdf5de" },
  { src: "/landing/face-5.png", bg: "#f3d3b8", dim: true },
];
const MID = (FACES.length - 1) / 2;

/** The first word of an email's local part, capitalised: "mum.k@x.com" → "Mum". */
function firstName(email: string) {
  const at = email.indexOf("@");
  if (at < 1) return null;
  const word = email.slice(0, at).split(/[^\p{L}]+/u).find(Boolean);
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Typing someone's email and pressing the button opens a transfer to them, email filled in.
 * Signed out, a sign-up has to come first — so the button and the line under it say so before
 * the sign-in window appears, rather than it arriving unexplained.
 */
export function Cta({ signedIn, onSend }: { signedIn: boolean; onSend: (email: string | null) => void }) {
  const [email, setEmail] = useState("");
  const reduce = useMedia(MEDIA.reduce);
  const valid = EMAIL_RE.test(email.trim());
  const name = valid ? firstName(email.trim()) : null;
  const label = name ? (signedIn ? `Send to ${name}` : `Sign up to send to ${name}`) : "Create your free account";

  return (
    <section className="mx-auto flex max-w-[1360px] flex-col items-center gap-9 px-4 text-center md:px-7">
      <div className="flex justify-center">
        {FACES.map((f, i) => (
          <motion.div
            key={f.src}
            initial={{ opacity: 0, x: reduce ? 0 : (MID - i) * 62, rotate: reduce ? 0 : (i - MID) * -7, scale: reduce ? 1 : 0.9 }}
            whileInView={{ opacity: f.dim ? 0.87 : 1, x: 0, rotate: 0, scale: 1 }}
            viewport={{ once: true, margin: "0px 0px -12% 0px" }}
            transition={{ duration: reduce ? 0.3 : 1, ease: EASE, delay: Math.abs(i - MID) * 0.05 }}
            className={`relative size-[clamp(72px,12vw,104px)] overflow-hidden rounded-full border-[5px] border-[var(--lp-cream)] ${i > 0 ? "-ml-[22px]" : ""}`}
            style={{ background: f.bg, zIndex: i }}
          >
            <Image src={f.src} alt="" fill sizes="104px" className="object-cover object-[50%_18%]" />
          </motion.div>
        ))}
      </div>

      <Reveal>
        <h2 className="lp-h-cta lp-display max-w-[1100px] text-balance">
          Who will you send to <span className="lp-serif">first?</span>
        </h2>
      </Reveal>
      <Reveal delay={0.07}>
        <p className="max-w-[520px] text-[clamp(17px,1.6vw,20px)] leading-[1.45] text-[var(--lp-body)]">
          Set up takes about a minute. Your first transfer takes about two seconds.
        </p>
      </Reveal>
      <Reveal delay={0.14} className="flex w-full max-w-[560px] flex-col items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSend(valid ? email.trim() : null);
          }}
          className="flex w-full flex-col gap-2 rounded-[32px] bg-white p-2 outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)] sm:flex-row sm:rounded-full"
        >
          <label htmlFor="lp-cta-email" className="sr-only">
            Their email
          </label>
          <input
            id="lp-cta-email"
            type="email"
            value={email}
            autoComplete="off"
            aria-describedby="lp-cta-hint"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="mum@gmail.com"
            className="min-w-0 flex-1 bg-transparent px-5 py-3.5 text-center text-[17px] outline-none placeholder:text-[rgba(91,100,93,0.7)] sm:text-left"
          />
          <Magnetic className="flex">
            <button
              type="submit"
              className="w-full whitespace-nowrap rounded-full bg-[var(--lp-ink)] px-7 py-[18px] text-[17px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
            >
              <Label text={label} />
            </button>
          </Magnetic>
        </form>
        <p id="lp-cta-hint" className="min-h-5 max-w-[460px] text-[14px] leading-5 text-[var(--lp-muted)]">
          {!name ? (
            "Type their email and see who’s first."
          ) : signedIn ? (
            `${name} gets a note with a claim link the moment you send.`
          ) : (
            <Label
              className="text-[var(--lp-ink)]"
              text={`You'll create your free Sendzz account first. It takes about a minute, then your transfer to ${name} opens with their email filled in.`}
            />
          )}
        </p>
      </Reveal>
    </section>
  );
}

/* ── FAQ ────────────────────────────────────────────────────────────────── */

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="mx-auto w-full max-w-[960px] scroll-mt-24 px-4 pb-14 pt-[clamp(48px,5vw,64px)] md:px-7">
      <Reveal>
        <h2 className="lp-h-faq lp-display mb-12 text-balance">
          Questions, <span className="lp-serif">answered.</span>
        </h2>
      </Reveal>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={item.q} y={24} delay={i * 0.05} className="rounded-[22px] bg-white">
              <h3>
                <button
                  type="button"
                  id={`lp-faq-q-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`lp-faq-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  className="flex w-full cursor-pointer items-center justify-between gap-5 rounded-[22px] px-6 py-6 text-left text-[17px] font-semibold md:px-7 md:text-[19px]"
                >
                  {item.q}
                  <span className="relative grid size-9 flex-none place-items-center rounded-full bg-[var(--lp-ink)] text-[var(--lp-green)]">
                    <span className="absolute h-0.5 w-3.5 rounded-full bg-current" />
                    <span className={`absolute h-3.5 w-0.5 rounded-full bg-current transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${isOpen ? "scale-y-0" : ""}`} />
                  </span>
                </button>
              </h3>
              <div
                id={`lp-faq-${i}`}
                role="region"
                aria-labelledby={`lp-faq-q-${i}`}
                inert={!isOpen}
                className={`grid transition-[grid-template-rows] duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
              >
                <div className="overflow-hidden">
                  <p className={`max-w-[720px] px-6 pb-[26px] leading-[1.6] text-[var(--lp-body)] transition-opacity ease-out md:px-7 ${isOpen ? "opacity-100 duration-300" : "opacity-0 duration-150"}`}>
                    {item.a}
                  </p>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

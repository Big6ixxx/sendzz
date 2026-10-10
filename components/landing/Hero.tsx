"use client";

import { AnimatePresence, animate, motion, useInView, useSpring } from "framer-motion";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getOffRampRate } from "@/lib/actions/ramp";
import { useCorridorFee } from "@/lib/hooks/useCorridorFee";
import { AnimatedNumber, EASE, EASE_IN_OUT, Label, MEDIA, Magnetic, useMedia } from "./motion";

/* ── Calculator ─────────────────────────────────────────────────────────── */

const PRESETS = [50, 200, 500, 1000];

// Shown only until (or if) the live rate cannot be fetched; the label says which it is.
const CURRENCIES = [
  { code: "NGN", symbol: "₦", fallback: 1331.28, to: "Mum · Access Bank" },
  { code: "KES", symbol: "KSh ", fallback: 129.1, to: "Wanjiru · M-Pesa" },
  { code: "GHS", symbol: "GH₵", fallback: 10.95, to: "Kwame · MTN MoMo" },
  { code: "USD", symbol: "$", fallback: 1, to: "chloe@example.com" },
] as const;

type Code = (typeof CURRENCIES)[number]["code"];

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COIN =
  "inline-grid flex-none place-items-center rounded-full bg-[radial-gradient(circle_at_34%_28%,#ffe98f,#f6c53d_55%,#e3a51b)] shadow-[inset_0_0_0_2px_#c98a12,inset_0_-3px_0_2px_rgb(122_78_6/0.22)] leading-none font-bold text-[#5c3b06]";

/** A dozen coins thrown up from the button, arcing out and falling away. */
function burstCoins(host: HTMLElement) {
  for (let i = 0; i < 12; i++) {
    const coin = document.createElement("span");
    coin.className = `${COIN} absolute top-1/2 -mt-[11px] -ml-[11px] size-[22px] text-xs`;
    coin.textContent = "$";
    coin.style.left = `${15 + Math.random() * 70}%`;
    host.append(coin);
    const angle = ((-155 + Math.random() * 130) * Math.PI) / 180;
    const reach = 70 + Math.random() * 100;
    const peak = Math.sin(angle) * reach;
    const fall = peak + 120 + Math.random() * 80;
    // Out along the arc, up then down under gravity, spinning, fading at the end.
    animate(
      coin,
      {
        x: [0, Math.cos(angle) * reach],
        y: [0, peak, fall],
        rotate: [0, -360 + Math.random() * 720],
        scale: [0.6, 1],
        opacity: [0, 1, 1, 0],
      },
      {
        duration: 0.95,
        x: { ease: "easeOut" },
        y: { times: [0, 0.44, 1], ease: ["easeOut", "easeIn"] },
        rotate: { ease: "linear" },
        scale: { duration: 0.12 },
        opacity: { times: [0, 0.13, 0.74, 1] },
      },
    ).then(() => coin.remove());
  }
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-[35.5px] rounded-full px-[13px] text-[13px] font-semibold leading-[19.5px] transition-[scale,background-color,color] duration-150 active:scale-[0.97] ${
        active ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]" : "bg-[var(--lp-cream)] hover:bg-[var(--lp-sand)]"
      }`}
    >
      {children}
    </button>
  );
}

function Calculator({ onSend }: { onSend: () => void }) {
  const [raw, setRaw] = useState("200");
  const [code, setCode] = useState<Code>("KES");
  const [live, setLive] = useState<Partial<Record<Code, number>>>({ USD: 1 });
  const [sent, setSent] = useState(false);
  const burstHost = useRef<HTMLSpanElement>(null);
  const reduce = useMedia(MEDIA.reduce);
  const corridorFee = useCorridorFee(code);

  useEffect(() => {
    if (live[code] != null) return;
    let cancelled = false;
    getOffRampRate(code)
      .then((r) => {
        if (!cancelled && Number.isFinite(r) && r > 0) setLive((m) => ({ ...m, [code]: r }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, live]);

  const currency = CURRENCIES.find((c) => c.code === code)!;
  const isLive = live[code] != null;
  const rate = live[code] ?? currency.fallback;
  const amount = Math.min(Number(raw) || 0, 9_999_999);
  // Sending by email is free. A bank payout carries its corridor's fee, charged on top of the
  // amount as a real withdrawal is: they receive the full amount, the fee comes from the sender.
  const byEmail = code === "USD";
  const fee = byEmail ? 0 : corridorFee ? (amount * corridorFee.percent) / 100 + corridorFee.flat : null;
  const received = amount * rate;

  const send = () => {
    if (sent || amount <= 0) return;
    setSent(true);
    if (!reduce && burstHost.current) burstCoins(burstHost.current);
    // Let the fill land before sign-in takes over the screen.
    setTimeout(onSend, reduce ? 0 : 700);
    setTimeout(() => setSent(false), 3200);
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-3 rounded-[36px] bg-white p-5 sm:p-7 lg:pb-[60px]">
      <h2 className="lp-display mb-1 text-[22px] font-semibold leading-[33px] tracking-[-0.02em]">
        How much are you sending?
      </h2>

      <div className="rounded-[20px] border-[1.5px] border-[var(--lp-line)] px-[18px] py-[14px] transition-colors duration-150 focus-within:border-[var(--lp-ink)]">
        <label htmlFor="lp-send" className="mb-1 block text-[13px] text-[var(--lp-muted)]">
          You send
        </label>
        <div className="flex items-center gap-2.5">
          <input
            id="lp-send"
            inputMode="decimal"
            autoComplete="off"
            value={raw}
            onChange={(e) => {
              const [whole, ...rest] = e.target.value.replace(/[^0-9.]/g, "").split(".");
              const w = whole.slice(0, 7);
              setRaw(rest.length ? `${w}.${rest.join("").slice(0, 2)}` : w);
            }}
            className="lp-display h-[60px] min-w-0 flex-1 bg-transparent text-[40px] tracking-[-0.04em] outline-none"
          />
          <span className="rounded-full bg-[var(--lp-cream)] px-[14px] py-2 text-[14px] font-semibold leading-5">USDC</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Chip key={p} active={amount === p} onClick={() => setRaw(String(p))}>
              ${p.toLocaleString("en-US")}
            </Chip>
          ))}
        </div>
      </div>

      <dl className="flex flex-col gap-2 px-1.5 py-1 text-[14px] leading-5 text-[var(--lp-muted)]">
        <div className="flex justify-between gap-4">
          <dt>Fees</dt>
          <dd className="font-semibold text-[var(--lp-ink)]">{fee == null ? "…" : `$${money(fee)}`}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>{isLive ? "Live mid-market rate" : "Indicative rate"}</dt>
          <dd className="lp-mono whitespace-nowrap text-[var(--lp-ink)]">
            1 USDC = {currency.symbol}
            {money(rate)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Arrives</dt>
          <dd className="font-semibold text-[var(--lp-ink)]">In about 2 seconds</dd>
        </div>
      </dl>

      <div className="rounded-[20px] border-[1.5px] border-[var(--lp-line)] px-[18px] py-[14px]">
        <p className="mb-1 text-[13px] text-[var(--lp-muted)]">
          {code === "USD" ? "They get (by email)" : "They get in their bank"}
        </p>
        <p className="lp-display mb-3 truncate text-[clamp(30px,8vw,40px)] leading-[60px] tracking-[-0.04em] tabular-nums">
          {currency.symbol}
          <AnimatedNumber value={received} format={money} />
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CURRENCIES.map((c) => (
            <Chip key={c.code} active={c.code === code} onClick={() => setCode(c.code)}>
              {c.code}
            </Chip>
          ))}
        </div>
      </div>

      <p className="px-1.5 py-0.5 text-[14px] leading-5 text-[var(--lp-muted)]">
        To <Label text={currency.to} className="font-semibold text-[var(--lp-ink)]" />
      </p>

      <div className="relative mt-auto max-lg:mt-3">
        <span ref={burstHost} aria-hidden className="pointer-events-none absolute inset-0" />
        <button
          type="button"
          onClick={send}
          className="relative h-[63.5px] w-full overflow-hidden rounded-full bg-[var(--lp-green)] text-[17px] font-semibold leading-[25.5px] transition-[scale] duration-150 active:scale-[0.97]"
        >
          <motion.span
            aria-hidden
            className="absolute inset-0 origin-left bg-[var(--lp-ink)]"
            initial={false}
            animate={{ scaleX: sent ? 1 : 0, opacity: sent ? 1 : 0 }}
            transition={
              sent
                ? { scaleX: { duration: reduce ? 0 : 0.65, ease: EASE_IN_OUT }, opacity: { duration: 0 } }
                : { opacity: { duration: 0.25 }, scaleX: { delay: 0.25, duration: 0 } }
            }
          />
          <span
            className={`relative block transition-colors ${sent ? "text-[var(--lp-cream)] delay-200 duration-200" : "duration-250"}`}
          >
            <Label text={sent ? "Sent." : "Send it now"} />
          </span>
        </button>
      </div>
    </div>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────────── */

const WORDS = ["Money", "that", "goes", "where"];
const NOUNS = ["people", "family", "clients", "friends"];
const NOTES = [
  { initial: "C", badge: "bg-[var(--lp-green)]", title: "Chidi sent you $200.00", detail: "Ready to withdraw to Access Bank" },
  { initial: "A", badge: "bg-[#f3d3b8]", title: "Invoice paid · $1,800.00", detail: "From client@austin.co" },
  { initial: "M", badge: "bg-[#cdf5de]", title: "Mum got GH₵3,120.00", detail: "Sent to MTN MoMo in 1.4s" },
];

/** Advances an index every `ms` while the section is on screen. */
function useCycle(length: number, ms: number, running: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setI((n) => (n + 1) % length), ms);
    return () => clearInterval(id);
  }, [length, ms, running]);
  return i;
}

/** Out with a lift and a blur, in from below — the swap used by the rotating hero word. */
const blurSwap = (reduce: boolean) => ({
  initial: { opacity: 0, y: reduce ? 0 : "30%", filter: reduce ? "blur(0px)" : "blur(8px)" },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.55, ease: EASE, delay: 0.1 },
  },
  exit: {
    opacity: 0,
    y: reduce ? 0 : "-30%",
    filter: reduce ? "blur(0px)" : "blur(8px)",
    transition: { duration: 0.22 },
  },
});

/** "your people" → "your family" → …, the slot easing to each word's width so "are." follows. */
function RotatingNoun({ index, reduce }: { index: number; reduce: boolean }) {
  const measure = useRef<HTMLSpanElement>(null);
  const [widths, setWidths] = useState<number[]>([]);

  useLayoutEffect(() => {
    const el = measure.current;
    if (!el) return;
    const read = () => setWidths(Array.from(el.children, (c) => (c as HTMLElement).offsetWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    document.fonts?.ready.then(read);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.span
      className="relative inline-block whitespace-nowrap align-baseline"
      initial={false}
      animate={{ width: widths[index] ?? "auto" }}
      transition={{ duration: reduce ? 0 : 0.55, ease: EASE_IN_OUT }}
    >
      {/* Invisible copies set the line height and give each word's width. */}
      <span ref={measure} aria-hidden className="invisible absolute left-0 top-0">
        {NOUNS.map((n) => (
          <span key={n} className="absolute left-0 top-0 whitespace-nowrap">
            {n}
          </span>
        ))}
      </span>
      <span className="invisible">{NOUNS[0]}</span>
      <AnimatePresence initial={false}>
        <motion.span
          key={NOUNS[index]}
          className="absolute left-0 top-0 whitespace-nowrap"
          {...blurSwap(reduce)}
        >
          {NOUNS[index]}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}

export function Hero({ onAction }: { onAction: () => void }) {
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const onScreen = useInView(section);
  const reduce = useMedia(MEDIA.reduce);
  const fine = useMedia(MEDIA.fine);
  const noun = useCycle(NOUNS.length, 2800, onScreen && !reduce);
  const note = useCycle(NOTES.length, 3600, onScreen && !reduce);
  const photoX = useSpring(0, { stiffness: 60, damping: 18 });
  const photoY = useSpring(0, { stiffness: 60, damping: 18 });

  const word = (i: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : "60%", filter: reduce ? "blur(0px)" : "blur(8px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.9, ease: EASE, delay: i * 0.06 },
  });
  const intro = (i: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 28 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.9, ease: EASE, delay: 0.35 + i * 0.08 },
  });

  return (
    <section ref={section} className="mx-auto w-full max-w-[1360px] px-4 pt-6 md:px-7 md:pt-10">
      <h1 className="lp-h1 lp-display max-w-[1240px]">
        {WORDS.map((w, i) => (
          <span key={w}>
            <motion.span className="inline-block" {...word(i)}>
              {w}
            </motion.span>{" "}
          </span>
        ))}
        <motion.span className="lp-serif inline-block" {...word(4)}>
          your <RotatingNoun index={noun} reduce={reduce} />
        </motion.span>{" "}
        <motion.span className="inline-block" {...word(5)}>
          are.
        </motion.span>
      </h1>

      <motion.p
        {...intro(0)}
        className="mt-4 max-w-[555px] text-[17px] leading-[26px] text-[var(--lp-body)] md:text-[20px] md:leading-[29px]"
      >
        Pay for goods across borders, bill your overseas clients, and send money to loved ones with
        just an email, everything settles in under two minutes and delivers before you blink.
      </motion.p>

      <motion.div {...intro(1)} className="mt-[27px]">
        <Magnetic>
          <button
            type="button"
            onClick={onAction}
            className="h-[63.5px] rounded-full bg-[var(--lp-ink)] px-[30px] text-[17px] font-semibold leading-[25.5px] text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
          >
            Send your first payment
          </button>
        </Magnetic>
      </motion.div>

      <div className="mt-10 grid grid-cols-1 gap-4 pb-[14px] lg:grid-cols-[minmax(0,805fr)_minmax(0,483fr)]">
        <motion.div
          {...intro(2)}
          ref={frame}
          onPointerMove={(e) => {
            if (!fine || reduce || !frame.current) return;
            const r = frame.current.getBoundingClientRect();
            photoX.set(((e.clientX - r.left) / r.width - 0.5) * -20);
            photoY.set(((e.clientY - r.top) / r.height - 0.5) * -20);
          }}
          onPointerLeave={() => {
            photoX.set(0);
            photoY.set(0);
          }}
          className="relative aspect-[4/5] overflow-hidden rounded-[28px] bg-[var(--lp-sand)] sm:aspect-[805/678.5] md:rounded-[36px] lg:aspect-auto lg:h-[678.5px]"
        >
          <motion.div className="absolute inset-[-4%]" style={{ x: photoX, y: photoY }}>
            <Image
              src="/landing/hero.png"
              alt="A smiling man in a grey beanie against an orange wall"
              fill
              priority
              sizes="(min-width: 1024px) 805px, 100vw"
              className="object-cover object-[50%_28%]"
            />
          </motion.div>

          <div aria-hidden className="pointer-events-none absolute inset-4 sm:inset-6">
            <AnimatePresence initial={false}>
              <motion.div
                key={note}
                initial={{ opacity: 0, y: reduce ? 0 : 14, scale: reduce ? 1 : 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE, delay: 0.15 } }}
                exit={{ opacity: 0, y: reduce ? 0 : -10, scale: reduce ? 1 : 0.97, transition: { duration: 0.2 } }}
                className="absolute left-0 top-0 flex max-w-full origin-top-left items-center gap-[14px] rounded-[22px] bg-white py-[14px] pl-[14px] pr-5 shadow-[0px_24px_48px_-20px_rgba(17,26,19,0.35)]"
              >
                <span className={`grid size-11 shrink-0 place-items-center rounded-full text-[18px] font-semibold ${NOTES[note].badge}`}>
                  {NOTES[note].initial}
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold leading-6">{NOTES[note].title}</span>
                  <span className="block text-[14px] leading-5 text-[var(--lp-muted)]">{NOTES[note].detail}</span>
                </span>
              </motion.div>
            </AnimatePresence>
            <div className="absolute bottom-0 right-0 flex h-[43.5px] items-center gap-2 rounded-full bg-[var(--lp-ink)] px-[18px]">
              <span className="lp-pulse size-2 rounded-full bg-[var(--lp-green)]" />
              <span className="lp-mono text-[13px] leading-[19.5px] text-[var(--lp-cream)]">Arrived in 1.4s · $0 fees</span>
            </div>
          </div>
        </motion.div>

        <motion.div {...intro(3)} className="flex min-w-0">
          <Calculator onSend={onAction} />
        </motion.div>
      </div>
    </section>
  );
}

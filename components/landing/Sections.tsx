"use client";

import {
  animate,
  motion,
  stagger,
  useAnimate,
  useAnimationFrame,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "framer-motion";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { EASE, MEDIA, Reveal, useMedia, useTilt } from "./motion";

const container = "mx-auto w-full max-w-[1360px] px-4 md:px-7";

/* ── Currency strip ─────────────────────────────────────────────────────── */

const CURRENCIES = [
  { code: "USDC", icon: "/landing/usdc.svg" },
  { code: "USD", icon: "/landing/usd.png" },
  { code: "NGN", icon: "/landing/ngn.png" },
  { code: "UGX", icon: "/landing/ugx.png" },
  { code: "TZS", icon: "/landing/tzs.png" },
  { code: "KES", icon: "/landing/kes.png" },
];
const COPIES = 4;
const LOOP_SECONDS = 30;

function CurrencyList({ hidden }: { hidden?: boolean }) {
  return (
    <ul className="flex flex-none" aria-hidden={hidden}>
      {CURRENCIES.map((c) => (
        <li key={c.code} className="flex items-center gap-3 px-[clamp(18px,2.4vw,34px)]">
          <Image src={c.icon} alt="" width={40} height={40} className="size-10" />
          <span className="lp-display text-[clamp(22px,2.2vw,30px)] font-semibold tracking-[-0.02em]">{c.code}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * An endless strip that speeds up and leans with the scroll — reversing when you scroll up —
 * and slows right down under the pointer.
 */
export function CurrencyStrip() {
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const onScreen = useInView(strip);
  const reduce = useMedia(MEDIA.reduce);
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const x = useMotionValue(0);
  const skewTarget = useMotionValue(0);
  const skewX = useSpring(skewTarget, { stiffness: 200, damping: 30 });
  const speed = useSpring(1, { stiffness: 120, damping: 20 });
  const direction = useRef(1);
  const hover = useRef(1);

  useEffect(
    () =>
      velocity.on("change", (v) => {
        if (Math.abs(v) < 40) {
          speed.set(direction.current * hover.current);
          skewTarget.set(0);
          return;
        }
        direction.current = v < 0 ? -1 : 1;
        speed.set(direction.current * hover.current * (1 + Math.min(Math.abs(v) / 400, 6)));
        skewTarget.set(Math.max(-10, Math.min(10, v / -220)));
      }),
    [velocity, speed, skewTarget],
  );

  useAnimationFrame((_, delta) => {
    if (reduce || !onScreen || !track.current) return;
    const loop = track.current.scrollWidth / COPIES;
    let next = x.get() - (loop / LOOP_SECONDS) * (delta / 1000) * speed.get();
    if (next <= -loop) next += loop;
    if (next > 0) next -= loop;
    x.set(next);
  });

  return (
    <section className="pb-4 pt-2" aria-label="Supported currencies">
      <Reveal className="px-4">
        <p className="mx-auto max-w-[640px] text-center text-[clamp(17px,1.5vw,20px)] leading-[1.45] text-[var(--lp-body)]">
          Built for the way money moves today: digital dollars on one side, local currency on the
          other.
        </p>
      </Reveal>
      <div
        ref={strip}
        className="lp-marquee mt-8 overflow-hidden py-3"
        onPointerEnter={() => {
          hover.current = 0.2;
          speed.set(direction.current * 0.2);
        }}
        onPointerLeave={() => {
          hover.current = 1;
          speed.set(direction.current);
        }}
      >
        <motion.div ref={track} className="flex w-max" style={{ x, skewX }}>
          {Array.from({ length: COPIES }, (_, i) => (
            <CurrencyList key={i} hidden={i > 0} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ── Shared section heading ─────────────────────────────────────────────── */

function SectionHeading({ bold, italic, aside }: { bold: string; italic: string; aside?: string }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <Reveal>
        <h2 className="lp-h2 lp-display">
          <span className="block">{bold}</span>
          <span className="lp-serif block pb-[0.08em]">{italic}</span>
        </h2>
      </Reveal>
      {aside && (
        <Reveal delay={0.07} className="lg:w-[380px] lg:pb-[2px]">
          <p className="text-[17px] leading-[26px] text-[var(--lp-body)] md:text-[18px] md:leading-[27px]">{aside}</p>
        </Reveal>
      )}
    </div>
  );
}

/* ── Features ───────────────────────────────────────────────────────────── */

const RAMPS = [
  { code: "NGN", label: "GTBank deposit", time: "~30s" },
  { code: "KES", label: "M-Pesa withdrawal", time: "~2 min" },
  { code: "GHS", label: "MTN MoMo withdrawal", time: "~2 min" },
];

const STRUCK = ["ETH", "MATIC", "Native tokens"];

type Play = (scope: ReturnType<typeof useAnimate>[1], el: HTMLElement, reduce: boolean) => void;

/** Each card's own little performance, replayed when the pointer comes back to it. */
const PLAYS: Play[] = [
  (run, el, reduce) => {
    const amount = el.querySelector<HTMLElement>("[data-amount]")!;
    run("[data-box]", { y: [reduce ? 0 : 28, 0], opacity: [0, 1] }, { duration: 0.7, ease: EASE });
    animate(reduce ? 250 : 0, 250, {
      duration: 0.9,
      delay: 0.25,
      ease: "easeOut",
      onUpdate: (v) => (amount.textContent = `$${v.toFixed(2)}`),
    });
    run("[data-check]", { scale: [reduce ? 1 : 0.6, 1], opacity: [0, 1] }, { duration: 0.4, delay: 1, ease: "backOut" });
  },
  (run, _el, reduce) => {
    run("[data-row]", { x: [reduce ? 0 : -28, 0], opacity: [0, 1] }, { duration: 0.6, ease: EASE, delay: stagger(0.08) });
    run("[data-coin]", { rotateY: [reduce ? 0 : -360, 0] }, { duration: 0.9, ease: EASE, delay: stagger(0.08, { startDelay: 0.1 }) });
  },
  (run, el, reduce) => {
    const fee = el.querySelector<HTMLElement>("[data-fee]")!;
    animate(reduce ? 0 : 9, 0, { duration: 1, ease: "easeOut", onUpdate: (v) => (fee.textContent = `$${Math.round(v)}`) });
    run("[data-strike]", { scaleX: [reduce ? 1 : 0, 1], opacity: [reduce ? 0 : 1, 1] }, { duration: 0.35, ease: EASE, delay: stagger(0.1, { startDelay: 0.5 }) });
    run("[data-only]", { scale: [reduce ? 1 : 0.95, 1], opacity: [0, 1] }, { duration: 0.3, ease: EASE, delay: 0.95 });
  },
];

function FeatureCard({
  index,
  className,
  children,
}: {
  index: number;
  className: string;
  children: React.ReactNode;
}) {
  const [scope, run] = useAnimate<HTMLDivElement>();
  const seen = useInView(scope, { once: true, margin: "0px 0px -25% 0px" });
  const reduce = useMedia(MEDIA.reduce);
  const fine = useMedia(MEDIA.fine);
  const { ref: tiltRef, style: tiltStyle } = useTilt<HTMLElement>(4);
  const play = () => PLAYS[index](run, scope.current, reduce);

  useEffect(() => {
    if (seen) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  return (
    <Reveal y={56} delay={index * 0.08} className="h-full">
      <div ref={scope} className="h-full">
        <motion.article
          ref={tiltRef}
          style={tiltStyle}
          onPointerEnter={() => fine && !reduce && play()}
          className={`flex h-full min-h-[480px] flex-col gap-7 rounded-[32px] p-7 md:min-h-[540px] xl:p-9 ${className}`}
        >
          {children}
        </motion.article>
      </div>
    </Reveal>
  );
}

function CardFooter({ title, body, tone = "" }: { title: React.ReactNode; body: string; tone?: string }) {
  return (
    <div className="mt-auto">
      <h3 className="lp-display mb-3 text-[30px] font-bold leading-none tracking-[-0.03em] md:text-[34px]">{title}</h3>
      <p className={`text-[16px] leading-normal md:text-[17px] ${tone}`}>{body}</p>
    </div>
  );
}

export function Features() {
  return (
    <section className={`${container} py-[clamp(64px,9vw,120px)]`}>
      <SectionHeading
        bold="One account."
        italic="Every border, gone."
        aside="Everything a bank transfer should have been, without the bank, the wait or the wire fee."
      />

      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-[22px]">
        <FeatureCard index={0} className="bg-[var(--lp-green)]">
          <span className="lp-mono text-[13px]">01 / SEND BY EMAIL</span>
          <div data-box className="flex flex-col gap-2.5 rounded-[22px] bg-[var(--lp-cream)] p-[18px] shadow-[0_20px_40px_-20px_rgb(0_60_30/0.5)]">
            <div className="flex items-center gap-3 rounded-[14px] bg-white p-2.5">
              <span className="grid size-[38px] flex-none place-items-center rounded-full bg-[var(--lp-ink)] font-semibold text-[var(--lp-green)]">C</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">chloe@example.com</div>
                <div className="text-[13px] text-[var(--lp-muted)]">Not on Sendzz yet · claim link sent</div>
              </div>
            </div>
            <div className="lp-display flex justify-between px-2.5 py-1 text-[30px] font-bold">
              <span data-amount className="tabular-nums">$250.00</span>
              <span data-check className="text-[#00a857]">✓</span>
            </div>
          </div>
          <CardFooter
            title={
              <>
                Forget wallet
                <br />
                addresses.
              </>
            }
            body="Type an email, pick an amount, send. Recipients get funds the moment they log in, even if they've never touched crypto."
          />
        </FeatureCard>

        <FeatureCard index={1} className="bg-[var(--lp-forest)] text-[#f5f4ee]">
          <span className="lp-mono text-[13px] text-[var(--lp-green)]">02 / LOCAL RAMPS</span>
          <ul className="flex flex-col gap-2 [perspective:600px]">
            {RAMPS.map((r) => (
              <li key={r.code} data-row className="flex min-h-[57px] items-center gap-3.5 rounded-2xl bg-[rgba(245,244,238,0.07)] px-4 py-2">
                <span data-coin className="lp-mono rounded-[8px] bg-[var(--lp-green)] px-[9px] py-[6px] text-[13px] font-medium leading-none text-[#0d120f]">
                  {r.code}
                </span>
                <span className="flex-1 text-[15px]">{r.label}</span>
                <span className="lp-mono whitespace-nowrap text-[13px] text-[#a9c2b5]">{r.time}</span>
              </li>
            ))}
          </ul>
          <CardFooter
            tone="text-[#cfe0d6]"
            title="Your bank, in and out."
            body="Deposit NGN, KES or GHS straight from your bank. Withdraw to a local account in minutes, at competitive Paycrest rates."
          />
        </FeatureCard>

        <FeatureCard index={2} className="border-[1.5px] border-[var(--lp-ink)] bg-white md:col-span-2 xl:col-span-1">
          <span className="lp-mono text-[13px]">03 / ZERO GAS</span>
          <div className="lp-display text-[clamp(120px,14vw,188px)] leading-[0.8] tracking-[-0.06em] tabular-nums">
            <span data-fee>$0</span>
            <span className="text-[var(--lp-green)]">.</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STRUCK.map((s) => (
              <s key={s} className="relative rounded-full border border-[rgba(17,26,19,0.2)] px-3 py-[7px] text-[13px] whitespace-nowrap text-[var(--lp-muted)] no-underline">
                {s}
                <span data-strike className="absolute inset-x-2 top-1/2 h-[1.5px] origin-left bg-[var(--lp-muted)]" />
              </s>
            ))}
            <span data-only className="rounded-full bg-[var(--lp-ink)] px-3 py-[7px] text-[13px] font-semibold whitespace-nowrap text-[var(--lp-cream)]">
              Just USDC
            </span>
          </div>
          <CardFooter
            tone="text-[var(--lp-body)]"
            title="Gas is on us. Always."
            body="Every transaction is sponsored. You never need to buy or hold another token just to move your money."
          />
        </FeatureCard>
      </div>
    </section>
  );
}

/* ── Stories ────────────────────────────────────────────────────────────── */

const STORIES = [
  { name: "Amara O.", role: "Brand designer, Lagos", quote: "My clients in the US pay me by email. It’s in my bank before I close the laptop.", image: "/landing/story-amara.png", bg: "#cdf5de", amount: "$1,800", route: "Austin → Lagos" },
  { name: "Kwame A.", role: "Nurse, London → Kumasi", quote: "Mum gets it on mobile money while we’re still on the phone.", image: "/landing/story-kwame.png", bg: "#f3d3b8", amount: "$240", route: "London → Kumasi" },
  { name: "Wanjiru K.", role: "Coffee exporter, Nairobi", quote: "We hold dollars now. Our margins stopped moving with the exchange rate.", image: "/landing/story-wanjiru.png", bg: "#e7dfcf", amount: "$12,400", route: "Hamburg → Nairobi" },
  { name: "Daniel M.", role: "Studio lead, Lisbon", quote: "Twelve contractors, six countries, one button on payday.", image: "/landing/story-daniel.png", bg: "#cdf5de", amount: "$9,600", route: "Lisbon → 6 countries" },
];

function Story({ story, index }: { story: (typeof STORIES)[number]; index: number }) {
  const { ref: tiltRef, style: tiltStyle } = useTilt<HTMLDivElement>(5);
  const reduce = useMedia(MEDIA.reduce);
  const { scrollYProgress } = useScroll({ target: tiltRef, offset: ["start end", "end start"] });
  const drift = index % 2 ? 4 : 6;
  const y = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : [`-${drift}%`, `${drift}%`]);

  return (
    <Reveal delay={index * 0.07}>
      <figure className="group flex flex-col gap-[18px]">
        <motion.div
          ref={tiltRef}
          style={{ ...tiltStyle, background: story.bg }}
          className="relative aspect-[314/392.5] overflow-hidden rounded-[28px]"
        >
          <motion.div className="absolute inset-x-0 -top-[8%] h-[116%]" style={{ y }}>
            <Image
              src={story.image}
              alt={`Portrait of ${story.name}`}
              fill
              sizes="(min-width: 1280px) 314px, (min-width: 640px) 50vw, 100vw"
              className="object-cover"
            />
          </motion.div>
          {/* Always shown on touch; slides up on hover where there is a pointer. */}
          <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-[18px] bg-white px-4 py-3 shadow-[0_18px_36px_-18px_rgb(17_26_19/0.45)] transition-[translate,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] [@media(hover:hover)_and_(pointer:fine)]:translate-y-[calc(100%+16px)] [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:translate-y-0! group-hover:opacity-100!">
            <span className="lp-display text-[20px] tracking-[-0.03em]">{story.amount}</span>
            <span className="lp-mono min-w-0 truncate text-[12px] text-[var(--lp-muted)]">{story.route}</span>
          </div>
        </motion.div>
        <blockquote className="pr-6 text-[18px] leading-snug">“{story.quote}”</blockquote>
        <figcaption className="text-[14px] text-[var(--lp-muted)]">
          <span className="font-semibold text-[var(--lp-ink)]">{story.name}</span> · {story.role}
        </figcaption>
      </figure>
    </Reveal>
  );
}

export function Stories() {
  return (
    <section id="stories" className={`${container} scroll-mt-24 pb-[clamp(64px,9vw,120px)]`}>
      <SectionHeading
        bold="Real people."
        italic="Real reasons."
        aside="Behind every transfer is a rent payment, a school fee, a first invoice, a Sunday call home."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 gap-y-10 sm:grid-cols-2 xl:grid-cols-4">
        {STORIES.map((s, i) => (
          <Story key={s.name} story={s} index={i} />
        ))}
      </div>
    </section>
  );
}

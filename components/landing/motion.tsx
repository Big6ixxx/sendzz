"use client";

import {
  motion,
  useMotionValue,
  useSpring,
  type HTMLMotionProps,
} from "framer-motion";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** The page's two curves: a strong ease-out for arrivals, an in-out for travel. */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const MEDIA = {
  reduce: "(prefers-reduced-motion: reduce)",
  fine: "(hover: hover) and (pointer: fine)",
  // Large enough to pin a section and scrub through it without it feeling cramped.
  roomy: "(min-width: 1024px) and (min-height: 760px)",
};

export function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Lifts content into place the first time it is 85% of the way up the screen. */
export function Reveal({
  delay = 0,
  y = 40,
  ...props
}: HTMLMotionProps<"div"> & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -15% 0px" }}
      transition={{ duration: 0.9, ease: EASE, delay }}
      {...props}
    />
  );
}

/** A number that rolls to its new value instead of jumping. */
export function AnimatedNumber({
  value,
  format,
  duration = 600,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const next = origin + (value - origin) * (1 - Math.pow(1 - t, 5));
      setShown(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <>{format(shown)}</>;
}

/** Tilts an element toward the pointer, in 3D, on devices with a real pointer. */
export function useTilt<T extends HTMLElement>(degrees = 5) {
  const ref = useRef<T | null>(null);
  const rx = useSpring(0, { stiffness: 160, damping: 22 });
  const ry = useSpring(0, { stiffness: 160, damping: 22 });
  const fine = useMedia(MEDIA.fine);
  const reduce = useMedia(MEDIA.reduce);

  useEffect(() => {
    const el = ref.current;
    if (!el || !fine || reduce) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ry.set(((e.clientX - r.left) / r.width - 0.5) * degrees * 2);
      rx.set(((e.clientY - r.top) / r.height - 0.5) * degrees * -2);
    };
    const leave = () => {
      rx.set(0);
      ry.set(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [fine, reduce, degrees, rx, ry]);

  return { ref, style: { rotateX: rx, rotateY: ry, transformPerspective: 900 } };
}

/** Pulls its child a little toward the pointer while hovered. */
export function Magnetic({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 150, damping: 15 });
  const y = useSpring(useMotionValue(0), { stiffness: 150, damping: 15 });
  const fine = useMedia(MEDIA.fine);
  const reduce = useMedia(MEDIA.reduce);
  const active = fine && !reduce;

  return (
    <motion.span
      ref={ref}
      className={`inline-flex ${className}`}
      style={{ x, y }}
      onPointerMove={(e) => {
        if (!active || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * 0.28);
        y.set((e.clientY - r.top - r.height / 2) * 0.28);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}

/** Swaps text with a short blur-and-rise, keyed on the text itself. */
export function Label({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span key={text} className={`lp-label-in inline-block ${className}`}>
      {text}
    </span>
  );
}

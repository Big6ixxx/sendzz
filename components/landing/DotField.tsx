"use client";

import { useEffect, useRef } from "react";
import { MEDIA, useMedia } from "./motion";

const INK = "#111a13";
const GREEN = "#00a857";
const GOLD = "#e3a51b";
const TAU = Math.PI * 2;

const GRID = 28; // dot spacing
const DOT = 1; // dot radius
const GRID_ALPHA = 0.16;
const GRID_PARALLAX = 0.08; // the grid drifts at this fraction of the scroll
const SPOTLIGHT = 190; // radius in which dots turn green under the cursor

const SPECK_COLORS = [
  { color: GREEN, strength: 1 },
  { color: GOLD, strength: 1.4 },
  { color: GREEN, strength: 1 },
  { color: INK, strength: 0.55 },
];
const MAX_SPECKS = 60;
const AREA_PER_SPECK = 21600;
const REPEL_RADIUS = 150;
const REPEL_FORCE = 700;
const SCROLL_DRAG = 0.3;

type Speck = { x: number; y: number; vx: number; vy: number; depth: number; phase: number; color: string; alpha: number };

const approach = (from: number, to: number, k: number) => (Math.abs(to - from) < 0.02 ? to : from + (to - from) * k);

/**
 * The page background: a dot grid that drifts with the scroll and lights up green around the
 * cursor, and a layer of specks that float upward and scatter away from the pointer.
 */
export function DotField() {
  const wrap = useRef<HTMLDivElement>(null);
  const gridCanvas = useRef<HTMLCanvasElement>(null);
  const speckCanvas = useRef<HTMLCanvasElement>(null);
  const reduce = useMedia(MEDIA.reduce);
  const fine = useMedia(MEDIA.fine);

  useEffect(() => {
    const el = wrap.current!;
    const grid = gridCanvas.current!.getContext("2d")!;
    const specksCtx = speckCanvas.current!.getContext("2d")!;
    let w = 0;
    let h = 0;
    let specks: Speck[] = [];
    let lastScroll = window.scrollY;
    let scrollVelocity = 0;
    let dirty = false;
    const pointer = { x: 0, y: 0, present: false };
    const light = { x: 0, y: 0, strength: 0 };

    const drawGrid = () => {
      const shift = reduce ? 0 : lastScroll * GRID_PARALLAX;
      const x0 = (w % GRID) / 2;
      const y0 = (((-shift % GRID) + GRID) % GRID) - GRID / 2;
      grid.clearRect(0, 0, w, h);
      grid.globalAlpha = GRID_ALPHA;
      grid.fillStyle = INK;
      grid.beginPath();
      for (let y = y0; y < h + GRID; y += GRID)
        for (let x = x0; x < w; x += GRID) {
          grid.moveTo(x + DOT, y);
          grid.arc(x, y, DOT, 0, TAU);
        }
      grid.fill();
      if (light.strength === 0) return;

      const sx = x0 + Math.max(0, Math.ceil((light.x - SPOTLIGHT - x0) / GRID)) * GRID;
      const sy = y0 + Math.max(0, Math.ceil((light.y - SPOTLIGHT - y0) / GRID)) * GRID;
      grid.fillStyle = GREEN;
      for (let y = sy; y < Math.min(h + GRID, light.y + SPOTLIGHT); y += GRID)
        for (let x = sx; x < Math.min(w, light.x + SPOTLIGHT); x += GRID) {
          const t = 1 - Math.hypot(x - light.x, y - light.y) / SPOTLIGHT;
          if (t <= 0) continue;
          grid.globalAlpha = t * t * (3 - 2 * t) * light.strength;
          grid.beginPath();
          grid.arc(x, y, DOT + t * 0.9, 0, TAU);
          grid.fill();
        }
    };

    const seed = () => {
      const count = Math.round(Math.min(MAX_SPECKS, (w * h) / AREA_PER_SPECK));
      specks = Array.from({ length: count }, (_, i) => {
        const { color, strength } = SPECK_COLORS[i % SPECK_COLORS.length];
        const depth = 0.4 + Math.random() * 0.6;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: 0,
          vy: 0,
          depth,
          phase: Math.random() * TAU,
          color,
          alpha: (0.16 + depth * 0.34) * strength,
        };
      });
    };

    const step = (dt: number, now: number) => {
      const damping = Math.exp(-dt * 2.5);
      for (const s of specks) {
        const dx = s.x - pointer.x;
        const dy = s.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (pointer.present && dist < REPEL_RADIUS && dist > 0) {
          const push = ((1 - dist / REPEL_RADIUS) * REPEL_FORCE * dt) / dist;
          s.vx += dx * push;
          s.vy += dy * push;
        }
        s.vx *= damping;
        s.vy *= damping;
        const sway = Math.sin(now / 1600 + s.phase) * 7;
        const rise = 5 + s.depth * 15;
        s.x += (s.vx + sway) * dt;
        s.y += (s.vy - rise - scrollVelocity * SCROLL_DRAG * s.depth) * dt;
        if (s.y < -8) {
          s.y = h + 8;
          s.x = Math.random() * w;
        } else if (s.y > h + 8) {
          s.y = -8;
          s.x = Math.random() * w;
        }
        if (s.x < -8) s.x = w + 8;
        else if (s.x > w + 8) s.x = -8;
      }
    };

    const drawSpecks = () => {
      specksCtx.clearRect(0, 0, w, h);
      for (const s of specks) {
        specksCtx.globalAlpha = s.alpha;
        specksCtx.fillStyle = s.color;
        specksCtx.beginPath();
        specksCtx.arc(s.x, s.y, 0.8 + s.depth * 2.4, 0, TAU);
        specksCtx.fill();
      }
    };

    const resize = new ResizeObserver(() => {
      w = el.clientWidth;
      h = el.clientHeight;
      const dpr = Math.min(window.devicePixelRatio, 2);
      for (const ctx of [grid, specksCtx]) {
        ctx.canvas.width = Math.round(w * dpr);
        ctx.canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      seed();
      drawGrid();
      drawSpecks();
    });
    resize.observe(el);
    if (reduce) return () => resize.disconnect();

    let prev = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      if (dt === 0) return;
      const y = window.scrollY;
      if (y !== lastScroll) dirty = true;
      scrollVelocity = approach(scrollVelocity, (y - lastScroll) / dt, 1 - Math.exp(-dt * 6));
      lastScroll = y;
      const target = pointer.present ? 1 : 0;
      if (light.x !== pointer.x || light.y !== pointer.y || light.strength !== target) {
        const k = 1 - Math.exp(-dt * 9);
        light.x = approach(light.x, pointer.x, k);
        light.y = approach(light.y, pointer.y, k);
        light.strength = approach(light.strength, target, k);
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        drawGrid();
      }
      if (specks.length) {
        step(dt, now);
        drawSpecks();
      }
    });

    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (!pointer.present) {
        light.x = pointer.x;
        light.y = pointer.y;
        pointer.present = true;
      }
    };
    const leave = () => {
      pointer.present = false;
    };
    if (fine) {
      window.addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("pointerleave", leave);
    }

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [reduce, fine]);

  return (
    <div ref={wrap} aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-lvh print:hidden">
      <canvas ref={gridCanvas} className="absolute inset-0 size-full" />
      <canvas ref={speckCanvas} className="absolute inset-0 size-full" />
    </div>
  );
}

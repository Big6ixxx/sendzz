"use client";

/**
 * SettlementCountdown
 *
 * The two minutes after a withdrawal is signed, while we wait for the bank to confirm.
 *
 * A bare spinner says "something is happening" and nothing else, so a wait of ninety seconds
 * feels indefinite and people refresh, or assume it broke. A countdown says how long this
 * normally takes, which turns the same wait into a known quantity.
 *
 * It is a guide, not a deadline, and the copy has to be honest about that: most payouts land
 * well inside it, some land after, and nothing goes wrong at zero. So the timer never becomes a
 * failure state. When it runs out it stops counting and says, plainly, that this one is taking
 * longer. The screen only leaves on the real signal, which is the payout confirming.
 *
 * Time is measured from a fixed start rather than by decrementing a number each tick: browsers
 * throttle timers in background tabs, and a counter that ticks down would drift behind and
 * still be showing 40 seconds left long after the two minutes had passed.
 */

import { useEffect, useState } from "react";

const WINDOW_MS = 2 * 60 * 1000;

/** `1:47`, and `0:09` rather than `0:9`. */
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function SettlementCountdown() {
  // Elapsed time is the state, and the start lives in the effect's closure.
  //
  // Reading the clock while rendering is impure, and on a server-rendered page it also starts
  // the server and the browser from two different moments, which hydrates as a mismatch. First
  // paint shows a full 2:00 and the effect takes over a tick later.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = WINDOW_MS - elapsed;
  const isOvertime = remaining <= 0;

  // The ring drains as the time does, so the shape carries the same information as the number.
  const R = 43;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const progress = Math.min(1, Math.max(0, elapsed / WINDOW_MS));

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative w-[104px] h-[104px]">
        <svg
          viewBox="0 0 104 104"
          className={isOvertime ? "w-full h-full animate-spin [animation-duration:3s]" : "w-full h-full -rotate-90"}
          aria-hidden
        >
          <circle
            cx="52"
            cy="52"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-white/[0.07]"
          />
          <circle
            cx="52"
            cy="52"
            r={R}
            fill="none"
            stroke="#00e87a"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            // Overtime: a short arc that simply turns, so the ring keeps saying "still working"
            // without pretending to measure anything it no longer knows.
            strokeDashoffset={
              isOvertime ? CIRCUMFERENCE * 0.75 : CIRCUMFERENCE * progress
            }
            style={{ transition: isOvertime ? undefined : "stroke-dashoffset 1s linear" }}
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          {isOvertime ? (
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-secondary/40">
              Almost
            </span>
          ) : (
            <span
              className="font-display text-[1.75rem] leading-none font-bold tracking-tight tabular-nums text-brand-secondary"
              aria-live="off"
            >
              {clock(remaining)}
            </span>
          )}
        </div>
      </div>

      {/*
        The copy lives here rather than in the parent so it can never disagree with the ring
        about which phase we are in.
      */}
      <p className="text-sm text-muted-foreground leading-relaxed max-w-[19rem]">
        {isOvertime
          ? "This one is taking longer than usual. It has not failed and your money is not stuck. You can close this and carry on, we will email you as soon as it lands."
          : "Most withdrawals reach the bank within two minutes. Some land sooner, a few take a little longer. You can wait here, or close this and we will email you when it arrives."}
      </p>

      {/*
        Announced once per phase, not every second: a live region on the ticking number would
        read the clock aloud on every tick to anyone using a screen reader.
      */}
      <p className="sr-only" aria-live="polite">
        {isOvertime
          ? "Still processing. This is taking longer than usual."
          : "Processing your withdrawal. This usually takes about two minutes."}
      </p>
    </div>
  );
}

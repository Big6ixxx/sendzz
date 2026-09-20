"use client";

/**
 * Where you are in a transaction that takes more than one step.
 *
 * Shown for the duration of a multi-step flow, pinned so it survives scrolling. Its job is to
 * answer the question a Web2 user asks during the gap between two confirmations — "did that
 * work, and is something still happening?" — which an ordinary spinner does not.
 *
 * It renders nothing for single-step flows. A progress tracker for one step is noise, and
 * noise is what teaches people to stop reading these.
 */

import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { signatureCount, type SigningPlan } from "@/lib/signing/plan";

export function SigningProgress({
  plan,
  /** Index of the step currently running. */
  current,
  /** Live status line from the flow itself, shown against the active step. */
  status,
}: {
  plan: SigningPlan | null;
  current: number;
  status?: string;
}) {
  if (!plan || plan.steps.length < 2) return null;

  const signatures = signatureCount(plan);

  // Confirmations are numbered separately from steps. "Confirmation 2 of 2" is what the user
  // is counting; a waiting step sitting between them is not one of the things they do.
  //
  // Computed up front rather than tallied inside the map: a counter mutated during render
  // gives a different answer on a re-render that starts midway, which is precisely when this
  // component re-renders.
  const signatureOrdinals = plan.steps.reduce<(number | null)[]>((acc, step) => {
    const previous = acc.filter((n) => n !== null).length;
    acc.push(step.signature ? previous + 1 : null);
    return acc;
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-secondary/35">
          In progress
        </p>
        <p className="text-[11px] text-brand-secondary/35">
          Step {Math.min(current + 1, plan.steps.length)} of {plan.steps.length}
        </p>
      </div>

      <ol className="space-y-3">
        {plan.steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const thisSignature = signatureOrdinals[index];

          return (
            <li key={`${step.kind}-${index}`} className="flex gap-3">
              <span
                className={cn(
                  "mt-0.5 w-5 h-5 shrink-0 rounded-full border flex items-center justify-center",
                  done
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : active
                      ? "border-accent/60 text-accent"
                      : "border-white/12 text-brand-secondary/25",
                )}
              >
                {done ? (
                  <Check className="w-3 h-3" />
                ) : active ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <span className="text-[10px] font-bold">{index + 1}</span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[13.5px] font-semibold",
                    done
                      ? "text-brand-secondary/45 line-through decoration-white/20"
                      : active
                        ? "text-brand-secondary"
                        : "text-brand-secondary/45",
                  )}
                >
                  {step.title}
                  {thisSignature && signatures > 1 && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-secondary/30">
                      Confirmation {thisSignature} of {signatures}
                    </span>
                  )}
                </span>

                {/* The detail is only worth the space while the step is the one happening.
                    Every step's explanation shown at once is a wall nobody reads. */}
                {active && (step.detail || status) && (
                  <span className="block text-[12px] text-brand-secondary/50 leading-relaxed mt-1">
                    {status || step.detail}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

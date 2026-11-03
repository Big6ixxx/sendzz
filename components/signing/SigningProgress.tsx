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
import { FlowLabel } from "@/components/flow/ui";

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
    <div className="lp-card space-y-4 rounded-[22px] p-5">
      <div className="flex items-baseline justify-between gap-4">
        <FlowLabel>
          In progress
        </FlowLabel>
        <p className="lp-mono text-[12px] tabular-nums text-[var(--lp-muted)]">
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
                    ? "border-transparent bg-[var(--lp-green)] text-[var(--lp-ink)]"
                    : active
                      ? "border-[var(--lp-ink)] text-[var(--lp-ink)]"
                      : "border-[#d9d3c5] text-[var(--lp-muted)]",
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
                    "block text-[15px] font-semibold",
                    done
                      ? "text-[var(--lp-muted)] line-through decoration-[#d9d3c5]"
                      : active
                        ? "text-[var(--lp-ink)]"
                        : "text-[var(--lp-muted)]",
                  )}
                >
                  {step.title}
                  {thisSignature && signatures > 1 && (
                    <span className="lp-mono ml-2 text-[11px] font-normal uppercase text-[var(--lp-muted)]">
                      Confirmation {thisSignature} of {signatures}
                    </span>
                  )}
                </span>

                {/* The detail is only worth the space while the step is the one happening.
                    Every step's explanation shown at once is a wall nobody reads. */}
                {active && (step.detail || status) && (
                  <span className="mt-1 block text-[14px] leading-[1.5] text-[var(--lp-body)]">
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

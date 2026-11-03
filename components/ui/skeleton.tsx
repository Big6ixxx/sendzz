import { cn } from "@/lib/utils";

/**
 * The brand's placeholder for content on its way: a soft block in the shape of what will
 * replace it. Spinners are kept for things the person is waiting on (a button they pressed, a
 * step in progress); anything that is only loading to be read gets one of these instead.
 *
 * `tone` follows the surface it sits on: `card` on white, `page` on the cream page, `forest`
 * on the dark green panels.
 */
const TONE = {
  card: "bg-[#efe9dd]",
  page: "bg-[var(--lp-sand)]",
  forest: "bg-[rgba(246,242,233,0.12)]",
} as const;

export type SkeletonTone = keyof typeof TONE;

function Skeleton({
  className,
  tone = "card",
  ...props
}: React.ComponentProps<"span"> & { tone?: SkeletonTone }) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden
      className={cn("block rounded-full motion-safe:animate-pulse", TONE[tone], className)}
      {...props}
    />
  );
}

/** A list row: a round badge, a title line and a smaller line under it, an amount at the end. */
function SkeletonRow({ tone = "card", trailing = true, className }: { tone?: SkeletonTone; trailing?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Skeleton tone={tone} className="size-10 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton tone={tone} className="h-3.5 w-2/5" />
        <Skeleton tone={tone} className="h-3 w-1/4" />
      </div>
      {trailing && <Skeleton tone={tone} className="h-4 w-16 shrink-0" />}
    </div>
  );
}

/** Wraps a group of skeletons so a screen reader hears one "Loading" instead of nothing. */
function SkeletonGroup({ label = "Loading", className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-label={label} aria-busy className={className}>
      {children}
    </div>
  );
}

export { Skeleton, SkeletonGroup, SkeletonRow };

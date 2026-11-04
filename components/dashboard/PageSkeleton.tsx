import { Skeleton, SkeletonGroup, SkeletonRow } from "@/components/ui/skeleton";

/**
 * A dashboard page before its data is in: the same outline as the page it stands for, so
 * nothing jumps when the real content takes its place.
 *
 * - overview: the balance panel and recent activity
 * - form: a form beside the forest summary (Transfer, Bridge)
 * - list: a search field and day-grouped rows (History)
 * - detail: one record, its amount and its rows (an activity)
 */
export function PageSkeleton({ variant, label = "Loading" }: { variant: "overview" | "form" | "list" | "detail"; label?: string }) {
  return (
    <SkeletonGroup label={label} className="space-y-6 pb-24 md:space-y-8">
      {variant !== "detail" && <HeaderSkeleton />}
      {variant === "overview" && <OverviewBody />}
      {variant === "form" && <FormBody />}
      {variant === "list" && <ListBody />}
      {variant === "detail" && <DetailBody />}
    </SkeletonGroup>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-3 pt-2">
      <Skeleton tone="page" className="h-3 w-24" />
      <Skeleton tone="page" className="h-12 w-[min(420px,80%)] rounded-[16px]" />
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="lp-card space-y-5 rounded-[28px] p-5 sm:p-6">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

function OverviewBody() {
  return (
    <>
      <div className="lp-fixed space-y-5 rounded-[32px] bg-[var(--lp-forest)] p-6 sm:p-8">
        <Skeleton tone="forest" className="h-3 w-28" />
        <Skeleton tone="forest" className="h-14 w-56 rounded-[18px]" />
        <div className="flex gap-3 pt-2">
          <Skeleton tone="forest" className="h-12 w-32" />
          <Skeleton tone="forest" className="h-12 w-32" />
        </div>
      </div>
      <Rows count={4} />
    </>
  );
}

function FormBody() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:gap-6">
      <div className="lp-card space-y-5 rounded-[32px] p-6 sm:p-7">
        <Skeleton className="h-11 w-full max-w-[320px]" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-16 w-full rounded-[20px]" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-14 w-full rounded-[20px]" />
      </div>
      <div className="lp-fixed space-y-4 rounded-[32px] bg-[var(--lp-forest)] p-6 sm:p-7">
        <Skeleton tone="forest" className="h-3 w-24" />
        <Skeleton tone="forest" className="h-12 w-40 rounded-[16px]" />
        <Skeleton tone="forest" className="h-3 w-full" />
        <Skeleton tone="forest" className="h-3 w-4/5" />
        <Skeleton tone="forest" className="mt-4 h-14 w-full" />
      </div>
    </div>
  );
}

function ListBody() {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Skeleton tone="page" className="h-12 w-full sm:w-72" />
        <Skeleton tone="page" className="h-10 w-20" />
        <Skeleton tone="page" className="h-10 w-24" />
        <Skeleton tone="page" className="h-10 w-20" />
      </div>
      <Skeleton tone="page" className="h-3 w-20" />
      <Rows count={5} />
    </>
  );
}

function DetailBody() {
  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <Skeleton tone="page" className="h-4 w-20" />
      <div className="space-y-4">
        <Skeleton tone="page" className="h-3 w-28" />
        <Skeleton tone="page" className="h-16 w-64 rounded-[18px]" />
        <Skeleton tone="page" className="h-4 w-48" />
      </div>
      <div className="lp-card space-y-4 rounded-[28px] p-6">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { ActivityDetailModal } from '@/components/ActivityDetailModal';
import type { Activity } from '@/components/HistoryModule';
import { HistoryList } from '@/components/dashboard/HistoryList';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';

export default function HistoryPage() {
  const { ready, authenticated, user } = usePrivy();
  const [selected, setSelected] = useState<Activity | null>(null);

  if (!ready || !authenticated || !user) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="mx-auto max-w-[880px] space-y-6 pb-24 md:space-y-8">
      <PageHeader
        eyebrow="History"
        title="Every dollar,"
        italic="accounted for."
        actions={
          <Link
            href="/dashboard/transfer"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-6 text-[15px] font-semibold text-[var(--lp-cream)] transition-transform duration-150 hover:-translate-y-px"
          >
            Send money <ArrowUpRight className="size-4" />
          </Link>
        }
      />

      <HistoryList userId={user.id} userEmail={user.email?.address || ''} onOpen={setSelected} />

      <ActivityDetailModal activity={selected} isOpen={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}

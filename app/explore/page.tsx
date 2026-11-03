import { DocHeader } from '@/components/dashboard/DocLayout';
import { PublicPage } from '@/components/landing/PublicPage';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExploreClient } from './ExploreClient';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Explore · Live Transparency Dashboard',
  description:
    'Browse every transaction on Sendzz in real time: volume, system status, bridges, transfers, deposits and withdrawals. Fully public and privacy-preserving.',
  openGraph: {
    title: 'Sendzz Explorer · Live Transparency Dashboard',
    description:
      'Real-time, anonymized view of all activity on Sendzz: volume and every transaction on-chain.',
  },
};

// Time-sensitive public data — always render fresh.
export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  return (
    <PublicPage>
      <DocHeader
        eyebrow="Explorer"
        title="Every dollar,"
        italic="in the open."
        lead="Every transfer, move, deposit and withdrawal on Sendzz, live. Amounts and on-chain records are public; who sent them never is."
      />
      <div className="mt-10 md:mt-14">
        <Suspense fallback={<Skeleton tone="page" className="h-96 rounded-[32px]" />}>
          <ExploreClient />
        </Suspense>
      </div>
    </PublicPage>
  );
}

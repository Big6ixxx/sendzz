'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { HistoryModule } from '@/components/HistoryModule';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { Loader2, Send } from 'lucide-react';

export default function HistoryPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();

  if (!ready || !authenticated || !user) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <DashboardPageHeader
          title="History"
          subtitle="Review your global settlement activity."
        />
        <button
          onClick={() => router.push('/dashboard/transfer')}
          className="btn-accent h-12 px-6 rounded-2xl flex items-center gap-2 text-xs font-bold uppercase tracking-widest shrink-0"
        >
          <Send className="w-4 h-4" />
          New Transfer
        </button>
      </div>

      <HistoryModule
        userId={user.id}
        userEmail={user.email?.address || ''}
        hideHeader={true}
        showControls={true}
        onTxClick={(a) => router.push(`/dashboard/activity/${a.id}`)}
      />
    </div>
  );
}

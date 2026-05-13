'use client';

import { ActivityDetailModal } from '@/components/ActivityDetailModal';
import { DashboardPageHeader } from '@/components/DashboardPageHeader';
import { Activity, HistoryModule } from '@/components/HistoryModule';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export default function HistoryPage() {
  const { ready, authenticated, user } = usePrivy();
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(
    null,
  );

  if (!ready || !authenticated || !user) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <DashboardPageHeader
        title="History"
        subtitle="Review your global settlement activity."
      />

      <div className="card-glass p-1">
        <HistoryModule
          userId={user.id}
          userEmail={user.email?.address || ''}
          hideHeader={true}
          onTxClick={setSelectedActivity}
        />
      </div>

      <ActivityDetailModal
        isOpen={!!selectedActivity}
        activity={selectedActivity}
        onClose={() => setSelectedActivity(null)}
      />
    </div>
  );
}

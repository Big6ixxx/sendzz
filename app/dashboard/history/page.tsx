'use client';

import { HistoryModule } from '@/components/HistoryModule';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';

export default function HistoryPage() {
  const { ready, authenticated, user } = usePrivy();

  if (!ready || !authenticated) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-black uppercase tracking-tight">History</h1>
        <p className="text-muted-foreground font-medium">Review your global settlement activity.</p>
      </div>

      <div className="card-elegant p-1">
        <HistoryModule
          userId={user?.id || ''}
          userEmail={user?.email?.address || ''}
        />
      </div>
    </div>
  );
}

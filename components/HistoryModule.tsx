'use client';

import { getUserActivities } from '@/lib/supabase/actions';
import { useQuery } from '@tanstack/react-query';
import { 
  ArrowDownLeft, 
  ArrowUpRight, 
  History, 
  Landmark, 
  Loader2, 
  RefreshCw, 
  Wallet,
  X,
  ExternalLink,
  Copy,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import { toast } from 'sonner';

type ActivityType = 'sent' | 'received' | 'deposit' | 'withdrawal';

interface Activity {
  id: string;
  type: ActivityType;
  amount: number;
  status: string;
  timestamp: string;
  details: string;
  asset: string;
  txHash?: string;
}

const EXPLORER_BASE_URL = 'https://basescan.org/tx/';

export function HistoryModule({ userId, userEmail }: { userId: string; userEmail: string }) {
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  const { data: activities, isLoading, refetch } = useQuery({
    queryKey: ['history', userEmail],
    queryFn: async () => {
      const data = await getUserActivities(userEmail);

      // Unified mapping
      const unified: Activity[] = [
        ...(data.sent || []).map(t => ({
          id: t.id,
          type: 'sent' as ActivityType,
          amount: t.amount,
          status: t.status,
          timestamp: t.created_at,
          details: `Recipient: ${t.recipient_email}`,
          asset: t.asset,
          txHash: t.note?.startsWith('0x') ? t.note : undefined // Note currently stores txHash
        })),
        ...(data.received || []).filter(t => t.sender_id !== userId).map(t => ({
          id: t.id,
          type: 'received' as ActivityType,
          amount: t.amount,
          status: t.status,
          timestamp: t.created_at,
          details: `Sender ID: ${t.sender_id || 'EXTERNAL'}`,
          asset: t.asset,
          txHash: t.note?.startsWith('0x') ? t.note : undefined
        })),
        ...(data.deposits || []).map(d => ({
          id: d.id,
          type: 'deposit' as ActivityType,
          amount: d.amount_usdc || 0,
          status: d.status,
          timestamp: d.created_at,
          details: `Source: ${d.currency_fiat} Gateway`,
          asset: 'USDC',
          txHash: d.paycrest_tx_id?.startsWith('0x') ? d.paycrest_tx_id : undefined
        })),
        ...(data.withdrawals || []).map(w => ({
          id: w.id,
          type: 'withdrawal' as ActivityType,
          amount: w.amount_usdc,
          status: w.status,
          timestamp: w.created_at,
          details: `Target: ${w.fiat_currency} Bank`,
          asset: 'USDC',
          txHash: w.paycrest_order_id?.startsWith('0x') ? w.paycrest_order_id : undefined
        }))
      ];

      return unified.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    },
    enabled: !!userEmail,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="brutal-card p-12 flex flex-col items-center justify-center gap-4 bg-white dark:bg-black">
        <Loader2 className="w-12 h-12 animate-spin text-neon" />
        <p className="font-mono text-sm font-bold uppercase animate-pulse">Syncing Ledger...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-between items-center border-b-4 border-black dark:border-white pb-2">
        <h2 className="font-oswald text-3xl font-black uppercase tracking-tighter flex items-center gap-3">
          <History className="w-8 h-8" />
          Operational History
        </h2>
        <button 
          onClick={() => refetch()}
          className="p-2 hover:bg-neon hover:text-black transition-colors border-2 border-black"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto max-h-[600px] pr-2">
        {!activities || activities.length === 0 ? (
          <div className="brutal-card p-12 text-center bg-white/5 border-dashed">
            <p className="font-mono text-gray-500 uppercase font-bold">No operations logged in terminal</p>
          </div>
        ) : (
          activities.map((a) => (
            <div 
              key={a.id} 
              onClick={() => setSelectedActivity(a)}
              className="brutal-card p-4 flex items-center gap-6 bg-white dark:bg-black hover:bg-neon hover:text-black transition-all group cursor-pointer"
            >
              <div className={`w-12 h-12 border-4 border-black flex items-center justify-center shrink-0 ${
                a.type === 'sent' ? 'bg-red-500' :
                a.type === 'received' ? 'bg-neon' :
                a.type === 'deposit' ? 'bg-green-500' : 'bg-orange-500'
              }`}>
                {a.type === 'sent' && <ArrowUpRight className="w-6 h-6 text-white group-hover:text-black" />}
                {a.type === 'received' && <ArrowDownLeft className="w-6 h-6 text-black" />}
                {a.type === 'deposit' && <Wallet className="w-6 h-6 text-white group-hover:text-black" />}
                {a.type === 'withdrawal' && <Landmark className="w-6 h-6 text-white group-hover:text-black" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <p className="font-oswald text-xl font-black uppercase tracking-tight truncate">
                    {a.type} {a.amount} {a.asset}
                  </p>
                  <span className="font-mono text-[10px] font-bold uppercase opacity-60">
                    {format(new Date(a.timestamp), 'MMM dd, HH:mm')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <p className="font-mono text-[10px] font-bold uppercase truncate opacity-70">
                    {a.details}
                  </p>
                  <span className={`font-mono text-[10px] font-black uppercase px-2 py-0.5 border-2 border-black ${
                    a.status === 'completed' || a.status === 'confirmed' || a.status === 'claimed' ? 'bg-neon text-black' :
                    a.status === 'failed' ? 'bg-red-500 text-white' : 'bg-black text-white'
                  }`}>
                    {a.status}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Activity Detail Modal */}
      {selectedActivity && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-100 flex items-center justify-center p-4">
          <div className="brutal-card w-full max-w-md bg-white text-black p-8 relative">
            <button 
              onClick={() => setSelectedActivity(null)}
              className="absolute top-4 right-4 hover:rotate-90 transition-transform"
            >
              <X className="w-8 h-8" />
            </button>

            <div className="mb-8 border-b-4 border-black pb-4 flex items-center gap-4">
              <div className={`w-14 h-14 border-4 border-black flex items-center justify-center shrink-0 ${
                selectedActivity.type === 'sent' ? 'bg-red-500' :
                selectedActivity.type === 'received' ? 'bg-neon' :
                selectedActivity.type === 'deposit' ? 'bg-green-500' : 'bg-orange-500'
              }`}>
                {selectedActivity.type === 'sent' && <ArrowUpRight className="w-8 h-8 text-white" />}
                {selectedActivity.type === 'received' && <ArrowDownLeft className="w-8 h-8 text-black" />}
                {selectedActivity.type === 'deposit' && <Wallet className="w-8 h-8 text-white" />}
                {selectedActivity.type === 'withdrawal' && <Landmark className="w-8 h-8 text-white" />}
              </div>
              <div>
                <h3 className="font-oswald text-3xl font-black uppercase tracking-tighter leading-none">
                  {selectedActivity.type} Details
                </h3>
                <p className="font-mono text-[10px] font-bold uppercase opacity-60">Internal Log ID: {selectedActivity.id.substring(0, 8)}...</p>
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <div className="flex justify-between items-end border-b-2 border-black pb-4">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase opacity-60">Principal Amount</p>
                  <p className="font-oswald text-5xl font-black">{selectedActivity.amount} {selectedActivity.asset}</p>
                </div>
                <div className={`px-3 py-1 border-4 border-black font-mono text-xs font-black uppercase ${
                  selectedActivity.status === 'completed' || selectedActivity.status === 'confirmed' || selectedActivity.status === 'claimed' ? 'bg-neon text-black' :
                  selectedActivity.status === 'failed' ? 'bg-red-500 text-white' : 'bg-black text-white'
                }`}>
                  {selectedActivity.status}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="brutal-card p-4 bg-gray-50 border-2 border-black">
                  <p className="font-mono text-[10px] font-bold uppercase opacity-60 mb-2 flex items-center gap-2">
                    <Clock className="w-3 h-3" /> Execution Timestamp
                  </p>
                  <p className="font-mono text-sm font-black uppercase">
                    {format(new Date(selectedActivity.timestamp), 'MMMM dd, yyyy @ HH:mm:ss')}
                  </p>
                </div>

                <div className="brutal-card p-4 bg-gray-50 border-2 border-black">
                  <p className="font-mono text-[10px] font-bold uppercase opacity-60 mb-2 flex items-center gap-2">
                    <History className="w-3 h-3" /> Operational Context
                  </p>
                  <p className="font-mono text-sm font-black uppercase">
                    {selectedActivity.details}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex gap-4">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(selectedActivity.id);
                    toast.success('Internal ID copied');
                  }}
                  className="brutal-btn flex-1 bg-white! text-black! flex items-center justify-center gap-2 py-3"
                >
                  <Copy className="w-4 h-4" /> COPY ID
                </button>
                {selectedActivity.txHash ? (
                  <a 
                    href={`${EXPLORER_BASE_URL}${selectedActivity.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="brutal-btn flex-1 bg-black! text-white! flex items-center justify-center gap-2 py-3 hover:bg-neon! hover:text-black! transition-all"
                  >
                    <ExternalLink className="w-4 h-4" /> EXPLORER
                  </a>
                ) : (
                  <button 
                    disabled
                    className="brutal-btn flex-1 bg-gray-300! text-gray-500! border-gray-400! flex items-center justify-center gap-2 py-3 cursor-not-allowed"
                  >
                    <ExternalLink className="w-4 h-4" /> EXPLORER
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

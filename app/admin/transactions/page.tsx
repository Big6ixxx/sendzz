'use client';

import { useQuery } from '@tanstack/react-query';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  ArrowLeftRight, 
  Search,
  Download,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { usePrivy } from '@privy-io/react-auth';
import { getAdminTransactions } from '@/lib/supabase/actions';

const ITEMS_PER_PAGE = 20;

export default function AdminTransactions() {
  const { user } = usePrivy();
  const [filterType, setFilterType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-transactions', filterType, user?.email?.address],
    queryFn: async () => {
      if (!user?.email?.address) return [];
      return getAdminTransactions(user.email.address, filterType || undefined);
    },
    enabled: !!user?.email?.address,
  });

  const transactions = data || [];

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx: any) => {
      if (!search) return true;
      const searchLower = search.toLowerCase();
      return (
        tx.id.toLowerCase().includes(searchLower) ||
        (tx.recipient_email && tx.recipient_email.toLowerCase().includes(searchLower)) ||
        (tx.sender_email && tx.sender_email.toLowerCase().includes(searchLower))
      );
    });
  }, [transactions, search]);

  // Client-side pagination logic
  const totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
  const currentItems = filteredTransactions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'claimed':
      case 'confirmed':
        return 'bg-[#00e87a]/10 text-[#00e87a]';
      case 'pending':
      case 'pending_claim':
      case 'awaiting_verification':
        return 'bg-amber-400/10 text-amber-400';
      case 'failed':
      case 'cancelled':
        return 'bg-red-400/10 text-red-400';
      default:
        return 'bg-white/5 text-white/50';
    }
  };

  const getTxIcon = (type: string) => {
    switch (type) {
      case 'deposit': return <ArrowDownLeft className="w-4 h-4 text-[#00e87a]" />;
      case 'withdrawal': return <ArrowUpRight className="w-4 h-4 text-red-400" />;
      case 'transfer': return <ArrowLeftRight className="w-4 h-4 text-blue-400" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight">Transactions</h1>
          <p className="text-white/40 mt-1 font-medium">Monitoring platform flow. Showing 20 most recent per type.</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white transition-all text-xs font-bold uppercase tracking-widest">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-[#00e87a] transition-colors" />
          <input 
            type="text" 
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-12 bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#00e87a]/50 transition-all"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
          {[
            { label: 'All', value: null },
            { label: 'Deposits', value: 'deposit' },
            { label: 'Withdrawals', value: 'withdrawal' },
            { label: 'Transfers', value: 'transfer' },
          ].map((type) => (
            <button
              key={type.label}
              onClick={() => {
                setFilterType(type.value);
                setCurrentPage(1);
              }}
              className={cn(
                "px-5 h-12 rounded-2xl text-[10px] font-bold uppercase tracking-widest border transition-all whitespace-nowrap",
                filterType === type.value 
                  ? "bg-[#00e87a]/10 border-[#00e87a]/30 text-[#00e87a]" 
                  : "bg-white/5 border-white/10 text-white/40 hover:border-white/20 hover:text-white"
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="card-glass p-0 overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Type</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Entity</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-6 py-8">
                      <div className="h-4 bg-white/5 rounded-full w-full" />
                    </td>
                  </tr>
                ))
              ) : currentItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center">
                    <p className="text-white/20 font-medium">No transactions found.</p>
                  </td>
                </tr>
              ) : (
                currentItems.map((tx: any, i: number) => (
                  <motion.tr 
                    key={tx.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="hover:bg-white/[0.02] transition-colors group"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-white/5">
                          {getTxIcon(tx.tx_type)}
                        </div>
                        <span className="text-xs font-bold text-white/80 uppercase tracking-wider">{tx.tx_type}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-white truncate max-w-[180px]">
                          {tx.tx_type === 'transfer' ? tx.recipient_email : tx.user_id?.slice(0, 8) + '...'}
                        </p>
                        <p className="text-[10px] font-mono text-white/20 uppercase tracking-tighter">{tx.id.slice(0, 12)}...</p>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-baseline gap-1">
                        <span className="text-sm font-bold text-white">${Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        <span className="text-[10px] font-bold text-white/20 tracking-tighter uppercase">USDC</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap",
                        getStatusColor(tx.status)
                      )}>
                        {tx.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-xs font-medium text-white/40">
                      {format(new Date(tx.created_at), 'MMM dd, HH:mm')}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
          <p className="text-[10px] font-bold text-white/20 uppercase tracking-widest">
            Showing {currentItems.length} of {filteredTransactions.length} results
          </p>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-white/5 text-white/20 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 text-[10px] font-bold text-white/40 uppercase tracking-widest">
              Page {currentPage} of {totalPages || 1}
            </div>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="p-2 rounded-lg bg-white/5 text-white/20 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

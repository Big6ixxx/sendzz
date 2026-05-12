'use client';

import * as React from 'react';
import { useBatchSend } from './useBatchSend';
import { Search, X, ChevronLeft, ArrowRight, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReviewSummaryProps {
  hook: ReturnType<typeof useBatchSend>;
}

export function ReviewSummary({ hook }: ReviewSummaryProps) {
  const [search, setSearch] = React.useState('');
  
  const filtered = hook.validRecipients.filter(r => 
    r.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col h-full max-h-[60vh]">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Recipients', value: hook.validRecipients.length },
          { label: 'Each', value: `$${hook.amountUsd.toFixed(2)}` },
          { label: 'Total', value: `$${hook.totalAmount.toFixed(2)}` },
        ].map((stat) => (
          <div key={stat.label} className="p-4 bg-muted/30 border border-border rounded-2xl text-center">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-xl font-black">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="relative shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search recipients..."
          className="input-elegant pl-9 h-11 text-sm rounded-xl"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex-1 overflow-y-auto border border-border rounded-2xl bg-muted/10">
        <div className="sticky top-0 bg-muted/80 backdrop-blur-sm border-b border-border p-3 grid grid-cols-[1fr_auto_auto] gap-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground z-10">
          <span>Recipient Email</span>
          <span className="text-right">Amount</span>
          <span className="w-8"></span>
        </div>
        <div className="divide-y divide-border/50">
          {filtered.map((r) => (
            <div key={r.id} className="p-3 grid grid-cols-[1fr_auto_auto] gap-4 items-center hover:bg-muted/30 transition-colors group">
              <span className="text-sm font-medium truncate">{r.email}</span>
              <span className="text-sm font-bold text-right tabular-nums">${hook.amountUsd.toFixed(2)}</span>
              <button 
                onClick={() => hook.removeRecipient(r.id)}
                className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground uppercase font-bold tracking-tighter opacity-50">
              No results found
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-4 pt-4 shrink-0">
        <button
          onClick={() => hook.setStep('amount')}
          className="btn-secondary flex-1 gap-2"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={() => hook.setStep('confirm')}
          className="btn-primary flex-1 gap-2 group"
        >
          Continue <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    </div>
  );
}

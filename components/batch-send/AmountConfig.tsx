'use client';

import * as React from 'react';
import { useBatchSend } from './useBatchSend';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AlertCircle, ChevronLeft } from 'lucide-react';

interface AmountConfigProps {
  hook: ReturnType<typeof useBatchSend>;
  maxAmount: number;
}

export function AmountConfig({ hook, maxAmount }: AmountConfigProps) {
  const isOverBalance = hook.totalAmount > maxAmount;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Amount per Person
          </Label>
          <button
            onClick={() => {
              hook.setCurrency(c => c === 'USD' ? 'NGN' : 'USD');
              hook.setAmount('');
            }}
            className="text-[10px] font-bold uppercase bg-muted px-3 py-1 rounded-full hover:bg-muted/80 transition-colors"
          >
            Switch to {hook.currency === 'USD' ? 'NGN' : 'USD'}
          </button>
        </div>

        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-4xl font-black opacity-20 pointer-events-none">
            {hook.currency === 'NGN' ? '₦' : '$'}
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            className="w-full bg-transparent border-none text-6xl font-black text-right pr-4 h-24 outline-none focus:ring-0 placeholder:opacity-10"
            value={hook.amount}
            onChange={(e) => hook.setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-5 gap-2">
          {[5, 10, 25, 50, 100].map((v) => {
            const val = hook.currency === 'NGN' ? v * 1500 : v;
            return (
              <button
                key={v}
                onClick={() => hook.setAmount(val.toString())}
                className="py-2.5 bg-muted/50 rounded-xl text-xs font-bold hover:bg-muted transition-colors border border-border/50"
              >
                {hook.currency === 'NGN' ? `₦${v}k` : `$${v}`}
              </button>
            );
          })}
        </div>
      </div>

      <div className={cn(
        "p-6 rounded-2xl border transition-all space-y-4",
        isOverBalance ? "bg-red-50 border-red-100" : "bg-muted/30 border-border"
      )}>
        <div className="flex justify-between items-end border-b border-border/50 pb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total Payout</span>
          <span className={cn("text-3xl font-black", isOverBalance ? "text-red-600" : "text-foreground")}>
            ${hook.totalAmount.toFixed(2)} <span className="text-xs font-bold opacity-40">USDC</span>
          </span>
        </div>
        
        <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
          <span className="text-muted-foreground">Recipients</span>
          <span>{hook.validRecipients.length} People</span>
        </div>

        {isOverBalance && (
          <div className="flex gap-2 items-center text-[10px] font-black uppercase text-red-600">
            <AlertCircle className="w-3 h-3" />
            Insufficient Balance (${maxAmount.toFixed(2)} available)
          </div>
        )}
      </div>

      <div className="space-y-2 px-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          What is this for? (Optional)
        </Label>
        <input
          type="text"
          placeholder="e.g. Payroll May 2026"
          className="input-elegant text-sm"
          value={hook.note}
          onChange={(e) => hook.setNote(e.target.value)}
        />
      </div>

      <div className="flex gap-4 pt-4">
        <button
          onClick={() => hook.setStep('recipients')}
          className="btn-secondary flex-1 gap-2"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={() => hook.setStep('preview')}
          disabled={!hook.amount || hook.amountUsd <= 0 || isOverBalance}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          Review List
        </button>
      </div>
    </div>
  );
}

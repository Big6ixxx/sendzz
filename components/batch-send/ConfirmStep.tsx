'use client';

import { AlertCircle, ShieldCheck, Users } from 'lucide-react';
import { useBatchSend } from './useBatchSend';

interface ConfirmStepProps {
  hook: ReturnType<typeof useBatchSend>;
}

export function ConfirmStep({ hook }: ConfirmStepProps) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 text-center">
      <div className="w-24 h-24 bg-foreground text-background rounded-3xl mx-auto flex items-center justify-center shadow-xl rotate-3">
        <Users className="w-12 h-12" />
      </div>

      <div className="space-y-2">
        <h3 className="text-3xl font-black uppercase tracking-tighter">
          Ready to send?
        </h3>
        <p className="text-sm text-muted-foreground font-medium">
          You are about to send funds to {hook.validRecipients.length} people
        </p>
      </div>

      <div className="p-8 bg-muted/30 border border-border rounded-3xl space-y-6">
        <div className="flex justify-between items-center border-b border-border/50 pb-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Total Payout
          </span>
          <span className="text-4xl font-black">
            ${hook.totalAmount.toFixed(2)}{' '}
            <span className="text-sm opacity-40">USDC</span>
          </span>
        </div>

        <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider">
          <span className="text-muted-foreground">Fees</span>
          <span className="text-green-600 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> Free
          </span>
        </div>
      </div>

      <div className="bg-red-50 text-red-600 p-4 border border-red-100 rounded-2xl flex gap-3 text-left">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <p className="text-[10px] font-bold uppercase leading-relaxed tracking-tight">
          Warning: This action is irreversible once confirmed on the blockchain.
          Please ensure all recipient emails are correct.
        </p>
      </div>

      <div className="flex gap-4 pt-4">
        <button
          onClick={() => hook.setStep('preview')}
          className="btn-secondary flex-1"
        >
          Cancel
        </button>
        <button
          onClick={() => hook.handleConfirm()}
          className="btn-primary flex-1"
        >
          Send Now
        </button>
      </div>
    </div>
  );
}

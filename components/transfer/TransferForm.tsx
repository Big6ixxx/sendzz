import React from 'react';
import { CurrencySelector } from '@/components/CurrencySelector';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getCurrencySymbol, type FiatCurrencyCode } from '@/lib/currency-config';
import { AlertTriangle, Info, Loader2, MessageSquare, ShieldCheck } from 'lucide-react';
import { type ContactRow } from '@/lib/supabase/contacts';
import { ReceiptActions } from '@/components/receipt/ReceiptActions';
import { ReceiptData } from '@/lib/receipt/types';
import { type RecipientCheckState } from './useTransfer';
import { RecipientSuggestions } from '@/components/contacts/RecipientSuggestions';

interface TransferFormProps {
  recipientEmail: string;
  setRecipientEmail: (email: string) => void;
  amount: string;
  setAmount: (amount: string) => void;
  currency: 'USD' | FiatCurrencyCode;
  setCurrency: (currency: 'USD' | FiatCurrencyCode) => void;
  memo: string;
  setMemo: (memo: string) => void;
  loading: boolean;
  status: string;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  setIsAddingContact: (add: boolean) => void;
  contacts: ContactRow[];
  amountUsdc: string;
  isFiat: boolean;
  exchangeRate: number;
  isOverBalance: boolean;
  isZeroBalance: boolean;
  handleTransfer: (e: React.FormEvent) => void;
  smartAddress: string;
  balance: string;
  lastCompletedTransfer?: ReceiptData | null;
  recipientCheck?: RecipientCheckState | null;
}

export function TransferForm({
  recipientEmail,
  setRecipientEmail,
  amount,
  setAmount,
  currency,
  setCurrency,
  memo,
  setMemo,
  loading,
  status,
  showSuggestions,
  setShowSuggestions,
  setIsAddingContact,
  contacts,
  amountUsdc,
  isFiat,
  exchangeRate,
  isOverBalance,
  isZeroBalance,
  handleTransfer,
  smartAddress,
  balance,
  lastCompletedTransfer,
  recipientCheck,
}: TransferFormProps) {
  return (
    <form
      onSubmit={handleTransfer}
      className="flex flex-col gap-8 relative z-10"
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Recipient Email
          </label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger type="button">
                <Info className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                Enter the email address of the person you want to send money to.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="relative z-50">
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => {
              setRecipientEmail(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            className="input-elegant h-14 text-lg font-medium w-full"
            placeholder="name@example.com"
            required
            autoComplete="off"
          />
          <RecipientSuggestions
            isOpen={showSuggestions}
            inputVal={recipientEmail}
            contacts={contacts}
            actionIcon="send"
            onSelect={(email) => {
              setRecipientEmail(email);
              setShowSuggestions(false);
            }}
            onAddNew={() => {
              setIsAddingContact(true);
              setShowSuggestions(false);
            }}
            onClose={() => setShowSuggestions(false)}
          />
        </div>

        {/* Recipient warnings — shown after 500ms debounce check */}
        {recipientCheck?.status === 'done' && (
          <div className="space-y-1.5 pt-1">
            {!recipientCheck.exists && (
              <div
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[11px] font-semibold leading-snug"
                style={{
                  background: 'rgba(251,146,60,0.08)',
                  border: '1px solid rgba(251,146,60,0.2)',
                  color: '#fb923c',
                }}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                This email doesn&apos;t have a Sendzz account yet. They&apos;ll receive a link to claim your funds.
              </div>
            )}
            {recipientCheck.exists && recipientCheck.priorTransactionCount === 0 && (
              <div
                className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[11px] font-semibold leading-snug"
                style={{
                  background: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.2)',
                  color: '#fbbf24',
                }}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                You&apos;ve never sent to this address before. Please double-check before sending.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Amount ({currency})
            </label>
            <TooltipProvider>
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-help"
                  >
                    <Info className="w-4 h-4 opacity-70" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="bg-[#1a1a1c] border border-white/10 text-white"
                >
                  <p className="max-w-[200px] text-center font-medium leading-relaxed">
                    {currency === 'USD'
                      ? 'Send exact USDC from your balance.'
                      : `Enter the amount in ${currency}. the equivalent USDC will be deducted from your balance.`}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex flex-row gap-2 items-center">
            <CurrencySelector selected={currency} onChange={setCurrency} />
            {parseFloat(balance) > 0 && currency === "USD" && (
              <button
                type="button"
                onClick={() => setAmount(currency === 'USD' ? balance : (parseFloat(balance) * exchangeRate).toFixed(2))}
                className="px-3 py-1 rounded-lg bg-accent/10 text-accent text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-colors"
              >
                MAX
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black opacity-20">
            {currency === 'USD' ? '$' : getCurrencySymbol(currency)}
          </span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-elegant h-24 pl-16 text-5xl md:text-6xl font-black tracking-tighter text-right pr-6"
            placeholder="0.00"
            required
          />
        </div>
        {isFiat && exchangeRate > 0 && (
          <p className="text-[10px] font-bold text-muted-foreground uppercase text-right px-2">
            ≈ ${amountUsdc} USDC (@ 1:{exchangeRate.toFixed(0)} {currency})
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/50" />
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Memo (Optional)
          </label>
        </div>
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          className="input-elegant h-14 text-sm"
          placeholder="What's this for?"
        />
      </div>

      <div className="space-y-4 pt-4">
        <button
          type="submit"
          disabled={loading || !smartAddress || isZeroBalance || isOverBalance}
          className="btn-primary w-full h-16 text-lg md:text-xl gap-3 shadow-xl hover:shadow-2xl transition-all"
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : isZeroBalance ? (
            'Insufficient Funds'
          ) : isOverBalance ? (
            'Exceeds Balance'
          ) : (
            <>
              Send Funds Now
              <ShieldCheck className="w-5 h-5 opacity-60" />
            </>
          )}
        </button>

        {status && (
          <div className="p-4 rounded-xl text-xs font-bold uppercase tracking-tight text-center break-words animate-in fade-in slide-in-from-top-2 duration-300 bg-muted/50 text-muted-foreground">
            {status}
          </div>
        )}

        {lastCompletedTransfer && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <p className="text-[10px] font-bold uppercase tracking-widest text-center text-muted-foreground/60">
              Transaction Receipt
            </p>
            <ReceiptActions data={lastCompletedTransfer} variant="light" />
          </div>
        )}
      </div>
    </form>
  );
}

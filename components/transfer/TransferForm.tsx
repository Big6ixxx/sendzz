import React from 'react';
import { CurrencySelector } from '@/components/CurrencySelector';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getCurrencySymbol, type FiatCurrencyCode } from '@/lib/currency-config';
import { Info, Loader2, MessageSquare, Send, ShieldCheck, Plus } from 'lucide-react';
import { type ContactRow } from '@/lib/supabase/contacts';
import { ReceiptActions } from '@/components/receipt/ReceiptActions';
import { ReceiptData } from '@/lib/receipt/types';

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
          {showSuggestions && (
            <div className="absolute left-0 right-0 top-full mt-2 bg-brand-primary border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-100 max-h-64 overflow-y-auto p-2">
              {contacts.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-4">
                    No contacts saved
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsAddingContact(true);
                      setShowSuggestions(false);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-lg"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Contact
                  </button>
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 flex items-center justify-between border-b border-white/5 mb-1">
                    <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">
                      Suggestions
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsAddingContact(true);
                        setShowSuggestions(false);
                      }}
                      className="text-[9px] font-black text-accent uppercase tracking-widest hover:text-accent-dim transition-colors"
                    >
                      + New
                    </button>
                  </div>
                  {contacts
                    .filter(
                      (c) =>
                        c.name.toLowerCase().includes(recipientEmail.toLowerCase()) ||
                        c.email.toLowerCase().includes(recipientEmail.toLowerCase())
                    )
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setRecipientEmail(c.email);
                          setShowSuggestions(false);
                        }}
                        className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 transition-colors flex items-center justify-between group"
                      >
                        <div className="flex flex-col">
                          <span className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">
                            {c.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60">
                            {c.email}
                          </span>
                        </div>
                        <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Send className="w-3 h-3 text-accent" />
                        </div>
                      </button>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
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
          <div
            className={`p-4 rounded-xl text-xs font-bold uppercase tracking-tight text-center animate-in fade-in slide-in-from-top-2 duration-300 ${status.includes('Error')
              ? 'bg-red-50 text-red-600'
              : 'bg-muted/50 text-muted-foreground'
              }`}
          >
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

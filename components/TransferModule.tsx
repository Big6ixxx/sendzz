'use client';

import { CurrencySelector } from '@/components/CurrencySelector';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  getCurrencySymbol,
  type FiatCurrencyCode,
} from '@/lib/currency-config';
import { sendTransferEmail } from '@/lib/email/sendEmail';
import { useExchangeRate } from '@/lib/hooks/useExchangeRate';
import { getUserContacts } from '@/lib/supabase/contacts';
import { executeCircleGaslessTransfer } from '@/lib/web3/circle-actions';
import { ConnectedWallet } from '@privy-io/react-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, MessageSquare, Send, ShieldCheck } from 'lucide-react';
import { useState, useEffect } from 'react';

export function TransferModule({
  smartAddress,
  embeddedProvider,
  balance,
  senderEmail,
  initialRecipientEmail,
  onClearInitialRecipient,
}: {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  balance: string;
  senderEmail: string;
  initialRecipientEmail?: string;
  onClearInitialRecipient?: () => void;
}) {
  const [recipientEmail, setRecipientEmail] = useState(initialRecipientEmail || '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | FiatCurrencyCode>('USD');
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [isPendingClaim, setIsPendingClaim] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const isFiat = currency !== 'USD';
  const { data: exchangeRate = 1 } = useExchangeRate(isFiat ? currency : 'NGN');
  const queryClient = useQueryClient();

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts', senderEmail],
    queryFn: () => getUserContacts(senderEmail),
    enabled: !!senderEmail,
  });


  useEffect(() => {
    if (initialRecipientEmail) {
      setRecipientEmail(initialRecipientEmail);
      if (onClearInitialRecipient) onClearInitialRecipient();
    }
  }, [initialRecipientEmail, onClearInitialRecipient]);

  const amountUsdc = isFiat
    ? (parseFloat(amount || '0') / exchangeRate).toFixed(2)
    : amount;

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !recipientEmail || !embeddedProvider) return;

    setLoading(true);
    setStatus('Looking up recipient...');
    setIsPendingClaim(false);

    try {
      // Import the function dynamically here so we don't cause client/server import issues
      const { getUserAddressByEmail } = await import('@/lib/supabase/users');
      let recipientAddress = await getUserAddressByEmail(recipientEmail);

      if (!recipientAddress) {
        setIsPendingClaim(true);
        setStatus('Recipient not found. Generating secure wallet...');

        const res = await fetch('/api/wallets/pre-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: recipientEmail }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to pre-generate wallet');
        }

        recipientAddress = data.address as string;
        setStatus(`Ready to send to new wallet...`);
      } else {
        setStatus(`Identity confirmed. Requesting signature...`);
      }

      const provider = await embeddedProvider.getEthereumProvider();
      const txHash = await executeCircleGaslessTransfer(
        provider,
        recipientAddress as string,
        amountUsdc,
      );

      setStatus(`Success! Transfer completed.`);

      const { recordTransfer } = await import('@/lib/supabase/transactions');
      await recordTransfer({
        senderEmail,
        recipientEmail,
        amount: parseFloat(amountUsdc),
        status: isPendingClaim ? 'pending_claim' : 'completed',
        note: memo,
        txHash,
      });

      queryClient.invalidateQueries({ queryKey: ['balance', smartAddress] });
      queryClient.invalidateQueries({ queryKey: ['history', senderEmail] });

      sendTransferEmail(recipientEmail, amountUsdc, senderEmail).catch(
        console.error,
      );

      setAmount('');
      setRecipientEmail('');
      setMemo('');
      setIsPendingClaim(false);
      setTimeout(() => setStatus(''), 5000);
    } catch (err) {
      console.error('[Transfer] Fatal Error:', err);
      setStatus(
        `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
    setLoading(false);
  };

  const isOverBalance = parseFloat(amountUsdc || '0') > parseFloat(balance);
  const isZeroBalance = parseFloat(balance) === 0;

  return (
    <div className="card-elegant p-8 md:p-12 bg-background border-border relative overflow-hidden">
      <div className="flex items-center gap-4 mb-10 border-b border-border/50 pb-6">
        <div className="p-3 bg-foreground text-background rounded-2xl shadow-lg">
          <Send className="w-6 h-6 md:w-8 md:h-8" />
        </div>
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">
            Transfer
          </h2>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Send funds to anyone using their email address
          </p>
        </div>
      </div>

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
                  Enter the email address of the person you want to send money
                  to.
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
            {showSuggestions && contacts.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-[#0a0a0b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[100] max-h-64 overflow-y-auto p-2">
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
                      <span className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.email}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Amount ({currency})
            </label>
            <CurrencySelector selected={currency} onChange={setCurrency} />
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
            disabled={
              loading || !smartAddress || isZeroBalance || isOverBalance
            }
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
              className={`p-4 rounded-xl text-xs font-bold uppercase tracking-tight text-center animate-in fade-in slide-in-from-top-2 duration-300 ${
                status.includes('Error')
                  ? 'bg-red-50 text-red-600'
                  : 'bg-muted/50 text-muted-foreground'
              }`}
            >
              {status}
            </div>
          )}
        </div>
      </form>

      {/* Decorative Background Element */}
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-muted/20 rounded-full blur-3xl z-0" />
    </div>
  );
}

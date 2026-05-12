'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { sendTransferEmail } from '@/lib/email/sendEmail';
import { getUserAddressByEmail } from '@/lib/supabase/actions';
import { executeCircleGaslessTransfer } from '@/lib/web3/circle-actions';
import { ConnectedWallet } from '@privy-io/react-auth';
import { useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, Send, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export function TransferModule({
  smartAddress,
  embeddedProvider,
  balance,
  senderEmail,
}: {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  balance: string;
  senderEmail: string;
}) {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');

  const queryClient = useQueryClient();

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !recipientEmail || !embeddedProvider) return;

    setLoading(true);
    setStatus('Looking up recipient...');

    try {
      let recipientAddress = await getUserAddressByEmail(recipientEmail);

      if (!recipientAddress) {
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
        amount,
      );

      setStatus(`Success! Transfer completed.`);

      const { recordTransfer } = await import('@/lib/supabase/actions');
      await recordTransfer({
        senderEmail,
        recipientEmail,
        amount: parseFloat(amount),
        status: status.includes('Generating') ? 'pending_claim' : 'completed',
        txHash,
      });

      queryClient.invalidateQueries({ queryKey: ['balance', smartAddress] });
      queryClient.invalidateQueries({ queryKey: ['history', senderEmail] });

      sendTransferEmail(recipientEmail, amount, senderEmail).catch(
        console.error,
      );

      setAmount('');
      setRecipientEmail('');
      setTimeout(() => setStatus(''), 5000);
    } catch (err) {
      console.error('[Transfer] Fatal Error:', err);
      setStatus(
        `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
    setLoading(false);
  };

  const isOverBalance = parseFloat(amount || '0') > parseFloat(balance);
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
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className="input-elegant h-14 text-lg font-medium"
            placeholder="name@example.com"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1 block">
            Amount (USDC)
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black opacity-20">
              $
            </span>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-elegant h-24 pl-10 text-5xl md:text-6xl font-black tracking-tighter text-right pr-6"
              placeholder="0.00"
              required
            />
          </div>
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

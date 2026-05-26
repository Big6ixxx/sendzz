import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUserContacts } from '@/components/contacts/useContacts';
import { useExchangeRate } from '@/lib/hooks/useExchangeRate';
import { ConnectedWallet } from '@privy-io/react-auth';
import { executeCircleGaslessTransfer } from '@/lib/web3/circle-actions';
import { type FiatCurrencyCode } from '@/lib/currency-config';
import { ReceiptData } from '@/lib/receipt/types';
import { toast } from 'sonner';

/** Convert raw viem / Circle / network errors into short user-readable strings. */
export function parseFriendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Circle / viem UserOperation errors contain multi-KB hex calldata — catch first
  if (raw.includes('executing user operation') || raw.includes('UserOperation')) {
    if (raw.includes('JSON is not a valid request object'))
      return 'Transfer service is temporarily unavailable. Please try again shortly.';
    if (raw.includes('AA21') || raw.includes("didn't pay prefund"))
      return 'Insufficient funds to cover the network fee.';
    if (
      raw.includes('precheck failed') ||
      raw.includes('sender balance and deposit together')
    )
      return 'Transfer failed. Please try again.';
    if (raw.includes('AA25') || raw.includes('invalid account nonce'))
      return 'Transaction conflict — please wait a moment and retry.';
    if (/rejected|denied/i.test(raw))
      return 'Transaction rejected by network.';
    return 'Transfer failed. Please try again.';
  }

  if (/user rejected|user denied|cancelled/i.test(raw)) return 'Transaction cancelled.';
  if (/insufficient funds|insufficient balance/i.test(raw))
    return 'Insufficient balance to complete this transfer.';
  if (/network|fetch|ECONNREFUSED|timeout/i.test(raw))
    return 'Network error. Please check your connection and try again.';
  if (raw.includes('Circle Client Key not configured'))
    return 'Transfer service is not configured. Please contact support.';

  // Only surface the raw message if it's short enough to be readable
  return raw.length <= 120 ? raw : 'Transfer failed. Please try again.';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface RecipientCheckState {
  status: 'idle' | 'loading' | 'done';
  exists: boolean;
  priorTransactionCount: number;
}

interface UseTransferProps {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  balance: string;
  senderEmail: string;
  initialRecipientEmail?: string;
  onClearInitialRecipient?: () => void;
}

export function useTransfer({
  smartAddress,
  embeddedProvider,
  balance,
  senderEmail,
  initialRecipientEmail,
  onClearInitialRecipient,
}: UseTransferProps) {
  const [recipientEmail, setRecipientEmail] = useState(initialRecipientEmail || '');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | FiatCurrencyCode>('USD');
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [isPendingClaim, setIsPendingClaim] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [lastRecipient, setLastRecipient] = useState('');
  const [lastCompletedTransfer, setLastCompletedTransfer] = useState<ReceiptData | null>(null);
  const [recipientCheck, setRecipientCheck] = useState<RecipientCheckState | null>(null);

  // Cache recipient check results for 30s to avoid hammering on keystrokes
  const checkCacheRef = useRef<Map<string, { data: { exists: boolean; priorTransactionCount: number }; ts: number }>>(new Map());

  const isFiat = currency !== 'USD';
  const { data: exchangeRate = 1 } = useExchangeRate(isFiat ? currency : 'USD');
  const queryClient = useQueryClient();

  const { data: contacts = [] } = useUserContacts(senderEmail);

  useEffect(() => {
    if (initialRecipientEmail) {
      setRecipientEmail(initialRecipientEmail);
      if (onClearInitialRecipient) onClearInitialRecipient();
    }
  }, [initialRecipientEmail, onClearInitialRecipient]);

  // Debounced recipient check — fires 500ms after the email field settles
  useEffect(() => {
    const emailLower = recipientEmail.toLowerCase().trim();

    if (!emailLower || !isValidEmail(emailLower)) {
      setRecipientCheck(null);
      return;
    }
    // Don't warn when sending to yourself
    if (emailLower === senderEmail.toLowerCase()) {
      setRecipientCheck(null);
      return;
    }

    const timer = setTimeout(async () => {
      // Check 30-second cache first
      const cached = checkCacheRef.current.get(emailLower);
      if (cached && Date.now() - cached.ts < 30_000) {
        setRecipientCheck({ status: 'done', ...cached.data });
        return;
      }

      setRecipientCheck({ status: 'loading', exists: false, priorTransactionCount: 0 });
      try {
        const res = await fetch(
          `/api/transfer/check-recipient?email=${encodeURIComponent(emailLower)}`,
        );
        if (res.ok) {
          const data = await res.json();
          checkCacheRef.current.set(emailLower, { data, ts: Date.now() });
          setRecipientCheck({ status: 'done', ...data });
        } else {
          setRecipientCheck(null);
        }
      } catch {
        setRecipientCheck(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [recipientEmail, senderEmail]);

  const amountUsdc = isFiat
    ? (parseFloat(amount || '0') / exchangeRate).toFixed(2)
    : amount;

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !recipientEmail || !embeddedProvider) return;

    setLoading(true);
    setLastCompletedTransfer(null);
    setStatus('Looking up recipient...');
    setIsPendingClaim(false);

    try {
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
        setStatus('Ready to send to new wallet...');
      } else {
        setStatus('Identity confirmed. Requesting signature...');
      }

      const provider = await embeddedProvider.getEthereumProvider();
      const txHash = await executeCircleGaslessTransfer(
        provider,
        recipientAddress as string,
        amountUsdc,
      );

      toast.success('Transfer completed!');
      setStatus('');

      setLastCompletedTransfer({
        id: (txHash as string) || `txn-${Date.now().toString(36)}`,
        type: 'sent',
        status: 'completed',
        timestamp: new Date().toISOString(),
        amountUsdc: parseFloat(amountUsdc),
        senderEmail,
        recipientEmail,
        note: memo || undefined,
        txHash: txHash as string,
      });

      const { recordTransfer } = await import('@/lib/supabase/transactions');
      await recordTransfer({
        senderEmail,
        recipientEmail,
        amount: parseFloat(amountUsdc),
        status: isPendingClaim ? 'pending_claim' : 'completed',
        note: memo,
        txHash,
      });

      const isExisting = contacts.some(
        (c) => c.email.toLowerCase() === recipientEmail.toLowerCase(),
      );
      if (!isExisting) {
        setLastRecipient(recipientEmail);
        setShowSavePrompt(true);
      }

      queryClient.invalidateQueries({ queryKey: ['balance', smartAddress] });
      queryClient.invalidateQueries({ queryKey: ['history', senderEmail] });

      setAmount('');
      setRecipientEmail('');
      setMemo('');
      setIsPendingClaim(false);
    } catch (err) {
      console.error('[Transfer] Fatal Error:', err);
      toast.error(parseFriendlyError(err));
      setStatus('');
    }
    setLoading(false);
  };

  const isOverBalance = parseFloat(amountUsdc || '0') > parseFloat(balance);
  const isZeroBalance = parseFloat(balance) === 0;

  return {
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
    setStatus,
    isPendingClaim,
    showSuggestions,
    setShowSuggestions,
    isAddingContact,
    setIsAddingContact,
    showSavePrompt,
    setShowSavePrompt,
    lastRecipient,
    lastCompletedTransfer,
    contacts,
    amountUsdc,
    isFiat,
    exchangeRate,
    isOverBalance,
    isZeroBalance,
    handleTransfer,
    recipientCheck,
  };
}

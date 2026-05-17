import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUserContacts } from '@/lib/supabase/contacts';
import { useExchangeRate } from '@/lib/hooks/useExchangeRate';
import { ConnectedWallet } from '@privy-io/react-auth';
import { executeCircleGaslessTransfer } from '@/lib/web3/circle-actions';
import { sendTransferEmail } from '@/lib/email/sendEmail';
import { type FiatCurrencyCode } from '@/lib/currency-config';

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

      setStatus('Success! Transfer completed.');

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
    contacts,
    amountUsdc,
    isFiat,
    exchangeRate,
    isOverBalance,
    isZeroBalance,
    handleTransfer,
  };
}

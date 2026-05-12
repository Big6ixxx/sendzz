'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { batchSend, type SendResult } from '@/lib/batch-send';
import { ConnectedWallet } from '@privy-io/react-auth';

export type Step =
  | 'recipients'
  | 'amount'
  | 'preview'
  | 'confirm'
  | 'processing'
  | 'results';

export interface Recipient {
  id: string;
  email: string;
  valid: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useBatchSend(
  maxAmount: number,
  smartAddress: string,
  senderEmail: string,
  embeddedProvider?: ConnectedWallet,
  onClose?: () => void
) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('recipients');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'NGN'>('USD');
  const [note, setNote] = useState('');
  
  const [batchResults, setBatchResults] = useState<SendResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // Derived
  const validRecipients = recipients.filter((r) => r.valid);
  const amountUsd = currency === 'NGN' ? parseFloat(amount || '0') / 1500 : parseFloat(amount || '0');
  const totalAmount = amountUsd * validRecipients.length;

  const handleConfirm = async (retryEmails?: string[]) => {
    if (!embeddedProvider) {
      toast.error('Wallet not connected');
      return;
    }

    const targetEmails = retryEmails || validRecipients.map((r) => r.email);
    setStep('processing');
    setProgress({ done: 0, total: targetEmails.length });

    try {
      const provider = await embeddedProvider.getEthereumProvider();

      const results = await batchSend({
        recipients: targetEmails,
        amount: amountUsd.toString(),
        senderEmail,
        provider,
        onProgress: (done, total) => setProgress({ done, total }),
      });

      if (retryEmails) {
        setBatchResults((prev) => {
          const updated = [...prev];
          results.forEach((newRes) => {
            const idx = updated.findIndex((r) => r.email === newRes.email);
            if (idx !== -1) updated[idx] = newRes;
            else updated.push(newRes);
          });
          return updated;
        });
      } else {
        setBatchResults(results);
      }

      setStep('results');
      queryClient.invalidateQueries({ queryKey: ['balance', smartAddress] });
      queryClient.invalidateQueries({ queryKey: ['history', senderEmail] });

      if (results.some((r) => r.status === 'failed')) {
        toast.error('Some transfers failed. Review and retry.');
      } else {
        toast.success('All transfers completed successfully! 🎉');
      }
    } catch (err) {
      console.error('Batch send error:', err);
      toast.error('An error occurred during sending.');
      setStep('confirm');
    }
  };

  const addRecipients = (emails: string[]) => {
    setRecipients((prev) => {
      const seen = new Set(prev.map((r) => r.email));
      const next = [...prev];
      for (const email of emails) {
        const trimmed = email.trim().toLowerCase();
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        next.push({
          id: `${Date.now()}-${Math.random()}`,
          email: trimmed,
          valid: EMAIL_RE.test(trimmed),
        });
      }
      return next;
    });
  };

  const removeRecipient = (id: string) => {
    setRecipients((p) => p.filter((r) => r.id !== id));
  };

  return {
    step, setStep,
    recipients, setRecipients, addRecipients, removeRecipient,
    validRecipients,
    amount, setAmount,
    currency, setCurrency,
    note, setNote,
    amountUsd, totalAmount,
    batchResults, progress,
    handleConfirm
  };
}

'use client';

import {
  finalizeOffRamp,
  getInstitutions,
  getOffRampQuote,
  getOnRampRate,
  getOrderStatus,
  initiateOnRamp,
  verifyBankAccount,
} from '@/lib/actions/ramp';
import { type FiatCurrencyCode } from '@/lib/currency-config';
import {
  PaycrestInstitution,
  PaycrestOrderResponse,
} from '@/lib/paycrest/types';
import { executeCircleGaslessTransfer } from '@/lib/web3/circle-actions';
import { ConnectedWallet } from '@privy-io/react-auth';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export type FlowType = 'deposit' | 'withdraw';

interface BankDetails {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bankName: string;
}

export function useDepositWithdraw(
  type: FlowType,
  userAddress: string,
  userEmail: string,
  userId: string,
  balance: string,
  embeddedProvider?: ConnectedWallet,
  onClose?: () => void,
) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrencyCode>('NGN');

  // Institutions & Rates
  const [institutions, setInstitutions] = useState<PaycrestInstitution[]>([]);
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  // Bank Selection
  const [bankDetails, setBankDetails] = useState<BankDetails>({
    accountNumber: '',
    bankCode: '',
    accountName: '',
    bankName: '',
  });
  const [verifyingBank, setVerifyingBank] = useState(false);
  const lastAttemptedRef = useRef<string>('');

  // Order & Execution
  const [order, setOrder] = useState<PaycrestOrderResponse | null>(null);
  const [quote, setQuote] = useState<{
    rate: number;
    payoutAmount: number;
  } | null>(null);
  const [transferring, setTransferring] = useState(false);

  // Polling for deposit status
  const [polling, setPolling] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch institutions & rates when fiatCurrency changes
  useEffect(() => {
    const init = async () => {
      try {
        const res = await getInstitutions(fiatCurrency);
        setInstitutions(res.data);
      } catch (err) {
        console.error('Failed to fetch banks', err);
      }
    };
    init();

    // Reset bank details when currency changes
    setBankDetails({ accountNumber: '', bankCode: '', accountName: '', bankName: '' });
    lastAttemptedRef.current = '';

    if (type === 'deposit') {
      setRateLoading(true);
      getOnRampRate(fiatCurrency)
        .then(setRate)
        .catch(() => setRate(null))
        .finally(() => setRateLoading(false));
    }
  }, [type, fiatCurrency]);

  // Bank Auto-Verification
  const handleVerifyBank = useCallback(async (details: BankDetails) => {
    const key = `${details.bankCode}-${details.accountNumber}`;
    if (
      details.accountNumber.length !== 10 ||
      !details.bankCode ||
      lastAttemptedRef.current === key
    )
      return;

    setVerifyingBank(true);
    lastAttemptedRef.current = key;
    try {
      const res = await verifyBankAccount(
        details.bankCode,
        details.accountNumber,
      );
      const name =
        typeof res.data === 'string' ? res.data : res.data?.accountName;
      setBankDetails((prev) => ({ ...prev, accountName: name }));
      toast.success('Bank account verified');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
      setBankDetails((prev) => ({ ...prev, accountName: '' }));
    } finally {
      setVerifyingBank(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (
        bankDetails.accountNumber.length === 10 &&
        bankDetails.bankCode &&
        !bankDetails.accountName
      ) {
        handleVerifyBank(bankDetails);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [bankDetails, handleVerifyBank]);

  // Flow Handlers
  const handleDepositInitiate = async () => {
    if (!bankDetails.accountName) {
      setError('Please verify your refund bank account');
      return;
    }
    
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      setError('Enter a valid amount');
      return;
    }
    
    // Minimums
    if (fiatCurrency === 'NGN' && val < 1000) {
      setError('Minimum deposit is 1,000 NGN');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await initiateOnRamp({
        amountFiat: val,
        userId,
        userAddress,
        userEmail,
        refundAccount: {
          institution: bankDetails.bankCode,
          accountIdentifier: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        },
        fiatCurrency,
      });
      setOrder(res);
      setStep(2);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An unknown error occurred',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawQuote = async () => {
    const val = parseFloat(amount);
    if (isNaN(val) || val < 1) {
      setError('Minimum withdrawal is 1 USDC');
      return;
    }

    if (val > parseFloat(balance)) {
      setError(`Insufficient balance. Max: ${balance} USDC`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getOffRampQuote(val, fiatCurrency);
      setQuote(res);
      setStep(2);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An unknown error occurred',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawFinalize = async () => {
    if (!bankDetails.accountName) {
      setError('Please verify destination account');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await finalizeOffRamp(
        parseFloat(amount),
        bankDetails.accountNumber,
        bankDetails.bankCode,
        bankDetails.accountName,
        userAddress,
        userEmail,
        fiatCurrency,
      );
      setOrder(res);
      setStep(3);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An unknown error occurred',
      );
    } finally {
      setLoading(false);
    }
  };

  const executeTransfer = async () => {
    if (!order?.providerAccount?.receiveAddress || !embeddedProvider) return;
    setTransferring(true);
    try {
      const provider = await embeddedProvider.getEthereumProvider();
      await executeCircleGaslessTransfer(
        provider,
        order.providerAccount.receiveAddress,
        amount,
      );
      toast.success('Transfer successful!');
      queryClient.invalidateQueries({ queryKey: ['balance', userAddress] });
      setTimeout(() => onClose?.(), 2000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An unknown error occurred',
      );
    } finally {
      setTransferring(false);
    }
  };

  const startPolling = useCallback(() => {
    if (!order?.id) return;
    setPolling(true);
    const poll = async () => {
      try {
        const result = await getOrderStatus(order.id);
        setTxStatus(result.status);
        if (
          [
            'settled',
            'refunded',
            'expired',
            'failed',
            'cancelled',
            'completed',
          ].includes(result.status)
        ) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setPolling(false);

          if (result.status === 'settled') {
            toast.success('Funds received!');
            queryClient.invalidateQueries({
              queryKey: ['balance', userAddress],
            });
            setStep(3);
          } else {
            toast.error(`Transaction ${result.status}`);
          }
        }
      } catch {}
    };
    poll();
    pollIntervalRef.current = setInterval(poll, 8000);
  }, [order?.id, queryClient, userAddress]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  return {
    step,
    setStep,
    amount,
    setAmount,
    loading,
    error,
    fiatCurrency,
    setFiatCurrency,
    institutions,
    rate,
    rateLoading,
    bankDetails,
    setBankDetails,
    verifyingBank,
    order,
    quote,
    transferring,
    polling,
    txStatus,
    handleDepositInitiate,
    handleWithdrawQuote,
    handleWithdrawFinalize,
    executeTransfer,
    startPolling,
  };
}

'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Shield,
  Wallet,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface Institution {
  code: string;
  name: string;
}

interface WithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxAmount: number;
}

type Step = 'method' | 'amount' | 'bank' | 'crypto_dest' | 'verify' | 'success';
type WithdrawMethod = 'fiat' | 'usdc';
type Chain = 'solana' | 'ethereum' | 'base' | 'arbitrum' | 'polygon';

export function WithdrawDialog({
  open,
  onOpenChange,
  maxAmount,
}: WithdrawDialogProps) {
  const [step, setStep] = useState<Step>('method');
  const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethod>('fiat');
  const [loading, setLoading] = useState(false);

  // Form data
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'NGN' | 'KES' | 'GHS'>(
    'NGN',
  );
  const [institutionCode, setInstitutionCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [withdrawalId, setWithdrawalId] = useState('');

  // Crypto withdrawal state
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [cryptoChain, setCryptoChain] = useState<Chain>('solana');

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);

  // Account validation state
  const [accountValidating, setAccountValidating] = useState(false);
  const [accountValidationError, setAccountValidationError] = useState('');

  // Exchange rate
  const [exchangeRate, setExchangeRate] = useState(1500); // Default fallback
  const [rateLoading, setRateLoading] = useState(false);

  // Fetch exchange rate when dialog opens
  useEffect(() => {
    if (open && currency !== 'USD') {
      const fetchRate = async () => {
        setRateLoading(true);
        try {
          const res = await fetch(`/api/paycrest/rates/USDC/${currency}`);
          const data = await res.json();
          if (data.success && data.data?.marketRate) {
            setExchangeRate(data.data.marketRate);
          }
        } catch {
          console.warn('Failed to fetch exchange rate, using default');
        }
        setRateLoading(false);
      };
      fetchRate();
    }
  }, [currency, open]);

  // Fetch institutions when dialog opens
  useEffect(() => {
    if (open) {
      if (currency === 'USD') {
        fetchInstitutions('NGN');
      } else {
        fetchInstitutions(currency);
      }
    }
  }, [currency, open]);

  const fetchInstitutions = async (currencyCode: string) => {
    setInstitutionsLoading(true);
    try {
      const res = await fetch(`/api/paycrest/institutions/${currencyCode}`);
      const data = await res.json();
      if (data.institutions) {
        setInstitutions(data.institutions);
      }
    } catch {
      console.error('Failed to fetch institutions');
    }
    setInstitutionsLoading(false);
  };

  // Validate account when institution and account number are ready
  useEffect(() => {
    const validateAccount = async () => {
      // Reset validation state
      setAccountName('');
      setAccountValidationError('');

      // Require both institution and sufficient account number length
      if (!institutionCode || accountNumber.length < 10) {
        return;
      }

      setAccountValidating(true);
      try {
        const res = await fetch('/api/paycrest/verify-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            institutionCode,
            accountNumber,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          setAccountValidationError(data.error || 'Unable to verify account');
        } else {
          setAccountName(data.accountName);
        }
      } catch {
        setAccountValidationError('Account verification failed');
      }
      setAccountValidating(false);
    };

    validateAccount();
  }, [institutionCode, accountNumber]);

  const handleInitiate = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    let equivalentUsd = amountNum;
    if (currency !== 'USD') {
      equivalentUsd = amountNum / exchangeRate;
    }

    if (equivalentUsd > maxAmount) {
      toast.error(`Insufficient balance (Max: $${maxAmount.toFixed(2)})`);
      return;
    }

    if (withdrawMethod === 'usdc') {
      setStep('crypto_dest');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/withdraw/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: equivalentUsd,
          currency,
          institutionCode,
          accountNumber,
          accountName: accountName || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate withdrawal');
      }

      setWithdrawalId(data.withdrawalId);
      setStep('verify');
      toast.success('Verification code sent to your email');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to initiate',
      );
    }
    setLoading(false);
  };

  const handleInitiateCrypto = async () => {
    if (!cryptoAddress || cryptoAddress.length < 32) {
      toast.error('Please enter a valid wallet address');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/withdraw/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(amount),
          currency: 'USDC',
          method: 'crypto',
          destinationAddress: cryptoAddress,
          chain: cryptoChain,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to initiate withdrawal');
      }

      setWithdrawalId(data.withdrawalId);
      setStep('verify');
      toast.success('Verification code sent to your email');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to initiate',
      );
    }
    setLoading(false);
  };

  const handleVerify = async () => {
    if (verificationCode.length !== 6) {
      toast.error('Please enter the 6-digit code');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/withdraw/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          withdrawalId,
          code: verificationCode,
          accountNumber,
          accountName: accountName || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      setStep('success');
      toast.success('Withdrawal processing! 🎉');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Verification failed',
      );
    }
    setLoading(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep('method');
      setWithdrawMethod('fiat');
      setAmount('');
      setInstitutionCode('');
      setAccountNumber('');
      setAccountName('');
      setVerificationCode('');
      setWithdrawalId('');
      setAccountValidationError('');
    }, 200);
  };

  const formatAmount = (num: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const selectedInstitution = institutions.find(
    (i) => i.code === institutionCode,
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-violet-600" />
            Withdraw to Bank
          </DialogTitle>
          <DialogDescription>
            {step === 'method' && 'Choose your withdrawal destination.'}
            {step === 'amount' && `Enter the amount of USDC to withdraw.`}
            {step === 'bank' && 'Enter your bank account details.'}
            {step === 'crypto_dest' && 'Enter your destination wallet address.'}
            {step === 'verify' &&
              'Enter the verification code sent to your email.'}
            {step === 'success' && 'Your withdrawal is being processed.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'method' && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setWithdrawMethod('fiat');
                  setStep('amount');
                }}
                className="group flex gap-2 p-3.5 rounded-xl border border-white/10 bg-white/4 hover:border-primary/50 hover:bg-primary/8 text-left transition-all"
              >
                <Banknote className="w-5 h-5 text-primary transition-all" />
                <div>
                  <p className="font-medium text-sm text-foreground">
                    Fiat to Bank
                  </p>
                  <p className="text-xs text-muted-foreground">NGN, KES, GHS</p>
                </div>
              </button>
              <button
                onClick={() => {
                  setWithdrawMethod('usdc');
                  setCurrency('USD');
                  setStep('amount');
                }}
                className="group flex gap-2 items-center p-3.5 rounded-xl border border-white/10 bg-white/4 hover:border-accent/50 hover:bg-accent/8 text-left transition-all"
              >
                <Wallet className="w-5 h-5 text-accent" />
                <div>
                  <p className="font-medium text-sm text-foreground">
                    Crypto Transfer
                  </p>
                  <p className="text-xs text-muted-foreground">
                    USDC (Multi-chain)
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 'amount' && (
          <div className="space-y-4 mt-4">
            {/* Amount */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="withdrawAmount">Amount</Label>
                <span className="text-sm text-muted-foreground">
                  Max: {formatAmount(maxAmount)} USDC
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">
                  {currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : ''}
                </span>
                <Input
                  id="withdrawAmount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-8 pr-16 text-lg font-semibold"
                  value={amount}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setAmount(val);
                  }}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">
                  {currency}
                </span>
              </div>
              {currency !== 'USD' && amount && (
                <p className="text-xs text-muted-foreground text-right">
                  {rateLoading
                    ? 'Loading rate...'
                    : `≈ $${(parseFloat(amount) / exchangeRate).toFixed(2)} USD`}
                </p>
              )}
            </div>

            {/* Currency */}
            {withdrawMethod === 'fiat' && (
              <div className="space-y-2">
                <Label>Withdrawal Currency</Label>
                <div className="grid grid-cols-3 gap-2">
                  {['NGN', 'KES', 'GHS'].map((curr) => (
                    <Button
                      key={curr}
                      type="button"
                      variant={currency === curr ? 'default' : 'outline'}
                      onClick={() => setCurrency(curr as 'NGN' | 'KES' | 'GHS')}
                      className={`font-semibold ${
                        currency !== curr
                          ? 'border-white/10 bg-white/5 hover:bg-white/10 text-foreground'
                          : 'btn-shimmer text-white border-0'
                      }`}
                    >
                      {curr}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button
              onClick={() => {
                if (withdrawMethod === 'fiat') setStep('bank');
                else setStep('crypto_dest');
              }}
              disabled={
                !amount ||
                parseFloat(amount) <= 0 ||
                (currency !== 'USD'
                  ? parseFloat(amount) / exchangeRate > maxAmount
                  : parseFloat(amount) > maxAmount)
              }
              className="w-full h-12 font-bold btn-shimmer text-white border-0"
            >
              Continue
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 'bank' && (
          <div className="space-y-4 mt-4">
            {/* Bank Selection */}
            <div className="space-y-2">
              <Label>Select Bank</Label>
              {institutionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <select
                  value={institutionCode}
                  onChange={(e) => setInstitutionCode(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-white/10 bg-white/5 text-foreground text-sm focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
                >
                  <option value="" className="bg-background">
                    Select a bank...
                  </option>
                  {institutions.map((inst) => (
                    <option
                      key={inst.code}
                      value={inst.code}
                      className="bg-background"
                    >
                      {inst.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Account Number */}
            <div className="space-y-2">
              <Label htmlFor="accountNumber">Account Number</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="accountNumber"
                  type="text"
                  inputMode="numeric"
                  placeholder="0123456789"
                  className="pl-10"
                  value={accountNumber}
                  onChange={(e) =>
                    setAccountNumber(e.target.value.replace(/\D/g, ''))
                  }
                  maxLength={20}
                />
              </div>
            </div>

            {/* Account Name (validated) */}
            <div className="space-y-2">
              <Label htmlFor="accountName">Account Name</Label>
              <div className="relative">
                <Input
                  id="accountName"
                  type="text"
                  placeholder={
                    accountValidating
                      ? 'Validating...'
                      : 'Enter account number above'
                  }
                  value={accountName}
                  readOnly
                  className={`pr-10 ${
                    accountValidationError
                      ? 'border-red-500 focus-visible:ring-red-500'
                      : accountName
                        ? 'border-green-500 focus-visible:ring-green-500'
                        : ''
                  }`}
                />
                {accountValidating && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {!accountValidating && accountName && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                )}
                {!accountValidating && accountValidationError && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500" />
                )}
              </div>
              {accountValidationError && (
                <p className="text-sm text-red-500">{accountValidationError}</p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setStep('amount')}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleInitiate}
                disabled={
                  loading ||
                  !institutionCode ||
                  !accountNumber ||
                  !accountName ||
                  accountValidating
                }
                className="flex-1 font-bold bg-linear-to-r from-blue-600 to-violet-600"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Shield className="mr-2 h-4 w-4" />
                    Verify & Withdraw
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 'crypto_dest' && (
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Destination Chain</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'solana', name: 'Solana' },
                  { id: 'base', name: 'Base' },
                  { id: 'polygon', name: 'Polygon' },
                  { id: 'ethereum', name: 'Ethereum' },
                  { id: 'arbitrum', name: 'Arbitrum' },
                ].map((c) => (
                  <Button
                    key={c.id}
                    variant={cryptoChain === c.id ? 'default' : 'outline'}
                    onClick={() => setCryptoChain(c.id as Chain)}
                    className={`h-10 border ${
                      cryptoChain !== c.id
                        ? 'border-white/10 bg-white/5 hover:bg-white/10 text-foreground'
                        : 'btn-shimmer text-white border-0'
                    }`}
                  >
                    {c.name}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cryptoAddress">Wallet Address</Label>
              <div className="relative">
                <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="cryptoAddress"
                  type="text"
                  placeholder={
                    cryptoChain === 'solana'
                      ? 'Solana Address'
                      : '0x... EVM Address'
                  }
                  className="pl-10"
                  value={cryptoAddress}
                  onChange={(e) => setCryptoAddress(e.target.value)}
                />
              </div>
            </div>

            <div className="p-3 bg-primary/8 rounded-xl border border-primary/20 flex items-start gap-2">
              <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Zero Network Fees
                </p>
                <p className="text-xs text-muted-foreground">
                  {cryptoChain === 'solana'
                    ? 'Sponsored by BlockRadar native gasless features.'
                    : 'Sponsored by Circle ERC-4337 Paymaster integration.'}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setStep('amount')}
                className="flex-1 border-white/10 bg-white/5 hover:bg-white/10 text-foreground"
              >
                Back
              </Button>
              <Button
                onClick={handleInitiateCrypto}
                disabled={loading || !cryptoAddress}
                className="flex-1 font-bold btn-shimmer text-white border-0"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Send USDC'
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-4 mt-4">
            <div className="bg-primary/8 text-foreground/80 border border-primary/20 p-4 rounded-xl text-sm">
              <p className="font-semibold mb-1 text-foreground">
                Security Verification
              </p>
              <p>
                Enter the 6-digit code we sent to your email to confirm this
                withdrawal.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="verifyCode">Verification Code</Label>
              <Input
                id="verifyCode"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                className="text-center text-2xl font-bold tracking-widest"
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(
                    e.target.value.replace(/\D/g, '').slice(0, 6),
                  )
                }
                maxLength={6}
              />
            </div>

            <Button
              onClick={handleVerify}
              disabled={loading || verificationCode.length !== 6}
              className="w-full h-12 font-bold btn-shimmer text-white border-0"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Confirm Withdrawal'
              )}
            </Button>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center mx-auto mb-4">
              <Banknote className="w-8 h-8 text-accent" />
            </div>
            <h3
              className="text-xl font-bold mb-2"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Processing! 🎉
            </h3>
            <p className="text-muted-foreground mb-5">
              Your withdrawal of ${amount} USDC to{' '}
              {selectedInstitution?.name || 'your bank'} is being processed.
              You&apos;ll receive an email confirmation when complete.
            </p>
            <Button
              onClick={handleClose}
              className="w-full btn-shimmer text-white border-0 font-bold"
            >
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

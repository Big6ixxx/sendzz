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
  Banknote,
  Building2,
  ChevronRight,
  Loader2,
  Shield,
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

type Step = 'amount' | 'bank' | 'verify' | 'success';

export function WithdrawDialog({
  open,
  onOpenChange,
  maxAmount,
}: WithdrawDialogProps) {
  const [step, setStep] = useState<Step>('amount');
  const [loading, setLoading] = useState(false);

  // Form data
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('NGN');
  const [institutionCode, setInstitutionCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [withdrawalId, setWithdrawalId] = useState('');

  // Data

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);

  // Fetch institutions when dialog opens
  useEffect(() => {
    if (open) {
      fetchInstitutions(currency);
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

  const handleInitiate = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (amountNum > maxAmount) {
      toast.error('Insufficient balance');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/withdraw/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
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
      setStep('amount');
      setAmount('');
      setInstitutionCode('');
      setAccountNumber('');
      setAccountName('');
      setVerificationCode('');
      setWithdrawalId('');
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
            {step === 'amount' &&
              'Convert USDC to fiat and withdraw to your bank.'}
            {step === 'bank' && 'Enter your bank account details.'}
            {step === 'verify' &&
              'Enter the verification code sent to your email.'}
            {step === 'success' && 'Your withdrawal is being processed.'}
          </DialogDescription>
        </DialogHeader>

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
                  $
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
                  USDC
                </span>
              </div>
            </div>

            {/* Currency */}
            <div className="space-y-2">
              <Label>Receive Currency</Label>
              <div className="grid grid-cols-3 gap-2">
                {['NGN', 'KES', 'GHS'].map((curr) => (
                  <Button
                    key={curr}
                    type="button"
                    variant={currency === curr ? 'default' : 'outline'}
                    onClick={() => setCurrency(curr)}
                    className="font-semibold"
                  >
                    {curr}
                  </Button>
                ))}
              </div>
            </div>

            <Button
              onClick={() => setStep('bank')}
              disabled={!amount || parseFloat(amount) <= 0}
              className="w-full h-12 font-bold"
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
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">Select a bank...</option>
                  {institutions.map((inst) => (
                    <option key={inst.code} value={inst.code}>
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

            {/* Account Name (optional) */}
            <div className="space-y-2">
              <Label htmlFor="accountName">Account Name (optional)</Label>
              <Input
                id="accountName"
                type="text"
                placeholder="John Doe"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
              />
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
                disabled={loading || !institutionCode || !accountNumber}
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

        {step === 'verify' && (
          <div className="space-y-4 mt-4">
            <div className="bg-blue-50 text-blue-700 p-4 rounded-lg text-sm">
              <p className="font-semibold mb-1">Security Verification</p>
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
              className="w-full h-12 font-bold bg-linear-to-r from-blue-600 to-violet-600"
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
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Banknote className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Processing! 🎉</h3>
            <p className="text-muted-foreground mb-4">
              Your withdrawal of ${amount} USDC to{' '}
              {selectedInstitution?.name || 'your bank'} is being processed.
              You&apos;ll receive an email confirmation when complete.
            </p>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

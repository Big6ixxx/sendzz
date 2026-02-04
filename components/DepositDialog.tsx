'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { convertNgnToUsd } from '@/lib/currency';
import {
  ArrowUpCircle,
  Banknote,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface DepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DepositDialog({ open, onOpenChange }: DepositDialogProps) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'NGN'>('USD');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    setLoading(true);

    try {
      // Convert to USD if using NGN
      const amountNum = parseFloat(amount);
      const finalAmount =
        currency === 'NGN' ? convertNgnToUsd(amountNum) : amountNum;

      const res = await fetch('/api/deposits/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: finalAmount.toString(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to deposit');
      }

      toast.success(
        `Successfully deposited ${currency === 'NGN' ? `₦${amount}` : `$${amount}`}!`,
      );
      onOpenChange(false);
      setAmount('');
      router.refresh(); // Refresh to show new balance
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Something went wrong',
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleCurrency = () => {
    setCurrency((prev) => (prev === 'USD' ? 'NGN' : 'USD'));
    setAmount(''); // Reset amount on change to avoid confusion
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="w-5 h-5 text-blue-600" />
            Deposit Funds
          </DialogTitle>
          <DialogDescription>
            Add funds to your Sendzz balance instantly.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleDeposit} className="space-y-6 py-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount ({currency})</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                onClick={toggleCurrency}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Switch to {currency === 'USD' ? 'NGN' : 'USD'}
              </Button>
            </div>
            <div className="relative">
              <Banknote className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                className="pl-10 text-lg font-medium"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={loading}
                autoFocus
              />
              <div className="absolute right-3 top-3 text-sm font-medium text-muted-foreground">
                {currency}
              </div>
            </div>
            {amount && (
              <p className="text-xs text-muted-foreground">
                ≈{' '}
                {currency === 'NGN'
                  ? `$${(parseFloat(amount) / 1500).toFixed(2)} USD`
                  : `₦${(parseFloat(amount) * 1500).toLocaleString()} NGN`}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Simulation Mode: Funds will be added immediately.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 font-bold h-11"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Deposit{' '}
                  {amount ? `${currency === 'NGN' ? '₦' : '$'}${amount}` : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
import {
  ArrowUpCircle,
  Banknote,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface DepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
}

type DepositMethod = 'fiat' | 'usdc';

// Same chains as ReceiveDialog — all route to the same Solana address via Circle CCTP
const CCTP_CHAINS = [
  {
    id: 'solana',
    name: 'Solana',
    icon: '◎',
    description: 'Native — fastest',
    native: true,
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    icon: 'Ξ',
    description: 'Via Circle CCTP',
    native: false,
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    icon: '🔷',
    description: 'Via Circle CCTP',
    native: false,
  },
  {
    id: 'base',
    name: 'Base',
    icon: '🔵',
    description: 'Via Circle CCTP',
    native: false,
  },
  {
    id: 'polygon',
    name: 'Polygon',
    icon: '🟣',
    description: 'Via Circle CCTP',
    native: false,
  },
] as const;

export function DepositDialog({
  open,
  onOpenChange,
  userId,
}: DepositDialogProps) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'NGN'>('USD');
  const [loading, setLoading] = useState(false);
  const [depositMethod, setDepositMethod] = useState<DepositMethod>('fiat');
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState('solana');
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(1500);
  const router = useRouter();

  // Fetch exchange rate when dialog opens
  useEffect(() => {
    if (open) {
      const fetchRate = async () => {
        try {
          const res = await fetch('/api/paycrest/rates/USDC/NGN');
          const data = await res.json();
          if (data.success && data.data?.marketRate) {
            setExchangeRate(data.data.marketRate);
          }
        } catch {
          console.warn('Failed to fetch exchange rate');
        }
      };
      fetchRate();
    }
  }, [open]);

  // Fetch user's Solana address for USDC deposits (Circle CCTP model — one address for all chains)
  useEffect(() => {
    if (open && userId && depositMethod === 'usdc') {
      const fetchAddress = async () => {
        setLoadingAddress(true);
        try {
          const res = await fetch('/api/user/wallet');
          const data = await res.json();
          if (data.success && data.solanaAddress) {
            setSolanaAddress(data.solanaAddress);
          }
        } catch {
          console.error('Failed to fetch wallet address');
        }
        setLoadingAddress(false);
      };
      fetchAddress();
    }
  }, [open, userId, depositMethod]);

  const handleFiatDeposit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    setLoading(true);

    try {
      const amountNum = parseFloat(amount);
      const finalAmount =
        currency === 'NGN' ? amountNum / exchangeRate : amountNum;

      const res = await fetch('/api/deposits/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: finalAmount.toString(),
          method: 'fiat',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to deposit');
      }

      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
        return;
      }

      toast.success(
        'Deposit initiated! You will receive payment instructions.',
      );
      onOpenChange(false);
      setAmount('');
      router.refresh();
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
    setAmount('');
  };

  const handleCopyAddress = () => {
    if (solanaAddress) {
      navigator.clipboard.writeText(solanaAddress);
      toast.success('Address copied to clipboard!');
    }
  };

  const selectedChainInfo = CCTP_CHAINS.find((c) => c.id === selectedChain);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="w-5 h-5 text-primary" />
            Deposit Funds
          </DialogTitle>
          <DialogDescription>
            Add funds to your Sendzz balance.
          </DialogDescription>
        </DialogHeader>

        {/* Method Selection */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setDepositMethod('fiat')}
            className={`group p-3.5 rounded-xl border text-left transition-all ${
              depositMethod === 'fiat'
                ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
                : 'border-white/10 bg-white/4 hover:border-primary/40 hover:bg-primary/6'
            }`}
          >
            <div className="flex items-center gap-2">
              <Banknote
                className={`w-5 h-5 ${depositMethod === 'fiat' ? 'text-primary' : 'text-foreground/70'}`}
              />
              <div>
                <p className="font-medium text-sm text-foreground">
                  Bank Transfer
                </p>
                <p className="text-xs text-muted-foreground">NGN, USD</p>
              </div>
            </div>
          </button>
          <button
            onClick={() => setDepositMethod('usdc')}
            className={`p-3.5 rounded-xl border text-left transition-all ${
              depositMethod === 'usdc'
                ? 'border-accent/60 bg-accent/10 ring-1 ring-accent/40'
                : 'border-white/10 bg-white/4 hover:border-accent/40 hover:bg-accent/6'
            }`}
          >
            <div className="flex items-center gap-2">
              <Wallet
                className={`w-5 h-5 ${depositMethod === 'usdc' ? 'text-accent' : 'text-foreground/70'}`}
              />
              <div>
                <p className="font-medium text-sm text-foreground">
                  USDC Transfer
                </p>
                <p className="text-xs text-muted-foreground">Any chain</p>
              </div>
            </div>
          </button>
        </div>

        {depositMethod === 'fiat' ? (
          <form onSubmit={handleFiatDeposit} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">Amount ({currency})</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-primary hover:text-primary hover:bg-primary/10"
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
                <div className="absolute right-8 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  {currency}
                </div>
              </div>
              {amount && (
                <p className="text-xs text-muted-foreground">
                  ≈{' '}
                  {currency === 'NGN'
                    ? `$${(parseFloat(amount) / exchangeRate).toFixed(2)} USD`
                    : `₦${(parseFloat(amount) * exchangeRate).toLocaleString()} NGN`}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="submit"
                className="w-full btn-shimmer text-white border-0 font-bold h-11"
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
        ) : (
          /* ── USDC Tab — Circle CCTP model, identical to ReceiveDialog ── */
          <div className="space-y-4">
            {/* Chain selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Select Network</Label>
              <div className="grid grid-cols-2 gap-2">
                {CCTP_CHAINS.map((chain) => (
                  <button
                    key={chain.id}
                    onClick={() => setSelectedChain(chain.id)}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      selectedChain === chain.id
                        ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/40'
                        : 'border-white/10 bg-white/4 hover:border-white/20 hover:bg-white/8'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{chain.icon}</span>
                      <div>
                        <p className="font-medium text-sm text-foreground">
                          {chain.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {chain.description}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Address — same Solana address for every chain */}
            <div className="space-y-3">
              <Label>Deposit Address</Label>
              {loadingAddress ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : solanaAddress ? (
                <>
                  <div className="flex justify-center">
                    <div className="p-3 bg-white rounded-2xl shadow-lg">
                      <QRCodeSVG
                        value={solanaAddress}
                        size={130}
                        level="M"
                        bgColor="#ffffff"
                        fgColor="#4f46e5"
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg border border-white/10 bg-white/4">
                    <p className="font-mono text-xs break-all text-center text-foreground/80">
                      {solanaAddress}
                    </p>
                  </div>

                  {selectedChainInfo && !selectedChainInfo.native && (
                    <div className="p-3 bg-primary/8 rounded-xl border border-primary/20">
                      <p className="text-xs text-foreground/80">
                        <strong className="text-foreground">
                          Cross-chain deposit:
                        </strong>{' '}
                        Send USDC on {selectedChainInfo.name} to this address.
                        Circle CCTP will automatically bridge it to your Solana
                        wallet.
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handleCopyAddress}
                    className="w-full btn-shimmer text-white border-0 font-bold"
                  >
                    Copy Address
                  </Button>
                </>
              ) : (
                <div className="text-center py-6 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Wallet not set up yet
                  </p>
                  <Button
                    variant="outline"
                    className="border-white/10 bg-white/5 hover:bg-white/10 text-foreground"
                    onClick={() => toast.info('Please try again in a moment')}
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>

            {/* Warning */}
            <div className="p-3 rounded-lg border border-white/10 bg-white/4">
              <div className="flex items-start gap-2">
                <ExternalLink className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground/80">Only send USDC</strong>{' '}
                  to this address. Sending other tokens may result in loss of
                  funds.
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

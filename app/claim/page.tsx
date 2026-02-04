'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { CheckCircle, Gift, Loader2, Sparkles, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

type ClaimStatus =
  | 'loading'
  | 'ready'
  | 'claiming'
  | 'success'
  | 'error'
  | 'expired'
  | 'login_required';

interface TransferInfo {
  amount: string;
  senderEmail: string;
  note?: string;
}

export default function ClaimPage() {
  const [status, setStatus] = useState<ClaimStatus>('loading');
  const [error, setError] = useState('');
  const [transferInfo, setTransferInfo] = useState<TransferInfo | null>(null);
  const [mounted, setMounted] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const supabase = getSupabaseBrowserClient();

  const checkAuthAndToken = useCallback(async () => {
    if (!token) {
      setStatus('error');
      setError('No claim token provided');
      return;
    }

    // Check if user is logged in
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setStatus('login_required');
      return;
    }

    // For now, we'll show the claim button
    // In a real scenario, you might want to verify the token first
    setStatus('ready');
    // TODO: Could add an API endpoint to preview transfer info before claiming
  }, [token, supabase]);

  useEffect(() => {
    const init = () => {
      setMounted(true);
      checkAuthAndToken();
    };
    init();
  }, [checkAuthAndToken]);

  const handleClaim = async () => {
    if (!token) return;

    setStatus('claiming');

    try {
      const response = await fetch('/api/transfer/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          setStatus('expired');
          setError('This transfer link has expired or already been claimed.');
        } else {
          setStatus('error');
          setError(data.error || 'Failed to claim transfer');
        }
        return;
      }

      setTransferInfo({
        amount: data.amount,
        senderEmail: data.senderEmail || 'Someone',
        note: data.note,
      });
      setStatus('success');
      toast.success('Funds claimed! 🎉');
    } catch {
      setStatus('error');
      setError('Something went wrong. Please try again.');
    }
  };

  const handleLogin = () => {
    // Redirect to login with return URL
    router.push(
      `/login?redirect=${encodeURIComponent(`/claim?token=${token}`)}`,
    );
  };

  const formatAmount = (amount: string) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(parseFloat(amount));
  };

  if (!mounted) {
    return null;
  }

  return (
    <main className="min-h-screen bg-linear-to-br from-green-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* BRANDING */}
        <div className="text-center mb-8 animate-slide-in-down">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-linear-to-br from-green-500 to-emerald-600 rounded-2xl shadow-xl shadow-green-200/50 mb-4">
            <Gift className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">
            You&apos;ve Got Money! 💸
          </h1>
          <p className="text-muted-foreground mt-2">
            Someone sent you USDC via Sendzz
          </p>
        </div>

        <Card className="border-2 shadow-xl animate-slide-in-up">
          <CardHeader className="text-center">
            <CardTitle>Claim Your Transfer</CardTitle>
            <CardDescription>
              Click below to add these funds to your Sendzz wallet
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Loading State */}
            {status === 'loading' && (
              <div className="text-center py-8">
                <Loader2 className="w-12 h-12 animate-spin mx-auto text-green-500 mb-4" />
                <p className="text-muted-foreground">Verifying claim...</p>
              </div>
            )}

            {/* Login Required */}
            {status === 'login_required' && (
              <div className="space-y-4">
                <div className="bg-blue-50 text-blue-700 p-4 rounded-lg text-sm text-center">
                  <p className="font-semibold mb-1">Sign in to claim</p>
                  <p>
                    Create an account or sign in with your email to receive your
                    funds.
                  </p>
                </div>
                <Button
                  onClick={handleLogin}
                  className="w-full h-12 font-bold bg-linear-to-r from-blue-600 to-violet-600"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Sign In to Claim
                </Button>
              </div>
            )}

            {/* Ready to Claim */}
            {status === 'ready' && (
              <div className="space-y-4">
                <div className="bg-green-50 p-6 rounded-xl text-center">
                  <p className="text-sm text-green-600 font-medium mb-1">
                    Amount to receive
                  </p>
                  <p className="text-3xl font-black text-green-700">USDC</p>
                </div>
                <Button
                  onClick={handleClaim}
                  className="w-full h-12 font-bold bg-linear-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
                >
                  <Gift className="mr-2 h-4 w-4" />
                  Claim Now
                </Button>
              </div>
            )}

            {/* Claiming */}
            {status === 'claiming' && (
              <div className="text-center py-8">
                <Loader2 className="w-12 h-12 animate-spin mx-auto text-green-500 mb-4" />
                <p className="text-muted-foreground font-medium">
                  Processing claim...
                </p>
              </div>
            )}

            {/* Success */}
            {status === 'success' && transferInfo && (
              <div className="space-y-4">
                <div className="text-center">
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-green-600 mb-2">
                    +{formatAmount(transferInfo.amount)} USDC
                  </h3>
                  <p className="text-muted-foreground">
                    From {transferInfo.senderEmail}
                  </p>
                  {transferInfo.note && (
                    <p className="text-sm text-muted-foreground mt-2 italic">
                      &quot;{transferInfo.note}&quot;
                    </p>
                  )}
                </div>
                <Link href="/dashboard">
                  <Button className="w-full h-12 font-bold">
                    Go to Dashboard
                  </Button>
                </Link>
              </div>
            )}

            {/* Error */}
            {(status === 'error' || status === 'expired') && (
              <div className="space-y-4">
                <div className="text-center">
                  <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                  <p className="text-red-600 font-medium">{error}</p>
                </div>
                <Link href="/dashboard">
                  <Button variant="outline" className="w-full">
                    Go to Dashboard
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center mt-6 text-muted-foreground text-xs">
          Powered by <span className="font-bold">SENDZZ</span>
        </p>
      </div>
    </main>
  );
}

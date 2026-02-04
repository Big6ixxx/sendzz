'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function SendzzLogin() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  const error = searchParams.get('error');

  useEffect(() => {
    const init = () => {
      setMounted(true);
      // Show error message if redirected with error
      if (error === 'auth_callback_error') {
        toast.error('Authentication failed. Please try again.');
      }
    };
    init();
  }, [error]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error('Authentication Error', {
          description: data.error || 'Failed to send code',
        });
        setLoading(false);
        return;
      }

      toast.success('Code Sent!', {
        description: '📧 Check your inbox for a 6-digit verification code.',
        duration: 5000,
      });

      // Redirect to verify page with email
      router.push(
        `/verify?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirect)}`,
      );
    } catch {
      toast.error('Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-linear-to-br from-blue-50 via-white to-violet-50 flex items-center justify-center p-4">
      <div
        className={`w-full max-w-md ${mounted ? 'animate-fade-in' : 'opacity-0'}`}
      >
        {/* BRANDING */}
        <div className="text-center mb-8 animate-slide-in-down">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-linear-to-br from-blue-600 to-violet-600 rounded-2xl shadow-xl shadow-blue-200/50 mb-4 hover:scale-105 transition-transform">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
            SENDZZ
          </h1>
          <p className="text-muted-foreground font-medium mt-2 text-sm uppercase tracking-widest">
            Instant • Borderless • Payments
          </p>
        </div>

        {/* LOGIN CARD */}
        <Card className="border-2 shadow-xl animate-slide-in-up">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
            <CardDescription>
              Enter your email to receive a verification code.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    className="pl-10 h-12"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="email"
                    autoFocus
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading || !email}
                className="w-full h-12 text-base font-bold shadow-lg hover:shadow-xl transition-all bg-linear-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending Code...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Continue with Email
                  </>
                )}
              </Button>
            </form>

            {/* Features */}
            <div className="mt-6 pt-6 border-t space-y-3">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                  <span className="text-green-600">✓</span>
                </div>
                <span>No password to remember</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <span className="text-blue-600">💸</span>
                </div>
                <span>Send USDC to any email instantly</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <span className="text-violet-600">🏦</span>
                </div>
                <span>Withdraw to your bank account</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* FOOTER */}
        <p className="text-center mt-6 text-muted-foreground text-xs font-medium animate-fade-in">
          By continuing, you agree to the Sendzz Terms of Service.
        </p>
      </div>
    </main>
  );
}

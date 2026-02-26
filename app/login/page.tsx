'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, Sparkles } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function SendzzLogin() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [loading, setLoading] = useState(false);
  const mounted = true;
  const router = useRouter();

  const redirect = searchParams.get('redirect') || '/dashboard';
  const error = searchParams.get('error');

  useEffect(() => {
    if (error === 'auth_callback_error') {
      toast.error('Authentication failed. Please try again.');
    }
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

      toast.success('Code sent!', {
        description: '📧 Check your inbox for a 6-digit verification code.',
        duration: 5000,
      });

      router.push(
        `/verify?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirect)}`,
      );
    } catch {
      toast.error('Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  return (
    <main className="relative min-h-screen bg-background flex items-center justify-center p-4 overflow-hidden">
      {/* Aurora background blobs */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="aurora-orb aurora-orb-indigo w-[600px] h-[600px] -top-48 -left-48 opacity-40 animate-aurora-pulse" />
        <div
          className="aurora-orb aurora-orb-cyan w-[500px] h-[500px] -bottom-40 -right-40 opacity-30 animate-aurora-pulse"
          style={{ animationDelay: '3s' }}
        />
        <div
          className="aurora-orb aurora-orb-gold w-[300px] h-[300px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-15 animate-aurora-pulse"
          style={{ animationDelay: '1.5s' }}
        />
      </div>

      <div
        className={`relative w-full max-w-md z-10 ${mounted ? 'animate-fade-in' : 'opacity-0'}`}
      >
        {/* Branding */}
        <div className="text-center mb-8 animate-slide-in-down">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl btn-shimmer shadow-xl mb-5 animate-float">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1
            className="text-5xl font-extrabold tracking-tight text-aurora"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            SENDZZ
          </h1>
          <p className="text-muted-foreground text-sm mt-2 font-medium tracking-widest uppercase">
            Instant · Borderless · Payments
          </p>
        </div>

        {/* Glass card */}
        <div className="glass-card rounded-2xl p-8 glow-border-indigo animate-slide-in-up">
          <div className="mb-6">
            <h2
              className="text-2xl font-bold mb-1"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Welcome back
            </h2>
            <p className="text-muted-foreground text-sm">
              Enter your email to receive a magic code.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-sm font-semibold text-foreground/80"
              >
                Email Address
              </Label>
              <div className="relative focus-glow rounded-lg transition-all">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  className="pl-10 h-12 bg-white/5 border-white/10 text-foreground placeholder:text-muted-foreground/50 focus:border-primary/60"
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
              className="w-full h-12 text-base font-bold btn-shimmer text-white border-0 shadow-lg"
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

          {/* Feature list */}
          <div className="mt-6 pt-6 border-t border-white/8 space-y-3">
            {[
              {
                emoji: '✓',
                color: 'text-accent',
                bg: 'bg-accent/10 border-accent/20',
                label: 'No password to remember',
              },
              {
                emoji: '💸',
                color: 'text-primary',
                bg: 'bg-primary/10 border-primary/20',
                label: 'Send USDC to any email instantly',
              },
              {
                emoji: '🏦',
                color: 'text-[oklch(0.82_0.17_87)]',
                bg: 'bg-[oklch(0.82_0.17_87/0.1)] border-[oklch(0.82_0.17_87/0.2)]',
                label: 'Withdraw to your bank account',
              },
            ].map((item, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 text-sm text-muted-foreground animate-slide-in-left animate-stagger-${i + 1}`}
              >
                <div
                  className={`w-8 h-8 rounded-lg border ${item.bg} flex items-center justify-center shrink-0`}
                >
                  <span className={item.color}>{item.emoji}</span>
                </div>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <p
          className="text-center mt-5 text-muted-foreground text-xs animate-fade-in"
          style={{ animationDelay: '0.5s' }}
        >
          By continuing, you agree to the Sendzz{' '}
          <a
            href="#"
            className="underline hover:text-foreground transition-colors"
          >
            Terms of Service
          </a>
          .
        </p>
      </div>
    </main>
  );
}

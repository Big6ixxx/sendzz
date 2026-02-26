'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

export default function VerifyOTP() {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const redirect = searchParams.get('redirect') || '/dashboard';

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Auto-focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (value && !/^\d$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (value && index === 5 && newCode.every((d) => d)) {
      handleVerify(newCode.join(''));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, 6);
    if (pastedData.length === 6) {
      const newCode = pastedData.split('');
      setCode(newCode);
      handleVerify(pastedData);
    }
  };

  const handleVerify = async (otp: string) => {
    if (!email) {
      toast.error('Email not found. Please go back and try again.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error('Invalid Code', {
          description: data.error || 'Please check the code and try again.',
        });
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
        setLoading(false);
        return;
      }

      toast.success('Welcome to Sendzz! 🎉');
      router.push(redirect);
    } catch {
      toast.error('Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;

    setResending(true);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error('Failed to resend code', { description: data.error });
      } else {
        toast.success('New code sent!', {
          description: 'Check your inbox for a new verification code.',
        });
        setCountdown(60);
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch {
      toast.error('Failed to resend code');
    }
    setResending(false);
  };

  /* ── No-email fallback ── */
  if (!email) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="glass-card rounded-2xl border border-white/8 p-8 w-full max-w-sm text-center animate-fade-in">
          <p className="text-muted-foreground mb-6">
            No email address provided.
          </p>
          <Button
            asChild
            className="btn-shimmer text-white border-0 font-semibold"
          >
            <Link href="/login">Go to Login</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Aurora orbs */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="aurora-orb aurora-orb-indigo w-[600px] h-[600px] -top-60 -left-40 opacity-35 animate-aurora-pulse" />
        <div
          className="aurora-orb aurora-orb-cyan w-[450px] h-[450px] -bottom-40 -right-32 opacity-25 animate-aurora-pulse"
          style={{ animationDelay: '3s' }}
        />
      </div>

      <div className="relative w-full max-w-md">
        {/* Icon + heading */}
        <div className="text-center mb-8 animate-slide-in-down">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 relative"
            style={{
              background:
                'linear-gradient(135deg, oklch(0.50 0.28 290), oklch(0.68 0.22 195))',
              boxShadow: '0 8px 32px oklch(0.62 0.28 290 / 35%)',
            }}
          >
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <h1
            className="text-3xl font-black tracking-tight"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Check Your Email
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-foreground">{email}</span>
          </p>
        </div>

        {/* Glass card */}
        <div
          className="glass-card rounded-2xl p-7 animate-slide-in-up"
          style={{ border: '1px solid oklch(0.62 0.28 290 / 20%)' }}
        >
          <div className="space-y-6">
            {/* OTP inputs */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold">Verification Code</Label>
              <div className="flex gap-2 justify-between" onPaste={handlePaste}>
                {code.map((digit, index) => (
                  <Input
                    key={index}
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    disabled={loading}
                    aria-label={`Digit ${index + 1}`}
                    className={`w-12 h-14 text-center text-2xl font-bold transition-all
                      bg-white/5 border-white/10
                      focus:border-primary/60 focus:ring-2 focus:ring-primary/30
                      ${digit ? 'border-primary/40 bg-primary/8 text-white' : ''}
                    `}
                  />
                ))}
              </div>
            </div>

            {/* Verify button */}
            <Button
              onClick={() => handleVerify(code.join(''))}
              disabled={loading || code.some((d) => !d)}
              className="w-full h-12 text-base font-bold btn-shimmer text-white border-0 disabled:opacity-50"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Verify &amp; Continue
                </>
              )}
            </Button>

            {/* Resend */}
            <div className="text-center">
              <Button
                variant="ghost"
                onClick={handleResend}
                disabled={countdown > 0 || resending}
                className="text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-40"
              >
                {resending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
              </Button>
            </div>

            {/* Back to login */}
            <div className="text-center pt-1 border-t border-white/8">
              <Button
                asChild
                variant="link"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                <Link href="/login">
                  <ArrowLeft className="mr-2 h-3.5 w-3.5" />
                  Use a different email
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

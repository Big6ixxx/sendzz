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
  const [mounted, setMounted] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';
  const redirect = searchParams.get('redirect') || '/dashboard';

  useEffect(() => {
    const init = () => {
      setMounted(true);
      // Start countdown for resend
      setCountdown(60);
    };
    init();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  // Auto-focus first input
  useEffect(() => {
    if (mounted && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [mounted]);

  const handleChange = (index: number, value: string) => {
    // Only allow digits
    if (value && !/^\d$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // Auto-focus next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits entered
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
      // Call custom verify-otp API (session is created server-side)
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
        // Clear code and focus first input
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
        setLoading(false);
        return;
      }

      // Session was created server-side, just redirect
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

  if (!email) {
    return (
      <main className="min-h-screen bg-linear-to-br from-blue-50 via-white to-violet-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 shadow-xl">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground mb-4">
              No email address provided.
            </p>
            <Link href="/login">
              <Button>Go to Login</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-linear-to-br from-blue-50 via-white to-violet-50 flex items-center justify-center p-4">
      <div
        className={`w-full max-w-md ${mounted ? 'animate-fade-in' : 'opacity-0'}`}
      >
        {/* BRANDING */}
        <div className="text-center mb-8 animate-slide-in-down">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-linear-to-br from-blue-600 to-violet-600 rounded-2xl shadow-xl shadow-blue-200/50 mb-4">
            <KeyRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">
            Check Your Email
          </h1>
          <p className="text-muted-foreground mt-2">
            We sent a code to{' '}
            <span className="font-semibold text-foreground">{email}</span>
          </p>
        </div>

        {/* VERIFY CARD */}
        <Card className="border-2 shadow-xl animate-slide-in-up">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl font-bold">
              Enter Verification Code
            </CardTitle>
            <CardDescription>
              Enter the 6-digit code from your email
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* OTP Input */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">
                  Verification Code
                </Label>
                <div
                  className="flex gap-2 justify-between"
                  onPaste={handlePaste}
                >
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
                      className="w-12 h-14 text-center text-2xl font-bold"
                      aria-label={`Digit ${index + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* Verify Button */}
              <Button
                onClick={() => handleVerify(code.join(''))}
                disabled={loading || code.some((d) => !d)}
                className="w-full h-12 text-base font-bold shadow-lg hover:shadow-xl transition-all bg-linear-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Verify & Continue
                  </>
                )}
              </Button>

              {/* Resend */}
              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={handleResend}
                  disabled={countdown > 0 || resending}
                  className="text-sm"
                >
                  {resending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {countdown > 0
                    ? `Resend code in ${countdown}s`
                    : 'Resend code'}
                </Button>
              </div>

              {/* Back to login */}
              <div className="text-center pt-2 border-t">
                <Link href="/login">
                  <Button
                    variant="link"
                    className="text-sm text-muted-foreground"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Use a different email
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

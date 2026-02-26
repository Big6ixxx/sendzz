'use client';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
    ArrowLeft,
    CheckCircle2,
    Copy,
    LogOut,
    Shield,
    Sparkles,
    User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export default function SettingsPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setEmail(user.email || '');
      setLoading(false);
    };
    checkUser();
  }, [router, supabase.auth]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    toast.success('Logged out successfully');
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(email);
    toast.success('Email copied to clipboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Aurora orbs */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="aurora-orb aurora-orb-indigo w-[500px] h-[500px] -top-40 -left-24 opacity-30 animate-aurora-pulse" />
        <div
          className="aurora-orb aurora-orb-cyan w-[350px] h-[350px] bottom-0 -right-24 opacity-20 animate-aurora-pulse"
          style={{ animationDelay: '3s' }}
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 glass-strong border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-white/5 text-foreground/70"
          >
            <Link href="/dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <h1
            className="text-xl font-bold"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Settings
          </h1>
        </div>
      </header>

      <main className="relative max-w-2xl mx-auto px-4 py-8 space-y-4">
        {/* Account */}
        <section className="glass-card rounded-2xl border border-white/8 overflow-hidden animate-slide-in-up">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
              <User className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p
                className="font-semibold text-sm"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                Account
              </p>
              <p className="text-xs text-muted-foreground">
                Your Sendzz account information
              </p>
            </div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-0.5">
                  Email Address
                </p>
                <p className="font-semibold text-sm truncate">{email}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-white/10 bg-white/5 hover:bg-white/10 text-foreground"
                onClick={copyEmail}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy
              </Button>
            </div>
            <Separator className="bg-white/8" />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-0.5">
                Account ID
              </p>
              <p className="font-mono text-sm text-muted-foreground">
                Linked to your email address
              </p>
            </div>
          </div>
        </section>

        {/* Contacts */}
        <section
          className="glass-card rounded-2xl border border-white/8 overflow-hidden animate-slide-in-up"
          style={{ animationDelay: '0.05s' }}
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center">
              <User className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p
                className="font-semibold text-sm"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                Contacts
              </p>
              <p className="text-xs text-muted-foreground">
                Manage your saved recipients
              </p>
            </div>
          </div>
          <div className="px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-sm">My Contacts</p>
              <p className="text-xs text-muted-foreground">
                View and manage your address book
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="shrink-0 border-white/10 bg-white/5 hover:bg-white/10 text-foreground"
            >
              <Link href="/contacts">Manage</Link>
            </Button>
          </div>
        </section>

        {/* Security */}
        <section
          className="glass-card rounded-2xl border border-white/8 overflow-hidden animate-slide-in-up"
          style={{ animationDelay: '0.10s' }}
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <p
                className="font-semibold text-sm"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                Security
              </p>
              <p className="text-xs text-muted-foreground">
                Manage your account security
              </p>
            </div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-sm">Authentication</p>
                <p className="text-xs text-muted-foreground">
                  Passwordless login via email OTP
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2.5 py-1 rounded-full shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Enabled
              </div>
            </div>
            <Separator className="bg-white/8" />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-sm">Withdrawal Verification</p>
                <p className="text-xs text-muted-foreground">
                  OTP required for all withdrawals
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2.5 py-1 rounded-full shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Enabled
              </div>
            </div>
          </div>
        </section>

        {/* Customization */}
        <section
          className="glass-card rounded-2xl border border-white/8 overflow-hidden animate-slide-in-up"
          style={{ animationDelay: '0.15s' }}
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
            <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p
                className="font-semibold text-sm"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                Customization
              </p>
              <p className="text-xs text-muted-foreground">
                Personalize your Sendzz experience
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex items-center justify-between gap-4 opacity-50">
              <div>
                <p className="font-semibold text-sm">Custom Sendzz Email</p>
                <p className="text-xs text-muted-foreground">
                  Get your own @sendzz.io address
                </p>
              </div>
              <div className="text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0">
                Soon
              </div>
            </div>
          </div>
        </section>

        {/* Sign Out */}
        <section
          className="glass-card rounded-2xl border border-destructive/20 overflow-hidden animate-slide-in-up"
          style={{ animationDelay: '0.20s' }}
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8">
            <div className="w-8 h-8 rounded-lg bg-destructive/15 border border-destructive/25 flex items-center justify-center">
              <LogOut className="w-4 h-4 text-destructive" />
            </div>
            <div>
              <p
                className="font-semibold text-sm text-destructive"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                Session
              </p>
              <p className="text-xs text-muted-foreground">
                Manage your current session
              </p>
            </div>
          </div>
          <div className="px-5 py-4">
            <Button
              variant="outline"
              className="w-full border-destructive/30 bg-destructive/5 hover:bg-destructive/10 text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground pt-2 pb-4">
          <p>Sendzz v1.0.0 · © 2026 Sendzz. All rights reserved.</p>
        </div>
      </main>
    </div>
  );
}

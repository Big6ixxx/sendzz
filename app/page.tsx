import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';
import {
    ArrowRight,
    Banknote,
    DollarSign,
    Globe,
    Mail,
    Shield,
    Sparkles,
    Zap,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <main className="min-h-screen bg-background overflow-hidden">
      {/* ── Aurora Background Orbs ── */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="aurora-orb aurora-orb-indigo w-[700px] h-[700px] -top-60 -left-40 opacity-50"
          style={{ animationDelay: '0s' }}
        />
        <div
          className="aurora-orb aurora-orb-cyan w-[500px] h-[500px] top-40 -right-40 opacity-40"
          style={{ animationDelay: '2s' }}
        />
        <div
          className="aurora-orb aurora-orb-gold w-[400px] h-[400px] bottom-0 left-1/3 opacity-25"
          style={{ animationDelay: '4s' }}
        />
      </div>

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 glass-strong border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl btn-shimmer flex items-center justify-center shadow-lg">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span
              className="text-xl font-extrabold tracking-tight text-aurora"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              SENDZZ
            </span>
          </div>
          <Button
            asChild
            className="btn-shimmer text-white font-bold border-0 shadow-lg"
          >
            <Link href="/login">
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative max-w-6xl mx-auto px-4 py-24 md:py-40">
        <div className="text-center max-w-3xl mx-auto">
          {/* Pill */}
          <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 text-sm font-semibold text-foreground/80 mb-8 animate-fade-in glow-border-cyan">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            Instant · Borderless · Payments
          </div>

          {/* Headline */}
          <h1
            className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05] mb-6 animate-slide-in-up"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Send Money to <span className="text-aurora">Any Email</span>{' '}
            Instantly
          </h1>

          <p
            className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto animate-slide-in-up"
            style={{ animationDelay: '0.1s' }}
          >
            Transfer USDC to anyone using just their email address. No crypto
            wallet needed. Withdraw directly to your bank in seconds.
          </p>

          <div
            className="flex flex-col sm:flex-row gap-4 justify-center animate-slide-in-up"
            style={{ animationDelay: '0.2s' }}
          >
            <Button
              asChild
              size="lg"
              className="btn-shimmer h-14 px-8 text-lg font-bold text-white border-0 shadow-xl"
            >
              <Link href="/login">
                <Mail className="mr-2 h-5 w-5" />
                Start Sending
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-14 px-8 text-lg font-bold glass border-white/10 hover:border-white/20 hover:bg-white/5 text-foreground"
            >
              <Link href="#features">Learn More</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="relative max-w-6xl mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-6">
          {/* Card 1 */}
          <div className="glass-card rounded-2xl p-8 group hover:glow-border-indigo transition-all duration-300 animate-slide-in-up animate-stagger-1">
            <div className="w-12 h-12 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Mail className="w-6 h-6 text-primary" />
            </div>
            <h3
              className="text-xl font-bold mb-3"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Email-Based Transfers
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Send USDC to any email address. Recipients don&apos;t need a
              crypto wallet — they sign in with just their email.
            </p>
          </div>

          {/* Card 2 */}
          <div className="glass-card rounded-2xl p-8 group hover:glow-border-cyan transition-all duration-300 animate-slide-in-up animate-stagger-2">
            <div className="w-12 h-12 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <DollarSign className="w-6 h-6 text-accent" />
            </div>
            <h3
              className="text-xl font-bold mb-3"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Stablecoin Powered
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              All transfers run on USDC — a stablecoin pegged to the US Dollar.
              No volatility, no surprises.
            </p>
          </div>

          {/* Card 3 */}
          <div className="glass-card rounded-2xl p-8 group hover:glow-border-indigo transition-all duration-300 animate-slide-in-up animate-stagger-3">
            <div className="w-12 h-12 rounded-xl bg-[oklch(0.82_0.17_87/0.2)] border border-[oklch(0.82_0.17_87/0.3)] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Banknote className="w-6 h-6 text-[oklch(0.82_0.17_87)]" />
            </div>
            <h3
              className="text-xl font-bold mb-3"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Withdraw to Bank
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Cash out directly to your bank account in NGN, KES, GHS, and more.
              Fast, secure, borderless.
            </p>
          </div>
        </div>
      </section>

      {/* ── Trust / CTA Band ── */}
      <section className="relative max-w-6xl mx-auto px-4 py-16">
        <div className="relative glass-card rounded-3xl p-10 md:p-14 overflow-hidden">
          {/* Inner orb */}
          <div className="aurora-orb aurora-orb-indigo w-96 h-96 -top-32 -right-32 opacity-30 pointer-events-none" />

          <div className="relative z-10 flex flex-col items-center text-center gap-6">
            <div className="flex gap-4">
              {[Shield, Globe, Zap].map((Icon, i) => (
                <div
                  key={i}
                  className="w-12 h-12 glass rounded-xl flex items-center justify-center border border-white/10"
                >
                  <Icon className="w-6 h-6 text-foreground/70" />
                </div>
              ))}
            </div>
            <h2
              className="text-3xl md:text-4xl font-bold"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Secure. <span className="text-aurora">Global.</span> Instant.
            </h2>
            <p className="text-muted-foreground max-w-xl">
              Built with enterprise-grade security. Send money across borders in
              seconds, not days. Zero hidden fees.
            </p>
            <Button
              asChild
              size="lg"
              className="btn-shimmer h-12 px-8 text-white font-bold border-0 shadow-xl"
            >
              <Link href="/login">
                Get Started Free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5 mt-8">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm text-muted-foreground font-medium">
              © 2026 Sendzz. All rights reserved.
            </span>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            {['Terms', 'Privacy', 'Support'].map((link) => (
              <a
                key={link}
                href="#"
                className="hover:text-foreground transition-colors"
              >
                {link}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}

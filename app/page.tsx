import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';
import {
  ArrowRight,
  Banknote,
  DollarSign,
  Globe,
  Mail,
  Send,
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
      {/* ── Aurora Background ── */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="aurora-orb aurora-orb-indigo w-[750px] h-[750px] -top-60 -left-48 opacity-45 animate-aurora-pulse"
          style={{ animationDelay: '0s' }}
        />
        <div
          className="aurora-orb aurora-orb-cyan w-[550px] h-[550px] top-32 -right-48 opacity-35 animate-aurora-pulse"
          style={{ animationDelay: '2.5s' }}
        />
        <div
          className="aurora-orb aurora-orb-gold w-[400px] h-[400px] bottom-0 left-1/3 opacity-20 animate-aurora-pulse"
          style={{ animationDelay: '5s' }}
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
      <section className="relative max-w-6xl mx-auto px-4 pt-28 pb-16 md:pt-40 md:pb-20">
        <div className="text-center max-w-3xl mx-auto">
          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-2 text-sm font-semibold text-foreground/80 mb-8 animate-fade-in border border-white/10">
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
              className="h-14 px-8 text-lg font-bold glass border-white/10 hover:border-white/20 hover:bg-white/5 hover:text-white text-foreground"
            >
              <Link href="#features">See How It Works</Link>
            </Button>
          </div>
        </div>

        {/* ── Hero product preview card ── */}
        <div
          className="mt-16 max-w-sm mx-auto animate-slide-in-up"
          style={{ animationDelay: '0.35s' }}
        >
          <div className="glass-card rounded-2xl border border-white/8 p-5 shadow-2xl">
            {/* Mini balance card */}
            <div
              className="rounded-xl p-4 mb-4 relative overflow-hidden"
              style={{
                background:
                  'linear-gradient(135deg, oklch(0.25 0.08 270), oklch(0.20 0.06 220))',
                border: '1px solid rgba(255,255,255,0.12)',
              }}
            >
              <p className="text-white/50 text-xs mb-0.5">Available Balance</p>
              <p
                className="text-white text-2xl font-extrabold"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                $1,250.00
              </p>
              <p className="text-white/40 text-xs mt-0.5">≈ ₦1,875,000</p>
              <button
                className="mt-3 w-full h-9 rounded-lg text-white text-sm font-semibold flex items-center justify-center gap-2"
                style={{
                  background:
                    'linear-gradient(115deg, oklch(0.50 0.28 290), oklch(0.68 0.22 195))',
                }}
                tabIndex={-1}
              >
                <Send className="w-3.5 h-3.5" />
                Send USDC
              </button>
            </div>

            {/* Mini transaction list */}
            <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">
              Recent
            </p>
            {[
              {
                name: 'sarah@gmail.com',
                amount: '+$50.00',
                sign: 'in',
                delay: '0',
              },
              {
                name: 'alex@outlook.com',
                amount: '-$25.00',
                sign: 'out',
                delay: '1',
              },
              {
                name: 'mike@yahoo.com',
                amount: '+$120.00',
                sign: 'in',
                delay: '2',
              },
            ].map((tx) => (
              <div
                key={tx.name}
                className="flex items-center justify-between py-2 border-b border-white/6 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${tx.sign === 'in' ? 'bg-emerald-400/15 text-emerald-400' : 'bg-primary/15 text-primary'}`}
                  >
                    {tx.name[0].toUpperCase()}
                  </div>
                  <p className="text-xs text-foreground/70 font-medium">
                    {tx.name}
                  </p>
                </div>
                <p
                  className={`text-xs font-bold ${tx.sign === 'in' ? 'text-emerald-400' : 'text-foreground/60'}`}
                >
                  {tx.amount}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats row ── */}
      <section className="relative max-w-6xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto">
          {[
            { value: '<2s', label: 'Transfer time' },
            { value: '0%', label: 'Hidden fees' },
            { value: '5+', label: 'Supported currencies' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="glass-card rounded-xl border border-white/8 py-4 px-3 text-center"
            >
              <p
                className="text-xl font-extrabold text-aurora mb-0.5"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                {stat.value}
              </p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="relative max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-3">
            Features
          </p>
          <h2
            className="text-3xl md:text-4xl font-bold"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            Everything you need to{' '}
            <span className="text-aurora">move money</span>
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {/* Card 1 */}
          <div className="glass-card rounded-2xl p-7 border border-white/8 group hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 animate-slide-in-up animate-stagger-1">
            <div className="w-11 h-11 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <h3
              className="text-lg font-bold mb-2"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Email-Based Transfers
            </h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Send USDC to any email address. Recipients don&apos;t need a
              crypto wallet — they sign in with just their email.
            </p>
          </div>

          {/* Card 2 */}
          <div className="glass-card rounded-2xl p-7 border border-white/8 group hover:border-accent/40 hover:bg-accent/5 transition-all duration-300 animate-slide-in-up animate-stagger-2">
            <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
              <DollarSign className="w-5 h-5 text-accent" />
            </div>
            <h3
              className="text-lg font-bold mb-2"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Stablecoin Powered
            </h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              All transfers run on USDC — a stablecoin pegged to the US Dollar.
              No volatility, no surprises.
            </p>
          </div>

          {/* Card 3 */}
          <div className="glass-card rounded-2xl p-7 border border-white/8 group hover:border-amber-400/40 hover:bg-amber-400/5 transition-all duration-300 animate-slide-in-up animate-stagger-3">
            <div className="w-11 h-11 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-200">
              <Banknote className="w-5 h-5 text-amber-400" />
            </div>
            <h3
              className="text-lg font-bold mb-2"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Withdraw to Bank
            </h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Cash out directly to your bank account in NGN, KES, GHS, and more.
              Fast, secure, borderless.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA Band ── */}
      <section className="relative max-w-6xl mx-auto px-4 py-16">
        <div className="relative glass-card rounded-3xl p-10 md:p-16 overflow-hidden border border-white/8">
          {/* Inner orbs */}
          <div className="aurora-orb aurora-orb-indigo w-96 h-96 -top-32 -right-32 opacity-25 pointer-events-none animate-aurora-pulse" />
          <div
            className="aurora-orb aurora-orb-cyan w-64 h-64 -bottom-20 -left-20 opacity-20 pointer-events-none animate-aurora-pulse"
            style={{ animationDelay: '3s' }}
          />

          <div className="relative z-10 flex flex-col items-center text-center gap-6">
            <div className="flex gap-3">
              {[
                {
                  Icon: Shield,
                  color: 'text-primary',
                  bg: 'bg-primary/10 border-primary/20',
                },
                {
                  Icon: Globe,
                  color: 'text-accent',
                  bg: 'bg-accent/10 border-accent/20',
                },
                {
                  Icon: Zap,
                  color: 'text-amber-400',
                  bg: 'bg-amber-400/10 border-amber-400/20',
                },
              ].map(({ Icon, color, bg }, i) => (
                <div
                  key={i}
                  className={`w-12 h-12 glass rounded-xl flex items-center justify-center border ${bg}`}
                >
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
              ))}
            </div>

            <h2
              className="text-3xl md:text-5xl font-bold"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Secure. <span className="text-aurora">Global.</span> Instant.
            </h2>
            <p className="text-muted-foreground max-w-xl text-sm md:text-base">
              Built with enterprise-grade security. Send money across borders in
              seconds, not days. Zero hidden fees.
            </p>
            <Button
              asChild
              size="lg"
              className="btn-shimmer h-13 px-10 text-lg text-white font-bold border-0 shadow-xl"
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
      <footer className="border-t border-white/5 mt-4">
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

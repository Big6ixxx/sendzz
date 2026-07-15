'use client';

import { usePrivy } from '@privy-io/react-auth';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Globe,
  Landmark,
  Send,
  Shield,
  Zap,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';

/* ─── Mock UI Card Components ─── */

function WalletCard() {
  return (
    <div className="w-full h-full flex flex-col gap-5 p-6">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-40 mb-1">
            Available Balance
          </p>
          <p className="font-display text-4xl font-bold tracking-tight">
            $12,450<span className="opacity-30">.00</span>
          </p>
        </div>
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(0, 232, 122, 0.15)', color: '#00e87a' }}
        >
          <Zap className="w-5 h-5" />
        </div>
      </div>

      <div className="h-px bg-current opacity-5" />

      <div className="space-y-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] opacity-30">
          Recent Activity
        </p>
        {[
          {
            label: 'Received',
            sub: 'alex@earth.io',
            amount: '+$500.00',
            color: '#00e87a',
          },
          {
            label: 'Sent',
            sub: 'maya@sendzz.io',
            amount: '−$1,200.00',
            color: 'currentColor',
          },
          {
            label: 'Deposit',
            sub: 'GTBank • NGN',
            amount: '+$3,000.00',
            color: '#60a5fa',
          },
        ].map((item, i) => (
          <div key={i} className="flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <div
                className="w-7 h-7 rounded-xl flex items-center justify-center border border-current border-opacity-10"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-current opacity-40" />
              </div>
              <div>
                <p className="text-[11px] font-semibold">{item.label}</p>
                <p className="text-[9px] opacity-30">{item.sub}</p>
              </div>
            </div>
            <p
              className="text-[11px] font-bold tabular-nums"
              style={{ color: item.color }}
            >
              {item.amount}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SendCard() {
  return (
    <div className="w-full h-full flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: 'rgba(0, 232, 122, 0.15)', color: '#00e87a' }}
        >
          <Send className="w-4 h-4" />
        </div>
        <div>
          <p className="text-[11px] font-bold">Send Money</p>
          <p className="text-[9px] opacity-30">Instant · Gas-free</p>
        </div>
      </div>
      <div className="h-px bg-current opacity-5" />
      <div className="space-y-3">
        <div
          className="rounded-xl p-3 text-[11px]"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p className="opacity-30 mb-1 text-[9px] uppercase tracking-widest">
            To
          </p>
          <p className="font-medium">chloe@example.com</p>
        </div>
        <div
          className="rounded-xl p-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p className="opacity-30 text-[9px] uppercase tracking-widest mb-1">
            Amount
          </p>
          <p className="font-display text-2xl font-bold">
            $250<span className="opacity-30 text-sm">.00 USD</span>
          </p>
        </div>
      </div>
      <button
        className="w-full rounded-full py-2.5 text-[11px] font-bold flex items-center justify-center gap-1.5 mt-auto"
        style={{ background: '#00e87a', color: '#0a0a0b' }}
      >
        Send Instantly <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function BatchCard() {
  return (
    <div className="w-full h-full flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold">Batch Payroll</p>
          <p className="text-[9px] opacity-30">16 recipients</p>
        </div>
        <span
          className="text-[9px] font-bold px-2 py-1 rounded-full"
          style={{ background: 'rgba(0, 232, 122, 0.15)', color: '#00e87a' }}
        >
          Live
        </span>
      </div>
      <div className="h-px bg-current opacity-5" />
      <div className="space-y-2">
        {[
          { name: 'team@design.co', sent: true },
          { name: 'dev@agency.io', sent: true },
          { name: 'ops@remote.org', sent: false },
          { name: 'hr@company.com', sent: false },
        ].map((r, i) => (
          <div key={i} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-full text-[8px] font-bold flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.08)' }}
              >
                {r.name[0].toUpperCase()}
              </div>
              <p className="text-[10px] opacity-60">{r.name}</p>
            </div>
            <div className="flex items-center gap-1">
              {r.sent ? (
                <CheckCircle2
                  className="w-3.5 h-3.5"
                  style={{ color: '#00e87a' }}
                />
              ) : (
                <div className="w-3.5 h-3.5 rounded-full border border-current opacity-20" />
              )}
              <span className="text-[9px] opacity-40">$125</span>
            </div>
          </div>
        ))}
      </div>
      <div
        className="rounded-xl p-2.5 mt-auto"
        style={{
          background: 'rgba(0, 232, 122, 0.08)',
          border: '1px solid rgba(0, 232, 122, 0.15)',
        }}
      >
        <p className="text-[9px] font-bold" style={{ color: '#00e87a' }}>
          2/4 Confirmed · $250 dispatched
        </p>
      </div>
    </div>
  );
}

/* ─── Hero Card Triptych ─── */
function CardTriptych() {
  return (
    <div
      className="relative w-full flex justify-center items-end"
      style={{ height: '420px' }}
    >
      {/* Left card */}
      <div
        className="absolute animate-float-left"
        style={{
          width: '280px',
          height: '340px',
          left: 'calc(50% - 290px)',
          zIndex: 1,
          transformOrigin: 'bottom center',
          transform: 'rotate(-8deg) scale(0.92)',
        }}
      >
        <div
          className="w-full h-full rounded-3xl overflow-hidden text-brand-secondary"
          style={{
            background: 'rgba(20, 20, 26, 0.7)',
            backdropFilter: 'blur(32px) saturate(200%)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow:
              '0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
          }}
        >
          <BatchCard />
        </div>
      </div>

      {/* Center card */}
      <div
        className="absolute animate-float-center"
        style={{
          width: '300px',
          height: '380px',
          zIndex: 3,
          transform: 'scale(1)',
          left: 'calc(50% - 150px)',
          boxShadow:
            '0 40px 100px rgba(0,0,0,0.6), 0 0 80px rgba(0,232,122,0.08)',
        }}
      >
        <div
          className="w-full h-full rounded-3xl overflow-hidden text-brand-secondary animate-glow"
          style={{
            background: 'rgba(16, 16, 20, 0.75)',
            backdropFilter: 'blur(40px) saturate(220%)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow:
              '0 40px 100px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)',
          }}
        >
          <WalletCard />
        </div>
        {/* Accent glow beneath center card */}
        <div
          className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-48 h-16 rounded-full blur-2xl opacity-30"
          style={{ background: '#00e87a' }}
        />
      </div>

      {/* Right card */}
      <div
        className="absolute animate-float-right"
        style={{
          width: '280px',
          height: '340px',
          right: 'calc(50% - 290px)',
          zIndex: 2,
          transformOrigin: 'bottom center',
          transform: 'rotate(8deg) scale(0.92)',
        }}
      >
        <div
          className="w-full h-full rounded-3xl overflow-hidden text-brand-secondary"
          style={{
            background: 'rgba(20, 20, 26, 0.65)',
            backdropFilter: 'blur(32px) saturate(200%)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow:
              '0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
          }}
        >
          <SendCard />
        </div>
      </div>

      {/* Fade-out gradient at bottom to imply scroll */}
      <div
        className="absolute bottom-0 left-0 right-0 h-24 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, transparent, var(--background))',
        }}
      />
    </div>
  );
}

/* ─── Main Landing Page ─── */
export default function Landing() {
  const { authenticated, login } = usePrivy();
  const router = useRouter();
  const heroRef = useRef<HTMLDivElement>(null);

  const handleAction = () => {
    if (authenticated) {
      router.push('/dashboard');
    } else {
      login();
    }
  };

  return (
    <div
      className="flex flex-col min-h-screen overflow-x-hidden"
      style={{ background: '#07070a' }}
    >
      {/* Ambient background blobs */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute top-[-20%] left-[10%] w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
          style={{
            background: 'radial-gradient(circle, #00e87a 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute top-[30%] right-[-10%] w-[500px] h-[500px] rounded-full opacity-10 blur-[100px]"
          style={{
            background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute bottom-[10%] left-[30%] w-[400px] h-[400px] rounded-full opacity-10 blur-[100px]"
          style={{
            background: 'radial-gradient(circle, #00e87a 0%, transparent 70%)',
          }}
        />
      </div>

      {/* ─── Navigation ─── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center py-5 px-6 md:px-12"
        style={{
          background: 'rgba(7, 7, 10, 0.6)',
          backdropFilter: 'blur(24px) saturate(180%)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <Link href="/">
          <Image
            src="/logo.svg"
            alt="Sendzz"
            width={100}
            height={30}
            priority
          />
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {[
            { label: 'Features', href: '/features' },
            { label: 'Explore', href: '/explore' },
            { label: 'Security', href: '/security' },
            { label: 'Pricing', href: '/pricing' },
          ].map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-[13px] font-medium transition-colors"
              style={{ color: 'rgba(248,248,246,0.45)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#f8f8f6')}
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = 'rgba(248,248,246,0.45)')
              }
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          onClick={handleAction}
          className="btn-accent h-10 px-6 text-sm rounded-full font-semibold"
          style={{ height: '2.5rem' }}
        >
          {authenticated ? 'Dashboard' : 'Get Started'}
        </button>
      </header>

      {/* ─── Hero ─── */}
      <main className="flex-1">
        <section
          ref={heroRef}
          className="relative pt-40 pb-0 px-6 text-center flex flex-col items-center"
        >
          {/* Status pill */}
          <div
            className="animate-slide-up opacity-0 delay-100 mb-8 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.15em]"
            style={{
              background: 'rgba(0, 232, 122, 0.1)',
              border: '1px solid rgba(0, 232, 122, 0.2)',
              color: '#00e87a',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-beacon"
              style={{ background: '#00e87a' }}
            />
            Now live on Base Mainnet
          </div>

          {/* Main headline */}
          <h1 className="animate-slide-up opacity-0 delay-200 font-display font-bold tracking-tight leading-none text-brand-secondary max-w-4xl">
            <span className="block text-[clamp(3rem,10vw,7.5rem)]">
              The Modern
            </span>
            <span
              className="block text-[clamp(3rem,10vw,7.5rem)]"
              style={{
                background:
                  'linear-gradient(135deg, #00e87a 0%, #00c468 40%, #60a5fa 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Standard For
            </span>
            <span className="block text-[clamp(3rem,10vw,7.5rem)]">
              Global Payments.
            </span>
          </h1>

          {/* Subheadline */}
          <p
            className="animate-slide-up opacity-0 delay-300 mt-8 text-[clamp(1rem,2vw,1.25rem)] font-medium leading-relaxed max-w-2xl"
            style={{ color: 'rgba(248,248,246,0.5)' }}
          >
            Universal access to global capital. Hold stable USDC, deposit local
            currency in seconds, and send to any email address instantly with
            zero gas fees.
          </p>

          {/* CTA row */}
          <div className="animate-slide-up opacity-0 delay-400 mt-10 flex flex-col sm:flex-row gap-4 items-center justify-center">
            <button
              onClick={handleAction}
              className="btn-accent h-14 px-10 text-base font-bold rounded-full flex items-center gap-3 group"
            >
              {authenticated ? 'Enter Dashboard' : 'Start Sending Free'}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
            <button
              className="flex items-center gap-2 text-sm font-medium"
              style={{ color: 'rgba(248,248,246,0.4)' }}
            >
              <Globe className="w-4 h-4" />
              Works in 30+ countries
            </button>
          </div>

          {/* Trust row */}
          <div className="animate-slide-up opacity-0 delay-500 mt-8 flex flex-wrap justify-center gap-6">
            {[
              { icon: Shield, label: 'Self-Custodial' },
              { icon: Zap, label: 'Gas Sponsored' },
              { icon: Landmark, label: 'Fiat On/Off Ramps' },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 text-[11px] font-semibold"
                style={{ color: 'rgba(248,248,246,0.3)' }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </div>
            ))}
          </div>

          {/* Card triptych — peeking below fold */}
          <div className="animate-fade-scale opacity-0 delay-600 w-full max-w-5xl mx-auto mt-20">
            <CardTriptych />
          </div>
        </section>

        {/* ─── Features ─── */}
        <section className="relative px-6 py-32 max-w-6xl mx-auto">
          <div className="text-center mb-20">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.25em] mb-4"
              style={{ color: '#00e87a' }}
            >
              What Sendzz Does
            </p>
            <h2 className="font-display text-[clamp(2rem,5vw,3.5rem)] font-bold text-brand-secondary tracking-tight leading-tight">
              One account.
              <br />
              Infinite reach.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Send,
                title: 'Send by Email',
                body: "Forget wallet addresses. Type an email, pick an amount, and send. Recipients get funds the moment they log in — even if they're new to crypto.",
                accent: false,
              },
              {
                icon: Landmark,
                title: 'Multi-Currency Ramps',
                body: 'Deposit NGN, KES, or GHS directly from your bank. Withdraw to your local bank account within minutes. Paycrest-powered, always competitive rates.',
                accent: true,
              },
              {
                icon: Zap,
                title: 'Zero Gas, Always',
                body: 'Every transaction is gas-sponsored. You never need ETH, MATIC, or any native token. Just USDC — clean, simple, free to move.',
                accent: false,
              },
            ].map(({ icon: Icon, title, body, accent }) => (
              <div
                key={title}
                className="card-glass p-8 relative overflow-hidden group"
                style={
                  accent
                    ? {
                        background: 'rgba(0, 232, 122, 0.06)',
                        border: '1px solid rgba(0, 232, 122, 0.15)',
                      }
                    : {}
                }
              >
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6"
                  style={{
                    background: accent
                      ? 'rgba(0, 232, 122, 0.15)'
                      : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${accent ? 'rgba(0, 232, 122, 0.2)' : 'rgba(255,255,255,0.08)'}`,
                    color: accent ? '#00e87a' : 'rgba(248,248,246,0.6)',
                  }}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="font-display text-xl font-bold mb-3 text-brand-secondary">
                  {title}
                </h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: 'rgba(248,248,246,0.45)' }}
                >
                  {body}
                </p>
                {accent && (
                  <div
                    className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20 pointer-events-none"
                    style={{ background: '#00e87a' }}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ─── Trust / Proof ─── */}
        <section className="px-6 py-24 text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-display text-[clamp(2rem,5vw,3rem)] font-bold text-brand-secondary tracking-tight mb-4">
              Built on industrial-grade rails.
            </h2>
            <p
              className="text-sm mb-12"
              style={{ color: 'rgba(248,248,246,0.4)' }}
            >
              Your money lives on Base — an Ethereum L2. You control the keys.
              We just make it easy.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { stat: '$0', label: 'Gas Fees Ever' },
                { stat: '< 2s', label: 'Settlement Time' },
                { stat: '30+', label: 'Countries Supported' },
                { stat: 'USDC', label: 'Stable Asset Only' },
                { stat: 'Open', label: 'Source Smart Contracts' },
                { stat: '24/7', label: 'Always Available' },
              ].map(({ stat, label }) => (
                <div key={label} className="card-glass p-6 text-center">
                  <p
                    className="font-display text-3xl font-bold mb-1"
                    style={{ color: '#00e87a' }}
                  >
                    {stat}
                  </p>
                  <p
                    className="text-[11px] font-semibold uppercase tracking-widest"
                    style={{ color: 'rgba(248,248,246,0.35)' }}
                  >
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Final CTA ─── */}
        <section className="px-6 py-32 text-center relative">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="w-[600px] h-[600px] rounded-full blur-[120px] opacity-15"
              style={{
                background: 'radial-gradient(circle, #00e87a, transparent 70%)',
              }}
            />
          </div>

          <div className="relative max-w-2xl mx-auto space-y-8">
            <h2 className="font-display text-[clamp(2.5rem,7vw,5rem)] font-bold text-brand-secondary tracking-tight leading-none">
              Your money,
              <br />
              <span
                style={{
                  background: 'linear-gradient(135deg, #00e87a, #60a5fa)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                unchained.
              </span>
            </h2>
            <p
              className="text-base"
              style={{ color: 'rgba(248,248,246,0.45)' }}
            >
              Join thousands who have moved beyond borders, banks, and barriers.
            </p>
            <button
              onClick={handleAction}
              className="btn-accent h-14 px-12 text-base font-bold rounded-full inline-flex items-center gap-3 group"
            >
              {authenticated ? 'Go to Dashboard' : 'Create Your Wallet'}
              <ArrowUpRight className="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </button>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer
        className="px-6 md:px-12 py-10"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo.svg"
              alt="Sendzz"
              width={50}
              height={15}
              priority
            />
            <span
              className="text-[11px] ml-2"
              style={{ color: 'rgba(248,248,246,0.2)' }}
            >
              © {new Date().getFullYear()} Global Operations Group
            </span>
          </div>

          <div className="flex items-center gap-8">
            {[
              { label: 'Documentation', href: '/documentation' },
              { label: 'Explore', href: '/explore' },
              { label: 'Security', href: '/security' },
              { label: 'Privacy', href: '/privacy' },
            ].map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-[11px] font-medium transition-colors"
                style={{ color: 'rgba(248,248,246,0.3)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#f8f8f6')}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = 'rgba(248,248,246,0.3)')
                }
              >
                {l.label}
              </Link>
            ))}
            <div
              className="flex items-center gap-2 text-[11px]"
              style={{ color: 'rgba(248,248,246,0.3)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-beacon"
                style={{ background: '#00e87a' }}
              />
              Network Live
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

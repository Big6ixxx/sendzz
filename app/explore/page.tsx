import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Suspense } from 'react';
import { ExploreClient } from './ExploreClient';

export const metadata: Metadata = {
  title: 'Explore · Live Transparency Dashboard',
  description:
    'Browse every transaction on Sendzz in real time — volume, active users, system status, bridges, transfers, deposits and withdrawals. Fully public and privacy-preserving.',
  openGraph: {
    title: 'Sendzz Explorer · Live Transparency Dashboard',
    description:
      'Real-time, anonymized view of all activity on Sendzz — volume, users, and every transaction on-chain.',
  },
};

// Time-sensitive public data — always render fresh.
export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  return (
    <div className="min-h-screen selection:bg-accent/30" style={{ background: '#07070a' }}>
      {/* Background ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div className="absolute top-[-10%] left-[-5%] w-[60%] h-[60%] rounded-full bg-accent opacity-[0.03] blur-[160px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[50%] rounded-full bg-[#3b82f6] opacity-[0.02] blur-[140px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 flex justify-between items-center py-5 px-6 md:px-12 bg-[#07070a]/60 backdrop-blur-xl border-b border-white/5">
        <Link href="/" aria-label="Sendzz home">
          <Image src="/logo.svg" alt="Sendzz" width={100} height={30} priority />
        </Link>
        <Link href="/dashboard" className="btn-accent h-10 px-6 text-sm rounded-full font-semibold">
          Launch App
        </Link>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 md:px-12 pt-14 pb-24">
        {/* Hero */}
        <div className="max-w-3xl space-y-4 mb-12">
          <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight text-white">
            Sendzz <span className="text-accent">Explorer</span>
          </h1>
          <p className="text-base md:text-lg text-white/60 leading-relaxed">
            Track every transfer, bridge, deposit, and withdrawal across the Sendzz network in real time.
            A live, open window into money moving across borders.
          </p>
        </div>

        <Suspense fallback={<div className="h-96 animate-pulse card-glass" />}>
          <ExploreClient />
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-10 px-6 md:px-12">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/40">
            © {new Date().getFullYear()} Sendzz · Money without borders.
          </p>
          <nav aria-label="Footer" className="flex items-center gap-6 text-xs font-medium text-white/50">
            <Link href="/features" className="hover:text-white transition-colors">Features</Link>
            <Link href="/security" className="hover:text-white transition-colors">Security</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/dashboard" className="hover:text-accent transition-colors">Launch App</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

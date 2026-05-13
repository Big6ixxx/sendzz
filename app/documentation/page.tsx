'use client';

import { usePrivy } from '@privy-io/react-auth';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Book,
  Code,
  ExternalLink,
  Search,
  Terminal,
  Zap
} from 'lucide-react';
import Link from 'next/link';

export default function DocumentationPage() {
  const { login } = usePrivy();

  const sections = [
    {
      title: 'Quick Start',
      items: [
        'System Overview',
        'Account Creation',
        'Identity Verification',
        'First Transfer',
      ],
      icon: Zap,
    },
    {
      title: 'SDK & APIs',
      items: [
        'REST API Reference',
        'Webhooks',
        'Client Libraries',
        'Authentication',
      ],
      icon: Terminal,
    },
    {
      title: 'Bridge Specs',
      items: [
        'Circle CCTP Flow',
        'Gasless Relay',
        'Settlement Times',
        'Fee Calculations',
      ],
      icon: Code,
    },
  ];

  return (
    <div
      className="min-h-screen selection:bg-accent/30"
      style={{ background: '#07070a' }}
    >
      {/* Background Ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[0%] left-[50%] -translate-x-1/2 w-[80%] h-[40%] rounded-full bg-accent opacity-[0.02] blur-[160px]" />
      </div>

      <header className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center py-5 px-6 md:px-12 bg-[#07070a]/60 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display font-bold text-lg bg-accent text-[#07070a]">
              S
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-brand-secondary">
              Sendzz
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-8">
            <span className="text-[13px] font-bold text-accent">
              Documentation
            </span>
            <span className="text-[13px] font-medium text-brand-secondary/40">
              API Status
            </span>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <button className="hidden sm:flex items-center gap-2 px-4 h-10 rounded-xl bg-white/5 border border-white/10 text-[13px] text-brand-secondary/40">
            <Search className="w-4 h-4" /> Search docs...
          </button>
          <button
            onClick={login}
            className="btn-accent h-10 px-6 text-sm rounded-full font-semibold"
          >
            Dashboard
          </button>
        </div>
      </header>

      <main className="pt-40 pb-24 px-6 relative z-10">
        <div className="max-w-6xl mx-auto space-y-20">
          {/* Header */}
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40"
            >
              <Book className="w-3.5 h-3.5" /> Dev-Docs v1.0
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="font-display text-5xl md:text-7xl font-bold tracking-tight text-brand-secondary"
            >
              Build with the <br />
              <span className="text-accent">Global Ledger.</span>
            </motion.h1>
          </div>

          {/* Docs Grid */}
          <div className="grid md:grid-cols-3 gap-8">
            {sections.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 + 0.2 }}
                className="card-glass p-10 space-y-8"
              >
                <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 text-accent">
                  <s.icon className="w-6 h-6" />
                </div>
                <div className="space-y-6">
                  <h3 className="text-xl font-bold text-brand-secondary">
                    {s.title}
                  </h3>
                  <div className="space-y-4">
                    {s.items.map((item) => (
                      <button
                        key={item}
                        className="w-full flex items-center justify-between group"
                      >
                        <span className="text-sm font-medium text-brand-secondary/40 group-hover:text-brand-secondary transition-colors">
                          {item}
                        </span>
                        <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all text-accent" />
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Code Example */}
          <div className="card-glass overflow-hidden border-accent/20">
            <div className="flex items-center justify-between px-8 py-4 bg-white/5 border-b border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/20" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
                <div className="w-3 h-3 rounded-full bg-green-500/20" />
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30">
                example_transfer.js
              </p>
            </div>
            <div className="p-10 font-mono text-sm leading-relaxed overflow-x-auto">
              <pre className="text-brand-secondary/80">
                {`// Send USDC instantly via email
const transfer = await sendzz.transfers.create({
  recipientEmail: "alex@earth.io",
  amount: 250.00,
  currency: "USD",
  memo: "Consulting fees",
  gasless: true
});

console.log(\`Settled: \${transfer.txHash}\`);`}
              </pre>
            </div>
          </div>

          {/* Help Footer */}
          <div className="grid md:grid-cols-2 gap-8">
            <div className="card-glass p-10 flex items-center justify-between group">
              <div className="space-y-1">
                <p className="text-lg font-bold text-brand-secondary">
                  Join Discord
                </p>
                <p className="text-sm text-brand-secondary/40">
                  Connect with our engineering community.
                </p>
              </div>
              <ExternalLink className="w-6 h-6 opacity-20 group-hover:opacity-100 group-hover:text-accent transition-all" />
            </div>
            <div className="card-glass p-10 flex items-center justify-between group">
              <div className="space-y-1">
                <p className="text-lg font-bold text-brand-secondary">
                  Support Desk
                </p>
                <p className="text-sm text-brand-secondary/40">
                  Open a ticket for integration issues.
                </p>
              </div>
              <ExternalLink className="w-6 h-6 opacity-20 group-hover:opacity-100 group-hover:text-accent transition-all" />
            </div>
          </div>
        </div>
      </main>

      <footer className="py-12 px-12 border-t border-white/5 text-center">
        <p className="text-[11px] font-bold uppercase tracking-widest opacity-20 text-brand-secondary">
          © 2026 Sendzz Global Operations Group
        </p>
      </footer>
    </div>
  );
}

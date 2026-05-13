'use client';

import { usePrivy } from '@privy-io/react-auth';
import {
  Eye,
  FileText,
  Shield,
  UserCheck
} from 'lucide-react';
import Link from 'next/link';

export default function PrivacyPage() {
  const { login } = usePrivy();

  const principles = [
    {
      title: 'Minimal Data Collection',
      description:
        'We only collect what is strictly necessary to process your transactions and comply with regional laws.',
      icon: Eye,
    },
    {
      title: 'Decentralized Identity',
      description:
        'Your personal info is protected by high-entropy encryption and is never sold to third parties.',
      icon: UserCheck,
    },
    {
      title: 'Zero Monitoring',
      description:
        'We do not track your transaction content or memo history for advertising or profiling.',
      icon: Shield,
    },
  ];

  return (
    <div
      className="min-h-screen selection:bg-accent/30"
      style={{ background: '#07070a' }}
    >
      {/* Background Ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[0%] right-[0%] w-[50%] h-[50%] rounded-full bg-accent opacity-[0.02] blur-[160px]" />
      </div>

      <header className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center py-5 px-6 md:px-12 bg-[#07070a]/60 backdrop-blur-xl border-b border-white/5">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display font-bold text-lg bg-accent text-[#07070a]">
            S
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-brand-secondary">
            Sendzz
          </span>
        </Link>
        <button
          onClick={login}
          className="btn-accent h-10 px-6 text-sm rounded-full font-semibold"
        >
          Get Started
        </button>
      </header>

      <main className="pt-40 pb-24 px-6 relative z-10">
        <div className="max-w-4xl mx-auto space-y-20">
          {/* Header */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40">
              <FileText className="w-3.5 h-3.5" /> Updated: May 2026
            </div>
            <h1 className="font-display text-5xl md:text-7xl font-bold tracking-tight text-brand-secondary">
              Privacy <br />
              is a <span className="text-accent">Right.</span>
            </h1>
            <p className="text-xl text-brand-secondary/50 leading-relaxed max-w-2xl">
              Our privacy policy is designed to be readable, transparent, and
              respectful of your financial sovereignty.
            </p>
          </div>

          {/* Principles */}
          <div className="grid md:grid-cols-3 gap-6">
            {principles.map((p) => (
              <div key={p.title} className="card-glass p-8 space-y-6">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                  <p.icon className="w-5 h-5" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-bold text-brand-secondary">{p.title}</h3>
                  <p className="text-sm text-brand-secondary/40 leading-relaxed">
                    {p.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Detailed Content */}
          <div className="card-glass p-10 lg:p-16 space-y-12">
            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-brand-secondary">
                1. Information We Collect
              </h2>
              <p className="text-sm text-brand-secondary/50 leading-relaxed">
                When you create an account, we collect your email address and
                basic device information to secure your account using MPC
                technology. If you use fiat on-ramps, our partners (like
                Paycrest) may collect KYC information as required by law. Sendzz
                does not store your government-issued IDs on our own servers.
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-bold text-brand-secondary">
                2. How We Use Data
              </h2>
              <p className="text-sm text-brand-secondary/50 leading-relaxed">
                We use your data solely for:
                <ul className="list-disc pl-5 mt-4 space-y-2">
                  <li>Facilitating transactions and verifying settlement.</li>
                  <li>
                    Sending critical security alerts and receipt notifications.
                  </li>
                  <li>Improving platform performance and squashing bugs.</li>
                </ul>
              </p>
            </section>

            <section className="space-y-4 border-t border-white/5 pt-12">
              <h2 className="text-2xl font-bold text-brand-secondary">
                3. Data Retention
              </h2>
              <p className="text-sm text-brand-secondary/50 leading-relaxed">
                Transactional records on the Base blockchain are permanent and
                immutable. However, we purge internal application logs and
                non-critical metadata every 90 days.
              </p>
            </section>
          </div>

          {/* Contact */}
          <div className="card-glass p-10 flex flex-col md:flex-row items-center justify-between gap-8 bg-accent/3 border-accent/20">
            <div className="space-y-2 text-center md:text-left">
              <h3 className="text-xl font-bold text-brand-secondary">
                Have questions about your data?
              </h3>
              <p className="text-sm text-brand-secondary/40">
                Our privacy officer is available to help.
              </p>
            </div>
            <button className="h-12 px-8 rounded-xl bg-accent text-[#07070a] font-bold text-sm hover:brightness-110 transition-all">
              privacy@sendzz.io
            </button>
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

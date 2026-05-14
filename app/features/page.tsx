'use client';

import { usePrivy } from '@privy-io/react-auth';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Coins,
  Cpu,
  Globe,
  Landmark,
  Lock,
  Send,
  Shield,
  Users,
  Zap,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function FeaturesPage() {
  const { authenticated, login } = usePrivy();
  const router = useRouter();

  const handleAction = () => {
    if (authenticated) {
      router.push('/dashboard');
    } else {
      login();
    }
  };

  const features = [
    {
      title: 'Email-First Payments',
      description:
        'Send money to anyone with just an email address. No complex wallet addresses or ENS names required.',
      icon: Send,
      color: '#00e87a',
    },
    {
      title: 'Global Fiat Ramps',
      description:
        'Direct integration with local banks in Nigeria, Kenya, and Ghana. Deposit and withdraw in seconds.',
      icon: Landmark,
      color: '#3b82f6',
    },
    {
      title: 'Gas-Free Infrastructure',
      description:
        'We sponsor all network fees on Base. You only pay for the value you send, never for the gas.',
      icon: Zap,
      color: '#fb923c',
    },
    {
      title: 'Self-Custodial Security',
      description:
        'Your keys, your money. Sendzz uses advanced MPC technology to give you full control without the complexity.',
      icon: Shield,
      color: '#a855f7',
    },
    {
      title: 'Batch Dispositions',
      description:
        'Pay entire teams or distribute rewards to hundreds of recipients in a single click.',
      icon: Users,
      color: '#06b6d4',
    },
    {
      title: 'Stable USDC Settlements',
      description:
        'Protected against volatility. All balances are held in Circle’s USDC, the world’s most trusted stablecoin.',
      icon: Coins,
      color: '#22c55e',
    },
  ];

  return (
    <div
      className="min-h-screen selection:bg-accent/30"
      style={{ background: '#07070a' }}
    >
      {/* Background Ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[60%] h-[60%] rounded-full bg-accent opacity-[0.03] blur-[160px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[50%] rounded-full bg-[#3b82f6] opacity-[0.02] blur-[140px]" />
      </div>

      <header className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center py-5 px-6 md:px-12 bg-[#07070a]/60 backdrop-blur-xl border-b border-white/5">
        <Link href="/">
          <Image
            src="/logo.svg"
            alt="Sendzz"
            width={100}
            height={30}
            priority
          />
        </Link>
        <button
          onClick={handleAction}
          className="btn-accent h-10 px-6 text-sm rounded-full font-semibold"
        >
          {authenticated ? 'Dashboard' : 'Get Started'}
        </button>
      </header>

      <main className="pt-32 pb-24 px-6 relative z-10">
        <div className="max-w-6xl mx-auto space-y-24">
          {/* Hero Section */}
          <div className="text-center space-y-6 max-w-3xl mx-auto">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-display text-5xl md:text-7xl font-bold tracking-tight text-brand-secondary"
            >
              Powering the next era of{' '}
              <span className="text-accent">global capital.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg text-brand-secondary/50 leading-relaxed"
            >
              Sendzz combines institutional-grade infrastructure with a
              consumer-first experience to make cross-border payments as simple
              as email.
            </motion.p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="card-glass p-10 space-y-6 group hover:bg-white/4 transition-all"
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center border transition-transform group-hover:scale-110"
                  style={{
                    background: `${f.color}10`,
                    borderColor: `${f.color}20`,
                    color: f.color,
                  }}
                >
                  <f.icon className="w-7 h-7" />
                </div>
                <div className="space-y-3">
                  <h3 className="text-xl font-bold text-brand-secondary">
                    {f.title}
                  </h3>
                  <p className="text-sm text-brand-secondary/40 leading-relaxed">
                    {f.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Technical Edge */}
          <div className="card-glass p-12 lg:p-20 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-accent opacity-[0.03] blur-3xl rounded-full" />
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div className="space-y-8">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold uppercase tracking-widest">
                  <Cpu className="w-3.5 h-3.5" /> Technical Stack
                </div>
                <h2 className="font-display text-4xl font-bold text-brand-secondary leading-tight">
                  Programmable money <br />
                  meets human design.
                </h2>
                <div className="space-y-6">
                  {[
                    'ERC-4337 Smart Account Abstraction',
                    'Circle Iris API Bridge Integration',
                    'Biometric Passkey Authentication',
                    'Deterministic Multi-Chain Address Generation',
                  ].map((t) => (
                    <div
                      key={t}
                      className="flex items-center gap-3 text-sm font-medium text-brand-secondary/60"
                    >
                      <CheckCircle2 className="w-5 h-5 text-accent" /> {t}
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="aspect-square card-glass bg-white/2 flex flex-col items-center justify-center gap-4 text-center p-6">
                  <Lock className="w-8 h-8 text-accent" />
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 text-brand-secondary">
                    Security First
                  </p>
                </div>
                <div className="aspect-square card-glass bg-white/2 flex flex-col items-center justify-center gap-4 text-center p-6 mt-8">
                  <Globe className="w-8 h-8 text-blue-400" />
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 text-brand-secondary">
                    Borderless
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="text-center py-12">
            <button
              onClick={handleAction}
              className="btn-accent h-16 px-12 text-lg rounded-full font-bold shadow-[0_20px_40px_rgba(0,232,122,0.15)]"
            >
              {authenticated ? 'Enter Dashboard' : 'Start Using Sendzz'}
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

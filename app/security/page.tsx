'use client';

import { usePrivy } from '@privy-io/react-auth';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  EyeOff,
  Fingerprint,
  Key,
  Lock,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SecurityPage() {
  const { authenticated, login } = usePrivy();
  const router = useRouter();

  const handleAction = () => {
    if (authenticated) {
      router.push('/dashboard');
    } else {
      login();
    }
  };

  const securityFeatures = [
    {
      title: 'MPC-CMP Technology',
      description:
        'Threshold Signature Schemes ensure your private keys are never stored in a single location, eliminating single points of failure.',
      icon: Key,
    },
    {
      title: 'Non-Custodial Design',
      description:
        "Sendzz uses Privy's MPC technology to ensure your funds are truly yours. Your private key is never stored in one place; instead, it's split into multiple shares. This means Sendzz never has access to your assets, giving you full ownership with institutional-grade security.",
      icon: ShieldCheck,
    },
    {
      title: 'Biometric Passkeys',
      description:
        'Replace insecure passwords with device-native biometrics like FaceID or TouchID for seamless, ultra-secure authentication.',
      icon: Fingerprint,
    },
    {
      title: 'On-Chain Transparency',
      description:
        'Every transaction is verifiable on the Base ledger. Full audit trails are available for every dollar moved.',
      icon: EyeOff,
    },
  ];

  return (
    <div
      className="min-h-screen selection:bg-accent/30"
      style={{ background: '#07070a' }}
    >
      {/* Background Ambience */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[60%] h-[60%] rounded-full bg-accent opacity-[0.03] blur-[160px]" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[50%] h-[50%] rounded-full bg-red-500 opacity-[0.02] blur-[140px]" />
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

      <main className="pt-40 pb-24 px-6 relative z-10">
        <div className="max-w-5xl mx-auto space-y-32">
          {/* Hero Section */}
          <div className="space-y-8 max-w-3xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent"
            >
              <Shield className="w-8 h-8" />
            </motion.div>
            <div className="space-y-4">
              <motion.h1
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="font-display text-5xl md:text-7xl font-bold tracking-tight text-brand-secondary"
              >
                Security by <span className="text-accent">Default.</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="text-xl text-brand-secondary/50 leading-relaxed"
              >
                Sendzz is built on the most secure infrastructure in
                decentralized finance. We prioritize your financial safety at
                every layer of our stack.
              </motion.p>
            </div>
          </div>

          {/* Core Security Grid */}
          <div className="grid md:grid-cols-2 gap-8">
            {securityFeatures.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="card-glass p-10 space-y-6"
              >
                <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-accent border border-white/10">
                  <f.icon className="w-6 h-6" />
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

          {/* Compliance & Audits */}
          <div className="card-glass p-12 lg:p-20 bg-accent/2 border-accent/10 overflow-hidden relative">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div className="space-y-8">
                <h2 className="font-display text-4xl font-bold text-brand-secondary">
                  Audited. Verified. <br />
                  Trusted.
                </h2>
                <div className="space-y-6">
                  <div className="p-6 rounded-2xl bg-white/2 border border-white/5 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                      Smart Contracts
                    </p>
                    <p className="text-sm font-medium text-brand-secondary/60">
                      Verified and audited smart accounts powered by Circle and
                      Privy.
                    </p>
                  </div>
                  <div className="p-6 rounded-2xl bg-white/2 border border-white/5 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-accent">
                      Infrastructure
                    </p>
                    <p className="text-sm font-medium text-brand-secondary/60">
                      Enterprise-grade cloud security with hardware-level key
                      isolation.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-center">
                <div className="relative">
                  <div className="w-64 h-64 rounded-full border border-accent/20 animate-spin-slow flex items-center justify-center">
                    <div className="w-48 h-48 rounded-full border border-accent/10 flex items-center justify-center">
                      <ShieldCheck className="w-20 h-20 text-accent opacity-20" />
                    </div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 flex items-center justify-center text-accent">
                      <Lock className="w-12 h-12" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Warning Card */}
          <div className="p-8 rounded-3xl bg-red-500/5 border border-red-500/10 flex flex-col md:flex-row items-center gap-6 text-center md:text-left">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-red-400">
                Remember Your Responsibilities
              </h4>
              <p className="text-xs text-red-400/60 leading-relaxed max-w-2xl">
                Sendzz is a self-custodial platform. While we provide
                best-in-class recovery options, you are ultimately responsible
                for your account access. Never share your login credentials or
                recovery phrases with anyone.
              </p>
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

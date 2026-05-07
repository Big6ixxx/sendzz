'use client';

import { usePrivy } from '@privy-io/react-auth';
import { ArrowRight, Target, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Landing() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) {
      router.push('/dashboard');
    }
  }, [ready, authenticated, router]);

  return (
    <div className="flex flex-col min-h-[85vh] justify-between">
      <header className="flex justify-between items-center border-b-4 border-black dark:border-white pb-6 mb-12">
        <h1 className="text-4xl md:text-6xl font-oswald font-black uppercase tracking-tighter">
          Sendzz //
        </h1>
        <button
          className="brutal-btn text-xl bg-neon text-black"
          onClick={login}
        >
          Init Wallet
        </button>
      </header>

      <main className="grid md:grid-cols-2 gap-12 grow">
        <div className="flex flex-col justify-center relative">
          <h2 className="text-7xl md:text-[9rem] font-oswald font-black leading-[0.8] uppercase mb-8 z-10 wrap-break-word drop-shadow-[5px_5px_0_rgba(234,255,0,1)]">
            Value
            <br />
            Transfer
          </h2>
          <div className="absolute top-10 left-10 w-full h-full bg-neon z-0 opacity-20 transform -rotate-2"></div>

          <p className="text-xl font-mono mb-8 bg-black text-white dark:bg-white dark:text-black p-4 z-10 w-fit">
            NON-CUSTODIAL. GAS-SPONSORED. ON-CHAIN.
          </p>

          <button
            onClick={login}
            className="brutal-btn flex items-center justify-between text-2xl w-full max-w-md group z-10 bg-neon text-black"
          >
            <span>Access Network</span>
            <ArrowRight
              className="group-hover:translate-x-3 transition-transform"
              strokeWidth={3}
            />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-6 content-center z-10">
          <div className="brutal-card p-8">
            <Zap className="w-16 h-16 mb-4" />
            <h3 className="font-oswald text-3xl uppercase font-black mb-2">
              Zero Fuel
            </h3>
            <p className="font-mono text-base font-bold bg-neon text-black inline-block p-1">
              ERC-4337 Sponsored Paymaster
            </p>
            <p className="font-mono text-sm mt-3">
              Completely eliminates ETH friction. Users transfer USDC natively
              without ever needing raw chain fuel.
            </p>
          </div>

          <div className="brutal-card p-8 bg-black text-white dark:bg-white dark:text-black">
            <Target className="w-16 h-16 mb-4" />
            <h3 className="font-oswald text-3xl uppercase font-black mb-2">
              Total Control
            </h3>
            <p className="font-mono text-base font-bold bg-neon text-black inline-block p-1">
              We do not hold your capital
            </p>
            <p className="font-mono text-sm mt-3">
              We are not a database ledger. Every transfer executes directly on
              the transparent blockchain.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t-4 border-black dark:border-white pt-6 mt-12 flex justify-between font-mono uppercase text-xs font-bold">
        <span>Sendzz {new Date().getFullYear()}</span>
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-neon animate-pulse"></span>{' '}
          Network Active
        </span>
      </footer>
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils';
import { usePrivy } from '@privy-io/react-auth';
import {
  ArrowRight,
  CheckCircle2,
  Globe,
  Landmark,
  Mail,
  Zap
} from 'lucide-react';
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
    <div className="flex flex-col min-h-screen bg-background">
      {/* Navigation */}
      <header className="flex justify-between items-center py-8 px-6 md:px-12 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-foreground text-background rounded-xl flex items-center justify-center font-black text-xl">
            S
          </div>
          <h1 className="text-2xl font-black uppercase tracking-tighter">
            Sendzz
          </h1>
        </div>
        <button
          className="btn-primary h-12 px-8 text-sm rounded-xl font-bold transition-all hover:scale-105"
          onClick={login}
        >
          Sign In
        </button>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="px-6 py-20 md:py-32 max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 xl:gap-32 items-center">
            <div className="space-y-8 animate-in fade-in slide-in-from-left-8 duration-1000 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-[10px] font-bold uppercase tracking-widest text-muted-foreground border border-border/50">
                <Globe className="w-3 h-3" /> The Future of Global Settlements
              </div>

              <h2 className="text-6xl md:text-8xl lg:text-7xl xl:text-9xl font-black tracking-tighter leading-[0.85] uppercase">
                Borderless
                <br />
                Payments.
              </h2>

              <p className="text-xl md:text-2xl text-muted-foreground max-w-xl font-medium leading-relaxed">
                The modern standard for global money movement. Deposit cash,
                hold stable digital dollars, and send instantly to any email
                with zero gas fees.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
                <button
                  onClick={login}
                  className="btn-primary h-16 px-10 text-lg gap-3 w-full sm:w-auto shadow-[0_20px_50px_rgba(0,0,0,0.1)] hover:shadow-[0_20px_50px_rgba(0,0,0,0.2)] transition-all group rounded-2xl"
                >
                  Start Sending Now
                  <ArrowRight className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>

            <div className="relative animate-in fade-in zoom-in-95 duration-1000 delay-200 hidden lg:block">
              <div className="card-elegant p-1 aspect-square max-w-[500px] ml-auto rounded-[3rem] bg-linear-to-br from-muted via-background to-muted border-border/50 shadow-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 pointer-events-none" />
                <div className="h-full w-full rounded-[2.8rem] bg-background border border-border/50 p-8 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        Available Balance
                      </p>
                      <h4 className="text-5xl font-black tracking-tighter">
                        $12,450.00
                      </h4>
                    </div>
                    <div className="w-12 h-12 bg-muted rounded-2xl flex items-center justify-center">
                      <Zap className="w-6 h-6 text-foreground" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                      Recent Activity
                    </p>
                    {[
                      {
                        type: 'Received',
                        from: 'alex@world.com',
                        amount: '+ $500.00',
                        color: 'text-green-500',
                      },
                      {
                        type: 'Sent',
                        from: 'maya@sendzz.io',
                        amount: '- $1,200.00',
                        color: 'text-foreground',
                      },
                      {
                        type: 'Deposit',
                        from: 'GTBank',
                        amount: '+ $3,000.00',
                        color: 'text-blue-500',
                      },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex justify-between items-center py-3 border-b border-border/30 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-foreground" />
                          </div>
                          <div>
                            <p className="text-xs font-bold uppercase">
                              {item.type}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-medium">
                              {item.from}
                            </p>
                          </div>
                        </div>
                        <p className={cn('text-xs font-black', item.color)}>
                          {item.amount}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Value Props */}
        <section className="px-6 py-24 bg-muted/20">
          <div className="max-w-7xl mx-auto">
            <div className="grid md:grid-cols-3 gap-12">
              <div className="space-y-4">
                <div className="w-14 h-14 bg-foreground text-background rounded-2xl flex items-center justify-center shadow-lg">
                  <Mail className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  Email Identity
                </h3>
                <p className="text-muted-foreground font-medium leading-relaxed">
                  Forget long wallet addresses. Send and receive funds using
                  just your email address. It&apos;s digital cash, simplified.
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-foreground text-background rounded-2xl flex items-center justify-center shadow-lg">
                  <Zap className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  Zero Gas Fees
                </h3>
                <p className="text-muted-foreground font-medium leading-relaxed">
                  We sponsor every transaction. No ETH required. Move your USDC
                  freely without worrying about fluctuating network costs.
                </p>
              </div>
              <div className="space-y-4">
                <div className="w-14 h-14 bg-foreground text-background rounded-2xl flex items-center justify-center shadow-lg">
                  <Landmark className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  Fiat Gateways
                </h3>
                <p className="text-muted-foreground font-medium leading-relaxed">
                  Seamlessly move between your bank account and the blockchain.
                  Fast deposits and withdrawals in your local currency.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Trust Section */}
        <section className="px-6 py-32 text-center max-w-3xl mx-auto space-y-12">
          <h2 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">
            Your Money, Your Control.
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {[
              'Self-Custodial',
              'Open Source',
              'Audit Trail',
              'On-Chain',
              'Anti-Fragile',
              'Global',
            ].map((text) => (
              <div
                key={text}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-background border border-border rounded-xl shadow-sm group hover:border-foreground transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {text}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-12 px-6 md:px-12 max-w-7xl mx-auto w-full border-t border-border/50 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="space-y-2 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2">
            <div className="w-6 h-6 bg-foreground text-background rounded-md flex items-center justify-center font-black text-xs">
              S
            </div>
            <span className="text-sm font-black uppercase tracking-tighter">
              Sendzz
            </span>
          </div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
            © {new Date().getFullYear()} Global Operations Group
          </p>
        </div>

        <div className="flex items-center gap-8 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <a href="#" className="hover:text-foreground transition-colors">
            Documentation
          </a>
          <a href="#" className="hover:text-foreground transition-colors">
            Security
          </a>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Network Live
          </div>
        </div>
      </footer>
    </div>
  );
}

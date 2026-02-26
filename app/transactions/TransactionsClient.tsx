'use client';

import { Transaction, TransactionList } from '@/components/TransactionList';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles, Wallet } from 'lucide-react';
import Link from 'next/link';

interface TransactionsClientProps {
  transactions: Transaction[];
  userEmail: string;
}

export function TransactionsClient({
  transactions,
  userEmail,
}: TransactionsClientProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Aurora orbs */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="aurora-orb aurora-orb-indigo w-[500px] h-[500px] -top-40 -left-24 opacity-30 animate-aurora-pulse" />
        <div
          className="aurora-orb aurora-orb-cyan w-[350px] h-[350px] top-1/2 -right-24 opacity-20 animate-aurora-pulse"
          style={{ animationDelay: '3s' }}
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 glass-strong border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-white/5 text-foreground/70"
          >
            <Link href="/dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div>
            <h1
              className="text-xl font-bold"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              Transaction History
            </h1>
            <p className="text-sm text-muted-foreground">{userEmail}</p>
          </div>
        </div>
      </header>

      <main className="relative max-w-4xl mx-auto px-4 py-8">
        {transactions.length === 0 ? (
          <div className="glass-card rounded-2xl border border-white/8 py-20 flex flex-col items-center gap-4 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Wallet className="w-8 h-8 text-primary/60" />
            </div>
            <div>
              <h3
                className="text-lg font-semibold mb-1"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                No transactions yet
              </h3>
              <p className="text-muted-foreground text-sm">
                Send or receive USDC to see your transaction history here.
              </p>
            </div>
            <Button
              asChild
              className="mt-2 btn-shimmer text-white border-0 font-semibold"
            >
              <Link href="/dashboard">
                <Sparkles className="mr-2 w-4 h-4" />
                Go to Dashboard
              </Link>
            </Button>
          </div>
        ) : (
          <div className="glass-card rounded-2xl border border-white/8 overflow-hidden animate-fade-in">
            <TransactionList transactions={transactions} grouped />
          </div>
        )}
      </main>
    </div>
  );
}

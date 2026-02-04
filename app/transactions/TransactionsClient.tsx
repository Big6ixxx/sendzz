'use client';

import { Transaction, TransactionList } from '@/components/TransactionList';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Wallet } from 'lucide-react';
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
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button asChild variant="ghost" size="icon" className="rounded-full">
            <Link href="/dashboard">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold">Transaction History</h1>
            <p className="text-sm text-muted-foreground">{userEmail}</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {transactions.length === 0 ? (
          <Card className="border-2">
            <CardContent className="py-16 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Wallet className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                No transactions yet
              </h3>
              <p className="text-muted-foreground mb-6">
                Send or receive USDC to see your transaction history here.
              </p>
              <Button asChild>
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <TransactionList transactions={transactions} grouped />
        )}
      </main>
    </div>
  );
}

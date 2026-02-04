'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';

interface Transaction {
  id: string;
  type: 'sent' | 'received' | 'withdrawal';
  amount: number;
  asset: string;
  status: string;
  counterparty: string;
  note?: string | null;
  createdAt: string;
}

interface TransactionsClientProps {
  transactions: Transaction[];
  userEmail: string;
}

export function TransactionsClient({
  transactions,
  userEmail,
}: TransactionsClientProps) {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
      case 'claimed':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            Completed
          </Badge>
        );
      case 'pending_claim':
        return (
          <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
            Pending Claim
          </Badge>
        );
      case 'processing':
        return (
          <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
            Processing
          </Badge>
        );
      case 'awaiting_verification':
        return (
          <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">
            Awaiting Verification
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            Failed
          </Badge>
        );
      case 'expired':
        return (
          <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
            Expired
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'sent':
        return (
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <ArrowUpRight className="w-5 h-5 text-red-500" />
          </div>
        );
      case 'received':
        return (
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <ArrowDownLeft className="w-5 h-5 text-green-500" />
          </div>
        );
      case 'withdrawal':
        return (
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <Banknote className="w-5 h-5 text-blue-500" />
          </div>
        );
      default:
        return (
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-slate-500" />
          </div>
        );
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'sent':
        return 'Sent';
      case 'received':
        return 'Received';
      case 'withdrawal':
        return 'Withdrawal';
      default:
        return type;
    }
  };

  // Group transactions by date
  const groupedTransactions = transactions.reduce(
    (groups, tx) => {
      const date = new Date(tx.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(tx);
      return groups;
    },
    {} as Record<string, Transaction[]>,
  );

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
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
              <Link href="/dashboard">
                <Button>Go to Dashboard</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedTransactions).map(([date, txs]) => (
              <Card key={date} className="border-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {date}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {txs.map((tx, index) => (
                    <div key={tx.id}>
                      <div className="flex items-center gap-4 py-3 hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors">
                        {getTransactionIcon(tx.type)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold">{tx.counterparty}</p>
                            {getStatusBadge(tx.status)}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {getTypeLabel(tx.type)}
                            {tx.note && (
                              <span className="ml-2">• {tx.note}</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDate(tx.createdAt)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p
                            className={`font-bold text-lg ${tx.type === 'received' ? 'text-green-600' : ''}`}
                          >
                            {tx.type === 'received' ? '+' : '-'}
                            {formatAmount(tx.amount)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {tx.asset}
                          </p>
                        </div>
                      </div>
                      {index < txs.length - 1 && <Separator />}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

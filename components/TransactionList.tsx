'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { convertUsdToNgn, formatCurrency } from '@/lib/currency';
import { toTitleCase } from '@/lib/utils';
import { ArrowDownLeft, ArrowUpRight, Banknote, Wallet } from 'lucide-react';

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  asset: string;
  status: string;
  counterparty: string;
  note?: string | null;
  createdAt: string;
}

interface TransactionListProps {
  transactions: Transaction[];
  grouped?: boolean;
  emptyMessage?: string;
  limit?: number;
}

export function TransactionList({
  transactions,
  grouped = false,
  emptyMessage = 'No transactions yet',
  limit,
}: TransactionListProps) {
  const displayTransactions = limit
    ? transactions.slice(0, limit)
    : transactions;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
      case 'claimed':
      case 'confirmed':
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            Completed
          </Badge>
        );
      case 'pending_claim':
        return (
          <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
            Pending
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
            Verifying
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
        return <Badge variant="secondary">{toTitleCase(status)}</Badge>;
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
      case 'deposit':
        return 'Deposit';
      default:
        return toTitleCase(type);
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Wallet className="w-8 h-8 text-slate-400" />
        </div>
        <p className="text-muted-foreground font-medium">{emptyMessage}</p>
        <p className="text-sm text-muted-foreground mt-1">
          Make a deposit to get started!
        </p>
      </div>
    );
  }

  const renderTransactionRow = (
    tx: Transaction,
    index: number,
    total: number,
  ) => (
    <div key={tx.id}>
      <div className="flex items-center gap-4 py-3 hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors">
        {getTransactionIcon(tx.type)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold truncate">
              {tx.counterparty || 'Unknown'}
            </p>
            {getStatusBadge(tx.status)}
          </div>
          <p className="text-sm text-muted-foreground">
            {getTypeLabel(tx.type)}
            {tx.note && <span className="ml-2">• {tx.note}</span>}
            <span className="mx-1">•</span>
            {formatDate(tx.createdAt)}
          </p>
        </div>
        <div className="text-right">
          <p
            className={`font-bold ${
              tx.type === 'received' || tx.type === 'deposit'
                ? 'text-green-600'
                : ''
            }`}
          >
            {tx.type === 'received' || tx.type === 'deposit' ? '+' : '-'}
            {formatCurrency(tx.amount, 'USD')}
          </p>
          <p className="text-xs text-muted-foreground">
            ≈ {formatCurrency(convertUsdToNgn(tx.amount), 'NGN')}
          </p>
        </div>
      </div>
      {index < total - 1 && <Separator />}
    </div>
  );

  if (grouped) {
    const groupedTransactions = displayTransactions.reduce(
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
      <div className="space-y-6">
        {Object.entries(groupedTransactions).map(([date, txs]) => (
          <Card key={date} className="border-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {date}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {txs.map((tx, idx) => renderTransactionRow(tx, idx, txs.length))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {displayTransactions.map((tx, idx) =>
        renderTransactionRow(tx, idx, displayTransactions.length),
      )}
    </div>
  );
}

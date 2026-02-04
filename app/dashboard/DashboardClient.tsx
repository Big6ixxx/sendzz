'use client';

import { ReceiveDialog } from '@/components/ReceiveDialog';
import { SendMoneyDialog } from '@/components/SendMoneyDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { WithdrawDialog } from '@/components/WithdrawDialog';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Copy,
  LogOut,
  MoreHorizontal,
  Plus,
  Send,
  Settings,
  Sparkles,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

interface Transaction {
  id: string;
  type: string;
  amount: number;
  asset: string;
  status: string;
  counterparty: string;
  note?: string | null;
  createdAt: string;
}

interface DashboardClientProps {
  user: {
    id: string;
    email: string;
    onboardingCompleted: boolean;
  };
  balance: {
    available: number;
    locked: number;
    total: number;
  };
  recentTransactions: Transaction[];
}

export function DashboardClient({
  user,
  balance,
  recentTransactions,
}: DashboardClientProps) {
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    toast.success('Logged out successfully');
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(user.email);
    toast.success('Email copied to clipboard');
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

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
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
            Failed
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'sent':
        return <ArrowUpRight className="w-4 h-4 text-red-500" />;
      case 'received':
        return <ArrowDownLeft className="w-4 h-4 text-green-500" />;
      case 'withdrawal':
        return <Banknote className="w-4 h-4 text-blue-500" />;
      default:
        return <Wallet className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-linear-to-br from-blue-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200/50">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-black tracking-tight bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              SENDZZ
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={copyEmail}>
                <Copy className="mr-2 h-4 w-4" />
                Copy Email
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Welcome */}
        <div className="animate-fade-in">
          <p className="text-muted-foreground">Welcome back,</p>
          <h1 className="text-2xl font-bold">{user.email}</h1>
        </div>

        {/* Balance Card */}
        <Card className="border-2 shadow-xl bg-linear-to-br from-blue-600 to-violet-600 text-white animate-slide-in-up">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <p className="text-blue-100 text-sm font-medium">
                  Available Balance
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black">
                    {formatAmount(balance.available)}
                  </span>
                  <span className="text-xl font-semibold text-blue-100">
                    USDC
                  </span>
                </div>
              </div>

              {balance.locked > 0 && (
                <div className="flex items-center gap-2 text-sm text-blue-100">
                  <Wallet className="w-4 h-4" />
                  <span>
                    {formatAmount(balance.locked)} USDC locked in pending
                    transactions
                  </span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={() => setSendDialogOpen(true)}
                  className="flex-1 h-12 bg-white text-blue-600 hover:bg-blue-50 font-bold shadow-lg"
                >
                  <Send className="mr-2 h-4 w-4" />
                  Send
                </Button>
                <Button
                  onClick={() => setWithdrawDialogOpen(true)}
                  className="flex-1 h-12 bg-white/20 hover:bg-white/30 text-white font-bold border border-white/30"
                >
                  <Banknote className="mr-2 h-4 w-4" />
                  Withdraw
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-12 bg-white/20 hover:bg-white/30 text-white border-white/30"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3 animate-slide-in-up">
          <Card
            className="border hover:border-blue-200 transition-colors cursor-pointer group hover:bg-blue-50/50"
            onClick={() => setSendDialogOpen(true)}
          >
            <CardContent className="pt-4 pb-4 text-center">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                <Send className="w-5 h-5 text-blue-600" />
              </div>
              <p className="text-sm font-semibold">Send</p>
            </CardContent>
          </Card>
          <Card
            className="border hover:border-green-200 transition-colors cursor-pointer group hover:bg-green-50/50"
            onClick={() => setReceiveDialogOpen(true)}
          >
            <CardContent className="pt-4 pb-4 text-center">
              <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                <ArrowDownLeft className="w-5 h-5 text-green-600" />
              </div>
              <p className="text-sm font-semibold">Receive</p>
            </CardContent>
          </Card>
          <Card
            className="border hover:border-violet-200 transition-colors cursor-pointer group hover:bg-violet-50/50"
            onClick={() => setWithdrawDialogOpen(true)}
          >
            <CardContent className="pt-4 pb-4 text-center">
              <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center mx-auto mb-2 group-hover:scale-110 transition-transform">
                <Banknote className="w-5 h-5 text-violet-600" />
              </div>
              <p className="text-sm font-semibold">Withdraw</p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Transactions */}
        <Card className="border-2 animate-slide-in-up">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Your latest transactions</CardDescription>
              </div>
              <Link href="/transactions">
                <Button variant="ghost" size="sm">
                  View All
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentTransactions.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Wallet className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-muted-foreground font-medium">
                  No transactions yet
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Send money to get started!
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentTransactions.map((tx, index) => (
                  <div key={tx.id}>
                    <div className="flex items-center gap-4 py-3 hover:bg-slate-50 rounded-lg px-2 -mx-2 transition-colors">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                        {getTransactionIcon(tx.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold truncate">
                            {tx.counterparty}
                          </p>
                          {getStatusBadge(tx.status)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {tx.type === 'sent'
                            ? 'Sent'
                            : tx.type === 'received'
                              ? 'Received'
                              : 'Withdrawal'}{' '}
                          • {formatDate(tx.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`font-bold ${tx.type === 'received' ? 'text-green-600' : ''}`}
                        >
                          {tx.type === 'received' ? '+' : '-'}
                          {formatAmount(tx.amount)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {tx.asset}
                        </p>
                      </div>
                    </div>
                    {index < recentTransactions.length - 1 && <Separator />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Dialogs */}
      <SendMoneyDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        maxAmount={balance.available}
      />
      <WithdrawDialog
        open={withdrawDialogOpen}
        onOpenChange={setWithdrawDialogOpen}
        maxAmount={balance.available}
      />
      <ReceiveDialog
        open={receiveDialogOpen}
        onOpenChange={setReceiveDialogOpen}
        email={user.email}
      />
    </div>
  );
}

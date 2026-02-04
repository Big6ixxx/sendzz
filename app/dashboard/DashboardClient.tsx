'use client';

import { DepositDialog } from '@/components/DepositDialog';
import { ReceiveDialog } from '@/components/ReceiveDialog';
import { SendMoneyDialog } from '@/components/SendMoneyDialog';
import { TransactionList } from '@/components/TransactionList';
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
import { WithdrawDialog } from '@/components/WithdrawDialog';
import { convertUsdToNgn, formatCurrency } from '@/lib/currency';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  ArrowDownLeft,
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
  const [depositDialogOpen, setDepositDialogOpen] = useState(false);
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

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-linear-to-br from-blue-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200/50">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-black tracking-tight bg-linear-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              SENDZZ
            </span>
          </Link>

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
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-blue-100 mb-1">
                    Total Balance
                  </p>
                  <h2 className="text-4xl font-bold mb-1">
                    {formatCurrency(balance.available, 'USD')}
                  </h2>
                  <p className="text-blue-200 text-sm">
                    ≈{' '}
                    {formatCurrency(convertUsdToNgn(balance.available), 'NGN')}
                  </p>
                </div>
                <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm self-start">
                  <Wallet className="w-6 h-6" />
                </div>
              </div>

              {balance.locked > 0 && (
                <div className="mt-4 pt-4 border-t border-white/20 flex items-center gap-2 text-sm text-blue-100">
                  <div className="w-2 h-2 rounded-full bg-yellow-400" />
                  <span>
                    Locked: {formatCurrency(balance.locked, 'USD')} (
                    {formatCurrency(convertUsdToNgn(balance.locked), 'NGN')})
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
                  onClick={() => setDepositDialogOpen(true)}
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
              <Button asChild variant="ghost" size="sm">
                <Link href="/transactions">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <CardContent>
              <TransactionList transactions={recentTransactions} limit={5} />
            </CardContent>
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
      <DepositDialog
        open={depositDialogOpen}
        onOpenChange={setDepositDialogOpen}
      />
    </div>
  );
}

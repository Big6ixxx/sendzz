'use client';

import { DepositDialog } from '@/components/DepositDialog';
import { ReceiveDialog } from '@/components/ReceiveDialog';
import { SendMoneyDialog } from '@/components/SendMoneyDialog';
import { TransactionList } from '@/components/TransactionList';
import { Button } from '@/components/ui/button';
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
  Banknote,
  Copy,
  Download,
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
    toast.success('Email copied');
  };

  const firstName = user.email.split('@')[0];

  return (
    <div className="min-h-screen bg-background">
      {/* ── Aurora Background ── */}
      <div
        className="pointer-events-none fixed inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="aurora-orb aurora-orb-indigo w-[600px] h-[600px] -top-48 -left-32 opacity-35 animate-aurora-pulse" />
        <div
          className="aurora-orb aurora-orb-cyan w-[400px] h-[400px] top-1/3 -right-32 opacity-20 animate-aurora-pulse"
          style={{ animationDelay: '3s' }}
        />
      </div>

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 glass-strong border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl btn-shimmer flex items-center justify-center shadow-lg">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span
              className="text-xl font-extrabold tracking-tight text-aurora"
              style={{ fontFamily: 'var(--font-syne)' }}
            >
              SENDZZ
            </span>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full hover:bg-white/5 text-foreground/70"
              >
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 glass-card border-white/10"
            >
              <DropdownMenuItem
                onClick={copyEmail}
                className="hover:bg-white/5 cursor-pointer"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy Email
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="hover:bg-white/5 cursor-pointer"
              >
                <Link href="/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/8" />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive hover:bg-destructive/10 cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="relative max-w-4xl mx-auto px-4 pt-6 pb-10 space-y-4">
        {/* Welcome */}
        <div className="animate-fade-in pb-1">
          <p className="text-muted-foreground text-sm">Welcome back,</p>
          <h1
            className="text-2xl font-bold mt-0.5"
            style={{ fontFamily: 'var(--font-syne)' }}
          >
            {firstName}
          </h1>
        </div>

        {/* ── Balance Card ── */}
        <div
          className="relative rounded-2xl p-6 overflow-hidden animate-slide-in-up"
          style={{
            background: 'oklch(0.11 0.022 280 / 0.9)',
            backdropFilter: 'blur(24px)',
            border: '1px solid oklch(0.62 0.28 290 / 30%)',
            boxShadow:
              '0 0 0 1px oklch(0.62 0.28 290 / 15%), 0 8px 32px oklch(0 0 0 / 40%)',
          }}
        >
          {/* Ambient orbs inside card – own overflow-hidden wrapper so they bleed correctly */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
            <div
              className="aurora-orb aurora-orb-indigo"
              style={{
                width: '280px',
                height: '280px',
                top: '-80px',
                right: '-80px',
                opacity: 0.6,
              }}
            />
            <div
              className="aurora-orb aurora-orb-cyan"
              style={{
                width: '200px',
                height: '200px',
                bottom: '-60px',
                left: '-60px',
                opacity: 0.4,
              }}
            />
          </div>

          <div className="relative z-10 space-y-5">
            {/* Balance amount */}
            <div className="flex items-start justify-between">
              <div>
                <p className="text-white/50 text-sm font-medium mb-1">
                  Available Balance
                </p>
                <div
                  className="text-5xl font-extrabold tracking-tight text-white"
                  style={{ fontFamily: 'var(--font-syne)' }}
                >
                  {formatCurrency(balance.available, 'USD')}
                </div>
                <p className="text-white/40 text-sm mt-1.5">
                  ≈ {formatCurrency(convertUsdToNgn(balance.available), 'NGN')}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-white/8 border border-white/10">
                <Wallet className="w-5 h-5 text-white/70" />
              </div>
            </div>

            {balance.locked > 0 && (
              <div className="flex items-center gap-2 text-sm text-white/50 pt-1 border-t border-white/8">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Locked: {formatCurrency(balance.locked, 'USD')}
              </div>
            )}

            {/* ── Send CTA ── */}
            <button
              onClick={() => setSendDialogOpen(true)}
              className="w-full h-11 rounded-lg text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all mt-1"
              style={{
                background:
                  'linear-gradient(115deg, oklch(0.50 0.28 290), oklch(0.68 0.22 195), oklch(0.50 0.28 290))',
                backgroundSize: '200% auto',
              }}
            >
              <Send className="h-4 w-4" />
              Send USDC
            </button>
          </div>
        </div>

        {/* ── Quick Actions (2×2 grid) ── */}
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              label: 'Send',
              icon: Send,
              color: 'text-primary',
              iconBg: 'bg-primary/15 border-primary/25',
              hoverBorder: 'hover:border-primary/50 hover:bg-primary/5',
              onClick: () => setSendDialogOpen(true),
              delay: '0.05s',
            },
            {
              label: 'Receive',
              icon: Download,
              color: 'text-accent',
              iconBg: 'bg-accent/15 border-accent/25',
              hoverBorder: 'hover:border-accent/50 hover:bg-accent/5',
              onClick: () => setReceiveDialogOpen(true),
              delay: '0.10s',
            },
            {
              label: 'Withdraw',
              icon: Banknote,
              color: 'text-amber-400',
              iconBg: 'bg-amber-400/10 border-amber-400/20',
              hoverBorder: 'hover:border-amber-400/50 hover:bg-amber-400/5',
              onClick: () => setWithdrawDialogOpen(true),
              delay: '0.15s',
            },
            {
              label: 'Deposit',
              icon: Plus,
              color: 'text-emerald-400',
              iconBg: 'bg-emerald-400/10 border-emerald-400/20',
              hoverBorder: 'hover:border-emerald-400/50 hover:bg-emerald-400/5',
              onClick: () => setDepositDialogOpen(true),
              delay: '0.20s',
            },
          ].map(
            ({
              label,
              icon: Icon,
              color,
              iconBg,
              hoverBorder,
              onClick,
              delay,
            }) => (
              <button
                key={label}
                onClick={onClick}
                className={`glass-card rounded-xl py-4 px-3 text-center border border-white/8 transition-all duration-200 group animate-slide-in-up ${hoverBorder}`}
                style={{ animationDelay: delay }}
              >
                <div
                  className={`w-10 h-10 rounded-xl border ${iconBg} flex items-center justify-center mx-auto mb-2.5 group-hover:scale-110 transition-transform duration-200`}
                >
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <p className="text-sm font-semibold text-foreground/80">
                  {label}
                </p>
              </button>
            ),
          )}
        </div>

        {/* ── Recent Transactions ── */}
        <div
          className="glass-card rounded-2xl border border-white/8 overflow-hidden animate-slide-in-up"
          style={{ animationDelay: '0.25s' }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
            <div>
              <h2
                className="font-bold text-sm text-foreground"
                style={{ fontFamily: 'var(--font-syne)' }}
              >
                Recent Activity
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your latest transactions
              </p>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-primary hover:bg-primary/10 text-xs h-8"
            >
              <Link href="/transactions">View All</Link>
            </Button>
          </div>
          <div className="px-2 py-2">
            <TransactionList transactions={recentTransactions} limit={5} />
          </div>
        </div>
      </main>

      {/* ── Dialogs ── */}
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
        userId={user.id}
      />
      <DepositDialog
        open={depositDialogOpen}
        onOpenChange={setDepositDialogOpen}
        userId={user.id}
      />
    </div>
  );
}

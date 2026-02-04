import { createClient } from '@/lib/supabase/server';
import {
  findUserById,
  getAllUserTransfers,
  getBalance,
  getWithdrawalsByUser,
} from '@/server/repositories';
import { redirect } from 'next/navigation';
import { DashboardClient } from './DashboardClient';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch data in parallel
  const [profile, balance, transfers, withdrawals] = await Promise.all([
    findUserById(user.id),
    getBalance(user.id),
    getAllUserTransfers(user.id, 10),
    getWithdrawalsByUser(user.id, 5),
  ]);

  // Combine and format transactions
  const recentTransactions = [
    ...transfers.map((t) => ({
      id: t.id,
      type: t.sender_id === user.id ? 'sent' : 'received',
      amount: Number(t.amount),
      asset: t.asset,
      status: t.status,
      counterparty: t.sender_id === user.id ? t.recipient_email : 'Someone',
      note: t.note,
      createdAt: t.created_at,
    })),
    ...withdrawals.map((w) => ({
      id: w.id,
      type: 'withdrawal',
      amount: Number(w.amount_usdc),
      asset: 'USDC' as const,
      status: w.status,
      counterparty: `Bank ${w.bank_account_masked}`,
      createdAt: w.created_at,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 10);

  return (
    <DashboardClient
      user={{
        id: user.id,
        email: user.email!,
        onboardingCompleted: profile?.onboarding_completed ?? false,
      }}
      balance={{
        available: balance?.available ?? 0,
        locked: balance?.locked ?? 0,
        total: balance?.total ?? 0,
      }}
      recentTransactions={recentTransactions}
    />
  );
}

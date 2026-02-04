import { createClient } from '@/lib/supabase/server';
import {
    getAllUserTransfers,
    getWithdrawalsByUser,
} from '@/server/repositories';
import { redirect } from 'next/navigation';
import { TransactionsClient } from './TransactionsClient';

export default async function TransactionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch all transactions
  const [transfers, withdrawals] = await Promise.all([
    getAllUserTransfers(user.id, 50),
    getWithdrawalsByUser(user.id, 50),
  ]);

  // Format transactions
  const transactions = [
    ...transfers.map((t) => ({
      id: t.id,
      type: t.sender_id === user.id ? ('sent' as const) : ('received' as const),
      amount: Number(t.amount),
      asset: t.asset,
      status: t.status,
      counterparty: t.sender_id === user.id ? t.recipient_email : 'Someone',
      note: t.note,
      createdAt: t.created_at,
    })),
    ...withdrawals.map((w) => ({
      id: w.id,
      type: 'withdrawal' as const,
      amount: Number(w.amount_usdc),
      asset: 'USDC' as const,
      status: w.status,
      counterparty: `Bank ${w.bank_account_masked}`,
      createdAt: w.created_at,
    })),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <TransactionsClient transactions={transactions} userEmail={user.email!} />
  );
}

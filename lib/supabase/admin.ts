'use server';

import { AdminTransaction } from '@/types/admin';
import { supabaseAdmin } from './adminClient';

async function verifyAdmin(email: string | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_admins')
      .select('email')
      .eq('email', email.toLowerCase())
      .single();
    if (data && !error) return true;
  } catch (err) {
    console.error('[Admin Auth] DB query failed, falling back to ENV:', err);
  }
  const serverAdmins =
    process.env.ADMIN_EMAILS?.split(',').map((e) => e.trim().toLowerCase()) || [];
  return serverAdmins.includes(email.toLowerCase());
}

export async function checkIsAdmin(email: string | undefined): Promise<boolean> {
  return verifyAdmin(email);
}

export async function getAdminStats(adminEmail: string) {
  if (!(await verifyAdmin(adminEmail))) throw new Error('Unauthorized');

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: d },
    { data: w },
    { data: t },
    { count: u },
    { data: activeD },
    { data: activeW },
    { data: activeT },
  ] = await Promise.all([
    supabaseAdmin.from('deposits').select('amount_usdc, status'),
    supabaseAdmin.from('withdrawals').select('amount_usdc, status'),
    supabaseAdmin.from('transfers').select('amount, status'),
    supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('deposits').select('user_id').gte('created_at', last24h),
    supabaseAdmin.from('withdrawals').select('user_id').gte('created_at', last24h),
    supabaseAdmin.from('transfers').select('sender_id, recipient_id').gte('created_at', last24h),
  ]);

  const activeUserIds = new Set([
    ...(activeD || []).map((x) => x.user_id),
    ...(activeW || []).map((x) => x.user_id),
    ...(activeT || []).map((x) => x.sender_id),
    ...(activeT || []).map((x) => x.recipient_id).filter(Boolean),
  ]);

  const confirmedDeposits = d?.filter((x) => x.status === 'confirmed') || [];
  const confirmedWithdrawals = w?.filter((x) => x.status === 'completed' || x.status === 'processing') || [];
  const confirmedTransfers = t?.filter((x) => x.status === 'completed') || [];

  const totalDeposits = confirmedDeposits.reduce((acc, curr) => acc + (Number(curr.amount_usdc) || 0), 0);
  const totalWithdrawals = confirmedWithdrawals.reduce((acc, curr) => acc + (Number(curr.amount_usdc) || 0), 0);
  const totalTransfers = confirmedTransfers.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const pendingDepositsCount = d?.filter((x) => x.status === 'pending').length || 0;
  const pendingWithdrawalsCount = w?.filter((x) => x.status === 'processing' || x.status === 'awaiting_verification').length || 0;

  return {
    totalUsers: u || 0,
    totalVolume: totalDeposits + totalWithdrawals + totalTransfers,
    totalDeposits,
    totalWithdrawals,
    totalTransfers,
    activeUsers24h: activeUserIds.size,
    pendingActions: pendingDepositsCount + pendingWithdrawalsCount,
  };
}

export async function getAdminTransactions(
  adminEmail: string,
  filterType?: string,
): Promise<AdminTransaction[]> {
  if (!(await verifyAdmin(adminEmail))) throw new Error('Unauthorized');

  const [{ data: transfers }, { data: deposits }, { data: withdrawals }] =
    await Promise.all([
      supabaseAdmin.from('transfers').select('*').order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('deposits').select('*').order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(50),
    ]);

  const all: AdminTransaction[] = [
    ...(transfers || []).map((t) => ({ ...t, tx_type: 'transfer' as const })),
    ...(deposits || []).map((d) => ({ ...d, tx_type: 'deposit' as const, amount: d.amount_usdc || 0 })),
    ...(withdrawals || []).map((w) => ({ ...w, tx_type: 'withdrawal' as const, amount: w.amount_usdc || 0 })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return filterType ? all.filter((t) => t.tx_type === filterType) : all;
}

export async function getAdminUsers(adminEmail: string) {
  if (!(await verifyAdmin(adminEmail))) throw new Error('Unauthorized');

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const [{ data: d }, { data: w }, { data: t }] = await Promise.all([
    supabaseAdmin.from('deposits').select('user_id, amount_usdc, status'),
    supabaseAdmin.from('withdrawals').select('user_id, amount_usdc, status'),
    supabaseAdmin.from('transfers').select('sender_id, sender_email, recipient_id, recipient_email, amount, status'),
  ]);

  return users.map((user) => {
    const userEmail = user.email.toLowerCase();
    const userDeposits = d?.filter((x) => x.user_id === user.id && x.status === 'confirmed') || [];
    const total_deposits = userDeposits.reduce((a, b) => a + (Number(b.amount_usdc) || 0), 0);
    const userWithdrawals = w?.filter((x) => x.user_id === user.id && (x.status === 'completed' || x.status === 'processing')) || [];
    const total_withdrawals = userWithdrawals.reduce((a, b) => a + (Number(b.amount_usdc) || 0), 0);
    const userTransfersSent = t?.filter((x) => (x.sender_id === user.id || x.sender_email?.toLowerCase() === userEmail) && x.status === 'completed') || [];
    const total_sent = userTransfersSent.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const userTransfersReceived = t?.filter((x) => (x.recipient_id === user.id || x.recipient_email?.toLowerCase() === userEmail) && x.status === 'completed') || [];
    const total_received = userTransfersReceived.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    return { ...user, total_volume: total_deposits + total_withdrawals + total_sent + total_received, total_deposits, total_withdrawals, total_sent, total_received };
  });
}

export async function getAdminAnalytics(
  email: string | undefined,
  period: '7d' | '30d' | 'all' = '7d',
) {
  if (!email || !(await verifyAdmin(email))) throw new Error('Unauthorized');

  const days = period === 'all' ? 90 : period === '30d' ? 30 : 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateIso = startDate.toISOString();

  const [{ data: transfers }, { data: deposits }, { data: withdrawals }, { data: newUsers }] =
    await Promise.all([
      supabaseAdmin.from('transfers').select('amount, status, created_at').gte('created_at', startDateIso),
      supabaseAdmin.from('deposits').select('amount_usdc, status, created_at').gte('created_at', startDateIso),
      supabaseAdmin.from('withdrawals').select('amount_usdc, status, created_at').gte('created_at', startDateIso),
      supabaseAdmin.from('users').select('created_at').gte('created_at', startDateIso),
    ]);

  const chartData: Record<string, { date: string; volume: number; users: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    chartData[dateStr] = { date: dateStr, volume: 0, users: 0 };
  }

  const txEvents = [
    ...(transfers || []).filter((x) => x.status === 'completed' && x.created_at).map((x) => ({ a: Number(x.amount), d: x.created_at })),
    ...(deposits || []).filter((x) => x.status === 'confirmed' && x.created_at).map((x) => ({ a: Number(x.amount_usdc), d: x.created_at })),
    ...(withdrawals || []).filter((x) => (x.status === 'completed' || x.status === 'processing') && x.created_at).map((x) => ({ a: Number(x.amount_usdc), d: x.created_at })),
  ];

  txEvents.forEach((tx) => {
    if (!tx.d) return;
    const dateStr = tx.d.split('T')[0];
    if (chartData[dateStr]) chartData[dateStr].volume += tx.a;
  });

  (newUsers || []).forEach((u) => {
    if (!u.created_at) return;
    const dateStr = u.created_at.split('T')[0];
    if (chartData[dateStr]) chartData[dateStr].users += 1;
  });

  return Object.values(chartData).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAdminLogs(
  adminEmail: string,
  type: 'webhooks' | 'audit',
) {
  if (!(await verifyAdmin(adminEmail))) throw new Error('Unauthorized');

  if (type === 'webhooks') {
    const { data, error } = await supabaseAdmin.from('webhook_events').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  } else {
    const { data, error } = await supabaseAdmin.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
  }
}

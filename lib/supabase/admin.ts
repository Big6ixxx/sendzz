'use server';

import type { AdminDateRange, AdminTransaction, AdminUserDetail } from '@/types/admin';
import { getAdminSession, requireAdmin } from '@/lib/admin/auth';
import { diditConsoleSessionUrl } from '@/lib/kyc/didit-client';
import { supabaseAdmin } from './adminClient';

/**
 * Every export below is a Server Action — a POST endpoint anyone can invoke. So each one opens
 * with `requireAdmin()`, which derives the caller's identity from their session cookie. None of
 * them accept an email to authorise against: a caller-supplied identity is not an identity.
 */

/** Is the *current session* an approved admin? Takes no argument, by design. */
export async function checkIsAdmin(accessToken?: string): Promise<boolean> {
  return (await getAdminSession(accessToken)) !== null;
}

export async function getAdminStats(accessToken?: string) {
  await requireAdmin(accessToken);

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: d },
    { data: w },
    { data: t },
    { count: u },
    { data: activeD },
    { data: activeW },
    { data: activeT },
    { data: activeB },
    { data: b },
  ] = await Promise.all([
    supabaseAdmin.from('deposits').select('amount_usdc, status'),
    supabaseAdmin.from('withdrawals').select('amount_usdc, status'),
    supabaseAdmin.from('transfers').select('amount, status'),
    supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('deposits').select('user_id').gte('created_at', last24h),
    supabaseAdmin.from('withdrawals').select('user_id').gte('created_at', last24h),
    supabaseAdmin.from('transfers').select('sender_id, recipient_id').gte('created_at', last24h),
    supabaseAdmin.from('bridge_transactions').select('user_id').gte('created_at', last24h),
    supabaseAdmin.from('bridge_transactions').select('amount, attestation_status'),
  ]);

  const activeUserIds = new Set([
    ...(activeD || []).map((x) => x.user_id),
    ...(activeW || []).map((x) => x.user_id),
    ...(activeT || []).map((x) => x.sender_id),
    ...(activeT || []).map((x) => x.recipient_id).filter(Boolean),
    ...(activeB || []).map((x) => x.user_id),
  ]);

  const confirmedDeposits = d?.filter((x) => x.status === 'confirmed') || [];
  // Only 'completed' withdrawals count — 'processing' means the USDC transfer was sent
  // but Paycrest hasn't settled yet, so it must NOT be counted as confirmed volume.
  const confirmedWithdrawals = w?.filter((x) => x.status === 'completed') || [];
  const confirmedTransfers = t?.filter((x) => x.status === 'completed') || [];
  const confirmedBridges = b?.filter((x) => x.attestation_status === 'complete') || [];

  const totalDeposits = confirmedDeposits.reduce((acc, curr) => acc + (Number(curr.amount_usdc) || 0), 0);
  const totalWithdrawals = confirmedWithdrawals.reduce((acc, curr) => acc + (Number(curr.amount_usdc) || 0), 0);
  const totalTransfers = confirmedTransfers.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalBridges = confirmedBridges.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

  const pendingDepositsCount = d?.filter((x) => x.status === 'pending').length || 0;
  const pendingWithdrawalsCount = w?.filter((x) => x.status === 'processing' || x.status === 'awaiting_verification').length || 0;
  const pendingBridgesCount = b?.filter((x) => x.attestation_status === 'pending').length || 0;

  return {
    totalUsers: u || 0,
    totalVolume: totalDeposits + totalWithdrawals + totalTransfers + totalBridges,
    totalDeposits,
    totalWithdrawals,
    totalTransfers,
    totalBridges,
    activeUsers24h: activeUserIds.size,
    pendingActions: pendingDepositsCount + pendingWithdrawalsCount + pendingBridgesCount,
  };
}

/** Start of a reporting window, or undefined for 'all' (no lower bound). */
function dateRangeStart(range: AdminDateRange | undefined): string | undefined {
  if (!range || range === 'all') return undefined;
  const now = new Date();
  if (range === '7d') now.setDate(now.getDate() - 7);
  else if (range === '30d') now.setDate(now.getDate() - 30);
  else if (range === '6m') now.setMonth(now.getMonth() - 6);
  else if (range === '1y') now.setFullYear(now.getFullYear() - 1);
  return now.toISOString();
}

export async function getAdminTransactions(
  filterType?: string,
  dateRange?: AdminDateRange,
  accessToken?: string,
): Promise<AdminTransaction[]> {
  await requireAdmin(accessToken);

  const startDate = dateRangeStart(dateRange);

  const applyDateFilter = <T extends { gte: (col: string, val: string) => T }>(
    query: T,
  ): T => (startDate ? query.gte('created_at', startDate) : query);

  const [{ data: transfers }, { data: deposits }, { data: withdrawals }, { data: bridges }] =
    await Promise.all([
      applyDateFilter(supabaseAdmin.from('transfers').select('*').order('created_at', { ascending: false })),
      applyDateFilter(supabaseAdmin.from('deposits').select('*').order('created_at', { ascending: false })),
      applyDateFilter(supabaseAdmin.from('withdrawals').select('*').order('created_at', { ascending: false })),
      applyDateFilter(supabaseAdmin.from('bridge_transactions').select('*').order('created_at', { ascending: false })),
    ]);

  const all: AdminTransaction[] = [
    ...(transfers || []).map((t) => ({ ...t, tx_type: 'transfer' as const })),
    ...(deposits || []).map((d) => ({ ...d, tx_type: 'deposit' as const, amount: d.amount_usdc || 0 })),
    ...(withdrawals || []).map((w) => ({ ...w, tx_type: 'withdrawal' as const, amount: w.amount_usdc || 0 })),
    ...(bridges || []).map((b) => ({ ...b, tx_type: 'bridge' as const, status: b.attestation_status })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return filterType ? all.filter((t) => t.tx_type === filterType) : all;
}

export async function getAdminUsers(accessToken?: string) {
  await requireAdmin(accessToken);

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const [{ data: d }, { data: w }, { data: t }, { data: b }] = await Promise.all([
    supabaseAdmin.from('deposits').select('user_id, amount_usdc, status'),
    supabaseAdmin.from('withdrawals').select('user_id, amount_usdc, status'),
    supabaseAdmin.from('transfers').select('sender_id, sender_email, recipient_id, recipient_email, amount, status'),
    supabaseAdmin.from('bridge_transactions').select('user_id, amount, attestation_status'),
  ]);

  return users.map((user) => {
    const userEmail = user.email.toLowerCase();
    const userDeposits = d?.filter((x) => x.user_id === user.id && x.status === 'confirmed') || [];
    const total_deposits = userDeposits.reduce((a, b) => a + (Number(b.amount_usdc) || 0), 0);
    const userWithdrawals = w?.filter((x) => x.user_id === user.id && x.status === 'completed') || [];
    const total_withdrawals = userWithdrawals.reduce((a, b) => a + (Number(b.amount_usdc) || 0), 0);
    const userTransfersSent = t?.filter((x) => (x.sender_id === user.id || x.sender_email?.toLowerCase() === userEmail) && x.status === 'completed') || [];
    const total_sent = userTransfersSent.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const userTransfersReceived = t?.filter((x) => (x.recipient_id === user.id || x.recipient_email?.toLowerCase() === userEmail) && x.status === 'completed') || [];
    const total_received = userTransfersReceived.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    const userBridges = b?.filter((x) => x.user_id === user.id && x.attestation_status === 'complete') || [];
    const total_bridge = userBridges.reduce((a, b) => a + (Number(b.amount) || 0), 0);
    return { ...user, total_volume: total_deposits + total_withdrawals + total_sent + total_received + total_bridge, total_deposits, total_withdrawals, total_sent, total_received, total_bridge };
  });
}

/**
 * Everything the admin user-detail view needs for one account, in a single round-trip:
 * profile, wallets, KYC state, lifetime totals, and the transactions inside `dateRange`.
 *
 * Totals are deliberately LIFETIME and independent of `dateRange` — they describe the account,
 * so re-filtering the table shouldn't appear to change how much the user has ever moved. Only
 * `transactions` narrows, and that's what the table and the export both read.
 *
 * Transfers are matched on id OR email because a transfer can predate the recipient having an
 * account: `recipient_id` is null until they sign up, and the email is the only link back. The
 * same rule is used by the user's own history, so admin and user see the same set.
 */
export async function getAdminUserDetail(
  userId: string,
  dateRange: AdminDateRange = '30d',
  accessToken?: string,
): Promise<AdminUserDetail> {
  await requireAdmin(accessToken);

  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (userError || !user) throw new Error('User not found');
  const email = user.email.toLowerCase();

  const startDate = dateRangeStart(dateRange);
  const inRange = <T extends { gte: (col: string, val: string) => T }>(q: T): T =>
    startDate ? q.gte('created_at', startDate) : q;

  const [{ data: kyc }, { data: deposits }, { data: withdrawals }, { data: transfers }, { data: bridges }] =
    await Promise.all([
      supabaseAdmin
        .from('kyc_verifications')
        .select('status, didit_session_id, updated_at')
        .eq('user_id', userId)
        .maybeSingle(),
      inRange(supabaseAdmin.from('deposits').select('*').eq('user_id', userId)),
      inRange(supabaseAdmin.from('withdrawals').select('*').eq('user_id', userId)),
      inRange(
        supabaseAdmin
          .from('transfers')
          .select('*')
          .or(
            `sender_id.eq.${userId},recipient_id.eq.${userId},` +
              `sender_email.eq.${email},recipient_email.eq.${email}`,
          ),
      ),
      inRange(supabaseAdmin.from('bridge_transactions').select('*').eq('user_id', userId)),
    ]);

  const transactions: AdminTransaction[] = [
    ...(transfers ?? []).map((t) => ({ ...t, tx_type: 'transfer' as const })),
    ...(deposits ?? []).map((d) => ({ ...d, tx_type: 'deposit' as const, amount: d.amount_usdc || 0 })),
    ...(withdrawals ?? []).map((w) => ({ ...w, tx_type: 'withdrawal' as const, amount: w.amount_usdc || 0 })),
    ...(bridges ?? []).map((b) => ({ ...b, tx_type: 'bridge' as const, status: b.attestation_status })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Lifetime totals — a separate, unfiltered pass. Only settled rows count, matching the
  // definitions used by the directory and the platform stats so the numbers reconcile.
  const [{ data: allD }, { data: allW }, { data: allT }, { data: allB }] = await Promise.all([
    supabaseAdmin.from('deposits').select('amount_usdc, status').eq('user_id', userId),
    supabaseAdmin.from('withdrawals').select('amount_usdc, status').eq('user_id', userId),
    supabaseAdmin
      .from('transfers')
      .select('sender_id, sender_email, recipient_id, recipient_email, amount, status')
      .or(
        `sender_id.eq.${userId},recipient_id.eq.${userId},` +
          `sender_email.eq.${email},recipient_email.eq.${email}`,
      ),
    supabaseAdmin.from('bridge_transactions').select('amount, attestation_status').eq('user_id', userId),
  ]);

  const sum = (rows: { amount?: unknown; amount_usdc?: unknown }[]) =>
    rows.reduce((acc, r) => acc + (Number(r.amount ?? r.amount_usdc) || 0), 0);

  const isSender = (t: { sender_id?: string | null; sender_email?: string | null }) =>
    t.sender_id === userId || t.sender_email?.toLowerCase() === email;

  const totalDeposits = sum((allD ?? []).filter((x) => x.status === 'confirmed'));
  const totalWithdrawals = sum((allW ?? []).filter((x) => x.status === 'completed'));
  const settledTransfers = (allT ?? []).filter((x) => x.status === 'completed');
  const totalSent = sum(settledTransfers.filter(isSender));
  const totalReceived = sum(settledTransfers.filter((t) => !isSender(t)));
  const totalBridged = sum((allB ?? []).filter((x) => x.attestation_status === 'complete'));

  return {
    user,
    kyc: {
      status: kyc?.status ?? 'not_started',
      diditSessionId: kyc?.didit_session_id ?? null,
      updatedAt: kyc?.updated_at ?? null,
      // Built server-side so the console template never has to reach the browser.
      consoleUrl: kyc?.didit_session_id ? diditConsoleSessionUrl(kyc.didit_session_id) : null,
    },
    totals: {
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      sent: totalSent,
      received: totalReceived,
      bridged: totalBridged,
      volume: totalDeposits + totalWithdrawals + totalSent + totalReceived + totalBridged,
    },
    transactions,
  };
}

export async function getAdminAnalytics(
  period: '7d' | '30d' | 'all' = '7d',
  accessToken?: string,
) {
  await requireAdmin(accessToken);

  const days = period === 'all' ? 90 : period === '30d' ? 30 : 7;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateIso = startDate.toISOString();

  const [{ data: transfers }, { data: deposits }, { data: withdrawals }, { data: bridges }, { data: newUsers }] =
    await Promise.all([
      supabaseAdmin.from('transfers').select('amount, status, created_at').gte('created_at', startDateIso),
      supabaseAdmin.from('deposits').select('amount_usdc, status, created_at').gte('created_at', startDateIso),
      supabaseAdmin.from('withdrawals').select('amount_usdc, status, created_at').gte('created_at', startDateIso),
      supabaseAdmin.from('bridge_transactions').select('amount, attestation_status, created_at').gte('created_at', startDateIso),
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
    ...(withdrawals || []).filter((x) => x.status === 'completed' && x.created_at).map((x) => ({ a: Number(x.amount_usdc), d: x.created_at })),
    ...(bridges || []).filter((x) => x.attestation_status === 'complete' && x.created_at).map((x) => ({ a: Number(x.amount), d: x.created_at })),
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

export async function getAdminLogs(type: 'webhooks' | 'audit', accessToken?: string) {
  await requireAdmin(accessToken);

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

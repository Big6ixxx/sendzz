'use server';

import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceRole);

export async function getUserAddressByEmail(
  email: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('smart_account_address')
    .eq('email', email)
    .single();

  if (error || !data) return null;
  return data.smart_account_address;
}

export async function registerUserAddress(email: string, address: string) {
  const { error } = await supabaseAdmin
    .from('users')
    .upsert({ email, smart_account_address: address }, { onConflict: 'email' });

  if (error) throw new Error(`Failed to map address: ${error.message}`);
}

export async function recordTransfer(params: {
  senderEmail: string;
  recipientEmail: string;
  amount: number;
  status: 'completed' | 'pending_claim';
  note?: string;
  txHash?: string;
}) {
  try {
    console.log(`[Supabase] Recording transfer: ${params.senderEmail} -> ${params.recipientEmail} ($${params.amount})`);
    
    // 1. Get sender and recipient internal IDs from the public.users table
    const { data: users, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .or(`email.eq.${params.senderEmail},email.eq.${params.recipientEmail}`);

    if (fetchError) {
      console.error('[Supabase] Failed to fetch users for recording:', fetchError);
      return;
    }

    const sender = users?.find((u) => u.email === params.senderEmail);
    const recipient = users?.find((u) => u.email === params.recipientEmail);

    if (!sender) {
      console.warn(`[Supabase] Sender ${params.senderEmail} not found in users table. Skipping record.`);
      return;
    }

    console.log(`[Supabase] Resolved IDs - Sender: ${sender.id}, Recipient: ${recipient?.id || 'NULL'}`);

    // 2. Insert record into transfers table
    const { error: insertError } = await supabaseAdmin.from('transfers').insert({
      sender_id: sender.id,
      sender_email: params.senderEmail,
      recipient_id: recipient?.id || null,
      recipient_email: params.recipientEmail,
      amount: params.amount,
      status: params.status,
      note: params.note || null,
      tx_hash: params.txHash || null,
      asset: 'USDC',
    });

    if (insertError) {
      console.error('[Supabase Actions] Failed to record transfer:', insertError);
    } else {
      console.log('[Supabase] Transfer recorded successfully');
    }
  } catch (err) {
    console.error('[Supabase Actions] Critical failure in recordTransfer:', err);
  }
}

export async function recordDeposit(params: {
  userEmail: string;
  amountFiat: number;
  currencyFiat: string;
  amountUsdc: number;
  status: 'pending' | 'confirmed';
  paycrestTxId?: string;
}) {
  try {
    console.log(`[Supabase] recordDeposit start for ${params.userEmail}`);
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', params.userEmail)
      .single();

    if (userError || !user) {
      console.error(`[Supabase] recordDeposit: User not found for email ${params.userEmail}`, userError);
      return;
    }

    console.log(`[Supabase] recordDeposit: Found user ID ${user.id}. Attempting insert...`);

    const { error: insertError } = await supabaseAdmin.from('deposits').insert({
      user_id: user.id,
      amount_fiat: params.amountFiat,
      currency_fiat: params.currencyFiat,
      amount_usdc: params.amountUsdc,
      status: params.status,
      paycrest_tx_id: params.paycrestTxId || null,
    });

    if (insertError) {
      console.error('[Supabase] recordDeposit: INSERT ERROR', insertError);
      return;
    }
    console.log(`[Supabase] recordDeposit: SUCCESS for ${params.paycrestTxId}`);
  } catch (err) {
    console.error('[Supabase Actions] Critical failure in recordDeposit:', err);
  }
}

export async function updateDepositStatus(paycrestTxId: string, status: 'confirmed' | 'failed') {
  try {
    const { error } = await supabaseAdmin
      .from('deposits')
      .update({ status })
      .eq('paycrest_tx_id', paycrestTxId);

    if (error) throw error;
    console.log(`[Supabase] Deposit ${paycrestTxId} status updated to ${status}`);
  } catch (err) {
    console.error('[Supabase Actions] Failed to update deposit status:', err);
  }
}

export async function recordWithdrawal(params: {
  userEmail: string;
  amountUsdc: number;
  fiatCurrency: string;
  bankAccountMasked: string;
  institutionCode: string;
  status: 'processing' | 'completed';
  paycrestOrderId?: string;
}) {
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', params.userEmail)
      .single();

    if (!user) throw new Error('User not found');

    const { error: insertError } = await supabaseAdmin.from('withdrawals').insert({
      user_id: user.id,
      amount_usdc: params.amountUsdc,
      fiat_currency: params.fiatCurrency,
      bank_account_masked: params.bankAccountMasked,
      institution_code: params.institutionCode,
      status: params.status,
      paycrest_order_id: params.paycrestOrderId || null,
      verification_status: 'verified', // If it reached this stage, we assume verified for now
    });

    if (insertError) {
      if (insertError.code === '23503') {
        console.error(`[Supabase] WITHDRAWAL FAILED: Foreign key violation. The 'withdrawals' table is likely pointing to 'auth.users' instead of 'public.users'.`);
      } else {
        console.error('[Supabase Actions] Failed to record withdrawal:', insertError.message);
      }
      return;
    }
    console.log(`[Supabase] Withdrawal recorded successfully: ${params.paycrestOrderId}`);
  } catch (err) {
    console.error('[Supabase Actions] Critical failure in recordWithdrawal:', err);
  }
}

export async function getUserActivities(userEmail: string) {
  try {
    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', userEmail)
      .single();

    const internalId = userRecord?.id;
    if (!internalId) return { sent: [], received: [], deposits: [], withdrawals: [] };

    const { data: sent } = await supabaseAdmin
      .from('transfers')
      .select('*, sender:sender_id(email)')
      .eq('sender_id', internalId);

    const { data: received } = await supabaseAdmin
      .from('transfers')
      .select('*, sender:sender_id(email)')
      .or(`recipient_id.eq.${internalId},recipient_email.eq.${userEmail}`);

    const { data: deposits } = await supabaseAdmin
      .from('deposits')
      .select('*')
      .eq('user_id', internalId);

    const { data: withdrawals } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('user_id', internalId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapTransfer = (t: any) => ({
      ...t,
      sender_email: t.sender_email || t.sender?.email || 'Unknown Sender',
      tx_hash: t.tx_hash || (t.note?.startsWith('0x') ? t.note : null)
    });

    return {
      sent: (sent || []).map(mapTransfer),
      received: (received || []).map(mapTransfer),
      deposits: deposits || [],
      withdrawals: withdrawals || [],
    };
  } catch (err) {
    console.error('[Supabase Actions] Failed to fetch activities:', err);
    return { sent: [], received: [], deposits: [], withdrawals: [] };
  }
}

// --- ADMIN ACTIONS ---

async function verifyAdmin(email: string | undefined) {
    if (!email) return false;
    
    try {
        const { data, error } = await supabaseAdmin
            .from('platform_admins')
            .select('email')
            .eq('email', email.toLowerCase())
            .single();

        if (data && !error) {
            return true;
        }
    } catch (err) {
        console.error('[Admin Auth] DB query failed, falling back to ENV:', err);
    }

    // Fallback for disaster recovery: check .env if DB query fails or user not found in table
    const serverAdmins = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
    return serverAdmins.includes(email.toLowerCase());
}

export async function checkIsAdmin(email: string | undefined) {
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
        { data: activeT }
    ] = await Promise.all([
        supabaseAdmin.from('deposits').select('amount_usdc, status'),
        supabaseAdmin.from('withdrawals').select('amount_usdc, status'),
        supabaseAdmin.from('transfers').select('amount, status'),
        supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
        // For active users calculation
        supabaseAdmin.from('deposits').select('user_id').gte('created_at', last24h),
        supabaseAdmin.from('withdrawals').select('user_id').gte('created_at', last24h),
        supabaseAdmin.from('transfers').select('sender_id, recipient_id').gte('created_at', last24h)
    ]);

    // Calculate Active Users (Unique IDs in last 24h)
    const activeUserIds = new Set([
        ...(activeD || []).map(x => x.user_id),
        ...(activeW || []).map(x => x.user_id),
        ...(activeT || []).map(x => x.sender_id),
        ...(activeT || []).map(x => x.recipient_id).filter(Boolean)
    ]);

    // Filter and sum
    const confirmedDeposits = d?.filter(x => x.status === 'confirmed') || [];
    const confirmedWithdrawals = w?.filter(x => x.status === 'completed' || x.status === 'processing') || [];
    const confirmedTransfers = t?.filter(x => x.status === 'completed') || [];

    const totalDeposits = confirmedDeposits.reduce((acc, curr) => acc + (Number(curr.amount_usdc) || 0), 0);
    const totalWithdrawals = confirmedWithdrawals.reduce((acc, curr) => acc + (Number(curr.amount_usdc) || 0), 0);
    const totalTransfers = confirmedTransfers.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    // Pending calculations
    const pendingDepositsCount = d?.filter(x => x.status === 'pending').length || 0;
    const pendingWithdrawalsCount = w?.filter(x => x.status === 'processing' || x.status === 'awaiting_verification').length || 0;

    return {
        totalUsers: u || 0,
        totalVolume: totalDeposits + totalWithdrawals + totalTransfers,
        totalDeposits,
        totalWithdrawals,
        totalTransfers,
        activeUsers24h: activeUserIds.size,
        pendingActions: pendingDepositsCount + pendingWithdrawalsCount
    };
}

export async function getAdminTransactions(adminEmail: string, filterType?: string) {
    if (!(await verifyAdmin(adminEmail))) throw new Error('Unauthorized');

    const [{ data: transfers }, { data: deposits }, { data: withdrawals }] = await Promise.all([
        supabaseAdmin.from('transfers').select('*').order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('deposits').select('*').order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(50)
    ]);

    const all = [
        ...(transfers || []).map(t => ({ ...t, tx_type: 'transfer' })),
        ...(deposits || []).map(d => ({ ...d, tx_type: 'deposit', amount: d.amount_usdc })),
        ...(withdrawals || []).map(w => ({ ...w, tx_type: 'withdrawal', amount: w.amount_usdc }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return filterType ? all.filter(t => t.tx_type === filterType) : all;
}

export async function getAdminUsers(adminEmail: string) {
    if (!(await verifyAdmin(adminEmail))) throw new Error('Unauthorized');

    // Fetch users and their transaction totals
    const { data: users, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch all confirmed transactions to calculate volume per user
    const [{ data: d }, { data: w }, { data: t }] = await Promise.all([
        supabaseAdmin.from('deposits').select('user_id, amount_usdc, status'),
        supabaseAdmin.from('withdrawals').select('user_id, amount_usdc, status'),
        supabaseAdmin.from('transfers').select('sender_id, sender_email, recipient_id, recipient_email, amount, status')
    ]);

    const usersWithVolume = users.map(user => {
        const userEmail = user.email.toLowerCase();
        
        // Deposits
        const userDeposits = d?.filter(x => x.user_id === user.id && x.status === 'confirmed') || [];
        const total_deposits = userDeposits.reduce((a, b) => a + (Number(b.amount_usdc) || 0), 0);
        
        // Withdrawals
        const userWithdrawals = w?.filter(x => x.user_id === user.id && (x.status === 'completed' || x.status === 'processing')) || [];
        const total_withdrawals = userWithdrawals.reduce((a, b) => a + (Number(b.amount_usdc) || 0), 0);
        
        // Transfers
        const userTransfersSent = t?.filter(x => 
            (x.sender_id === user.id || x.sender_email?.toLowerCase() === userEmail) && 
            x.status === 'completed'
        ) || [];
        const total_sent = userTransfersSent.reduce((a, b) => a + (Number(b.amount) || 0), 0);

        const userTransfersReceived = t?.filter(x => 
            (x.recipient_id === user.id || x.recipient_email?.toLowerCase() === userEmail) && 
            x.status === 'completed'
        ) || [];
        const total_received = userTransfersReceived.reduce((a, b) => a + (Number(b.amount) || 0), 0);
        
        return {
            ...user,
            total_volume: total_deposits + total_withdrawals + total_sent + total_received,
            total_deposits,
            total_withdrawals,
            total_sent,
            total_received
        };
    });

    return usersWithVolume;
}

export async function getAdminAnalytics(email: string | undefined, period: '7d' | '30d' | 'all' = '7d') {
    if (!email || !(await verifyAdmin(email))) {
        throw new Error('Unauthorized');
    }

    const days = period === 'all' ? 90 : (period === '30d' ? 30 : 7); // Default 'all' to 90 days for now
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateIso = startDate.toISOString();

    const [{ data: transfers }, { data: deposits }, { data: withdrawals }, { data: newUsers }] = await Promise.all([
        supabaseAdmin.from('transfers').select('amount, status, created_at').gte('created_at', startDateIso),
        supabaseAdmin.from('deposits').select('amount_usdc, status, created_at').gte('created_at', startDateIso),
        supabaseAdmin.from('withdrawals').select('amount_usdc, status, created_at').gte('created_at', startDateIso),
        supabaseAdmin.from('users').select('created_at').gte('created_at', startDateIso)
    ]);

    // Group by date
    const chartData: Record<string, { date: string, volume: number, users: number }> = {};
    
    // Initialize chart data with 0s for the period
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        chartData[dateStr] = { date: dateStr, volume: 0, users: 0 };
    }

    // Populate volumes (only confirmed/completed)
    const validTransfers = (transfers || []).filter(x => x.status === 'completed' && x.created_at).map(x => ({ a: Number(x.amount), d: x.created_at }));
    const validDeposits = (deposits || []).filter(x => x.status === 'confirmed' && x.created_at).map(x => ({ a: Number(x.amount_usdc), d: x.created_at }));
    const validWithdrawals = (withdrawals || []).filter(x => (x.status === 'completed' || x.status === 'processing') && x.created_at).map(x => ({ a: Number(x.amount_usdc), d: x.created_at }));

    [...validTransfers, ...validDeposits, ...validWithdrawals].forEach(tx => {
        if (!tx.d) return;
        const dateStr = tx.d.split('T')[0];
        if (chartData[dateStr]) {
            chartData[dateStr].volume += tx.a;
        }
    });

    // Populate new users
    (newUsers || []).forEach(u => {
        if (!u.created_at) return;
        const dateStr = u.created_at.split('T')[0];
        if (chartData[dateStr]) {
            chartData[dateStr].users += 1;
        }
    });

    return Object.values(chartData).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAdminLogs(adminEmail: string, type: 'webhooks' | 'audit') {
    if (!(await verifyAdmin(adminEmail))) throw new Error('Unauthorized');

    if (type === 'webhooks') {
        const { data, error } = await supabaseAdmin
            .from('webhook_events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        return data || [];
    } else {
        const { data, error } = await supabaseAdmin
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        return data || [];
    }
}

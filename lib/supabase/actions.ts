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
      note: params.txHash || params.note || null, // Store txHash in note for explorer links
      asset: 'USDC',
    });

    if (insertError) {
      if (insertError.code === '23503') {
        console.warn(`[Supabase] ACTION REQUIRED: The 'transfers' table has a foreign key constraint pointing to 'auth.users', but you are using Privy. Please update the 'transfers_sender_id_fkey' in your Supabase dashboard to point to 'public.users(id)'.`);
      } else {
        console.error('[Supabase Actions] Failed to record transfer:', insertError);
      }
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
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', params.userEmail)
      .single();

    if (!user) throw new Error('User not found');

    const { error } = await supabaseAdmin.from('deposits').insert({
      user_id: user.id,
      amount_fiat: params.amountFiat,
      currency_fiat: params.currencyFiat,
      amount_usdc: params.amountUsdc,
      status: params.status,
      paycrest_tx_id: params.paycrestTxId || null,
    });

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase Actions] Failed to record deposit:', err);
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

    const { error } = await supabaseAdmin.from('withdrawals').insert({
      user_id: user.id,
      amount_usdc: params.amountUsdc,
      fiat_currency: params.fiatCurrency,
      bank_account_masked: params.bankAccountMasked,
      institution_code: params.institutionCode,
      status: params.status,
      paycrest_order_id: params.paycrestOrderId || null,
      verification_status: 'verified', // If it reached this stage, we assume verified for now
    });

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase Actions] Failed to record withdrawal:', err);
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

    // Fetch sent transfers with sender email (joined or column)
    const { data: sent } = await supabaseAdmin
      .from('transfers')
      .select('*, sender:sender_id(email)')
      .eq('sender_id', internalId);

    // Fetch received transfers with sender email (joined or column)
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

    // Process transfers to include sender_email if column is null
    const mapTransfer = (t: any) => ({
      ...t,
      sender_email: t.sender_email || t.sender?.email || 'Unknown Sender'
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

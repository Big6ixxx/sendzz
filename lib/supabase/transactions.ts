'use server';

import { Database } from '@/types/database';
import { supabaseAdmin } from './adminClient';

type TransferRow = Database['public']['Tables']['transfers']['Row'];

// --- TRANSFERS ---

export async function recordTransfer(params: {
  senderEmail: string;
  recipientEmail: string;
  amount: number;
  status: 'completed' | 'pending_claim';
  note?: string;
  txHash?: string;
}): Promise<void> {
  try {
    console.log(
      `[Supabase] Recording transfer: ${params.senderEmail} -> ${params.recipientEmail} ($${params.amount})`,
    );

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
      console.warn(`[Supabase] Sender ${params.senderEmail} not found. Skipping.`);
      return;
    }

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
      console.error('[Supabase] Failed to record transfer:', insertError);
    } else {
      console.log('[Supabase] Transfer recorded successfully');
    }
  } catch (err) {
    console.error('[Supabase] Critical failure in recordTransfer:', err);
  }
}

// --- DEPOSITS ---

export async function recordDeposit(params: {
  userEmail: string;
  amountFiat: number;
  currencyFiat: string;
  amountUsdc: number;
  status: 'pending' | 'confirmed';
  paycrestTxId?: string;
}): Promise<void> {
  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', params.userEmail)
      .single();

    if (userError || !user) {
      console.error(`[Supabase] recordDeposit: User not found for ${params.userEmail}`, userError);
      return;
    }

    const { error: insertError } = await supabaseAdmin.from('deposits').insert({
      user_id: user.id,
      amount_fiat: params.amountFiat,
      currency_fiat: params.currencyFiat,
      amount_usdc: params.amountUsdc,
      status: params.status,
      paycrest_tx_id: params.paycrestTxId || null,
    });

    if (insertError) {
      console.error('[Supabase] recordDeposit INSERT ERROR:', insertError);
      return;
    }
    console.log(`[Supabase] recordDeposit SUCCESS for ${params.paycrestTxId}`);
  } catch (err) {
    console.error('[Supabase] Critical failure in recordDeposit:', err);
  }
}

export async function updateDepositStatus(
  paycrestTxId: string,
  status: 'confirmed' | 'failed',
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('deposits')
      .update({ status })
      .eq('paycrest_tx_id', paycrestTxId);

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] Failed to update deposit status:', err);
  }
}

// --- WITHDRAWALS ---

export async function recordWithdrawal(params: {
  userEmail: string;
  amountUsdc: number;
  fiatCurrency: string;
  bankAccountMasked: string;
  institutionCode: string;
  status: 'processing' | 'completed';
  paycrestOrderId?: string;
}): Promise<void> {
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
      verification_status: 'verified',
    });

    if (insertError) {
      console.error('[Supabase] Failed to record withdrawal:', insertError.message);
      return;
    }
    console.log(`[Supabase] Withdrawal recorded: ${params.paycrestOrderId}`);
  } catch (err) {
    console.error('[Supabase] Critical failure in recordWithdrawal:', err);
  }
}

export async function updateWithdrawalStatus(
  paycrestOrderId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('withdrawals')
      .update({ status })
      .eq('paycrest_order_id', paycrestOrderId);

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] Failed to update withdrawal status:', err);
  }
}

// --- BRIDGE TRANSACTIONS ---

export async function recordBridgeTransaction(params: {
  userEmail: string;
  sourceChain: string;
  destChain: string;
  amountUsdc: number;
  burnTxHash: string;
}): Promise<void> {
  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', params.userEmail.trim())
      .single();

    if (userError || !user) {
      console.error(`[Supabase] User not found for bridge: ${params.userEmail}`);
      return;
    }

    const { error } = await supabaseAdmin.from('bridge_transactions').insert({
      user_id: user.id,
      source_chain: params.sourceChain,
      dest_chain: params.destChain,
      amount: params.amountUsdc,
      burn_tx_hash: params.burnTxHash,
      attestation_status: 'pending',
    });

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] Failed to record bridge tx:', err);
  }
}

export async function updateBridgeStatus(
  burnTxHash: string,
  status: 'complete' | 'failed',
  mintTxHash?: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('bridge_transactions')
      .update({
        attestation_status: status as 'complete' | 'failed' | 'pending',
        mint_tx_hash: mintTxHash || null,
        updated_at: new Date().toISOString(),
      })
      .eq('burn_tx_hash', burnTxHash);

    if (error) throw error;
  } catch (err) {
    console.error('[Supabase] Failed to update bridge status:', err);
  }
}

// --- ACTIVITY HISTORY ---

export async function getUserActivities(userEmail: string) {
  try {
    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('id')
      .ilike('email', userEmail.trim())
      .single();

    const internalId = userRecord?.id;
    if (!internalId)
      return { sent: [], received: [], deposits: [], withdrawals: [], bridges: [] };

    const [
      { data: sent },
      { data: received },
      { data: deposits },
      { data: withdrawals },
      { data: bridges },
    ] = await Promise.all([
      supabaseAdmin.from('transfers').select('*, sender:sender_id(email)').eq('sender_id', internalId),
      supabaseAdmin.from('transfers').select('*, sender:sender_id(email)').or(`recipient_id.eq.${internalId},recipient_email.eq.${userEmail}`),
      supabaseAdmin.from('deposits').select('*').eq('user_id', internalId),
      supabaseAdmin.from('withdrawals').select('*').eq('user_id', internalId),
      supabaseAdmin.from('bridge_transactions').select('*').eq('user_id', internalId),
    ]);

    interface JoinedSender {
      email: string;
    }

    const mapTransfer = (
      t: TransferRow & { sender?: JoinedSender | JoinedSender[] | null | unknown },
    ) => {
      let senderEmail: string | undefined;
      if (t.sender) {
        if (Array.isArray(t.sender)) {
          senderEmail = (t.sender[0] as JoinedSender)?.email;
        } else {
          senderEmail = (t.sender as JoinedSender)?.email;
        }
      }

      return {
        ...t,
        sender_email: t.sender_email || senderEmail || 'Unknown Sender',
        tx_hash: t.tx_hash || (t.note?.startsWith('0x') ? t.note : null),
      };
    };

    return {
      sent: (sent || []).map(mapTransfer),
      received: (received || []).map(mapTransfer),
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      bridges: bridges || [],
    };
  } catch (err) {
    console.error('[Supabase] Failed to fetch activities:', err);
    return { sent: [], received: [], deposits: [], withdrawals: [], bridges: [] };
  }
}

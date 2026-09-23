/**
 * A short-lived code emailed to the account's own address, to confirm something sensitive.
 *
 * Two things use it, for the same underlying reason: the person acting has to prove they hold
 * something the account owner holds, and a mailbox is the one thing every Sendzz user
 * demonstrably has — they signed in with it.
 *
 *   pin_reset        somebody forgot the PIN. The PIN cannot be read back, so the only way
 *                    forward is to prove the mailbox and set a new one.
 *   security_change  somebody is weakening a protection. The PIN is deliberately NOT accepted
 *                    for this — see migration 058 — so email is the fallback for an account
 *                    with no authenticator and no passkey.
 *
 * The address is always the one on the account, never one supplied by the caller. A reset flow
 * that could be pointed at an attacker's mailbox is a way to take an account over, not a way
 * to recover one, and that is the single worst thing this kind of code can get wrong.
 */

import crypto from 'node:crypto';

import { decrypt, encrypt } from '@/lib/encryption';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

/** How long a code is good for. */
const TTL_MS = 10 * 60 * 1000;

/** The quiet period between codes, so an open session cannot spray a mailbox. */
const RESEND_COOLDOWN_MS = 60 * 1000;

export type EmailCodePurpose = 'pin_reset' | 'security_change';

function encryptionKey(): string {
  const key = process.env.TOTP_ENCRYPTION_KEY;
  if (!key) throw new Error('TOTP_ENCRYPTION_KEY is not configured.');
  return key;
}

/**
 * Mint a code and store it. Returns the id to quote back, and the code itself so the caller
 * can put it in whatever email suits the purpose.
 */
export async function issueEmailCode(params: {
  userEmail: string;
  purpose: EmailCodePurpose;
}): Promise<{ id: string; code: string }> {
  const { userEmail, purpose } = params;
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('transaction_otps')
    .delete()
    .lt('expires_at', now)
    .eq('user_email', userEmail);

  const since = new Date(Date.now() - RESEND_COOLDOWN_MS).toISOString();
  const { data: recent } = await supabaseAdmin
    .from('transaction_otps')
    .select('id')
    .eq('user_email', userEmail)
    .eq('action_type', purpose)
    .gt('created_at', since)
    .maybeSingle();

  if (recent) {
    throw new Error('A code was just sent. Check your inbox, or try again in a minute.');
  }

  const code = crypto.randomInt(100000, 999999).toString();

  const { data, error } = await supabaseAdmin
    .from('transaction_otps')
    .insert({
      user_email: userEmail,
      // Encrypted at rest: a database dump should not hand somebody a live code for every
      // account mid-flow.
      otp_code: encrypt(code, encryptionKey()),
      action_type: purpose,
      payload: {},
      expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[EmailCode] could not store code:', error?.message);
    throw new Error('Could not send the code. Please try again.');
  }

  return { id: data.id, code };
}

/**
 * Check a code and spend it.
 *
 * Returns false for anything that simply did not match, so every wrong code is answered
 * identically and nothing distinguishes "expired" from "never existed" from "belongs to
 * somebody else".
 */
export async function consumeEmailCode(params: {
  id: string;
  code: string;
  userEmail: string;
  purpose: EmailCodePurpose;
}): Promise<boolean> {
  try {
    const { data: row } = await supabaseAdmin
      .from('transaction_otps')
      .select('id, user_email, otp_code, action_type, expires_at')
      .eq('id', params.id)
      .maybeSingle();

    if (!row) return false;
    if (row.action_type !== params.purpose) return false;
    if (row.user_email !== params.userEmail) return false;
    if (new Date(row.expires_at) < new Date()) return false;

    if (decrypt(row.otp_code, encryptionKey()) !== params.code) return false;

    // Spent, so one code confirms one thing.
    await supabaseAdmin.from('transaction_otps').delete().eq('id', row.id);
    return true;
  } catch (err) {
    console.error('[EmailCode] verification failed:', (err as Error).message);
    return false;
  }
}

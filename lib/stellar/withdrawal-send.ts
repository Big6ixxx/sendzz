import 'server-only';

/**
 * The one Stellar send that needs no PIN of its own: settling a withdrawal the user already
 * authorised with a PIN when the order was created.
 *
 * The waiver is only as good as the check behind it. Taking `withdrawalOrderId` from the request
 * on trust let any signed-in caller skip the PIN by naming one. So the order is loaded here and
 * the send must be exactly what it was for — this user's, still open, on Stellar, to its deposit
 * address and memo, for no more than its amount and fee — and it can be sent once.
 */
import { getCorridorFee } from '@/lib/ramp/fees';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { isPlaceholderHash, PLACEHOLDER_TX_HASH } from '@/lib/explorers';
import type { RampProviderName } from '@/lib/ramp/types';
import type { Json } from '@/types/database';

const EPSILON = 1e-6;

/** The withdrawal's provider_metadata, as far as this file reads or writes it. */
type Meta = Record<string, unknown> & {
  network?: string;
  deposit_address?: string;
  deposit_memo?: string;
  fee_usdc?: number;
  stellar_send_claimed_at?: string;
  stellar_send_hash?: string;
  brails?: { payoutId?: string; settledAs?: string };
};

export type WithdrawalSendCheck = { ok: true; rowId: string } | { ok: false; reason: string };

export async function checkWithdrawalSend(params: {
  userEmail: string;
  withdrawalOrderId: string;
  recipientAddress: string;
  amount: number;
  memo?: string;
  feeAmount: number;
}): Promise<WithdrawalSendCheck> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', params.userEmail.trim().toLowerCase())
    .maybeSingle();
  if (!user?.id) return { ok: false, reason: 'no user' };

  const { data: w } = await supabaseAdmin
    .from('withdrawals')
    .select('id, user_id, status, provider, amount_usdc, fiat_currency, tx_hash, provider_metadata, corridor_fee_usdc')
    .eq('provider_order_id', params.withdrawalOrderId)
    .maybeSingle();
  if (!w || w.user_id !== user.id) return { ok: false, reason: 'not this user’s withdrawal' };
  if (w.status !== 'processing') return { ok: false, reason: `withdrawal is ${w.status}` };

  const meta = (w.provider_metadata ?? {}) as Meta;
  if (meta.network !== 'stellar') return { ok: false, reason: 'not a Stellar withdrawal' };
  if (!meta.deposit_address || meta.deposit_address !== params.recipientAddress) {
    return { ok: false, reason: 'recipient is not the withdrawal’s deposit address' };
  }
  if ((meta.deposit_memo ?? '') !== (params.memo ?? '')) return { ok: false, reason: 'memo does not match' };

  // Sent before, or being sent. Only an earlier send that can no longer land frees the order.
  if (!isPlaceholderHash(w.tx_hash) || meta.stellar_send_claimed_at) {
    const sentHash = isPlaceholderHash(w.tx_hash) ? meta.stellar_send_hash ?? null : w.tx_hash;
    if (!(await sendCanNoLongerLand(sentHash, meta.stellar_send_claimed_at))) {
      return { ok: false, reason: 'already sent' };
    }
    if (!(await resetExpiredSend(w.id, w.tx_hash))) return { ok: false, reason: 'already being sent' };
  }

  // The flat fee the order was created with — what its deposit was sized on.
  const corridorFee =
    w.corridor_fee_usdc != null
      ? Number(w.corridor_fee_usdc)
      : getCorridorFee(w.provider as RampProviderName, w.fiat_currency);
  const maxAmount = Number(w.amount_usdc) + corridorFee;
  if (params.amount > maxAmount + EPSILON) return { ok: false, reason: 'amount exceeds the withdrawal' };
  if (params.feeAmount > Number(meta.fee_usdc ?? 0) + EPSILON) {
    return { ok: false, reason: 'fee exceeds the withdrawal’s' };
  }
  return { ok: true, rowId: w.id };
}

/**
 * Payments are built valid for 300 seconds (`setTimeout(300)`), so once that has passed with
 * margin and the ledger has no such transaction, it never will. Anything else — too recent, no
 * hash recorded, or the ledger cannot be asked — is treated as possibly sent.
 */
const SEND_EXPIRES_MS = 6 * 60_000;

async function sendCanNoLongerLand(txHash: string | null, claimedAt?: string): Promise<boolean> {
  if (!claimedAt || Date.now() - Date.parse(claimedAt) < SEND_EXPIRES_MS) return false;
  if (isPlaceholderHash(txHash)) return false;
  const { ledgerTransaction } = await import('@/lib/stellar/privy-wallet');
  const onLedger = await ledgerTransaction(txHash!);
  // Absent (Horizon's 404) or failed on-chain: nothing moved. Landed, or Horizon could not say:
  // treat as sent — a wrong "absent" is how a payment gets made twice.
  return onLedger.state === 'absent' || onLedger.state === 'failed';
}

/**
 * Change this row's provider_metadata without erasing a concurrent write to it.
 *
 * The Brails webhooks write the same column (lib/ramp/brails-payout.ts). Writing back a copy
 * read earlier would erase whatever they wrote in between, so each write is guarded on the
 * fields any writer claims — the Brails payout and settlement claims and this send's own claim —
 * being what was read, and a lost race re-reads and tries again. `change` returns the new
 * metadata (and any column to set alongside), or null when its precondition no longer holds.
 */
async function updateSendMeta(
  rowId: string,
  change: (meta: Meta) => { meta: Meta; txHash?: null } | null,
  onlyIfTxHash?: string | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await supabaseAdmin.from('withdrawals').select('provider_metadata').eq('id', rowId).maybeSingle();
    const current = (data?.provider_metadata ?? {}) as Meta;
    const next = change(current);
    if (!next) return false;

    let update = supabaseAdmin
      .from('withdrawals')
      .update({ provider_metadata: next.meta as Json, ...(next.txHash === null ? { tx_hash: null } : {}) })
      .eq('id', rowId);
    const guard = (path: string, value: string | undefined) => {
      update = value == null ? update.is(path, null) : update.eq(path, value);
    };
    guard('provider_metadata->brails->>payoutId', current.brails?.payoutId);
    guard('provider_metadata->brails->>settledAs', current.brails?.settledAs);
    guard('provider_metadata->>stellar_send_claimed_at', current.stellar_send_claimed_at);
    if (onlyIfTxHash !== undefined) {
      update = onlyIfTxHash && !isPlaceholderHash(onlyIfTxHash)
        ? update.eq('tx_hash', onlyIfTxHash)
        : update.or(`tx_hash.is.null,tx_hash.eq.${PLACEHOLDER_TX_HASH}`);
    }
    const { data: written } = await update.select('id');
    if (written?.length) return true;
  }
  return false;
}

function withoutSendClaim(meta: Meta): Meta {
  const rest = { ...meta };
  delete rest.stellar_send_claimed_at;
  delete rest.stellar_send_hash;
  return rest;
}

/** Clear an expired send's hash and claim, only if they are still the ones that expired. */
async function resetExpiredSend(rowId: string, staleHash: string | null): Promise<boolean> {
  const reset = await updateSendMeta(rowId, (meta) => ({ meta: withoutSendClaim(meta), txHash: null }), staleHash);
  if (reset) console.warn(`[Stellar/Send] Withdrawal ${rowId}: earlier send ${staleHash} expired unsent — may be sent again.`);
  return reset;
}

/**
 * Mark the withdrawal's Stellar send as under way, atomically, so two requests for the same
 * order cannot both sign. False when another request got there first.
 */
export function claimWithdrawalSend(rowId: string): Promise<boolean> {
  return updateSendMeta(rowId, (meta) =>
    meta.stellar_send_claimed_at ? null : { meta: { ...meta, stellar_send_claimed_at: new Date().toISOString() } },
  );
}

/**
 * Record the payment's hash on the claim before it is submitted, so if this request dies
 * mid-submit a retry can still ask the ledger whether it went out.
 */
export async function noteWithdrawalSendHash(rowId: string, hash: string): Promise<void> {
  await updateSendMeta(rowId, (meta) =>
    meta.stellar_send_claimed_at ? { meta: { ...meta, stellar_send_hash: hash } } : null,
  );
}

/** Give the claim back when nothing was broadcast, so the user can try again. */
export async function releaseWithdrawalSend(rowId: string): Promise<void> {
  await updateSendMeta(rowId, (meta) => (meta.stellar_send_claimed_at ? { meta: withoutSendClaim(meta) } : null));
}

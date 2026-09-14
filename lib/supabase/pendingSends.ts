/**
 * Sends that were broadcast but not yet confirmed.
 *
 * The safety property that matters here: **a transfer is only ever recorded for a transaction
 * Sendzz itself broadcast, and only once the chain confirms that exact hash succeeded.** Nothing
 * in this module can invent history — it never looks at a wallet and guesses what a transaction
 * was, it only answers "did the thing we were about to send actually land?"
 *
 * Migration 049 records why the alternative — scanning wallets for unrecorded outgoing USDC —
 * was rejected.
 */

import 'server-only';

import { supabaseAdmin } from './adminClient';
import { isEvmUsdcChain } from '@/lib/circle/gateway';
import { STELLAR_HORIZON_URL } from '@/lib/stellar/config';
import { redactEmail } from '@/lib/log';

/**
 * When a send can be declared impossible, which is the only moment it is safe to forget.
 *
 * Stellar is exact: transactions carry a 300s timebound, so past it inclusion is not merely
 * unlikely, it is rejected by the protocol. Writing off at that point cannot discard a payment
 * that later happens.
 *
 * A UserOperation has no such guarantee. A bundler may hold one far longer than expected, and
 * forgetting it early would silently recreate the bug this table exists to close — so EVM gets a
 * day. A stale row costs nothing; a forgotten payment costs a user their history.
 */
function validityMs(chain: string): number {
  return chain === 'stellar' ? 300_000 : 24 * 60 * 60 * 1000;
}

/** Give a transaction its full window before writing it off. */
const WRITE_OFF_GRACE_MS = 60_000;

export interface PendingSendInput {
  userId: string;
  txHash: string;
  chain: string;
  senderEmail: string;
  recipient: string;
  amount: number;
  note?: string;
}

/**
 * Write down a send immediately BEFORE broadcasting it.
 *
 * Never throws. This runs on the payment path, and a bookkeeping failure must not stop a
 * transfer the user asked for — it only costs us the ability to self-heal that one send.
 */
export async function markSendPending(input: PendingSendInput): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('pending_sends').insert({
      user_id: input.userId,
      tx_hash: input.txHash,
      chain: input.chain,
      sender_email: input.senderEmail,
      recipient: input.recipient,
      amount: input.amount,
      note: input.note ?? null,
      expires_at: new Date(Date.now() + validityMs(input.chain)).toISOString(),
    });
    if (error) console.error('[PendingSends] could not record intent:', error.message);
  } catch (err) {
    console.error('[PendingSends] markSendPending failed:', (err as Error).message);
  }
}

/**
 * Drop one recipient's intent, once its transfer is recorded or it can never land.
 *
 * By row id, not by hash: the recipients of a batch share a hash, and deleting by that would
 * discard the ones this pass has not reached yet.
 */
export async function clearPendingSend(id: string): Promise<void> {
  try {
    await supabaseAdmin.from('pending_sends').delete().eq('id', id);
  } catch (err) {
    console.error('[PendingSends] clearPendingSend failed:', (err as Error).message);
  }
}

/**
 * Write the ledger row for a send the chain has confirmed.
 *
 * Deliberately separate from `recordTransfer`, which derives its sender from the session. There
 * is no session in a cron, and weakening `recordTransfer` to accept a caller-supplied sender
 * would reopen the hole that was just closed. This takes an explicit user id because it is
 * server-internal and unreachable from a browser.
 *
 * Idempotent, per recipient: a batch writes one transfer per person under a shared hash, so
 * matching on the hash alone would treat everyone after the first as already recorded and
 * silently drop them.
 */
async function recordConfirmedSend(row: {
  user_id: string;
  tx_hash: string;
  chain: string;
  sender_email: string;
  recipient: string;
  amount: number;
  note: string | null;
}): Promise<boolean> {
  const { data: already } = await supabaseAdmin
    .from('transfers')
    .select('id')
    .eq('tx_hash', row.tx_hash)
    .eq('recipient_email', row.recipient.toLowerCase())
    .maybeSingle();
  if (already) return false;

  // The recipient may be a Sendzz user (identified by email) or an external address. Only look
  // one up when it could be an email — an address is never an account.
  let recipientId: string | null = null;
  if (row.recipient.includes('@')) {
    const { data: r } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', row.recipient.toLowerCase())
      .maybeSingle();
    recipientId = r?.id ?? null;
  }

  const { error } = await supabaseAdmin.from('transfers').insert({
    sender_id: row.user_id,
    sender_email: row.sender_email,
    recipient_id: recipientId,
    recipient_email: row.recipient.toLowerCase(),
    amount: row.amount,
    status: 'completed',
    note: row.note,
    tx_hash: row.tx_hash,
    asset: 'USDC',
    source_chain: row.chain,
  });

  if (error) {
    console.error(`[PendingSends] could not record ${row.tx_hash.slice(0, 12)}:`, error.message);
    return false;
  }

  console.log(
    `[PendingSends] recovered ${row.amount} USDC ${redactEmail(row.sender_email)} → ` +
      `${row.recipient.slice(0, 10)} on ${row.chain} (${row.tx_hash.slice(0, 12)})`,
  );
  return true;
}

/**
 * What a chain said about one outstanding send. `txHash` is present only where the chain knows a
 * different hash than the one we filed the intent under — i.e. EVM, where the intent is keyed on
 * a UserOperation hash and the ledger wants the transaction it became.
 */
interface ChainOutcome {
  successful: boolean;
  txHash?: string;
}

/**
 * Did this exact transaction land, and did it succeed?
 *
 * `null` means "not yet / cannot tell" — never "no". An unreadable Horizon must not be mistaken
 * for a transaction that failed, because that would write off a send that actually happened.
 */
async function stellarOutcome(txHash: string): Promise<ChainOutcome | null> {
  try {
    const res = await fetch(`${STELLAR_HORIZON_URL}/transactions/${txHash}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const tx = (await res.json()) as { successful?: boolean };
    return { successful: tx.successful ?? false };
  } catch {
    return null;
  }
}

/**
 * Did this UserOperation get included, and did it succeed?
 *
 * EVM intents are keyed on a UserOperation hash, not a transaction hash — at the moment of
 * broadcast the transaction does not exist yet. The bundler is the only thing that can map one
 * to the other, so it is asked directly.
 *
 * `null` means "not yet / cannot tell", never "no", for the same reason as the Stellar lookup.
 */
async function evmOutcome(
  chain: string,
  userOpHash: string,
): Promise<ChainOutcome | null> {
  try {
    const { createBundlerClient } = await import('viem/account-abstraction');
    const { toModularTransport } = await import('@circle-fin/modular-wallets-core');
    const { VIEM_CHAINS } = await import('@/lib/web3/multichain');
    const { CIRCLE_CLIENT_KEY, CIRCLE_SEND_URL } = await import('@/lib/web3/config');

    const viemChain = VIEM_CHAINS[chain as keyof typeof VIEM_CHAINS];
    if (!viemChain || !CIRCLE_CLIENT_KEY || !CIRCLE_SEND_URL) return null;

    const bundler = createBundlerClient({
      chain: viemChain,
      transport: toModularTransport(`${CIRCLE_SEND_URL}/${chain}`, CIRCLE_CLIENT_KEY),
    });

    const receipt = await bundler.getUserOperationReceipt({
      hash: userOpHash as `0x${string}`,
    });
    if (!receipt) return null;

    return {
      successful: receipt.success !== false,
      txHash: receipt.receipt?.transactionHash,
    };
  } catch {
    // The bundler answers "not found" by throwing, which is indistinguishable from being
    // unreachable. Both are "we cannot tell" — the expiry window decides when to give up.
    return null;
  }
}

/**
 * Resolve every outstanding send against its chain.
 *
 * Three outcomes per row, and nothing else is possible:
 *   • landed and succeeded  -> record the transfer, drop the intent
 *   • landed and failed     -> drop the intent, record nothing (no money moved)
 *   • not landed, window gone -> drop the intent, record nothing (it never can)
 *
 * A row whose window has not expired is left for the next run.
 */
export async function reconcilePendingSends(): Promise<{
  checked: number;
  recovered: number;
  writtenOff: number;
}> {
  const result = { checked: 0, recovered: 0, writtenOff: 0 };

  const { data: rows, error } = await supabaseAdmin
    .from('pending_sends')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('[PendingSends] query failed:', error.message);
    return result;
  }
  if (!rows?.length) return result;

  for (const row of rows) {
    result.checked++;

    const outcome =
      row.chain === 'stellar'
        ? await stellarOutcome(row.tx_hash)
        : isEvmUsdcChain(row.chain)
          ? await evmOutcome(row.chain, row.tx_hash)
          : null;

    if (outcome?.successful) {
      // On EVM the intent is keyed on the UserOperation hash; the ledger wants the transaction
      // hash the bundler resolved it to, so history links to something an explorer can show.
      const resolved = outcome.txHash ?? row.tx_hash;
      if (await recordConfirmedSend({ ...row, tx_hash: resolved })) result.recovered++;
      await clearPendingSend(row.id);
      continue;
    }

    if (outcome && !outcome.successful) {
      // In a ledger and rejected there. No money moved, so there is nothing to record.
      console.warn(`[PendingSends] ${row.tx_hash.slice(0, 12)} failed on-chain — discarding.`);
      await clearPendingSend(row.id);
      result.writtenOff++;
      continue;
    }

    // Not on the chain. Only give up once inclusion has become impossible; until then the row is
    // left exactly as it is. Nothing is written on a miss — how long a send has been outstanding
    // is already answered by `created_at`, so counting attempts would only add a database write
    // per row per cycle for a number no decision reads.
    if (Date.now() > new Date(row.expires_at).getTime() + WRITE_OFF_GRACE_MS) {
      console.warn(
        `[PendingSends] ${row.tx_hash.slice(0, 12)} never landed before its window closed — discarding.`,
      );
      await clearPendingSend(row.id);
      result.writtenOff++;
    }
  }

  if (result.recovered || result.writtenOff) {
    console.log(
      `[PendingSends] checked=${result.checked} recovered=${result.recovered} writtenOff=${result.writtenOff}`,
    );
  }
  return result;
}

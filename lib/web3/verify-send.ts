/**
 * Does this transaction actually exist, and did it move what the caller claims?
 *
 * `recordTransfer` is a `"use server"` export, which means it is a POST endpoint anyone can
 * invoke once they know its action id. The sender is now taken from the session, so nobody can
 * write history into someone else's account — but `amount` and `txHash` are still whatever the
 * caller sends. Without this, a signed-in user could write rows claiming any figure they liked
 * and, because recording also notifies the recipient, have Sendzz send a genuine
 * "You received 5,000 USDC" email to anyone.
 *
 * So the ledger is checked against the chain before it is written.
 *
 * --- The verdict is three-way on purpose -------------------------------------
 *
 * `not_found` and `unknown` must never be collapsed. "The chain says this transaction does not
 * exist" is grounds to refuse. "We could not reach the chain" is not — refusing there would
 * throw away the record of a payment that really happened, which is the exact failure we just
 * finished fixing on the send path. An unreachable RPC must never cost a user their history.
 */

import 'server-only';

import { isEvmUsdcChain, USDC_ADDRESSES, type SupportedChain } from '@/lib/circle/gateway';
import { STELLAR_HORIZON_URL } from '@/lib/stellar/config';

export type SendVerdict =
  /** The chain confirms this transaction moved the claimed amount from this sender. */
  | 'confirmed'
  /** The chain is readable and has no such transaction, or it moved something else. */
  | 'not_found'
  /** We cannot tell: unreadable RPC, unsupported chain, or nothing to check. */
  | 'unknown';

/** ERC-20 Transfer(address,address,uint256). */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Amounts are compared with a tolerance, not for equality.
 *
 * USDC carries 6 decimals while the app handles amounts as floating-point strings, so a
 * round-trip can land a hair off. One cent is far tighter than any amount worth forging and
 * comfortably looser than any rounding artefact.
 */
const TOLERANCE_USDC = 0.01;

function matches(claimed: number, actual: number): boolean {
  return Math.abs(claimed - actual) <= TOLERANCE_USDC;
}

/** Every USDC amount this transaction moved out of `sender`. */
async function evmSentAmounts(
  chain: string,
  txHash: string,
  sender: string,
): Promise<number[] | null> {
  try {
    const { createPublicClient } = await import('viem');
    const { rpcTransport } = await import('./rpc');
    const client = createPublicClient({ transport: rpcTransport(chain) });

    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (!receipt || receipt.status !== 'success') return [];

    const usdc = USDC_ADDRESSES[chain as SupportedChain]?.toLowerCase();
    const from = sender.toLowerCase();

    return receipt.logs
      .filter(
        (log) =>
          log.address.toLowerCase() === usdc &&
          log.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
          // topics[1] is the indexed `from`, left-padded to 32 bytes.
          `0x${log.topics[1]?.slice(26)}`.toLowerCase() === from,
      )
      .map((log) => Number(BigInt(log.data)) / 1e6);
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    // viem words a missing transaction this way. Anything else is an unreadable chain, not an
    // absent transaction, and must stay indistinguishable from "we don't know".
    if (message.includes('could not be found')) return [];
    return null;
  }
}

/** Every USDC amount this Stellar transaction moved out of `sender`. */
async function stellarSentAmounts(txHash: string, sender: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${STELLAR_HORIZON_URL}/transactions/${txHash}/payments`);
    if (res.status === 404) return [];
    if (!res.ok) return null;

    const body = (await res.json()) as {
      _embedded?: { records?: { asset_code?: string; from?: string; amount?: string }[] };
    };
    return (body._embedded?.records ?? [])
      .filter((p) => p.asset_code === 'USDC' && p.from === sender)
      .map((p) => parseFloat(p.amount ?? '0'));
  } catch {
    return null;
  }
}

/**
 * Confirm a USDC send against its chain.
 *
 * Checks that the transaction exists, succeeded, and moved the claimed amount out of this
 * sender's own wallet. The recipient is deliberately not matched: a transfer addressed by email
 * is delivered to a wallet this function is not given, and the forgery this defends against is
 * the AMOUNT, which this pins exactly.
 */
export async function verifyUsdcSend(params: {
  chain: string | undefined;
  txHash: string | undefined;
  senderAddress: string | null | undefined;
  amount: number;
}): Promise<SendVerdict> {
  const { txHash, amount } = params;
  const chain = params.chain?.toLowerCase();
  const sender = params.senderAddress;

  // Nothing to check against. Solana is here too: it has no verification path yet, and guessing
  // would be worse than admitting we cannot tell.
  if (!txHash || !chain || !sender || chain === 'solana') return 'unknown';

  const sent =
    chain === 'stellar'
      ? await stellarSentAmounts(txHash, sender)
      : isEvmUsdcChain(chain)
        ? await evmSentAmounts(chain, txHash, sender)
        : null;

  if (sent === null) return 'unknown';
  if (sent.some((value) => matches(amount, value))) return 'confirmed';

  // The chain answered and this sender did not move that amount in that transaction.
  return 'not_found';
}

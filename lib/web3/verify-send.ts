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
 * finished fixing on the send path. An unreachable RPC must never cost a user their history. *
 * `unknown` means exactly that one thing: the chain could not be read. A claim with nothing to
 * check — no hash, no sender wallet, a chain we have no reader for — is `not_found`. It used to
 * be `unknown`, which wrote the row and notified the recipient, so `chain: 'solana'` with any
 * amount at all was a way to make Sendzz announce a payment that never happened.
 */

import 'server-only';

import { isEvmUsdcChain, USDC_ADDRESSES, type SupportedChain } from '@/lib/circle/gateway';
import { STELLAR_HORIZON_URL, STELLAR_USDC_ISSUER } from '@/lib/stellar/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { NETWORK } from '@/lib/network';
import { solanaRpcUrl } from '@/lib/solana/rpc';

export type SendVerdict =
  /** The chain confirms this transaction moved the claimed amount from this sender. */
  | 'confirmed'
  /** The chain is readable and has no such transaction, or it moved something else. */
  | 'not_found'
  /** We cannot tell: the chain could not be read. */
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
export async function stellarSentAmounts(txHash: string, sender: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${STELLAR_HORIZON_URL}/transactions/${txHash}/payments`);
    if (res.status === 404) return [];
    if (!res.ok) return null;

    type Movement = { asset_code?: string; asset_issuer?: string; from?: string; amount?: string };
    const body = (await res.json()) as {
      _embedded?: {
        records?: (Movement & { asset_balance_changes?: (Movement & { type?: string })[] })[];
      };
    };
    // A classic payment carries the movement on the record itself. A Soroban call — the CCTP
    // burn behind every Stellar bridge — carries it in `asset_balance_changes` instead, and
    // without reading those every send bridged out of Stellar looked like it moved nothing.
    const movements = (body._embedded?.records ?? []).flatMap((p) => [
      p,
      ...(p.asset_balance_changes ?? []),
    ]);
    return movements
      .filter(
        (m) =>
          m.asset_code === 'USDC' &&
          (!m.asset_issuer || m.asset_issuer === STELLAR_USDC_ISSUER) &&
          m.from === sender,
      )
      .map((m) => parseFloat(m.amount ?? '0'));
  } catch {
    return null;
  }
}

/** A parsed SPL Token instruction, as `getParsedTransaction` returns it. */
interface ParsedTokenIx {
  program?: string;
  parsed?: {
    type?: string;
    info?: {
      source?: string;
      account?: string;
      authority?: string;
      mint?: string;
      amount?: string;
      tokenAmount?: { amount?: string };
    };
  };
}

/** A Solana signature is 64 bytes of base58 — 87 or 88 characters. */
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

/**
 * Every USDC amount this Solana transaction moved out of `sender`'s USDC account.
 *
 * Read per instruction, inner ones included, rather than as the net balance change: a send
 * carries its platform fee as a second transfer in the same transaction, exactly as an EVM user
 * operation carries it as a second log, and each must be matchable on its own. Burns count as
 * moving USDC out, for a bridge leg recorded against Solana.
 */
export async function solanaSentAmounts(
  signature: string,
  sender: string,
  /** How long to wait for a node that has not seen the transaction yet. Tests pass 0. */
  retryDelayMs = 1_500,
): Promise<number[] | null> {
  if (!SOLANA_SIGNATURE.test(signature)) return [];
  try {
    const mint = NETWORK.solana.usdcMint;
    let senderAta: string;
    try {
      senderAta = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(sender)).toBase58();
    } catch {
      return [];
    }

    const conn = new Connection(solanaRpcUrl(), 'confirmed');
    // The browser confirmed this on one node; we may be asking another, moments later. A
    // transaction it has not seen yet is not evidence that none exists — refusing on that would
    // throw away the record of a real send — so ask again, then admit we cannot tell.
    let tx = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, retryDelayMs));
      tx = await conn.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (tx) break;
    }
    if (!tx?.meta) return null;
    if (tx.meta.err) return [];

    const all = [
      ...tx.transaction.message.instructions,
      ...(tx.meta.innerInstructions ?? []).flatMap((inner) => inner.instructions),
    ] as ParsedTokenIx[];

    const amounts: number[] = [];
    for (const ix of all) {
      if (ix.program !== 'spl-token' || !ix.parsed?.info) continue;
      const { type, info } = ix.parsed;
      const from = info.source ?? info.account;
      if (from !== senderAta || info.authority !== sender) continue;
      if (info.mint && info.mint !== mint) continue;

      let raw: string | undefined;
      if (type === 'transfer' || type === 'burn') raw = info.amount;
      else if (type === 'transferChecked' || type === 'burnChecked') raw = info.tokenAmount?.amount;
      if (raw) amounts.push(Number(BigInt(raw)) / 1e6);
    }
    return amounts;
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

  // Nothing to check against is not the same as being unable to read the chain. Recording
  // proceeds on `unknown`, so a claim with no evidence at all has to be refused here.
  if (!txHash || !chain || !sender) return 'not_found';

  let sent: number[] | null;
  if (chain === 'stellar') sent = await stellarSentAmounts(txHash, sender);
  else if (chain === 'solana') sent = await solanaSentAmounts(txHash, sender);
  else if (isEvmUsdcChain(chain)) sent = await evmSentAmounts(chain, txHash, sender);
  else return 'not_found';

  if (sent === null) return 'unknown';
  if (sent.some((value) => matches(amount, value))) return 'confirmed';

  // The chain answered and this sender did not move that amount in that transaction.
  return 'not_found';
}

/** One on-chain movement out of the sender that pays for (part of) a transfer. */
export interface SendLeg {
  chain: string;
  txHash: string;
  amount: number;
}

/** More legs than any route plans — a cap, so one record cannot fan out into many RPC reads. */
const MAX_LEGS = 10;

/**
 * Confirm the evidence for one ledger row, which may span several transactions.
 *
 * A transfer is not always one transaction moving exactly the recorded amount. A send gathered
 * from three networks is three transactions, each moving its share; a cross-chain send is a burn
 * on the source chain that may carry its fee inside it. Checking the row's single hash against
 * its full amount refused both — the payment had happened, and its history row was thrown away.
 *
 * So each leg is checked on its own chain against its own amount, and together they must cover
 * what the row says was sent: nobody is told they received more than the sender demonstrably
 * moved. The row's own hash must be one of the legs, so nothing shown in history is unchecked.
 *
 * Without `legs`, the row's hash, chain and amount are the single leg — the original behaviour.
 */
export async function verifyTransferEvidence(params: {
  amount: number;
  txHash: string | undefined;
  chain: string | undefined;
  legs?: SendLeg[];
  /** The sender's own wallet on a chain, from the database — never from the caller. */
  senderFor: (chain: string) => string | null | undefined;
}): Promise<SendVerdict> {
  const { amount, txHash, chain, senderFor } = params;

  let legs: SendLeg[];
  if (params.legs?.length) {
    legs = params.legs;
    if (legs.length > MAX_LEGS) return 'not_found';
    if (legs.some((l) => !l?.chain || !l?.txHash || !(l.amount > 0))) return 'not_found';
    if (txHash && !legs.some((l) => l.txHash === txHash)) return 'not_found';
    const covered = legs.reduce((sum, l) => sum + l.amount, 0);
    if (covered + TOLERANCE_USDC < amount) return 'not_found';
  } else {
    if (!txHash || !chain) return 'not_found';
    legs = [{ chain, txHash, amount }];
  }

  const verdicts = await Promise.all(
    legs.map((leg) =>
      verifyUsdcSend({
        chain: leg.chain,
        txHash: leg.txHash,
        senderAddress: senderFor(leg.chain.toLowerCase()),
        amount: leg.amount,
      }),
    ),
  );

  if (verdicts.includes('not_found')) return 'not_found';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'confirmed';
}

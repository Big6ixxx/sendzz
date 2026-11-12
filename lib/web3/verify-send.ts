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

/**
 * One USDC movement inside a transaction, as its chain reports it.
 *
 * Read once per transaction and matched both ways: out of the sender (is the claim real?) and
 * into the recipient (did it arrive where the row says?). EVM and Stellar name the wallets;
 * Solana names token accounts and the signing authority, so it is matched on those.
 */
interface Movement {
  amount: number;
  /** EVM (lowercased) and Stellar wallets. */
  from?: string;
  to?: string;
  /** Solana token accounts and the authority that signed the move. */
  source?: string;
  destination?: string;
  authority?: string;
  /** Burned rather than paid: counts as leaving the sender, never as arriving anywhere. */
  burn?: boolean;
}

/**
 * Transactions already read while recording one transfer, so the sender check and the delivery
 * check share a single RPC or Horizon call per transaction. Keyed `chain:hash`.
 */
export type MovementReads = Map<string, Promise<Movement[] | null>>;

/** `[]` for a transaction that does not exist or failed; `null` when the chain cannot be read. */
async function readEvm(chain: string, txHash: string): Promise<Movement[] | null> {
  try {
    const { createPublicClient } = await import('viem');
    const { rpcTransport } = await import('./rpc');
    const client = createPublicClient({ transport: rpcTransport(chain) });

    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (!receipt || receipt.status !== 'success') return [];

    const usdc = USDC_ADDRESSES[chain as SupportedChain]?.toLowerCase();
    return receipt.logs
      .filter((log) => log.address.toLowerCase() === usdc && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC)
      .map((log) => ({
        // topics[1] and [2] are the indexed `from` and `to`, left-padded to 32 bytes.
        from: `0x${log.topics[1]?.slice(26)}`.toLowerCase(),
        to: `0x${log.topics[2]?.slice(26)}`.toLowerCase(),
        amount: Number(BigInt(log.data)) / 1e6,
      }));
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    // viem words a missing transaction this way. Anything else is an unreadable chain, not an
    // absent transaction, and must stay indistinguishable from "we don't know".
    if (message.includes('could not be found')) return [];
    return null;
  }
}

async function readStellar(txHash: string): Promise<Movement[] | null> {
  try {
    // 200 is Horizon's page maximum and above a transaction's 100-operation cap, so one page is
    // the whole transaction. The default of 10 missed every payment after the tenth.
    const res = await fetch(`${STELLAR_HORIZON_URL}/transactions/${txHash}/payments?limit=200`);
    if (res.status === 404) return [];
    if (!res.ok) return null;

    type Raw = { asset_code?: string; asset_issuer?: string; from?: string; to?: string; amount?: string; type?: string };
    const body = (await res.json()) as {
      _embedded?: { records?: (Raw & { asset_balance_changes?: Raw[] })[] };
    };
    // A classic payment carries the movement on the record itself. A Soroban call — the CCTP
    // burn behind every Stellar bridge — carries it in `asset_balance_changes` instead, and
    // without reading those every send bridged out of Stellar looked like it moved nothing.
    return (body._embedded?.records ?? [])
      .flatMap((p) => [p, ...(p.asset_balance_changes ?? [])])
      .filter((m) => m.asset_code === 'USDC' && (!m.asset_issuer || m.asset_issuer === STELLAR_USDC_ISSUER))
      .map((m) => ({
        from: m.from,
        to: m.to,
        amount: parseFloat(m.amount ?? '0'),
        burn: m.type === 'burn',
      }));
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
      destination?: string;
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
 * Read per instruction, inner ones included, rather than as the net balance change: a send
 * carries its platform fee as a second transfer in the same transaction, exactly as an EVM user
 * operation carries it as a second log, and each must be matchable on its own.
 */
async function readSolana(signature: string, retryDelayMs = 1_500): Promise<Movement[] | null> {
  if (!SOLANA_SIGNATURE.test(signature)) return [];
  try {
    const mint = NETWORK.solana.usdcMint;
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

    const movements: Movement[] = [];
    for (const ix of all) {
      if (ix.program !== 'spl-token' || !ix.parsed?.info) continue;
      const { type, info } = ix.parsed;
      if (info.mint && info.mint !== mint) continue;
      let raw: string | undefined;
      if (type === 'transfer' || type === 'burn') raw = info.amount;
      else if (type === 'transferChecked' || type === 'burnChecked') raw = info.tokenAmount?.amount;
      if (!raw) continue;
      const burn = type === 'burn' || type === 'burnChecked';
      movements.push({
        source: info.source ?? info.account,
        destination: burn ? undefined : info.destination,
        authority: info.authority,
        amount: Number(BigInt(raw)) / 1e6,
        burn,
      });
    }
    return movements;
  } catch {
    return null;
  }
}

/** Read a transaction's USDC movements, once per `reads`. */
function readMovements(chain: string, txHash: string, reads?: MovementReads): Promise<Movement[] | null> {
  const key = `${chain}:${txHash}`;
  const cached = reads?.get(key);
  if (cached) return cached;
  const read =
    chain === 'stellar'
      ? readStellar(txHash)
      : chain === 'solana'
        ? readSolana(txHash)
        : isEvmUsdcChain(chain)
          ? readEvm(chain, txHash)
          : Promise.resolve([] as Movement[]);
  reads?.set(key, read);
  // A read that failed is not remembered: the next caller (the delivery check after the
  // evidence check) tries the chain again rather than inheriting one blip.
  if (reads) void read.then((r) => { if (r === null && reads.get(key) === read) reads.delete(key); });
  return read;
}

/** A wallet's USDC token account, or null for something that is not a wallet address. */
function solanaUsdcAccount(owner: string, allowOffCurve: boolean): string | null {
  try {
    return getAssociatedTokenAddressSync(
      new PublicKey(NETWORK.solana.usdcMint),
      new PublicKey(owner),
      allowOffCurve,
    ).toBase58();
  } catch {
    return null;
  }
}

/** Amounts that left `sender`'s own wallet. */
function sentBy(chain: string, movements: Movement[], sender: string): number[] {
  if (chain === 'solana') {
    const ata = solanaUsdcAccount(sender, false);
    return movements.filter((m) => !!ata && m.source === ata && m.authority === sender).map((m) => m.amount);
  }
  const from = isEvmUsdcChain(chain) ? sender.toLowerCase() : sender;
  return movements.filter((m) => m.from === from).map((m) => m.amount);
}

/** Amounts that arrived in `recipient`'s own wallet. */
function deliveredTo(chain: string, movements: Movement[], recipient: string): number[] {
  const live = movements.filter((m) => !m.burn);
  if (chain === 'solana') {
    const ata = solanaUsdcAccount(recipient, true);
    return live.filter((m) => !!ata && m.destination === ata).map((m) => m.amount);
  }
  const to = isEvmUsdcChain(chain) ? recipient.toLowerCase() : recipient;
  return live.filter((m) => m.to === to).map((m) => m.amount);
}

/** Every USDC amount this Stellar transaction moved out of `sender`. */
export async function stellarSentAmounts(txHash: string, sender: string): Promise<number[] | null> {
  const movements = await readStellar(txHash);
  return movements && sentBy('stellar', movements, sender);
}

/**
 * Every USDC amount this Solana transaction moved out of `sender`'s USDC account. Burns count as
 * moving USDC out, for a bridge leg recorded against Solana.
 */
export async function solanaSentAmounts(
  signature: string,
  sender: string,
  /** How long to wait for a node that has not seen the transaction yet. Tests pass 0. */
  retryDelayMs = 1_500,
): Promise<number[] | null> {
  if (!SOLANA_SIGNATURE.test(signature) || !solanaUsdcAccount(sender, false)) return [];
  const movements = await readSolana(signature, retryDelayMs);
  return movements && sentBy('solana', movements, sender);
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
  reads?: MovementReads;
}): Promise<SendVerdict> {
  const { txHash, amount } = params;
  const chain = params.chain?.toLowerCase();
  const sender = params.senderAddress;

  // Nothing to check against is not the same as being unable to read the chain. Recording
  // proceeds on `unknown`, so a claim with no evidence at all has to be refused here.
  if (!txHash || !chain || !sender) return 'not_found';
  if (chain !== 'stellar' && chain !== 'solana' && !isEvmUsdcChain(chain)) return 'not_found';
  if (chain === 'solana' && !solanaUsdcAccount(sender, false)) return 'not_found';

  const movements = await readMovements(chain, txHash, params.reads);
  if (movements === null) return 'unknown';
  const sent = sentBy(chain, movements, sender);

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
  /** Share the chain reads with a later deliveredToAddress for the same transfer. */
  reads?: MovementReads;
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
        reads: params.reads,
      }),
    ),
  );

  if (verdicts.includes('not_found')) return 'not_found';
  if (verdicts.includes('unknown')) return 'unknown';
  return 'confirmed';
}

/**
 * Did these transactions deliver at least `amount` USDC to `recipient`'s own wallet?
 *
 * `verifyTransferEvidence` deliberately checks only the sender. That is enough for a row that
 * names an outside address, but not for one linked to a Sendzz account: linking puts the payment
 * in that person's received history and notifies them, so anyone could attach a real send of
 * their own, paid to anywhere, to another user's address. When the recipient is an address, the
 * destination is known, so it is checked.
 *
 * `false` for a chain that answered and shows no such delivery, and also for one that could not
 * be read: the row is then recorded unlinked, as an outside payment, which is what it was before
 * linking existed. A cross-chain send is a burn here, delivered later by a mint on another chain,
 * so it is never linked.
 */
export async function deliveredToAddress(params: {
  recipient: string;
  amount: number;
  legs: SendLeg[];
  /** The reads verifyTransferEvidence already made for these legs. */
  reads?: MovementReads;
}): Promise<boolean> {
  const { recipient, amount } = params;
  const legs = params.legs.slice(0, MAX_LEGS);
  const read = await Promise.all(
    legs.map((leg) => readMovements(leg.chain.toLowerCase(), leg.txHash, params.reads)),
  );
  let total = 0;
  for (const [i, movements] of read.entries()) {
    if (movements === null) return false;
    for (const value of deliveredTo(legs[i].chain.toLowerCase(), movements, recipient)) total += value;
  }
  return total + TOLERANCE_USDC >= amount;
}

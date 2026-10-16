/**
 * The Solana leg of the deposit scanner (lib/web3/deposit-scanner).
 *
 * Its own module, with no Supabase import, so it can be tested against a fake RPC — the same
 * reason lib/web3/deposit-amount exists. The orchestrator in deposit-scanner owns the cursor
 * table and the insert; this only reads the chain and says what it found.
 *
 * Four rules, each of which lost or corrupted a deposit when it was missing:
 *
 *   1. The signature is stored as the chain wrote it. Base58 is case-sensitive, so a lowercased
 *      signature is a different (non-existent) transaction to every explorer and RPC. Only the
 *      dedupe comparison against `known` is case-folded, because that set is lowercased.
 *   2. The cursor never moves past a transaction we could not read. A failed fetch, or a
 *      response without `meta`, stops the batch there; the next scan starts from it again.
 *   3. Signatures are paged with `before`. One `getSignaturesForAddress` call returns at most
 *      1000, newest first — so with more than that since the cursor, the oldest ones were never
 *      seen, and the cursor then jumped past them for good.
 *   4. Amounts come from the raw integer `amount` strings, in bigint. `uiAmount` is a float and
 *      is null on some RPCs; the difference of two floats is not the amount that moved.
 */
import {
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
  type SignaturesForAddressOptions,
  type TokenBalance,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { formatRawUnits } from '@/lib/solana/usdc-balance';
import type { ChainScan, DepositRow } from './deposit-scanner';

/** The two RPC methods the scan uses. `Connection` satisfies it; tests pass a fake. */
export interface SolanaScanRpc {
  getSignaturesForAddress(
    address: PublicKey,
    options?: SignaturesForAddressOptions,
  ): Promise<ConfirmedSignatureInfo[]>;
  getParsedTransaction(
    signature: string,
    config: { maxSupportedTransactionVersion: number },
  ): Promise<ParsedTransactionWithMeta | null>;
}

/** Signatures per `getSignaturesForAddress` page — the RPC's own maximum. */
export const SOL_SIG_PAGE = 1000;

/**
 * Signature pages read per scan before giving up.
 *
 * Paging is cheap (no transaction bodies), but it is not free, and an address with this much
 * unread history is not a user's USDC account behaving normally. Rather than process a window
 * that may not reach back to the cursor — which would skip the oldest arrivals — the scan
 * throws, the orchestrator logs it, and the cursor stays put.
 */
export const SOL_MAX_SIG_PAGES = 20;

/** Transactions parsed per scan, so a deep backfill chunks across scans. */
export const SOL_MAX_TX = 50;

/**
 * Does this transaction mint USDC into `tokenAccount`?
 *
 * The scan reads a net token-balance delta, which can't tell a mint from an incoming transfer
 * on its own. CCTP delivers via `mintTo`, so look for one — including inner instructions,
 * since the mint is a CPI from the token-messenger program.
 */
export function mintsUsdcTo(
  tx: ParsedTransactionWithMeta,
  tokenAccount: string,
  usdcMint: string,
): boolean {
  const isUsdcMintTo = (ix: ParsedInstruction | PartiallyDecodedInstruction): boolean => {
    const parsed = (ix as ParsedInstruction).parsed;
    if (!parsed || typeof parsed !== 'object') return false;
    const { type, info } = parsed as { type?: string; info?: Record<string, unknown> };
    if (type !== 'mintTo' && type !== 'mintToChecked') return false;
    return info?.mint === usdcMint && info?.account === tokenAccount;
  };

  if (tx.transaction.message.instructions.some(isUsdcMintTo)) return true;
  return (tx.meta?.innerInstructions ?? []).some((inner) =>
    inner.instructions.some(isUsdcMintTo),
  );
}

/** Raw USDC units held by `owner` across `balances`, summed in case it has several accounts. */
function rawUsdcOf(balances: TokenBalance[] | null | undefined, owner: string, usdcMint: string): bigint {
  let total = 0n;
  for (const b of balances ?? []) {
    if (b.owner !== owner || b.mint !== usdcMint) continue;
    total += BigInt(b.uiTokenAmount.amount);
  }
  return total;
}

/** USDC decimals as reported on the balance entries, defaulting to 6. */
function decimalsOf(tx: ParsedTransactionWithMeta, owner: string, usdcMint: string): number {
  const entry = [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])].find(
    (b) => b.owner === owner && b.mint === usdcMint,
  );
  return entry?.uiTokenAmount.decimals ?? 6;
}

/** `raw / 10^decimals` as a number, via an exact decimal string rather than float division. */
export function rawToUsdc(raw: bigint, decimals: number): number {
  return Number(formatRawUnits(raw, decimals));
}

/**
 * Net USDC received by `owner` in this transaction, in raw units (negative for a send).
 * Exported for tests.
 */
export function solanaUsdcDelta(tx: ParsedTransactionWithMeta, owner: string, usdcMint: string): bigint {
  return (
    rawUsdcOf(tx.meta?.postTokenBalances, owner, usdcMint) -
    rawUsdcOf(tx.meta?.preTokenBalances, owner, usdcMint)
  );
}

/**
 * Every signature on `address` newer than `until`, oldest first.
 *
 * Pages backwards with `before` until a short page says the history (or the cursor) has been
 * reached. See rule 3 in the module header.
 */
async function signaturesSince(
  rpc: SolanaScanRpc,
  address: PublicKey,
  until: string | null,
): Promise<ConfirmedSignatureInfo[]> {
  const newestFirst: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;

  for (let page = 0; page < SOL_MAX_SIG_PAGES; page++) {
    const batch = await rpc.getSignaturesForAddress(address, {
      limit: SOL_SIG_PAGE,
      ...(until ? { until } : {}),
      ...(before ? { before } : {}),
    });
    newestFirst.push(...batch);
    if (batch.length < SOL_SIG_PAGE) return newestFirst.reverse();
    before = batch[batch.length - 1].signature;
  }

  throw new Error(
    `Solana ${address.toBase58()}: more than ${SOL_MAX_SIG_PAGES * SOL_SIG_PAGE} unread ` +
      `signatures since the cursor — not scanning a window that may not reach it`,
  );
}

/**
 * Scan incoming USDC to the owner's USDC token account since the cursor signature.
 *
 * `cursor` is the newest signature already processed (exclusive). The returned `nextCursor`
 * is the newest signature this scan finished with — never one past a transaction it failed
 * to read — and is persisted by the orchestrator only after the rows are inserted.
 */
export async function scanSolana(
  rpc: SolanaScanRpc,
  params: {
    userId: string;
    ownerAddress: string;
    usdcMint: PublicKey;
    cursor: string | null;
    /** Lowercased hashes already on the ledger. */
    known: Set<string>;
  },
): Promise<ChainScan> {
  const { userId, ownerAddress, usdcMint, cursor, known } = params;
  const owner = new PublicKey(ownerAddress);
  const ata = getAssociatedTokenAddressSync(usdcMint, owner, true);
  const ataStr = ata.toBase58();
  const mintStr = usdcMint.toBase58();

  const chronological = await signaturesSince(rpc, ata, cursor);
  if (chronological.length === 0) return { chain: 'solana', rows: [], nextCursor: null };
  const batch = chronological.slice(0, SOL_MAX_TX); // chunk backfill across scans

  const rows: DepositRow[] = [];
  let lastProcessed = cursor;

  for (const info of batch) {
    // A failed transaction moved nothing; it is finished with as soon as it is seen.
    if (info.err || known.has(info.signature.toLowerCase())) {
      lastProcessed = info.signature;
      continue;
    }

    let tx: ParsedTransactionWithMeta | null;
    try {
      tx = await rpc.getParsedTransaction(info.signature, { maxSupportedTransactionVersion: 0 });
    } catch (e) {
      console.error(
        `[DepositScan] solana ${info.signature}: fetch failed, stopping here until next scan:`,
        e instanceof Error ? e.message : e,
      );
      break;
    }
    if (!tx?.meta) {
      // Not readable yet (or not by this node). Stopping is what keeps it from being skipped.
      console.error(`[DepositScan] solana ${info.signature}: no transaction meta, stopping here until next scan`);
      break;
    }
    lastProcessed = info.signature;

    const delta = solanaUsdcDelta(tx, ownerAddress, mintStr);
    if (delta <= 0n) continue; // not a receive (sent / unrelated)
    // Minted in, not paid in — a bridge delivery. Recorded as a bridge, not a deposit.
    if (mintsUsdcTo(tx, ataStr, mintStr)) continue;

    rows.push({
      user_id: userId,
      tx_hash: info.signature,
      amount_usdc: rawToUsdc(delta, decimalsOf(tx, ownerAddress, mintStr)),
      network: 'solana',
      provider: 'onchain',
      status: 'confirmed',
      ...(info.blockTime ? { created_at: new Date(info.blockTime * 1000).toISOString() } : {}),
      provider_metadata: { source: 'deposit-scan', token_account: ataStr },
    });
  }

  // Returned, not written — persisted by the orchestrator once the rows are safely inserted.
  return {
    chain: 'solana',
    rows,
    nextCursor: lastProcessed && lastProcessed !== cursor ? lastProcessed : null,
  };
}

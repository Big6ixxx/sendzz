/**
 * On-chain USDC deposit scanner (EVM + Solana).
 *
 * The portfolio scanner reads live balances, so USDC sent to a user's wallet shows up in their
 * balance — but nothing recorded it, so it never appeared in transaction history. This closes
 * that gap: it finds incoming USDC transfers to the user's address and inserts previously-unseen
 * ones as confirmed `deposits` rows (provider `onchain`).
 *
 * Efficiency: a per-(user, chain) cursor is persisted in `deposit_sync_state`. The first scan of
 * a chain deep-backfills from the beginning; subsequent scans only look at transfers AFTER the
 * cursor, so we never re-read the whole history. Work per scan is capped (paged) so the backfill
 * chunks across a few scans instead of blocking one history load.
 *
 * Dedupe is still done in code against hashes we already track — existing deposits, P2P receives
 * (`transfers`), and bridge mints (`bridge_transactions`) — so fiat-ramp settlements, P2P
 * transfers, and CCTP bridge mints are never double-counted (the cursor and dedupe overlap by a
 * block/signature on purpose, so nothing slips through the boundary).
 */
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import type { Json } from '@/types/database';
import { USDC_ADDRESSES, type SupportedChain } from '@/lib/circle/gateway';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

/** Alchemy Transfers API subdomain per chain. */
const ALCHEMY_SUBDOMAIN: Record<SupportedChain, string> = {
  ethereum: 'eth-mainnet',
  arbitrum: 'arb-mainnet',
  avalanche: 'avax-mainnet',
  optimism: 'opt-mainnet',
  polygon: 'polygon-mainnet',
  base: 'base-mainnet',
};

const SCAN_CHAINS = Object.keys(USDC_ADDRESSES) as SupportedChain[];
const SOLANA_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOLANA_RPC =
  process.env.SOLANA_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  'https://api.mainnet-beta.solana.com';

// Per-scan work caps so a deep backfill chunks across scans instead of blocking a history load.
const EVM_MAX_PAGES = 5; // × 1000 transfers per chain per scan
const SOL_MAX_TX = 50; //     signatures parsed per scan

// Warm-instance throttle so rapid history refetches don't hammer the RPCs. Keyed by address.
const lastScan = new Map<string, number>();
const THROTTLE_MS = 30_000;

type DepositRow = {
  user_id: string;
  tx_hash: string;
  amount_usdc: number;
  network: string;
  provider: 'onchain';
  status: 'confirmed';
  created_at?: string;
  provider_metadata: Json;
};

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Hashes we already account for, so we never double-count deposits/receives/bridge mints. */
async function knownHashes(userId: string): Promise<Set<string>> {
  const [{ data: deps }, { data: recv }, { data: bridges }] = await Promise.all([
    supabaseAdmin.from('deposits').select('tx_hash').eq('user_id', userId).not('tx_hash', 'is', null),
    supabaseAdmin.from('transfers').select('tx_hash').eq('recipient_id', userId).not('tx_hash', 'is', null),
    supabaseAdmin.from('bridge_transactions').select('mint_tx_hash').eq('user_id', userId).not('mint_tx_hash', 'is', null),
  ]);
  const known = new Set<string>();
  for (const r of deps ?? []) if (r.tx_hash) known.add(r.tx_hash.toLowerCase());
  for (const r of recv ?? []) if (r.tx_hash) known.add(r.tx_hash.toLowerCase());
  for (const r of bridges ?? []) if (r.mint_tx_hash) known.add(r.mint_tx_hash.toLowerCase());
  return known;
}

async function insertDeposits(rows: DepositRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { error, count } = await supabaseAdmin.from('deposits').insert(rows, { count: 'exact' });
  if (error) {
    console.error('[DepositScan] insert failed:', error.message);
    return 0;
  }
  return count ?? rows.length;
}

async function readCursors(userId: string): Promise<Map<string, string | null>> {
  const { data } = await supabaseAdmin
    .from('deposit_sync_state')
    .select('chain, cursor')
    .eq('user_id', userId);
  const map = new Map<string, string | null>();
  for (const r of data ?? []) map.set(r.chain, r.cursor);
  return map;
}

async function writeCursor(userId: string, chain: string, cursor: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('deposit_sync_state')
    .upsert({ user_id: userId, chain, cursor, updated_at: new Date().toISOString() }, { onConflict: 'user_id,chain' });
  if (error) console.error(`[DepositScan] cursor upsert (${chain}) failed:`, error.message);
}

// ─── EVM ─────────────────────────────────────────────────────────────────────

interface AlchemyTransfer {
  hash: string;
  value: number | null;
  from: string;
  blockNum: string;
  metadata?: { blockTimestamp?: string };
}

/** Fetch incoming USDC transfers to `address` on `chain` from `fromBlockHex`, paging up to a cap. */
async function fetchIncomingUsdc(
  chain: SupportedChain,
  address: string,
  fromBlockHex: string,
  apiKey: string,
): Promise<AlchemyTransfer[]> {
  const url = `https://${ALCHEMY_SUBDOMAIN[chain]}.g.alchemy.com/v2/${apiKey}`;
  const out: AlchemyTransfer[] = [];
  let pageKey: string | undefined;

  for (let page = 0; page < EVM_MAX_PAGES; page++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'alchemy_getAssetTransfers',
        params: [
          {
            fromBlock: fromBlockHex,
            toBlock: 'latest',
            toAddress: address,
            contractAddresses: [USDC_ADDRESSES[chain]],
            category: ['erc20'],
            withMetadata: true,
            excludeZeroValue: true,
            order: 'asc',
            maxCount: '0x3e8', // 1000
            ...(pageKey ? { pageKey } : {}),
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Alchemy ${chain} transfers ${res.status}`);
    const json = (await res.json()) as {
      result?: { transfers?: AlchemyTransfer[]; pageKey?: string };
      error?: { message: string };
    };
    if (json.error) throw new Error(`Alchemy ${chain}: ${json.error.message}`);
    out.push(...(json.result?.transfers ?? []));
    pageKey = json.result?.pageKey;
    if (!pageKey) break;
  }
  return out;
}

async function scanEvmChain(
  userId: string,
  chain: SupportedChain,
  address: string,
  apiKey: string,
  cursor: string | null,
  known: Set<string>,
): Promise<DepositRow[]> {
  // First scan of this chain → deep-backfill from genesis; otherwise resume at the cursor block.
  const fromBlockHex = cursor ? `0x${BigInt(cursor).toString(16)}` : '0x0';
  const transfers = await fetchIncomingUsdc(chain, address, fromBlockHex, apiKey);

  const rows: DepositRow[] = [];
  let maxBlock = cursor ? BigInt(cursor) : 0n;
  const seen = new Set<string>();

  for (const t of transfers) {
    const block = t.blockNum ? BigInt(t.blockNum) : 0n;
    if (block > maxBlock) maxBlock = block;
    if (!t.hash || !t.value || t.value <= 0) continue;
    const hash = t.hash.toLowerCase();
    if (known.has(hash) || seen.has(hash)) continue;
    seen.add(hash);
    rows.push({
      user_id: userId,
      tx_hash: hash,
      amount_usdc: t.value,
      network: chain,
      provider: 'onchain',
      status: 'confirmed',
      ...(t.metadata?.blockTimestamp ? { created_at: t.metadata.blockTimestamp } : {}),
      provider_metadata: { source: 'deposit-scan', from: t.from, block: t.blockNum },
    });
  }

  // Advance the cursor to the newest block we saw (decimal). Re-including that block next scan
  // is fine — dedupe handles the overlap. On an empty range the cursor is unchanged.
  if (transfers.length > 0) await writeCursor(userId, chain, maxBlock.toString());
  return rows;
}

// ─── Solana ──────────────────────────────────────────────────────────────────

/** Scan incoming USDC SPL transfers to the user's USDC token account since the cursor signature. */
async function scanSolana(
  userId: string,
  ownerAddress: string,
  cursor: string | null,
  known: Set<string>,
): Promise<DepositRow[]> {
  const conn = new Connection(SOLANA_RPC, 'confirmed');
  const owner = new PublicKey(ownerAddress);
  const ata = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, owner, true);

  // Most-recent-first, stopping at the cursor (exclusive). Reverse to chronological order.
  const sigInfos = await conn.getSignaturesForAddress(ata, {
    ...(cursor ? { until: cursor } : {}),
    limit: 1000,
  });
  if (sigInfos.length === 0) return [];
  const chronological = [...sigInfos].reverse();
  const batch = chronological.slice(0, SOL_MAX_TX); // chunk backfill across scans

  const rows: DepositRow[] = [];
  const ataStr = ata.toBase58();
  let lastProcessed = cursor;

  for (const info of batch) {
    lastProcessed = info.signature;
    if (info.err) continue;
    const hash = info.signature.toLowerCase();
    if (known.has(hash)) continue;
    try {
      const tx = await conn.getParsedTransaction(info.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx?.meta) continue;
      // Net USDC change on the owner's token account (positive = received).
      const pre = tx.meta.preTokenBalances?.find((b) => b.owner === ownerAddress && b.mint === SOLANA_USDC_MINT.toBase58());
      const post = tx.meta.postTokenBalances?.find((b) => b.owner === ownerAddress && b.mint === SOLANA_USDC_MINT.toBase58());
      const before = pre?.uiTokenAmount.uiAmount ?? 0;
      const after = post?.uiTokenAmount.uiAmount ?? 0;
      const delta = after - before;
      if (delta <= 0) continue; // not a receive (sent / unrelated)
      rows.push({
        user_id: userId,
        tx_hash: hash,
        amount_usdc: delta,
        network: 'solana',
        provider: 'onchain',
        status: 'confirmed',
        ...(info.blockTime ? { created_at: new Date(info.blockTime * 1000).toISOString() } : {}),
        provider_metadata: { source: 'deposit-scan', token_account: ataStr },
      });
    } catch (e) {
      console.error('[DepositScan] solana parse failed:', e instanceof Error ? e.message : e);
    }
  }

  // Advance cursor to the newest signature we processed this batch (chronological last).
  if (lastProcessed && lastProcessed !== cursor) await writeCursor(userId, 'solana', lastProcessed);
  return rows;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Scan every chain for incoming USDC to the user's addresses and record new external deposits.
 * Returns the number of deposit rows inserted. Best-effort: per-chain errors are swallowed so
 * one bad RPC doesn't fail the whole scan (or the caller's history load). Throttled per address.
 */
export async function scanUsdcDeposits(params: {
  userId: string;
  address: string;
  solanaAddress?: string;
}): Promise<number> {
  const { userId } = params;
  const address = params.address?.toLowerCase();
  const apiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || '';
  if (!address && !params.solanaAddress) return 0;

  const throttleKey = address || params.solanaAddress!;
  const now = Date.now();
  if (now - (lastScan.get(throttleKey) ?? 0) < THROTTLE_MS) return 0;
  lastScan.set(throttleKey, now);

  const [cursors, known] = await Promise.all([readCursors(userId), knownHashes(userId)]);

  const batches = await Promise.all([
    // EVM chains (parallel, per-chain best-effort)
    ...(apiKey && address
      ? SCAN_CHAINS.map(async (chain) => {
          try {
            return await scanEvmChain(userId, chain, address, apiKey, cursors.get(chain) ?? null, known);
          } catch (e) {
            console.error('[DepositScan]', e instanceof Error ? e.message : e);
            return [] as DepositRow[];
          }
        })
      : []),
    // Solana
    params.solanaAddress
      ? (async () => {
          try {
            return await scanSolana(userId, params.solanaAddress!, cursors.get('solana') ?? null, known);
          } catch (e) {
            console.error('[DepositScan] solana:', e instanceof Error ? e.message : e);
            return [] as DepositRow[];
          }
        })()
      : Promise.resolve([] as DepositRow[]),
  ]);

  // Dedupe across chains (same hash shouldn't appear twice) and insert.
  const seen = new Set<string>();
  const rows = batches.flat().filter((r) => {
    if (seen.has(r.tx_hash)) return false;
    seen.add(r.tx_hash);
    return true;
  });

  const inserted = await insertDeposits(rows);

  // Mark this user scanned so the reconcile cron rotates fairly (least-recently-scanned first).
  await supabaseAdmin
    .from('users')
    .update({ last_deposit_scan_at: new Date().toISOString() })
    .eq('id', userId);

  if (inserted > 0) console.log(`[DepositScan] recorded ${inserted} new deposit(s) for ${userId}`);
  return inserted;
}

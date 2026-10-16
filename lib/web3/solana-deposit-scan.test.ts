import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey, type ConfirmedSignatureInfo, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  rawToUsdc,
  scanSolana,
  SOL_MAX_TX,
  SOL_SIG_PAGE,
  type SolanaScanRpc,
} from './solana-deposit-scan';

/**
 * The Solana deposit scan, against a fake RPC.
 *
 * Each describe pins one of the four rules in the module header. Behavioural rather than
 * source-level, because these are arithmetic and paging bugs — the wiring is not the risk.
 */

const MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // devnet USDC
const OWNER = Keypair.generate().publicKey.toBase58();
const ATA = getAssociatedTokenAddressSync(MINT, new PublicKey(OWNER), true).toBase58();

/** A mixed-case base58 signature, unique per index. */
const sig = (i: number) => `SiG${i.toString().padStart(6, '0')}AbCdEfGh`;

const info = (i: number, extra: Partial<ConfirmedSignatureInfo> = {}): ConfirmedSignatureInfo => ({
  signature: sig(i),
  slot: i,
  err: null,
  memo: null,
  blockTime: 1_700_000_000 + i,
  ...extra,
});

/** A transaction moving USDC into (or out of) OWNER's account, raw units. */
function tx(pre: string | null, post: string, opts: { mint?: boolean } = {}): ParsedTransactionWithMeta {
  const bal = (amount: string) => ({
    accountIndex: 1,
    mint: MINT.toBase58(),
    owner: OWNER,
    // uiAmount is deliberately WRONG, so a scan that still reads it fails loudly.
    uiTokenAmount: { amount, decimals: 6, uiAmount: 999, uiAmountString: '999' },
  });
  const mintIx = {
    program: 'spl-token',
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    parsed: { type: 'mintTo', info: { mint: MINT.toBase58(), account: ATA, amount: post } },
  };
  return {
    slot: 1,
    transaction: { signatures: [], message: { accountKeys: [], instructions: [], recentBlockhash: '' } },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [],
      postBalances: [],
      preTokenBalances: pre === null ? [] : [bal(pre)],
      postTokenBalances: [bal(post)],
      innerInstructions: opts.mint ? [{ index: 0, instructions: [mintIx] }] : [],
    },
  } as unknown as ParsedTransactionWithMeta;
}

/**
 * A fake RPC over a chronological list of signatures, honouring `until`/`before`/`limit` the
 * way the real `getSignaturesForAddress` does (newest first, both bounds exclusive).
 */
function fakeRpc(
  history: ConfirmedSignatureInfo[],
  txs: (signature: string) => Promise<ParsedTransactionWithMeta | null>,
) {
  const sigCalls: { until?: string; before?: string; limit?: number }[] = [];
  const rpc: SolanaScanRpc = {
    getSignaturesForAddress: vi.fn(async (_addr, opts = {}) => {
      sigCalls.push({ until: opts.until, before: opts.before, limit: opts.limit });
      let newest = [...history].reverse();
      if (opts.before) newest = newest.slice(newest.findIndex((s) => s.signature === opts.before) + 1);
      if (opts.until) {
        const stop = newest.findIndex((s) => s.signature === opts.until);
        if (stop >= 0) newest = newest.slice(0, stop);
      }
      return newest.slice(0, opts.limit ?? 1000);
    }),
    getParsedTransaction: vi.fn(async (signature) => txs(signature)),
  };
  return { rpc, sigCalls };
}

const run = (rpc: SolanaScanRpc, cursor: string | null = null, known = new Set<string>()) =>
  scanSolana(rpc, { userId: 'u1', ownerAddress: OWNER, usdcMint: MINT, cursor, known });

describe('signatures are stored as the chain wrote them', () => {
  it('keeps the original case in tx_hash', async () => {
    const { rpc } = fakeRpc([info(1)], async () => tx('0', '1000000'));
    const scan = await run(rpc);
    expect(scan.rows).toHaveLength(1);
    expect(scan.rows[0].tx_hash).toBe(sig(1));
    expect(scan.rows[0].tx_hash).not.toBe(sig(1).toLowerCase());
    expect(scan.nextCursor).toBe(sig(1));
  });

  it('still dedupes against the lowercased known set', async () => {
    const fetched = vi.fn(async () => tx('0', '1000000'));
    const { rpc } = fakeRpc([info(1), info(2)], fetched);
    const scan = await run(rpc, null, new Set([sig(1).toLowerCase()]));
    expect(scan.rows.map((r) => r.tx_hash)).toEqual([sig(2)]);
    // Known signatures are skipped without spending a transaction fetch on them.
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(scan.nextCursor).toBe(sig(2));
  });
});

describe('the cursor never moves past a transaction that could not be read', () => {
  it('stops at a fetch failure and keeps the rows before it', async () => {
    const { rpc } = fakeRpc([info(1), info(2), info(3)], async (s) => {
      if (s === sig(2)) throw new Error('429 Too Many Requests');
      return tx('0', '2500000');
    });
    const scan = await run(rpc);
    expect(scan.rows.map((r) => r.tx_hash)).toEqual([sig(1)]);
    expect(scan.nextCursor).toBe(sig(1));
  });

  it('stops at a transaction that came back without meta', async () => {
    const { rpc } = fakeRpc([info(1), info(2)], async (s) =>
      s === sig(1) ? ({ ...tx('0', '1'), meta: null } as ParsedTransactionWithMeta) : tx('0', '1'),
    );
    const scan = await run(rpc, 'previous');
    expect(scan.rows).toEqual([]);
    // Nothing was finished, so the cursor is not moved at all.
    expect(scan.nextCursor).toBeNull();
  });

  it('stops at a transaction the node returned as null', async () => {
    const { rpc } = fakeRpc([info(1), info(2)], async (s) => (s === sig(2) ? null : tx('0', '1000000')));
    const scan = await run(rpc);
    expect(scan.nextCursor).toBe(sig(1));
  });

  it('still steps over a transaction that failed on chain', async () => {
    const fetched = vi.fn(async () => tx('0', '1000000'));
    const { rpc } = fakeRpc([info(1, { err: { InstructionError: [0, 'Custom'] } }), info(2)], fetched);
    const scan = await run(rpc);
    expect(scan.rows.map((r) => r.tx_hash)).toEqual([sig(2)]);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(scan.nextCursor).toBe(sig(2));
  });
});

describe('more than one page of new signatures is read in full', () => {
  it('pages with `before` and starts from the OLDEST unread signature', async () => {
    const total = SOL_SIG_PAGE * 2 + 5;
    const history = Array.from({ length: total }, (_, i) => info(i + 1));
    const { rpc, sigCalls } = fakeRpc(history, async () => tx('0', '1000000'));
    const scan = await run(rpc);

    expect(sigCalls).toHaveLength(3);
    expect(sigCalls[0].before).toBeUndefined();
    expect(sigCalls[1].before).toBe(sig(total - SOL_SIG_PAGE + 1));
    // The batch is the oldest SOL_MAX_TX, not the oldest of the newest page — which is what a
    // single 1000-signature call handed back, skipping everything below it.
    expect(scan.rows[0].tx_hash).toBe(sig(1));
    expect(scan.rows).toHaveLength(SOL_MAX_TX);
    expect(scan.nextCursor).toBe(sig(SOL_MAX_TX));
  });

  it('passes the cursor as `until` on every page', async () => {
    const history = Array.from({ length: SOL_SIG_PAGE + 10 }, (_, i) => info(i + 1));
    const { rpc, sigCalls } = fakeRpc(history, async () => tx('0', '1'));
    await run(rpc, sig(3));
    expect(sigCalls.every((c) => c.until === sig(3))).toBe(true);
  });

  it('returns no cursor when there is nothing new', async () => {
    const { rpc } = fakeRpc([info(1)], async () => tx('0', '1'));
    const scan = await run(rpc, sig(1));
    expect(scan).toEqual({ chain: 'solana', rows: [], nextCursor: null });
  });
});

describe('amounts come from the raw integers, not uiAmount', () => {
  it('credits exactly the raw delta', async () => {
    const { rpc } = fakeRpc([info(1)], async () => tx('1100000', '1300000'));
    const scan = await run(rpc);
    // 0.1 + 0.2 in floats is 0.30000000000000004; uiAmount (999) would be 0.
    expect(scan.rows[0].amount_usdc).toBe(0.2);
  });

  it('treats a missing pre-balance (account created in the same tx) as zero', async () => {
    const { rpc } = fakeRpc([info(1)], async () => tx(null, '938136'));
    const scan = await run(rpc);
    expect(scan.rows[0].amount_usdc).toBe(0.938136);
  });

  it('is exact beyond float precision', async () => {
    const { rpc } = fakeRpc([info(1)], async () => tx('0', '90071992547409930'));
    const scan = await run(rpc);
    expect(scan.rows[0].amount_usdc).toBe(Number('90071992547.409930'));
  });

  it('ignores sends and bridge mints', async () => {
    const { rpc } = fakeRpc([info(1), info(2)], async (s) =>
      s === sig(1) ? tx('5000000', '1000000') : tx('0', '1000000', { mint: true }),
    );
    const scan = await run(rpc);
    expect(scan.rows).toEqual([]);
    expect(scan.nextCursor).toBe(sig(2));
  });

  it('formats raw units without float division', () => {
    expect(rawToUsdc(1n, 6)).toBe(0.000001);
    expect(rawToUsdc(123456789n, 6)).toBe(123.456789);
    expect(rawToUsdc(-2500000n, 6)).toBe(-2.5);
    expect(rawToUsdc(7n, 0)).toBe(7);
  });
});

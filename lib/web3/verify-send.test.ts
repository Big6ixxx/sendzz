import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { NETWORK } from '@/lib/network';
import { STELLAR_USDC_ISSUER } from '@/lib/stellar/config';

vi.mock('server-only', () => ({}));

const getParsedTransaction = vi.fn();
vi.mock('@solana/web3.js', async (orig) => {
  const actual = await orig<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({ getParsedTransaction })),
  };
});

const { solanaSentAmounts, stellarSentAmounts, verifyTransferEvidence, verifyUsdcSend } =
  await import('./verify-send');

const mint = NETWORK.solana.usdcMint;
const sender = Keypair.generate().publicKey.toBase58();
const senderAta = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(sender)).toBase58();
const other = Keypair.generate().publicKey.toBase58();
const sig = '5'.repeat(88);

function parsed(instructions: unknown[], inner: unknown[] = [], err: unknown = null) {
  return {
    meta: { err, innerInstructions: inner.length ? [{ index: 0, instructions: inner }] : [] },
    transaction: { message: { instructions } },
  };
}

const transferChecked = (amount: string, source = senderAta, authority = sender, m = mint) => ({
  program: 'spl-token',
  parsed: {
    type: 'transferChecked',
    info: { source, authority, mint: m, tokenAmount: { amount } },
  },
});

beforeEach(() => {
  getParsedTransaction.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('solanaSentAmounts', () => {
  it('lists each USDC transfer out of the sender, so the payment and its fee match separately', async () => {
    getParsedTransaction.mockResolvedValue(
      parsed([transferChecked('10000000'), transferChecked('50000')]),
    );
    expect(await solanaSentAmounts(sig, sender)).toEqual([10, 0.05]);
  });

  it('counts inner instructions and burns', async () => {
    getParsedTransaction.mockResolvedValue(
      parsed([], [
        { program: 'spl-token', parsed: { type: 'burn', info: { account: senderAta, authority: sender, amount: '2500000' } } },
      ]),
    );
    expect(await solanaSentAmounts(sig, sender)).toEqual([2.5]);
  });

  it("ignores transfers out of someone else's account, by someone else, or of another mint", async () => {
    getParsedTransaction.mockResolvedValue(
      parsed([
        transferChecked('1', other),
        transferChecked('2', senderAta, other),
        transferChecked('3', senderAta, sender, other),
      ]),
    );
    expect(await solanaSentAmounts(sig, sender)).toEqual([]);
  });

  it('treats a failed transaction as moving nothing', async () => {
    getParsedTransaction.mockResolvedValue(parsed([transferChecked('1000000')], [], { InstructionError: [0, 'x'] }));
    expect(await solanaSentAmounts(sig, sender)).toEqual([]);
  });

  it('retries a transaction the node has not seen yet, then says unknown rather than absent', async () => {
    getParsedTransaction.mockResolvedValue(null);
    expect(await solanaSentAmounts(sig, sender, 0)).toBeNull();
    expect(getParsedTransaction).toHaveBeenCalledTimes(3);
  });

  it('finds a transaction that appears on a retry', async () => {
    getParsedTransaction
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(parsed([transferChecked('1000000')]));
    expect(await solanaSentAmounts(sig, sender, 0)).toEqual([1]);
  });

  it('rejects something that is not a Solana signature without asking the chain', async () => {
    expect(await solanaSentAmounts('0xabc', sender)).toEqual([]);
    expect(getParsedTransaction).not.toHaveBeenCalled();
  });

  it('returns null — unknown, not absent — when the RPC cannot be read', async () => {
    getParsedTransaction.mockImplementation(async () => { throw new Error('429 Too Many Requests'); });
    expect(await solanaSentAmounts(sig, sender)).toBeNull();
  });
});

describe('verifyUsdcSend', () => {
  const base = { txHash: sig, senderAddress: sender, amount: 10 };

  it('confirms a Solana send that moved the claimed amount', async () => {
    getParsedTransaction.mockResolvedValue(parsed([transferChecked('10000000')]));
    expect(await verifyUsdcSend({ ...base, chain: 'solana' })).toBe('confirmed');
  });

  it('refuses a Solana claim the chain contradicts — the forged notification', async () => {
    getParsedTransaction.mockResolvedValue(parsed([transferChecked('1')]));
    expect(await verifyUsdcSend({ ...base, chain: 'solana', amount: 5000 })).toBe('not_found');
  });

  it('stays unknown when Solana cannot be read, so a real payment keeps its record', async () => {
    getParsedTransaction.mockImplementation(async () => { throw new Error('timeout'); });
    expect(await verifyUsdcSend({ ...base, chain: 'solana' })).toBe('unknown');
  });

  it('refuses a claim with nothing to check, rather than recording it unverified', async () => {
    expect(await verifyUsdcSend({ ...base, chain: 'solana', txHash: undefined })).toBe('not_found');
    expect(await verifyUsdcSend({ ...base, chain: undefined })).toBe('not_found');
    expect(await verifyUsdcSend({ ...base, chain: 'solana', senderAddress: null })).toBe('not_found');
    expect(await verifyUsdcSend({ ...base, chain: 'dogecoin' })).toBe('not_found');
  });
});

describe('verifyTransferEvidence', () => {
  const sig2 = '6'.repeat(88);
  const senderFor = (chain: string) => (chain === 'solana' ? sender : null);

  function byHash(amounts: Record<string, string>) {
    getParsedTransaction.mockImplementation(async (hash: string) =>
      amounts[hash] ? parsed([transferChecked(amounts[hash])]) : null,
    );
  }

  it('confirms a send gathered from several transactions, each checked for its own share', async () => {
    byHash({ [sig]: '6000000', [sig2]: '4000000' });
    const verdict = await verifyTransferEvidence({
      amount: 10,
      txHash: sig,
      chain: 'solana',
      legs: [
        { chain: 'solana', txHash: sig, amount: 6 },
        { chain: 'solana', txHash: sig2, amount: 4 },
      ],
      senderFor,
    });
    expect(verdict).toBe('confirmed');
  });

  it('refuses when one leg did not move its share', async () => {
    byHash({ [sig]: '6000000', [sig2]: '1' });
    const verdict = await verifyTransferEvidence({
      amount: 10,
      txHash: sig,
      chain: 'solana',
      legs: [
        { chain: 'solana', txHash: sig, amount: 6 },
        { chain: 'solana', txHash: sig2, amount: 4 },
      ],
      senderFor,
    });
    expect(verdict).toBe('not_found');
  });

  it('refuses legs that do not cover the amount recorded — nobody is told they got more', async () => {
    byHash({ [sig]: '6000000' });
    const verdict = await verifyTransferEvidence({
      amount: 5000,
      txHash: sig,
      chain: 'solana',
      legs: [{ chain: 'solana', txHash: sig, amount: 6 }],
      senderFor,
    });
    expect(verdict).toBe('not_found');
    expect(getParsedTransaction).not.toHaveBeenCalled();
  });

  it('accepts a burn that moved more than was sent, its fee riding inside it', async () => {
    byHash({ [sig]: '10100000' });
    const verdict = await verifyTransferEvidence({
      amount: 10,
      txHash: sig,
      chain: 'solana',
      legs: [{ chain: 'solana', txHash: sig, amount: 10.1 }],
      senderFor,
    });
    expect(verdict).toBe('confirmed');
  });

  it("refuses a row whose hash is not one of its legs, so history never shows an unchecked hash", async () => {
    byHash({ [sig]: '10000000' });
    const verdict = await verifyTransferEvidence({
      amount: 10,
      txHash: sig2,
      chain: 'solana',
      legs: [{ chain: 'solana', txHash: sig, amount: 10 }],
      senderFor,
    });
    expect(verdict).toBe('not_found');
  });

  it('falls back to the row itself as the only leg', async () => {
    byHash({ [sig]: '10000000' });
    expect(
      await verifyTransferEvidence({ amount: 10, txHash: sig, chain: 'solana', senderFor }),
    ).toBe('confirmed');
    expect(
      await verifyTransferEvidence({ amount: 10, txHash: undefined, chain: 'solana', senderFor }),
    ).toBe('not_found');
  });
});

describe('stellarSentAmounts', () => {
  const g = 'G' + 'A'.repeat(55);

  function horizon(records: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ _embedded: { records } }) }),
    );
  }

  it('reads a classic USDC payment', async () => {
    horizon([{ asset_code: 'USDC', asset_issuer: STELLAR_USDC_ISSUER, from: g, amount: '5.0000000' }]);
    expect(await stellarSentAmounts('h', g)).toEqual([5]);
  });

  it('reads the balance changes of a Soroban call — the CCTP burn behind a Stellar bridge', async () => {
    horizon([
      {
        type: 'invoke_host_function',
        asset_balance_changes: [
          { type: 'transfer', asset_code: 'USDC', asset_issuer: STELLAR_USDC_ISSUER, from: g, amount: '10.1000000' },
        ],
      },
    ]);
    expect(await stellarSentAmounts('h', g)).toEqual([10.1]);
  });

  it('ignores an asset that is only called USDC', async () => {
    horizon([{ asset_code: 'USDC', asset_issuer: 'G' + 'B'.repeat(55), from: g, amount: '5' }]);
    expect(await stellarSentAmounts('h', g)).toEqual([]);
  });
});

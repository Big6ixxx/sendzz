import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { formatRawUnits, readSolanaUsdcBalance, type SolanaBalanceRpc } from './usdc-balance';

const MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const OWNER = Keypair.generate().publicKey;

const rpc = (impl: SolanaBalanceRpc['getParsedAccountInfo']): SolanaBalanceRpc => ({
  getParsedAccountInfo: impl,
});

const tokenAccount = (amount: string, decimals = 6) => ({
  value: {
    executable: false,
    lamports: 2039280,
    owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    rentEpoch: 0,
    data: {
      program: 'spl-token',
      space: 165,
      parsed: { type: 'account', info: { tokenAmount: { amount, decimals, uiAmount: 999 } } },
    },
  },
});

describe('readSolanaUsdcBalance', () => {
  it('reads zero only when the token account does not exist', async () => {
    expect(await readSolanaUsdcBalance(rpc(async () => ({ value: null })), OWNER, MINT)).toBe('0');
  });

  it('reports an RPC failure as unreadable, not zero', async () => {
    const failing = rpc(async () => {
      throw new Error('429 Too Many Requests');
    });
    expect(await readSolanaUsdcBalance(failing, OWNER, MINT)).toBeNull();
  });

  it('reports an account that is not a token account as unreadable', async () => {
    const raw = rpc(async () => ({ value: { ...tokenAccount('1').value, data: Buffer.alloc(0) } }));
    expect(await readSolanaUsdcBalance(raw, OWNER, MINT)).toBeNull();
  });

  it('reads the raw amount, not uiAmount', async () => {
    expect(await readSolanaUsdcBalance(rpc(async () => tokenAccount('12345678')), OWNER, MINT)).toBe('12.345678');
  });
});

describe('formatRawUnits', () => {
  it('is exact and trims trailing zeros', () => {
    expect(formatRawUnits(0n, 6)).toBe('0');
    expect(formatRawUnits(1n, 6)).toBe('0.000001');
    expect(formatRawUnits(2_500_000n, 6)).toBe('2.5');
    expect(formatRawUnits(90071992547409930n, 6)).toBe('90071992547.40993');
    expect(formatRawUnits(-1_000_000n, 6)).toBe('-1');
  });
});

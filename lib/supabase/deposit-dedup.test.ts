import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./adminClient', () => ({ supabaseAdmin: {} }));

const { depositHashForms } = await import('./deposit-dedup');

describe('depositHashForms', () => {
  it('finds an EVM deposit, which is stored lowercased, from a checksummed hash', () => {
    expect(depositHashForms('0xABCdef')).toEqual(['0xABCdef', '0xabcdef']);
  });

  it('finds a Solana deposit, which is stored exactly as the chain wrote it', () => {
    const sig = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
    expect(depositHashForms(sig)).toContain(sig);
  });

  it('asks once for a hash that is already lowercase', () => {
    expect(depositHashForms('0xabc')).toEqual(['0xabc']);
  });
});

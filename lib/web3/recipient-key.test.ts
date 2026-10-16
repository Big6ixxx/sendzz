import { describe, expect, it } from 'vitest';
import { normalizeRecipient } from './recipient-key';

describe('normalizeRecipient', () => {
  it('lowercases emails and EVM addresses, as before', () => {
    expect(normalizeRecipient(' Ada@Example.com ')).toBe('ada@example.com');
    expect(normalizeRecipient('0xAbCdEf0123456789aBcDeF0123456789AbCdEf01')).toBe(
      '0xabcdef0123456789abcdef0123456789abcdef01',
    );
  });

  it('keeps a Solana address exactly as given', () => {
    const sol = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    expect(normalizeRecipient(sol)).toBe(sol);
  });

  it('keeps a Stellar address exactly as given', () => {
    const g = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    expect(normalizeRecipient(g)).toBe(g);
  });
});

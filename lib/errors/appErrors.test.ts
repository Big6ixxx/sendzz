import { describe, expect, it, vi } from 'vitest';

vi.mock('./report', () => ({ reportClientError: () => undefined }));
vi.spyOn(console, 'error').mockImplementation(() => undefined);

import { friendlyErrorMessage, classifyAppError } from './appErrors';

const category = (raw: string) => classifyAppError(new Error(raw)).category;

describe('Solana error categories', () => {
  it('reads an expired blockhash as safe to retry', () => {
    expect(category('Transaction simulation failed: Blockhash not found')).toBe('blockhash_expired');
    expect(
      category('Signature 5x… has expired: block height exceeded.'),
    ).toBe('blockhash_expired');
    expect(category('[blockhash_expired] This transfer took too long')).toBe('blockhash_expired');
  });

  it("reads SPL Token's error 1 as the user's balance", () => {
    expect(
      category('failed to send transaction: Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1'),
    ).toBe('insufficient_funds');
    expect(category('{"InstructionError":[1,{"Custom":1}]}')).toBe('insufficient_funds');
  });

  it('does not mistake another custom error for insufficient funds', () => {
    expect(category('custom program error: 0x10')).not.toBe('insufficient_funds');
  });

  it("reads an empty fee payer as ours, not the user's", () => {
    expect(
      category('Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.'),
    ).toBe('service_unavailable');
    expect(category('Transfer: insufficient lamports 100, need 2039280')).toBe('service_unavailable');
  });

  it('maps the sponsor codes', () => {
    expect(category('[sponsor_refused] This transaction cannot be sponsored.')).toBe('sponsor_refused');
    expect(category('Gas station error: This transaction cannot be sponsored.')).toBe('sponsor_refused');
    expect(category('[ata_rent_limited] limit')).toBe('ata_rent_limited');
    expect(category('Gas sponsor error: Bad Gateway')).toBe('service_unavailable');
    expect(category('Gas station error: Circle did not return a sponsored transaction')).toBe('service_unavailable');
  });

  it('keeps the RPC duplicate refusal away from the CCTP already-processed category', () => {
    const r = classifyAppError(new Error('Transaction simulation failed: This transaction has already been processed'));
    expect(r.isAlreadyProcessed).toBe(false);
    expect(r.category).toBe('broadcast_unconfirmed');
  });

  it('still recognises a CCTP replay', () => {
    expect(classifyAppError(new Error('nonce already used')).isAlreadyProcessed).toBe(true);
  });

  it('never shows the raw simulation text', () => {
    expect(friendlyErrorMessage(new Error('custom program error: 0x1'))).not.toMatch(/0x1/);
  });
});

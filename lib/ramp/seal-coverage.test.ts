import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

/**
 * Every withdrawal must seal where its fiat is going — not just the deferred ones.
 *
 * This is asserted against the SOURCE rather than behaviour because the failure it guards is a
 * silent one. Sealing used to be gated on `deferredInitialize`, which is true only for Stellar
 * (`hasSharedDepositAddress` → network === 'stellar'). Every EVM withdrawal therefore stored
 * nothing, and when one failed after the user's deposit landed there was no account number to
 * pay — only a mask. Three of the first four real debts died that way.
 *
 * Nothing errors when this regresses. The column is simply null, months later, on the row an
 * operator is trying to settle. So the gate is tested for directly.
 */
describe('withdrawal beneficiary sealing', () => {
  it('is not gated on deferredInitialize', async () => {
    const src = await readFile('lib/actions/ramp.ts', 'utf8');
    expect(src).toMatch(/const\s+pendingBeneficiary\s*=\s*sealBeneficiary\(/);
    expect(src).not.toMatch(/pendingBeneficiary\s*=\s*created\.deferredInitialize/);
  });

  it('passes the sealed copy to the withdrawal row', async () => {
    const src = await readFile('lib/actions/ramp.ts', 'utf8');
    expect(src).toContain('pendingBeneficiary,');
  });

  it('is cleared only once the withdrawal completes', async () => {
    // Scrubbing when the payout is CREATED is what made these debts unrecoverable: a created
    // payout can still fail, and that is precisely when the destination is needed.
    const settle = await readFile('lib/ramp/deferred-settle.ts', 'utf8');
    expect(settle).not.toMatch(/\.update\(\{\s*pending_beneficiary:\s*null\s*\}\)/);

    const tx = await readFile('lib/supabase/transactions.ts', 'utf8');
    expect(tx).toMatch(/pending_beneficiary:\s*null/);
  });
});

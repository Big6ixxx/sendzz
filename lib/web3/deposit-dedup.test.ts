import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * An incoming USDC transfer is not automatically a deposit.
 *
 * A Sendzz-to-Sendzz send lands on chain exactly like an outside payment, and so does a CCTP
 * mint. Both are already on the ledger — as a transfer, and as a bridge — so crediting them
 * again puts one tx_hash in the ledger twice and the recipient sees one payment as two. That
 * happened on Base: the same hash appeared as both a transfer and a deposit.
 *
 * The unique index on deposits does NOT catch this. It stops a duplicate DEPOSIT; a transfer and
 * a deposit live in different tables.
 *
 * Two sides, because the webhook and the transfer write race each other.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('the webhook does not re-credit what is already on the ledger', () => {
  const route = read('app/api/webhook/alchemy/route.ts');

  it('checks transfers received and bridge mints before crediting', () => {
    // The scanner has always done this via knownHashes. The webhook did not, which is the bug.
    expect(route).toMatch(/from\('transfers'\)[\s\S]{0,200}recipient_id/);
    expect(route).toMatch(/from\('bridge_transactions'\)[\s\S]{0,200}mint_tx_hash/);
  });

  it('checks fiat on-ramp settlements too', () => {
    // A fiat deposit settles by sending USDC on chain. Crediting that leg as its own deposit
    // doubles the figure and tells someone who paid in naira that they made a crypto deposit.
    expect(route).toMatch(/from\('deposits'\)[\s\S]{0,200}neq\('provider', 'onchain'\)/);
  });

  it('matches on user AND hash, not hash alone', () => {
    // Keying on the hash alone would drop a genuine deposit that happens to share a hash with
    // somebody else's transfer — one transaction can pay several people at once.
    expect(route).toMatch(/\$\{r\.recipient_id\}:\$\{r\.tx_hash\.toLowerCase\(\)\}/);
    expect(route).toMatch(/\$\{r\.user_id\}:\$\{r\.tx_hash\}/);
  });
});

describe('both ramp providers clear the on-chain shadow', () => {
  // Paycrest has always done this; Bitnob — the primary provider — did not, which is why a
  // fiat deposit could end up recorded twice.
  for (const provider of ['bitnob', 'paycrest']) {
    it(`${provider} clears it when the settlement hash arrives`, () => {
      const route = read(`app/api/webhook/${provider}/route.ts`);
      expect(route).toMatch(/clearOnchainDepositShadow\(/);
    });
  }
});

describe('the loser of the race cleans up', () => {
  const tx = read('lib/supabase/transactions.ts');

  it('removes a deposit already credited for the same transfer', () => {
    // The webhook fires within seconds, often before the browser writes the transfer row. It
    // cannot skip a row that does not exist yet, so this side has to clean up.
    expect(tx).toMatch(/from\("deposits"\)\s*\.delete\(\)[\s\S]{0,300}eq\("provider", "onchain"\)/);
  });

  it('scopes the delete to the recipient, the hash, and onchain deposits only', () => {
    // Bounded to THIS block. A slice running to end of file also covers
    // clearOnchainDepositShadow, which carries the same provider filter — so the assertion
    // passed even with the guard deleted here, which is the failure this test exists to catch.
    const start = tx.indexOf('if (transferId && params.txHash && recipient?.id)');
    expect(start).toBeGreaterThan(-1);
    const block = tx.slice(start, tx.indexOf('could not clear duplicate deposit'));

    expect(block).toMatch(/eq\("user_id", recipient\.id\)/);
    expect(block).toMatch(/eq\("tx_hash", params\.txHash\.toLowerCase\(\)\)/);
    // Without the provider filter this would delete real fiat on-ramp deposits.
    expect(block).toMatch(/eq\("provider", "onchain"\)/);
  });
});

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

describe('the scanner recognises a transfer sent before the recipient signed up', () => {
  it('matches transfers by recipient email, not only recipient_id', () => {
    // A pending-claim transfer has no recipient_id until it is claimed. Matching on the id alone
    // let the first scan after sign-up record it as a deposit and send a deposit email.
    const scanner = read('lib/web3/deposit-scanner.ts');
    expect(scanner).toMatch(/from\('transfers'\)[\s\S]{0,80}eq\('recipient_email'/);
  });
});

describe('the loser of the race cleans up', () => {
  const helper = read('lib/supabase/deposit-dedup.ts');

  it('removes a deposit already credited for the same transfer', () => {
    // The webhook fires within seconds, often before the browser writes the transfer row. It
    // cannot skip a row that does not exist yet, so this side has to clean up.
    expect(helper).toMatch(/from\('deposits'\)\s*\.delete\(\)/);
  });

  it('scopes the delete to the recipient, the hash, and onchain deposits only', () => {
    expect(helper).toMatch(/eq\('user_id', userId\)/);
    expect(helper).toMatch(/eq\('tx_hash', txHash\.toLowerCase\(\)\)/);
    // Without the provider filter this would delete real fiat on-ramp deposits.
    expect(helper).toMatch(/eq\('provider', 'onchain'\)/);
  });

  it('is not callable from the browser', () => {
    // transactions.ts is "use server": an export there is a public endpoint that could delete
    // anyone's deposit rows. The helper must live in a server-only module.
    expect(helper).toMatch(/^import 'server-only';/m);
  });

  // Every path that writes a transfer or links it to the recipient: the browser recording it,
  // the reconciler recovering it, and a claim or accept attaching it to a new account. Missing
  // any one leaves the duplicate the scanner already wrote.
  for (const file of [
    'lib/supabase/transactions.ts',
    'lib/supabase/pendingSends.ts',
    'app/api/transfer/claim/route.ts',
    'app/api/transfer/accept/route.ts',
  ]) {
    it(`${file} clears the duplicate`, () => {
      expect(read(file)).toMatch(/clearDuplicateDeposit\(/);
    });
  }
});

describe('a send from another Sendzz account is never a deposit', () => {
  const route = read('app/api/webhook/alchemy/route.ts');

  it('looks the sender up alongside the recipient', () => {
    expect(route).toMatch(/for \(const raw of \[a\.toAddress!, a\.fromAddress\]\)/);
  });

  it('skips it before a deposit row (and its email) can exist', () => {
    // The ledger check above cannot catch this: the transfer row is usually written AFTER the
    // webhook lands. The cleanup removed the row, but the deposit email had already gone out.
    const skip = route.indexOf('userByAddress.has(activity.fromAddress.toLowerCase())');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(route.indexOf('rows.push('));
    expect(route.slice(skip, skip + 120)).toMatch(/continue;/);
  });
});

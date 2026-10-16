import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Stellar has no deposit webhook.
 *
 * Alchemy's Address Activity webhook covers the EVM chains, which is why the full sweep was
 * moved to once a day. Stellar was swept by that same pass — so moving it to daily left a
 * Stellar payment unrecorded for up to 24 hours, with nothing else watching. This pins the two
 * properties that stop it happening again.
 *
 * Source-level assertions, in the style of lib/ramp/seal-coverage.test.ts: the behaviour lives
 * in a cron route and a Supabase write, and the thing worth protecting is the WIRING, which a
 * mock-heavy test would restate rather than check.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Just the sweepRail function, so an assertion cannot drift into a neighbouring one. */
function sweepFn(cron: string): string {
  const from = cron.indexOf('async function sweepRail');
  return cron.slice(from, cron.indexOf('\nasync function scanStaleUsers', from));
}

describe('Stellar deposits are swept on every cron run', () => {
  const cron = read('app/api/cron/reconcile-transactions/route.ts');

  it('runs a Stellar pass that is not behind the daily due-check', () => {
    expect(cron).toMatch(/sweepRail\('stellar'\)/);
    // The daily gate belongs to the full sweep only. If sweepRail ever moves inside
    // scanStaleUsers, or gains a midnight check of its own, Stellar goes dark again.
    expect(sweepFn(cron)).not.toMatch(/setUTCHours|dueBefore/);
  });

  it('costs a fixed number of requests per run, whatever the user count', () => {
    // Sweeping every address each run made Horizon load grow with signups, straight towards the
    // per-IP rate limit. A fixed batch keeps the cost flat; only the lap time grows.
    const fn = sweepFn(cron);
    expect(fn).toMatch(/rail === 'stellar' \? STELLAR_SWEEP_BATCH : SOLANA_SWEEP_BATCH/);
    expect(fn).toMatch(/slice\(0, batchSize\)/);
  });

  it('rotates without starving anyone', () => {
    // deposit_sync_state is a CURSOR — a quiet account never moves it, so ordering by it alone
    // would hand back the same users forever. Touching it on every sweep is what makes it mean
    // "when did we last look", and never-swept users must sort ahead of everyone.
    const fn = sweepFn(cron);
    expect(fn).toMatch(/touchSweep\(u\.id, rail\)/);
    expect(fn).toMatch(/\.eq\('chain', rail\)/);
    expect(fn).toMatch(/if \(!ta\) return -1;/);
  });

  it('touches the timestamp without ever writing the cursor', () => {
    // Writing back a cursor read at the top of the sweep would rewind a scan that ran from the
    // app in the meantime, making it re-read a window it had already finished.
    const touch = cron.slice(cron.indexOf('async function touchSweep'));
    const body = touch.slice(0, touch.indexOf('\n}') + 2);
    expect(body).toMatch(/\.update\(\{ updated_at:/);
    expect(body).not.toMatch(/upsert\(/);
    // The only cursor it may write is none at all, for an address never scanned before.
    expect(body).toMatch(/insert\(\{ user_id: userId, chain, cursor: null \}\)/);
  });

  it('gives up its turn before scanning, so a failure cannot block the queue', () => {
    // Touch BEFORE the scan: a throw has still moved the user to the back, and a scan that
    // advances the cursor overwrites this row with the correct value anyway.
    const fn = sweepFn(cron);
    const touch = fn.indexOf('await touchSweep(');
    const scan = fn.indexOf('await scanUsdcDeposits(');
    expect(touch).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(touch);
  });
});

describe('Solana deposits get the same frequent sweep, once Solana is switched on', () => {
  const cron = read('app/api/cron/reconcile-transactions/route.ts');

  it('runs a Solana pass on every cron run, gated only by SOLANA_RECEIVE_ENABLED', () => {
    // Solana has no deposit webhook either (Alchemy's is registered for the EVM accounts only),
    // so without this pass it would wait for the daily full sweep.
    expect(cron).toMatch(/SOLANA_RECEIVE_ENABLED \? sweepRail\('solana'\)/);
  });

  it('rotates Solana on its own sync-state row, not Stellar\'s', () => {
    // Sharing a rotation key would let one rail's sweep make the other's users look fresh.
    const fn = sweepFn(cron);
    expect(fn).toMatch(/rail === 'stellar' \? 'stellar_address' : 'solana_address'/);
    expect(fn).toMatch(/solanaAddress: u\.address/);
  });
});

describe('the history feed sweeps Stellar and Solana, and never the EVM chains', () => {
  const tx = read('lib/supabase/transactions.ts');

  it('scans the user Stellar address when history is read', () => {
    // Without this a deposit waits for the next cron tick. Stellar has no webhook, so this is
    // the only thing that makes an arrival show up the moment the user looks.
    expect(tx).toMatch(/scanUsdcDeposits\([\s\S]{0,240}rails: "stellar"/);
  });

  it('scans the user Solana address when history is read, while Solana is on', () => {
    expect(tx).toMatch(/SOLANA_RECEIVE_ENABLED && userRecord\.solana_address\s*\?\s*scanUsdcDeposits\([\s\S]{0,240}rails: "solana"/);
  });

  it('does NOT sweep the EVM chains from the history feed', () => {
    // The bill. Every open tab swept six chains twice a minute through a billed Alchemy call.
    expect(tx).not.toMatch(/scanUsdcDeposits\([\s\S]{0,240}rails: "all"/);
    expect(tx).not.toMatch(/scanUsdcDeposits\(\{[\s\S]{0,200}address: userRecord\.smart_account_address/);
  });
});

describe('a Stellar-only sweep does not consume the daily EVM slot', () => {
  const scanner = read('lib/web3/deposit-scanner.ts');

  it('keeps each single-rail pass to its own rail', () => {
    // A Solana-only pass that also hit Horizon (or the reverse) would double that rail's load.
    expect(scanner).toMatch(/\(rails === 'all' \|\| rails === 'stellar'\) && params\.stellarAddress/);
    expect(scanner).toMatch(/\(rails === 'all' \|\| rails === 'solana'\) && params\.solanaAddress/);
  });

  it('never stamps last_deposit_scan_at on a Stellar-only pass', () => {
    // The subtle one. A Stellar pass that stamped the daily key would make every swept user look
    // freshly scanned, and their EVM chains would never come due again — deposits would stop
    // being found on six chains at once, silently.
    expect(scanner).toMatch(/if \(rails === 'all'\)[\s\S]{0,200}last_deposit_scan_at/);
  });

  it('skips the billed EVM chains on a Stellar-only pass', () => {
    // Each EVM chain is one billed alchemy_getAssetTransfers call. Sweeping them every two
    // minutes is the cost this whole change exists to avoid.
    expect(scanner).toMatch(/rails === 'all' && apiKey && address/);
  });
});

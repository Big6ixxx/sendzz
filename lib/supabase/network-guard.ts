/**
 * Keeps testnet activity out of the production database.
 *
 * The app and the database are two independent configurations, and nothing linked them:
 * pointing the app at Arc Testnet while it still held production Supabase credentials
 * would write testnet transfers straight into the live tables — same `users` rows (Circle
 * smart account addresses are deterministic, so a tester resolves to an existing user),
 * same `transfers`, and the same `public_transaction_feed` that powers the public
 * dashboard.
 *
 * So a database now has to *declare itself* usable for testnet writes:
 *
 *   NEXT_PUBLIC_SUPABASE_NETWORK="testnet"   set alongside the testnet project's URL/keys
 *
 * Unset means production. That direction matters: forgetting the variable blocks writes,
 * rather than silently permitting them. A mainnet build is unaffected — it writes to
 * whatever database it is given, exactly as production does today.
 *
 * What is blocked: table mutations (insert/update/upsert/delete) and any RPC not known to
 * be read-only. What is not: reads, and Supabase Auth. Auth is deliberately left alone
 * because blocking it means nobody can log in and there is nothing to demo at all; the
 * cost is that sign-in still creates an auth session row in whichever project is
 * configured. That is the one carve-out, and it is why this is a stopgap until the
 * testnet preview points at its own Supabase project.
 */

import { IS_TESTNET } from '@/lib/web3/network';

export type DbNetwork = 'testnet' | 'mainnet';

/**
 * Supabase project refs that are production — no matter what the environment claims.
 *
 * The marker below is just a string, and setting it next to a production URL is the
 * obvious thing to do when you are "in testnet mode". That mistake switched the guard
 * off and let a test bridge and a test user write into live tables. A label alone is
 * not a safety mechanism, so production is now identified by the database's own
 * identity, and no environment variable can talk the guard out of it.
 *
 * These refs are not secrets — they are the subdomain of NEXT_PUBLIC_SUPABASE_URL and
 * ship to every browser already. Add a ref here the moment a project holds real data.
 */
const PRODUCTION_PROJECT_REFS = ['bnqafdsqkuktaeswrtuu'];

/** `https://<ref>.supabase.co` → `<ref>` */
function projectRef(url: string | undefined): string {
  return url?.match(/^https?:\/\/([^.]+)\./)?.[1] ?? '';
}

export const SUPABASE_PROJECT_REF = projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL);

/** True when the configured database is a known production project. */
export const IS_PRODUCTION_DB = PRODUCTION_PROJECT_REFS.includes(SUPABASE_PROJECT_REF);

/** Which database this deployment claims to be talking to. Unmarked means production. */
export const DB_NETWORK: DbNetwork =
  process.env.NEXT_PUBLIC_SUPABASE_NETWORK === 'testnet' ? 'testnet' : 'mainnet';

/**
 * Writes are allowed when the app and the database genuinely agree about which world
 * they are in. A mainnet app writes anywhere; a testnet app writes only to a database
 * that both declares itself testnet *and* is not a known production project.
 *
 * The second condition is the one that matters: it cannot be satisfied by editing an
 * environment variable, only by pointing at a different database.
 */
export const DB_WRITES_ALLOWED =
  !IS_TESTNET || (DB_NETWORK === 'testnet' && !IS_PRODUCTION_DB);

/**
 * RPCs that only read. Everything else is assumed to write — `create_transfer_and_lock_
 * balance`, `claim_transfer` and `finalize_withdrawal_success` are the real money paths
 * in this app, and none of them go through `.insert()`, so an allowlist is the only
 * approach that cannot be defeated by adding a new function.
 */
const READ_ONLY_RPCS = new Set([
  'get_public_stats',
  'get_public_feed_totals',
  'get_kyc_status_and_totals',
]);

/** PostgREST query-builder methods that modify data. */
const MUTATING_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

export class TestnetWriteBlockedError extends Error {
  constructor(operation: string) {
    const reason = IS_PRODUCTION_DB
      ? `"${SUPABASE_PROJECT_REF}" is a production database. Marking it ` +
        `NEXT_PUBLIC_SUPABASE_NETWORK="testnet" does not make it one, and is ignored.`
      : `the configured Supabase project is not marked as a testnet database.`;

    super(
      `Blocked "${operation}": the app is running on testnet and ${reason}\n\n` +
        `This write would land in production data. Fix one of these:\n` +
        `  • point NEXT_PUBLIC_SUPABASE_URL / keys at a SEPARATE testnet Supabase ` +
        `project and set NEXT_PUBLIC_SUPABASE_NETWORK="testnet"\n` +
        `  • or set NEXT_PUBLIC_SIMULATION_MODE="false" to run against mainnet.`,
    );
    this.name = 'TestnetWriteBlockedError';
  }
}

/** Re-binds methods so the proxy doesn't break PostgREST's chained builders. */
function passThrough(target: object, prop: string | symbol, receiver: unknown) {
  const value = Reflect.get(target, prop, receiver);
  return typeof value === 'function' ? value.bind(target) : value;
}

function guardQueryBuilder<T extends object>(builder: T, table: string): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && MUTATING_METHODS.has(prop)) {
        return () => {
          throw new TestnetWriteBlockedError(`${prop} on "${table}"`);
        };
      }
      return passThrough(target, prop, receiver);
    },
  });
}

/**
 * Wraps a Supabase client so writes fail fast instead of reaching production.
 *
 * Returns the client untouched when writes are allowed, so production and a correctly
 * configured testnet deployment both run with no proxy in the path at all.
 */
export function guardSupabaseWrites<T extends object>(client: T): T {
  if (DB_WRITES_ALLOWED) return client;

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => {
          const builder = (Reflect.get(target, prop, receiver) as (t: string) => object).call(
            target,
            table,
          );
          return guardQueryBuilder(builder, table);
        };
      }

      if (prop === 'rpc') {
        return (fn: string, ...rest: unknown[]) => {
          if (!READ_ONLY_RPCS.has(fn)) throw new TestnetWriteBlockedError(`rpc ${fn}()`);
          return (
            Reflect.get(target, prop, receiver) as (f: string, ...a: unknown[]) => unknown
          ).call(target, fn, ...rest);
        };
      }

      return passThrough(target, prop, receiver);
    },
  });
}

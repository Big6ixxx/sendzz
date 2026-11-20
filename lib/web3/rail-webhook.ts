/**
 * Solana and Stellar Address Activity events: find which of our users just moved money, and
 * scan their wallet now instead of waiting for the sweep to reach them.
 *
 * The sweep in the reconcile cron checks a rotating batch of addresses per run, so with a few
 * hundred users an arrival could wait hours to be recorded and emailed. This turns that into
 * seconds. The daily full sweep stays as the backstop for any event that never arrives.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { NETWORK } from '@/lib/network';
import { solanaRpcUrl } from '@/lib/solana/rpc';
import {
  solanaPayloadAddresses,
  stellarArrivalAddresses,
  type ScannedRail,
} from './alchemy-webhook';
import { scanUsdcDeposits } from './deposit-scanner';

/** Users scanned per event. A real payment touches one or two of ours. */
const MAX_USERS_PER_EVENT = 10;

/** `getMultipleAccounts` takes at most 100 keys per call. */
const MAX_TOKEN_ACCOUNT_LOOKUPS = 100;

type UserRow = { id: string; address: string };

async function usersByAddress(rail: ScannedRail, addresses: string[]): Promise<UserRow[]> {
  if (addresses.length === 0) return [];
  const column = rail === 'solana' ? 'solana_address' : 'stellar_address';
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, solana_address, stellar_address')
    .in(column, addresses);
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  return (data ?? [])
    .map((u) => ({ id: u.id, address: (rail === 'solana' ? u.solana_address : u.stellar_address) ?? '' }))
    .filter((u) => u.address);
}

/**
 * Owners of the USDC token accounts among `keys`.
 *
 * A Solana event may name a user's USDC token account rather than their wallet, since that is
 * the account the transfer actually touches. One RPC call resolves them all.
 */
async function usdcTokenAccountOwners(keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const mint = NETWORK.solana.usdcMint;
  const connection = new Connection(solanaRpcUrl(), 'confirmed');
  const infos = [];
  for (let i = 0; i < keys.length; i += MAX_TOKEN_ACCOUNT_LOOKUPS) {
    const chunk = keys.slice(i, i + MAX_TOKEN_ACCOUNT_LOOKUPS).map((k) => new PublicKey(k));
    infos.push(...(await connection.getMultipleParsedAccounts(chunk)).value);
  }
  const owners = new Set<string>();
  for (const info of infos) {
    const parsed = (info?.data as { parsed?: { type?: string; info?: { mint?: string; owner?: string } } })
      ?.parsed;
    if (parsed?.type === 'account' && parsed.info?.mint === mint && parsed.info.owner) {
      owners.add(parsed.info.owner);
    }
  }
  return [...owners];
}

async function usersInEvent(rail: ScannedRail, payload: unknown): Promise<UserRow[]> {
  if (rail === 'stellar') return usersByAddress('stellar', stellarArrivalAddresses(payload));

  const keys = solanaPayloadAddresses(payload);
  const direct = await usersByAddress('solana', keys);
  const matched = new Set(direct.map((u) => u.address));
  const rest = keys.filter((k) => !matched.has(k));
  if (rest.length === 0) return direct;
  let owners: string[] = [];
  try {
    owners = await usdcTokenAccountOwners(rest);
  } catch (e) {
    // The wallets matched directly are still worth scanning; the sweep covers the rest.
    console.error('[RailWebhook] token account lookup failed:', e instanceof Error ? e.message : e);
  }
  return [...direct, ...(await usersByAddress('solana', owners.filter((o) => !matched.has(o))))];
}

/** Scan every user this event concerns. Returns the deposits recorded. */
export async function scanForRailEvent(rail: ScannedRail, payload: unknown, tag: string): Promise<number> {
  const users = await usersInEvent(rail, payload);
  if (users.length === 0) {
    console.log(`${tag} ${rail}: no Sendzz wallet in this event`);
    return 0;
  }

  const unique = [...new Map(users.map((u) => [u.id, u])).values()].slice(0, MAX_USERS_PER_EVENT);
  // In parallel, and one failure does not fail the delivery: a 500 makes Alchemy resend the
  // event and every user be scanned again. A user whose scan failed is left to the sweep.
  const results = await Promise.allSettled(
    unique.map((u) =>
      scanUsdcDeposits({
        userId: u.id,
        address: '',
        ...(rail === 'solana' ? { solanaAddress: u.address } : { stellarAddress: u.address }),
        rails: rail,
        trigger: 'webhook',
      }),
    ),
  );
  let inserted = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') inserted += r.value;
    else console.error(`${tag} ${rail}: scan failed, left to the sweep:`, r.reason instanceof Error ? r.reason.message : r.reason);
  }
  console.log(`${tag} ${rail}: scanned ${unique.length} wallet(s), ${inserted} deposit(s) recorded`);
  return inserted;
}

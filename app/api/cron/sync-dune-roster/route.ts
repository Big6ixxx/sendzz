/**
 * GET /api/cron/sync-dune-roster
 *
 * Publishes the list of wallet addresses Sendzz has created, so a public Dune dashboard can
 * scope on-chain queries to our users.
 *
 * ─── Why a roster exists at all ──────────────────────────────────────────────
 *
 * Nothing on an EVM chain says "Sendzz". Our smart accounts are Circle modular wallets, and
 * every one of them is the same ERC-1967 proxy that every other Circle app deploys — verified
 * on Base, byte-identical bytecode across our accounts. Gas is paid by Circle's paymaster, not
 * ours. The accounts are deployed lazily on first use, so there is no creation event of ours to
 * point at either, and the first address to fund an account is usually just another user.
 *
 * So filtering by contract gives you the whole Circle/CCTP ecosystem, which is what happens if
 * you query TokenMessenger directly. The addresses are the only boundary that exists.
 *
 * Stellar is the exception and needs nothing from this job: every Sendzz Stellar transaction is
 * fee-bumped by our gas station, so `fee_account = <sponsor>` isolates our activity causally,
 * from the first day, with no list at all.
 *
 * ─── What this does and does not claim ───────────────────────────────────────
 *
 * Every FIGURE on the dashboard stays verifiable: the metrics are chain queries anyone can
 * recompute against these addresses. What a reader has to take on trust is that the list is
 * complete — that we have not omitted addresses to flatter a number.
 *
 * Two things make that trustworthy rather than merely asserted:
 *
 *   1. It is generated, not curated. The query below is every user row with an address; no
 *      human decides what goes in.
 *   2. It cannot shrink. `users` is protected by a refuse-delete trigger (migration 043), so a
 *      row cannot be removed even by us, even by accident. The roster is append-only because
 *      the table underneath it is.
 *
 * Authorised with `Authorization: Bearer $CRON_SECRET`, like the reconcile job. Daily is ample:
 * a new signup appears within a day, and nothing downstream is time-critical.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { Database } from '@/types/database';

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Uploading replaces the table wholesale, so the payload is always the full roster. */
const DUNE_TABLE = 'sendzz_wallets';

/** Anything that is not a plain value gets quoted; addresses never need it, but be exact. */
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const duneKey = process.env.DUNE_API_KEY;
  if (!duneKey) {
    return NextResponse.json(
      { error: 'DUNE_API_KEY is not configured' },
      { status: 503 },
    );
  }

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('smart_account_address, solana_address, stellar_address, created_at')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[DuneRoster] user read failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One row per address, not per user.
  //
  // A user holds an address on each rail, and a Dune query joins on a single `address` column.
  // Flattening here keeps the SQL a plain `IN` rather than three columns unioned in every
  // query. No email, no id, nothing that ties an address back to a person — the roster answers
  // "is this ours", and nothing else.
  const rows: string[] = ['address,chain_family,created_at'];
  let evm = 0;
  let solana = 0;
  let stellar = 0;

  for (const u of users ?? []) {
    const created = u.created_at ?? '';
    if (u.smart_account_address) {
      // Lower-cased: Dune stores EVM addresses lower-case, and a checksummed literal silently
      // matches nothing.
      rows.push(`${csvCell(u.smart_account_address.toLowerCase())},evm,${csvCell(created)}`);
      evm++;
    }
    if (u.solana_address) {
      // Base58 is case-sensitive — normalising it would break the match.
      rows.push(`${csvCell(u.solana_address)},solana,${csvCell(created)}`);
      solana++;
    }
    if (u.stellar_address) {
      rows.push(`${csvCell(u.stellar_address)},stellar,${csvCell(created)}`);
      stellar++;
    }
  }

  if (rows.length === 1) {
    // Never publish an empty roster over a good one: an upload replaces the table, so a
    // transient empty read would blank every dashboard that reads it.
    console.error('[DuneRoster] refusing to upload an empty roster.');
    return NextResponse.json({ error: 'roster came back empty' }, { status: 500 });
  }

  const res = await fetch('https://api.dune.com/api/v1/uploads/csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DUNE-API-KEY': duneKey },
    body: JSON.stringify({
      table_name: DUNE_TABLE,
      description:
        'Wallet addresses created by Sendzz (sendzz.io), one row per address. Published so ' +
        'on-chain activity can be scoped to Sendzz users: EVM smart accounts are Circle ' +
        'modular wallets and carry no app-specific marker on chain. Generated from our user ' +
        'table, append-only, no personal data.',
      // Public on purpose. A roster nobody can read is a roster nobody can check.
      is_private: false,
      data: rows.join('\n'),
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`[DuneRoster] upload failed ${res.status}: ${body.slice(0, 300)}`);
    return NextResponse.json({ error: 'Dune upload failed', status: res.status }, { status: 502 });
  }

  console.log(
    `[DuneRoster] published ${rows.length - 1} addresses ` +
      `(evm ${evm}, solana ${solana}, stellar ${stellar}) to ${DUNE_TABLE}.`,
  );
  return NextResponse.json({
    ok: true,
    table: DUNE_TABLE,
    addresses: rows.length - 1,
    breakdown: { evm, solana, stellar },
  });
}

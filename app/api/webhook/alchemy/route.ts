/**
 * POST /api/webhook/alchemy — USDC arrived at a watched address.
 *
 * Replaces polling as the PRIMARY way an on-chain deposit is noticed. The reconcile cron still
 * sweeps for anything this missed; see lib/web3/alchemy-webhook.ts for why both exist.
 *
 * Always answers 200 once the signature checks out, including when a payload turns out to hold
 * nothing we care about. Alchemy retries non-2xx, and retrying a well-formed event we have
 * correctly decided to ignore just bills us twice to reach the same conclusion. A 4xx is
 * reserved for "this did not come from Alchemy", a 5xx for "we failed to store it".
 *
 * Deliveries are NOT written to `webhook_events`. Most of them are not deposits — money leaving,
 * and on Arc the same send reported three ways — so logging them filled the admin log with rows
 * nobody needs to read. They go to stdout instead, where the reconcile output already lives.
 * Nothing is lost by that: replay safety comes from the deposits table, whose unique
 * (user_id, tx_hash) index makes a repeated delivery a no-op no matter how often it arrives.
 */

import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getAddress } from 'viem';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
import { USDC_ADDRESSES } from '@/lib/circle/gateway';
import { transferAmountUsdc } from '@/lib/web3/deposit-amount';
import {
  chainForWebhookId,
  isIncomingUsdc,
  toAlchemyTransfer,
  verifyAlchemySignature,
  webhookSecretEnv,
  type AlchemyWebhookPayload,
} from '@/lib/web3/alchemy-webhook';
import {
  insertDeposits,
  ZERO_ADDRESS,
  type DepositRow,
} from '@/lib/web3/deposit-scanner';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const requestId = crypto.randomBytes(4).toString('hex');
  const tag = `[Alchemy Webhook] [${requestId}]`;

  try {
    const rawBody = await req.text();
    if (!rawBody) return new Response('Empty body', { status: 400 });

    let payload: AlchemyWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as AlchemyWebhookPayload;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Which of our webhooks sent this? Also decides which signing key to check against, so an
    // event naming a webhook we never configured is refused before any work is done.
    const chain = chainForWebhookId(payload.webhookId);
    if (!chain) {
      console.error(`${tag} unknown webhookId ${payload.webhookId ?? '(none)'} — rejected`);
      return new Response('Unknown webhook', { status: 401 });
    }

    const signingKey = process.env[webhookSecretEnv(chain)];
    if (!signingKey) {
      // Refuse rather than accept unverified: an unsigned path into the deposit ledger would
      // let anyone credit themselves any amount.
      console.error(`${tag} ${webhookSecretEnv(chain)} not set — refusing to process ${chain}`);
      return new Response('Webhook secret not configured', { status: 500 });
    }

    if (
      !verifyAlchemySignature({
        rawBody,
        signature: req.headers.get('x-alchemy-signature'),
        signingKey,
      })
    ) {
      console.error(`${tag} signature mismatch on ${chain} — rejected`);
      return new Response('Invalid signature', { status: 401 });
    }

    const eventId = payload.id ?? '(no id)';
    const activities = payload.event?.activity ?? [];

    // ── Keep only what could be an incoming USDC payment ──────────────────────
    //
    // Done BEFORE any database work, because most deliveries are not deposits at all. An Address
    // Activity webhook fires on everything the address touches — money going OUT, and on Arc the
    // same native send reported three ways (external, internal, and a `token` entry against the
    // system contract). Filtering first means an outgoing send costs one cheap pass and no query.
    const candidates = activities.filter(
      (a) =>
        !!a.hash &&
        !!a.toAddress &&
        isIncomingUsdc(a, chain) &&
        // Minted in, not paid in — a bridge delivery, recorded as a bridge elsewhere.
        a.fromAddress?.toLowerCase() !== ZERO_ADDRESS,
    );

    if (candidates.length === 0) {
      // Logged, not silent. "Nothing here for us" and "we never got called" look identical in a
      // log that only speaks on success, and that is exactly what made the first live delivery
      // impossible to diagnose.
      console.log(
        `${tag} ${chain}: ${activities.length} activity item(s), none an incoming USDC payment ` +
          `(event ${eventId})`,
      );
      return NextResponse.json({ ok: true, credited: 0 });
    }

    // ── Who do these belong to? ───────────────────────────────────────────────
    //
    // Alchemy sends addresses lowercased; `smart_account_address` is stored EIP-55 checksummed,
    // as Circle returns it. Querying one against the other matches nothing — silently, because
    // an address that is not ours is a normal thing for this route to see. That is what made the
    // first live deposit fall through to the cron with no error anywhere. Both spellings are
    // asked for, so the match works whichever way a row was written and still uses the index.
    const recipients = new Set<string>();
    for (const a of candidates) {
      const raw = a.toAddress!;
      recipients.add(raw.toLowerCase());
      try {
        recipients.add(getAddress(raw));
      } catch {
        // Not a valid address; the lowercase form is still worth asking for.
      }
    }

    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, smart_account_address')
      .in('smart_account_address', Array.from(recipients));

    if (userError) {
      console.error(`${tag} user lookup failed: ${userError.message}`);
      return new Response('Internal error', { status: 500 });
    }

    const userByAddress = new Map<string, string>();
    for (const u of users ?? []) {
      if (u.smart_account_address) {
        userByAddress.set(u.smart_account_address.toLowerCase(), u.id);
      }
    }

    // ── Turn activity into deposits ───────────────────────────────────────────
    const rows: DepositRow[] = [];
    const seen = new Set<string>();

    for (const activity of candidates) {
      const userId = userByAddress.get(activity.toAddress!.toLowerCase());
      // Watched, but not one of ours — normal right after a user is removed from the list.
      if (!userId) continue;

      const amount = transferAmountUsdc(toAlchemyTransfer(activity));
      if (amount === null) {
        // Crediting an amount we cannot establish would write a wrong number into the ledger.
        // Skipping is safe — the cron backstop re-derives it — but it must not be silent.
        console.error(
          `${tag} ${chain} ${activity.hash}: no usable amount ` +
            `(value=${activity.value}, raw=${activity.rawContract?.rawValue ?? 'none'}). ` +
            `Not recorded — the reconcile cron will pick it up.`,
        );
        continue;
      }
      if (amount <= 0) continue;

      const key = `${userId}:${activity.hash!.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        user_id: userId,
        tx_hash: activity.hash!.toLowerCase(),
        amount_usdc: amount,
        network: chain,
        provider: 'onchain',
        status: 'confirmed',
        provider_metadata: {
          source: 'alchemy-webhook',
          from: activity.fromAddress ?? null,
          block: activity.blockNum ?? null,
          contract: activity.rawContract?.address ?? USDC_ADDRESSES[chain],
        },
      });
    }

    if (rows.length === 0) {
      console.log(
        `${tag} ${chain}: ${candidates.length} incoming USDC payment(s), none to a known address ` +
          `(event ${eventId})`,
      );
      return NextResponse.json({ ok: true, credited: 0 });
    }

    for (const r of rows) {
      console.log(`${tag} ${chain} <- ${r.amount_usdc} USDC to ${r.user_id} tx=${r.tx_hash}`);
    }

    // The same insert the scanner uses: upsert on (user_id, tx_hash), so an arrival the cron
    // already found is a no-op rather than a duplicate credit, and the deposit email fires once.
    const credited = await insertDeposits(rows);

    // `credited` counts rows that actually landed. Fewer than we saw is normal and not a
    // failure — it means the cron backstop got there first — but the two must be distinguishable
    // in the logs, because "webhook ran and stored nothing" and "webhook stored it" look
    // identical otherwise.
    console.log(
      `${tag} ${chain}: ${rows.length} arrival(s), ${credited} CREDITED, ` +
        `${rows.length - credited} already recorded`,
    );

    return NextResponse.json({ ok: true, credited });
  } catch (err) {
    // 500 so Alchemy retries — the event was genuine and we failed to store it.
    console.error(`${tag} error:`, err);
    return new Response('Internal error', { status: 500 });
  }
}

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
 */

import crypto from 'crypto';
import { NextResponse } from 'next/server';
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

    // ── Idempotency ───────────────────────────────────────────────────────────
    // Alchemy retries until it gets a 2xx, so the same event id can arrive several times. The
    // unique index on (provider, event_id) makes the duplicate lose here rather than downstream.
    const eventId = payload.id ?? `alchemy-${chain}-${crypto.randomUUID()}`;
    const { error: dupeError } = await supabaseAdmin.from('webhook_events').insert({
      provider: 'alchemy',
      event_id: eventId,
      event_type: `${payload.type ?? 'ADDRESS_ACTIVITY'}:${chain}`,
      payload_json: JSON.parse(rawBody),
    });
    if (dupeError) {
      // 23505 = unique violation: seen already, and the first delivery did the work.
      if (dupeError.code === '23505') {
        console.log(`${tag} ${eventId} already processed — acknowledging`);
        return NextResponse.json({ ok: true, duplicate: true });
      }
      console.error(`${tag} could not record event: ${dupeError.message}`);
      return new Response('Internal error', { status: 500 });
    }

    const activities = payload.event?.activity ?? [];
    if (activities.length === 0) return NextResponse.json({ ok: true, credited: 0 });

    // ── Who do these belong to? ───────────────────────────────────────────────
    // One lookup for every address in the batch. The smart-account address is the same on every
    // EVM chain, so this is a plain address match with no per-chain handling.
    const recipients = Array.from(
      new Set(
        activities
          .map((a) => a.toAddress?.toLowerCase())
          .filter((a): a is string => !!a),
      ),
    );
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, smart_account_address')
      .in('smart_account_address', recipients);

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

    for (const activity of activities) {
      const to = activity.toAddress?.toLowerCase();
      const userId = to ? userByAddress.get(to) : undefined;
      // Not one of ours. Alchemy watches an address list we control, so this is normal right
      // after a user is removed, and never an error.
      if (!userId || !activity.hash) continue;

      if (!isIncomingUsdc(activity, chain)) continue;

      // Minted in, not paid in — a bridge delivery, recorded as a bridge elsewhere.
      if (activity.fromAddress?.toLowerCase() === ZERO_ADDRESS) continue;

      const amount = transferAmountUsdc(toAlchemyTransfer(activity));
      if (amount === null) {
        // Crediting an amount we cannot establish would write a wrong number into the ledger.
        // Skipping is safe — the cron backstop re-derives it from the Transfers API — but it is
        // silent, so say so.
        console.error(
          `${tag} ${chain} ${activity.hash}: no usable amount ` +
            `(value=${activity.value}, raw=${activity.rawContract?.rawValue ?? 'none'}). ` +
            `Not recorded — the reconcile cron will pick it up.`,
        );
        continue;
      }
      if (amount <= 0) continue;

      const key = `${userId}:${activity.hash.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        user_id: userId,
        tx_hash: activity.hash.toLowerCase(),
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

    if (rows.length === 0) return NextResponse.json({ ok: true, credited: 0 });

    // One line per arrival, with the figures someone reading production logs actually needs:
    // what was credited, to whom, and the hash to check on chain.
    for (const r of rows) {
      console.log(
        `${tag} ${chain} <- ${r.amount_usdc} USDC to ${r.user_id} tx=${r.tx_hash}`,
      );
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

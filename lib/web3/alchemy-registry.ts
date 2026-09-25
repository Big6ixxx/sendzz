/**
 * Keeping Alchemy's watched-address list in step with our users.
 *
 * A webhook only fires for addresses it has been told to watch, so this is the half of the
 * mechanism that decides whether a deposit is ever seen at all. An address that never gets
 * registered produces no events and no error — silence that looks exactly like "nobody sent
 * anything". The reconcile cron is what stops that silence being permanent.
 *
 * The smart-account address is CREATE2-deterministic and therefore identical on every EVM
 * chain, so one address is registered with each chain's webhook rather than a different address
 * per chain.
 *
 * Failures here are logged and swallowed. Registration is best-effort by design: it must never
 * fail wallet creation, because a user without a wallet is a worse outcome than a user whose
 * deposits are found by the cron a few minutes later.
 */

import { webhookIdEnv } from './alchemy-webhook';
import { DEPOSIT_CHAINS, type SupportedChain } from '@/lib/circle/gateway';

const NOTIFY_URL = 'https://dashboard.alchemy.com/api/update-webhook-addresses';

/** Alchemy caps a single request; chunked well under it so a large sync cannot be refused. */
const CHUNK = 100;

function authToken(): string | undefined {
  return process.env.ALCHEMY_NOTIFY_TOKEN;
}

/** Chains with a webhook id set. */
function configuredWebhookChains(): SupportedChain[] {
  return DEPOSIT_CHAINS.filter((chain) => !!process.env[webhookIdEnv(chain)]);
}

async function patchAddresses(
  webhookId: string,
  addressesToAdd: string[],
  addressesToRemove: string[],
  token: string,
): Promise<boolean> {
  const res = await fetch(NOTIFY_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Alchemy-Token': token },
    body: JSON.stringify({
      webhook_id: webhookId,
      addresses_to_add: addressesToAdd,
      addresses_to_remove: addressesToRemove,
    }),
  });
  if (!res.ok) {
    console.error(
      `[AlchemyRegistry] ${webhookId} update failed ${res.status}: ${await res.text().catch(() => '')}`,
    );
    return false;
  }
  return true;
}

/**
 * Watch these addresses on every configured chain.
 *
 * Idempotent at Alchemy's end — re-adding an address it already watches is a no-op — so this is
 * safe to call on every wallet creation and again from the periodic sync, and neither needs to
 * know what the other did.
 */
export async function watchAddresses(addresses: string[]): Promise<void> {
  const token = authToken();
  const clean = Array.from(
    new Set(addresses.filter((a) => !!a && a.startsWith('0x')).map((a) => a.toLowerCase())),
  );
  if (clean.length === 0) return;

  if (!token) {
    // Not an error at startup — webhooks are optional, and the cron still finds deposits. But
    // it does mean push delivery is off, which is worth saying once per attempt.
    console.warn('[AlchemyRegistry] ALCHEMY_NOTIFY_TOKEN not set — addresses not registered.');
    return;
  }

  const chains = configuredWebhookChains();
  if (chains.length === 0) {
    console.warn('[AlchemyRegistry] no ALCHEMY_WEBHOOK_ID_* configured — nothing to register.');
    return;
  }

  for (const chain of chains) {
    const webhookId = process.env[webhookIdEnv(chain)]!;
    for (let i = 0; i < clean.length; i += CHUNK) {
      const batch = clean.slice(i, i + CHUNK);
      try {
        await patchAddresses(webhookId, batch, [], token);
      } catch (e) {
        console.error(`[AlchemyRegistry] ${chain} registration error:`, e);
      }
    }
  }
}

/** Convenience for the single-address case, so callers don't build an array. */
export async function watchAddress(address: string | null | undefined): Promise<void> {
  if (!address) return;
  await watchAddresses([address]);
}

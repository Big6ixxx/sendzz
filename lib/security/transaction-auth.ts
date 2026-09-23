/**
 * Binding a PIN entry to the one transaction it was entered for.
 *
 * `verifyPin` answers a question — "are these the right four digits?" — and an answer is not an
 * authorisation. It can be obtained once and reused all afternoon, for any amount, to anyone.
 * What a payment needs is a token that is true of exactly one operation and then stops being
 * true of anything, which is what this module mints and spends.
 *
 * The shape of the guarantee:
 *
 *   mint    PIN accepted → a random token, returned once, stored only as a digest, tied to
 *           (user, device session, purpose, payload) and expiring in minutes.
 *   consume the server hashes THE PARAMETERS IT IS ABOUT TO ACT ON and requires them to match.
 *           Spent atomically, so a replay finds nothing left.
 *
 * The critical detail is whose parameters get hashed on the way in. A consumer that hashed a
 * payload handed to it by the caller would authorise whatever the caller claimed to be doing,
 * which is no check at all. Every call site builds the descriptor from its own validated
 * arguments — the same values it is about to send money with — and that is what makes the
 * binding mean anything.
 */

import crypto from 'node:crypto';

import { getVerifiedIdentity } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/adminClient';

/**
 * How long an authorisation lives, per kind of operation.
 *
 * Set by the SERVER from the purpose, never by the caller. A client that could name its own
 * expiry would name a long one, and the window is the only thing bounding how long a minted
 * token is worth stealing.
 *
 * The numbers follow the slowest step each flow has to survive between the PIN being typed and
 * the token being spent:
 *
 *   transfer / crypto_transfer / batch_send — the browser signs within seconds of the PIN.
 *   bridge — a chain switch and a bundler round trip sit in between.
 *   withdrawal — the long one, and not arbitrarily. When a balance is spread across networks,
 *     the withdrawal consolidates onto the settlement chain FIRST, which means a CCTP burn,
 *     an attestation wait and a mint before the payout order is even created. A three-minute
 *     token expires in the middle of that, and it expires AFTER the bridge — stranding a user
 *     who has already paid to move their money, with nothing to show for it. Fifteen minutes
 *     is the cost of not doing that to them, and it is bounded by everything else about the
 *     token: single use, one device session, one exact payload.
 */
const AUTHORIZATION_TTL_MS: Record<AuthorizationPurpose, number> = {
  transfer: 3 * 60 * 1000,
  crypto_transfer: 3 * 60 * 1000,
  batch_send: 3 * 60 * 1000,
  bridge: 5 * 60 * 1000,
  withdrawal: 15 * 60 * 1000,
  // A settings change is applied in the same tick the PIN is accepted.
  security_change: 2 * 60 * 1000,
};

/**
 * The kinds of operation a PIN can authorise.
 *
 * Compared verbatim on consumption, so these strings are part of the contract between the
 * browser and the server — a withdrawal token cannot be spent on a bridge even when every
 * other field matches.
 */
export type AuthorizationPurpose =
  | 'transfer'
  | 'crypto_transfer'
  | 'withdrawal'
  | 'bridge'
  | 'batch_send'
  /**
   * Weakening a security control — removing a passkey, unpairing an authenticator, turning
   * verification off, raising the threshold at which it applies.
   *
   * Not a payment, but the same requirement: without it, anyone who reaches an open session
   * can quietly strip every protection and then withdraw freely, which makes the other
   * factors decorative. The payload names WHICH control, so a token minted to remove an
   * authenticator cannot be spent removing a passkey.
   */
  | 'security_change';

/**
 * What the user was shown, reduced to the fields that decide where the money goes.
 *
 * Only things a user would notice changing belong here. Including something volatile — a
 * quote id, a gas estimate, a timestamp — would make the hash drift between the moment of
 * authorisation and the moment of use, and every payment would fail for a reason that has
 * nothing to do with security.
 */
export interface AuthorizationPayload {
  /** Email, wallet address, bank account number, or destination chain — whatever "to" means here. */
  destination: string;
  /** USDC. Normalised to 2dp, because that is the precision the user was shown. */
  amount: number | string;
  /** Settlement chain, where one is known when the PIN is entered. */
  chain?: string | null;
}

/**
 * The exact bytes that get hashed.
 *
 * This function IS the definition of "the same transaction". It is deliberately the only place
 * that decides, and both the mint and the consume path call it, because two copies of this
 * logic would eventually disagree about whitespace or casing and start refusing honest
 * payments in production with no way to tell why.
 *
 * Normalisation matters as much as the fields: an address that arrives checksummed on one path
 * and lowercased on another is the same destination, and a user who typed `10` and a route that
 * computed `10.00` are the same amount.
 */
function canonicalPayload(purpose: AuthorizationPurpose, payload: AuthorizationPayload): string {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount)) {
    throw new Error('Cannot authorise an operation without a numeric amount.');
  }

  return JSON.stringify({
    purpose,
    destination: String(payload.destination ?? '').trim().toLowerCase(),
    amount: amount.toFixed(2),
    chain: (payload.chain ?? '').trim().toLowerCase(),
  });
}

/** Digest of the canonical form. Exported for the tests, which assert the binding directly. */
export function payloadHash(
  purpose: AuthorizationPurpose,
  payload: AuthorizationPayload,
): string {
  return crypto.createHash('sha256').update(canonicalPayload(purpose, payload)).digest('hex');
}

/** Tokens are compared by digest, never stored in the clear. */
function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Mint an authorisation. The caller MUST have verified the PIN immediately before this.
 *
 * Returns the token exactly once — it is never readable again, here or anywhere else.
 */
export async function mintAuthorization(params: {
  userId: string;
  sessionId: string;
  purpose: AuthorizationPurpose;
  payload: AuthorizationPayload;
}): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_MS[params.purpose]).toISOString();

  const { error } = await supabaseAdmin.from('transaction_authorizations').insert({
    user_id: params.userId,
    session_id: params.sessionId,
    purpose: params.purpose,
    payload_hash: payloadHash(params.purpose, params.payload),
    token_hash: tokenHash(token),
    expires_at: expiresAt,
  });

  if (error) {
    console.error('[TxAuth] could not mint authorization:', error.message);
    throw new Error('Could not authorise this transaction. Please try again.');
  }

  return { token, expiresAt };
}

/** Raised when an operation is not authorised. Carries wording safe to show the user. */
export class AuthorizationError extends Error {
  constructor(message = 'This transaction was not authorised. Enter your PIN and try again.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Spend an authorisation for an operation, or refuse.
 *
 * `payload` must be built from the parameters the caller is about to act on — see the module
 * header on why anything else is theatre.
 *
 * Throws rather than returning false. A caller that forgot to check a boolean would move money;
 * a caller that forgets to catch an exception does not.
 */
export async function consumeAuthorization(params: {
  token: string | undefined | null;
  purpose: AuthorizationPurpose;
  payload: AuthorizationPayload;
  /** Passed through to session verification for callers without a cookie. */
  accessToken?: string;
}): Promise<void> {
  const { token, purpose, payload, accessToken } = params;

  if (!token) throw new AuthorizationError();

  const identity = await getVerifiedIdentity(accessToken);
  if (!identity) throw new AuthorizationError();

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', identity.email)
    .maybeSingle();
  if (!user?.id) throw new AuthorizationError();

  // One statement decides everything, and it is the statement that spends the token.
  //
  // Reading the row, checking it in JavaScript and writing `consumed_at` afterwards would leave
  // a window in which two requests both read an unspent token and both proceed — a double
  // withdrawal from one PIN entry. Filtering on `consumed_at IS NULL` inside the UPDATE makes
  // Postgres settle the race: whichever transaction gets there first is the only one that sees
  // a row come back.
  //
  // Every other condition rides along in the same WHERE clause rather than being checked
  // separately, so a mismatched payload, a foreign session or an expired token are all simply
  // "no row updated" — and the caller is told nothing about which one it was.
  const { data: spent, error } = await supabaseAdmin
    .from('transaction_authorizations')
    .update({ consumed_at: new Date().toISOString() })
    .eq('token_hash', tokenHash(token))
    .eq('user_id', user.id)
    .eq('session_id', identity.sessionId)
    .eq('purpose', purpose)
    .eq('payload_hash', payloadHash(purpose, payload))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('[TxAuth] could not consume authorization:', error.message);
    throw new AuthorizationError('Could not verify your PIN authorisation. Please try again.');
  }

  if (!spent || spent.length === 0) {
    throw new AuthorizationError();
  }
}

/**
 * Record that a browser-signed operation was PIN-authorised, without gating it.
 *
 * For the EVM paths, where the browser talks to Circle's bundler and the server is not in the
 * loop. Spending the token here cannot prevent the signature that follows, so this is evidence
 * rather than enforcement — but it is evidence that survives the session, and "was a PIN
 * entered for this?" is the first question asked when a user disputes a transfer.
 *
 * Never throws. This runs on a payment path, and an audit write that failed the payment it was
 * observing would be worse than the gap it records.
 */
export async function noteClientAuthorization(params: {
  token: string | undefined | null;
  purpose: AuthorizationPurpose;
  payload: AuthorizationPayload;
  accessToken?: string;
}): Promise<boolean> {
  try {
    await consumeAuthorization(params);
    return true;
  } catch (err) {
    if (!(err instanceof AuthorizationError)) {
      console.error('[TxAuth] audit note failed:', (err as Error).message);
    }
    return false;
  }
}

/**
 * Delete authorisations that are past their expiry.
 *
 * Spent and expired rows are both dead, but they are kept until expiry rather than on spend:
 * a row that was consumed thirty seconds ago is the answer to "did they authorise this?", and
 * the sweep is what bounds the table, not the spending.
 */
export async function pruneExpiredAuthorizations(): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin
      .from('transaction_authorizations')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      console.error('[TxAuth] prune failed:', error.message);
      return 0;
    }
    return data?.length ?? 0;
  } catch (err) {
    console.error('[TxAuth] prune failed:', (err as Error).message);
    return 0;
  }
}

import { supabaseAdmin } from './adminClient';

export interface EmailNotifPrefs {
  email_notif_transfer: boolean;
  email_notif_deposit: boolean;
  email_notif_withdrawal: boolean;
  email_notif_bridge: boolean;
  email_notif_security: boolean;
  push_notif_transfer: boolean;
  push_notif_deposit: boolean;
  push_notif_withdrawal: boolean;
  push_notif_bridge: boolean;
  push_notif_security: boolean;
}

export const DEFAULT_PREFS: EmailNotifPrefs = {
  email_notif_transfer: true,
  email_notif_deposit: true,
  email_notif_withdrawal: true,
  email_notif_bridge: true,
  email_notif_security: true,
  push_notif_transfer: true,
  push_notif_deposit: true,
  push_notif_withdrawal: true,
  push_notif_bridge: true,
  push_notif_security: true,
};

/**
 * Resolve a user by email, case-insensitively — some rows predate email normalisation and are
 * stored mixed-case.
 *
 * `_` and `%` are ILIKE wildcards and both are legal in an email, so the pattern is escaped:
 * unescaped, `a_b@x.com` would also match `axb@x.com`.
 *
 * A few addresses exist twice, differing only in case. `.maybeSingle()` throws on more than one
 * match, so this takes the oldest deterministically — reads and writes then agree on one row.
 */
async function getUserId(email: string): Promise<string | null> {
  const pattern = email.replace(/([\\%_])/g, '\\$1');
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .ilike('email', pattern)
    .order('created_at', { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}

export async function getEmailNotifPrefs(email: string): Promise<EmailNotifPrefs> {
  const userId = await getUserId(email);
  if (!userId) return { ...DEFAULT_PREFS };

  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      // `id`, not `user_id` — user_profiles has no `user_id` column. Filtering on one errors,
      // and the catch below then returns the all-on defaults, silently ignoring preferences.
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return { ...DEFAULT_PREFS };

    const row = data as Record<string, unknown>;
    return {
      email_notif_transfer:   (row.email_notif_transfer as boolean | undefined)   ?? true,
      email_notif_deposit:    (row.email_notif_deposit as boolean | undefined)    ?? true,
      email_notif_withdrawal: (row.email_notif_withdrawal as boolean | undefined) ?? true,
      email_notif_bridge:     (row.email_notif_bridge as boolean | undefined)     ?? true,
      email_notif_security:   (row.email_notif_security as boolean | undefined)   ?? true,
      push_notif_transfer:    (row.push_notif_transfer as boolean | undefined)    ?? true,
      push_notif_deposit:     (row.push_notif_deposit as boolean | undefined)     ?? true,
      push_notif_withdrawal:  (row.push_notif_withdrawal as boolean | undefined)  ?? true,
      push_notif_bridge:      (row.push_notif_bridge as boolean | undefined)      ?? true,
      push_notif_security:    (row.push_notif_security as boolean | undefined)    ?? true,
    };
  } catch (err) {
    console.error('[Supabase] Failed to fetch notification preferences:', err);
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Persist a preference change. THROWS on failure, so the caller can tell the user — swallowing
 * it means the UI confirms a save that never happened and mail keeps arriving.
 *
 * Upsert, not update: not every user has a user_profiles row yet, and an UPDATE matching nothing
 * reports success while changing nothing.
 */
export async function saveEmailNotifPrefs(
  email: string,
  prefs: Partial<EmailNotifPrefs>
): Promise<void> {
  const userId = await getUserId(email);
  if (!userId) throw new Error(`User not found: ${email}`);

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert(
      { id: userId, email: email.toLowerCase(), ...prefs },
      { onConflict: 'id' },
    );

  if (error) {
    console.error('[Supabase] Error saving notification preferences:', error.message);
    throw new Error(`Could not save notification preferences: ${error.message}`);
  }
}

/**
 * Quick guard: returns true if the user wants this category of notification.
 *
 * `category` covers both rails — `email_notif_*` and `push_notif_*` are stored on the same row,
 * so this serves the push dispatcher too.
 *
 * Fails open (returns true) so a missing profile never silently blocks a notification. A user
 * receiving one they did not want is recoverable; one they were relying on and never got is not.
 */
export async function userWantsEmail(
  email: string,
  category: keyof EmailNotifPrefs
): Promise<boolean> {
  try {
    const prefs = await getEmailNotifPrefs(email);
    return prefs[category] !== false;
  } catch {
    return true; // fail open
  }
}


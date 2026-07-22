import { supabaseAdmin } from './adminClient';

export interface EmailNotifPrefs {
  email_notif_transfer: boolean;
  email_notif_deposit: boolean;
  email_notif_withdrawal: boolean;
  email_notif_bridge: boolean;
  email_notif_security: boolean;
  email_notif_system: boolean;
  push_notif_transfer: boolean;
  push_notif_wallet: boolean;
  push_notif_bridge: boolean;
  push_notif_security: boolean;
  push_notif_system: boolean;
}

export const DEFAULT_PREFS: EmailNotifPrefs = {
  email_notif_transfer: true,
  email_notif_deposit: true,
  email_notif_withdrawal: true,
  email_notif_bridge: true,
  email_notif_security: true,
  email_notif_system: true,
  push_notif_transfer: true,
  push_notif_wallet: true,
  push_notif_bridge: true,
  push_notif_security: true,
  push_notif_system: true,
};

async function getUserId(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  return data?.id ?? null;
}

export async function getEmailNotifPrefs(email: string): Promise<EmailNotifPrefs> {
  const userId = await getUserId(email);
  if (!userId) return { ...DEFAULT_PREFS };

  try {
    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return { ...DEFAULT_PREFS };

    const row = data as any;
    return {
      email_notif_transfer:   row.email_notif_transfer   ?? true,
      email_notif_deposit:    row.email_notif_deposit    ?? true,
      email_notif_withdrawal: row.email_notif_withdrawal ?? true,
      email_notif_bridge:     row.email_notif_bridge     ?? true,
      email_notif_security:   row.email_notif_security   ?? true,
      email_notif_system:     row.email_notif_system     ?? true,
      push_notif_transfer:    row.push_notif_transfer    ?? true,
      push_notif_wallet:      row.push_notif_wallet      ?? true,
      push_notif_bridge:      row.push_notif_bridge      ?? true,
      push_notif_security:    row.push_notif_security    ?? true,
      push_notif_system:      row.push_notif_system      ?? true,
    };
  } catch (err) {
    console.error('[Supabase] Failed to fetch notification preferences:', err);
    return { ...DEFAULT_PREFS };
  }
}

export async function saveEmailNotifPrefs(
  email: string,
  prefs: Partial<EmailNotifPrefs>
): Promise<void> {
  const userId = await getUserId(email);
  if (!userId) throw new Error(`User not found: ${email}`);

  try {
    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update(prefs as any)
      .eq('user_id', userId);

    if (error) {
      console.warn('[Supabase] Error updating notification preferences:', error.message);
    }
  } catch (err) {
    console.error('[Supabase] Failed to save notification preferences:', err);
  }
}

/**
 * Quick guard: returns true if the user wants this category of email.
 * Fails open (returns true) so a missing profile never silently blocks emails.
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


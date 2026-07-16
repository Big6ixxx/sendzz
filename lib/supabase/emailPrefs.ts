import { supabaseAdmin } from './adminClient';

export interface EmailNotifPrefs {
  email_notif_transfer: boolean;
  email_notif_deposit: boolean;
  email_notif_withdrawal: boolean;
  email_notif_bridge: boolean;
  email_notif_security: boolean;
}

export const DEFAULT_PREFS: EmailNotifPrefs = {
  email_notif_transfer: true,
  email_notif_deposit: true,
  email_notif_withdrawal: true,
  email_notif_bridge: true,
  email_notif_security: true,
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

  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select(
      'email_notif_transfer, email_notif_deposit, email_notif_withdrawal, email_notif_bridge, email_notif_security'
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { ...DEFAULT_PREFS };

  // Cast needed until Supabase types are regenerated after migration 033
  const row = data as any;
  return {
    email_notif_transfer:   row.email_notif_transfer   ?? true,
    email_notif_deposit:    row.email_notif_deposit    ?? true,
    email_notif_withdrawal: row.email_notif_withdrawal ?? true,
    email_notif_bridge:     row.email_notif_bridge     ?? true,
    email_notif_security:   row.email_notif_security   ?? true,
  };
}

export async function saveEmailNotifPrefs(
  email: string,
  prefs: Partial<EmailNotifPrefs>
): Promise<void> {
  const userId = await getUserId(email);
  if (!userId) throw new Error(`User not found: ${email}`);

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update(prefs as any) // cast until types regenerated after migration 033
    .eq('user_id', userId);

  if (error) throw error;
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

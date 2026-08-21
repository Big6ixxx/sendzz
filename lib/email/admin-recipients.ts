/**
 * Who gets an operational alert.
 *
 * Read from `ADMIN_EMAILS` — the same list that grants access to the admin dashboard, so
 * everyone alerted is someone who can act on it.
 *
 * Pure, and free of any database read: this list is needed exactly when something is already
 * broken, and parsing is where the mistakes live anyway.
 */
export function parseAdminRecipients(adminEmailsEnv: string | undefined): string[] {
  const seen = new Set<string>();

  for (const entry of (adminEmailsEnv || "").split(",")) {
    const email = entry.trim().toLowerCase();
    // A bare non-empty string is not an address. One malformed entry in a comma-separated env
    // var must not take the whole alert down with a provider-side rejection.
    if (!email || !email.includes("@")) continue;
    seen.add(email);
  }

  return Array.from(seen);
}

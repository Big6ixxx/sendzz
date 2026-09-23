import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Identity comes from the session, never from an argument.
 *
 * Thirteen of the eighteen findings in the security audit were one mistake wearing different
 * hats: a `'use server'` export that took an email or a user id and trusted it. Every export in
 * such a module is a POST endpoint anyone can invoke once they know its action id, so
 * `registerUserAddress(email, address)` was an open API for redirecting somebody else's money,
 * and the 2FA routes were an open API for switching off their protections.
 *
 * Fixing the thirteen does not stop the fourteenth. This does: it walks every `'use server'`
 * module and fails when an export takes a caller-supplied identity without deriving one from
 * the session. A test rather than a convention, because a convention is what let this happen.
 */

const ROOTS = ['lib', 'app', 'components', 'hooks'];

/** Parameter names that mean "who is asking" and therefore must never be trusted. */
const IDENTITY_PARAMS = /\b(email|userEmail|senderEmail|userId|user_id|privyUserId)\s*[?:]/;

/** Any of these proves the module resolves identity itself. */
const DERIVES_IDENTITY =
  /\b(requireUser|requireUserId|requireAdmin|getVerifiedIdentity|authorizeSecurityChange|consumeAuthorization)\b/;

/**
 * Exempt, with a reason each.
 *
 * An entry here is a claim that the identity argument is NOT the caller's — it names somebody
 * else the caller is acting towards — and that the caller is authenticated by other means.
 * Adding one is a decision; leaving the list empty is not an option the codebase supports.
 */
const EXEMPT: Record<string, string> = {
  'lib/supabase/users.ts':
    'lookupRecipientAddress takes the RECIPIENT of a transfer, not the caller. requireUser runs first.',
  'lib/email/notify.ts':
    'notifyTransferSent takes the person being notified. The sender comes from requireUser.',
  'lib/actions/transactionAuth.ts':
    'Payload describes the transaction being noted; the caller is resolved inside consumeAuthorization.',
};

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function serverActionModules(): string[] {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const head = fs.readFileSync(file, 'utf8').slice(0, 300);
      if (/^\s*['"]use server['"]/m.test(head)) found.push(file);
    }
  }
  return found;
}

describe('server actions resolve identity from the session', () => {
  it('finds the server-action modules at all', () => {
    // A guard that silently matches nothing passes forever. If this drops to zero the walk
    // has broken, not the codebase.
    expect(serverActionModules().length).toBeGreaterThan(3);
  });

  it('never trusts an identity passed as an argument', () => {
    const offenders: string[] = [];

    for (const file of serverActionModules()) {
      const source = fs.readFileSync(file, 'utf8');

      // Only the signatures matter. A `userId` local computed AFTER the session is resolved is
      // exactly what the fixed code does, so the whole file body would produce false alarms.
      const signatures = source.match(/export\s+async\s+function[\s\S]*?\)\s*:/g) ?? [];
      const takesIdentity = signatures.some((sig) => IDENTITY_PARAMS.test(sig));

      if (!takesIdentity) continue;
      if (DERIVES_IDENTITY.test(source)) continue;

      const key = file.split(path.sep).join('/');
      if (EXEMPT[key]) continue;

      offenders.push(key);
    }

    expect(
      offenders,
      offenders.length
        ? `These 'use server' modules take a caller-supplied identity without deriving one ` +
          `from the session:\n\n  ${offenders.join('\n  ')}\n\n` +
          `Take the identity from requireUser()/requireUserId() instead. If the argument is ` +
          `genuinely about somebody ELSE — a transfer recipient, say — add it to EXEMPT in ` +
          `this file with the reason.`
        : '',
    ).toEqual([]);
  });
});

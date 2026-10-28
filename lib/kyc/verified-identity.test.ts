import { describe, expect, it, vi } from 'vitest';
import type { DiditVerifiedIdentity } from './didit-client';

/** An approved re-verification replaces the identity on record only when it is safe to. */
const identities = vi.hoisted(() => new Map<string, DiditVerifiedIdentity | null>());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/adminClient', () => ({ supabaseAdmin: {} }));
const created = vi.hoisted(() => new Map<string, string>());
vi.mock('./didit-client', () => ({
  getVerifiedIdentity: async (id: string) => {
    if (id === 'unreadable') throw new Error('Didit timed out');
    return identities.get(id) ?? null;
  },
  getSessionState: async (id: string) => ({ status: 'Approved', vendorData: 'u1', createdAt: created.get(id) ?? null }),
  newerSessions: async () => [],
}));

const { reverificationMayReplace } = await import('./verified-identity');

const base: DiditVerifiedIdentity = {
  firstName: 'Ada', lastName: 'Obi', fullName: 'Ada Chioma Obi', issuingState: 'NGA', nationality: 'NGA',
  dateOfBirth: '1995-04-12', documentType: 'Passport', documentNumber: 'B01234567',
};
let n = 0;
const replace = (current: DiditVerifiedIdentity | null, next: DiditVerifiedIdentity | null) => {
  const a = `old${++n}`, b = `new${n}`;
  identities.set(a, current);
  identities.set(b, next);
  created.set(a, '2026-09-10T00:00:00Z');
  created.set(b, '2026-10-28T00:00:00Z');
  return reverificationMayReplace(a, b);
};

describe('reverificationMayReplace', () => {
  it('takes a better document from the same person', async () => {
    const slip = { ...base, documentType: 'Identity Card', documentNumber: '12345678901', dateOfBirth: undefined };
    const card = { ...base, documentType: 'Identity Card', documentNumber: '12345678901', fullName: 'OBI ADA' };
    await expect(replace(slip, card)).resolves.toEqual({ ok: true });
  });

  it('refuses someone else', async () => {
    await expect(replace(base, { ...base, fullName: 'Emeka Okafor' })).resolves.toMatchObject({ ok: false });
    await expect(replace(base, { ...base, dateOfBirth: '1990-01-01' })).resolves.toMatchObject({ ok: false });
  });

  it('refuses a document that loses a corridor the old one served', async () => {
    const withNin = { ...base, personalNumber: '12345678901' };
    await expect(replace(withNin, base)).resolves.toMatchObject({ ok: false, why: expect.stringMatching(/NGN/) });
  });

  it('ignores a late event for a session older than the one on record', async () => {
    // A redelivered approval of the session that was replaced must not switch the record back.
    identities.set('newer', base);
    identities.set('older', base);
    created.set('newer', '2026-10-28T00:00:00Z');
    created.set('older', '2026-09-10T00:00:00Z');
    await expect(reverificationMayReplace('newer', 'older')).resolves.toMatchObject({ ok: false, stale: true });
  });

  it('throws when the identity on record cannot be read, rather than skipping the comparison', async () => {
    // Read as "nothing on record", a timeout would let someone else's ID replace this one.
    identities.set('someone-else', { ...base, fullName: 'Emeka Okafor' });
    created.set('unreadable', '2026-09-10T00:00:00Z');
    created.set('someone-else', '2026-10-28T00:00:00Z');
    await expect(reverificationMayReplace('unreadable', 'someone-else')).rejects.toThrow(/timed out/);
  });

  it('refuses when the identity on record cannot be compared, rather than letting any ID through', async () => {
    await expect(replace(null, { ...base, fullName: 'Emeka Okafor' })).resolves.toMatchObject({ ok: false });
  });

  it('refuses a new session with no usable identity', async () => {
    await expect(replace(base, null)).resolves.toMatchObject({ ok: false });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** One verification outcome, one email, to the right people. */
const sent = vi.hoisted(() => ({ admin: [] as unknown[], user: [] as unknown[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/adminClient', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { email: 'ada@example.com' } }) }) }) }),
  },
}));
vi.mock('./verified-identity', () => ({ reverificationMayReplace: async () => ({ ok: true }) }));
vi.mock('./supabase-kyc', () => ({ claimReverifyNotice: async () => true, recordKycTransition: async () => true }));
const created = vi.hoisted(() => new Map<string, string>([['older', '2026-09-01T00:00:00Z'], ['record', '2026-09-10T00:00:00Z'], ['newer', '2026-10-28T00:00:00Z']]));
vi.mock('@/lib/kyc/didit-client', () => ({
  getSessionState: async (id: string) => ({ status: 'Declined', vendorData: 'u1', createdAt: created.get(id) ?? null }),
  getDecisionReasons: async () => [{ title: 'Printed copy of document detected', detail: 'Not an original.' }],
}));
vi.mock('@/lib/email/admin-alerts', () => ({ sendKycReviewAlert: async (a: unknown) => void sent.admin.push(a) }));
vi.mock('@/lib/email/sendEmail', () => ({
  sendKycResultEmail: async (...args: unknown[]) => void sent.user.push(args),
}));

const { notifyKycOutcome, notifyReverifyOutcome } = await import('./notify-outcome');
const notify = (diditStatus: string, reverify = false) =>
  notifyKycOutcome({ userId: 'u1', sessionId: 's1', diditStatus, reverify });

beforeEach(() => {
  sent.admin = [];
  sent.user = [];
});

describe('notifyKycOutcome', () => {
  it('asks the admins to review what Didit could not decide', async () => {
    await notify('In Review');
    expect(sent.admin).toEqual([{
      userEmail: 'ada@example.com', sessionId: 's1', reverify: false,
      reasons: [{ title: 'Printed copy of document detected', detail: 'Not an original.' }],
    }]);
    expect(sent.user).toEqual([]);
  });

  it('tells the user they were approved or declined', async () => {
    await notify('Approved');
    await notify('Declined', true);
    // A decline carries Didit's reason, which is nearly always why it went to review.
    expect(sent.user).toEqual([
      ['ada@example.com', 'approved', { reverify: false, reasons: [] }],
      ['ada@example.com', 'declined', { reverify: true, reasons: [{ title: 'Printed copy of document detected', detail: 'Not an original.' }] }],
    ]);
  });

  it('sends nothing for a user who closed the window, or a session not finished', async () => {
    // Abandoned is stored as declined; telling them they were rejected would be wrong.
    for (const s of ['Abandoned', 'Not Started', 'In Progress', 'Expired']) await notify(s);
    expect(sent.admin).toEqual([]);
    expect(sent.user).toEqual([]);
  });

  it('announces a re-verification only for a session newer than the one on record', async () => {
    // A late decline for a session before the approval on record is not a "new ID" that failed.
    await notifyReverifyOutcome('u1', 'older', 'record', 'Declined');
    expect(sent.user).toEqual([]);
    await notifyReverifyOutcome('u1', 'newer', 'record', 'Declined');
    expect(sent.user).toHaveLength(1);
  });
});

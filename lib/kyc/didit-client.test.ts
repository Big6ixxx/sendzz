import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDecisionReasons, getVerifiedIdentity, isDiditSessionId, normalizeDiditStatus } from './didit-client';

/**
 * The verified sender a Brails payout needs comes from here. A reviewer approving a session can
 * leave its ID check reading "In Review" — that user is verified, and must not be gated.
 */
const decision = (body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
let seq = 0;
const sid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const id = (status: string) => ({ status, first_name: 'Ada', last_name: 'Obi', issuing_state: 'nga' });

beforeEach(() => {
  vi.stubEnv('DIDIT_API_KEY', 'test');
  vi.stubEnv('DIDIT_WORKFLOW_ID', 'test');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('getVerifiedIdentity', () => {
  it('reads an approved session', async () => {
    decision({ status: 'Approved', id_verifications: [id('Approved')] });
    await expect(getVerifiedIdentity(sid())).resolves.toMatchObject({ firstName: 'Ada', lastName: 'Obi', fullName: 'Ada Obi', issuingState: 'NGA' });
  });

  it('reads a session a reviewer approved while its ID check still reads In Review', async () => {
    decision({ status: 'Approved', id_verifications: [id('In Review')] });
    await expect(getVerifiedIdentity(sid())).resolves.toMatchObject({ issuingState: 'NGA' });
  });

  it('refuses a session not approved, or an ID check that was declined', async () => {
    decision({ status: 'Not Started', id_verifications: [] });
    await expect(getVerifiedIdentity(sid())).resolves.toBeNull();
    decision({ status: 'Approved', id_verifications: [id('Declined')] });
    await expect(getVerifiedIdentity(sid())).resolves.toBeNull();
  });
});

describe('getDecisionReasons', () => {
  const held = {
    status: 'Declined',
    id_verifications: [{ status: 'In Review', warnings: [{ short_description: 'Printed copy of document detected', long_description: 'Not an original.' }] }],
    aml_screenings: [{ status: 'In Review', warnings: [{ short_description: 'Possible sanctions match' }] }],
    ip_analyses: [{ status: 'Declined', warnings: [{ short_description: 'VPN detected' }] }],
    reviews: [{ comment: 'Please use the original card.' }],
  };

  it('gives the admins every reason', async () => {
    decision(held);
    const titles = (await getDecisionReasons(sid(), 'admin')).map((r) => r.title);
    expect(titles).toEqual(['Printed copy of document detected', 'Possible sanctions match', 'VPN detected', "Reviewer's note"]);
  });

  it('keeps risk signals out of what the user is told', async () => {
    decision(held);
    const titles = (await getDecisionReasons(sid(), 'user')).map((r) => r.title);
    expect(titles).toEqual(['Printed copy of document detected', "Reviewer's note"]);
  });
});

describe('decision cache', () => {
  it('never keeps a decision still in progress, so an approval is read the moment it lands', async () => {
    // An earlier poll's "In Review" served to the approval webhook would judge it as no identity.
    const id = sid();
    const fetch = decision({ status: 'In Review', id_verifications: [] });
    await getVerifiedIdentity(id);
    fetch.mockResolvedValue(new Response(JSON.stringify({ status: 'Approved', id_verifications: [{ status: 'Approved', first_name: 'Ada', last_name: 'Obi', issuing_state: 'NGA' }] }), { status: 200 }));
    await expect(getVerifiedIdentity(id)).resolves.toMatchObject({ firstName: 'Ada' });
  });
});

describe('session ids and statuses', () => {
  it('accepts only a session id into a request path', () => {
    expect(isDiditSessionId('ce79839b-623c-42ea-8b0b-031c48af729f')).toBe(true);
    expect(isDiditSessionId('../../sessions/?vendor_data=x')).toBe(false);
    expect(isDiditSessionId('ce79839b-623c-42ea-8b0b-031c48af729f,status.eq.approved')).toBe(false);
  });

  it('ends an expired session like an abandoned one', () => {
    expect(normalizeDiditStatus('Expired')).toBe('declined');
    expect(normalizeDiditStatus('Abandoned')).toBe('declined');
    expect(normalizeDiditStatus('In Progress')).toBe('pending');
  });
});

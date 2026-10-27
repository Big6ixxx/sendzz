import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVerifiedIdentity } from './didit-client';

/**
 * The verified sender a Brails payout needs comes from here. A reviewer approving a session can
 * leave its ID check reading "In Review" — that user is verified, and must not be gated.
 */
const decision = (body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
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
    await expect(getVerifiedIdentity('s')).resolves.toEqual({ firstName: 'Ada', lastName: 'Obi', issuingState: 'NGA' });
  });

  it('reads a session a reviewer approved while its ID check still reads In Review', async () => {
    decision({ status: 'Approved', id_verifications: [id('In Review')] });
    await expect(getVerifiedIdentity('s')).resolves.toMatchObject({ issuingState: 'NGA' });
  });

  it('refuses a session not approved, or an ID check that was declined', async () => {
    decision({ status: 'Not Started', id_verifications: [] });
    await expect(getVerifiedIdentity('s')).resolves.toBeNull();
    decision({ status: 'Approved', id_verifications: [id('Declined')] });
    await expect(getVerifiedIdentity('s')).resolves.toBeNull();
  });
});

import crypto from 'crypto';
import { describe, expect, it } from 'vitest';

import { verifyBitnobSignature } from './webhook-signature';

const SECRET = 'test-webhook-secret';

/** Sign exactly what goes on the wire, the way a provider does. */
const sign = (body: string) =>
  crypto.createHmac('sha512', SECRET).update(body).digest('hex');

const verify = (rawBody: string, signature: string) =>
  verifyBitnobSignature({ rawBody, signature, secret: SECRET });

describe('verifyBitnobSignature', () => {
  /**
   * The regression this file exists for. Every one of these bodies round-trips to different
   * bytes through JSON.parse → JSON.stringify, so the old implementation rejected them all.
   * `deposit.success` carries a numeric amount, which is why finalize never ran and Bitnob
   * payouts expired — while string-amount events sailed through and made it look chain-specific.
   */
  it('accepts bodies whose JSON does not survive a parse/stringify round-trip', () => {
    const lossy = [
      '{"event":"deposit.success","data":{"amount":50.00,"reference":"offramp_1"}}',
      '{"event":"deposit.success","data":{"amount":1.10}}',
      '{"event":"deposit.success","data":{"amount":1e2}}',
      '{"event":"payout.completed","data":{"accountName":"Jos\\u00e9"}}',
      '{\n  "event": "deposit.success",\n  "data": { "amount": 50 }\n}',
    ];

    for (const raw of lossy) {
      expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw); // genuinely lossy
      expect(verify(raw, sign(raw))).toBe(true);
    }
  });

  it('still accepts the events that already worked (string amounts)', () => {
    const raw = '{"event":"payout.expired","data":{"amount":"50.00","reference":"offramp_1"}}';
    expect(JSON.stringify(JSON.parse(raw))).toBe(raw); // lossless
    expect(verify(raw, sign(raw))).toBe(true);
  });

  it('accepts a signature over the compact re-serialisation (fallback path)', () => {
    const raw = '{\n  "event": "payout.completed"\n}';
    const compactSig = sign(JSON.stringify(JSON.parse(raw)));
    expect(verify(raw, compactSig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const raw = '{"event":"deposit.success","data":{"amount":50.00}}';
    const signature = sign(raw);
    const tampered = '{"event":"deposit.success","data":{"amount":5000.00}}';
    expect(verify(tampered, signature)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const raw = '{"event":"deposit.success","data":{"amount":50.00}}';
    const wrong = crypto.createHmac('sha512', 'other-secret').update(raw).digest('hex');
    expect(verify(raw, wrong)).toBe(false);
  });

  it('rejects missing signature, missing secret, or empty body', () => {
    const raw = '{"event":"deposit.success"}';
    expect(verifyBitnobSignature({ rawBody: raw, signature: undefined, secret: SECRET })).toBe(false);
    expect(verifyBitnobSignature({ rawBody: raw, signature: sign(raw), secret: undefined })).toBe(false);
    expect(verifyBitnobSignature({ rawBody: '', signature: sign(''), secret: SECRET })).toBe(false);
  });

  it('is case- and whitespace-insensitive about the header value', () => {
    const raw = '{"event":"deposit.success","data":{"amount":50.00}}';
    expect(verify(raw, `  ${sign(raw).toUpperCase()}  `)).toBe(true);
  });

  it('does not throw on a non-JSON body', () => {
    expect(() => verify('not json at all', sign('x'))).not.toThrow();
    expect(verify('not json at all', sign('not json at all'))).toBe(true);
  });
});

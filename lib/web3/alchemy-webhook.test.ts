import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import {
  chainForWebhookId,
  isIncomingUsdc,
  toAlchemyTransfer,
  verifyAlchemySignature,
  type AlchemyActivity,
} from './alchemy-webhook';
import { transferAmountUsdc } from './deposit-amount';

/**
 * The webhook is a path into the deposit ledger, so the two things worth pinning are that
 * nothing unsigned gets in, and that a signed event is credited at the right SCALE.
 *
 * The scale half is not hypothetical: USDC on Arc is 6 decimals as a token and 18 when sent
 * natively as gas, and the webhook reports decimals as a NUMBER where the Transfers API reports
 * a hex STRING. Getting that conversion wrong is a six-orders-of-magnitude error in what a user
 * is credited, in the direction that costs real money.
 */

const KEY = 'whsec_test_key';
const sign = (body: string, key = KEY) =>
  crypto.createHmac('sha256', key).update(body, 'utf8').digest('hex');

beforeEach(() => {
  vi.stubEnv('ALCHEMY_WEBHOOK_ID_BASE', 'wh_base_123');
  vi.stubEnv('ALCHEMY_WEBHOOK_ID_ARC', 'wh_arc_456');
});
afterEach(() => vi.unstubAllEnvs());

describe('signature verification', () => {
  const body = JSON.stringify({ webhookId: 'wh_base_123', id: 'whevt_1' });

  it('accepts a genuine signature', () => {
    expect(verifyAlchemySignature({ rawBody: body, signature: sign(body), signingKey: KEY })).toBe(true);
  });

  it('rejects a signature made with the wrong key', () => {
    const forged = sign(body, 'attacker-key');
    expect(verifyAlchemySignature({ rawBody: body, signature: forged, signingKey: KEY })).toBe(false);
  });

  it('rejects when the body was altered after signing', () => {
    // The amount is the field an attacker would want to change.
    const signature = sign(body);
    const tampered = JSON.stringify({ webhookId: 'wh_base_123', id: 'whevt_1', extra: 'x' });
    expect(verifyAlchemySignature({ rawBody: tampered, signature, signingKey: KEY })).toBe(false);
  });

  it('rejects a missing signature, and a missing key', () => {
    expect(verifyAlchemySignature({ rawBody: body, signature: null, signingKey: KEY })).toBe(false);
    expect(verifyAlchemySignature({ rawBody: body, signature: sign(body), signingKey: undefined })).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    // timingSafeEqual throws on a length mismatch — that must read as "no", not a 500.
    expect(() =>
      verifyAlchemySignature({ rawBody: body, signature: 'not-hex', signingKey: KEY }),
    ).not.toThrow();
    expect(verifyAlchemySignature({ rawBody: body, signature: 'abcd', signingKey: KEY })).toBe(false);
  });
});

describe('chainForWebhookId', () => {
  it('resolves ids we configured', () => {
    expect(chainForWebhookId('wh_base_123')).toBe('base');
    expect(chainForWebhookId('wh_arc_456')).toBe('arc');
  });

  it('refuses an id we did not configure', () => {
    // This is the gate that stops an event naming somebody else's webhook being processed.
    expect(chainForWebhookId('wh_someone_else')).toBeNull();
    expect(chainForWebhookId(undefined)).toBeNull();
  });
});

describe('isIncomingUsdc', () => {
  const usdcOnBase = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

  it('accepts an ERC-20 transfer of the chain USDC contract', () => {
    const a: AlchemyActivity = { category: 'token', rawContract: { address: usdcOnBase } };
    expect(isIncomingUsdc(a, 'base')).toBe(true);
  });

  it('rejects another token on the same chain', () => {
    const a: AlchemyActivity = {
      category: 'token',
      rawContract: { address: '0x0000000000000000000000000000000000000dead' },
    };
    expect(isIncomingUsdc(a, 'base')).toBe(false);
  });

  it('accepts a native send on Arc, where the gas token IS USDC', () => {
    // On Arc an ordinary wallet-to-wallet USDC send emits no ERC-20 event at all.
    const a: AlchemyActivity = { category: 'external', value: 1.5 };
    expect(isIncomingUsdc(a, 'arc')).toBe(true);
  });

  it('rejects a native send on Base, where native means ETH', () => {
    // Crediting this would turn an ETH transfer into a USDC deposit.
    const a: AlchemyActivity = { category: 'external', value: 1.5 };
    expect(isIncomingUsdc(a, 'base')).toBe(false);
  });

  // ── The three shapes Arc reports one send as ──────────────────────────────
  // Taken from a real delivery: one 0.1 USDC payment arrived as `external`, as `internal`
  // DELEGATECALL traces, and as a `token` transfer against a system pseudo-contract. Exactly one
  // of them may be credited.

  it('rejects Arc internal traces, which are execution steps and not payments', () => {
    const a: AlchemyActivity = {
      category: 'internal',
      value: 0.1,
      rawContract: { rawValue: '0x16345785d8a0000', decimals: 18 },
    };
    expect(isIncomingUsdc(a, 'arc')).toBe(false);
  });

  it('rejects the Arc system pseudo-contract, which reports no decimals', () => {
    // The dangerous one. It carries an 18-decimal raw value with NO `decimals` field, so the
    // amount maths falls back to 6 and 0.1 USDC would be credited as 100,000,000,000.
    const a: AlchemyActivity = {
      category: 'token',
      rawContract: { address: '0xfffffffffffffffffffffffffffffffffffffffe', rawValue: '0x16345785d8a0000' },
    };
    expect(isIncomingUsdc(a, 'arc')).toBe(false);

    // Proof of what rejecting it avoids, had it been let through.
    expect(transferAmountUsdc(toAlchemyTransfer(a))).toBeCloseTo(100_000_000_000, 0);
  });

  it('accepts exactly one of the three, so the payment is credited once', () => {
    const hash = '0xca3a0785152f01b63d72cdbea5f70d9595cbf7d1726b287649fcfc4006efa0c3';
    const raw = { rawValue: '0x16345785d8a0000', decimals: 18 };
    const shapes: AlchemyActivity[] = [
      { hash, category: 'external', value: 0.1, rawContract: raw },
      { hash, category: 'internal', value: 0.1, rawContract: raw },
      { hash, category: 'token', rawContract: { address: '0xfffffffffffffffffffffffffffffffffffffffe', rawValue: raw.rawValue } },
    ];
    const accepted = shapes.filter((a) => isIncomingUsdc(a, 'arc'));
    expect(accepted).toHaveLength(1);
    expect(accepted[0].category).toBe('external');
    expect(transferAmountUsdc(toAlchemyTransfer(accepted[0]))).toBeCloseTo(0.1, 9);
  });
});

describe('toAlchemyTransfer — the decimals conversion', () => {
  it('credits a 6-decimal USDC token transfer correctly', () => {
    const a: AlchemyActivity = {
      hash: '0xabc',
      value: 293.092129,
      category: 'token',
      rawContract: { rawValue: '0x0000000000000000000000000000000000000000000000000000000011783b21', decimals: 6 },
    };
    expect(transferAmountUsdc(toAlchemyTransfer(a))).toBeCloseTo(293.092129, 6);
  });

  it('credits an 18-decimal native Arc send correctly', () => {
    // 0.5 USDC at 18 decimals. Reading this as 6 would credit 500,000,000,000.
    const a: AlchemyActivity = {
      hash: '0xdef',
      value: 0.5,
      category: 'external',
      rawContract: { rawValue: '0x' + (5n * 10n ** 17n).toString(16), decimals: 18 },
    };
    expect(transferAmountUsdc(toAlchemyTransfer(a))).toBeCloseTo(0.5, 9);
  });

  it('converts decimals as base-16, matching what the shared maths parses', () => {
    // The webhook says 18; the shared code parseInt(_, 16)s it, so it must travel as "12".
    expect(toAlchemyTransfer({ rawContract: { decimals: 18 } }).rawContract?.decimal).toBe('12');
    expect(toAlchemyTransfer({ rawContract: { decimals: 6 } }).rawContract?.decimal).toBe('6');
  });

  it('reports no amount rather than a wrong one when decimals are absent', () => {
    // Arc's precompile returns no metadata, and `value` then carries the RAW integer. Crediting
    // it would be the 938,136-for-0.938136 bug. Null makes the caller skip and let the cron
    // re-derive it.
    const a: AlchemyActivity = { hash: '0x1', value: 938136, category: 'external' };
    expect(transferAmountUsdc(toAlchemyTransfer(a))).toBeNull();
  });
});

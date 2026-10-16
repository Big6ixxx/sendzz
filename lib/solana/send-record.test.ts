import { describe, it, expect } from 'vitest';
import { parseSendRecord } from './send-record';

describe('parseSendRecord', () => {
  it('accepts a recipient, an amount and an optional note', () => {
    expect(parseSendRecord({ recipient: 'Abc', amount: 5, note: 'rent' })).toEqual({
      recipient: 'Abc',
      amount: 5,
      note: 'rent',
    });
    expect(parseSendRecord({ recipient: 'Abc', amount: 5 })).toEqual({ recipient: 'Abc', amount: 5, note: undefined });
  });

  it('rejects anything malformed', () => {
    expect(parseSendRecord(undefined)).toBeNull();
    expect(parseSendRecord({ recipient: '', amount: 5 })).toBeNull();
    expect(parseSendRecord({ recipient: 'Abc', amount: 0 })).toBeNull();
    expect(parseSendRecord({ recipient: 'Abc', amount: Number.NaN })).toBeNull();
    expect(parseSendRecord({ recipient: 'Abc', amount: '5' })).toBeNull();
    expect(parseSendRecord({ recipient: 'Abc', amount: 5, note: 7 })).toBeNull();
    expect(parseSendRecord({ recipient: 'x'.repeat(201), amount: 5 })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { activityStatus, detailHasIdentifier, isUncounted, shortenDetail as shortenWithJoiners } from './activity-look';

// The cut carries invisible word joiners; compare what a reader sees.
const shortenDetail = (text: string) => shortenWithJoiners(text).replace(/\u2060/g, '');

describe('shortenDetail', () => {
  it('keeps an email’s domain and cuts a long name', () => {
    expect(shortenDetail('Sent to yunusabdulmajid@gmail.com')).toBe('Sent to yunus…@gmail.com');
  });

  it('leaves a short email whole', () => {
    expect(shortenDetail('From ada@x.com')).toBe('From ada@x.com');
  });

  it('keeps the start and end of an address or hash', () => {
    expect(shortenDetail('To 0x9f3c2a1be8d74c55aa01f2e3b4c5d6e7f8091a2b')).toBe('To 0x9f3c…1a2b');
    expect(shortenDetail('GBX7KZQ2W4ABCDEFGHJKLMNPQRSTUVWXYZ234567ABCDEFGH')).toBe('GBX7…EFGH');
  });

  it('leaves ordinary words alone', () => {
    expect(shortenDetail('Withdrawal to GTBank · Ada Obi')).toBe('Withdrawal to GTBank · Ada Obi');
  });

  it('says when a line holds something worth copying whole', () => {
    expect(detailHasIdentifier('Sent to ada@example.com')).toBe(true);
    expect(detailHasIdentifier('To 0x9f3c2a1be8d74c55aa01f2e3b4c5d6e7f8091a2b')).toBe(true);
    expect(detailHasIdentifier('To GTBank · Ada Obi')).toBe(false);
  });
});

describe('the cut', () => {
  it('cannot be broken across lines', () => {
    expect(shortenWithJoiners('yunusabdulmajid@gmail.com')).toBe('yunus\u2060…\u2060@gmail.com');
  });
});

describe('activityStatus', () => {
  it('shows nothing once the money has arrived', () => {
    expect(activityStatus('completed')).toBeNull();
    expect(activityStatus('Confirmed')).toBeNull();
  });
  it('never calls a refund or a stuck payment completed', () => {
    expect(activityStatus('refunded')?.text).toBe('Refunded');
    expect(activityStatus('confirming')?.text).toBe('Confirming');
    expect(activityStatus('some_new_state')?.text).toBe('Some new state');
  });
});

describe('isUncounted', () => {
  it('leaves money that came back out of the totals', () => {
    expect(isUncounted('refunded')).toBe(true);
    expect(isUncounted('Cancelled')).toBe(true);
    expect(isUncounted('completed')).toBe(false);
  });
});

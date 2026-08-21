import { describe, expect, it } from 'vitest';
import { parseAdminRecipients } from './admin-recipients';

/**
 * This list is the difference between an operator finding out in seconds and finding out when
 * the user complains. It must never come back empty because of a stray comma or a duplicate.
 */
describe('parseAdminRecipients', () => {
  it('reads every admin out of the env var', () => {
    expect(parseAdminRecipients('ops@sendzz.io,founder@sendzz.io')).toEqual([
      'ops@sendzz.io',
      'founder@sendzz.io',
    ]);
  });

  it('sends one copy to an address listed twice', () => {
    expect(parseAdminRecipients('Ops@Sendzz.io , ops@sendzz.io')).toEqual(['ops@sendzz.io']);
  });

  it('tolerates the whitespace and trailing comma real env vars carry', () => {
    expect(parseAdminRecipients(' a@x.io ,  b@x.io ,')).toEqual(['a@x.io', 'b@x.io']);
  });

  it('drops entries that are not addresses instead of failing the whole send', () => {
    // One malformed entry must not cost every admin the alert.
    expect(parseAdminRecipients('a@x.io,not-an-email,,b@x.io')).toEqual(['a@x.io', 'b@x.io']);
  });

  it('returns nothing when the var is unset or empty, rather than throwing', () => {
    // The caller logs loudly on an empty list — silence here would hide the misconfiguration.
    expect(parseAdminRecipients(undefined)).toEqual([]);
    expect(parseAdminRecipients('')).toEqual([]);
    expect(parseAdminRecipients('   ,  ,')).toEqual([]);
  });
});

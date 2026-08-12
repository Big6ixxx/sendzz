/**
 * Mobile-money number handling.
 *
 * Bitnob's `/api/payouts/account-lookup` (name enquiry) is enabled for **Nigerian bank
 * accounts only**. For mobile-money rails — Rwanda, Kenya, Uganda, Ghana and the rest — it
 * returns 400 VALIDATION_ERROR for every operator code and every number format, because the
 * lookup simply isn't offered on those corridors. Verified against the live API.
 *
 * That has two consequences this module exists to handle:
 *
 *  1. Calling the lookup for a mobile-money rail is pointless — it can only ever 400. The
 *     provider skips it entirely rather than turning a structural 400 into a user-facing error.
 *
 *  2. With no name enquiry, the only pre-payout check available is the number itself. So we
 *     validate it properly: correct length for the country, and a prefix that really belongs
 *     to the chosen operator. An earlier attempt filled the gap by reporting every number as
 *     `Mobile Money (<number>)`, which made nonsense like `09000000009333` display as verified
 *     — worse than no check at all, because it invited someone to send money to it.
 *
 * What this cannot do is confirm who owns the number. Bitnob validates that at payout time and
 * refunds if the wallet is unreachable, so the UI must say "format checked", never "verified".
 */

/** Dialling codes for the corridors Bitnob serves. */
const COUNTRY_DIAL_CODE: Record<string, string> = {
  NG: '234',
  KE: '254',
  GH: '233',
  UG: '256',
  TZ: '255',
  RW: '250',
  GM: '220',
  MW: '265',
  CI: '225',
  SN: '221',
  BJ: '229',
  BF: '226',
  TG: '228',
  ML: '223',
  CM: '237',
  GA: '241',
  CD: '243',
  ZA: '27',
};

/**
 * National significant number length (digits after the dialling code, without the trunk 0).
 * Only listed where we're confident; unlisted countries skip the length check rather than
 * inventing a rule that would reject valid numbers.
 */
const NSN_LENGTH: Record<string, number[]> = {
  RW: [9],
  KE: [9],
  UG: [9],
  GH: [9],
  NG: [10],
  TZ: [9],
  CM: [9],
};

/**
 * Operator prefixes, keyed by the institution code the app offers for that operator.
 * Expressed as the national significant number's leading digits (no trunk 0).
 *
 * Only operators whose ranges we're confident about appear here. An operator that's absent
 * gets length validation only — a missing entry must never cause a valid number to be refused.
 */
const OPERATOR_PREFIXES: Record<string, string[]> = {
  // Rwanda — MTN 078/079, Airtel 072/073 (Airtel absorbed Tigo's 072/073 ranges).
  MTNRWF: ['78', '79'],
  AIRTRWF: ['72', '73'],
};

/** Institution codes the app treats as mobile-money rails rather than bank accounts. */
const MOBILE_MONEY_CODES = new Set([
  'SAFAKEPC', 'AIRTKEPC',
  'MTNGHPC', 'VODAGHPC', 'ATGHPC',
  'MTNUGPC', 'AIRTUGPC',
  'ORANGEXOF', 'MTNXOF', 'WAVEXOF',
  'MTNXAF', 'ORANGEXAF',
  'MTNRWF', 'AIRTRWF',
  'QMONEYGMD', 'AFRIGMD',
]);

export function isMobileMoneyCode(institutionCode: string): boolean {
  return MOBILE_MONEY_CODES.has((institutionCode || '').toUpperCase());
}

/** Digits only, trunk zero and dialling code removed — the national significant number. */
function toNationalNumber(accountNumber: string, country: string): string | null {
  const dial = COUNTRY_DIAL_CODE[(country || '').toUpperCase()];
  const digits = (accountNumber || '').replace(/\D/g, '');
  if (!digits) return null;
  const withoutDial = dial && digits.startsWith(dial) ? digits.slice(dial.length) : digits;
  const nsn = withoutDial.replace(/^0+/, '');
  return nsn || null;
}

/**
 * International MSISDN (dialling code + national number, no `+`), or null when the country's
 * code is unknown. Bitnob settles mobile money against this form.
 */
export function toInternationalMsisdn(accountNumber: string, country: string): string | null {
  const dial = COUNTRY_DIAL_CODE[(country || '').toUpperCase()];
  if (!dial) return null;
  const nsn = toNationalNumber(accountNumber, country);
  if (!nsn) return null;
  return `${dial}${nsn}`;
}

export interface MsisdnCheck {
  ok: boolean;
  /** Settlement form, present whenever the number could be normalised. */
  msisdn?: string;
  /** Why it was rejected — safe to show the user. */
  reason?: string;
}

/**
 * Validate a mobile-money number against its country's length and its operator's prefixes.
 * This is a format check, not proof the wallet exists or who owns it.
 */
export function validateMobileMoneyNumber(params: {
  institutionCode: string;
  country: string;
  accountNumber: string;
  /** Shown in messages, e.g. "MTN Mobile Money Rwanda". */
  operatorName?: string;
}): MsisdnCheck {
  const { institutionCode, country, accountNumber, operatorName } = params;
  const label = operatorName || institutionCode;

  const nsn = toNationalNumber(accountNumber, country);
  if (!nsn) return { ok: false, reason: 'Enter a mobile money number.' };

  if (!/^\d+$/.test(nsn)) {
    return { ok: false, reason: 'A mobile money number can only contain digits.' };
  }

  const lengths = NSN_LENGTH[(country || '').toUpperCase()];
  if (lengths && !lengths.includes(nsn.length)) {
    const expected = lengths.join(' or ');
    return {
      ok: false,
      reason: `That number has ${nsn.length} digits — ${label} numbers have ${expected} (excluding the leading 0).`,
    };
  }

  const prefixes = OPERATOR_PREFIXES[(institutionCode || '').toUpperCase()];
  if (prefixes && !prefixes.some((p) => nsn.startsWith(p))) {
    const shown = prefixes.map((p) => `0${p}`).join(' or ');
    return {
      ok: false,
      reason: `That number doesn't look like a ${label} number — they start with ${shown}.`,
    };
  }

  const msisdn = toInternationalMsisdn(accountNumber, country);
  return msisdn ? { ok: true, msisdn } : { ok: false, reason: 'Unsupported country for mobile money.' };
}

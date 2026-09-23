/**
 * Where a failed withdrawal's fiat was actually headed.
 *
 * An operator settling a debt by hand needs the real destination, not a masked one: you cannot
 * pay `******6462`. `withdrawals` deliberately stores only the mask (see 001_init_sendzz), so
 * the full details have to be recovered, and there are two places they can survive.
 *
 * Tier 1 — the sealed beneficiary on the row. Encrypted at order creation, and (since migration
 *          052's accompanying change) kept until the payout SUCCEEDS rather than until it is
 *          merely created. This is the reliable source for anything that fails from now on.
 *
 * Tier 2 — a saved bank contact of the same user whose last four digits match the mask. This is
 *          what recovers debts created before the scrub was moved. It found the largest of the
 *          first four outstanding debts and none of the other three: bank transfers get saved
 *          as contacts, mobile-money numbers are typed once and forgotten.
 *
 * Tier 3 — the mask alone. Not payable, and reported as such rather than dressed up.
 *
 * The bank NAME is resolved from `institution_code` by the caller rather than stored, matching
 * how the withdrawal receipt already derives it.
 */

import { openBeneficiary } from "@/lib/ramp/beneficiary-vault";

export interface PayoutDestination {
  /** Full account or phone number. Null when only the mask survived. */
  accountNumber: string | null;
  /** Account holder, when we have it. Providers do not always return one. */
  accountName: string | null;
  /** Bank or mobile-money operator name, when resolvable. */
  bankName: string | null;
  /** Always present — the last digits we stored at order time. */
  masked: string | null;
  /** Where the details came from, so the UI can say how much to trust them. */
  source: "sealed" | "contact" | "masked";
}

/** Last four digits of an account or phone number, ignoring formatting. */
export function last4(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(-4);
}

export interface SavedContact {
  bank_name: string | null;
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
}

/**
 * Best available destination for a withdrawal.
 *
 * Pure, so the tier logic is testable without a database: the caller fetches the sealed blob
 * and the user's contacts, this decides what they add up to.
 */
export function resolvePayoutDestination(params: {
  sealedBeneficiary: string | null | undefined;
  bankAccountMasked: string | null | undefined;
  contacts: SavedContact[] | null | undefined;
}): PayoutDestination {
  const masked = params.bankAccountMasked ?? null;

  // Tier 1 — sealed on the row.
  if (params.sealedBeneficiary) {
    const opened = openBeneficiary(params.sealedBeneficiary);
    if (opened?.accountNumber) {
      return {
        accountNumber: opened.accountNumber,
        accountName: opened.accountName || null,
        bankName: opened.bankName || null,
        masked,
        source: "sealed",
      };
    }
  }

  // Tier 2 — a saved contact ending in the same four digits.
  const want = last4(masked);
  if (want.length === 4) {
    const hit = (params.contacts ?? []).find(
      (c) => last4(c.account_number) === want,
    );
    if (hit?.account_number) {
      return {
        accountNumber: hit.account_number,
        accountName: hit.account_name || null,
        bankName: hit.bank_name || null,
        masked,
        source: "contact",
      };
    }
  }

  // Tier 3 — the mask, and an honest admission that it is not payable.
  return {
    accountNumber: null,
    accountName: null,
    bankName: null,
    masked,
    source: "masked",
  };
}

/** Can an operator actually send money with this? */
export function isPayable(d: PayoutDestination): boolean {
  return !!d.accountNumber;
}

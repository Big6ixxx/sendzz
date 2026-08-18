/**
 * Transient storage for a deferred payout's beneficiary.
 *
 * A deferred payout (shared-address chains — see `hasSharedDepositAddress`) is created only once
 * the user's deposit is verified. The browser normally supplies the bank details at that moment,
 * but if it dies in between, the deposit is credited and nothing can complete the payout. So the
 * details are also sealed here at order creation, and the reconcile cron can open them.
 *
 * Encrypted because `withdrawals` deliberately stores masked bank info only (see 001_init_sendzz).
 * Scrubbed the moment the payout is initialized, so nothing lingers past the window it exists for.
 */
import { decrypt, encrypt } from "@/lib/encryption";

export interface DeferredBeneficiary {
  accountNumber: string;
  accountName: string;
  bankName: string;
  memo?: string;
}

/** Dedicated key if set, otherwise the app's existing symmetric key. */
function vaultKey(): string | null {
  return process.env.WITHDRAWAL_ENCRYPTION_KEY || process.env.TOTP_ENCRYPTION_KEY || null;
}

/**
 * Seal a beneficiary for storage. Returns null when no key is configured — the caller then simply
 * stores nothing, and the flow degrades to browser-only settlement rather than writing plaintext
 * bank details to the database.
 */
export function sealBeneficiary(b: DeferredBeneficiary): string | null {
  const key = vaultKey();
  if (!key) {
    console.warn(
      "[Vault] No WITHDRAWAL_ENCRYPTION_KEY/TOTP_ENCRYPTION_KEY set — a deferred payout will not " +
        "be recoverable if the user's browser drops after depositing.",
    );
    return null;
  }
  try {
    return encrypt(JSON.stringify(b), key);
  } catch (e) {
    console.error("[Vault] Could not seal beneficiary:", e);
    return null;
  }
}

/** Open a sealed beneficiary, or null if absent/unreadable (e.g. the key was rotated). */
export function openBeneficiary(sealed: string | null | undefined): DeferredBeneficiary | null {
  const key = vaultKey();
  if (!sealed || !key) return null;
  try {
    const parsed = JSON.parse(decrypt(sealed, key)) as DeferredBeneficiary;
    return parsed?.accountNumber && parsed?.bankName ? parsed : null;
  } catch (e) {
    console.error("[Vault] Could not open sealed beneficiary:", e);
    return null;
  }
}

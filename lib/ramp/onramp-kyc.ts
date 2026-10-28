/**
 * The customer details Paycrest requires on every on-ramp order (`source.kyc`), built from the
 * identity Didit verified.
 *
 * Paycrest checks who each deposit came from against these details and returns any deposit
 * from someone else, so they must be the user's own — never typed in, and never the refund
 * account's name. Everything comes from the document the user verified with Didit; Sendzz
 * collects and stores none of it. When that document lacks what a corridor needs (a printed
 * copy with no readable date of birth; for naira, no NIN), the user is told what is missing and
 * asked to verify again with an ID that shows it.
 *
 * Rules (Paycrest's sender API, "On-ramp customer KYC"):
 *   - every order: full name, date of birth (18 or over), an ID document
 *   - NGN: the ID document must be the BVN or the NIN, 11 digits, issuer NG
 *   - KES: a Kenyan mobile number, which the payment prompt is pushed to
 */
import type { DiditVerifiedIdentity } from "@/lib/kyc/didit-client";
import { alpha2FromAlpha3 } from "./iso-country";
import { isMobileMoneyCode, toInternationalMsisdn } from "./msisdn";
import type { OnRampCustomer } from "./types";

export type OnRampKycNeed = "verification" | "in_review" | "reverify" | "kenyan_phone" | "adult";

export type OnRampKycCheck =
  | { ok: true; customer: OnRampCustomer }
  | { ok: false; need: OnRampKycNeed; message: string };

const ELEVEN_DIGITS = /^\d{11}$/;
const KENYAN_MOBILE = /^\+254[17]\d{8}$/;

function documentTypeOf(label?: string): OnRampCustomer["personDetails"]["idDocument"]["type"] | null {
  if (!label) return null;
  if (/passport/i.test(label)) return "passport";
  if (/driv/i.test(label)) return "driverLicense";
  if (/identity|national|id card/i.test(label)) return "nationalID";
  return null;
}

/** Whole years between a YYYY-MM-DD birth date and `now`; null when the date is unreadable. */
function ageOn(birthDate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age;
}

/**
 * The NIN or BVN the verification carries, if any. A registry lookup (Didit's Nigeria NIN/BVN
 * check) gives the number it matched: NIBSS is the BVN register, NIMC the NIN one. A document
 * can only carry the NIN: a passport's personal number, or the ID card's own number. No
 * document shows a BVN, so a BVN comes from the lookup alone.
 */
function nigerianIdFrom(identity: DiditVerifiedIdentity): { type: "BVN" | "nationalID"; number: string } | null {
  if (identity.issuingState !== "NGA") return null;
  const digits = (v?: string) => (v ?? "").replace(/\s/g, "");
  const looked = digits(identity.lookup?.identifier);
  if (ELEVEN_DIGITS.test(looked)) {
    return { type: /nibss|bvn/i.test(identity.lookup?.source ?? "") ? "BVN" : "nationalID", number: looked };
  }
  if (ELEVEN_DIGITS.test(digits(identity.personalNumber))) return { type: "nationalID", number: digits(identity.personalNumber) };
  if (documentTypeOf(identity.documentType) === "nationalID" && ELEVEN_DIGITS.test(digits(identity.documentNumber))) {
    return { type: "nationalID", number: digits(identity.documentNumber) };
  }
  return null;
}

/** "Naira deposits", "Shilling deposits", "GHS deposits". */
function depositsIn(currency: string): string {
  const names: Record<string, string> = { NGN: "Naira", KES: "Shilling" };
  return `${names[currency] ?? currency} deposits`;
}

/** What an ID must show for a deposit in this currency, as the user is told it. */
function idMustShow(currency: string): string {
  return currency === "NGN" ? "your NIN or BVN and your date of birth" : "your date of birth";
}

/**
 * What a deposit in `currency` needs from the user, for someone who has not verified yet. Each
 * corridor asks only for its own: Paycrest wants the NIN or BVN on naira alone, and a Kenyan
 * mobile number on shillings alone.
 */
function depositRequirementText(currency: string): string {
  const cur = currency.toUpperCase();
  const extra = cur === "KES" ? ", and your own M-Pesa number as the refund account" : "";
  return (
    `${depositsIn(cur)} need a verified ID that shows ${idMustShow(cur)}${extra}. ` +
    "It is a one time check that usually takes a few minutes."
  );
}

/**
 * Why the document this user verified with cannot carry a deposit in `currency`, or null when
 * it can. Judged per corridor, so a document that serves one is never sent back to
 * verification because another corridor would want more.
 */
export function depositIdentityGap(identity: DiditVerifiedIdentity, currency: string): string | null {
  const cur = currency.toUpperCase();
  const again = `Please verify again with an ID that shows ${idMustShow(cur)}.`;
  if (!identity.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(identity.dateOfBirth)) {
    return (
      `${depositsIn(cur)} need your date of birth, and we couldn't read one from the ID you verified ` +
      `with. This can happen with a printed copy or a photo of a document. ${again}`
    );
  }
  if (cur === "NGN") {
    if (!nigerianIdFrom(identity)) {
      return `${depositsIn(cur)} need your NIN or BVN, and the ID you verified with doesn't show either. ${again}`;
    }
  } else if (!documentTypeOf(identity.documentType) || !identity.documentNumber || !alpha2FromAlpha3(identity.issuingState)) {
    return `The ID you verified with can't be used for ${depositsIn(cur).toLowerCase()}. ${again}`;
  }
  return null;
}

export function buildOnRampCustomer(params: {
  identity: DiditVerifiedIdentity | null;
  currency: string;
  email?: string;
  refundAccount?: { institution: string; accountIdentifier: string };
  /** Judge everything but the Kenyan phone, which needs the refund account (the form's pre-check). */
  skipPhone?: boolean;
  now?: Date;
}): OnRampKycCheck {
  const { identity } = params;
  const currency = params.currency.toUpperCase();
  if (!identity) {
    return { ok: false, need: "verification", message: depositRequirementText(currency) };
  }

  const gap = depositIdentityGap(identity, currency);
  if (gap) return { ok: false, need: "reverify", message: gap };

  const birthDate = identity.dateOfBirth!;
  const age = ageOn(birthDate, params.now ?? new Date());
  if (age == null || age < 18) {
    return { ok: false, need: "adult", message: "Deposits are only available to customers aged 18 or over." };
  }

  const nigerianId = currency === "NGN" ? nigerianIdFrom(identity) : null;
  const idDocument: OnRampCustomer["personDetails"]["idDocument"] = nigerianId
    ? { ...nigerianId, issuerCountry: "NG" }
    : {
        type: documentTypeOf(identity.documentType)!,
        number: identity.documentNumber!,
        issuerCountry: alpha2FromAlpha3(identity.issuingState)!,
      };

  let phoneE164: string | undefined;
  if (currency === "KES" && !params.skipPhone) {
    const refund = params.refundAccount;
    const msisdn =
      refund && isMobileMoneyCode(refund.institution) ? toInternationalMsisdn(refund.accountIdentifier, "KE") : null;
    phoneE164 = msisdn ? `+${msisdn}` : undefined;
    if (!phoneE164 || !KENYAN_MOBILE.test(phoneE164)) {
      return {
        ok: false,
        need: "kenyan_phone",
        message: "Shilling deposits need your Kenyan mobile number. Use your own M-Pesa number as the refund account.",
      };
    }
  }

  const nationality = identity.nationality ? alpha2FromAlpha3(identity.nationality) ?? undefined : undefined;
  const email = params.email?.trim().toLowerCase();
  return {
    ok: true,
    customer: {
      entityType: "person",
      personDetails: {
        fullName: identity.fullName,
        birthDate,
        ...(nationality ? { nationality } : {}),
        ...(email || phoneE164 ? { contact: { ...(email ? { email } : {}), ...(phoneE164 ? { phoneE164 } : {}) } } : {}),
        idDocument,
      },
    },
  };
}

/**
 * Do two names look like the same person? Lenient on order and middle names, since banks and
 * documents print them in any order: at least two of the first name's parts (or its only part)
 * must appear in the second. Used for the refund account (Paycrest refuses an NGN order whose
 * refund account resolves to someone else) and for a re-verification's new ID.
 */
export function namesMatch(verifiedName: string, otherName: string): boolean {
  const parts = (s: string) =>
    s
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^A-Z]+/)
      .filter((p) => p.length > 1);
  const verified = [...new Set(parts(verifiedName))];
  const other = new Set(parts(otherName));
  const shared = verified.filter((p) => other.has(p)).length;
  return shared >= Math.min(2, verified.length) && verified.length > 0;
}

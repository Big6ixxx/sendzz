/**
 * Brails as a payout provider — the corridors Bitnob does not serve, and a fallback where it does.
 *
 * Off-ramp only. Brails can collect fiat too, but on-ramp through it is on hold (a $2 send per
 * deposit), so `onRamp` is off.
 *
 * How a Brails payout differs from Bitnob and Paycrest
 * ─────────────────────────────────────────────────────
 * Brails has no order with its own deposit address. It gives each CUSTOMER one USDC address, and
 * paying out is a separate call we make once the money has landed:
 *
 *   1. createOffRampOrder — returns the customer's Brails address and our own order reference.
 *   2. The user sends USDC there (the normal withdraw step; the hash is saved on the row).
 *   3. Brails sends `collection.deposit.success`; app/api/webhook/brails matches it to this
 *      withdrawal by hash and calls `initializePayout` (lib/ramp/brails-payout.ts).
 *   4. `payout.transfer.success` / `.failed` finalise the withdrawal.
 *
 * Corridors
 * ─────────
 * Only rails whose beneficiary is what the withdraw form collects: network + phone + name for
 * mobile money, bank + account number + name for Nigerian banks. Some mobile money corridors
 * (the CFA franc countries, DR Congo, Ethiopia, The Gambia, Guinea, Morocco) also need the
 * sender's name and country, which come from the user's Didit verification — so those are served
 * only for verified users (`needsSender`), and everyone else goes to the next provider. Rails
 * needing more than that (South Africa and Egypt banks; Rwanda's sender address) are not offered.
 *
 * Institution codes are `COUNTRY:NETWORK` for mobile money (`GH:MTN`) and `COUNTRY:BANKCODE`
 * for banks (`NG:100004`). A payout needs the country as well as the network or bank, so the
 * code carries both — which keeps the corridor on the withdrawal row, where the webhook reads it.
 */
import { createHash } from "crypto";
import { getBrailsClient } from "@/lib/brails/client";
import { getCurrencySymbol } from "@/lib/currency-config";
import { getCorridorFee } from "../fees";
import { toInternationalMsisdn, validateMobileMoneyNumber } from "../msisdn";
import { RampUnsupportedError, type RampProvider } from "../provider";
import type {
  CreateOffRampParams,
  QuoteOffRampParams,
  RampCapabilities,
  RampCountry,
  RampCurrency,
  RampCurrencyDetail,
  RampInstitution,
  RampOrderResponse,
  RampPayoutQuote,
  RampRateResponse,
  RampVerifyAccountResponse,
} from "../types";

interface Corridor {
  name: string;
  currency: string;
  rail: "mobile_money" | "bank";
  /** Smallest payout Brails accepts here, in the payout currency (its supported-countries list). */
  minPayout: number;
  /** Largest, from the same list. Above it Brails rejects the payout after the USDC has landed. */
  maxPayout: number;
  /** Mobile money only; banks come from Brails' live bank list. */
  networks: { code: string; name: string }[];
  /** Brails requires the sender's verified name and country here (see brails-sender). */
  needsSender?: boolean;
}

/** From Brails' beneficiary guides — each `network` is the exact value its payout API accepts. */
const CORRIDORS: Record<string, Corridor> = {
  NG: { name: "Nigeria", currency: "NGN", rail: "bank", minPayout: 500, maxPayout: 500_000_000, networks: [] },
  GH: { name: "Ghana", currency: "GHS", rail: "mobile_money", minPayout: 20, maxPayout: 15_000, networks: [{ code: "MTN", name: "MTN Mobile Money" }] },
  KE: { name: "Kenya", currency: "KES", rail: "mobile_money", minPayout: 20, maxPayout: 250_000, networks: [{ code: "MPESA", name: "M-PESA" }] },
  UG: {
    name: "Uganda",
    currency: "UGX",
    rail: "mobile_money",
    minPayout: 37000,
    maxPayout: 5_000_000,
    networks: [
      { code: "MTN", name: "MTN Mobile Money" },
      { code: "AIRTEL", name: "Airtel Money" },
    ],
  },
  TZ: {
    name: "Tanzania",
    currency: "TZS",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 3_000_000,
    networks: [
      { code: "VODACOM", name: "Vodacom M-Pesa" },
      { code: "AIRTEL", name: "Airtel Money" },
      { code: "TIGO", name: "Tigo Pesa" },
      { code: "HALOTEL", name: "Halopesa" },
    ],
  },
  ZM: {
    name: "Zambia",
    currency: "ZMW",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 20_000,
    networks: [
      { code: "MTN", name: "MTN Mobile Money" },
      { code: "AIRTEL", name: "Airtel Money" },
      { code: "ZAMTEL", name: "Zamtel Kwacha" },
    ],
  },
  CM: {
    name: "Cameroon",
    currency: "XAF",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 1_000_000,
    networks: [
      { code: "MTN", name: "MTN Mobile Money" },
      { code: "OM", name: "Orange Money" },
    ],
  },
  GA: {
    name: "Gabon",
    currency: "XAF",
    rail: "mobile_money",
    minPayout: 200,
    maxPayout: 500_000,
    networks: [
      { code: "AIRTEL", name: "Airtel Money" },
      { code: "MOOV", name: "Moov Money" },
    ],
  },
  MW: {
    name: "Malawi",
    currency: "MWK",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 750_000,
    networks: [
      { code: "TNM", name: "TNM Mpamba" },
      { code: "AIRTEL", name: "Airtel Money" },
    ],
  },
  // ── Below here Brails also requires the sender (see brails-sender) ──
  BJ: {
    name: "Benin",
    currency: "XOF",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 2_000_000,
    needsSender: true,
    networks: [
      { code: "MTN", name: "MTN Mobile Money" },
      { code: "MOOV", name: "Moov Money" },
      { code: "CELTIS", name: "Celtis Cash" },
    ],
  },
  BF: {
    name: "Burkina Faso",
    currency: "XOF",
    rail: "mobile_money",
    minPayout: 200,
    maxPayout: 500_000,
    needsSender: true,
    networks: [
      { code: "ORANGE", name: "Orange Money" },
      { code: "ONATEL", name: "Moov Money (Onatel)" },
    ],
  },
  CI: {
    name: "Côte d'Ivoire",
    currency: "XOF",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 2_000_000,
    needsSender: true,
    networks: [
      { code: "ORANGE", name: "Orange Money" },
      { code: "MTN", name: "MTN Mobile Money" },
      { code: "MOOV", name: "Moov Money" },
    ],
  },
  ML: {
    name: "Mali",
    currency: "XOF",
    rail: "mobile_money",
    minPayout: 200,
    maxPayout: 500_000,
    needsSender: true,
    networks: [
      { code: "ORANGE", name: "Orange Money" },
      { code: "MOOV", name: "Moov Money" },
    ],
  },
  NE: {
    name: "Niger",
    currency: "XOF",
    rail: "mobile_money",
    minPayout: 500,
    // Brails' table says 500,000,000 — Nigeria's NGN figure, by the look of it. Capped at the
    // highest of the other XOF mobile money corridors until Brails confirms the real limit.
    maxPayout: 2_000_000,
    needsSender: true,
    networks: [
      { code: "AIRTEL", name: "Airtel Money" },
      { code: "MOOV", name: "Moov Money" },
    ],
  },
  SN: {
    name: "Senegal",
    currency: "XOF",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 200_000,
    needsSender: true,
    networks: [
      { code: "ORANGE", name: "Orange Money" },
      { code: "WAVE", name: "Wave" },
      { code: "FREE", name: "Free Money" },
      { code: "EXPRESSO", name: "E-Money (Expresso)" },
    ],
  },
  TG: {
    name: "Togo",
    currency: "XOF",
    rail: "mobile_money",
    minPayout: 200,
    maxPayout: 500_000,
    needsSender: true,
    networks: [{ code: "TMONEY", name: "T-Money" }],
  },
  CG: {
    name: "Republic of the Congo",
    currency: "XAF",
    rail: "mobile_money",
    minPayout: 10,
    maxPayout: 50_000,
    needsSender: true,
    networks: [{ code: "MTN", name: "MTN Mobile Money" }],
  },
  CD: {
    name: "DR Congo",
    currency: "CDF",
    rail: "mobile_money",
    minPayout: 100,
    maxPayout: 1_000_000,
    needsSender: true,
    networks: [
      { code: "MPESA", name: "Vodacom M-Pesa" },
      { code: "AIRTEL", name: "Airtel Money" },
      { code: "ORANGE", name: "Orange Money" },
      { code: "AFRICEL", name: "Afrimoney (Africell)" },
    ],
  },
  ET: {
    name: "Ethiopia",
    currency: "ETB",
    rail: "mobile_money",
    minPayout: 200,
    maxPayout: 50_000,
    needsSender: true,
    networks: [
      { code: "ETHIO", name: "telebirr (Ethio Telecom)" },
      { code: "SAFARICOM", name: "M-PESA (Safaricom)" },
    ],
  },
  GM: {
    name: "The Gambia",
    currency: "GMD",
    rail: "mobile_money",
    minPayout: 10,
    maxPayout: 50_000,
    needsSender: true,
    networks: [
      { code: "AFRIMONEY", name: "Afrimoney" },
      { code: "QMONEY", name: "QMoney" },
    ],
  },
  GN: {
    name: "Guinea",
    currency: "GNF",
    rail: "mobile_money",
    minPayout: 200,
    maxPayout: 7_196_000,
    needsSender: true,
    networks: [
      { code: "ORANGE", name: "Orange Money" },
      { code: "MTN", name: "MTN Mobile Money" },
    ],
  },
  MA: {
    name: "Morocco",
    currency: "MAD",
    rail: "mobile_money",
    minPayout: 10,
    maxPayout: 50_000,
    needsSender: true,
    networks: [{ code: "ORANGE", name: "Orange Money" }],
  },
};

/**
 * Chains Brails accepts USDC deposits on that the app can settle a withdrawal from — every one
 * both sides support, so a withdrawal settles where the money already is and only bridges when
 * it is spread too thin for any one chain (the consolidation rule in routing, unchanged).
 * Arc is not a Brails chain, and Ethereum L1 is switched off in the app.
 */
const SETTLEMENT_NETWORKS = ["base", "polygon", "arbitrum", "optimism", "avalanche", "solana", "stellar"];

/**
 * The memo that identifies this user's deposits on Brails' Stellar address.
 *
 * Brails gives every customer the SAME Stellar address; the memo is the only thing that says
 * whose deposit it is, so a payment without the right one cannot be attributed. Derived from the
 * email so it is stable for a user, and 18 digits so two users cannot realistically share one
 * (Brails accepts it; Stellar's text memo allows 28 characters). Once issued it is stored with
 * the address and reused from there — see `depositAddressFor` — never re-derived for an address
 * that already has one.
 */
export function brailsStellarMemo(email: string): string {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest();
  return (digest.readBigUInt64BE(0) % 10n ** 18n).toString().padStart(18, "1");
}

export interface BrailsInstitution {
  country: string;
  rail: Corridor["rail"];
  /** The mobile network (`MTN`) or the bank code (`100004`). */
  network: string;
}

/** Does Brails need the sender's name and country to pay this country? */
export function brailsNeedsSender(country: string): boolean {
  return !!CORRIDORS[country.toUpperCase()]?.needsSender;
}

/** `GH:MTN` / `NG:100004` → its parts, or null when the code is not one of ours. */
export function parseBrailsInstitution(code: string): BrailsInstitution | null {
  const [country, network] = (code || "").toUpperCase().split(":");
  if (!country || !network) return null;
  const corridor = CORRIDORS[country];
  if (!corridor) return null;
  if (corridor.rail === "bank") return /^\d{3,6}$/.test(network) ? { country, rail: "bank", network } : null;
  return corridor.networks.some((n) => n.code === network) ? { country, rail: "mobile_money", network } : null;
}

/** Brails' bank list, an hour at a time: it is long, and it does not change by the minute. */
const bankCache = new Map<string, { at: number; banks: RampInstitution[] }>();
async function banksFor(country: string, currency: string): Promise<RampInstitution[]> {
  const hit = bankCache.get(country);
  if (hit && Date.now() - hit.at < 60 * 60_000) return hit.banks;
  const list = await getBrailsClient().getBankList(country, currency);
  // Brails lists a few codes twice under different names; one entry per code is a pickable list.
  const seen = new Set<string>();
  const banks = list
    .filter((b) => b.code && b.name && !seen.has(b.code) && seen.add(b.code))
    .map((b) => ({ name: b.name.trim(), code: `${country}:${b.code}`, institutionCode: `${country}:${b.code}`, currency }));
  bankCache.set(country, { at: Date.now(), banks });
  return banks;
}

/** The corridor for a currency, honouring the chosen country when one was given. */
function corridorFor(currency: string, country?: string): [string, Corridor] | null {
  const cur = currency.toUpperCase();
  if (country) {
    const c = CORRIDORS[country.toUpperCase()];
    return c && c.currency === cur ? [country.toUpperCase(), c] : null;
  }
  const match = Object.entries(CORRIDORS).find(([, c]) => c.currency === cur);
  return match ?? null;
}

/** International digits, no `+` — the form every Brails sample uses. */
export function brailsPhone(accountNumber: string, country: string): string {
  return toInternationalMsisdn(accountNumber, country) ?? accountNumber.replace(/\D/g, "");
}

export class BrailsProvider implements RampProvider {
  readonly name = "brails" as const;
  readonly capabilities: RampCapabilities = {
    onRamp: false,
    offRamp: true,
    verifyAccount: true,
    institutions: true,
    currencies: true,
    rates: true,
  };

  async supportsCurrency(currency: RampCurrency): Promise<boolean> {
    return getBrailsClient().configured && corridorFor(currency) !== null;
  }

  async createOnRampOrder(): Promise<RampOrderResponse> {
    throw new RampUnsupportedError("brails", "onRamp");
  }

  private assertWithinLimits(fiat: number, currency: string, country?: string): void {
    const corridor = corridorFor(currency, country);
    if (!corridor) return;
    const [, c] = corridor;
    if (fiat < c.minPayout) {
      throw new RampUnsupportedError("brails", "offRamp", `Payouts to ${c.name} start at ${c.minPayout.toLocaleString("en-US")} ${c.currency}.`);
    }
    if (fiat > c.maxPayout) {
      throw new RampUnsupportedError("brails", "offRamp", `Payouts to ${c.name} are limited to ${c.maxPayout.toLocaleString("en-US")} ${c.currency} each.`);
    }
  }

  /**
   * What a dollar pays out in this country, from a live quote.
   *
   * The currency-wide payout rate is not what a payout gets: Brails prices each country
   * separately (Cameroon quoted 598 XAF to the dollar against a currency rate of 623), so showing
   * the currency rate promised more than the payout would deliver. The quote is for roughly this
   * amount, inside the corridor's limits, and nothing is reserved by asking.
   */
  private async countryRate(currency: string, country: string, usd: number): Promise<number> {
    const base = await this.sellRate(currency);
    this.assertWithinLimits(usd * base, currency, country);
    const quote = await getBrailsClient().createPayoutQuote({
      targetCurrency: currency,
      targetMinor: Math.round(usd * base * 100),
      country,
    });
    const rate = Number(quote.rate) > 0 ? Number(quote.rate) : (quote.targetAmount / quote.sourceAmount);
    if (!(rate > 0)) {
      throw new RampUnsupportedError("brails", "rates", `Brails returned no ${currency} quote for ${country}`);
    }
    return rate;
  }

  private async sellRate(currency: string): Promise<number> {
    const { sellRate } = await getBrailsClient().getPayoutRate(currency);
    if (!(Number(sellRate) > 0)) {
      throw new RampUnsupportedError("brails", "rates", `Brails returned no ${currency} rate`);
    }
    return Number(sellRate);
  }

  /**
   * The user's Brails address on `chain`: the one their last Brails withdrawal used, or a new one.
   *
   * Read back from our own withdrawal rows because Brails cannot give it back — every request
   * mints another address, and its list cannot be filtered by customer. Two first withdrawals
   * at once may each get one; harmless, since deposits are matched by hash, not by address.
   */
  private async depositAddressFor(email: string, chain: string): Promise<{ address: string; memo?: string }> {
    const isStellar = chain === "stellar";
    const { supabaseAdmin } = await import("@/lib/supabase/adminClient");
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();
    if (user?.id) {
      const { data: prior } = await supabaseAdmin
        .from("withdrawals")
        .select("provider_metadata")
        .eq("user_id", user.id)
        .eq("provider", "brails")
        .eq("provider_metadata->>network", chain)
        .not("provider_metadata->>deposit_address", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const known = prior?.provider_metadata as { deposit_address?: string; deposit_memo?: string } | null;
      // On Stellar the address alone identifies nobody — reuse it only together with its memo.
      if (known?.deposit_address && (!isStellar || known.deposit_memo)) {
        return { address: known.deposit_address, memo: known.deposit_memo };
      }
    }
    const memo = isStellar ? brailsStellarMemo(email) : undefined;
    const created = await getBrailsClient().createDepositAddress(email, chain, memo);
    // Brails echoes the memo it registered; trust that over our own copy.
    const registered = (created as { memo?: string | null }).memo ?? memo;
    if (isStellar && !registered) {
      throw new Error("Brails returned a Stellar address without a memo — refusing to use it");
    }
    return { address: created.address, memo: registered ?? undefined };
  }

  /**
   * Indicative, never binding. Brails' quotes last 90 seconds, far less than the time between a
   * user placing an order and their USDC arriving, so the binding quote is taken at payout time
   * (lib/ramp/brails-payout.ts) and this shows the live payout rate meanwhile.
   */
  async quoteOffRamp(params: QuoteOffRampParams): Promise<RampPayoutQuote> {
    const corridor = corridorFor(params.fiatCurrency, params.payoutCountry);
    if (!corridor) {
      throw new RampUnsupportedError("brails", "offRamp", `Brails does not pay out ${params.fiatCurrency} here`);
    }
    const rate = await this.countryRate(params.fiatCurrency, corridor[0], params.amountUsdc);
    this.assertWithinLimits(params.amountUsdc * rate, params.fiatCurrency, corridor[0]);
    return {
      provider: "brails",
      rate,
      payoutAmount: params.amountUsdc * rate,
      binding: false,
    };
  }

  async createOffRampOrder(params: CreateOffRampParams): Promise<RampOrderResponse> {
    const corridor = corridorFor(params.fiatCurrency, params.payoutCountry);
    const inst = parseBrailsInstitution(params.bank.bankCode);
    if (!corridor || !inst || inst.country !== corridor[0]) {
      throw new RampUnsupportedError(
        "brails",
        "offRamp",
        `Brails cannot pay ${params.fiatCurrency} to ${params.bank.bankCode}`,
      );
    }
    if (!SETTLEMENT_NETWORKS.includes(params.network.toLowerCase())) {
      throw new RampUnsupportedError("brails", "offRamp", `Brails does not accept USDC on ${params.network}`);
    }

    // Before an address exists or anything is sent: a corridor that needs the sender can only be
    // served for a user with a verified name, and the payout cannot add one later.
    if (corridor[1].needsSender) {
      const { brailsSenderFor } = await import("../brails-sender");
      if (!(await brailsSenderFor({ email: params.userEmail }))) {
        throw new RampUnsupportedError(
          "brails",
          "offRamp",
          `Verify your identity to send to ${corridor[1].name}.`,
        );
      }
    }

    const rate = await this.countryRate(params.fiatCurrency, corridor[0], params.amountUsdc);
    const fiatAmount =
      params.inputMode === "fiat" && params.fiatAmount ? params.fiatAmount : params.amountUsdc * rate;
    // Before the user sends anything: Brails rejects a payout outside the corridor's limits, and
    // by then the USDC is already with Brails. Refusing here lets the router try the next provider.
    this.assertWithinLimits(fiatAmount, params.fiatCurrency, corridor[0]);

    const address = await this.depositAddressFor(params.userEmail, params.network.toLowerCase());

    const now = Date.now();
    return {
      // Our reference, not Brails': no Brails transaction exists until the deposit lands and
      // the webhook starts the payout. It is what the withdrawal row and the webhook key on.
      id: `brails_${now}_${Math.random().toString(36).slice(2, 8)}`,
      provider: "brails",
      status: "pending",
      providerAccount: {
        receiveAddress: address.address,
        // Stellar only: without it Brails cannot tell whose deposit this is.
        ...(address.memo ? { memo: address.memo } : {}),
        network: params.network,
        // The address is the customer's for good; this bounds how long the indicative rate
        // shown with it is presented as current.
        validUntil: new Date(now + 30 * 60_000).toISOString(),
      },
      source: { type: "crypto", currency: "USDC", network: params.network },
      destination: { type: "fiat", currency: params.fiatCurrency },
      amount: String(params.amountUsdc),
      fiatAmount: fiatAmount.toFixed(2),
      fiatRate: rate,
      // Brails' own per-payout fee (Tanzania, Zambia, Uganda…), sent on top of the amount so it
      // comes out of the user's deposit, not out of what the recipient gets or our wallet.
      providerFee: String(getCorridorFee("brails", params.fiatCurrency, corridor[1].rail)),
      createdAt: new Date(now).toISOString(),
    };
  }

  /**
   * Always `pending`. There is no Brails order under our reference to ask about — the outcome
   * arrives by webhook and is written to the withdrawal row, which the withdraw screen and the
   * history view read alongside this. Answering (rather than throwing) keeps those polls going,
   * the same way Bitnob's stay `pending` while its webhook decides.
   */
  async getOrder(orderId: string): Promise<RampOrderResponse> {
    const now = new Date().toISOString();
    return {
      id: orderId,
      provider: "brails",
      status: "pending",
      providerAccount: { validUntil: now },
      source: { type: "crypto", currency: "USDC" },
      destination: { type: "fiat", currency: "" },
      amount: "0",
      createdAt: now,
    };
  }

  async getRates(amount: number, fiat: RampCurrency): Promise<RampRateResponse> {
    if (!corridorFor(fiat)) throw new RampUnsupportedError("brails", "rates", `Brails does not price ${fiat}`);
    const rate = await this.sellRate(fiat);
    void amount;
    return { data: { sell: { rate, provider_id: "brails" } } };
  }

  async verifyAccount(
    institution: string,
    accountNumber: string,
  ): Promise<RampVerifyAccountResponse> {
    const inst = parseBrailsInstitution(institution);
    if (!inst) throw new RampUnsupportedError("brails", "verifyAccount", `Unknown Brails network ${institution}`);

    if (inst.rail === "bank") {
      const r = await getBrailsClient().lookupBeneficiary({
        country: inst.country,
        accountNumber: accountNumber.replace(/\D/g, ""),
        bankCode: inst.network,
      });
      if (!r.accountName) throw new Error("Unable to verify bank details. Please check the bank and account number.");
      return { status: "success", data: { accountName: r.accountName }, nameVerified: true };
    }

    const operator = CORRIDORS[inst.country].networks.find((n) => n.code === inst.network)!.name;
    // The shared rules (length per country, operator prefixes) before anything else: a number
    // that cannot be right is caught here, not rejected by the payout after the deposit lands.
    const check = validateMobileMoneyNumber({
      institutionCode: institution,
      country: inst.country,
      accountNumber,
      operatorName: operator,
    });
    if (!check.ok) throw new Error(check.reason ?? `That ${operator} number isn't valid.`);
    const phone = check.msisdn ?? brailsPhone(accountNumber, inst.country);

    // Brails' name enquiry serves Ghana MTN only. Everywhere else the number's shape is all
    // that can be checked, and the UI must not present that as a confirmed account holder.
    if (inst.country === "GH" && inst.network === "MTN") {
      const r = await getBrailsClient().lookupBeneficiary({ country: "GH", accountNumber: phone, network: "MTN" });
      if (!r.accountName) throw new Error("We couldn't find that mobile money account.");
      return { status: "success", data: { accountName: r.accountName }, nameVerified: true };
    }
    return { status: "success", message: "format_checked", data: { accountName: operator }, nameVerified: false };
  }

  async getInstitutions(currency: RampCurrency, country?: string): Promise<{ data: RampInstitution[] }> {
    // Unconfigured, Brails can take no order — so it must not offer networks either.
    if (!getBrailsClient().configured) {
      throw new RampUnsupportedError("brails", "institutions", "Brails is not configured");
    }
    const corridor = corridorFor(currency, country);
    if (!corridor) {
      throw new RampUnsupportedError("brails", "institutions", `Brails does not pay out ${currency}`);
    }
    const [code, c] = corridor;
    if (c.rail === "bank") return { data: await banksFor(code, c.currency) };
    return {
      data: c.networks.map((n) => ({
        name: n.name,
        code: `${code}:${n.code}`,
        institutionCode: `${code}:${n.code}`,
        currency: c.currency,
      })),
    };
  }

  async getCurrencies(): Promise<{ data: RampCurrencyDetail[] }> {
    if (!getBrailsClient().configured) return { data: [] };
    return {
      data: Object.entries(CORRIDORS).map(([code, c]) => ({
        code: c.currency,
        name: c.name,
        country: code,
        symbol: getCurrencySymbol(c.currency),
        channels: [c.rail],
      })),
    };
  }

  async getPayoutCountries(): Promise<{ data: RampCountry[] }> {
    if (!getBrailsClient().configured) return { data: [] };
    return {
      data: Object.entries(CORRIDORS).map(([code, c]) => ({
        code,
        name: c.name,
        currency: c.currency,
        channels: [c.rail],
      })),
    };
  }

  async getSettlementNetworks(): Promise<string[]> {
    return getBrailsClient().configured ? SETTLEMENT_NETWORKS : [];
  }
}

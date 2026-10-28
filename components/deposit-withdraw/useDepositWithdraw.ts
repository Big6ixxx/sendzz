"use client";

import {
  executeOffRamp,
  getInstitutions,
  getKycGatedNetworks,
  getOffRampProviderOrder,
  getOffRampQuote,
  getOffRampQuoteForFiat,
  getOffRampRate,
  getOnRampRate,
  getOrderStatus,
  getCorridorFeeAction,
  getProviderFeePercent,
  getRampNetworks,
  initiateOnRamp,
  getOnRampRequirement,
  getDepositStatus,
  pickDepositNetwork,
  verifyBankAccount,
} from "@/lib/actions/ramp";
import type { RampProviderName } from "@/lib/ramp";
import { type SupportedChain } from "@/lib/circle/gateway";
import {
  updateDepositStatus,
  saveWithdrawalTxHash,
  saveDepositTxHash,
  getLedgerOrderStatus,
  reconcileOrderStatus,
} from "@/lib/supabase/transactions";
import { type FiatCurrencyCode } from "@/lib/currency-config";
import {
  getUserBankContacts,
  addBankContact,
  type BankContactRow,
} from "@/lib/supabase/bank-contacts";
import {
  RampInstitution,
  RampNetwork,
  RampOrderResponse,
} from "@/lib/ramp";
import {
  executeCircleGaslessTransfer,
  executeCircleGaslessBatchTransfer,
} from "@/lib/web3/circle-actions";
import {
  consolidateFundsToChain,
  selectConsolidationSources,
} from "@/lib/web3/bridge-actions";
import { stellarSourceFor } from "@/lib/web3/stellar-bridge";
import {
  planWithdrawalRoute,
  AUTO_SOURCE,
  type ChainBalances,
  type SolanaSource,
  type SourceChainKey,
  type SourcePreference,
} from "@/lib/web3/routing";
import { parseFriendlyError } from "@/components/transfer/useTransfer";
import { ConnectedWallet, usePrivy } from "@privy-io/react-auth";
import { formatFiatShort, getCurrencySymbol } from "@/lib/currency-config";
import { FIAT_ROUTING_PAD } from "@/lib/ramp/fees";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchContactBank } from "./contact-bank";
import { usePinAuthorization } from "@/components/security/PinAuthorizationProvider";
import { describeWithdrawal } from "@/lib/signing/describe";
import { getReferralBenefitBalances } from "@/lib/actions/ramp";
import { applyBenefits, type BenefitBalances } from "@/lib/referrals/benefit-math";
import { type SigningPlan } from "@/lib/signing/plan";
import { toast } from "sonner";
import type { KycBlock } from "@/components/kyc/KycRequiredModal";
import { useCurrencies } from "@/lib/hooks/useCurrencies";
import type { OnRampKycNeed } from "@/lib/ramp/onramp-kyc";

export type FlowType = "deposit" | "withdraw";

interface BankDetails {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bankName: string;
  memo?: string;
}

export function useDepositWithdraw(
  type: FlowType,
  userAddress: string,
  userEmail: string,
  userId: string,
  balance: string,
  embeddedProvider?: ConnectedWallet,
  onClose?: () => void,
  chainBalances?: ChainBalances,
  solanaSource?: SolanaSource,
  stellarAddress?: string,
  stellarWalletId?: string,
  stellarBalance = 0,
) {
  const queryClient = useQueryClient();
  const { data: currencies } = useCurrencies();
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("");
  const [inputMode, setInputMode] = useState<"usdc" | "fiat">("usdc");
  const [loading, setLoading] = useState(false);
  // A refused withdrawal is a dead end unless we offer the way out, so the guard's result is
  // held here and rendered as a modal rather than thrown away in a toast.
  const [kycBlock, setKycBlock] = useState<KycBlock | null>(null);
  const [error] = useState<string | null>(null);
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrencyCode>("NGN");
  /**
   * The payout country the user chose, when they chose one.
   *
   * Not derivable from the currency: XOF covers eight countries, and without this the provider
   * resolved the corridor by scanning for the first match — so a payout to Senegal was built
   * against Benin's banks and Benin's beneficiary. Null means "no preference", which is the old
   * behaviour and still correct for a currency only one country uses.
   */
  const [payoutCountry, setPayoutCountry] = useState<string | null>(null);
  // Deposits: what the user still needs before Paycrest will take the order (see
  // getOnRampRequirement). Null while asking.
  const [onRampRequirement, setOnRampRequirement] = useState<
    { ok: true; name: string } | { ok: false; need: OnRampKycNeed; message: string; name?: string } | null
  >(null);
  const onRampRequest = useRef(0);
  // Set when the provider holds the deposit for a compliance review (see the poll below).
  const [depositUnderReview, setDepositUnderReview] = useState(false);
  // Networks at this destination the user must verify their identity to use (see
  // getKycGatedNetworks). Empty for verified users and for corridors that need no sender.
  const [kycGatedNetworks, setKycGatedNetworks] = useState<string[]>([]);
  // Only the latest request may land: switching country quickly must not leave the previous
  // country's gates on the new list.
  const kycGateRequest = useRef(0);
  const refreshKycGates = useCallback(() => {
    const request = ++kycGateRequest.current;
    if (type !== "withdraw" || !payoutCountry) {
      setKycGatedNetworks([]);
      return;
    }
    getKycGatedNetworks(fiatCurrency, payoutCountry)
      .catch(() => [] as string[])
      .then((gated) => {
        if (request === kycGateRequest.current) setKycGatedNetworks(gated);
      });
  }, [type, fiatCurrency, payoutCountry]);
  useEffect(() => {
    setKycGatedNetworks([]);
    refreshKycGates();
  }, [refreshKycGates]);
  const [quoteUsdcAmount, setQuoteUsdcAmount] = useState<string>("");
  // On-ramp landing chain. Defaults to Base; advanced users may pick another supported chain.

  // User Security Preferences
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState(500);
  const { authorize } = usePinAuthorization();

  // Referral benefits, as BALANCES rather than a priced quote, so the fee recomputes as the
  // user types without a round trip per keystroke. The arithmetic is shared with the server
  // (lib/referrals/benefit-math.ts), so what is shown here is what is charged.
  const [benefits, setBenefits] = useState<BenefitBalances>({
    waiverVolumeUsdc: 0,
    feeCreditUsdc: 0,
  });
  // The plan the user approved, and how far through it we are.
  const [activePlan, setActivePlan] = useState<SigningPlan | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  /**
   * The chains the off-ramp provider can settle on. Drives withdrawal routing.
   *
   * Fetched through react-query rather than a once-only effect. It used to run once on mount
   * with no retry, and `getRampNetworks` degrades to `["base", "polygon"]` when the provider
   * call fails — so a single transient failure at mount pinned the whole session to those two
   * chains. During the Bitnob outage that is exactly what happened: Arbitrum dropped out of the
   * candidate list, so a wallet whose balance was mostly on Arbitrum could not settle there and
   * bridged to Base instead, for every withdrawal until the page was reloaded.
   *
   * Retries, and refetches on reconnect, so recovering the provider recovers the routing
   * without the user having to reload.
   */
  const { data: fetchedRampNetworks } = useQuery({
    // Keyed by currency: the answer depends on which providers can still serve that corridor,
    // so a cached list from another currency would offer chains nothing can settle on.
    queryKey: ["ramp-networks", fiatCurrency],
    queryFn: () => getRampNetworks(fiatCurrency),
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (fetchedRampNetworks) setRampNetworks(fetchedRampNetworks as SupportedChain[]);
  }, [fetchedRampNetworks]);

  // Sync fiatCurrency with available currencies if current one is not supported
  useEffect(() => {
    // A chosen destination decides the currency. `currencies` is one provider's catalogue, and a
    // currency only another provider pays (CDF, ETB, GNF, MAD, MWK are Brails-only) is missing
    // from it — resetting to its first entry turned DR Congo into NGN and listed Nigerian banks.
    if (type === "withdraw" && payoutCountry) return;
    if (currencies && currencies.length > 0) {
      const isSupported = currencies.some((c) => c.code === fiatCurrency);
      if (!isSupported) {
        setFiatCurrency(currencies[0].code);
      }
    }
  }, [currencies, fiatCurrency, type, payoutCountry]);

  // Off-ramp provider pinned for this withdrawal (banks + verify + order all use it).
  const [offRampProvider, setOffRampProvider] = useState<RampProviderName | undefined>(
    undefined,
  );
  // Platform fee % for the pinned provider (drives the fee line + balance math). The actual
  // fee amount/treasury is resolved server-side and embedded in the order.
  const [feePercent, setFeePercent] = useState<number>(0);
  // Flat per-payout provider fee in USDC, on top of base + platform fee (see getCorridorFee).
  const [corridorFee, setCorridorFee] = useState<number>(0);
  // Both fee figures loaded for the current destination. Until then they read 0, and confirming
  // 0 would make the server refuse every provider that charges more (see executeOffRamp).
  const [feesLoaded, setFeesLoaded] = useState(false);
  // The providers that may take this destination's order, for re-pricing once a bank is picked.
  const [feeCandidates, setFeeCandidates] = useState<RampProviderName[]>([]);

  // Institutions & Rates
  const [institutions, setInstitutions] = useState<RampInstitution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  // Bank Selection
  const [bankDetails, setBankDetails] = useState<BankDetails>({
    accountNumber: "",
    bankCode: "",
    accountName: "",
    bankName: "",
  });
  const [verifyingBank, setVerifyingBank] = useState(false);

  // Order & Execution
  const [order, setOrder] = useState<RampOrderResponse | null>(null);
  /**
   * The payout quote in force. `payoutAmount` is what the beneficiary receives — after every
   * fee, since fees are added ON TOP of the base rather than taken out of the payout.
   *
   * `binding` says whether it came from the provider's own payout quote (it will settle at this
   * figure) or from the indicative rate (an estimate). Once the order exists, this is replaced
   * by the order's own quoted figure, so the confirm screen, the payout and the receipt are all
   * the same number.
   */
  const [quote, setQuote] = useState<{
    rate: number;
    payoutAmount: number;
    binding?: boolean;
    quoteId?: string;
    reference?: string;
    /** Which provider priced it — a different one settling means a different price. */
    provider?: RampProviderName;
  } | null>(null);

  /**
   * Who the money is going to, in the words the user would use.
   *
   * The account name is the one a person recognises — it is their own name, or the name of
   * whoever they are paying. The bank stands in only when the account name is missing, because
   * "your bank" is still more meaningful than an account number.
   */
  const payoutTo = useCallback(
    () =>
      bankDetails.accountName?.trim() ||
      bankDetails.bankName?.trim() ||
      "your bank",
    [bankDetails.accountName, bankDetails.bankName],
  );

  /** The payout as the recipient will see it on their statement: "₦82,400". */
  const payoutAmountText = useCallback(
    () => (quote?.payoutAmount != null ? formatFiatShort(quote.payoutAmount, fiatCurrency) : ""),
    [quote?.payoutAmount, fiatCurrency],
  );
  /**
   * The binding quote behind the amount currently typed on step 1. Distinct from `quote`, which
   * is the one the user has reviewed and committed to; this one changes as they type.
   */
  const [liveQuote, setLiveQuote] = useState<
    | {
        rate: number;
        payoutAmount: number;
        binding: boolean;
        quoteId?: string;
        reference?: string;
        provider?: RampProviderName;
        /** The USDC base it was struck for — stale once the input moves on. */
        forAmountUsdc: number;
      }
    | null
  >(null);
  const [liveQuoteLoading, setLiveQuoteLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  /**
   * Set when the payout figure moved between the review the user authorised and the order that
   * was actually struck — a re-quoted rate, or a fallback provider pricing it differently.
   *
   * The withdrawal is authorised once and runs through, so this does not gate anything; it
   * labels the change inline on the summary that stays on screen, and the summary already shows
   * the new figure. Silently swapping a money amount is the one thing not to do.
   */
  const [payoutAdjusted, setPayoutAdjusted] = useState<
    { from: number; reason: "rate" | "provider" } | null
  >(null);
  /**
   * Why the transfer stopped, when it did.
   *
   * Without a second confirmation press there is no button left on the sending screen, so a
   * rejected signature or a failed broadcast would otherwise spin forever. The order already
   * exists at that point, so the recovery is to retry THIS order — creating another would
   * orphan the first in `pending_address_deposit`.
   */
  const [transferError, setTransferError] = useState<string | null>(null);
  // Ramp-supported chain chosen by the router to source the off-ramp from.
  const [withdrawChain, setWithdrawChain] = useState<RampNetwork>("base");
  // Settlement networks the active off-ramp provider supports (fetched, not hardcoded).
  const [rampNetworks, setRampNetworks] = useState<SupportedChain[] | undefined>(
    undefined,
  );
  // When funds are split across chains, we auto-bridge them onto Base before withdrawing.
  const [mustConsolidate, setMustConsolidate] = useState(false);
  // User source override (default: smart auto). Set via the SourceSelector.
  const [sourcePref, setSourcePref] = useState<SourcePreference>(AUTO_SOURCE);
  // When consolidating, the specific chains to pull from (null = all funded).
  const [consolidateFrom, setConsolidateFrom] = useState<SourceChainKey[] | null>(null);
  /**
   * A CURRENT Privy access token for the server actions that authenticate the caller.
   *
   * Without one they fall back to the `privy-token` cookie, which goes stale while a tab sits
   * open — and a stale cookie fails identity verification, surfacing as "Your session expired"
   * on an action the user just triggered. `getAccessToken()` refreshes a token that is near
   * expiry, so asking for it per call is what keeps a long-lived tab working. This is the same
   * thing the transfer flow and the admin pages already do.
   *
   * Resolves to undefined if Privy can't be reached; the action then falls back to the cookie
   * rather than being blocked outright.
   */
  const { getAccessToken } = usePrivy();
  const freshToken = useCallback(
    async () => (await getAccessToken().catch(() => null)) ?? undefined,
    [getAccessToken],
  );

  const [bankContacts, setBankContacts] = useState<BankContactRow[]>([]);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  // Polling for deposit status
  const [polling, setPolling] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  /**
   * Did this withdrawal end in failure?
   *
   * Needed because `polling` alone cannot say how it ended. The progress view read
   * `polling ? "Processing" : "Withdrawal Complete!"`, so the moment polling stopped — for ANY
   * reason — a failed withdrawal rendered a green tick and "your funds have been sent to your
   * bank account", while the toast underneath said it had failed.
   */
  const [txFailed, setTxFailed] = useState(false);
  const [withdrawalTxHash, setWithdrawalTxHash] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  /** Detaches the service-worker listener that races the poll. */
  const pushListenerRef = useRef<(() => void) | null>(null);

  // 2FA State
  const [twoFaModalOpen, setTwoFaModalOpen] = useState(false);
  const [twoFaOtpId, setTwoFaOtpId] = useState<string | null>(null);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);

  // Fetch institutions & rates when the destination changes.
  useEffect(() => {
    // Every response below belongs to ONE destination, and only the latest may land.
    //
    // There was no guard, and the hook starts on NGN — whose bank list (367 banks) is the
    // slowest call of all. Pick Kenya within a second and Kenya's operators arrive first, then
    // Nigeria's banks arrive last and overwrite them. That is why every corridor showed
    // Nigerian banks. The same race could overwrite the RATE, the fee percent, the corridor fee
    // and the quote with Nigeria's figures while the user is looking at Kenya — a pricing bug,
    // not just a list bug. It was always latent; putting the country picker first, where people
    // change it immediately, made it fire every time.
    let cancelled = false;

    // A withdrawal asks for its destination first, and nothing country-specific is fetched
    // until there is one. Loading on mount meant fetching NIGERIA by default — the hook's
    // starting currency — for a user who had not chosen anything, and that request (367 banks,
    // the slowest there is) was exactly the one that later landed on top of their real choice.
    // Deposits are unaffected: they have no destination step.
    const awaitingDestination = type === "withdraw" && !payoutCountry;

    const init = async () => {
      setInstitutionsLoading(true);
      try {
        let provider: RampProviderName;
        // Every provider that may take this order, not only the first: see the fees below.
        let candidates: RampProviderName[] = [];
        let instRes: { data: RampInstitution[] } = { data: [] };

        if (type === "withdraw") {
          const order = await getOffRampProviderOrder(fiatCurrency).catch(
            () => ["paycrest"] as RampProviderName[],
          );
          provider = order[0] || "paycrest";
          candidates = order.length > 0 ? order : [provider];
          instRes = await getInstitutions(fiatCurrency, undefined, payoutCountry ?? undefined).catch(() => ({ data: [] }));
        } else {
          provider = "paycrest";
          candidates = [provider];
          instRes = await getInstitutions(fiatCurrency, provider, payoutCountry ?? undefined).catch(() => ({ data: [] }));
        }

        if (cancelled) return;
        setOffRampProvider(provider);
        setFeeCandidates(candidates);
        // Asked per corridor: a currency with its own rate must not be quoted at the
        // standard one and then deducted at the other. The highest across the providers that
        // may take the order: the server only lets a provider through if it costs no more than
        // what was confirmed, so the figure must cover every one of them. Whichever takes it,
        // the user is charged its own (equal or lower) fee. A failed fetch is retried once, then
        // left unloaded — never taken as 0, which would get every fallback refused.
        const highest = (values: number[]) => values.reduce((m, v) => Math.max(m, v), 0);
        const retryOnce = <T,>(fn: () => Promise<T>) => fn().catch(() => fn());
        setFeesLoaded(false);
        const feePercents = Promise.all(candidates.map((p) => retryOnce(() => getProviderFeePercent(p, fiatCurrency))))
          .then(highest);
        // Flat provider fee for this corridor. Fetched alongside the provider so
        // it is known before the amount is validated, not after the order exists.
        const corridorFees = Promise.all(candidates.map((p) => retryOnce(() => getCorridorFeeAction(p, fiatCurrency))))
          .then(highest);
        feePercents.then((v) => { if (!cancelled) setFeePercent(v); }).catch(() => undefined);
        corridorFees.then((v) => { if (!cancelled) setCorridorFee(v); }).catch(() => undefined);
        Promise.all([feePercents, corridorFees])
          .then(() => { if (!cancelled) setFeesLoaded(true); })
          .catch(() => console.error("[Withdraw] fees could not be loaded for", fiatCurrency));
        getReferralBenefitBalances()
          .then(setBenefits)
          // Zero on failure means the full fee is quoted. The user is then charged less than
          // shown, never more — the only safe direction for a number they are deciding on.
          .catch(() => setBenefits({ waiverVolumeUsdc: 0, feeCreditUsdc: 0 }));
        setInstitutions(instRes.data);
      } catch (err) {
        console.error("Failed to fetch banks", err);
      } finally {
        if (!cancelled) setInstitutionsLoading(false);
      }
    };
    if (awaitingDestination) {
      setInstitutions([]);
      setInstitutionsLoading(false);
    } else {
      init();
    }

    // Reset bank details when currency changes
    setBankDetails({
      accountNumber: "",
      bankCode: "",
      accountName: "",
      bankName: "",
    });
    setRate(null);

    if (awaitingDestination) {
      setRateLoading(false);
    } else {
      setRateLoading(true);
      if (type === "deposit") {
        getOnRampRate(fiatCurrency)
          .then((r) => { if (!cancelled) setRate(r); })
          .catch(() => { if (!cancelled) setRate(null); })
          .finally(() => { if (!cancelled) setRateLoading(false); });
      } else {
        getOffRampRate(fiatCurrency)
          .then((r) => { if (!cancelled) setRate(r); })
          .catch(() => { if (!cancelled) setRate(null); })
          .finally(() => { if (!cancelled) setRateLoading(false); });

        if (quoteUsdcAmount) {
          const val = parseFloat(quoteUsdcAmount);
          if (!isNaN(val) && val > 0) {
            getOffRampQuote(val, fiatCurrency, withdrawChain)
              .then((q) => { if (!cancelled) setQuote(q); })
              .catch(() => {});
          }
        }
      }
    }

    // Fetch bank contacts
    if (userEmail) {
      getUserBankContacts().then(setBankContacts).catch(console.error);

      // Fetch security preferences
      fetch("/api/user/preferences")
        .then((res) => res.json())
        .then((data) => {
          if (data && typeof data.two_fa_enabled === "boolean") {
            setTwoFaEnabled(data.two_fa_enabled);
            setTwoFaThreshold(data.two_fa_threshold);
            setTotpEnabled(data.totp_enabled || false);
            const credentials = data.webauthn_credentials || [];
            setPasskeyEnabled(
              Array.isArray(credentials) && credentials.length > 0,
            );
          }
        })
        .catch(console.error);

      // Whether a PIN exists. Read from its own endpoint, which returns only a boolean —
      // the hash is never sent anywhere, not even to the account that owns it.
      fetch("/api/2fa/pin")
        .then((res) => res.json())
        .then((data) => setPinEnabled(!!data?.enabled))
        .catch(() => setPinEnabled(false));
    }

    return () => {
      cancelled = true;
    };
    // `payoutCountry` included so Ivory Coast → Senegal (both XOF) refetches: the currency does
    // not change, so without it the previous country's operators stayed on screen.
  }, [type, fiatCurrency, payoutCountry, userEmail]);

  // Some corridors charge bank payouts a flat fee and mobile money none (Ghana), so once the
  // bank or operator is picked the fee is re-asked for it. Until it answers, or if it fails,
  // the destination's highest fee stands — more than will be charged, never less.
  useEffect(() => {
    if (type !== "withdraw" || !bankDetails.bankCode || feeCandidates.length === 0) return;
    let cancelled = false;
    Promise.all(feeCandidates.map((p) => getCorridorFeeAction(p, fiatCurrency, bankDetails.bankCode)))
      .then((v) => { if (!cancelled) setCorridorFee(v.reduce((m, x) => Math.max(m, x), 0)); })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [type, bankDetails.bankCode, feeCandidates, fiatCurrency]);

  // Saved contacts whose bank pays out in the chosen country. The rest are hidden rather than
  // offered and then failing: picking one would address a payout to a bank this corridor lacks.
  const countryContacts = useMemo(
    () =>
      bankContacts.filter(
        (c) => matchContactBank(institutions, { bankCode: c.bank_code, bankName: c.bank_name }) != null,
      ),
    [bankContacts, institutions],
  );

  // A mobile money number whose holder cannot be looked up (everywhere but Ghana MTN): its
  // format passed, and the user must give the recipient's name. Keyed to the network and number,
  // so changing either asks again, and so it is not re-verified in a loop while the name is empty.
  const [acceptedNumber, setAcceptedNumber] = useState<string | null>(null);
  const numberKey = `${bankDetails.bankCode}|${bankDetails.accountNumber}`;
  const recipientNameNeeded = acceptedNumber === numberKey;
  // A saved contact's name, offered as the recipient's name if the number has no name enquiry.
  const contactNameHint = useRef("");

  const handleSelectContact = useCallback(
    (contact: {
      bankCode: string;
      bankName: string;
      accountNumber: string;
      accountName: string;
    }) => {
      const resolved = matchContactBank(institutions, contact);
      if (!resolved) return;
      // A saved name is not a checked one: the account is verified again, like a typed one.
      // Where the network has a name enquiry, its answer is shown; where it has none, the saved
      // name only pre-fills the editable recipient field. Older contacts saved the operator
      // ("Wave") as the name, which is no name at all.
      const operatorAsName =
        contact.accountName.trim().toLowerCase() === contact.bankName.trim().toLowerCase();
      contactNameHint.current = operatorAsName ? "" : contact.accountName;
      setAcceptedNumber(null);
      setBankDetails({
        bankCode: resolved.code,
        bankName: resolved.name,
        accountNumber: contact.accountNumber,
        accountName: "",
      });
    },
    [institutions],
  );

  /** A saved contact whose network this user must verify their identity to pay. */
  const isContactGated = useCallback(
    (contact: { bankCode: string; bankName: string }) => {
      const resolved = matchContactBank(institutions, contact);
      return !!resolved && kycGatedNetworks.includes(resolved.code);
    },
    [institutions, kycGatedNetworks],
  );

  // Bank Auto-Verification
  const handleVerifyBank = useCallback(async (details: BankDetails) => {
    if (
      details.accountNumber.length < 8 ||
      !details.bankCode
    )
      return;

    setVerifyingBank(true);
    try {
      // Verified against the provider that will actually settle on THIS chain. Checking against
      // a provider that cannot settle here is how a bank could pass verification and then be
      // rejected at payout by whichever provider really handled it.
      const res = await verifyBankAccount(
        details.bankCode,
        details.accountNumber,
        fiatCurrency,
        offRampProvider,
        withdrawChain,
        details.bankName,
        payoutCountry ?? undefined,
      );
      let name =
        typeof res.data === "string" ? res.data : res.data?.accountName;
      if (!name) {
        throw new Error("Could not verify account for these bank details.");
      }
      if (name.trim().toUpperCase() === "OK") {
        name = "VERIFIED ACCOUNT";
      }
      // Mobile money with no name enquiry: only the number was checked. Its "name" is the
      // operator's, which must not become the recipient's name on the payout — ask for it.
      if (res.nameVerified === false) {
        setAcceptedNumber(`${details.bankCode}|${details.accountNumber}`);
        setBankDetails((prev) => ({ ...prev, accountName: contactNameHint.current }));
        contactNameHint.current = "";
        toast.success("Mobile money number accepted");
        return;
      }
      setAcceptedNumber(null);
      contactNameHint.current = "";
      setBankDetails((prev) => ({ ...prev, accountName: name }));
      toast.success("Bank account verified");
    } catch (err) {
      toast.error(parseFriendlyError(err));
      setBankDetails((prev) => ({ ...prev, accountName: "" }));
    } finally {
      setVerifyingBank(false);
    }
  }, [fiatCurrency, offRampProvider, withdrawChain, payoutCountry]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (
        bankDetails.accountNumber.length >= 8 &&
        bankDetails.bankCode &&
        !bankDetails.accountName &&
        !recipientNameNeeded &&
        !verifyingBank
      ) {
        handleVerifyBank(bankDetails);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [bankDetails.accountNumber, bankDetails.bankCode, bankDetails.accountName, recipientNameNeeded, verifyingBank, handleVerifyBank]);

  const refreshOnRampRequirement = useCallback(() => {
    const request = ++onRampRequest.current;
    setOnRampRequirement(null);
    getOnRampRequirement(fiatCurrency)
      .then((r) => { if (request === onRampRequest.current) setOnRampRequirement(r); })
      .catch(() => {
        // Unknown is not "blocked": the server checks again when the order is made.
        if (request === onRampRequest.current) setOnRampRequirement(null);
      });
  }, [fiatCurrency]);

  useEffect(() => {
    if (type !== "deposit") return;
    refreshOnRampRequirement();
  }, [type, refreshOnRampRequirement]);

  // Flow Handlers
  const handleDepositInitiate = async () => {
    if (!bankDetails.accountName) {
      toast.error("Please verify your refund bank account");
      return;
    }
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    // Minimums
    if (fiatCurrency === "NGN" && val < 1000) {
      toast.error("Minimum deposit is 1,000 NGN");
      return;
    }

    // Deposits carry no fee, so the whole amount converts. The floor is about the result
    // being worth delivering on-chain at all, not about covering a deduction.
    const estimatedUsdc = val / (rate || 1);
    if (estimatedUsdc <= 1) {
      toast.error("That amount is too small. Please enter a little more.");
      return;
    }

    // No allowance is spent on deposits — money arriving is not rationed. The verified identity
    // the provider requires is checked by initiateOnRamp (the form also holds Continue until it is).
    setLoading(true);
    try {
      // Chosen, not asked — see `Ramp.pickDepositNetwork` for why.
      const network = await pickDepositNetwork(estimatedUsdc, fiatCurrency);

      const res = await initiateOnRamp({
        amountFiat: val,
        userAddress,
        refundAccount: {
          institution: bankDetails.bankCode,
          accountIdentifier: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        },
        fiatCurrency,
        network: network as RampNetwork,
        accessToken: await freshToken(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDepositUnderReview(false);
      setOrder(res.order);
      setStep(2);
    } catch (err) {
      toast.error(parseFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Keep a binding quote in step with what the user has typed, so the payout shown while they
   * choose an amount is the payout the summary shows next — and the payout that settles.
   *
   * Step 1 used to multiply by the indicative display rate, which runs a spread better than any
   * payout: it advertised ₦5,557 on a withdrawal the summary then quoted at ₦5,547. Same number
   * on both screens now, because it is the same quote — carried through, not re-struck.
   *
   * Debounced, because each call strikes a real provider quote; only fired for an amount that
   * could actually be withdrawn.
   */
  useEffect(() => {
    if (type !== "withdraw" || step !== 1) return;

    const typed = parseFloat(amount);
    if (!Number.isFinite(typed) || typed <= 0) {
      setLiveQuote(null);
      return;
    }
    // In USDC mode the input IS the base. In fiat mode the payout is the target the user typed,
    // so there is nothing to estimate — `solveForFiatTarget` sizes the USDC at Get Quote time.
    if (inputMode === "fiat") {
      setLiveQuote(null);
      return;
    }
    if (typed < 1) {
      setLiveQuote(null);
      return;
    }

    let cancelled = false;
    setLiveQuoteLoading(true);
    const id = setTimeout(() => {
      getOffRampQuote(typed, fiatCurrency, withdrawChain)
        .then((q) => {
          if (!cancelled) setLiveQuote({ ...q, forAmountUsdc: typed });
        })
        .catch(() => {
          if (!cancelled) setLiveQuote(null);
        })
        .finally(() => {
          if (!cancelled) setLiveQuoteLoading(false);
        });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(id);
      setLiveQuoteLoading(false);
    };
  }, [type, step, amount, inputMode, fiatCurrency, withdrawChain]);

  /**
   * What this withdrawal actually costs, benefits included.
   *
   * Every balance check and every displayed total goes through this. Using the raw rate
   * anywhere would tell a referee inside their fee-free allowance that they cannot afford a
   * withdrawal they can in fact make for nothing — which is exactly the audience the
   * allowance exists for.
   */
  const feeBreakdown = useCallback(
    (base: number) =>
      applyBenefits({ volumeUsdc: base, feePercent, balances: benefits }),
    [feePercent, benefits],
  );

  const totalRequired = useCallback(
    (base: number) => base + feeBreakdown(base).feeUsdc + corridorFee,
    [feeBreakdown, corridorFee],
  );

  const handleWithdrawQuote = async () => {
    if (!feesLoaded) {
      toast.error("Still loading the fees for this destination. Please try again in a moment.");
      return;
    }
    const typed = parseFloat(amount);
    let val = typed;

    if (inputMode === "fiat") {
      if (!rate) {
        toast.error("Exchange rate not available yet");
        return;
      }
      // Only to size the balance check and routing below. The real amount comes from solving
      // against the provider's own quote once the settlement chain is known — dividing by this
      // display rate is exactly what made a 5,000 request pay out less than 5,000.
      //
      // Padded, because the solved amount is almost always a little HIGHER than this estimate
      // (the display rate is the optimistic one). Routing on the bare estimate could pick a
      // chain — or bridge an amount — that the real figure then does not fit into.
      val = (typed / rate) * FIAT_ROUTING_PAD;
    }

    if (isNaN(val) || val < 1) {
      toast.error("That amount is too small to withdraw. Please enter a little more.");
      return;
    }

    // Include the platform fee (provider-specific) in the balance check — the input is the
    // base, so the fee is added on top of it.
    // base + our platform fee + the provider's corridor fee — all three leave the user's
    // wallet, so all three must be covered before we route or bridge anything.
    const totalUsdcRequired = totalRequired(val);

    // The spinner starts here, before the first slow call.
    //
    // Everything above is synchronous validation. Everything below it — the KYC lookup, the
    // balance reads, the quote — takes a round trip, and until now none of it moved the button.
    // The user got no feedback for a second or more and reasonably concluded the tap had missed,
    // so they tapped again. The `finally` is what makes this safe: every early return below
    // (limit reached, insufficient balance, unpriceable amount) has to clear it.
    setLoading(true);
    try {
      // Early KYC & Limit Pre-Check — block immediately at step 1 before bank details, 2FA, or signing.
      //
      // Checked on `val`, the amount the user asked to withdraw, NOT on totalUsdcRequired. The
      // allowance counts `withdrawals.amount_usdc`, which is the base — fees are recorded
      // separately. Passing the fee-inclusive figure would measure the request against a total it
      // will never be added to, and refuse a withdrawal of exactly 100 because 100.60 > 100.
      try {
        const { checkKycLimitAction } = await import("@/lib/kyc/guard");
        const guard = await checkKycLimitAction(val, await freshToken());
        if (!guard.allowed) {
          setKycBlock({
            message: guard.message,
            allowanceUsed: guard.allowanceUsed,
            allowanceRemaining: guard.allowanceRemaining,
            allowanceTotal: guard.allowanceTotal,
          });
          return;
        }
      } catch (err) {
        console.error("[Withdraw] Early KYC check error:", err);
      }

      // A Paycrest order settles on one network, so we must source the whole amount from
      // a single Paycrest-supported chain. Route to one that holds enough.
      const routeBalances: ChainBalances & { solana?: number; stellar?: number } = {
        ...(chainBalances && Object.keys(chainBalances).length > 0
          ? chainBalances
          : { base: parseFloat(balance) || 0 }),
        solana: solanaSource?.balance ?? 0,
        stellar: stellarBalance ?? 0,
      };

      const route = planWithdrawalRoute(totalUsdcRequired.toFixed(6), routeBalances, {
        supportedChains: rampNetworks,
        homeChain: "base",
        source: sourcePref,
      });

      // `routeBalances` already carries Solana and Stellar, so the route's total includes them.
      // Adding them again counted both twice and let an underfunded withdrawal through to a
      // consolidation that could never gather enough.
      const combinedAvailable = route.totalAvailable;

      // Settling directly on Solana is a distinct path: funds must already be on Solana (no
      // bridging TO Solana), and the payout is a Solana SPL transfer — not an EVM route.
      const isSolanaSettlement = sourcePref.mode === "single" && sourcePref.chain === "solana";

      // Validate a manual override before proceeding (Solana is validated separately below).
      //
      // `needsConsolidation` is not a failure here: it means the chosen chain holds the money
      // but cannot settle fiat, so the route bridges it to one that can. Only a route that is
      // neither directly payable nor bridgeable is a genuine shortfall.
      if (
        sourcePref.mode === "single" &&
        !isSolanaSettlement &&
        !route.feasible &&
        !route.needsConsolidation
      ) {
        toast.error(
          `The balance you picked doesn't hold enough to withdraw ${totalUsdcRequired.toFixed(2)} USDC.`,
        );
        return;
      }
      if (sourcePref.mode === "consolidate") {
        const selSum = sourcePref.from.reduce(
          (s, c) => {
            if (c === "solana") return s + (solanaSource?.balance ?? 0);
            if (c === "stellar") return s + (stellarBalance ?? 0);
            return s + (routeBalances[c] ?? 0);
          },
          0,
        );
        if (selSum + 1e-9 < totalUsdcRequired) {
          toast.error(
            `The balances you picked hold $${selSum.toFixed(2)}, but this needs ${totalUsdcRequired.toFixed(2)} USDC.`,
          );
          return;
        }
      }

      // The chain this withdrawal will settle on. Tracked locally as well as in state because
      // the quote below needs it in this same tick — `withdrawChain` does not update until the
      // next render, and quoting the wrong chain quotes the wrong price.
      let settlementChain: RampNetwork = withdrawChain;

      if (isSolanaSettlement) {
        // Settle on Solana — requires enough USDC already on Solana; no consolidation.
        const solBal = solanaSource?.balance ?? 0;
        if (solBal + 1e-9 < totalUsdcRequired) {
          toast.error(
            `That balance holds $${solBal.toFixed(2)}, but this needs ${totalUsdcRequired.toFixed(2)} USDC.`,
          );
          return;
        }
        if (!solanaSource?.settleOffRamp) {
          toast.error("Your wallet is still loading. Please try again in a moment.");
          return;
        }
        settlementChain = "solana";
        setWithdrawChain("solana");
        setMustConsolidate(false);
        setConsolidateFrom(null);
      } else if (route.feasible && route.chain) {
        // A single supported chain holds enough — source straight from it.
        settlementChain = route.chain as RampNetwork;
        setWithdrawChain(settlementChain);
        setMustConsolidate(false);
        setConsolidateFrom(null);
      } else if (
        route.needsConsolidation ||
        combinedAvailable + 1e-9 >= totalUsdcRequired
      ) {
        const targetChain = route.chain ?? "base";
        settlementChain = targetChain as RampNetwork;
        setWithdrawChain(settlementChain);
        setMustConsolidate(true);
        setConsolidateFrom(route.consolidateFrom ?? null);
      } else {
        toast.error(
          `Insufficient balance. Requires ${totalUsdcRequired.toFixed(2)} USDC`,
        );
        return;
      }

      if (inputMode === "fiat") {
        // The user named what the RECIPIENT must receive. Solve for the USDC that delivers it
        // at the provider's own rate, rather than converting at the display rate and hoping.
        const solved = await getOffRampQuoteForFiat(typed, fiatCurrency, settlementChain);
        if (!solved) {
          toast.error("Couldn't price that amount right now. Please try again.");
          return;
        }
        if (!solved.meetsTarget) {
          // Say so rather than quietly settling for less than was asked for.
          toast.error(
            `We can't reach ${getCurrencySymbol(fiatCurrency)}${typed.toLocaleString()} ` +
              `${fiatCurrency} right now — the best available is ` +
              `${getCurrencySymbol(fiatCurrency)}${solved.payoutAmount.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}.`,
          );
        }
        setQuoteUsdcAmount(solved.amountUsdc.toFixed(6));
        setQuote(solved);
        setStep(2);
        return;
      }

      // USDC mode: the input is the base. Reuse the quote already struck for this exact amount
      // on step 1 — that is what makes the two screens agree by construction, not coincidence.
      setQuoteUsdcAmount(val.toFixed(6));
      const reusable =
        liveQuote && Math.abs(liveQuote.forAmountUsdc - val) < 1e-9 ? liveQuote : null;
      setQuote(reusable ?? (await getOffRampQuote(val, fiatCurrency, settlementChain)));
      setStep(2);
    } catch (err) {
      toast.error(parseFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawFinalize = async () => {
    if (!bankDetails.accountName) {
      toast.error("Please verify destination account");
      return;
    }

    const amountUsdc = parseFloat(quoteUsdcAmount);

    // Total amount that will be deducted including the platform fee (provider-specific).
    const totalUsdcRequired = totalRequired(amountUsdc);

    if (totalUsdcRequired >= twoFaThreshold) {
      if (!twoFaEnabled) {
        toast.error(
          `Withdrawals over ${twoFaThreshold} USDC require 2FA. Please enable it in Settings.`,
        );
        return;
      }

      // 2FA Required - open modal without sending OTP
      setTwoFaModalOpen(true);
      return;
    }

    await authorizeAndWithdraw();
  };

  /**
   * Take the PIN, then run the withdrawal.
   *
   * Asked BEFORE the consolidation step inside executeWithdrawalActual, not after it. When a
   * balance is spread across networks that step bridges funds onto the settlement chain, which
   * is slow and costs real money — so it must be something the user approved, not something
   * that happens while they are still deciding. The authorisation is minted with a longer life
   * for exactly this reason; see AUTHORIZATION_TTL_MS in lib/security/transaction-auth.ts.
   */
  const authorizeAndWithdraw = async () => {
    const amountUsdc = parseFloat(quoteUsdcAmount);
    const totalUsdcRequired = totalRequired(amountUsdc);
    const payout = quote?.payoutAmount;

    const plan = describeWithdrawal({
      amountLabel: payout
        ? `${payout.toLocaleString()} ${fiatCurrency}`
        : `${amountUsdc.toFixed(2)} USDC`,
      bankLabel: bankDetails.accountName || bankDetails.accountNumber,
      settlementChain: withdrawChain,
      // Only the networks this withdrawal will actually pull from, taken from the same
      // selection the consolidation step runs — so "you'll confirm twice" stays true when
      // the balance is split, and stays absent when it is not.
      gatherFrom: mustConsolidate
        ? selectConsolidationSources({
            targetChain: withdrawChain as SupportedChain | "stellar" | "solana",
            requiredAmount: totalUsdcRequired.toFixed(6),
            balances: chainBalances ?? {},
            solanaBalance: solanaSource?.balance,
            stellarBalance,
          }).map((source) => source.chain as string)
        : [],
    });

    const authorization = await authorize({
      purpose: "withdrawal",
      payload: {
        destination: bankDetails.accountNumber,
        amount: amountUsdc,
        chain: withdrawChain,
      },
      // The headline is what LANDS in the bank, because that is the number someone set out to
      // achieve. What it costs them is a row below, where it is still impossible to miss.
      amount: payout
        ? `${payout.toLocaleString()} ${fiatCurrency}`
        : `${amountUsdc.toFixed(2)} USDC`,
      destination: [bankDetails.accountName, bankDetails.bankName || bankDetails.bankCode]
        .filter(Boolean)
        .join(" · "),
      warning: "Cannot be recalled once it reaches your bank.",
      details: [
        { label: "Account", value: bankDetails.accountNumber },
        { label: "Total deducted", value: `${totalUsdcRequired.toFixed(2)} USDC` },
      ],
      plan,
      confirmLabel: "Withdraw",
    });

    if (!authorization) return;

    setActivePlan(plan);
    setActiveStep(0);
    await executeWithdrawalActual(authorization);
  };

  const handleTwoFaSubmit = async (
    code: string,
    method?: "email" | "totp" | "passkey",
  ) => {
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      let res;

      if (method === "passkey") {
        // Passkey is already verified, just proceed with the actual withdrawal
        setTwoFaModalOpen(false);
        await authorizeAndWithdraw();
        return;
      }

      if (method === "totp") {
        // Use TOTP verification endpoint
        res = await fetch("/api/2fa/totp/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: code,
            method: "totp",
          }),
        });
      } else {
        // Use email OTP verification endpoint
        if (!twoFaOtpId) return;
        res = await fetch("/api/2fa/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail,
            otp_id: twoFaOtpId,
            otp_code: code,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");

      setTwoFaModalOpen(false);
      setTwoFaOtpId(null);
      await authorizeAndWithdraw();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Invalid code";
      setTwoFaError(errorMessage);
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleTwoFaResend = async () => {
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      const amountUsdc = parseFloat(quoteUsdcAmount);
      const res = await fetch("/api/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          actionType: "withdrawal",
          payload: {
            amountUsdc,
            accountNumber: bankDetails.accountNumber,
            bankCode: bankDetails.bankCode,
            fiatCurrency,
            fiatAmount: quote?.payoutAmount,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend code");
      setTwoFaOtpId(data.otp_id);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to resend code";
      setTwoFaError(errorMessage);
    } finally {
      setTwoFaLoading(false);
    }
  };

  const executeWithdrawalActual = async (authorization: string) => {
    if (!bankDetails.accountName) {
      toast.error("Please verify destination account");
      return;
    }
    setLoading(true);
    try {
      // Auto-consolidate onto the SETTLEMENT chain first when funds are split across chains.
      // Done before creating the off-ramp order so the order's transfer window starts fresh.
      if (mustConsolidate && embeddedProvider) {
        const targetChain = withdrawChain as SupportedChain | "stellar" | "solana";
        // Bring over base + platform fee + corridor fee. Each is a separate outflow from this
        // chain, so consolidating only the base strands the withdrawal a fee short — and after
        // a CCTP bridge, which is slow and not worth repeating.
        const required = (
          totalRequired(parseFloat(quoteUsdcAmount))
        ).toFixed(6);
        // Honour the user's chosen networks (if any); otherwise pull from everything.
        const allBalances: ChainBalances & { solana?: number; stellar?: number } = {
          ...(chainBalances ?? {}),
          solana: solanaSource?.balance ?? 0,
          stellar: stellarBalance ?? 0,
        };
        const sourceBalances: ChainBalances & { solana?: number; stellar?: number } = consolidateFrom
          ? Object.fromEntries(
              (Object.keys(allBalances) as (keyof typeof allBalances)[])
                .filter((c) => consolidateFrom.includes(c as SourceChainKey))
                .map((c) => [c, allBalances[c]]),
            )
          : allBalances;
        const includeSolana = consolidateFrom
          ? consolidateFrom.includes("solana")
          : true;
        const includeStellar = consolidateFrom
          ? consolidateFrom.includes("stellar")
          : true;
        const stellarSource = stellarSourceFor(
          { walletId: stellarWalletId, address: stellarAddress },
          stellarBalance,
          embeddedProvider,
        );
        // Moving USDC between networks to fund the payout is our problem, not the user's.
        // They asked to be paid; the mechanics carry no meaning for them and naming chains here
        // only invites "what is Arbitrum and why is my money on it?".
        toast.loading("Preparing your withdrawal…", { id: "consolidate" });
        await consolidateFundsToChain(embeddedProvider, {
          targetChain,
          requiredAmount: required,
          balances: sourceBalances,
          recipient: userAddress,
          stellarRecipient: stellarAddress,
          solana: includeSolana ? solanaSource : undefined,
          stellar: includeStellar ? stellarSource : undefined,
          // Where to DELIVER when the withdrawal settles on Stellar or Solana. Passed
          // unconditionally: the source objects above are absent when that chain is the
          // target, which is exactly when delivery needs them.
          stellarWallet:
            stellarWalletId && stellarAddress
              ? { walletId: stellarWalletId, address: stellarAddress }
              : null,
          // Solana is not wired here: this hook never receives a Solana address, and
          // `solanaRecipient` is likewise unset, so a consolidation TO Solana has nowhere to
          // deliver. It now fails loudly in `bridgeAndDeliver` instead of reporting a move
          // that did not happen. Solana withdrawals settle directly on Solana and do not take
          // this path.
          solanaWallet: null,
          // Deliberately not surfaced: these read "Moving funds from Arbitrum to Base…".
          onStatus: undefined,
          // Pinned, not advanced per source: `onSourceStart` emits the source index, and every
          // source now belongs to the same single gather step. Forwarding it would march the
          // tracker on while the gathering was still running.
          onSourceStart: () => setActiveStep(0),
        });
        toast.dismiss("consolidate");
      }

      // Gathering done; the step the user confirms next is the settlement itself.
      setActiveStep((current) => current + 1);

      // Submit via the pinned-provider flow using the CANONICAL bank identity (name, not
      // a raw code). executeOffRamp resolves the right bank_code per provider and falls
      // back (re-resolving) if the first provider can't create the order.
      const { order: res } = await executeOffRamp({
        amountUsdc: parseFloat(quoteUsdcAmount),
        fiatAmount: inputMode === "fiat" ? parseFloat(amount) : quote?.payoutAmount,
        exchangeRate: quote?.rate,
        inputMode,
        bank: {
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
          bankName: bankDetails.bankName || bankDetails.bankCode,
          bankCode: bankDetails.bankCode,
          memo: bankDetails.memo,
        },
        userRefundAddress: userAddress,
        fiatCurrency,
        // The country the user picked, so the corridor is built for it rather than for
        // whichever country the provider lists first under this currency.
        payoutCountry: payoutCountry ?? undefined,
        network: withdrawChain,
        consolidated: mustConsolidate,
        accessToken: await freshToken(),
        // Settle on the quote the user just reviewed rather than a freshly struck one.
        quoteId: quote?.quoteId,
        quoteReference: quote?.reference,
        quotedBy: quote?.provider,
        // What the review screen charged. A fallback provider that costs more is not used.
        confirmedFeePercent: feePercent,
        confirmedCorridorFee: corridorFee,
        // Refused by the action without this. The server re-derives the hash from the
        // amount, account number and chain it is about to act on, so a token minted for a
        // different account or a different figure does not open this door.
        authorization,
      });
      setOrder(res);

      // Adopt the order's own quoted payout as THE figure from here on. It is what the ledger
      // just recorded and what the provider will pay, so the confirm screen and the receipt
      // now show the same number the beneficiary receives. Normally identical to the reviewed
      // quote (it is the same quote); it differs only when that quote had to be re-struck.
      const quotedFiat = Number(res.fiatAmount);
      const switchedProvider = !!quote?.provider && quote.provider !== res.provider;
      if (res.fiatAmount != null && Number.isFinite(quotedFiat) && quotedFiat > 0) {
        const previous = quote?.payoutAmount;
        setQuote((q) => ({
          ...(q ?? {}),
          rate: res.fiatRate ?? q?.rate ?? quotedFiat / parseFloat(quoteUsdcAmount),
          payoutAmount: quotedFiat,
          binding: true,
          provider: res.provider,
        }));
        // The figure moved — a re-struck quote, or a fallback provider with its own price. The
        // summary on screen picks up the new number on this same render, so the user sees the
        // real amount without another press; the note just says why it differs.
        setPayoutAdjusted(
          previous != null && Math.abs(previous - quotedFiat) > 0.01
            ? { from: previous, reason: switchedProvider ? "provider" : "rate" }
            : null,
        );
      } else if (switchedProvider) {
        // A settling provider that states no payout figure: better to show nothing than the
        // price of a provider that is not paying. The receipt fills in on settlement.
        setQuote((q) => (q ? { ...q, binding: false, provider: res.provider } : q));
        setPayoutAdjusted(null);
      } else {
        setPayoutAdjusted(null);
      }

      // Straight through to the transfer. The review screen is the single authorisation point,
      // so there is no second confirmation here — the order is passed directly rather than read
      // back from state, which would still be null on this tick.
      setStep(3);
      await executeTransfer(res);
    } catch (err) {
      toast.dismiss("consolidate");
      toast.error(parseFriendlyError(err));
    } finally {
      setActivePlan(null);
      setActiveStep(0);
      setLoading(false);
    }
  };

  /**
   * Move the USDC. Takes the order directly so it can run in the SAME tick the order was
   * created in — the withdrawal is authorised once, at review, and then carries through to the
   * transfer without a second press. Falls back to the order in state when called with nothing.
   */
  /**
   * The settlement chain's balance, read now rather than from the query cache.
   *
   * Only called on the path that is about to move money, so one extra round trip is worth it:
   * the alternative is refusing a withdrawal because a cache has not caught up with a bridge
   * that finished seconds ago.
   */
  const readSettlementBalance = async (
    chain: string,
    fallback: number,
  ): Promise<number> => {
    try {
      // EVM only: Solana and Stellar balances come from sources that are already read live,
      // so neither goes stale behind a bridge the way the EVM query cache does.
      if (chain === "solana" || chain === "stellar") return fallback;

      const params = new URLSearchParams({ address: userAddress });
      if (stellarAddress) params.set("stellarAddress", stellarAddress);

      const res = await fetch(`/api/balances/cross-chain?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return fallback;

      const rows = (await res.json()) as { chain: string; balance: string }[];
      const row = Array.isArray(rows)
        ? rows.find((r) => r.chain?.toLowerCase() === chain.toLowerCase())
        : undefined;
      const live = row ? parseFloat(row.balance) : NaN;

      if (!Number.isFinite(live)) return fallback;
      // The higher of the two: a read that lags the chain should never veto a withdrawal the
      // cached figure already supports.
      return Math.max(live, fallback);
    } catch {
      return fallback;
    }
  };

  const executeTransfer = async (orderOverride?: RampOrderResponse) => {
    const activeOrder = orderOverride ?? order;
    const receiveAddress = activeOrder?.providerAccount?.receiveAddress;
    if (!activeOrder || !receiveAddress) return;
    setTransferError(null);

    const settlementChain = (activeOrder.providerAccount?.network ?? withdrawChain) as string;
    const baseAmount = parseFloat(quoteUsdcAmount);
    // Fee is resolved server-side and embedded in the order: `onchain` collection carries a
    // treasury address (we route the fee there ourselves); `provider` collection is skimmed by
    // the provider (we just send base + fee to its single receive address).
    const fee = activeOrder.fee;
    const onchainFee =
      fee?.collection === "onchain" && fee.address && parseFloat(fee.usdc) > 0
        ? { address: fee.address, usdc: fee.usdc }
        : null;

    // Last balance check before any money moves. The earlier checks use our own corridor-fee
    // config; this one uses the fee the order actually came back with, so a config drift can't
    // leave an orphan payout parked in `pending_address_deposit` after a failed transfer.
    const totalToSend =
      parseFloat(baseAmount.toFixed(6)) +
      parseFloat(activeOrder.providerFee || "0") +
      (fee ? parseFloat(fee.usdc) : 0);

    const cachedOnChain =
      settlementChain === "solana"
        ? (solanaSource?.balance ?? 0)
        : settlementChain === "stellar"
          ? stellarBalance
          : (chainBalances?.[settlementChain as SupportedChain] ?? (parseFloat(balance) || 0));

    // Read the balance fresh rather than trusting the cached one.
    //
    // `chainBalances` is a prop, fed by a react-query cache that was populated before this
    // withdrawal started. When the withdrawal consolidated first — bridging from other chains
    // onto the settlement chain — that cache still holds the PRE-BRIDGE figure, so this check
    // refuses a withdrawal whose funds have already arrived. That is the "Not enough balance"
    // a user sees right after a bridge, and why pressing Try Again works: by then the cache has
    // caught up.
    //
    // Falls back to the cached value if the read fails: a flaky balance endpoint must not block
    // a withdrawal that would otherwise go through.
    const availableOnChain = await readSettlementBalance(settlementChain, cachedOnChain);

    if (availableOnChain + 1e-9 < totalToSend) {
      console.error("[Withdraw] insufficient balance — withdrawal not submitted");
      const msg = "Not enough balance to complete this withdrawal.";
      toast.error(msg);
      setTransferError(msg);
      return;
    }

    setTransferring(true);
    try {
      let txHash: string;

      if (settlementChain === "solana") {
        // Settle directly on Solana: sponsored SPL transfer(s) — payout (+ fee) in one tx.
        if (!solanaSource?.settleOffRamp) {
          throw new Error("Your wallet isn't ready to settle this withdrawal yet. Please try again in a moment.");
        }
        const providerFee = parseFloat(activeOrder.providerFee || "0");
        const payoutDeposit = baseAmount + providerFee;
        txHash = await solanaSource.settleOffRamp({
          payoutAddress: receiveAddress,
          // A provider-collected fee rides to the same address as the payout — as on EVM. It
          // used to be dropped here, so the provider was sent less than it was owed.
          payoutAmount: (onchainFee || !fee
            ? payoutDeposit
            : payoutDeposit + parseFloat(fee.usdc)
          ).toFixed(6),
          feeAddress: onchainFee?.address,
          feeAmount: onchainFee?.usdc,
          // The server records the signature on this withdrawal the moment it broadcasts.
          withdrawalOrderId: activeOrder.id,
          onStatus: undefined,
        });
        toast.dismiss("wd-settle");
      } else if (settlementChain === "stellar") {
        // Settle directly on Stellar: fee-bumped payment — payout (+ fee) directly to Bitnob.
        if (!stellarAddress || !stellarWalletId) {
          throw new Error("Your wallet isn't ready to settle this withdrawal yet. Please try again in a moment.");
        }
        // Brails gives every customer the same Stellar address and tells deposits apart by memo.
        // Without one the money would arrive unattributed — so never send it.
        if (activeOrder.provider === "brails" && !activeOrder.providerAccount?.memo) {
          throw new Error("This withdrawal is missing its payment reference. Nothing was sent — please start it again.");
        }
        const providerFee = parseFloat(activeOrder.providerFee || "0");
        const payoutDeposit = baseAmount + providerFee;
        toast.loading(`Sending ${payoutAmountText()} to ${payoutTo()}…`, { id: "wd-settle" });

        const res = await fetch("/api/stellar/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletId: stellarWalletId,
            senderAddress: stellarAddress,
            recipientAddress: receiveAddress,
            amount: payoutDeposit.toFixed(6),
            // A provider that shares one Stellar address across users (Brails) tells deposits
            // apart by memo; without it the money arrives but cannot be matched to this payout.
            ...(activeOrder.providerAccount?.memo ? { memo: activeOrder.providerAccount.memo } : {}),
            // The order's fee, same as the EVM and Solana branches — without it the route
            // prices this at the P2P transfer rate.
            feeAmount: onchainFee?.usdc ?? "0",
            // Lets the route record the hash server-side, so the deposit stays attributable to
            // this withdrawal even if this tab never comes back.
            withdrawalOrderId: activeOrder.id,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to submit Stellar withdrawal transaction.");
        // The route returns `txHash` (see app/api/stellar/send). Reading `hash` here left every
        // Stellar withdrawal with no hash at all: none was persisted, and the finalize call fell
        // back to matching on Bitnob's static Stellar address — which is shared by every payout.
        txHash = data.txHash;
        toast.dismiss("wd-settle");
      } else {
        if (!embeddedProvider) return;
        const provider = await embeddedProvider.getEthereumProvider();
        const evmChain = settlementChain as SupportedChain;

        const providerFee = parseFloat(activeOrder.providerFee || "0");
        const payoutDeposit = baseAmount + providerFee;

        if (onchainFee) {
          // One gasless UserOp: payout to the provider (including Bitnob rail fee) + fee to our treasury.
          txHash = await executeCircleGaslessBatchTransfer(
            provider,
            [
              { recipientAddress: receiveAddress, amountUSDC: payoutDeposit.toFixed(6) },
              { recipientAddress: onchainFee.address, amountUSDC: onchainFee.usdc },
            ],
            evmChain,
          );
        } else {
          // Provider-collected fee (or no fee): send base + fee to the single receive address.
          const total = fee ? payoutDeposit + parseFloat(fee.usdc) : payoutDeposit;
          txHash = await executeCircleGaslessTransfer(
            provider,
            receiveAddress,
            total.toFixed(6),
            evmChain,
          );
        }
      }

      setWithdrawalTxHash(txHash);
      if (activeOrder.id && txHash) {
        saveWithdrawalTxHash(activeOrder.id, txHash).catch(console.error);
      }
      if (activeOrder.provider === "bitnob" && activeOrder.providerRef) {
        const ref = activeOrder.providerRef;
        // Pass what identifies OUR deposit so the action can confirm the money actually
        // landed before releasing the payout — broadcasting a transfer is not receiving it.
        const depositAmount = baseAmount + parseFloat(activeOrder.providerFee || "0");

        if (activeOrder.deferredInitialize) {
          const deferredToken = await freshToken();
          // On this chain no payout exists yet: the beneficiary is attached only once this
          // deposit is verified, so this call is what creates it. If it fails, nothing pays
          // out — say so rather than leaving the user watching a spinner.
          import("@/lib/actions/ramp")
            .then(({ settleDeferredBitnobPayoutAction }) =>
              settleDeferredBitnobPayoutAction({
                quoteId: ref,
                orderId: activeOrder.id,
                txHash,
                requiredUsdc: depositAmount,
                network: settlementChain,
                fiatCurrency,
                bank: {
                  accountNumber: bankDetails.accountNumber,
                  accountName: bankDetails.accountName,
                  bankName: bankDetails.bankName || bankDetails.bankCode,
                  memo: bankDetails.memo,
                },
                // Fires after the transfer confirms, so the cookie has had the longest to go
                // stale — and a failure here strands the user's deposit with no payout.
                accessToken: deferredToken,
              }),
            )
            .then((res) => {
              if (!res?.ok) {
                toast.error(
                  `Your transfer arrived but the payout could not be created${res?.reason ? `: ${res.reason}` : ""}. Support can complete it.`,
                  { duration: 10000 },
                );
              }
            })
            .catch(console.error);
        } else {
          import("@/lib/actions/ramp").then(({ finalizeBitnobPayoutAction }) => {
            finalizeBitnobPayoutAction(ref, {
              address: receiveAddress,
              txHash,
              amountUsdc: depositAmount,
            });
          }).catch(console.error);
        }
      }
      toast.success(`Sending ${payoutAmountText()} to ${payoutTo()}…`);
      queryClient.invalidateQueries({ queryKey: ["balance", userAddress] });
      setStep(4);
      // Pass the order straight through — state has not flushed on this tick, and polling that
      // silently no-ops is what showed "Withdrawal Complete" the instant the transfer was sent.
      startPolling(activeOrder);
    } catch (err) {
      toast.dismiss("wd-settle");
      const msg = parseFriendlyError(err);
      toast.error(msg);
      setTransferError(msg);
    } finally {
      setTransferring(false);
    }
  };

  /**
   * Watch the order through to a terminal state. Takes the order directly for the same reason
   * `executeTransfer` does: it is started in the tick the order was created, when the `order`
   * state has not flushed yet. Reading it from state there saw `null` and returned early —
   * which never set `polling`, so the success screen rendered the moment the transfer was
   * broadcast, telling the user their money had arrived when the payout had not even started.
   */
  const startPolling = useCallback(
    (orderOverride?: RampOrderResponse) => {
    const activeOrder = orderOverride ?? order;
    if (!activeOrder?.id) return;
    // A retry starts clean: a stale failure flag would render the error view over a healthy run.
    setTxFailed(false);
    setPolling(true);
    const isWithdraw = type === "withdraw";
    const poll = async () => {
      try {
        // Our ledger is the second source of truth, and for Bitnob the ONLY one that turns
        // terminal: the webhook writes it, while provider polling stays `pending` because the
        // payout is not indexed under our order reference. Consulted alongside the provider so
        // "completed" means the fiat actually landed, however we came to know it.
        //
        // Fetched together, not one after the other. The ledger read is the fast one AND the
        // one that actually turns terminal for Bitnob, so making it queue behind a slow
        // provider call added that call's latency to every tick — which is how a push
        // notification (sent server-side the moment the webhook lands) beat this screen to the
        // news.
        const [result, ledger] = await Promise.all([
          isWithdraw
            ? getOrderStatus(activeOrder.id, activeOrder.provider)
            : getDepositStatus(activeOrder.id, activeOrder.provider),
          isWithdraw
            ? getLedgerOrderStatus(activeOrder.id, "withdrawal").catch(() => null)
            : Promise.resolve(null),
        ]);

        setTxStatus(ledger === "completed" ? "settled" : result.status);
        if ("underReview" in result && result.underReview) setDepositUnderReview(true);

        // Completion ONLY. `deposited` and `validated` mean the user's USDC arrived and passed
        // checks — the payout has not been made. Treating those as success is what told people
        // their money had landed while the bank transfer had not yet started; they are a
        // processing state and must keep the spinner up.
        const successStatuses = ["settled"];
        const failureStatuses = ["refunded", "expired", "failed", "refunding"];

        const isSuccess =
          successStatuses.includes(result.status) || ledger === "completed";
        const isFailure =
          failureStatuses.includes(result.status) ||
          (ledger != null && ["failed", "reversed"].includes(ledger));

        if (isSuccess || isFailure) {
          if (pollIntervalRef.current) {
            clearTimeout(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          pushListenerRef.current?.();
          pushListenerRef.current = null;
          setPolling(false);

          if (isSuccess) {
            if (isWithdraw) {
              // IMPORTANT: use reconcileOrderStatus (calls finalize_withdrawal_success RPC)
              // which atomically updates locked_balance. Do NOT call updateWithdrawalStatus() directly.
              // Skipped when the ledger is already terminal — the webhook ran that same RPC, and
              // re-driving it with a still-`pending` provider status would be a no-op anyway.
              if (ledger !== "completed") {
                reconcileOrderStatus(activeOrder.id, result.status, 'withdrawal').catch(console.error);
              }
              toast.success(`${payoutAmountText()} sent to ${payoutTo()}.`);

              // Offer to save the destination, unless it is already in their contacts.
              const exists = bankContacts.some(
                (c) => c.account_number === bankDetails.accountNumber,
              );
              if (!exists) {
                setShowSavePrompt(true);
              }

              queryClient.invalidateQueries({
                queryKey: ["balance", userAddress],
              });

              // The modal STAYS OPEN on completion. It used to close itself two seconds after a
              // withdrawal to a bank already in contacts, which is the common case — so the
              // success screen, the receipt and its download button flashed past and vanished
              // before they could be read. Completion is the one moment the user most wants to
              // look at: closing is now theirs to do, via the X or a click outside.
            } else {
              updateDepositStatus(activeOrder.id, "confirmed");
              // Try to capture settlement tx hash from Paycrest order status
              const settlementTxHash =
                result.txHash ||
                result.settlementTxHash ||
                result.transactionHash;
              if (settlementTxHash && activeOrder.id) {
                saveDepositTxHash(activeOrder.id, settlementTxHash).catch(
                  console.error,
                );
              }
              toast.success("Deposit complete. Your balance has been updated.");

              // Check if bank is already in contacts (for refund)
              const exists = bankContacts.some(
                (c) => c.account_number === bankDetails.accountNumber,
              );
              if (!exists) {
                setShowSavePrompt(true);
              }

              queryClient.invalidateQueries({
                queryKey: ["balance", userAddress],
              });
              setStep(3);
            }
          } else {
            if (isWithdraw) {
              // IMPORTANT: use reconcileOrderStatus (calls finalize_withdrawal_failed RPC)
              // which atomically refunds locked_balance → available_balance.
              reconcileOrderStatus(activeOrder.id, result.status, 'withdrawal').catch(console.error);
            } else {
              updateDepositStatus(activeOrder.id, "failed");
            }
            setTxFailed(true);
            // The provider's own status word ("reverted", "expired") means nothing to someone
            // watching for their money. Say what happened to them, not to the transaction.
            // This only runs after the USDC was sent, so a withdrawal's balance HAS changed — the
            // money is owed back, and saying "unchanged" told people it had vanished.
            toast.error(
              isWithdraw
                ? "That withdrawal didn't go through. Your money is safe and will be returned to your wallet."
                : result.refundReason === "payer_mismatch" || result.refundReason === "payer_unverified"
                  ? result.status === "refunding"
                    ? "Your payment is being sent back to the account it came from, because it wasn't paid from an account in your own name."
                    : "Your payment was sent back to the account it came from, because it wasn't paid from an account in your own name."
                  : result.status === "refunding"
                    ? "That deposit didn't go through. Your payment is being returned to you."
                    : result.status === "refunded"
                      ? "That deposit didn't go through. Your payment has been returned to you."
                      : "That deposit didn't go through. You have not been charged."
            );
          }
        }
      } catch {}
    };
    /**
     * Interval by age, not a flat 8 seconds.
     *
     * Most withdrawals settle within two minutes, so the first stretch is where the answer
     * almost always arrives — polling it every 8s meant up to 8 seconds of the user staring at
     * a spinner after the money had already landed. Tight early, then backing off so a slow
     * payout is not still being polled hard ten minutes later.
     */
    const startedAt = Date.now();
    const nextDelay = () => {
      const age = Date.now() - startedAt;
      if (age < 60_000) return 2000;
      if (age < 180_000) return 5000;
      return 10_000;
    };

    // Self-scheduling rather than setInterval: the gap has to change as the wait grows, and a
    // fixed interval can also stack calls when one poll outlives its own period.
    const tick = async () => {
      await poll();
      if (pollIntervalRef.current) {
        pollIntervalRef.current = setTimeout(tick, nextDelay());
      }
    };

    // Non-null marks the loop as live; `poll` clears it on a terminal status, which is what
    // stops `tick` rescheduling itself.
    pollIntervalRef.current = setTimeout(tick, nextDelay());
    void poll();

    /**
     * Second way to learn the same thing, racing the poll.
     *
     * The push is sent server-side the moment the provider webhook lands, so the device
     * usually knows before this screen does — which is why the notification arrived first.
     * The service worker relays it here (see public/sw.js) and we simply poll immediately
     * rather than waiting out the timer.
     *
     * It only ever triggers a read; the ledger still decides. So a spoofed or mistimed message
     * cannot mark a withdrawal complete, it can only make us ask sooner. Whichever source
     * learns first wins, and neither can be wrong on its own.
     */
    const onPush = (event: MessageEvent) => {
      if (event.data?.type !== "sendzz:push") return;
      const txId = event.data?.payload?.data?.transactionId;
      // A push about some other transaction is not news about this one.
      if (txId && activeOrder.id && txId !== activeOrder.id) return;
      if (pollIntervalRef.current) void poll();
    };
    navigator.serviceWorker?.addEventListener("message", onPush);
    pushListenerRef.current = () =>
      navigator.serviceWorker?.removeEventListener("message", onPush);
  }, [
    // The whole order, since the callback now falls back to it when called with no argument.
    order,
    type,
    bankContacts,
    queryClient,
    userAddress,
    bankDetails.accountNumber,
    // Both are read when the poll reports a terminal status, to name the amount and destination.
    payoutAmountText,
    payoutTo,
  ]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      pushListenerRef.current?.();
      pushListenerRef.current = null;
    };
  }, []);

  const refreshBankContacts = useCallback(async () => {
    if (userEmail) {
      const contacts = await getUserBankContacts().catch(() => []);
      setBankContacts(contacts);
    }
  }, [userEmail]);

  return {
    step,
    setStep,
    amount,
    setAmount,
    balance,
    inputMode,
    setInputMode,
    loading,
    error,
    fiatCurrency,
    setFiatCurrency,
    payoutCountry,
    setPayoutCountry,
    institutions,
    institutionsLoading,
    rate,
    rateLoading,
    bankDetails,
    setBankDetails,
    verifyingBank,
    order,
    quote,
    transferring,
    polling,
    txStatus,
    txFailed,
    withdrawalTxHash,
    bankContacts,
    countryContacts,
    showSavePrompt,
    setShowSavePrompt,
    quoteUsdcAmount,
    liveQuote,
    liveQuoteLoading,
    payoutAdjusted,
    transferError,
    /** Retry the transfer for the order that already exists — never create a second one. */
    retryTransfer: () => executeTransfer(),
    withdrawChain,
    mustConsolidate,
    sourcePref,
    setSourcePref,
    chainBalances: chainBalances ?? {},
    solanaBalance: solanaSource?.balance ?? 0,
    stellarBalance: stellarBalance ?? 0,
    offRampProvider,
    feePercent,
    // The provider's flat corridor fee in USDC. Exposed so the breakdown can show the SAME
    // total the wallet is actually debited — it is a third outflow alongside base + platform
    // fee, and leaving it out of "Total Deducted" understated every mobile-money withdrawal.
    corridorFee,
    // On-ramp (Paycrest) lands USDC on these chains; default Base.
    userEmail,
    userAddress,
    handleSelectContact,
    refreshBankContacts,
    handleDepositInitiate,
    handleWithdrawQuote,
    kycBlock,
    kycGatedNetworks,
    refreshKycGates,
    recipientNameNeeded,
    isContactGated,
    onRampRequirement,
    refreshOnRampRequirement,
    depositUnderReview,
    dismissKycBlock: () => setKycBlock(null),
    handleWithdrawFinalize,
    executeTransfer,
    startPolling,
    twoFaModalOpen,
    setTwoFaModalOpen,
    twoFaLoading,
    twoFaError,
    activePlan,
    activeStep,
    benefits,
    feeBreakdown,
    totalRequired,
    handleTwoFaSubmit,
    handleTwoFaResend,
    totpEnabled,
    passkeyEnabled,
    pinEnabled,
    handleSaveBankContact: async () => {
      try {
        await addBankContact({
          bankName: bankDetails.bankName,
          bankCode: bankDetails.bankCode,
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        });
        toast.success("Bank account saved!");
        setShowSavePrompt(false);
        getUserBankContacts()
          .then(setBankContacts)
          .catch(console.error);
        // Deliberately does NOT close on a withdrawal: saving the contact is a side errand, and
        // closing would take the receipt with it before the user had a chance to download it.
      } catch (err) {
        toast.error(parseFriendlyError(err));
      }
    },
    reset: () => {
      setStep(1);
      setAmount("");
      setOrder(null);
      setQuote(null);
      setLiveQuote(null);
      setPayoutAdjusted(null);
      setTransferError(null);
      setTxStatus(null);
      setPolling(false);
      setShowSavePrompt(false);
      setWithdrawChain("base");
      setMustConsolidate(false);
      setSourcePref(AUTO_SOURCE);
      setConsolidateFrom(null);
      setPayoutCountry(null);
      setBankDetails({
        accountNumber: "",
        bankCode: "",
        accountName: "",
        bankName: "",
      });
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      pushListenerRef.current?.();
      pushListenerRef.current = null;
    },
    goBack: () => {
      setStep((prev) => (prev > 1 ? prev - 1 : 1));
    },
    onClose,
  };
}

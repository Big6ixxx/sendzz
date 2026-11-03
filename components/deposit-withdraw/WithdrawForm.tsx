"use client";

import { SigningProgress } from "@/components/signing/SigningProgress";
import { maxWithdrawableBase } from "@/lib/referrals/benefit-math";
import { formatFiat, getCurrencySymbol } from "@/lib/currency-config";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Plus } from "lucide-react";
import { balanceOfChain, type SourceChainKey } from "@/lib/web3/routing";
import { BankSelector } from "./BankSelector";
import { DestinationPicker } from "./DestinationPicker";
import { SourceSelector } from "@/components/SourceSelector";
import { OrderAdvancedDetails } from "./OrderAdvancedDetails";
import { CHAIN_NAMES, type SupportedChain } from "@/lib/circle/gateway";
import {
  FIAT_ROUTING_PAD,
} from "@/lib/ramp/fees";
import { useDepositWithdraw } from "./useDepositWithdraw";
import { ReceiptActions } from "@/components/receipt/ReceiptActions";
import { ReceiptData } from "@/lib/receipt/types";
import { cn } from "@/lib/utils";
import { getCountryFlag } from "@/lib/currency-config";
import { useEffect, useMemo, useState } from "react";
import { KycRequiredModal } from "@/components/kyc/KycRequiredModal";
import { SettlementCountdown } from "./SettlementCountdown";
import { KycModal } from "@/components/kyc/KycModal";
import { AmountField, AsideFigure, AsideRows, FlowButton, FlowFrame, FlowLabel, FlowSteps, FlowSuccess, Notice } from "@/components/flow/ui";
import { Skeleton } from "@/components/ui/skeleton";

interface WithdrawFormProps {
  hook: ReturnType<typeof useDepositWithdraw>;
}

/**
 * A country's name from its ISO code, in the user's language where the browser supports it.
 *
 * Read from the platform rather than carried on the hook: the hook holds only the code, and
 * every browser this app supports ships the names. Falls back to the code itself.
 */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Phase = "recipient" | "amount";

const PHASE_LABELS = ["Who you're paying", "How much"];

export function WithdrawForm({ hook }: WithdrawFormProps) {
  // Which step is on screen. Local, not in the hook: it is a property of
  // this form's presentation, and the hook's `step` already owns the real transaction stages.
  const [phase, setPhase] = useState<Phase>("recipient");
  // Back to the country list. The bank list is per country, so a bank picked under the old one
  // goes with it.
  const clearDestination = () => {
    hook.setPayoutCountry(null);
    hook.setBankDetails({ accountNumber: "", bankCode: "", accountName: "", bankName: "" });
  };
  // Track whether user is typing in USD or their local fiat currency
  const [amountCurrency, setAmountCurrency] = useState<"usd" | "fiat">("usd");
  // Which withdrawal the user waved the save-contact offer away for. Keyed by order id so it
  // clears itself on the next withdrawal without needing a reset hook.
  const [saveDismissedFor, setSaveDismissedFor] = useState<string | null>(null);
  // Verification opened from the limit modal, so the user never leaves the withdrawal to do it.
  const [kycModalOpen, setKycModalOpen] = useState(false);

  // Networks the user must verify to use, marked in the list rather than hidden: hiding them
  // would make a corridor look unsupported when one step would open it.
  const gatedCodes = useMemo(() => new Set(hook.kycGatedNetworks), [hook.kycGatedNetworks]);
  const selectorInstitutions = useMemo(
    () =>
      hook.institutions.map((i) =>
        gatedCodes.has(i.institutionCode || i.code) ? { ...i, name: `${i.name} · verify ID to use` } : i,
      ),
    [hook.institutions, gatedCodes],
  );
  // Every network shown, not a count: the gated codes come from Brails' list and need not all be
  // among those displayed.
  const allNetworksGated =
    hook.institutions.length > 0 &&
    hook.institutions.every((i) => gatedCodes.has(i.institutionCode || i.code));

  const fiatSymbol = getCurrencySymbol(hook.fiatCurrency);
  const parsedAmount = parseFloat(hook.amount || "0");

  // Fee % is provider-specific — read from the hook, never hardcoded.
  const feePercent = hook.feePercent;

  // Derived: what the input value means in USDC (base, before fee)
  const usdcBase = (() => {
    if (!parsedAmount || !hook.rate) return 0;
    if (amountCurrency === "usd") return parsedAmount; // USD ≈ USDC 1:1
    return parsedAmount / hook.rate; // fiat → USDC
  })();

  // Total USDC that will be deducted — base + platform fee + the provider's corridor fee. All
  // three leave the wallet, and omitting the corridor fee here understated the deduction against
  // the summary's own "Total Deducted".
  const usdcTotal = hook.totalRequired(usdcBase);

  /**
   * The payout to advertise while the user is still choosing an amount.
   *
   * In fiat mode it is simply what they typed — that IS the target, and the quote is solved to
   * hit it. In USDC mode it comes from the binding quote struck for this exact amount; the
   * indicative rate is only a placeholder until that lands, because it prices a spread better
   * than any payout settles at and made this line disagree with the summary.
   */
  const liveQuoteMatches =
    hook.liveQuote != null &&
    amountCurrency === "usd" &&
    Math.abs(hook.liveQuote.forAmountUsdc - usdcBase) < 1e-9;
  const quotedPayout = liveQuoteMatches ? hook.liveQuote!.payoutAmount : null;

  // The full deduction (incl. fee) can't exceed the user's combined balance.
  const totalAvailable = parseFloat(hook.balance) || 0;

  /**
   * The largest base amount whose FULL deduction still fits the balance.
   *
   * This is the exact inverse of `usdcTotal` above — base + platform fee + corridor fee — so
   * "withdraw everything" means everything: the fees come out of the balance rather than
   * being stacked on top of it.
   *
   * It used to invert only the platform fee, which left MAX short by the corridor fee and made
   * the deduction exceed the balance. That excess was invisible until step 3, because the
   * pre-transfer check is the first place base, platform fee and corridor fee are added up
   * against the wallet — so the user got "Not enough balance" only after the quote existed.
   */
  const maxBaseUsdc = maxWithdrawableBase({
    availableUsdc: totalAvailable,
    feePercent,
    corridorFeeUsdc: hook.corridorFee,
    // A fee-free allowance raises the ceiling: less of the balance goes on fees, so more of
    // it can be withdrawn. Ignoring it here would offer a referee less than they can take.
    balances: hook.benefits,
  });

  const isOverBalance = parsedAmount > 0 && usdcTotal > totalAvailable + 1e-9;

  // What the user will receive in local fiat
  const fiatOut =
    amountCurrency === "usd" ? parsedAmount * (hook.rate || 0) : parsedAmount;

  const handleModeSwitch = (mode: "usd" | "fiat") => {
    if (mode === amountCurrency) return;
    // Convert current amount to the new currency
    if (hook.amount && parsedAmount && hook.rate) {
      if (mode === "usd") {
        // fiat → USD: fiat / rate
        hook.setAmount((parsedAmount / hook.rate).toFixed(2));
      } else {
        // USD → fiat: usd * rate
        hook.setAmount(Math.round(parsedAmount * hook.rate).toString());
      }
    }
    setAmountCurrency(mode);
    hook.setInputMode(mode === "fiat" ? "fiat" : "usdc");
  };

  /**
   * Round DOWN to `dp`. `toFixed` rounds half-up, so it could round the base UP and push the
   * total past the very balance it was derived from — a few cents over is still refused.
   */
  const floorTo = (n: number, dp: number) => Math.floor(n * 10 ** dp) / 10 ** dp;

  const handleMax = () => {
    if (!hook.rate || maxBaseUsdc <= 0) return;
    if (amountCurrency === "usd") {
      hook.setAmount(floorTo(maxBaseUsdc, 2).toFixed(2));
      hook.setInputMode("usdc");
    } else {
      // A typed fiat target is converted back to USDC at the indicative rate and padded before
      // routing, so the fiat max has to leave that same headroom. Without it, MAX in fiat mode
      // produced a figure ~1% over balance every single time.
      hook.setAmount(
        Math.floor((maxBaseUsdc / FIAT_ROUTING_PAD) * hook.rate).toString(),
      );
      hook.setInputMode("fiat");
    }
  };

  /**
   * Everything wrong with the amount, said at the amount field.
   *
   * These conditions were previously only reachable later — the minimum as a toast from the
   * quote handler, the balance ceiling as a bare button label, and the true shortfall not until
   * the pre-transfer check on step 3. Anything about the amount belongs where the amount is
   * typed, while it can still be corrected for free.
   */
  /**
   * Drop a manual source choice once the amount outgrows it.
   *
   * The source picker decides eligibility from the amount, but the CHOICE lives out here and
   * was never rechecked. So picking "Pay from Base" at 5 USDC and then typing 50 left the
   * preference pointing at a chain that no longer covers it — and Get Quote refused with
   * "Base doesn't hold enough", while the money sat on other chains that together did.
   *
   * Falling back to Automatic is the honest resolution: the user asked for an amount, and the
   * chain was a preference about how to fund it, not part of the request. It happens as they
   * type, so the picker visibly reads "Automatic" before they press anything, rather than
   * failing at the far end.
   */
  useEffect(() => {
    if (hook.sourcePref.mode === "auto" || !usdcTotal) return;

    const balOf = (c: SourceChainKey) =>
      balanceOfChain(c, hook.chainBalances ?? {}, hook.solanaBalance, hook.stellarBalance);

    const stillCovers =
      hook.sourcePref.mode === "single"
        ? balOf(hook.sourcePref.chain) + 1e-9 >= usdcTotal
        : hook.sourcePref.from.reduce((sum, c) => sum + balOf(c), 0) + 1e-9 >= usdcTotal;

    if (!stillCovers) hook.setSourcePref({ mode: "auto" });
  }, [
    usdcTotal,
    hook.sourcePref,
    hook.chainBalances,
    hook.solanaBalance,
    hook.stellarBalance,
    hook,
  ]);

  const amountError = (() => {
    if (!hook.amount || !hook.rate) return null;
    if (usdcBase < 1) return "Minimum transfer is 1 USDC equivalent.";
    if (isOverBalance) {
      const maxLabel =
        amountCurrency === "usd"
          ? `$${floorTo(maxBaseUsdc, 2).toFixed(2)}`
          : `${fiatSymbol}${Math.floor(
              (maxBaseUsdc / FIAT_ROUTING_PAD) * hook.rate,
            ).toLocaleString()}`;
      return `Fees come out of your balance, so the most you can withdraw is ${maxLabel}. Tap “Use max” to send it all.`;
    }
    return null;
  })();

  const prefix = amountCurrency === "usd" ? "$" : fiatSymbol;

  // Shown on the forest panel from the first step to the last, so who is paid never drops out.
  const recipientRows = [
    ...(hook.payoutCountry
      ? [{ label: "Country", value: `${getCountryFlag(hook.payoutCountry, hook.fiatCurrency)} ${countryName(hook.payoutCountry)}` }]
      : []),
    ...(hook.bankDetails.accountName ? [{ label: "To", value: hook.bankDetails.accountName }] : []),
    ...(hook.bankDetails.accountNumber && hook.bankDetails.accountName
      ? [
          {
            label: "Account",
            value: hook.bankDetails.bankName
              ? `${hook.bankDetails.bankName} · ${hook.bankDetails.accountNumber}`
              : hook.bankDetails.accountNumber,
          },
        ]
      : []),
  ];

  const backButton = (onClick: () => void, disabled?: boolean) => (
    <FlowButton tone="quiet" onClick={onClick} disabled={disabled} className="w-auto shrink-0 px-5" aria-label="Back">
      <ArrowLeft className="size-5" />
    </FlowButton>
  );

  if (hook.step === 1) {
    const modals = (
      <>
        {/* Refused for the allowance: explain it and offer the way out, in place. */}
        <KycRequiredModal block={hook.kycBlock} onClose={hook.dismissKycBlock} onVerify={() => setKycModalOpen(true)} />
        <KycModal
          isOpen={kycModalOpen}
          onClose={() => {
            setKycModalOpen(false);
            // Verification may have just finished: networks it unlocks should open up.
            hook.refreshKycGates();
          }}
          userEmail={hook.userEmail}
        />
      </>
    );

    if (phase === "recipient") {
      return (
        <FlowFrame
          main={
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <FlowSteps steps={PHASE_LABELS} current={0} />
              <p className="text-[15px] leading-[1.5] text-[var(--lp-body)]">
                {hook.payoutCountry
                  ? "Choose their bank or mobile money provider, then enter the account number."
                  : "Start with the country their account is in."}
              </p>

              {/* The bank list waits for the country: it is per country, and loading it first
                  meant fetching Nigeria by default for someone who had picked nothing. */}
              {hook.payoutCountry ? (
                <div className="lp-card flex items-center gap-3 rounded-[22px] px-4 py-3.5">
                  <span className="text-[26px] leading-none shrink-0" aria-hidden>
                    {getCountryFlag(hook.payoutCountry, hook.fiatCurrency)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{countryName(hook.payoutCountry)}</span>
                    <span className="block text-[13px] text-[var(--lp-muted)]">Pays out in {hook.fiatCurrency}</span>
                  </span>
                  <button
                    type="button"
                    onClick={clearDestination}
                    className="shrink-0 rounded-full px-3 py-1.5 text-[14px] font-semibold transition-colors hover:bg-[var(--lp-cream)]"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <DestinationPicker
                  onSelect={(country) => {
                    hook.setPayoutCountry(country.code);
                    hook.setFiatCurrency(country.currency);
                    // Cleared on purpose: an amount typed against one currency means something
                    // different against the next, and carrying it over silently re-prices it.
                    hook.setAmount("");
                  }}
                />
              )}

              {/* Every network here needs a verified sender: say so before they fill anything in. */}
              {hook.payoutCountry && allNetworksGated && (
                <Notice
                  tone="warning"
                  title={`Verify your identity to send to ${countryName(hook.payoutCountry)}`}
                  action={
                    <button
                      type="button"
                      onClick={() => setKycModalOpen(true)}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-4 text-[14px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
                    >
                      Verify identity <ArrowRight className="size-4" />
                    </button>
                  }
                >
                  Payouts here need a verified sender. It is a one-time check that usually takes a few minutes.
                </Notice>
              )}

              {hook.payoutCountry && (
                <BankSelector
                  label="Bank or mobile money"
                  institutions={selectorInstitutions}
                  selectedBankCode={hook.bankDetails.bankCode}
                  onSelect={(b) => {
                    // A network only a verified sender can use opens verification instead of
                    // being selected: no provider would take the order without it.
                    if (gatedCodes.has(b.code)) {
                      setKycModalOpen(true);
                      return;
                    }
                    const original = hook.institutions.find((i) => (i.institutionCode || i.code) === b.code);
                    hook.setBankDetails({ ...hook.bankDetails, bankCode: b.code, bankName: original?.name ?? b.name, accountName: "" });
                  }}
                  onSelectContact={(contact) => {
                    // Same gate as picking the network directly.
                    if (hook.isContactGated(contact)) {
                      setKycModalOpen(true);
                      return;
                    }
                    hook.handleSelectContact(contact);
                  }}
                  accountNumber={hook.bankDetails.accountNumber}
                  onAccountNumberChange={(val) => hook.setBankDetails({ ...hook.bankDetails, accountNumber: val, accountName: "" })}
                  accountName={hook.bankDetails.accountName}
                  recipientNameNeeded={hook.recipientNameNeeded}
                  onAccountNameChange={(val) => hook.setBankDetails({ ...hook.bankDetails, accountName: val })}
                  memo={hook.bankDetails.memo}
                  onMemoChange={(val) => hook.setBankDetails({ ...hook.bankDetails, memo: val })}
                  isVerifying={hook.verifyingBank}
                  contacts={hook.countryContacts}
                  userEmail={hook.userEmail}
                  fiatCurrency={hook.fiatCurrency}
                  onContactsChanged={hook.refreshBankContacts}
                />
              )}
              {modals}
            </div>
          }
          aside={
            <div className="space-y-6">
              <div>
                <p className="lp-mono text-[12px] uppercase text-[var(--lp-green)]">Sending to</p>
                <p className="lp-display mt-2 break-words text-[clamp(28px,7vw,36px)] leading-[1] tracking-[-0.035em]">
                  {hook.bankDetails.accountName || (hook.payoutCountry ? countryName(hook.payoutCountry) : "Someone new")}
                </p>
              </div>
              {recipientRows.length > 0 ? (
                <AsideRows rows={recipientRows} />
              ) : (
                <p className="text-[15px] leading-[1.5] text-[#a9c2b5]">Pick the country their account is in, and the details fill in here.</p>
              )}
            </div>
          }
          action={
            <div className="flex gap-2">
              {hook.payoutCountry && backButton(clearDestination)}
              <FlowButton
                tone="accent"
                onClick={() => setPhase("amount")}
                disabled={!hook.payoutCountry || !hook.bankDetails.accountName || hook.verifyingBank}
                className="flex-1"
              >
                Continue <ArrowRight className="size-5" />
              </FlowButton>
            </div>
          }
        />
      );
    }

    const hasMultipleSources =
      Object.values(hook.chainBalances).filter((b) => (b ?? 0) > 0).length + (hook.solanaBalance > 0 ? 1 : 0) + (hook.stellarBalance > 0 ? 1 : 0) > 1;

    return (
      <FlowFrame
        main={
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <FlowSteps steps={PHASE_LABELS} current={1} />

            <AmountField
              label={amountCurrency === "usd" ? "You send" : "They receive"}
              value={hook.amount}
              onChange={(v) => {
                hook.setAmount(v);
                hook.setInputMode(amountCurrency === "fiat" ? "fiat" : "usdc");
              }}
              symbol={prefix}
              placeholder={amountCurrency === "usd" ? "100.00" : "10,000"}
              currency={
                <div className="flex rounded-full bg-[var(--lp-cream)] p-1" role="group" aria-label="Enter the amount in">
                  {(["usd", "fiat"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => handleModeSwitch(mode)}
                      aria-pressed={amountCurrency === mode}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-[14px] font-semibold transition-colors duration-150",
                        amountCurrency === mode ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]" : "text-[var(--lp-body)]",
                      )}
                    >
                      {mode === "usd" ? "USD" : hook.fiatCurrency}
                    </button>
                  ))}
                </div>
              }
              footer={
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] text-[var(--lp-muted)]">
                    Balance <span className="font-semibold text-[var(--lp-ink)] tabular-nums">{hook.balance} USDC</span>
                  </span>
                  {parseFloat(hook.balance) > 0 && hook.rate && (
                    <button
                      type="button"
                      onClick={handleMax}
                      className="rounded-full bg-[var(--lp-cream)] px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-[#ece6da]"
                    >
                      Use max
                    </button>
                  )}
                </div>
              }
            />

            {/* Anything wrong with the amount, stated here rather than a step later. */}
            {amountError && <Notice tone="danger">{amountError}</Notice>}
            {!hook.rateLoading && !hook.rate && parsedAmount > 0 && (
              <Notice tone="warning" title="No rate right now">
                We can&apos;t price {hook.fiatCurrency} at the moment. Try again shortly.
              </Notice>
            )}

            {parsedAmount > 0 && hasMultipleSources && (
              <div className="space-y-2">
                <FlowLabel>Pay from</FlowLabel>
                <SourceSelector
                  balances={hook.chainBalances}
                  solanaBalance={hook.solanaBalance}
                  stellarBalance={hook.stellarBalance}
                  requiredAmount={usdcTotal}
                  allowConsolidate
                  value={hook.sourcePref}
                  onChange={hook.setSourcePref}
                />
              </div>
            )}
            {modals}
          </div>
        }
        aside={
          <div className="space-y-6">
            <AsideFigure
              label={hook.bankDetails.accountName ? `${hook.bankDetails.accountName.split(" ")[0]} receives` : "They receive"}
              value={
                hook.rateLoading ? (
                  <Skeleton tone="forest" className="inline-block h-11 w-44 rounded-[14px] align-middle" aria-label="Loading amount" />
                ) : (
                  <>
                    {/* No "≈" once the quote is binding: it is the figure that pays out. */}
                    {amountCurrency === "usd" && quotedPayout == null && parsedAmount > 0 ? "≈ " : ""}
                    {formatFiat(amountCurrency === "usd" ? (quotedPayout ?? fiatOut) : parsedAmount, hook.fiatCurrency, {
                      maximumFractionDigits: amountCurrency === "usd" && quotedPayout == null ? 0 : 2,
                    })}
                  </>
                )
              }
            />
            <AsideRows
              rows={[
                {
                  label: amountCurrency === "usd" ? "Deducted" : "Deducted (approx.)",
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      {usdcTotal.toFixed(2)} USDC
                      {hook.liveQuoteLoading && <Loader2 className="size-3.5 animate-spin" />}
                    </span>
                  ),
                },
                {
                  label: "Rate",
                  value: hook.rate ? `1 USDC = ${hook.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${hook.fiatCurrency}` : "—",
                },
                ...recipientRows.filter((r) => r.label !== "Country"),
              ]}
            />
            <p className="text-[14px] leading-[1.5] text-[#a9c2b5]">Fees come out of your balance, never out of what they receive.</p>
          </div>
        }
        action={
          <div className="flex gap-2">
            {backButton(() => setPhase("recipient"), hook.loading)}
            <FlowButton
              tone="accent"
              onClick={hook.handleWithdrawQuote}
              loading={hook.loading}
              disabled={hook.rateLoading || usdcBase < 1 || amountError != null}
              className="flex-1"
            >
              {isOverBalance ? "Not enough balance" : <>Review transfer <ArrowRight className="size-5" /></>}
            </FlowButton>
          </div>
        }
      />
    );
  }

  if (hook.step === 2 && hook.quote) {
    const base = parseFloat(hook.quoteUsdcAmount);
    // One fee line covering both what we charge and the provider's corridor fee: the user is
    // debited for both, so splitting them only invited "what is this second fee". The percentage
    // is shown only when the platform fee is the whole of it.
    const breakdown = hook.feeBreakdown(base);
    const charged = breakdown.feeUsdc + hook.corridorFee;
    const discounted = breakdown.waivedVolumeUsdc > 0 || breakdown.creditAppliedUsdc > 0;
    const wouldHaveBeen = breakdown.standardFeeUsdc + hook.corridorFee;
    const usdc = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`;

    return (
      <FlowFrame
        main={
          <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
            <button
              type="button"
              onClick={hook.goBack}
              // Not while the withdrawal is being sent: going back then would let it be sent twice.
              disabled={hook.loading}
              className="lp-card inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors hover:text-[#00a857] disabled:pointer-events-none disabled:opacity-50"
            >
              <ArrowLeft className="size-4" /> Edit details
            </button>

            <div>
              <p className="lp-display text-[clamp(24px,6vw,30px)] font-semibold leading-tight tracking-[-0.03em]">
                Check it <span className="lp-serif font-normal">over.</span>
              </p>
              <p className="mt-1 text-[15px] text-[var(--lp-muted)]">Once you press send, the money moves.</p>
            </div>

            {/* Read back, not re-asked: this is the last look before money moves. */}
            <dl className="lp-card rounded-[22px] px-5">
              {recipientRows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-[#ece6da] py-3.5 last:border-b-0">
                  <dt className="shrink-0 text-[14px] text-[var(--lp-muted)]">{r.label}</dt>
                  <dd className="min-w-0 break-words text-right text-[15px] font-semibold">{r.value}</dd>
                </div>
              ))}
            </dl>

            {hook.quote.binding === false && (
              <Notice title="The payout is an estimate">
                It&apos;s priced from the live rate. The final amount is confirmed before anything is sent.
              </Notice>
            )}
            {discounted && (
              <Notice tone="success" title="You're saving on this one">
                {breakdown.waivedVolumeUsdc > 0 && `${usdc(breakdown.waivedVolumeUsdc)} of this is inside your fee-free allowance. `}
                {breakdown.creditAppliedUsdc > 0 && `${usdc(breakdown.creditAppliedUsdc)} is covered by your referral credit.`}
              </Notice>
            )}

            {/* A withdrawal that has to gather funds first spends minutes here, bridging. This is
                where someone decides the app has frozen and starts pressing things. */}
            {hook.activePlan && hook.activePlan.steps.length > 1 && <SigningProgress plan={hook.activePlan} current={hook.activeStep} />}
          </div>
        }
        aside={
          <div className="space-y-6">
            <AsideFigure
              label={hook.quote.binding === false ? "They receive (est.)" : "They receive"}
              value={formatFiat(hook.quote.payoutAmount, hook.fiatCurrency)}
            />
            <AsideRows
              rows={[
                { label: "Rate", value: `1 USDC = ${hook.quote.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${hook.fiatCurrency}` },
                { label: "Amount", value: usdc(base) },
                {
                  label: hook.corridorFee > 0 ? "Fee" : `Fee (${feePercent}%)`,
                  value: (
                    <span className="inline-flex items-baseline gap-2">
                      {/* The old figure struck through, because a waived fee only persuades if the
                          user can see what it saved them. */}
                      {discounted && wouldHaveBeen > charged && (
                        <span className="text-[#a9c2b5] line-through">{wouldHaveBeen.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      )}
                      {charged === 0 ? "Free" : usdc(charged)}
                    </span>
                  ),
                  tone: discounted ? "good" : undefined,
                },
                { label: "Total deducted", value: usdc(hook.totalRequired(base)) },
              ]}
            />
          </div>
        }
        action={
          // The single authorisation point: this press creates the order AND sends the funds, so
          // it names the amount being authorised rather than a generic "confirm".
          <FlowButton tone="accent" onClick={hook.handleWithdrawFinalize} loading={hook.loading} disabled={!hook.bankDetails.accountName}>
            Send {formatFiat(hook.quote.payoutAmount, hook.fiatCurrency)}
          </FlowButton>
        }
      />
    );
  }

  // Step 3 — the withdrawal running. Not a confirmation gate: the review screen is the single
  // point of authorisation, and the transfer starts the moment the order exists. This keeps what
  // was authorised on screen while it settles, with the payout updated if the order came back
  // priced differently.
  if (hook.step === 3 && hook.order) {
    const payout = hook.quote?.payoutAmount;
    const network =
      CHAIN_NAMES[(hook.order.providerAccount?.network ?? hook.withdrawChain) as SupportedChain] ??
      hook.order.providerAccount?.network ??
      hook.withdrawChain;
    return (
      <FlowFrame
        main={
          <div className="space-y-6 text-center animate-in fade-in duration-300">
            <span
              className={cn(
                "mx-auto grid size-20 place-items-center rounded-full",
                hook.transferError ? "bg-[#a1462c]/10 text-[#a1462c]" : "lp-card",
              )}
            >
              {hook.transferError ? <AlertCircle className="size-9" /> : <Loader2 className="size-9 animate-spin" />}
            </span>
            <div>
              <h3 className="lp-display text-[clamp(28px,7vw,36px)] leading-[1] tracking-[-0.04em]">
                {hook.transferError ? (
                  <>
                    That didn&apos;t <span className="lp-serif">go through.</span>
                  </>
                ) : (
                  <>
                    Sending <span className="lp-serif">your money.</span>
                  </>
                )}
              </h3>
              <p className="mx-auto mt-3 max-w-[360px] text-[15px] leading-[1.5] text-[var(--lp-body)]">
                {hook.transferError ? hook.transferError : "Making sure it gets where it needs to go. Keep this open. Network fees are on us."}
              </p>
            </div>
            <div className="text-left">
              <OrderAdvancedDetails
                orderId={hook.order.id}
                network={hook.order.providerAccount?.network ?? hook.withdrawChain}
                receiveAddress={hook.order.providerAccount?.receiveAddress}
                consolidated={hook.mustConsolidate}
                validUntil={hook.order.providerAccount?.validUntil}
              />
            </div>
          </div>
        }
        aside={
          <div className="space-y-6">
            {payout != null && (
              <div>
                <AsideFigure label={`${hook.bankDetails.accountName?.split(" ")[0] || "They"} receive${hook.bankDetails.accountName ? "s" : ""}`} value={formatFiat(payout, hook.fiatCurrency)} />
                {/* The amount moved after the review was authorised. It is already updated above
                    and on the receipt; this only says why, so the change is never silent. */}
                {hook.payoutAdjusted && (
                  <p className="mt-2 text-[13px] text-[#f5c451]">
                    {hook.payoutAdjusted.reason === "provider" ? "Routed via another provider" : "Rate refreshed"}, updated from{" "}
                    {formatFiat(hook.payoutAdjusted.from, hook.fiatCurrency)}
                  </p>
                )}
              </div>
            )}
            <AsideRows
              rows={[
                { label: "Total deducted", value: `${hook.totalRequired(parseFloat(hook.quoteUsdcAmount)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC` },
                {
                  label: "To",
                  value: `${hook.bankDetails.bankName || hook.bankDetails.bankCode}${hook.bankDetails.accountNumber ? ` ····${hook.bankDetails.accountNumber.slice(-4)}` : ""}`,
                },
                { label: "Network", value: network },
              ]}
            />
          </div>
        }
        action={
          hook.transferError ? (
            // Retries the order that already exists. Nothing was sent, and the quote behind this
            // order is unchanged, so the amount shown is still the amount that will be paid.
            <FlowButton tone="accent" onClick={hook.retryTransfer} loading={hook.transferring}>
              Try again
            </FlowButton>
          ) : undefined
        }
      />
    );
  }

  if (hook.step === 4) {
    /**
     * Offer to save the destination whenever it is not already a contact.
     *
     * Derived from the contact list here rather than read from a flag set during status
     * polling: that flag was only ever assigned inside the polling success branch, so whether
     * the button appeared depended on which path noticed the withdrawal finish and on whether
     * the contact list had loaded by then. Reading the list at render time has no such timing.
     */
    const accountNumber = hook.bankDetails.accountNumber;
    const alreadySaved = hook.bankContacts.some((c) => c.account_number === accountNumber);
    const canSaveContact = !!accountNumber && !alreadySaved && saveDismissedFor !== (hook.order?.id ?? null);
    const details = (status: string) =>
      hook.order && (
        <div className="text-left">
          <OrderAdvancedDetails
            orderId={hook.order.id}
            network={hook.order.providerAccount?.network ?? hook.withdrawChain}
            receiveAddress={hook.order.providerAccount?.receiveAddress}
            consolidated={hook.mustConsolidate}
            status={status}
          />
        </div>
      );

    if (hook.polling) {
      return (
        <FlowFrame
          main={
            <div className="space-y-6 text-center animate-in fade-in duration-300">
              {/* The countdown replaces a spinner: two things turning at once, one measuring
                  nothing, is how a wait starts to look like a stall. */}
              <SettlementCountdown />
              <p className="text-[14px] capitalize text-[var(--lp-muted)]">Status: {(hook.txStatus || "pending").replace(/_/g, " ")}</p>
              {details(hook.txStatus || "Pending")}
            </div>
          }
          // The payout stays on screen from review to receipt: dropping it here made the amount
          // vanish and reappear mid-flow, which reads as a changed number.
          aside={
            hook.quote ? (
              <div className="space-y-6">
                <AsideFigure label="On its way" value={formatFiat(hook.quote.payoutAmount, hook.fiatCurrency)} />
                <AsideRows rows={recipientRows} />
              </div>
            ) : undefined
          }
        />
      );
    }

    /*
     * A withdrawal that did not go through. What they need to know is whether their money is
     * coming back, and that depends on whether it ever left: if the transfer went out we owe a
     * refund and say so; if it never did, their USDC is still theirs.
     */
    if (hook.txFailed) {
      return (
        <FlowFrame
          main={
            <div className="space-y-6 py-4 text-center animate-in fade-in duration-300">
              <span className="mx-auto grid size-20 place-items-center rounded-full bg-[#a1462c]/10 text-[#a1462c]">
                <AlertCircle className="size-9" />
              </span>
              <div>
                <h3 className="lp-display text-[clamp(28px,7vw,36px)] leading-[1] tracking-[-0.04em]">
                  Withdrawal <span className="lp-serif">failed.</span>
                </h3>
                <p className="mx-auto mt-3 max-w-[380px] text-[15px] leading-[1.5] text-[var(--lp-body)]">
                  {hook.withdrawalTxHash
                    ? "Your transfer went out but the payout could not be completed. We're returning your funds, you'll have them back shortly, and our team has been alerted."
                    : "Your transfer could not be completed. Your funds are still in your wallet. Nothing was sent."}
                </p>
                {hook.txStatus && <p className="mt-2 text-[14px] capitalize text-[var(--lp-muted)]">Status: {hook.txStatus.replace(/_/g, " ")}</p>}
              </div>
              {details(hook.txStatus || "Failed")}
            </div>
          }
        />
      );
    }

    // Every field the receipt renders, so the copy downloaded here matches the one in history.
    const receiptData: ReceiptData | null = hook.order
      ? {
          id: hook.order.id,
          type: "withdrawal",
          status: "completed",
          timestamp: new Date().toISOString(),
          amountUsdc: parseFloat(hook.quoteUsdcAmount),
          fiatCurrency: hook.fiatCurrency,
          fiatPayoutAmount: hook.quote?.payoutAmount,
          exchangeRate: hook.quote?.rate,
          bankAccount: hook.bankDetails.accountNumber,
          bankName: hook.bankDetails.bankName || hook.bankDetails.bankCode,
          sourceChain: hook.order.providerAccount?.network ?? hook.withdrawChain,
          txHash: hook.withdrawalTxHash ?? undefined,
          note: hook.bankDetails.memo || undefined,
          orderId: hook.order.id,
        }
      : null;

    return (
      <FlowFrame
        main={
          <div className="py-4">
            <FlowSuccess
              title="Money"
              italic="sent."
              body={
                hook.quote
                  ? `${formatFiat(hook.quote.payoutAmount, hook.fiatCurrency)} is on its way to ${hook.bankDetails.accountName || "their account"}.`
                  : "Your funds have been sent to their account."
              }
            >
              {receiptData && <ReceiptActions data={receiptData} />}

              {canSaveContact && (
                <div className="lp-card rounded-[22px] p-4 text-left animate-in fade-in slide-in-from-top-4 duration-500">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--lp-cream)]">
                      <Plus className="size-4" />
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold">Save this account?</p>
                      <p className="text-[13px] text-[var(--lp-muted)]">Send to them in a tap next time.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <FlowButton
                      tone="quiet"
                      className="h-11 text-[15px]"
                      onClick={() => {
                        setSaveDismissedFor(hook.order?.id ?? null);
                        hook.setShowSavePrompt(false);
                      }}
                    >
                      Not now
                    </FlowButton>
                    <FlowButton className="h-11 text-[15px]" onClick={hook.handleSaveBankContact}>
                      Save it
                    </FlowButton>
                  </div>
                </div>
              )}
            </FlowSuccess>
          </div>
        }
      />
    );
  }

  return null;
}

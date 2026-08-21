"use client";

import { CurrencySelector } from "@/components/CurrencySelector";
import { formatFiat, getCurrencySymbol } from "@/lib/currency-config";
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  AlertCircle,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { BankSelector } from "./BankSelector";
import { SourceSelector } from "@/components/SourceSelector";
import { OrderAdvancedDetails } from "./OrderAdvancedDetails";
import { CHAIN_NAMES, type SupportedChain } from "@/lib/circle/gateway";
import {
  FIAT_ROUTING_PAD,
  feeFromBase,
  maxBaseFromBalance,
  totalDeducted,
} from "@/lib/ramp/fees";
import { useDepositWithdraw } from "./useDepositWithdraw";
import { ReceiptActions } from "@/components/receipt/ReceiptActions";
import { ReceiptData } from "@/lib/receipt/types";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface WithdrawFormProps {
  hook: ReturnType<typeof useDepositWithdraw>;
}

export function WithdrawForm({ hook }: WithdrawFormProps) {
  // Track whether user is typing in USD or their local fiat currency
  const [amountCurrency, setAmountCurrency] = useState<"usd" | "fiat">("usd");
  // Which withdrawal the user waved the save-contact offer away for. Keyed by order id so it
  // clears itself on the next withdrawal without needing a reset hook.
  const [saveDismissedFor, setSaveDismissedFor] = useState<string | null>(null);

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
  const usdcTotal = totalDeducted(usdcBase, feePercent, hook.corridorFee);

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
  const maxBaseUsdc = maxBaseFromBalance(
    totalAvailable,
    feePercent,
    hook.corridorFee,
  );

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
  const amountError = (() => {
    if (!parsedAmount || !hook.rate) return null;
    if (usdcBase > 0 && usdcBase < 1) {
      return "Minimum withdrawal is 1 USDC equivalent.";
    }
    if (isOverBalance) {
      const maxLabel =
        amountCurrency === "usd"
          ? `$${floorTo(maxBaseUsdc, 2).toFixed(2)}`
          : `${fiatSymbol}${Math.floor(
              (maxBaseUsdc / FIAT_ROUTING_PAD) * hook.rate,
            ).toLocaleString()}`;
      return `Fees come out of your balance, so the most you can withdraw is ${maxLabel}. Tap MAX to use it all.`;
    }
    return null;
  })();

  const prefix = amountCurrency === "usd" ? "$" : fiatSymbol;
  // Dynamic padding: short symbols (1–2 chars) → pl-10, longer → pl-14/pl-16
  const inputPl =
    prefix.length <= 1 ? "pl-9" : prefix.length <= 2 ? "pl-12" : "pl-16";

  if (hook.step === 1) {
    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* ── Currency mode toggle ──────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-muted-foreground">
            Enter amount in
          </span>
          <div
            className="flex items-center rounded-xl p-1 gap-1"
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <button
              type="button"
              onClick={() => handleModeSwitch("usd")}
              className="relative px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all duration-200"
              style={
                amountCurrency === "usd"
                  ? {
                      background: "rgba(0,232,122,0.15)",
                      color: "#00e87a",
                      border: "1px solid rgba(0,232,122,0.25)",
                    }
                  : {
                      color: "rgba(248,248,246,0.4)",
                      border: "1px solid transparent",
                    }
              }
            >
              USD
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("fiat")}
              className="relative px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all duration-200"
              style={
                amountCurrency === "fiat"
                  ? {
                      background: "rgba(0,232,122,0.15)",
                      color: "#00e87a",
                      border: "1px solid rgba(0,232,122,0.25)",
                    }
                  : {
                      color: "rgba(248,248,246,0.4)",
                      border: "1px solid transparent",
                    }
              }
            >
              {hook.fiatCurrency}
            </button>
          </div>

          {/* Currency selector (local fiat picker) always visible */}
          <div className="ml-auto">
            <CurrencySelector
              selected={hook.fiatCurrency}
              onChange={(c) => {
                hook.setFiatCurrency(c);
                hook.setAmount("");
              }}
              includeUsd={false}
              size="sm"
            />
          </div>
        </div>

        {/* ── Amount input ──────────────────────────────────────────── */}
        <div>
          <div className="relative">
            {/* Symbol prefix — sized to content, never overlaps */}
            <span
              className="absolute left-4 top-1/2 -translate-y-1/2 font-bold pointer-events-none select-none tabular-nums"
              style={{
                color: "rgba(248,248,246,0.35)",
                fontSize: prefix.length > 2 ? "0.8rem" : "1rem",
              }}
            >
              {prefix}
            </span>
            <input
              type="number"
              value={hook.amount}
              onChange={(e) => {
                hook.setAmount(e.target.value);
                hook.setInputMode(amountCurrency === "fiat" ? "fiat" : "usdc");
              }}
              className={`input-elegant ${inputPl} text-xl font-bold`}
              placeholder={amountCurrency === "usd" ? "100.00" : "10000"}
            />
            {parseFloat(hook.balance) > 0 && hook.rate && (
              <button
                type="button"
                onClick={handleMax}
                className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 rounded-lg bg-accent/10 text-accent text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-colors"
              >
                MAX
              </button>
            )}
          </div>

          {/* Anything wrong with the amount, stated here rather than a step later. */}
          {amountError && (
            <p className="mt-2 px-1 text-[10px] font-medium text-red-400">
              {amountError}
            </p>
          )}

          {/* Live conversion hint */}
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-[10px] text-muted-foreground">
              Balance: {hook.balance} USDC
            </span>
            {parsedAmount > 0 && (
              <span
                className="text-[10px] font-medium flex items-center gap-1.5"
                style={{ color: "rgba(248,248,246,0.5)" }}
              >
                {hook.rateLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : hook.rate ? (
                  amountCurrency === "usd" ? (
                    <>
                      {/* No "≈" once the quote is binding — it is the figure that pays out. */}
                      {quotedPayout != null ? "" : "≈ "}
                      {formatFiat(quotedPayout ?? fiatOut, hook.fiatCurrency, {
                        maximumFractionDigits: quotedPayout != null ? 2 : 0,
                      })}{" "}
                      payout · {usdcTotal.toFixed(2)} USDC deducted
                      {hook.liveQuoteLoading && (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      )}
                    </>
                  ) : (
                    <>
                      {/* Fiat mode: the payout is the target, so it is stated, not estimated —
                          the USDC needed to reach it is what has to be approximated here. */}
                      {formatFiat(parsedAmount, hook.fiatCurrency)} payout · ≈{" "}
                      {usdcTotal.toFixed(2)} USDC deducted
                    </>
                  )
                ) : (
                  <span className="text-red-400 font-bold uppercase text-[9px] tracking-widest">
                    Rate Unavailable
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {parsedAmount > 0 &&
          Object.values(hook.chainBalances).filter((b) => (b ?? 0) > 0).length +
            (hook.solanaBalance > 0 ? 1 : 0) +
            (hook.stellarBalance > 0 ? 1 : 0) >
            1 && (
            <SourceSelector
              balances={hook.chainBalances}
              solanaBalance={hook.solanaBalance}
              stellarBalance={hook.stellarBalance}
              requiredAmount={usdcTotal}
              singleSourceChains={hook.rampNetworks}
              allowConsolidate
              consolidationTarget="Base"
              value={hook.sourcePref}
              onChange={hook.setSourcePref}
            />
          )}

        <button
          onClick={hook.handleWithdrawQuote}
          disabled={
            hook.loading || hook.rateLoading || !hook.amount || amountError != null
          }
          className="btn-primary w-full gap-2"
        >
          {hook.loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isOverBalance ? (
            "Insufficient Balance"
          ) : (
            "Get Quote"
          )}
        </button>
      </div>
    );
  }

  if (hook.step === 2 && hook.quote) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
        <div className="flex items-center mb-2">
          <button
            onClick={hook.goBack}
            className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
        </div>
        <div className="p-4 bg-muted/30 rounded-2xl border border-border space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Exchange Rate</span>
            <span className="font-semibold">
              1 USDC = {hook.quote.rate.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              {hook.fiatCurrency}
            </span>
          </div>
          {/* The headline number: what actually lands in the recipient's account, after every
              fee. Every fee is charged on top of the base, so none of them reduce this. */}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {hook.quote.binding === false ? "You Receive (est.)" : "You Receive"}
            </span>
            <span className="font-bold text-foreground">
              {formatFiat(hook.quote.payoutAmount, hook.fiatCurrency)}
            </span>
          </div>
          {hook.quote.binding === false && (
            <p className="text-[10px] text-muted-foreground leading-snug">
              Estimated from the live rate — the final payout is confirmed on the next screen
              before you send anything.
            </p>
          )}
          <div className="flex justify-between text-sm pt-2 border-t border-border text-muted-foreground">
            <span>Base Cost</span>
            <span>
              {parseFloat(hook.quoteUsdcAmount).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              USDC
            </span>
          </div>
          {/* One fee line covering both what we charge and the provider's corridor fee. They
              are separate charges internally — ours is routed on-chain to our treasury, the
              provider's rides along in the payout deposit — but the user is debited for both,
              so splitting them here only invited "what is this second fee". The percentage is
              shown ONLY when the platform fee is the whole of it; once a corridor fee is
              folded in, the total is no longer that percentage of the base and labelling it so
              would be the same displayed-vs-charged mismatch this screen exists to end. */}
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>{hook.corridorFee > 0 ? "Fee" : `Fee (${feePercent}%)`}</span>
            <span>
              {(
                feeFromBase(parseFloat(hook.quoteUsdcAmount), feePercent) + hook.corridorFee
              ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              USDC
            </span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-border">
            <span className="font-bold">Total Deducted</span>
            <span className="font-bold text-red-400">
              -
              {(
                totalDeducted(
                  parseFloat(hook.quoteUsdcAmount),
                  feePercent,
                  hook.corridorFee,
                )
              ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              USDC
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {/* Destination Country / Currency Selector List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
                Select Destination Country
              </label>
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider flex items-center gap-1.5">
                {hook.institutionsLoading ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-accent" />
                    Fetching banks…
                  </>
                ) : hook.institutions.length > 0 ? (
                  `${hook.institutions.length} banks available`
                ) : null}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { code: "NGN", flag: "🇳🇬" },
                { code: "KES", flag: "🇰🇪" },
                { code: "GHS", flag: "🇬🇭" },
                { code: "UGX", flag: "🇺🇬" },
                { code: "TZS", flag: "🇹🇿" },
                { code: "XOF", flag: "🇨🇮" },
                { code: "XAF", flag: "🇨🇲" },
                { code: "RWF", flag: "🇷🇼" },
                { code: "GMD", flag: "🇬🇲" },
                { code: "BRL", flag: "🇧🇷" },
              ].map((c) => {
                const isSelected = hook.fiatCurrency === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => hook.setFiatCurrency(c.code)}
                    className={cn(
                      "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider border transition-all duration-200 group select-none",
                      isSelected
                        ? "bg-accent/15 border-accent text-foreground shadow-md shadow-accent/10"
                        : "bg-white/[0.04] border-white/10 text-muted-foreground hover:bg-white/[0.08] hover:border-white/20 hover:text-foreground"
                    )}
                  >
                    <span className="text-base leading-none transition-transform group-hover:scale-110">
                      {c.flag}
                    </span>
                    <span>{c.code}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <BankSelector
            label="Bank"
            institutions={hook.institutions}
            selectedBankCode={hook.bankDetails.bankCode}
            onSelect={(b) =>
              hook.setBankDetails({
                ...hook.bankDetails,
                bankCode: b.code,
                bankName: b.name,
                accountName: "",
              })
            }
            onSelectContact={hook.handleSelectContact}
            accountNumber={hook.bankDetails.accountNumber}
            onAccountNumberChange={(val) =>
              hook.setBankDetails({
                ...hook.bankDetails,
                accountNumber: val,
                accountName: "",
              })
            }
            accountName={hook.bankDetails.accountName}
            onAccountNameChange={(name) =>
              hook.setBankDetails({
                ...hook.bankDetails,
                accountName: name,
              })
            }
            memo={hook.bankDetails.memo}
            onMemoChange={(val) =>
              hook.setBankDetails({
                ...hook.bankDetails,
                memo: val,
              })
            }
            isVerifying={hook.verifyingBank}
            contacts={hook.bankContacts}
            userEmail={hook.userEmail}
            fiatCurrency={hook.fiatCurrency}
            onContactsChanged={hook.refreshBankContacts}
          />
        </div>

        {/* The single authorisation point: this press creates the order AND sends the funds,
            so it names the amount being authorised rather than a generic "confirm". */}
        <button
          onClick={hook.handleWithdrawFinalize}
          disabled={hook.loading || !hook.bankDetails.accountName}
          className="btn-primary w-full gap-2"
        >
          {hook.loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            `Send ${formatFiat(hook.quote.payoutAmount, hook.fiatCurrency)}`
          )}
        </button>
      </div>
    );
  }

  // Step 3 — the withdrawal running. Not a confirmation gate: the review screen is the single
  // point of authorisation, and the transfer starts the moment the order exists. This is the
  // summary of what was authorised, kept on screen while it settles, with the payout figure
  // already updated if the order came back priced differently.
  if (hook.step === 3 && hook.order) {
    const payout = hook.quote?.payoutAmount;
    return (
      <div className="space-y-6 animate-in fade-in duration-300 text-center">
        <div
          className={cn(
            "w-20 h-20 rounded-full flex items-center justify-center mx-auto shadow-sm",
            hook.transferError ? "bg-red-950/40" : "bg-muted",
          )}
        >
          {hook.transferError ? (
            <AlertCircle className="w-10 h-10 text-red-400" />
          ) : (
            <Loader2 className="w-10 h-10 text-foreground animate-spin" />
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-2xl font-black uppercase tracking-tighter">
            {hook.transferError ? "Transfer Didn't Go Through" : "Sending Your Withdrawal"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {hook.transferError
              ? hook.transferError
              : "Signing the transfer and releasing the payout. Keep this open."}
          </p>
        </div>

        <div className="p-4 bg-muted/30 rounded-xl border border-border text-left space-y-3">
          {payout != null && (
            <div className="space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-bold text-muted-foreground uppercase">
                  {hook.bankDetails.accountName || "Recipient"} receives
                </span>
                <span className="text-lg font-black tracking-tight tabular-nums">
                  {formatFiat(payout, hook.fiatCurrency)}
                </span>
              </div>
              {/* The amount moved after the review was authorised. It is already updated above
                  and on the receipt — this only says why, so the change is never silent. */}
              {hook.payoutAdjusted && (
                <p className="text-[10px] text-amber-400/90 leading-snug text-right">
                  {hook.payoutAdjusted.reason === "provider"
                    ? "Routed via another provider"
                    : "Rate refreshed"}{" "}
                  — updated from{" "}
                  {formatFiat(hook.payoutAdjusted.from, hook.fiatCurrency)}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t border-border">
            <span>Total deducted</span>
            <span className="font-semibold tabular-nums">
              {(
                totalDeducted(
                  parseFloat(hook.quoteUsdcAmount),
                  feePercent,
                  hook.corridorFee,
                )
              ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              USDC
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>To</span>
            <span className="font-semibold text-right">
              {hook.bankDetails.bankName || hook.bankDetails.bankCode}
              {hook.bankDetails.accountNumber
                ? ` ····${hook.bankDetails.accountNumber.slice(-4)}`
                : ""}
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Network</span>
            <span className="font-semibold">
              {CHAIN_NAMES[
                (hook.order.providerAccount?.network ?? hook.withdrawChain) as SupportedChain
              ] ??
                hook.order.providerAccount?.network ??
                hook.withdrawChain}
            </span>
          </div>
        </div>

        <OrderAdvancedDetails
          provider={hook.order.provider}
          orderId={hook.order.id}
          network={hook.order.providerAccount?.network ?? hook.withdrawChain}
          receiveAddress={hook.order.providerAccount?.receiveAddress}
          consolidated={hook.mustConsolidate}
          validUntil={hook.order.providerAccount?.validUntil}
        />

        {hook.transferError ? (
          // Retries the order that already exists. Nothing was sent, and the quote behind this
          // order is unchanged, so the amount above is still the amount that will be paid.
          <button
            onClick={hook.retryTransfer}
            disabled={hook.transferring}
            className="btn-primary w-full gap-2"
          >
            {hook.transferring ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Retrying…
              </>
            ) : (
              "Try Again"
            )}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 text-xs font-bold text-green-400 bg-green-950/30 py-2 rounded-lg">
            <ShieldCheck className="w-4 h-4" />
            GASLESS TRANSFER SUPPORTED
          </div>
        )}
      </div>
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
    const alreadySaved = hook.bankContacts.some(
      (c) => c.account_number === accountNumber,
    );
    const canSaveContact =
      !!accountNumber && !alreadySaved && saveDismissedFor !== (hook.order?.id ?? null);

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 text-center">
        {hook.polling ? (
          <>
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto shadow-sm">
              <Loader2 className="w-10 h-10 animate-spin text-foreground" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black uppercase tracking-tighter">
                Processing
              </h3>
              <p className="text-sm text-muted-foreground">
                Your withdrawal is being processed. This may take a few minutes.
              </p>
              <p className="text-[10px] text-muted-foreground uppercase font-bold">
                Status: {hook.txStatus || "Pending"}
              </p>
            </div>
            {/* The payout stays on screen from review through to the receipt. Dropping it here
                made the amount vanish and reappear mid-flow, which reads as a changed number. */}
            {hook.quote && (
              <div className="p-4 bg-muted/30 rounded-xl border border-border text-left">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs font-bold text-muted-foreground uppercase">
                    {hook.bankDetails.accountName || "Recipient"} receives
                  </span>
                  <span className="text-lg font-black tracking-tight tabular-nums">
                    {formatFiat(hook.quote.payoutAmount, hook.fiatCurrency)}
                  </span>
                </div>
              </div>
            )}
            {hook.order && (
              <OrderAdvancedDetails
                provider={hook.order.provider}
                orderId={hook.order.id}
                network={hook.order.providerAccount?.network ?? hook.withdrawChain}
                receiveAddress={hook.order.providerAccount?.receiveAddress}
                consolidated={hook.mustConsolidate}
                status={hook.txStatus || "Pending"}
              />
            )}
          </>
        ) : hook.txFailed ? (
          /*
           * A withdrawal that did not go through.
           *
           * This branch did not exist: the view was `polling ? Processing : Complete`, so the
           * instant polling stopped — however it ended — a failed withdrawal showed a green tick
           * and "your funds have been sent to your bank account", contradicted only by a toast
           * that had already faded.
           *
           * What they need to know is whether their money is coming back, and that depends on
           * one thing: whether it ever left. If the transfer went out, we owe them a refund and
           * say so; if it never did, their USDC is still theirs and saying "refund" would be
           * just as wrong in the other direction.
           */
          <>
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-9 h-9 text-red-400" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black uppercase tracking-tighter">
                Withdrawal Failed
              </h3>
              <p className="text-sm text-muted-foreground">
                {hook.withdrawalTxHash
                  ? "Your transfer went out but the payout could not be completed. We are returning your funds — you'll receive them back shortly, and we've alerted our team."
                  : "Your withdrawal could not be completed. Your funds are still in your wallet — nothing was sent."}
              </p>
              {hook.txStatus && (
                <p className="text-[10px] text-muted-foreground uppercase font-bold">
                  Status: {hook.txStatus}
                </p>
              )}
            </div>

            {hook.order && (
              <OrderAdvancedDetails
                provider={hook.order.provider}
                orderId={hook.order.id}
                network={hook.order.providerAccount?.network ?? hook.withdrawChain}
                receiveAddress={hook.order.providerAccount?.receiveAddress}
                consolidated={hook.mustConsolidate}
                status={hook.txStatus || "Failed"}
              />
            )}
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-green-500 text-background rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-900/20">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black uppercase tracking-tighter">
                Withdrawal Complete!
              </h3>
              <p className="text-muted-foreground text-sm">
                Your funds have been sent to your bank account.
              </p>
            </div>

            {hook.order &&
              (() => {
                // Every field the receipt renders. The hash, memo and settlement chain were
                // missing here, so the copy downloaded straight after a withdrawal was thinner
                // than the identical receipt reached later from transaction history.
                const receiptData: ReceiptData = {
                  id: hook.order.id,
                  type: "withdrawal",
                  status: "completed",
                  timestamp: new Date().toISOString(),
                  amountUsdc: parseFloat(hook.quoteUsdcAmount),
                  fiatCurrency: hook.fiatCurrency,
                  fiatPayoutAmount: hook.quote?.payoutAmount,
                  exchangeRate: hook.quote?.rate,
                  bankAccount: hook.bankDetails.accountNumber,
                  bankName:
                    hook.bankDetails.bankName || hook.bankDetails.bankCode,
                  sourceChain:
                    hook.order.providerAccount?.network ?? hook.withdrawChain,
                  txHash: hook.withdrawalTxHash ?? undefined,
                  note: hook.bankDetails.memo || undefined,
                  orderId: hook.order.id,
                };
                return (
                  <div className="w-full space-y-1.5 animate-in fade-in duration-500">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30 text-center">
                      Transaction Receipt
                    </p>
                    <ReceiptActions data={receiptData} />
                  </div>
                );
              })()}

            {canSaveContact && (
              <div className="p-6 bg-accent/5 border border-accent/20 rounded-3xl space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-accent/10 rounded-xl">
                    <Plus className="w-5 h-5 text-accent" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm">Save this bank account?</p>
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">
                      Quickly withdraw to this bank next time
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setSaveDismissedFor(hook.order?.id ?? null);
                      hook.setShowSavePrompt(false);
                    }}
                    className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/5 transition-colors"
                  >
                    No, Thanks
                  </button>
                  <button
                    onClick={hook.handleSaveBankContact}
                    className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest bg-accent text-accent-foreground hover:scale-[1.02] transition-all shadow-lg shadow-accent/20"
                  >
                    Yes, Save
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return null;
}

"use client";

import { CurrencySelector } from "@/components/CurrencySelector";
import { getCurrencySymbol } from "@/lib/currency-config";
import {
  CheckCircle2,
  ChevronRight,
  Landmark,
  Loader2,
  ShieldCheck,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { BankSelector } from "./BankSelector";
import { useDepositWithdraw } from "./useDepositWithdraw";
import { PAYCREST_PARTNER_FEE_PERCENT } from "@/lib/paycrest/config";
import { ReceiptActions } from "@/components/receipt/ReceiptActions";
import { ReceiptData } from "@/lib/receipt/types";
import { useState } from "react";

interface WithdrawFormProps {
  hook: ReturnType<typeof useDepositWithdraw>;
}

export function WithdrawForm({ hook }: WithdrawFormProps) {
  // Track whether user is typing in USD or their local fiat currency
  const [amountCurrency, setAmountCurrency] = useState<"usd" | "fiat">("fiat");

  const fiatSymbol = getCurrencySymbol(hook.fiatCurrency);
  const parsedAmount = parseFloat(hook.amount || "0");

  // Derived: what the input value means in USDC (base, before fee)
  const usdcBase = (() => {
    if (!parsedAmount || !hook.rate) return 0;
    if (amountCurrency === "usd") return parsedAmount; // USD ≈ USDC 1:1
    return parsedAmount / hook.rate; // fiat → USDC
  })();

  // Total USDC that will be deducted (base + fee)
  const feeRate = PAYCREST_PARTNER_FEE_PERCENT / 100;
  const usdcTotal = usdcBase * (1 + feeRate);

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

  const handleMax = () => {
    if (!hook.rate) return;
    const maxBaseUsdc = parseFloat(hook.balance) / (1 + feeRate);
    if (amountCurrency === "usd") {
      hook.setAmount(maxBaseUsdc.toFixed(2));
      hook.setInputMode("usdc");
    } else {
      const maxFiat = maxBaseUsdc * hook.rate;
      hook.setAmount(Math.floor(maxFiat).toString());
      hook.setInputMode("fiat");
    }
  };

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
                      ≈ {fiatSymbol}
                      {fiatOut.toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}{" "}
                      {hook.fiatCurrency} payout · {usdcTotal.toFixed(2)} USDC
                      deducted
                    </>
                  ) : (
                    <>≈ {usdcTotal.toFixed(2)} USDC deducted</>
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

        <button
          onClick={hook.handleWithdrawQuote}
          disabled={hook.loading || hook.rateLoading || !hook.amount}
          className="btn-primary w-full gap-2"
        >
          {hook.loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
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
              1 USDC = {hook.quote.rate.toLocaleString()} {hook.fiatCurrency}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">You Receive</span>
            <span className="font-bold text-foreground">
              {getCurrencySymbol(hook.fiatCurrency)}
              {hook.quote.payoutAmount.toLocaleString()} {hook.fiatCurrency}
            </span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-border text-muted-foreground">
            <span>Base Cost</span>
            <span>
              {parseFloat(hook.quoteUsdcAmount).toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{" "}
              USDC
            </span>
          </div>
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Network Fee ({PAYCREST_PARTNER_FEE_PERCENT}%)</span>
            <span>
              {(
                parseFloat(hook.quoteUsdcAmount) *
                (PAYCREST_PARTNER_FEE_PERCENT / 100)
              ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              USDC
            </span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-border">
            <span className="font-bold">Total Deducted</span>
            <span className="font-bold text-red-400">
              -
              {(
                parseFloat(hook.quoteUsdcAmount) *
                (1 + PAYCREST_PARTNER_FEE_PERCENT / 100)
              ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              USDC
            </span>
          </div>
        </div>

        <div className="space-y-4">
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
            onSelectContact={(contact) =>
              hook.setBankDetails({
                bankCode: contact.bankCode,
                bankName: contact.bankName,
                accountNumber: contact.accountNumber,
                accountName: contact.accountName,
              })
            }
            accountNumber={hook.bankDetails.accountNumber}
            onAccountNumberChange={(val) =>
              hook.setBankDetails({
                ...hook.bankDetails,
                accountNumber: val,
                accountName: "",
              })
            }
            accountName={hook.bankDetails.accountName}
            isVerifying={hook.verifyingBank}
            contacts={hook.bankContacts}
            userEmail={hook.userEmail}
            onContactsChanged={hook.refreshBankContacts}
          />
        </div>

        <button
          onClick={hook.handleWithdrawFinalize}
          disabled={hook.loading || !hook.bankDetails.accountName}
          className="btn-primary w-full gap-2"
        >
          {hook.loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            "Confirm Withdrawal"
          )}
        </button>
      </div>
    );
  }

  if (hook.step === 3 && hook.order) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 text-center">
        <div className="flex items-center justify-start -mb-4">
          <button
            onClick={hook.goBack}
            disabled={hook.transferring}
            className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
        </div>

        <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mx-auto shadow-sm">
          <Landmark className="w-10 h-10 text-foreground" />
        </div>

        <div className="space-y-2">
          <h3 className="text-2xl font-black uppercase tracking-tighter">
            Ready to Send
          </h3>
          <p className="text-sm text-muted-foreground">
            Please confirm the transfer of funds to complete your withdrawal.
          </p>
        </div>

        <div className="p-4 bg-muted/30 rounded-xl border border-border text-left space-y-2">
          <div className="flex justify-between text-xs font-bold text-muted-foreground uppercase">
            <span>Destination</span>
            <span>Network: Base</span>
          </div>
          <div className="p-3 bg-background border border-border rounded-lg font-mono text-[10px] break-all">
            {hook.order.providerAccount?.receiveAddress}
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs font-bold text-green-400 bg-green-950/30 py-2 rounded-lg">
          <ShieldCheck className="w-4 h-4" />
          GASLESS TRANSFER SUPPORTED
        </div>

        <button
          onClick={hook.executeTransfer}
          disabled={hook.transferring}
          className="btn-primary w-full gap-2"
        >
          {hook.transferring ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              Send Funds Now
              <ChevronRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
    );
  }

  if (hook.step === 4) {
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

            {hook.showSavePrompt && (
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
                    onClick={() => hook.setShowSavePrompt(false)}
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

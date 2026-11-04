"use client";

import { CurrencySelector } from "@/components/CurrencySelector";
import { getCurrencySymbol } from "@/lib/currency-config";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, Clock, Copy, Loader2, Plus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { BankSelector } from "./BankSelector";
import { useDepositWithdraw } from "./useDepositWithdraw";
import { useOnRampAvailability } from "@/lib/hooks/useOnRampAvailability";
import { ReceiptActions } from "@/components/receipt/ReceiptActions";
import { ReceiptData } from "@/lib/receipt/types";
import { KycModal } from "@/components/kyc/KycModal";
import { namesMatch } from "@/lib/ramp/onramp-kyc";
import { AmountField, AsideFigure, AsideRows, FlowButton, FlowFrame, FlowLabel, FlowSuccess, Notice } from "@/components/flow/ui";
import { Skeleton } from "@/components/ui/skeleton";

interface DepositFormProps {
  hook: ReturnType<typeof useDepositWithdraw>;
}

/** One of the bank details to pay into, copied with a tap. */
function PayDetail({ label, value, copy }: { label: string; value?: string; copy?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[rgba(246,242,233,0.12)] py-3 last:border-b-0">
      <span className="text-[14px] text-[#a9c2b5]">{label}</span>
      {copy && value ? (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success(`${label} copied`);
            setTimeout(() => setCopied(false), 1400);
          }}
          className="flex min-w-0 items-center gap-2 rounded-full bg-[rgba(245,244,238,0.1)] px-3 py-1.5 text-[15px] font-semibold tabular-nums transition-colors hover:bg-[rgba(245,244,238,0.18)]"
        >
          <span className="truncate">{value}</span>
          {copied ? <Check className="size-3.5 shrink-0 text-[var(--lp-green)]" /> : <Copy className="size-3.5 shrink-0 opacity-70" />}
        </button>
      ) : (
        <span className="min-w-0 truncate text-right text-[15px] font-semibold">{value || "—"}</span>
      )}
    </div>
  );
}

export function DepositForm({ hook }: DepositFormProps) {
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);
  const [kycModalOpen, setKycModalOpen] = React.useState(false);
  const requirement = hook.onRampRequirement;
  const blocked = requirement?.ok === false ? requirement : null;
  const canVerify = blocked?.need === "verification" || blocked?.need === "reverify";
  const verifiedName = requirement?.name;
  const refundNameMismatch = !!verifiedName && !!hook.bankDetails.accountName && !namesMatch(verifiedName, hook.bankDetails.accountName);
  // Nothing is deducted on the way in, so the estimate is simply the amount at the rate.
  const estimatedUsdc = hook.rate && hook.amount ? (parseFloat(hook.amount) / hook.rate).toFixed(4) : null;

  // Checked at the size being deposited, not a fixed one: a corridor quotes some amounts and not
  // others, and only the user's own figure answers "can this go through".
  const { unavailable: depositUnavailable, checkedAmount } = useOnRampAvailability(
    hook.fiatCurrency,
    estimatedUsdc ? parseFloat(estimatedUsdc) : undefined,
  );

  // Countdown timer for order
  React.useEffect(() => {
    if (!hook.order?.providerAccount?.validUntil) return;
    const target = new Date(hook.order.providerAccount.validUntil).getTime();
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [hook.order]);

  if (hook.step === 1) {
    const amount = parseFloat(hook.amount);
    return (
      <FlowFrame
        main={
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {blocked && (
              <Notice
                tone="warning"
                title={
                  blocked.need === "verification"
                    ? "Verify your identity to deposit"
                    : blocked.need === "reverify"
                      ? "One more verification needed"
                      : blocked.need === "in_review"
                        ? "Your verification is in review"
                        : "Deposits are unavailable"
                }
                action={
                  canVerify && (
                    <button
                      type="button"
                      onClick={() => setKycModalOpen(true)}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-4 text-[14px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
                    >
                      {blocked.need === "reverify" ? "Verify again" : "Verify identity"}
                      <ArrowRight className="size-4" />
                    </button>
                  )
                }
              >
                {blocked.message}
              </Notice>
            )}
            {depositUnavailable && (
              <Notice tone="warning" title={checkedAmount ? "That amount can't go through right now" : "Deposits are paused"}>
                {checkedAmount
                  ? `Nobody is quoting this amount in ${hook.fiatCurrency} right now. Try a smaller amount.`
                  : `${hook.fiatCurrency} deposits are paused right now. Try another currency or check back shortly.`}
              </Notice>
            )}

            <AmountField
              label="You deposit"
              value={hook.amount}
              onChange={hook.setAmount}
              symbol={getCurrencySymbol(hook.fiatCurrency)}
              placeholder="5,000"
              currency={
                <CurrencySelector
                  selected={hook.fiatCurrency}
                  onChange={hook.setFiatCurrency}
                  includeUsd={false}
                  size="md"
                  /* Only corridors an on-ramp provider can actually fulfil. Without this the list
                     came from Bitnob, which has no fiat on-ramp, so a user could pick a currency
                     that only failed once they had entered an amount. */
                  scope="onramp"
                />
              }
            />

            <div className="space-y-3 pt-1">
              {/* Said before the fields, not under them: being asked for a bank account while
                  money is arriving reads as a mistake until you know it is the refund route. */}
              <div>
                <FlowLabel>Refund account</FlowLabel>
                <p className="mt-1.5 text-[14px] leading-[1.5] text-[var(--lp-body)]">
                  If anything goes wrong, we send your money back here. Use an account in your own name
                  {verifiedName ? ` (${verifiedName})` : ""}.{hook.fiatCurrency === "KES" && " Use your own M-Pesa number."}
                </p>
              </div>

              <BankSelector
                label="Bank"
                institutions={hook.institutions}
                selectedBankCode={hook.bankDetails.bankCode}
                onSelect={(b) => hook.setBankDetails({ ...hook.bankDetails, bankCode: b.code, bankName: b.name, accountName: "" })}
                onSelectContact={hook.handleSelectContact}
                accountNumber={hook.bankDetails.accountNumber}
                onAccountNumberChange={(val) => hook.setBankDetails({ ...hook.bankDetails, accountNumber: val, accountName: "" })}
                accountName={hook.bankDetails.accountName}
                isVerifying={hook.verifyingBank}
                contacts={hook.bankContacts}
                userEmail={hook.userEmail}
                onContactsChanged={hook.refreshBankContacts}
                memo={hook.bankDetails.memo}
                onMemoChange={(val) => hook.setBankDetails({ ...hook.bankDetails, memo: val })}
              />

              {refundNameMismatch && (
                <Notice tone="danger" title="This account isn't in your name">
                  It belongs to {hook.bankDetails.accountName}, not {verifiedName}. Use an account in your own name, or the deposit will be
                  refused.
                </Notice>
              )}
            </div>

            <KycModal
              isOpen={kycModalOpen}
              onClose={() => {
                setKycModalOpen(false);
                hook.refreshOnRampRequirement();
              }}
              userEmail={hook.userEmail}
              depositCurrency={hook.fiatCurrency}
            />
          </div>
        }
        aside={
          <div className="space-y-6">
            <AsideFigure
              label="You deposit"
              value={`${getCurrencySymbol(hook.fiatCurrency)}${Number.isFinite(amount) ? amount.toLocaleString() : "0"}`}
              unit={hook.fiatCurrency}
            />
            <AsideRows
              rows={[
                {
                  label: "Rate",
                  value: hook.rateLoading ? (
                    <Skeleton tone="forest" className="inline-block h-3.5 w-32 align-middle" aria-label="Loading rate" />
                  ) : hook.rate ? (
                    `1 USDC = ${hook.rate.toLocaleString()} ${hook.fiatCurrency}`
                  ) : (
                    "Unavailable"
                  ),
                },
                // Deposits are free. A withdrawal fee shown here told people they were being charged twice.
                { label: "Fee", value: "Free", tone: "good" },
              ]}
            />
            <AsideFigure
              label="You receive"
              size="md"
              value={hook.rateLoading ? <Skeleton tone="forest" className="inline-block h-9 w-36 rounded-[12px] align-middle" aria-label="Loading amount" /> : (estimatedUsdc ?? "0.00")}
              unit="USDC"
            />
            <p className="text-[14px] leading-[1.5] text-[#a9c2b5]">Added to your balance as soon as your transfer lands.</p>
          </div>
        }
        action={
          <FlowButton
            tone="accent"
            onClick={() => hook.handleDepositInitiate()}
            loading={hook.loading}
            disabled={hook.rateLoading || depositUnavailable || !!blocked || !hook.amount || !hook.bankDetails.accountName}
          >
            Continue <ArrowRight className="size-5" />
          </FlowButton>
        }
      />
    );
  }

  if (hook.step === 2 && hook.order) {
    const account = hook.order.providerAccount;
    return (
      <FlowFrame
        main={
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {hook.depositUnderReview && (
              <Notice tone="warning" title="Your payment is being reviewed">
                We received it and it is going through a routine check, which can take a few days. Please don&apos;t pay again, as a second
                payment would be held too. It will either arrive in your balance or be returned to the account it came from.
              </Notice>
            )}

            {secondsLeft !== null && !hook.depositUnderReview && (
              <div
                className={cn(
                  "flex items-center justify-between gap-3 rounded-full px-5 py-3",
                  secondsLeft < 60 ? "bg-[var(--lp-danger-soft)] text-[var(--lp-danger)]" : "lp-card",
                )}
              >
                <span className="flex items-center gap-2 text-[14px] font-semibold">
                  <Clock className="size-4" /> Pay within
                </span>
                <span className="lp-display text-[24px] leading-none tracking-[-0.03em] tabular-nums">
                  {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                </span>
              </div>
            )}

            <div>
              <FlowLabel>How to pay</FlowLabel>
              <ol className="mt-3 space-y-3">
                {[
                  "Open your banking app.",
                  "Send exactly the amount shown, to the account shown.",
                  `Pay from an account in your own name${verifiedName ? ` (${verifiedName})` : ""}. A payment from anyone else is sent back.`,
                  "Come back and tap “I’ve sent the money”. Your balance updates by itself.",
                ].map((line, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--lp-ink)] text-[13px] font-semibold text-[var(--lp-cream)]">
                      {i + 1}
                    </span>
                    <span className="pt-0.5 text-[15px] leading-[1.5] text-[var(--lp-body)]">{line}</span>
                  </li>
                ))}
              </ol>
            </div>

            {hook.polling && (
              <p className="text-[14px] capitalize text-[var(--lp-muted)]">Status: {(hook.txStatus || "pending").replace(/_/g, " ")}</p>
            )}
          </div>
        }
        aside={
          <div>
            <AsideFigure label="Transfer exactly" value={account?.amountToTransfer} unit={account?.currency} />
            <div className="mt-6">
              <PayDetail label="Bank" value={account?.institution} />
              <PayDetail label="Account" value={account?.accountIdentifier} copy />
              <PayDetail label="Name" value={account?.accountName} />
            </div>
          </div>
        }
        action={
          hook.polling ? (
            <FlowButton tone="quiet" disabled className="disabled:opacity-100">
              <Loader2 className="size-5 animate-spin" /> Watching for your payment
            </FlowButton>
          ) : (
            <FlowButton tone="accent" onClick={() => hook.startPolling()}>
              I&apos;ve sent the money
            </FlowButton>
          )
        }
      />
    );
  }

  if (hook.step === 3) {
    const depositReceipt: ReceiptData = {
      id: hook.order?.id ?? "dep-pending",
      type: "deposit",
      status: "confirmed",
      timestamp: new Date().toISOString(),
      amountUsdc: hook.rate && hook.amount ? parseFloat(hook.amount) / hook.rate : 0,
      fiatAmount: parseFloat(hook.amount),
      fiatCurrency: hook.fiatCurrency,
      exchangeRate: hook.rate ?? undefined,
      orderId: hook.order?.id,
    };

    return (
      <FlowFrame
        main={
          <div className="py-4">
            <FlowSuccess title="Money" italic="received." body="It's in your balance and ready to use.">
              <ReceiptActions data={depositReceipt} />

              {hook.showSavePrompt && (
                <div className="lp-card rounded-[22px] p-4 text-left animate-in fade-in slide-in-from-top-4 duration-500">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--lp-cream)]">
                      <Plus className="size-4" />
                    </span>
                    <div>
                      <p className="text-[15px] font-semibold">Save this refund account?</p>
                      <p className="text-[13px] text-[var(--lp-muted)]">It&apos;s filled in for you next time.</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <FlowButton tone="quiet" className="h-11 text-[15px]" onClick={() => hook.setShowSavePrompt(false)}>
                      Not now
                    </FlowButton>
                    <FlowButton className="h-11 text-[15px]" onClick={hook.handleSaveBankContact}>
                      Save it
                    </FlowButton>
                  </div>
                </div>
              )}

              <FlowButton tone="quiet" onClick={() => hook.onClose?.()}>
                Back to dashboard
              </FlowButton>
            </FlowSuccess>
          </div>
        }
      />
    );
  }

  return null;
}

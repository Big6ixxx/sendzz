'use client';

import { CurrencySelector } from '@/components/CurrencySelector';
import { getCurrencySymbol } from '@/lib/currency-config';
import {
  CheckCircle2,
  ChevronRight,
  Landmark,
  Loader2,
  ShieldCheck,
  Plus,
  ArrowLeft,
  Info,
} from 'lucide-react';
import { BankSelector } from './BankSelector';
import { useDepositWithdraw } from './useDepositWithdraw';
import { PAYCREST_PARTNER_FEE_PERCENT } from '@/lib/paycrest/config';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ReceiptActions } from '@/components/receipt/ReceiptActions';
import { ReceiptData } from '@/lib/receipt/types';

interface WithdrawFormProps {
  hook: ReturnType<typeof useDepositWithdraw>;
}

export function WithdrawForm({ hook }: WithdrawFormProps) {
  if (hook.step === 1) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-semibold text-muted-foreground">
              Amount (USDC)
            </label>
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground transition-colors cursor-help">
                      <Info className="w-4 h-4 opacity-70" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-[#1a1a1c] border border-white/10 text-white">
                    <p className="max-w-[200px] text-center font-medium leading-relaxed">
                      Select your local currency. Your USDC will be converted and paid out to your bank account in this currency.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <CurrencySelector
                selected={hook.fiatCurrency}
                onChange={hook.setFiatCurrency}
                includeUsd={false}
                size="sm"
              />
            </div>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
              $
            </span>
            <input
              type="number"
              value={hook.amount}
              onChange={(e) => hook.setAmount(e.target.value)}
              className="input-elegant pl-14 text-xl font-bold"
              placeholder="100.00"
            />
            {parseFloat(hook.balance) > 0 && (
              <button
                type="button"
                onClick={() => hook.setAmount(parseFloat(hook.balance).toFixed(2))}
                className="absolute right-4 top-1/2 -translate-y-1/2 px-3 py-1 rounded-lg bg-accent/10 text-accent text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-colors"
              >
                MAX
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 px-1 flex justify-between">
            <span>
              Payout in {getCurrencySymbol(hook.fiatCurrency)} ({hook.fiatCurrency})
            </span>
            {hook.rate && hook.amount && !isNaN(parseFloat(hook.amount)) && (
              <span className="font-medium text-foreground">
                ≈ {getCurrencySymbol(hook.fiatCurrency)}{(parseFloat(hook.amount) * hook.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={hook.handleWithdrawQuote}
          disabled={hook.loading || !hook.amount}
          className="btn-primary w-full gap-2"
        >
          {hook.loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            'Continue'
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
            <span className="text-muted-foreground">Estimated Received</span>
            <span className="font-bold text-foreground">
              {getCurrencySymbol(hook.fiatCurrency)}{hook.quote.payoutAmount.toLocaleString()} {hook.fiatCurrency}
            </span>
          </div>
          <div className="flex justify-between text-sm pt-2 border-t border-border">
            <span className="text-muted-foreground">Network Fee</span>
            <span className="font-semibold text-foreground">{PAYCREST_PARTNER_FEE_PERCENT}%</span>
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
                accountName: '',
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
                accountName: '',
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
            'Confirm Withdrawal'
          )}
        </button>
      </div>
    );
  }

  if (hook.step === 3 && hook.order) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 text-center">
        <div className="flex items-center justify-start mb-[-1rem]">
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

        <div className="flex items-center justify-center gap-2 text-xs font-bold text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 py-2 rounded-lg">
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
                Status: {hook.txStatus || 'Pending'}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="w-20 h-20 bg-green-500 text-background rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-200 dark:shadow-green-900/20">
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

            {hook.order && (() => {
              const receiptData: ReceiptData = {
                id: hook.order.id,
                type: 'withdrawal',
                status: 'completed',
                timestamp: new Date().toISOString(),
                amountUsdc: parseFloat(hook.amount),
                fiatCurrency: hook.fiatCurrency,
                fiatPayoutAmount: hook.quote?.payoutAmount,
                exchangeRate: hook.quote?.rate,
                bankAccount: hook.bankDetails.accountNumber,
                bankName: hook.bankDetails.bankName || hook.bankDetails.bankCode,
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
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Quickly withdraw to this bank next time</p>
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

'use client';

import { CurrencySelector } from '@/components/CurrencySelector';
import { getCurrencySymbol } from '@/lib/currency-config';
import {
  CheckCircle2,
  ChevronRight,
  Landmark,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { BankSelector } from './BankSelector';
import { useDepositWithdraw } from './useDepositWithdraw';
import { PAYCREST_PARTNER_FEE_PERCENT } from '@/lib/paycrest/config';

interface WithdrawFormProps {
  hook: ReturnType<typeof useDepositWithdraw>;
}

export function WithdrawForm({ hook }: WithdrawFormProps) {
  if (hook.step === 1) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-muted-foreground">
                Amount ({hook.inputMode === 'usdc' ? 'USDC' : hook.fiatCurrency})
              </label>
              <button
                type="button"
                onClick={() => hook.setInputMode(hook.inputMode === 'usdc' ? 'fiat' : 'usdc')}
                className="text-[10px] text-primary hover:underline font-medium"
              >
                Use {hook.inputMode === 'usdc' ? hook.fiatCurrency : 'USDC'}
              </button>
            </div>
            <CurrencySelector
              selected={hook.fiatCurrency}
              onChange={hook.setFiatCurrency}
              includeUsd={false}
              size="sm"
            />
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
              {hook.inputMode === 'usdc' ? '$' : getCurrencySymbol(hook.fiatCurrency)}
            </span>
            <input
              type="number"
              value={hook.amount}
              onChange={(e) => hook.setAmount(e.target.value)}
              className="input-elegant pl-14 text-xl font-bold"
              placeholder="100.00"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 px-1 flex justify-between">
            <span>
              {hook.inputMode === 'usdc' 
                ? `Payout in ${getCurrencySymbol(hook.fiatCurrency)} (${hook.fiatCurrency})`
                : `Withdrawal from USDC balance`}
            </span>
            {hook.rate && hook.amount && !isNaN(parseFloat(hook.amount)) && (
              <span className="font-medium text-foreground">
                ≈ {hook.inputMode === 'usdc' 
                  ? `${getCurrencySymbol(hook.fiatCurrency)}${(parseFloat(hook.amount) * hook.rate).toLocaleString()}`
                  : `$${(parseFloat(hook.amount) / hook.rate).toLocaleString(undefined, {maximumFractionDigits: 2})}`
                }
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
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
            label="Destination Bank Account"
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
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 text-center">
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
          </>
        )}
      </div>
    );
  }

  return null;
}

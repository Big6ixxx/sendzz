'use client';

import { CurrencySelector } from '@/components/CurrencySelector';
import { getCurrencySymbol } from '@/lib/currency-config';
import {
  ChevronRight,
  Landmark,
  Loader2,
  ShieldCheck
} from 'lucide-react';
import { BankSelector } from './BankSelector';
import { useDepositWithdraw } from './useDepositWithdraw';

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
              Amount to Withdraw (USDC)
            </label>
            <CurrencySelector
              selected={hook.fiatCurrency}
              onChange={hook.setFiatCurrency}
              includeUsd={false}
              size="sm"
            />
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-muted-foreground">
              $
            </span>
            <input
              type="number"
              value={hook.amount}
              onChange={(e) => hook.setAmount(e.target.value)}
              className="input-elegant pl-8 text-xl font-bold"
              placeholder="100.00"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 px-1">
            Payout in {getCurrencySymbol(hook.fiatCurrency)} ({hook.fiatCurrency})
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

  return null;
}

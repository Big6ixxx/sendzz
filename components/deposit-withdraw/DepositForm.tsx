'use client';

import { CurrencySelector } from '@/components/CurrencySelector';
import { getCurrencySymbol } from '@/lib/currency-config';
import { cn } from '@/lib/utils';
import { AlertCircle, CheckCircle2, Clock, Copy, Loader2, Plus } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { calculatePaycrestBaseAmount, PAYCREST_PARTNER_FEE_PERCENT } from '@/lib/paycrest/config';
import { BankSelector } from './BankSelector';
import { useDepositWithdraw } from './useDepositWithdraw';
import { ReceiptActions } from '@/components/receipt/ReceiptActions';
import { ReceiptData } from '@/lib/receipt/types';

interface DepositFormProps {
  hook: ReturnType<typeof useDepositWithdraw>;
}

export function DepositForm({ hook }: DepositFormProps) {
  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null);

  const estimatedUsdc =
    hook.rate && hook.amount
      ? (calculatePaycrestBaseAmount(parseFloat(hook.amount)) / hook.rate).toFixed(4)
      : null;

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
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-semibold text-muted-foreground">
                Amount to Deposit ({hook.fiatCurrency})
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
                {getCurrencySymbol(hook.fiatCurrency)}
              </span>
              <input
                type="number"
                value={hook.amount}
                onChange={(e) => hook.setAmount(e.target.value)}
                className="input-elegant pl-14 text-xl font-bold"
                placeholder="5,000"
              />
            </div>
          </div>

          <div className="p-4 bg-muted/30 rounded-2xl border border-border space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Exchange Rate</span>
              <span className="font-semibold">
                {hook.rateLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin inline" />
                ) : hook.rate ? (
                  `1 USDC = ${hook.rate.toLocaleString()} ${hook.fiatCurrency}`
                ) : (
                  <span className="text-red-400 font-bold uppercase text-[10px] tracking-widest">Unavailable</span>
                )}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Estimated Received</span>
              <span className="font-bold text-foreground">
                {hook.rateLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin inline" />
                ) : estimatedUsdc ? (
                  `${estimatedUsdc} USDC`
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Platform Fee</span>
              <span className="font-semibold text-foreground">{PAYCREST_PARTNER_FEE_PERCENT}%</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
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
          <p className="text-[10px] text-muted-foreground mt-2 px-1">
            * In case of any issues, funds will be returned to this account.
          </p>
        </div>

        <button
          onClick={() => hook.handleDepositInitiate()}
          disabled={
            hook.loading || hook.rateLoading || !hook.amount || !hook.bankDetails.accountName
          }
          className="btn-primary w-full gap-2 mt-4"
        >
          {hook.loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            'Continue to Deposit'
          )}
        </button>
      </div>
    );
  }

  if (hook.step === 2 && hook.order) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {secondsLeft !== null && (
          <div
            className={cn(
              'p-4 rounded-2xl border flex items-center justify-between',
              secondsLeft < 60
                ? 'bg-red-50 border-red-100 text-red-600 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400'
                : 'bg-muted/50 border-border',
            )}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">
                Expires In
              </span>
            </div>
            <span className="text-xl font-black tabular-nums">
              {Math.floor(secondsLeft / 60)}:
              {String(secondsLeft % 60).padStart(2, '0')}
            </span>
          </div>
        )}

        <div className="p-6 bg-foreground text-background rounded-2xl shadow-xl space-y-4">
          <p className="text-xs font-bold opacity-60 uppercase tracking-widest">
            Amount to Transfer
          </p>
          <h3 className="text-4xl font-black">
            {hook.order.providerAccount?.amountToTransfer}{' '}
            {hook.order.providerAccount?.currency}
          </h3>

          <div className="space-y-3 pt-4 border-t border-background/10">
            {[
              { label: 'Bank', value: hook.order.providerAccount?.institution },
              {
                label: 'Account',
                value: hook.order.providerAccount?.accountIdentifier,
                copy: true,
              },
              { label: 'Name', value: hook.order.providerAccount?.accountName },
            ].map((item) => (
              <div
                key={item.label}
                className="flex justify-between items-center text-sm"
              >
                <span className="opacity-60">{item.label}</span>
                <button
                  onClick={() =>
                    item.copy &&
                    (navigator.clipboard.writeText(item.value || ''),
                    toast.success('Copied!'))
                  }
                  className={cn(
                    'font-bold flex items-center gap-2',
                    item.copy &&
                      'hover:text-muted-foreground transition-colors',
                  )}
                >
                  {item.value} {item.copy && <Copy className="w-3 h-3" />}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-muted/50 p-4 rounded-xl border border-border flex gap-3">
          <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Please make the transfer from your personal bank account. Funds will
            be credited automatically once confirmed.
          </p>
        </div>

        {hook.polling ? (
          <div className="p-4 bg-muted/80 rounded-2xl border border-border text-center space-y-2">
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-foreground" />
              <span className="font-bold uppercase tracking-wider text-sm">
                Checking Payment
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold">
              Status: {hook.txStatus || 'Pending'}
            </p>
          </div>
        ) : (
          <button onClick={hook.startPolling} className="btn-primary w-full">
            I Have Made the Transfer
          </button>
        )}
      </div>
    );
  }

  if (hook.step === 3) {
    const depositReceipt: ReceiptData = {
      id: hook.order?.id ?? 'dep-pending',
      type: 'deposit',
      status: 'confirmed',
      timestamp: new Date().toISOString(),
      amountUsdc:
        hook.rate && hook.amount
          ? calculatePaycrestBaseAmount(parseFloat(hook.amount)) / hook.rate
          : 0,
      fiatAmount: parseFloat(hook.amount),
      fiatCurrency: hook.fiatCurrency,
      exchangeRate: hook.rate ?? undefined,
      orderId: hook.order?.id,
    };

    return (
      <div className="flex flex-col items-center justify-center py-10 text-center space-y-6 animate-in zoom-in duration-500">
        <div className="w-20 h-20 bg-green-500 text-background rounded-full flex items-center justify-center shadow-lg shadow-green-200 dark:shadow-green-900/20">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-black uppercase tracking-tighter">
            Success!
          </h2>
          <p className="text-muted-foreground">
            Your funds have been deposited and are ready to use.
          </p>
        </div>

        <div className="w-full space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60 text-center">
            Transaction Receipt
          </p>
          <ReceiptActions data={depositReceipt} variant="light" />
        </div>

        {hook.showSavePrompt && (
          <div className="w-full max-w-sm p-6 bg-accent/5 border border-accent/20 rounded-3xl space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent/10 rounded-xl">
                <Plus className="w-5 h-5 text-accent" />
              </div>
              <div className="text-left">
                <p className="font-bold text-sm">Save this refund bank?</p>
                <p className="text-[10px] text-muted-foreground uppercase font-bold">Securely store your bank details for future refunds</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => hook.setShowSavePrompt(false)}
                className="h-10 rounded-xl text-[10px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/5 transition-colors text-foreground"
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

        <button
          onClick={() => hook.onClose?.()}
          className="btn-secondary px-10"
        >
          View Dashboard
        </button>
      </div>
    );
  }

  return null;
}

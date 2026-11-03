'use client';

import { CurrencySelector } from '@/components/CurrencySelector';
import { getCurrencySymbol } from '@/lib/currency-config';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { AmountField, AsideFigure, AsideRows, FlowButton, FlowFrame, FlowInput, FlowSteps, Notice } from '@/components/flow/ui';
import { useBatchSend } from './useBatchSend';
import { BATCH_STEPS } from './steps';
import { formatUsd } from '@/lib/format-usdc';

interface AmountConfigProps {
  hook: ReturnType<typeof useBatchSend>;
  maxAmount: number;
}

export function AmountConfig({ hook, maxAmount }: AmountConfigProps) {
  const isOverBalance = hook.totalAmount > maxAmount;
  const isFiat = hook.currency !== 'USD';
  const symbol = isFiat ? getCurrencySymbol(hook.currency) : '$';

  return (
    <FlowFrame
      main={
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <FlowSteps steps={BATCH_STEPS} current={1} />

          <AmountField
            label="Each person gets"
            value={hook.amount}
            onChange={(v) => hook.setAmount(v.replace(/[^0-9.]/g, ''))}
            symbol={symbol}
            placeholder="0.00"
            autoFocus
            currency={
              <CurrencySelector
                selected={hook.currency}
                onChange={(c) => {
                  hook.setCurrency(c);
                  hook.setAmount('');
                }}
                size="md"
              />
            }
            footer={
              <div className="flex flex-wrap gap-1.5">
                {[5, 10, 25, 50, 100].map((v) => {
                  const val = isFiat ? v * 1000 : v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => hook.setAmount(val.toString())}
                      className="rounded-full bg-[var(--lp-cream)] px-3.5 py-1.5 text-[14px] font-semibold transition-colors hover:bg-[#ece6da]"
                    >
                      {isFiat ? `${symbol}${v}k` : `$${v}`}
                    </button>
                  );
                })}
              </div>
            }
          />

          {isOverBalance && (
            <Notice tone="danger" title="That's more than your balance">
              {formatUsd(hook.totalAmount)} in total, and you have {formatUsd(maxAmount)} available. Lower the amount, or remove some people.
            </Notice>
          )}

          <FlowInput
            label={
              <>
                What&apos;s it for? <span className="font-normal text-[var(--lp-muted)]">(optional)</span>
              </>
            }
            type="text"
            placeholder="e.g. Payroll, May 2026"
            value={hook.note}
            onChange={(e) => hook.setNote(e.target.value)}
          />
        </div>
      }
      aside={
        <div className="space-y-6">
          <AsideFigure label="Total" value={formatUsd(hook.totalAmount)} unit="USDC" />
          <AsideRows
            rows={[
              { label: 'People', value: hook.validRecipients.length },
              { label: 'Each', value: formatUsd(hook.amountUsd) },
              { label: 'Available', value: formatUsd(maxAmount) },
            ]}
          />
        </div>
      }
      action={
        <div className="flex gap-2">
          <FlowButton tone="quiet" onClick={() => hook.setStep('recipients')} className="w-auto shrink-0 px-5" aria-label="Back">
            <ArrowLeft className="size-5" />
          </FlowButton>
          <FlowButton tone="accent" onClick={() => hook.setStep('preview')} disabled={!hook.amount || hook.amountUsd <= 0 || isOverBalance} className="flex-1">
            Check the list <ArrowRight className="size-5" />
          </FlowButton>
        </div>
      }
    />
  );
}

'use client';

import { ArrowLeft } from 'lucide-react';
import { AsideFigure, AsideRows, FlowButton, FlowFrame, FlowSteps, Notice } from '@/components/flow/ui';
import { useBatchSend } from './useBatchSend';
import { BATCH_STEPS } from './steps';
import { formatUsd } from '@/lib/format-usdc';

interface ConfirmStepProps {
  hook: ReturnType<typeof useBatchSend>;
}

export function ConfirmStep({ hook }: ConfirmStepProps) {
  const count = hook.validRecipients.length;
  return (
    <FlowFrame
      main={
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <FlowSteps steps={BATCH_STEPS} current={3} />
          <div>
            <p className="lp-display text-[clamp(26px,6.4vw,34px)] font-semibold leading-tight tracking-[-0.03em]">
              Ready to <span className="lp-serif font-normal">send?</span>
            </p>
            <p className="mt-2 text-[16px] leading-[1.5] text-[var(--lp-body)]">
              {formatUsd(hook.amountUsd)} each to {count} {count === 1 ? 'person' : 'people'}
              {hook.note ? `, for “${hook.note}”` : ''}.
            </p>
          </div>
          <Notice tone="danger" title="This can't be undone">
            Once it&apos;s sent it can&apos;t be pulled back. Check every email on the list is right.
          </Notice>
        </div>
      }
      aside={
        <div className="space-y-6">
          <AsideFigure label="Total" value={formatUsd(hook.totalAmount)} unit="USDC" />
          <AsideRows
            rows={[
              { label: 'People', value: count },
              { label: 'Each', value: formatUsd(hook.amountUsd) },
              { label: 'Fees', value: 'Free', tone: 'good' },
            ]}
          />
        </div>
      }
      action={
        <div className="flex gap-2">
          <FlowButton tone="quiet" onClick={() => hook.setStep('preview')} className="w-auto shrink-0 px-5" aria-label="Back">
            <ArrowLeft className="size-5" />
          </FlowButton>
          <FlowButton tone="accent" onClick={() => hook.handleConfirm()} className="flex-1">
            Send {formatUsd(hook.totalAmount)}
          </FlowButton>
        </div>
      }
    />
  );
}

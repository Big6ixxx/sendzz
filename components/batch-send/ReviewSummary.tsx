'use client';

import { ArrowLeft, ArrowRight, Search, X } from 'lucide-react';
import * as React from 'react';
import { AsideFigure, AsideRows, FlowButton, FlowFrame, FlowSteps } from '@/components/flow/ui';
import { useBatchSend } from './useBatchSend';
import { BATCH_STEPS } from './steps';
import { formatUsd } from '@/lib/format-usdc';

interface ReviewSummaryProps {
  hook: ReturnType<typeof useBatchSend>;
}

export function ReviewSummary({ hook }: ReviewSummaryProps) {
  const [search, setSearch] = React.useState('');
  const filtered = hook.validRecipients.filter((r) => r.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <FlowFrame
      main={
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <FlowSteps steps={BATCH_STEPS} current={2} />

          <label className="flex h-12 items-center gap-3 rounded-full bg-[var(--lp-surface)] px-4 shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)]">
            <Search className="size-4 shrink-0 text-[var(--lp-muted)]" />
            <input
              type="text"
              placeholder="Search the list"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--lp-placeholder)] md:text-[15px]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <div className="lp-card rounded-[22px]">
            <div className="lp-mono flex justify-between border-b border-[var(--lp-rule)] px-5 py-3 text-[12px] uppercase text-[var(--lp-muted)]">
              <span>Person</span>
              <span className="pr-10">Gets</span>
            </div>
            <ul className="divide-y divide-[var(--lp-soft-2)]">
              {filtered.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1 truncate text-[15px]">{r.email}</span>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums">{formatUsd(hook.amountUsd)}</span>
                  <button
                    onClick={() => hook.removeRecipient(r.id)}
                    aria-label={`Remove ${r.email}`}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[#a1462c]/10 hover:text-[var(--lp-danger)]"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-5 py-10 text-center text-[15px] text-[var(--lp-muted)]">Nobody on the list matches that.</li>}
            </ul>
          </div>
        </div>
      }
      aside={
        <div className="space-y-6">
          <AsideFigure label="Total" value={formatUsd(hook.totalAmount)} unit="USDC" />
          <AsideRows
            rows={[
              { label: 'People', value: hook.validRecipients.length },
              { label: 'Each', value: formatUsd(hook.amountUsd) },
            ]}
          />
        </div>
      }
      action={
        <div className="flex gap-2">
          <FlowButton tone="quiet" onClick={() => hook.setStep('amount')} className="w-auto shrink-0 px-5" aria-label="Back">
            <ArrowLeft className="size-5" />
          </FlowButton>
          <FlowButton tone="accent" onClick={() => hook.setStep('confirm')} className="flex-1">
            Continue <ArrowRight className="size-5" />
          </FlowButton>
        </div>
      }
    />
  );
}

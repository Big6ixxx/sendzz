'use client';

import { RotateCcw, UserPlus } from 'lucide-react';
import { AsideFigure, AsideRows, FlowButton, FlowFrame, FlowSuccess, Notice, FlowLabel } from '@/components/flow/ui';
import { toast } from 'sonner';
import { useBatchSend } from './useBatchSend';
import { addContact, getUserContacts } from '@/lib/supabase/contacts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

interface ExecutionStatusProps {
  hook: ReturnType<typeof useBatchSend>;
  onClose: () => void;
}

export function ExecutionStatus({ hook, onClose }: ExecutionStatusProps) {
  const [savePending, setSavePending] = useState(false);
  const [savedBatch, setSavedBatch] = useState(false);
  const queryClient = useQueryClient();

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts', hook.senderEmail],
    queryFn: () => getUserContacts(),
    enabled: !!hook.senderEmail,
  });

  const successes = hook.batchResults.filter(
    (r) => r.status === 'success' || r.status === 'claim_required',
  );

  const newRecipients = successes
    .map(s => s.email)
    .filter(email => !contacts.some(c => c.email.toLowerCase() === email.toLowerCase()));
  const failures = hook.batchResults.filter((r) => r.status === 'failed');

  const saveAll = async () => {
    setSavePending(true);
    try {
      await Promise.all(newRecipients.map((email) => addContact({ contactEmail: email, contactName: email.split('@')[0] })));
      queryClient.invalidateQueries({ queryKey: ['contacts', hook.senderEmail] });
      toast.success(`Saved ${newRecipients.length} contacts!`);
      setSavedBatch(true);
    } catch (err) {
      console.error('Failed to save batch contacts', err);
    } finally {
      setSavePending(false);
    }
  };

  if (hook.step === 'processing') {
    const percent = hook.progress.total > 0 ? Math.round((hook.progress.done / hook.progress.total) * 100) : 0;
    const C = 2 * Math.PI * 88;

    return (
      <FlowFrame
        main={
          <div className="flex flex-col items-center justify-center gap-6 py-8 text-center animate-in fade-in zoom-in-95 duration-500">
            <div className="relative">
              <svg className="size-48 -rotate-90" viewBox="0 0 192 192" aria-hidden>
                <circle cx="96" cy="96" r="88" className="stroke-[var(--lp-rule)]" strokeWidth="10" fill="none" />
                <circle
                  cx="96"
                  cy="96"
                  r="88"
                  strokeWidth="10"
                  fill="none"
                  strokeDasharray={C}
                  strokeDashoffset={C - (C * percent) / 100}
                  strokeLinecap="round"
                  className="stroke-[var(--lp-ink)] transition-[stroke-dashoffset] duration-500 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="lp-display text-[44px] leading-none tracking-[-0.04em] tabular-nums">{percent}%</span>
              </div>
            </div>
            <div>
              <h3 className="lp-display text-[clamp(28px,7vw,36px)] leading-[1] tracking-[-0.04em]">
                Sending <span className="lp-serif">to everyone.</span>
              </h3>
              <p className="mt-2 text-[15px] text-[var(--lp-body)]">
                {hook.progress.done} of {hook.progress.total} sent. Keep this open.
              </p>
            </div>
          </div>
        }
      />
    );
  }

  if (hook.step === 'results') {
    const saveOffer =
      !savedBatch && newRecipients.length > 0 ? (
        <div className="lp-card flex items-center gap-3 rounded-[22px] p-4 text-left animate-in fade-in slide-in-from-top-2 duration-500">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-cream)]">
            <UserPlus className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Save them as contacts?</p>
            <p className="text-[13px] text-[var(--lp-muted)]">
              {newRecipients.length} new {newRecipients.length > 1 ? 'people' : 'person'} on this list
            </p>
          </div>
          <FlowButton onClick={saveAll} loading={savePending} className="h-10 w-auto shrink-0 px-4 text-[14px]">
            Save all
          </FlowButton>
        </div>
      ) : savedBatch ? (
        <Notice tone="success" title="Saved to your contacts" />
      ) : null;

    return (
      <FlowFrame
        main={
          failures.length === 0 ? (
            <div className="py-4">
              <FlowSuccess title="Everyone" italic="paid." body={`${successes.length} ${successes.length === 1 ? 'payment' : 'payments'} sent. New people get a link to claim theirs.`}>
                {saveOffer}
              </FlowSuccess>
            </div>
          ) : (
            <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div>
                <p className="lp-display text-[clamp(26px,6.4vw,34px)] font-semibold leading-tight tracking-[-0.03em]">
                  Some didn&apos;t <span className="lp-serif font-normal">go through.</span>
                </p>
                <p className="mt-2 text-[15px] text-[var(--lp-body)]">
                  {successes.length} sent, {failures.length} failed. Nothing was taken for the ones that failed.
                </p>
              </div>
              <div className="lp-card rounded-[22px]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--lp-rule)] px-5 py-3">
                  <FlowLabel as="span">To retry</FlowLabel>
                  <button
                    onClick={() => hook.handleConfirm(failures.map((f) => f.email))}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lp-ink)] px-3 py-1.5 text-[13px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
                  >
                    <RotateCcw className="size-3.5" /> Retry all
                  </button>
                </div>
                <ul className="max-h-[300px] divide-y divide-[var(--lp-soft-2)] overflow-y-auto">
                  {failures.map((f) => (
                    <li key={f.email} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{f.email}</p>
                        <p className="truncate text-[13px] text-[var(--lp-danger)]">{f.error || 'Network error'}</p>
                      </div>
                      <button
                        onClick={() => hook.handleConfirm([f.email])}
                        aria-label={`Retry ${f.email}`}
                        className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-[var(--lp-cream)]"
                      >
                        <RotateCcw className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {saveOffer}
            </div>
          )
        }
        aside={
          failures.length > 0 ? (
            <div className="space-y-6">
              <AsideFigure label="Sent" value={successes.length} unit={`of ${hook.batchResults.length}`} />
              <AsideRows
                rows={[
                  { label: 'Paid', value: successes.length, tone: 'good' },
                  { label: 'Failed', value: failures.length },
                ]}
              />
            </div>
          ) : undefined
        }
        action={<FlowButton onClick={onClose}>Back to dashboard</FlowButton>}
      />
    );
  }

  return null;
}

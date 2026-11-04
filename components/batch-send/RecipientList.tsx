'use client';

import { cn } from '@/lib/utils';
import { ArrowRight, Mail, X } from 'lucide-react';
import { AsideFigure, FlowButton, FlowFrame, FlowSteps } from '@/components/flow/ui';
import { BATCH_STEPS } from './steps';
import * as React from 'react';
import { useBatchSend } from './useBatchSend';
import { AddContactModal } from '../contacts/AddContactModal';
import { RecipientSuggestions } from '@/components/contacts/RecipientSuggestions';
import { ImportFromFile } from './ImportFromFile';
import { useRecipientList } from './useRecipientList';

interface RecipientListProps { hook: ReturnType<typeof useBatchSend>; senderEmail: string; }

export function RecipientList({ hook, senderEmail }: RecipientListProps) {
  const {
    inputVal,
    setInputVal,
    isDrag,
    setIsDrag,
    showSuggestions,
    setShowSuggestions,
    isAddingContact,
    setIsAddingContact,
    contacts,
    commitInput,
    onKeyDown,
    handleFile,
  } = useRecipientList({ hook, senderEmail });
  const invalid = hook.recipients.filter((r) => !r.valid);
  const ready = hook.validRecipients;

  return (
    <FlowFrame
      main={
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <FlowSteps steps={BATCH_STEPS} current={0} />

          <div
            className={cn(
              'lp-card relative min-h-[180px] cursor-text rounded-[24px] p-4 outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)]',
              isDrag && 'outline-dashed outline-[var(--lp-ink)]',
            )}
            onDragOver={(e) => (e.preventDefault(), setIsDrag(true))}
            onDragLeave={() => setIsDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            onClick={() => document.getElementById('batch-input')?.focus()}
          >
            {hook.recipients.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {hook.recipients.map((r) => (
                  <span
                    key={r.id}
                    className={cn(
                      'inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-3 pr-1.5 text-[14px] font-medium',
                      r.valid ? 'bg-[var(--lp-ink)] text-[var(--lp-cream)]' : 'bg-[#a1462c]/10 text-[var(--lp-danger)] line-through decoration-1',
                    )}
                  >
                    <span className="truncate">{r.email}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        hook.removeRecipient(r.id);
                      }}
                      aria-label={`Remove ${r.email}`}
                      className="grid size-5 shrink-0 place-items-center rounded-full opacity-70 transition-opacity hover:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative z-50 flex items-center gap-3">
              <Mail className="size-5 shrink-0 text-[var(--lp-muted)]" />
              <input
                id="batch-input"
                type="text"
                className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-[var(--lp-placeholder)]"
                placeholder={hook.recipients.length === 0 ? 'Type or paste email addresses' : 'Add more'}
                value={inputVal}
                onChange={(e) => {
                  setInputVal(e.target.value);
                  setShowSuggestions(true);
                }}
                onKeyDown={onKeyDown}
                onBlur={commitInput}
                onFocus={() => setShowSuggestions(true)}
                autoComplete="off"
              />
            </div>
            <p className="mt-3 text-[13px] text-[var(--lp-muted)]">Press Enter or a comma after each one, or drop a CSV here.</p>

            <RecipientSuggestions
              isOpen={showSuggestions}
              inputVal={inputVal}
              contacts={contacts}
              onSelect={(email) => {
                hook.addRecipients([email]);
                setInputVal('');
                setShowSuggestions(false);
              }}
              onAddNew={() => {
                setIsAddingContact(true);
                setShowSuggestions(false);
              }}
            />

            {isDrag && (
              <div className="absolute inset-0 grid place-items-center rounded-[24px] bg-[var(--lp-cream)]/90 text-[18px] font-semibold">
                Drop the file to import it
              </div>
            )}
          </div>

          {hook.recipients.length > 0 && (
            <div className="flex items-center justify-between px-1 text-[14px]">
              <span className="flex gap-3">
                {ready.length > 0 && <span className="font-semibold">{ready.length} ready</span>}
                {invalid.length > 0 && <span className="text-[var(--lp-danger)]">{invalid.length} not valid</span>}
              </span>
              <button onClick={() => hook.setRecipients([])} className="font-semibold text-[var(--lp-muted)] transition-colors hover:text-[var(--lp-ink)]">
                Clear all
              </button>
            </div>
          )}

          <ImportFromFile onFileSelected={handleFile} />

          <AddContactModal isOpen={isAddingContact} onClose={() => setIsAddingContact(false)} senderEmail={senderEmail} defaultEmail={inputVal} />
        </div>
      }
      aside={
        <div className="space-y-6">
          <AsideFigure label="Paying" value={ready.length} unit={ready.length === 1 ? 'person' : 'people'} />
          {ready.length > 0 ? (
            <ul className="space-y-0">
              {ready.slice(0, 6).map((r) => (
                <li key={r.id} className="truncate border-b border-[rgba(246,242,233,0.12)] py-2.5 text-[15px] last:border-b-0">
                  {r.email}
                </li>
              ))}
              {ready.length > 6 && <li className="pt-2.5 text-[14px] text-[#a9c2b5]">and {ready.length - 6} more</li>}
            </ul>
          ) : (
            <p className="text-[15px] leading-[1.5] text-[#a9c2b5]">
              Add the emails of everyone you&apos;re paying. New to Sendzz? They get a link to claim it.
            </p>
          )}
        </div>
      }
      action={
        <FlowButton tone="accent" onClick={() => hook.setStep('amount')} disabled={ready.length === 0}>
          Continue <ArrowRight className="size-5" />
        </FlowButton>
      }
    />
  );
}

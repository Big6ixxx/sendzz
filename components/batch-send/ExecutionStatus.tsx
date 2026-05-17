'use client';

import { cn } from '@/lib/utils';
import { RotateCcw, Sparkles, UserPlus, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useBatchSend } from './useBatchSend';
import { addContact, getUserContacts } from '@/lib/supabase/contacts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

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
    queryFn: () => getUserContacts(hook.senderEmail),
    enabled: !!hook.senderEmail,
  });

  const successes = hook.batchResults.filter(
    (r) => r.status === 'success' || r.status === 'claim_required',
  );

  const newRecipients = successes
    .map(s => s.email)
    .filter(email => !contacts.some(c => c.email.toLowerCase() === email.toLowerCase()));
  const failures = hook.batchResults.filter((r) => r.status === 'failed');

  if (hook.step === 'processing') {
    const percent =
      hook.progress.total > 0
        ? Math.round((hook.progress.done / hook.progress.total) * 100)
        : 0;

    return (
      <div className="py-12 flex flex-col items-center justify-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="relative">
          <svg className="w-48 h-48 transform -rotate-90">
            <circle
              cx="96"
              cy="96"
              r="88"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              className="text-muted/30"
            />
            <circle
              cx="96"
              cy="96"
              r="88"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              strokeDasharray={552.92}
              strokeDashoffset={552.92 - (552.92 * percent) / 100}
              strokeLinecap="round"
              className="text-foreground transition-all duration-500 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-4xl font-black">{percent}%</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Sending
            </span>
          </div>
        </div>

        <div className="text-center space-y-2">
          <h3 className="text-2xl font-black uppercase tracking-tighter">
            Processing Batch
          </h3>
          <p className="text-sm font-medium text-muted-foreground">
            {hook.progress.done} of {hook.progress.total} transfers completed
          </p>
        </div>
      </div>
    );
  }

  if (hook.step === 'results') {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-6 bg-muted/30 border border-border rounded-2xl text-center space-y-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Successful
            </p>
            <p className="text-5xl font-black text-green-600">
              {successes.length}
            </p>
          </div>
          <div
            className={cn(
              'p-6 border rounded-2xl text-center space-y-1',
              failures.length > 0
                ? 'bg-red-50 border-red-100'
                : 'bg-muted/30 border-border',
            )}
          >
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Failed
            </p>
            <p
              className={cn(
                'text-5xl font-black',
                failures.length > 0 ? 'text-red-600' : 'text-foreground',
              )}
            >
              {failures.length}
            </p>
          </div>
        </div>

        {failures.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <h4 className="text-sm font-bold uppercase tracking-tighter text-red-600">
                Errors to Review
              </h4>
              <button
                onClick={() => hook.handleConfirm(failures.map((f) => f.email))}
                className="text-[10px] font-bold uppercase bg-foreground text-background px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity flex items-center gap-2"
              >
                <RotateCcw className="w-3 h-3" /> Retry All Failed
              </button>
            </div>

            <div className="max-h-[300px] overflow-y-auto border border-border rounded-2xl bg-muted/10 divide-y divide-border/50">
              {failures.map((f) => (
                <div
                  key={f.email}
                  className="p-4 flex items-center justify-between group hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{f.email}</p>
                    <p className="text-[10px] text-red-500 font-medium uppercase tracking-tight truncate">
                      {f.error || 'Network Error'}
                    </p>
                  </div>
                  <button
                    onClick={() => hook.handleConfirm([f.email])}
                    className="p-2 hover:bg-background rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-12 bg-muted/30 border border-border rounded-3xl flex flex-col items-center justify-center space-y-6 text-center">
            <div className="w-20 h-20 bg-green-500 text-background rounded-full flex items-center justify-center shadow-lg shadow-green-100">
              <Sparkles className="w-10 h-10" />
            </div>
            <div className="space-y-2 px-6">
              <h3 className="text-3xl font-black uppercase tracking-tighter">
                Batch Complete!
              </h3>
              <p className="text-muted-foreground text-sm">
                All funds have been successfully dispatched to your recipients.
              </p>
            </div>
          </div>
        )}

        {/* New Contacts Prompt for Batch */}
        {!savedBatch && newRecipients.length > 0 && hook.step === 'results' && (
          <div className="p-6 bg-accent/5 border border-accent/20 rounded-3xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent/10 rounded-xl">
                <UserPlus className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-white uppercase tracking-tight">Save New Contacts?</h4>
                <p className="text-[10px] text-white/40 font-medium uppercase tracking-widest">
                  Found {newRecipients.length} new recipient{newRecipients.length > 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={async () => {
                  setSavePending(true);
                  try {
                    await Promise.all(
                      newRecipients.map(email => 
                        addContact({
                          userEmail: hook.senderEmail,
                          contactEmail: email,
                          contactName: email.split('@')[0]
                        })
                      )
                    );
                    queryClient.invalidateQueries({ queryKey: ['contacts', hook.senderEmail] });
                    toast.success(`Saved ${newRecipients.length} contacts!`);
                    setSavedBatch(true);
                  } catch (err) {
                    console.error('Failed to save batch contacts', err);
                  } finally {
                    setSavePending(false);
                  }
                }}
                disabled={savePending}
                className="btn-accent h-10 px-4 text-[10px] gap-2 shrink-0"
              >
                {savePending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save All'}
              </button>
            </div>
          </div>
        )}

        {savedBatch && (
          <div className="p-4 bg-accent/10 border border-accent/20 rounded-2xl flex items-center gap-3 animate-in fade-in zoom-in duration-300">
            <CheckCircle2 className="w-5 h-5 text-accent" />
            <p className="text-xs font-bold text-accent uppercase tracking-widest">Address book updated!</p>
          </div>
        )}

        <button onClick={onClose} className="btn-primary w-full h-14 text-lg">
          Back to Dashboard
        </button>
      </div>
    );
  }

  return null;
}

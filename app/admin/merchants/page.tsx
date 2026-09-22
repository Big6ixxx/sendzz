'use client';

/**
 * Merchant applications awaiting a decision.
 *
 * Approving one moves a referrer onto the track that pays cash out of the treasury, so the
 * queue shows both sides of the question: what the applicant claims, and what their network
 * has actually done. The second is the only one we can verify, and it is deliberately next to
 * the first rather than a click away.
 *
 * A rejection asks for a note because it is shown to the applicant. "No" with no reason
 * produces a support conversation; "not yet, come back when your group is actually
 * transacting" produces a better application later.
 */

import {
  decideMerchantApplication,
  getPendingMerchantApplications,
  type PendingMerchantApplication,
} from '@/lib/actions/merchant';
import { usePrivy } from '@privy-io/react-auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, Loader2, RefreshCw, Store, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export default function AdminMerchants() {
  const { getAccessToken } = usePrivy();
  const queryClient = useQueryClient();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const { data: applications = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['merchant-applications'],
    queryFn: async () => getPendingMerchantApplications((await getAccessToken()) ?? undefined),
  });

  const decide = useMutation({
    mutationFn: async (input: { id: string; approve: boolean; note?: string }) => {
      const result = await decideMerchantApplication({
        applicationId: input.id,
        approve: input.approve,
        decisionNote: input.note,
        accessToken: (await getAccessToken()) ?? undefined,
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    onSuccess: (_data, input) => {
      toast.success(input.approve ? 'Approved — they are now a Merchant.' : 'Application declined.');
      setNoteFor(null);
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['merchant-applications'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-display font-bold tracking-tight text-brand-secondary">
            Merchant applications
          </h1>
          <p className="text-brand-secondary/40 font-medium">
            Approving moves a referrer onto the cash revenue share
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary gap-2 shrink-0"
        >
          <RefreshCw className={isFetching ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="h-[40vh] flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-brand-secondary/25" />
        </div>
      ) : applications.length === 0 ? (
        <div className="card-glass p-12 text-center space-y-3">
          <Store className="w-8 h-8 mx-auto text-brand-secondary/20" />
          <p className="text-sm text-brand-secondary/50">Nothing waiting.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {applications.map((application) => (
            <ApplicationCard
              key={application.id}
              application={application}
              busy={decide.isPending}
              noteOpen={noteFor === application.id}
              note={note}
              onNoteChange={setNote}
              onOpenNote={() => {
                setNoteFor(application.id);
                setNote('');
              }}
              onCancelNote={() => setNoteFor(null)}
              onApprove={() => decide.mutate({ id: application.id, approve: true })}
              onReject={() =>
                decide.mutate({ id: application.id, approve: false, note })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicationCard({
  application,
  busy,
  noteOpen,
  note,
  onNoteChange,
  onOpenNote,
  onCancelNote,
  onApprove,
  onReject,
}: {
  application: PendingMerchantApplication;
  busy: boolean;
  noteOpen: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onOpenNote: () => void;
  onCancelNote: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="card-glass p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-bold text-brand-secondary break-all">{application.userEmail}</p>
          <p className="text-[12px] text-brand-secondary/40 mt-0.5">
            Applied {format(new Date(application.createdAt), 'd MMM yyyy')}
          </p>
        </div>

        {/* What we can verify, beside what they claimed. */}
        <div className="flex gap-6 shrink-0">
          <Figure
            label="Network this month"
            value={`$${application.monthlyNetworkVolumeUsdc.toLocaleString()}`}
          />
          <Figure label="People referred" value={String(application.refereeCount)} />
          <Figure
            label="They expect"
            value={
              application.expectedMonthlyVolumeUsdc != null
                ? `$${application.expectedMonthlyVolumeUsdc.toLocaleString()}`
                : '—'
            }
          />
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Organisation" value={application.organisation} />
        <Field label="Audience" value={application.audience} />
      </dl>
      {application.notes && <Field label="Notes" value={application.notes} />}

      {noteOpen ? (
        <div className="space-y-3 pt-2 border-t border-white/5">
          <label className="block">
            <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
              Why not? — shown to them
            </span>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Not yet — come back when your group is transacting regularly."
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-brand-secondary focus:outline-none focus:border-accent/60"
            />
          </label>
          <div className="flex gap-3">
            <button onClick={onCancelNote} disabled={busy} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              onClick={onReject}
              disabled={busy}
              className="btn-primary flex-1 !bg-red-500 !text-white hover:!bg-red-600"
            >
              {busy ? 'Declining…' : 'Decline'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 pt-2 border-t border-white/5">
          <button onClick={onOpenNote} disabled={busy} className="btn-secondary flex-1 gap-2">
            <X className="w-4 h-4" />
            Decline
          </button>
          <button onClick={onApprove} disabled={busy} className="btn-primary flex-1 gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Approve as Merchant
          </button>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-secondary/30">
        {label}
      </p>
      <p className="font-bold text-brand-secondary mt-0.5">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-secondary/30">
        {label}
      </dt>
      <dd className="text-[13px] text-brand-secondary/80 mt-1 leading-relaxed whitespace-pre-wrap">
        {value || '—'}
      </dd>
    </div>
  );
}

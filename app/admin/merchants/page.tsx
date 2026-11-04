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

import { decideMerchantApplication, getPendingMerchantApplications, type PendingMerchantApplication } from '@/lib/actions/merchant';
import { usePrivy } from '@privy-io/react-auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, Loader2, Store, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar, CardsShimmer, EmptyState, PageHeader, Panel, PrimaryButton, RefreshButton, SecondaryButton } from '../components/ui';
import { FlowLabel } from '@/components/flow/ui';

export default function AdminMerchants() {
  const { getAccessToken } = usePrivy();
  const queryClient = useQueryClient();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const { data: applications = [], isPending, refetch, isFetching } = useQuery({
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
      toast.success(input.approve ? 'Approved. They are now a Merchant.' : 'Application declined.');
      setNoteFor(null);
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['merchant-applications'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader
        eyebrow="Merchants"
        title="Merchant"
        italic="applications."
        aside="Approving moves a referrer onto the cash revenue share, paid from the treasury."
        actions={<RefreshButton onClick={() => refetch()} spinning={isFetching} disabled={isFetching} />}
      />

      {isPending ? (
        <CardsShimmer />
      ) : applications.length === 0 ? (
        <Panel>
          <EmptyState icon={<Store className="size-5" />} title="Nothing" italic="waiting." body="New merchant applications show up here for a decision." />
        </Panel>
      ) : (
        <div className="space-y-4 md:space-y-5">
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
              onReject={() => decide.mutate({ id: application.id, approve: false, note })}
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
    <Panel className="p-5 sm:p-8">
      <div className="flex items-center gap-3">
        <Avatar email={application.userEmail} />
        <div className="min-w-0">
          <p className="break-all text-[17px] font-semibold">{application.userEmail}</p>
          <p className="text-[13px] text-[var(--lp-muted)]">Applied {format(new Date(application.createdAt), 'd MMM yyyy')}</p>
        </div>
      </div>

      {/* What we can verify, beside what they claimed. */}
      <dl className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Figure label="Network this month" value={`$${application.monthlyNetworkVolumeUsdc.toLocaleString()}`} verified />
        <Figure label="People referred" value={String(application.refereeCount)} verified />
        <Figure
          label="They expect"
          value={application.expectedMonthlyVolumeUsdc != null ? `$${application.expectedMonthlyVolumeUsdc.toLocaleString()}` : '—'}
        />
      </dl>

      <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <Field label="Organisation" value={application.organisation} />
        <Field label="Audience" value={application.audience} />
        {application.notes && (
          <div className="sm:col-span-2">
            <Field label="Notes" value={application.notes} />
          </div>
        )}
      </dl>

      <div className="mt-6 border-t border-[var(--lp-rule)] pt-5">
        {noteOpen ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-[14px] font-semibold">
                Why not? <span className="font-normal text-[var(--lp-muted)]">This is shown to them.</span>
              </span>
              <textarea
                value={note}
                onChange={(e) => onNoteChange(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Not yet. Come back when your group is transacting regularly."
                className="w-full rounded-[20px] bg-[var(--lp-cream)] px-4 py-3 text-base outline-2 outline-offset-2 outline-transparent transition-[outline-color] focus:outline-[var(--lp-ink)] sm:text-[15px]"
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <SecondaryButton onClick={onCancelNote} disabled={busy} className="sm:flex-1">
                Cancel
              </SecondaryButton>
              <button
                onClick={onReject}
                disabled={busy}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#a1462c] px-5 text-[15px] font-semibold text-white transition-[scale,opacity] duration-150 active:scale-[0.97] disabled:opacity-40 sm:flex-1"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                {busy ? 'Declining…' : 'Decline application'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <SecondaryButton onClick={onOpenNote} disabled={busy} className="sm:flex-1">
              <X className="size-4" /> Decline
            </SecondaryButton>
            <PrimaryButton onClick={onApprove} disabled={busy} className="sm:flex-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Approve as Merchant
            </PrimaryButton>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Figure({ label, value, verified }: { label: string; value: string; verified?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--lp-cream)] px-4 py-3 sm:block">
      <dt className="flex items-center gap-2 text-[13px] text-[var(--lp-muted)]">
        {label}
        <span
          className={
            verified
              ? 'rounded-full bg-[var(--lp-green)]/15 px-2 py-px text-[11px] font-semibold text-[var(--lp-good)]'
              : 'rounded-full bg-[var(--lp-warn-soft)] px-2 py-px text-[11px] font-semibold text-[var(--lp-warn)]'
          }
        >
          {verified ? 'Verified' : 'Claimed'}
        </span>
      </dt>
      <dd className="lp-display text-[22px] leading-none tracking-[-0.03em] tabular-nums sm:mt-2 sm:text-[26px]">{value}</dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <FlowLabel as="dt">{label}</FlowLabel>
      <dd className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{value || '—'}</dd>
    </div>
  );
}

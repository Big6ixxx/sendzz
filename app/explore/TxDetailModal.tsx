'use client';

import { DetailRows, FlowDialog } from '@/components/flow/ui';
import { explorerUrlFor, routeLabel } from '@/lib/chains';
import { cn } from '@/lib/utils';
import type { PublicFeedRow } from '@/types/public';
import { ExternalLink } from 'lucide-react';
import {
  formatFeedDate,
  shortHash,
  statusBadge,
  type TimeMode,
  timeZoneAbbrev,
  TYPE_META,
} from './shared';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { formatMoney } from '@/lib/format-usdc';

interface TxDetailModalProps {
  row: PublicFeedRow | null;
  open: boolean;
  loading?: boolean;
  timeZone: string;
  timeMode: TimeMode;
  onClose: () => void;
}

export function TxDetailModal({ row, open, loading, timeZone, timeMode, onClose }: TxDetailModalProps) {
  const primaryUrl = row ? explorerUrlFor(row) : null;
  const rows = row
    ? [
        { label: 'Network', value: routeLabel(row) },
        { label: 'Settled', value: row.is_settled ? 'Yes' : 'Not yet' },
        ...(row.consolidated ? [{ label: 'Combined', value: 'Gathered from several networks' }] : []),
        {
          label: timeMode === 'relative' ? 'When' : `When (${timeZoneAbbrev(timeZone) || timeZone})`,
          value: formatFeedDate(row.created_at, timeZone, timeMode, 'long'),
        },
      ]
    : [];

  return (
    <FlowDialog
      open={open}
      onClose={onClose}
      eyebrow={row ? `${TYPE_META[row.tx_type].label} · public record` : 'Public record'}
      title={row && !loading ? `$${formatMoney(row.amount)}` : 'Transaction'}
      italic={row && !loading ? `${row.asset}.` : 'details.'}
    >
      {loading ? (
        <SkeletonGroup label="Loading transaction" className="space-y-5">
          <Skeleton className="h-7 w-24" />
          <div className="space-y-4 border-y border-[var(--lp-line)] py-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between gap-4">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-32" />
              </div>
            ))}
          </div>
        </SkeletonGroup>
      ) : !row ? (
        <p className="py-10 text-center text-[15px] text-[var(--lp-muted)]">We could not find that transaction.</p>
      ) : (
        <div className="space-y-5">
          <span className={cn('inline-block rounded-full px-3 py-1 text-[13px] font-semibold', statusBadge(row.status).tone)}>
            {statusBadge(row.status).text}
          </span>

          <DetailRows rows={rows} />

          {/* The explorer link is the whole point of a hash here; only its absence needs saying. */}
          {!row.tx_hash && <p className="text-[14px] text-[var(--lp-muted)]">No on-chain hash was recorded for this transaction.</p>}

          {primaryUrl && (
            <a
              href={primaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-on-green inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold text-[var(--lp-ink)] transition-[scale] duration-150 active:scale-[0.98]"
            >
              View on block explorer <ExternalLink className="size-4" />
            </a>
          )}

          <p className="text-[13px] text-[var(--lp-muted)]">Public and anonymised. Who sent it is never shown.</p>
          <span className="sr-only">Transaction reference {shortHash(row.id, 8, 4)}</span>
        </div>
      )}
    </FlowDialog>
  );
}

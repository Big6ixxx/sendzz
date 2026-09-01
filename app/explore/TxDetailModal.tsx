'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { explorerUrlFor, routeLabel } from '@/lib/chains';
import { cn } from '@/lib/utils';
import type { PublicFeedRow } from '@/types/public';
import { ExternalLink, Loader2 } from 'lucide-react';
import {
  formatFeedDate,
  formatStatus,
  formatUsdc,
  shortHash,
  statusClasses,
  type TimeMode,
  timeZoneAbbrev,
  TypeBadge,
} from './shared';

interface TxDetailModalProps {
  row: PublicFeedRow | null;
  open: boolean;
  loading?: boolean;
  timeZone: string;
  timeMode: TimeMode;
  onClose: () => void;
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{label}</p>
      <div className="text-sm font-semibold text-white/90">{children}</div>
    </div>
  );
}

export function TxDetailModal({ row, open, loading, timeZone, timeMode, onClose }: TxDetailModalProps) {
  const primaryUrl = row ? explorerUrlFor(row) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-bold tracking-tight text-white">
            Transaction Details
          </DialogTitle>
          <DialogDescription className="text-white/50">
            Public, anonymized on-chain record.
          </DialogDescription>
        </DialogHeader>

        {loading || !row ? (
          <div className="py-16 flex flex-col items-center gap-4 text-white/40">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-xs font-bold uppercase tracking-[0.25em]">
              {loading ? 'Loading transaction…' : 'Transaction not found'}
            </p>
          </div>
        ) : (
          <div className="space-y-6 pt-2 min-w-0">
            {/* Amount + type + status */}
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="space-y-2">
                <TypeBadge type={row.tx_type} />
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold tracking-tight text-white">
                    ${formatUsdc(row.amount)}
                  </span>
                  <span className="text-sm font-bold text-white/30 uppercase">{row.asset}</span>
                </div>
              </div>
              <span
                className={cn(
                  'px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-widest',
                  statusClasses(row.status),
                )}
              >
                {formatStatus(row.status)}
              </span>
            </div>

            <div className="h-px bg-white/8" />

            {/* Meta grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              <DetailField label="Route">{routeLabel(row)}</DetailField>
              <DetailField label="Settled">{row.is_settled ? 'Yes' : 'Not yet'}</DetailField>
              {row.consolidated && (
                <DetailField label="Consolidation">
                  <span className="text-amber-300">Multi-chain consolidated</span>
                </DetailField>
              )}
              <DetailField
                label={timeMode === 'relative' ? 'Date' : `Date (${timeZoneAbbrev(timeZone) || timeZone})`}
              >
                {formatFeedDate(row.created_at, timeZone, timeMode, 'long')}
              </DetailField>
            </div>

            {/* The explorer button below is the whole point of a hash here, so the raw string
                and its copy control are gone. Only its absence still needs saying. */}
            {!row.tx_hash && (
              <p className="text-xs text-white/40 rounded-xl bg-black/40 border border-white/8 px-3 py-2.5">
                No on-chain hash recorded for this transaction.
              </p>
            )}

            {primaryUrl && (
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-accent w-full h-12 text-sm rounded-xl font-bold"
              >
                View on Block Explorer
                <ExternalLink className="w-4 h-4 ml-2" />
              </a>
            )}
          </div>
        )}

        {/* sr-only reference for the id (helps screen readers announce which tx) */}
        {row && <span className="sr-only">Transaction reference {shortHash(row.id, 8, 4)}</span>}
      </DialogContent>
    </Dialog>
  );
}

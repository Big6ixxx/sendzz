'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { explorerUrlFor, routeLabel, secondaryExplorerUrlFor } from '@/lib/chains';
import { cn } from '@/lib/utils';
import type { PublicFeedRow } from '@/types/public';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success(`${label} copied`);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 rounded-md p-1.5 text-white/40 hover:text-accent hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none transition-colors"
      aria-label={`Copy ${label.toLowerCase()}`}
    >
      {copied ? <Check className="w-4 h-4 text-accent" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function HashRow({ label, hash, url }: { label: string; hash: string; url: string | null }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{label}</p>
      <div className="flex items-center gap-2 rounded-xl bg-black/40 border border-white/8 px-3 py-2.5 min-w-0">
        <code className="flex-1 min-w-0 truncate font-mono text-xs text-white/80">{hash}</code>
        <CopyButton value={hash} label={label} />
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md p-1.5 text-white/40 hover:text-accent hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none transition-colors"
            aria-label={`View ${label.toLowerCase()} on block explorer`}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
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
  const secondaryUrl = row ? secondaryExplorerUrlFor(row) : null;

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
              {row.fiat_currency && (
                <DetailField label="Fiat Corridor">{row.fiat_currency.toUpperCase()}</DetailField>
              )}
              <DetailField
                label={timeMode === 'relative' ? 'Date' : `Date (${timeZoneAbbrev(timeZone) || timeZone})`}
              >
                {formatFeedDate(row.created_at, timeZone, timeMode, 'long')}
              </DetailField>
            </div>

            {/* Hashes */}
            <div className="space-y-4 min-w-0">
              {row.tx_hash ? (
                <HashRow
                  label={row.tx_type === 'bridge' ? 'Burn Tx Hash' : 'Tx Hash'}
                  hash={row.tx_hash}
                  url={primaryUrl}
                />
              ) : (
                <p className="text-xs text-white/40 rounded-xl bg-black/40 border border-white/8 px-3 py-2.5">
                  No on-chain hash recorded for this transaction.
                </p>
              )}
              {row.tx_type === 'bridge' && row.secondary_tx_hash && (
                <HashRow label="Mint Tx Hash" hash={row.secondary_tx_hash} url={secondaryUrl} />
              )}
            </div>

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

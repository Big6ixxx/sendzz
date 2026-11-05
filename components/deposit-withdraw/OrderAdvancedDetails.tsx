'use client';

import { useState } from 'react';
import { ChevronDown, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CHAIN_NAMES, type SupportedChain } from '@/lib/circle/gateway';
import { publicOrderId } from '@/lib/ramp/public-order-id';
import { FlowLabel } from '@/components/flow/ui';

interface OrderAdvancedDetailsProps {
  orderId?: string;
  /** Settlement chain the USDC is sent on. */
  network?: string;
  /** Address the USDC is sent to (off-ramp). */
  receiveAddress?: string;
  /** True when funds were gathered onto the settlement chain first. */
  consolidated?: boolean;
  /** Live order status while processing. */
  status?: string;
  validUntil?: string;
  /** Start expanded (e.g. while processing). Defaults to collapsed. */
  defaultOpen?: boolean;
}

function shorten(s: string, head = 10, tail = 6) {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/**
 * Collapsible technical breakdown of a created ramp order — shown on the "ready to send" and
 * "processing" screens so advanced users can see the order id, the settlement network and the
 * receive address. Novices can ignore the collapsed accordion.
 *
 * No provider name. Sendzz settles the withdrawal as far as the user is concerned, and naming
 * whoever moves the money underneath tells them nothing they can act on.
 */
export function OrderAdvancedDetails({
  orderId,
  network,
  receiveAddress,
  consolidated,
  status,
  validUntil,
  defaultOpen = false,
}: OrderAdvancedDetailsProps) {
  const [open, setOpen] = useState(defaultOpen);

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error('Copy failed'),
    );
  };

  const networkName = network
    ? CHAIN_NAMES[network.toLowerCase() as SupportedChain] ?? network
    : null;

  const rows: { label: string; value: string; copy?: string }[] = [];
  if (networkName)
    rows.push({ label: 'Network', value: consolidated ? `${networkName} (consolidated)` : networkName });
  if (status) rows.push({ label: 'Status', value: status });
  if (orderId) rows.push({ label: 'Order ID', value: shorten(publicOrderId(orderId)), copy: publicOrderId(orderId) });
  if (receiveAddress)
    rows.push({ label: 'Receive address', value: shorten(receiveAddress), copy: receiveAddress });
  if (validUntil) {
    const d = new Date(validUntil);
    if (!isNaN(d.getTime())) rows.push({ label: 'Quote valid until', value: d.toLocaleTimeString() });
  }

  if (rows.length === 0) return null;

  return (
    <div className="lp-card overflow-hidden rounded-[20px] text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3"
      >
        <FlowLabel as="span">
          Advanced details
        </FlowLabel>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-[var(--lp-muted)] transition-transform shrink-0',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-[var(--lp-rule)] px-4 pb-3 pt-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 text-[14px]">
              <span className="shrink-0 text-[var(--lp-muted)]">
                {r.label}
              </span>
              <span className="lp-mono flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--lp-ink)]">
                <span className="truncate">{r.value}</span>
                {r.copy && (
                  <button
                    type="button"
                    onClick={() => copy(r.label, r.copy!)}
                    className="shrink-0 text-[var(--lp-muted)] transition-colors hover:text-[var(--lp-ink)]"
                    aria-label={`Copy ${r.label}`}
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

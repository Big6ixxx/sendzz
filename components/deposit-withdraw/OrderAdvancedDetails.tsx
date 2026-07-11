'use client';

import { useState } from 'react';
import { ChevronDown, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { CHAIN_NAMES, type SupportedChain } from '@/lib/circle/gateway';

interface OrderAdvancedDetailsProps {
  /** Ramp provider settling the order ('bitnob' | 'paycrest'). */
  provider?: string;
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

const PROVIDER_LABEL: Record<string, string> = {
  bitnob: 'Bitnob',
  paycrest: 'Paycrest',
};

function shorten(s: string, head = 10, tail = 6) {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/**
 * Collapsible technical breakdown of a created ramp order — shown on the "ready to send"
 * and "processing" screens so advanced users can see which provider settles it, the order
 * id, the settlement network, etc. Novices can ignore the collapsed accordion.
 */
export function OrderAdvancedDetails({
  provider,
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
  if (provider) rows.push({ label: 'Settles via', value: PROVIDER_LABEL[provider] ?? provider });
  if (networkName)
    rows.push({ label: 'Network', value: consolidated ? `${networkName} (consolidated)` : networkName });
  if (status) rows.push({ label: 'Status', value: status });
  if (orderId) rows.push({ label: 'Order ID', value: shorten(orderId), copy: orderId });
  if (receiveAddress)
    rows.push({ label: 'Receive address', value: shorten(receiveAddress), copy: receiveAddress });
  if (validUntil) {
    const d = new Date(validUntil);
    if (!isNaN(d.getTime())) rows.push({ label: 'Quote valid until', value: d.toLocaleTimeString() });
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white/3 border border-white/8 overflow-hidden text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40">
          Advanced details
        </span>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-brand-secondary/40 transition-transform shrink-0',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2 border-t border-white/6 pt-3">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-brand-secondary/40 font-medium uppercase tracking-wide text-[10px] shrink-0">
                {r.label}
              </span>
              <span className="font-semibold text-brand-secondary/90 flex items-center gap-1.5 min-w-0">
                <span className="truncate">{r.value}</span>
                {r.copy && (
                  <button
                    type="button"
                    onClick={() => copy(r.label, r.copy!)}
                    className="text-brand-secondary/40 hover:text-accent transition-colors shrink-0"
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

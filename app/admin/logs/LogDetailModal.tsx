'use client';

import { format } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Globe, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { getCurrencyCountry, getCurrencyFlag } from '@/lib/currency-config';
import { cn } from '@/lib/utils';
import type { AdminLog, AuditLog, WebhookLog } from '@/types/admin';

/**
 * Keys that answer "what happened and why".
 *
 * Providers don't agree on a name for the failure text — Paycrest sends `reason`, Bitnob sends
 * `failureReason`, our own RPCs write `reason` into the audit metadata — so we look for all of
 * them rather than making the admin hunt through raw JSON for the one line that matters.
 */
const CAUSE_KEYS = [
  'reason',
  'failureReason',
  'failure_reason',
  'error',
  'errorMessage',
  'message',
  'description',
];

/** Keys worth pulling to the top as identifying facts, in roughly the order you'd want them. */
const FACT_KEYS = [
  'status',
  'state',
  'event',
  'type',
  'orderId',
  'order_id',
  'paycrest_order_id',
  'provider_order_id',
  'reference',
  'quote_id',
  'withdrawal_id',
  'deposit_id',
  'transfer_id',
  'amount',
  'amount_usdc',
  'currency',
  'txHash',
  'tx_hash',
  'hash',
];

/** Every name a provider might give the payout currency. */
const CURRENCY_KEYS = [
  'currency',
  'fiat_currency',
  'fiatCurrency',
  'to_currency',
  'toCurrency',
  'currency_fiat',
  'localCurrency',
  'destinationCurrency',
];

type Found = { key: string; value: string };

/**
 * Walk a payload for the keys above. Providers nest their real content at different depths
 * (`data.status` vs `payload.order.status`), so this searches rather than assuming a shape.
 * Depth-limited, and only primitives are collected — an object is never stringified into a
 * "fact" row, since that's what the raw JSON panel below is for.
 */
function findKeys(value: unknown, wanted: string[], depth = 0, out: Found[] = []): Found[] {
  if (depth > 4 || value === null || typeof value !== 'object') return out;

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '') continue;
    const isPrimitive = ['string', 'number', 'boolean'].includes(typeof v);
    if (isPrimitive && wanted.some((w) => w.toLowerCase() === k.toLowerCase())) {
      if (!out.some((f) => f.key === k)) out.push({ key: k, value: String(v) });
    } else if (typeof v === 'object') {
      findKeys(v, wanted, depth + 1, out);
    }
  }
  return out;
}

/**
 * The single most relevant cause line, for the collapsed row. Shared with the modal so the
 * summary and the detail can never disagree about what a log is reporting.
 */
export function summariseCause(payload: unknown): string | null {
  const found = findKeys(payload, CAUSE_KEYS);
  return found.length > 0 ? found[0].value : null;
}

/**
 * Which currency this payout was for, and where it was going.
 *
 * The country is derived from the currency because that's what we actually persist — an
 * explicit `country` field is used when a provider happens to send one, but most don't.
 */
function resolveDestination(payload: unknown): {
  currency: string | null;
  country: string | null;
  flag: string;
} {
  const currency = findKeys(payload, CURRENCY_KEYS)[0]?.value?.toUpperCase() ?? null;
  const explicit = findKeys(payload, ['country', 'countryCode', 'country_code'])[0]?.value ?? null;
  const country = explicit ?? (currency ? getCurrencyCountry(currency) : null);
  return { currency, country, flag: currency ? getCurrencyFlag(currency) : '🏳️' };
}

function labelise(key: string): string {
  return key
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-[#00e87a]" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy JSON'}
    </button>
  );
}

export function LogDetailModal({
  log,
  logType,
  onClose,
}: {
  log: AdminLog | null;
  logType: 'webhooks' | 'audit';
  onClose: () => void;
}) {
  const payload =
    log && (logType === 'webhooks'
      ? (log as WebhookLog).payload_json
      : (log as AuditLog).metadata_json);

  const destination = log ? resolveDestination(payload) : null;
  const causes = log ? findKeys(payload, CAUSE_KEYS) : [];
  const facts = log ? findKeys(payload, FACT_KEYS) : [];
  const json = log ? JSON.stringify(payload, null, 2) : '';

  useEffect(() => {
    if (!log) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [log, onClose]);

  const title = log
    ? logType === 'webhooks'
      ? `${(log as WebhookLog).provider} · ${(log as WebhookLog).event_type}`
      : (log as AuditLog).action
    : '';

  // No document during SSR. Safe against hydration mismatch because the modal only ever has
  // a log to show after a click, which is necessarily post-hydration.
  if (typeof document === 'undefined') return null;

  /**
   * Portalled to <body> rather than rendered in place.
   *
   * The admin layout nests pages inside `overflow-hidden` panels and a sidebar that creates its
   * own stacking context with a backdrop-filter — enough to trap a `position: fixed` overlay so
   * it mounts but is never visible. Escaping to the body sidesteps every ancestor's overflow,
   * transform and z-index, which is why the modal opened but nothing appeared.
   */
  return createPortal(
    <AnimatePresence>
      {log && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6"
          style={{ background: 'rgba(7,7,10,0.75)', backdropFilter: 'blur(6px)' }}
        >
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            onClick={(e) => e.stopPropagation()}
            className="card-glass w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto border-white/10 p-6 sm:rounded-3xl rounded-t-3xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-white tracking-tight break-words">
                  {title}
                </h2>
                <p className="text-[10px] font-mono text-white/25 mt-1 uppercase tracking-widest break-all">
                  {format(new Date(log.created_at), 'd MMM yyyy, HH:mm:ss.SSS')} · {log.id}
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Destination — which currency and where it was headed */}
            {destination && (destination.currency || destination.country) && (
              <div className="mb-6 flex items-center gap-4 rounded-2xl border border-white/8 bg-white/3 px-5 py-4">
                <span className="text-2xl leading-none">{destination.flag}</span>
                <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                  <div>
                    <p className="text-[9px] font-bold text-white/25 uppercase tracking-[0.2em]">
                      Currency
                    </p>
                    <p className="text-sm font-bold text-white mt-0.5">
                      {destination.currency ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-white/25 uppercase tracking-[0.2em] flex items-center gap-1.5">
                      <Globe className="w-3 h-3" /> Destination
                    </p>
                    <p className="text-sm font-bold text-white mt-0.5">
                      {destination.country ?? 'Unknown'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Why — shown ONLY when the provider actually told us. No canned explanation of
                what a status means: an admin opening a log already knows what "expired" is, and
                filling the space with boilerplate hides the fact that the real cause is absent. */}
            {causes.length > 0 && (
              <div className="mb-7 border-l-2 border-amber-400/70 pl-5">
                {causes.map((c, i) => (
                  <div key={c.key} className={i > 0 ? 'mt-5' : undefined}>
                    <p className="text-[15px] leading-relaxed text-white/90">{c.value}</p>
                    <p className="text-[11px] text-white/30 mt-2">
                      {labelise(c.key)} · reported by{' '}
                      {logType === 'webhooks'
                        ? (log as WebhookLog).provider
                        : 'Sendzz'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Record-level fields */}
            <div className="grid sm:grid-cols-2 gap-3 mb-6">
              {(logType === 'webhooks'
                ? [
                    ['Provider', (log as WebhookLog).provider],
                    ['Event Type', (log as WebhookLog).event_type],
                    ['Event ID', (log as WebhookLog).event_id],
                    ['Processed', String((log as WebhookLog).processed)],
                  ]
                : [
                    ['Action', (log as AuditLog).action],
                    ['User ID', (log as AuditLog).user_id ?? '—'],
                    ['IP', (log as AuditLog).ip ?? '—'],
                    ['User Agent', (log as AuditLog).user_agent ?? '—'],
                  ]
              ).map(([label, value]) => (
                <div
                  key={label as string}
                  className="rounded-xl bg-white/3 border border-white/5 px-4 py-3 min-w-0"
                >
                  <p className="text-[9px] font-bold text-white/25 uppercase tracking-[0.2em]">
                    {label}
                  </p>
                  <p className="text-xs text-white/70 mt-1 break-all">{value || '—'}</p>
                </div>
              ))}
            </div>

            {/* Facts pulled out of the payload */}
            {facts.length > 0 && (
              <div className="mb-6">
                <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] mb-3">
                  Key Fields
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {facts.map((f) => (
                    <div
                      key={f.key}
                      className="rounded-xl bg-white/3 border border-white/5 px-4 py-3 min-w-0"
                    >
                      <p className="text-[9px] font-bold text-white/25 uppercase tracking-[0.2em]">
                        {labelise(f.key)}
                      </p>
                      <p className="text-xs text-white/70 mt-1 break-all">{f.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw payload — the final authority when the extraction misses something */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
                  Raw Payload
                </h3>
                <CopyButton text={json} />
              </div>
              <pre
                className={cn(
                  'text-[11px] leading-relaxed text-white/60 font-mono',
                  'rounded-2xl bg-black/40 border border-white/5 p-4 overflow-x-auto max-h-96',
                )}
              >
                {json}
              </pre>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

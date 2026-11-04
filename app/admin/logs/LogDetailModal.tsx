'use client';

import { format } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Globe, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { brandFontVars } from '@/components/landing/fonts';
import { getCurrencyCountry, getCurrencyFlag } from '@/lib/currency-config';
import { cn } from '@/lib/utils';
import type { AdminLog, AuditLog, WebhookLog } from '@/types/admin';
import { useCopied } from '../components/ui';
import { FlowLabel } from '@/components/flow/ui';

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
  return {
    currency,
    country,
    flag: currency ? getCurrencyFlag(currency) : '🏳️',
  };
}

function labelise(key: string): string {
  return key
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopied();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className="inline-flex h-9 items-center gap-2 rounded-full border border-[rgb(var(--lp-hair)/0.15)] px-3.5 text-[13px] font-semibold transition-colors hover:border-[var(--lp-ink)]"
    >
      {copied ? <Check className="w-3 h-3 text-[var(--lp-good)]" /> : <Copy className="w-3 h-3" />}
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
    log &&
    (logType === 'webhooks' ? (log as WebhookLog).payload_json : (log as AuditLog).metadata_json);

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
   * The admin layout nests pages inside `overflow-hidden` scroll panels, which can trap a
   * `position: fixed` overlay so it mounts but is never visible. Escaping to the body sidesteps
   * every ancestor's overflow, transform and z-index.
   *
   * Out there it is also outside the admin's `lp-root`, so it brings the brand scope with it:
   * without it the text takes the app's global near-white and the cream fills have no colour.
   * `contents` keeps the wrapper itself out of the layout.
   */
  return createPortal(
    <div className={`lp-root ${brandFontVars} contents`}>
      <AnimatePresence>
        {log && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-6"
            style={{
              background: 'rgba(17,26,19,0.5)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-h-[90vh] overflow-y-auto rounded-t-[28px] bg-[var(--lp-surface)] p-5 shadow-[0_24px_64px_-24px_rgb(17_26_19/0.45)] sm:max-w-3xl sm:rounded-[32px] sm:p-8"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="min-w-0">
                  <p className="lp-mono text-[11px] uppercase text-[var(--lp-muted)] sm:text-[12px]">
                    {logType === 'webhooks' ? 'Webhook' : 'Audit log'}
                  </p>
                  <h2 className="lp-display mt-1 break-words text-[clamp(22px,5vw,32px)] leading-[1.05] tracking-[-0.03em]">
                    {title}
                  </h2>
                  <p className="lp-mono mt-2 break-all text-[12px] text-[var(--lp-muted)]">
                    {format(new Date(log.created_at), 'd MMM yyyy, HH:mm:ss.SSS')} · {log.id}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--lp-cream)] transition-colors hover:bg-[var(--lp-soft-2)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Destination — which currency and where it was headed */}
              {destination && (destination.currency || destination.country) && (
                <div className="mb-6 flex items-center gap-4 rounded-[22px] bg-[var(--lp-cream)] px-5 py-4">
                  <span className="text-2xl leading-none">{destination.flag}</span>
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
                    <div>
                      <p className="lp-mono text-[11px] text-[var(--lp-muted)] uppercase">
                        Currency
                      </p>
                      <p className="text-sm font-bold text-[var(--lp-ink)] mt-0.5">
                        {destination.currency ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className="lp-mono text-[11px] text-[var(--lp-muted)] uppercase flex items-center gap-1.5">
                        <Globe className="w-3 h-3" /> Destination
                      </p>
                      <p className="text-sm font-bold text-[var(--lp-ink)] mt-0.5">
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
                <div className="mb-7 rounded-[22px] border-l-4 border-[#f5c451] bg-[#f5c451]/15 py-4 pl-5 pr-4">
                  {causes.map((c, i) => (
                    <div key={c.key} className={i > 0 ? 'mt-5' : undefined}>
                      <p className="text-[16px] leading-relaxed text-[var(--lp-ink)]">{c.value}</p>
                      <p className="text-[13px] text-[var(--lp-muted)] mt-2">
                        {labelise(c.key)} · reported by{' '}
                        {logType === 'webhooks' ? (log as WebhookLog).provider : 'Sendzz'}
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
                    className="min-w-0 rounded-[18px] bg-[var(--lp-cream)] px-4 py-3"
                  >
                    <p className="text-[13px] text-[var(--lp-muted)]">{label}</p>
                    <p className="mt-0.5 break-all text-[14px] font-semibold">{value || '—'}</p>
                  </div>
                ))}
              </div>

              {/* Facts pulled out of the payload */}
              {facts.length > 0 && (
                <div className="mb-6">
                  <h3 className="lp-mono mb-3 text-[12px] uppercase text-[var(--lp-muted)]">
                    Key fields
                  </h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {facts.map((f) => (
                      <div
                        key={f.key}
                        className="min-w-0 rounded-[18px] bg-[var(--lp-cream)] px-4 py-3"
                      >
                        <p className="text-[13px] text-[var(--lp-muted)]">{labelise(f.key)}</p>
                        <p className="mt-0.5 break-all text-[14px] font-semibold">{f.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw payload — the final authority when the extraction misses something */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <FlowLabel as="h3">
                    Raw payload
                  </FlowLabel>
                  <CopyButton text={json} />
                </div>
                <pre
                  className={cn(
                    'lp-mono text-[12px] leading-relaxed text-[#cfe0d6]',
                    'max-h-96 overflow-x-auto rounded-[22px] bg-[var(--lp-ink)] p-4 sm:p-5',
                  )}
                >
                  {json}
                </pre>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

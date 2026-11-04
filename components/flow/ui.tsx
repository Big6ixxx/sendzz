'use client';

/**
 * Building blocks for the money flows (deposit, withdraw, batch send), in the landing page's
 * language: a two-line display title, a hero amount like the landing calculator, summaries ruled
 * like its comparison table, pill controls and full-width pill actions. They sit on the cream
 * surface of the brand dialog (components/ui/dialog.tsx).
 */

import { AlertCircle, CheckCircle2, Info, Loader2, ShieldAlert, X } from 'lucide-react';
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { MEDIA, useMedia } from '@/components/landing/motion';

/** A full-width choice between two or three ways of doing the same thing. */
export function FlowTabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="lp-card flex gap-1 rounded-full p-1" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-full px-3 py-2.5 text-[14px] font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#04c96a]',
            o.value === value ? 'bg-[var(--lp-ink)] text-[var(--lp-cream)]' : 'text-[var(--lp-body)] hover:text-[var(--lp-link)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Where a flow is: "Step 1 of 2", with the step's name and a bar per step. */
export function FlowSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold">{steps[current]}</span>
        <span className="lp-mono text-[12px] uppercase text-[var(--lp-muted)]">
          Step {current + 1} of {steps.length}
        </span>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {steps.map((s, i) => (
          <span key={s} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-300', i <= current ? 'bg-[var(--lp-ink)]' : 'bg-[var(--lp-rule)]')} />
        ))}
      </div>
    </div>
  );
}

/**
 * The amount, as the landing calculator shows it: a label, the figure in display type, and the
 * currency beside it. The input is the figure itself, so there is no box inside a box.
 */
export function AmountField({
  label,
  value,
  onChange,
  symbol,
  currency,
  placeholder = '0',
  footer,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  symbol?: string;
  /** The currency control, or a fixed label, on the right. */
  currency: React.ReactNode;
  placeholder?: string;
  footer?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="lp-card rounded-[24px] p-5 outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)]">
      <label htmlFor={id} className="text-[14px] text-[var(--lp-muted)]">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          {symbol && <span className="lp-display text-[clamp(26px,7vw,34px)] leading-none tracking-[-0.03em] text-[var(--lp-muted)]">{symbol}</span>}
          <input
            id={id}
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className="lp-display min-w-0 flex-1 bg-transparent text-[clamp(36px,10vw,48px)] leading-none tracking-[-0.04em] tabular-nums outline-none placeholder:text-[var(--lp-line)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </div>
        <div className="shrink-0">{currency}</div>
      </div>
      {footer && <div className="mt-3 border-t border-[var(--lp-soft-2)] pt-3">{footer}</div>}
    </div>
  );
}

/** A currency shown, not chosen: the pill the amount sits beside. */
export function CurrencyPill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-10 items-center rounded-full bg-[var(--lp-cream)] px-4 text-[15px] font-semibold">{children}</span>;
}

const NOTICE = {
  info: { Icon: Info, box: 'lp-card', icon: 'bg-[var(--lp-cream)] text-[var(--lp-ink)]', title: '' },
  warning: { Icon: ShieldAlert, box: 'bg-[#f5c451]/20', icon: 'bg-[#f5c451]/40 text-[var(--lp-warn)]', title: 'text-[var(--lp-warn)]' },
  danger: { Icon: AlertCircle, box: 'bg-[#a1462c]/10', icon: 'bg-[#a1462c]/15 text-[var(--lp-danger)]', title: 'text-[var(--lp-danger)]' },
  success: { Icon: CheckCircle2, box: 'bg-[#00e87a]/15', icon: 'bg-[#00e87a]/30 text-[var(--lp-good)]', title: 'text-[var(--lp-good)]' },
} as const;

/** One way to say something needs reading: a tinted card, an icon, a title, a line. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: keyof typeof NOTICE;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const look = NOTICE[tone];
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('rounded-[22px] p-4', look.box)}>
      <div className="flex items-start gap-3">
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', look.icon)}>
          <look.Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          {title && <p className={cn('text-[15px] font-semibold leading-snug', look.title)}>{title}</p>}
          {children && <div className={cn('text-[14px] leading-[1.5] text-[var(--lp-body)]', title && 'mt-1')}>{children}</div>}
        </div>
      </div>
      {action && <div className="mt-3 pl-12">{action}</div>}
    </div>
  );
}

/** The step's main action: a full-width pill. `accent` is the brand green, for the money moment. */
export function FlowButton({
  tone = 'ink',
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'ink' | 'accent' | 'quiet' | 'danger'; loading?: boolean }) {
  const unavailable = props.disabled && !loading;
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold outline-none transition-[scale,opacity,background-color,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-[#04c96a] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100',
        // Unavailable (not merely busy) keeps full-strength text on a flat sand fill: readable on
        // cream and on forest, where a faded green turned into a muddy block with the label gone.
        unavailable && tone !== 'quiet'
          ? 'bg-[var(--lp-line)] text-[var(--lp-body)]'
          : [
              tone === 'ink' && 'bg-[var(--lp-ink)] text-[var(--lp-cream)]',
              tone === 'accent' && 'lp-fixed bg-[var(--lp-green)] text-[var(--lp-ink)]',
              tone === 'danger' && 'bg-[#a1462c] text-white',
            ],
        // Ink set explicitly: on the forest panel the inherited text is cream, which vanishes on white.
        tone === 'quiet' && 'border border-[rgb(var(--lp-hair)/0.15)] bg-[var(--lp-surface)] text-[var(--lp-ink)] hover:border-[var(--lp-ink)]',
        tone === 'quiet' && unavailable && 'opacity-60',
        className,
      )}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : children}
    </button>
  );
}

/** A labelled input in the brand: a white pill-cornered field that outlines in ink on focus. */
export const FlowInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: React.ReactNode; trailing?: React.ReactNode }
>(function FlowInput({ label, hint, trailing, className, id, ...props }, ref) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-[14px] font-semibold">
        {label}
      </label>
      <div className="flex h-14 items-center gap-3 rounded-[18px] bg-[var(--lp-surface)] px-4 shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-within:outline-[var(--lp-ink)]">
        <input ref={ref} id={inputId} {...props} className={cn('min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--lp-placeholder)] disabled:opacity-60', className)} />
        {trailing}
      </div>
      {hint && <p className="mt-1.5 text-[13px] leading-normal text-[var(--lp-muted)]">{hint}</p>}
    </div>
  );
});

/** The end of a flow: a mark, a two-line title, a line of what happens next. */
export function FlowSuccess({ title, italic, body, children }: { title: string; italic: string; body?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-500">
      <span className="lp-fixed grid size-20 place-items-center rounded-full bg-[var(--lp-green)] text-[var(--lp-ink)]">
        <CheckCircle2 className="size-10" />
      </span>
      <h3 className="lp-display mt-6 text-[clamp(32px,8.4vw,44px)] leading-[0.95] tracking-[-0.045em]">
        {title} <span className="lp-serif tracking-[-0.02em]">{italic}</span>
      </h3>
      {body && <p className="mt-3 max-w-[340px] text-[16px] leading-[1.5] text-[var(--lp-body)]">{body}</p>}
      {children && <div className="mt-6 w-full space-y-3">{children}</div>}
    </div>
  );
}

/** A label above a group, in the brand's mono. */
export function FlowLabel({
  children,
  className,
  as: Tag = 'p',
}: {
  children: React.ReactNode;
  className?: string;
  /** The element, when a paragraph is wrong in context: a span in a row, a dt in a list. */
  as?: React.ElementType;
}) {
  return <Tag className={cn('lp-mono text-[12px] uppercase text-[var(--lp-muted)]', className)}>{children}</Tag>;
}

/* ── The frame ──────────────────────────────────────────────────────────────
 *
 * Desktop: a wide split dialog in the landing's comparison layout. The form on cream at the left,
 * a forest panel at the right that answers "what happens with my money" as the user types, with
 * the step's main action at its foot. Phones: a full-screen sheet, the forest panel as a card at
 * the end of the form and the action pinned to the bottom of the screen.
 *
 * The dialog provides the header and tabs (FlowFrameProvider); each step of a flow renders a
 * FlowFrame with its own form, panel and action.
 */

type FrameChrome = {
  eyebrow: string;
  title: React.ReactNode;
  italic: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  tabs?: React.ReactNode;
};

const FrameContext = React.createContext<FrameChrome | null>(null);

export function FlowFrameProvider({ value, children }: { value: FrameChrome; children: React.ReactNode }) {
  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}

export function FlowFrame({ main, aside, action }: { main: React.ReactNode; aside?: React.ReactNode; action?: React.ReactNode }) {
  const chrome = React.useContext(FrameContext);
  // One copy of the summary and the action, placed for the screen, rather than both rendered and
  // one hidden: a summary holds QR codes and copy timers that should exist once.
  const wide = useMedia(MEDIA.wide);
  if (!chrome) throw new Error('FlowFrame must be rendered inside a FlowFrameProvider');
  const split = !!aside && wide;

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col', split && 'grid grid-cols-[minmax(0,1fr)_minmax(0,420px)]')}>
      <button
        type="button"
        onClick={chrome.onClose}
        disabled={chrome.closeDisabled}
        aria-label="Close"
        className="lp-card absolute right-4 top-4 z-20 grid size-10 place-items-center rounded-full text-[var(--lp-ink)] outline-none transition-[scale,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--lp-green)] active:scale-[0.94] disabled:opacity-40 sm:right-5 sm:top-5"
      >
        <X className="size-4" />
      </button>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-5 px-5 pt-5 sm:px-8 sm:pt-8">
          <div className="pr-14">
            <FlowLabel>{chrome.eyebrow}</FlowLabel>
            <h2 className="lp-display mt-2 text-[clamp(32px,8vw,48px)] leading-[0.95] tracking-[-0.045em]">
              {chrome.title} <span className="lp-serif tracking-[-0.02em]">{chrome.italic}</span>
            </h2>
          </div>
          {chrome.tabs}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5 sm:px-8 sm:pb-8">
          {main}
          {aside && !split && <div className="lp-fixed mt-5 rounded-[28px] bg-[var(--lp-forest)] p-5 text-[var(--lp-cream)]">{aside}</div>}
        </div>

        {action && !split && <div className="shrink-0 border-t border-[var(--lp-rule)] bg-[var(--lp-cream)] px-5 py-4 sm:px-8">{action}</div>}
      </div>

      {split && (
        <aside className="lp-fixed flex min-h-0 flex-col bg-[var(--lp-forest)] text-[var(--lp-cream)]">
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-20">{aside}</div>
          {action && <div className="shrink-0 px-8 pb-8">{action}</div>}
        </aside>
      )}
    </div>
  );
}

/* ── Pieces for the forest panel ───────────────────────────────────────── */

/** A labelled figure on the forest: the mono label, then the value in display type. */
export function AsideFigure({ label, value, unit, size = 'lg' }: { label: string; value: React.ReactNode; unit?: string; size?: 'lg' | 'md' }) {
  return (
    <div>
      <p className="lp-mono text-[12px] uppercase text-[var(--lp-green)]">{label}</p>
      <p
        className={cn(
          'lp-display mt-2 break-words leading-[0.95] tracking-[-0.045em] tabular-nums',
          size === 'lg' ? 'text-[clamp(36px,9vw,52px)]' : 'text-[clamp(28px,7vw,36px)]',
        )}
      >
        {value} {unit && <span className="lp-serif text-[0.5em] tracking-[-0.01em] text-[#cfe0d6]">{unit}</span>}
      </p>
    </div>
  );
}

/** Ruled rows on the forest. */
export function AsideRows({ rows }: { rows: { label: React.ReactNode; value: React.ReactNode; tone?: 'good' }[] }) {
  return (
    <dl>
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-[rgba(246,242,233,0.12)] py-3 last:border-b-0">
          <dt className="text-[14px] text-[#a9c2b5]">{r.label}</dt>
          <dd className={cn('min-w-0 text-right text-[15px] font-semibold tabular-nums', r.tone === 'good' && 'text-[var(--lp-green)]')}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Label and value rows on cream or white, ruled apart like a receipt: the counterpart of
 * AsideRows on the forest panel. A falsy row is skipped, so optional details read inline.
 */
export function DetailRows({
  rows,
  className,
}: {
  rows: ({ label: React.ReactNode; value: React.ReactNode } | false | null | undefined)[];
  className?: string;
}) {
  return (
    <dl className={cn('divide-y divide-[var(--lp-rule)] border-y border-[var(--lp-rule)] text-[15px]', className)}>
      {rows.filter((r) => !!r).map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-3">
          <dt className="shrink-0 text-[var(--lp-muted)]">{r.label}</dt>
          <dd className="min-w-0 text-right font-medium">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A short question before or after a money step ("Send to someone new?", "Save this contact?"):
 * the shared dialog with a line of context and two actions.
 */
export function FlowConfirm({
  open,
  onClose,
  eyebrow = 'Confirm',
  title,
  italic,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  loading,
  tone = 'ink',
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  italic: string;
  children?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
  tone?: 'ink' | 'accent' | 'danger';
}) {
  return (
    <FlowDialog open={open} onClose={() => !loading && onClose()} eyebrow={eyebrow} title={title} italic={italic} showClose={false}>
      {children && <div className="text-[15px] leading-[1.55] text-[var(--lp-body)]">{children}</div>}
      <div className={cn('flex flex-col-reverse gap-2 sm:flex-row', children && 'mt-6')}>
        <FlowButton tone="quiet" onClick={onClose} disabled={loading} className="sm:w-36">
          {cancelLabel}
        </FlowButton>
        <FlowButton tone={tone} onClick={onConfirm} loading={loading} className="sm:flex-1">
          {confirmLabel}
        </FlowButton>
      </div>
    </FlowDialog>
  );
}

/**
 * The money flows' split, laid out on a page instead of a dialog: the form on the left, and on
 * the right a forest summary that answers "what happens with my money" as the person types, with
 * the main action at its foot. On a phone the summary follows the form.
 */
export function FlowPage({
  tabs,
  main,
  summary,
  action,
  extra,
}: {
  tabs?: React.ReactNode;
  main: React.ReactNode;
  summary: React.ReactNode;
  action: React.ReactNode;
  /** Cards under the summary. */
  extra?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start lg:gap-6">
      <section className="min-w-0 space-y-5">
        {tabs}
        {main}
      </section>
      <div className="min-w-0 space-y-4 lg:sticky lg:top-6">
        <section className="lp-fixed rounded-[32px] bg-[var(--lp-forest)] p-6 text-[var(--lp-cream)] sm:p-7">
          {summary}
          <div className="mt-6 space-y-3">{action}</div>
        </section>
        {extra}
      </div>
    </div>
  );
}

/** The heading every cream dialog opens with: a mono label over the two-part title. */
export function FlowDialogHeading({
  eyebrow,
  title,
  italic,
  Title = 'h2',
}: {
  eyebrow: string;
  title: React.ReactNode;
  italic?: React.ReactNode;
  /** The element for the title: DialogTitle inside a Radix dialog, a plain heading elsewhere. */
  Title?: React.ElementType;
}) {
  return (
    <div className="space-y-2 pr-8 text-left">
      <p className="lp-mono text-[12px] uppercase text-[var(--lp-muted)]">{eyebrow}</p>
      <Title className="lp-display text-[clamp(28px,7vw,36px)] font-normal leading-[0.95] tracking-[-0.045em]">
        {title}
        {italic && (
          <>
            {' '}
            <span className="lp-serif tracking-[-0.02em]">{italic}</span>
          </>
        )}
      </Title>
    </div>
  );
}

/**
 * The cream dialog every short task uses (add a contact, set a PIN, confirm it's you): a mono
 * label, the two-part title, an optional line under it, then the body. One place for the shell,
 * so each dialog is only its content.
 */
export function FlowDialog({
  open,
  onClose,
  eyebrow,
  title,
  italic,
  description,
  children,
  size = 'sm',
  dismissable = true,
  showClose = true,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: React.ReactNode;
  italic?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** sm: a short form or question. md: a step-by-step setup. */
  size?: 'sm' | 'md';
  /** False for a gate that must be completed: no outside click, no Escape, no close button. */
  dismissable?: boolean;
  showClose?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismissable && onClose()}>
      <DialogContent
        showCloseButton={dismissable && showClose}
        onPointerDownOutside={dismissable ? undefined : (e) => e.preventDefault()}
        onEscapeKeyDown={dismissable ? undefined : (e) => e.preventDefault()}
        className={cn('gap-0 p-6 sm:p-8', size === 'sm' ? 'sm:max-w-[460px]' : 'sm:max-w-[520px]')}
      >
        <FlowDialogHeading eyebrow={eyebrow} title={title} italic={italic} Title={DialogTitle} />
        {description ? (
          <DialogDescription className="mt-3 text-[15px] leading-[1.55] text-[var(--lp-body)]">{description}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{eyebrow}</DialogDescription>
        )}
        <div className="mt-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}


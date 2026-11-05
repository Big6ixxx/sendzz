"use client";

/**
 * Applying to the Merchant track, from the retail referrals page.
 *
 * Deliberately an application and not a button. The Merchant track pays cash out of the
 * treasury where retail only discounts our own margin, and the people worth having on it are
 * hand-picked — community leaders, agency operators, group admins — not whoever clicks.
 *
 * The fields are free text on purpose. The useful signal is "I run a 400-person freelancer
 * Slack in Lagos", which no dropdown would have captured, and which is exactly what an
 * approver needs beside the volume figures we can verify ourselves.
 */

import { useState } from "react";
import { FlowButton, FlowInput, FlowLabel } from "@/components/flow/ui";
import { toast } from "sonner";

import { applyForMerchant, type MerchantApplication } from "@/lib/actions/merchant";

interface FormState {
  organisation: string;
  audience: string;
  expectedMonthlyVolumeUsdc: string;
  notes: string;
}

const EMPTY: FormState = {
  organisation: "",
  audience: "",
  expectedMonthlyVolumeUsdc: "",
  notes: "",
};

export function MerchantApplicationCard({
  application,
  onApplied,
}: {
  application: MerchantApplication | null;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await applyForMerchant({
        organisation: form.organisation,
        audience: form.audience,
        expectedMonthlyVolumeUsdc: form.expectedMonthlyVolumeUsdc
          ? Number(form.expectedMonthlyVolumeUsdc)
          : undefined,
        notes: form.notes,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Sent. We'll be in touch.");
      setOpen(false);
      setForm(EMPTY);
      onApplied();
    } finally {
      setBusy(false);
    }
  };

  const formBlock = (
    <Form
      form={form}
      setForm={setForm}
      busy={busy}
      onSubmit={submit}
      onCancel={() => setOpen(false)}
    />
  );

  // Waiting on us — show where it stands rather than the form again.
  if (application?.status === "pending") {
    return (
      <Shell>
        <Title>Your application is <span className="lp-serif">with us.</span></Title>
        <p className="text-[15px] leading-[1.55] text-[var(--lp-body)]">
          We read every one properly, so give us a few days. You keep earning fee credit in the
          meantime. Nothing pauses while you wait.
        </p>
      </Shell>
    );
  }

  if (application?.status === "rejected") {
    return (
      <Shell>
        <Title>Not <span className="lp-serif">this time.</span></Title>
        {application.decisionNote && (
          <p className="text-[15px] leading-[1.55] text-[var(--lp-body)]">
            {application.decisionNote}
          </p>
        )}
        <p className="text-[14px] leading-[1.55] text-[var(--lp-muted)]">
          You can apply again whenever there is more to show. A turned-down application is not
          a permanent no.
        </p>
        {open ? (
          formBlock
        ) : (
          <FlowButton tone="quiet" onClick={() => setOpen(true)}>
            Apply again
          </FlowButton>
        )}
      </Shell>
    );
  }

  // The pitch stays on the left either way; opening the form puts it beside the reasons to
  // fill it in, rather than replacing them.
  return (
    <Shell>
      <div className={open ? "grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-8" : "grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-8"}>
        <div className="min-w-0 space-y-5">
          <div className="space-y-2">
            <FlowLabel>Merchant track</FlowLabel>
            <Title>Bringing <span className="lp-serif">real volume?</span></Title>
            <p className="text-[15px] leading-[1.55] text-[var(--lp-body)]">
              If you run a community, an agency or a group that moves money regularly, you can
              earn a share of the fees in cash instead of credit, paid into your wallet every
              time your people cash out.
            </p>
          </div>
          {open && <Perks />}
          {!open && (
            <FlowButton onClick={() => setOpen(true)} className="md:w-auto md:px-8">
              Apply to become a Merchant
            </FlowButton>
          )}
        </div>
        {open ? formBlock : <Perks />}
      </div>
    </Shell>
  );
}

/**
 * The three reasons, each shown with a piece of the product rather than an icon: what a payout
 * looks like, how the tiers step up, what lands in the wallet. A glyph in a circle says
 * "feature"; the thing itself says what you get.
 */
const PERKS: { title: string; body: string; visual: React.ReactNode }[] = [
  {
    title: "Cash, not credit",
    body: "Your share arrives as USDC in your Sendzz wallet.",
    visual: (
      <span className="lp-display inline-flex items-baseline gap-1 text-[26px] leading-none tracking-[-0.03em] tabular-nums">
        $42.10
        <span className="lp-serif text-[14px] tracking-normal text-[var(--lp-muted)]">USDC</span>
      </span>
    ),
  },
  {
    title: "A rate that grows",
    body: "The more your network moves, the more you keep.",
    visual: (
      <span className="flex items-end gap-1" aria-hidden>
        {[
          { name: "Bronze", h: "h-3" },
          { name: "Silver", h: "h-5" },
          { name: "Gold", h: "h-7" },
        ].map((t, i) => (
          <span key={t.name} className="flex flex-col items-center gap-1">
            <span className={`w-9 rounded-[5px] ${t.h} ${i === 2 ? "bg-[#04c96a]" : "bg-[var(--lp-ink)]"}`} />
            <span className="lp-mono text-[9.5px] uppercase text-[var(--lp-muted)]">{t.name}</span>
          </span>
        ))}
      </span>
    ),
  },
  {
    title: "Nothing to claim",
    body: "Payouts land by themselves once you pass the minimum.",
    visual: (
      <span className="lp-card inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3">
        <span className="grid size-6 place-items-center rounded-full bg-[var(--lp-good-soft)] text-[11px] font-bold text-[var(--lp-good)]">+</span>
        <span className="text-[13px] font-semibold">Payout sent</span>
      </span>
    ),
  },
];

function Perks() {
  return (
    <ul className="divide-y divide-[rgb(var(--lp-hair)/0.12)] border-y border-[rgb(var(--lp-hair)/0.12)]">
      {PERKS.map((p) => (
        <li key={p.title} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
          <span className="min-w-[180px] flex-1">
            <span className="block text-[16px] font-semibold">{p.title}</span>
            <span className="mt-0.5 block text-[14px] leading-[1.5] text-[var(--lp-body)]">{p.body}</span>
          </span>
          <span className="shrink-0">{p.visual}</span>
        </li>
      ))}
    </ul>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="space-y-4 rounded-[28px] bg-[var(--lp-sand)] p-6 sm:p-8">{children}</section>;
}

function Title({ children }: { children: React.ReactNode }) {
  return <h2 className="lp-display text-[clamp(24px,4vw,30px)] leading-[1] tracking-[-0.03em]">{children}</h2>;
}

/** Quick answers for the volume question; typing any figure still works. */
const VOLUME_PICKS = [
  { label: "$5k", value: "5000" },
  { label: "$25k", value: "25000" },
  { label: "$100k+", value: "100000" },
];

function Form({
  form,
  setForm,
  busy,
  onSubmit,
  onCancel,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const set = (key: keyof FormState) => (value: string) => setForm({ ...form, [key]: value });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (form.organisation.trim() && !busy) onSubmit();
      }}
      className="lp-card min-w-0 space-y-5 rounded-[24px] p-5 animate-in fade-in slide-in-from-bottom-2 duration-300 sm:p-6"
    >
      <div>
        <FlowLabel>Your application</FlowLabel>
        <p className="mt-1 text-[17px] font-semibold">Tell us about your people.</p>
      </div>

      <FlowInput
        label={<Label text="What do you run?" />}
        placeholder="Lagos Freelancers Slack, 400 members"
        value={form.organisation}
        onChange={(e) => set("organisation")(e.target.value)}
        hint="One line is enough: what it is and roughly how many people."
        autoFocus
        required
      />

      <TextArea
        label={<Label text="Who are they?" optional />}
        placeholder="Designers and developers paid by clients in the US and Europe"
        value={form.audience}
        onChange={set("audience")}
      />

      <div>
        <FlowInput
          label={<Label text="Roughly how much would they cash out a month?" optional />}
          placeholder="15,000"
          value={form.expectedMonthlyVolumeUsdc}
          onChange={(e) => set("expectedMonthlyVolumeUsdc")(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          trailing={<span className="shrink-0 text-[14px] text-[var(--lp-muted)]">USD</span>}
        />
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Quick picks">
          {VOLUME_PICKS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => set("expectedMonthlyVolumeUsdc")(p.value)}
              aria-pressed={form.expectedMonthlyVolumeUsdc === p.value}
              className={
                form.expectedMonthlyVolumeUsdc === p.value
                  ? "h-8 rounded-full bg-[var(--lp-ink)] px-3 text-[13px] font-semibold text-[var(--lp-cream)]"
                  : "h-8 rounded-full bg-[var(--lp-cream)] px-3 text-[13px] font-semibold transition-colors hover:bg-[var(--lp-sand)]"
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TextArea
        label={<Label text="Anything else" optional />}
        placeholder="Links, how you'd introduce Sendzz, anything that helps"
        value={form.notes}
        onChange={set("notes")}
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <FlowButton type="button" tone="quiet" onClick={onCancel} disabled={busy} className="sm:w-36">
          Cancel
        </FlowButton>
        <FlowButton type="submit" loading={busy} disabled={!form.organisation.trim()} className="sm:flex-1">
          Send application
        </FlowButton>
      </div>
      <p className="text-center text-[13px] text-[var(--lp-muted)]">We read every one and reply within a few days.</p>
    </form>
  );
}

function Label({ text, optional }: { text: string; optional?: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span>{text}</span>
      {optional && <span className="shrink-0 text-[13px] font-normal text-[var(--lp-muted)]">Optional</span>}
    </span>
  );
}

function TextArea({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[14px] font-semibold">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-[18px] bg-[var(--lp-surface)] px-4 py-3 text-base shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 placeholder:text-[var(--lp-placeholder)] focus:outline-[var(--lp-ink)] md:text-[15px]"
      />
    </label>
  );
}

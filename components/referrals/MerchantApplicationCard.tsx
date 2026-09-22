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
import { Loader2, Store } from "lucide-react";
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
        <p className="font-bold text-brand-secondary">Your application is with us</p>
        <p className="text-[13px] text-brand-secondary/50 leading-relaxed">
          We read every one properly, so give us a few days. You keep earning fee credit in the
          meantime — nothing pauses while you wait.
        </p>
      </Shell>
    );
  }

  if (application?.status === "rejected") {
    return (
      <Shell>
        <p className="font-bold text-brand-secondary">Not this time</p>
        {application.decisionNote && (
          <p className="text-[13px] text-brand-secondary/50 leading-relaxed">
            {application.decisionNote}
          </p>
        )}
        <p className="text-[12.5px] text-brand-secondary/40 leading-relaxed">
          You can apply again whenever there is more to show — a turned-down application is not
          a permanent no.
        </p>
        {open ? (
          formBlock
        ) : (
          <button onClick={() => setOpen(true)} className="btn-secondary w-full">
            Apply again
          </button>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center text-brand-secondary/40 shrink-0">
          <Store className="w-5 h-5" />
        </div>
        <div className="space-y-1 min-w-0">
          <p className="font-bold text-brand-secondary">Bringing real volume?</p>
          <p className="text-[13px] text-brand-secondary/50 leading-relaxed">
            If you run a community, an agency or a group that moves money regularly, you can
            earn a share of the fees in cash instead of credit — paid into your wallet every
            time your people cash out.
          </p>
        </div>
      </div>

      {open ? (
        formBlock
      ) : (
        <button onClick={() => setOpen(true)} className="btn-secondary w-full">
          Apply to become a Merchant
        </button>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="card-glass p-6 md:p-8 space-y-4">{children}</div>;
}

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
    <div className="space-y-4 pt-2 border-t border-white/5">
      <Field
        label="What do you run?"
        placeholder="Lagos Freelancers Slack, 400 members"
        value={form.organisation}
        onChange={set("organisation")}
        autoFocus
      />
      <Field
        label="Who are they?"
        placeholder="Designers and developers paid by clients in the US and Europe"
        value={form.audience}
        onChange={set("audience")}
      />
      <Field
        label="Roughly how much would they cash out a month? (USD)"
        placeholder="15000"
        value={form.expectedMonthlyVolumeUsdc}
        onChange={(v) => set("expectedMonthlyVolumeUsdc")(v.replace(/[^\d.]/g, ""))}
        inputMode="decimal"
      />
      <Field
        label="Anything else"
        placeholder="Optional"
        value={form.notes}
        onChange={set("notes")}
        multiline
      />

      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <button onClick={onCancel} disabled={busy} className="btn-secondary flex-1">
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={busy || !form.organisation.trim()}
          className="btn-primary flex-1 gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? "Sending…" : "Send application"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  multiline,
  autoFocus,
  inputMode,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  autoFocus?: boolean;
  inputMode?: "decimal";
}) {
  const className =
    "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[13px] text-brand-secondary placeholder:text-brand-secondary/25 focus:outline-none focus:border-accent/60";

  return (
    <label className="block">
      <span className="block mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={className}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          inputMode={inputMode}
          className={className}
        />
      )}
    </label>
  );
}

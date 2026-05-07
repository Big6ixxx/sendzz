'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { batchSend, type SendResult } from '@/lib/batch-send';
import { ConnectedWallet } from '@privy-io/react-auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronRight,
  FileText,
  Mail,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  Users,
  X
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Recipient {
  id: string;
  email: string;
  valid: boolean;
}

type Step =
  | 'recipients'
  | 'amount'
  | 'preview'
  | 'confirm'
  | 'processing'
  | 'results';

interface BatchSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxAmount: number;
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  senderEmail: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRaw(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function mergeRecipients(emails: string[], existing: Recipient[]): Recipient[] {
  const seen = new Set(existing.map((r) => r.email));
  const next = [...existing];
  for (const email of emails) {
    if (seen.has(email)) continue;
    seen.add(email);
    next.push({
      id: `${Date.now()}-${Math.random()}`,
      email,
      valid: EMAIL_RE.test(email),
    });
  }
  return next;
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: 'recipients', label: 'RECIPIENTS' },
  { key: 'amount', label: 'CAPITAL' },
  { key: 'preview', label: 'VALIDATE' },
  { key: 'confirm', label: 'COMMIT' },
];

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  if (idx === -1) return null;

  return (
    <div className="grid grid-cols-4 gap-2 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex flex-col gap-1">
          <div
            className={`h-3 border-2 border-black transition-all ${
              i <= idx
                ? 'bg-neon shadow-[2px_2px_0_rgba(0,0,0,1)]'
                : 'bg-black/10'
            }`}
          />
          <span
            className={`text-[10px] font-oswald font-black uppercase tracking-tighter ${
              i === idx ? 'text-black' : 'text-gray-400'
            }`}
          >
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Email chip ─────────────────────────────────────────────────────────────────

function Chip({
  r,
  onRemove,
}: {
  r: Recipient;
  onRemove: (id: string) => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 border-2 border-black font-mono text-xs font-bold transition-all shadow-[2px_2px_0_rgba(0,0,0,1)] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_rgba(0,0,0,1)] ${
        r.valid ? 'bg-white text-black' : 'bg-red-500 text-white'
      }`}
    >
      <span className="truncate">{r.email}</span>
      <button
        type="button"
        onClick={() => onRemove(r.id)}
        className="hover:text-neon transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function BatchSendDialog({
  open,
  onOpenChange,
  maxAmount,
  smartAddress,
  embeddedProvider,
  senderEmail,
}: BatchSendDialogProps) {
  const [step, setStep] = useState<Step>('recipients');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [isDrag, setIsDrag] = useState(false);

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'NGN'>('USD');
  const [note, setNote] = useState('');

  const [search, setSearch] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const queryClient = useQueryClient();

  const [batchResults, setBatchResults] = useState<SendResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const fileRef = useRef<HTMLInputElement>(null);

  // Derived
  const valid = recipients.filter((r) => r.valid);
  const invalid = recipients.filter((r) => !r.valid);
  const amountUsd =
    currency === 'NGN'
      ? parseFloat(amount || '0') / 1500
      : parseFloat(amount || '0');
  const total = amountUsd * valid.length;
  const filtered = valid.filter((r) => r.email.includes(search.toLowerCase()));

  // Results derived
  const successes = batchResults.filter(
    (r) => r.status === 'success' || r.status === 'claim_required',
  );
  const failures = batchResults.filter((r) => r.status === 'failed');
  const claimRequired = batchResults.filter(
    (r) => r.status === 'claim_required',
  );

  // Recipient helpers
  const commitInput = useCallback(() => {
    const emails = parseRaw(inputVal);
    if (!emails.length) return;
    setRecipients((prev) => mergeRecipients(emails, prev));
    setInputVal('');
  }, [inputVal]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && inputVal === '')
      setRecipients((p) => p.slice(0, -1));
  };

  const remove = (id: string) =>
    setRecipients((p) => p.filter((r) => r.id !== id));

  const addOne = () => {
    const t = addEmail.trim();
    if (!t) return;
    setRecipients((p) => mergeRecipients([t], p));
    setAddEmail('');
    toast.success('Recipient added');
  };

  // File parsing
  const parseFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      let emails: string[] = [];
      if (file.name.endsWith('.csv')) {
        const lines = text.split('\n').filter(Boolean);
        const headerCols = lines[0]?.toLowerCase().split(',') ?? [];
        const colIdx = headerCols.findIndex((h) => h.trim().includes('email'));
        const idx = colIdx >= 0 ? colIdx : 0;
        emails = lines
          .slice(1)
          .map((l) => (l.split(',')[idx] ?? '').trim().replace(/^"|"$/g, ''));
      } else {
        emails = parseRaw(text);
      }
      setRecipients((prev) => mergeRecipients(emails, prev));
      const added = emails.filter((e) => EMAIL_RE.test(e)).length;
      toast.success(`Imported ${added} email${added !== 1 ? 's' : ''}`);
    };
    reader.readAsText(file);
  }, []);

  // Submit
  const handleConfirm = async (retryEmails?: string[]) => {
    if (!embeddedProvider) {
      toast.error('Wallet not connected');
      return;
    }

    const targetEmails = retryEmails || valid.map((r) => r.email);
    setStep('processing');
    setProgress({ done: 0, total: targetEmails.length });

    try {
      const provider = await embeddedProvider.getEthereumProvider();

      const results = await batchSend({
        recipients: targetEmails,
        amount: amountUsd.toString(),
        senderEmail,
        provider,
        onProgress: (done, total) => {
          setProgress({ done, total });
        },
      });

      if (retryEmails) {
        setBatchResults((prev) => {
          const updated = [...prev];
          results.forEach((newRes) => {
            const idx = updated.findIndex((r) => r.email === newRes.email);
            if (idx !== -1) updated[idx] = newRes;
            else updated.push(newRes);
          });
          return updated;
        });
      } else {
        setBatchResults(results);
      }

      setStep('results');
      // Invalidate balance and history immediately
      queryClient.invalidateQueries({ queryKey: ['balance', smartAddress] });
      queryClient.invalidateQueries({ queryKey: ['history', senderEmail] });

      if (results.some((r) => r.status === 'failed')) {
        toast.error('Some transfers failed. Review and retry.');
      } else {
        toast.success('All transfers completed successfully! 🎉');
      }
    } catch (err) {
      console.error('Batch send error:', err);
      toast.error('A critical error occurred during batch sending.');
      setStep('confirm');
    }
  };

  const handleRetryAllFailed = () => {
    const failedEmails = failures.map((f) => f.email);
    handleConfirm(failedEmails);
  };

  const handleRetrySingle = (email: string) => {
    handleConfirm([email]);
  };

  const handleClose = () => {
    if (
      step === 'processing' &&
      !confirm('Transfers are in progress. Are you sure you want to close?')
    ) {
      return;
    }
    onOpenChange(false);
    setTimeout(() => {
      setStep('recipients');
      setRecipients([]);
      setInputVal('');
      setAmount('');
      setCurrency('USD');
      setNote('');
      setSearch('');
      setAddEmail('');
      setBatchResults([]);
      setProgress({ done: 0, total: 0 });
    }, 250);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleClose()}>
      <DialogContent 
        onInteractOutside={(e) => {
          // Prevent closing if we are processing or if results are shown
          if (step === 'processing' || step === 'results') {
            e.preventDefault();
          }
        }}
        onPointerDownOutside={(e) => {
          if (step === 'processing' || step === 'results') {
            e.preventDefault();
          }
        }}
        className="sm:max-w-2xl bg-white dark:bg-black border-4 border-black p-0 overflow-hidden shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] rounded-none gap-0"
      >
        <DialogHeader className="p-6 bg-black text-white dark:bg-white dark:text-black border-b-4 border-black">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-neon text-black border-2 border-black">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <DialogTitle className="font-oswald text-3xl font-black uppercase tracking-tighter">
                Batch Transfer // Engine
              </DialogTitle>
              <DialogDescription className="text-neon/80 dark:text-black/60 font-mono text-xs uppercase font-bold mt-1">
                {step === 'recipients' && 'Upload/Enter target email addresses'}
                {step === 'amount' && 'Specify unit capital allocation'}
                {step === 'preview' && 'Review operational parameters'}
                {step === 'confirm' && 'Commit funds to blockchain'}
                {step === 'processing' && 'Executing multi-node transfer…'}
                {step === 'results' && 'Operational cycle complete'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-8 flex flex-col gap-0 max-h-[70vh] overflow-hidden">
          {step !== 'processing' && step !== 'results' && (
            <Stepper current={step} />
          )}

          {/* ── RECIPIENTS ── */}
          {step === 'recipients' && (
            <div className="flex flex-col gap-6 overflow-y-auto flex-1 pr-1">
              <div
                className={`brutal-card min-h-[160px] p-6 relative transition-all cursor-text ${
                  isDrag ? 'bg-neon/10 border-dashed scale-[0.99]' : ''
                }`}
                onClick={() =>
                  document.getElementById('batch-email-input')?.focus()
                }
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDrag(true);
                }}
                onDragLeave={() => setIsDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDrag(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) parseFile(f);
                }}
              >
                <div className="flex flex-wrap gap-2 mb-4">
                  {recipients.map((r) => (
                    <Chip key={r.id} r={r} onRemove={remove} />
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-black/40 shrink-0" />
                  <input
                    id="batch-email-input"
                    type="text"
                    className="flex-1 bg-transparent font-mono text-lg outline-none placeholder:text-black/30 dark:placeholder:text-white/30"
                    placeholder={
                      recipients.length === 0
                        ? 'IDENTIFIER@DOMAIN.COM…'
                        : 'ADD MORE…'
                    }
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={commitInput}
                    autoComplete="off"
                  />
                </div>
                {isDrag && (
                  <div className="absolute inset-0 bg-neon/40 flex items-center justify-center font-oswald font-black text-2xl uppercase">
                    Drop File Here
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between font-mono text-xs font-bold uppercase">
                <div className="flex gap-4">
                  {valid.length > 0 && (
                    <span className="text-black bg-neon px-2 py-0.5">
                      {valid.length} Validated
                    </span>
                  )}
                  {invalid.length > 0 && (
                    <span className="text-white bg-red-600 px-2 py-0.5">
                      {invalid.length} Malformed
                    </span>
                  )}
                </div>
                {recipients.length > 0 && (
                  <button
                    onClick={() => setRecipients([])}
                    className="hover:underline underline-offset-4"
                  >
                    Wipe All
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="brutal-card flex items-center gap-4 p-4 group hover:bg-black hover:text-white transition-all"
              >
                <div className="w-12 h-12 bg-neon border-2 border-black flex items-center justify-center group-hover:bg-white group-hover:text-black shrink-0">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <p className="font-oswald text-xl font-black uppercase tracking-tight">
                    Import Batch File
                  </p>
                  <p className="font-mono text-[10px] uppercase opacity-60">
                    Supports CSV (email column) or plain TXT
                  </p>
                </div>
                <FileText className="w-5 h-5 opacity-40" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) parseFile(f);
                  e.target.value = '';
                }}
              />

              <button
                onClick={() => setStep('amount')}
                disabled={valid.length === 0}
                className="brutal-btn w-full text-2xl mt-auto disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-4"
              >
                Allocate Capital ({valid.length})
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          )}

          {/* ── AMOUNT ── */}
          {step === 'amount' && (
            <div className="flex flex-col gap-8 overflow-y-auto flex-1 pr-1">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b-4 border-black pb-2">
                  <Label className="font-oswald text-2xl font-black uppercase tracking-tight">
                    Unit Amount per Node
                  </Label>
                  <button
                    onClick={() => {
                      setCurrency((c) => (c === 'USD' ? 'NGN' : 'USD'));
                      setAmount('');
                    }}
                    className="font-mono text-xs font-bold uppercase bg-black text-neon px-3 py-1 hover:bg-neon hover:text-black transition-colors"
                  >
                    Switch to {currency === 'USD' ? 'NGN' : 'USD'}
                  </button>
                </div>

                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-oswald text-5xl font-black opacity-30">
                    {currency === 'NGN' ? '₦' : '$'}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="brutal-input text-6xl font-oswald font-black pl-16 pr-16 h-24 text-right"
                    value={amount}
                    onChange={(e) =>
                      setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                    }
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xl font-black opacity-40">
                    {currency}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {[5, 10, 25, 50, 100].map((v) => {
                  const val = currency === 'NGN' ? v * 1500 : v;
                  return (
                    <button
                      key={v}
                      onClick={() => setAmount(val.toString())}
                      className="brutal-btn p-2 text-sm shadow-[3px_3px_0_rgba(0,0,0,1)]!"
                    >
                      {currency === 'NGN' ? `₦${v}K` : `$${v}`}
                    </button>
                  );
                })}
              </div>

              {amount && (
                <div className="brutal-card bg-neon p-6 space-y-4 shadow-[8px_8px_0_rgba(0,0,0,1)]!">
                  <div className="flex justify-between font-oswald text-2xl font-black uppercase tracking-tight border-b-2 border-black pb-2">
                    <span>Total Exposure</span>
                    <span
                      className={
                        total > maxAmount ? 'text-red-600' : 'text-black'
                      }
                    >
                      ${total.toFixed(2)} USDC
                    </span>
                  </div>
                  <div className="flex justify-between font-mono text-xs font-bold uppercase">
                    <span className="opacity-60">Recipients</span>
                    <span>{valid.length} Nodes</span>
                  </div>
                  {total > maxAmount && (
                    <div className="bg-red-600 text-white p-2 font-mono text-[10px] font-bold uppercase text-center">
                      ERROR: Capital exceeds available balance ($
                      {maxAmount.toFixed(2)})
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label className="font-mono text-xs font-bold uppercase">
                  Operational Memo
                </Label>
                <input
                  type="text"
                  placeholder="Memo tag…"
                  className="brutal-input text-lg font-mono"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                />
              </div>

              <div className="flex gap-4 mt-auto pt-4">
                <button
                  onClick={() => setStep('recipients')}
                  className="brutal-btn bg-white! flex-1"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('preview')}
                  disabled={!amount || amountUsd <= 0 || total > maxAmount}
                  className="brutal-btn flex-1 disabled:opacity-50"
                >
                  Review
                </button>
              </div>
            </div>
          )}

          {/* ── PREVIEW ── */}
          {step === 'preview' && (
            <div className="flex flex-col gap-6 overflow-hidden flex-1 min-h-0">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'NODES', value: valid.length },
                  { label: 'UNIT', value: `$${amountUsd.toFixed(2)}` },
                  { label: 'TOTAL', value: `$${total.toFixed(2)}` },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="brutal-card bg-black text-neon p-3 text-center shadow-[4px_4px_0_rgba(0,0,0,1)]!"
                  >
                    <p className="font-mono text-[10px] font-bold uppercase">
                      {label}
                    </p>
                    <p className="font-oswald text-xl font-black">{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/40" />
                  <input
                    type="text"
                    placeholder="FILTER NODES…"
                    className="brutal-input h-10 pl-10 text-sm font-mono uppercase"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 flex-1">
                  <input
                    type="email"
                    placeholder="ADD@EMAIL.COM"
                    className="brutal-input h-10 text-sm font-mono uppercase"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addOne()}
                  />
                  <button
                    onClick={addOne}
                    disabled={!addEmail.trim()}
                    className="brutal-btn p-0 w-10 h-10 flex items-center justify-center disabled:opacity-50"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto border-4 border-black bg-white dark:bg-black">
                <div className="grid grid-cols-[1fr_auto_auto] font-mono text-[10px] font-bold uppercase bg-black text-white p-2 sticky top-0 z-10">
                  <span>Identifier</span>
                  <span className="px-4 text-right">Amount</span>
                  <span className="w-8"></span>
                </div>
                {filtered.length === 0 ? (
                  <div className="p-8 text-center font-mono text-sm opacity-40 uppercase">
                    No nodes found
                  </div>
                ) : (
                  filtered.map((r, i) => (
                    <div
                      key={r.id}
                      className={`grid grid-cols-[1fr_auto_auto] items-center p-3 border-b-2 border-black last:border-0 hover:bg-neon hover:text-black transition-colors ${
                        i % 2 === 0 ? 'bg-black/5' : ''
                      }`}
                    >
                      <span className="font-mono text-xs truncate font-bold">
                        {r.email}
                      </span>
                      <span className="px-4 font-oswald font-bold text-sm">
                        ${amountUsd.toFixed(2)}
                      </span>
                      <button
                        onClick={() => remove(r.id)}
                        className="w-8 h-8 flex items-center justify-center hover:bg-red-600 hover:text-white transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-4 shrink-0">
                <button
                  onClick={() => setStep('amount')}
                  className="brutal-btn bg-white! flex-1"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('confirm')}
                  className="brutal-btn flex-1"
                >
                  Commit
                </button>
              </div>
            </div>
          )}

          {/* ── CONFIRM ── */}
          {step === 'confirm' && (
            <div className="flex flex-col gap-8 overflow-y-auto flex-1 py-4 text-center">
              <div className="w-32 h-32 bg-neon border-4 border-black mx-auto flex items-center justify-center shadow-[8px_8px_0_rgba(0,0,0,1)] rotate-3">
                <Users className="w-16 h-16" />
              </div>

              <div className="space-y-2">
                <h3 className="font-oswald text-5xl font-black uppercase tracking-tighter">
                  Final Commit
                </h3>
                <p className="font-mono text-sm font-bold uppercase opacity-60">
                  Authorize network dispatch to {valid.length} identifiers
                </p>
              </div>

              <div className="brutal-card bg-black text-neon p-8 space-y-6 shadow-[12px_12px_0_rgba(0,0,0,1)]!">
                <div className="flex justify-between items-center border-b-2 border-neon/30 pb-4">
                  <span className="font-mono text-xs uppercase font-bold opacity-70">
                    Total Principal
                  </span>
                  <span className="font-oswald text-4xl font-black">
                    ${total.toFixed(2)} USDC
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-xs uppercase font-bold opacity-70">
                    Paymaster Status
                  </span>
                  <span className="bg-neon text-black px-2 py-0.5 font-mono text-[10px] font-black uppercase">
                    Gas Sponsored
                  </span>
                </div>
              </div>

              <div className="bg-red-600 text-white p-4 border-4 border-black text-left flex gap-4 shadow-[4px_4px_0_rgba(0,0,0,1)]">
                <AlertCircle className="w-8 h-8 shrink-0" />
                <p className="font-mono text-xs font-bold uppercase leading-relaxed">
                  IMMEDIATE SETTLEMENT: Capital will be deducted from your smart
                  account upon signature. This action is irreversible on-chain.
                </p>
              </div>

              <div className="flex gap-4 mt-auto pt-6">
                <button
                  onClick={() => setStep('preview')}
                  className="brutal-btn bg-white! flex-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirm()}
                  className="brutal-btn flex-1 bg-neon text-black animate-pulse hover:animate-none"
                >
                  Confirm Sign
                </button>
              </div>
            </div>
          )}

          {/* ── PROCESSING ── */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-12 flex-1">
              <div className="relative">
                <div className="w-48 h-48 border-8 border-black border-t-neon rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-oswald text-5xl font-black">
                    {progress.total > 0
                      ? Math.round((progress.done / progress.total) * 100)
                      : 0}
                    %
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase opacity-60">
                    Syncing…
                  </span>
                </div>
              </div>
              <div className="text-center space-y-4">
                <h3 className="font-oswald text-4xl font-black uppercase tracking-tighter">
                  Executing Dispatch
                </h3>
                <div className="flex gap-2 justify-center">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-4 h-8 border-2 border-black ${i < (progress.done / progress.total) * 5 ? 'bg-neon shadow-[2px_2px_0_rgba(0,0,0,1)]' : 'bg-black/10'}`}
                    />
                  ))}
                </div>
                <p className="font-mono text-sm font-bold uppercase">
                  {progress.done} OF {progress.total} NODES SETTLED
                </p>
              </div>
            </div>
          )}

          {/* ── RESULTS ── */}
          {step === 'results' && (
            <div className="flex flex-col gap-8 overflow-hidden flex-1 py-4">
              <div className="grid grid-cols-2 gap-6">
                <div className="brutal-card bg-neon p-6 text-center shadow-[8px_8px_0_rgba(0,0,0,1)]!">
                  <p className="font-mono text-xs font-bold uppercase mb-2">
                    Success
                  </p>
                  <p className="font-oswald text-6xl font-black">
                    {successes.length}
                  </p>
                  <div className="font-mono text-[10px] font-bold uppercase mt-2 opacity-60">
                    {claimRequired.length} PENDING CLAIM
                  </div>
                </div>
                <div
                  className={`brutal-card p-6 text-center shadow-[8px_8px_0_rgba(0,0,0,1)]! ${
                    failures.length > 0
                      ? 'bg-red-600 text-white'
                      : 'bg-white text-black'
                  }`}
                >
                  <p className="font-mono text-xs font-bold uppercase mb-2">
                    Failed
                  </p>
                  <p className="font-oswald text-6xl font-black">
                    {failures.length}
                  </p>
                  {failures.length > 0 && (
                    <button
                      onClick={handleRetryAllFailed}
                      className="font-mono text-[10px] font-black uppercase underline decoration-2 underline-offset-4 mt-2 flex items-center justify-center gap-1 mx-auto"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Retry All
                    </button>
                  )}
                </div>
              </div>

              {failures.length > 0 && (
                <div className="flex flex-col gap-3 overflow-hidden flex-1 min-h-0">
                  <p className="font-oswald text-xl font-black uppercase tracking-tight text-red-600">
                    Error Log // Failed Nodes
                  </p>
                  <div className="overflow-y-auto flex-1 space-y-2 border-4 border-black bg-white dark:bg-black">
                    {failures.map((f) => (
                      <div
                        key={f.email}
                        className="flex items-center gap-4 p-4 border-b-2 border-black last:border-0 hover:bg-red-50 transition-colors"
                      >
                        <div className="w-10 h-10 bg-red-600 text-white border-2 border-black flex items-center justify-center shrink-0">
                          <X className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0 font-mono">
                          <p className="text-sm font-black truncate">
                            {f.email}
                          </p>
                          <p className="text-[10px] font-bold uppercase opacity-60 truncate">
                            {f.error || 'UNEXPECTED NETWORK ERROR'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRetrySingle(f.email)}
                          className="brutal-btn p-0 w-10 h-10 flex items-center justify-center bg-white!"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {failures.length === 0 && (
                <div className="flex flex-col items-center justify-center flex-1 py-12 gap-6 bg-neon border-4 border-black shadow-[8px_8px_0_rgba(0,0,0,1)]">
                  <Sparkles className="w-16 h-16 animate-pulse" />
                  <div className="text-center">
                    <h3 className="font-oswald text-4xl font-black uppercase tracking-tighter">
                      Cycle Complete
                    </h3>
                    <p className="font-mono text-sm font-bold uppercase opacity-70">
                      All nodes have been successfully settled.
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={handleClose}
                className="brutal-btn w-full text-2xl h-16"
              >
                Return to Terminal
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

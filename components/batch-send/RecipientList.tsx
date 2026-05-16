'use client';

import { cn } from '@/lib/utils';
import { ChevronRight, FileText, Mail, Upload, X } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { getUserContacts } from '@/lib/supabase/contacts';
import { useQuery } from '@tanstack/react-query';
import { useBatchSend } from './useBatchSend';

interface RecipientListProps {
  hook: ReturnType<typeof useBatchSend>;
  senderEmail: string;
}

export function RecipientList({ hook, senderEmail }: RecipientListProps) {
  const [inputVal, setInputVal] = React.useState('');
  const [isDrag, setIsDrag] = React.useState(false);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts', senderEmail],
    queryFn: () => getUserContacts(senderEmail),
    enabled: !!senderEmail,
  });

  const parseRaw = (raw: string): string[] => {
    return raw
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  };

  const commitInput = React.useCallback(() => {
    // Slight delay to allow clicking on suggestions
    setTimeout(() => {
      const emails = parseRaw(inputVal);
      if (emails.length) hook.addRecipients(emails);
      setInputVal('');
      setShowSuggestions(false);
    }, 150);
  }, [inputVal, hook]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (
      e.key === 'Backspace' &&
      inputVal === '' &&
      hook.recipients.length > 0
    ) {
      hook.removeRecipient(hook.recipients[hook.recipients.length - 1].id);
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      let emails: string[] = [];
      if (file.name.endsWith('.csv')) {
        const lines = text.split('\n').filter(Boolean);
        const header = lines[0]?.toLowerCase().split(',') ?? [];
        const idx = Math.max(
          0,
          header.findIndex((h) => h.includes('email')),
        );
        emails = lines
          .slice(1)
          .map((l) => (l.split(',')[idx] ?? '').trim().replace(/^"|"$/g, ''));
      } else {
        emails = parseRaw(text);
      }
      hook.addRecipients(emails);
      toast.success(`Imported recipients`);
    };
    reader.readAsText(file);
  };

  const invalid = hook.recipients.filter((r) => !r.valid);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-48">
      <div
        className={cn(
          'min-h-[200px] p-6 rounded-2xl border-2 border-dashed transition-all cursor-text relative bg-muted/20',
          isDrag
            ? 'border-foreground bg-muted/40 scale-[0.99]'
            : 'border-border hover:border-muted-foreground/50',
        )}
        onDragOver={(e) => (e.preventDefault(), setIsDrag(true))}
        onDragLeave={() => setIsDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        onClick={() => document.getElementById('batch-input')?.focus()}
      >
        <div className="flex flex-wrap gap-2 mb-4">
          {hook.recipients.map((r) => (
            <span
              key={r.id}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all',
                r.valid
                  ? 'bg-foreground text-background'
                  : 'bg-destructive text-destructive-foreground',
              )}
            >
              {r.email}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  hook.removeRecipient(r.id);
                }}
                className="hover:opacity-70"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-3 relative z-50">
          <Mail className="w-5 h-5 text-muted-foreground" />
          <input
            id="batch-input"
            type="text"
            className="flex-1 bg-transparent outline-none text-lg font-medium placeholder:text-muted-foreground/50"
            placeholder={
              hook.recipients.length === 0
                ? 'Enter email addresses...'
                : 'Add more...'
            }
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={onKeyDown}
            onBlur={commitInput}
            onFocus={() => setShowSuggestions(true)}
            autoComplete="off"
          />
        </div>

        {showSuggestions && contacts.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-[#0a0a0b] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-[100] max-h-64 overflow-y-auto p-2">
            {contacts
              .filter(
                (c) =>
                  c.name.toLowerCase().includes(inputVal.toLowerCase()) ||
                  c.email.toLowerCase().includes(inputVal.toLowerCase())
              )
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hook.addRecipients([c.email]);
                    setInputVal('');
                    setShowSuggestions(false);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 transition-colors flex items-center justify-between group"
                >
                  <span className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.email}</span>
                </button>
              ))}
          </div>
        )}

        {isDrag && (
          <div className="absolute inset-0 bg-background/80 rounded-2xl flex items-center justify-center font-bold text-xl uppercase tracking-tighter">
            Drop File to Import
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest">
          {hook.validRecipients.length > 0 && (
            <span className="text-foreground">
              {hook.validRecipients.length} Ready
            </span>
          )}
          {invalid.length > 0 && (
            <span className="text-destructive">{invalid.length} Invalid</span>
          )}
        </div>
        {hook.recipients.length > 0 && (
          <button
            onClick={() => hook.setRecipients([])}
            className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full p-4 rounded-2xl border border-border bg-muted/30 hover:bg-muted/50 transition-all flex items-center gap-4 group"
      >
        <div className="w-12 h-12 bg-background rounded-xl border border-border flex items-center justify-center group-hover:shadow-sm transition-all">
          <Upload className="w-5 h-5" />
        </div>
        <div className="flex-1 text-left">
          <p className="font-bold text-sm">Import from File</p>
          <p className="text-[10px] text-muted-foreground uppercase font-bold">
            CSV or TXT supported
          </p>
        </div>
        <FileText className="w-5 h-5 opacity-20" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      <button
        onClick={() => hook.setStep('amount')}
        disabled={hook.validRecipients.length === 0}
        className="btn-primary w-full h-14 text-lg gap-3 disabled:opacity-50"
      >
        Next: Set Amount ({hook.validRecipients.length})
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

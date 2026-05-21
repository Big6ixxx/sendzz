'use client';

import { cn } from '@/lib/utils';
import { ChevronRight, Mail, X } from 'lucide-react';
import * as React from 'react';
import { useBatchSend } from './useBatchSend';
import { BatchAddContactModal } from './BatchAddContactModal';
import { RecipientSuggestions } from './RecipientSuggestions';
import { ImportFromFile } from './ImportFromFile';
import { useRecipientList } from './useRecipientList';

interface RecipientListProps { hook: ReturnType<typeof useBatchSend>; senderEmail: string; }

export function RecipientList({ hook, senderEmail }: RecipientListProps) {
  const {
    inputVal,
    setInputVal,
    isDrag,
    setIsDrag,
    showSuggestions,
    setShowSuggestions,
    isAddingContact,
    setIsAddingContact,
    contacts,
    commitInput,
    onKeyDown,
    handleFile,
  } = useRecipientList({ hook, senderEmail });
  const invalid = hook.recipients.filter((r) => !r.valid);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-48">
      <div
        className={cn(
          'min-h-[200px] p-6 rounded-2xl border-2 border-dashed transition-all cursor-text relative bg-muted/20',
          isDrag ? 'border-foreground bg-muted/40 scale-[0.99]' : 'border-border hover:border-muted-foreground/50',
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
                r.valid ? 'bg-foreground text-background' : 'bg-destructive text-destructive-foreground',
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
            placeholder={hook.recipients.length === 0 ? 'Enter email addresses...' : 'Add more...'}
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

        <RecipientSuggestions
          isOpen={showSuggestions}
          inputVal={inputVal}
          contacts={contacts}
          onSelect={(email) => {
            hook.addRecipients([email]);
            setInputVal('');
            setShowSuggestions(false);
          }}
          onAddNew={() => {
            setIsAddingContact(true);
            setShowSuggestions(false);
          }}
        />

        {isDrag && (
          <div className="absolute inset-0 bg-background/80 rounded-2xl flex items-center justify-center font-bold text-xl uppercase tracking-tighter">
            Drop File to Import
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1">
        <div className="flex gap-4 text-[10px] font-bold uppercase tracking-widest">
          {hook.validRecipients.length > 0 && (
            <span className="text-foreground">{hook.validRecipients.length} Ready</span>
          )}
          {invalid.length > 0 && <span className="text-destructive">{invalid.length} Invalid</span>}
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

      <ImportFromFile onFileSelected={handleFile} />

      <button
        onClick={() => hook.setStep('amount')}
        disabled={hook.validRecipients.length === 0}
        className="btn-primary w-full h-14 text-lg gap-3 disabled:opacity-50"
      >
        Next: Set Amount ({hook.validRecipients.length})
        <ChevronRight className="w-5 h-5" />
      </button>

      <BatchAddContactModal
        isOpen={isAddingContact}
        onClose={() => setIsAddingContact(false)}
        senderEmail={senderEmail}
        defaultEmail={inputVal}
      />
    </div>
  );
}

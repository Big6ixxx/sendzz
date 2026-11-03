import * as React from 'react';
import { ChevronRight, Plus, Send } from 'lucide-react';
import { type ContactRow } from '@/lib/supabase/contacts';

interface RecipientSuggestionsProps {
  isOpen: boolean;
  inputVal: string;
  contacts: ContactRow[];
  onSelect: (email: string) => void;
  onAddNew: () => void;
  onClose?: () => void;
  actionIcon?: 'chevron' | 'send';
}

export function RecipientSuggestions({
  isOpen,
  inputVal,
  contacts,
  onSelect,
  onAddNew,
  onClose,
  actionIcon = 'chevron',
}: RecipientSuggestionsProps) {
  if (!isOpen) return null;

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(inputVal.toLowerCase()) ||
      c.email.toLowerCase().includes(inputVal.toLowerCase())
  );

  const small =
    'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors';

  return (
    <div className="absolute left-0 right-0 top-full z-100 mt-2 max-h-72 overflow-y-auto rounded-[22px] bg-white p-1.5 shadow-[0_0_0_1px_rgb(17_26_19/0.08),0_24px_48px_-20px_rgb(17_26_19/0.35)]">
      {contacts.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-[14px] text-[var(--lp-muted)]">No saved contacts yet.</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button type="button" onClick={onAddNew} className={`${small} bg-[var(--lp-ink)] text-[var(--lp-cream)]`}>
              <Plus className="size-3.5" /> Add a contact
            </button>
            {onClose && (
              <button type="button" onClick={onClose} className={`${small} text-[var(--lp-muted)] hover:bg-[var(--lp-cream)]`}>
                Close
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
            <span className="lp-mono text-[11.5px] uppercase text-[var(--lp-muted)]">Your contacts</span>
            <span className="flex items-center gap-1">
              <button type="button" onClick={onAddNew} className={`${small} hover:bg-[var(--lp-cream)]`}>
                <Plus className="size-3.5" /> New
              </button>
              {onClose && (
                <button type="button" onClick={onClose} className={`${small} text-[var(--lp-muted)] hover:bg-[var(--lp-cream)]`}>
                  Close
                </button>
              )}
            </span>
          </div>
          {filteredContacts.length === 0 ? (
            <p className="px-4 py-5 text-center text-[14px] text-[var(--lp-muted)]">No contact matches that.</p>
          ) : (
            filteredContacts.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect(c.email);
                }}
                className="group flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--lp-cream)]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--lp-sand)] text-[14px] font-semibold uppercase">
                  {(c.name || c.email).charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="block truncate text-[13px] text-[var(--lp-muted)]">{c.email}</span>
                </span>
                {actionIcon === 'send' ? (
                  <Send className="size-4 shrink-0 text-[var(--lp-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-[var(--lp-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            ))
          )}
        </>
      )}
    </div>
  );
}

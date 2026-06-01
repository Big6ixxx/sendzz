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

  return (
    <div className="absolute left-0 right-0 top-full mt-2 bg-brand-primary border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-100 max-h-64 overflow-y-auto p-2">
      {contacts.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-4">
            No contacts saved
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onAddNew}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-lg"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Contact
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center px-4 py-2 rounded-xl bg-white/5 text-white/40 font-black text-[10px] uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all shadow-lg"
              >
                Close
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 flex items-center justify-between border-b border-white/5 mb-1">
            <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">
              Suggestions
            </span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={onAddNew}
                className="text-[9px] font-black text-accent uppercase tracking-widest hover:text-accent-dim transition-colors"
              >
                + New
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="text-[9px] font-black text-white/40 uppercase tracking-widest hover:text-white transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
          {filteredContacts.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs font-bold text-white/30 uppercase tracking-widest">
                No contacts match your filter
              </p>
            </div>
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
                className="w-full text-left px-4 py-3 rounded-xl hover:bg-white/5 transition-colors flex items-center justify-between group"
              >
                <div className="flex flex-col">
                  <span className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">
                    {c.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">{c.email}</span>
                </div>
                <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {actionIcon === 'send' ? (
                    <Send className="w-3 h-3 text-accent" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-accent" />
                  )}
                </div>
              </button>
            ))
          )}
        </>
      )}
    </div>
  );
}

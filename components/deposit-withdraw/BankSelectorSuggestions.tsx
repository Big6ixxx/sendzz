import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BankContactRow } from '@/lib/supabase/bank-contacts';

interface BankSelectorSuggestionsProps {
  isOpen: boolean;
  accountNumber: string;
  contacts: BankContactRow[];
  onSelectContact: (contact: { bankCode: string; bankName: string; accountNumber: string; accountName: string }) => void;
  onDeleteContact: (contactId: string) => void;
  onClose: () => void;
  onAddNew: () => void;
}

export function BankSelectorSuggestions({
  isOpen,
  accountNumber,
  contacts,
  onSelectContact,
  onDeleteContact,
  onClose,
  onAddNew,
}: BankSelectorSuggestionsProps) {
  if (!isOpen) return null;

  const filteredContacts = contacts.filter(
    (c) =>
      c.account_number.includes(accountNumber) ||
      c.account_name.toLowerCase().includes(accountNumber.toLowerCase())
  );

  return (
    <div
      className="absolute z-50 top-full left-0 right-0 mt-2 border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 p-2"
      style={{ background: '#0a0a0c', borderColor: 'rgba(255,255,255,0.1)' }}
    >
      {contacts.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-4">
            No bank contacts saved
          </p>
          <button
            type="button"
            onClick={onAddNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-accent-foreground font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Bank Account
          </button>
        </div>
      ) : (
        <>
          <div className="px-2 py-1 flex items-center justify-between border-b border-white/5 mb-2">
            <span className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">
              Saved Accounts
            </span>
            <button
              type="button"
              onClick={onAddNew}
              className="text-[9px] font-black text-accent uppercase tracking-widest hover:text-accent-dim transition-colors"
            >
              + New
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredContacts.map((c) => (
              <div
                key={c.id}
                className="w-full flex items-center gap-2 group"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectContact({
                      bankCode: c.bank_code,
                      bankName: c.bank_name,
                      accountNumber: c.account_number,
                      accountName: c.account_name,
                    });
                    onClose();
                  }}
                  className="flex-1 text-left p-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <p className="font-bold text-xs text-foreground group-hover:text-accent transition-colors truncate">
                    {c.account_name}
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono">
                    {c.bank_name} • {c.account_number}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteContact(c.id);
                  }}
                  className="p-2 text-white/20 hover:text-red-400 transition-colors shrink-0 rounded-lg hover:bg-red-400/10"
                  title="Remove saved account"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

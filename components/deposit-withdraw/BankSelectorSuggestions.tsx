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
    <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-[20px] bg-[var(--lp-surface)] p-2 shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08),0_20px_48px_-16px_rgb(17_26_19/0.35)] animate-in fade-in slide-in-from-top-2 duration-200">
      {contacts.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-[14px] text-[var(--lp-muted)]">No saved accounts yet.</p>
          <button
            type="button"
            onClick={onAddNew}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-[var(--lp-ink)] px-4 text-[14px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.97]"
          >
            <Plus className="size-4" /> Save an account
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-2 pb-2 pt-1">
            <span className="lp-mono text-[11px] uppercase text-[var(--lp-muted)]">Saved accounts</span>
            <button type="button" onClick={onAddNew} className="text-[13px] font-semibold transition-colors hover:text-[var(--lp-link)]">
              + Add new
            </button>
          </div>
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {filteredContacts.map((c) => (
              <div key={c.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onSelectContact({ bankCode: c.bank_code, bankName: c.bank_name, accountNumber: c.account_number, accountName: c.account_name });
                    onClose();
                  }}
                  className="min-w-0 flex-1 rounded-[14px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--lp-cream)]"
                >
                  <p className="truncate text-[15px] font-semibold">{c.account_name}</p>
                  <p className="truncate text-[13px] text-[var(--lp-muted)]">
                    {c.bank_name} · <span className="tabular-nums">{c.account_number}</span>
                  </p>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteContact(c.id);
                  }}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[#a1462c]/10 hover:text-[var(--lp-danger)]"
                  title="Remove saved account"
                  aria-label={`Remove ${c.account_name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

'use client';

import { Trash2, Landmark } from 'lucide-react';
import { ContactToDelete } from './types';
import { BankContactRow } from '@/lib/supabase/bank-contacts';

interface BankContactCardProps {
  contact: BankContactRow;
  onSelectContact?: (accountNumber: string) => void;
  onDeleteRequest: (contact: ContactToDelete) => void;
}

export function BankContactCard({
  contact,
  onSelectContact,
  onDeleteRequest,
}: BankContactCardProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent shrink-0">
          <Landmark className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm text-white truncate">{contact.account_name}</p>
          <p className="text-xs text-muted-foreground truncate">{contact.bank_name} • {contact.account_number}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 self-end sm:self-auto shrink-0">
        {onSelectContact && (
          <button
            onClick={() => onSelectContact(contact.account_number)}
            className="px-4 py-2 bg-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors mr-2"
          >
            Select
          </button>
        )}
        <button
          onClick={() => onDeleteRequest({ id: contact.id, name: contact.account_name })}
          className="p-2 text-white/40 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

'use client';

import { PaycrestInstitution } from '@/lib/paycrest/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import * as React from 'react';
import { BankContactRow } from '@/lib/supabase/bank-contacts';
import { AddBankContactModal } from './AddBankContactModal';
import { BankSelectorDropdown } from './BankSelectorDropdown';
import { BankSelectorSuggestions } from './BankSelectorSuggestions';

interface BankSelectorProps {
  institutions: PaycrestInstitution[];
  selectedBankCode: string;
  onSelect: (bank: { code: string; name: string }) => void;
  accountNumber: string;
  onAccountNumberChange: (value: string) => void;
  accountName: string;
  isVerifying: boolean;
  label: string;
  disabled?: boolean;
  contacts?: BankContactRow[];
  userEmail?: string;
}

export function BankSelector({
  institutions,
  selectedBankCode,
  onSelect,
  accountNumber,
  onAccountNumberChange,
  accountName,
  isVerifying,
  label,
  disabled,
  contacts = [],
  userEmail = '',
}: BankSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [isAddingContact, setIsAddingContact] = React.useState(false);
  const selectedBank = institutions.find((i) => (i.institutionCode || i.code) === selectedBankCode);
  const filtered = React.useMemo(() => {
    if (!search) return institutions;
    return institutions.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));
  }, [institutions, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <label className="text-sm font-semibold mb-1.5 block text-muted-foreground">{label}</label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(!open)}
          className="input-elegant flex items-center justify-between group"
          style={{ background: '#141416', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <span className={cn(selectedBank ? 'text-foreground' : 'text-muted-foreground')}>
            {selectedBank?.name || 'Select a bank'}
          </span>
          <ChevronDown className={cn('w-4 h-4 transition-transform opacity-50', open && 'rotate-180')} />
        </button>
        <BankSelectorDropdown
          isOpen={open}
          search={search}
          onSearchChange={setSearch}
          filteredInstitutions={filtered}
          onSelect={(bank) => {
            onSelect(bank);
            setOpen(false);
            setSearch('');
          }}
        />
      </div>

      <div className="relative">
        <label className="text-sm font-semibold mb-1.5 block text-muted-foreground">Account Number</label>
        <div className="relative">
          <input
            type="text"
            maxLength={10}
            disabled={disabled}
            placeholder="0123456789"
            className="input-elegant tracking-widest font-mono"
            value={accountNumber}
            onChange={(e) => {
              onAccountNumberChange(e.target.value.replace(/\D/g, ''));
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {isVerifying ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : accountName ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : null}
          </div>
          <BankSelectorSuggestions
            isOpen={showSuggestions}
            accountNumber={accountNumber}
            contacts={contacts}
            onSelect={onSelect}
            onAccountNumberChange={onAccountNumberChange}
            onClose={() => setShowSuggestions(false)}
            onAddNew={() => {
              setIsAddingContact(true);
              setShowSuggestions(false);
            }}
          />
        </div>
      </div>

      <AddBankContactModal
        isOpen={isAddingContact}
        onClose={() => setIsAddingContact(false)}
        userEmail={userEmail}
        defaultAccountNumber={accountNumber}
        institutions={institutions}
      />

      {accountName && (
        <div className="p-4 bg-muted/50 rounded-xl border border-border animate-in fade-in slide-in-from-top-2 duration-300">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
            Confirmed Account Holder
          </p>
          <p className="font-semibold uppercase truncate">{accountName}</p>
        </div>
      )}
    </div>
  );
}

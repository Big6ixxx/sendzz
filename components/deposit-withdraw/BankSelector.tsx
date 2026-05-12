'use client';

import * as React from 'react';
import { PaycrestInstitution } from '@/lib/paycrest/types';
import { CheckCircle2, ChevronDown, Search, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  disabled
}: BankSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  
  const selectedBank = institutions.find(i => (i.institutionCode || i.code) === selectedBankCode);

  const filtered = React.useMemo(() => {
    if (!search) return institutions;
    return institutions.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
  }, [institutions, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <label className="text-sm font-semibold mb-1.5 block text-muted-foreground">
          {label}
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(!open)}
          className="input-elegant flex items-center justify-between group"
        >
          <span className={cn(selectedBank ? "text-foreground" : "text-muted-foreground")}>
            {selectedBank?.name || "Select a bank"}
          </span>
          <ChevronDown className={cn("w-4 h-4 transition-transform opacity-50", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-background border border-border rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-2 border-b border-border bg-muted/30">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search banks..."
                  className="w-full bg-transparent pl-9 pr-3 py-2 text-sm outline-none"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {filtered.map((inst) => (
                <button
                  key={inst.code}
                  type="button"
                  onClick={() => {
                    onSelect({ code: inst.institutionCode || inst.code, name: inst.name });
                    setOpen(false);
                    setSearch('');
                  }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-muted transition-colors border-b border-border/50 last:border-0"
                >
                  {inst.name}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No banks found
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <label className="text-sm font-semibold mb-1.5 block text-muted-foreground">
          Account Number
        </label>
        <div className="relative">
          <input
            type="text"
            maxLength={10}
            disabled={!selectedBankCode || disabled}
            placeholder="0123456789"
            className="input-elegant tracking-widest font-mono"
            value={accountNumber}
            onChange={(e) => onAccountNumberChange(e.target.value.replace(/\D/g, ''))}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {isVerifying ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : accountName ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : null}
          </div>
        </div>
      </div>

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

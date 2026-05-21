import * as React from 'react';
import { Search } from 'lucide-react';
import { PaycrestInstitution } from '@/lib/paycrest/types';

interface BankSelectorDropdownProps {
  isOpen: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  filteredInstitutions: PaycrestInstitution[];
  onSelect: (bank: { code: string; name: string }) => void;
}

export function BankSelectorDropdown({
  isOpen,
  search,
  onSearchChange,
  filteredInstitutions,
  onSelect,
}: BankSelectorDropdownProps) {
  if (!isOpen) return null;

  return (
    <div
      className="absolute z-50 top-full left-0 right-0 mt-2 border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      style={{ background: '#1a1a1c', borderColor: 'rgba(255,255,255,0.1)' }}
    >
      <div className="p-2 border-b border-border bg-muted/30">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search banks..."
            className="w-full bg-transparent pl-9 pr-3 py-2 text-sm outline-none"
            autoFocus
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {filteredInstitutions.map((inst) => (
          <button
            key={inst.code}
            type="button"
            onClick={() => {
              onSelect({
                code: inst.institutionCode || inst.code,
                name: inst.name,
              });
            }}
            className="w-full text-left px-4 py-3 text-sm hover:bg-muted transition-colors border-b border-border/50 last:border-0"
          >
            {inst.name}
          </button>
        ))}
        {filteredInstitutions.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No banks found
          </div>
        )}
      </div>
    </div>
  );
}

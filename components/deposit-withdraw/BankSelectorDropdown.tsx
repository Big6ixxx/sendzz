import * as React from 'react';
import { Search } from 'lucide-react';
import { RampInstitution } from '@/lib/ramp';

interface BankSelectorDropdownProps {
  isOpen: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  filteredInstitutions: RampInstitution[];
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
    <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-[20px] bg-[var(--lp-surface)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08),0_20px_48px_-16px_rgb(17_26_19/0.35)] animate-in fade-in zoom-in-95 duration-200">
      <label className="m-2 flex h-11 items-center gap-2 rounded-full bg-[var(--lp-cream)] px-3">
        <Search className="size-4 shrink-0 text-[var(--lp-muted)]" />
        <input
          type="text"
          placeholder="Search banks"
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--lp-placeholder)] md:text-[15px]"
          autoFocus
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </label>
      <div className="max-h-64 overflow-y-auto px-2 pb-2">
        {filteredInstitutions.map((inst) => (
          <button
            key={inst.code}
            type="button"
            onClick={() => onSelect({ code: inst.institutionCode || inst.code, name: inst.name })}
            className="w-full rounded-[14px] px-3 py-3 text-left text-[15px] transition-colors hover:bg-[var(--lp-cream)]"
          >
            {inst.name}
          </button>
        ))}
        {filteredInstitutions.length === 0 && <p className="px-4 py-8 text-center text-[14px] text-[var(--lp-muted)]">No bank matches that.</p>}
      </div>
    </div>
  );
}

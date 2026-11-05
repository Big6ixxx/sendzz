'use client';

import { RampInstitution } from '@/lib/ramp';
import { cn } from '@/lib/utils';
import { CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { BankContactRow, deleteBankContact } from '@/lib/supabase/bank-contacts';
import { FlowInput } from '@/components/flow/ui';
import { AddBankContactModal } from './AddBankContactModal';
import { BankSelectorDropdown } from './BankSelectorDropdown';
import { BankSelectorSuggestions } from './BankSelectorSuggestions';

interface BankSelectorProps {
  institutions: RampInstitution[];
  selectedBankCode: string;
  onSelect: (bank: { code: string; name: string }) => void;
  onSelectContact?: (contact: { bankCode: string; bankName: string; accountNumber: string; accountName: string }) => void;
  accountNumber: string;
  onAccountNumberChange: (value: string) => void;
  accountName: string;
  isVerifying: boolean;
  label: string;
  disabled?: boolean;
  contacts?: BankContactRow[];
  userEmail?: string;
  fiatCurrency?: string;
  onContactsChanged?: () => void;
  memo?: string;
  onMemoChange?: (value: string) => void;
  /** The number was only format-checked: the user must give the recipient's name. */
  recipientNameNeeded?: boolean;
  onAccountNameChange?: (value: string) => void;
}

export function BankSelector({
  institutions,
  selectedBankCode,
  onSelect,
  onSelectContact,
  accountNumber,
  onAccountNumberChange,
  accountName,
  memo,
  onMemoChange,
  recipientNameNeeded,
  onAccountNameChange,
  isVerifying,
  label,
  disabled,
  contacts = [],
  userEmail = '',
  fiatCurrency,
  onContactsChanged,
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

  const handleDeleteContact = React.useCallback(async (contactId: string) => {
    if (!userEmail) return;
    try {
      await deleteBankContact(contactId);
      toast.success('Account removed');
      onContactsChanged?.();
    } catch {
      toast.error('Failed to remove account');
    }
  }, [userEmail, onContactsChanged]);

  return (
    <div className="space-y-4">
      {/* Account number first: a saved account can be picked from what is typed. */}
      <div className="relative">
        <FlowInput
          label="Account number"
          type="text"
          inputMode="numeric"
          maxLength={16}
          disabled={disabled}
          placeholder="0123456789"
          className="tracking-[0.12em] tabular-nums"
          value={accountNumber}
          onChange={(e) => {
            onAccountNumberChange(e.target.value.replace(/\D/g, ''));
            setShowSuggestions(true);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          trailing={
            isVerifying ? (
              <Loader2 className="size-5 shrink-0 animate-spin text-[var(--lp-muted)]" />
            ) : accountName ? (
              <CheckCircle2 className="size-5 shrink-0 text-[var(--lp-good)]" />
            ) : null
          }
        />
        <BankSelectorSuggestions
          isOpen={showSuggestions}
          accountNumber={accountNumber}
          contacts={contacts}
          onSelectContact={(contact) => {
            if (onSelectContact) {
              onSelectContact(contact);
            } else {
              onSelect({ code: contact.bankCode, name: contact.bankName });
              onAccountNumberChange(contact.accountNumber);
            }
          }}
          onDeleteContact={handleDeleteContact}
          onClose={() => setShowSuggestions(false)}
          onAddNew={() => {
            setIsAddingContact(true);
            setShowSuggestions(false);
          }}
        />
      </div>

      <div className="relative">
        <p className="mb-1.5 text-[14px] font-semibold">{label}</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex h-14 w-full items-center justify-between gap-3 rounded-[18px] bg-[var(--lp-surface)] px-4 text-left text-base shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-visible:outline-[var(--lp-ink)] disabled:opacity-60"
        >
          <span className={cn('truncate', !selectedBank && 'text-[var(--lp-placeholder)]')}>{selectedBank?.name || (label === 'Bank' ? 'Choose a bank' : 'Choose a provider')}</span>
          <ChevronDown className={cn('size-4 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
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

      {/* No name enquiry exists for this number, so the name comes from the user — labelled as
          theirs, never shown under a "Verified" badge. */}
      {recipientNameNeeded && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          <FlowInput
            label="Recipient's full name"
            type="text"
            maxLength={80}
            disabled={disabled}
            autoComplete="off"
            placeholder="As registered on the mobile money account"
            value={accountName}
            onChange={(e) => onAccountNameChange?.(e.target.value)}
            hint="We checked the number's format. The name can't be looked up on this network, so enter it exactly as the recipient's account shows it."
          />
        </div>
      )}

      {/* Text, not an input: this name is the result of a name enquiry against the provider that
          settles the payout, the one thing on the form the user did not supply. While it was
          editable, anyone could type over a confirmed beneficiary and the typed value went on to
          the order, so the badge vouched for a name nobody had checked. */}
      {accountName && !recipientNameNeeded && (
        <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[var(--lp-green)]/15 px-4 py-3.5 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--lp-good)]">Account holder</p>
            <p className="break-words text-[16px] font-semibold uppercase tracking-wide">{accountName}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--lp-surface)] px-2.5 py-1 text-[12px] font-semibold text-[var(--lp-good)]">
            <CheckCircle2 className="size-3.5" /> Verified
          </span>
        </div>
      )}

      <FlowInput
        label={
          <>
            Reference <span className="font-normal text-[var(--lp-muted)]">(optional)</span>
          </>
        }
        type="text"
        maxLength={60}
        disabled={disabled}
        placeholder="A note for the payment"
        value={memo || ''}
        onChange={(e) => onMemoChange?.(e.target.value)}
      />

      <AddBankContactModal
        isOpen={isAddingContact}
        onClose={() => setIsAddingContact(false)}
        userEmail={userEmail}
        defaultAccountNumber={accountNumber}
        institutions={institutions}
        fiatCurrency={fiatCurrency}
        onSuccess={onContactsChanged}
      />
    </div>
  );
}

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { addBankContact } from '@/lib/supabase/bank-contacts';
import { verifyBankAccount } from '@/lib/actions/ramp';
import { RampInstitution } from '@/lib/ramp';
import { cn } from '@/lib/utils';
import { FlowButton, FlowDialog, FlowInput, Notice } from '@/components/flow/ui';

interface AddBankContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  defaultAccountNumber: string;
  institutions: RampInstitution[];
  fiatCurrency?: string;
  onSuccess?: () => void;
}

export function AddBankContactModal({
  isOpen,
  onClose,
  userEmail,
  defaultAccountNumber,
  institutions,
  fiatCurrency = 'NGN',
  onSuccess,
}: AddBankContactModalProps) {
  const [newAccountNumber, setNewAccountNumber] = React.useState(defaultAccountNumber);
  const [newAccountName, setNewAccountName] = React.useState('');
  const [newBank, setNewBank] = React.useState<{ code: string; name: string } | null>(null);
  const [newBankDropdownOpen, setNewBankDropdownOpen] = React.useState(false);
  const [newBankSearch, setNewBankSearch] = React.useState('');
  const [isVerifyingNew, setIsVerifyingNew] = React.useState(false);
  const [isAddingPending, setIsAddingPending] = React.useState(false);
  const [addError, setAddError] = React.useState('');

  const queryClient = useQueryClient();

  React.useEffect(() => {
    setNewAccountNumber(defaultAccountNumber);
  }, [defaultAccountNumber]);

  const newBankFiltered = React.useMemo(() => {
    if (!newBankSearch) return institutions;
    return institutions.filter((i) =>
      i.name.toLowerCase().includes(newBankSearch.toLowerCase())
    );
  }, [institutions, newBankSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBank || !newAccountName) return;
    setIsAddingPending(true);
    setAddError('');
    try {
      await addBankContact({
        bankName: newBank.name,
        bankCode: newBank.code,
        accountNumber: newAccountNumber,
        accountName: newAccountName,
      });
      toast.success('Bank account saved!');
      setNewAccountNumber('');
      setNewAccountName('');
      setNewBank(null);
      queryClient.invalidateQueries({ queryKey: ['bank_contacts', userEmail] });
      onSuccess?.();
      onClose();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add bank account');
    } finally {
      setIsAddingPending(false);
    }
  };

  // Each lookup is numbered; only the latest may set the name, so a slow answer for an earlier
  // number can never put the wrong holder beside the number now in the field.
  const lookup = React.useRef(0);
  const verify = (bank: { code: string; name: string } | null, number: string) => {
    const id = ++lookup.current;
    // A name belongs to one bank and one number: any change drops it until it is checked again.
    setNewAccountName('');
    if (!bank || number.length < 8) {
      setIsVerifyingNew(false);
      return;
    }
    setIsVerifyingNew(true);
    verifyBankAccount(bank.code, number, fiatCurrency, undefined, undefined, bank.name)
      .then((res) => {
        if (id !== lookup.current) return;
        const rawName = typeof res.data === 'string' ? res.data : res.data?.accountName;
        setNewAccountName(!rawName || rawName.trim().toUpperCase() === 'OK' ? `${bank.name} (${number})` : rawName);
      })
      .catch(() => {
        if (id === lookup.current) setNewAccountName('');
      })
      .finally(() => {
        if (id === lookup.current) setIsVerifyingNew(false);
      });
  };

  const pickBank = (inst: RampInstitution) => {
    const bank = { code: inst.institutionCode || inst.code, name: inst.name };
    setNewBank(bank);
    setNewBankDropdownOpen(false);
    setNewBankSearch('');
    verify(bank, newAccountNumber);
  };

  const onAccountNumber = (raw: string) => {
    const val = raw.replace(/\D/g, '');
    setNewAccountNumber(val);
    verify(newBank, val);
  };

  return (
    <FlowDialog
      open={isOpen}
      onClose={onClose}
      eyebrow="Bank accounts"
      title="Save"
      italic="a bank account."
      description="We check the account and show the holder's name before you save it."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="mb-1.5 text-[14px] font-semibold">Bank or mobile money</p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setNewBankDropdownOpen(!newBankDropdownOpen)}
              aria-expanded={newBankDropdownOpen}
              className="flex h-14 w-full items-center justify-between gap-3 rounded-[18px] bg-[var(--lp-surface)] px-4 text-left text-base shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-150 focus-visible:outline-[var(--lp-ink)]"
            >
              <span className={cn('truncate', newBank ? 'font-semibold' : 'text-[var(--lp-placeholder)]')}>
                {newBank?.name || 'Choose a bank'}
              </span>
              <ChevronDown className={cn('size-4 shrink-0 transition-transform', newBankDropdownOpen && 'rotate-180')} />
            </button>

            {newBankDropdownOpen && (
              <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-[22px] bg-[var(--lp-surface)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08),0_24px_48px_-20px_rgb(17_26_19/0.35)] animate-in fade-in zoom-in-95 duration-150">
                <label className="flex items-center gap-2 border-b border-[var(--lp-line)] px-4 py-3">
                  <Search className="size-4 shrink-0 text-[var(--lp-muted)]" />
                  <input
                    type="text"
                    placeholder="Search banks"
                    aria-label="Search banks"
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--lp-placeholder)]"
                    autoFocus
                    value={newBankSearch}
                    onChange={(e) => setNewBankSearch(e.target.value)}
                  />
                </label>
                <div className="max-h-56 overflow-y-auto p-1.5">
                  {newBankFiltered.map((inst) => (
                    <button
                      key={inst.code}
                      type="button"
                      onClick={() => pickBank(inst)}
                      className="block w-full rounded-[14px] px-3 py-2.5 text-left text-[15px] transition-colors hover:bg-[var(--lp-cream)]"
                    >
                      {inst.name}
                    </button>
                  ))}
                  {newBankFiltered.length === 0 && (
                    <p className="px-4 py-6 text-center text-[14px] text-[var(--lp-muted)]">No bank matches that.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <FlowInput
          label="Account number"
          type="text"
          inputMode="numeric"
          required
          maxLength={16}
          value={newAccountNumber}
          onChange={(e) => onAccountNumber(e.target.value)}
          placeholder="0123456789"
          className="lp-mono tracking-[0.12em]"
          trailing={isVerifyingNew ? <Loader2 className="size-5 shrink-0 animate-spin text-[var(--lp-muted)]" /> : undefined}
        />

        {newAccountName && (
          <div className="rounded-[18px] bg-[var(--lp-good-soft)] px-4 py-3.5 animate-in fade-in duration-200">
            <p className="text-[13px] text-[var(--lp-good)]">Account holder</p>
            <p className="mt-0.5 truncate text-[16px] font-semibold uppercase text-[var(--lp-ink)]">{newAccountName}</p>
          </div>
        )}

        {addError && <Notice tone="danger">{addError}</Notice>}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
          <FlowButton type="button" tone="quiet" onClick={onClose} disabled={isAddingPending} className="sm:w-32">
            Cancel
          </FlowButton>
          <FlowButton type="submit" loading={isAddingPending} disabled={!newAccountName} className="sm:flex-1">
            Save account
          </FlowButton>
        </div>
      </form>
    </FlowDialog>
  );
}

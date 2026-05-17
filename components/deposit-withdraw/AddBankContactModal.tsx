import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, Landmark, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { addBankContact } from '@/lib/supabase/bank-contacts';
import { verifyBankAccount } from '@/lib/actions/ramp';
import { PaycrestInstitution } from '@/lib/paycrest/types';
import { cn } from '@/lib/utils';

interface AddBankContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  defaultAccountNumber: string;
  institutions: PaycrestInstitution[];
}

export function AddBankContactModal({
  isOpen,
  onClose,
  userEmail,
  defaultAccountNumber,
  institutions,
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

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBank || !newAccountName) return;
    setIsAddingPending(true);
    setAddError('');
    try {
      await addBankContact({
        userEmail,
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
      onClose();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add bank account');
    } finally {
      setIsAddingPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-[#07070a]/90 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-sm card-glass p-8 bg-[#0a0a0b] animate-in zoom-in-95 duration-300">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-white/20 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center">
            <Landmark className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Save Bank Account</h3>
            <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Add to your address book</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2 relative">
            <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Select Bank</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setNewBankDropdownOpen(!newBankDropdownOpen)}
                className="w-full h-14 rounded-xl bg-white/5 border border-white/10 px-4 text-sm font-bold text-white flex items-center justify-between outline-none focus:border-accent/50 transition-colors"
              >
                <span className={newBank ? 'text-white' : 'text-white/40'}>
                  {newBank?.name || 'Select a bank'}
                </span>
                <ChevronDown className={cn('w-4 h-4 opacity-50 transition-transform', newBankDropdownOpen && 'rotate-180')} />
              </button>

              {newBankDropdownOpen && (
                <div
                  className="absolute z-[400] top-full left-0 right-0 mt-2 border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                  style={{ background: '#1a1a1c', borderColor: 'rgba(255,255,255,0.1)' }}
                >
                  <div className="p-2 border-b border-border bg-muted/30">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search banks..."
                        className="w-full bg-transparent pl-9 pr-3 py-2 text-sm outline-none font-normal"
                        autoFocus
                        value={newBankSearch}
                        onChange={(e) => setNewBankSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {newBankFiltered.map((inst) => (
                      <button
                        key={inst.code}
                        type="button"
                        onClick={() => {
                          setNewBank({ code: inst.institutionCode || inst.code, name: inst.name });
                          setNewBankDropdownOpen(false);
                          setNewBankSearch('');

                          if (newAccountNumber.length === 10) {
                            setIsVerifyingNew(true);
                            verifyBankAccount(inst.institutionCode || inst.code, newAccountNumber)
                              .then((res) => {
                                const name = typeof res.data === 'string' ? res.data : res.data?.accountName;
                                setNewAccountName(name || '');
                              })
                              .catch(() => setNewAccountName(''))
                              .finally(() => setIsVerifyingNew(false));
                          }
                        }}
                        className="w-full text-left px-4 py-3 text-sm font-normal hover:bg-muted transition-colors border-b border-border/50 last:border-0 text-white"
                      >
                        {inst.name}
                      </button>
                    ))}
                    {newBankFiltered.length === 0 && (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        No banks found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Account Number</label>
            <div className="relative">
              <input
                type="text"
                required
                maxLength={10}
                value={newAccountNumber}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setNewAccountNumber(val);
                  if (val.length === 10 && newBank) {
                    setIsVerifyingNew(true);
                    verifyBankAccount(newBank.code, val)
                      .then((res) => {
                        const name = typeof res.data === 'string' ? res.data : res.data?.accountName;
                        setNewAccountName(name || '');
                      })
                      .catch(() => setNewAccountName(''))
                      .finally(() => setIsVerifyingNew(false));
                  }
                }}
                placeholder="0123456789"
                className="input-elegant h-14 bg-white/5 tracking-widest font-mono"
              />
              {isVerifyingNew && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-accent" />}
            </div>
          </div>

          {newAccountName && (
            <div className="p-4 rounded-xl bg-accent/5 border border-accent/20 animate-in fade-in zoom-in-95 duration-300">
              <p className="text-[9px] font-black text-accent/50 uppercase tracking-widest mb-1">Account Holder</p>
              <p className="text-sm font-bold text-white uppercase truncate">{newAccountName}</p>
            </div>
          )}

          {addError && (
            <div className="p-4 rounded-xl bg-red-400/5 border border-red-400/10 text-red-400 text-xs font-bold uppercase">
              {addError}
            </div>
          )}

          <button
            type="submit"
            disabled={isAddingPending || !newAccountName}
            className="btn-accent w-full h-14 text-sm gap-2 disabled:opacity-50"
          >
            {isAddingPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Save Bank Account
          </button>
        </form>
      </div>
    </div>
  );
}

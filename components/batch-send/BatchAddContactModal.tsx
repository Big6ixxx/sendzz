import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { addContact } from '@/lib/supabase/contacts';

interface BatchAddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  senderEmail: string;
  defaultEmail: string;
}

export function BatchAddContactModal({
  isOpen,
  onClose,
  senderEmail,
  defaultEmail,
}: BatchAddContactModalProps) {
  const [newContactName, setNewContactName] = React.useState('');
  const [newContactEmail, setNewContactEmail] = React.useState(defaultEmail);
  const [addError, setAddError] = React.useState('');
  const [isAddingPending, setIsAddingPending] = React.useState(false);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    setNewContactEmail(defaultEmail);
  }, [defaultEmail]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingPending(true);
    setAddError('');
    try {
      await addContact({
        userEmail: senderEmail,
        contactEmail: newContactEmail,
        contactName: newContactName,
      });
      queryClient.invalidateQueries({ queryKey: ['contacts', senderEmail] });
      toast.success('Contact saved!');
      setNewContactName('');
      setNewContactEmail('');
      onClose();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setIsAddingPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 md:p-6">
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
            <UserPlus className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Save Contact</h3>
            <p className="text-xs text-white/40 uppercase tracking-widest font-medium">Add to your address book</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Full Name</label>
            <input
              type="text"
              required
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
              placeholder="e.g. Satoshi Nakamoto"
              className="input-elegant h-14 bg-white/5"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Email Address</label>
            <input
              type="email"
              required
              value={newContactEmail}
              onChange={(e) => setNewContactEmail(e.target.value)}
              placeholder="name@example.com"
              className="input-elegant h-14 bg-white/5"
            />
          </div>

          {addError && (
            <div className="p-4 rounded-xl bg-red-400/5 border border-red-400/10 text-red-400 text-xs font-bold uppercase">
              {addError}
            </div>
          )}

          <button
            type="submit"
            disabled={isAddingPending}
            className="btn-accent w-full h-14 text-sm gap-2"
          >
            {isAddingPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Save Contact
          </button>
        </form>
      </div>
    </div>
  );
}

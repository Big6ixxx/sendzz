'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { addContact } from '@/lib/supabase/contacts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  senderEmail: string;
  defaultEmail?: string;
  onSuccess?: () => void;
}

export function AddContactModal({
  isOpen,
  onClose,
  senderEmail,
  defaultEmail = '',
  onSuccess,
}: AddContactModalProps) {
  const [newContactName, setNewContactName] = React.useState('');
  const [newContactEmail, setNewContactEmail] = React.useState(defaultEmail);
  const [addError, setAddError] = React.useState('');
  const [isAddingPending, setIsAddingPending] = React.useState(false);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (isOpen) {
      setNewContactEmail(defaultEmail);
    }
  }, [isOpen, defaultEmail]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactName.trim() || !newContactEmail.trim()) return;

    setIsAddingPending(true);
    setAddError('');
    try {
      await addContact({
        userEmail: senderEmail,
        contactEmail: newContactEmail.trim(),
        contactName: newContactName.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ['contacts', senderEmail] });
      toast.success('Contact saved!');
      setNewContactName('');
      setNewContactEmail('');
      onSuccess?.();
      onClose();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setIsAddingPending(false);
    }
  };

  const handleClose = () => {
    if (!isAddingPending) {
      setNewContactName('');
      setNewContactEmail('');
      setAddError('');
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center shrink-0">
              <UserPlus className="w-6 h-6 text-accent" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Save Contact</DialogTitle>
              <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mt-0.5">
                Add to your address book
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-2">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Full Name</label>
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
            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">Email Address</label>
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

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isAddingPending}
              className="flex-1 h-14 rounded-xl text-xs font-bold uppercase tracking-widest border border-white/10 text-muted-foreground hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isAddingPending}
              className="flex-1 btn-accent h-14 text-sm gap-2"
            >
              {isAddingPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { addContact } from '@/lib/supabase/contacts';
import { Loader2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface AddEmailContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
  onSuccess?: () => void;
}

export function AddEmailContactModal({
  isOpen,
  onClose,
  userEmail,
  onSuccess,
}: AddEmailContactModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setSaving(true);
    try {
      await addContact({ userEmail, contactEmail: email.trim(), contactName: name.trim() });
      toast.success('Recipient saved');
      setName('');
      setEmail('');
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save recipient');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setName('');
      setEmail('');
      onClose();
    }
  };

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm font-medium text-brand-secondary placeholder-brand-secondary/30 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/40 transition-all';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md bg-background border-border rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-foreground flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-accent" />
            Add Recipient
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40">
              Name
            </label>
            <input
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/40">
              Email address
            </label>
            <input
              type="email"
              placeholder="john@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              required
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="flex-1 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest border border-white/10 text-brand-secondary/60 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim() || !email.trim()}
              className="flex-1 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest btn-accent flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

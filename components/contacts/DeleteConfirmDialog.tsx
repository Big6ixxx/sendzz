'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ContactToDelete } from './types';

interface DeleteConfirmDialogProps {
  contactToDelete: ContactToDelete | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  contactToDelete,
  isPending,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog
      open={!!contactToDelete}
      onOpenChange={(open) => !open && onCancel()}
    >
      <DialogContent className="sm:max-w-md bg-background border-border rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-black uppercase tracking-tighter text-foreground flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Delete Contact
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-2">
            Are you sure you want to delete{' '}
            <span className="font-bold text-foreground">
              {contactToDelete?.name}
            </span>
            ? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 mt-6 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-muted transition-colors text-muted-foreground"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-red-500 hover:bg-red-600 text-white transition-colors flex items-center gap-2"
          >
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Delete
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

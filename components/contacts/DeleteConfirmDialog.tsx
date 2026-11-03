'use client';

import { FlowConfirm } from '@/components/flow/ui';
import { ContactToDelete } from './types';

interface DeleteConfirmDialogProps {
  contactToDelete: ContactToDelete | null;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Removing a saved recipient or bank account: names who goes, and says it can be re-added. */
export function DeleteConfirmDialog({ contactToDelete, isPending, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  return (
    <FlowConfirm
      open={!!contactToDelete}
      onClose={onCancel}
      eyebrow="Saved recipients"
      title="Remove"
      italic="this contact?"
      confirmLabel="Remove"
      cancelLabel="Keep it"
      onConfirm={onConfirm}
      loading={isPending}
      tone="danger"
    >
      <span className="font-semibold text-[var(--lp-ink)]">{contactToDelete?.name}</span> will no longer be suggested
      when you send. You can add them again any time.
    </FlowConfirm>
  );
}

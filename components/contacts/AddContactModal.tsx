'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { addContact } from '@/lib/supabase/contacts';
import { FlowButton, FlowDialog, FlowInput, Notice } from '@/components/flow/ui';

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
    <FlowDialog
      open={isOpen}
      onClose={handleClose}
      eyebrow="Saved recipients"
      title="Save"
      italic="a contact."
      description="Pick them from a list next time instead of typing their email."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <FlowInput
          label="Their name"
          type="text"
          required
          value={newContactName}
          onChange={(e) => setNewContactName(e.target.value)}
          placeholder="Ada Okafor"
          autoComplete="off"
        />
        <FlowInput
          label="Their email"
          type="email"
          required
          value={newContactEmail}
          onChange={(e) => setNewContactEmail(e.target.value)}
          placeholder="name@example.com"
          autoComplete="off"
        />

        {addError && <Notice tone="danger">{addError}</Notice>}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
          <FlowButton type="button" tone="quiet" onClick={handleClose} disabled={isAddingPending} className="sm:w-32">
            Cancel
          </FlowButton>
          <FlowButton type="submit" loading={isAddingPending} disabled={!newContactName.trim() || !newContactEmail.trim()} className="sm:flex-1">
            Save contact
          </FlowButton>
        </div>
      </form>
    </FlowDialog>
  );
}

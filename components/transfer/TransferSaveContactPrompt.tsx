import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlowConfirm } from '@/components/flow/ui';
import { shortenDetail } from '@/components/dashboard/activity-look';
import { addContact } from '@/lib/supabase/contacts';
import { toast } from 'sonner';

interface TransferSaveContactPromptProps {
  isOpen: boolean;
  onClose: () => void;
  senderEmail: string;
  recipientEmail: string;
}

export function TransferSaveContactPrompt({
  isOpen,
  onClose,
  senderEmail,
  recipientEmail,
}: TransferSaveContactPromptProps) {
  const [isAddingPending, setIsAddingPending] = useState(false);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setIsAddingPending(true);
    try {
      await addContact({
        contactEmail: recipientEmail,
        contactName: recipientEmail.split('@')[0],
      });
      queryClient.invalidateQueries({
        queryKey: ['contacts', senderEmail],
      });
      toast.success('Contact saved successfully!');
      onClose();
    } catch (err) {
      console.error('Failed to save contact', err);
    } finally {
      setIsAddingPending(false);
    }
  };

  return (
    <FlowConfirm
      open={isOpen}
      onClose={onClose}
      eyebrow="Sent"
      title="Save"
      italic="this contact?"
      confirmLabel="Save contact"
      cancelLabel="Not now"
      onConfirm={handleSave}
      loading={isAddingPending}
      tone="accent"
    >
      Next time, pick{' '}
      <span className="font-semibold text-[var(--lp-ink)]" title={recipientEmail}>
        {shortenDetail(recipientEmail)}
      </span>{' '}
      from your contacts instead of typing the address.
    </FlowConfirm>
  );
}

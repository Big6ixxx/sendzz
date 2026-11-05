import { FlowConfirm } from '@/components/flow/ui';
import { shortenDetail } from '@/components/dashboard/activity-look';

interface FirstTimeTransferWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  recipientEmail: string;
}

export function FirstTimeTransferWarningModal({
  isOpen,
  onClose,
  onConfirm,
  recipientEmail,
}: FirstTimeTransferWarningModalProps) {
  return (
    <FlowConfirm
      open={isOpen}
      onClose={onClose}
      eyebrow="Before you send"
      title="Someone"
      italic="new?"
      confirmLabel="Yes, send it"
      cancelLabel="Let me check"
      onConfirm={onConfirm}
    >
      You haven&apos;t sent to{' '}
      <span className="font-semibold text-[var(--lp-ink)]" title={recipientEmail}>
        {shortenDetail(recipientEmail)}
      </span>{' '}
      before. Check every letter of the address: money sent to the wrong email is hard to get back.
    </FlowConfirm>
  );
}

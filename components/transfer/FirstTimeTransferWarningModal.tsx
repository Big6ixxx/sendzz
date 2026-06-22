import { AlertTriangle } from 'lucide-react';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-[#07070a]/80 backdrop-blur-md cursor-pointer"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm card-glass p-8 bg-brand-primary animate-in fade-in zoom-in-95 duration-300 text-center border-accent/10 shadow-[0_0_50px_rgba(0,232,122,0.08)]">
        <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-6 border border-accent/20">
          <AlertTriangle className="w-8 h-8 text-accent" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">
          New Recipient Warning
        </h3>
        <p className="text-sm text-white/40 mb-8 font-medium">
          You have <span className="text-accent font-semibold">never</span> sent funds to <span className="text-white font-semibold">{recipientEmail}</span> before. Please double-check the email address to prevent loss of funds.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={onConfirm}
            className="btn-accent w-full h-14 transition-all duration-300"
          >
            Yes, Proceed Transfer
          </button>
          <button
            onClick={onClose}
            className="w-full h-12 text-sm font-bold text-white/40 hover:text-white transition-colors duration-300"
          >
            Cancel and Check
          </button>
        </div>
      </div>
    </div>
  );
}

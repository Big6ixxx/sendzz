import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
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

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsAddingPending(true);
    try {
      await addContact({
        userEmail: senderEmail,
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
    <div className="fixed inset-0 z-210 flex items-center justify-center p-4 md:p-6">
      <div
        className="absolute inset-0 bg-[#07070a]/80 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm card-glass p-8 bg-brand-primary animate-in fade-in zoom-in-95 duration-300 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-6">
          <UserPlus className="w-8 h-8 text-accent" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">
          Save to Contacts?
        </h3>
        <p className="text-sm text-white/40 mb-8 font-medium">
          Would you like to save <span className="text-white">{recipientEmail}</span> to your address book for future transfers?
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleSave}
            disabled={isAddingPending}
            className="btn-accent w-full h-14"
          >
            {isAddingPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              'Yes, Save Contact'
            )}
          </button>
          <button
            onClick={onClose}
            className="w-full h-12 text-sm font-bold text-white/40 hover:text-white transition-colors"
          >
            No, Thanks
          </button>
        </div>
      </div>
    </div>
  );
}

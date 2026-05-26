import * as React from 'react';
import { useUserContacts } from '@/components/contacts/useContacts';
import { useBatchSend } from './useBatchSend';
import { toast } from 'sonner';

interface UseRecipientListProps {
  hook: ReturnType<typeof useBatchSend>;
  senderEmail: string;
}

export function useRecipientList({ hook, senderEmail }: UseRecipientListProps) {
  const [inputVal, setInputVal] = React.useState('');
  const [isDrag, setIsDrag] = React.useState(false);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [isAddingContact, setIsAddingContact] = React.useState(false);

  const { data: contacts = [] } = useUserContacts(senderEmail);

  const parseRaw = (raw: string): string[] => {
    return raw
      .split(/[\n,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  };

  const commitInput = React.useCallback(() => {
    setTimeout(() => {
      const emails = parseRaw(inputVal);
      if (emails.length) hook.addRecipients(emails);
      setInputVal('');
      setShowSuggestions(false);
    }, 150);
  }, [inputVal, hook]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (
      e.key === 'Backspace' &&
      inputVal === '' &&
      hook.recipients.length > 0
    ) {
      hook.removeRecipient(hook.recipients[hook.recipients.length - 1].id);
    }
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      let emails: string[] = [];
      if (file.name.endsWith('.csv')) {
        const lines = text.split('\n').filter(Boolean);
        const header = lines[0]?.toLowerCase().split(',') ?? [];
        const idx = Math.max(
          0,
          header.findIndex((h) => h.includes('email')),
        );
        emails = lines
          .slice(1)
          .map((l) => (l.split(',')[idx] ?? '').trim().replace(/^"|"$/g, ''));
      } else {
        emails = parseRaw(text);
      }
      hook.addRecipients(emails);
      toast.success(`Imported recipients`);
    };
    reader.readAsText(file);
  };

  return {
    inputVal,
    setInputVal,
    isDrag,
    setIsDrag,
    showSuggestions,
    setShowSuggestions,
    isAddingContact,
    setIsAddingContact,
    contacts,
    commitInput,
    onKeyDown,
    handleFile,
  };
}

import { Loader2 } from 'lucide-react';
import { BankContactCard } from './BankContactCard';
import { BankContactRow } from '@/lib/supabase/bank-contacts';
import { ContactToDelete } from './types';

interface BankContactListProps {
  bankContacts: BankContactRow[];
  isLoading: boolean;
  onDeleteRequest: (contact: ContactToDelete) => void;
}

export function BankContactList({
  bankContacts,
  isLoading,
  onDeleteRequest,
}: BankContactListProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  if (bankContacts.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm font-medium">
          No bank contacts found. Add one during your next withdrawal.
        </p>
      </div>
    );
  }

  return (
    <>
      {bankContacts.map((contact) => (
        <BankContactCard
          key={contact.id}
          contact={contact}
          onDeleteRequest={onDeleteRequest}
        />
      ))}
    </>
  );
}

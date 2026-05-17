import { Loader2 } from 'lucide-react';
import { ContactCard } from './ContactCard';
import { Contact, ContactToDelete } from './types';

interface MailContactListProps {
  contacts: Contact[];
  isLoading: boolean;
  editingContactId: string | null;
  editName: string;
  editEmail: string;
  isUpdatePending: boolean;
  onSelectContact?: (email: string) => void;
  onStartEdit: (contact: Contact) => void;
  onEditNameChange: (name: string) => void;
  onEditEmailChange: (email: string) => void;
  onEditSubmit: (e: React.FormEvent) => void;
  onCancelEdit: () => void;
  onDeleteRequest: (contact: ContactToDelete) => void;
}

export function MailContactList({
  contacts,
  isLoading,
  ...props
}: MailContactListProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm font-medium">No mail contacts found.</p>
      </div>
    );
  }

  return (
    <>
      {contacts.map((contact) => (
        <ContactCard
          key={contact.id}
          contact={contact}
          {...props}
        />
      ))}
    </>
  );
}

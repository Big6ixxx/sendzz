'use client';

import { Edit2, Trash2 } from 'lucide-react';
import { Contact, ContactToDelete } from './types';
import { EditContactForm } from './EditContactForm';

interface ContactCardProps {
  contact: Contact;
  editingContactId: string | null;
  editName: string;
  editEmail: string;
  isUpdatePending: boolean;
  onSelectContact?: (email: string) => void;
  onStartEdit: (contact: Contact) => void;
  onEditNameChange: (v: string) => void;
  onEditEmailChange: (v: string) => void;
  onEditSubmit: (e: React.FormEvent) => void;
  onCancelEdit: () => void;
  onDeleteRequest: (contact: ContactToDelete) => void;
}

export function ContactCard({
  contact,
  editingContactId,
  editName,
  editEmail,
  isUpdatePending,
  onSelectContact,
  onStartEdit,
  onEditNameChange,
  onEditEmailChange,
  onEditSubmit,
  onCancelEdit,
  onDeleteRequest,
}: ContactCardProps) {
  if (editingContactId === contact.id) {
    return (
      <EditContactForm
        name={editName}
        email={editEmail}
        isPending={isUpdatePending}
        onNameChange={onEditNameChange}
        onEmailChange={onEditEmailChange}
        onSubmit={onEditSubmit}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold uppercase shrink-0">
          {contact.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm text-white truncate">{contact.name}</p>
          <p className="text-xs text-muted-foreground truncate">{contact.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 self-end sm:self-auto shrink-0">
        {onSelectContact && (
          <button
            onClick={() => onSelectContact(contact.email)}
            className="px-4 py-2 bg-white/10 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors mr-2"
          >
            Select
          </button>
        )}
        <button
          onClick={() => onStartEdit(contact)}
          className="p-2 text-white/40 hover:text-accent transition-colors"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDeleteRequest({ id: contact.id, name: contact.name })}
          className="p-2 text-white/40 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

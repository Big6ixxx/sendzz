'use client';

import { addContact, deleteContact, getUserContacts, updateContact } from '@/lib/supabase/contacts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookUser, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { AddContactForm } from './contacts/AddContactForm';
import { ContactCard } from './contacts/ContactCard';
import { DeleteConfirmDialog } from './contacts/DeleteConfirmDialog';
import { Contact, ContactToDelete } from './contacts/types';

interface ContactsModuleProps {
  userEmail: string;
  onSelectContact?: (email: string) => void;
}

export function ContactsModule({ userEmail, onSelectContact }: ContactsModuleProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState('');

  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const [contactToDelete, setContactToDelete] = useState<ContactToDelete | null>(null);

  const queryClient = useQueryClient();
  const queryKey = ['contacts', userEmail];

  const { data: contacts = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getUserContacts(userEmail),
    enabled: !!userEmail,
  });

  const addMutation = useMutation({
    mutationFn: () => addContact({ userEmail, contactEmail: newEmail, contactName: newName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setIsAdding(false);
      setNewName('');
      setNewEmail('');
      setError('');
    },
    onError: (err: Error) => setError(err.message || 'Failed to add contact'),
  });

  const deleteMutation = useMutation({
    mutationFn: (contactId: string) => deleteContact(userEmail, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setContactToDelete(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editingContactId) return Promise.resolve({ success: true as const });
      return updateContact({ userEmail, contactId: editingContactId, contactEmail: editEmail, contactName: editName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setEditingContactId(null);
      setError('');
    },
    onError: (err: Error) => setError(err.message || 'Failed to update contact'),
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) return;
    addMutation.mutate();
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName || !editEmail) return;
    updateMutation.mutate();
  };

  const handleStartEdit = (contact: Contact) => {
    setEditingContactId(contact.id);
    setEditName(contact.name);
    setEditEmail(contact.email);
    setError('');
    setIsAdding(false);
  };

  return (
    <div className="card-elegant p-8 md:p-12 bg-background border-border relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-10 border-b border-border/50 pb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-foreground text-background rounded-2xl shadow-lg">
            <BookUser className="w-6 h-6 md:w-8 md:h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">Contacts</h2>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Manage your address book
            </p>
          </div>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/10 text-accent font-bold text-xs uppercase tracking-widest hover:bg-accent/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        )}
      </div>

      {/* Add Form */}
      {isAdding && (
        <AddContactForm
          name={newName}
          email={newEmail}
          error={error}
          isPending={addMutation.isPending}
          onNameChange={setNewName}
          onEmailChange={setNewEmail}
          onSubmit={handleAddSubmit}
          onClose={() => { setIsAdding(false); setError(''); }}
        />
      )}

      {/* Contact List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-muted-foreground text-sm font-medium">No contacts found.</p>
          </div>
        ) : (
          (contacts as Contact[]).map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              editingContactId={editingContactId}
              editName={editName}
              editEmail={editEmail}
              isUpdatePending={updateMutation.isPending}
              onSelectContact={onSelectContact}
              onStartEdit={handleStartEdit}
              onEditNameChange={setEditName}
              onEditEmailChange={setEditEmail}
              onEditSubmit={handleEditSubmit}
              onCancelEdit={() => { setEditingContactId(null); setError(''); }}
              onDeleteRequest={setContactToDelete}
            />
          ))
        )}
      </div>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        contactToDelete={contactToDelete}
        isPending={deleteMutation.isPending}
        onConfirm={() => contactToDelete && deleteMutation.mutate(contactToDelete.id)}
        onCancel={() => setContactToDelete(null)}
      />
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addContact, deleteContact, getUserContacts, updateContact } from '@/lib/supabase/contacts';
import { deleteBankContact, getUserBankContacts } from '@/lib/supabase/bank-contacts';
import { Contact, ContactToDelete } from './types';

export function useContacts(userEmail: string) {
  const [activeTab, setActiveTab] = useState<'mail' | 'bank'>('mail');
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
  const bankQueryKey = ['bank_contacts', userEmail];

  const { data: contacts = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getUserContacts(),
    enabled: !!userEmail && activeTab === 'mail',
  });

  const { data: bankContacts = [], isLoading: isBankLoading } = useQuery({
    queryKey: bankQueryKey,
    queryFn: () => getUserBankContacts(),
    enabled: !!userEmail && activeTab === 'bank',
  });

  const addMutation = useMutation({
    mutationFn: () => addContact({ contactEmail: newEmail, contactName: newName }),
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
    mutationFn: (contactId: string) => {
      if (activeTab === 'bank') return deleteBankContact(contactId);
      return deleteContact(contactId);
    },
    onSuccess: () => {
      if (activeTab === 'bank') {
        queryClient.invalidateQueries({ queryKey: bankQueryKey });
      } else {
        queryClient.invalidateQueries({ queryKey });
      }
      setContactToDelete(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editingContactId) return Promise.resolve({ success: true as const });
      return updateContact({ contactId: editingContactId, contactEmail: editEmail, contactName: editName });
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

  return {
    activeTab,
    setActiveTab,
    isAdding,
    setIsAdding,
    newName,
    setNewName,
    newEmail,
    setNewEmail,
    error,
    setError,
    editingContactId,
    setEditingContactId,
    editName,
    setEditName,
    editEmail,
    setEditEmail,
    contactToDelete,
    setContactToDelete,
    contacts,
    isLoading,
    bankContacts,
    isBankLoading,
    addMutation,
    deleteMutation,
    updateMutation,
    handleAddSubmit,
    handleEditSubmit,
    handleStartEdit,
  };
}

export function useUserContacts(userEmail: string) {
  return useQuery({
    queryKey: ['contacts', userEmail],
    queryFn: () => getUserContacts(),
    enabled: !!userEmail,
  });
}


'use client';

import { BookUser, Plus } from 'lucide-react';
import { AddContactForm } from './contacts/AddContactForm';
import { DeleteConfirmDialog } from './contacts/DeleteConfirmDialog';
import { Contact } from './contacts/types';
import { MailContactList } from './contacts/MailContactList';
import { BankContactList } from './contacts/BankContactList';
import { useContacts } from './contacts/useContacts';

interface ContactsModuleProps {
  userEmail: string;
  onSelectContact?: (email: string) => void;
}

export function ContactsModule({ userEmail, onSelectContact }: ContactsModuleProps) {
  const {
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
  } = useContacts(userEmail);

  return (
    <div className="card-elegant p-8 md:p-12 bg-background border-border relative overflow-hidden">
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
        {!isAdding && activeTab === 'mail' && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/10 text-accent font-bold text-xs uppercase tracking-widest hover:bg-accent/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        )}
      </div>

      <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 mb-8 max-w-sm">
        <button
          onClick={() => { setActiveTab('mail'); setIsAdding(false); }}
          className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all ${
            activeTab === 'mail'
              ? 'bg-accent text-[#07070a] shadow-lg'
              : 'text-white/40 hover:text-white/60'
          }`}
        >
          Mail Contacts
        </button>
        <button
          onClick={() => { setActiveTab('bank'); setIsAdding(false); }}
          className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all ${
            activeTab === 'bank'
              ? 'bg-accent text-[#07070a] shadow-lg'
              : 'text-white/40 hover:text-white/60'
          }`}
        >
          Bank Contacts
        </button>
      </div>

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

      <div className="space-y-4">
        {activeTab === 'mail' ? (
          <MailContactList
            contacts={contacts as Contact[]}
            isLoading={isLoading}
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
        ) : (
          <BankContactList
            bankContacts={bankContacts}
            isLoading={isBankLoading}
            onDeleteRequest={setContactToDelete}
          />
        )}
      </div>

      <DeleteConfirmDialog
        contactToDelete={contactToDelete}
        isPending={deleteMutation.isPending}
        onConfirm={() => contactToDelete && deleteMutation.mutate(contactToDelete.id)}
        onCancel={() => setContactToDelete(null)}
      />
    </div>
  );
}

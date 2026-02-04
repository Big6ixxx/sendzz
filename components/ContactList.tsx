'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Search, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AddContactDialog } from './AddContactDialog';

interface Contact {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  created_at: string;
}

export function ContactList() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/contacts');
      const data = await res.json();
      if (res.ok) {
        setContacts(data.contacts);
      }
    } catch (error) {
      console.error('Failed to fetch contacts', error);
    } finally {
      setLoading(false);
    }
  };

  const handleContactAdded = (contact: { name: string; email: string }) => {
    setContacts(
      [
        ...contacts,
        {
          ...contact,
          id: 'temp-' + Date.now(),
          created_at: new Date().toISOString(),
        },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    // Re-fetch to get real ID
    fetchContacts();
  };;

  const handleDeleteContact = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete');

      setContacts(contacts.filter((c) => c.id !== id));
      toast.success(`Removed ${name}`);
    } catch {
      toast.error('Failed to remove contact');
    }
  };

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card className="border-2 shadow-sm h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Contacts
            </CardTitle>
            <CardDescription>Manage your saved recipients</CardDescription>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4" />
            Add
          </Button>
          <AddContactDialog
            open={open}
            onOpenChange={setOpen}
            onContactAdded={handleContactAdded}
          />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[400px] pr-4 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {search
                ? 'No contacts found.'
                : 'No contacts yet. Add one to get started!'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredContacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={contact.avatar_url} />
                      <AvatarFallback>
                        {contact.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-sm">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {contact.email}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-red-500"
                    onClick={() =>
                      handleDeleteContact(contact.id, contact.name)
                    }
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

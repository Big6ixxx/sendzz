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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Search, Trash2, User, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

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

  // New Contact Form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);

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

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) return;

    setSaving(true);
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, email: newEmail }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to add contact');
      }

      setContacts(
        [...contacts, data.contact].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setOpen(false);
      setNewName('');
      setNewEmail('');
      toast.success('Contact added!');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add contact',
      );
    }
    setSaving(false);
  };

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
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Contact</DialogTitle>
                <DialogDescription>
                  Save a recipient for quick transfers.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddContact} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="Alice Smith"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="alice@example.com"
                      className="pl-10"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving}>
                    {saving && (
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    )}
                    Save Contact
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
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

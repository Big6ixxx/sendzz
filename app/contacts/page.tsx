'use client';

import { ContactList } from '@/components/ContactList';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

export default function ContactsPage() {
  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 animate-fade-in">
      <div className="mb-8">
        <Link href="/dashboard">
          <Button
            variant="ghost"
            className="mb-4 pl-0 hover:pl-2 transition-all"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
        <p className="text-muted-foreground mt-2">
          Manage your saved recipients for quick and easy transfers.
        </p>
      </div>

      <div className="grid gap-8">
        <Suspense fallback={<div>Loading...</div>}>
          <ContactList />
        </Suspense>
      </div>
    </div>
  );
}
